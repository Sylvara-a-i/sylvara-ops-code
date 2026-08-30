"use strict";

const { OperationTimeoutError, withOperationTimeout } = require("./operation-timeout");
const { isValidTokenHash, normalizeJourneyId } = require("./security");

const TABLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const COLUMN_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const MAX_STRING_BYTES = 4096;
const MAX_ROW_BYTES = 32768;

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
  return new CatalystDataStoreAdapterError(message, { publicCode: "datastore_input_invalid" });
}

function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function primitive(value) {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) throw inputError("String is too large");
    return value;
  }
  if (value === null || typeof value === "boolean" ||
      (typeof value === "number" && Number.isSafeInteger(value))) return value;
  throw inputError("Data Store value is invalid");
}

function row(value, allowRowId = false) {
  if (!plain(value) || Object.keys(value).length < 1 || Object.keys(value).length > 40) {
    throw inputError("Data Store row is invalid");
  }
  const normalized = {};
  for (const [column, selected] of Object.entries(value)) {
    if (!COLUMN_PATTERN.test(column) || (column === "ROWID" && !allowRowId)) {
      throw inputError("Data Store column is invalid");
    }
    if (column === "ROWID") {
      if (!ROW_ID_PATTERN.test(String(selected))) throw inputError("ROWID is invalid");
      normalized.ROWID = String(selected);
    } else {
      normalized[column] = primitive(selected);
    }
  }
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > MAX_ROW_BYTES) {
    throw inputError("Data Store row is too large");
  }
  return normalized;
}

function sql(value) {
  const selected = primitive(value);
  if (selected === null) return "NULL";
  if (typeof selected === "boolean") return selected ? "TRUE" : "FALSE";
  if (typeof selected === "number") return String(selected);
  return `'${selected.replaceAll("'", "''")}'`;
}

function wrap(error, label, ambiguous = false) {
  if (error instanceof CatalystDataStoreAdapterError) return error;
  if (error instanceof OperationTimeoutError) {
    return new CatalystDataStoreAdapterError(`${label} timed out`, {
      publicCode: "dependency_timeout",
      ambiguous,
    });
  }
  return new CatalystDataStoreAdapterError(`${label} failed`, { ambiguous });
}

function createCatalystDataStoreAdapter(app, config) {
  const tableName = config?.sessionTableName;
  const timeoutMs = config?.platformOperationTimeoutMs;
  if (!TABLE_PATTERN.test(tableName ?? "") || !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 250 || timeoutMs > 15000 ||
      typeof app?.datastore !== "function" || typeof app?.zcql !== "function") {
    throw new CatalystDataStoreAdapterError("Data Store adapter configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  function exactTable(selected) {
    if (selected !== tableName) throw inputError("Data Store table is outside the allowlist");
    return selected;
  }
  async function query(statement, label, ambiguous = false) {
    try {
      const result = await withOperationTimeout(
        () => app.zcql().executeZCQLQuery(statement),
        timeoutMs,
        { ambiguous },
      );
      if (!ambiguous && !Array.isArray(result)) {
        throw new CatalystDataStoreAdapterError("Data Store response is invalid");
      }
      return result;
    } catch (error) {
      throw wrap(error, label, ambiguous);
    }
  }
  async function find(table, column, value) {
    exactTable(table);
    return query(`SELECT * FROM ${tableName} WHERE ${column} = ${sql(value)}`, "Data Store query");
  }
  async function findRowsByTokenHash(table, tokenHash) {
    if (!isValidTokenHash(tokenHash)) throw inputError("Token hash is invalid");
    return find(table, "TOKEN_HASH", tokenHash);
  }
  async function findRowsByJourneyId(table, journeyId) {
    return find(table, "INTAKE_SUBMISSION_ID", normalizeJourneyId(journeyId));
  }
  async function findRowsByRowId(table, rowId) {
    exactTable(table);
    if (!ROW_ID_PATTERN.test(String(rowId))) throw inputError("ROWID is invalid");
    return query(`SELECT * FROM ${tableName} WHERE ROWID = ${String(rowId)}`, "Data Store query");
  }
  async function insertRow(table, value) {
    exactTable(table);
    const validated = row(value);
    try {
      return await withOperationTimeout(
        () => app.datastore().table(tableName).insertRow(validated),
        timeoutMs,
        { ambiguous: true },
      );
    } catch (error) {
      throw wrap(error, "Data Store insert", true);
    }
  }
  async function updateRow(table, value, expected) {
    exactTable(table);
    const validated = row(value, true);
    const predicates = row(expected);
    if (!validated.ROWID) throw inputError("ROWID is required");
    const updates = Object.entries(validated).filter(([key]) => key !== "ROWID").sort();
    const setClause = updates.map(([key, selected]) => `${key} = ${sql(selected)}`).join(", ");
    const whereClause = Object.entries(predicates).sort().map(([key, selected]) =>
      selected === null ? `${key} IS NULL` : `${key} = ${sql(selected)}`).join(" AND ");
    return query(
      `UPDATE ${tableName} SET ${setClause} WHERE ROWID = ${validated.ROWID} AND ${whereClause}`,
      "Conditional Data Store update",
      true,
    );
  }
  return Object.freeze({
    findRowsByJourneyId,
    findRowsByRowId,
    findRowsByTokenHash,
    insertRow,
    updateRow,
  });
}

module.exports = { CatalystDataStoreAdapterError, createCatalystDataStoreAdapter };
