'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalystStore } = require('../lib/catalyst-store');
const { outboxRow } = require('./helpers');
const { callFact, MemoryStore, key } = require('./helpers');
const { checkpointKey, createOutboxRow } = require('../lib/facts');
const { buildDailyMetricFact } = require('../lib/daily-rollup');

const OUTBOX = 'AnalyticsSyncOutbox';
const CHECKPOINT = 'AnalyticsSyncCheckpoints';

function literal(statement, column) {
  return statement.match(new RegExp(`${column} = '([^']*)'`))?.[1];
}

function fakeApp(initialRows = []) {
  const rows = initialRows.map((row, index) => ({ ROWID: String(index + 1), ...row }));
  return {
    rows,
    zcql: () => ({
      executeZCQLQuery: async (statement) => {
        assert.match(statement, new RegExp(`FROM ${OUTBOX}`));
        let matches;
        if (statement.includes(' OUTBOX_KEY = ')) {
          matches = rows.filter((row) => row.OUTBOX_KEY === literal(statement, 'OUTBOX_KEY'));
          if (statement.includes('ROW_SCHEMA_VERSION = 2')) {
            matches = matches.filter((row) => Number(row.ROW_SCHEMA_VERSION) === 2);
          }
        } else {
          matches = rows.filter((row) => Number(row.ROW_SCHEMA_VERSION) === 2
            && row.RECORD_TYPE === literal(statement, 'RECORD_TYPE')
            && row.ENVIRONMENT === literal(statement, 'ENVIRONMENT')
            && row.CLIENT_KEY === literal(statement, 'CLIENT_KEY')
            && row.DEPLOYMENT_KEY === literal(statement, 'DEPLOYMENT_KEY')
            && row.RECORD_KEY === literal(statement, 'RECORD_KEY')
            && row.SOURCE_MODIFIED_AT === literal(statement, 'SOURCE_MODIFIED_AT'));
        }
        return matches.slice(0, 2).map((row) => ({ [OUTBOX]: { ...row } }));
      },
    }),
    datastore: () => ({
      table: (table) => {
        assert.equal(table, OUTBOX);
        return {
          insertRow: async (candidate) => {
            if (rows.some((row) => row.OUTBOX_KEY === candidate.OUTBOX_KEY)) {
              throw new Error('Synthetic provider unique-key conflict.');
            }
            const inserted = { ...candidate, ROWID: String(rows.length + 1) };
            rows.push(inserted);
            return { ...inserted };
          },
        };
      },
    }),
  };
}

function store(app) {
  return createCatalystStore(app, {
    environment: 'development', platformTimeoutMs: 1000,
    maxBatchSize: 25, maxRollupCalls: 250,
    tables: { outbox: OUTBOX, checkpoint: CHECKPOINT },
  });
}

function candidate(overrides = {}) {
  const { ROWID: _rowId, ...row } = outboxRow(overrides);
  return row;
}

function reportReadFixture(respond) {
  const statements = [];
  const scope = { CLIENT_KEY: 'b'.repeat(64), DEPLOYMENT_KEY: 'c'.repeat(64),
    CONFIGURATION_VERSION: 'config-v1', ENGAGEMENT_TYPE: 'free_test',
    ENVIRONMENT: 'development', SOURCE_REVISION: 'd'.repeat(40) };
  const app = {
    datastore() { throw new Error('Report readers must never initialize a write.'); },
    zcql: () => ({ async executeZCQLQuery(statement) {
      statements.push(statement);
      assert.match(statement, /^SELECT /);
      return respond(statement, scope);
    } }),
  };
  const durable = createCatalystStore(app, { environment: 'development', sourceRevision: scope.SOURCE_REVISION,
    platformTimeoutMs: 1000, maxBatchSize: 25, maxRollupCalls: 250,
    tables: { outbox: OUTBOX, checkpoint: CHECKPOINT } });
  return { scope, statements, durable };
}

test('report source cancellation stops partition enumeration after a pending query', async () => {
  const controller = new AbortController();
  let release;
  let reached;
  const pending = new Promise((resolve) => { release = resolve; });
  const paused = new Promise((resolve) => { reached = resolve; });
  const f = reportReadFixture(async () => { reached(); await pending; return []; });
  const result = f.durable.listReportRows(f.scope, { signal: controller.signal });
  const rejected = assert.rejects(result, { code: 'REPORT_READ_ABORTED' });
  await paused;
  assert.equal(f.statements.length, 1);
  controller.abort();
  release();
  await rejected;
  assert.equal(f.statements.length, 1);
  await assert.rejects(f.durable.listReportRows(f.scope, { signal: controller.signal }),
    { code: 'REPORT_READ_ABORTED' });
  assert.equal(f.statements.length, 1);
});

