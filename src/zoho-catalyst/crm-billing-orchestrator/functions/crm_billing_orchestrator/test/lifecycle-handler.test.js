"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const { CANONICAL_PLAN_BY_CRM_API_VALUE } = require("../lib/crm-client");
const {
  TEST_CUSTOMER_PROVISIONING_ACTION,
  deriveOperationIdentity,
  deriveTestCustomerProvisioningIdentity,
} = require("../lib/idempotency");
const { createLifecycleHandler } = require("../lib/lifecycle-handler");
const { reportSummaryIdentity, reportSummaryPatch } = require("../lib/report-summary");
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
      Plan: "Option 2",
      Billing_Frequency: "Monthly",
      Monthly_Recurring_Revenue: defaultTerms.recurringMinor / 100,
      Setup_Fee: defaultTerms.setupMinor / 100,
      Subscription_Start_Date: "2026-09-01",
      Subscription_Acceptance_Status: config.paidAcceptanceValue,
      Subscription_Accepted_At: "2026-08-21T10:00:00-05:00",
      Subscription_Acceptance_Version: config.paidCommercialTerms.acceptanceVersion,
      Results_Review_At: "2026-08-21T09:00:00-05:00",
      Deployment_Record_ID: "deployment_A",
      Configuration_Version: "cfg_A_v1",
      Approved_Deployment_Record_ID: "deployment_A",
      Approved_Configuration_Version: "cfg_A_v1",
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
  const plan = CANONICAL_PLAN_BY_CRM_API_VALUE[current.deal.Plan];
  const terms = config.paidCommercialTerms.plans[
    `${plan}::${current.deal.Billing_Frequency}`
  ];
  return deriveOperationIdentity(
    config,
    "prepare_paid_subscription",
    current.deal.id,
    {
      accountId: current.account.id,
      billingFrequency: current.deal.Billing_Frequency,
      billingOrganizationId: config.billingOrganizationId,
      currency: config.paidCommercialTerms.currency,
      interval: config.paidCommercialTerms.interval,
      intervalUnit: config.paidCommercialTerms.intervalUnit,
      plan,
      planCode: config.paidPlanCodeMap[
        `${plan}::${current.deal.Billing_Frequency}`
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
      deploymentId: current.deal.Deployment_Record_ID,
      configurationVersion: current.deal.Configuration_Version,
    },
  );
}

function terminalSummary(overrides = {}) {
  return {
    schemaVersion: 2,
    dealId: "100000000000001",
    deploymentId: "deployment_A",
    configurationVersion: "cfg_A_v1",
    reportSchemaVersion: 2,
    callSetDigest: "c".repeat(64),
    testStatus: "Completed",
    testStartAt: "2026-08-21T15:00:00.000Z",
    testEndAt: "2026-08-22T16:00:00.000Z",
    testEndReason: "Call Limit Reached",
    callTotalsReconciled: true,
    callsCaptured: 25,
    qualifiedOpportunities: 8,
    existingCustomerCalls: 4,
    actualAverageCallDurationSeconds: 60.6,
    outOfAreaOrWrongFitCalls: 2,
    urgentRequests: 3,
    bookableOpportunities: 6,
    officeFollowUpCalls: 2,
    observedWorkflowFailures: 1,
    recommendedPaidCoverage: "After Hours + Overflow",
    expectedMonthlyConnectedMinutesMin: 100.9,
    expectedMonthlyConnectedMinutesMax: 200.1,
    dataConfidenceNotes: "Synthetic terminal evidence is complete.",
    ...overrides,
  };
}

function reportOperation(config, selectedSummary, status = "pending") {
  const identity = reportSummaryIdentity(config, selectedSummary);
  const lastOutcome = {
    pending: "terminal_report_ready",
    processing: `report_write_started_${"1".repeat(32)}`,
    reconciliation_required: "report_summary_readback_required",
    completed: "report_summary_readback_confirmed",
  }[status];
  return {
    ROWID: "9",
    OPERATION_KEY: identity.operationKey,
    OPERATION_FINGERPRINT: identity.operationFingerprint,
    ACTION: "sync_report_summary",
    CRM_DEAL_ID: selectedSummary.dealId,
    STATUS: status,
    SOURCE_REVISION: config.sourceRevision,
    SOURCE_ENVIRONMENT: config.deploymentEnvironment,
    LAST_OUTCOME: lastOutcome,
    OPERATION_PAYLOAD_JSON: JSON.stringify(selectedSummary),
    OPERATION_VERSION: status === "pending" ? 1 : 3,
    CREATED_AT: "2026-08-22T16:00:00.000Z",
    UPDATED_AT: "2026-08-22T16:00:00.000Z",
  };
}

