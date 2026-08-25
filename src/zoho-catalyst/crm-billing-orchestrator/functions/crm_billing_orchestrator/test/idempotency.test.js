"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const {
  TEST_CUSTOMER_PROVISIONING_ACTION,
  createOperationStore,
  deriveOperationIdentity,
  deriveTestCustomerProvisioningIdentity,
} = require("../lib/idempotency");
const { REVISION, baseEnvironment } = require("./helpers");

function memoryApp(tableName) {
  const rows = [];
  let nextRowId = 1;
  const table = {
    async insertRow(row) {
      if (rows.some((candidate) => candidate.OPERATION_KEY === row.OPERATION_KEY)) {
        throw Object.assign(new Error("duplicate"), { code: "DUPLICATE" });
      }
      const inserted = { ...row, ROWID: String(nextRowId++) };
      rows.push(inserted);
      return inserted;
    },
    async updateRow(patch) {
      const row = rows.find((candidate) => candidate.ROWID === String(patch.ROWID));
      Object.assign(row, patch);
      return row;
    },
  };
  return {
    rows,
    datastore: () => ({ table: () => table }),
    zcql: () => ({
      executeZCQLQuery: async (statement) => {
        if (statement.startsWith(`UPDATE ${tableName} SET STATUS = 'processing'`)) {
          const id = statement.match(/ROWID = ([0-9]+)/)?.[1];
          const expectedVersion = Number(statement.match(/AND OPERATION_VERSION = ([0-9]+)/)?.[1]);
          const nextVersion = Number(statement.match(/OPERATION_VERSION = ([0-9]+), UPDATED_AT/)?.[1]);
          const claimToken = statement.match(/LAST_OUTCOME = '(report_claim_[a-f0-9]{32})'/)?.[1];
          const expectedStatus = statement.match(/AND STATUS = '([^']+)'/)?.[1];
          const expectedOutcome = statement.match(/AND LAST_OUTCOME = '([^']+)'/)?.[1];
          const updatedAt = statement.match(/UPDATED_AT = '([^']+)'/)?.[1];
          const selected = rows.find((candidate) => candidate.ROWID === id);
          if (selected?.STATUS === expectedStatus
            && selected.LAST_OUTCOME === expectedOutcome
            && selected.OPERATION_VERSION === expectedVersion) {
            Object.assign(selected, {
              STATUS: "processing",
              LAST_OUTCOME: claimToken,
              OPERATION_VERSION: nextVersion,
              UPDATED_AT: updatedAt,
            });
          }
          return [];
        }
        if (statement.startsWith(`UPDATE ${tableName} SET LAST_OUTCOME = 'report_write_started_`)) {
          const id = statement.match(/ROWID = ([0-9]+)/)?.[1];
          const expectedVersion = Number(statement.match(/AND OPERATION_VERSION = ([0-9]+)/)?.[1]);
          const nextVersion = Number(statement.match(/OPERATION_VERSION = ([0-9]+), UPDATED_AT/)?.[1]);
          const writeStarted = statement.match(/SET LAST_OUTCOME = '(report_write_started_[a-f0-9]{32})'/)?.[1];
          const claimToken = statement.match(/AND LAST_OUTCOME = '(report_claim_[a-f0-9]{32})'/)?.[1];
          const updatedAt = statement.match(/UPDATED_AT = '([^']+)'/)?.[1];
          const selected = rows.find((candidate) => candidate.ROWID === id);
          if (selected?.STATUS === "processing"
            && selected.LAST_OUTCOME === claimToken
            && selected.OPERATION_VERSION === expectedVersion) {
            Object.assign(selected, {
              LAST_OUTCOME: writeStarted,
              OPERATION_VERSION: nextVersion,
              UPDATED_AT: updatedAt,
            });
          }
          return [];
        }
        if (statement.startsWith(`UPDATE ${tableName} SET STATUS = 'completed'`)
          || statement.startsWith(`UPDATE ${tableName} SET STATUS = 'reconciliation_required'`)) {
          const id = statement.match(/ROWID = ([0-9]+)/)?.[1];
          const status = statement.match(/SET STATUS = '([^']+)'/)?.[1];
          const lastOutcome = statement.match(/, LAST_OUTCOME = '([^']+)'/)?.[1];
          const nextVersion = Number(statement.match(/OPERATION_VERSION = ([0-9]+), UPDATED_AT/)?.[1]);
          const expectedStatus = statement.match(/AND STATUS = '([^']+)'/)?.[1];
          const expectedOutcome = statement.match(/AND LAST_OUTCOME = '([^']+)'/)?.[1];
          const expectedVersion = Number(statement.match(/AND OPERATION_VERSION = ([0-9]+)/)?.[1]);
          const updatedAt = statement.match(/UPDATED_AT = '([^']+)'/)?.[1];
          const selected = rows.find((candidate) => candidate.ROWID === id);
          if (selected?.STATUS === expectedStatus
            && selected.LAST_OUTCOME === expectedOutcome
            && selected.OPERATION_VERSION === expectedVersion) {
            Object.assign(selected, {
              STATUS: status,
              LAST_OUTCOME: lastOutcome,
              OPERATION_VERSION: nextVersion,
              UPDATED_AT: updatedAt,
            });
          }
          return [];
        }
        const key = statement.match(/OPERATION_KEY = '([a-f0-9]{64})'/)?.[1];
        const id = statement.match(/ROWID = ([0-9]+)/)?.[1];
        const row = key
          ? rows.find((candidate) => candidate.OPERATION_KEY === key)
          : rows.find((candidate) => candidate.ROWID === id);
        return row ? [{ [tableName]: { ...row } }] : [];
      },
    }),
  };
}

