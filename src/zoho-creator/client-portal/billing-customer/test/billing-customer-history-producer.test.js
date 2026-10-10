"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { produceBillingCustomerHistory: produce } = require("../billing-customer-history-producer");
const OBSERVED = "2026-10-07T12:00:00.000Z";
const UNKNOWN = { state: "unknown", items: null };

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
    policy: { expectedEnvironment: "development", expectedOrganizationId: "synthetic-org",
      asOf: "2026-10-07T12:01:00.000Z", maxAgeMs: 60000,
      featureCode: "synthetic-feature", featurePolicyRevision: "synthetic-revision" },
    limits: { maxPages: 3, pageSize: 2, currencies: [
      { code: "EUR", minorUnitExponent: 2 }, { code: "JPY", minorUnitExponent: 0 }, { code: "KWD", minorUnitExponent: 3 },
    ] },
  };
}
function envelope(state = "available") {
  return { state, environment: "development", organizationId: "synthetic-org", customerId: "synthetic-customer", observedAt: OBSERVED };
}
function customer() {
  return { ...envelope(), customer: { customerId: "synthetic-customer", crmAccountId: "synthetic-crm" } };
}
function subscription(subscriptionId = "synthetic-subscription") {
  return { subscriptionId, organizationId: "synthetic-org", customerId: "synthetic-customer", status: "live",
    planCode: "synthetic-plan", planLabel: "Synthetic Plan", termStart: "2026-10-01",
    termEnd: "2026-10-31", nextBillingOn: "2026-11-01" };
}
function invoice(invoiceId = "synthetic-invoice") {
  return { invoiceId, organizationId: "synthetic-org", customerId: "synthetic-customer", number: "SYN-001", status: "paid",
    issuedOn: "2026-10-01", dueOn: "2026-10-07", money: { total: "123.45", balance: "0.00", unit: "major",
      currency: { code: "EUR", minorUnitExponent: 2, source: "invoice-response" } } };
}
function page(items, nextCursor = null) { return { ...envelope(), items, nextCursor }; }
function scenario() {
  const f = fixture(), calls = [], responses = {
    customer: customer(), subscriptions: page([subscription()]), invoices: page([invoice()]),
  };
  return { f, calls, responses, get: async (request) => {
    calls.push(request);
    const response = responses[request.resource];
    return typeof response === "function" ? response(request) : response;
  } };
}
function run(s = scenario()) { return produce(s.f.input, s.f.trusted, s.f.policy, s.get, s.f.limits); }
function frozen(value) {
  if (value && typeof value === "object") {
    assert.ok(Object.isFrozen(value));
    for (const item of Object.values(value)) frozen(item);
  }
}
function assertUnavailable(result, resource, state = "error") {
  assert.deepEqual(result.view[resource], UNKNOWN);
  assert.equal(result.outcomes[resource].state, state);
}
async function invalidInvoice(mutate) {
  const s = scenario(); mutate(s.responses.invoices.items[0]);
  const result = await run(s);
  assertUnavailable(result, "invoices");
  assert.equal(result.view.subscriptions.state, "available");
}

test("producer projects complete synthetic facts through the history view and keeps optional evidence unknown", async () => {
  const s = scenario(), before = structuredClone({ f: s.f, responses: s.responses });
  const result = await run(s);
  assert.equal(result.view.customerState, "verified");
  assert.deepEqual(result.view.subscriptions.items, [{ status: "live", planLabel: "Synthetic Plan",
    termStart: "2026-10-01", termEnd: "2026-10-31", nextBillingOn: "2026-11-01" }]);
  assert.deepEqual(result.view.invoices.items[0].money, { totalMinor: 12345, balanceMinor: 0, amountUnit: "minor",
    currency: invoice().money.currency });
  for (const resource of ["customer", "subscriptions", "invoices"]) assert.deepEqual(result.outcomes[resource], { state: "complete", reason: null });
  for (const resource of ["payments", "integrations"]) {
    assert.deepEqual(result.view[resource], UNKNOWN);
    assert.deepEqual(result.outcomes[resource], { state: "unknown", reason: "not-requested" });
  }
  assert.deepEqual({ f: s.f, responses: s.responses }, before);
  frozen(result);
  s.responses.invoices.items[0].money.currency.code = "JPY";
  assert.equal(result.view.invoices.items[0].money.currency.code, "EUR");
  for (const id of ["synthetic-principal", "synthetic-contact", "synthetic-account", "synthetic-crm", "synthetic-org",
    "synthetic-customer", "synthetic-subscription", "synthetic-invoice", "synthetic-plan"])
    assert.ok(!JSON.stringify(result).includes(id));
});

