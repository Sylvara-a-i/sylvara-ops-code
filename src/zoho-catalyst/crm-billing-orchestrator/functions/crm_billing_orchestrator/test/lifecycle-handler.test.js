"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const {
  TEST_CUSTOMER_PROVISIONING_ACTION,
  deriveOperationIdentity,
  deriveTestCustomerProvisioningIdentity,
} = require("../lib/idempotency");
const { createLifecycleHandler } = require("../lib/lifecycle-handler");
const { REVISION, baseEnvironment } = require("./helpers");

function context(config, overrides = {}) {
  const defaultTerms = config.paidCommercialTerms.plans["Growth::Monthly"];
  return {
    deal: {
      id: "100000000000001",
      Modified_Time: "2026-08-21T10:00:00-05:00",
      Deal_Name: "ZZZ SYNTHETIC Revenue Desk Acceptance",
      Pipeline: config.revenueDeskPipelineValue,
      Entry_Offer: config.freeTestEntryOfferValue,
      Type: config.initialSaleTypeValue,
      Stage: config.subscriptionProposedStageValue,
      Account_Name: { id: "100000000000002", name: "Synthetic Account" },
      Test_Status: config.testCompletedStatusValue,
      Plan: "Growth",
      Billing_Frequency: "Monthly",
      MRR: defaultTerms.recurringMinor / 100,
      Setup_Fee: defaultTerms.setupMinor / 100,
      Connected_AI_Minute_Rate: config.paidCommercialTerms.commonUsageRateMinor / 100,
      Subscription_Start_Date: "2026-09-01",
      Subscription_Acceptance_Status: config.paidAcceptanceValue,
      Subscription_Accepted_At: "2026-08-21T10:00:00-05:00",
      Subscription_Acceptance_Version: "paid-acceptance-v1",
      Results_Review_At: "2026-08-21T09:00:00-05:00",
      Billing_Customer_ID: null,
      Billing_Subscription_ID: null,
      Subscription_Status: null,
      Billing_Automation_Status: null,
      Billing_Last_Sync_At: null,
      Billing_Automation_Error: "Synthetic prior error",
      ...overrides,
    },
    account: {
      id: "100000000000002",
      Modified_Time: "2026-08-21T10:00:00-05:00",
      Account_Name: "ZZZ SYNTHETIC Account",
    },
  };
}