function unreviewedReportDeal(overrides = {}) {
  return {
    Plan: null,
    Results_Review_At: null,
    Subscription_Acceptance_Status: null,
    Subscription_Accepted_At: null,
    Billing_Customer_ID: null,
    Billing_Subscription_ID: null,
    ...overrides,
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
    updateDealReportSummary: async (deal, patch) => {
      calls.push(["crm_report_update", patch]);
      if (typeof options.updateDealReportSummary === "function") {
        return options.updateDealReportSummary(deal, patch);
      }
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
    claimReportSummary: async (...args) => {
      calls.push(["claim_report", ...args]);
      if (typeof options.claimReportSummary === "function") {
        return options.claimReportSummary(...args);
      }
      return {
        claimed: true,
        row: {
          ...args[0],
          STATUS: "processing",
          LAST_OUTCOME: args[1],
          OPERATION_VERSION: Number(args[0].OPERATION_VERSION) + 1,
          UPDATED_AT: args[2],
        },
      };
    },
    beginReportSummaryWrite: async (...args) => {
      calls.push(["begin_report_write", ...args]);
      if (typeof options.beginReportSummaryWrite === "function") {
        return options.beginReportSummaryWrite(...args);
      }
      return {
        started: true,
        row: {
          ...args[0],
          LAST_OUTCOME: args[1].replace("report_claim_", "report_write_started_"),
          OPERATION_VERSION: Number(args[0].OPERATION_VERSION) + 1,
          UPDATED_AT: args[2],
        },
      };
    },
    transitionReportSummary: async (...args) => {
      calls.push(["report_transition", ...args]);
      if (typeof options.reportTransition === "function") {
        return options.reportTransition(...args);
      }
      return {
        transitioned: true,
        row: {
          ...args[0],
          STATUS: args[1],
          LAST_OUTCOME: args[2],
          OPERATION_VERSION: Number(args[0].OPERATION_VERSION) + 1,
          UPDATED_AT: args[3],
        },
      };
    },
    mark: async (...args) => {
      calls.push(["mark", ...args]);
      if (typeof options.mark === "function") return options.mark(...args);
      return undefined;
    },
  };
  const analyticsOutbox = {
    ensureConversionStatus: async (...args) => {
      calls.push(["analytics", ...args]);
      if (typeof options.ensureConversionStatus === "function") {
        return options.ensureConversionStatus(...args);
      }
      return { inserted: true, row: { RECORD_TYPE: "conversion_status" } };
    },
  };
  return {
    calls,
    current: () => structuredClone(current),
    lifecycle: createLifecycleHandler(config, {
      crmClient,
      billingClient,
      operationStore,
      analyticsOutbox,
      now: options.now ?? (() => Date.parse("2026-08-21T15:02:00.000Z")),
    }),
  };
}

test("report summary claims once, writes exact fields without Plan, and leaves human review untouched", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const selectedSummary = terminalSummary();
  const operation = reportOperation(config, selectedSummary);
  const selected = harness(config, context(config, unreviewedReportDeal({
    Stage: "Test Live",
    Test_Status: "Live",
  })), {
    readOperation: async () => operation,
  });
  const result = await selected.lifecycle.handle({
    action: "sync_report_summary",
    dealId: selectedSummary.dealId,
    operationKey: operation.OPERATION_KEY,
  });
  assert.equal(result.outcome, "report_summary_readback_confirmed");
  assert.equal(selected.calls.filter(([kind]) => kind === "claim_report").length, 1);
  assert.equal(selected.calls.filter(([kind]) => kind === "crm_report_update").length, 1);
  const patch = selected.calls.find(([kind]) => kind === "crm_report_update")[1];
  assert.equal(Object.hasOwn(patch, "Stage"), false);
  assert.equal(Object.hasOwn(patch, "Results_Review_At"), false);
  assert.equal(selected.current().deal.Results_Review_At, null);
  assert.equal(selected.current().deal.Stage, "Test Live");
  assert.equal(selected.current().deal.Test_Status, "Completed");
});

test("a pre-write report claim left by a crashed execution is safely reclaimed", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const selectedSummary = terminalSummary();
  let operation = {
    ...reportOperation(config, selectedSummary, "processing"),
    LAST_OUTCOME: `report_claim_${"1".repeat(32)}`,
    OPERATION_VERSION: 2,
  };
  const selected = harness(
    config,
    context(config, unreviewedReportDeal({ Test_Status: "Live" })),
    {
      readOperation: async () => structuredClone(operation),
      claimReportSummary: async (_current, claimToken, claimedAt) => {
        operation = {
          ...operation,
          LAST_OUTCOME: claimToken,
          OPERATION_VERSION: operation.OPERATION_VERSION + 1,
          UPDATED_AT: claimedAt,
        };
        return { claimed: true, row: structuredClone(operation) };
      },
      beginReportSummaryWrite: async (_current, claimToken, startedAt) => {
        operation = {
          ...operation,
          LAST_OUTCOME: claimToken.replace("report_claim_", "report_write_started_"),
          OPERATION_VERSION: operation.OPERATION_VERSION + 1,
          UPDATED_AT: startedAt,
        };
        return { started: true, row: structuredClone(operation) };
      },
      reportTransition: async (cursor, status, lastOutcome, transitionedAt) => {
        operation = {
          ...operation,
          STATUS: status,
          LAST_OUTCOME: lastOutcome,
          OPERATION_VERSION: Number(cursor.OPERATION_VERSION) + 1,
          UPDATED_AT: transitionedAt,
        };
        return { transitioned: true, row: structuredClone(operation) };
      },
    },
  );

  const result = await selected.lifecycle.handle({
    action: "sync_report_summary",
    dealId: selectedSummary.dealId,
    operationKey: operation.OPERATION_KEY,
  });
  assert.equal(result.outcome, "report_summary_readback_confirmed");
  assert.equal(selected.calls.filter(([kind]) => kind === "claim_report").length, 1);
  assert.equal(selected.calls.filter(([kind]) => kind === "begin_report_write").length, 1);
  assert.equal(selected.calls.filter(([kind]) => kind === "crm_report_update").length, 1);
  assert.equal(operation.STATUS, "completed");
  assert.equal(operation.LAST_OUTCOME, "report_summary_readback_confirmed");
});

