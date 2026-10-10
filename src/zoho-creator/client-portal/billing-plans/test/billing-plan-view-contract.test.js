"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareBillingPlanView: prepare } = require("../billing-plan-view-contract");
const policy = () => ({ expectedEnvironment: "development", asOf: "2026-10-07T12:01:00.000Z", maxAgeMs: 60000 });
const plan = () => ({ label: "Synthetic Plan", catalogStatus: "active", recurringMinor: 12345, setupMinor: 678,
  amountUnit: "minor", interval: { count: 1, unit: "months" },
  currency: { code: "EUR", minorUnitExponent: 2, source: "plan-response" } });
const evidence = () => ({ environment: "development", observedAt: "2026-10-07T12:00:00.000Z", complete: true, plans: [plan()] });

test("exact sanitized projection, minor values and provenance; no input mutation", () => {
  const e = evidence(), p = policy(), before = structuredClone({ e, p });
  const view = prepare(e, p);
  assert.deepEqual(view, { environment: e.environment, observedAt: e.observedAt, catalogStatus: "available", plans: [plan()],
    customer: { subscription: null, entitlement: null, termStart: null, termEnd: null, usage: null } });
  assert.deepEqual({ e, p }, before);
  e.plans[0].currency.code = "USD"; e.plans[0].interval.count = 9;
  assert.equal(view.plans[0].currency.code, "EUR"); assert.equal(view.plans[0].interval.count, 1);
  for (const v of [view, view.plans, view.plans[0], view.plans[0].currency, view.plans[0].interval, view.customer]) assert.ok(Object.isFrozen(v));
});

test("unknown currency/unit/interval stay unavailable, never default USD or zero", () => {
  const e = evidence(); e.plans[0].currency = null;
  const v = prepare(e, policy()).plans[0];
  assert.equal(v.recurringMinor, null); assert.equal(v.setupMinor, null); assert.equal(v.amountUnit, null); assert.equal(v.currency, null);
  e.plans[0] = { ...plan(), amountUnit: null, recurringMinor: null, setupMinor: null, interval: null };
  assert.equal(prepare(e, policy()).plans[0].interval, null);
  e.plans[0].recurringMinor = 123; assert.throws(() => prepare(e, policy()), TypeError);
});

test("non-enumerable currency data fields retain complete provenance beside amounts", () => {
  const keys = ["code", "minorUnitExponent", "source"];
  for (let mask = 1; mask < 8; mask++) {
    const e = evidence();
    keys.forEach((key, bit) => {
      if (mask & (1 << bit)) Object.defineProperty(e.plans[0].currency, key, { enumerable: false });
    });
    const v = prepare(e, policy()).plans[0];
    assert.deepEqual(v, plan());
    assert.deepEqual(Object.keys(v.currency), keys);
    assert.ok(Object.isFrozen(v.currency));
  }
});

test("active/inactive/unavailable catalog is separate from entitlement and usage", () => {
  for (const status of ["active", "inactive", "unavailable"]) {
    const e = evidence(); e.plans[0].catalogStatus = status;
    const v = prepare(e, policy()); assert.equal(v.plans[0].catalogStatus, status);
    assert.ok(Object.values(v.customer).every((x) => x === null));
  }
  const e = evidence(); e.plans = []; assert.equal(prepare(e, policy()).catalogStatus, "unavailable");
});

test("monthly and annual observations coexist, duplicate or conflicting identities deny", () => {
  const e = evidence(); e.plans.push({ ...plan(), interval: { count: 1, unit: "years" } });
  assert.equal(prepare(e, policy()).plans.length, 2);
  for (const changed of [false, true]) {
    const e = evidence(); e.plans.push({ ...plan(), label: "synthetic plan", recurringMinor: changed ? 99 : 12345 });
    assert.throws(() => prepare(e, policy()), TypeError);
  }
});

test("environment, complete result, future/stale observation and canonical time deny", () => {
  for (const mutate of [
    (e) => { e.environment = "production"; }, (e) => { e.complete = false; },
    (e) => { e.observedAt = "2026-10-07T12:01:00.001Z"; },
    (e) => { e.observedAt = "2026-10-07T11:59:59.999Z"; },
    (e) => { e.observedAt = "2026-02-30T00:00:00.000Z"; },
    (e) => { e.observedAt = "2026-10-07T12:00:00Z"; },
  ]) { const e = evidence(); mutate(e); assert.throws(() => prepare(e, policy()), TypeError); }
  for (const p of [null, { ...policy(), maxAgeMs: -1 }, { ...policy(), asOf: "now" }, { ...policy(), expectedEnvironment: "owner-preview" }]) assert.throws(() => prepare(evidence(), p), TypeError);
});

