"use strict";

const { resolveProtectedCompanyLinks } = require("./offline-identity-contract");

function deny() { throw new TypeError("Invalid Creator authorization evidence"); }

function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) deny();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) deny();
  const copy = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, "value")) deny();
    copy[key] = d.value;
  }
  return copy;
}

function list(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) deny();
  return Array.from({ length: value.length }, (_, index) => {
    const d = Object.getOwnPropertyDescriptor(value, String(index));
    if (!d || !Object.hasOwn(d, "value")) deny();
    return d.value;
  });
}

function text(value) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      /[\u0000-\u0020\u007f]/.test(value)) deny();
  return value;
}

function label(value) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      /[\u0000-\u001f\u007f]/.test(value)) deny();
  return value;
}

function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) deny();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) deny();
  return time;
}

function one(rows, predicate) {
  const found = rows.filter(predicate);
  if (found.length !== 1) deny();
  return found[0];
}

// Offline projection for the EXISTING readAuthorization seam, not authentication.
// Both receipts and policy must be installed by the protected server composition.
// No browser payload, portal email lookup, or fixture resolver supplies authority.
function projectCreatorAuthorization(accountSelector, sessionReceipt, registryReceipt, policy) {
  try {
    const limits = record(policy, ["expectedEnvironment", "expectedOrganizationId", "asOf", "maxAgeMs", "allowedPermissions"]);
    if (!["development", "staging", "production"].includes(limits.expectedEnvironment) ||
        !Number.isSafeInteger(limits.maxAgeMs) || limits.maxAgeMs <= 0) deny();
    text(limits.expectedOrganizationId);
    const asOf = instant(limits.asOf);
    const permissions = list(limits.allowedPermissions).map(label);
    if (!permissions.length || new Set(permissions).size !== permissions.length) deny();
    function receipt(value, keys) {
      const r = record(value, ["environment", "organizationId", "observedAt", "complete", ...keys]);
      const age = asOf - instant(r.observedAt);
      if (r.complete !== true || r.environment !== limits.expectedEnvironment ||
          r.organizationId !== limits.expectedOrganizationId || age < 0 || age > limits.maxAgeMs) deny();
      return r;
    }
    const session = receipt(sessionReceipt, ["callerContextQualified", "nativeSubjectId", "incarnationId", "emailAddresses", "username", "permission"]);
    if (session.callerContextQualified !== true) deny();
    for (const key of ["nativeSubjectId", "incarnationId"]) text(session[key]);
    label(session.username);
    label(session.permission);
    const emails = list(session.emailAddresses).map(text);
    if (emails.length !== 1 || !permissions.includes(session.permission)) deny();
    const registry = receipt(registryReceipt, ["bindings", "grants", "accountLinks", "contactLinks"]);
    const bindingKeys = ["principalId", "auditActorId", "nativeSubjectId", "incarnationId", "emailLookup", "username", "active", "revision"];
    const bindings = list(registry.bindings).map(row => {
      const b = record(row, bindingKeys);
      for (const key of bindingKeys.filter(key => !["active", "username"].includes(key))) text(b[key]);
      label(b.username);
      if (typeof b.active !== "boolean") deny();
      return b;
    });
    // Search all candidates, including inactive tombstones. Never choose the
    // active/latest match to resolve a duplicate or recreate an old identity.
    const binding = one(bindings, b => b.emailLookup === emails[0]);
    one(bindings, b => b.nativeSubjectId === binding.nativeSubjectId);
    one(bindings, b => b.principalId === binding.principalId);
    one(bindings, b => b.auditActorId === binding.auditActorId);
    if (!binding.active || binding.nativeSubjectId !== session.nativeSubjectId ||
        binding.incarnationId !== session.incarnationId || binding.username !== session.username) deny();

    // Existing resolver owns grants and canonical CRM joins; do not reimplement them.
    const snapshot = {
      principal: { id: binding.principalId, auditActorId: binding.auditActorId }, complete: true,
      grants: registry.grants, accountLinks: registry.accountLinks, contactLinks: registry.contactLinks,
    };
    resolveProtectedCompanyLinks(accountSelector, snapshot);
    // Detach accepted primitive rows; no getters/toJSON/client-owned methods executed.
    const copyRows = (rows, keys) => Object.freeze(list(rows).map(row => Object.freeze(record(row, keys))));
    // The oldest constituent time is used. A later registry read cannot refresh
    // a cached session or permission observation for the timed producer.
    return Object.freeze({
      environment: limits.expectedEnvironment, organizationId: limits.expectedOrganizationId,
      observedAt: new Date(Math.min(instant(session.observedAt), instant(registry.observedAt))).toISOString(),
      complete: true, principal: Object.freeze(snapshot.principal),
      grants: copyRows(snapshot.grants, ["principalId", "creatorAccountId", "creatorContactId", "scope", "active", "revision"]),
      accountLinks: copyRows(snapshot.accountLinks, ["creatorAccountId", "crmAccountId", "revision"]),
      contactLinks: copyRows(snapshot.contactLinks, ["creatorContactId", "creatorAccountId", "crmContactId", "revision"]),
    });
  } catch { deny(); }
}

module.exports = { projectCreatorAuthorization };
