'use strict';

const { compareWatermark, createOutboxRow } = require('../lib/facts');
const LEASE_PROOF_COLUMN = 'LEASE_' + 'TOKEN';
const OUTBOX_IMMUTABLE = Object.freeze([
  'OUTBOX_KEY', 'ROW_SCHEMA_VERSION', 'RECORD_TYPE',
  'RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
  'ENGAGEMENT_TYPE', 'ENVIRONMENT', 'PAYLOAD_JSON', 'PAYLOAD_HASH', 'METRIC_VERSION',
  'SOURCE_MODIFIED_AT', 'SOURCE_DATE_UTC', 'SOURCE_REVISION',
]);

function sameImmutable(left, right) {
  return OUTBOX_IMMUTABLE.every((column) => String(left[column]) === String(right[column]));
}

function sameProviderIdentity(left, right) {
  return left.RECORD_TYPE === right.RECORD_TYPE
    && left.ENVIRONMENT === right.ENVIRONMENT
    && left.CLIENT_KEY === right.CLIENT_KEY
    && left.DEPLOYMENT_KEY === right.DEPLOYMENT_KEY
    && left.RECORD_KEY === right.RECORD_KEY
    && left.SOURCE_MODIFIED_AT === right.SOURCE_MODIFIED_AT;
}

function key(character) {
  return character.repeat(64);
}

function callFact(overrides = {}) {
  return {
    SCHEMA_VERSION: 1,
    METRIC_VERSION: 'revenue_desk_metrics_v1',
    RECORD_KEY: key('a'),
    CLIENT_KEY: key('b'),
    DEPLOYMENT_KEY: key('c'),
    CONFIGURATION_VERSION: 'config-v1',
    ENGAGEMENT_TYPE: 'free_test',
    ENVIRONMENT: 'development',
    SOURCE_MODIFIED_AT: '2026-08-24T12:05:00.000Z',
    SOURCE_REVISION: 'd'.repeat(40),
    CALL_KEY: key('a'),
    STARTED_AT: '2026-08-24T12:00:00.000Z',
    ENDED_AT: '2026-08-24T12:03:00.000Z',
    DURATION_SECONDS: 180,
    CALL_STATUS: 'ended',
    OUTCOME: 'potential_job',
    URGENCY_CLASS: 'routine',
    COVERAGE_MODE: 'after_hours',
    HANDLED_RECORDED: true,
    BOOKABLE_OPPORTUNITY: true,
    OFFICE_FOLLOW_UP_REQUIRED: true,
    NOTIFICATION_STATE: 'sent',
    VALUE_EVIDENCE_CLASS: 'unknown',
    ...overrides,
  };
}

function outboxRow(overrides = {}, rowId = '1') {
  const factOverrides = {};
  const rowOverrides = {};
  for (const [name, value] of Object.entries(overrides)) {
    if (Object.hasOwn(callFact(), name)) factOverrides[name] = value;
    else rowOverrides[name] = value;
  }
  return { ...createOutboxRow('call', callFact(factOverrides),
    rowOverrides.CREATED_AT || '2026-08-24T12:06:00.000Z'), ROWID: rowId, ...rowOverrides };
}

class MemoryStore {
  constructor(rows = []) {
    this.rows = rows.map((row, index) => ({ ROWID: String(index + 1), ...row }));
    this.checkpoints = new Map();
    this.readinessCalls = 0;
  }

  async listDue(environment, nowIso, limit) {
    const dueStatuses = new Set(['Pending', 'RetryRequired', 'Submitted', 'CheckpointPending']);
    return this.rows.filter((row) => Number(row.ROW_SCHEMA_VERSION) === 2
      && row.ENVIRONMENT === environment
      && ((dueStatuses.has(row.SYNC_STATUS) && row.NEXT_ATTEMPT_AT <= nowIso)
        || (row.SYNC_STATUS === 'Claimed' && row.LEASE_EXPIRES_AT <= nowIso)))
      .sort(compareWatermark).slice(0, limit).map((row) => ({ ...row }));
  }

  async listBatch(environment, batchKey) {
    return this.rows.filter((row) => Number(row.ROW_SCHEMA_VERSION) === 2
      && row.ENVIRONMENT === environment && row.BATCH_KEY === batchKey
      && row.SYNC_STATUS !== 'Succeeded' && row.SYNC_STATUS !== 'TerminalFailure')
      .sort(compareWatermark).map((row) => ({ ...row }));
  }

  async listRollupCalls(seed, batchKey, limit) {
    const matches = this.rows.filter((row) => Number(row.ROW_SCHEMA_VERSION) === 2
      && row.RECORD_TYPE === 'call' && row.ENVIRONMENT === seed.ENVIRONMENT
      && row.CLIENT_KEY === seed.CLIENT_KEY && row.DEPLOYMENT_KEY === seed.DEPLOYMENT_KEY
      && row.CONFIGURATION_VERSION === seed.CONFIGURATION_VERSION
      && row.ENGAGEMENT_TYPE === seed.ENGAGEMENT_TYPE
      && row.METRIC_VERSION === seed.METRIC_VERSION
      && row.SOURCE_DATE_UTC === seed.SOURCE_DATE_UTC
      && (row.SYNC_STATUS === 'Succeeded' || (row.SYNC_STATUS === 'Claimed'
        && row.PROVIDER_STATE === 'Reconciled' && row.BATCH_KEY === batchKey)))
      .sort(compareWatermark);
    if (matches.length > limit) throw new Error('Synthetic rollup bound exceeded.');
    return matches.map((row) => ({ ...row }));
  }

