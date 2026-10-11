"use strict";

const { resolveProtectedCompanyLinks, prepareOfflineRequestBinding } = require("./offline-identity-contract");
const { validateRequestedServiceArea } = require("./service-area-request-contract");

function deny() {
  // Never expose provider errors, record contents, or protected identity data.
  throw new TypeError("Invalid service-area read evidence");
}

// Snapshot own data descriptors, including nonenumerable data. Do not execute getters,
// custom iterators, toJSON, or caller-owned methods while accepting evidence.
function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) deny();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) deny();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) deny();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
    copy[key] = descriptor.value;
  }
  return copy;
}

function array(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) deny();
  const copy = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
    copy.push(descriptor.value);
  }
  return copy;
}

function rows(value, keys) {
  return Object.freeze(array(value).map((row) => Object.freeze(record(row, keys))));
}

function identifier(value) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      /[\u0000-\u0020\u007f]/.test(value)) deny();
}

function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) deny();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) deny();
  return milliseconds;
}

function readPolicy(value) {
  const copy = record(value, ["expectedEnvironment", "expectedOrganizationId", "asOf", "maxAgeMs"]);
  if (!["development", "staging", "production"].includes(copy.expectedEnvironment)) deny();
  identifier(copy.expectedOrganizationId);
  instant(copy.asOf);
  if (!Number.isSafeInteger(copy.maxAgeMs) || copy.maxAgeMs <= 0) deny();
  return Object.freeze(copy);
}

function checkScopeAndFreshness(evidence, policy) {
  if (evidence.environment !== policy.expectedEnvironment ||
      evidence.organizationId !== policy.expectedOrganizationId) deny();
  const age = instant(policy.asOf) - instant(evidence.observedAt);
  if (age < 0 || age > policy.maxAgeMs) deny();
}

function protectedSnapshot(value, policy) {
  const copy = record(value, ["environment", "organizationId", "observedAt", "complete",
    "principal", "grants", "accountLinks", "contactLinks"]);
  checkScopeAndFreshness(copy, policy);
  return Object.freeze({
    principal: Object.freeze(record(copy.principal, ["id", "auditActorId"])),
    complete: copy.complete,
    grants: rows(copy.grants, ["principalId", "creatorAccountId", "creatorContactId", "scope", "active", "revision"]),
    accountLinks: rows(copy.accountLinks, ["creatorAccountId", "crmAccountId", "revision"]),
    contactLinks: rows(copy.contactLinks, ["creatorContactId", "creatorAccountId", "crmContactId", "revision"]),
  });
}

function descriptor(module, recordId, fields, policy) {
  return Object.freeze({ method: "GET", module, recordId, fields: Object.freeze(fields),
    environment: policy.expectedEnvironment, organizationId: policy.expectedOrganizationId });
}

// This envelope belongs to the injected server adapter, not the CRM API. A CRM
// response alone cannot establish its organization, environment, or observation time.
function receiptRow(value, request, policy, keys) {
  const receipt = record(value, ["state", "environment", "organizationId", "observedAt",
    "module", "recordId", "complete", "response"]);
  checkScopeAndFreshness(receipt, policy);
  if (receipt.state !== "available" || receipt.complete !== true ||
      receipt.module !== request.module || receipt.recordId !== request.recordId) deny();
  const response = record(receipt.response, ["data"]);
  const data = array(response.data);
  if (data.length !== 1) deny();
  const row = record(data[0], keys);
  // No coercion: CRM IDs can exceed JavaScript's safe integer range.
  if (row.id !== request.recordId) deny();
  return row;
}

async function produceServiceAreaRequest(input, trusted, issuance, policy, get) {
  try {
    // Complete validation and copying before yielding to the injected reader.
    const client = Object.freeze(record(input, ["Account", "Requested_Service_Area"]));
    validateRequestedServiceArea(client.Requested_Service_Area);
    const issued = Object.freeze(record(issuance, ["requestId", "issuedAt"]));
    identifier(issued.requestId);
    instant(issued.issuedAt);
    const limits = readPolicy(policy);
    const evidence = protectedSnapshot(trusted, limits);
    const identity = resolveProtectedCompanyLinks(client.Account, evidence);
    if (typeof get !== "function") deny();

    const contactRequest = descriptor("Contacts", identity.crmContactId, ["id", "Account_Name"], limits);
    const contact = receiptRow(await get(contactRequest), contactRequest, limits, ["id", "Account_Name"]);
    const lookup = record(contact.Account_Name, Object.hasOwn(contact.Account_Name || {}, "name")
      ? ["id", "name"] : ["id"]);
    if (lookup.id !== identity.crmAccountId ||
        (Object.hasOwn(lookup, "name") && typeof lookup.name !== "string")) deny();
    const contactFact = Object.freeze({ id: contact.id, accountId: lookup.id });

    // Never follow a returned lookup to a different company or retry a failed read.
    const accountRequest = descriptor("Accounts", identity.crmAccountId, ["id", "Primary_Service_Area"], limits);
    const account = receiptRow(await get(accountRequest), accountRequest, limits, ["id", "Primary_Service_Area"]);
    validateRequestedServiceArea(account.Primary_Service_Area);
    const accountFact = Object.freeze({ id: account.id, previousServiceArea: account.Primary_Service_Area });
    return prepareOfflineRequestBinding(client, {
      ...evidence, crmContacts: [contactFact], crmAccounts: [accountFact],
    }, issued);
  } catch {
    deny();
  }
}

module.exports = { produceServiceAreaRequest };
