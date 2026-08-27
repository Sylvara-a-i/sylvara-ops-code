'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AnalyticsSyncError } = require('../lib/errors');
const LEASE_PROOF_COLUMN = 'LEASE_' + 'TOKEN';
const { parseOutboxRow, targetRow } = require('../lib/facts');
const { createAnalyticsSyncService } = require('../lib/service');
const { MemoryStore, key, outboxRow, serviceConfig } = require('./helpers');

function harness(rows, adapterOverrides = {}, configOverrides = {}) {
  let clock = Date.parse('2026-08-24T12:06:00.000Z');
  let randomCounter = 1;
  const store = new MemoryStore(rows);
  const adapter = {
    submitBatch: async () => ({ jobId: '1001' }),
    pollImport: async () => ({ state: 'pending' }),
    startReadback: async () => ({ jobId: '2001' }),
    pollReadback: async () => ({ state: 'pending' }),
    ...adapterOverrides,
  };
  const service = createAnalyticsSyncService({
    store, adapter, config: serviceConfig(configOverrides), now: () => clock,
    randomBytes: (size) => Buffer.alloc(size, randomCounter++),
  });
  return { store, adapter, service, advance: (milliseconds) => { clock += milliseconds; } };
}

test('a call batch reconciles, checkpoints, and materializes its deterministic daily metric', async () => {
  const initial = outboxRow();
  const expected = targetRow(parseOutboxRow(initial, 'development'));
  const h = harness([initial], {
    pollImport: async () => ({ state: 'complete', totalRows: 1, acceptedRows: 1, rejectedRows: 0 }),
    pollReadback: async () => ({ state: 'complete', rows: [{
      RECORD_KEY: expected.RECORD_KEY, CLIENT_KEY: expected.CLIENT_KEY,
      DEPLOYMENT_KEY: expected.DEPLOYMENT_KEY, ENVIRONMENT: expected.ENVIRONMENT,
      PAYLOAD_HASH: expected.PAYLOAD_HASH, SOURCE_MODIFIED_AT: expected.SOURCE_MODIFIED_AT,
    }] }),
  });
  assert.equal((await h.service.run()).state, 'Submitted');
  h.advance(30000);
  assert.equal((await h.service.run()).state, 'ReadbackSubmitted');
  h.advance(30000);
  assert.equal((await h.service.run()).state, 'CheckpointPending');
  assert.equal(h.store.rows[0].SYNC_STATUS, 'CheckpointPending');
  assert.equal(h.store.checkpoints.size, 0);
  const completion = await h.service.run();
  assert.equal(completion.state, 'Succeeded');
  assert.equal(completion.dailyMetricsEnsured, 1);
  assert.equal(h.store.rows[0].SYNC_STATUS, 'Succeeded');
  assert.equal(h.store.rows[0].READBACK_ROW_COUNT, 1);
  assert.equal(h.store.checkpoints.size, 1);
  const checkpoint = [...h.store.checkpoints.values()][0];
  assert.equal(checkpoint.ROW_SCHEMA_VERSION, 2);
  assert.equal(checkpoint.STATUS, 'Healthy');
  assert.equal(checkpoint.LAST_RECORD_KEY, expected.RECORD_KEY);
  const dailyRows = h.store.rows.filter((row) => row.RECORD_TYPE === 'daily_metric');
  assert.equal(dailyRows.length, 1);
  assert.equal(dailyRows[0].SYNC_STATUS, 'Pending');
  const daily = parseOutboxRow(dailyRows[0], 'development');
  assert.equal(daily.fact.TOTAL_CALLS_HANDLED, 1);
  assert.equal(daily.fact.QUALIFIED_OPPORTUNITIES, 1);
  assert.equal((await h.service.run()).state, 'Submitted');
  assert.equal(dailyRows[0].SYNC_STATUS, 'Submitted');
});