test("durable operation claim returns completed replay and rejects conflicts", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const app = memoryApp(config.operationTable);
  const store = createOperationStore(app, config);
  const identity = deriveOperationIdentity(config, "prepare_paid_subscription", "100000000000001", {
    accountId: "100000000000002",
    plan: "Growth",
    subscriptionStartDate: "2026-08-21",
  });
  assert.match(identity.billingReference, /^syl-paid-[a-f0-9]{32}$/);
  const first = await store.claim({
    operationKey: identity.operationKey,
    operationFingerprint: identity.operationFingerprint,
    action: "prepare_paid_subscription",
    scopeId: "100000000000001",
  });
  assert.equal(first.outcome, "claimed");
  await store.mark(first.rowId, "completed", "paid_subscription_readback_confirmed");
  const replay = await store.claim({
    operationKey: identity.operationKey,
    operationFingerprint: identity.operationFingerprint,
    action: "prepare_paid_subscription",
    scopeId: "100000000000001",
  });
  assert.equal(replay.outcome, "duplicate-completed");
  assert.equal(replay.status, "completed");
  assert.equal(replay.lastOutcome, "paid_subscription_readback_confirmed");
  assert.equal(replay.sourceRevision, config.sourceRevision);
  assert.equal(replay.sourceEnvironment, config.deploymentEnvironment);
  const conflict = await store.claim({
    operationKey: identity.operationKey,
    operationFingerprint: "d".repeat(64),
    action: "prepare_paid_subscription",
    scopeId: "100000000000001",
  });
  assert.equal(conflict.outcome, "duplicate-conflict");
});

