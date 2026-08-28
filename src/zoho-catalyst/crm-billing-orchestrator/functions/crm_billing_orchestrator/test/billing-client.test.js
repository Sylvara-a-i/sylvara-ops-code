"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createBillingClient, directTestCustomerIdentity } = require("../lib/billing-client");
const { loadConfig } = require("../lib/config");
const {
  REVISION,
  SYNTHETIC_COMMERCIAL_TERMS,
  baseEnvironment,
  jsonResponse,
} = require("./helpers");

const token = `Zoho-oauthtoken ${"b".repeat(24)}`;
const crmAccountId = "100000000000002";
const customerId = "200000000000001";
const subscriptionId = "300000000000001";
const reference = `syl-paid-${"c".repeat(32)}`;

function approvedTerms(planName, billingFrequency) {
  const values = SYNTHETIC_COMMERCIAL_TERMS.plans[`${planName}::${billingFrequency}`];
  return values ? { plan: planName, billingFrequency, ...values } : null;
}

function testConfig(overrides = {}) {
  return loadConfig(baseEnvironment({
    CUSTOMER_PROVISIONING_MODE: "test_direct_customer",
    ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "true",
    ...overrides,
  }), { artifactRevision: REVISION });
}

function testOrganization(config, overrides = {}) {
  return {
    organization_id: config.billingOrganizationId,
    name: "Synthetic Billing TEST Organization",
    mode: "test",
    org_joined_app_list: ["subscriptions"],
    ...overrides,
  };
}

function directTestCustomer(config, overrides = {}) {
  const identity = directTestCustomerIdentity(config, crmAccountId);
  return {
    customer_id: customerId,
    email: identity.email,
    display_name: identity.displayName,
    company_name: identity.displayName,
    notes: identity.marker,
    status: "active",
    is_portal_enabled: false,
    ach_supported: false,
    payment_terms: 0,
    is_linked_with_zohocrm: false,
    outstanding: "0",
    unused_credits: "0",
    ...overrides,
  };
}

function selectedTerms(config, selectedPlan = "Growth") {
  return config.paidCommercialTerms.plans[`${selectedPlan}::Monthly`];
}

