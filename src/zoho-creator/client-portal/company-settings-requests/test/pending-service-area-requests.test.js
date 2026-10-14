"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const api = require("../pending-service-area-requests");
const { preparePendingServiceAreaRequestRead: read, preparePendingServiceAreaRequests: project } = api;
const ERROR = "Invalid pending service-area request read evidence";

function fixture(suffix = "a") {
  const observedAt = "2026-10-14T12:00:00.000Z";
  const account = `synthetic-company-${suffix}`;
  const company = {
    principalId: `synthetic-principal-${suffix}`, auditActorId: `synthetic-actor-${suffix}`,
    contact: { id: `synthetic-contact-${suffix}`, accountId: `synthetic-crm-${suffix}` },
    companyMappings: [{ creatorAccountId: account, crmAccountId: `synthetic-crm-${suffix}`, active: true }],
  };
  return {
    input: { Account: account, limit: 2, cursor: null },
    trusted: { environment: "development", organizationId: "synthetic-org", observedAt, complete: true, company,
      readGrant: { principalId: company.principalId, creatorAccountId: account,
        operation: "company-settings-requests.read", active: true, revision: "synthetic-read-v1" } },
    evidence: { environment: "development", organizationId: "synthetic-org", observedAt, complete: true,
      resource: "Company_Settings_Requests", accountId: account, snapshotId: "synthetic-snapshot-v1",
      items: ["c", "a", "b"].map(key => ({ ID: `synthetic-request-${key}`, Account: account,
        Previous_Service_Area: "  Synthetic before\r\narea\t ",
        Requested_Service_Area: `Synthetic requested area ${key}`, Status: "Pending review" })) },
    policy: { expectedEnvironment: "development", expectedOrganizationId: "synthetic-org",
      asOf: "2026-10-14T12:00:30.000Z", maxAgeMs: 60000 },
  };
}
function run(f) { return project(f.input, f.trusted, f.evidence, f.policy); }
function plan(f) { return read({ Account: f.input.Account }, f.trusted, f.policy); }
function denied(action) {
  assert.throws(action, error => error instanceof TypeError && error.message === ERROR && error.cause === undefined);
}
function assertFrozen(value) {
  if (value && typeof value === "object") {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) assertFrozen(child);
  }
}

test("pending requests: only the read plan and paged projection are public", () => {
  assert.deepEqual(Object.keys(api).sort(), ["preparePendingServiceAreaRequestRead", "preparePendingServiceAreaRequests"]);
});

test("pending requests: read plan pins the company, resource and minimum persisted fields without transport", () => {
  const f = fixture();
  const before = structuredClone(f);
  const result = plan(f);
  assert.deepEqual(result, {
    method: "GET", resource: "Company_Settings_Requests", environment: "development", organizationId: "synthetic-org",
    criteria: { Account: "synthetic-company-a" },
    fields: ["ID", "Account", "Previous_Service_Area", "Requested_Service_Area", "Status"],
  });
  assertFrozen(result);
  assert.deepEqual(f, before);
  assert.equal(Object.isFrozen(f.trusted.company), false);
  for (const extra of ["Status", "environment", "organizationId", "principalId", "fields", "criteria", "url"]) {
    denied(() => read({ Account: f.input.Account, [extra]: "synthetic-override" }, f.trusted, f.policy));
  }
});

test("pending requests: independent companies receive only their reviewed presentation fields", () => {
  const a = fixture(), b = fixture("b");
  a.input.limit = b.input.limit = 100;
  const result = run(a);
  assert.deepEqual(run(b), result);
  assert.deepEqual(Object.keys(result), ["state", "observedAt", "items", "totalCount", "hasMore", "nextCursor"]);
  assert.deepEqual(result.items.map(row => row.ID), ["synthetic-request-a", "synthetic-request-b", "synthetic-request-c"]);
  assert.equal(result.state, "available");
  assert.equal(result.totalCount, 3);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
  for (const item of result.items) {
    assert.deepEqual(Object.keys(item), ["ID", "Previous_Service_Area", "Requested_Service_Area", "Status"]);
  }
  const serialized = JSON.stringify(result);
  for (const privateValue of [a.input.Account, a.trusted.company.principalId, a.trusted.company.auditActorId,
    a.trusted.company.contact.id, a.trusted.company.contact.accountId, a.trusted.readGrant.revision,
    a.evidence.snapshotId, a.trusted.organizationId]) assert.equal(serialized.includes(privateValue), false);
  a.evidence = b.evidence;
  denied(() => run(a));
});

