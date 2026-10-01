'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalystStore } = require('../lib/catalyst-store');
const { outboxRow } = require('./helpers');
const { callFact, MemoryStore, key } = require('./helpers');
const { checkpointKey, checkpointRow, createOutboxRow } = require('../lib/facts');
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


test('report source reads accept the canonical Form2 version identity without relaxing scope equality', async () => {
  const f = reportReadFixture(() => []);
  const scope = { ...f.scope, CONFIGURATION_VERSION: 'form2cfgv1:101:' + 'd'.repeat(40) };
  assert.deepEqual(await f.durable.listReportRows(scope), []);
  assert.equal(f.statements.length, 3);
  for (const value of [true, 101, "invalid' OR 1=1", 'invalid whitespace', 'invalid/config']) {
    await assert.rejects(f.durable.listReportRows({ ...scope, CONFIGURATION_VERSION: value }),
      { code: 'REPORT_SCOPE_INVALID' });
  }
  assert.equal(f.statements.length, 3);
});

function checkpointInsertFixture({ legacy = true, mutateColumns, provider = true, ambiguous = false,
  changeReadback, readMetadata, timeoutMs = 1000 } = {}) {
  const contract = require('../../../config/datastore-schema.json').tables
    .find(table => table.api_name === CHECKPOINT);
  let columns = contract.columns.map(column => ({ column_name: column.api_name,
    data_type: column.type, max_length: column.max_length, is_mandatory: column.mandatory,
    is_unique: column.unique }));
  if (legacy) {
    columns.push(...Object.entries({ CheckpointKey: 255, TargetEnvironment: 32, RecordType: 64,
      SourceTableName: 120, TargetWorkspaceId: 64, TargetViewId: 64, MatchColumns: 255 })
      .map(([name, length]) => ({ column_name: name, data_type: 'varchar', max_length: length,
        is_mandatory: true, is_unique: name === 'CheckpointKey' })),
    { column_name: 'SyncEnabled', data_type: 'boolean', is_mandatory: true, is_unique: false,
      default_value: 'false' });
  }
  if (mutateColumns) columns = mutateColumns(columns);
  const rows = []; const writes = []; let metadataReads = 0;
  const app = {
    datastore: () => ({ table: table => {
      assert.equal(table, CHECKPOINT);
      return {
        getAllColumns: async () => {
          metadataReads += 1;
          return readMetadata ? readMetadata() : structuredClone(columns);
        },
        insertRow: async value => {
          writes.push(structuredClone(value));
          for (const column of columns) {
            if (column.is_mandatory && column.default_value === undefined) {
              assert.notEqual(value[column.column_name], undefined, `Required ${column.column_name}`);
            }
          }
          for (const name of Object.keys(value)) {
            assert.ok(columns.some(column => column.column_name === name), `Unknown ${name}`);
          }
          if (rows.some(row => row.CHECKPOINT_KEY === value.CHECKPOINT_KEY)) throw new Error('Unique conflict');
          rows.push({ ...value, ROWID: '100' });
          if (ambiguous) throw new Error('Synthetic response loss after commit');
          return structuredClone(rows[0]);
        },
      };
    } }),
    zcql: () => ({ executeZCQLQuery: async statement => {
      assert.match(statement, /^SELECT \* FROM AnalyticsSyncCheckpoints WHERE CHECKPOINT_KEY = /);
      const result = rows.filter(row => row.CHECKPOINT_KEY === literal(statement, 'CHECKPOINT_KEY'));
      return result.map(row => ({ [CHECKPOINT]: changeReadback ? changeReadback({ ...row }) : { ...row } }));
    } }),
  };
  const config = { environment: 'development', platformTimeoutMs: timeoutMs,
    tables: { checkpoint: CHECKPOINT, outbox: OUTBOX },
    provider: provider ? { workspaceId: '10001', targets: {
      call: { table: 'RevenueDeskAnalyticsCallFacts', viewId: '10002' },
    } } : null };
  const last = outboxRow({ PROVIDER_JOB_ID: '10003', ACCEPTED_ROW_COUNT: 1, REJECTED_ROW_COUNT: 0 });
  const row = checkpointRow(last, 'call', '2026-08-24T12:06:00.000Z', '2026-08-24T13:06:00.000Z');
  return { app, durable: createCatalystStore(app, config), row, rows, writes,
    metadataReads: () => metadataReads };
}

