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

// Separate protocol: legacy callers retain their fixed-asOf snapshot semantics.
async function produceTimedServiceAreaRequest(input, requestId, policy, services) {
  let timer, expired = false;
  try {
    const client = Object.freeze(record(input, ["Account", "Requested_Service_Area"]));
    validateRequestedServiceArea(client.Requested_Service_Area);
    identifier(requestId);
    const config = record(policy, ["protocol", "expectedEnvironment", "expectedOrganizationId", "maxAgeMs", "maxDurationMs"]);
    if (config.protocol !== "timed-read-v2" || !Number.isSafeInteger(config.maxDurationMs) ||
        config.maxDurationMs <= 0 || config.maxDurationMs > 2147483647) deny();
    const callbacks = record(services, ["now", "readAuthorization", "get"]);
    if (Object.values(callbacks).some((value) => typeof value !== "function")) deny();
    const elapsedDeadline = performance.now() + config.maxDurationMs;
    let last = instant(callbacks.now());
    const started = last;
    const deadline = started + config.maxDurationMs;
    if (!Number.isSafeInteger(deadline)) deny();
    const issuedAt = new Date(started).toISOString();
    const deadlineAt = new Date(deadline).toISOString();
    readPolicy({ expectedEnvironment: config.expectedEnvironment,
      expectedOrganizationId: config.expectedOrganizationId, maxAgeMs: config.maxAgeMs, asOf: issuedAt });
    function clock() {
      const next = instant(callbacks.now());
      if (expired || performance.now() >= elapsedDeadline || next < last || next >= deadline) deny();
      last = next;
      return new Date(next).toISOString();
    }
    function limits(asOf) {
      return readPolicy({ expectedEnvironment: config.expectedEnvironment,
        expectedOrganizationId: config.expectedOrganizationId, maxAgeMs: config.maxAgeMs, asOf });
    }
    let identity, authorizationObservedAt, finalObservations;
    function finalCheck() {
      const finalPolicy = limits(clock());
      for (const observedAt of finalObservations) {
        checkScopeAndFreshness({ environment: config.expectedEnvironment,
          organizationId: config.expectedOrganizationId, observedAt }, finalPolicy);
      }
    }
    async function authorize() {
      const began = instant(clock());
      const raw = await callbacks.readAuthorization();
      const current = limits(clock());
      const observed = record(raw, ["environment", "organizationId", "observedAt", "complete",
        "principal", "grants", "accountLinks", "contactLinks"]);
      if (instant(observed.observedAt) < began) deny();
      const snapshot = protectedSnapshot(observed, current);
      const resolved = resolveProtectedCompanyLinks(client.Account, snapshot);
      if (identity && Object.keys(identity).some((key) => identity[key] !== resolved[key])) deny();
      identity = resolved;
      authorizationObservedAt = observed.observedAt;
      return snapshot;
    }
    async function run() {
      await authorize();
      async function read(module, id, fields, keys) {
        const began = instant(clock());
        const request = Object.freeze({ ...descriptor(module, id, fields, limits(new Date(began).toISOString())),
          protocol: config.protocol, requestStartedAt: issuedAt, deadlineAt });
        const raw = await callbacks.get(request);
        const current = limits(clock());
        const row = receiptRow(raw, request, current, keys);
        if (instant(raw.observedAt) < began) deny();
        // Detach before another callback can mutate the accepted facts.
        if (module === "Contacts") {
          const lookup = record(row.Account_Name, Object.hasOwn(row.Account_Name || {}, "name")
            ? ["id", "name"] : ["id"]);
          if (lookup.id !== identity.crmAccountId ||
              (Object.hasOwn(lookup, "name") && typeof lookup.name !== "string")) deny();
          return Object.freeze({ observedAt: raw.observedAt,
            fact: Object.freeze({ id: row.id, accountId: lookup.id }) });
        }
        validateRequestedServiceArea(row.Primary_Service_Area);
        return Object.freeze({ observedAt: raw.observedAt,
          fact: Object.freeze({ id: row.id, previousServiceArea: row.Primary_Service_Area }) });
      }
      const contact = await read("Contacts", identity.crmContactId, ["id", "Account_Name"], ["id", "Account_Name"]);
      await authorize();
      const account = await read("Accounts", identity.crmAccountId, ["id", "Primary_Service_Area"], ["id", "Primary_Service_Area"]);
      const finalAuthorization = await authorize();
      const prepared = prepareOfflineRequestBinding(client, { ...finalAuthorization,
        crmContacts: [contact.fact], crmAccounts: [account.fact] }, { requestId, issuedAt });
      finalObservations = Object.freeze([contact.observedAt, account.observedAt, authorizationObservedAt]);
      finalCheck();
      return prepared;
    }
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new TypeError("Invalid service-area read evidence")); },
        Math.max(0, elapsedDeadline - performance.now()));
    });
    const prepared = await Promise.race([run(), timeout]);
    // Promise resolution introduces another continuation window after run's check.
    finalCheck();
    return prepared;
  } catch {
    deny();
  } finally {
    clearTimeout(timer);
    expired = true;
  }
}

module.exports = { produceServiceAreaRequest, produceTimedServiceAreaRequest };