test('an ambiguous submit is quarantined and never blindly replayed', async () => {
  let submissions = 0;
  const h = harness([outboxRow()], {
    submitBatch: async () => {
      submissions += 1;
      throw new AnalyticsSyncError('ANALYTICS_TIMEOUT', 'Synthetic ambiguous timeout.',
        { ambiguous: true });
    },
  });
  assert.equal((await h.service.run()).state, 'ReconciliationRequired');
  assert.equal(h.store.rows[0].SYNC_STATUS, 'ReconciliationRequired');
  assert.equal(h.store.rows[0].ATTEMPT_COUNT, 1);
  assert.equal((await h.service.run()).state, 'Idle');
  assert.equal(submissions, 1);
});

test('definitive retryable submit errors use bounded durable backoff and a new batch claim', async () => {
  let submissions = 0;
  const h = harness([outboxRow()], {
    submitBatch: async () => {
      submissions += 1;
      if (submissions === 1) throw new AnalyticsSyncError(
        'CONNECTION_TIMEOUT', 'Synthetic pre-invocation timeout.', { retryable: true },
      );
      return { jobId: '1002' };
    },
  });
  assert.equal((await h.service.run()).state, 'RetryRequired');
  const firstAttemptAt = h.store.rows[0].NEXT_ATTEMPT_AT;
  assert.equal(h.store.rows[0].BATCH_KEY, null);
  assert.equal(h.store.rows[0].ATTEMPT_COUNT, 1);
  assert.equal((await h.service.run()).state, 'Idle');
  h.advance(60000);
  assert.equal(new Date(firstAttemptAt).getTime(), Date.parse('2026-08-24T12:07:00.000Z'));
  assert.equal((await h.service.run()).state, 'Submitted');
  assert.equal(h.store.rows[0].ATTEMPT_COUNT, 2);
  assert.equal(submissions, 2);
});

test('batches never cross a client, deployment, or rollup-grain partition', async () => {
  const first = outboxRow({}, '1');
  const second = outboxRow({
    RECORD_KEY: key('e'), CALL_KEY: key('e'), CLIENT_KEY: key('f'),
    DEPLOYMENT_KEY: key('0'), SOURCE_MODIFIED_AT: '2026-08-24T12:05:01.000Z',
  }, '2');
  const submittedSizes = [];
  const h = harness([first, second], {
    submitBatch: async (_recordType, rows) => {
      submittedSizes.push(rows.length);
      return { jobId: '1003' };
    },
  });
  assert.equal((await h.service.run()).state, 'Submitted');
  assert.deepEqual(submittedSizes, [1]);
  assert.equal(h.store.rows[0].SYNC_STATUS, 'Submitted');
  assert.equal(h.store.rows[1].SYNC_STATUS, 'Pending');
});

test('provider corrections sharing one match identity are serialized', async () => {
  const original = outboxRow({}, '1');
  const correction = outboxRow({
    OUTCOME: 'existing_customer',
    SOURCE_MODIFIED_AT: '2026-08-24T12:05:01.000Z',
  }, '2');
  const submitted = [];
  const h = harness([original, correction], {
    submitBatch: async (_recordType, rows) => {
      submitted.push(rows.map((row) => row.PAYLOAD_HASH));
      return { jobId: '1007' };
    },
  });
  assert.equal((await h.service.run()).state, 'Submitted');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].length, 1);
  assert.notEqual(original.OUTBOX_KEY, correction.OUTBOX_KEY);
  assert.equal(h.store.rows[0].SYNC_STATUS, 'Submitted');
  assert.equal(h.store.rows[1].SYNC_STATUS, 'Pending');
});

test('same-watermark payload conflicts share one key and are quarantined before provider write', async () => {
  const original = outboxRow({}, '1');
  const conflict = outboxRow({ OUTCOME: 'spam' }, '2');
  assert.equal(original.OUTBOX_KEY, conflict.OUTBOX_KEY);
  assert.notEqual(original.PAYLOAD_HASH, conflict.PAYLOAD_HASH);
  let submissions = 0;
  const h = harness([original, conflict], {
    submitBatch: async () => { submissions += 1; return { jobId: '1009' }; },
  });
  assert.equal((await h.service.run()).state, 'ReconciliationRequired');
  assert.equal(submissions, 0);
  assert.equal(h.store.rows[0].SYNC_STATUS, 'ReconciliationRequired');
  assert.equal(h.store.rows[1].SYNC_STATUS, 'Pending');
  assert.equal((await h.service.run()).state, 'ReconciliationRequired');
  assert.equal(submissions, 0);
  assert.equal(h.store.rows[1].SYNC_STATUS, 'ReconciliationRequired');
  assert.equal(h.store.rows[0].LAST_ERROR_CODE, 'ANALYTICS_OUTBOX_OWNERSHIP_CONFLICT');
  assert.equal(h.store.rows[1].LAST_ERROR_CODE, 'ANALYTICS_OUTBOX_OWNERSHIP_CONFLICT');
});