test("an ambiguous CRM report PUT is never repeated automatically", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const selectedSummary = terminalSummary();
  let operation = reportOperation(config, selectedSummary);
  const selected = harness(
    config,
    context(config, unreviewedReportDeal({ Test_Status: "Live" })),
    {
      readOperation: async () => structuredClone(operation),
      claimReportSummary: async (_current, claimToken, claimedAt) => {
        operation = {
          ...operation,
          STATUS: "processing",
          LAST_OUTCOME: claimToken,
          OPERATION_VERSION: operation.OPERATION_VERSION + 1,
          UPDATED_AT: claimedAt,
        };
        return { claimed: true, row: structuredClone(operation) };
      },
      beginReportSummaryWrite: async (_current, claimToken, startedAt) => {
        operation = {
          ...operation,
          LAST_OUTCOME: claimToken.replace("report_claim_", "report_write_started_"),
          OPERATION_VERSION: operation.OPERATION_VERSION + 1,
          UPDATED_AT: startedAt,
        };
        return { started: true, row: structuredClone(operation) };
      },
      updateDealReportSummary: async () => {
        throw new Error("synthetic ambiguous CRM PUT");
      },
      reportTransition: async (cursor, status, lastOutcome, transitionedAt) => {
        operation = {
          ...operation,
          STATUS: status,
          LAST_OUTCOME: lastOutcome,
          OPERATION_VERSION: Number(cursor.OPERATION_VERSION) + 1,
          UPDATED_AT: transitionedAt,
        };
        return { transitioned: true, row: structuredClone(operation) };
      },
    },
  );

  const payload = {
    action: "sync_report_summary",
    dealId: selectedSummary.dealId,
    operationKey: operation.OPERATION_KEY,
  };
  await assert.rejects(
    selected.lifecycle.handle(payload),
    (error) => error.publicCode === "reconciliation_required",
  );
  assert.equal(operation.STATUS, "reconciliation_required");
  assert.equal(operation.LAST_OUTCOME, "report_summary_readback_required");
  await assert.rejects(
    selected.lifecycle.handle(payload),
    (error) => error.publicCode === "reconciliation_required",
  );
  assert.equal(selected.calls.filter(([kind]) => kind === "crm_report_update").length, 1);
  assert.equal(selected.calls.filter(([kind]) => kind === "begin_report_write").length, 1);
});

test("write-started report operation never writes again and only exact CRM readback can complete it", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const selectedSummary = terminalSummary();
  const operation = reportOperation(config, selectedSummary, "processing");
  const unresolved = harness(config, context(config, unreviewedReportDeal()), {
    readOperation: async () => operation,
  });
  await assert.rejects(() => unresolved.lifecycle.handle({
    action: "sync_report_summary", dealId: selectedSummary.dealId,
    operationKey: operation.OPERATION_KEY,
  }), (error) => error.publicCode === "reconciliation_required");
  assert.equal(unresolved.calls.some(([kind]) => kind === "crm_report_update"), false);
  assert.equal(unresolved.calls.some(([kind]) => kind === "claim_report"), false);

  const exactPatch = reportSummaryPatch(config, selectedSummary);
  const reconciled = harness(config, context(config, unreviewedReportDeal({
    ...exactPatch,
    Test_Start_At: "2026-08-21T10:00:00-05:00",
    Test_End_At: "2026-08-22T11:00:00-05:00",
  })), { readOperation: async () => operation });
  const result = await reconciled.lifecycle.handle({
    action: "sync_report_summary", dealId: selectedSummary.dealId,
    operationKey: operation.OPERATION_KEY,
  });
  assert.equal(result.duplicate, true);
  assert.equal(reconciled.calls.some(([kind]) => kind === "crm_report_update"), false);
  assert.equal(reconciled.calls.some(([kind]) => kind === "report_transition"), true);
});

