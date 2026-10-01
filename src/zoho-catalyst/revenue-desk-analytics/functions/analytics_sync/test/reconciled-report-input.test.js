'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { createReconciledFreeTestInputReader } = require('../../../tools/read-reconciled-free-test-input');
const { createReconciledReportFixture } = require('./helpers/reconciled-report-fixture');
const { checkpointKey, createOutboxRow, parseOutboxRow, targetRow } = require('../lib/facts');
const { buildFreeTestReport } = require('../../../tools/build-free-test-report');

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });
const REJECTED = { code: 'DRAFT_RECONCILIATION_REQUIRED', message: 'DRAFT_RECONCILIATION_REQUIRED' };

function checkpoint(fixture, type = 'call') {
  return fixture.analyticsStore.checkpoints.get(checkpointKey({ ...fixture.scope, RECORD_TYPE: type }));
}

function changeLatestFact(fixture, type, patch) {
  const candidates = fixture.analyticsStore.rows.filter((row) => row.RECORD_TYPE === type)
    .sort((a, b) => a.SOURCE_MODIFIED_AT.localeCompare(b.SOURCE_MODIFIED_AT));
  const row = candidates.at(-1);
  const changed = createOutboxRow(type, { ...parseOutboxRow(row, 'development').fact, ...patch }, row.CREATED_AT);
  // Preserve actual service execution state while changing the candidate facts
  // and their matching readback. The canonical runtime remains independent.
  for (const key of ['PAYLOAD_JSON', 'PAYLOAD_HASH', 'OUTBOX_KEY', 'SOURCE_MODIFIED_AT']) row[key] = changed[key];
  fixture.imported.get(type).set(row.RECORD_KEY, targetRow(parseOutboxRow(row, 'development')));
}

test('reader builds the existing gated report from actual terminal and Analytics service transitions', async () => {
  const f = await createReconciledReportFixture();
  const prepared = await f.readInput(f.identity);
  assert.ok(prepared);
  assert.equal(prepared.input.calls.length, 1);
  assert.equal(prepared.callDetails.rows.length, 1);
  assert.equal(prepared.callDetails.rows[0].issueSummary, 'Synthetic leaking tap');
  assert.doesNotThrow(() => buildFreeTestReport(prepared.input, f.now(), prepared.callDetails));
  assert.ok(f.analyticsStore.rows.filter((row) => row.RECORD_TYPE === 'deployment').length > 1,
    'The source history must retain older deployment versions.');
});

test('source processing waits for real Analytics transitions and then becomes ready', async () => {
  const f = await createReconciledReportFixture({ reconcile: false });
  assert.equal(await f.readInput(f.identity), null);
  await f.runAnalyticsStep();
  assert.equal(await f.readInput(f.identity), null);
  await f.reconcileAnalytics();
  assert.ok(await f.readInput(f.identity));
});

test('a full 25-call cohort with ended/analyzed events and accepted synthetic notifications remains complete', async () => {
  let accepted = 0;
  const f = await createReconciledReportFixture({
    analyses: Array.from({ length: 25 }, (_, index) => ({ issue_summary: `Synthetic repair request ${index + 1}` })),
    endedBeforeAnalysis: true,
    mailBehavior(message) {
      accepted += 1;
      assert.ok(message.to_email.every((recipient) => recipient.endsWith('@example.invalid')));
      return { isAsync: false, from_email: message.from_email, to_email: message.to_email,
        project_details: { id: 'synthetic_mail_project' } };
    },
  });
  const prepared = await f.readInput(f.identity);
  assert.ok(prepared);
  assert.equal(accepted, 25);
  assert.equal(prepared.input.calls.length, 25);
  assert.equal(prepared.callDetails.rows.length, 25);
  assert.ok(prepared.input.calls.every((call) => call.NOTIFICATION_STATE === 'sent'));
  assert.equal(new Set(prepared.callDetails.rows.map((row) => row.issueSummary)).size, 25);
  const counts = Object.fromEntries(['deployment', 'call', 'final_test_result'].map((type) =>
    [type, f.analyticsStore.rows.filter((row) => row.RECORD_TYPE === type).length]));
  assert.deepEqual(counts, { deployment: 27, call: 25, final_test_result: 1 });
  assert.equal(new Set(f.analyticsStore.rows.map((row) => row.ROWID)).size, f.analyticsStore.rows.length);
  assert.ok(f.analyticsStore.rows.every((row) => row.SYNC_STATUS === 'Succeeded'));
  assert.doesNotThrow(() => buildFreeTestReport(prepared.input, f.now(), prepared.callDetails));
});

