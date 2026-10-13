"use strict";

const { createHash } = require("node:crypto");
const { assertCompanyIdentity } = require("../company-settings-requests/service-area-request-contract");
const continuations = new WeakMap();
const OUTCOMES = Object.freeze(["potential_job", "existing_customer", "urgent_potential_job", "spam",
  "unsupported_service", "out_of_area", "other_general_inquiry", "sensitive_data_ended",
  "configuration_failure", "caller_abandoned", "unresolved"]);

function deny() { throw new TypeError("Invalid company call/report projection evidence"); }
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
      value.length > 1000 || Reflect.ownKeys(value).length !== value.length + 1) deny();
  return Array.from({ length: value.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !Object.hasOwn(d, "value")) deny();
    return d.value;
  });
}
function id(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) deny();
  return value;
}
function hash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) deny();
  return value;
}
function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) deny();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) deny();
  return ms;
}
function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) deny();
  instant(value + "T00:00:00.000Z");
}
function digest(value) { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function reportPreference(value, policy, company, accountId) {
  if (value === null) return null;
  const saved = record(value, ["version", "environment", "organizationId", "principalId",
    "creatorAccountId", "crmAccountId", "resource", "dateRange"]);
  if (saved.version !== 1 || saved.environment !== policy.expectedEnvironment ||
      saved.organizationId !== policy.expectedOrganizationId || saved.principalId !== company.principalId ||
      saved.creatorAccountId !== accountId || saved.crmAccountId !== company.contact.accountId ||
      saved.resource !== "reports") deny();
  if (saved.dateRange !== null) {
    saved.dateRange = record(saved.dateRange, ["start", "end"]);
    date(saved.dateRange.start); date(saved.dateRange.end);
    if (saved.dateRange.start > saved.dateRange.end) deny();
  }
  return saved;
}

// This is an offline server consistency boundary, NOT an authenticator. A
// protected composition must supply fresh identity, grants and canonical source
// receipts. Browser-created trusted/evidence/policy objects confer no authority.
function project(resource, input, trusted, evidence, policy, withPreference = false) {
  try {
    const request = record(input, ["Account", "limit", "cursor", ...(withPreference ? ["preference"] : [])]);
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100) deny();
    const p = record(policy, ["expectedEnvironment", "expectedOrganizationId", "asOf", "maxAgeMs",
      ...(withPreference ? ["reportEntitlementPolicyRevision"] : [])]);
    if (!["development", "stage", "production"].includes(p.expectedEnvironment) ||
        !Number.isSafeInteger(p.maxAgeMs) || p.maxAgeMs <= 0) deny();
    id(p.expectedOrganizationId);
    const asOf = instant(p.asOf);
    function receipt(value, keys) {
      const r = record(value, ["environment", "organizationId", "observedAt", "complete", ...keys]);
      const age = asOf - instant(r.observedAt);
      if (r.complete !== true || r.environment !== p.expectedEnvironment ||
          r.organizationId !== p.expectedOrganizationId || age < 0 || age > p.maxAgeMs) deny();
      return r;
    }
    const t = receipt(trusted, ["company", "readGrant", "sourceBinding", "reportGrants",
      ...(withPreference ? ["reportEntitlement"] : [])]);
    const accountId = assertCompanyIdentity(t.company, request.Account);
    const crmAccountId = t.company.contact.accountId;
    // Also reject aliases of the canonical CRM account in the complete mapping.
    if (t.company.companyMappings.filter(m => m.crmAccountId === crmAccountId).length !== 1) deny();
    const grant = record(t.readGrant, ["principalId", "creatorAccountId", "operation", "active", "revision"]);
    id(grant.revision);
    if (grant.principalId !== t.company.principalId || grant.creatorAccountId !== accountId ||
        grant.operation !== `${resource}.read` || grant.active !== true) deny();
    const identity = [t.company.principalId, t.company.auditActorId, accountId,
      t.company.contact.id, crmAccountId, grant.operation, grant.revision];

    let preference = null, entitlement = null, authorityObservedAt = t.observedAt;
    if (withPreference) {
      preference = reportPreference(request.preference, p, t.company, accountId);
      id(p.reportEntitlementPolicyRevision);
      entitlement = receipt(t.reportEntitlement, ["principalId", "creatorAccountId", "crmAccountId",
        "resource", "decision", "revision", "policyRevision", "validUntil", "periodStart", "periodEnd"]);
      id(entitlement.revision);
      if (entitlement.principalId !== t.company.principalId || entitlement.creatorAccountId !== accountId ||
          entitlement.crmAccountId !== crmAccountId || entitlement.resource !== "reports" ||
          entitlement.decision !== "eligible" || entitlement.policyRevision !== p.reportEntitlementPolicyRevision ||
          instant(entitlement.observedAt) > instant(t.observedAt) || instant(entitlement.validUntil) <= asOf) deny();
      date(entitlement.periodStart); date(entitlement.periodEnd);
      if (entitlement.periodStart > entitlement.periodEnd) deny();
      authorityObservedAt = entitlement.observedAt;
    }

    if (t.sourceBinding === null) {
      if (evidence !== null || t.reportGrants !== null || request.cursor !== null) deny();
      return freeze({ state: "unknown", sourceState: "unknown", observedAt: authorityObservedAt,
        watermark: null, items: null, hasMore: false, nextCursor: null });
    }
    const binding = record(t.sourceBinding, ["creatorAccountId", "crmAccountId", "clientId", "deploymentId",
      "configurationVersion", "sourceRevision", "active", "revision"]);
    for (const key of Object.keys(binding).filter(k => k !== "active")) id(binding[key]);
    if (binding.creatorAccountId !== accountId || binding.crmAccountId !== crmAccountId || binding.active !== true) deny();
    function owner(row) {
      if (row.clientId !== binding.clientId || row.deploymentId !== binding.deploymentId ||
          row.configurationVersion !== binding.configurationVersion) deny();
    }
    const reportGrants = resource === "reports" ? list(t.reportGrants).map(value => {
      const g = record(value, ["principalId", "creatorAccountId", "reportKey", "operation", "active",
        "releaseRevision", "artifactVersion", "artifactSha256", "revision"]);
      for (const key of Object.keys(g).filter(k => k !== "active")) id(g[key]);
      hash(g.artifactSha256);
      if (g.principalId !== t.company.principalId || g.creatorAccountId !== accountId ||
          !["reports.view", "reports.download"].includes(g.operation) || typeof g.active !== "boolean") deny();
      return g;
    }) : [];
    if (resource === "calls" && t.reportGrants !== null) deny();
    const grantKeys = new Set();
    for (const g of reportGrants) {
      const key = JSON.stringify([g.reportKey, g.operation]);
      if (grantKeys.has(key)) deny();
      grantKeys.add(key);
    }
    reportGrants.sort((a, b) => compare(a.reportKey, b.reportKey) || compare(a.operation, b.operation));
    if (evidence === null) {
      if (request.cursor !== null) deny();
      return freeze({ state: "unknown", sourceState: "unknown", observedAt: authorityObservedAt,
        watermark: null, items: null, hasMore: false, nextCursor: null });
    }
    const source = receipt(evidence, ["snapshotId", "watermark", "sourceRevision", "clientId", "deploymentId",
      "configurationVersion", "items"]);
    owner(source);
    id(source.snapshotId);
    if (source.sourceRevision !== binding.sourceRevision) deny();
    const watermark = instant(source.watermark);
    // Watermark is the latest canonical change, not the current read time.
    // Completed histories may remain unchanged while observations stay fresh.
    if (watermark > instant(source.observedAt)) deny();
    const seen = new Set();
    // Validate every row, including unreleased or ungranted reports, before selection.
    const rows = list(source.items).map(value => {
      if (resource === "calls") {
        const c = record(value, ["callKey", "clientId", "deploymentId", "configurationVersion",
          "startedAt", "endedAt", "outcome"]);
        owner(c); hash(c.callKey);
        const start = instant(c.startedAt);
        if (start > watermark || !OUTCOMES.includes(c.outcome)) deny();
        if (c.endedAt !== null && (instant(c.endedAt) < start || instant(c.endedAt) > watermark)) deny();
        if (seen.has(c.callKey)) deny();
        seen.add(c.callKey);
        return c;
      }
      const r = record(value, ["reportKey", "clientId", "deploymentId", "configurationVersion", "periodStart",
        "periodEnd", "releaseState", "releaseRevision", "releasedAt", "artifact"]);
      owner(r); id(r.reportKey); date(r.periodStart); date(r.periodEnd);
      if (r.periodEnd < r.periodStart || r.periodEnd > source.watermark.slice(0, 10) ||
          !["draft", "released", "withdrawn"].includes(r.releaseState)) deny();
      if (r.releaseRevision !== null) id(r.releaseRevision);
      if (r.releasedAt !== null && (instant(r.releasedAt) > watermark ||
          r.releasedAt.slice(0, 10) < r.periodEnd)) deny();
      if (r.releaseState === "released" && (r.releaseRevision === null || r.releasedAt === null)) deny();
      if (r.artifact !== null) {
        r.artifact = record(r.artifact, ["version", "sha256", "accepted"]);
        id(r.artifact.version); hash(r.artifact.sha256);
        if (typeof r.artifact.accepted !== "boolean") deny();
      }
      if (seen.has(r.reportKey)) deny();
      seen.add(r.reportKey);
      return r;
    });
    const key = resource === "calls" ? "callKey" : "reportKey";
    rows.sort((a, b) => compare(a[key], b[key]));
    const bindingDigest = digest([resource, request.limit, p.expectedEnvironment, p.expectedOrganizationId,
      p.maxAgeMs, identity, binding, reportGrants, preference, entitlement]);
    const snapshotDigest = digest([source.snapshotId, source.observedAt, source.watermark, rows]);
    function permitted(row, operation) {
      return reportGrants.some(g => g.reportKey === row.reportKey && g.operation === operation && g.active &&
        g.releaseRevision === row.releaseRevision && g.artifactVersion === row.artifact.version &&
        g.artifactSha256 === row.artifact.sha256);
    }
    const visible = resource === "calls" ? rows.map(c => ({ callKey: c.callKey, startedAt: c.startedAt,
      endedAt: c.endedAt, outcome: c.outcome })) : rows.filter(r => r.releaseState === "released" &&
        r.artifact !== null && r.artifact.accepted && permitted(r, "reports.view") &&
        (entitlement === null || (r.periodStart >= entitlement.periodStart && r.periodEnd <= entitlement.periodEnd))).map(r => ({
      reportKey: r.reportKey, periodStart: r.periodStart, periodEnd: r.periodEnd, releasedAt: r.releasedAt,
      canDownload: permitted(r, "reports.download"),
    }));
    // Whole reporting periods must fit both bounds. Saved dates only narrow the
    // current entitled/released/view-authorized set, after every source row validates.
    const range = preference === null ? null : preference.dateRange;
    const items = range === null ? visible : visible.filter(r => r.periodStart >= range.start && r.periodEnd <= range.end);
    const timeKey = resource === "calls" ? "startedAt" : "releasedAt";
    items.sort((a, b) => compare(b[timeKey], a[timeKey]) || compare(a[key], b[key]));
    let start = 0;
    if (request.cursor !== null) {
      const previous = continuations.get(request.cursor);
      if (!previous || previous.bindingDigest !== bindingDigest || previous.snapshotDigest !== snapshotDigest) deny();
      const index = items.findIndex(item => item[key] === previous.afterKey);
      if (index < 0) deny();
      start = index + 1;
    }
    const page = items.slice(start, start + request.limit);
    const hasMore = start + page.length < items.length;
    let nextCursor = null;
    if (hasMore) {
      // Process-local capability only: no unsigned browser cursor or durable token
      // protocol is introduced. Recheck fresh authority on every continuation.
      nextCursor = Object.freeze({});
      continuations.set(nextCursor, Object.freeze({ bindingDigest, snapshotDigest, afterKey: page.at(-1)[key] }));
    }
    // Do not disclose whether hidden drafts/withdrawn/ungranted reports exist.
    const sourceState = visible.length ? "available" : "empty";
    return freeze({ state: sourceState === "available" && items.length === 0 ? "no_matches" : sourceState, sourceState,
      observedAt: new Date(Math.min(instant(authorityObservedAt), instant(source.observedAt))).toISOString(),
      watermark: source.watermark, items: page, hasMore, nextCursor });
  } catch { deny(); }
}

function prepareCompanyCallsPage(input, trusted, evidence, policy) {
  return project("calls", input, trusted, evidence, policy);
}
function prepareReleasedReportsPage(input, trusted, evidence, policy) {
  return project("reports", input, trusted, evidence, policy);
}
function preparePreferredReleasedReportsPage(input, trusted, evidence, policy) {
  return project("reports", input, trusted, evidence, policy, true);
}

module.exports = { prepareCompanyCallsPage, prepareReleasedReportsPage, preparePreferredReleasedReportsPage };
