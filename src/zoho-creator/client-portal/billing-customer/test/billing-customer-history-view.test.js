"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareBillingCustomerView: original, prepareBillingCustomerHistoryView: prepare } = require("../billing-customer-view-contract");
const OBSERVED = "2026-10-07T12:00:00.000Z";

function fixture() {
  return {
    input: { Account: "synthetic-account" },
    trusted: {
      environment: "development", organizationId: "synthetic-org", observedAt: OBSERVED, complete: true,
      company: { principalId: "synthetic-principal", contact: { id: "synthetic-contact", accountId: "synthetic-crm" },
        companyMappings: [{ creatorAccountId: "synthetic-account", crmAccountId: "synthetic-crm", active: true }],
        auditActorId: "synthetic-actor" },
      readGrant: { principalId: "synthetic-principal", creatorAccountId: "synthetic-account", operation: "billing.read", active: true },
      billingBinding: { creatorAccountId: "synthetic-account", crmAccountId: "synthetic-crm",
        organizationId: "synthetic-org", customerId: "synthetic-customer" },
    },
    evidence: {
      environment: "development", organizationId: "synthetic-org", observedAt: OBSERVED, complete: true,
      customer: { customerId: "synthetic-customer", crmAccountId: "synthetic-crm" },
      subscriptions: { complete: true, items: [{
        subscriptionId: "synthetic-subscription", customerId: "synthetic-customer", status: "live",
        planCode: "synthetic-plan", planLabel: "Synthetic Plan", termStart: "2026-10-01",
        termEnd: "2026-10-31", nextBillingOn: "2026-11-01",
      }] },
      invoices: { complete: true, items: [{
        invoiceId: "synthetic-invoice", customerId: "synthetic-customer", number: "SYN-001", status: "paid",
        issuedOn: "2026-10-01", dueOn: "2026-10-07",
        money: { totalMinor: 12345, balanceMinor: 0, amountUnit: "minor",
          currency: { code: "EUR", minorUnitExponent: 2, source: "invoice-response" } },
      }] },
      integrations: null,
      payments: { complete: true, items: [{
        paymentId: "synthetic-payment", customerId: "synthetic-customer", number: "PAY-001",
        status: "success", recordedOn: "2026-10-02", mode: "creditcard",
        money: { amountMinor: 12345, amountUnit: "minor",
          currency: { code: "EUR", minorUnitExponent: 2, source: "payment-response" } },
      }] },
    },
    policy: { expectedEnvironment: "development", expectedOrganizationId: "synthetic-org",
      asOf: "2026-10-07T12:01:00.000Z", maxAgeMs: 60000,
      featureCode: "synthetic-feature", featurePolicyRevision: "synthetic-revision" },
  };
}
function run(f = fixture()) { return prepare(f.input, f.trusted, f.evidence, f.policy); }
function invalid(mutate) { const f = fixture(); mutate(f); assert.throws(() => run(f), TypeError); }
function frozen(value) {
  if (value && typeof value === "object") {
    assert.ok(Object.isFrozen(value));
    for (const item of Object.values(value)) frozen(item);
  }
}
function payment(f) { return f.evidence.payments.items[0]; }

test("history projects payment facts and explicit billing dates without changing source objects", () => {
  const f = fixture(), before = structuredClone(f), view = run(f);
  assert.equal(view.subscriptions.items[0].nextBillingOn, "2026-11-01");
  assert.notEqual(view.subscriptions.items[0].nextBillingOn, view.subscriptions.items[0].termEnd);
  assert.deepEqual(view.payments, { state: "available", items: [{
    number: "PAY-001", status: "success", recordedOn: "2026-10-02", mode: "creditcard", money: payment(f).money,
  }] });
  assert.deepEqual(f, before);
  frozen(view);
  payment(f).money.currency.code = "USD";
  assert.equal(view.payments.items[0].money.currency.code, "EUR");
  for (const value of ["synthetic-principal", "synthetic-contact", "synthetic-customer", "synthetic-subscription", "synthetic-payment", "synthetic-org"])
    assert.ok(!JSON.stringify(view).includes(value));
});

test("original export retains its exact shape and rejects history-only inputs", () => {
  const f = fixture();
  assert.throws(() => original(f.input, f.trusted, f.evidence, f.policy), TypeError);
  delete f.evidence.payments;
  delete f.evidence.subscriptions.items[0].nextBillingOn;
  const view = original(f.input, f.trusted, f.evidence, f.policy);
  assert.deepEqual(Object.keys(view), ["environment", "observedAt", "customerState", "subscriptions", "invoices", "integrations"]);
  assert.deepEqual(Object.keys(view.subscriptions.items[0]), ["status", "planLabel", "termStart", "termEnd"]);
  assert.deepEqual(view.invoices.items[0].money, f.evidence.invoices.items[0].money);
  assert.throws(() => run(f), TypeError);
});