function paidIdentity(config, current) {
  const terms = config.paidCommercialTerms.plans[
    `${current.deal.Plan}::${current.deal.Billing_Frequency}`
  ];
  return deriveOperationIdentity(
    config,
    "prepare_paid_subscription",
    current.deal.id,
    {
      accepted: true,
      accountId: current.account.id,
      billingFrequency: current.deal.Billing_Frequency,
      billingOrganizationId: config.billingOrganizationId,
      currency: config.paidCommercialTerms.currency,
      interval: config.paidCommercialTerms.interval,
      intervalUnit: config.paidCommercialTerms.intervalUnit,
      plan: current.deal.Plan,
      planCode: config.paidPlanCodeMap[
        `${current.deal.Plan}::${current.deal.Billing_Frequency}`
      ],
      recurringMinor: terms.recurringMinor,
      resultsReviewAt: current.deal.Results_Review_At,
      setupMinor: terms.setupMinor,
      subscriptionAcceptanceVersion: current.deal.Subscription_Acceptance_Version,
      subscriptionAcceptedAt: current.deal.Subscription_Accepted_At,
      subscriptionStartDate: current.deal.Subscription_Start_Date,
      usageAddonCode: config.paidUsageAddonCode,
      usageAddonProductId: config.paidUsageAddonProductId,
      usageAddonUnit: config.paidUsageAddonUnit,
      usageRateMinor: config.paidCommercialTerms.commonUsageRateMinor,
    },
  );
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
      calls.push(["crm_read", contextReads]);
      return structuredClone(current);
    },
    updateDealIntegration: async (deal, patch) => {
      calls.push(["crm_update", patch]);
      if (typeof options.updateDeal === "function") return options.updateDeal(deal, patch);
      current.deal = {
        ...deal,
        ...patch,
        Modified_Time: "2026-08-21T10:01:00-05:00",
      };
      return structuredClone(current.deal);
    },
  };
  const billingClient = {
    ensureCustomer: async (input) => {
      calls.push(["customer", input]);
      if (typeof options.ensureCustomer === "function") return options.ensureCustomer(input);
      return { customer: { customer_id: "200000000000001" } };
    },
    ensurePaidSubscription: async (input) => {
      calls.push(["paid", input]);
      if (typeof options.ensurePaid === "function") return options.ensurePaid(input);
      return { subscription_id: "300000000000001", status: "live" };
    },
    findCustomerByCrmReference: async (accountId) => {
      calls.push(["find_customer", accountId]);
      if (typeof options.findCustomer === "function") return options.findCustomer(accountId);
      return { customer_id: "200000000000001" };
    },
    findVerifiedPaidSubscription: async (input) => {
      calls.push(["find_paid", input]);
      if (typeof options.findPaid === "function") return options.findPaid(input);
      return { subscription_id: "300000000000001", status: "live" };
    },
  };
  const operationStore = {
    claim: async (input) => {
      calls.push(["claim", input]);
      if (typeof options.claim === "function") return options.claim(input);
      return { outcome: "claimed", rowId: "1" };
    },
    readByKey: async (operationKey) => {
      calls.push(["read_operation", operationKey]);
      if (typeof options.readOperation === "function") {
        return options.readOperation(operationKey, structuredClone(current));
      }
      const provisioningIdentity = deriveTestCustomerProvisioningIdentity(
        config,
        current.account.id,
      );
      if (operationKey === provisioningIdentity.operationKey) {
        return {
          ROWID: "2",
          OPERATION_KEY: provisioningIdentity.operationKey,
          OPERATION_FINGERPRINT: provisioningIdentity.operationFingerprint,
          ACTION: TEST_CUSTOMER_PROVISIONING_ACTION,
          CRM_DEAL_ID: current.account.id,
          STATUS: "completed",
          SOURCE_REVISION: config.sourceRevision,
          SOURCE_ENVIRONMENT: config.deploymentEnvironment,
        };
      }
      const identity = paidIdentity(config, current);
      if (operationKey !== identity.operationKey) return null;
      return {
        ROWID: "1",
        OPERATION_KEY: identity.operationKey,
        OPERATION_FINGERPRINT: identity.operationFingerprint,
        ACTION: "prepare_paid_subscription",
        CRM_DEAL_ID: current.deal.id,
        STATUS: "completed",
        SOURCE_REVISION: config.sourceRevision,
        SOURCE_ENVIRONMENT: config.deploymentEnvironment,
      };
    },
    mark: async (...args) => {
      calls.push(["mark", ...args]);
      if (typeof options.mark === "function") return options.mark(...args);
      return undefined;
    },
  };
  return {
    calls,
    current: () => structuredClone(current),
    lifecycle: createLifecycleHandler(config, {
      crmClient,
      billingClient,
      operationStore,
      now: options.now ?? (() => Date.parse("2026-08-21T15:02:00.000Z")),
    }),
  };
}

test("all approved monthly plans bind exact terms and update CRM once after Billing readback", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  for (const terms of Object.values(config.paidCommercialTerms.plans)) {
    const plan = terms.plan;
    const selected = harness(config, context(config, {
      Plan: plan,
      MRR: terms.recurringMinor / 100,
      Setup_Fee: terms.setupMinor / 100,
    }));
    const result = await selected.lifecycle.handle({
      action: "prepare_paid_subscription",
      dealId: "100000000000001",
    });
    assert.equal(result.outcome, "paid_subscription_readback_confirmed");
    assert.equal(selected.calls.filter(([kind]) => kind === "customer").length, 1);
    assert.equal(selected.calls.filter(([kind]) => kind === "paid").length, 1);
    assert.equal(selected.calls.filter(([kind]) => kind === "crm_update").length, 1);
    const paidIndex = selected.calls.findIndex(([kind]) => kind === "paid");
    const updateIndex = selected.calls.findIndex(([kind]) => kind === "crm_update");
    assert.ok(updateIndex > paidIndex);
    const paidInput = selected.calls[paidIndex][1];
    assert.equal(paidInput.selectedPlanCode, config.paidPlanCodeMap[`${plan}::Monthly`]);
    assert.equal(paidInput.commercialTerms.recurringMinor, terms.recurringMinor);
    assert.equal(paidInput.commercialTerms.setupMinor, terms.setupMinor);
    const patch = selected.calls[updateIndex][1];
    assert.deepEqual(patch, {
      Billing_Customer_ID: "200000000000001",
      Billing_Subscription_ID: "300000000000001",
      Subscription_Status: "Active",
      Billing_Automation_Status: "Paid Verified",
      Billing_Last_Sync_At: "2026-08-21T15:02:00.000Z",
      Billing_Automation_Error: null,
    });
  }
});