test('first checkpoint insert satisfies retained mandatory columns from its exact import binding', async () => {
  const f = checkpointInsertFixture();
  const actual = await f.durable.upsertCheckpoint(f.row);
  assert.equal(actual.CHECKPOINT_KEY, f.row.CHECKPOINT_KEY);
  assert.deepEqual(Object.fromEntries(Object.keys(actual).filter(name => /^[A-Z][a-z]/.test(name))
    .map(name => [name, actual[name]])), {
    CheckpointKey: f.row.CHECKPOINT_KEY, TargetEnvironment: 'Development', RecordType: 'call',
    SourceTableName: OUTBOX, TargetWorkspaceId: '10001', TargetViewId: '10002',
    MatchColumns: 'RECORD_KEY,CLIENT_KEY,DEPLOYMENT_KEY,ENVIRONMENT', SyncEnabled: false,
  });
  assert.equal(f.writes.length, 1);
  assert.equal(f.metadataReads(), 1);
  await f.durable.upsertCheckpoint(f.row);
  assert.equal(f.writes.length, 1);
  assert.equal(f.metadataReads(), 1, 'Existing checkpoints do not re-enter schema/insert handling');
});

test('v2-only checkpoint table receives no nonexistent compatibility columns or provider dependency', async () => {
  const f = checkpointInsertFixture({ legacy: false, provider: false });
  const actual = await f.durable.upsertCheckpoint(f.row);
  assert.deepEqual(f.writes[0], { ...f.row, VERSION: 0 });
  assert.equal(actual.SyncEnabled, undefined);
});

test('checkpoint insertion rejects partial, duplicate, missing and newly required schema before writing', async () => {
  for (const mutateColumns of [
    columns => columns.filter(column => column.column_name !== 'TargetViewId'),
    columns => columns.filter(column => column.column_name !== 'VERSION'),
    columns => [...columns, { ...columns[0] }],
    columns => columns.map(column => column.column_name === 'CheckpointKey'
      ? { ...column, is_unique: false } : column),
    columns => [...columns, { column_name: 'UnexpectedRequired', data_type: 'varchar', is_mandatory: true }],
    () => [],
  ]) {
    const f = checkpointInsertFixture({ mutateColumns });
    await assert.rejects(f.durable.upsertCheckpoint(f.row), { code: 'CHECKPOINT_SCHEMA_UNVERIFIED' });
    assert.equal(f.writes.length, 0);
  }
});

test('legacy checkpoint insert requires a trusted provider target and original deterministic identity', async () => {
  const f = checkpointInsertFixture({ provider: false });
  await assert.rejects(f.durable.upsertCheckpoint(f.row), { code: 'CHECKPOINT_BINDING_UNVERIFIED' });
  assert.equal(f.writes.length, 0);
  const crossed = checkpointInsertFixture();
  await assert.rejects(crossed.durable.upsertCheckpoint({ ...crossed.row, CLIENT_KEY: 'f'.repeat(64) }),
    { code: 'CHECKPOINT_BINDING_UNVERIFIED' });
  assert.equal(crossed.writes.length, 0);
});

test('ambiguous and concurrent first checkpoint inserts reconcile one immutable compatibility binding', async () => {
  const f = checkpointInsertFixture({ ambiguous: true });
  const [a, b] = await Promise.all([f.durable.upsertCheckpoint(f.row), f.durable.upsertCheckpoint(f.row)]);
  assert.equal(f.rows.length, 1);
  assert.equal(a.ROWID, b.ROWID);
  assert.equal(f.writes.length, 2, 'Two competing unique-key insert attempts, no automatic retry');
  assert.equal(f.metadataReads(), 2);
  const crossed = checkpointInsertFixture({ changeReadback: row => ({ ...row, TargetViewId: '99999' }) });
  await assert.rejects(crossed.durable.upsertCheckpoint(crossed.row), { code: 'CHECKPOINT_OWNERSHIP_CONFLICT' });
  assert.equal(crossed.writes.length, 1);
});

test('late or failed checkpoint metadata cannot dispatch an insert after the bounded read fails', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = checkpointInsertFixture({ readMetadata: () => pending, timeoutMs: 10 });
  await assert.rejects(f.durable.upsertCheckpoint(f.row), { code: 'DATASTORE_TIMEOUT' });
  release([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.writes.length, 0);
  assert.equal(f.metadataReads(), 1);
  const failed = checkpointInsertFixture({ readMetadata: () => { throw new Error('Synthetic metadata failure'); } });
  await assert.rejects(failed.durable.upsertCheckpoint(failed.row), { code: 'DATASTORE_OPERATION_FAILED' });
  assert.equal(failed.writes.length, 0);
});
