"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareReleasedReportsPage, preparePreferredReleasedReportsPage } = require("../company-call-report-projection");

function fixture(suffix = "a") {
  const observedAt = "2026-10-12T12:00:00.000Z";
  const principalId = `synthetic-principal-${suffix}`, creatorAccountId = `synthetic-company-${suffix}`;
  const crmAccountId = `synthetic-crm-${suffix}`;
  const receipt = { environment: "development", organizationId: "synthetic-org", observedAt, complete: true };
  const owner = { clientId: `synthetic-client-${suffix}`, deploymentId: `synthetic-deployment-${suffix}`,
    configurationVersion: "synthetic-config-v1" };
  const items = [
    ["old", "2026-09-01", "2026-09-30", "2026-10-01T11:00:00.000Z"],
    ["first", "2026-10-01", "2026-10-07", "2026-10-08T11:00:00.000Z"],
    ["second", "2026-10-08", "2026-10-11", "2026-10-12T10:00:00.000Z"],
    ["straddling", "2026-09-25", "2026-10-02", "2026-10-03T11:00:00.000Z"],
    ["draft", "2026-10-01", "2026-10-02", "2026-10-03T11:00:00.000Z"],
    ["third", "2026-10-09", "2026-10-10", "2026-10-12T11:00:00.000Z"],
  ].map(([key, periodStart, periodEnd, releasedAt]) => ({ ...owner, reportKey: `synthetic-report-${key}`,
    periodStart, periodEnd, releasedAt, releaseState: key === "draft" ? "draft" : "released",
    releaseRevision: "synthetic-release-v1", artifact: { version: "synthetic-artifact-v1", sha256: "a".repeat(64), accepted: true } }));
  const reportGrants = items.map(r => ({ principalId, creatorAccountId, reportKey: r.reportKey,
    operation: "reports.view", active: true, releaseRevision: r.releaseRevision, artifactVersion: r.artifact.version,
    artifactSha256: r.artifact.sha256, revision: "synthetic-grant-v1" }));
  reportGrants.push({ ...reportGrants[1], operation: "reports.download" });
  return {
    input: { Account: creatorAccountId, limit: 1, cursor: null, preference: {
      version: 1, environment: receipt.environment, organizationId: receipt.organizationId, principalId,
      creatorAccountId, crmAccountId, resource: "reports", dateRange: { start: "2026-10-01", end: "2026-10-10" },
    } },
    trusted: { ...receipt, company: { principalId, auditActorId: `synthetic-actor-${suffix}`,
      contact: { id: `synthetic-contact-${suffix}`, accountId: crmAccountId },
      companyMappings: [{ creatorAccountId, crmAccountId, active: true }] },
    readGrant: { principalId, creatorAccountId, operation: "reports.read", active: true, revision: "synthetic-read-v1" },
    sourceBinding: { ...owner, creatorAccountId, crmAccountId, active: true, sourceRevision: "synthetic-source-v1", revision: "synthetic-binding-v1" },
    reportGrants, reportEntitlement: { ...receipt, principalId, creatorAccountId, crmAccountId, resource: "reports",
      decision: "eligible", revision: "synthetic-entitlement-v1", policyRevision: "synthetic-policy-v1",
      validUntil: "2026-10-12T13:00:00.000Z", periodStart: "2026-10-01", periodEnd: "2026-10-11" } },
    evidence: { ...receipt, ...owner, sourceRevision: "synthetic-source-v1", snapshotId: "synthetic-snapshot-v1", watermark: observedAt, items },
    policy: { expectedEnvironment: receipt.environment, expectedOrganizationId: receipt.organizationId,
      asOf: "2026-10-12T12:00:30.000Z", maxAgeMs: 60000, reportEntitlementPolicyRevision: "synthetic-policy-v1" },
  };
}
function run(f) { return preparePreferredReleasedReportsPage(f.input, f.trusted, f.evidence, f.policy); }
function denied(f) {
  assert.throws(() => run(f), error => error instanceof TypeError && error.message === "Invalid company call/report projection evidence");
}
function keys(result) { return result.items.map(r => r.reportKey.replace("synthetic-report-", "")); }

