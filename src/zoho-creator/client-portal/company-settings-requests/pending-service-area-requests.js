"use strict";

const { createHash } = require("node:crypto");
const { assertCompanyIdentity, validateRequestedServiceArea } = require("./service-area-request-contract");
const continuations = new WeakMap();
const RESOURCE = "Company_Settings_Requests";
const FIELDS = Object.freeze(["ID", "Account", "Previous_Service_Area", "Requested_Service_Area", "Status"]);

function deny() { throw new TypeError("Invalid pending service-area request read evidence"); }
function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) deny();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) deny();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
    copy[key] = descriptor.value;
  }
  return copy;
}
function list(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 1000 || Reflect.ownKeys(value).length !== value.length + 1) deny();
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
    return descriptor.value;
  });
}
function id(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) deny();
  return value;
}
function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) deny();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) deny();
  return time;
}
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function digest(value) { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function receipt(value, keys, policy) {
  const result = record(value, ["environment", "organizationId", "observedAt", "complete", ...keys]);
  const age = instant(policy.asOf) - instant(result.observedAt);
  if (result.environment !== policy.expectedEnvironment || result.organizationId !== policy.expectedOrganizationId ||
      result.complete !== true || age < 0 || age > policy.maxAgeMs) deny();
  return result;
}
function authorize(account, trusted, policy) {
  const p = record(policy, ["expectedEnvironment", "expectedOrganizationId", "asOf", "maxAgeMs"]);
  if (!["development", "staging", "production"].includes(p.expectedEnvironment) ||
      !Number.isSafeInteger(p.maxAgeMs) || p.maxAgeMs <= 0) deny();
  id(p.expectedOrganizationId); instant(p.asOf); id(account);
  const t = receipt(trusted, ["company", "readGrant"], p);
  assertCompanyIdentity(t.company, account);
  const company = t.company;
  // An alias of the same canonical CRM company makes the complete join ambiguous.
  if (company.companyMappings.filter(mapping => mapping.crmAccountId === company.contact.accountId).length !== 1) deny();
  const grant = record(t.readGrant, ["principalId", "creatorAccountId", "operation", "active", "revision"]);
  id(grant.revision);
  if (grant.principalId !== company.principalId || grant.creatorAccountId !== account ||
      grant.operation !== "company-settings-requests.read" || grant.active !== true) deny();
  return { policy: p, observedAt: t.observedAt, identity: [company.principalId, company.auditActorId,
    company.contact.id, company.contact.accountId, account, grant.operation, grant.revision] };
}

// An internal read plan, not a Creator URL or API invocation. A protected adapter
// must qualify the native report, Account predicate and terminal pagination.
function preparePendingServiceAreaRequestRead(input, trusted, policy) {
  try {
    const request = record(input, ["Account"]);
    const context = authorize(request.Account, trusted, policy);
    return freeze({ method: "GET", resource: RESOURCE, environment: context.policy.expectedEnvironment,
      organizationId: context.policy.expectedOrganizationId, criteria: { Account: request.Account }, fields: [...FIELDS] });
  } catch { deny(); }
}

// Structural consistency only: neither caller-created objects nor complete:true
// authenticate a user or certify a provider snapshot. No transport or writer.
function preparePendingServiceAreaRequests(input, trusted, evidence, policy) {
  try {
    const request = record(input, ["Account", "limit", "cursor"]);
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100) deny();
    const context = authorize(request.Account, trusted, policy);
    if (evidence === null) {
      if (request.cursor !== null) deny();
      return freeze({ state: "unknown", observedAt: context.observedAt,
        items: null, totalCount: null, hasMore: false, nextCursor: null });
    }
    const source = receipt(evidence, ["resource", "accountId", "snapshotId", "items"], context.policy);
    if (source.resource !== RESOURCE || source.accountId !== request.Account) deny();
    id(source.snapshotId);
    const seen = new Set();
    // Validate the entire scoped collection before selecting a page. Filtering
    // foreign rows here would conceal a broken provider-side tenant predicate.
    const rows = list(source.items).map(value => {
      const row = record(value, FIELDS);
      id(row.ID);
      if (row.Account !== request.Account || row.Status !== "Pending review" || seen.has(row.ID)) deny();
      seen.add(row.ID);
      // The native before-image field is optional, unlike the write planner's
      // required fresh CRM baseline. Do not invent one for historical records.
      if (row.Previous_Service_Area !== null && row.Previous_Service_Area !== "") {
        validateRequestedServiceArea(row.Previous_Service_Area);
      }
      validateRequestedServiceArea(row.Requested_Service_Area);
      // Preserve persisted text exactly; render as text, never as markup.
      return { ID: row.ID, Previous_Service_Area: row.Previous_Service_Area,
        Requested_Service_Area: row.Requested_Service_Area, Status: row.Status };
    }).sort((a, b) => compare(a.ID, b.ID));
    const binding = digest([RESOURCE, context.policy.expectedEnvironment, context.policy.expectedOrganizationId,
      context.policy.maxAgeMs, context.identity, request.limit]);
    const snapshot = digest([source.snapshotId, source.observedAt, rows]);
    let start = 0;
    if (request.cursor !== null) {
      const previous = continuations.get(request.cursor);
      if (!previous || previous.binding !== binding || previous.snapshot !== snapshot) deny();
      const position = rows.findIndex(row => row.ID === previous.after);
      if (position < 0) deny();
      start = position + 1;
    }
    const items = rows.slice(start, start + request.limit);
    const hasMore = start + items.length < rows.length;
    let nextCursor = null;
    if (hasMore) {
      nextCursor = Object.freeze({});
      continuations.set(nextCursor, { binding, snapshot, after: items[items.length - 1].ID });
    }
    return freeze({ state: rows.length ? "available" : "empty",
      observedAt: context.observedAt < source.observedAt ? context.observedAt : source.observedAt,
      items, totalCount: rows.length, hasMore, nextCursor });
  } catch { deny(); }
}

module.exports = { preparePendingServiceAreaRequestRead, preparePendingServiceAreaRequests };
