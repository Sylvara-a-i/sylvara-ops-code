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
  const identity = deriveOperationIdentity(config, "start_evaluation", "100000000000001", {
    accountId: "100000000000002",
    testScopeVersion: "scope-v1",
    testStartAt: "2026-08-21T10:00:00-05:00",
  });
  assert.match(identity.billingReference, /^syl-evaluation-[a-f0-9]{32}$/);
  const first = await store.claim({
    operationKey: identity.operationKey,
    operationFingerprint: identity.operationFingerprint,
    action: "start_evaluation",
    scopeId: "100000000000001",
  });
  assert.equal(first.outcome, "claimed");
  await store.mark(first.rowId, "completed", "evaluation_readback_confirmed");
  const replay = await store.claim({
    operationKey: identity.operationKey,
    operationFingerprint: identity.operationFingerprint,
    action: "start_evaluation",
    scopeId: "100000000000001",
  });
  assert.equal(replay.outcome, "duplicate-completed");
  const conflict = await store.claim({
    operationKey: identity.operationKey,
    operationFingerprint: "d".repeat(64),
    action: "start_evaluation",
    scopeId: "100000000000001",
  });
  assert.equal(conflict.outcome, "duplicate-conflict");
});

test("evaluation and paid references stay stable when mutable Deal material changes", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const cases = [
    {
      action: "start_evaluation",
      prefix: "syl-evaluation-",
      first: {
        accountId: "100000000000002",
        testScopeVersion: "scope-v1",
        testStartAt: "2026-08-21T10:00:00-05:00",
      },
      changed: {
        accountId: "100000000000002",
        testScopeVersion: "scope-v2",
        testStartAt: "2026-08-22T10:00:00-05:00",
      },
    },
    {
      action: "prepare_paid_subscription",
      prefix: "syl-paid-",
      first: {
        accountId: "100000000000002",
        accepted: true,
        billingFrequency: "Monthly",
        plan: "Launch",
        subscriptionStartDate: "2026-09-01",
      },
      changed: {
        accountId: "100000000000002",
        accepted: true,
        billingFrequency: "Annual",
        plan: "Growth",
        subscriptionStartDate: "2026-10-01",
      },
    },
  ];
  for (const candidate of cases) {
    const first = deriveOperationIdentity(
      config,
      candidate.action,
      "100000000000001",
      candidate.first,
    );
    const changed = deriveOperationIdentity(
      config,
      candidate.action,
      "100000000000001",
      candidate.changed,
    );
    assert.equal(changed.operationKey, first.operationKey);
    assert.equal(changed.billingReference, first.billingReference);
    assert.notEqual(changed.operationFingerprint, first.operationFingerprint);
    assert.match(first.billingReference, new RegExp(`^${candidate.prefix}[a-f0-9]{32}$`));

    const app = memoryApp(config.operationTable);
    const store = createOperationStore(app, config);
    await store.claim({
      operationKey: first.operationKey,
      operationFingerprint: first.operationFingerprint,
      action: candidate.action,
      scopeId: "100000000000001",
    });
    const conflict = await store.claim({
      operationKey: changed.operationKey,
      operationFingerprint: changed.operationFingerprint,
      action: candidate.action,
      scopeId: "100000000000001",
    });
    assert.equal(conflict.outcome, "duplicate-conflict");
  }
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
    "ensure_customer",
    "100000000000001",
    { accountId },
  );
  const secondDealAction = deriveOperationIdentity(
    config,
    "start_evaluation",
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
