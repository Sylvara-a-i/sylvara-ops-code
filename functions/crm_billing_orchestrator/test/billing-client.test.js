"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createBillingClient } = require("../lib/billing-client");
const { loadConfig } = require("../lib/config");
const { REVISION, baseEnvironment, jsonResponse } = require("./helpers");

const token = `Zoho-oauthtoken ${"b".repeat(24)}`;
const crmAccountId = "100000000000002";
const customerId = "200000000000001";
const subscriptionId = "300000000000001";
const reference = `syl-evaluation-${"c".repeat(32)}`;

function evaluationPlan(price = "0") {
  return {
    plan_code: "evaluation_plan",
    status: "active",
    recurring_price: price,
    setup_fee: "0",
    billing_cycles: 1,
    trial_period: 7,
  };
}

function evaluationSubscription(overrides = {}) {
  return {
    subscription_id: subscriptionId,
    customer_id: customerId,
    reference_id: reference,
    plan: {
      plan_code: "evaluation_plan",
      setup_fee: "0",
      trial_days: 7,
    },
    auto_collect: false,
    addons: [],
    amount: "0",
    status: "trial",
    ...overrides,
  };
}

function paidPlan() {
  return {
    plan_code: "launch_plan",
    status: "active",
    recurring_price: "37",
  };
}

function paidSubscription(overrides = {}) {
  return evaluationSubscription({
    plan: { plan_code: "launch_plan" },
    amount: "37",
    status: "future",
    start_date: "2026-09-01",
    ...overrides,
  });
}

function subscriptionPage(subscriptions, page = 1, hasMorePage = false) {
  return {
    subscriptions,
    page_context: { page, per_page: 200, has_more_page: hasMorePage },
  };
}

function clientFor(config, responses, calls = []) {
  return createBillingClient(config, {
    readAuthorizationProvider: async () => token,
    writeAuthorizationProvider: async () => token,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  });
}

test("customer creation uses only the native CRM Account import and exact reference readback", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const calls = [];
  const customer = { customer_id: customerId, zcrm_account_id: crmAccountId };
  const client = clientFor(config, [
    jsonResponse(404, { code: 1008 }),
    jsonResponse(201, { code: 0 }),
    jsonResponse(200, { customer }),
  ], calls);
  const result = await client.ensureCustomer({ crmAccountId });
  assert.equal(result.imported, true);
  assert.equal(result.customer.customer_id, customerId);
  assert.equal(calls[0].url, `${config.billingApiBaseUrl}/customers/reference/${crmAccountId}?reference_id_type=zcrm_account_id`);
  assert.equal(calls[1].url, `${config.billingApiBaseUrl}/crm/account/${crmAccountId}/import`);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(Object.hasOwn(calls[1].options, "body"), false);
  assert.equal(calls.some(({ url, options }) => (
    url.endsWith("/customers") && options.method === "POST"
  )), false);
});

test("customer lookup rejects a response without the exact CRM Account reference", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const client = clientFor(config, [
    jsonResponse(200, { customer: { customer_id: customerId } }),
  ]);
  await assert.rejects(
    client.findCustomerByCrmReference(crmAccountId),
    /reference readback does not match/,
  );
});

test("evaluation creation proves zero exposure and uses the documented creation overrides", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const calls = [];
  const responses = [
    jsonResponse(200, { plan: evaluationPlan() }),
    jsonResponse(200, subscriptionPage([])),
    jsonResponse(201, { subscription: evaluationSubscription() }),
    jsonResponse(200, subscriptionPage([evaluationSubscription()])),
    jsonResponse(200, { subscription: evaluationSubscription() }),
  ];
  const client = clientFor(config, responses, calls);
  const result = await client.ensureEvaluationSubscription({
    customerId,
    deterministicReference: reference,
  });
  assert.equal(result.subscription_id, subscriptionId);
  assert.equal(calls[0].url, `${config.billingApiBaseUrl}/plans/evaluation_plan`);
  const create = calls.find((call) => call.options.method === "POST");
  const body = JSON.parse(create.options.body);
  assert.equal(body.auto_collect, false);
  assert.deepEqual(body.plan, {
    plan_code: "evaluation_plan",
    quantity: 1,
    exclude_setup_fee: true,
    billing_cycles: 1,
    trial_days: config.freeTestDurationDays,
  });
  assert.equal(Object.hasOwn(body, "addons"), false);
  assert.equal(Object.hasOwn(body, "card_id"), false);
  const referenceLookups = calls.filter(({ url }) => url.includes("reference_contains="));
  assert.equal(referenceLookups.length, 2);
  assert.ok(referenceLookups.every(({ url }) => (
    new URL(url).searchParams.get("reference_contains") === reference &&
    new URL(url).searchParams.has("reference_id") === false
  )));
  assert.ok(calls.every((call) => (
    call.options.headers["X-com-zoho-subscriptions-organizationid"] ===
    config.billingOrganizationId
  )));
});

