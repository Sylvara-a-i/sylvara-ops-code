"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const { createLifecycleHandler } = require("../lib/lifecycle-handler");
const { REVISION, baseEnvironment } = require("./helpers");

function context(config, overrides = {}) {
  return {
    deal: {
      id: "100000000000001",
      Modified_Time: "2026-08-21T10:00:00-05:00",
      Entry_Offer: config.freeTestEntryOfferValue,
      Type: config.initialSaleTypeValue,
      Stage: config.testLiveStageValue,
      Account_Name: { id: "100000000000002", name: "Synthetic Account" },
      Go_Live_Approval_Status: config.goLiveApprovedValue,
      Go_Live_Approved_At: "2026-08-21T10:00:00-05:00",
      Test_Status: "Live",
      Test_Duration_Days: config.freeTestDurationDays,
      Test_Call_Limit: config.freeTestCallLimit,
      Test_Scope_Version: "scope-v1",
      Test_Start_At: "2026-08-21T10:00:00-05:00",
      Billing_Customer_ID: null,
      Billing_Evaluation_Subscription_ID: null,
      Billing_Evaluation_Status: null,
      Billing_Subscription_ID: null,
      Subscription_Status: null,
      Billing_Automation_Status: null,
      Billing_Last_Sync_At: null,
      Billing_Automation_Error: "Synthetic prior error",
      Plan: "Launch",
      Billing_Frequency: "Monthly",
      Subscription_Start_Date: "2026-09-01",
      Subscription_Acceptance_Status: "Not Accepted",
      ...overrides,
    },
    account: {
      id: "100000000000002",
      Modified_Time: "2026-08-21T10:00:00-05:00",
      Account_Name: "Synthetic Account",
    },
  };
}

function harness(config, initialContext) {
  let current = structuredClone(initialContext);
  const calls = [];
  const crmClient = {
    getContext: async () => structuredClone(current),
    updateDealIntegration: async (deal, patch) => {
      calls.push(["crm_update", patch]);
      current.deal = {
        ...deal,
        ...patch,
        Modified_Time: "2026-08-21T10:01:00-05:00",
      };
      return structuredClone(current.deal);
    },
  };
  const billingClient = {
    ensureCustomer: async () => ({ customer: {
      customer_id: "200000000000001",
      zcrm_account_id: current.account.id,
    } }),
    ensureEvaluationSubscription: async (input) => {
      calls.push(["evaluation", input]);
      return { subscription_id: "300000000000001" };
    },
    ensurePaidSubscription: async (input) => {
      calls.push(["paid", input]);
      return { subscription_id: "400000000000001" };
    },
    cancelEvaluation: async (id) => {
      calls.push(["cancel", id]);
      return { subscription_id: id, status: "cancelled" };
    },
    findCustomerByCrmReference: async () => ({ customer_id: "200000000000001" }),
    getSubscription: async (id) => {
      calls.push(["get_subscription", id]);
      return {
        subscription_id: id,
        customer_id: "200000000000001",
      };
    },
  };
  const operationStore = {
    claim: async () => ({ outcome: "claimed", rowId: "1" }),
    mark: async (...args) => calls.push(["mark", ...args]),
  };
  return {
    calls,
    lifecycle: createLifecycleHandler(config, {
      crmClient,
      billingClient,
      operationStore,
      now: () => Date.parse("2026-08-21T15:02:00.000Z"),
    }),
  };
}

test("start_evaluation creates only after CRM gates and persists readback IDs", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const { lifecycle, calls } = harness(config, context(config));
  const result = await lifecycle.handle({
    action: "start_evaluation",
    dealId: "100000000000001",
  });
  assert.equal(result.outcome, "evaluation_readback_confirmed");
  assert.equal(calls.filter(([kind]) => kind === "evaluation").length, 1);
  const finalUpdate = calls.filter(([kind]) => kind === "crm_update").at(-1)[1];
  assert.equal(finalUpdate.Billing_Evaluation_Subscription_ID, "300000000000001");
  assert.equal(finalUpdate.Billing_Evaluation_Status, "Trial");
  assert.equal(finalUpdate.Billing_Automation_Status, "Evaluation Verified");
  assert.equal(finalUpdate.Billing_Last_Sync_At, "2026-08-21T15:02:00.000Z");
  assert.equal(finalUpdate.Billing_Automation_Error, null);
  assert.equal(Object.hasOwn(finalUpdate, "Billing_Subscription_ID"), false);
  assert.equal(Object.hasOwn(finalUpdate, "Subscription_Status"), false);
});