test("payment unknown, verified-empty and available states remain distinct", () => {
  const f = fixture();
  f.evidence.payments = null;
  assert.deepEqual(run(f).payments, { state: "unknown", items: null });
  f.evidence.payments = { complete: true, items: [] };
  assert.deepEqual(run(f).payments, { state: "empty", items: [] });
  invalid((f) => { f.evidence.payments.complete = false; });
  invalid((f) => { delete f.evidence.payments; });
});

test("unresolved customer cannot certify even empty payment history", () => {
  const f = fixture();
  f.evidence.customer = null;
  f.evidence.subscriptions = null; f.evidence.invoices = null; f.evidence.integrations = null;
  f.evidence.payments = { complete: true, items: [] };
  assert.throws(() => run(f), TypeError);
  f.evidence.payments = null;
  assert.equal(run(f).customerState, "unknown");
  f.trusted.billingBinding = null;
  assert.equal(run(f).customerState, "unknown");
});

test("subscription and invoice availability do not fabricate or erase payment history", () => {
  const f = fixture();
  f.evidence.subscriptions = null; f.evidence.invoices = null;
  assert.equal(run(f).payments.items.length, 1);
  f.evidence.subscriptions = { complete: true, items: [] };
  f.evidence.invoices = { complete: true, items: [] };
  assert.equal(run(f).payments.items.length, 1);
});

test("multiple subscriptions retain independent known or unknown billing dates", () => {
  const f = fixture();
  const first = f.evidence.subscriptions.items[0];
  f.evidence.subscriptions.items.push({ ...first, subscriptionId: "synthetic-cancelled", status: "cancelled", nextBillingOn: null });
  assert.deepEqual(run(f).subscriptions.items.map((s) => s.nextBillingOn), ["2026-11-01", null]);
  first.nextBillingOn = null;
  assert.equal(run(f).subscriptions.items[0].nextBillingOn, null);
  for (const value of ["2026-02-30", "2026-11-01T00:00:00Z", "", 1, undefined])
    invalid((f) => { f.evidence.subscriptions.items[0].nextBillingOn = value; });
});

test("payment ownership, duplicate identity and inherited read authorization fail closed", () => {
  invalid((f) => { payment(f).customerId = "other"; });
  invalid((f) => { f.evidence.payments.items.push(structuredClone(payment(f))); });
  for (const value of [null, "", 1, "trailing "])
    invalid((f) => { payment(f).paymentId = value; });
  for (const mutate of [
    (f) => { f.trusted.readGrant.active = false; },
    (f) => { f.trusted.readGrant.operation = "billing.change"; },
    (f) => { f.trusted.company.companyMappings.push({ ...f.trusted.company.companyMappings[0] }); },
    (f) => { f.trusted.billingBinding.customerId = "other"; },
    (f) => { f.evidence.organizationId = "other"; },
    (f) => { f.evidence.environment = "production"; },
    (f) => { f.evidence.observedAt = "2026-10-07T11:59:59.999Z"; },
    (f) => { f.evidence.complete = false; },
  ]) invalid(mutate);
});

test("failed and unknown payments remain clearly labelled rather than counted as collected revenue", () => {
  for (const status of ["success", "failure", "unknown"]) {
    const f = fixture(); payment(f).status = status;
    assert.equal(run(f).payments.items[0].status, status);
  }
  invalid((f) => { payment(f).status = "paid"; });
  const f = fixture(); payment(f).number = null; payment(f).recordedOn = null; payment(f).mode = "unknown";
  assert.equal(run(f).payments.items[0].number, null);
  assert.equal(run(f).payments.items[0].recordedOn, null);
  for (const value of ["<script>", "", "PAY\n001"])
    invalid((f) => { payment(f).number = value; });
  invalid((f) => { payment(f).recordedOn = "2026-02-30"; });
  invalid((f) => { payment(f).mode = "arbitrary-private-label"; });
});

test("payment money uses the existing exact minor-unit rules and suppresses unavailable currency", () => {
  for (const amount of [-1, -0, 1.1, NaN, Infinity, "123", Number.MAX_SAFE_INTEGER + 1])
    invalid((f) => { payment(f).money.amountMinor = amount; });
  for (const amount of [0, null, Number.MAX_SAFE_INTEGER]) {
    const f = fixture(); payment(f).money.amountMinor = amount;
    assert.equal(run(f).payments.items[0].money.amountMinor, amount);
  }
  const f = fixture(); payment(f).money.currency = null;
  assert.deepEqual(run(f).payments.items[0].money, { amountMinor: null, amountUnit: null, currency: null });
  payment(f).money = { amountMinor: null, amountUnit: null, currency: { code: "JPY", minorUnitExponent: 0, source: "verified-payment-metadata" } };
  assert.equal(run(f).payments.items[0].money.amountMinor, null);
  invalid((f) => { payment(f).money.amountUnit = null; });
  invalid((f) => { payment(f).money.amountUnit = "major"; });
});