test("restores a serialized company/user preference before pagination with inclusive whole-period dates", () => {
  const f = fixture(), before = structuredClone(f);
  f.input.preference = JSON.parse(JSON.stringify(f.input.preference));
  const first = run(f);
  assert.deepEqual(keys(first), ["third"]);
  assert.equal(first.hasMore, true);
  assert.deepEqual(f, before);
  f.input.cursor = first.nextCursor;
  f.evidence.items.reverse(); f.trusted.reportGrants.reverse();
  const second = run(f);
  assert.deepEqual(keys(second), ["first"]);
  assert.equal(second.items[0].canDownload, true);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(run(f), second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.items) && Object.isFrozen(first.items[0]));
});

test("no preference and cleared date range still enforce current plan period and individual grants", () => {
  for (const preference of [null, { ...fixture().input.preference, dateRange: null }]) {
    const f = fixture(); f.input.preference = preference; f.input.limit = 100;
    assert.deepEqual(keys(run(f)), ["third", "second", "first"]);
    f.trusted.reportGrants.find(g => g.reportKey === "synthetic-report-third").active = false;
    assert.deepEqual(keys(run(f)), ["second", "first"]);
  }
});

test("saved wider dates cannot restore access after a plan downgrade or include a boundary-straddling report", () => {
  const f = fixture(); f.input.limit = 100;
  f.input.preference.dateRange = { start: "2026-09-01", end: "2026-10-12" };
  assert.deepEqual(keys(run(f)), ["third", "second", "first"]);
  f.trusted.reportEntitlement.periodEnd = "2026-10-07";
  f.trusted.reportEntitlement.revision = "synthetic-entitlement-v2";
  assert.deepEqual(keys(run(f)), ["first"]);
  f.trusted.reportEntitlement.periodStart = "2026-10-02";
  assert.deepEqual(keys(run(f)), []);
});

test("preference containment excludes a report that only overlaps a selected day", () => {
  const f = fixture(); f.input.preference.dateRange = { start: "2026-10-10", end: "2026-10-10" };
  assert.deepEqual(keys(run(f)), []);
  f.evidence.items.at(-1).periodStart = "2026-10-10";
  assert.deepEqual(keys(run(f)), ["third"]);
});

test("unknown, authorized empty and no matches are distinct without exposing hidden source rows", () => {
  const f = fixture(); f.input.preference.dateRange = { start: "2026-08-01", end: "2026-08-31" };
  assert.equal(run(f).state, "no_matches");
  assert.equal(run(f).sourceState, "available");
  f.evidence.items = f.evidence.items.filter(r => r.releaseState === "draft" || r.reportKey.endsWith("old"));
  const hidden = run(f);
  assert.equal(hidden.state, "empty");
  f.evidence.items = [];
  assert.deepEqual(run(f), hidden);
  f.evidence = null;
  assert.equal(run(f).state, "unknown");
  assert.equal(run(f).items, null);
  f.trusted.sourceBinding = null; f.trusted.reportGrants = null;
  assert.equal(run(f).state, "unknown");
  f.trusted.reportEntitlement.decision = "ineligible";
  denied(f);
});

test("preferences never reinstate withdrawn, revoked or replaced reports or download permissions", () => {
  for (const mutate of [
    f => { f.evidence.items.at(-1).releaseState = "withdrawn"; },
    f => { f.evidence.items.at(-1).artifact.version = "synthetic-artifact-v2"; },
    f => { f.trusted.reportGrants.find(g => g.reportKey.endsWith("third")).active = false; },
  ]) { const f = fixture(); mutate(f); assert.deepEqual(keys(run(f)), ["first"]); }
  const f = fixture(); f.input.limit = 100;
  f.trusted.reportGrants.find(g => g.operation === "reports.download").active = false;
  assert.ok(run(f).items.every(r => r.canDownload === false));
});

test("foreign saved preferences reject even when current caller has their own valid reports", () => {
  const a = fixture(), b = fixture("b");
  b.input.preference = a.input.preference;
  denied(b);
});

