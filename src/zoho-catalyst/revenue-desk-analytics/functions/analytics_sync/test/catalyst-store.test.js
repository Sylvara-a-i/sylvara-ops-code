'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalystStore } = require('../lib/catalyst-store');
const { outboxRow } = require('./helpers');

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