test("paid subscription is impossible without explicit acceptance", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const rejected = harness(config, context(config, {
    Stage: config.subscriptionProposedStageValue,
    Test_Status: config.testCompletedStatusValue,
  }));
  await assert.rejects(rejected.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /explicit paid acceptance/);
  assert.equal(rejected.calls.some(([kind]) => kind === "paid"), false);

  const accepted = harness(config, context(config, {
    Stage: config.subscriptionProposedStageValue,
    Test_Status: config.testCompletedStatusValue,
    Subscription_Acceptance_Status: config.paidAcceptanceValue,
  }));
  const result = await accepted.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  });
  assert.equal(result.outcome, "paid_subscription_readback_confirmed");
  assert.equal(accepted.calls.filter(([kind]) => kind === "paid").length, 1);
  const paidInput = accepted.calls.find(([kind]) => kind === "paid")[1];
  assert.equal(paidInput.selectedPlanCode, "launch_plan");
  const paidUpdate = accepted.calls.filter(([kind]) => kind === "crm_update").at(-1)[1];
  assert.equal(paidUpdate.Billing_Subscription_ID, "400000000000001");
  assert.equal(paidUpdate.Subscription_Status, config.paidReadyStatusValue);
  assert.equal(paidUpdate.Billing_Automation_Status, "Paid Verified");
  assert.equal(Object.hasOwn(paidUpdate, "Billing_Evaluation_Subscription_ID"), false);

  const wrongFrequency = harness(config, context(config, {
    Stage: config.subscriptionProposedStageValue,
    Test_Status: config.testCompletedStatusValue,
    Subscription_Acceptance_Status: config.paidAcceptanceValue,
    Billing_Frequency: "Annual",
  }));
  await assert.rejects(wrongFrequency.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /Plan and Billing Frequency are outside/);
  assert.equal(wrongFrequency.calls.some(([kind]) => kind === "paid"), false);
});

test("end_evaluation requires terminal CRM evidence before cancellation", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const approved = harness(config, context(config, {
    Stage: config.resultsReviewStageValue,
    Test_End_At: "2026-08-28T10:00:00-05:00",
    Test_End_Reason: "Configured limit reached",
    Billing_Customer_ID: "200000000000001",
    Billing_Evaluation_Subscription_ID: "300000000000001",
  }));
  const result = await approved.lifecycle.handle({
    action: "end_evaluation",
    dealId: "100000000000001",
  });
  assert.equal(result.outcome, "evaluation_end_readback_confirmed");
  assert.deepEqual(approved.calls.find(([kind]) => kind === "cancel"), [
    "cancel",
    "300000000000001",
  ]);
  const terminalUpdate = approved.calls.filter(([kind]) => kind === "crm_update").at(-1)[1];
  assert.equal(terminalUpdate.Billing_Evaluation_Status, "Canceled");
  assert.equal(terminalUpdate.Billing_Automation_Status, "Evaluation Verified");
  assert.equal(Object.hasOwn(terminalUpdate, "Subscription_Status"), false);
});

test("customer verification never occupies paid subscription fields", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const verified = harness(config, context(config));
  const result = await verified.lifecycle.handle({
    action: "ensure_customer",
    dealId: "100000000000001",
  });
  assert.equal(result.outcome, "customer_readback_confirmed");
  const patch = verified.calls.find(([kind]) => kind === "crm_update")[1];
  assert.equal(patch.Billing_Customer_ID, "200000000000001");
  assert.equal(patch.Billing_Automation_Status, "Customer Verified");
  assert.equal(Object.hasOwn(patch, "Billing_Subscription_ID"), false);
  assert.equal(Object.hasOwn(patch, "Subscription_Status"), false);
});

test("reconcile reads evaluation and paid subscription IDs independently", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const reconciled = harness(config, context(config, {
    Billing_Customer_ID: "200000000000001",
    Billing_Evaluation_Subscription_ID: "300000000000001",
    Billing_Subscription_ID: "400000000000001",
  }));
  const result = await reconciled.lifecycle.handle({
    action: "reconcile",
    dealId: "100000000000001",
  });
  assert.equal(result.outcome, "authoritative_readback_confirmed");
  assert.deepEqual(
    reconciled.calls.filter(([kind]) => kind === "get_subscription"),
    [
      ["get_subscription", "300000000000001"],
      ["get_subscription", "400000000000001"],
    ],
  );
});