test('concurrent exact replays converge on one durable outbox row', async () => {
  const store = new MemoryStore();
  const { ROWID: _syntheticRowId, ...candidate } = outboxRow();
  const [first, second] = await Promise.all([
    store.ensureOutbox({ ...candidate }),
    store.ensureOutbox({ ...candidate }),
  ]);
  assert.equal(store.rows.length, 1);
  assert.equal(first.ROWID, second.ROWID);
  assert.equal(first.OUTBOX_KEY, candidate.OUTBOX_KEY);
  assert.equal(first.PAYLOAD_HASH, candidate.PAYLOAD_HASH);
});

test('a concurrent same-watermark conflicting payload loses before provider submission', async () => {
  const original = outboxRow({}, '1');
  const { ROWID: _syntheticRowId, ...conflict } = outboxRow({ OUTCOME: 'spam' }, '2');
  assert.equal(original.OUTBOX_KEY, conflict.OUTBOX_KEY);
  assert.notEqual(original.PAYLOAD_HASH, conflict.PAYLOAD_HASH);
  let providerWrites = 0;
  let h;
  h = harness([original], {
    submitBatch: async () => {
      await assert.rejects(() => h.store.ensureOutbox(conflict),
        /durable idempotency conflict/);
      providerWrites += 1;
      return { jobId: '1011' };
    },
  });
  assert.equal((await h.service.run()).state, 'Submitted');
  assert.equal(providerWrites, 1);
  assert.equal(h.store.rows.length, 1);
  assert.equal(h.store.rows[0].OUTBOX_KEY, original.OUTBOX_KEY);
  assert.equal(h.store.rows[0].PAYLOAD_HASH, original.PAYLOAD_HASH);
});

test('duplicate identical outbox keys block processing before provider submission', async () => {
  const first = outboxRow({}, '1');
  const duplicate = outboxRow({}, '2');
  let providerWrites = 0;
  const h = harness([first, duplicate], {
    submitBatch: async () => { providerWrites += 1; return { jobId: '1012' }; },
  });
  assert.equal((await h.service.run()).state, 'ReconciliationRequired');
  assert.equal(providerWrites, 0);
  assert.equal(h.store.rows[0].LAST_ERROR_CODE, 'ANALYTICS_OUTBOX_OWNERSHIP_CONFLICT');
  assert.equal(h.store.rows[1].SYNC_STATUS, 'Pending');
});

test('candidate selection stops at the first interleaved rollup grain', async () => {
  const first = outboxRow({}, '1');
  const middle = outboxRow({
    RECORD_KEY: key('e'), CALL_KEY: key('e'),
    STARTED_AT: '2026-08-25T12:00:00.000Z', ENDED_AT: '2026-08-25T12:03:00.000Z',
    SOURCE_MODIFIED_AT: '2026-08-25T12:05:00.000Z',
  }, '2');
  const last = outboxRow({
    RECORD_KEY: key('f'), CALL_KEY: key('f'),
    SOURCE_MODIFIED_AT: '2026-08-26T12:05:00.000Z',
  }, '3');
  const submitted = [];
  const h = harness([first, middle, last], {
    submitBatch: async (_recordType, rows) => {
      submitted.push(rows.map((row) => row.RECORD_KEY));
      return { jobId: '1010' };
    },
  });
  h.advance(3 * 24 * 60 * 60 * 1000);
  assert.equal((await h.service.run()).state, 'Submitted');
  assert.deepEqual(submitted, [[first.RECORD_KEY]]);
  assert.equal(h.store.rows[0].SYNC_STATUS, 'Submitted');
  assert.equal(h.store.rows[1].SYNC_STATUS, 'Pending');
  assert.equal(h.store.rows[2].SYNC_STATUS, 'Pending');
});

