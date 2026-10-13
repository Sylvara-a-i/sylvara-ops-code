"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { prepareCompanyCallsPage, prepareReleasedReportsPage } = require("../company-call-report-projection");
const ERROR = /^Invalid company call\/report projection evidence$/;

function fixture(resource = "calls", suffix = "a") {
  const observedAt = "2026-10-12T12:00:00.000Z";
  const owner = { clientId: `synthetic-client-${suffix}`, deploymentId: `synthetic-deployment-${suffix}`,
    configurationVersion: "synthetic-config-v1" };
  const company = { principalId: `synthetic-principal-${suffix}`, auditActorId: `synthetic-actor-${suffix}`,
    contact: { id: `synthetic-contact-${suffix}`, accountId: `synthetic-crm-${suffix}` },
    companyMappings: [{ creatorAccountId: `synthetic-company-${suffix}`, crmAccountId: `synthetic-crm-${suffix}`, active: true }] };
  const calls = ["c", "a", "b"].map((key, index) => ({ ...owner, callKey: key.repeat(64),
    startedAt: index === 0 ? "2026-10-12T10:00:00.000Z" : "2026-10-12T11:00:00.000Z",
    endedAt: null, outcome: "unresolved" }));
  const reports = ["c", "a", "b", "d", "e", "f", "g"].map((key, index) => ({ ...owner,
    reportKey: `synthetic-report-${key}`, periodStart: "2026-10-01", periodEnd: "2026-10-07",
    releaseState: index === 3 ? "draft" : index === 4 ? "withdrawn" : "released",
    releaseRevision: "synthetic-release-v1", releasedAt: index === 0 ? "2026-10-11T10:00:00.000Z" : "2026-10-11T11:00:00.000Z",
    artifact: index === 6 ? null : { version: "synthetic-artifact-v1", sha256: "a".repeat(64), accepted: index !== 5 } }));
  const reportGrants = reports.map(r => ({ principalId: company.principalId,
    creatorAccountId: company.companyMappings[0].creatorAccountId, reportKey: r.reportKey,
    operation: "reports.view", active: true, releaseRevision: r.releaseRevision,
    artifactVersion: "synthetic-artifact-v1", artifactSha256: "a".repeat(64), revision: "synthetic-report-grant-v1" }));
  reportGrants.push({ ...reportGrants[1], operation: "reports.download" });
  return {
    resource,
    input: { Account: company.companyMappings[0].creatorAccountId, limit: 2, cursor: null },
    trusted: { environment: "development", organizationId: "synthetic-org", observedAt, complete: true, company,
      readGrant: { principalId: company.principalId, creatorAccountId: company.companyMappings[0].creatorAccountId,
        operation: `${resource}.read`, active: true, revision: "synthetic-read-v1" },
      sourceBinding: { ...owner, creatorAccountId: company.companyMappings[0].creatorAccountId,
        crmAccountId: company.contact.accountId, sourceRevision: "synthetic-source-v1", active: true, revision: "synthetic-binding-v1" },
      reportGrants: resource === "reports" ? reportGrants : null },
    evidence: { environment: "development", organizationId: "synthetic-org", observedAt, complete: true,
      snapshotId: "synthetic-snapshot-v1", watermark: observedAt, sourceRevision: "synthetic-source-v1", ...owner,
      items: resource === "reports" ? reports : calls },
    policy: { expectedEnvironment: "development", expectedOrganizationId: "synthetic-org",
      asOf: "2026-10-12T12:00:30.000Z", maxAgeMs: 60000 },
  };
}
function run(f) {
  return (f.resource === "calls" ? prepareCompanyCallsPage : prepareReleasedReportsPage)(f.input, f.trusted, f.evidence, f.policy);
}
function denied(f) { assert.throws(() => run(f), error => error instanceof TypeError && ERROR.test(error.message)); }
function frozen(value) {
  if (value && typeof value === "object") {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) frozen(child);
  }
}

