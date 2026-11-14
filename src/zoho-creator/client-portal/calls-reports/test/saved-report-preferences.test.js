"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { prepareReleasedReportsPage, preparePreferredReleasedReportsPage,
  prepareReleasedReportRead, verifyReleasedReportReadBytes } = require("../company-call-report-projection");

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

function readFixture(suffix = "a") {
  const f = fixture(suffix);
  f.input = { Account: f.input.Account, reportKey: "synthetic-report-first", operation: "reports.view" };
  return f;
}
function read(f) { return prepareReleasedReportRead(f.input, f.trusted, f.evidence, f.policy); }
function readDenied(f) {
  assert.throws(() => read(f), error => error instanceof TypeError && error.message === "Invalid company call/report projection evidence");
}

test("report read: produces only an immutable server-side GET plan for the exact current released artifact", () => {
  for (const operation of ["reports.view", "reports.download"]) {
    const f = readFixture(); f.input.operation = operation;
    const before = structuredClone(f), result = read(f);
    assert.deepEqual(result, {
      method: "GET", resource: "released-report-artifact", operation,
      environment: "development", organizationId: "synthetic-org", principalId: "synthetic-principal-a",
      creatorAccountId: "synthetic-company-a", crmAccountId: "synthetic-crm-a", clientId: "synthetic-client-a",
      deploymentId: "synthetic-deployment-a", configurationVersion: "synthetic-config-v1",
      sourceRevision: "synthetic-source-v1", snapshotId: "synthetic-snapshot-v1", reportKey: "synthetic-report-first",
      releaseRevision: "synthetic-release-v1", artifact: { version: "synthetic-artifact-v1", sha256: "a".repeat(64) },
      checkedAt: f.policy.asOf, observedAt: f.evidence.observedAt,
    });
    assert.deepEqual(f, before);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.artifact));
    assert.deepEqual(Object.keys(result.artifact), ["version", "sha256"]);
    assert.equal(Object.hasOwn(result, "url"), false);
    f.evidence.items[1].artifact.version = "synthetic-artifact-v2";
    assert.equal(result.artifact.version, "synthetic-artifact-v1");
  }
});

test("report read: view and download both need current view authority; download additionally needs its own grant", () => {
  const viewOnly = readFixture();
  viewOnly.trusted.reportGrants = viewOnly.trusted.reportGrants.filter(g => g.operation !== "reports.download");
  assert.equal(read(viewOnly).operation, "reports.view");
  viewOnly.input.operation = "reports.download";
  readDenied(viewOnly);
  for (const operation of ["reports.view", "reports.download"]) {
    const downloadOnly = readFixture(); downloadOnly.input.operation = operation;
    downloadOnly.trusted.reportGrants = downloadOnly.trusted.reportGrants.filter(g => g.operation !== "reports.view");
    readDenied(downloadOnly);
  }
});

test("report read: a previously visible download hint cannot survive withdrawal, replacement or revocation", () => {
  const mutations = [
    f => { f.evidence.items[1].releaseState = "withdrawn"; },
    f => { f.evidence.items[1].artifact.version = "synthetic-artifact-v2"; },
    f => { f.evidence.items[1].artifact.sha256 = "b".repeat(64); },
    f => { f.evidence.items[1].releaseRevision = "synthetic-release-v2"; },
    f => { f.trusted.readGrant.active = false; },
    f => { f.trusted.reportGrants.find(g => g.reportKey === f.input.reportKey && g.operation === "reports.view").active = false; },
    f => { f.trusted.reportGrants.find(g => g.operation === "reports.download").active = false; },
    f => { f.trusted.reportEntitlement.decision = "ineligible"; },
    f => { f.trusted.reportEntitlement.validUntil = f.policy.asOf; },
    f => { f.trusted.reportEntitlement.periodStart = "2026-10-02"; },
    f => { f.trusted.reportEntitlement.periodEnd = "2026-10-06"; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); f.input.limit = 100;
    const listed = run(f).items.find(r => r.reportKey === "synthetic-report-first");
    assert.equal(listed.canDownload, true);
    f.input = { Account: f.input.Account, reportKey: listed.reportKey, operation: "reports.download" };
    mutate(f); readDenied(f);
  }
});