const invalid = {
  "missing preference": f => { delete f.input.preference; },
  "missing current entitlement": f => { delete f.trusted.reportEntitlement; },
  "null entitlement": f => { f.trusted.reportEntitlement = null; },
  "ineligible entitlement": f => { f.trusted.reportEntitlement.decision = "ineligible"; },
  "unknown eligibility": f => { f.trusted.reportEntitlement.decision = "unknown"; },
  "read revocation": f => { f.trusted.readGrant.active = false; },
  "unsupported saved version": f => { f.input.preference.version = 2; },
  "string saved version": f => { f.input.preference.version = "1"; },
  "preference on another resource": f => { f.input.preference.resource = "calls"; },
  "foreign saved principal": f => { f.input.preference.principalId = "synthetic-principal-b"; },
  "foreign saved company": f => { f.input.preference.creatorAccountId = "synthetic-company-b"; },
  "foreign saved CRM link": f => { f.input.preference.crmAccountId = "synthetic-crm-b"; },
  "foreign saved environment": f => { f.input.preference.environment = "production"; },
  "foreign saved organization": f => { f.input.preference.organizationId = "synthetic-other-org"; },
  "invalid calendar date": f => { f.input.preference.dateRange.start = "2026-02-30"; },
  "noncanonical date": f => { f.input.preference.dateRange.start = "2026-1-01"; },
  "timestamp in date": f => { f.input.preference.dateRange.start = "2026-10-01T00:00:00.000Z"; },
  "reversed preference dates": f => { f.input.preference.dateRange.start = "2026-10-11"; },
  "missing date bound": f => { delete f.input.preference.dateRange.end; },
  "null date bound": f => { f.input.preference.dateRange.end = null; },
  "array range": f => { f.input.preference.dateRange = []; },
  "stale entitlement": f => { f.trusted.reportEntitlement.observedAt = "2026-10-12T11:59:29.999Z"; },
  "future entitlement": f => { f.trusted.reportEntitlement.observedAt = "2026-10-12T12:00:30.001Z"; },
  "entitlement newer than enclosing observation": f => { f.trusted.reportEntitlement.observedAt = "2026-10-12T12:00:00.001Z"; },
  "exclusive expiry boundary": f => { f.trusted.reportEntitlement.validUntil = f.policy.asOf; },
  "incomplete entitlement": f => { f.trusted.reportEntitlement.complete = false; },
  "wrong entitlement policy": f => { f.trusted.reportEntitlement.policyRevision = "synthetic-policy-v2"; },
  "malformed policy revision": f => { f.policy.reportEntitlementPolicyRevision = ""; },
  "wrong entitlement principal": f => { f.trusted.reportEntitlement.principalId = "synthetic-principal-b"; },
  "wrong entitlement company": f => { f.trusted.reportEntitlement.creatorAccountId = "synthetic-company-b"; },
  "wrong entitlement CRM link": f => { f.trusted.reportEntitlement.crmAccountId = "synthetic-crm-b"; },
  "wrong entitlement environment": f => { f.trusted.reportEntitlement.environment = "production"; },
  "wrong entitlement organization": f => { f.trusted.reportEntitlement.organizationId = "synthetic-other-org"; },
  "wrong entitlement resource": f => { f.trusted.reportEntitlement.resource = "calls"; },
  "reversed entitled dates": f => { f.trusted.reportEntitlement.periodStart = "2026-10-12"; },
  "invalid entitled calendar date": f => { f.trusted.reportEntitlement.periodEnd = "2026-02-30"; },
  "foreign row excluded by preferences": f => { f.evidence.items[0].clientId = "synthetic-client-b"; },
  "malformed row excluded by preferences": f => { f.evidence.items[0].periodStart = "invalid"; },
  "foreign hidden draft": f => { f.evidence.items[4].deploymentId = "synthetic-deployment-b"; },
};
for (const key of ["grants", "cursor", "sourceBinding", "url", "plan", "reportKeys", "readGrant"]) {
  invalid[`saved authority/unsupported field ${key}`] = f => { f.input.preference[key] = "synthetic-forbidden"; };
}
for (const [name, mutate] of Object.entries(invalid)) {
  test(`saved preferences reject ${name}`, () => { const f = fixture(); mutate(f); denied(f); });
}

