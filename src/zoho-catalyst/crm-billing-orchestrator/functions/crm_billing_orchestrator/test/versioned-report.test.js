"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { syncVersionedReport, PROTECTED_FIELDS } = require("../lib/versioned-report");
const { reportSummaryIdentity, reportSummaryPatch } = require("../lib/report-summary");

const config = {
  deploymentEnvironment: "development", analyticsPartitionSecret: "synthetic-only".repeat(3),
  sourceRevision: "a".repeat(40), testCompletedStatusValue: "Completed", reportMutableStageValue: "Test Live",
};
const call = `c:${"a".repeat(64)}`;
function summary(version = 1, overrides = {}) {
  return {
    schemaVersion: 3, dealId: "10000001", deploymentId: "synthetic_a", configurationVersion: "v1",
    reportSchemaVersion: 2, callSetDigest: "b".repeat(64), testStatus: "Completed",
    testStartAt: "2026-09-01T00:00:00.000Z", testEndAt: "2026-09-08T00:00:00.000Z",
    testEndReason: "Seven-Day Limit Reached", callTotalsReconciled: true, callsCaptured: 1,
    qualifiedOpportunities: 1, existingCustomerCalls: 0, actualAverageCallDurationSeconds: 60,
    outOfAreaOrWrongFitCalls: 0, urgentRequests: 0, bookableOpportunities: null,
    officeFollowUpCalls: null, observedWorkflowFailures: null, recommendedPaidCoverage: null,
    expectedMonthlyConnectedMinutesMin: null, expectedMonthlyConnectedMinutesMax: null,
    dataConfidenceNotes: "Synthetic evidence only.", sourceVersions: [[call, version]], ...overrides,
  };
}
function operation(selected) {
  const identity = reportSummaryIdentity(config, selected);
  return { ROWID: identity.operationKey, OPERATION_KEY: identity.operationKey,
    OPERATION_FINGERPRINT: identity.operationFingerprint, ACTION: "sync_report_summary",
    CRM_DEAL_ID: selected.dealId, SOURCE_REVISION: config.sourceRevision, SOURCE_ENVIRONMENT: "development",
    OPERATION_PAYLOAD_JSON: JSON.stringify(selected), STATUS: "pending", LAST_OUTCOME: "terminal_report_ready",
    OPERATION_VERSION: 1 };
}
function harness() {
  const rows = new Map();
  let guard = null;
  let writes = 0;
  let tick = 0;
  let beforeRead = null;
  let updateBehavior = null;
  const state = { accountId: "10000002", deal: {
    id: "10000001", Deployment_Record_ID: "synthetic_a", Configuration_Version: "v1",
    Modified_Time: "2026-09-08T00:00:00.000Z", Stage: "Test Live", Test_Status: "Live",
    ...Object.fromEntries(PROTECTED_FIELDS.map((name) => [name, null])),
  } };
  const store = {
    readByKey: async (key) => structuredClone(rows.get(key)),
    readReportGuard: async (binding) => {
      if (guard && !Object.keys(binding).every((name) => guard[name] === binding[name])) throw Error("binding");
      return structuredClone(guard);
    },
    claimReportGuard: async (binding, key, expected) => {
      guard ??= { ...binding, schemaVersion: 1, confirmedOperationKey: null, inflightOperationKey: null };
      if (guard.confirmedOperationKey !== expected || (guard.inflightOperationKey && guard.inflightOperationKey !== key)) {
        return { claimed: false, guard: structuredClone(guard) };
      }
      guard.inflightOperationKey = key;
      return { claimed: true, guard: structuredClone(guard) };
    },
    completeReportGuard: async (_, key) => {
      if (guard?.inflightOperationKey !== key) return { completed: false };
      guard.confirmedOperationKey = key;
      guard.inflightOperationKey = null;
      return { completed: true, guard: structuredClone(guard) };
    },
    claimReportSummary: async (cursor, token) => {
      const row = rows.get(cursor.OPERATION_KEY);
      if (row.OPERATION_VERSION !== cursor.OPERATION_VERSION) return { claimed: false };
      Object.assign(row, { STATUS: "processing", LAST_OUTCOME: token, OPERATION_VERSION: row.OPERATION_VERSION + 1 });
      return { claimed: true, row: structuredClone(row) };
    },
    beginReportSummaryWrite: async (cursor, token) => {
      const row = rows.get(cursor.OPERATION_KEY);
      if (row.LAST_OUTCOME !== token) return { started: false };
      row.LAST_OUTCOME = token.replace("report_claim_", "report_write_started_");
      row.OPERATION_VERSION += 1;
      return { started: true, row: structuredClone(row) };
    },
    transitionReportSummary: async (cursor, status, outcome) => {
      const row = rows.get(cursor.OPERATION_KEY);
      if (row.OPERATION_VERSION !== cursor.OPERATION_VERSION) return { transitioned: false, row: structuredClone(row) };
      Object.assign(row, { STATUS: status, LAST_OUTCOME: outcome, OPERATION_VERSION: row.OPERATION_VERSION + 1 });
      return { transitioned: true, row: structuredClone(row) };
    },
  };
  const client = {
    getContext: async () => { beforeRead?.(state); return structuredClone(state); },
    updateDealReportSummary: async (deal, patch) => {
      writes += 1;
      assert.equal(deal.Modified_Time, state.deal.Modified_Time);
      if (updateBehavior) return updateBehavior(state, patch);
      Object.assign(state.deal, patch, { Modified_Time: `2026-09-08T00:00:${String(writes).padStart(2, "0")}.000Z` });
      return structuredClone(state.deal);
    },
  };
  return { state, rows, store, get writes() { return writes; }, get guard() { return guard; },
    beforeRead(fn) { beforeRead = fn; }, updateBehavior(fn) { updateBehavior = fn; },
    async run(selected, overrides = {}) {
      const op = operation(selected);
      if (!rows.has(op.OPERATION_KEY)) rows.set(op.OPERATION_KEY, op);
      return syncVersionedReport({ config, state: structuredClone(state),
        operation: structuredClone(rows.get(op.OPERATION_KEY)), summary: selected,
        crmClient: client, operationStore: store, validateContext: (value) => value,
        nowIso: () => new Date(Date.UTC(2026, 8, 8, 0, 0, tick++)).toISOString(), ...overrides });
    },
  };
}