test("report read: current re-release selects only the replacement bytes with matching fresh grants", () => {
  const f = readFixture(); f.input.operation = "reports.download";
  f.evidence.items[1].releaseRevision = "synthetic-release-v2";
  f.evidence.items[1].artifact = { version: "synthetic-artifact-v2", sha256: "b".repeat(64), accepted: true };
  f.evidence.snapshotId = "synthetic-snapshot-v2";
  for (const g of f.trusted.reportGrants.filter(g => g.reportKey === f.input.reportKey)) {
    g.releaseRevision = "synthetic-release-v2";
    g.artifactVersion = "synthetic-artifact-v2";
    g.artifactSha256 = "b".repeat(64);
    g.revision = "synthetic-grant-v2";
  }
  const result = read(f);
  assert.deepEqual(result.artifact, { version: "synthetic-artifact-v2", sha256: "b".repeat(64) });
  assert.equal(result.releaseRevision, "synthetic-release-v2");
  assert.equal(result.snapshotId, "synthetic-snapshot-v2");
});

test("report read: release, artifact, action grants and entitlement form a fail-closed permission matrix", () => {
  const grantStates = ["current", "revoked", "absent", "stale-artifact"];
  const entitlementStates = ["eligible", "ineligible", "expired", "out-of-period"];
  let checked = 0, allowed = 0;
  for (const release of ["draft", "released", "withdrawn"]) {
    for (const accepted of [false, true]) {
      for (const view of grantStates) {
        for (const download of grantStates) {
          for (const operation of ["reports.view", "reports.download"]) {
            for (const entitlement of entitlementStates) {
              const f = readFixture();
              f.input.operation = operation;
              f.evidence.items[1].releaseState = release;
              f.evidence.items[1].artifact.accepted = accepted;
              for (const [action, state] of [["reports.view", view], ["reports.download", download]]) {
                const grant = f.trusted.reportGrants.find(g => g.reportKey === f.input.reportKey && g.operation === action);
                if (state === "revoked") grant.active = false;
                if (state === "stale-artifact") grant.artifactSha256 = "b".repeat(64);
                if (state === "absent") f.trusted.reportGrants = f.trusted.reportGrants.filter(g => g !== grant);
              }
              if (entitlement === "ineligible") f.trusted.reportEntitlement.decision = "ineligible";
              if (entitlement === "expired") f.trusted.reportEntitlement.validUntil = f.policy.asOf;
              if (entitlement === "out-of-period") f.trusted.reportEntitlement.periodStart = "2026-10-02";
              const shouldAllow = release === "released" && accepted && view === "current" &&
                (operation === "reports.view" || download === "current") && entitlement === "eligible";
              const label = JSON.stringify({ release, accepted, view, download, operation, entitlement });
              if (shouldAllow) {
                const result = read(f);
                assert.equal(result.operation, operation, label);
                assert.equal(result.reportKey, f.input.reportKey, label);
                assert.deepEqual(result.artifact, { version: "synthetic-artifact-v1", sha256: "a".repeat(64) }, label);
                allowed++;
              } else {
                assert.throws(() => read(f), error => error instanceof TypeError &&
                  error.message === "Invalid company call/report projection evidence", label);
              }
              checked++;
            }
          }
        }
      }
    }
  }
  assert.equal(checked, 768);
  assert.equal(allowed, 5); // Four view cases ignore download state; only one download case is authorized.
});

test("report read: current entitlement is mandatory and display preferences do not substitute", () => {
  const missing = [
    f => { delete f.trusted.reportEntitlement; },
    f => { delete f.policy.reportEntitlementPolicyRevision; },
    f => { f.trusted.reportEntitlement.policyRevision = "synthetic-old-policy"; },
    f => { f.trusted.reportEntitlement.principalId = "synthetic-principal-b"; },
    f => { f.trusted.reportEntitlement.creatorAccountId = "synthetic-company-b"; },
    f => { f.trusted.reportEntitlement.crmAccountId = "synthetic-crm-b"; },
  ];
  for (const mutate of missing) { const f = readFixture(); mutate(f); readDenied(f); }
  const f = fixture();
  f.input.preference.dateRange = { start: "2026-10-10", end: "2026-10-10" };
  assert.equal(run(f).state, "no_matches");
  f.input = { Account: f.input.Account, reportKey: "synthetic-report-first", operation: "reports.view" };
  assert.equal(read(f).reportKey, f.input.reportKey); // A display filter is not an authorization rule.
});

