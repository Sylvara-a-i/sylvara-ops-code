"use strict";

const { createHash } = require("node:crypto");
const { preparePendingServiceAreaRequest, validateRequestedServiceArea } = require("./service-area-request-contract");

function deny() {
  throw new TypeError("Invalid explicit portal identity or replay binding");
}

function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) deny();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) deny();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) deny();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
  }
}

function identifier(value) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      /[\u0000-\u0020\u007f]/.test(value)) deny();
}

function rows(value, keys, textKeys = keys) {
  if (!Array.isArray(value)) deny();
  // Accept dense ordinary data arrays only; accessors/custom iterators are not evidence.
  if (Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) deny();
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
    record(descriptor.value, keys);
    for (const key of textKeys) identifier(descriptor.value[key]);
  }
}

function onlyMatch(values, matches) {
  const found = values.filter(matches);
  if (found.length !== 1) deny();
  return found[0];
}

// Offline structural resolution, NOT authentication or live link discovery.
function resolveExplicitCompanyIdentity(accountSelector, evidence) {
  identifier(accountSelector);
  record(evidence, ["principal", "complete", "grants", "accountLinks", "contactLinks", "crmContacts", "crmAccounts"]);
  record(evidence.principal, ["id", "auditActorId"]);
  identifier(evidence.principal.id);
  identifier(evidence.principal.auditActorId);
  if (evidence.complete !== true) deny();
  rows(evidence.grants, ["principalId", "creatorAccountId", "creatorContactId", "scope", "active", "revision"],
    ["principalId", "creatorAccountId", "creatorContactId", "scope", "revision"]);
  for (const grant of evidence.grants) {
    if (typeof grant.active !== "boolean" || grant.scope !== "service-area-request") deny();
  }
  rows(evidence.accountLinks, ["creatorAccountId", "crmAccountId", "revision"]);
  rows(evidence.contactLinks, ["creatorContactId", "creatorAccountId", "crmContactId", "revision"]);
  rows(evidence.crmContacts, ["id", "accountId"]);
  rows(evidence.crmAccounts, ["id", "previousServiceArea"], ["id"]);

  const grant = onlyMatch(evidence.grants, (row) =>
    row.principalId === evidence.principal.id && row.creatorAccountId === accountSelector);
  if (!grant.active) deny();
  const accountLink = onlyMatch(evidence.accountLinks, (row) => row.creatorAccountId === accountSelector);
  onlyMatch(evidence.accountLinks, (row) => row.crmAccountId === accountLink.crmAccountId);
  const contactLink = onlyMatch(evidence.contactLinks, (row) => row.creatorContactId === grant.creatorContactId);
  onlyMatch(evidence.contactLinks, (row) => row.crmContactId === contactLink.crmContactId);
  if (contactLink.creatorAccountId !== accountSelector) deny();
  const contact = onlyMatch(evidence.crmContacts, (row) => row.id === contactLink.crmContactId);
  if (contact.accountId !== accountLink.crmAccountId) deny();
  const account = onlyMatch(evidence.crmAccounts, (row) => row.id === accountLink.crmAccountId);
  validateRequestedServiceArea(account.previousServiceArea);
  return Object.freeze({
    principalId: evidence.principal.id,
    auditActorId: evidence.principal.auditActorId,
    creatorAccountId: accountSelector,
    creatorContactId: grant.creatorContactId,
    crmAccountId: account.id,
    crmContactId: contact.id,
    grantRevision: grant.revision,
    accountLinkRevision: accountLink.revision,
    contactLinkRevision: contactLink.revision,
    previousServiceArea: account.previousServiceArea,
  });
}

function digest(tuple) {
  return createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex");
}

function prepareOfflineRequestBinding(input, evidence, issuance) {
  record(issuance, ["requestId", "issuedAt"]);
  identifier(issuance.requestId);
  if (typeof issuance.issuedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(issuance.issuedAt)) deny();
  const milliseconds = Date.parse(issuance.issuedAt);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== issuance.issuedAt) deny();
  // The existing planner owns input validation and all four form fields.
  // Read the selector only after its own descriptor has been checked.
  record(input, ["Account", "Requested_Service_Area"]);
  const identity = resolveExplicitCompanyIdentity(input.Account, evidence);
  const request = preparePendingServiceAreaRequest(input, {
    principalId: identity.principalId,
    auditActorId: identity.auditActorId,
    contact: { id: identity.crmContactId, accountId: identity.crmAccountId },
    companyMappings: [{ creatorAccountId: identity.creatorAccountId, crmAccountId: identity.crmAccountId, active: true }],
    previousServiceArea: identity.previousServiceArea,
  });
  const { previousServiceArea, ...attributes } = identity;
  const attribution = Object.freeze(attributes);
  const claimKey = digest(["portal-service-area-claim-v1", attribution.principalId, issuance.requestId]);
  // A fixed ordered tuple binds every consequential value without object-key ordering ambiguity.
  const bindingDigest = digest([
    "portal-service-area-binding-v1", claimKey, issuance.requestId, issuance.issuedAt,
    attribution.principalId, attribution.auditActorId, attribution.creatorAccountId,
    attribution.creatorContactId, attribution.crmAccountId, attribution.crmContactId,
    attribution.grantRevision, attribution.accountLinkRevision, attribution.contactLinkRevision,
    request.Account, request.Previous_Service_Area, request.Requested_Service_Area, request.Status,
  ]);
  return Object.freeze({
    request,
    attribution,
    requestId: issuance.requestId,
    issuedAt: issuance.issuedAt,
    binding: Object.freeze({ claimKey, bindingDigest }),
  });
}

// Compare only bindings from trusted producer output and trusted durable readback.
// This has no claim/write/replay side effects and does not authenticate either object.
function assertSameReplayBinding(storedBinding, candidateBinding) {
  for (const binding of [storedBinding, candidateBinding]) {
    record(binding, ["claimKey", "bindingDigest"]);
    for (const value of Object.values(binding)) {
      if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) deny();
    }
  }
  if (storedBinding.claimKey !== candidateBinding.claimKey ||
      storedBinding.bindingDigest !== candidateBinding.bindingDigest) deny();
}

module.exports = {
  resolveExplicitCompanyIdentity,
  prepareOfflineRequestBinding,
  assertSameReplayBinding,
};
