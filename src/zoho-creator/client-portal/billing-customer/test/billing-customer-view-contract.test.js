"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareBillingCustomerView: prepare } = require("../billing-customer-view-contract");
const OBSERVED = "2026-10-07T12:00:00.000Z";
const input = () => ({ Account: "synthetic-creator-account" });
const policy = () => ({
  expectedEnvironment: "development", expectedOrganizationId: "synthetic-billing-org",
  asOf: "2026-10-07T12:01:00.000Z", maxAgeMs: 60000,
  featureCode: "synthetic-call-record-export", featurePolicyRevision: "synthetic-policy-r1",
});
const trusted = () => ({
  environment: "development", organizationId: "synthetic-billing-org", observedAt: OBSERVED, complete: true,
  company: {
    principalId: "synthetic-principal",
    contact: { id: "synthetic-secondary-contact", accountId: "synthetic-crm-account" },
    companyMappings: [{ creatorAccountId: "synthetic-creator-account", crmAccountId: "synthetic-crm-account", active: true }],
    auditActorId: "synthetic-human",
  },
  readGrant: { principalId: "synthetic-principal", creatorAccountId: "synthetic-creator-account", operation: "billing.read", active: true },
  billingBinding: { creatorAccountId: "synthetic-creator-account", crmAccountId: "synthetic-crm-account",
    organizationId: "synthetic-billing-org", customerId: "synthetic-customer" },
});
const subscription = () => ({
  subscriptionId: "synthetic-subscription", customerId: "synthetic-customer", status: "live",
  planCode: "synthetic-plan", planLabel: "Synthetic Plan", termStart: "2026-10-01", termEnd: "2026-10-31",
});
const invoice = () => ({
  invoiceId: "synthetic-invoice", customerId: "synthetic-customer", number: "SYN-001", status: "paid",
  issuedOn: "2026-10-01", dueOn: "2026-10-07",
  money: { totalMinor: 12345, balanceMinor: 0, amountUnit: "minor",
    currency: { code: "EUR", minorUnitExponent: 2, source: "invoice-response" } },
});
const integration = () => ({
  provider: "jobber",
  featureGrant: { provider: "jobber", customerId: "synthetic-customer", subscriptionId: "synthetic-subscription",
    featureCode: "synthetic-call-record-export", policyRevision: "synthetic-policy-r1",
    decision: "eligible", observedAt: OBSERVED, validUntil: "2026-10-07T12:02:00.000Z" },
  connection: { creatorAccountId: "synthetic-creator-account", provider: "jobber", authorizationStatus: "authorized",
    connectionStatus: "connected", destinationConfigured: true, dataScope: ["Synthetic summary"], observedAt: OBSERVED },
});
const evidence = () => ({
  environment: "development", organizationId: "synthetic-billing-org", observedAt: OBSERVED, complete: true,
  customer: { customerId: "synthetic-customer", crmAccountId: "synthetic-crm-account" },
  subscriptions: { complete: true, items: [subscription()] },
  invoices: { complete: true, items: [invoice()] },
  integrations: { complete: true, items: [integration()] },
});
function run(e = evidence(), t = trusted(), p = policy(), i = input()) { return prepare(i, t, e, p); }
function invalidEvidence(mutate) { const e = evidence(); mutate(e); assert.throws(() => run(e), TypeError); }
function invalidTrusted(mutate) { const t = trusted(); mutate(t); assert.throws(() => run(evidence(), t), TypeError); }
function assertFrozen(value) {
  if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); for (const item of Object.values(value)) assertFrozen(item); }
}

test("projects consistent synthetic facts only; removes internal IDs and returns immutable copies", () => {
  const e = evidence(), t = trusted(), p = policy(), i = input();
  const before = structuredClone({ e, t, p, i });
  const view = prepare(i, t, e, p);
  assert.deepEqual(view, {
    environment: "development", observedAt: OBSERVED, customerState: "verified",
    subscriptions: { state: "available", items: [{ status: "live", planLabel: "Synthetic Plan", termStart: "2026-10-01", termEnd: "2026-10-31" }] },
    invoices: { state: "available", items: [{ number: "SYN-001", status: "paid", issuedOn: "2026-10-01", dueOn: "2026-10-07", money: invoice().money }] },
    integrations: { state: "available", items: [{ provider: "jobber", eligibility: "eligible", authorizationStatus: "authorized",
      connectionStatus: "connected", destinationConfigured: true, dataScope: ["Synthetic summary"] }] },
  });
  assert.deepEqual({ e, t, p, i }, before);
  assertFrozen(view);
  e.invoices.items[0].money.currency.code = "USD"; e.integrations.items[0].connection.dataScope.push("Other");
  assert.equal(view.invoices.items[0].money.currency.code, "EUR");
  assert.equal(view.integrations.items[0].dataScope.length, 1);
  for (const text of ["synthetic-principal", "synthetic-crm-account", "synthetic-customer", "synthetic-subscription", "synthetic-invoice", "synthetic-plan"])
    assert.ok(!JSON.stringify(view).includes(text));
});