const invalidAuthority = {
  "forged company selector": f => { f.input.Account = "synthetic-company-b"; },
  "wrong grant principal": f => { f.trusted.readGrant.principalId = "synthetic-principal-b"; },
  "wrong grant company": f => { f.trusted.readGrant.creatorAccountId = "synthetic-company-b"; },
  "submission scope is not read scope": f => { f.trusted.readGrant.operation = "service-area-request"; },
  "another resource read scope": f => { f.trusted.readGrant.operation = "reports.read"; },
  "revoked read grant": f => { f.trusted.readGrant.active = false; },
  "truthy grant flag": f => { f.trusted.readGrant.active = "true"; },
  "missing grant revision": f => { delete f.trusted.readGrant.revision; },
  "missing company mapping": f => { f.trusted.company.companyMappings = []; },
  "inactive company mapping": f => { f.trusted.company.companyMappings[0].active = false; },
  "duplicate company mapping": f => { f.trusted.company.companyMappings.push({ ...f.trusted.company.companyMappings[0] }); },
  "canonical CRM alias": f => { f.trusted.company.companyMappings.push({ ...f.trusted.company.companyMappings[0], creatorAccountId: "synthetic-alias" }); },
  "inactive canonical CRM alias": f => { f.trusted.company.companyMappings.push({ ...f.trusted.company.companyMappings[0], creatorAccountId: "synthetic-alias", active: false }); },
  "wrong contact company": f => { f.trusted.company.contact.accountId = "synthetic-crm-b"; },
  "missing human attribution": f => { f.trusted.company.auditActorId = ""; },
  "incomplete authorization": f => { f.trusted.complete = false; },
  "wrong authorization organization": f => { f.trusted.organizationId = "synthetic-other-org"; },
  "wrong authorization environment": f => { f.trusted.environment = "production"; },
  "stale authorization": f => { f.trusted.observedAt = "2026-10-14T11:59:29.999Z"; },
  "future authorization": f => { f.trusted.observedAt = "2026-10-14T12:00:30.001Z"; },
  "malformed authorization time": f => { f.trusted.observedAt = "2026-10-14"; },
  "unsupported environment vocabulary": f => { f.policy.expectedEnvironment = "stage"; },
  "unbounded freshness": f => { f.policy.maxAgeMs = Infinity; },
  "zero freshness budget": f => { f.policy.maxAgeMs = 0; },
  "invalid current clock": f => { f.policy.asOf = "not-an-instant"; },
};
for (const [name, mutate] of Object.entries(invalidAuthority)) {
  test(`pending requests: both APIs reject ${name}, including missing data`, () => {
    const f = fixture(); mutate(f);
    denied(() => plan(f));
    denied(() => run(f));
    f.evidence = null;
    denied(() => run(f));
  });
}

test("pending requests: unknown evidence is distinct from a complete empty company snapshot", () => {
  const f = fixture(); f.evidence = null;
  assert.deepEqual(run(f), { state: "unknown", observedAt: f.trusted.observedAt,
    items: null, totalCount: null, hasMore: false, nextCursor: null });
  f.evidence = fixture().evidence; f.evidence.items = [];
  assert.deepEqual(run(f), { state: "empty", observedAt: f.trusted.observedAt,
    items: [], totalCount: 0, hasMore: false, nextCursor: null });
  f.evidence.complete = false;
  denied(() => run(f));
  const continued = fixture(); continued.input.cursor = run(continued).nextCursor; continued.evidence = null;
  denied(() => run(continued));
});

test("pending requests: observation time is the oldest evidence and freshness boundary is inclusive", () => {
  const f = fixture();
  f.evidence.observedAt = "2026-10-14T11:59:30.000Z";
  assert.equal(run(f).observedAt, f.evidence.observedAt);
  f.evidence.observedAt = "2026-10-14T12:00:10.000Z";
  assert.equal(run(f).observedAt, f.trusted.observedAt);
  f.trusted.observedAt = "2026-10-14T11:59:30.000Z";
  assert.equal(run(f).observedAt, f.trusted.observedAt);
});