test("missing, pending, declined, or premature acceptance never reaches Billing", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  for (const overrides of [
    { Subscription_Acceptance_Status: null },
    { Subscription_Acceptance_Status: "Pending" },
    { Subscription_Acceptance_Status: "Declined" },
    { Stage: "Setup and Authorization" },
    { Stage: "Setup and QA" },
    { Stage: "Test Live" },
    { Stage: "Results Review" },
    { Test_Status: "Live" },
  ]) {
    const rejected = harness(config, context(config, overrides));
    await assert.rejects(rejected.lifecycle.handle({
      action: "prepare_paid_subscription",
      dealId: "100000000000001",
    }), /explicit paid acceptance/);
    assert.equal(rejected.calls.some(([kind]) => kind === "claim"), false);
    assert.equal(rejected.calls.some(([kind]) => kind === "customer"), false);
    assert.equal(rejected.calls.some(([kind]) => kind === "paid"), false);
    assert.equal(rejected.calls.some(([kind]) => kind === "crm_update"), false);
  }
});

test("acceptance evidence, chronology, and ZZZ SYNTHETIC ownership fail closed before claim", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  for (const overrides of [
    { Subscription_Accepted_At: null },
    { Subscription_Acceptance_Version: null },
    { Results_Review_At: null },
    { Subscription_Acceptance_Version: "unsafe version" },
    { Results_Review_At: "2026-08-21T10:01:00-05:00" },
    { Subscription_Accepted_At: "2026-08-21T10:03:00-05:00" },
    { Deal_Name: "Acme Plumbing Paid Subscription" },
  ]) {
    const rejected = harness(config, context(config, overrides));
    await assert.rejects(rejected.lifecycle.handle({
      action: "prepare_paid_subscription",
      dealId: "100000000000001",
    }), /invalid|ZZZ SYNTHETIC/);
    assert.equal(rejected.calls.some(([kind]) => kind === "claim"), false);
  }

  const realAccount = context(config);
  realAccount.account.Account_Name = "Acme Plumbing";
  const rejectedAccount = harness(config, realAccount);
  await assert.rejects(rejectedAccount.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /ZZZ SYNTHETIC/);
  assert.equal(rejectedAccount.calls.some(([kind]) => kind === "claim"), false);
});

test("acceptance version is bound to the claimed paid operation", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const changed = harness(config, context(config), {
    onGetContext: (current, readNumber) => readNumber === 2
      ? {
        ...current,
        deal: { ...current.deal, Subscription_Acceptance_Version: "paid-acceptance-v2" },
      }
      : current,
  });
  await assert.rejects(changed.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /requires reconciliation/);
  assert.equal(changed.calls.some(([kind]) => kind === "paid"), false);
  assert.deepEqual(
    changed.calls.filter(([kind]) => kind === "mark").map(([, , status]) => status),
    ["reconciliation_required"],
  );
});

test("invalid commercial terms and dates fail before the operation claim", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const growth = config.paidCommercialTerms.plans["Growth::Monthly"];
  for (const overrides of [
    { Plan: "Enterprise" },
    { Billing_Frequency: "Annual" },
    { MRR: (growth.recurringMinor - 1) / 100 },
    { Setup_Fee: (growth.setupMinor - 1) / 100 },
    { Connected_AI_Minute_Rate:
      (config.paidCommercialTerms.commonUsageRateMinor + 1) / 100 },
    { Subscription_Start_Date: "2026-02-31" },
    { Subscription_Start_Date: "2026-08-20" },
    { Subscription_Start_Date: "2027-08-23" },
  ]) {
    const rejected = harness(config, context(config, overrides));
    await assert.rejects(rejected.lifecycle.handle({
      action: "prepare_paid_subscription",
      dealId: "100000000000001",
    }), /catalog|Subscription_Start_Date/);
    assert.equal(rejected.calls.some(([kind]) => kind === "claim"), false);
    assert.equal(rejected.calls.some(([kind]) => kind === "customer"), false);
    assert.equal(rejected.calls.some(([kind]) => kind === "paid"), false);
  }
});