test("subscription lookup paginates and exact-filters reference_contains results", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const calls = [];
  const client = clientFor(config, [
    jsonResponse(200, subscriptionPage([
      evaluationSubscription({
        subscription_id: "300000000000002",
        reference_id: `${reference}-partial`,
      }),
    ], 1, true)),
    jsonResponse(200, subscriptionPage([evaluationSubscription()], 2, false)),
  ], calls);
  const result = await client.findSubscriptionByReference(reference);
  assert.equal(result.subscription_id, subscriptionId);
  assert.equal(new URL(calls[0].url).searchParams.get("page"), "1");
  assert.equal(new URL(calls[1].url).searchParams.get("page"), "2");
});

test("paid subscription creation transmits and verifies the accepted start date", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const calls = [];
  const subscription = paidSubscription();
  const client = clientFor(config, [
    jsonResponse(200, { plan: paidPlan() }),
    jsonResponse(200, subscriptionPage([])),
    jsonResponse(201, { subscription }),
    jsonResponse(200, subscriptionPage([subscription])),
    jsonResponse(200, { subscription }),
  ], calls);
  const result = await client.ensurePaidSubscription({
    customerId,
    deterministicReference: reference,
    selectedPlanCode: "launch_plan",
    subscriptionStartDate: "2026-09-01",
  });
  assert.equal(result.subscription_id, subscriptionId);
  const body = JSON.parse(calls.find((call) => call.options.method === "POST").options.body);
  assert.equal(body.starts_at, "2026-09-01");
});

test("subscription readback rejects every documented payment-method shape", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  for (const paymentEvidence of [
    { card: { card_id: "synthetic-card" } },
    { bank_account_id: "synthetic-bank" },
  ]) {
    const client = clientFor(config, [
      jsonResponse(200, { plan: evaluationPlan() }),
      jsonResponse(200, subscriptionPage([evaluationSubscription()])),
      jsonResponse(200, { subscription: evaluationSubscription(paymentEvidence) }),
    ]);
    await assert.rejects(client.ensureEvaluationSubscription({
      customerId,
      deterministicReference: reference,
    }), /violates the approved boundary/);
  }
});

test("subscription readback fails closed when evaluation amount evidence is missing", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const missingAmount = evaluationSubscription();
  delete missingAmount.amount;
  const client = clientFor(config, [
    jsonResponse(200, { plan: evaluationPlan() }),
    jsonResponse(200, subscriptionPage([missingAmount])),
    jsonResponse(200, { subscription: missingAmount }),
  ]);
  await assert.rejects(client.ensureEvaluationSubscription({
    customerId,
    deterministicReference: reference,
  }), /financial exposure/);
});

test("evaluation readback requires trial status and explicit zero setup fee", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  for (const unsafe of [
    evaluationSubscription({ status: "live" }),
    evaluationSubscription({ plan: { plan_code: "evaluation_plan" } }),
    evaluationSubscription({ plan: {
      plan_code: "evaluation_plan", setup_fee: "1.00", trial_days: 7,
    } }),
    evaluationSubscription({ plan: {
      plan_code: "evaluation_plan", setup_fee: "0", trial_days: 14,
    } }),
  ]) {
    const client = clientFor(config, [
      jsonResponse(200, { plan: evaluationPlan() }),
      jsonResponse(200, subscriptionPage([unsafe])),
      jsonResponse(200, { subscription: unsafe }),
    ]);
    await assert.rejects(client.ensureEvaluationSubscription({
      customerId,
      deterministicReference: reference,
    }), /approved boundary|financial exposure/);
  }
});