test("report-summary claim and write-start fences permit pre-write reclaim only", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const app = memoryApp(config.operationTable);
  const row = {
    ROWID: "1",
    OPERATION_KEY: "a".repeat(64),
    OPERATION_FINGERPRINT: "b".repeat(64),
    ACTION: "sync_report_summary",
    CRM_DEAL_ID: "100000000000001",
    STATUS: "pending",
    SOURCE_REVISION: config.sourceRevision,
    SOURCE_ENVIRONMENT: config.deploymentEnvironment,
    LAST_OUTCOME: "terminal_report_ready",
    OPERATION_PAYLOAD_JSON: "{}",
    OPERATION_VERSION: 1,
    CREATED_AT: "2026-08-21T15:00:00.000Z",
    UPDATED_AT: "2026-08-21T15:00:00.000Z",
  };
  app.rows.push(row);
  const store = createOperationStore(app, config);
  const [left, right] = await Promise.all([
    store.claimReportSummary({ ...row }, `report_claim_${"1".repeat(32)}`, "2026-08-21T15:01:00.000Z"),
    store.claimReportSummary({ ...row }, `report_claim_${"2".repeat(32)}`, "2026-08-21T15:01:00.000Z"),
  ]);
  assert.equal([left, right].filter(({ claimed }) => claimed).length, 1);
  assert.equal(app.rows[0].STATUS, "processing");
  assert.equal(app.rows[0].OPERATION_VERSION, 2);
  const firstOwner = [left, right].find(({ claimed }) => claimed);
  const reclaimed = await store.claimReportSummary(
    { ...app.rows[0] }, `report_claim_${"3".repeat(32)}`, "2026-08-21T15:02:00.000Z",
  );
  assert.equal(reclaimed.claimed, true);
  assert.equal(app.rows[0].OPERATION_VERSION, 3);
  const fencedOldOwner = await store.beginReportSummaryWrite(
    firstOwner.row,
    firstOwner.row.LAST_OUTCOME,
    "2026-08-21T15:03:00.000Z",
  );
  assert.equal(fencedOldOwner.started, false);
  const writeStart = await store.beginReportSummaryWrite(
    reclaimed.row,
    reclaimed.row.LAST_OUTCOME,
    "2026-08-21T15:03:00.000Z",
  );
  assert.equal(writeStart.started, true);
  assert.equal(app.rows[0].OPERATION_VERSION, 4);
  assert.match(app.rows[0].LAST_OUTCOME, /^report_write_started_[a-f0-9]{32}$/);
  await assert.rejects(
    store.claimReportSummary(
      { ...app.rows[0] }, `report_claim_${"4".repeat(32)}`, "2026-08-21T15:04:00.000Z",
    ),
    /claim input is invalid/,
  );
});