const invalidSource = {
  "foreign receipt account": f => { f.evidence.accountId = "synthetic-company-b"; },
  "wrong resource": f => { f.evidence.resource = "Settings_Request_Native_Trial"; },
  "report name in place of form resource": f => { f.evidence.resource = "All_Company_Settings_Requests"; },
  "wrong source environment": f => { f.evidence.environment = "production"; },
  "wrong source organization": f => { f.evidence.organizationId = "synthetic-other-org"; },
  "incomplete source": f => { f.evidence.complete = false; },
  "truthy completeness": f => { f.evidence.complete = "true"; },
  "stale source": f => { f.evidence.observedAt = "2026-10-14T11:59:29.999Z"; },
  "future source": f => { f.evidence.observedAt = "2026-10-14T12:00:30.001Z"; },
  "invalid calendar date": f => { f.evidence.observedAt = "2026-02-30T12:00:00.000Z"; },
  "missing snapshot identity": f => { f.evidence.snapshotId = ""; },
  "duplicate request reference": f => { f.evidence.items.push({ ...f.evidence.items[0] }); },
  "foreign row after first page": f => { f.input.limit = 1; f.evidence.items[0].Account = "synthetic-company-b"; },
  "unknown status after first page": f => { f.input.limit = 1; f.evidence.items[0].Status = "Approved"; },
  "nonexact pending status": f => { f.evidence.items[0].Status = "pending review"; },
  "missing persisted ID": f => { delete f.evidence.items[0].ID; },
  "numeric ID": f => { f.evidence.items[0].ID = 42; },
  "extra private row field": f => { f.evidence.items[0].auditActorId = "synthetic-private-actor"; },
  "sparse collection": f => { delete f.evidence.items[1]; },
  "missing collection": f => { f.evidence.items = null; },
  "oversized complete collection": f => { f.evidence.items = Array.from({ length: 1001 }, (_, i) => ({ ...f.evidence.items[0], ID: `synthetic-${i}` })); },
  "zero page size": f => { f.input.limit = 0; },
  "fractional page size": f => { f.input.limit = 1.5; },
  "oversized page size": f => { f.input.limit = 101; },
  "extra client status predicate": f => { f.input.Status = "Pending review"; },
};
for (const [name, mutate] of Object.entries(invalidSource)) {
  test(`pending requests: rejects ${name}`, () => { const f = fixture(); mutate(f); denied(() => run(f)); });
}

test("pending requests: optional native before-image null/empty remains distinct and text is preserved", () => {
  const f = fixture(); f.input.limit = 100;
  f.evidence.items[0].Previous_Service_Area = null;
  f.evidence.items[1].Previous_Service_Area = "";
  f.evidence.items[2].Requested_Service_Area = "  Synthetic <area>\r\nEast\t ";
  const result = run(f);
  assert.equal(result.items[0].Previous_Service_Area, "");
  assert.equal(result.items[1].Previous_Service_Area, "  Synthetic before\r\narea\t ");
  assert.equal(result.items[1].Requested_Service_Area, "  Synthetic <area>\r\nEast\t ");
  assert.equal(result.items[2].Previous_Service_Area, null);
  for (const invalid of [undefined, false, 0, {}, [], "  ", "Synthetic\u0000area"]) {
    const malformed = fixture(); malformed.evidence.items[0].Previous_Service_Area = invalid;
    denied(() => run(malformed));
  }
});

test("pending requests: requested text is required and bounded by Unicode code points without truncation", () => {
  for (const invalid of [null, undefined, "", "\r\n\t ", false, {}, "Synthetic\u0001area", "\u{1f600}".repeat(2001)]) {
    const f = fixture(); f.evidence.items[0].Requested_Service_Area = invalid; denied(() => run(f));
  }
  const f = fixture(); f.input.limit = 100;
  f.evidence.items[0].Requested_Service_Area = "\u{1f600}".repeat(2000);
  assert.equal(run(f).items[2].Requested_Service_Area, f.evidence.items[0].Requested_Service_Area);
});

