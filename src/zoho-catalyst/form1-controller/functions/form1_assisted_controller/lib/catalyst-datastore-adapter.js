"use strict";

const { OperationTimeoutError, withOperationTimeout } = require("./operation-timeout");
const { isValidTokenHash } = require("./security");

const TABLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const COLUMN_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const MAX_COLUMNS = 32;
const MAX_STRING_BYTES = 4096;
const MAX_ROW_BYTES = 16384;
const MAX_STATEMENT_BYTES = 32768;

class CatalystDataStoreAdapterError extends Error {
  constructor(message, { publicCode = "datastore_unavailable", ambiguous = false } = {}) {
    super(message);
    this.name = "CatalystDataStoreAdapterError";
    this.status = 503;
    this.publicCode = publicCode;
    this.ambiguous = ambiguous;
  }
}

function inputError(message) {
  return new CatalystDataStoreAdapterError(message, {
    publicCode: "datastore_input_invalid",
  });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateTableName(value, expected) {
  if (typeof value !== "string" || value !== expected || !TABLE_PATTERN.test(value)) {
    throw inputError("Data Store table is outside the allowlist");
  }
  return value;
}

function validateColumnName(value) {
  if (typeof value !== "string" || !COLUMN_PATTERN.test(value)) {
    throw inputError("Data Store column is invalid");
  }
  return value;
}

function validateRowId(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw inputError("Data Store ROWID is invalid");
  }
  const normalized = String(value ?? "");
  if (!ROW_ID_PATTERN.test(normalized)) throw inputError("Data Store ROWID is invalid");
  return normalized;
}

function validatePrimitive(value) {
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > MAX_STRING_BYTES) throw inputError("Data Store string is too large");
    return { value, bytes };
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw inputError("Data Store number is invalid");
    return { value, bytes: String(value).length };
  }
  if (typeof value === "boolean") return { value, bytes: 5 };
  if (value === null) return { value, bytes: 4 };
  throw inputError("Data Store values must be bounded primitives");
}

function validateRow(record, { allowRowId, requireRowId = false } = {}) {
  if (!isPlainObject(record)) throw inputError("Data Store row must be a plain object");
  const entries = Object.entries(record);
  if (!entries.length || entries.length > MAX_COLUMNS) {
    throw inputError("Data Store row has an invalid number of columns");
  }
  let totalBytes = 0;
  const validated = Object.create(null);
  for (const [column, value] of entries) {
    validateColumnName(column);
    if (column === "ROWID") {
      if (!allowRowId) throw inputError("ROWID is not allowed for this operation");
      validated.ROWID = validateRowId(value);
      continue;
    }
    const primitive = validatePrimitive(value);
    totalBytes += primitive.bytes;
    if (totalBytes > MAX_ROW_BYTES) throw inputError("Data Store row exceeds its value bound");
    validated[column] = primitive.value;
  }
  if (requireRowId && !Object.hasOwn(validated, "ROWID")) {
    throw inputError("ROWID is required for a Data Store update");
  }
  return validated;
}

function encodeSql(value) {
  const primitive = validatePrimitive(value).value;
  if (typeof primitive === "string") return `'${primitive.replaceAll("'", "''")}'`;
  if (typeof primitive === "boolean") return primitive ? "TRUE" : "FALSE";
  if (primitive === null) return "NULL";
  return String(primitive);
}

function wrapError(error, operation, { ambiguous = false } = {}) {
  if (error instanceof CatalystDataStoreAdapterError) return error;
  if (error instanceof OperationTimeoutError) {
    return new CatalystDataStoreAdapterError(`${operation} timed out`, {
      publicCode: "dependency_timeout",
      ambiguous,
    });
  }
  return new CatalystDataStoreAdapterError(`${operation} failed`, { ambiguous });
}

function createCatalystDataStoreAdapter(app, config) {
  const tableName = config?.sessionTableName;
  const timeoutMs = config?.platformOperationTimeoutMs;
  if (
    typeof tableName !== "string" ||
    !TABLE_PATTERN.test(tableName) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 250 ||
    timeoutMs > 15000 ||
    typeof app?.datastore !== "function" ||
    typeof app?.zcql !== "function"
  ) {
    throw new CatalystDataStoreAdapterError("Data Store adapter configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }

  async function query(statement, operation, { dml = false } = {}) {
    if (Buffer.byteLength(statement, "utf8") > MAX_STATEMENT_BYTES) {
      throw inputError("Data Store statement exceeds its bound");
    }
    try {
      const result = await withOperationTimeout(
        () => app.zcql().executeZCQLQuery(statement),
        timeoutMs,
        { ambiguous: dml },
      );
      if (!dml && !Array.isArray(result)) {
        throw new CatalystDataStoreAdapterError(`${operation} returned an invalid result`);
      }
      return result;
    } catch (error) {
      throw wrapError(error, operation, { ambiguous: dml });
    }
  }

  async function insertRow(requestedTable, row) {
    const table = validateTableName(requestedTable, tableName);
    const validated = validateRow(row, { allowRowId: false });
    try {
      return await withOperationTimeout(
        () => app.datastore().table(table).insertRow(validated),
        timeoutMs,
        { ambiguous: true },
      );
    } catch (error) {
      throw wrapError(error, "Data Store insert", { ambiguous: true });
    }
  }

  async function updateRow(requestedTable, row, expected) {
    const table = validateTableName(requestedTable, tableName);
    const validated = validateRow(row, { allowRowId: true, requireRowId: true });
    const condition = validateRow(expected, { allowRowId: false });
    const updates = Object.entries(validated)
      .filter(([column]) => column !== "ROWID")
      .sort(([left], [right]) => left.localeCompare(right));
    if (!updates.length) throw inputError("Data Store update has no changed fields");
    const predicates = Object.entries(condition).sort(([left], [right]) => left.localeCompare(right));
    const setClause = updates.map(([column, value]) => `${column} = ${encodeSql(value)}`).join(", ");
    const whereClause = predicates
      .map(([column, value]) => (value === null ? `${column} IS NULL` : `${column} = ${encodeSql(value)}`))
      .join(" AND ");
    return query(
      `UPDATE ${table} SET ${setClause} WHERE ROWID = ${validated.ROWID} AND ${whereClause}`,
      "Conditional Data Store update",
      { dml: true },
    );
  }

  async function findRowsByTokenHash(requestedTable, tokenHash) {
    const table = validateTableName(requestedTable, tableName);
    if (!isValidTokenHash(tokenHash)) throw inputError("Token hash is invalid");
    return query(
      `SELECT * FROM ${table} WHERE TOKEN_HASH = '${tokenHash}'`,
      "Data Store token query",
    );
  }

  async function findRowsByRowId(requestedTable, rowId) {
    const table = validateTableName(requestedTable, tableName);
    const normalized = validateRowId(rowId);
    return query(`SELECT * FROM ${table} WHERE ROWID = ${normalized}`, "Data Store ROWID query");
  }

  return Object.freeze({ findRowsByRowId, findRowsByTokenHash, insertRow, updateRow });
}

module.exports = { CatalystDataStoreAdapterError, createCatalystDataStoreAdapter };