test("unknown differs from verified empty; no customer evidence cannot certify emptiness", () => {
  const e = evidence(); e.subscriptions = null; e.invoices = null; e.integrations = null;
  const v = run(e);
  for (const key of ["subscriptions", "invoices", "integrations"]) assert.deepEqual(v[key], { state: "unknown", items: null });
  for (const key of ["subscriptions", "invoices", "integrations"]) e[key] = { complete: true, items: [] };
  const empty = run(e);
  for (const key of ["subscriptions", "invoices", "integrations"]) assert.deepEqual(empty[key], { state: "empty", items: [] });
  e.customer = null;
  assert.throws(() => run(e), TypeError);
  e.subscriptions = null; e.invoices = null; e.integrations = null;
  assert.equal(run(e).customerState, "unknown");
  const t = trusted(); t.billingBinding = null;
  assert.equal(run(e, t).customerState, "unknown");
  assert.throws(() => run(evidence(), t), TypeError);
});

test("preserves multiple subscriptions and historical invoices without selecting a primary or computing entitlement", () => {
  const e = evidence();
  e.subscriptions.items.push({ ...subscription(), subscriptionId: "synthetic-second-subscription", status: "cancelled" });
  e.integrations.items[0].featureGrant = null;
  const v = run(e);
  assert.deepEqual(v.subscriptions.items.map((s) => s.status), ["live", "cancelled"]);
  assert.equal(v.integrations.items[0].eligibility, "unknown");
  assert.equal(v.invoices.items.length, 1);
  for (const status of ["active", "live", "trial", "unpaid", "cancelled", "unknown"]) {
    e.subscriptions.items[0].status = status;
    assert.equal(run(e).integrations.items[0].eligibility, "unknown");
  }
});

test("exact company identity semantics deny ambiguous, inactive and cross-company joins", () => {
  for (const mutate of [
    (t) => { t.company.companyMappings = []; },
    (t) => { t.company.companyMappings.push({ ...t.company.companyMappings[0] }); },
    (t) => { t.company.companyMappings[0].active = false; },
    (t) => { t.company.contact.accountId = "other"; },
    (t) => { t.company.companyMappings[0].crmAccountId = "other"; },
    (t) => { t.company.companyMappings[0].creatorAccountId = "other"; },
    (t) => { t.company.principalId = ""; },
    (t) => { t.company.auditActorId = ""; },
  ]) invalidTrusted(mutate);
  assert.throws(() => run(evidence(), trusted(), policy(), { Account: "other" }), TypeError);
});

test("read-operation grant is a checked input prerequisite, not a role-derived permission", () => {
  for (const patch of [
    { principalId: "other" }, { creatorAccountId: "other" }, { operation: "integration.edit" }, { active: false }, { active: "true" },
  ]) invalidTrusted((t) => Object.assign(t.readGrant, patch));
  invalidTrusted((t) => { t.readGrant.role = "Admin"; });
  // This accepted synthetic payload proves consistency only, never actual login.
  assert.doesNotThrow(() => run());
});

test("exact Creator/CRM/Billing joins reject mismatched binding, customer, subscription and invoice IDs", () => {
  for (const key of ["creatorAccountId", "crmAccountId", "organizationId", "customerId"])
    invalidTrusted((t) => { t.billingBinding[key] = "other"; });
  for (const key of ["customerId", "crmAccountId"]) invalidEvidence((e) => { e.customer[key] = "other"; });
  invalidEvidence((e) => { e.subscriptions.items[0].customerId = "other"; });
  invalidEvidence((e) => { e.invoices.items[0].customerId = "other"; });
});

test("duplicate subscription/invoice/provider identities reject, even identical copies", () => {
  for (const key of ["subscriptions", "invoices", "integrations"])
    invalidEvidence((e) => { e[key].items.push(structuredClone(e[key].items[0])); });
});