for (const resource of ["calls", "reports"]) {
  test(`${resource}: independent company projections expose only permitted list fields`, () => {
    const a = fixture(resource), b = fixture(resource, "b");
    a.input.limit = b.input.limit = 100;
    const result = run(a);
    assert.equal(result.items.length, 3);
    assert.deepEqual(run(b), result);
    const json = JSON.stringify(result);
    for (const forbidden of ["principal", "clientId", "deploymentId", "configurationVersion", "sha256",
      "artifactVersion", "sourceRevision", "crmAccount", "transcript", "recording", "url", "releaseRevision"]) {
      assert.equal(json.includes(forbidden), false, forbidden);
    }
    assert.equal(result.state, "available");
    assert.equal(result.hasMore, false);
    assert.equal(result.nextCursor, null);
  });

  test(`${resource}: stable timestamp/key pagination survives source reordering and rechecks current authority`, () => {
    const f = fixture(resource);
    f.input.limit = 1;
    const key = resource === "calls" ? "callKey" : "reportKey";
    const first = run(f);
    f.input.cursor = first.nextCursor;
    f.evidence.items.reverse();
    if (resource === "reports") f.trusted.reportGrants.reverse();
    const second = run(f);
    assert.deepEqual(run(f), second); // A repeated continuation returns the same page.
    f.input.cursor = second.nextCursor;
    const third = run(f);
    assert.deepEqual([first, second, third].map(page => page.items[0][key]), resource === "calls" ?
      ["a", "b", "c"].map(c => c.repeat(64)) : ["a", "b", "c"].map(c => `synthetic-report-${c}`));
    assert.equal(third.hasMore, false);
    assert.equal(third.nextCursor, null);
    assert.equal(new Set([first, second, third].map(page => page.items[0][key])).size, 3);
  });

  test(`${resource}: unknown and certified empty are distinct; missing binding cannot certify an empty source`, () => {
    const f = fixture(resource);
    f.evidence = null;
    assert.equal(run(f).state, "unknown");
    assert.equal(run(f).items, null);
    f.trusted.sourceBinding = null;
    f.trusted.reportGrants = null;
    assert.equal(run(f).state, "unknown");
    f.evidence = fixture(resource).evidence;
    f.evidence.items = [];
    denied(f);
    const empty = fixture(resource);
    empty.evidence.items = [];
    const result = run(empty);
    assert.equal(result.state, "empty");
    assert.deepEqual(result.items, []);
    assert.equal(result.hasMore, false);
  });

  const invalid = {
    "forged account": f => { f.input.Account = "synthetic-company-b"; },
    "foreign principal grant": f => { f.trusted.readGrant.principalId = "synthetic-principal-b"; },
    "foreign company grant": f => { f.trusted.readGrant.creatorAccountId = "synthetic-company-b"; },
    "service-area permission is not read permission": f => { f.trusted.readGrant.operation = "service-area-request"; },
    "billing permission is not read permission": f => { f.trusted.readGrant.operation = "billing.read"; },
    "revoked read grant": f => { f.trusted.readGrant.active = false; },
    "inactive source binding": f => { f.trusted.sourceBinding.active = false; },
    "wrong CRM contact relationship": f => { f.trusted.company.contact.accountId = "synthetic-crm-b"; },
    "duplicate mapping": f => { f.trusted.company.companyMappings.push({ ...f.trusted.company.companyMappings[0] }); },
    "canonical account alias": f => { f.trusted.company.companyMappings.push({ ...f.trusted.company.companyMappings[0], creatorAccountId: "synthetic-company-b" }); },
    "inactive mapping": f => { f.trusted.company.companyMappings[0].active = false; },
    "wrong source binding account": f => { f.trusted.sourceBinding.crmAccountId = "synthetic-crm-b"; },
    "wrong source client": f => { f.evidence.clientId = "synthetic-client-b"; },
    "wrong source deployment": f => { f.evidence.deploymentId = "synthetic-deployment-b"; },
    "wrong source configuration": f => { f.evidence.configurationVersion = "synthetic-other-config"; },
    "wrong source revision": f => { f.evidence.sourceRevision = "synthetic-other-source"; },
    "cross-tenant row": f => { f.evidence.items.at(-1).clientId = "synthetic-client-b"; },
    "cross-deployment row": f => { f.evidence.items.at(-1).deploymentId = "synthetic-deployment-b"; },
    "row configuration mismatch": f => { f.evidence.items.at(-1).configurationVersion = "synthetic-other-config"; },
    "duplicate row": f => { f.evidence.items.push(structuredClone(f.evidence.items[0])); },
    "wrong environment": f => { f.evidence.environment = "production"; },
    "wrong organization": f => { f.trusted.organizationId = "synthetic-other-org"; },
    "incomplete source": f => { f.evidence.complete = false; },
    "incomplete authority": f => { f.trusted.complete = false; },
    "stale source": f => { f.evidence.observedAt = "2026-10-12T11:59:29.999Z"; },
    "stale authorization": f => { f.trusted.observedAt = "2026-10-12T11:59:29.999Z"; },
    "future source": f => { f.evidence.observedAt = "2026-10-12T12:00:30.001Z"; },
    "future authorization": f => { f.trusted.observedAt = "2026-10-12T12:00:30.001Z"; },
    "watermark beyond observation": f => { f.evidence.watermark = "2026-10-12T12:00:00.001Z"; },
    "invalid watermark": f => { f.evidence.watermark = "not-an-instant"; },
    "zero page size": f => { f.input.limit = 0; },
    "oversize page": f => { f.input.limit = 101; },
    "fractional page size": f => { f.input.limit = 1.5; },
    "forged cursor": f => { f.input.cursor = {}; },
    "private URL field": f => { f.evidence.items[0].url = "synthetic-forbidden"; },
    "raw content field": f => { f.evidence.items[0].transcript = "synthetic-forbidden"; },
    "sparse collection": f => { delete f.evidence.items[1]; },
    "oversize snapshot": f => { f.evidence.items = Array(1001).fill(f.evidence.items[0]); },
  };
  for (const [name, mutate] of Object.entries(invalid)) {
    test(`${resource}: rejects ${name}`, () => { const f = fixture(resource); mutate(f); denied(f); });
  }

  test(`${resource}: cursor pins company, grant/binding revisions, page size and exact snapshot`, () => {
    const mutations = [
      f => { f.trusted.readGrant.revision = "synthetic-read-v2"; },
      f => { f.trusted.readGrant.active = false; },
      f => { f.trusted.sourceBinding.revision = "synthetic-binding-v2"; },
      f => { f.evidence.snapshotId = "synthetic-snapshot-v2"; },
      f => { f.evidence.items.pop(); },
      f => { f.input.limit = 3; },
      f => { f.evidence = null; },
      f => { f.evidence.observedAt = "2026-10-12T12:00:01.000Z"; },
      f => { f.policy.asOf = "2026-10-12T12:01:00.001Z"; },
    ];
    for (const mutate of mutations) {
      const f = fixture(resource);
      f.input.cursor = run(f).nextCursor;
      mutate(f);
      denied(f);
    }
    const a = fixture(resource), b = fixture(resource, "b");
    b.input.cursor = run(a).nextCursor;
    denied(b);
    a.input.cursor = structuredClone(run(a).nextCursor);
    denied(a); // Serialization is deliberately not an authenticated cursor transport.
  });

  test(`${resource}: exact freshness boundary and oldest constituent observation`, () => {
    const f = fixture(resource);
    f.trusted.observedAt = "2026-10-12T11:59:30.000Z";
    assert.equal(run(f).observedAt, f.trusted.observedAt);
    f.trusted.observedAt = "2026-10-12T11:59:29.999Z";
    denied(f);
  });

  test(`${resource}: fresh observation of unchanged historical data remains valid`, () => {
    const f = fixture(resource);
    f.evidence.watermark = "2026-10-11T12:00:00.000Z";
    if (resource === "calls") {
      for (const row of f.evidence.items) row.startedAt = "2026-10-10T11:00:00.000Z";
    }
    const result = run(f);
    assert.equal(result.state, "available");
    assert.equal(result.watermark, "2026-10-11T12:00:00.000Z");
    assert.equal(result.observedAt, "2026-10-12T12:00:00.000Z");
  });

  test(`${resource}: detached immutable output and no input mutation`, () => {
    const f = fixture(resource), before = structuredClone(f), result = run(f);
    assert.deepEqual(f, before);
    frozen(result);
    const snapshot = JSON.stringify(result);
    f.evidence.items[1][resource === "calls" ? "outcome" : "periodStart"] = "changed";
    assert.equal(JSON.stringify(result), snapshot);
    assert.throws(() => result.items.push({}), TypeError);
  });
}

