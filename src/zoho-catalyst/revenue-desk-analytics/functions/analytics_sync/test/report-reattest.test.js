'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { createReconciledReportFixture } = require('./helpers/reconciled-report-fixture');
const { createReconciledFreeTestInputReader } = require('../../../tools/read-reconciled-free-test-input');
const { createReportCheckpointReattestor } = require('../../../tools/reattest-report-checkpoints');
const { createCatalystStore } = require('../lib/catalyst-store');
const { createReportAttemptBudget, REPORT_ATTEMPT_MAXIMUMS } = require('../lib/report-attempt-budget');
const { checkpointState, checkpointVerificationPatch } = require('../lib/report-checkpoint-verification');
const { checkpointKey } = require('../lib/facts');

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });
const REJECTED = { code: 'DRAFT_RECONCILIATION_REQUIRED' };
const TYPES = ['deployment', 'call', 'final_test_result'];

function expired(f) {
  f.runtime.clock.value = Math.max(...[...f.analyticsStore.checkpoints.values()]
    .map((row) => Date.parse(row.STALE_AFTER_AT))) + 1;
}

function reader(f, overrides = {}) {
  return createReconciledFreeTestInputReader({ ...f.readerOptions,
    reattestCheckpoints: createReportCheckpointReattestor({ analyticsStore: f.analyticsStore,
      now: f.now, freshnessMs: 7_200_000 }), ...overrides });
}

test('expired complete evidence receives real verification while import and CRM history remain unchanged', async () => {
  const f = await createReconciledReportFixture();
  const business = structuredClone({ source: f.analyticsStore.rows,
    imports: [...f.imported], crm: f.runtime.store.rows.get('CRMBillingOperations') });
  const before = new Map([...f.analyticsStore.checkpoints].map(([key, row]) => [key, structuredClone(row)]));
  expired(f);
  await assert.rejects(f.readInput(f.identity), REJECTED, 'The old read-only path must still block expired evidence.');
  const prepared = await reader(f)(f.identity);
  assert.equal(prepared.input.calls.length, 1);
  const verifications = TYPES.map((type) => f.analyticsStore.checkpoints.get(checkpointKey({ ...f.scope, RECORD_TYPE: type })));
  assert.equal(new Set(verifications.map((row) => row.REPORT_VERIFICATION_DIGEST)).size, 1);
  for (const row of verifications) {
    const original = before.get(row.CHECKPOINT_KEY);
    assert.match(row.REPORT_VERIFICATION_DIGEST, /^[a-f0-9]{64}$/);
    assert.equal(row.LAST_RECONCILED_AT, new Date(f.now()).toISOString());
    for (const field of ['LAST_SYNC_AT', 'LAST_PROVIDER_JOB_ID', 'LAST_ACCEPTED_ROW_COUNT',
      'LAST_REJECTED_ROW_COUNT', 'LAST_SOURCE_MODIFIED_AT', 'PROVIDER_WATERMARK']) {
      assert.equal(row[field], original[field]);
    }
    assert.equal(row.VERSION, original.VERSION + 1);
  }
  const verified = structuredClone([...f.analyticsStore.checkpoints]);
  assert.ok(await reader(f)(f.identity), 'Later review/retry inside the verified window remains ready.');
  assert.deepEqual([...f.analyticsStore.checkpoints], verified, 'A fresh retry creates no fictional new verification.');
  assert.deepEqual({ source: f.analyticsStore.rows, imports: [...f.imported],
    crm: f.runtime.store.rows.get('CRMBillingOperations') }, business);
});

test('expired zero-call reports verify the empty partition without inserting a call checkpoint', async () => {
  const f = await createReconciledReportFixture({ empty: true });
  expired(f);
  assert.equal((await reader(f)(f.identity)).input.calls.length, 0);
  assert.equal(await f.analyticsStore.getReportCheckpoint(f.scope, 'call'), null);
  assert.equal(f.analyticsStore.checkpoints.size, 2);
});

