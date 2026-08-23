'use strict';

const { FreeTestError, invariant } = require('./errors');

const TABLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const COLUMN_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const MAX_STATEMENT_BYTES = 65_536;
const MAX_ROW_BYTES = 48_000;
const QUERY_COLUMNS = new Set([
  'DEPLOYMENT_KEY', 'DEPLOYMENT_ID', 'NUMBER_LOOKUP_HASH', 'EVENT_KEY', 'CALL_KEY',
  'NOTIFICATION_KEY', 'STATUS', 'SOURCE_REVISION', 'ROWID',
]);

function withTimeout(operation, timeoutMs, ambiguous = false) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new FreeTestError(
        'CATALYST_OPERATION_TIMEOUT', 'Catalyst operation timed out.',
        { httpStatus: 503, retryable: true, ambiguous },
      )), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validatePrimitive(value) {
  invariant(value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isSafeInteger(value)),
  'INVALID_DATASTORE_ROW', 'Catalyst rows may contain only bounded primitives.', { httpStatus: 503 });
  if (typeof value === 'string') invariant(Buffer.byteLength(value, 'utf8') <= 32_768,
    'INVALID_DATASTORE_ROW', 'Catalyst row value is too large.', { httpStatus: 503 });
  return value;
}

function validateRow(row, allowRowId = false) {
  invariant(plain(row), 'INVALID_DATASTORE_ROW', 'Catalyst row must be an object.', { httpStatus: 503 });
  const result = {};
  for (const [column, value] of Object.entries(row)) {
    invariant(COLUMN_PATTERN.test(column) && (column !== 'ROWID' || allowRowId),
      'INVALID_DATASTORE_ROW', 'Catalyst row contains an invalid column.', { httpStatus: 503 });
    result[column] = validatePrimitive(value);
  }
  invariant(Buffer.byteLength(JSON.stringify(result), 'utf8') <= MAX_ROW_BYTES,
    'INVALID_DATASTORE_ROW', 'Catalyst row exceeds the approved size.', { httpStatus: 503 });
  return result;
}

function samePrimitive(actual, expected) {
  if (typeof expected === 'number') return Number(actual) === expected;
  if (typeof expected === 'boolean') {
    return actual === expected || String(actual).toLowerCase() === String(expected);
  }
  return actual === expected;
}

