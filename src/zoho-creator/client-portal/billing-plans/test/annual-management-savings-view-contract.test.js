"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareAnnualManagementSavingsView: prepare } = require("../annual-management-savings-view-contract");
const policy = () => ({ expectedEnvironment: "development", asOf: "2026-10-07T12:01:00.000Z", maxAgeMs: 60000 });
const plan = (annual = false) => ({
  label: annual ? "Synthetic Annual" : "Synthetic Monthly", catalogStatus: "active",
  recurringMinor: annual ? 2640 : 250, setupMinor: 678, amountUnit: "minor",
  interval: { count: 1, unit: annual ? "years" : "months" },
  currency: { code: "EUR", minorUnitExponent: 2, source: "plan-response" },
});
const evidence = () => ({
  environment: "development", observedAt: "2026-10-07T12:00:00.000Z", complete: true,
  pairing: { monthlyPlanId: "synthetic-monthly", annualPlanId: "synthetic-annual",
    equivalent: true, scope: "management-fee-only" },
  monthly: { planId: "synthetic-monthly", plan: plan() },
  annual: { planId: "synthetic-annual", plan: plan(true) },
});
const expected = () => ({
  environment: "development", observedAt: "2026-10-07T12:00:00.000Z",
  comparison: {
    monthlyLabel: "Synthetic Monthly", annualLabel: "Synthetic Annual",
    monthlyAnnualizedMinor: 3000, annualRecurringMinor: 2640, savingsMinor: 360,
    amountUnit: "minor", currency: { code: "EUR", minorUnitExponent: 2 },
    basisMonths: 12, scope: "management-fee-only",
    savingsPercentHundredths: 1200, percentageRounding: "floor",
  },
});

test("annual savings: exact frozen display facts with no identities, permissions or input mutation", () => {
  const e = evidence(), p = policy(), before = structuredClone({ e, p });
  const result = prepare(e, p);
  assert.deepEqual(result, expected());
  assert.deepEqual({ e, p }, before);
  for (const value of [result, result.comparison, result.comparison.currency]) assert.ok(Object.isFrozen(value));
  e.monthly.plan.currency.code = "JPY"; e.annual.plan.recurringMinor = 1;
  assert.deepEqual(result, expected());
  assert.equal(JSON.stringify(result).includes("synthetic-monthly"), false);
  assert.equal(JSON.stringify(result).includes("synthetic-annual"), false);
});

test("annual savings: explicit row IDs bind the pair; labels never establish equivalence", () => {
  for (const mutate of [
    (e) => { e.monthly.planId = "other-tier"; },
    (e) => { e.annual.planId = "other-tier"; },
    (e) => { e.pairing.monthlyPlanId = "other-tier"; },
    (e) => { e.pairing.annualPlanId = "other-tier"; },
    (e) => { e.annual.planId = e.pairing.annualPlanId = e.monthly.planId; },
    (e) => { [e.monthly, e.annual] = [e.annual, e.monthly]; },
    (e) => { e.pairing.equivalent = false; },
    (e) => { e.pairing.equivalent = null; },
    (e) => { e.pairing.scope = null; },
    (e) => { e.pairing = null; },
  ]) {
    const e = evidence(); e.monthly.plan.label = e.annual.plan.label = "Synthetic Same";
    mutate(e); assert.equal(prepare(e, policy()).comparison, null);
  }
  const e = evidence(); e.monthly.plan.label = "Unrelated Display A"; e.annual.plan.label = "Unrelated Display B";
  assert.equal(prepare(e, policy()).comparison.savingsMinor, 360);
});

test("annual savings: missing rows and unknown money suppress comparison", () => {
  for (const role of ["monthly", "annual"]) {
    for (const mutate of [
      (e) => { e[role] = null; },
      (e) => { e[role].plan.currency = null; },
      (e) => { e[role].plan.recurringMinor = null; },
      (e) => { Object.assign(e[role].plan, { recurringMinor: null, setupMinor: null, amountUnit: null }); },
    ]) { const e = evidence(); mutate(e); assert.equal(prepare(e, policy()).comparison, null); }
  }
  const e = evidence(); e.monthly = e.annual = e.pairing = null;
  assert.deepEqual(prepare(e, policy()), { environment: e.environment, observedAt: e.observedAt, comparison: null });
});

test("annual savings: only active one-month and one-year rows qualify", () => {
  for (const role of ["monthly", "annual"]) {
    for (const status of ["inactive", "unavailable"]) {
      const e = evidence(); e[role].plan.catalogStatus = status;
      assert.equal(prepare(e, policy()).comparison, null);
    }
    for (const interval of [null, { count: 2, unit: "months" }, { count: 12, unit: "months" }, { count: 2, unit: "years" }]) {
      const e = evidence(); e[role].plan.interval = interval;
      assert.equal(prepare(e, policy()).comparison, null);
    }
  }
  const e = evidence(); e.monthly.plan.interval.unit = "years"; e.annual.plan.interval.unit = "months";
  assert.equal(prepare(e, policy()).comparison, null);
});