test("report completion requires an explicit null nullable field", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const selectedSummary = terminalSummary({ observedWorkflowFailures: null });
  const operation = reportOperation(config, selectedSummary, "processing");
  const exactPatch = reportSummaryPatch(config, selectedSummary);
  assert.equal(exactPatch.Test_Observed_Workflow_Failures, null);

  const omittedContext = context(config, unreviewedReportDeal(exactPatch));
  delete omittedContext.deal.Test_Observed_Workflow_Failures;
  const omitted = harness(config, omittedContext, {
    readOperation: async () => operation,
  });
  await assert.rejects(omitted.lifecycle.handle({
    action: "sync_report_summary",
    dealId: selectedSummary.dealId,
    operationKey: operation.OPERATION_KEY,
  }), (error) => error?.publicCode === "reconciliation_required");
  assert.equal(omitted.calls.some(([kind]) => kind === "crm_report_update"), false);
  assert.equal(omitted.calls.some(([kind, , status]) => (
    kind === "report_transition" && status === "reconciliation_required"
  )), true);

  const present = harness(config, context(config, unreviewedReportDeal(exactPatch)), {
    readOperation: async () => operation,
  });
  const result = await present.lifecycle.handle({
    action: "sync_report_summary",
    dealId: selectedSummary.dealId,
    operationKey: operation.OPERATION_KEY,
  });
  assert.deepEqual(result, { outcome: "report_summary_readback_confirmed", duplicate: true });
  assert.equal(present.calls.some(([kind]) => kind === "crm_report_update"), false);
});

test("reviewed Deal permits exact report replay but rejects a differing report revision", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const selectedSummary = terminalSummary();
  let operation = reportOperation(config, selectedSummary);
  const differing = harness(config, context(config), {
    readOperation: async () => structuredClone(operation),
    reportTransition: async (cursor, status, lastOutcome, transitionedAt) => {
      operation = {
        ...operation,
        STATUS: status,
        LAST_OUTCOME: lastOutcome,
        OPERATION_VERSION: Number(cursor.OPERATION_VERSION) + 1,
        UPDATED_AT: transitionedAt,
      };
      return { transitioned: true, row: structuredClone(operation) };
    },
  });
  await assert.rejects(() => differing.lifecycle.handle({
    action: "sync_report_summary", dealId: selectedSummary.dealId,
    operationKey: operation.OPERATION_KEY,
  }), (error) => error.publicCode === "reconciliation_required");
  assert.equal(differing.calls.some(([kind]) => kind === "claim_report"), false);
  assert.equal(differing.calls.some(([kind]) => kind === "crm_report_update"), false);
  assert.equal(operation.STATUS, "reconciliation_required");
  assert.equal(operation.LAST_OUTCOME, "report_revision_protected");

  operation = reportOperation(config, selectedSummary);
  const exact = harness(config, context(config, reportSummaryPatch(config, selectedSummary)), {
    readOperation: async () => operation,
  });
  const replay = await exact.lifecycle.handle({
    action: "sync_report_summary", dealId: selectedSummary.dealId,
    operationKey: operation.OPERATION_KEY,
  });
  assert.equal(replay.duplicate, true);
  assert.equal(exact.calls.some(([kind]) => kind === "crm_report_update"), false);
  assert.equal(exact.calls.some(([kind]) => kind === "report_transition"), true);
});

