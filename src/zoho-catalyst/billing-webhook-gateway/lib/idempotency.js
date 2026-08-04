"use strict";

const crypto = require("node:crypto");
const { withOperationTimeout } = require("./operation-timeout");

class IdempotencyError extends Error {
  constructor(message) {
    super(message);
    this.name = "IdempotencyError";
    this.publicCode = "idempotency_unavailable";
  }
}

function extractErrorCode(error) {
  const candidates = [
    error?.code,
    error?.statusCode,
    error?.status,
    error?.data?.code,
    error?.response?.data?.code,
  ];
  return candidates.find((candidate) => candidate !== undefined && candidate !== null);
}

function unwrapRow(row, tableName) {
  if (!row || typeof row !== "object") return null;
  return row[tableName] && typeof row[tableName] === "object" ? row[tableName] : row;
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function validateRowId(rowId) {
  if (typeof rowId === "number" && !Number.isSafeInteger(rowId)) {
    throw new IdempotencyError("Durable row identifier is invalid");
  }
  const normalized = String(rowId ?? "");
  if (!/^[0-9]{1,30}$/.test(normalized)) {
    throw new IdempotencyError("Durable row identifier is invalid");
  }
  return normalized;
}

function createCatalystIdempotencyStore(app, config) {
  const table = app.datastore().table(config.eventInboxTable);

  async function queryOne(statement, failureMessage) {
    let result;
    try {
      result = await withOperationTimeout(
        () => app.zcql().executeZCQLQuery(statement),
        config.platformOperationTimeoutMs,
      );
    } catch {
      throw new IdempotencyError(failureMessage);
    }
    if (!Array.isArray(result) || result.length !== 1) {
      throw new IdempotencyError("Durable readback did not resolve to one row");
    }
    const row = unwrapRow(result[0], config.eventInboxTable);
    if (!row || typeof row !== "object") {
      throw new IdempotencyError("Durable readback is incomplete");
    }
    return row;
  }

  async function readExisting(eventKey) {
    const query = `SELECT ROWID, STATUS, EVENT_FINGERPRINT, EVENT_TYPE, SOURCE_EVENT_ID FROM ${config.eventInboxTable} WHERE EVENT_KEY = '${eventKey}'`;
    const row = await queryOne(query, "Could not read the durable event claim");
    return {
      rowId: validateRowId(row.ROWID),
      status: String(row.STATUS ?? ""),
      eventFingerprint: String(row.EVENT_FINGERPRINT ?? ""),
      eventType: String(row.EVENT_TYPE ?? ""),
      sourceEventId: String(row.SOURCE_EVENT_ID ?? ""),
    };
  }

  async function readState(rowId) {
    const validatedRowId = validateRowId(rowId);
    const query = `SELECT ROWID, STATUS, LAST_OUTCOME FROM ${config.eventInboxTable} WHERE ROWID = ${validatedRowId}`;
    const row = await queryOne(query, "Could not read the durable event state");
    return {
      rowId: validateRowId(row.ROWID),
      status: String(row.STATUS ?? ""),
      lastOutcome: String(row.LAST_OUTCOME ?? ""),
    };
  }

  async function claim({ eventKey, eventFingerprint, eventType, sourceEventId }) {
    if (
      !/^[a-f0-9]{64}$/.test(eventKey) ||
      !/^[a-f0-9]{64}$/.test(eventFingerprint) ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(sourceEventId)
    ) {
      throw new IdempotencyError("Durable claim input is invalid");
    }
    try {
      const inserted = await withOperationTimeout(
        () => table.insertRow({
          EVENT_KEY: eventKey,
          EVENT_FINGERPRINT: eventFingerprint,
          SOURCE_EVENT_ID: sourceEventId,
          STATUS: "processing",
          EVENT_TYPE: eventType,
          SOURCE_REVISION: config.sourceRevision,
          SOURCE_ENVIRONMENT: config.deploymentEnvironment,
          LAST_OUTCOME: "claimed",
        }),
        config.platformOperationTimeoutMs,
        { ambiguous: true },
      );
      return { outcome: "claimed", rowId: validateRowId(inserted?.ROWID) };
    } catch (error) {
      if (error instanceof IdempotencyError) throw error;
      const code = String(extractErrorCode(error) ?? "");
      if (!config.duplicateErrorCodes.includes(code)) {
        throw new IdempotencyError("Durable claim insert failed or timed out");
      }
      const existing = await readExisting(eventKey);
      if (
        !safeEqualHex(existing.eventFingerprint, eventFingerprint) ||
        existing.eventType !== eventType ||
        existing.sourceEventId !== sourceEventId
      ) {
        return { outcome: "duplicate-conflict", rowId: existing.rowId };
      }
      return existing.status === "completed"
        ? { outcome: "duplicate-completed", rowId: existing.rowId }
        : { outcome: "duplicate-unresolved", rowId: existing.rowId };
    }
  }

  async function mark(rowId, status, lastOutcome) {
    const validatedRowId = validateRowId(rowId);
    if (!new Set(["completed", "failed", "reconciliation_required"]).has(status)) {
      throw new IdempotencyError("Unsupported durable event state");
    }
    if (!/^[a-z0-9_]{1,80}$/.test(lastOutcome)) {
      throw new IdempotencyError("Durable outcome class is invalid");
    }
    try {
      await withOperationTimeout(
        () => table.updateRow({
          ROWID: validatedRowId,
          STATUS: status,
          LAST_OUTCOME: lastOutcome,
        }),
        config.platformOperationTimeoutMs,
        { ambiguous: true },
      );
    } catch {
      // An update timeout is ambiguous. The exact Data Store row is authoritative.
    }
    const readback = await readState(validatedRowId);
    if (readback.status !== status || readback.lastOutcome !== lastOutcome) {
      throw new IdempotencyError("Durable state readback did not match");
    }
  }

  return Object.freeze({ claim, mark, readState });
}

module.exports = { IdempotencyError, createCatalystIdempotencyStore };