test("report read: missing, hidden, unknown and unaccepted targets share one value-free denial", () => {
  const mutations = [
    f => { f.input.reportKey = "synthetic-not-found"; },
    f => { f.evidence.items[1].releaseState = "draft"; },
    f => { f.evidence.items[1].releaseState = "withdrawn"; },
    f => { f.evidence.items[1].artifact = null; },
    f => { f.evidence.items[1].artifact.accepted = false; },
    f => { f.trusted.reportGrants = []; },
    f => { f.evidence.items = []; },
    f => { f.evidence = null; },
    f => { f.trusted.sourceBinding = null; f.trusted.reportGrants = null; f.evidence = null; },
  ];
  for (const mutate of mutations) { const f = readFixture(); mutate(f); readDenied(f); }
});

test("report read: direct target selection cannot skip foreign, duplicated or malformed hidden rows", () => {
  const mutations = [
    f => { f.input.Account = "synthetic-company-b"; },
    f => { f.trusted.company.companyMappings[0].active = false; },
    f => { f.trusted.readGrant.operation = "calls.read"; },
    f => { f.evidence.clientId = "synthetic-client-b"; },
    f => { f.evidence.items[4].clientId = "synthetic-client-b"; },
    f => { f.evidence.items[4].artifact = { version: "synthetic-artifact", sha256: "invalid", accepted: true }; },
    f => { f.evidence.items[4].transcript = "synthetic-forbidden"; },
    f => { f.evidence.items.push(structuredClone(f.evidence.items[4])); },
    f => { f.trusted.reportGrants.push(structuredClone(f.trusted.reportGrants[0])); },
    f => { f.evidence.complete = false; },
    f => { f.trusted.complete = false; },
    f => { f.evidence.observedAt = "2026-10-12T11:59:29.999Z"; },
  ];
  for (const mutate of mutations) { const f = readFixture(); mutate(f); readDenied(f); }
  const a = readFixture(), b = readFixture("b");
  a.evidence = b.evidence;
  readDenied(a);
  const result = read(b);
  assert.equal(result.creatorAccountId, "synthetic-company-b");
  assert.equal(result.clientId, "synthetic-client-b");
});

test("report read: selection covers the complete bounded snapshot, not only a first list page", () => {
  const f = readFixture(), template = f.evidence.items[1], grant = f.trusted.reportGrants[1];
  f.evidence.items = Array.from({ length: 1000 }, (_, i) => ({ ...template, reportKey: `synthetic-report-${String(i).padStart(4, "0")}` }));
  f.trusted.reportGrants = f.evidence.items.map(r => ({ ...grant, reportKey: r.reportKey }));
  f.input.reportKey = "synthetic-report-0999";
  assert.equal(read(f).reportKey, f.input.reportKey);
  f.evidence.items.reverse(); f.trusted.reportGrants.reverse();
  assert.equal(read(f).reportKey, f.input.reportKey);
  f.evidence.items.push({ ...template, reportKey: "synthetic-report-1000" });
  readDenied(f);
});

test("report read: selector and operation are exact data; hints and previous plans confer no authority", () => {
  let reads = 0;
  const mutations = [
    f => { f.input.operation = "reports.delete"; },
    f => { f.input.operation = "GET"; },
    f => { f.input.canDownload = true; },
    f => { f.input.artifact = { version: "synthetic-artifact-v1", sha256: "a".repeat(64) }; },
    f => { f.input.preference = fixture().input.preference; },
    f => { f.input.cursor = null; },
    f => { f.input[Symbol("extra")] = true; },
    f => { f.input = Object.create(f.input); },
    f => { Object.defineProperty(f.input, "reportKey", { get() { reads++; return "synthetic-report-first"; } }); },
    f => { f.input.operation = { toString() { reads++; return "reports.view"; } }; },
  ];
  for (const mutate of mutations) { const f = readFixture(); mutate(f); readDenied(f); }
  assert.equal(reads, 0);
  const f = readFixture(); f.input = read(f); readDenied(f);
  const plain = readFixture(); plain.input = Object.assign(Object.create(null), plain.input);
  assert.equal(read(plain).operation, "reports.view");
});

