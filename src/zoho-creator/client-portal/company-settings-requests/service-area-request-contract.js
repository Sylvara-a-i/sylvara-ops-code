"use strict";

function deny() {
  // Do not echo selectors, baselines, or principal identifiers in errors.
  throw new TypeError("Invalid service-area request or verified company context");
}

function assertRecord(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) deny();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) deny();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => !keys.includes(key))) deny();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
  }
}

function assertDataArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) deny();
  // Validate every index before iteration can invoke an accessor or custom iterator.
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
  }
}

function assertIdentifier(value) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      /[\u0000-\u0020\u007f]/.test(value)) deny();
}

function validateRequestedServiceArea(value) {
  if (typeof value !== "string") deny();
  // Exact normalizeText semantics for Form2's required multiline maximum=2000.
  // Kept local to avoid coupling this planner to the deployed Form2 writer.
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized) ||
      [...normalized].length > 2000) deny();
  return normalized;
}

// Structural assertions only. The adapter must independently authenticate and
// verify every fact; a caller-created object cannot establish authorization.
function assertCompanyIdentity(context, accountSelector) {
  assertIdentifier(accountSelector);
  assertRecord(context, ["principalId", "contact", "companyMappings", "auditActorId"]);
  assertIdentifier(context.principalId);
  assertIdentifier(context.auditActorId);
  assertRecord(context.contact, ["id", "accountId"]);
  assertIdentifier(context.contact.id);
  assertIdentifier(context.contact.accountId);
  assertDataArray(context.companyMappings);
  if (context.companyMappings.length === 0) deny();
  const matches = [];
  for (const mapping of context.companyMappings) {
    assertRecord(mapping, ["creatorAccountId", "crmAccountId", "active"]);
    assertIdentifier(mapping.creatorAccountId);
    assertIdentifier(mapping.crmAccountId);
    if (typeof mapping.active !== "boolean") deny();
    if (mapping.creatorAccountId === accountSelector) matches.push(mapping);
  }
  if (matches.length !== 1 || !matches[0].active ||
      matches[0].crmAccountId !== context.contact.accountId) deny();
  return matches[0].creatorAccountId;
}

function assertVerifiedCompanyContext(context, accountSelector) {
  assertRecord(context, ["principalId", "contact", "companyMappings", "previousServiceArea", "auditActorId"]);
  const account = assertCompanyIdentity({
    principalId: context.principalId, contact: context.contact,
    companyMappings: context.companyMappings, auditActorId: context.auditActorId,
  }, accountSelector);
  // Validate availability without normalizing the authoritative before-image.
  validateRequestedServiceArea(context.previousServiceArea);
  return account;
}

function preparePendingServiceAreaRequest(input, verifiedContext) {
  assertRecord(input, ["Account", "Requested_Service_Area"]);
  const account = assertVerifiedCompanyContext(verifiedContext, input.Account);
  const requested = validateRequestedServiceArea(input.Requested_Service_Area);
  return Object.freeze({
    Account: account,
    Previous_Service_Area: verifiedContext.previousServiceArea,
    Requested_Service_Area: requested,
    Status: "Pending review",
  });
}

module.exports = {
  validateRequestedServiceArea,
  assertVerifiedCompanyContext,
  assertCompanyIdentity,
  preparePendingServiceAreaRequest,
};