test("every continuation pins saved dates, current entitlement and original authorization/snapshot", () => {
  for (const mutate of [
    f => { f.input.preference.dateRange.end = "2026-10-11"; },
    f => { f.input.preference = null; },
    f => { f.trusted.reportEntitlement.revision = "synthetic-entitlement-v2"; },
    f => { f.trusted.reportEntitlement.periodEnd = "2026-10-10"; },
    f => { f.trusted.reportEntitlement.validUntil = "2026-10-12T13:00:01.000Z"; },
    f => { f.trusted.reportEntitlement.decision = "ineligible"; },
    f => { f.policy.asOf = f.trusted.reportEntitlement.validUntil; f.policy.maxAgeMs = 3600000; },
    f => { f.trusted.reportEntitlement.policyRevision = f.policy.reportEntitlementPolicyRevision = "synthetic-policy-v2"; },
    f => { f.trusted.reportGrants[0].revision = "synthetic-grant-v2"; },
    f => { f.trusted.readGrant.revision = "synthetic-read-v2"; },
    f => { f.evidence.snapshotId = "synthetic-snapshot-v2"; },
  ]) { const f = fixture(); f.input.cursor = run(f).nextCursor; mutate(f); denied(f); }
  const a = fixture(), b = fixture("b"); b.input.cursor = run(a).nextCursor; denied(b);
  a.input.cursor = structuredClone(run(a).nextCursor); denied(a);
});

test("legacy and preference-aware cursors cannot be interchanged; old export rejects new envelope", () => {
  const f = fixture();
  assert.throws(() => prepareReleasedReportsPage(f.input, f.trusted, f.evidence, f.policy), TypeError);
  const { preference, ...input } = f.input;
  const { reportEntitlement, ...trusted } = f.trusted;
  const { reportEntitlementPolicyRevision, ...policy } = f.policy;
  f.input.cursor = prepareReleasedReportsPage(input, trusted, f.evidence, policy).nextCursor;
  denied(f);
  f.input.cursor = null;
  input.cursor = run(f).nextCursor;
  assert.throws(() => prepareReleasedReportsPage(input, trusted, f.evidence, policy), TypeError);
});

test("preference and entitlement data reject accessors, prototypes and symbols without evaluation", () => {
  let invoked = 0;
  const getter = { enumerable: true, get() { invoked++; return "synthetic-forbidden"; } };
  for (const mutate of [
    f => { Object.defineProperty(f.input, "preference", getter); },
    f => { Object.defineProperty(f.input.preference, "principalId", getter); },
    f => { Object.defineProperty(f.input.preference, "dateRange", getter); },
    f => { Object.defineProperty(f.input.preference.dateRange, "start", getter); },
    f => { Object.defineProperty(f.trusted, "reportEntitlement", getter); },
    f => { Object.defineProperty(f.trusted.reportEntitlement, "decision", getter); },
    f => { f.input.preference[Symbol("extra")] = true; },
    f => { f.input.preference = Object.create(f.input.preference); },
    f => { f.trusted.reportEntitlement = Object.create(f.trusted.reportEntitlement); },
    f => { f.input.preference.toJSON = () => { invoked++; return {}; }; },
  ]) { const f = fixture(); mutate(f); denied(f); }
  assert.equal(invoked, 0);
});

test("oldest entitlement observation is retained, including unknown source; receipt freshness is inclusive", () => {
  const f = fixture(); f.trusted.reportEntitlement.observedAt = "2026-10-12T11:59:30.000Z";
  assert.equal(run(f).observedAt, f.trusted.reportEntitlement.observedAt);
  f.evidence = null;
  assert.equal(run(f).observedAt, f.trusted.reportEntitlement.observedAt);
});

test("result is detached and contains no saved owner scope or entitlement metadata", () => {
  const f = fixture(), result = run(f), before = JSON.stringify(result);
  for (const forbidden of ["principalId", "creatorAccountId", "crmAccountId", "policyRevision", "validUntil", "preference", "entitlement"]) {
    assert.equal(before.includes(forbidden), false, forbidden);
  }
  f.input.preference.dateRange.start = "2026-10-11";
  f.trusted.reportEntitlement.decision = "ineligible";
  assert.equal(JSON.stringify(result), before);
});