test("report sync permits only Live to Completed and Completed exact replay", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const selectedSummary = terminalSummary();
  for (const testStatus of ["Failed", "Rolled Back"]) {
    let operation = reportOperation(config, selectedSummary);
    const rejected = harness(
      config,
      context(config, unreviewedReportDeal({ Test_Status: testStatus })),
      {
        readOperation: async () => structuredClone(operation),
        reportTransition: async (cursor, status, lastOutcome, transitionedAt) => {
          operation = {
            ...operation,
            STATUS: status,
            LAST_OUTCOME: lastOutcome,
            OPERATION_VERSION: Number(cursor.OPERATION_VERSION) + 1,
            UPDATED_AT: transitionedAt,
          };
          return { transitioned: true, row: structuredClone(operation) };
        },
      },
    );
    await assert.rejects(
      rejected.lifecycle.handle({
        action: "sync_report_summary",
        dealId: selectedSummary.dealId,
        operationKey: operation.OPERATION_KEY,
      }),
      (error) => error.publicCode === "reconciliation_required",
    );
    assert.equal(operation.STATUS, "reconciliation_required");
    assert.equal(operation.LAST_OUTCOME, "report_test_status_conflict");
    assert.equal(rejected.calls.some(([kind]) => kind === "claim_report"), false);
    assert.equal(rejected.calls.some(([kind]) => kind === "crm_report_update"), false);
  }

  const completedOperation = reportOperation(config, selectedSummary, "completed");
  const exact = harness(
    config,
    context(config, unreviewedReportDeal(reportSummaryPatch(config, selectedSummary))),
    { readOperation: async () => completedOperation },
  );
  assert.equal((await exact.lifecycle.handle({
    action: "sync_report_summary",
    dealId: selectedSummary.dealId,
    operationKey: completedOperation.OPERATION_KEY,
  })).duplicate, true);
  assert.equal(exact.calls.some(([kind]) => kind === "crm_report_update"), false);
  assert.equal(exact.calls.some(([kind]) => kind === "report_transition"), false);
  assert.equal(exact.calls.filter(([kind]) => kind === "crm_read").length, 2);

  let conflictingOperation = structuredClone(completedOperation);
  const conflicting = harness(config, context(config, unreviewedReportDeal()), {
    readOperation: async () => structuredClone(conflictingOperation),
    reportTransition: async (cursor, status, lastOutcome, transitionedAt) => {
      conflictingOperation = {
        ...conflictingOperation,
        STATUS: status,
        LAST_OUTCOME: lastOutcome,
        OPERATION_VERSION: Number(cursor.OPERATION_VERSION) + 1,
        UPDATED_AT: transitionedAt,
      };
      return { transitioned: true, row: structuredClone(conflictingOperation) };
    },
  });
  await assert.rejects(
    conflicting.lifecycle.handle({
      action: "sync_report_summary",
      dealId: selectedSummary.dealId,
      operationKey: completedOperation.OPERATION_KEY,
    }),
    (error) => error.publicCode === "reconciliation_required",
  );
  assert.equal(conflicting.calls.some(([kind]) => kind === "crm_report_update"), false);
  assert.equal(conflictingOperation.STATUS, "reconciliation_required");
  assert.equal(conflictingOperation.LAST_OUTCOME, "report_summary_readback_required");
  assert.equal(conflictingOperation.OPERATION_VERSION, completedOperation.OPERATION_VERSION + 1);
  assert.equal(conflicting.calls.filter(([kind]) => kind === "crm_read").length, 3);

  let newerSemanticOperation = structuredClone(completedOperation);
  const staleMismatch = harness(config, context(config, unreviewedReportDeal()), {
    readOperation: async () => structuredClone(newerSemanticOperation),
    reportTransition: async (cursor) => {
      newerSemanticOperation = {
        ...newerSemanticOperation,
        STATUS: "reconciliation_required",
        LAST_OUTCOME: "report_revision_protected",
        OPERATION_VERSION: newerSemanticOperation.OPERATION_VERSION + 1,
      };
      assert.equal(cursor.STATUS, "completed");
      return { transitioned: false, row: structuredClone(newerSemanticOperation) };
    },
  });
  await assert.rejects(
    staleMismatch.lifecycle.handle({
      action: "sync_report_summary",
      dealId: selectedSummary.dealId,
      operationKey: completedOperation.OPERATION_KEY,
    }),
    (error) => error.publicCode === "reconciliation_required",
  );
  assert.equal(newerSemanticOperation.STATUS, "reconciliation_required");
  assert.equal(newerSemanticOperation.LAST_OUTCOME, "report_revision_protected");
  assert.equal(newerSemanticOperation.OPERATION_VERSION, completedOperation.OPERATION_VERSION + 1);
});

test("stale report completion and containment invocations cannot overwrite each other", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const selectedSummary = terminalSummary();
  const payload = {
    action: "sync_report_summary",
    dealId: selectedSummary.dealId,
    operationKey: reportOperation(config, selectedSummary).OPERATION_KEY,
  };
  const exactDeal = context(
    config,
    unreviewedReportDeal(reportSummaryPatch(config, selectedSummary)),
  );
  const protectedDeal = context(config);

  function deferred() {
    let resolve;
    const promise = new Promise((selectedResolve) => { resolve = selectedResolve; });
    return { promise, resolve };
  }

  for (const firstTarget of ["completed", "reconciliation_required"]) {
    let operation = reportOperation(config, selectedSummary);
    const staleEntered = deferred();
    const releaseStale = deferred();
    const cas = async (cursor, status, lastOutcome, transitionedAt) => {
      const matches = cursor.ROWID === operation.ROWID
        && cursor.STATUS === operation.STATUS
        && cursor.LAST_OUTCOME === operation.LAST_OUTCOME
        && cursor.OPERATION_VERSION === operation.OPERATION_VERSION;
      if (!matches) return { transitioned: false, row: structuredClone(operation) };
      operation = {
        ...operation,
        STATUS: status,
        LAST_OUTCOME: lastOutcome,
        OPERATION_VERSION: operation.OPERATION_VERSION + 1,
        UPDATED_AT: transitionedAt,
      };
      return { transitioned: true, row: structuredClone(operation) };
    };
    const staleIsCompletion = firstTarget === "completed";
    const stale = harness(config, staleIsCompletion ? exactDeal : protectedDeal, {
      readOperation: async () => structuredClone(operation),
      reportTransition: async (...args) => {
        staleEntered.resolve();
        await releaseStale.promise;
        return cas(...args);
      },
    });
    const newer = harness(config, staleIsCompletion ? protectedDeal : exactDeal, {
      readOperation: async () => structuredClone(operation),
      reportTransition: cas,
    });

    const staleResult = stale.lifecycle.handle(payload);
    await staleEntered.promise;
    if (staleIsCompletion) {
      await assert.rejects(
        newer.lifecycle.handle(payload),
        (error) => error.publicCode === "reconciliation_required",
      );
      assert.equal(operation.STATUS, "reconciliation_required");
      assert.equal(operation.LAST_OUTCOME, "report_revision_protected");
    } else {
      assert.equal((await newer.lifecycle.handle(payload)).duplicate, true);
      assert.equal(operation.STATUS, "completed");
      assert.equal(operation.LAST_OUTCOME, "report_summary_readback_confirmed");
    }
    releaseStale.resolve();
    await assert.rejects(
      staleResult,
      (error) => error.publicCode === "reconciliation_required",
    );
    assert.equal(operation.STATUS, "reconciliation_required");
    assert.equal(
      operation.LAST_OUTCOME,
      staleIsCompletion ? "report_revision_protected" : "report_summary_readback_required",
    );
    assert.equal(operation.OPERATION_VERSION, staleIsCompletion ? 2 : 3);
  }
});