test('zero-call terminal tests require an independent empty provider partition and no invented checkpoint', async () => {
  const f = await createReconciledReportFixture({ empty: true });
  const prepared = await f.readInput(f.identity);
  assert.equal(prepared.input.calls.length, 0);
  const scope = prepared.input.evidence.scopes[0];
  assert.equal(scope.checkpoints.call, null);
  assert.equal(scope.analytics_readback.record_types.call.empty_source_verified, true);
  assert.equal(scope.analytics_readback.record_types.call.verified_at, prepared.input.evidence.evaluated_at);
  const reader = createReconciledFreeTestInputReader({ ...f.readerOptions,
    async readCompleteScope(scopeValue, type) {
      if (type === 'call') return { ...await f.readCompleteScope(scopeValue, type), complete: false };
      return f.readCompleteScope(scopeValue, type);
    } });
  await assert.rejects(reader(f.identity), REJECTED);
});

test('a matching source and Analytics rowset cannot override current canonical deployment or final facts', async () => {
  const f = await createReconciledReportFixture();
  changeLatestFact(f, 'deployment', { CALL_LIMIT: 26 });
  changeLatestFact(f, 'final_test_result', { CALL_LIMIT: 26 });
  await assert.rejects(f.readInput(f.identity), REJECTED);
  const second = await createReconciledReportFixture({analyses:[{request_kind:'new_service_request'}]});
  changeLatestFact(second, 'final_test_result', { ANALYSIS_EVIDENCE_COMPLETE: false });
  await assert.rejects(second.readInput(second.identity), REJECTED);
});

test('null, blank, boolean and noncanonical checkpoint numbers never become zero', async () => {
  const f = await createReconciledReportFixture();
  const row = checkpoint(f);
  for (const value of [null, '', false, true, ' 0', '00', Number.NaN, -1, 0.5]) {
    row.LAST_REJECTED_ROW_COUNT = value;
    await assert.rejects(f.readInput(f.identity), REJECTED);
  }
  row.LAST_REJECTED_ROW_COUNT = '0';
  row.ROW_SCHEMA_VERSION = '2';
  assert.ok(await f.readInput(f.identity));
});

test('an older unresolved source version prevents a latest-only success claim', async () => {
  const f = await createReconciledReportFixture();
  const rows = f.analyticsStore.rows.filter((row) => row.RECORD_TYPE === 'deployment')
    .sort((a, b) => a.SOURCE_MODIFIED_AT.localeCompare(b.SOURCE_MODIFIED_AT));
  assert.ok(rows.length > 1);
  rows[0].SYNC_STATUS = 'ReconciliationRequired';
  assert.equal(await f.readInput(f.identity), null);
});

test('wrong scope, configuration, source revision and duplicate versions fail closed', async () => {
  const f = await createReconciledReportFixture();
  await assert.rejects(f.readInput({ ...f.identity, clientId: 'client_B' }), REJECTED);
  const rows = await f.analyticsStore.listReportRows(f.scope);
  for (const patch of [{ CLIENT_KEY: '0'.repeat(64) }, { CONFIGURATION_VERSION: 'another_config' },
    { SOURCE_REVISION: 'f'.repeat(40) }]) {
    const reader = createReconciledFreeTestInputReader({ ...f.readerOptions, analyticsStore: {
      getReportCheckpoint: f.analyticsStore.getReportCheckpoint.bind(f.analyticsStore),
      listReportRows: async () => rows.map((row) => ({ ...row, ...patch })),
    } });
    await assert.rejects(reader(f.identity), REJECTED);
  }
  f.analyticsStore.rows.push(structuredClone(f.analyticsStore.rows.find((row) => row.RECORD_TYPE === 'call')));
  await assert.rejects(f.readInput(f.identity), REJECTED);
});

test('partial, stale, extra, cross-client and mismatched provider readbacks cannot attest a report', async () => {
  const f = await createReconciledReportFixture();
  const mutations = [
    (value) => { value.complete = false; },
    (value) => { value.bindingVerified = false; },
    (value) => { value.observedAt = new Date(f.now() - 1).toISOString(); },
    (value) => { value.scope.SOURCE_REVISION = 'f'.repeat(40); },
    (value) => { value.rows[0].CLIENT_KEY = '0'.repeat(64); },
    (value) => { value.rows[0].PAYLOAD_HASH = '0'.repeat(64); },
    (value) => { value.rows[0].privatePayload = 'not allowed'; },
    (value) => { value.rows.push({ ...value.rows[0], RECORD_KEY: '0'.repeat(64) }); },
    (value) => { value.rows = []; },
  ];
  for (const mutate of mutations) {
    const reader = createReconciledFreeTestInputReader({ ...f.readerOptions,
      async readCompleteScope(scope, type) {
        const result = await f.readCompleteScope(scope, type);
        if (type === 'call') mutate(result);
        return result;
      } });
    await assert.rejects(reader(f.identity), REJECTED);
  }
});