test("the paid mutation kill switch preserves non-creating Billing reconciliation", async () => {
  const config = loadConfig(baseEnvironment({
    ENABLE_PAID_SUBSCRIPTION_PREPARATION: "false",
  }), { artifactRevision: REVISION });
  const disabled = harness(config, context(config));
  await assert.rejects(disabled.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /preparation is disabled/);
  assert.equal(disabled.calls.some(([kind]) => kind === "claim"), false);

  const reconciled = harness(config, context(config, {
    Billing_Customer_ID: "200000000000001",
    Billing_Subscription_ID: "300000000000001",
    Subscription_Status: "Active",
    Billing_Automation_Status: "Paid Verified",
    Billing_Last_Sync_At: "2026-08-21T15:01:00.000Z",
    Billing_Automation_Error: null,
  }));
  const result = await reconciled.lifecycle.handle({
    action: "reconcile",
    dealId: "100000000000001",
  });
  assert.equal(result.outcome, "authoritative_readback_confirmed");
  assert.equal(reconciled.calls.some(([kind]) => kind === "paid"), false);
  assert.equal(reconciled.calls.some(([kind]) => kind === "crm_update"), false);
});

test("customer provisioning never updates CRM before paid subscription readback", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const failed = harness(config, context(config), {
    ensurePaid: async () => {
      throw Object.assign(new Error("synthetic readback failure"), {
        ambiguous: false,
        publicCode: "billing_rejected",
      });
    },
  });
  await assert.rejects(failed.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /requires reconciliation/);
  assert.equal(failed.calls.filter(([kind]) => kind === "customer").length, 1);
  assert.equal(failed.calls.filter(([kind]) => kind === "crm_update").length, 0);
  assert.deepEqual(
    failed.calls.filter(([kind]) => kind === "mark").map(([, , status]) => status),
    ["reconciliation_required"],
  );
});

test("an unresolved paid claim never resumes mutation automatically", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const firstAttempt = harness(config, context(config), {
    ensureCustomer: async () => {
      throw Object.assign(new Error("synthetic dependency failure"), {
        ambiguous: false,
        publicCode: "billing_dependency_failed",
      });
    },
  });
  await assert.rejects(firstAttempt.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /requires reconciliation/);
  assert.deepEqual(
    firstAttempt.calls.filter(([kind]) => kind === "mark").map(([, rowId, status, outcome]) => (
      [rowId, status, outcome]
    )),
    [["1", "reconciliation_required", "billing_dependency_failed"]],
  );

  for (const unresolvedClaim of [
    { status: "processing", lastOutcome: "claimed" },
    { status: "reconciliation_required", lastOutcome: "billing_dependency_failed" },
    { status: "reconciliation_required", lastOutcome: "safe_prewrite_dependency_failed" },
  ]) {
    const blocked = harness(config, context(config), {
      claim: async () => ({
        outcome: "duplicate-unresolved",
        rowId: "1",
        sourceRevision: "b".repeat(40),
        sourceEnvironment: config.deploymentEnvironment,
        ...unresolvedClaim,
      }),
    });
    await assert.rejects(blocked.lifecycle.handle({
      action: "prepare_paid_subscription",
      dealId: "100000000000001",
    }), /requires reconciliation/);
    assert.equal(blocked.calls.some(([kind]) => kind === "customer"), false);
    assert.equal(blocked.calls.some(([kind]) => kind === "paid"), false);
  }
});