test("payment currency provenance stays resource-specific with cross-history exponent consistency", () => {
  for (const source of ["default", "invoice-response", "catalog-response"])
    invalid((f) => { payment(f).money.currency.source = source; });
  for (const value of [-1, 5, 1.5, "2"])
    invalid((f) => { payment(f).money.currency.minorUnitExponent = value; });
  invalid((f) => { payment(f).money.currency.code = "eur"; });
  invalid((f) => { payment(f).money.currency.minorUnitExponent = 0; }); // conflicts with invoice EUR
  const f = fixture();
  payment(f).money.currency = { code: "JPY", minorUnitExponent: 0, source: "verified-payment-metadata" };
  assert.equal(run(f).payments.items[0].money.currency.code, "JPY");
  f.evidence.payments.items.push({ ...payment(f), paymentId: "synthetic-second-payment",
    money: { ...payment(f).money, currency: { ...payment(f).money.currency, minorUnitExponent: 2 } } });
  assert.throws(() => run(f), TypeError);
});

test("payment projection preserves non-enumerable currency fields and never returns references", () => {
  const keys = ["code", "minorUnitExponent", "source"];
  for (let mask = 1; mask < 8; mask++) {
    const f = fixture(), expected = structuredClone(payment(f).money);
    keys.forEach((key, bit) => {
      if (mask & (1 << bit)) Object.defineProperty(payment(f).money.currency, key, { enumerable: false });
    });
    const result = run(f).payments.items[0].money;
    assert.deepEqual(result, expected);
    assert.deepEqual(Object.keys(result.currency), keys);
  }
});

test("history rejects credential/action fields, hostile shapes and accessors without executing getters", () => {
  for (const key of ["oauthToken", "cardNumber", "lastFourDigits", "paymentUrl", "invoiceId", "confirm", "cancel"])
    invalid((f) => { payment(f)[key] = "forbidden"; });
  invalid((f) => { f.evidence.payments.items = [ , payment(f)]; });
  invalid((f) => { f.evidence.payments.items.extra = true; });
  invalid((f) => { payment(f).money = Object.create(payment(f).money); });
  invalid((f) => { payment(f)[Symbol("hidden")] = true; });
  let calls = 0;
  for (const mutate of [
    (f) => { Object.defineProperty(f.evidence, "payments", { get() { calls++; return null; } }); },
    (f) => { Object.defineProperty(f.evidence.payments.items, "0", { get() { calls++; return {}; } }); },
    (f) => { Object.defineProperty(payment(f), "money", { get() { calls++; return {}; } }); },
    (f) => { Object.defineProperty(payment(f).money.currency, "code", { get() { calls++; return "EUR"; } }); },
    (f) => { Object.defineProperty(f.evidence.subscriptions.items[0], "nextBillingOn", { get() { calls++; return null; } }); },
  ]) invalid(mutate);
  assert.equal(calls, 0);
});

test("history export has zero transport, writer, logging or implicit clock capability", () => {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  let calls = 0;
  const forbidden = () => { calls++; throw Error("forbidden"); };
  const sandbox = vm.createContext({ module: { exports: {} }, fetch: forbidden, console: { log: forbidden }, XMLHttpRequest: forbidden });
  vm.runInContext("Date.now = () => { throw Error('clock forbidden'); };", sandbox);
  const shared = fs.readFileSync(path.resolve(__dirname, "../../company-settings-requests/service-area-request-contract.js"), "utf8");
  vm.runInContext("(function () { " + shared + "\n})()", sandbox);
  const helper = sandbox.module.exports;
  sandbox.module = { exports: {} };
  sandbox.require = (name) => name === "../company-settings-requests/service-area-request-contract" ? helper : forbidden();
  const source = fs.readFileSync(path.resolve(__dirname, "../billing-customer-view-contract.js"), "utf8");
  vm.runInContext("(function () { " + source + "\n})()", sandbox);
  const f = fixture();
  vm.runInContext("module.exports.prepareBillingCustomerHistoryView(" +
    [f.input, f.trusted, f.evidence, f.policy].map(JSON.stringify).join(",") + ")", sandbox);
  assert.equal(calls, 0);
});