test("report terminal CAS preserves newer semantic state and tolerates cursor-only advances", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  function pendingRow(operationKey) {
    return {
      ROWID: "1",
      OPERATION_KEY: operationKey,
      OPERATION_FINGERPRINT: "b".repeat(64),
      ACTION: "sync_report_summary",
      CRM_DEAL_ID: "100000000000001",
      STATUS: "pending",
      SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: config.deploymentEnvironment,
      LAST_OUTCOME: "terminal_report_ready",
      OPERATION_PAYLOAD_JSON: "{}",
      OPERATION_VERSION: 1,
      CREATED_AT: "2026-08-21T15:00:00.000Z",
      UPDATED_AT: "2026-08-21T15:00:00.000Z",
    };
  }

  const containmentApp = memoryApp(config.operationTable);
  containmentApp.rows.push(pendingRow("a".repeat(64)));
  const containmentStore = createOperationStore(containmentApp, config);
  const staleCompletionCursor = { ...containmentApp.rows[0] };
  const contained = await containmentStore.transitionReportSummary(
    { ...containmentApp.rows[0] },
    "reconciliation_required",
    "report_revision_protected",
    "2026-08-21T15:01:00.000Z",
  );
  assert.equal(contained.transitioned, true);
  const staleCompletion = await containmentStore.transitionReportSummary(
    staleCompletionCursor,
    "completed",
    "report_summary_readback_confirmed",
    "2026-08-21T15:02:00.000Z",
  );
  assert.equal(staleCompletion.transitioned, false);
  assert.equal(containmentApp.rows[0].STATUS, "reconciliation_required");
  assert.equal(containmentApp.rows[0].LAST_OUTCOME, "report_revision_protected");
  assert.equal(containmentApp.rows[0].OPERATION_VERSION, 2);

  const completionApp = memoryApp(config.operationTable);
  completionApp.rows.push(pendingRow("c".repeat(64)));
  const completionStore = createOperationStore(completionApp, config);
  const staleContainmentCursor = { ...completionApp.rows[0] };
  assert.equal((await completionStore.transitionReportSummary(
    { ...completionApp.rows[0] },
    "completed",
    "report_summary_readback_confirmed",
    "2026-08-21T15:01:00.000Z",
  )).transitioned, true);
  assert.equal((await completionStore.transitionReportSummary(
    staleContainmentCursor,
    "reconciliation_required",
    "report_test_status_conflict",
    "2026-08-21T15:02:00.000Z",
  )).transitioned, false);
  assert.equal(completionApp.rows[0].STATUS, "completed");
  assert.equal(completionApp.rows[0].LAST_OUTCOME, "report_summary_readback_confirmed");
  assert.equal(completionApp.rows[0].OPERATION_VERSION, 2);

  const cursorApp = memoryApp(config.operationTable);
  cursorApp.rows.push(pendingRow("d".repeat(64)));
  const cursorStore = createOperationStore(cursorApp, config);
  const staleCursor = { ...cursorApp.rows[0] };
  cursorApp.rows[0].OPERATION_VERSION = 2;
  cursorApp.rows[0].UPDATED_AT = "2026-08-21T15:00:30.000Z";
  const afterCursorAdvance = await cursorStore.transitionReportSummary(
    staleCursor,
    "completed",
    "report_summary_readback_confirmed",
    "2026-08-21T15:03:00.000Z",
  );
  assert.equal(afterCursorAdvance.transitioned, true);
  assert.equal(cursorApp.rows[0].STATUS, "completed");
  assert.equal(cursorApp.rows[0].OPERATION_VERSION, 3);

  const completedMismatchApp = memoryApp(config.operationTable);
  completedMismatchApp.rows.push(pendingRow("e".repeat(64)));
  const completedMismatchStore = createOperationStore(completedMismatchApp, config);
  await completedMismatchStore.transitionReportSummary(
    { ...completedMismatchApp.rows[0] },
    "completed",
    "report_summary_readback_confirmed",
    "2026-08-21T15:01:00.000Z",
  );
  const staleCompletedCursor = { ...completedMismatchApp.rows[0] };
  await completedMismatchStore.transitionReportSummary(
    { ...completedMismatchApp.rows[0] },
    "reconciliation_required",
    "report_revision_protected",
    "2026-08-21T15:02:00.000Z",
  );
  const staleReadbackContainment = await completedMismatchStore.transitionReportSummary(
    staleCompletedCursor,
    "reconciliation_required",
    "report_summary_readback_required",
    "2026-08-21T15:03:00.000Z",
  );
  assert.equal(staleReadbackContainment.transitioned, false);
  assert.equal(completedMismatchApp.rows[0].STATUS, "reconciliation_required");
  assert.equal(completedMismatchApp.rows[0].LAST_OUTCOME, "report_revision_protected");
  assert.equal(completedMismatchApp.rows[0].OPERATION_VERSION, 3);
});

test("paid references stay stable while accepted commercial changes conflict", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const growth = config.paidCommercialTerms.plans["Growth::Monthly"];
  const scale = config.paidCommercialTerms.plans["Scale::Monthly"];
  const first = deriveOperationIdentity(
    config,
    "prepare_paid_subscription",
    "100000000000001",
    {
      accountId: "100000000000002",
      accepted: true,
      billingFrequency: "Monthly",
      plan: "Growth",
      recurringMinor: growth.recurringMinor,
      subscriptionAcceptanceVersion: "paid-acceptance-v1",
      subscriptionStartDate: "2026-09-01",
    },
  );
  const changed = deriveOperationIdentity(
    config,
    "prepare_paid_subscription",
    "100000000000001",
    {
      accountId: "100000000000002",
      accepted: true,
      billingFrequency: "Monthly",
      plan: "Scale",
      recurringMinor: scale.recurringMinor,
      subscriptionAcceptanceVersion: "paid-acceptance-v1",
      subscriptionStartDate: "2026-10-01",
    },
  );
  const changedAcceptance = deriveOperationIdentity(
    config,
    "prepare_paid_subscription",
    "100000000000001",
    {
      accountId: "100000000000002",
      accepted: true,
      billingFrequency: "Monthly",
      plan: "Growth",
      recurringMinor: growth.recurringMinor,
      subscriptionAcceptanceVersion: "paid-acceptance-v2",
      subscriptionStartDate: "2026-09-01",
    },
  );
  assert.equal(changed.operationKey, first.operationKey);
  assert.equal(changed.billingReference, first.billingReference);
  assert.notEqual(changed.operationFingerprint, first.operationFingerprint);
  assert.equal(changedAcceptance.operationKey, first.operationKey);
  assert.equal(changedAcceptance.billingReference, first.billingReference);
  assert.notEqual(changedAcceptance.operationFingerprint, first.operationFingerprint);
  assert.match(first.billingReference, /^syl-paid-[a-f0-9]{32}$/);

  const app = memoryApp(config.operationTable);
  const store = createOperationStore(app, config);
  await store.claim({
    operationKey: first.operationKey,
    operationFingerprint: first.operationFingerprint,
    action: "prepare_paid_subscription",
    scopeId: "100000000000001",
  });
  const conflict = await store.claim({
    operationKey: changed.operationKey,
    operationFingerprint: changed.operationFingerprint,
    action: "prepare_paid_subscription",
    scopeId: "100000000000001",
  });
  assert.equal(conflict.outcome, "duplicate-conflict");
});