test("each envelope enforces organization, environment, completeness and canonical freshness", () => {
  for (const mutate of [
    (x) => { x.organizationId = "other"; }, (x) => { x.environment = "production"; },
    (x) => { x.complete = false; }, (x) => { x.observedAt = "2026-10-07T11:59:59.999Z"; },
    (x) => { x.observedAt = "2026-10-07T12:01:00.001Z"; }, (x) => { x.observedAt = "2026-10-07T12:00:00Z"; },
    (x) => { x.observedAt = "2026-02-30T12:00:00.000Z"; },
  ]) { invalidEvidence(mutate); invalidTrusted(mutate); }
  for (const key of ["subscriptions", "invoices", "integrations"]) invalidEvidence((e) => { e[key].complete = false; });
  for (const p of [{ ...policy(), maxAgeMs: -1 }, { ...policy(), expectedEnvironment: "preview" }, { ...policy(), asOf: "now" }])
    assert.throws(() => run(evidence(), trusted(), p), TypeError);
  assert.doesNotThrow(() => run()); // exact age boundary is allowed
});

test("unknown currency and unit remain unavailable; never default USD, zero or convert floats", () => {
  const e = evidence(); e.invoices.items[0].money.currency = null;
  assert.deepEqual(run(e).invoices.items[0].money, { totalMinor: null, balanceMinor: null, amountUnit: null, currency: null });
  e.invoices.items[0].money = { totalMinor: null, balanceMinor: null, amountUnit: null, currency: invoice().money.currency };
  assert.equal(run(e).invoices.items[0].money.totalMinor, null);
  for (const amount of [-1, -0, 1.1, NaN, Infinity, "123", Number.MAX_SAFE_INTEGER + 1])
    invalidEvidence((e) => { e.invoices.items[0].money.totalMinor = amount; });
  for (const patch of [
    { amountUnit: "major" }, { amountUnit: null },
    { currency: { code: "EUR", minorUnitExponent: 2, source: "default" } },
    { currency: { code: "eur", minorUnitExponent: 2, source: "invoice-response" } },
    { currency: { code: "EUR", minorUnitExponent: 5, source: "invoice-response" } },
  ]) invalidEvidence((e) => Object.assign(e.invoices.items[0].money, patch));
  e.invoices.items[0].money = { ...invoice().money, totalMinor: 1, currency: { code: "JPY", minorUnitExponent: 0, source: "verified-invoice-metadata" } };
  assert.equal(run(e).invoices.items[0].money.totalMinor, 1);
});

test("non-enumerable currency data fields are explicitly preserved with their amounts", () => {
  const keys = ["code", "minorUnitExponent", "source"];
  for (let mask = 1; mask < 8; mask++) {
    const e = evidence();
    const currency = e.invoices.items[0].money.currency;
    keys.forEach((key, bit) => {
      if (mask & (1 << bit)) Object.defineProperty(currency, key, { enumerable: false });
    });
    const projected = run(e).invoices.items[0].money;
    assert.deepEqual(projected, invoice().money);
    assert.deepEqual(Object.keys(projected.currency), keys);
    assert.ok(Object.isFrozen(projected.currency));
  }
});

test("conflicting exponents, malformed dates, reversed terms and unsupported statuses reject", () => {
  invalidEvidence((e) => { e.invoices.items.push({ ...invoice(), invoiceId: "other", money: { ...invoice().money, currency: { ...invoice().money.currency, minorUnitExponent: 0 } } }); });
  invalidEvidence((e) => { e.subscriptions.items[0].termStart = "2026-02-30"; });
  invalidEvidence((e) => { e.subscriptions.items[0].termEnd = "2026-09-30"; });
  invalidEvidence((e) => { e.invoices.items[0].dueOn = "2026-10-07T00:00:00Z"; });
  invalidEvidence((e) => { e.subscriptions.items[0].status = "paid"; });
  invalidEvidence((e) => { e.invoices.items[0].status = "approved"; });
});

test("explicit feature evidence binds provider/customer/subscription/feature/revision and validity", () => {
  for (const key of ["provider", "customerId", "subscriptionId", "featureCode", "policyRevision"])
    invalidEvidence((e) => { e.integrations.items[0].featureGrant[key] = "other"; });
  for (const key of ["observedAt", "validUntil"])
    invalidEvidence((e) => { e.integrations.items[0].featureGrant[key] = "2026-10-07T11:59:59.000Z"; });
  invalidEvidence((e) => { e.integrations.items[0].featureGrant.validUntil = policy().asOf; });
  invalidEvidence((e) => { e.integrations.items[0].featureGrant.observedAt = policy().asOf; });
  invalidEvidence((e) => { e.subscriptions = null; });
  invalidEvidence((e) => { e.subscriptions.items = []; });
});

