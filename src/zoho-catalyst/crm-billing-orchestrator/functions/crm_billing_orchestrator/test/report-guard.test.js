"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createReportGuardStore } = require("../lib/report-guard");
const { createOperationStore } = require("../lib/idempotency");

const CONFIG = Object.freeze({ operationTable: "SyntheticOperations",
  deploymentEnvironment: "development", analyticsPartitionSecret: "synthetic-guard-secret-".repeat(3),
  sourceRevision: "1".repeat(40), platformOperationTimeoutMs: 1000 });
const BINDING = Object.freeze({ dealId: "100000000000001", accountId: "100000000000002",
  deploymentId: "synthetic-deployment", configurationVersion: "synthetic-v1" });
const A = "a".repeat(64);
const B = "b".repeat(64);
const AT = "2026-09-12T12:00:00.000Z";
const LATER = "2026-09-12T12:01:00.000Z";

function memory() {
  let row = null;
  const control = {};
  const calls = { inserts: 0, updates: 0, reads: 0 };
  const readByKey = async (key) => {
    calls.reads += 1;
    if (control.readError) throw new Error("Synthetic read failure");
    return row?.OPERATION_KEY === key ? structuredClone(row) : null;
  };
  const app = {
    datastore: () => ({ table: () => ({ insertRow: async (value) => {
      calls.inserts += 1;
      if (control.insertErrorBefore) throw new Error("Synthetic insert failure");
      if (row) throw new Error("Synthetic duplicate");
      row = { ROWID: "1", ...structuredClone(value) };
      if (control.insertErrorAfter) throw new Error("Synthetic ambiguous insert");
      return structuredClone(row);
    } }) }),
    zcql: () => ({ executeZCQLQuery: async (statement) => {
      if (statement.startsWith("SELECT ")) {
        const selected = await readByKey(statement.match(/OPERATION_KEY = '([a-f0-9]{64})'/)[1]);
        return selected ? [{ SyntheticOperations: selected }] : [];
      }
      calls.updates += 1;
      if (control.casErrorBefore) throw new Error("Synthetic CAS failure");
      if (control.beforeCas) await control.beforeCas(row);
      const [set, where] = statement.split(" WHERE ");
      assert.equal(where.split(" AND ").length, 5, "Catalyst permits at most five WHERE conditions");
      const expected = {
        ROWID: where.match(/^ROWID = ([0-9]+)/)[1],
        ACTION: where.match(/ACTION = '([^']+)'/)[1],
        STATUS: where.match(/STATUS = '([^']+)'/)[1],
        LAST_OUTCOME: where.match(/LAST_OUTCOME = '([^']+)'/)[1],
        OPERATION_VERSION: Number(where.match(/OPERATION_VERSION = ([0-9]+)/)[1]),
      };
      if (row && Object.entries(expected).every(([key, value]) => row[key] === value)) {
        row.OPERATION_PAYLOAD_JSON = set.match(/OPERATION_PAYLOAD_JSON = '([^']+)'/)[1];
        row.LAST_OUTCOME = set.match(/LAST_OUTCOME = '([^']+)'/)[1];
        row.OPERATION_VERSION = Number(set.match(/OPERATION_VERSION = ([0-9]+)/)[1]);
        row.UPDATED_AT = set.match(/UPDATED_AT = '([^']+)'/)[1];
      }
      if (control.casErrorAfter) throw new Error("Synthetic ambiguous CAS");
      if (control.readErrorAfterCas) control.readError = true;
      return [];
    } }),
  };
  return { app, control, calls, readByKey, row: () => row,
    store: createReportGuardStore(app, CONFIG, readByKey) };
}