test("direct TEST customer claim is stable across Deals and lifecycle actions for one Account", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const accountId = "100000000000002";
  const first = deriveTestCustomerProvisioningIdentity(config, accountId);
  const fromAnotherDealAndAction = deriveTestCustomerProvisioningIdentity(config, accountId);
  const otherAccount = deriveTestCustomerProvisioningIdentity(config, "100000000000003");
  const changedOrganization = loadConfig(baseEnvironment({
    BILLING_ORGANIZATION_ID: "100000000000009",
  }), { artifactRevision: REVISION });
  const changedConfiguration = deriveTestCustomerProvisioningIdentity(
    changedOrganization,
    accountId,
  );
  const firstDealAction = deriveOperationIdentity(
    config,
    "prepare_paid_subscription",
    "100000000000001",
    { accountId },
  );
  const secondDealAction = deriveOperationIdentity(
    config,
    "prepare_paid_subscription",
    "100000000000004",
    { accountId },
  );

  assert.equal(first.operationKey, fromAnotherDealAndAction.operationKey);
  assert.equal(first.operationFingerprint, fromAnotherDealAndAction.operationFingerprint);
  assert.equal(first.billingReference, null);
  assert.notEqual(first.operationKey, otherAccount.operationKey);
  assert.equal(first.operationKey, changedConfiguration.operationKey);
  assert.notEqual(first.operationFingerprint, changedConfiguration.operationFingerprint);
  assert.notEqual(firstDealAction.operationKey, secondDealAction.operationKey);

  const app = memoryApp(config.operationTable);
  const store = createOperationStore(app, config);
  const claim = await store.claim({
    operationKey: first.operationKey,
    operationFingerprint: first.operationFingerprint,
    action: TEST_CUSTOMER_PROVISIONING_ACTION,
    scopeId: accountId,
  });
  assert.equal(claim.outcome, "claimed");
  assert.equal(app.rows[0].CRM_DEAL_ID, accountId);
  assert.equal(app.rows[0].ACTION, TEST_CUSTOMER_PROVISIONING_ACTION);
  const processingReplay = await store.claim({
    operationKey: first.operationKey,
    operationFingerprint: first.operationFingerprint,
    action: TEST_CUSTOMER_PROVISIONING_ACTION,
    scopeId: accountId,
  });
  assert.equal(processingReplay.outcome, "duplicate-unresolved");
  assert.equal(processingReplay.status, "processing");
  assert.equal(processingReplay.lastOutcome, "claimed");
  await store.mark(claim.rowId, "completed", "customer_readback_confirmed");
  const completedReplay = await store.claim({
    operationKey: first.operationKey,
    operationFingerprint: first.operationFingerprint,
    action: TEST_CUSTOMER_PROVISIONING_ACTION,
    scopeId: accountId,
  });
  assert.equal(completedReplay.outcome, "duplicate-completed");
  const configurationConflict = await store.claim({
    operationKey: changedConfiguration.operationKey,
    operationFingerprint: changedConfiguration.operationFingerprint,
    action: TEST_CUSTOMER_PROVISIONING_ACTION,
    scopeId: accountId,
  });
  assert.equal(configurationConflict.outcome, "duplicate-conflict");
});