test('report source reader preserves complete bounded history including old unresolved versions', async () => {
  const f = reportReadFixture((statement, scope) => {
    const type = literal(statement, 'RECORD_TYPE');
    return [0, 1].map((index) => ({ [OUTBOX]: { ...scope, RECORD_TYPE: type, ROW_SCHEMA_VERSION: 2,
      ROWID: String(index + 1), SYNC_STATUS: index === 0 ? 'ReconciliationRequired' : 'Succeeded',
      CONFIGURATION_VERSION: index === 0 ? 'prior-config' : scope.CONFIGURATION_VERSION,
      SOURCE_REVISION: index === 0 ? 'a'.repeat(40) : scope.SOURCE_REVISION } }));
  });
  const rows = await f.durable.listReportRows(f.scope);
  assert.equal(rows.length, 6);
  assert.equal(rows.filter((row) => row.SYNC_STATUS === 'ReconciliationRequired').length, 3);
  assert.deepEqual(f.statements.map((query) => literal(query, 'RECORD_TYPE')), ['deployment', 'call', 'final_test_result']);
  for (const query of f.statements) {
    assert.match(query, /ORDER BY ROWID ASC LIMIT 100$/);
    assert.equal(query.split(' AND ').length, 5);
    assert.equal(literal(query, 'CLIENT_KEY'), f.scope.CLIENT_KEY);
    assert.equal(literal(query, 'DEPLOYMENT_KEY'), f.scope.DEPLOYMENT_KEY);
    assert.doesNotMatch(query, /SYNC_STATUS|CONFIGURATION_VERSION|SOURCE_REVISION|OFFSET/);
  }
});

test('report source reader fails on a saturated page instead of claiming complete enumeration', async () => {
  const f = reportReadFixture((statement, scope) => Array.from({ length: 100 }, (_, index) => ({ [OUTBOX]: {
    ...scope, RECORD_TYPE: literal(statement, 'RECORD_TYPE'), ROWID: String(index + 1),
  } })));
  await assert.rejects(f.durable.listReportRows(f.scope), { code: 'REPORT_SOURCE_BOUND_EXCEEDED' });
  assert.equal(f.statements.length, 1);
});

test('report read boundaries reject malformed scopes before querying and reject crossed responses', async () => {
  const f = reportReadFixture(() => []);
  for (const patch of [{ CLIENT_KEY: "'unsafe" }, { SOURCE_REVISION: 'f'.repeat(40) },
    { CONFIGURATION_VERSION: '' }, { ENVIRONMENT: 'production' }, { extra: true }]) {
    await assert.rejects(f.durable.listReportRows({ ...f.scope, ...patch }), { code: 'REPORT_SCOPE_INVALID' });
    await assert.rejects(f.durable.getReportCheckpoint({ ...f.scope, ...patch }, 'call'), { code: 'REPORT_SCOPE_INVALID' });
  }
  await assert.rejects(f.durable.getReportCheckpoint(f.scope, 'daily_metric'), { code: 'REPORT_SCOPE_INVALID' });
  assert.equal(f.statements.length, 0);
  const crossed = reportReadFixture((statement, scope) => [{ [OUTBOX]: { ...scope,
    CLIENT_KEY: 'a'.repeat(64), RECORD_TYPE: literal(statement, 'RECORD_TYPE') } }]);
  await assert.rejects(crossed.durable.listReportRows(crossed.scope), { code: 'REPORT_SCOPE_INVALID' });
});

test('report checkpoint reader uses existing deterministic key and refuses absent or ambiguous ownership', async () => {
  const absent = reportReadFixture(() => []);
  assert.equal(await absent.durable.getReportCheckpoint(absent.scope, 'call'), null);
  assert.equal(absent.statements.length, 1);
  assert.match(absent.statements[0], /LIMIT 2$/);
  assert.equal(literal(absent.statements[0], 'CHECKPOINT_KEY'), checkpointKey({ ...absent.scope, RECORD_TYPE: 'call' }));
  const exact = reportReadFixture((statement, scope) => [{ [CHECKPOINT]: { ...scope,
    RECORD_TYPE: 'call', CHECKPOINT_KEY: checkpointKey({ ...scope, RECORD_TYPE: 'call' }), STATUS: 'Healthy' } }]);
  assert.equal((await exact.durable.getReportCheckpoint(exact.scope, 'call')).STATUS, 'Healthy');
  const crossed = reportReadFixture((statement, scope) => [{ [CHECKPOINT]: { ...scope,
    RECORD_TYPE: 'call', CHECKPOINT_KEY: checkpointKey({ ...scope, RECORD_TYPE: 'call' }), CLIENT_KEY: 'a'.repeat(64) } }]);
  await assert.rejects(crossed.durable.getReportCheckpoint(crossed.scope, 'call'), { code: 'REPORT_SCOPE_INVALID' });
  const duplicate = reportReadFixture(() => [{ [CHECKPOINT]: {} }, { [CHECKPOINT]: {} }]);
  await assert.rejects(duplicate.durable.getReportCheckpoint(duplicate.scope, 'call'), { code: 'DURABLE_OWNERSHIP_AMBIGUOUS' });
});