test('a deferred middle watermark blocks provider submission and checkpoint advance', async () => {
  const first = outboxRow({}, '1');
  const deferred = outboxRow({
    RECORD_KEY: key('e'), CALL_KEY: key('e'),
    SOURCE_MODIFIED_AT: '2026-08-24T12:05:01.000Z',
    SYNC_STATUS: 'RetryRequired', NEXT_ATTEMPT_AT: '2026-08-24T13:00:00.000Z',
  }, '2');
  const last = outboxRow({
    RECORD_KEY: key('f'), CALL_KEY: key('f'),
    SOURCE_MODIFIED_AT: '2026-08-24T12:05:02.000Z',
  }, '3');
  let submissions = 0;
  const h = harness([first, deferred, last], {
    submitBatch: async () => { submissions += 1; return { jobId: '1008' }; },
  });
  const outcome = await h.service.run();
  assert.equal(outcome.state, 'OrderedWait');
  assert.equal(submissions, 0);
  assert.equal(h.store.checkpoints.size, 0);
  assert.equal(h.store.rows[0].SYNC_STATUS, 'Pending');
  assert.equal(h.store.rows[1].SYNC_STATUS, 'RetryRequired');
  assert.equal(h.store.rows[2].SYNC_STATUS, 'Pending');
});

test('daily metrics exclude newer source facts that have not reconciled', async () => {
  const current = outboxRow({}, '1');
  const future = outboxRow({
    RECORD_KEY: key('e'), CALL_KEY: key('e'),
    SOURCE_MODIFIED_AT: '2026-08-24T12:05:01.000Z',
    NEXT_ATTEMPT_AT: '2026-08-24T13:00:00.000Z',
  }, '2');
  const expected = targetRow(parseOutboxRow(current, 'development'));
  const h = harness([current, future], {
    pollImport: async () => ({
      state: 'complete', totalRows: 1, acceptedRows: 1, rejectedRows: 0,
    }),
    pollReadback: async () => ({ state: 'complete', rows: [{
      RECORD_KEY: expected.RECORD_KEY, CLIENT_KEY: expected.CLIENT_KEY,
      DEPLOYMENT_KEY: expected.DEPLOYMENT_KEY, ENVIRONMENT: expected.ENVIRONMENT,
      PAYLOAD_HASH: expected.PAYLOAD_HASH, SOURCE_MODIFIED_AT: expected.SOURCE_MODIFIED_AT,
    }] }),
  });
  assert.equal((await h.service.run()).state, 'Submitted');
  h.advance(30000);
  assert.equal((await h.service.run()).state, 'ReadbackSubmitted');
  h.advance(30000);
  assert.equal((await h.service.run()).state, 'CheckpointPending');
  assert.equal((await h.service.run()).state, 'Succeeded');
  const daily = h.store.rows.find((row) => row.RECORD_TYPE === 'daily_metric');
  assert.ok(daily);
  assert.equal(parseOutboxRow(daily, 'development').fact.TOTAL_CALLS_HANDLED, 1);
  assert.equal(h.store.rows.find((row) => row.ROWID === '2').SYNC_STATUS, 'Pending');
});

test('a crashed submitting claim enters reconciliation after lease expiry without a second submit', async () => {
  const row = outboxRow({
    SYNC_STATUS: 'Claimed', BATCH_KEY: key('8'), ATTEMPT_COUNT: 1, CLAIM_COUNT: 1,
    FENCE_VERSION: 1, LEASE_OWNER: '1'.repeat(32), [LEASE_PROOF_COLUMN]: key('9'),
    LEASE_EXPIRES_AT: '2026-08-24T12:05:59.000Z', PROVIDER_STATE: 'Submitting',
    UPDATED_AT: '2026-08-24T12:05:00.000Z',
  });
  let submissions = 0;
  const h = harness([row], { submitBatch: async () => { submissions += 1; } });
  assert.equal((await h.service.run()).state, 'ReconciliationRequired');
  assert.equal(h.store.rows[0].LAST_ERROR_CODE, 'ANALYTICS_SUBMISSION_OUTCOME_UNKNOWN');
  assert.equal(submissions, 0);
});

