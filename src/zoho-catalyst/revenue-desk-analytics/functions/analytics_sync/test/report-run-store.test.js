'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createReportRunStore } = require('../lib/report-run-store');
const key = 'a'.repeat(64);
const syntheticRowId = `1${'0'.repeat(15)}1`;
const state = { kind: 'report_attempt_v1', identity: { clientId: 'client_A', deploymentId: 'deployment_A',
  periodStart: '2026-09-20', periodEnd: '2026-09-27' }, phase: 'working', owner: 'synthetic',
failures: 1, nextAttemptAt: 1800000000000, lastGenerationKey: null };
function fixture() {
  let row = null;
  const statements = [];
  const f = { failInsertResponse: false, failUpdateResponse: false, conflict: false,
    read: () => row, corrupt: fn => { row = fn(row); } };
  const app = { datastore: () => ({ table(name) {
    assert.equal(name, 'ReportRuns');
    return { async insertRow(value) {
      assert.equal(row, null);
      row = { ...value, ROWID: syntheticRowId };
      if (f.failInsertResponse) throw new Error('private provider response');
      return { ...row };
    } };
  } }), zcql: () => ({ async executeZCQLQuery(sql) {
    statements.push(sql);
    assert.ok(sql.includes('ReportRuns'));
    if (sql.startsWith('UPDATE')) {
      assert.match(sql, new RegExp(`WHERE ROWID = ${syntheticRowId} AND IdempotencyKey = 'revenue-desk-report-v1:[a-f0-9]{64}' AND RD_REPORT_VERSION = 1$`));
      if (!f.conflict) {
        for (const match of sql.split(' WHERE ')[0].matchAll(/([A-Za-z_]+) = ('(?:[^']|'')*'|NULL|TRUE|FALSE|\d+)/g)) {
          const raw = match[2];
          row[match[1]] = raw.startsWith("'") ? raw.slice(1, -1).replaceAll("''", "'")
            : raw === 'NULL' ? null : raw === 'TRUE' ? true : raw === 'FALSE' ? false : Number(raw);
        }
      }
      if (f.failUpdateResponse) throw new Error('ambiguous provider response');
      return [];
    }
    assert.match(sql, /^SELECT \* FROM ReportRuns WHERE IdempotencyKey = 'revenue-desk-report-v1:[a-f0-9]{64}' LIMIT 2$/);
    return row ? [{ ReportRuns: structuredClone(row) }] : [];
  } }) };
  return Object.assign(f, { app, statements, store: createReportRunStore({ app, environment: 'development' }) });
}

test('observed mandatory ReportRuns columns are populated without fabricated approval/delivery', async () => {
  const f = fixture();
  const result = await f.store.insert(key, state);
  assert.equal(result.state.phase, 'working');
  assert.equal(f.read().ClientId, 'client_A');
  assert.equal(f.read().DeploymentId, 'deployment_A');
  assert.equal(f.read().PeriodStart, '2026-09-20');
  assert.equal(f.read().PeriodEnd, '2026-09-27');
  assert.equal(f.read().ReportType, 'free_test_report_verification_attempt');
  assert.equal(f.read().ApprovalStatus, 'OwnerReviewRequired');
  assert.equal(f.read().DeliveryStatus, 'NotSent');
  assert.equal(f.read().ReportTotalsReconciled, false);
  assert.equal(f.read().AutoDeliveryEnabledAtRun, false);
  assert.equal(f.read().RecipientSnapshotJson, undefined);
});

test('existing unique IdempotencyKey scopes reads away from retained legacy rows', async () => {
  const f = fixture();
  assert.equal(await f.store.get(key), null);
  assert.equal(f.statements.length, 1);
  await assert.rejects(f.store.get("' OR true"));
  assert.equal(f.statements.length, 1);
  assert.throws(() => createReportRunStore({ app: f.app, environment: 'production' }));
});

test('CAS requires independent row/version/state and operator-index readback', async () => {
  const f = fixture();
  const first = await f.store.insert(key, state);
  const next = await f.store.compareAndSwap(first, { ...state, phase: 'waiting' });
  assert.equal(next.version, 2);
  assert.equal(next.state.phase, 'waiting');
  f.corrupt(row => ({ ...row, DeliveryStatus: 'Sent' }));
  await assert.rejects(f.store.get(key));
});

test('malformed durable state, impossible period and cancelled query fail closed', async () => {
  const f = fixture();
  await assert.rejects(f.store.insert(key, { ...state, identity: { ...state.identity, periodStart: '2026-02-30' } }));
  assert.equal(f.read(), null);
  const controller = new AbortController(); controller.abort();
  const count = f.statements.length;
  await assert.rejects(f.store.get(key, { signal: controller.signal }));
  assert.equal(f.statements.length, count);
  await f.store.insert(key, state);
  f.corrupt(row => ({ ...row, ReportPayloadJson: '{private-bad-json' }));
  await assert.rejects(f.store.get(key), { code: 'REPORT_RUN_RECONCILIATION_REQUIRED' });
});

test('immediate cancellation prevents SDK dispatch in the timeout microtask gap', async () => {
  for (const operation of ['get', 'insert', 'compareAndSwap']) {
    const f = fixture();
    const current = operation === 'compareAndSwap' ? await f.store.insert(key, state) : null;
    const before = f.statements.length;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const pending = operation === 'get' ? f.store.get(key, options)
      : operation === 'insert' ? f.store.insert(key, state, options)
        : f.store.compareAndSwap(current, { ...state, phase: 'waiting' }, options);
    controller.abort();
    await assert.rejects(pending, { code: 'REPORT_RUN_RECONCILIATION_REQUIRED' });
    assert.equal(f.statements.length, before);
    assert.equal(f.read()?.RD_REPORT_VERSION ?? null, current?.version ?? null);
  }
});

test('ambiguous insert and CAS recover by exact independent readback, while conflict stays unconfirmed', async () => {
  const f = fixture(); f.failInsertResponse = true; f.failUpdateResponse = true;
  const first = await f.store.insert(key, state);
  assert.equal(first.version, 1);
  f.conflict = true;
  assert.equal(await f.store.compareAndSwap(first, { ...state, phase: 'waiting' }), null);
  f.conflict = false;
  assert.equal((await f.store.compareAndSwap(first, { ...state, phase: 'waiting' })).version, 2);
  for (const version of [true, '', '01', 2147483648]) {
    f.corrupt(row => ({ ...row, RD_REPORT_VERSION: version }));
    await assert.rejects(f.store.get(key), { code: 'REPORT_RUN_RECONCILIATION_REQUIRED' });
  }
});