test("calls: source chronology, key and outcome are validated without reclassifying canonical facts", () => {
  const mutations = [
    f => { f.evidence.items[0].startedAt = "2026-10-12T12:01:00.000Z"; },
    f => { f.evidence.items[0].endedAt = "2026-10-12T09:00:00.000Z"; },
    f => { f.evidence.items[0].endedAt = "2026-10-12T12:01:00.000Z"; },
    f => { f.evidence.items[0].callKey = "raw-provider-id"; },
    f => { f.evidence.items[0].outcome = "guessed"; },
    f => { f.trusted.reportGrants = []; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); denied(f); }
});

test("reports: release, accepted immutable artifact and exact view grant are all required", () => {
  const mutations = [
    f => { f.evidence.items[0].releaseState = "draft"; },
    f => { f.evidence.items[0].releaseState = "withdrawn"; },
    f => { f.evidence.items[0].artifact = null; },
    f => { f.evidence.items[0].artifact.accepted = false; },
    f => { f.evidence.items[0].artifact.version = "synthetic-artifact-v2"; },
    f => { f.evidence.items[0].artifact.sha256 = "b".repeat(64); },
    f => { f.evidence.items[0].releaseRevision = "synthetic-release-v2"; },
    f => { f.trusted.reportGrants[0].active = false; },
    f => { f.trusted.reportGrants.splice(0, 1); },
  ];
  for (const mutate of mutations) {
    const f = fixture("reports"); f.input.limit = 100; mutate(f);
    assert.equal(run(f).items.some(r => r.reportKey === "synthetic-report-c"), false);
  }
  const f = fixture("reports");
  const result = run(f);
  assert.equal(result.items[0].canDownload, true);
  assert.equal(result.items[1].canDownload, false);
  f.trusted.reportGrants.find(g => g.operation === "reports.download").active = false;
  assert.equal(run(f).items[0].canDownload, false);
});

