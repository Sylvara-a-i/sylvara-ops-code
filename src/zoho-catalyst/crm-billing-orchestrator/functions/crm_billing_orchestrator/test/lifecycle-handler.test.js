"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const { createLifecycleHandler } = require("../lib/lifecycle-handler");
const { REVISION, baseEnvironment } = require("./helpers");

function paidEnabledConfig() {
  const base = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  return Object.freeze({
    ...base,
    enablePaidSubscriptionPreparation: true,
    paidPlanCodeMap: Object.freeze({ "Launch::Monthly": "launch_plan" }),
  });
}

function context(config, overrides = {}) {
  return {
    deal: {
      id: "100000000000001",
      Modified_Time: "2026-08-21T10:00:00-05:00",
      Pipeline: config.revenueDeskPipelineValue,
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

function harness(config, initialContext, options = {}) {
  let current = structuredClone(initialContext);
  let contextReads = 0;
  const calls = [];
  const crmClient = {
    getContext: async () => {
      contextReads += 1;
      if (typeof options.onGetContext === "function") {
        current = options.onGetContext(structuredClone(current), contextReads) ?? current;
      }
      return structuredClone(current);
    },
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
    ensureCustomer: async () => {
      calls.push(["customer"]);
      return { customer: {
        customer_id: "200000000000001",
        zcrm_account_id: current.account.id,
      } };
    },
    ensureEvaluationSubscription: async (input) => {
      calls.push(["evaluation", input]);
      return { subscription_id: "300000000000001" };
    },
    ensurePaidSubscription: async (input) => {
      calls.push(["paid", input]);
      return { subscription_id: "400000000000001" };
    },
    cancelEvaluation: async (input) => {
      calls.push(["cancel", input]);
      return { subscription_id: input.subscriptionId, status: "cancelled" };
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
    claim: async () => {
      calls.push(["claim"]);
      return { outcome: "claimed", rowId: "1" };
    },
    mark: async (...args) => {
      calls.push(["mark", ...args]);
      if (typeof options.mark === "function") return options.mark(...args);
      return undefined;
    },
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
  const { lifecycle, calls } = harness(config, context(config, {
    Stage: config.setupQaStageValue,
  }));
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
  const config = paidEnabledConfig();
  const rejected = harness(config, context(config, {
    Stage: config.subscriptionProposedStageValue,
    Test_Status: config.testCompletedStatusValue,
  }));
  await assert.rejects(rejected.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /explicit paid acceptance/);
  assert.equal(rejected.calls.some(([kind]) => kind === "claim"), false);
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
  assert.equal(paidInput.subscriptionStartDate, "2026-09-01");
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

  for (const invalidDate of ["2026-02-31", "2026-08-20", "2027-08-23"]) {
    const invalidStart = harness(config, context(config, {
      Stage: config.subscriptionProposedStageValue,
      Test_Status: config.testCompletedStatusValue,
      Subscription_Acceptance_Status: config.paidAcceptanceValue,
      Subscription_Start_Date: invalidDate,
    }));
    await assert.rejects(invalidStart.lifecycle.handle({
      action: "prepare_paid_subscription",
      dealId: "100000000000001",
    }), /Subscription_Start_Date/);
    assert.equal(invalidStart.calls.some(([kind]) => kind === "paid"), false);
  }
});

test("paid subscription preparation is impossible while the Development gate is disabled", async () => {
  const config = loadConfig(baseEnvironment({
    ENABLE_PAID_SUBSCRIPTION_PREPARATION: "false",
    PAID_PLAN_CODE_MAP: "{}",
  }), { artifactRevision: REVISION });
  const disabled = harness(config, context(config, {
    Stage: config.subscriptionProposedStageValue,
    Test_Status: config.testCompletedStatusValue,
    Subscription_Acceptance_Status: config.paidAcceptanceValue,
  }));
  await assert.rejects(disabled.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /preparation is disabled/);
  assert.equal(disabled.calls.some(([kind]) => kind === "claim"), false);
  assert.equal(disabled.calls.some(([kind]) => kind === "paid"), false);
  assert.equal(disabled.calls.some(([kind]) => kind === "crm_update"), false);
});

test("end_evaluation requires terminal CRM evidence before cancellation", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const approved = harness(config, context(config, {
    Stage: config.testLiveStageValue,
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
  const cancellation = approved.calls.find(([kind]) => kind === "cancel")[1];
  assert.equal(cancellation.subscriptionId, "300000000000001");
  assert.equal(cancellation.customerId, "200000000000001");
  assert.match(cancellation.deterministicReference, /^syl-evaluation-[a-f0-9]{32}$/);
  const terminalUpdate = approved.calls.filter(([kind]) => kind === "crm_update").at(-1)[1];
  assert.equal(terminalUpdate.Billing_Evaluation_Status, "Ended");
  assert.equal(terminalUpdate.Billing_Automation_Status, "Evaluation Verified");
  assert.equal(Object.hasOwn(terminalUpdate, "Subscription_Status"), false);
});

test("evaluation mutations fail closed outside their pre-transition stages", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const prematureStart = harness(config, context(config, {
    Stage: "Test Authorized",
  }));
  await assert.rejects(prematureStart.lifecycle.handle({
    action: "start_evaluation",
    dealId: "100000000000001",
  }), /not approved to start/);
  assert.equal(prematureStart.calls.some(([kind]) => kind === "claim"), false);
  assert.equal(prematureStart.calls.some(([kind]) => kind === "evaluation"), false);

  const prematureEnd = harness(config, context(config, {
    Stage: config.setupQaStageValue,
    Test_End_At: "2026-08-28T10:00:00-05:00",
    Test_End_Reason: "Configured limit reached",
    Billing_Customer_ID: "200000000000001",
    Billing_Evaluation_Subscription_ID: "300000000000001",
  }));
  await assert.rejects(prematureEnd.lifecycle.handle({
    action: "end_evaluation",
    dealId: "100000000000001",
  }), /not approved to end/);
  assert.equal(prematureEnd.calls.some(([kind]) => kind === "claim"), false);
  assert.equal(prematureEnd.calls.some(([kind]) => kind === "cancel"), false);

  const wrongPipeline = harness(config, context(config, {
    Pipeline: "Another Pipeline",
    Stage: config.setupQaStageValue,
  }));
  await assert.rejects(wrongPipeline.lifecycle.handle({
    action: "start_evaluation",
    dealId: "100000000000001",
  }), /outside the approved free-test lifecycle/);
  assert.equal(wrongPipeline.calls.some(([kind]) => kind === "claim"), false);
});

test("pre-existing CRM subscription IDs cannot trigger a second Billing create", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const existingEvaluation = harness(config, context(config, {
    Stage: config.setupQaStageValue,
    Billing_Evaluation_Subscription_ID: "300000000000001",
  }));
  await assert.rejects(existingEvaluation.lifecycle.handle({
    action: "start_evaluation",
    dealId: "100000000000001",
  }), /requires reconciliation/);
  assert.equal(existingEvaluation.calls.some(([kind]) => kind === "customer"), false);
  assert.equal(existingEvaluation.calls.some(([kind]) => kind === "evaluation"), false);

  const paidConfig = paidEnabledConfig();
  const existingPaid = harness(paidConfig, context(paidConfig, {
    Stage: paidConfig.subscriptionProposedStageValue,
    Test_Status: paidConfig.testCompletedStatusValue,
    Subscription_Acceptance_Status: paidConfig.paidAcceptanceValue,
    Billing_Subscription_ID: "400000000000001",
  }));
  await assert.rejects(existingPaid.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /requires reconciliation/);
  assert.equal(existingPaid.calls.some(([kind]) => kind === "customer"), false);
  assert.equal(existingPaid.calls.some(([kind]) => kind === "paid"), false);
});

test("subscription creation revalidates authoritative CRM state after customer synchronization", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const changedStage = harness(config, context(config, {
    Stage: config.setupQaStageValue,
  }), {
    onGetContext: (current, readNumber) => readNumber === 2 ? {
      ...current,
      deal: { ...current.deal, Stage: "Test Authorized" },
    } : current,
  });
  await assert.rejects(changedStage.lifecycle.handle({
    action: "start_evaluation",
    dealId: "100000000000001",
  }), /not approved to start/);
  assert.equal(changedStage.calls.some(([kind]) => kind === "evaluation"), false);

  const concurrentSubscription = harness(config, context(config, {
    Stage: config.setupQaStageValue,
  }), {
    onGetContext: (current, readNumber) => readNumber === 2 ? {
      ...current,
      deal: {
        ...current.deal,
        Billing_Evaluation_Subscription_ID: "300000000000001",
      },
    } : current,
  });
  await assert.rejects(concurrentSubscription.lifecycle.handle({
    action: "start_evaluation",
    dealId: "100000000000001",
  }), /requires reconciliation/);
  assert.equal(concurrentSubscription.calls.some(([kind]) => kind === "evaluation"), false);

  const changedAccount = harness(config, context(config, {
    Stage: config.setupQaStageValue,
  }), {
    onGetContext: (current, readNumber) => readNumber === 2 ? {
      deal: {
        ...current.deal,
        Account_Name: { id: "100000000000003", name: "Other Synthetic Account" },
      },
      account: {
        ...current.account,
        id: "100000000000003",
        Account_Name: "Other Synthetic Account",
      },
    } : current,
  });
  await assert.rejects(changedAccount.lifecycle.handle({
    action: "start_evaluation",
    dealId: "100000000000001",
  }), /Account relationship changed/);
  assert.equal(changedAccount.calls.some(([kind]) => kind === "evaluation"), false);
});

test("an uncertain completed mark is never followed by a second terminal write", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const uncertain = harness(config, context(config), {
    mark: async (_rowId, status) => {
      if (status === "completed") throw new Error("synthetic uncertain completion");
    },
  });
  await assert.rejects(uncertain.lifecycle.handle({
    action: "ensure_customer",
    dealId: "100000000000001",
  }), /completion requires reconciliation/);
  assert.deepEqual(
    uncertain.calls.filter(([kind]) => kind === "mark").map(([, , status]) => status),
    ["completed"],
  );
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