test("eligibility and authorization are independent; revocation preserves connection and historical facts", () => {
  const e = evidence(); e.integrations.items[0].featureGrant.decision = "ineligible";
  let v = run(e);
  assert.equal(v.integrations.items[0].eligibility, "ineligible");
  assert.equal(v.integrations.items[0].authorizationStatus, "authorized");
  assert.equal(v.integrations.items[0].destinationConfigured, true);
  assert.equal(v.invoices.items.length, 1);
  e.integrations.items[0].featureGrant.decision = "eligible";
  e.integrations.items[0].connection.authorizationStatus = "revoked";
  v = run(e);
  assert.equal(v.integrations.items[0].eligibility, "eligible");
  assert.equal(v.integrations.items[0].authorizationStatus, "revoked");
  e.integrations.items[0].connection = null;
  assert.equal(run(e).integrations.items[0].authorizationStatus, "unknown");
  assert.ok(!JSON.stringify(v).includes("canWrite"));
});

test("connection joins, freshness and data scopes reject ambiguous or unsafe evidence", () => {
  for (const key of ["creatorAccountId", "provider"]) invalidEvidence((e) => { e.integrations.items[0].connection[key] = "other"; });
  invalidEvidence((e) => { e.integrations.items[0].connection.observedAt = "2026-10-07T11:59:59.999Z"; });
  invalidEvidence((e) => { e.integrations.items[0].connection.observedAt = policy().asOf; });
  invalidEvidence((e) => { e.integrations.items[0].connection.dataScope.push("Synthetic summary"); });
  invalidEvidence((e) => { e.integrations.items[0].connection.dataScope = ["https://private.invalid"]; });
  invalidEvidence((e) => { e.integrations.items[0].connection.destinationConfigured = "true"; });
  for (const provider of ["housecall_pro", "workiz", "excel", "servicetitan"]) invalidEvidence((e) => { e.integrations.items[0].provider = provider; });
  for (const provider of ["google_sheets", "csv"]) {
    const e = evidence(); e.integrations.items = [{ provider, featureGrant: null, connection: null }];
    assert.equal(run(e).integrations.items[0].eligibility, "unknown");
  }
});

test("rejects all private/action fields, prototypes, symbols, sparse arrays and accessors without executing getters", () => {
  for (const key of ["rawPayload", "oauthToken", "paymentUrl", "activate", "mappingEdit"])
    invalidEvidence((e) => { e.integrations.items[0][key] = "forbidden"; });
  invalidEvidence((e) => { e.invoices.items[0].downloadUrl = "https://private.invalid"; });
  invalidEvidence((e) => { e.subscriptions.items[0].planLabel = "<script>"; });
  invalidEvidence((e) => { e.invoices.items = [ , invoice()]; });
  invalidEvidence((e) => { e.invoices.items.extra = true; });
  invalidTrusted((t) => { t.company.companyMappings[Symbol.iterator] = function* () {}; });
  invalidEvidence((e) => { e[Symbol("extra")] = true; });
  invalidEvidence((e) => { e.customer = Object.create(e.customer); });
  let calls = 0;
  invalidEvidence((e) => { Object.defineProperty(e.integrations.items[0], "featureGrant", { get() { calls++; return null; } }); });
  invalidTrusted((t) => { Object.defineProperty(t.company.companyMappings, "0", { get() { calls++; return {}; } }); });
  assert.equal(calls, 0);
});

test("imports only the pure company helper; zero network, database, logging or implicit clock capabilities", () => {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  let calls = 0;
  const forbidden = () => { calls++; throw Error("forbidden"); };
  const shared = fs.readFileSync(path.resolve(__dirname, "../../company-settings-requests/service-area-request-contract.js"), "utf8");
  const source = fs.readFileSync(path.resolve(__dirname, "../billing-customer-view-contract.js"), "utf8");
  const sandbox = vm.createContext({ module: { exports: {} }, fetch: forbidden, console: { log: forbidden }, XMLHttpRequest: forbidden });
  vm.runInContext("Date.now = () => { throw Error('clock forbidden'); };", sandbox);
  vm.runInContext("(function () { " + shared + "\n})()", sandbox);
  const helper = sandbox.module.exports;
  sandbox.module = { exports: {} };
  sandbox.require = (name) => name === "../company-settings-requests/service-area-request-contract" ? helper : forbidden();
  vm.runInContext("(function () { " + source + "\n})()", sandbox);
  vm.runInContext(`module.exports.prepareBillingCustomerView(${JSON.stringify(input())}, ${JSON.stringify(trusted())}, ${JSON.stringify(evidence())}, ${JSON.stringify(policy())})`, sandbox);
  assert.equal(calls, 0);
});