test("fresh CRM read blocks stale completion after a newer reconciliation cursor", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const selectedSummary = terminalSummary();
  const exactPatch = reportSummaryPatch(config, selectedSummary);
  let conflictObserved = false;
  let operation = {
    ...reportOperation(config, selectedSummary),
    STATUS: "reconciliation_required",
    LAST_OUTCOME: "report_revision_protected",
    OPERATION_VERSION: 2,
  };
  const selected = harness(
    config,
    context(config, unreviewedReportDeal(exactPatch)),
    {
      readOperation: async () => {
        // This models B changing CRM and fencing the row after A's initial CRM
        // snapshot but before A observes the operation cursor.
        conflictObserved = true;
        return structuredClone(operation);
      },
      onGetContext: (current) => conflictObserved ? context(config) : current,
      reportTransition: async (cursor, status, lastOutcome, transitionedAt) => {
        operation = {
          ...operation,
          STATUS: status,
          LAST_OUTCOME: lastOutcome,
          OPERATION_VERSION: Number(cursor.OPERATION_VERSION) + 1,
          UPDATED_AT: transitionedAt,
        };
        return { transitioned: true, row: structuredClone(operation) };
      },
    },
  );

  await assert.rejects(
    selected.lifecycle.handle({
      action: "sync_report_summary",
      dealId: selectedSummary.dealId,
      operationKey: operation.OPERATION_KEY,
    }),
    (error) => error.publicCode === "reconciliation_required",
  );
  assert.deepEqual(
    selected.calls.slice(0, 3).map(([kind]) => kind),
    ["crm_read", "read_operation", "crm_read"],
  );
  assert.equal(operation.STATUS, "reconciliation_required");
  assert.equal(operation.LAST_OUTCOME, "report_revision_protected");
  assert.equal(operation.OPERATION_VERSION, 3);
  assert.equal(selected.calls.filter(([kind]) => kind === "report_transition").length, 1);
  assert.equal(selected.calls.some(([kind]) => kind === "crm_report_update"), false);
});

test("newer CRM conflict repairs a completed marker that won the stale CAS race", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const selectedSummary = terminalSummary();
  let operation = reportOperation(config, selectedSummary);
  const payload = {
    action: "sync_report_summary",
    dealId: selectedSummary.dealId,
    operationKey: operation.OPERATION_KEY,
  };
  const exactEntered = {};
  exactEntered.promise = new Promise((resolve) => { exactEntered.resolve = resolve; });
  const releaseExact = {};
  releaseExact.promise = new Promise((resolve) => { releaseExact.resolve = resolve; });
  const conflictEntered = {};
  conflictEntered.promise = new Promise((resolve) => { conflictEntered.resolve = resolve; });
  const releaseConflict = {};
  releaseConflict.promise = new Promise((resolve) => { releaseConflict.resolve = resolve; });
  const cas = async (cursor, status, lastOutcome, transitionedAt) => {
    const matches = cursor.ROWID === operation.ROWID
      && cursor.STATUS === operation.STATUS
      && cursor.LAST_OUTCOME === operation.LAST_OUTCOME
      && cursor.OPERATION_VERSION === operation.OPERATION_VERSION;
    if (!matches) return { transitioned: false, row: structuredClone(operation) };
    operation = {
      ...operation,
      STATUS: status,
      LAST_OUTCOME: lastOutcome,
      OPERATION_VERSION: operation.OPERATION_VERSION + 1,
      UPDATED_AT: transitionedAt,
    };
    return { transitioned: true, row: structuredClone(operation) };
  };
  const exact = harness(
    config,
    context(config, unreviewedReportDeal(reportSummaryPatch(config, selectedSummary))),
    {
      readOperation: async () => structuredClone(operation),
      reportTransition: async (...args) => {
        exactEntered.resolve();
        await releaseExact.promise;
        return cas(...args);
      },
    },
  );
  let conflictTransitionCalls = 0;
  const conflict = harness(config, context(config), {
    readOperation: async () => structuredClone(operation),
    reportTransition: async (...args) => {
      conflictTransitionCalls += 1;
      if (conflictTransitionCalls === 1) {
        conflictEntered.resolve();
        await releaseConflict.promise;
      }
      return cas(...args);
    },
  });

  const exactResult = exact.lifecycle.handle(payload);
  await exactEntered.promise;
  const conflictResult = conflict.lifecycle.handle(payload);
  await conflictEntered.promise;
  releaseExact.resolve();
  assert.equal((await exactResult).duplicate, true);
  assert.equal(operation.STATUS, "completed");
  assert.equal(operation.OPERATION_VERSION, 2);
  releaseConflict.resolve();
  await assert.rejects(
    conflictResult,
    (error) => error.publicCode === "reconciliation_required",
  );
  assert.equal(operation.STATUS, "reconciliation_required");
  assert.equal(operation.LAST_OUTCOME, "report_summary_readback_required");
  assert.equal(operation.OPERATION_VERSION, 3);
  assert.equal(conflictTransitionCalls, 2);
  assert.equal(conflict.calls.filter(([kind]) => kind === "crm_read").length, 2);
  assert.equal(exact.calls.filter(([kind]) => kind === "crm_read").length, 2);
});