test("transport receives only frozen GET selectors pinned to independent policy and binding", async () => {
  const s = scenario(); await run(s);
  assert.deepEqual(s.calls.map((call) => call.resource).sort(), ["customer", "invoices", "subscriptions"]);
  for (const request of s.calls) {
    assert.deepEqual(request, { method: "GET", resource: request.resource, environment: "development",
      organizationId: "synthetic-org", customerId: "synthetic-customer", cursor: null, pageSize: 2 });
    frozen(request);
  }
});

test("invalid company, operation grant, selector or freshness rejects before transport", async () => {
  for (const mutate of [
    (f) => { f.trusted.company.companyMappings.push({ ...f.trusted.company.companyMappings[0] }); },
    (f) => { f.trusted.company.contact.accountId = "other"; },
    (f) => { f.trusted.readGrant.active = false; },
    (f) => { f.trusted.readGrant.operation = "billing.change"; },
    (f) => { f.trusted.readGrant.principalId = "other"; },
    (f) => { f.input.Account = "other"; },
    (f) => { f.input.customerId = "synthetic-customer"; },
    (f) => { f.trusted.billingBinding.organizationId = "other"; },
    (f) => { f.trusted.observedAt = "2026-10-07T11:59:59.999Z"; },
    (f) => { f.policy.expectedEnvironment = "production"; },
  ]) {
    const s = scenario(); mutate(s.f);
    await assert.rejects(run(s), TypeError);
    assert.equal(s.calls.length, 0);
  }
});

test("invalid independent pagination and currency policy rejects before transport", async () => {
  for (const mutate of [
    (limits) => { limits.maxPages = 0; }, (limits) => { limits.pageSize = -1; },
    (limits) => { limits.maxPages = 1.5; }, (limits) => { limits.pageSize = "2"; },
    (limits) => { limits.currencies.push({ code: "EUR", minorUnitExponent: 0 }); },
    (limits) => { limits.currencies[0].minorUnitExponent = 5; },
    (limits) => { limits.currencies[0].code = "eur"; },
    (limits) => { limits.url = "https://synthetic.invalid"; },
  ]) {
    const s = scenario(); mutate(s.f.limits);
    await assert.rejects(run(s), TypeError);
    assert.equal(s.calls.length, 0);
  }
});

test("no independent customer binding performs zero calls and cannot certify empty history", async () => {
  const s = scenario(); s.f.trusted.billingBinding = null;
  const result = await run(s);
  assert.equal(s.calls.length, 0);
  assert.equal(result.view.customerState, "unknown");
  assert.equal(result.outcomes.customer.state, "unknown");
  for (const resource of ["subscriptions", "invoices", "payments", "integrations"]) assertUnavailable(result, resource, "unknown");
});

test("missing, unknown and error customer observations preserve their outcomes and skip collection reads", async () => {
  for (const state of ["missing", "unknown", "error"]) {
    const s = scenario(); s.responses.customer = envelope(state);
    const result = await run(s);
    assert.deepEqual(s.calls.map((call) => call.resource), ["customer"]);
    assert.equal(result.view.customerState, "unknown");
    assert.equal(result.outcomes.customer.state, state);
    for (const resource of ["subscriptions", "invoices"]) assertUnavailable(result, resource, "unknown");
  }
});

test("customer transport failure remains unknown with a sanitized error outcome", async () => {
  const s = scenario(); s.responses.customer = () => { throw Error("synthetic-private-provider-detail"); };
  const result = await run(s);
  assert.equal(s.calls.length, 1);
  assert.equal(result.view.customerState, "unknown");
  assert.deepEqual(result.outcomes.customer, { state: "error", reason: "transport-error" });
  assert.ok(!JSON.stringify(result).includes("synthetic-private-provider-detail"));
});