test('checkpoint or mutable canonical state changing during provider reads invalidates the initial snapshot', async () => {
  for (const change of ['checkpoint', 'canonical']) {
    const f = await createReconciledReportFixture();
    const reader = createReconciledFreeTestInputReader({ ...f.readerOptions,
      async readCompleteScope(scope, type) {
        const result = await f.readCompleteScope(scope, type);
        if (type === 'final_test_result') {
          if (change === 'checkpoint') checkpoint(f, 'deployment').LAST_RECONCILED_AT = new Date(f.now() - 1).toISOString();
          else f.runtime.store.rows.get('RevenueDeskDeployments').find((row) => row.DEPLOYMENT_ID === f.identity.deploymentId)
            .REPORT_RECONCILIATION_VERSION += 1;
        }
        return result;
      } });
    await assert.rejects(reader(f.identity), REJECTED);
  }
});

test('bounded enumeration rejects saturation rather than trimming the older source history', async () => {
  const f = await createReconciledReportFixture();
  const call = f.analyticsStore.rows.find((row) => row.RECORD_TYPE === 'call');
  while (f.analyticsStore.rows.filter((row) => row.RECORD_TYPE === 'call').length < 100) {
    f.analyticsStore.rows.push(structuredClone(call));
  }
  await assert.rejects(f.readInput(f.identity), REJECTED);
});

test('assembler forwards cancellation and stops before reading later partitions', async () => {
  const f = await createReconciledReportFixture();
  const controller = new AbortController();
  const types = [];
  const reader = createReconciledFreeTestInputReader({ ...f.readerOptions,
    async readCompleteScope(scope, type, options) {
      assert.equal(options.signal, controller.signal);
      assert.equal(Object.isFrozen(options), true);
      types.push(type);
      const result = await f.readCompleteScope(scope, type);
      controller.abort();
      return result;
    },
  });
  await assert.rejects(reader(f.identity, { signal: controller.signal }), REJECTED);
  assert.deepEqual(types, ['deployment']);
  await assert.rejects(reader(f.identity, { signal: controller.signal }), REJECTED);
  assert.deepEqual(types, ['deployment']);
  await assert.rejects(reader(f.identity, { signal: {} }), REJECTED);
  await assert.rejects(reader(f.identity, { unknown: true }), REJECTED);
});

test('cancellation during a nested canonical read prevents every later store request', async () => {
  for (const pauseAt of ['detail deployment', 'rollback claims']) {
    const f = await createReconciledReportFixture();
    const controller = new AbortController();
    let release;
    let reached;
    let deploymentReads = 0;
    const pending = new Promise((resolve) => { release = resolve; });
    const paused = new Promise((resolve) => { reached = resolve; });
    const requests = [];
    const runtimeStore = {};
    for (const method of ['unique', 'query', 'queryBounded']) {
      runtimeStore[method] = async function (...args) {
        assert.equal(this, runtimeStore, 'The cancellation boundary must preserve the store receiver.');
        requests.push(method);
        const result = await f.runtime.store[method](...args);
        const isDeployment = method === 'unique' && args[0] === f.runtime.config.tables.DEPLOYMENT_TABLE;
        if (isDeployment) deploymentReads += 1;
        if ((pauseAt === 'detail deployment' && isDeployment && deploymentReads === 2)
          || (pauseAt === 'rollback claims' && method === 'queryBounded')) {
          reached();
          await pending;
        }
        return result;
      };
    }
    const reader = createReconciledFreeTestInputReader({ ...f.readerOptions, runtimeStore,
      async readCompleteScope() { assert.fail('No provider read should follow canonical cancellation.'); } });
    const result = reader(f.identity, { signal: controller.signal });
    const rejected = assert.rejects(result, REJECTED);
    await paused;
    const startedBeforeAbort = requests.length;
    controller.abort();
    release();
    await rejected;
    assert.equal(requests.length, startedBeforeAbort);
  }
});
