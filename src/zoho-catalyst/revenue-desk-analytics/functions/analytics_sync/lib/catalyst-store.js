'use strict';

const { AnalyticsSyncError, invariant } = require('./errors');
const { withTimeout } = require('./connection-boundary');
const { compareWatermark, parseOutboxRow } = require('./facts');

const ROW_ID_PATTERN = /^\d{1,30}$/;
const COLUMN_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_STATEMENT_BYTES = 65536;
const MAX_TEXT_BYTES = 10000;
const TERMINAL_STATUSES = new Set(['Succeeded', 'TerminalFailure']);
const LEASE_PROOF_COLUMN = 'LEASE_' + 'TOKEN';
const OUTBOX_COLUMNS = Object.freeze([
  'OUTBOX_KEY', 'ROW_SCHEMA_VERSION', 'RECORD_TYPE',
  'RECORD_KEY', 'CLIENT_KEY',
  'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION', 'ENGAGEMENT_TYPE', 'ENVIRONMENT',
  'PAYLOAD_JSON', 'PAYLOAD_HASH', 'METRIC_VERSION', 'SOURCE_MODIFIED_AT', 'SOURCE_DATE_UTC',
  'SYNC_STATUS',
  'BATCH_KEY', 'ATTEMPT_COUNT', 'CLAIM_COUNT', 'POLL_COUNT', 'NEXT_ATTEMPT_AT',
  'LEASE_OWNER', 'LEASE_TOKEN', 'LEASE_EXPIRES_AT', 'FENCE_VERSION', 'PROVIDER_JOB_ID',
  'PROVIDER_STATE', 'EXPECTED_ROW_COUNT', 'ACCEPTED_ROW_COUNT', 'REJECTED_ROW_COUNT',
  'READBACK_JOB_ID', 'READBACK_ROW_COUNT', 'READBACK_WATERMARK', 'LAST_ERROR_CODE',
  'LAST_ATTEMPT_AT', 'SUBMITTED_AT', 'RECONCILED_AT', 'CREATED_AT', 'UPDATED_AT',
  'SOURCE_REVISION',
]);
const OUTBOX_IMMUTABLE = Object.freeze([
  'OUTBOX_KEY', 'ROW_SCHEMA_VERSION', 'RECORD_TYPE',
  'RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
  'ENGAGEMENT_TYPE', 'ENVIRONMENT', 'PAYLOAD_JSON', 'PAYLOAD_HASH', 'METRIC_VERSION',
  'SOURCE_MODIFIED_AT', 'SOURCE_DATE_UTC', 'SOURCE_REVISION',
]);
const CHECKPOINT_COLUMNS = Object.freeze([
  'CHECKPOINT_KEY', 'ROW_SCHEMA_VERSION', 'RECORD_TYPE', 'TARGET_TABLE_ALIAS', 'CLIENT_KEY',
  'DEPLOYMENT_KEY', 'ENVIRONMENT', 'LAST_SOURCE_MODIFIED_AT', 'LAST_RECORD_KEY',
  'PROVIDER_WATERMARK', 'LAST_PROVIDER_JOB_ID', 'LAST_ACCEPTED_ROW_COUNT',
  'LAST_REJECTED_ROW_COUNT', 'STATUS', 'STALE_AFTER_AT', 'LAST_ERROR_CODE', 'VERSION',
  'LAST_SYNC_AT', 'LAST_RECONCILED_AT', 'CREATED_AT', 'UPDATED_AT', 'SOURCE_REVISION',
  'METRIC_VERSION',
]);

function primitive(value) {
  invariant(value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isSafeInteger(value)), 'DATASTORE_ROW_INVALID',
  'Catalyst row contains an unsupported value.');
  if (typeof value === 'string') invariant(Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES,
    'DATASTORE_ROW_INVALID', 'Catalyst row text exceeds the approved bound.');
  return value;
}