test("reports: hidden rows do not leak presence and cannot hide cross-company or malformed evidence", () => {
  const f = fixture("reports");
  f.evidence.items.forEach(r => { r.releaseState = "draft"; });
  const hidden = run(f);
  f.evidence.items = [];
  assert.deepEqual(run(f), hidden);
  const hiddenForeign = fixture("reports");
  hiddenForeign.evidence.items[3].clientId = "synthetic-client-b";
  denied(hiddenForeign);
});

test("reports: invalid release facts and ambiguous authorization reject", () => {
  const mutations = [
    f => { f.evidence.items[0].releaseState = "sent"; },
    f => { f.evidence.items[0].releaseRevision = null; },
    f => { f.evidence.items[0].releasedAt = null; },
    f => { f.evidence.items[0].releasedAt = "2026-10-12T12:00:00.001Z"; },
    f => { f.evidence.items[0].periodStart = "2026-10-08"; },
    f => { f.evidence.items[0].periodEnd = "2026-10-13"; },
    f => { f.evidence.items[0].artifact.sha256 = "invalid"; },
    f => { f.trusted.reportGrants.push({ ...f.trusted.reportGrants[0], active: false }); },
    f => { f.trusted.reportGrants[0].principalId = "synthetic-principal-b"; },
    f => { f.trusted.reportGrants[0].creatorAccountId = "synthetic-company-b"; },
    f => { f.trusted.reportGrants[0].operation = "billing.read"; },
    f => { f.trusted.reportGrants = null; },
  ];
  for (const mutate of mutations) { const f = fixture("reports"); mutate(f); denied(f); }
});

test("report continuation rejects withdrawal, artifact replacement and grant changes", () => {
  for (const mutate of [
    f => { f.evidence.items[0].releaseState = "withdrawn"; },
    f => { f.evidence.items[0].artifact.sha256 = "b".repeat(64); },
    f => { f.trusted.reportGrants[0].active = false; },
    f => { f.trusted.reportGrants[0].revision = "synthetic-grant-v2"; },
  ]) {
    const f = fixture("reports"); f.input.cursor = run(f).nextCursor; mutate(f); denied(f);
  }
});

test("strict data shapes reject getters, symbols, prototypes and custom array iteration without invocation", () => {
  let invoked = 0;
  const getter = { get() { invoked++; return "synthetic-company-a"; }, enumerable: true };
  const mutations = [
    f => { Object.defineProperty(f.input, "Account", getter); },
    f => { Object.defineProperty(f.trusted, "company", getter); },
    f => { Object.defineProperty(f.trusted.company.contact, "accountId", getter); },
    f => { Object.defineProperty(f.evidence.items, "0", getter); },
    f => { Object.defineProperty(f.evidence.items[0], "outcome", getter); },
    f => { f.evidence.items[Symbol.iterator] = () => { invoked++; return [][Symbol.iterator](); }; },
    f => { f.evidence.items[0].toJSON = () => { invoked++; return {}; }; },
    f => { f.input[Symbol("extra")] = true; },
    f => { f.input = Object.create(f.input); },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); denied(f); }
  assert.equal(invoked, 0);
});

test("module has no provider, writer, logging or implicit clock capabilities", () => {
  let invoked = 0;
  const forbidden = () => { invoked++; throw new Error("forbidden capability"); };
  const context = vm.createContext({ module: { exports: {} }, fetch: forbidden, XMLHttpRequest: forbidden,
    console: { log: forbidden, error: forbidden }, setTimeout: forbidden,
    require(name) {
      if (name === "node:crypto") return require("node:crypto");
      if (name === "../company-settings-requests/service-area-request-contract") return context.companyModule;
      return forbidden();
    } });
  const load = file => vm.runInContext(`(function(module, require) {\n${fs.readFileSync(file, "utf8")}\n})(module, require);`, context);
  load(path.resolve(__dirname, "../../company-settings-requests/service-area-request-contract.js"));
  context.companyModule = context.module.exports;
  context.module = { exports: {} };
  load(path.resolve(__dirname, "../company-call-report-projection.js"));
  vm.runInContext(`Date.now = () => { throw new Error("implicit clock"); };
    const f = ${JSON.stringify(fixture())};
    const first = module.exports.prepareCompanyCallsPage(f.input, f.trusted, f.evidence, f.policy);
    f.input.cursor = first.nextCursor;
    module.exports.prepareCompanyCallsPage(f.input, f.trusted, f.evidence, f.policy);`, context);
  assert.equal(invoked, 0);
});