test("concurrent paid replays permit at most one subscription mutation boundary", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  let claimCount = 0;
  let subscriptionPostCount = 0;
  let releasePaid;
  let announcePaid;
  const paidEntered = new Promise((resolve) => { announcePaid = resolve; });
  const paidRelease = new Promise((resolve) => { releasePaid = resolve; });
  const concurrent = harness(config, context(config), {
    claim: async () => {
      claimCount += 1;
      return claimCount === 1
        ? { outcome: "claimed", rowId: "1" }
        : {
          outcome: "duplicate-unresolved",
          rowId: "1",
          status: "processing",
          lastOutcome: "claimed",
          sourceEnvironment: config.deploymentEnvironment,
          sourceRevision: config.sourceRevision,
        };
    },
    ensurePaid: async () => {
      // This method is the lifecycle's sole subscription-POST boundary.
      subscriptionPostCount += 1;
      announcePaid();
      await paidRelease;
      return { subscription_id: "300000000000001", status: "live" };
    },
  });

  const first = concurrent.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  });
  await paidEntered;
  await assert.rejects(concurrent.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /requires reconciliation/);
  releasePaid();
  assert.equal((await first).outcome, "paid_subscription_readback_confirmed");
  assert.equal(subscriptionPostCount, 1);
  assert.equal(concurrent.calls.filter(([kind]) => kind === "paid").length, 1);
  assert.equal(concurrent.calls.filter(([kind]) => kind === "crm_update").length, 1);
});

test("authoritative CRM state is revalidated after customer provisioning", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  for (const mutation of [
    (current) => ({ ...current, deal: { ...current.deal, Stage: "Results Review" } }),
    (current) => ({ ...current, deal: { ...current.deal, MRR: 750 } }),
    (current) => ({
      deal: {
        ...current.deal,
        Account_Name: { id: "100000000000003", name: "ZZZ SYNTHETIC Other Account" },
      },
      account: {
        ...current.account,
        id: "100000000000003",
        Account_Name: "ZZZ SYNTHETIC Other Account",
      },
    }),
  ]) {
    const changed = harness(config, context(config), {
      onGetContext: (current, readNumber) => readNumber === 2 ? mutation(current) : current,
    });
    await assert.rejects(changed.lifecycle.handle({
      action: "prepare_paid_subscription",
      dealId: "100000000000001",
    }), /requires reconciliation/);
    assert.equal(changed.calls.some(([kind]) => kind === "paid"), false);
    assert.equal(changed.calls.some(([kind]) => kind === "crm_update"), false);
    assert.deepEqual(
      changed.calls.filter(([kind]) => kind === "mark").map(([, , status]) => status),
      ["reconciliation_required"],
    );
  }
});

test("pre-existing or conflicting paid references cannot create a second subscription", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const existing = harness(config, context(config, {
    Billing_Subscription_ID: "300000000000009",
  }));
  await assert.rejects(existing.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /requires reconciliation/);
  assert.equal(existing.calls.some(([kind]) => kind === "customer"), false);
  assert.equal(existing.calls.some(([kind]) => kind === "paid"), false);

  const conflict = harness(config, context(config, {
    Billing_Customer_ID: "200000000000009",
  }));
  await assert.rejects(conflict.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /requires reconciliation/);
  assert.equal(conflict.calls.some(([kind]) => kind === "paid"), false);
  assert.deepEqual(
    conflict.calls.filter(([kind]) => kind === "mark").map(([, , status]) => status),
    ["reconciliation_required"],
  );
});

test("completed replay performs paid-only authoritative reconciliation without another create", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const replay = harness(config, context(config, {
    Billing_Customer_ID: "200000000000001",
    Billing_Subscription_ID: "300000000000001",
    Subscription_Status: "Active",
    Billing_Automation_Status: "Paid Verified",
    Billing_Last_Sync_At: "2026-08-21T15:01:00.000Z",
    Billing_Automation_Error: null,
  }), {
    claim: async () => ({ outcome: "duplicate-completed", rowId: "1" }),
  });
  const result = await replay.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  });
  assert.deepEqual(result, { outcome: "duplicate_completed", duplicate: true });
  assert.equal(replay.calls.some(([kind]) => kind === "customer"), false);
  assert.equal(replay.calls.some(([kind]) => kind === "paid"), false);
  assert.equal(replay.calls.filter(([kind]) => kind === "find_paid").length, 1);
  assert.equal(replay.calls.some(([kind]) => kind === "crm_update"), false);
});