test("pending requests: stable ID pagination survives source reordering and repeated continuation", () => {
  const f = fixture(); f.input.limit = 1;
  f.evidence.items.forEach((row, index) => { row.ID = ["synthetic-2", "synthetic-10", "synthetic-1"][index]; });
  const first = run(f);
  f.input.cursor = first.nextCursor; f.evidence.items.reverse();
  const second = run(f);
  assert.deepEqual(run(f), second);
  f.input.cursor = second.nextCursor;
  const third = run(f);
  assert.deepEqual([first, second, third].map(page => page.items[0].ID), ["synthetic-1", "synthetic-10", "synthetic-2"]);
  assert.equal(third.hasMore, false);
  assert.equal(third.nextCursor, null);
  assert.ok([first, second, third].every(page => page.totalCount === 3));
});

test("pending requests: continuation rechecks current authorization without refreshing stale source", () => {
  const f = fixture(); f.input.cursor = run(f).nextCursor;
  f.policy.asOf = "2026-10-14T12:00:40.000Z";
  f.trusted.observedAt = "2026-10-14T12:00:39.000Z";
  assert.equal(run(f).items[0].ID, "synthetic-request-c");
  f.policy.asOf = "2026-10-14T12:01:00.001Z";
  f.trusted.observedAt = f.policy.asOf;
  denied(() => run(f));
});

const invalidContinuation = {
  "revoked read grant": f => { f.trusted.readGrant.active = false; },
  "changed grant revision": f => { f.trusted.readGrant.revision = "synthetic-read-v2"; },
  "changed principal": f => { f.trusted.company.principalId = f.trusted.readGrant.principalId = "synthetic-replacement"; },
  "changed audit actor": f => { f.trusted.company.auditActorId = "synthetic-other-actor"; },
  "changed contact": f => { f.trusted.company.contact.id = "synthetic-other-contact"; },
  "changed canonical company": f => { f.trusted.company.contact.accountId = f.trusted.company.companyMappings[0].crmAccountId = "synthetic-other-crm"; },
  "changed page size": f => { f.input.limit = 1; },
  "changed freshness policy": f => { f.policy.maxAgeMs = 120000; },
  "changed snapshot identity": f => { f.evidence.snapshotId = "synthetic-snapshot-v2"; },
  "changed source observation": f => { f.evidence.observedAt = "2026-10-14T12:00:01.000Z"; },
  "changed already-returned row": f => { f.evidence.items[1].Requested_Service_Area = "Synthetic revised area"; },
  "changed later row": f => { f.evidence.items[0].Previous_Service_Area = null; },
  "removed row": f => { f.evidence.items.pop(); },
};
for (const [name, mutate] of Object.entries(invalidContinuation)) {
  test(`pending requests: cursor rejects ${name}`, () => {
    const f = fixture(); f.input.cursor = run(f).nextCursor; mutate(f); denied(() => run(f));
  });
}

test("pending requests: cursors cannot cross companies or survive copying/serialization", () => {
  const a = fixture(), b = fixture("b");
  const cursor = run(a).nextCursor;
  b.input.cursor = cursor; denied(() => run(b));
  assertFrozen(cursor);
  assert.deepEqual(Reflect.ownKeys(cursor), []);
  for (const copy of [{ ...cursor }, structuredClone(cursor), JSON.parse(JSON.stringify(cursor)),
    Object.create(cursor), "synthetic-cursor", 1, undefined]) {
    a.input.cursor = copy; denied(() => run(a));
  }
});

test("pending requests: strict data shapes reject accessors and custom iterators without calling them", () => {
  let invoked = 0;
  const getter = { get() { invoked++; throw new Error("synthetic-private-getter"); }, enumerable: true };
  const mutations = [
    f => { Object.defineProperty(f.input, "Account", getter); },
    f => { Object.defineProperty(f.policy, "asOf", getter); },
    f => { Object.defineProperty(f.trusted, "company", getter); },
    f => { Object.defineProperty(f.trusted.company.contact, "id", getter); },
    f => { Object.defineProperty(f.trusted.company.companyMappings, "0", getter); },
    f => { Object.defineProperty(f.trusted.readGrant, "operation", getter); },
    f => { Object.defineProperty(f.evidence, "items", getter); },
    f => { Object.defineProperty(f.evidence.items, "2", getter); },
    f => { Object.defineProperty(f.evidence.items[0], "Requested_Service_Area", getter); },
    f => { f.evidence.items[Symbol.iterator] = () => { invoked++; return [][Symbol.iterator](); }; },
    f => { f.trusted.company.companyMappings[Symbol.iterator] = () => { invoked++; return [][Symbol.iterator](); }; },
    f => { Object.setPrototypeOf(f.evidence.items, Object.create(Array.prototype)); },
    f => { delete f.evidence.items[1]; f.evidence.items.extra = "synthetic-masked-hole"; },
    f => { delete f.trusted.company.companyMappings[0]; f.trusted.company.companyMappings.extra = "synthetic-masked-hole"; },
    f => { f.evidence.items[0].toJSON = () => { invoked++; return {}; }; },
    f => { Object.defineProperty(f.evidence.items[0], "privateField", { value: "synthetic-private", enumerable: false }); },
    f => { f.evidence.items[0][Symbol("extra")] = true; },
    f => { f.input[Symbol("extra")] = true; },
    f => { f.input = Object.create(f.input); },
    f => { f.evidence.items[0] = Object.create(f.evidence.items[0]); },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); denied(() => run(f)); }
  const f = fixture();
  const input = { Account: f.input.Account }; Object.defineProperty(input, "Account", getter);
  denied(() => read(input, f.trusted, f.policy));
  assert.equal(invoked, 0);
});