test("subscription readback accepts the documented nested customer identity", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const nestedCustomer = evaluationSubscription({ customer_id: undefined, customer: { customer_id: customerId } });
  const client = clientFor(config, [
    jsonResponse(200, { plan: evaluationPlan() }),
    jsonResponse(200, subscriptionPage([nestedCustomer])),
    jsonResponse(200, { subscription: nestedCustomer }),
  ]);
  const result = await client.ensureEvaluationSubscription({
    customerId,
    deterministicReference: reference,
  });
  assert.equal(result.subscription_id, subscriptionId);
});

test("natural trial expiry is a terminal evaluation outcome", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const calls = [];
  const client = clientFor(config, [
    jsonResponse(200, { subscription: evaluationSubscription({ status: "trial_expired" }) }),
  ], calls);
  const result = await client.cancelEvaluation({
    subscriptionId,
    customerId,
    deterministicReference: reference,
  });
  assert.equal(result.status, "trial_expired");
  assert.equal(calls.some((call) => call.options.method === "POST"), false);
});

test("evaluation cancellation verifies identity and zero exposure before and after POST", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const calls = [];
  const client = clientFor(config, [
    jsonResponse(200, { subscription: evaluationSubscription() }),
    jsonResponse(200, { code: 0 }),
    jsonResponse(200, { subscription: evaluationSubscription({ status: "cancelled" }) }),
  ], calls);
  const result = await client.cancelEvaluation({
    subscriptionId,
    customerId,
    deterministicReference: reference,
  });
  assert.equal(result.status, "cancelled");
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 1);

  for (const poisoned of [
    evaluationSubscription({ reference_id: `syl-evaluation-${"d".repeat(32)}` }),
    evaluationSubscription({ plan: {
      plan_code: "launch_plan", setup_fee: "0", trial_days: 7,
    } }),
    evaluationSubscription({ customer_id: "200000000000002" }),
  ]) {
    const poisonedCalls = [];
    const poisonedClient = clientFor(config, [
      jsonResponse(200, { subscription: poisoned }),
    ], poisonedCalls);
    await assert.rejects(poisonedClient.cancelEvaluation({
      subscriptionId,
      customerId,
      deterministicReference: reference,
    }), /approved boundary/);
    assert.equal(poisonedCalls.some((call) => call.options.method === "POST"), false);
  }

  const activatedCalls = [];
  const activatedClient = clientFor(config, [
    jsonResponse(200, { subscription: evaluationSubscription({ status: "live" }) }),
    jsonResponse(200, { code: 0 }),
    jsonResponse(200, { subscription: evaluationSubscription({ status: "cancelled" }) }),
  ], activatedCalls);
  const contained = await activatedClient.cancelEvaluation({
    subscriptionId,
    customerId,
    deterministicReference: reference,
  });
  assert.equal(contained.status, "cancelled");
  assert.equal(activatedCalls.filter((call) => call.options.method === "POST").length, 1);
});

test("incomplete pagination and duplicate exact references fail closed", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const incomplete = clientFor(config, [jsonResponse(200, { subscriptions: [] })]);
  await assert.rejects(incomplete.findSubscriptionByReference(reference), /pagination is incomplete/);

  const duplicate = clientFor(config, [jsonResponse(200, subscriptionPage([
    evaluationSubscription(),
    evaluationSubscription({ subscription_id: "300000000000002" }),
  ]))]);
  await assert.rejects(duplicate.findSubscriptionByReference(reference), /not unique/);
});

test("non-zero evaluation plan fails before subscription creation", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const calls = [];
  const client = clientFor(config, [
    jsonResponse(200, { plan: evaluationPlan("1.00") }),
  ], calls);
  await assert.rejects(client.ensureEvaluationSubscription({
    customerId,
    deterministicReference: reference,
  }), /zero bounded exposure/);
  assert.equal(calls.some((call) => call.options.method === "POST"), false);
});

test("an ambiguous create is resolved only by paginated deterministic reference readback", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const client = clientFor(config, [
    jsonResponse(200, { plan: evaluationPlan() }),
    jsonResponse(200, subscriptionPage([])),
    new Error("synthetic post-commit timeout"),
    jsonResponse(200, subscriptionPage([evaluationSubscription()])),
    jsonResponse(200, { subscription: evaluationSubscription() }),
  ]);
  const result = await client.ensureEvaluationSubscription({
    customerId,
    deterministicReference: reference,
  });
  assert.equal(result.subscription_id, subscriptionId);
});