test("report read: oldest current evidence observation is reported and freshness/expiry remain enforced", () => {
  const f = readFixture();
  f.trusted.reportEntitlement.observedAt = "2026-10-12T11:59:30.000Z";
  assert.equal(read(f).observedAt, "2026-10-12T11:59:30.000Z");
  f.trusted.reportEntitlement.observedAt = "2026-10-12T11:59:29.999Z";
  readDenied(f);
  const fresh = readFixture();
  fresh.trusted.reportEntitlement.validUntil = "2026-10-12T12:00:30.001Z";
  assert.equal(read(fresh).checkedAt, fresh.policy.asOf);
  fresh.policy.asOf = fresh.trusted.reportEntitlement.validUntil;
  readDenied(fresh);
});

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


function completionFixture(operation = "reports.view", bytes = Buffer.from("synthetic immutable report bytes")) {
  const f = readFixture();
  f.input.operation = operation;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  f.evidence.items[1].artifact.sha256 = sha256;
  for (const grant of f.trusted.reportGrants.filter(g => g.reportKey === f.input.reportKey)) {
    grant.artifactSha256 = sha256;
  }
  const plan = read(f), current = structuredClone(f);
  current.policy.asOf = "2026-10-12T12:00:32.000Z";
  current.trusted.observedAt = current.trusted.reportEntitlement.observedAt =
    current.evidence.observedAt = "2026-10-12T12:00:31.000Z";
  return { f, plan, bytes, current };
}
function complete(c) {
  return verifyReleasedReportReadBytes(c.plan, c.bytes, c.current.input,
    c.current.trusted, c.current.evidence, c.current.policy);
}
function completionDenied(c) {
  assert.throws(() => complete(c), error => error instanceof TypeError &&
    error.message === "Invalid company call/report projection evidence");
}

test("report completion: current unchanged target verifies exact copied bytes for view and download", () => {
  for (const operation of ["reports.view", "reports.download"]) {
    const c = completionFixture(operation), before = structuredClone(c.current);
    const result = complete(c);
    assert.ok(Buffer.isBuffer(result));
    assert.deepEqual(result, c.bytes);
    assert.notEqual(result, c.bytes);
    assert.notEqual(result.buffer, c.bytes.buffer);
    assert.deepEqual(c.current, before);
    const preserved = Buffer.from(result);
    c.bytes.fill(0);
    assert.deepEqual(result, preserved);
    completionDenied(c);
  }
});

test("report completion: refreshed snapshots and unrelated report grants may advance without changing the target", () => {
  const c = completionFixture();
  c.current.evidence.snapshotId = "synthetic-snapshot-v2";
  c.current.evidence.watermark = c.current.evidence.observedAt;
  c.current.evidence.items.reverse();
  c.current.trusted.reportGrants.reverse();
  c.current.trusted.reportGrants.find(g => g.reportKey === "synthetic-report-third").revision = "synthetic-unrelated-v2";
  // A view does not acquire or depend on download permission.
  c.current.trusted.reportGrants.find(g => g.operation === "reports.download").active = false;
  assert.deepEqual(complete(c), c.bytes);
});

test("report completion: forged, copied and serialized plans cannot substitute for the issued plan", () => {
  const c = completionFixture();
  for (const plan of [null, {}, structuredClone(c.plan), JSON.parse(JSON.stringify(c.plan)),
    Object.freeze({ ...c.plan }), Object.create(c.plan), c.f.input]) {
    completionDenied({ ...c, plan });
  }
  assert.deepEqual(complete(c), c.bytes);
});

test("report completion: mandatory new evidence is not replaced by a formerly valid plan", () => {
  const c = completionFixture();
  for (const key of ["input", "trusted", "evidence", "policy"]) {
    const current = { ...c.current, [key]: undefined };
    completionDenied({ ...c, current });
  }
  completionDenied({ ...c, current: c.f }); // Still fresh, but collected before preparation.
  c.current.policy.asOf = "2026-10-12T12:00:29.999Z";
  completionDenied(c);
});