test("pending requests: outputs are detached and immutable while caller inputs remain unchanged", () => {
  const f = fixture(), before = structuredClone(f);
  const result = run(f);
  assertFrozen(result);
  assert.deepEqual(f, before);
  assert.equal(Object.isFrozen(f.evidence.items), false);
  assert.equal(Object.isFrozen(f.evidence.items[1]), false);
  f.evidence.items[1].Requested_Service_Area = "Synthetic later mutation";
  assert.equal(result.items[0].Requested_Service_Area, "Synthetic requested area a");
  assert.throws(() => { result.items[0].Status = "Approved"; }, TypeError);
  assert.throws(() => result.items.push({}), TypeError);
  const nullPrototype = fixture();
  nullPrototype.input = Object.assign(Object.create(null), nullPrototype.input);
  assert.equal(run(nullPrototype).state, "available");
});

test("pending requests: failures expose one generic error rather than source values", () => {
  const f = fixture(); f.input.Account = "synthetic-private-account";
  f.evidence.items[0].Requested_Service_Area = "synthetic-private-area";
  denied(() => run(f));
  denied(() => plan(f));
  const missing = fixture();
  missing.evidence.items[0] = { Account: missing.input.Account, Previous_Service_Area: "Synthetic before",
    Requested_Service_Area: "Synthetic after", Status: "Pending review" };
  denied(() => run(missing)); // A prepared four-field request is not a persisted read row.
});

test("pending requests: module uses no provider, persistence, log, timer or implicit clock capability", () => {
  let invoked = 0;
  const forbidden = () => { invoked++; throw new Error("forbidden capability"); };
  const context = vm.createContext({ module: { exports: {} }, fetch: forbidden, XMLHttpRequest: forbidden,
    console: { log: forbidden, error: forbidden, warn: forbidden }, setTimeout: forbidden, setInterval: forbidden,
    require(name) {
      if (name === "node:crypto") return require("node:crypto");
      if (name === "./service-area-request-contract") return context.companyModule;
      return forbidden();
    } });
  const load = file => vm.runInContext(`(function(module, require) {\n${fs.readFileSync(file, "utf8")}\n})(module, require);`, context);
  load(path.resolve(__dirname, "../service-area-request-contract.js"));
  context.companyModule = context.module.exports;
  context.module = { exports: {} };
  load(path.resolve(__dirname, "../pending-service-area-requests.js"));
  const result = vm.runInContext(`Date.now = () => { throw new Error("implicit clock"); };
    const f = ${JSON.stringify(fixture())};
    const plan = module.exports.preparePendingServiceAreaRequestRead({ Account: f.input.Account }, f.trusted, f.policy);
    const first = module.exports.preparePendingServiceAreaRequests(f.input, f.trusted, f.evidence, f.policy);
    f.input.cursor = first.nextCursor;
    const last = module.exports.preparePendingServiceAreaRequests(f.input, f.trusted, f.evidence, f.policy);
    [plan.method, first.state, last.hasMore, first.nextCursor];`, context);
  assert.deepEqual(Array.from(result).slice(0, 3), ["GET", "available", false]);
  const foreignModule = fixture(); foreignModule.input.cursor = result[3];
  denied(() => run(foreignModule));
  assert.equal(invoked, 0);
});