test("wrong customer envelope ownership, CRM join or freshness prevents all collection reads", async () => {
  for (const mutate of [
    (response) => { response.environment = "production"; },
    (response) => { response.organizationId = "other"; },
    (response) => { response.customerId = "other"; },
    (response) => { response.customer.customerId = "other"; },
    (response) => { response.customer.crmAccountId = "other"; },
    (response) => { response.observedAt = "2026-10-07T11:59:59.999Z"; },
    (response) => { response.observedAt = "2026-10-07T12:01:00.001Z"; },
    (response) => { response.observedAt = "2026-10-07T12:00:00Z"; },
  ]) {
    const s = scenario(); mutate(s.responses.customer);
    const result = await run(s);
    assert.equal(result.outcomes.customer.state, "error");
    assert.equal(result.view.customerState, "unknown");
    assert.equal(s.calls.length, 1);
  }
});

test("complete empty, missing, unknown and error collection observations stay distinct", async () => {
  for (const resource of ["subscriptions", "invoices"]) {
    const s = scenario(); s.responses[resource] = page([]);
    const result = await run(s);
    assert.deepEqual(result.view[resource], { state: "empty", items: [] });
    assert.deepEqual(result.outcomes[resource], { state: "complete", reason: null });
    for (const state of ["missing", "unknown", "error"]) {
      s.responses[resource] = envelope(state);
      assertUnavailable(await run(s), resource, state);
    }
  }
});

test("one failed collection never erases another independently complete collection", async () => {
  for (const resource of ["subscriptions", "invoices"]) {
    const s = scenario(); s.responses[resource] = () => { throw Error("synthetic-private-detail"); };
    const result = await run(s), other = resource === "subscriptions" ? "invoices" : "subscriptions";
    assertUnavailable(result, resource);
    assert.deepEqual(result.outcomes[resource], { state: "error", reason: "transport-error" });
    assert.equal(result.view[other].state, "available");
    assert.equal(result.outcomes[other].state, "complete");
    assert.ok(!JSON.stringify(result).includes("synthetic-private-detail"));
  }
});

test("each collection follows explicit cursors to a terminal page without selecting a primary record", async () => {
  const s = scenario();
  for (const [resource, make] of [["subscriptions", subscription], ["invoices", invoice]]) {
    s.responses[resource] = ({ cursor }) => cursor === null
      ? page([make("synthetic-first-" + resource)], "synthetic-next-" + resource)
      : page([make("synthetic-second-" + resource)]);
  }
  const result = await run(s);
  for (const resource of ["subscriptions", "invoices"]) {
    assert.equal(result.view[resource].items.length, 2);
    assert.equal(result.outcomes[resource].state, "complete");
    assert.deepEqual(s.calls.filter((call) => call.resource === resource).map((call) => call.cursor),
      [null, "synthetic-next-" + resource]);
  }
});

test("duplicate item identities on one or later pages discard the entire affected collection", async () => {
  for (const [resource, make] of [["subscriptions", subscription], ["invoices", invoice]]) {
    for (const crossPage of [false, true]) {
      const s = scenario();
      s.responses[resource] = crossPage
        ? ({ cursor }) => page([make()], cursor === null ? "synthetic-next" : null)
        : page([make(), make()]);
      const result = await run(s);
      assertUnavailable(result, resource);
      assert.ok(s.calls.filter((call) => call.resource === resource).length <= 2);
    }
  }
});

test("repeated cursor cycles terminate and page limits never certify partial history", async () => {
  const repeated = scenario();
  repeated.responses.invoices = ({ cursor }) => page([invoice(cursor === null ? "synthetic-first" : "synthetic-second")], "synthetic-next");
  assertUnavailable(await run(repeated), "invoices");
  assert.equal(repeated.calls.filter((call) => call.resource === "invoices").length, 2);
  const capped = scenario(); capped.f.limits.maxPages = 2;
  let pages = 0;
  capped.responses.invoices = () => page([invoice("synthetic-invoice-" + ++pages)], "synthetic-cursor-" + pages);
  const result = await run(capped);
  assertUnavailable(result, "invoices");
  assert.equal(pages, 2);
  assert.equal(result.view.subscriptions.state, "available");
});

