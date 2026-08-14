"use strict";

const { OperationTimeoutError, withOperationTimeout } = require("./operation-timeout");

const TABLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const COLUMN_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const MAX_COLUMNS = 64;
const MAX_STRING_BYTES = 4096;
const MAX_ROW_VALUE_BYTES = 32768;
const MAX_STATEMENT_BYTES = 65536;

class CatalystDataStoreAdapterError extends Error {
  constructor(
    message,
    { publicCode = "datastore_unavailable", ambiguous = false } = {},
  ) {
    super(message);
    this.name = "CatalystDataStoreAdapterError";
    this.publicCode = publicCode;
    this.ambiguous = ambiguous;
  }
}

function inputError(message) {
  return new CatalystDataStoreAdapterError(message, {
    publicCode: "datastore_input_invalid",
  });
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateTableName(tableName, allowedTables) {
  if (typeof tableName !== "string" || !allowedTables.has(tableName)) {
    throw inputError("Data Store table is outside the configured allowlist");
  }
  return tableName;
}

function validateColumnName(columnName) {
  if (typeof columnName !== "string" || !COLUMN_PATTERN.test(columnName)) {
    throw inputError("Data Store column identifier is invalid");
  }
  return columnName;
}

function validatePrimitive(value) {
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > MAX_STRING_BYTES) throw inputError("Data Store string value is too large");
    return { value, bytes };
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw inputError("Data Store number must be a safe integer");
    return { value, bytes: String(value).length };
  }
  if (typeof value === "boolean") return { value, bytes: 5 };
  if (value === null) return { value, bytes: 4 };
  throw inputError("Data Store values must be bounded primitives");
}

function validateRecord(record, { allowRowId, requireRowId = false } = {}) {
  if (!isPlainRecord(record)) throw inputError("Data Store row must be a plain object");
  const entries = Object.entries(record);
  if (entries.length === 0 || entries.length > MAX_COLUMNS) {
    throw inputError("Data Store row has an invalid number of columns");
  }
  const validated = {};
  let valueBytes = 0;
  for (const [column, rawValue] of entries) {
    validateColumnName(column);
    if (column === "ROWID") {
      if (!allowRowId) throw inputError("ROWID is not allowed in this Data Store row");
      validated.ROWID = validateRowId(rawValue);
      continue;
    }
    const primitive = validatePrimitive(rawValue);
    valueBytes += primitive.bytes;
    if (valueBytes > MAX_ROW_VALUE_BYTES) {
      throw inputError("Data Store row values exceed the approved size");
    }
    validated[column] = primitive.value;
  }
  if (requireRowId && !Object.hasOwn(validated, "ROWID")) {
    throw inputError("ROWID is required for a Data Store update");
  }
  return validated;
}

function validateExpected(expected) {
  const validated = validateRecord(expected, { allowRowId: false });
  if (Object.keys(validated).length === 0) {
    throw inputError("A conditional Data Store update requires expected fields");
  }
  return validated;
}

function validateRowId(rowId) {
  if (typeof rowId === "number" && !Number.isSafeInteger(rowId)) {
    throw inputError("Data Store ROWID is invalid");
  }
  const normalized = String(rowId ?? "");
  if (!ROW_ID_PATTERN.test(normalized)) throw inputError("Data Store ROWID is invalid");
  return normalized;
}

function encodeSqlValue(value) {
  const primitive = validatePrimitive(value).value;
  if (typeof primitive === "string") return `'${primitive.replaceAll("'", "''")}'`;
  if (typeof primitive === "boolean") return primitive ? "TRUE" : "FALSE";
  if (primitive === null) return "NULL";
  return String(primitive);
}

function assertStatementBound(statement) {
  if (Buffer.byteLength(statement, "utf8") > MAX_STATEMENT_BYTES) {
    throw inputError("Data Store statement exceeds the approved size");
  }
  return statement;
}

function compareColumns([left], [right]) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function wrapOperationError(error, operation, { ambiguousOnTimeout = false } = {}) {
  if (error instanceof CatalystDataStoreAdapterError) return error;
  if (error instanceof OperationTimeoutError) {
    return new CatalystDataStoreAdapterError(`${operation} timed out`, {
      publicCode: "dependency_timeout",
      ambiguous: ambiguousOnTimeout,
    });
  }
  return new CatalystDataStoreAdapterError(`${operation} failed`);
}