function sqlValue(value) {
  validatePrimitive(value);
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function unwrapRows(result, table) {
  invariant(Array.isArray(result), 'CATALYST_RESPONSE_INVALID', 'Catalyst query response is invalid.', { httpStatus: 503, retryable: true });
  return result.map((entry) => {
    const row = plain(entry?.[table]) ? entry[table] : entry;
    invariant(plain(row), 'CATALYST_RESPONSE_INVALID', 'Catalyst query row is invalid.', { httpStatus: 503, retryable: true });
    return { ...row };
  });
}

function createCatalystStore(app, config) {
  invariant(config.environment === 'development', 'PRODUCTION_BLOCKED',
    'Catalyst store is Development-only.', { httpStatus: 503 });
  invariant(app && typeof app.datastore === 'function' && typeof app.zcql === 'function',
    'INVALID_RUNTIME_CONFIGURATION', 'Catalyst SDK Data Store interfaces are unavailable.', { httpStatus: 503 });
  const tables = new Set(Object.values(config.tables));
  invariant(tables.size === 4 && [...tables].every((name) => TABLE_PATTERN.test(name)),
    'INVALID_RUNTIME_CONFIGURATION', 'Catalyst table allowlist is invalid.', { httpStatus: 503 });

  function tableName(name) {
    invariant(tables.has(name), 'INVALID_DATASTORE_QUERY', 'Catalyst table is outside the allowlist.', { httpStatus: 503 });
    return name;
  }

  async function query(table, column, value) {
    tableName(table);
    invariant(QUERY_COLUMNS.has(column), 'INVALID_DATASTORE_QUERY', 'Catalyst query column is outside the allowlist.', { httpStatus: 503 });
    if (column === 'ROWID') invariant(ROW_ID_PATTERN.test(String(value)),
      'INVALID_DATASTORE_QUERY', 'Catalyst ROWID is invalid.', { httpStatus: 503 });
    // Catalyst ROWID is a BigInt. Keep its validated decimal text unquoted so
    // ZCQL V2 preserves the column type without coercing beyond JS safe integers.
    const renderedValue = column === 'ROWID' ? String(value) : sqlValue(value);
    const statement = `SELECT * FROM ${table} WHERE ${column} = ${renderedValue}`;
    invariant(Buffer.byteLength(statement, 'utf8') <= MAX_STATEMENT_BYTES,
      'INVALID_DATASTORE_QUERY', 'Catalyst query is too large.', { httpStatus: 503 });
    try {
      const result = await withTimeout(
        () => app.zcql().executeZCQLQuery(statement), config.platformTimeoutMs,
      );
      return unwrapRows(result, table);
    } catch (error) {
      if (error instanceof FreeTestError) throw error;
      throw new FreeTestError('CATALYST_QUERY_FAILED', 'Catalyst query failed.',
        { cause: error, httpStatus: 503, retryable: true });
    }
  }

  async function unique(table, column, value) {
    const rows = await query(table, column, value);
    invariant(rows.length <= 1, 'AMBIGUOUS_DURABLE_OWNERSHIP',
      'Catalyst unique key returned multiple rows.', { httpStatus: 503 });
    return rows[0] || null;
  }

  async function insert(table, row) {
    tableName(table);
    const normalized = validateRow(row);
    try {
      return await withTimeout(
        () => app.datastore().table(table).insertRow(normalized), config.platformTimeoutMs, true,
      );
    } catch (error) {
      if (error instanceof FreeTestError) throw error;
      throw new FreeTestError('CATALYST_INSERT_FAILED', 'Catalyst insert failed.',
        { cause: error, httpStatus: 503, retryable: true, ambiguous: true });
    }
  }

  async function insertUnique(table, keyColumn, row, immutableColumns) {
    let insertError = null;
    try {
      await insert(table, row);
    } catch (error) {
      insertError = error;
    }
    const readback = await unique(table, keyColumn, row[keyColumn]);
    if (!readback) throw insertError || new FreeTestError(
      'CATALYST_INSERT_READBACK_FAILED', 'Catalyst insert could not be read back.',
      { httpStatus: 503, retryable: true, ambiguous: true },
    );
    // Catalyst can deserialize BigInt/Boolean columns differently from the values
    // supplied to insertRow. Compare their primitive meaning without weakening
    // immutable string identity checks.
    for (const column of immutableColumns) invariant(samePrimitive(readback[column], row[column]),
      'DURABLE_IDEMPOTENCY_CONFLICT', 'Durable idempotency key is bound to different data.', { httpStatus: 409 });
    return { row: readback, inserted: !insertError };
  }

  async function conditionalUpdate(table, rowId, patch, expected) {
    tableName(table);
    invariant(ROW_ID_PATTERN.test(String(rowId)), 'INVALID_DATASTORE_ROW', 'Catalyst ROWID is invalid.', { httpStatus: 503 });
    const changed = validateRow(patch);
    const predicates = validateRow(expected);
    invariant(Object.keys(changed).length > 0 && Object.keys(predicates).length > 0,
      'INVALID_DATASTORE_ROW', 'Conditional update requires changes and predicates.', { httpStatus: 503 });
    const setClause = Object.entries(changed).sort().map(([key, value]) => `${key} = ${sqlValue(value)}`).join(', ');
    const whereClause = Object.entries(predicates).sort().map(([key, value]) => (
      value === null ? `${key} IS NULL` : `${key} = ${sqlValue(value)}`
    )).join(' AND ');
    const statement = `UPDATE ${table} SET ${setClause} WHERE ROWID = ${rowId} AND ${whereClause}`;
    invariant(Buffer.byteLength(statement, 'utf8') <= MAX_STATEMENT_BYTES,
      'INVALID_DATASTORE_QUERY', 'Catalyst update is too large.', { httpStatus: 503 });
    try {
      await withTimeout(() => app.zcql().executeZCQLQuery(statement), config.platformTimeoutMs, true);
    } catch (error) {
      if (error instanceof FreeTestError) throw error;
      throw new FreeTestError('CATALYST_UPDATE_FAILED', 'Catalyst conditional update failed.',
        { cause: error, httpStatus: 503, retryable: true, ambiguous: true });
    }
    return unique(table, 'ROWID', String(rowId));
  }

  async function mutate(table, keyColumn, keyValue, versionColumn, mutator, attempts = 5) {
    for (let index = 0; index < attempts; index += 1) {
      const current = await unique(table, keyColumn, keyValue);
      invariant(current, 'DURABLE_ROW_MISSING', 'Required durable row is missing.', { httpStatus: 503 });
      const currentVersion = Number(current[versionColumn]);
      invariant(Number.isSafeInteger(currentVersion) && currentVersion >= 0,
        'DURABLE_ROW_INVALID', 'Durable row version is invalid.', { httpStatus: 503 });
      const patch = mutator({ ...current });
      if (patch === null) return current;
      const next = { ...patch, [versionColumn]: currentVersion + 1 };
      const readback = await conditionalUpdate(table, current.ROWID, next, { [versionColumn]: currentVersion });
      // A competing writer can advance the version between our SELECT and UPDATE. Merely
      // observing version + 1 would then misattribute that writer's state to this mutation.
      // Treat the update as converged only when every intended value is present on readback.
      if (Number(readback?.[versionColumn]) === currentVersion + 1
        && Object.entries(next).every(([column, value]) => samePrimitive(readback?.[column], value))) {
        return readback;
      }
    }
    throw new FreeTestError('CATALYST_CONCURRENCY_CONFLICT', 'Catalyst row did not converge.',
      { httpStatus: 503, retryable: true });
  }

  async function readiness() {
    for (const table of tables) await query(table, 'ROWID', '0');
    const sourceRows = await query(config.tables.DEPLOYMENT_TABLE, 'SOURCE_REVISION', config.sourceRevision);
    invariant(sourceRows.length >= 1, 'CATALYST_READINESS_FAILED',
      'No deployment row matches the running source revision.', { httpStatus: 503 });
    return { tableCount: tables.size, sourceDeploymentCount: sourceRows.length };
  }

  return Object.freeze({ query, unique, insert, insertUnique, conditionalUpdate, mutate, readiness });
}

module.exports = { createCatalystStore, unwrapRows, sqlValue };