test("a later unavailable page discards partial items instead of fabricating complete history", async () => {
  for (const state of ["missing", "unknown", "error"]) {
    const s = scenario(); s.responses.invoices = ({ cursor }) => cursor === null
      ? page([invoice()], "synthetic-next") : envelope(state);
    const result = await run(s);
    assert.deepEqual(result.view.invoices, UNKNOWN);
    assert.notEqual(result.outcomes.invoices.state, "complete");
    assert.equal(result.view.subscriptions.state, "available");
  }
});

test("every page and every item must match the pinned organization and customer", async () => {
  for (const resource of ["subscriptions", "invoices"]) {
    for (const mutate of [
      (response) => { response.environment = "production"; },
      (response) => { response.organizationId = "other"; },
      (response) => { response.customerId = "other"; },
      (response) => { response.items[0].organizationId = "other"; },
      (response) => { response.items[0].customerId = "other"; },
      (response) => { delete response.items[0].organizationId; },
      (response) => { response.observedAt = "2026-10-07T11:59:59.999Z"; },
    ]) {
      const s = scenario(); mutate(s.responses[resource]);
      assertUnavailable(await run(s), resource);
    }
  }
});

test("malformed pagination, overfull pages and ambiguous response shapes cannot certify completeness", async () => {
  for (const mutate of [
    (response) => { delete response.nextCursor; },
    (response) => { response.nextCursor = ""; },
    (response) => { response.nextCursor = 1; },
    (response) => { response.items = [invoice("synthetic-one"), invoice("synthetic-two"), invoice("synthetic-three")]; },
    (response) => { response.items = [ , invoice()]; },
    (response) => { response.items.extra = true; },
    (response) => { response.rawPayload = "synthetic-private-detail"; },
    (response) => { response.items[0].downloadUrl = "https://synthetic.invalid"; },
    (response) => { response[Symbol("extra")] = true; },
  ]) {
    const s = scenario(); mutate(s.responses.invoices);
    assertUnavailable(await run(s), "invoices");
  }
});

test("missing statuses and nullable dates remain unknown without inferring the next bill date", async () => {
  const s = scenario(), sub = s.responses.subscriptions.items[0], inv = s.responses.invoices.items[0];
  delete sub.status; delete sub.termStart; delete sub.nextBillingOn;
  delete inv.status; delete inv.issuedOn; delete inv.dueOn;
  const result = await run(s);
  assert.deepEqual(result.view.subscriptions.items[0], { status: "unknown", planLabel: "Synthetic Plan",
    termStart: null, termEnd: "2026-10-31", nextBillingOn: null });
  assert.equal(result.view.invoices.items[0].status, "unknown");
  assert.equal(result.view.invoices.items[0].issuedOn, null);
  assert.equal(result.view.invoices.items[0].dueOn, null);
  const invalid = scenario(); invalid.responses.subscriptions.items[0].status = "paid";
  assertUnavailable(await run(invalid), "subscriptions");
  await invalidInvoice((item) => { item.status = "approved"; });
});