test("annual savings: currency and exponent must agree, with verified source syntax", () => {
  const mismatch = evidence(); mismatch.annual.plan.currency.code = "GBP";
  assert.equal(prepare(mismatch, policy()).comparison, null);
  const exponent = evidence(); exponent.annual.plan.currency.minorUnitExponent = 0;
  assert.throws(() => prepare(exponent, policy()), TypeError);
  for (const role of ["monthly", "annual"]) {
    for (const patch of [
      { source: "assumed" }, { code: "eur" }, { minorUnitExponent: 5 }, { minorUnitExponent: "2" },
    ]) {
      const e = evidence(); Object.assign(e[role].plan.currency, patch);
      assert.throws(() => prepare(e, policy()), TypeError);
    }
  }
  for (const [code, minorUnitExponent] of [["JPY", 0], ["EUR", 2], ["BHD", 3]]) {
    const e = evidence();
    for (const role of ["monthly", "annual"]) e[role].plan.currency = { code, minorUnitExponent, source: "verified-catalog-metadata" };
    e.monthly.plan.currency.source = "plan-response";
    assert.deepEqual(prepare(e, policy()).comparison.currency, { code, minorUnitExponent });
    assert.equal(prepare(e, policy()).comparison.savingsMinor, 360);
  }
});

test("annual savings: no constants, exact and conservatively rounded percentages", () => {
  for (const [monthly, annual, percent] of [[100, 1080, 1000], [100, 900, 2500], [1, 8, 3333], [1, 11, 833], [10000, 119999, 0]]) {
    const e = evidence(); e.monthly.plan.recurringMinor = monthly; e.annual.plan.recurringMinor = annual;
    const c = prepare(e, policy()).comparison;
    assert.equal(c.savingsPercentHundredths, percent);
    assert.equal(c.monthlyAnnualizedMinor, monthly * 12);
    assert.equal(c.savingsMinor, monthly * 12 - annual);
  }
});

test("annual savings: safe integer boundary and large exact percentage numerator", () => {
  const e = evidence(), maximumMonthly = Math.floor(Number.MAX_SAFE_INTEGER / 12);
  e.monthly.plan.recurringMinor = maximumMonthly; e.annual.plan.recurringMinor = 1;
  assert.equal(prepare(e, policy()).comparison.monthlyAnnualizedMinor, Number.MAX_SAFE_INTEGER - 7);
  assert.equal(prepare(e, policy()).comparison.savingsMinor, Number.MAX_SAFE_INTEGER - 8);
  assert.equal(prepare(e, policy()).comparison.savingsPercentHundredths, 9999);
  // True ratio is just below 50%; floating multiplication/division can round up.
  e.annual.plan.recurringMinor = (Number.MAX_SAFE_INTEGER - 5) / 2;
  assert.equal(prepare(e, policy()).comparison.savingsPercentHundredths, 4999);
  for (const amount of [maximumMonthly + 1, Number.MAX_SAFE_INTEGER]) {
    e.monthly.plan.recurringMinor = amount; assert.equal(prepare(e, policy()).comparison, null);
  }
});

test("annual savings: zero or nonpositive savings are unavailable", () => {
  for (const [monthly, annual] of [[0, 0], [0, 1], [1, 0], [250, 3000], [250, 3001], [1, Number.MAX_SAFE_INTEGER]]) {
    const e = evidence(); e.monthly.plan.recurringMinor = monthly; e.annual.plan.recurringMinor = annual;
    assert.equal(prepare(e, policy()).comparison, null);
  }
});

test("annual savings: unsafe, coerced and negative amounts deny", () => {
  for (const role of ["monthly", "annual"]) {
    for (const field of ["recurringMinor", "setupMinor"]) {
      for (const amount of [-1, -0, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "250", 1n]) {
        const e = evidence(); e[role].plan[field] = amount;
        assert.throws(() => prepare(e, policy()), TypeError);
      }
    }
  }
});

test("annual savings: setup never changes savings; usage and controls cannot enter evidence", () => {
  for (const monthlySetup of [null, 0, Number.MAX_SAFE_INTEGER]) {
    for (const annualSetup of [null, 0, Number.MAX_SAFE_INTEGER]) {
      const e = evidence(); e.monthly.plan.setupMinor = monthlySetup; e.annual.plan.setupMinor = annualSetup;
      assert.deepEqual(prepare(e, policy()), expected());
    }
  }
  for (const key of ["usage", "usageMinor", "setupSavingsMinor", "canUpgrade", "canChangePlan", "quote", "checkoutUrl", "show_in_portal"]) {
    for (const target of [(e) => e, (e) => e.pairing, (e) => e.monthly.plan, (e) => e.annual.plan]) {
      const e = evidence(); target(e)[key] = "synthetic";
      assert.throws(() => prepare(e, policy()), TypeError);
    }
  }
});