test("writer guard preserves its binding and confirmed predecessor across revisions", async () => {
  const selected = memory();
  assert.equal(await selected.store.readReportGuard(BINDING), null);
  const first = await selected.store.claimReportGuard(BINDING, A, null, AT);
  assert.equal(first.claimed, true);
  assert.deepEqual(first.guard, { schemaVersion: 1, ...BINDING,
    confirmedOperationKey: null, inflightOperationKey: A });
  assert.equal(selected.row().ACTION, "report_summary_write_guard");
  assert.equal(selected.row().STATUS, "processing");
  assert.equal((await selected.store.completeReportGuard(BINDING, A, AT)).completed, true);
  assert.equal((await selected.store.completeReportGuard(BINDING, A, AT)).completed, true);
  assert.equal(selected.calls.updates, 2);
  assert.equal((await selected.store.claimReportGuard(BINDING, B, null, LATER)).claimed, false);
  assert.equal((await selected.store.claimReportGuard(BINDING, B, A, LATER)).claimed, true);
  assert.equal((await selected.store.completeReportGuard(BINDING, B, LATER)).completed, true);
  assert.deepEqual(await selected.store.readReportGuard(BINDING), {
    schemaVersion: 1, ...BINDING, confirmedOperationKey: B, inflightOperationKey: null,
  });
  assert.equal(selected.row().CREATED_AT, AT);
  assert.equal(selected.row().SOURCE_REVISION, CONFIG.sourceRevision);
});

test("same-operation claim replays without another CAS; another operation cannot expire or complete it", async () => {
  const selected = memory();
  await selected.store.claimReportGuard(BINDING, A, null, AT);
  assert.equal((await selected.store.claimReportGuard(BINDING, A, null, LATER)).claimed, true);
  assert.equal((await selected.store.claimReportGuard(BINDING, B, null,
    "2099-01-01T00:00:00.000Z")).claimed, false);
  assert.equal((await selected.store.completeReportGuard(BINDING, B, LATER)).completed, false);
  assert.equal(selected.calls.updates, 1);
  assert.equal((await selected.store.readReportGuard(BINDING)).inflightOperationKey, A);
});

test("two different revisions racing for the same idle predecessor have one winner", async () => {
  const selected = memory();
  const results = await Promise.all([
    selected.store.claimReportGuard(BINDING, A, null, AT),
    selected.store.claimReportGuard(BINDING, B, null, AT),
  ]);
  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.ok([A, B].includes((await selected.store.readReportGuard(BINDING)).inflightOperationKey));
  assert.equal(selected.row().OPERATION_VERSION, 2);
});

test("same Deal cannot create another guard by changing Account, deployment or configuration", async () => {
  const selected = memory();
  await selected.store.claimReportGuard(BINDING, A, null, AT);
  for (const changed of [
    { accountId: "100000000000003" }, { deploymentId: "other-deployment" },
    { configurationVersion: "other-v2" },
  ]) {
    await assert.rejects(selected.store.claimReportGuard({ ...BINDING, ...changed }, B, null, AT),
      (error) => error.publicCode === "reconciliation_required");
  }
  assert.equal(selected.calls.inserts, 1);
  assert.equal(selected.calls.updates, 1);
});

test("malformed inputs fail before datastore access", async () => {
  const selected = memory();
  for (const binding of [{ ...BINDING, extra: true }, { ...BINDING, dealId: 100000000000001 },
    { ...BINDING, deploymentId: "unsafe'value" }, { ...BINDING, accountId: null }]) {
    await assert.rejects(selected.store.claimReportGuard(binding, A, null, AT),
      (error) => error.publicCode === "operation_invalid");
  }
  for (const args of [[BINDING, "invalid", null, AT], [BINDING, A, undefined, AT],
    [BINDING, A, null, "2026-02-30T00:00:00.000Z"]]) {
    await assert.rejects(selected.store.claimReportGuard(...args),
      (error) => error.publicCode === "operation_invalid");
  }
  assert.deepEqual(selected.calls, { inserts: 0, updates: 0, reads: 0 });
});

test("malformed or rebound durable payload never grants ownership", async () => {
  const mutations = [
    (row) => { row.OPERATION_PAYLOAD_JSON = "invalid"; },
    (row) => { row.OPERATION_FINGERPRINT = "f".repeat(64); },
    (row) => { row.ACTION = "sync_report_summary"; },
    (row) => { row.STATUS = "completed"; },
    (row) => { row.LAST_OUTCOME = "report_writer_idle"; },
    (row) => { row.OPERATION_VERSION = 0; },
    (row) => { row.UPDATED_AT = "invalid"; },
    (row) => { const guard = JSON.parse(row.OPERATION_PAYLOAD_JSON); guard.extra = true;
      row.OPERATION_PAYLOAD_JSON = JSON.stringify(guard); },
    (row) => { const guard = JSON.parse(row.OPERATION_PAYLOAD_JSON); guard.accountId = "100000000000003";
      row.OPERATION_PAYLOAD_JSON = JSON.stringify(guard); },
  ];
  for (const mutate of mutations) {
    const selected = memory();
    await selected.store.claimReportGuard(BINDING, A, null, AT);
    mutate(selected.row());
    await assert.rejects(selected.store.readReportGuard(BINDING),
      (error) => error.publicCode === "reconciliation_required");
    assert.equal(selected.calls.updates, 1);
  }
});