test("unknown interval cannot disambiguate label; conflicting currency exponent denies", () => {
  for (const reverse of [false, true]) {
    const e = evidence(); e.plans.push({ ...plan(), interval: null });
    if (reverse) e.plans.reverse();
    assert.throws(() => prepare(e, policy()), TypeError);
  }
  const e = evidence(); e.plans.push({ ...plan(), label: "Synthetic Other", currency: { ...plan().currency, minorUnitExponent: 0 } });
  assert.throws(() => prepare(e, policy()), TypeError);
});

test("exact safe minor integers, zero and per-currency exponent; no conversion", () => {
  for (const amount of [0, 1, Number.MAX_SAFE_INTEGER]) {
    const e = evidence(); e.plans[0].recurringMinor = amount; e.plans[0].currency = { code: "JPY", minorUnitExponent: 0, source: "verified-catalog-metadata" };
    assert.equal(prepare(e, policy()).plans[0].recurringMinor, amount);
  }
  for (const amount of [-1, -0, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "123", 1n]) {
    const e = evidence(); e.plans[0].setupMinor = amount; assert.throws(() => prepare(e, policy()), TypeError);
  }
});

test("unsupported price/status/interval/currency evidence cannot pass", () => {
  for (const patch of [
    { label: "https://private.invalid/checkout" }, { label: " Plan " }, { catalogStatus: "trial" }, { amountUnit: "major" },
    { interval: { count: 0, unit: "months" } }, { interval: { count: 1, unit: "one_time" } },
    { currency: { code: "eur", minorUnitExponent: 2, source: "plan-response" } },
    { currency: { code: "EUR", minorUnitExponent: 2, source: "default" } },
    { currency: { code: "EUR", minorUnitExponent: 5, source: "plan-response" } },
  ]) { const e = evidence(); Object.assign(e.plans[0], patch); assert.throws(() => prepare(e, policy()), TypeError); }
});

test("unknown/private/control/customer fields, prototypes, symbols and accessors deny", () => {
  for (const key of ["providerId", "checkoutUrl", "activate", "subscription", "rawPayload", "__proto__"]) {
    const e = evidence(); Object.defineProperty(e.plans[0], key, { value: "synthetic", enumerable: true });
    assert.throws(() => prepare(e, policy()), TypeError);
  }
  for (const mutate of [
    (e) => { e.principal = "synthetic"; }, (e) => { e[Symbol("private")] = true; },
    (e) => { e.plans[0] = Object.create(e.plans[0]); }, (e) => { e.plans = [ , plan()]; },
    (e) => { e.plans.extra = true; }, (e) => { e.plans[Symbol.iterator] = function* () {}; },
  ]) { const e = evidence(); mutate(e); assert.throws(() => prepare(e, policy()), TypeError); }
  let calls = 0; const e = evidence(); Object.defineProperty(e.plans[0], "currency", { get() { calls++; return null; } });
  assert.throws(() => prepare(e, policy()), TypeError); assert.equal(calls, 0);
});

test("no transport, writer, log or clock capability on import or projection", () => {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  let calls = 0; const forbidden = () => { calls++; throw Error("forbidden"); };
  const sandbox = vm.createContext({ module: { exports: {} }, require: forbidden, fetch: forbidden, console: { log: forbidden } });
  vm.runInContext("Date.now = () => { throw Error('clock forbidden'); };", sandbox);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../billing-plan-view-contract.js"), "utf8"), sandbox);
  vm.runInContext(`module.exports.prepareBillingPlanView(${JSON.stringify(evidence())}, ${JSON.stringify(policy())})`, sandbox);
  assert.equal(calls, 0);
});

// Keep the customer read projection covered without changing the shared portal entrypoint.
require("../../billing-customer/test/billing-customer-view-contract.test");

// Add annual comparison coverage without editing the shared portal entrypoint.
require("./annual-management-savings-view-contract.test");