test("annual savings: stale, future, incomplete and wrong-environment snapshot denies even without pairing", () => {
  for (const pairingMissing of [false, true]) {
    for (const patch of [
      { environment: "production" }, { complete: false },
      { observedAt: "2026-10-07T11:59:59.999Z" }, { observedAt: "2026-10-07T12:01:00.001Z" },
      { observedAt: "2026-02-30T12:00:00.000Z" }, { observedAt: "2026-10-07T12:00:00Z" },
    ]) {
      const e = Object.assign(evidence(), patch); if (pairingMissing) e.pairing = null;
      assert.throws(() => prepare(e, policy()), TypeError);
    }
  }
  for (const p of [null, { ...policy(), maxAgeMs: -1 }, { ...policy(), asOf: "now" }, { ...policy(), expectedEnvironment: "unknown" }]) {
    assert.throws(() => prepare(evidence(), p), TypeError);
  }
  const p = policy(); p.asOf = evidence().observedAt; p.maxAgeMs = 0;
  assert.deepEqual(prepare(evidence(), p), expected());
});

test("annual savings: strict ordinary object shapes reject missing, extra, inherited and symbol data", () => {
  const targets = [
    (e, p) => [e, "pairing"], (e) => [e.pairing, "monthlyPlanId"],
    (e) => [e.monthly, "planId"], (e) => [e.annual, "plan"],
    (e) => [e.monthly.plan, "recurringMinor"], (e) => [e.annual.plan.interval, "count"],
    (e) => [e.monthly.plan.currency, "code"], (e, p) => [p, "asOf"],
  ];
  for (const target of targets) {
    for (const mutate of [
      (object, key) => { delete object[key]; },
      (object) => { object[Symbol("hidden")] = true; },
      (object) => { Object.defineProperty(object, "extra", { value: true }); },
      (object) => { Object.setPrototypeOf(object, { inherited: true }); },
    ]) {
      const e = evidence(), p = policy(), [object, key] = target(e, p); mutate(object, key);
      assert.throws(() => prepare(e, p), TypeError);
    }
    let calls = 0; const e = evidence(), p = policy(), [object, key] = target(e, p);
    Object.defineProperty(object, key, { get() { calls++; throw Error("getter executed"); } });
    assert.throws(() => prepare(e, p), TypeError); assert.equal(calls, 0);
  }
  for (const value of [undefined, [], 1, "value", new Date(), new Map()]) assert.throws(() => prepare(value, policy()), TypeError);
  for (const patch of [{ equivalent: "true" }, { scope: "total-bill" }, { monthlyPlanId: "" }, { annualPlanId: " bad " }]) {
    const e = evidence(); Object.assign(e.pairing, patch); assert.throws(() => prepare(e, policy()), TypeError);
  }
});

test("annual savings: null prototypes, nonenumerable data and frozen records preserve facts", () => {
  const e = evidence(), p = policy();
  const objects = [e, e.pairing, e.monthly, e.annual, e.monthly.plan, e.annual.plan,
    e.monthly.plan.interval, e.annual.plan.interval, e.monthly.plan.currency, e.annual.plan.currency, p];
  for (const object of objects) {
    Object.setPrototypeOf(object, null);
    for (const key of Object.keys(object)) Object.defineProperty(object, key, { enumerable: false });
    Object.freeze(object);
  }
  assert.deepEqual(prepare(e, p), expected());
});

test("annual savings: old catalog and customer/history exports remain unchanged", () => {
  const catalog = require("../billing-plan-view-contract");
  const customer = require("../../billing-customer/billing-customer-view-contract");
  assert.deepEqual(Object.keys(catalog), ["prepareBillingPlanView"]);
  assert.deepEqual(Object.keys(customer), ["prepareBillingCustomerView", "prepareBillingCustomerHistoryView"]);
  assert.equal(catalog.prepareBillingPlanView.length, 2);
  assert.equal(customer.prepareBillingCustomerView.length, 4); assert.equal(customer.prepareBillingCustomerHistoryView.length, 4);
  const e = evidence(), rows = [e.monthly.plan, e.annual.plan];
  assert.deepEqual(catalog.prepareBillingPlanView({
    environment: e.environment, observedAt: e.observedAt, complete: true, plans: rows,
  }, policy()), {
    environment: e.environment, observedAt: e.observedAt, catalogStatus: "available", plans: rows,
    customer: { subscription: null, entitlement: null, termStart: null, termEnd: null, usage: null },
  });
});

test("annual savings: import and projection have no transport, writer, log or clock capability", () => {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  let calls = 0; const forbidden = () => { calls++; throw Error("forbidden"); };
  const sandbox = vm.createContext({ module: { exports: {} }, fetch: forbidden, console: { log: forbidden } });
  vm.runInContext("Date.now = () => { throw Error('clock forbidden'); };", sandbox);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../billing-plan-view-contract.js"), "utf8"), sandbox);
  const catalog = sandbox.module.exports; sandbox.module = { exports: {} };
  sandbox.require = (name) => { if (name === "./billing-plan-view-contract") return catalog; return forbidden(); };
  vm.runInContext("(function() {" + fs.readFileSync(path.resolve(__dirname, "../annual-management-savings-view-contract.js"), "utf8") + "\n})()", sandbox);
  vm.runInContext("module.exports.prepareAnnualManagementSavingsView(" + JSON.stringify(evidence()) + "," + JSON.stringify(policy()) + ")", sandbox);
  assert.equal(calls, 0);
});