test("reconciliation repairs CRM only after authoritative paid readback", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const repair = harness(config, context(config), {
    readOperation: (operationKey, current) => {
      const provision = deriveTestCustomerProvisioningIdentity(config, current.account.id);
      if (operationKey === provision.operationKey) {
        return {
          ROWID: "8",
          OPERATION_KEY: provision.operationKey,
          OPERATION_FINGERPRINT: provision.operationFingerprint,
          ACTION: TEST_CUSTOMER_PROVISIONING_ACTION,
          CRM_DEAL_ID: current.account.id,
          STATUS: "completed",
          SOURCE_REVISION: config.sourceRevision,
          SOURCE_ENVIRONMENT: config.deploymentEnvironment,
        };
      }
      const identity = paidIdentity(config, current);
      if (operationKey !== identity.operationKey) return null;
      return {
        ROWID: "7",
        OPERATION_KEY: identity.operationKey,
        OPERATION_FINGERPRINT: identity.operationFingerprint,
        ACTION: "prepare_paid_subscription",
        CRM_DEAL_ID: current.deal.id,
        STATUS: "reconciliation_required",
        SOURCE_REVISION: "b".repeat(40),
        SOURCE_ENVIRONMENT: config.deploymentEnvironment,
      };
    },
  });
  const result = await repair.lifecycle.handle({
    action: "reconcile",
    dealId: "100000000000001",
  });
  assert.equal(result.outcome, "authoritative_readback_confirmed");
  const findIndex = repair.calls.findIndex(([kind]) => kind === "find_paid");
  const updateIndex = repair.calls.findIndex(([kind]) => kind === "crm_update");
  assert.ok(updateIndex > findIndex);
  assert.equal(repair.calls.some(([kind]) => kind === "paid"), false);
  assert.deepEqual(
    repair.calls.filter(([kind]) => kind === "mark").map(([, rowId, status]) => [rowId, status]),
    [["7", "completed"]],
  );
});

test("next-day reconciliation accepts the operation-bound start date without reopening mutation", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const current = context(config, {
    Subscription_Start_Date: "2026-08-21",
    Billing_Customer_ID: "200000000000001",
    Billing_Subscription_ID: "300000000000001",
    Subscription_Status: "Active",
    Billing_Automation_Status: "Paid Verified",
    Billing_Last_Sync_At: "2026-08-21T15:01:00.000Z",
    Billing_Automation_Error: null,
  });
  const nextDay = () => Date.parse("2026-08-22T00:01:00.000Z");
  const delayed = harness(config, current, { now: nextDay });

  assert.equal((await delayed.lifecycle.handle({
    action: "reconcile",
    dealId: current.deal.id,
  })).outcome, "authoritative_readback_confirmed");
  assert.equal(delayed.calls.some(([kind]) => kind === "claim"), false);
  assert.equal(delayed.calls.some(([kind]) => kind === "customer"), false);
  assert.equal(delayed.calls.some(([kind]) => kind === "paid"), false);
  assert.equal(delayed.calls.some(([kind]) => kind === "crm_update"), false);
  assert.equal(delayed.calls.filter(([kind]) => kind === "find_paid").length, 1);

  const newMutation = harness(config, context(config, {
    Subscription_Start_Date: "2026-08-21",
  }), { now: nextDay });
  await assert.rejects(newMutation.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: current.deal.id,
  }), /Subscription_Start_Date is outside the approved range/);
  assert.equal(newMutation.calls.some(([kind]) => kind === "claim"), false);
  assert.equal(newMutation.calls.some(([kind]) => kind === "customer"), false);
  assert.equal(newMutation.calls.some(([kind]) => kind === "paid"), false);
});