test("concurrent report-summary requests permit only the owned claim to issue a CRM write", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const selectedSummary = terminalSummary();
  const operation = reportOperation(config, selectedSummary);
  let claimed = false;
  const selected = harness(config, context(config, unreviewedReportDeal({ Test_Status: "Live" })), {
    readOperation: async () => operation,
    claimReportSummary: async () => {
      if (claimed) return { claimed: false, row: { ...operation, STATUS: "processing" } };
      claimed = true;
      return { claimed: true, row: { ...operation, STATUS: "processing" } };
    },
  });
  const results = await Promise.allSettled([
    selected.lifecycle.handle({ action: "sync_report_summary", dealId: selectedSummary.dealId,
      operationKey: operation.OPERATION_KEY }),
    selected.lifecycle.handle({ action: "sync_report_summary", dealId: selectedSummary.dealId,
      operationKey: operation.OPERATION_KEY }),
  ]);
  assert.ok(results.some(({ status }) => status === "fulfilled"));
  assert.equal(selected.calls.filter(([kind]) => kind === "crm_report_update").length, 1);
});

test("all approved monthly plans bind exact terms and update CRM once after Billing readback", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const apiValueByPlan = Object.freeze({ Launch: "Option 1", Growth: "Option 2", Scale: "Pro" });
  for (const terms of Object.values(config.paidCommercialTerms.plans)) {
    const plan = terms.plan;
    const selected = harness(config, context(config, {
      Plan: apiValueByPlan[plan],
      Monthly_Recurring_Revenue: terms.recurringMinor / 100,
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
    const completedIndex = selected.calls.findIndex(
      ([kind, , status]) => kind === "mark" && status === "completed",
    );
    const analyticsIndex = selected.calls.findIndex(([kind]) => kind === "analytics");
    assert.ok(updateIndex > paidIndex);
    assert.ok(analyticsIndex > completedIndex);
    assert.equal(selected.calls.filter(([kind]) => kind === "analytics").length, 1);
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

test("unknown completion and upstream failures never emit a conversion success fact", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const billingFailure = harness(config, context(config), {
    ensurePaid: async () => { throw new Error("synthetic Billing uncertainty"); },
  });
  await assert.rejects(() => billingFailure.lifecycle.handle({
    action: "prepare_paid_subscription", dealId: "100000000000001",
  }), (error) => error.publicCode === "reconciliation_required");
  assert.equal(billingFailure.calls.some(([kind]) => kind === "analytics"), false);

  const completionFailure = harness(config, context(config), {
    mark: async (_rowId, status) => {
      if (status === "completed") throw new Error("synthetic uncertain completion");
    },
  });
  await assert.rejects(() => completionFailure.lifecycle.handle({
    action: "prepare_paid_subscription", dealId: "100000000000001",
  }), (error) => error.publicCode === "reconciliation_required");
  assert.equal(completionFailure.calls.some(([kind]) => kind === "analytics"), false);
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
    { Subscription_Acceptance_Version: `terms-v1:${"0".repeat(64)}` },
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

test("paid conversion requires exact current and approved deployment configuration identity", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  for (const overrides of [
    { Approved_Deployment_Record_ID: "deployment_B" },
    { Approved_Configuration_Version: "cfg_A_v2" },
    { Deployment_Record_ID: null },
    { Configuration_Version: "unsafe version" },
  ]) {
    const rejected = harness(config, context(config, overrides));
    await assert.rejects(() => rejected.lifecycle.handle({
      action: "prepare_paid_subscription", dealId: "100000000000001",
    }), /invalid|approved deployment configuration/);
    assert.equal(rejected.calls.some(([kind]) => kind === "claim"), false);
    assert.equal(rejected.calls.some(([kind]) => kind === "analytics"), false);
  }
});

test("acceptance version is bound to the claimed paid operation", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const changed = harness(config, context(config), {
    onGetContext: (current, readNumber) => readNumber === 2
      ? {
        ...current,
        deal: {
          ...current.deal,
          Subscription_Acceptance_Version: `terms-v1:${"0".repeat(64)}`,
        },
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
    { Monthly_Recurring_Revenue: (growth.recurringMinor - 1) / 100 },
    {
      Monthly_Recurring_Revenue: undefined,
      MRR: growth.recurringMinor / 100,
    },
    { Setup_Fee: (growth.setupMinor - 1) / 100 },
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

test("paid conversion rejects CRM Plan display labels before the operation claim", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  for (const displayLabel of ["Launch", "Growth", "Scale"]) {
    const rejected = harness(config, context(config, { Plan: displayLabel }));
    await assert.rejects(rejected.lifecycle.handle({
      action: "prepare_paid_subscription",
      dealId: "100000000000001",
    }), /approved monthly catalog/);
    assert.equal(rejected.calls.some(([kind]) => kind === "claim"), false);
    assert.equal(rejected.calls.some(([kind]) => kind === "customer"), false);
    assert.equal(rejected.calls.some(([kind]) => kind === "paid"), false);
  }
});

test("the paid gate blocks preparation and reconciliation before any dependency read", async () => {
  const enabledConfig = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const environment = baseEnvironment({ ENABLE_PAID_SUBSCRIPTION_PREPARATION: "false" });
  for (const name of [
    "PAID_COMMERCIAL_TERMS_JSON",
    "PAID_PLAN_CODE_MAP",
    "PAID_USAGE_ADDON_CODE",
    "PAID_USAGE_ADDON_UNIT",
    "PAID_USAGE_ADDON_PRODUCT_ID",
    "PAID_SUBSCRIPTION_STATUS_MAP",
    "PAID_ACCEPTANCE_VALUE",
    "CLOSED_WON_STAGE_VALUE",
  ]) delete environment[name];
  const config = loadConfig(environment, { artifactRevision: REVISION });

  for (const action of ["prepare_paid_subscription", "reconcile"]) {
    const disabled = harness(config, context(enabledConfig));
    await assert.rejects(disabled.lifecycle.handle({
      action,
      dealId: "100000000000001",
    }), /paid lifecycle actions are disabled/i);
    assert.deepEqual(disabled.calls, []);
  }
});

test("report summary sync remains available with paid catalog configuration absent", async () => {
  const enabledConfig = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const environment = baseEnvironment({ ENABLE_PAID_SUBSCRIPTION_PREPARATION: "false" });
  for (const name of [
    "PAID_COMMERCIAL_TERMS_JSON",
    "PAID_PLAN_CODE_MAP",
    "PAID_USAGE_ADDON_CODE",
    "PAID_USAGE_ADDON_UNIT",
    "PAID_USAGE_ADDON_PRODUCT_ID",
    "PAID_SUBSCRIPTION_STATUS_MAP",
    "PAID_ACCEPTANCE_VALUE",
    "CLOSED_WON_STAGE_VALUE",
  ]) delete environment[name];
  const config = loadConfig(environment, { artifactRevision: REVISION });
  const selectedSummary = terminalSummary();
  const operation = reportOperation(config, selectedSummary);
  const selected = harness(config, context(enabledConfig, unreviewedReportDeal({
    Stage: "Test Live",
    Test_Status: "Live",
  })), {
    readOperation: async () => operation,
  });

  const result = await selected.lifecycle.handle({
    action: "sync_report_summary",
    dealId: selectedSummary.dealId,
    operationKey: operation.OPERATION_KEY,
  });
  assert.equal(result.outcome, "report_summary_readback_confirmed");
  assert.equal(selected.calls.some(([kind]) => [
    "customer", "paid", "find_customer", "find_paid",
  ].includes(kind)), false);
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
    (current) => ({
      ...current,
      deal: { ...current.deal, Monthly_Recurring_Revenue: 750 },
    }),
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

test("paid reconciliation cannot treat an omitted cleared error as exact", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const exactIntegration = {
    Billing_Customer_ID: "200000000000001",
    Billing_Subscription_ID: "300000000000001",
    Subscription_Status: "Active",
    Billing_Automation_Status: "Paid Verified",
    Billing_Last_Sync_At: "2026-08-21T15:01:00.000Z",
    Billing_Automation_Error: null,
  };
  const omittedContext = context(config, exactIntegration);
  delete omittedContext.deal.Billing_Automation_Error;
  const omitted = harness(config, omittedContext);
  assert.equal((await omitted.lifecycle.handle({
    action: "reconcile",
    dealId: omittedContext.deal.id,
  })).outcome, "authoritative_readback_confirmed");
  const updates = omitted.calls.filter(([kind]) => kind === "crm_update");
  assert.equal(updates.length, 1);
  assert.equal(Object.hasOwn(updates[0][1], "Billing_Automation_Error"), true);
  assert.equal(updates[0][1].Billing_Automation_Error, null);

  const present = harness(config, context(config, exactIntegration));
  assert.equal((await present.lifecycle.handle({
    action: "reconcile",
    dealId: "100000000000001",
  })).outcome, "authoritative_readback_confirmed");
  assert.equal(present.calls.some(([kind]) => kind === "crm_update"), false);
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