function createCatalystDataStoreAdapter(app, config) {
  const tableNames = [
    config?.sessionTableName,
    config?.prefillTableName,
    config?.submissionTableName,
  ];
  if (
    tableNames.some((name) => typeof name !== "string" || !TABLE_PATTERN.test(name)) ||
    new Set(tableNames).size !== tableNames.length ||
    !Number.isSafeInteger(config?.platformOperationTimeoutMs) ||
    config.platformOperationTimeoutMs < 250 ||
    config.platformOperationTimeoutMs > 15000 ||
    typeof app?.datastore !== "function" ||
    typeof app?.zcql !== "function"
  ) {
    throw new CatalystDataStoreAdapterError("Data Store adapter configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  const allowedTables = new Set(tableNames);
  const timeoutMs = config.platformOperationTimeoutMs;

  async function executeQuery(statement, operation, { dml = false } = {}) {
    try {
      const result = await withOperationTimeout(
        () => app.zcql().executeZCQLQuery(statement),
        timeoutMs,
        { ambiguous: dml },
      );
      if (!dml && !Array.isArray(result)) {
        throw new CatalystDataStoreAdapterError(`${operation} returned an invalid response`);
      }
      return result;
    } catch (error) {
      throw wrapOperationError(error, operation, { ambiguousOnTimeout: dml });
    }
  }

  async function insertRow(tableName, row) {
    const table = validateTableName(tableName, allowedTables);
    const validatedRow = validateRecord(row, { allowRowId: false });
    try {
      return await withOperationTimeout(
        () => app.datastore().table(table).insertRow(validatedRow),
        timeoutMs,
        { ambiguous: true },
      );
    } catch (error) {
      throw wrapOperationError(error, "Data Store insert", { ambiguousOnTimeout: true });
    }
  }

  async function updateRow(tableName, row, expected) {
    const table = validateTableName(tableName, allowedTables);
    const validatedRow = validateRecord(row, { allowRowId: true, requireRowId: true });
    const validatedExpected = validateExpected(expected);
    const rowId = validatedRow.ROWID;
    const updates = Object.entries(validatedRow)
      .filter(([column]) => column !== "ROWID")
      .sort(compareColumns);
    if (updates.length === 0) throw inputError("Data Store update has no changed fields");
    const conditions = Object.entries(validatedExpected)
      .sort(compareColumns);
    const setClause = updates
      .map(([column, value]) => `${column} = ${encodeSqlValue(value)}`)
      .join(", ");
    const whereClause = conditions
      .map(([column, value]) => (
        value === null ? `${column} IS NULL` : `${column} = ${encodeSqlValue(value)}`
      ))
      .join(" AND ");
    const statement = assertStatementBound(
      `UPDATE ${table} SET ${setClause} WHERE ROWID = ${rowId} AND ${whereClause}`,
    );
    return executeQuery(statement, "Conditional Data Store update", { dml: true });
  }

  async function findRowsByHash(tableName, columnName, hash) {
    const table = validateTableName(tableName, allowedTables);
    validateColumnName(columnName);
    if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) {
      throw inputError("Data Store hash key is invalid");
    }
    const statement = `SELECT * FROM ${table} WHERE ${columnName} = '${hash}'`;
    return executeQuery(statement, "Data Store key query");
  }

  const findRowsByTokenHash = (tableName, hash) => findRowsByHash(
    tableName,
    "TOKEN_HASH",
    hash,
  );
  const findRowsByIssueKey = (tableName, hash) => findRowsByHash(
    tableName,
    "ISSUE_KEY",
    hash,
  );
  const findRowsByPrefillKey = (tableName, hash) => findRowsByHash(
    tableName,
    "PREFILL_KEY",
    hash,
  );
  const findRowsBySubmissionKey = (tableName, hash) => findRowsByHash(
    tableName,
    "SUBMISSION_KEY",
    hash,
  );

  async function findRowsByRowId(tableName, rowId) {
    const table = validateTableName(tableName, allowedTables);
    const validatedRowId = validateRowId(rowId);
    const statement = `SELECT * FROM ${table} WHERE ROWID = ${validatedRowId}`;
    return executeQuery(statement, "Data Store ROWID query");
  }

  return Object.freeze({
    findRowsByIssueKey,
    findRowsByPrefillKey,
    findRowsByRowId,
    findRowsBySubmissionKey,
    findRowsByTokenHash,
    insertRow,
    updateRow,
  });
}

module.exports = {
  CatalystDataStoreAdapterError,
  createCatalystDataStoreAdapter,
};
