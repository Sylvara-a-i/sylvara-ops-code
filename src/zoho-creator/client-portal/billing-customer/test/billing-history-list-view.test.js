"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareBillingHistoryListView } = require("../billing-history-list-view");
const { prepareBillingCustomerHistoryView, BILLING_HISTORY_STATUSES } = require("../billing-customer-view-contract");

function fixture() {
  const observedAt = "2026-10-07T12:00:00.000Z";
  const customerId = "synthetic-customer";
  return {
    input: { Account: "synthetic-account" },
    trusted: {
      environment: "development", organizationId: "synthetic-org", observedAt, complete: true,
      company: {
        principalId: "synthetic-principal", contact: { id: "synthetic-contact", accountId: "synthetic-crm" },
        companyMappings: [{ creatorAccountId: "synthetic-account", crmAccountId: "synthetic-crm", active: true }],
        auditActorId: "synthetic-actor",
      },
      readGrant: { principalId: "synthetic-principal", creatorAccountId: "synthetic-account", operation: "billing.read", active: true },
      billingBinding: { creatorAccountId: "synthetic-account", crmAccountId: "synthetic-crm", organizationId: "synthetic-org", customerId },
    },
    evidence: {
      environment: "development", organizationId: "synthetic-org", observedAt, complete: true,
      customer: { customerId, crmAccountId: "synthetic-crm" }, subscriptions: null, integrations: null,
      invoices: { complete: true, items: BILLING_HISTORY_STATUSES.invoice.map((status, index) => ({
        invoiceId: `synthetic-invoice-${index}`, customerId, number: `INV-${index}`, status,
        issuedOn: "2026-10-01", dueOn: null,
        money: { totalMinor: 12345, balanceMinor: 0, amountUnit: "minor",
          currency: { code: "EUR", minorUnitExponent: 2, source: "invoice-response" } },
      })) },
      payments: { complete: true, items: BILLING_HISTORY_STATUSES.payment.map((status, index) => ({
        paymentId: `synthetic-payment-${index}`, customerId, number: `PAY-${index}`, status,
        recordedOn: "2026-10-02", mode: "creditcard",
        money: { amountMinor: 12345, amountUnit: "minor",
          currency: { code: "EUR", minorUnitExponent: 2, source: "payment-response" } },
      })) },
    },
    policy: { expectedEnvironment: "development", expectedOrganizationId: "synthetic-org",
      asOf: "2026-10-07T12:01:00.000Z", maxAgeMs: 60000,
      featureCode: "synthetic-feature", featurePolicyRevision: "synthetic-revision" },
  };
}

function run(f, filters) {
  return prepareBillingHistoryListView(f.input, f.trusted, f.evidence, f.policy, filters);
}

test("history list defaults to all sanitized rows in source order without changing the history API", () => {
  const f = fixture();
  const history = prepareBillingCustomerHistoryView(f.input, f.trusted, f.evidence, f.policy);
  const list = run(f);
  assert.deepEqual(Object.keys(history.invoices), ["state", "items"]);
  assert.deepEqual(Object.keys(history.payments), ["state", "items"]);
  for (const key of ["environment", "observedAt", "customerState", "subscriptions", "integrations"]) {
    assert.deepEqual(list[key], history[key]);
  }
  for (const key of ["invoices", "payments"]) {
    assert.equal(list[key].sourceState, "available");
    assert.equal(list[key].state, "available");
    assert.equal(list[key].statusFilter, "all");
    assert.deepEqual(list[key].items, history[key].items);
  }
  assert.deepEqual(run(f, { invoiceStatus: "all", paymentStatus: "all" }), list);
  assert.equal(JSON.stringify(list).includes("synthetic-"), false);
});

test("history list independently selects every existing invoice and payment status", () => {
  for (const invoiceStatus of BILLING_HISTORY_STATUSES.invoice) {
    for (const paymentStatus of BILLING_HISTORY_STATUSES.payment) {
      const list = run(fixture(), { invoiceStatus, paymentStatus });
      assert.deepEqual(list.invoices.items.map((item) => item.status), [invoiceStatus]);
      assert.deepEqual(list.payments.items.map((item) => item.status), [paymentStatus]);
      assert.equal(list.invoices.state, "available");
      assert.equal(list.payments.state, "available");
    }
  }
  const list = run(fixture(), { invoiceStatus: "all", paymentStatus: "failure" });
  assert.equal(list.invoices.items.length, BILLING_HISTORY_STATUSES.invoice.length);
  assert.equal(list.payments.items[0].status, "failure");
});