function validatePatch(patch, allowlist) {
  invariant(patch && typeof patch === 'object' && !Array.isArray(patch)
    && Object.keys(patch).length > 0, 'DATASTORE_ROW_INVALID', 'Catalyst patch is invalid.');
  const result = {};
  for (const [column, value] of Object.entries(patch)) {
    invariant(COLUMN_PATTERN.test(column) && allowlist.includes(column), 'DATASTORE_ROW_INVALID',
      'Catalyst patch contains an unapproved column.');
    result[column] = primitive(value);
  }
  return result;
}

function sqlValue(value) {
  primitive(value);
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function unwrapRows(result, table) {
  invariant(Array.isArray(result), 'DATASTORE_RESPONSE_INVALID',
    'Catalyst query response is invalid.', { retryable: true });
  return result.map((entry) => {
    const row = entry && typeof entry === 'object' && entry[table]
      && typeof entry[table] === 'object' ? entry[table] : entry;
    invariant(row && typeof row === 'object' && !Array.isArray(row),
      'DATASTORE_RESPONSE_INVALID', 'Catalyst query row is invalid.', { retryable: true });
    return { ...row };
  });
}

function same(actual, expected) {
  if (typeof expected === 'number') return Number(actual) === expected;
  if (typeof expected === 'boolean') return actual === expected
    || String(actual).toLowerCase() === String(expected);
  return actual === expected;
}

function sameRowId(left, right) {
  return ROW_ID_PATTERN.test(String(left?.ROWID))
    && ROW_ID_PATTERN.test(String(right?.ROWID))
    && String(left.ROWID) === String(right.ROWID);
}

function createCatalystStore(app, config) {
  invariant(config.environment === 'development', 'PRODUCTION_BLOCKED',
    'Catalyst Analytics store is Development-only.');
  invariant(app && typeof app.datastore === 'function' && typeof app.zcql === 'function',
    'DATASTORE_UNAVAILABLE', 'Catalyst Data Store interfaces are unavailable.');
  const { outbox, checkpoint } = config.tables;
  const tables = new Set([outbox, checkpoint]);
  invariant(tables.size === 2, 'CONFIG_INVALID', 'Analytics table allowlist is invalid.');

  async function execute(statement, ambiguous = false) {
    invariant(typeof statement === 'string' && Buffer.byteLength(statement, 'utf8') <= MAX_STATEMENT_BYTES,
      'DATASTORE_QUERY_INVALID', 'Catalyst statement exceeds the approved bound.');
    try {
      return await withTimeout(() => app.zcql().executeZCQLQuery(statement),
        config.platformTimeoutMs, { code: 'DATASTORE_TIMEOUT', retryable: true, ambiguous });
    } catch (error) {
      if (error instanceof AnalyticsSyncError) throw error;
      throw new AnalyticsSyncError('DATASTORE_OPERATION_FAILED',
        'Catalyst Data Store operation failed.', { cause: error, retryable: true, ambiguous });
    }
  }

  async function query(table, statement) {
    invariant(tables.has(table), 'DATASTORE_QUERY_INVALID', 'Catalyst table is outside the allowlist.');
    return unwrapRows(await execute(statement), table);
  }

  async function unique(table, keyColumn, keyValue) {
    invariant(COLUMN_PATTERN.test(keyColumn), 'DATASTORE_QUERY_INVALID',
      'Catalyst key column is invalid.');
    const rendered = keyColumn === 'ROWID'
      ? (() => {
        invariant(ROW_ID_PATTERN.test(String(keyValue)), 'DATASTORE_QUERY_INVALID',
          'Catalyst ROWID is invalid.');
        return String(keyValue);
      })() : sqlValue(keyValue);
    const rows = await query(table,
      `SELECT * FROM ${table} WHERE ${keyColumn} = ${rendered} LIMIT 2`);
    invariant(rows.length <= 1, 'DURABLE_OWNERSHIP_AMBIGUOUS',
      'Catalyst unique key returned multiple rows.');
    return rows[0] || null;
  }

  async function conditionalUpdate(table, columns, row, patch, expected) {
    invariant(ROW_ID_PATTERN.test(String(row.ROWID)), 'DATASTORE_ROW_INVALID',
      'Catalyst ROWID is invalid.');
    const changed = validatePatch(patch, columns);
    const predicates = validatePatch(expected, columns);
    const setClause = Object.entries(changed).sort()
      .map(([column, value]) => `${column} = ${sqlValue(value)}`).join(', ');
    const whereClause = Object.entries(predicates).sort().map(([column, value]) => (
      value === null ? `${column} IS NULL` : `${column} = ${sqlValue(value)}`
    )).join(' AND ');
    await execute(`UPDATE ${table} SET ${setClause} WHERE ROWID = ${row.ROWID} AND ${whereClause}`, true);
    const readback = await unique(table, 'ROWID', String(row.ROWID));
    if (!readback || !Object.entries(changed).every(([column, value]) => same(readback[column], value))) {
      return null;
    }
    return readback;
  }

  async function listDue(environment, nowIso, limit) {
    invariant(environment === 'development' && Number.isSafeInteger(limit) && limit >= 1
      && limit <= config.maxBatchSize, 'DATASTORE_QUERY_INVALID', 'Analytics due-row query is invalid.');
    const ready = ['Pending', 'RetryRequired', 'Submitted', 'CheckpointPending']
      .map((status) => `SYNC_STATUS = ${sqlValue(status)}`).join(' OR ');
    const statement = `SELECT * FROM ${outbox} WHERE ROW_SCHEMA_VERSION = 2`
      + ` AND ENVIRONMENT = ${sqlValue(environment)}`
      + ` AND (((${ready}) AND NEXT_ATTEMPT_AT <= ${sqlValue(nowIso)})`
      + ` OR (SYNC_STATUS = 'Claimed' AND LEASE_EXPIRES_AT <= ${sqlValue(nowIso)}))`
      + ` ORDER BY SOURCE_MODIFIED_AT ASC, RECORD_KEY ASC LIMIT ${limit}`;
    return query(outbox, statement);
  }

  async function listBatch(environment, batchKey) {
    invariant(environment === 'development' && /^[a-f0-9]{64}$/.test(batchKey),
      'DATASTORE_QUERY_INVALID', 'Analytics batch query is invalid.');
    const rows = await query(outbox, `SELECT * FROM ${outbox} WHERE ROW_SCHEMA_VERSION = 2`
      + ` AND ENVIRONMENT = ${sqlValue(environment)} AND BATCH_KEY = ${sqlValue(batchKey)}`
      + ` ORDER BY SOURCE_MODIFIED_AT ASC, RECORD_KEY ASC LIMIT ${config.maxBatchSize + 1}`);
    invariant(rows.length <= config.maxBatchSize, 'OUTBOX_BATCH_INVALID',
      'Analytics durable batch exceeds the configured bound.');
    return rows.filter((row) => !TERMINAL_STATUSES.has(row.SYNC_STATUS));
  }

  async function listRollupCalls(seed, batchKey, limit) {
    invariant(seed.RECORD_TYPE === 'call' && seed.ENVIRONMENT === 'development'
      && /^\d{4}-\d{2}-\d{2}$/.test(seed.SOURCE_DATE_UTC)
      && /^[a-f0-9]{64}$/.test(batchKey)
      && Number.isSafeInteger(limit) && limit >= 1 && limit <= config.maxRollupCalls,
    'ROLLUP_QUERY_INVALID', 'Analytics daily-rollup query is invalid.');
    const rows = await query(outbox, `SELECT * FROM ${outbox} WHERE ROW_SCHEMA_VERSION = 2`
      + ` AND RECORD_TYPE = 'call' AND ENVIRONMENT = ${sqlValue(seed.ENVIRONMENT)}`
      + ` AND CLIENT_KEY = ${sqlValue(seed.CLIENT_KEY)}`
      + ` AND DEPLOYMENT_KEY = ${sqlValue(seed.DEPLOYMENT_KEY)}`
      + ` AND CONFIGURATION_VERSION = ${sqlValue(seed.CONFIGURATION_VERSION)}`
      + ` AND ENGAGEMENT_TYPE = ${sqlValue(seed.ENGAGEMENT_TYPE)}`
      + ` AND METRIC_VERSION = ${sqlValue(seed.METRIC_VERSION)}`
      + ` AND SOURCE_DATE_UTC = ${sqlValue(seed.SOURCE_DATE_UTC)}`
      + ` AND (SYNC_STATUS = 'Succeeded' OR (SYNC_STATUS = 'Claimed'`
      + ` AND PROVIDER_STATE = 'Reconciled' AND BATCH_KEY = ${sqlValue(batchKey)}))`
      + ` ORDER BY SOURCE_MODIFIED_AT ASC, RECORD_KEY ASC LIMIT ${limit + 1}`);
    invariant(rows.length <= limit, 'ROLLUP_BOUND_EXCEEDED',
      'Analytics daily-rollup source exceeds the approved per-day bound.');
    return rows;
  }

  async function providerIdentityRows(row) {
    return query(outbox, `SELECT * FROM ${outbox}`
      + ` WHERE ROW_SCHEMA_VERSION = 2 AND RECORD_TYPE = ${sqlValue(row.RECORD_TYPE)}`
      + ` AND ENVIRONMENT = ${sqlValue(row.ENVIRONMENT)}`
      + ` AND CLIENT_KEY = ${sqlValue(row.CLIENT_KEY)}`
      + ` AND DEPLOYMENT_KEY = ${sqlValue(row.DEPLOYMENT_KEY)}`
      + ` AND RECORD_KEY = ${sqlValue(row.RECORD_KEY)}`
      + ` AND SOURCE_MODIFIED_AT = ${sqlValue(row.SOURCE_MODIFIED_AT)} LIMIT 2`);
  }

  async function hasOutboxOwnershipConflict(row) {
    const keyedRows = await query(outbox, `SELECT * FROM ${outbox}`
      + ` WHERE OUTBOX_KEY = ${sqlValue(row.OUTBOX_KEY)} LIMIT 2`);
    if (keyedRows.length !== 1
      || !sameRowId(keyedRows[0], row)
      || !OUTBOX_IMMUTABLE.every((column) => same(keyedRows[0][column], row[column]))) return true;
    const identityRows = await providerIdentityRows(row);
    return identityRows.length !== 1
      || !sameRowId(identityRows[0], row)
      || !OUTBOX_IMMUTABLE.every((column) => same(identityRows[0][column], row[column]));
  }

  async function ensureOutbox(candidate) {
    let current = await unique(outbox, 'OUTBOX_KEY', candidate.OUTBOX_KEY);
    if (!current) {
      const owners = await providerIdentityRows(candidate);
      invariant(owners.length <= 1, 'DURABLE_OWNERSHIP_AMBIGUOUS',
        'Analytics provider identity returned multiple rows.');
      current = owners[0] || null;
      if (!current) {
        const normalized = validatePatch(candidate, OUTBOX_COLUMNS);
        try {
          await withTimeout(() => app.datastore().table(outbox).insertRow(normalized),
            config.platformTimeoutMs,
            { code: 'DATASTORE_TIMEOUT', retryable: true, ambiguous: true });
        } catch (error) {
          if (!(error instanceof AnalyticsSyncError)) {
            // Duplicate and ambiguous insert outcomes are resolved by exact readback below.
          }
        }
        current = await unique(outbox, 'OUTBOX_KEY', candidate.OUTBOX_KEY);
      }
    }
    invariant(current, 'OUTBOX_WRITE_AMBIGUOUS',
      'Analytics outbox insert could not be read back.', { ambiguous: true });
    parseOutboxRow(current, config.environment);
    invariant(OUTBOX_IMMUTABLE.every((column) => same(current[column], candidate[column])),
      'DURABLE_IDEMPOTENCY_CONFLICT', 'Analytics outbox insert readback conflicts.');
    invariant(!(await hasOutboxOwnershipConflict(current)), 'DURABLE_OWNERSHIP_AMBIGUOUS',
      'Analytics outbox ownership is ambiguous.');
    return current;
  }

  async function claim(row, claimState) {
    const now = Date.parse(claimState.nowIso);
    invariant(Number.isFinite(now) && (!row.BATCH_KEY || row.BATCH_KEY === claimState.batchKey),
      'OUTBOX_CLAIM_INVALID', 'Analytics claim is invalid.');
    if (row.SYNC_STATUS === 'Claimed') {
      invariant(Date.parse(row.LEASE_EXPIRES_AT) <= now, 'OUTBOX_CLAIM_BUSY',
        'Analytics outbox lease is still active.', { retryable: true });
    }
    const currentFence = Number(row.FENCE_VERSION);
    const currentClaims = Number(row.CLAIM_COUNT);
    invariant(Number.isSafeInteger(currentFence) && currentFence >= 0
      && Number.isSafeInteger(currentClaims) && currentClaims >= 0,
    'OUTBOX_CLAIM_INVALID', 'Analytics claim counters are invalid.');
    return conditionalUpdate(outbox, OUTBOX_COLUMNS, row, {
      SYNC_STATUS: 'Claimed',
      BATCH_KEY: claimState.batchKey,
      LEASE_OWNER: claimState.leaseOwner,
      [LEASE_PROOF_COLUMN]: claimState.leaseToken,
      LEASE_EXPIRES_AT: claimState.leaseExpiresIso,
      CLAIM_COUNT: currentClaims + 1,
      FENCE_VERSION: currentFence + 1,
      UPDATED_AT: claimState.nowIso,
    }, {
      FENCE_VERSION: currentFence,
      SYNC_STATUS: row.SYNC_STATUS,
      UPDATED_AT: row.UPDATED_AT,
    });
  }

  async function patchClaim(row, patch, release = false) {
    invariant(row.SYNC_STATUS === 'Claimed' && typeof row[LEASE_PROOF_COLUMN] === 'string',
      'OUTBOX_CLAIM_INVALID', 'Analytics claimed row is invalid.');
    const currentFence = Number(row.FENCE_VERSION);
    const changed = {
      ...patch,
      FENCE_VERSION: currentFence + 1,
      ...(release ? { LEASE_OWNER: null, [LEASE_PROOF_COLUMN]: null,
        LEASE_EXPIRES_AT: null } : {}),
    };
    return conditionalUpdate(outbox, OUTBOX_COLUMNS, row, changed, {
      FENCE_VERSION: currentFence,
      SYNC_STATUS: 'Claimed',
      [LEASE_PROOF_COLUMN]: row[LEASE_PROOF_COLUMN],
    });
  }

  async function hasOlderUnresolved(first, batchKey) {
    const status = ['Pending', 'Claimed', 'Submitted', 'RetryRequired',
      'ReconciliationRequired', 'CheckpointPending', 'TerminalFailure']
      .map((value) => `SYNC_STATUS = ${sqlValue(value)}`).join(' OR ');
    const earlier = `(SOURCE_MODIFIED_AT < ${sqlValue(first.SOURCE_MODIFIED_AT)}`
      + ` OR (SOURCE_MODIFIED_AT = ${sqlValue(first.SOURCE_MODIFIED_AT)}`
      + ` AND RECORD_KEY < ${sqlValue(first.RECORD_KEY)}))`;
    const rows = await query(outbox, `SELECT OUTBOX_KEY FROM ${outbox}`
      + ` WHERE ROW_SCHEMA_VERSION = 2 AND ENVIRONMENT = ${sqlValue(first.ENVIRONMENT)}`
      + ` AND RECORD_TYPE = ${sqlValue(first.RECORD_TYPE)}`
      + ` AND CLIENT_KEY = ${sqlValue(first.CLIENT_KEY)}`
      + ` AND DEPLOYMENT_KEY = ${sqlValue(first.DEPLOYMENT_KEY)}`
      + ` AND (${status}) AND ${earlier}`
      + ` AND (BATCH_KEY IS NULL OR BATCH_KEY != ${sqlValue(batchKey)}) LIMIT 1`);
    return rows.length > 0;
  }

  async function insertCheckpoint(row) {
    const normalized = validatePatch({ ...row, VERSION: 0 }, CHECKPOINT_COLUMNS);
    try {
      await withTimeout(() => app.datastore().table(checkpoint).insertRow(normalized),
        config.platformTimeoutMs,
        { code: 'DATASTORE_TIMEOUT', retryable: true, ambiguous: true });
    } catch (error) {
      if (!(error instanceof AnalyticsSyncError)) {
        // Duplicate and timeout outcomes are both resolved by deterministic readback below.
      }
    }
    const readback = await unique(checkpoint, 'CHECKPOINT_KEY', row.CHECKPOINT_KEY);
    invariant(readback, 'CHECKPOINT_WRITE_AMBIGUOUS',
      'Analytics checkpoint insert could not be read back.', { ambiguous: true });
    return readback;
  }

  async function upsertCheckpoint(candidate) {
    let current = await unique(checkpoint, 'CHECKPOINT_KEY', candidate.CHECKPOINT_KEY);
    if (!current) current = await insertCheckpoint(candidate);
    invariant(Number(current.ROW_SCHEMA_VERSION) === 2
      && current.RECORD_TYPE === candidate.RECORD_TYPE
      && current.CLIENT_KEY === candidate.CLIENT_KEY
      && current.DEPLOYMENT_KEY === candidate.DEPLOYMENT_KEY
      && current.ENVIRONMENT === candidate.ENVIRONMENT,
    'CHECKPOINT_OWNERSHIP_CONFLICT', 'Analytics checkpoint ownership conflicts.');
    const currentComparable = {
      SOURCE_MODIFIED_AT: current.LAST_SOURCE_MODIFIED_AT,
      RECORD_KEY: current.LAST_RECORD_KEY,
    };
    const candidateComparable = {
      SOURCE_MODIFIED_AT: candidate.LAST_SOURCE_MODIFIED_AT,
      RECORD_KEY: candidate.LAST_RECORD_KEY,
    };
    if (compareWatermark(currentComparable, candidateComparable) >= 0) return current;
    for (let index = 0; index < 5; index += 1) {
      const version = Number(current.VERSION);
      invariant(Number.isSafeInteger(version) && version >= 0, 'CHECKPOINT_INVALID',
        'Analytics checkpoint version is invalid.');
      const patch = { ...candidate, CREATED_AT: current.CREATED_AT, VERSION: version + 1 };
      delete patch.CHECKPOINT_KEY;
      const updated = await conditionalUpdate(checkpoint, CHECKPOINT_COLUMNS, current, patch,
        { VERSION: version, UPDATED_AT: current.UPDATED_AT });
      if (updated) return updated;
      current = await unique(checkpoint, 'CHECKPOINT_KEY', candidate.CHECKPOINT_KEY);
      invariant(current, 'CHECKPOINT_INVALID', 'Analytics checkpoint disappeared.');
      const observed = {
        SOURCE_MODIFIED_AT: current.LAST_SOURCE_MODIFIED_AT,
        RECORD_KEY: current.LAST_RECORD_KEY,
      };
      if (compareWatermark(observed, candidateComparable) >= 0) return current;
    }
    throw new AnalyticsSyncError('CHECKPOINT_CONCURRENCY_CONFLICT',
      'Analytics checkpoint did not converge.', { retryable: true });
  }

  async function readiness() {
    await query(outbox, `SELECT ${OUTBOX_COLUMNS.join(', ')} FROM ${outbox}`
      + ' WHERE ROW_SCHEMA_VERSION = 2 LIMIT 1');
    await query(checkpoint, `SELECT ${CHECKPOINT_COLUMNS.join(', ')} FROM ${checkpoint}`
      + ' WHERE ROW_SCHEMA_VERSION = 2 LIMIT 1');
    return Object.freeze({ tableCount: 2, rowSchemaVersion: 2 });
  }

  return Object.freeze({
    listDue, listBatch, listRollupCalls, ensureOutbox, claim, patchClaim,
    hasOlderUnresolved, hasOutboxOwnershipConflict, upsertCheckpoint, readiness,
  });
}

module.exports = {
  createCatalystStore, sqlValue, unwrapRows, OUTBOX_COLUMNS, OUTBOX_IMMUTABLE,
  CHECKPOINT_COLUMNS,
};