  async ensureOutbox(candidate) {
    const keyedRows = this.rows.filter((row) => row.OUTBOX_KEY === candidate.OUTBOX_KEY);
    if (keyedRows.length > 1) throw new Error('Synthetic durable ownership is ambiguous.');
    let current = keyedRows[0] || null;
    if (!current) {
      const ownerRows = this.rows.filter((row) => sameProviderIdentity(row, candidate));
      if (ownerRows.length > 1) throw new Error('Synthetic durable ownership is ambiguous.');
      current = ownerRows[0] || null;
    }
    if (current) {
      if (!sameImmutable(current, candidate)) {
        throw new Error('Synthetic durable idempotency conflict.');
      }
      if (await this.hasOutboxOwnershipConflict(current)) {
        throw new Error('Synthetic durable ownership is ambiguous.');
      }
      return { ...current };
    }
    const inserted = { ...candidate, ROWID: String(this.rows.length + 1) };
    this.rows.push(inserted);
    if (await this.hasOutboxOwnershipConflict(inserted)) {
      throw new Error('Synthetic durable ownership is ambiguous.');
    }
    return { ...inserted };
  }

  async claim(row, state) {
    const current = this.rows.find((item) => item.ROWID === row.ROWID);
    if (!current || current.SYNC_STATUS !== row.SYNC_STATUS
      || Number(current.FENCE_VERSION) !== Number(row.FENCE_VERSION)
      || current.UPDATED_AT !== row.UPDATED_AT) return null;
    if (current.SYNC_STATUS === 'Claimed' && current.LEASE_EXPIRES_AT > state.nowIso) return null;
    Object.assign(current, {
      SYNC_STATUS: 'Claimed', BATCH_KEY: state.batchKey, LEASE_OWNER: state.leaseOwner,
      [LEASE_PROOF_COLUMN]: state.leaseToken, LEASE_EXPIRES_AT: state.leaseExpiresIso,
      CLAIM_COUNT: Number(current.CLAIM_COUNT) + 1,
      FENCE_VERSION: Number(current.FENCE_VERSION) + 1, UPDATED_AT: state.nowIso,
    });
    return { ...current };
  }

  async patchClaim(row, patch, release) {
    const current = this.rows.find((item) => item.ROWID === row.ROWID);
    if (!current || current.SYNC_STATUS !== 'Claimed' || current.LEASE_TOKEN !== row.LEASE_TOKEN
      || Number(current.FENCE_VERSION) !== Number(row.FENCE_VERSION)) return null;
    Object.assign(current, patch, { FENCE_VERSION: Number(current.FENCE_VERSION) + 1 });
    if (release) Object.assign(current,
      { LEASE_OWNER: null, [LEASE_PROOF_COLUMN]: null, LEASE_EXPIRES_AT: null });
    return { ...current };
  }

  async hasOlderUnresolved(first, batchKey) {
    return this.rows.some((row) => Number(row.ROW_SCHEMA_VERSION) === 2
      && row.ENVIRONMENT === first.ENVIRONMENT && row.RECORD_TYPE === first.RECORD_TYPE
      && row.CLIENT_KEY === first.CLIENT_KEY && row.DEPLOYMENT_KEY === first.DEPLOYMENT_KEY
      && row.BATCH_KEY !== batchKey && row.SYNC_STATUS !== 'Succeeded'
      && compareWatermark(row, first) < 0);
  }

  async hasOutboxOwnershipConflict(candidate) {
    const keyedRows = this.rows.filter((row) => Number(row.ROW_SCHEMA_VERSION) === 2
      && row.OUTBOX_KEY === candidate.OUTBOX_KEY);
    const ownerRows = this.rows.filter((row) => Number(row.ROW_SCHEMA_VERSION) === 2
      && sameProviderIdentity(row, candidate));
    return keyedRows.length !== 1 || ownerRows.length !== 1
      || !sameImmutable(keyedRows[0], candidate) || !sameImmutable(ownerRows[0], candidate);
  }

  async upsertCheckpoint(candidate) {
    const current = this.checkpoints.get(candidate.CHECKPOINT_KEY);
    if (!current || compareWatermark({
      SOURCE_MODIFIED_AT: current.LAST_SOURCE_MODIFIED_AT,
      RECORD_KEY: current.LAST_RECORD_KEY,
    }, {
      SOURCE_MODIFIED_AT: candidate.LAST_SOURCE_MODIFIED_AT,
      RECORD_KEY: candidate.LAST_RECORD_KEY,
    }) < 0) {
      this.checkpoints.set(candidate.CHECKPOINT_KEY,
        { ...candidate, VERSION: current ? current.VERSION + 1 : 0 });
    }
    return { ...this.checkpoints.get(candidate.CHECKPOINT_KEY) };
  }

  async readiness() {
    this.readinessCalls += 1;
    return { tableCount: 2, rowSchemaVersion: 2 };
  }
}

function serviceConfig(overrides = {}) {
  return {
    environment: 'development', mode: 'active', sourceRevision: 'd'.repeat(40),
    maxBatchSize: 25, leaseMs: 120000, maxAttempts: 4, maxPollCount: 20,
    maxRollupCalls: 250,
    retryDelaysMs: [60000, 300000, 1800000], pollDelayMs: 30000,
    staleAfterMs: 7200000, ...overrides,
  };
}

module.exports = { MemoryStore, callFact, key, outboxRow, serviceConfig };