test('import count mismatches, readback mismatches, and checkpoint gaps fail closed', async (t) => {
  await t.test('import count mismatch', async () => {
    const row = outboxRow({
      SYNC_STATUS: 'Submitted', BATCH_KEY: key('7'), PROVIDER_JOB_ID: '1004',
      PROVIDER_STATE: 'Submitted', EXPECTED_ROW_COUNT: 1,
    });
    const h = harness([row], {
      pollImport: async () => ({ state: 'complete', totalRows: 1, acceptedRows: 0, rejectedRows: 1 }),
    });
    assert.equal((await h.service.run()).state, 'ReconciliationRequired');
    assert.equal(h.store.rows[0].LAST_ERROR_CODE, 'ANALYTICS_IMPORT_COUNT_MISMATCH');
  });

  await t.test('readback mismatch', async () => {
    const row = outboxRow({
      SYNC_STATUS: 'Submitted', BATCH_KEY: key('7'), PROVIDER_JOB_ID: '1005',
      READBACK_JOB_ID: '2005', PROVIDER_STATE: 'ReadbackSubmitted',
      EXPECTED_ROW_COUNT: 1, ACCEPTED_ROW_COUNT: 1, REJECTED_ROW_COUNT: 0,
    });
    const h = harness([row], {
      pollReadback: async () => ({ state: 'complete', rows: [] }),
    });
    assert.equal((await h.service.run()).state, 'ReconciliationRequired');
    assert.equal(h.store.rows[0].LAST_ERROR_CODE, 'ANALYTICS_READBACK_MISMATCH');
  });

  await t.test('older unresolved checkpoint gap', async () => {
    const current = outboxRow({
      RECORD_KEY: key('e'), CALL_KEY: key('e'), SOURCE_MODIFIED_AT: '2026-08-24T12:05:01.000Z',
      SYNC_STATUS: 'Submitted', BATCH_KEY: key('7'), PROVIDER_JOB_ID: '1006',
      READBACK_JOB_ID: '2006', PROVIDER_STATE: 'ReadbackSubmitted',
      EXPECTED_ROW_COUNT: 1, ACCEPTED_ROW_COUNT: 1, REJECTED_ROW_COUNT: 0,
    }, '2');
    const expected = targetRow(parseOutboxRow(current, 'development'));
    const older = outboxRow({
      SYNC_STATUS: 'RetryRequired', NEXT_ATTEMPT_AT: '2026-08-24T13:00:00.000Z',
    }, '1');
    const h = harness([older, current], {
      pollReadback: async () => ({ state: 'complete', rows: [{
        RECORD_KEY: expected.RECORD_KEY, CLIENT_KEY: expected.CLIENT_KEY,
        DEPLOYMENT_KEY: expected.DEPLOYMENT_KEY, ENVIRONMENT: expected.ENVIRONMENT,
        PAYLOAD_HASH: expected.PAYLOAD_HASH, SOURCE_MODIFIED_AT: expected.SOURCE_MODIFIED_AT,
      }] }),
    });
    assert.equal((await h.service.run()).state, 'ReconciliationRequired');
    assert.equal(h.store.rows.find((row) => row.ROWID === '2').LAST_ERROR_CODE,
      'ANALYTICS_CHECKPOINT_GAP');
  });
});

test('fencing prevents a stale claimant from mutating a reclaimed row', async () => {
  const store = new MemoryStore([outboxRow()]);
  const original = (await store.listDue('development', '2026-08-24T12:06:00.000Z', 1))[0];
  const claimed = await store.claim(original, {
    batchKey: key('5'), leaseOwner: '1'.repeat(32), leaseToken: key('6'),
    nowIso: '2026-08-24T12:06:00.000Z', leaseExpiresIso: '2026-08-24T12:08:00.000Z',
  });
  const updated = await store.patchClaim(claimed,
    { PROVIDER_STATE: 'Submitting', UPDATED_AT: '2026-08-24T12:06:01.000Z' }, false);
  assert.ok(updated);
  assert.equal(await store.patchClaim(claimed,
    { PROVIDER_STATE: 'StaleWriter', UPDATED_AT: '2026-08-24T12:06:02.000Z' }, false), null);
});