test("report completion: each observation must be at least preparation time and still fresh at completion", () => {
  for (const path of ["authority", "entitlement", "source"]) {
    const c = completionFixture();
    const receipt = path === "authority" ? c.current.trusted : path === "entitlement"
      ? c.current.trusted.reportEntitlement : c.current.evidence;
    receipt.observedAt = c.plan.checkedAt;
    if (path === "authority") c.current.trusted.reportEntitlement.observedAt = c.plan.checkedAt;
    assert.deepEqual(complete(c), c.bytes);
    receipt.observedAt = "2026-10-12T12:00:29.999Z";
    completionDenied(c);
  }
  const c = completionFixture();
  c.current.policy.asOf = "2026-10-12T12:01:31.000Z";
  assert.deepEqual(complete(c), c.bytes); // Inclusive receipt age boundary.
  c.current.policy.asOf = "2026-10-12T12:01:31.001Z";
  completionDenied(c);
});

test("report completion: withdrawal, revocation and entitlement expiry after preparation deny uniformly", () => {
  const mutations = [
    f => { f.evidence.items[1].releaseState = "withdrawn"; },
    f => { f.evidence.items[1].artifact.accepted = false; },
    f => { f.trusted.readGrant.active = false; },
    f => { f.trusted.reportGrants.find(g => g.reportKey === f.input.reportKey && g.operation === "reports.view").active = false; },
    f => { f.trusted.reportGrants.find(g => g.operation === "reports.download").active = false; },
    f => { f.trusted.reportEntitlement.decision = "ineligible"; },
    f => { f.trusted.reportEntitlement.validUntil = f.policy.asOf; },
    f => { f.trusted.reportEntitlement.periodStart = "2026-10-02"; },
    f => { f.evidence.items = []; },
    f => { f.evidence = null; },
    f => { f.trusted.complete = false; },
    f => { f.evidence.complete = false; },
    f => { f.evidence.items[4].clientId = "synthetic-other-client"; },
    f => { f.evidence.items[4].artifact.sha256 = "invalid"; },
  ];
  for (const mutate of mutations) {
    const c = completionFixture("reports.download"); mutate(c.current); completionDenied(c);
  }
});

test("report completion: both independently authorized operations cannot be exchanged mid-read", () => {
  for (const operation of ["reports.view", "reports.download"]) {
    const c = completionFixture(operation);
    c.current.input.operation = operation === "reports.view" ? "reports.download" : "reports.view";
    assert.equal(read(c.current).operation, c.current.input.operation);
    completionDenied(c);
  }
});

test("report completion: independently valid scope, revision and report changes require a new read", () => {
  const mutations = [
    f => { f.trusted.company.auditActorId = "synthetic-new-actor"; },
    f => { f.trusted.company.contact.id = "synthetic-new-contact"; },
    f => { f.trusted.readGrant.revision = "synthetic-read-v2"; },
    f => { f.trusted.sourceBinding.revision = "synthetic-binding-v2"; },
    f => { f.trusted.reportGrants.find(g => g.reportKey === f.input.reportKey && g.operation === "reports.view").revision = "synthetic-view-v2"; },
    f => { f.trusted.reportEntitlement.revision = "synthetic-entitlement-v2"; },
    f => { f.trusted.reportEntitlement.validUntil = "2026-10-12T14:00:00.000Z"; },
    f => { f.trusted.reportEntitlement.periodStart = "2026-09-01"; },
    f => { f.policy.reportEntitlementPolicyRevision = f.trusted.reportEntitlement.policyRevision = "synthetic-policy-v2"; },
    f => { f.policy.maxAgeMs++; },
    f => { f.evidence.items[1].periodStart = "2026-10-02"; },
    f => { f.evidence.items[1].releasedAt = "2026-10-08T11:00:01.000Z"; },
    f => { f.trusted.sourceBinding.sourceRevision = f.evidence.sourceRevision = "synthetic-source-v2"; },
    f => {
      f.evidence.items[1].reportKey = f.input.reportKey = "synthetic-new-report";
      for (const grant of f.trusted.reportGrants.filter(g => g.reportKey === "synthetic-report-first")) grant.reportKey = f.input.reportKey;
    },
    f => {
      f.evidence.items[1].releaseRevision = "synthetic-release-v2";
      for (const grant of f.trusted.reportGrants.filter(g => g.reportKey === f.input.reportKey)) grant.releaseRevision = "synthetic-release-v2";
    },
    f => {
      f.evidence.items[1].artifact.version = "synthetic-artifact-v2";
      for (const grant of f.trusted.reportGrants.filter(g => g.reportKey === f.input.reportKey)) grant.artifactVersion = "synthetic-artifact-v2";
    },
  ];
  for (const mutate of mutations) {
    const c = completionFixture(); mutate(c.current);
    assert.equal(read(c.current).operation, "reports.view");
    completionDenied(c);
  }
});