test("exact processing paid and customer rows converge through non-creating readback", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const current = context(config, {
    Billing_Customer_ID: "200000000000001",
    Billing_Subscription_ID: "300000000000001",
    Subscription_Status: "Active",
    Billing_Automation_Status: "Paid Verified",
    Billing_Last_Sync_At: "2026-08-21T15:01:00.000Z",
    Billing_Automation_Error: null,
  });
  const paid = paidIdentity(config, current);
  const provision = deriveTestCustomerProvisioningIdentity(config, current.account.id);
  const processing = harness(config, current, {
    readOperation: (operationKey) => {
      if (operationKey === paid.operationKey) return {
        ROWID: "1",
        OPERATION_KEY: paid.operationKey,
        OPERATION_FINGERPRINT: paid.operationFingerprint,
        ACTION: "prepare_paid_subscription",
        CRM_DEAL_ID: current.deal.id,
        STATUS: "processing",
        SOURCE_REVISION: "b".repeat(40),
        SOURCE_ENVIRONMENT: config.deploymentEnvironment,
      };
      if (operationKey === provision.operationKey) return {
        ROWID: "2",
        OPERATION_KEY: provision.operationKey,
        OPERATION_FINGERPRINT: provision.operationFingerprint,
        ACTION: TEST_CUSTOMER_PROVISIONING_ACTION,
        CRM_DEAL_ID: current.account.id,
        STATUS: "processing",
        SOURCE_REVISION: "c".repeat(40),
        SOURCE_ENVIRONMENT: config.deploymentEnvironment,
      };
      return null;
    },
  });
  assert.equal((await processing.lifecycle.handle({
    action: "reconcile",
    dealId: current.deal.id,
  })).outcome, "authoritative_readback_confirmed");
  assert.equal(processing.calls.some(([kind]) => kind === "customer"), false);
  assert.equal(processing.calls.some(([kind]) => kind === "paid"), false);
  assert.deepEqual(
    processing.calls.filter(([kind]) => kind === "mark").map(([, rowId, status]) => [rowId, status]),
    [["2", "completed"], ["1", "completed"]],
  );
});

test("non-creating reconciliation leaves unresolved claims untouched when resources do not exist", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const current = context(config);
  const paid = paidIdentity(config, current);
  const provision = deriveTestCustomerProvisioningIdentity(config, current.account.id);
  const missing = harness(config, current, {
    readOperation: (operationKey) => {
      const selected = operationKey === paid.operationKey
        ? ["1", paid, "prepare_paid_subscription", current.deal.id]
        : ["2", provision, TEST_CUSTOMER_PROVISIONING_ACTION, current.account.id];
      return {
        ROWID: selected[0],
        OPERATION_KEY: selected[1].operationKey,
        OPERATION_FINGERPRINT: selected[1].operationFingerprint,
        ACTION: selected[2],
        CRM_DEAL_ID: selected[3],
        STATUS: "processing",
        SOURCE_REVISION: config.sourceRevision,
        SOURCE_ENVIRONMENT: config.deploymentEnvironment,
      };
    },
    findCustomer: async () => null,
  });

  await assert.rejects(missing.lifecycle.handle({
    action: "reconcile",
    dealId: current.deal.id,
  }), /Billing customer is missing/);
  assert.equal(missing.calls.some(([kind]) => kind === "customer"), false);
  assert.equal(missing.calls.some(([kind]) => kind === "paid"), false);
  assert.equal(missing.calls.some(([kind]) => kind === "find_paid"), false);
  assert.equal(missing.calls.some(([kind]) => kind === "crm_update"), false);
  assert.equal(missing.calls.some(([kind]) => kind === "mark"), false);
});