test("major decimals normalize losslessly for independently qualified currency exponents", async () => {
  const maximum = String(Number.MAX_SAFE_INTEGER), overflow = String(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
  const maximumMajor = maximum.slice(0, -2) + "." + maximum.slice(-2);
  const overflowMajor = overflow.slice(0, -2) + "." + overflow.slice(-2);
  for (const [code, exponent, amount, expected] of [
    ["EUR", 2, "0", 0], ["EUR", 2, "1.2", 120], ["EUR", 2, "1.2300", 123],
    ["JPY", 0, "123.000", 123], ["KWD", 3, "1.2340", 1234],
    ["EUR", 2, maximumMajor, Number.MAX_SAFE_INTEGER],
  ]) {
    const s = scenario(), money = s.responses.invoices.items[0].money;
    money.total = amount; money.balance = null;
    money.currency = { code, minorUnitExponent: exponent, source: "verified-invoice-metadata" };
    const projected = (await run(s)).view.invoices.items[0].money;
    assert.equal(projected.totalMinor, expected);
    assert.equal(projected.balanceMinor, null);
    assert.equal(projected.currency.code, code);
  }
  for (const amount of [123.45, -0, "-0", "01.00", "+1", " 1", "1e2", ".1", "1.", "1.001", overflowMajor])
    await invalidInvoice((item) => { item.money.total = amount; });
});

test("minor values accept only exact nonnegative safe integers and canonical integer strings", async () => {
  for (const amount of [0, 12345, "0", "12345", Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)]) {
    const s = scenario(), money = s.responses.invoices.items[0].money;
    money.unit = "minor"; money.total = amount; money.balance = 0;
    assert.equal((await run(s)).view.invoices.items[0].money.totalMinor, Number(amount));
  }
  const overflow = String(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
  for (const amount of [-1, -0, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, overflow, "01", "1.0", "1e2", "-0", ""])
    await invalidInvoice((item) => { item.money.unit = "minor"; item.money.balance = 0; item.money.total = amount; });
});

test("missing amounts and money stay unknown while absent currency never defaults to a currency or zero", async () => {
  for (const mutate of [
    (item) => { delete item.money; }, (item) => { item.money = null; },
    (item) => { item.money.currency = null; },
  ]) {
    const s = scenario(); mutate(s.responses.invoices.items[0]);
    assert.deepEqual((await run(s)).view.invoices.items[0].money,
      { totalMinor: null, balanceMinor: null, amountUnit: null, currency: null });
  }
  const s = scenario(); delete s.responses.invoices.items[0].money.total;
  const projected = (await run(s)).view.invoices.items[0].money;
  assert.equal(projected.totalMinor, null);
  assert.equal(projected.balanceMinor, 0);
  for (const field of ["unit", "currency"]) await invalidInvoice((item) => { delete item.money[field]; });
  await invalidInvoice((item) => { item.money.unit = null; });
});

test("invoice currency must match independent qualification and resource-specific provenance", async () => {
  for (const patch of [
    { code: "USD" }, { code: "eur" }, { minorUnitExponent: 0 }, { minorUnitExponent: 5 },
    { source: "default" }, { source: "payment-response" }, { approved: true },
  ]) await invalidInvoice((item) => { Object.assign(item.money.currency, patch); });
  const s = scenario(), currency = s.responses.invoices.items[0].money.currency;
  for (const key of ["code", "minorUnitExponent", "source"]) Object.defineProperty(currency, key, { enumerable: false });
  assert.deepEqual((await run(s)).view.invoices.items[0].money.currency,
    { code: "EUR", minorUnitExponent: 2, source: "invoice-response" });
});

test("trusted and provider accessors are rejected without executing them", async () => {
  let reads = 0;
  const trusted = scenario();
  Object.defineProperty(trusted.f.trusted.readGrant, "active", { get() { reads++; return true; } });
  await assert.rejects(run(trusted), TypeError);
  assert.equal(trusted.calls.length, 0);
  for (const mutate of [
    (response) => { Object.defineProperty(response, "items", { get() { reads++; return []; } }); },
    (response) => { Object.defineProperty(response.items, "0", { get() { reads++; return invoice(); } }); },
    (response) => { Object.defineProperty(response.items[0].money.currency, "code", { get() { reads++; return "EUR"; } }); },
  ]) {
    const s = scenario(); mutate(s.responses.invoices);
    assertUnavailable(await run(s), "invoices");
  }
  for (const field of ["customerId", "crmAccountId"]) {
    const s = scenario(), malformed = {};
    Object.defineProperty(malformed, "value", { get() { reads++; return "synthetic-other"; } });
    s.responses.customer.customer[field] = malformed;
    const result = await run(s);
    assert.equal(result.view.customerState, "unknown");
    assert.equal(result.outcomes.customer.state, "error");
    assert.equal(s.calls.length, 1);
  }
  assert.equal(reads, 0);
});

test("preflight snapshots prevent in-flight mutation from changing authority, scope or currency qualification", async () => {
  const s = scenario();
  s.responses.customer = async () => {
    s.f.input.Account = "other";
    s.f.trusted.readGrant.active = false;
    s.f.trusted.billingBinding.customerId = "other";
    s.f.trusted.company.contact.accountId = "other";
    s.f.policy.expectedOrganizationId = "other";
    s.f.limits.currencies[0].minorUnitExponent = 0;
    s.f.limits.pageSize = 1;
    return customer();
  };
  const result = await run(s);
  assert.equal(result.view.customerState, "verified");
  assert.equal(result.view.invoices.items[0].money.totalMinor, 12345);
  for (const request of s.calls) {
    assert.equal(request.organizationId, "synthetic-org");
    assert.equal(request.customerId, "synthetic-customer");
    assert.equal(request.pageSize, 2);
  }
});

test("provider evidence is detached before another async turn can replace ownership, state or items", async () => {
  let reads = 0;
  for (const mutate of [
    (response) => { response.state = "missing"; response.organizationId = "other"; response.items = []; },
    (response) => { Object.defineProperty(response, "items", { get() { reads++; return []; } }); },
  ]) {
    const s = scenario(), response = s.responses.invoices;
    s.responses.invoices = () => {
      queueMicrotask(() => queueMicrotask(() => mutate(response)));
      return response;
    };
    const result = await run(s);
    assert.notEqual(result.view.invoices.state, "empty");
    if (result.outcomes.invoices.state === "complete") {
      assert.equal(result.view.invoices.items.length, 1);
      assert.equal(result.view.invoices.items[0].money.totalMinor, 12345);
    } else assertUnavailable(result, "invoices");
  }
  const s = scenario(), response = s.responses.customer;
  s.responses.customer = () => {
    queueMicrotask(() => queueMicrotask(() => {
      response.state = "missing";
      response.organizationId = "other";
      Object.defineProperty(response, "customer", { get() { reads++; return customer().customer; } });
    }));
    return response;
  };
  const result = await run(s);
  assert.ok(["complete", "error"].includes(result.outcomes.customer.state));
  assert.equal(reads, 0);
});

test("the producer has only its injected GET capability and no implicit network, writer, logging or clock", async () => {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  let calls = 0;
  const forbidden = () => { calls++; throw Error("forbidden"); };
  const sandbox = vm.createContext({ module: { exports: {} }, fetch: forbidden, XMLHttpRequest: forbidden,
    console: { log: forbidden, error: forbidden }, setTimeout: forbidden, setInterval: forbidden });
  vm.runInContext("Date.now = () => { throw Error('clock forbidden'); };", sandbox);
  const shared = fs.readFileSync(path.resolve(__dirname, "../../company-settings-requests/service-area-request-contract.js"), "utf8");
  vm.runInContext("(function () { " + shared + "\n})()", sandbox);
  const helper = sandbox.module.exports;
  sandbox.module = { exports: {} };
  sandbox.require = (name) => name === "../company-settings-requests/service-area-request-contract" ? helper : forbidden();
  const view = fs.readFileSync(path.resolve(__dirname, "../billing-customer-view-contract.js"), "utf8");
  vm.runInContext("(function () { " + view + "\n})()", sandbox);
  const model = sandbox.module.exports;
  sandbox.module = { exports: {} };
  sandbox.require = (name) => name === "./billing-customer-view-contract" ? model : forbidden();
  const producer = fs.readFileSync(path.resolve(__dirname, "../billing-customer-history-producer.js"), "utf8");
  vm.runInContext("(function () { " + producer + "\n})()", sandbox);
  const s = scenario();
  const result = await vm.runInContext("(async function () { const f = " + JSON.stringify(s.f) +
    "; const responses = " + JSON.stringify(s.responses) + "; return module.exports.produceBillingCustomerHistory(" +
    "f.input, f.trusted, f.policy, async (request) => responses[request.resource], f.limits); })()", sandbox);
  assert.equal(result.view.invoices.items[0].money.totalMinor, 12345);
  assert.equal(calls, 0);
});