test("report completion: coherently changed tenant, principal, organization and partition still cannot replace the initial scope", () => {
  const c = completionFixture();
  for (const [from, to] of [
    ["synthetic-principal-a", "synthetic-principal-b"],
    ["synthetic-company-a", "synthetic-company-b"],
    ["synthetic-crm-a", "synthetic-crm-b"],
    ["synthetic-org", "synthetic-other-org"],
    ["development", "stage"],
    ["synthetic-client-a", "synthetic-client-b"],
    ["synthetic-deployment-a", "synthetic-deployment-b"],
    ["synthetic-config-v1", "synthetic-config-v2"],
  ]) {
    const current = JSON.parse(JSON.stringify(c.current).replaceAll(from, to));
    assert.equal(read(current).operation, "reports.view");
    completionDenied({ ...c, current });
  }
});

test("report completion: replacement artifacts with fresh matching grants do not authorize old or replacement bytes on an old plan", () => {
  const c = completionFixture(), replacement = Buffer.from("synthetic replacement report");
  const sha256 = createHash("sha256").update(replacement).digest("hex");
  c.current.evidence.items[1].artifact.sha256 = sha256;
  for (const grant of c.current.trusted.reportGrants.filter(g => g.reportKey === c.current.input.reportKey)) {
    grant.artifactSha256 = sha256;
  }
  assert.equal(read(c.current).artifact.sha256, sha256);
  completionDenied(c);
  c.bytes = replacement;
  completionDenied(c);
});

test("report completion: byte integrity rejects truncation, changed data, empty values and implicit conversions", () => {
  const c = completionFixture(); let invoked = 0;
  for (const bytes of [Buffer.from("synthetic wrong bytes"), c.bytes.subarray(1), Buffer.alloc(0),
    c.bytes.toString(), [...c.bytes], new Uint8Array(c.bytes), new DataView(new ArrayBuffer(10)),
    new ArrayBuffer(10), null, undefined, { type: "Buffer", data: [...c.bytes] },
    { valueOf() { invoked++; return c.bytes; }, toString() { invoked++; return c.bytes.toString(); } }]) {
    completionDenied({ ...c, bytes });
  }
  assert.equal(invoked, 0);
});

test("report completion: accepts exact 2 MiB maximum but rejects oversized or shared bytes even with matching digests", () => {
  const max = completionFixture("reports.view", Buffer.alloc(2 * 1024 * 1024, 1));
  assert.deepEqual(complete(max), max.bytes);
  completionDenied(completionFixture("reports.view", Buffer.alloc(2 * 1024 * 1024 + 1, 1)));
  const shared = Buffer.from(new SharedArrayBuffer(64)); shared.fill(1);
  completionDenied(completionFixture("reports.view", shared));
});

test("report completion: native byte accessors ignore caller-owned properties and copy only the actual byte range", () => {
  const backing = Buffer.from("prefix|synthetic immutable report bytes|suffix");
  const c = completionFixture("reports.view", backing.subarray(7, -7)); let invoked = 0;
  for (const key of ["length", "byteLength", "byteOffset", "buffer"]) {
    Object.defineProperty(c.bytes, key, { get() { invoked++; throw new Error("synthetic private error"); } });
  }
  const result = complete(c);
  assert.equal(result.toString(), "synthetic immutable report bytes");
  assert.equal(invoked, 0);
  backing.fill(0);
  assert.equal(result.toString(), "synthetic immutable report bytes");
});


test("report completion: simulated asynchronous resolution cannot reuse authority withdrawn while bytes were pending", async () => {
  for (const mutate of [
    f => { f.evidence.items[1].releaseState = "withdrawn"; },
    f => { f.trusted.reportGrants.find(g => g.operation === "reports.download").active = false; },
    f => { f.trusted.reportEntitlement.decision = "ineligible"; },
  ]) {
    const c = completionFixture("reports.download");
    const bytes = await Promise.resolve().then(() => { mutate(c.current); return Buffer.from(c.bytes); });
    completionDenied({ ...c, bytes });
  }
});