test('changed, incomplete or unhealthy evidence cannot obtain a fresh attestation', async () => {
  for (const fault of ['extra provider row', 'unresolved history', 'changed canonical', 'bad checkpoint time', 'checkpoint race']) {
    const f = await createReconciledReportFixture();
    expired(f);
    let writes = 0;
    const original = f.analyticsStore.reattestReportCheckpoint.bind(f.analyticsStore);
    f.analyticsStore.reattestReportCheckpoint = async (...args) => { writes += 1; return original(...args); };
    const options = {};
    if (fault === 'unresolved history') f.analyticsStore.rows[0].SYNC_STATUS = 'Pending';
    if (fault === 'changed canonical') f.runtime.store.rows.get('RevenueDeskCalls')[0].OUTCOME = 'spam';
    if (fault === 'bad checkpoint time') [...f.analyticsStore.checkpoints.values()][0].LAST_RECONCILED_AT = null;
    if (fault === 'extra provider row' || fault === 'checkpoint race') options.readCompleteScope = async (scope, type) => {
      const result = await f.readCompleteScope(scope, type);
      if (type === 'call') {
        if (fault === 'extra provider row') result.rows.push({ ...result.rows[0], RECORD_KEY: 'e'.repeat(64) });
        else f.analyticsStore.checkpoints.get(checkpointKey({ ...scope, RECORD_TYPE: 'deployment' })).VERSION += 1;
      }
      return result;
    };
    const attempt = reader(f, options)(f.identity);
    if (fault === 'unresolved history') assert.equal(await attempt, null);
    else await assert.rejects(attempt, REJECTED);
    assert.equal(writes, 0);
    assert.ok([...f.analyticsStore.checkpoints.values()].every((row) => !row.REPORT_VERIFICATION_DIGEST));
  }
});

test('a concurrent canonical change during durable verification blocks the resulting draft', async () => {
  const f = await createReconciledReportFixture();
  expired(f);
  const original = f.analyticsStore.reattestReportCheckpoint.bind(f.analyticsStore);
  let changed = false;
  f.analyticsStore.reattestReportCheckpoint = async (...args) => {
    const result = await original(...args);
    if (!changed) {
      changed = true;
      const row = f.runtime.store.rows.get('RevenueDeskCalls')[0];
      const call = JSON.parse(row.CANONICAL_CALL_JSON);
      call.issueSummary = 'Concurrent synthetic correction';
      row.CANONICAL_CALL_JSON = JSON.stringify(call);
    }
    return result;
  };
  await assert.rejects(reader(f)(f.identity), REJECTED);
});

test('one budget covers expired re-attestation and a second review pass without replenishing requests', async () => {
  const f = await createReconciledReportFixture();
  expired(f);
  const budget = createReportAttemptBudget({ timeoutMs: 60_000, now: f.now, limits: REPORT_ATTEMPT_MAXIMUMS });
  try {
    const read = reader(f, { async readCompleteScope(scope, type, options) {
      options.budget.consume('analytics_read', 2);
      return f.readCompleteScope(scope, type);
    } });
    const options = { signal: budget.signal, budget };
    assert.ok(await read(f.identity, options));
    assert.ok(await read(f.identity, options));
    assert.equal(budget.snapshot().analytics_read, 12);
    assert.equal(budget.snapshot().checkpoint_write, 3);
    assert.ok(budget.snapshot().source_read > 100);
    assert.ok(budget.snapshot().source_read <= REPORT_ATTEMPT_MAXIMUMS.source_read);
    await assert.rejects(read(f.identity, options), REJECTED);
    assert.equal(budget.snapshot().analytics_read, 12);
    assert.equal(budget.signal.aborted, true);
  } finally { budget.close(); }
});