test('daily rollup rematerialization preserves an existing legacy payload and rejects changed old fields', async () => {
  const fact = buildDailyMetricFact({ calls: [callFact()], reportingDateUtc: '2026-08-24',
    clientKey: key('b'), deploymentKey: key('c'), configurationVersion: 'config-v1',
    engagementType: 'free_test', environment: 'development', metricVersion: 'revenue_desk_metrics_v1',
    sourceRevision: 'd'.repeat(40) });
  const legacyFact = { ...fact };
  delete legacyFact.GENERAL_INQUIRY_CALLS;
  delete legacyFact.PRIVACY_STOP_CALLS;
  const oldRow = createOutboxRow('daily_metric', legacyFact, '2026-08-24T12:06:00.000Z');
  const nextRow = createOutboxRow('daily_metric', fact, '2026-08-24T12:06:00.000Z');
  const app = fakeApp([oldRow]);
  for (const durable of [store(app), new MemoryStore([oldRow])]) {
    const result = await durable.ensureOutbox(nextRow);
    assert.equal(result.PAYLOAD_JSON, oldRow.PAYLOAD_JSON);
    assert.equal(result.PAYLOAD_HASH, oldRow.PAYLOAD_HASH);
    const conflict = createOutboxRow('daily_metric', { ...fact, TOTAL_CALLS_HANDLED: 99 }, oldRow.CREATED_AT);
    await assert.rejects(() => durable.ensureOutbox(conflict), /conflict/);
    const correction = createOutboxRow('daily_metric', {
      ...fact, SOURCE_MODIFIED_AT: '2026-08-24T12:10:00.000Z',
    }, oldRow.CREATED_AT);
    const corrected = await durable.ensureOutbox(correction);
    assert.equal(corrected.PAYLOAD_JSON, correction.PAYLOAD_JSON);
  }
  assert.equal(app.rows.length, 2);
  assert.equal(app.rows[0].PAYLOAD_HASH, oldRow.PAYLOAD_HASH);
});

test('Catalyst store exact and concurrent replays converge by OUTBOX_KEY', async () => {
  const app = fakeApp();
  const durable = store(app);
  const row = candidate();
  const [first, second] = await Promise.all([
    durable.ensureOutbox({ ...row }), durable.ensureOutbox({ ...row }),
  ]);
  assert.equal(app.rows.length, 1);
  assert.equal(first.ROWID, second.ROWID);
  assert.equal(first.OUTBOX_KEY, row.OUTBOX_KEY);
});

test('Catalyst store rejects same-watermark payload conflict and permits later correction', async () => {
  const app = fakeApp();
  const durable = store(app);
  const original = candidate();
  const conflict = candidate({ OUTCOME: 'spam' });
  const correction = candidate({
    OUTCOME: 'existing_customer', SOURCE_MODIFIED_AT: '2026-08-24T12:05:01.000Z',
  });
  await durable.ensureOutbox(original);
  await assert.rejects(() => durable.ensureOutbox(conflict),
    (error) => error.code === 'DURABLE_IDEMPOTENCY_CONFLICT');
  await durable.ensureOutbox(correction);
  assert.equal(app.rows.length, 2);
  assert.equal(original.OUTBOX_KEY, conflict.OUTBOX_KEY);
  assert.notEqual(original.OUTBOX_KEY, correction.OUTBOX_KEY);
});

test('Catalyst store blocks duplicate keys and mismatched provider ownership', async () => {
  const original = candidate();
  const duplicateApp = fakeApp([original, original]);
  const duplicateStore = store(duplicateApp);
  assert.equal(await duplicateStore.hasOutboxOwnershipConflict(duplicateApp.rows[0]), true);
  await assert.rejects(() => duplicateStore.ensureOutbox(original),
    (error) => error.code === 'DURABLE_OWNERSHIP_AMBIGUOUS');

  const wrongKey = { ...original, OUTBOX_KEY: 'f'.repeat(64) };
  const ownerApp = fakeApp([original, wrongKey]);
  assert.equal(await store(ownerApp).hasOutboxOwnershipConflict(ownerApp.rows[0]), true);
});

test('Catalyst store counts every schema version when checking an OUTBOX_KEY owner', async () => {
  const original = candidate();
  const crossVersion = { ...original, ROW_SCHEMA_VERSION: 1 };
  const app = fakeApp([original, crossVersion]);
  const durable = store(app);
  assert.equal(await durable.hasOutboxOwnershipConflict(app.rows[0]), true);
  await assert.rejects(() => durable.ensureOutbox(original),
    (error) => error.code === 'DURABLE_OWNERSHIP_AMBIGUOUS');
});