test("history list distinguishes unavailable, certified empty, and no matching rows", () => {
  for (const key of ["invoices", "payments"]) {
    const f = fixture();
    const filters = { invoiceStatus: "paid", paymentStatus: "success" };
    f.evidence[key] = null;
    assert.deepEqual(run(f, filters)[key], {
      sourceState: "unknown", state: "unknown", statusFilter: key === "invoices" ? "paid" : "success", items: null,
    });
    f.evidence[key] = { complete: true, items: [] };
    assert.equal(run(f, filters)[key].state, "empty");
    assert.equal(run(f, filters)[key].sourceState, "empty");
    assert.deepEqual(run(f, filters)[key].items, []);
    f.evidence[key].items = fixture().evidence[key].items.filter((item) => item.status === "unknown");
    const selected = run(f, filters)[key];
    assert.equal(selected.state, "no_matches");
    assert.equal(selected.sourceState, "available");
    assert.deepEqual(selected.items, []);
    assert.equal(run(f)[key].state, "available");
  }
  const f = fixture();
  f.trusted.billingBinding = null;
  f.evidence.customer = null;
  f.evidence.invoices = null;
  f.evidence.payments = null;
  const list = run(f, { invoiceStatus: "paid", paymentStatus: "success" });
  assert.equal(list.customerState, "unknown");
  assert.equal(list.invoices.state, "unknown");
  assert.equal(list.payments.state, "unknown");
});

test("history list validates excluded rows and all existing authority checks before selection", () => {
  const mutations = [
    (f) => { f.evidence.invoices.items[0].customerId = "synthetic-other"; },
    (f) => { f.evidence.payments.items[1].customerId = "synthetic-other"; },
    (f) => { f.evidence.invoices.items[0].status = "unsupported"; },
    (f) => { f.evidence.payments.items[1].money.amountMinor = -1; },
    (f) => { f.evidence.invoices.items.push(structuredClone(f.evidence.invoices.items[0])); },
    (f) => { f.evidence.payments.items.push(structuredClone(f.evidence.payments.items[1])); },
    (f) => { f.evidence.invoices.complete = false; },
    (f) => { f.trusted.readGrant.active = false; },
    (f) => { f.input.Account = "synthetic-other"; },
    (f) => { f.evidence.observedAt = "2026-10-07T11:59:59.000Z"; },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.throws(() => run(f, { invoiceStatus: "paid", paymentStatus: "success" }), TypeError);
  }
});

test("history list rejects malformed filters without invoking accessors or coercion", () => {
  let reads = 0;
  const getter = { paymentStatus: "all" };
  Object.defineProperty(getter, "invoiceStatus", { get() { reads++; return "paid"; } });
  const coercible = { toString() { reads++; return "paid"; } };
  const filters = [null, [], "paid", {}, { invoiceStatus: "all" },
    { invoiceStatus: "Paid", paymentStatus: "all" }, { invoiceStatus: "all", paymentStatus: "paid" },
    { invoiceStatus: "all", paymentStatus: "all", extra: true },
    { invoiceStatus: "all", paymentStatus: "all", [Symbol("extra")]: true },
    Object.create({ invoiceStatus: "all", paymentStatus: "all" }), getter,
    { invoiceStatus: coercible, paymentStatus: "all" }];
  for (const filter of filters) assert.throws(() => run(fixture(), filter), /Invalid billing history filters/);
  assert.equal(reads, 0);
  const plain = Object.create(null);
  Object.defineProperties(plain, {
    invoiceStatus: { value: "paid" }, paymentStatus: { value: "success" },
  });
  assert.equal(run(fixture(), plain).invoices.items[0].status, "paid");
});

test("history list and status catalog are immutable detached snapshots", () => {
  const f = fixture();
  const before = structuredClone(f);
  const filters = { invoiceStatus: "paid", paymentStatus: "success" };
  const list = run(f, filters);
  assert.deepEqual(f, before);
  f.evidence.invoices.items[2].number = "CHANGED";
  f.evidence.payments.items[0].money.currency.code = "USD";
  filters.invoiceStatus = "all";
  assert.equal(list.invoices.items[0].number, "INV-2");
  assert.equal(list.payments.items[0].money.currency.code, "EUR");
  assert.equal(list.invoices.statusFilter, "paid");
  function frozen(value) {
    if (value && typeof value === "object") {
      assert.equal(Object.isFrozen(value), true);
      for (const item of Object.values(value)) frozen(item);
    }
  }
  frozen(list);
  frozen(BILLING_HISTORY_STATUSES);
  assert.throws(() => list.invoices.items.push({}), TypeError);
  assert.throws(() => BILLING_HISTORY_STATUSES.invoice.push("custom"), TypeError);
});