function checkpointSdk(initial, { ambiguous = false, conflict = false } = {}) {
  let row = structuredClone(initial);
  const statements = [];
  const app = { datastore() { throw new Error('No checkpoint insert is allowed.'); },
    zcql: () => ({ async executeZCQLQuery(statement) {
      statements.push(statement);
      if (statement.startsWith('SELECT ')) return [{ AnalyticsSyncCheckpoints: structuredClone(row) }];
      assert.match(statement, /^UPDATE AnalyticsSyncCheckpoints SET /);
      assert.equal(statement.includes('LAST_SYNC_AT ='), false);
      assert.equal(statement.includes('LAST_PROVIDER_JOB_ID ='), false);
      const [, set, where] = statement.match(/^UPDATE AnalyticsSyncCheckpoints SET (.+) WHERE (.+)$/);
      const values = (text) => Object.fromEntries([...text.matchAll(/([A-Z_]+) = ('[^']*'|\d+)/g)]
        .map(([, key, value]) => [key, value.startsWith("'") ? value.slice(1, -1) : Number(value)]));
      const predicates = values(where);
      if (conflict) row.VERSION += 1;
      if (Object.entries(predicates).every(([key, value]) => String(row[key]) === String(value))) {
        Object.assign(row, values(set));
      }
      if (ambiguous) throw new Error('Synthetic timeout after possible commit.');
      return [];
    } }) };
  return { app, statements, current: () => structuredClone(row) };
}

test('Catalyst re-attestation resolves ambiguous CAS only by exact independent readback and preserves history', async () => {
  const f = await createReconciledReportFixture();
  expired(f);
  const expected = { ...await f.analyticsStore.getReportCheckpoint(f.scope, 'call'), ROWID: '7001' };
  const verification = { digest: 'f'.repeat(64), verifiedAt: new Date(f.now()).toISOString(),
    staleAfterAt: new Date(f.now() + 7_200_000).toISOString() };
  for (const conflict of [false, true]) {
    const sdk = checkpointSdk(expected, { ambiguous: true, conflict });
    const durable = createCatalystStore(sdk.app, { environment: 'development', sourceRevision: f.scope.SOURCE_REVISION,
      platformTimeoutMs: 1000, tables: { outbox: 'AnalyticsSyncOutbox', checkpoint: 'AnalyticsSyncCheckpoints' } });
    const attempt = durable.reattestReportCheckpoint(f.scope, 'call', expected, verification);
    if (conflict) await assert.rejects(attempt, { code: 'REPORT_CHECKPOINT_WRITE_UNCONFIRMED' });
    else {
      const result = await attempt;
      assert.equal(checkpointState(result), checkpointState({ ...expected,
        ...checkpointVerificationPatch(f.scope, 'call', expected, verification) }));
      assert.deepEqual(await durable.reattestReportCheckpoint(f.scope, 'call', expected, verification), result);
    }
    assert.equal(sdk.statements.filter((statement) => statement.startsWith('UPDATE ')).length, 1);
  }
});


test('25-call late correction and accepted in-flight overshoot retain complete bounded history', async () => {
  for (const scenario of ['late correction', 'in-flight overshoot']) {
    const callCount = scenario === 'late correction' ? 25 : 26;
    const f = await createReconciledReportFixture({
      analyses: Array.from({ length: callCount }, (_, index) => ({ issue_summary: `Synthetic request ${index}` })),
      endedBeforeAnalysis: true, lateFinalCall: scenario === 'late correction',
      inFlightOvershoot: scenario === 'in-flight overshoot',
    });
    const history = Object.fromEntries(TYPES.map((type) => [type,
      f.analyticsStore.rows.filter((row) => row.RECORD_TYPE === type).length]));
    assert.ok(Object.values(history).every((count) => count < 100));
    assert.equal(history.final_test_result, 1);
    assert.ok(f.analyticsStore.rows.every((row) => row.SYNC_STATUS === 'Succeeded'));
    expired(f);
    const budget = createReportAttemptBudget({ timeoutMs: 60_000, now: f.now, limits: REPORT_ATTEMPT_MAXIMUMS });
    try {
      const read = reader(f, { async readCompleteScope(scope, type, options) {
        options.budget.consume('analytics_read', 2);
        return f.readCompleteScope(scope, type);
      } });
      const options = { budget, signal: budget.signal };
      const result = await read(f.identity, options);
      assert.equal(result.input.calls.length, callCount);
      assert.equal(result.callDetails.rows.length, callCount);
      assert.ok(await read(f.identity, options));
      assert.equal(budget.snapshot().analytics_read, 12);
      assert.equal(budget.snapshot().checkpoint_write, 3);
      assert.ok(budget.snapshot().source_read <= REPORT_ATTEMPT_MAXIMUMS.source_read);
    } finally { budget.close(); }
    // An older unresolved version is still a hard block, even after newer rows
    // and checkpoints passed verification. No truncation or latest-only filter.
    f.analyticsStore.rows.find((row) => row.RECORD_TYPE === 'deployment').SYNC_STATUS = 'Pending';
    assert.equal(await reader(f)(f.identity), null);
  }
});


test('verification rejects blank, null and boolean checkpoint numbers before any durable update', async () => {
  const f = await createReconciledReportFixture();
  expired(f);
  const original = await f.analyticsStore.getReportCheckpoint(f.scope, 'call');
  const verification = { digest: 'f'.repeat(64), verifiedAt: new Date(f.now()).toISOString(),
    staleAfterAt: new Date(f.now() + 7_200_000).toISOString() };
  for (const field of ['ROW_SCHEMA_VERSION', 'VERSION', 'LAST_ACCEPTED_ROW_COUNT', 'LAST_REJECTED_ROW_COUNT']) {
    for (const value of [null, '', ' ', false, true]) {
      assert.throws(() => checkpointVerificationPatch(f.scope, 'call', { ...original, [field]: value }, verification),
        { code: 'REPORT_CHECKPOINT_INVALID' });
    }
  }
});


test('partial durable verification remains blocked and a fresh complete retry safely finishes the cohort', async () => {
  const f = await createReconciledReportFixture();
  expired(f);
  const imported = structuredClone([...f.imported]);
  const original = f.analyticsStore.reattestReportCheckpoint.bind(f.analyticsStore);
  let failOnce = true;
  f.analyticsStore.reattestReportCheckpoint = async (scope, type, ...rest) => {
    if (type === 'call' && failOnce) { failOnce = false; throw new Error('Synthetic storage failure'); }
    return original(scope, type, ...rest);
  };
  await assert.rejects(reader(f)(f.identity), REJECTED);
  assert.equal([...f.analyticsStore.checkpoints.values()].filter((row) => row.REPORT_VERIFICATION_DIGEST).length, 1);
  await assert.rejects(f.readInput(f.identity), REJECTED, 'A partial verification cannot waive other expired checkpoints.');
  f.runtime.clock.value += 1;
  assert.ok(await reader(f)(f.identity));
  const rows = [...f.analyticsStore.checkpoints.values()].filter((row) => TYPES.includes(row.RECORD_TYPE));
  assert.equal(new Set(rows.map((row) => row.LAST_RECONCILED_AT)).size, 1);
  assert.equal(new Set(rows.map((row) => row.REPORT_VERIFICATION_DIGEST)).size, 1);
  assert.deepEqual([...f.imported], imported);
});


test('verified manual stopped reports preserve stop evidence through expired checkpoint renewal, including empty calls', async () => {
  for (const empty of [false, true]) {
    const f = await createReconciledReportFixture({ stopped: true, empty });
    const before = structuredClone(f.runtime.store.rows.get('RevenueDeskDeployments')[0]);
    expired(f);
    const budget = createReportAttemptBudget({ timeoutMs: 60_000, now: f.now, limits: REPORT_ATTEMPT_MAXIMUMS });
    try {
      const read = reader(f, { async readCompleteScope(scope, type, options) {
        options.budget.consume('analytics_read', 2);
        return f.readCompleteScope(scope, type);
      } });
      const prepared = await read(f.identity, { budget });
      assert.equal(prepared.input.calls.length, empty ? 0 : 2);
      assert.equal(prepared.input.deployment.DEPLOYMENT_STATUS, 'stopped');
      assert.ok(await read(f.identity, { budget }));
      assert.ok(budget.snapshot().source_read <= REPORT_ATTEMPT_MAXIMUMS.source_read);
      assert.equal(budget.snapshot().checkpoint_write, empty ? 2 : 3);
      assert.deepEqual(f.runtime.store.rows.get('RevenueDeskDeployments')[0], before);
    } finally { budget.close(); }
    if (empty) assert.equal(await f.analyticsStore.getReportCheckpoint(f.scope, 'call'), null);
    const operation = f.runtime.store.rows.get('CRMBillingOperations')[0];
    operation.STATUS = 'pending';
    await assert.rejects(reader(f)(f.identity), REJECTED, 'Stopped/NotRequired cannot waive exact CRM completion.');
    operation.STATUS = 'completed';
    const claim = f.runtime.store.rows.get('RevenueDeskEventReceipts').find((row) => row.EVENT_TYPE === 'rollback_claim');
    assert.ok(claim);
    claim.STATUS = 'Pending';
    await assert.rejects(reader(f)(f.identity), REJECTED, 'A completed HMAC rollback claim is required on every source pass.');
  }
});