function moneyString(minor) {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

function plan(config, selectedPlan = "Growth", overrides = {}) {
  const terms = selectedTerms(config, selectedPlan);
  return {
    plan_code: config.paidPlanCodeMap[`${selectedPlan}::Monthly`],
    product_id: config.paidUsageAddonProductId,
    status: "active",
    currency_code: config.paidCommercialTerms.currency,
    interval: config.paidCommercialTerms.interval,
    interval_unit: config.paidCommercialTerms.intervalUnit,
    trial_period: 0,
    recurring_price: moneyString(terms.recurringMinor),
    setup_fee: moneyString(terms.setupMinor),
    ...overrides,
  };
}

function usageAddon(config, overrides = {}) {
  return {
    addon_code: config.paidUsageAddonCode,
    status: "active",
    type: "recurring",
    is_usage_supported: true,
    pricing_scheme: "unit",
    currency_code: config.paidCommercialTerms.currency,
    interval: config.paidCommercialTerms.interval,
    interval_unit: config.paidCommercialTerms.intervalUnit,
    unit: config.paidUsageAddonUnit,
    product_id: config.paidUsageAddonProductId,
    price_brackets: [{
      start_quantity: 1,
      end_quantity: null,
      price: moneyString(config.paidCommercialTerms.commonUsageRateMinor),
    }],
    ...overrides,
  };
}

function subscription(config, selectedPlan = "Growth", overrides = {}) {
  const selectedPlanObject = plan(config, selectedPlan);
  return {
    subscription_id: subscriptionId,
    product_id: config.paidUsageAddonProductId,
    customer_id: customerId,
    reference_id: reference,
    plan: {
      plan_code: selectedPlanObject.plan_code,
      recurring_price: selectedPlanObject.recurring_price,
      setup_fee: selectedPlanObject.setup_fee,
      interval: config.paidCommercialTerms.interval,
      interval_unit: config.paidCommercialTerms.intervalUnit,
    },
    addons: [{
      addon_code: config.paidUsageAddonCode,
      quantity: 1,
      price: moneyString(config.paidCommercialTerms.commonUsageRateMinor),
      unit: config.paidUsageAddonUnit,
    }],
    currency_code: config.paidCommercialTerms.currency,
    auto_collect: false,
    status: "future",
    start_date: "2026-09-01",
    current_term_starts_at: "2026-09-01",
    ...overrides,
  };
}

function customerPage(customers, page = 1, hasMorePage = false) {
  return { customers, page_context: { page, per_page: 200, has_more_page: hasMorePage } };
}

function subscriptionPage(subscriptions, page = 1, hasMorePage = false) {
  return { subscriptions, page_context: { page, per_page: 200, has_more_page: hasMorePage } };
}

function clientFor(config, responses, calls = [], operationStore = {
  claim: async () => ({ outcome: "claimed", rowId: "1" }),
  mark: async () => undefined,
}) {
  return createBillingClient(config, {
    readAuthorizationProvider: async () => token,
    writeAuthorizationProvider: async () => token,
    operationStore,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  });
}

function catalogResponses(config, selectedPlan = "Growth", overrides = {}) {
  return [
    jsonResponse(200, { organization: testOrganization(config) }),
    jsonResponse(200, { plan: plan(config, selectedPlan, overrides.plan) }),
    jsonResponse(200, { addon: usageAddon(config, overrides.addon) }),
  ];
}

function paidCreateResponses(config, selectedPlan = "Growth", overrides = {}) {
  const paid = subscription(config, selectedPlan, overrides.subscription);
  return [
    ...catalogResponses(config, selectedPlan, overrides),
    jsonResponse(200, subscriptionPage([])),
    overrides.createResponse ?? jsonResponse(201, { subscription: paid }),
    jsonResponse(200, subscriptionPage([paid])),
    jsonResponse(200, { subscription: paid }),
    ...catalogResponses(config, selectedPlan, overrides),
  ];
}

test("direct customer provisioning is confined to an attested Billing TEST organization", async () => {
  const config = testConfig();
  const calls = [];
  const customer = directTestCustomer(config);
  const marks = [];
  const client = clientFor(config, [
    jsonResponse(200, { organization: testOrganization(config) }),
    jsonResponse(200, customerPage([])),
    jsonResponse(201, { customer }),
    jsonResponse(200, { organization: testOrganization(config) }),
    jsonResponse(200, customerPage([customer])),
    jsonResponse(200, { customer }),
  ], calls, {
    claim: async () => ({ outcome: "claimed", rowId: "1" }),
    mark: async (...args) => marks.push(args),
  });
  const result = await client.ensureCustomer({ crmAccountId });
  assert.equal(result.testDirect, true);
  assert.equal(result.customer.customer_id, customerId);
  const create = calls.find(({ url, options }) => url.endsWith("/customers") && options.method === "POST");
  const body = JSON.parse(create.options.body);
  assert.equal(body.is_portal_enabled, false);
  assert.equal(body.ach_supported, false);
  assert.equal(body.payment_terms, 0);
  assert.doesNotMatch(create.options.body, new RegExp(crmAccountId));
  assert.deepEqual(marks, [["1", "completed", "customer_readback_confirmed"]]);
});

test("direct customer provisioning rejects live, joined, or unresolved claims before mutation", async () => {
  const config = testConfig();
  for (const organization of [
    testOrganization(config, { mode: "live" }),
    testOrganization(config, { org_joined_app_list: ["subscriptions", "books"] }),
  ]) {
    const calls = [];
    const client = clientFor(config, [jsonResponse(200, { organization })], calls);
    await assert.rejects(client.ensureCustomer({ crmAccountId }), /isolated Billing TEST tenant/);
    assert.equal(calls.some(({ options }) => options.method === "POST"), false);
  }

  const calls = [];
  const unresolved = clientFor(config, [
    jsonResponse(200, { organization: testOrganization(config) }),
    jsonResponse(200, customerPage([])),
  ], calls, {
    claim: async () => ({ outcome: "duplicate-unresolved", rowId: "1" }),
    mark: async () => undefined,
  });
  await assert.rejects(unresolved.ensureCustomer({ crmAccountId }), /claim is unresolved/);
  assert.equal(calls.length, 2);
});

test("a completed direct customer claim performs exact readback and never creates again", async () => {
  const config = testConfig();
  const customer = directTestCustomer(config);
  const calls = [];
  const client = clientFor(config, [
    jsonResponse(200, { organization: testOrganization(config) }),
    jsonResponse(200, customerPage([customer])),
    jsonResponse(200, { customer }),
  ], calls, {
    claim: async () => ({ outcome: "duplicate-completed", rowId: "1" }),
    mark: async () => undefined,
  });
  const result = await client.ensureCustomer({ crmAccountId });
  assert.equal(result.duplicateProvisioning, true);
  assert.equal(calls.some(({ options }) => options.method === "POST"), false);
});

test("unresolved customer creation is quarantined after any write response", async () => {
  const config = testConfig();
  const marks = [];
  const client = clientFor(config, [
    jsonResponse(200, { organization: testOrganization(config) }),
    jsonResponse(200, customerPage([])),
    jsonResponse(400, { code: "SYNTHETIC_REJECTION" }),
    jsonResponse(200, { organization: testOrganization(config) }),
    jsonResponse(200, customerPage([])),
  ], [], {
    claim: async () => ({ outcome: "claimed", rowId: "1" }),
    mark: async (...args) => marks.push(args),
  });
  await assert.rejects(client.ensureCustomer({ crmAccountId }), (error) => (
    error?.ambiguous === true && error?.publicCode === "reconciliation_required"
  ));
  assert.deepEqual(marks, [["1", "reconciliation_required", "reconciliation_required"]]);
});

test("a transient pre-write customer read leaves no claim and is safely retryable", async () => {
  const config = testConfig();
  const customer = directTestCustomer(config);
  let claims = 0;
  const client = clientFor(config, [
    new Error("synthetic transient read failure"),
    new Error("synthetic repeated read failure"),
    jsonResponse(200, { organization: testOrganization(config) }),
    jsonResponse(200, customerPage([])),
    jsonResponse(201, { customer }),
    jsonResponse(200, { organization: testOrganization(config) }),
    jsonResponse(200, customerPage([customer])),
    jsonResponse(200, { customer }),
  ], [], {
    claim: async () => {
      claims += 1;
      return { outcome: "claimed", rowId: "1" };
    },
    mark: async () => undefined,
  });
  await assert.rejects(client.ensureCustomer({ crmAccountId }), /authoritative result/);
  assert.equal(claims, 0);
  assert.equal((await client.ensureCustomer({ crmAccountId })).customer.customer_id, customerId);
  assert.equal(claims, 1);
});

test("all approved plans and the common meter require exact catalog readback", async () => {
  const config = testConfig();
  for (const selectedPlan of ["Launch", "Growth", "Scale"]) {
    const client = clientFor(config, catalogResponses(config, selectedPlan));
    const result = await client.readPaidCatalog(
      config.paidPlanCodeMap[`${selectedPlan}::Monthly`],
      approvedTerms(selectedPlan, "Monthly"),
    );
    assert.equal(result.plan.plan_code, config.paidPlanCodeMap[`${selectedPlan}::Monthly`]);
    assert.equal(result.addon.addon_code, config.paidUsageAddonCode);
  }
});

test("paid plan or metered add-on drift fails before subscription creation", async () => {
  const config = testConfig();
  for (const planOverride of [
    { recurring_price: moneyString(selectedTerms(config).recurringMinor - 1) },
    { setup_fee: moneyString(selectedTerms(config).setupMinor - 1) },
    { currency_code: "CAD" },
    { interval: 12 },
    { interval_unit: "years" },
    { trial_period: 7 },
    { status: "inactive" },
    { product_id: "400000000000009" },
  ]) {
    const calls = [];
    const client = clientFor(config, [
      jsonResponse(200, { organization: testOrganization(config) }),
      jsonResponse(200, { plan: plan(config, "Growth", planOverride) }),
    ], calls);
    await assert.rejects(client.ensurePaidSubscription({
      customerId,
      deterministicReference: reference,
      selectedPlanCode: config.paidPlanCodeMap["Growth::Monthly"],
      commercialTerms: approvedTerms("Growth", "Monthly"),
      subscriptionStartDate: "2026-09-01",
    }), /catalog|commercial terms/);
    assert.equal(calls.some(({ options }) => options.method === "POST"), false);
  }

  for (const addonOverride of [
    { status: "inactive" },
    { type: "one_time" },
    { is_usage_supported: false },
    { is_usage_supported: undefined },
    { pricing_scheme: "volume" },
    { currency_code: "CAD" },
    { interval: 2 },
    { interval_unit: "years" },
    { unit: "" },
    { unit: "generic minute" },
    { product_id: "400000000000009" },
    { price_brackets: [] },
    { price_brackets: [{
      start_quantity: 1,
      price: moneyString(config.paidCommercialTerms.commonUsageRateMinor + 1),
    }] },
  ]) {
    const calls = [];
    const client = clientFor(config, catalogResponses(config, "Growth", { addon: addonOverride }), calls);
    await assert.rejects(client.ensurePaidSubscription({
      customerId,
      deterministicReference: reference,
      selectedPlanCode: config.paidPlanCodeMap["Growth::Monthly"],
      commercialTerms: approvedTerms("Growth", "Monthly"),
      subscriptionStartDate: "2026-09-01",
    }), /metered contract|commercial terms/);
    assert.equal(calls.some(({ options }) => options.method === "POST"), false);
  }
});

test("paid creation sends only the accepted plan, common meter, and no collection instruction", async () => {
  const config = testConfig();
  const calls = [];
  const client = clientFor(config, paidCreateResponses(config), calls);
  const result = await client.ensurePaidSubscription({
    customerId,
    deterministicReference: reference,
    selectedPlanCode: config.paidPlanCodeMap["Growth::Monthly"],
    commercialTerms: approvedTerms("Growth", "Monthly"),
    subscriptionStartDate: "2026-09-01",
  });
  assert.equal(result.subscription_id, subscriptionId);
  assert.equal(result.status, "future");
  const create = calls.find(({ url, options }) => url.endsWith("/subscriptions") && options.method === "POST");
  assert.deepEqual(JSON.parse(create.options.body), {
    customer_id: customerId,
    reference_id: reference,
    auto_collect: false,
    starts_at: "2026-09-01",
    plan: { plan_code: config.paidPlanCodeMap["Growth::Monthly"], quantity: 1 },
    addons: [{ addon_code: config.paidUsageAddonCode, quantity: 1 }],
  });
  assert.equal(calls.filter(({ url }) => url.endsWith(`/organizations/${config.billingOrganizationId}`)).length, 2);
  assert.equal(calls.filter(({ url }) => url.endsWith(`/plans/${config.paidPlanCodeMap["Growth::Monthly"]}`)).length, 2);
  assert.equal(calls.filter(({ url }) => url.endsWith(`/addons/${config.paidUsageAddonCode}`)).length, 2);
});

test("paid subscription readback rejects unsafe payment, catalog, meter, and status shapes", async () => {
  const config = testConfig();
  for (const unsafe of [
    { auto_collect: true },
    { card: { card_id: "synthetic-card" } },
    { bank_account_id: "synthetic-bank" },
    { coupon_id: "synthetic-coupon" },
    { discount: "10" },
    { status: "trial" },
    { currency_code: "CAD" },
    { product_id: "400000000000009" },
    { start_date: undefined, current_term_starts_at: "2026-09-01" },
    { current_term_starts_at: "2026-08-01" },
    { plan: {
      ...subscription(config).plan,
      recurring_price: moneyString(selectedTerms(config).recurringMinor - 1),
    } },
    { plan: { ...subscription(config).plan, setup_fee: "0" } },
    { addons: [] },
    { addons: [
      {
        addon_code: config.paidUsageAddonCode,
        quantity: 1,
        price: moneyString(config.paidCommercialTerms.commonUsageRateMinor),
      },
      { addon_code: "unexpected", quantity: 1, price: "1.00" },
    ] },
    { addons: [{
      addon_code: config.paidUsageAddonCode,
      quantity: 1,
      price: moneyString(config.paidCommercialTerms.commonUsageRateMinor + 1),
      unit: config.paidUsageAddonUnit,
    }] },
    { addons: [{
      addon_code: config.paidUsageAddonCode,
      quantity: 1,
      price: moneyString(config.paidCommercialTerms.commonUsageRateMinor),
      unit: "connected_minute",
    }] },
  ]) {
    const calls = [];
    const client = clientFor(config, paidCreateResponses(config, "Growth", {
      subscription: unsafe,
    }), calls);
    await assert.rejects(client.ensurePaidSubscription({
      customerId,
      deterministicReference: reference,
      selectedPlanCode: config.paidPlanCodeMap["Growth::Monthly"],
      commercialTerms: approvedTerms("Growth", "Monthly"),
      subscriptionStartDate: "2026-09-01",
    }), /reconciliation|approved boundary|commercial/);
  }
});

test("subscription lookup paginates, exact-filters, and rejects duplicate exact references", async () => {
  const config = testConfig();
  const paid = subscription(config);
  const partial = { ...paid, subscription_id: "300000000000002", reference_id: `${reference}-partial` };
  const calls = [];
  const client = clientFor(config, [
    jsonResponse(200, subscriptionPage([partial], 1, true)),
    jsonResponse(200, subscriptionPage([paid], 2, false)),
  ], calls);
  assert.equal((await client.findSubscriptionByReference(reference)).subscription_id, subscriptionId);
  assert.equal(new URL(calls[0].url).searchParams.get("page"), "1");
  assert.equal(new URL(calls[1].url).searchParams.get("page"), "2");

  const duplicate = clientFor(config, [jsonResponse(200, subscriptionPage([
    paid,
    { ...paid, subscription_id: "300000000000003" },
  ]))]);
  await assert.rejects(duplicate.findSubscriptionByReference(reference), /not unique/);
});

test("an ambiguous paid create is accepted only after complete deterministic readback", async () => {
  const config = testConfig();
  const responses = paidCreateResponses(config);
  responses[4] = new Error("synthetic post-commit timeout");
  const client = clientFor(config, responses);
  const result = await client.ensurePaidSubscription({
    customerId,
    deterministicReference: reference,
    selectedPlanCode: config.paidPlanCodeMap["Growth::Monthly"],
    commercialTerms: approvedTerms("Growth", "Monthly"),
    subscriptionStartDate: "2026-09-01",
  });
  assert.equal(result.subscription_id, subscriptionId);
});

test("any unresolved post-create outcome is reconciliation-required even after a 4xx response", async () => {
  const config = testConfig();
  const responses = [
    ...catalogResponses(config),
    jsonResponse(200, subscriptionPage([])),
    jsonResponse(400, { code: "SYNTHETIC_REJECTION" }),
    jsonResponse(200, subscriptionPage([])),
  ];
  const client = clientFor(config, responses);
  await assert.rejects(client.ensurePaidSubscription({
    customerId,
    deterministicReference: reference,
    selectedPlanCode: config.paidPlanCodeMap["Growth::Monthly"],
    commercialTerms: approvedTerms("Growth", "Monthly"),
    subscriptionStartDate: "2026-09-01",
  }), (error) => (
    error?.ambiguous === true && error?.publicCode === "reconciliation_required"
  ));
});

test("renewal term advancement preserves separately verified original subscription start", async () => {
  const config = testConfig();
  const client = clientFor(config, paidCreateResponses(config, "Growth", {
    subscription: { current_term_starts_at: "2027-01-01" },
  }));
  const result = await client.ensurePaidSubscription({
    customerId,
    deterministicReference: reference,
    selectedPlanCode: config.paidPlanCodeMap["Growth::Monthly"],
    commercialTerms: approvedTerms("Growth", "Monthly"),
    subscriptionStartDate: "2026-09-01",
  });
  assert.equal(result.start_date, "2026-09-01");
  assert.equal(result.current_term_starts_at, "2027-01-01");
});

test("verified paid lookup performs catalog and full subscription readback without mutation", async () => {
  const config = testConfig();
  const paid = subscription(config);
  const calls = [];
  const client = clientFor(config, [
    ...catalogResponses(config),
    jsonResponse(200, subscriptionPage([paid])),
    jsonResponse(200, { subscription: paid }),
  ], calls);
  const result = await client.findVerifiedPaidSubscription({
    customerId,
    deterministicReference: reference,
    selectedPlanCode: config.paidPlanCodeMap["Growth::Monthly"],
    commercialTerms: approvedTerms("Growth", "Monthly"),
    subscriptionStartDate: "2026-09-01",
  });
  assert.equal(result.subscription_id, subscriptionId);
  assert.equal(calls.some(({ options }) => options.method === "POST"), false);
});