test("read failure is sanitized and never creates or mutates a guard", async () => {
  const selected = memory();
  selected.control.readError = true;
  await assert.rejects(selected.store.claimReportGuard(BINDING, A, null, AT),
    (error) => error.publicCode === "reconciliation_required"
      && error.message === "Report writer state readback is unavailable");
  assert.equal(selected.calls.inserts, 0);
  assert.equal(selected.calls.updates, 0);
});

test("uncertain creation and CAS use exact readback, never blind retries", async () => {
  const committed = memory();
  committed.control.insertErrorAfter = true;
  committed.control.casErrorAfter = true;
  assert.equal((await committed.store.claimReportGuard(BINDING, A, null, AT)).claimed, true);
  assert.equal((await committed.store.completeReportGuard(BINDING, A, LATER)).completed, true);
  assert.equal(committed.calls.inserts, 1);
  assert.equal(committed.calls.updates, 2);

  const notCommitted = memory();
  notCommitted.control.casErrorBefore = true;
  assert.equal((await notCommitted.store.claimReportGuard(BINDING, A, null, AT)).claimed, false);
  assert.equal(notCommitted.calls.updates, 1);
  assert.equal((await notCommitted.store.readReportGuard(BINDING)).inflightOperationKey, null);

  const failedInsert = memory();
  failedInsert.control.insertErrorBefore = true;
  await assert.rejects(failedInsert.store.claimReportGuard(BINDING, A, null, AT),
    (error) => error.publicCode === "reconciliation_required");
  assert.equal(failedInsert.calls.inserts, 1);
  assert.equal(failedInsert.calls.updates, 0);
});

test("changed cursor loses CAS without overwriting another writer", async () => {
  const selected = memory();
  selected.control.beforeCas = (row) => {
    const guard = JSON.parse(row.OPERATION_PAYLOAD_JSON);
    guard.inflightOperationKey = B;
    row.OPERATION_PAYLOAD_JSON = JSON.stringify(guard);
    row.LAST_OUTCOME = "report_writer_busy";
    row.OPERATION_VERSION += 1;
    row.UPDATED_AT = LATER;
  };
  const result = await selected.store.claimReportGuard(BINDING, A, null, AT);
  assert.equal(result.claimed, false);
  assert.equal(result.guard.inflightOperationKey, B);
  assert.equal(selected.calls.updates, 1);
});

test("post-CAS read failure keeps a possibly committed claim busy without a second write", async () => {
  const selected = memory();
  selected.control.readErrorAfterCas = true;
  await assert.rejects(selected.store.claimReportGuard(BINDING, A, null, AT),
    (error) => error.publicCode === "reconciliation_required");
  assert.equal(selected.calls.updates, 1);
  assert.equal(JSON.parse(selected.row().OPERATION_PAYLOAD_JSON).inflightOperationKey, A);
  selected.control.readError = false;
  selected.control.readErrorAfterCas = false;
  assert.equal((await selected.store.claimReportGuard(BINDING, B, null, LATER)).claimed, false);
  assert.equal(selected.calls.updates, 1);
});

test("completion cannot fabricate a claim, and store exposes the helper without new schema", async () => {
  const selected = memory();
  await assert.rejects(selected.store.completeReportGuard(BINDING, A, AT),
    (error) => error.publicCode === "reconciliation_required");
  const integrated = createOperationStore(selected.app, CONFIG);
  assert.equal(typeof integrated.readReportGuard, "function");
  assert.equal(typeof integrated.claimReportGuard, "function");
  assert.equal(typeof integrated.completeReportGuard, "function");
  assert.equal((await integrated.claimReportGuard(BINDING, A, null, AT)).claimed, true);
});