test("same-call late analysis revises Completed; old/latest replay preserve history and the terminal clock", async () => {
  const h = harness();
  const first = summary();
  const newer = summary(2, { bookableOpportunities: 1 });
  assert.equal((await h.run(first)).duplicate, false);
  const receipt = structuredClone(h.rows.get(operation(first).OPERATION_KEY));
  assert.equal((await h.run(newer)).duplicate, false);
  assert.equal(h.state.deal.Test_Status, "Completed");
  assert.equal(h.state.deal.Test_End_At, first.testEndAt);
  assert.equal(h.state.deal.Test_Bookable_Opportunities, 1);
  assert.equal((await h.run(first)).duplicate, true);
  assert.equal((await h.run(newer)).duplicate, true);
  assert.deepEqual(h.rows.get(receipt.OPERATION_KEY), receipt);
  assert.equal(h.writes, 2);
});

test("identical normalized CRM projection advances source history without a redundant write", async () => {
  const h = harness();
  await h.run(summary(1, { actualAverageCallDurationSeconds: 60.1 }));
  assert.equal((await h.run(summary(2, { actualAverageCallDurationSeconds: 60.2 }))).duplicate, true);
  assert.equal(h.writes, 1);
  assert.equal(h.rows.size, 2);
});

test("equal, regressed, incomparable, changed terminal or foreign configuration evidence cannot revise", async () => {
  for (const changed of [
    summary(1, { qualifiedOpportunities: 0 }), summary(1, { sourceVersions: [] }),
    summary(1, { sourceVersions: [[`c:${"b".repeat(64)}`, 3]] }),
    summary(2, { testEndReason: "Technical Failure" }), summary(2, { configurationVersion: "v2" }),
  ]) {
    const h = harness();
    await h.run(summary());
    await assert.rejects(h.run(changed));
    assert.equal(h.writes, 1);
    assert.equal(h.state.deal.Test_Qualified_Opportunities, 1);
  }
});

test("missing or newly protected review/paid fields and unknown stored stage block revisions", async () => {
  for (const field of [...PROTECTED_FIELDS, "Stage"]) {
    for (const missing of [false, true]) {
      const h = harness();
      await h.run(summary());
      h.beforeRead((state) => { if (missing) delete state.deal[field]; else state.deal[field] = "protected"; });
      await assert.rejects(h.run(summary(2, { qualifiedOpportunities: 0 })));
      assert.equal(h.writes, 1);
    }
  }
  const h = harness();
  await assert.rejects(h.run(summary(), { config: { ...config, reportMutableStageValue: null } }));
  assert.equal(h.writes, 0);
});

test("untrusted Completed state, prior patch edits, missing receipt and Account rebinding fail closed", async () => {
  for (const mutate of [
    (h) => { h.state.deal.Test_Calls_Reaching_Route = 9; },
    (h) => { delete h.state.deal.Test_Office_Follow_Up_Calls; },
    (h) => { h.rows.clear(); },
    (h) => { h.state.accountId = "10000003"; },
    (h) => { h.rows.get(h.guard.confirmedOperationKey).STATUS = "reconciliation_required"; },
  ]) {
    const h = harness(); await h.run(summary()); mutate(h);
    await assert.rejects(h.run(summary(2))); assert.equal(h.writes, 1);
  }
  const h = harness();
  Object.assign(h.state.deal, reportSummaryPatch(config, summary()));
  await assert.rejects(h.run(summary(2))); assert.equal(h.writes, 0);
});

test("ambiguous persistence reconciles through exact readback with no resend; stale unknown stays held", async () => {
  for (const persisted of [true, false]) {
    const h = harness(); await h.run(summary());
    const changed = summary(2, { qualifiedOpportunities: 0 });
    h.updateBehavior((state, patch) => {
      if (persisted) Object.assign(state.deal, patch);
      throw Error("synthetic ambiguous outcome");
    });
    await assert.rejects(h.run(changed));
    const blockedKey = operation(changed).OPERATION_KEY;
    assert.equal(h.guard.inflightOperationKey, blockedKey);
    if (persisted) {
      assert.equal((await h.run(changed)).duplicate, true);
      assert.equal(h.guard.inflightOperationKey, null);
    } else {
      await assert.rejects(h.run(changed));
      await assert.rejects(h.run(summary(3)));
      assert.equal(h.guard.inflightOperationKey, blockedKey);
    }
    assert.equal(h.writes, 2);
  }
});

test("concurrent incomparable revisions serialize and cannot overwrite the winner", async () => {
  const h = harness(); await h.run(summary());
  const results = await Promise.allSettled([
    h.run(summary(2, { qualifiedOpportunities: 0 })),
    h.run(summary(2, { existingCustomerCalls: 1 })),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(h.writes, 2);
});