test("reconciliation requires a valid audit SHA but not the current revision", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const current = context(config, {
    Billing_Customer_ID: "200000000000001",
    Billing_Subscription_ID: "300000000000001",
    Subscription_Status: "Active",
    Billing_Automation_Status: "Paid Verified",
    Billing_Last_Sync_At: "2026-08-21T15:01:00.000Z",
    Billing_Automation_Error: null,
  });
  const paid = paidIdentity(config, current);
  const provision = deriveTestCustomerProvisioningIdentity(config, current.account.id);
  function row(identity, action, scopeId, sourceRevision) {
    return {
      ROWID: action === "prepare_paid_subscription" ? "1" : "2",
      OPERATION_KEY: identity.operationKey,
      OPERATION_FINGERPRINT: identity.operationFingerprint,
      ACTION: action,
      CRM_DEAL_ID: scopeId,
      STATUS: "completed",
      SOURCE_REVISION: sourceRevision,
      SOURCE_ENVIRONMENT: config.deploymentEnvironment,
    };
  }
  for (const [paidRevision, provisionRevision] of [
    ["not-a-sha", "b".repeat(40)],
    ["b".repeat(40), "C".repeat(40)],
  ]) {
    const invalid = harness(config, current, {
      readOperation: (operationKey) => operationKey === paid.operationKey
        ? row(paid, "prepare_paid_subscription", current.deal.id, paidRevision)
        : row(provision, TEST_CUSTOMER_PROVISIONING_ACTION, current.account.id, provisionRevision),
    });
    await assert.rejects(invalid.lifecycle.handle({
      action: "reconcile",
      dealId: current.deal.id,
    }), /operation is unresolved/);
    assert.equal(invalid.calls.some(([kind]) => kind === "find_customer"), false);
  }
});

test("direct TEST reconciliation requires its exact completed Account claim", async () => {
  const config = loadConfig(baseEnvironment({
    CUSTOMER_PROVISIONING_MODE: "test_direct_customer",
    ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "true",
  }), { artifactRevision: REVISION });
  const current = context(config, {
    Billing_Customer_ID: "200000000000001",
    Billing_Subscription_ID: "300000000000001",
    Subscription_Status: "Active",
    Billing_Automation_Status: "Paid Verified",
    Billing_Last_Sync_At: "2026-08-21T15:01:00.000Z",
    Billing_Automation_Error: null,
  });
  const paid = paidIdentity(config, current);
  const provision = deriveTestCustomerProvisioningIdentity(config, current.account.id);
  const validProvision = {
    ROWID: "2",
    OPERATION_KEY: provision.operationKey,
    OPERATION_FINGERPRINT: provision.operationFingerprint,
    ACTION: TEST_CUSTOMER_PROVISIONING_ACTION,
    CRM_DEAL_ID: current.account.id,
    STATUS: "completed",
    SOURCE_REVISION: "b".repeat(40),
    SOURCE_ENVIRONMENT: config.deploymentEnvironment,
  };
  const readOperation = (operationKey) => {
    if (operationKey === paid.operationKey) return {
      ROWID: "1",
      OPERATION_KEY: paid.operationKey,
      OPERATION_FINGERPRINT: paid.operationFingerprint,
      ACTION: "prepare_paid_subscription",
      CRM_DEAL_ID: current.deal.id,
      STATUS: "completed",
      SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: config.deploymentEnvironment,
    };
    if (operationKey === provision.operationKey) return validProvision;
    return null;
  };
  const verified = harness(config, current, { readOperation });
  assert.equal((await verified.lifecycle.handle({
    action: "reconcile",
    dealId: current.deal.id,
  })).outcome, "authoritative_readback_confirmed");

  const recoverable = harness(config, current, {
    readOperation: (operationKey) => operationKey === provision.operationKey
      ? { ...validProvision, STATUS: "reconciliation_required" }
      : readOperation(operationKey),
  });
  assert.equal((await recoverable.lifecycle.handle({
    action: "reconcile",
    dealId: current.deal.id,
  })).outcome, "authoritative_readback_confirmed");
  assert.deepEqual(
    recoverable.calls.filter(([kind]) => kind === "mark").map(([, rowId, status]) => [rowId, status]),
    [["2", "completed"]],
  );

  const missing = harness(config, current, {
    readOperation: (operationKey) => operationKey === paid.operationKey
      ? readOperation(operationKey)
      : null,
  });
  await assert.rejects(missing.lifecycle.handle({
    action: "reconcile",
    dealId: current.deal.id,
  }), /customer provisioning operation is unresolved/);
});

test("an uncertain completion mark is never followed by a second terminal write", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const uncertain = harness(config, context(config), {
    mark: async (_rowId, status) => {
      if (status === "completed") throw new Error("synthetic uncertain completion");
    },
  });
  await assert.rejects(uncertain.lifecycle.handle({
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /completion requires reconciliation/);
  assert.deepEqual(
    uncertain.calls.filter(([kind]) => kind === "mark").map(([, , status]) => status),
    ["completed"],
  );
});
