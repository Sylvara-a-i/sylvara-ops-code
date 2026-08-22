"use strict";

const crypto = require("node:crypto");
const { ACTIONS } = require("./action-contract");
const { withOperationTimeout } = require("./operation-timeout");

const HASH = /^[a-f0-9]{64}$/;
const ROW_ID = /^[0-9]{1,30}$/;
const OUTCOME = /^[a-z0-9_]{1,80}$/;
const ACTION_SET = new Set(ACTIONS);

class IdempotencyError extends Error {
  constructor(message, publicCode = "idempotency_unavailable") {
    super(message);
    this.name = "IdempotencyError";
    this.publicCode = publicCode;
    this.status = 503;
  }
}

function extractErrorCode(error) {
  return [
    error?.code,
    error?.statusCode,
    error?.status,
    error?.data?.code,
    error?.response?.data?.code,
  ].find((candidate) => candidate !== undefined && candidate !== null);
}

function unwrap(row, tableName) {
  if (!row || typeof row !== "object") return null;
  return row[tableName] && typeof row[tableName] === "object" ? row[tableName] : row;
}

function rowId(value) {
  const normalized = String(value ?? "");
  if (!ROW_ID.test(normalized)) throw new IdempotencyError("Operation row identifier is invalid");
  return normalized;
}

function safeHashEqual(left, right) {
  return HASH.test(left) && HASH.test(right) && crypto.timingSafeEqual(
    Buffer.from(left, "hex"),
    Buffer.from(right, "hex"),
  );
}

function canonicalMaterial(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdempotencyError("Operation identity material is invalid", "operation_invalid");
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (
    entries.length < 1 || entries.length > 20 ||
    entries.some(([key, candidate]) => (
      !/^[a-z][a-zA-Z0-9]{0,39}$/.test(key) ||
      !["string", "number", "boolean"].includes(typeof candidate) ||
      (typeof candidate === "string" && (candidate.length > 200 || /[\u0000-\u001f\u007f]/.test(candidate))) ||
      (typeof candidate === "number" && !Number.isSafeInteger(candidate))
    ))
  ) throw new IdempotencyError("Operation identity material is invalid", "operation_invalid");
  return JSON.stringify(entries);
}

function deriveOperationIdentity(config, action, dealId, material) {
  if (!ACTION_SET.has(action) || !/^[1-9][0-9]{7,29}$/.test(dealId)) {
    throw new IdempotencyError("Operation identity input is invalid", "operation_invalid");
  }
  const canonical = canonicalMaterial(material);
  const stableIdentity = `${config.deploymentEnvironment}\0${dealId}\0${action}`;
  const key = crypto.createHmac("sha256", config.idempotencyPepper)
    .update(`operation\0${stableIdentity}`)
    .digest("hex");
  const fingerprint = crypto.createHmac("sha256", config.idempotencyPepper)
    .update(`fingerprint\0${stableIdentity}\0${canonical}`)
    .digest("hex");
  const referencePrefix = action === "start_evaluation"
    ? "syl-evaluation-"
    : action === "prepare_paid_subscription"
      ? "syl-paid-"
      : null;
  return Object.freeze({
    operationKey: key,
    operationFingerprint: fingerprint,
    billingReference: referencePrefix ? `${referencePrefix}${key.slice(0, 32)}` : null,
  });
}

function createOperationStore(app, config) {
  if (typeof app?.datastore !== "function" || typeof app?.zcql !== "function") {
    throw new IdempotencyError("Catalyst Data Store is unavailable");
  }
  const table = app.datastore().table(config.operationTable);

  async function query(statement) {
    let result;
    try {
      result = await withOperationTimeout(
        () => app.zcql().executeZCQLQuery(statement),
        config.platformOperationTimeoutMs,
      );
    } catch {
      throw new IdempotencyError("Operation readback failed");
    }
    if (!Array.isArray(result) || result.length > 1) {
      throw new IdempotencyError("Operation readback is not unique", "reconciliation_required");
    }
    return result.length ? unwrap(result[0], config.operationTable) : null;
  }

  async function readByKey(operationKey) {
    if (!HASH.test(operationKey)) throw new IdempotencyError("Operation key is invalid");
    return query(
      `SELECT ROWID, OPERATION_KEY, OPERATION_FINGERPRINT, ACTION, CRM_DEAL_ID, STATUS, LAST_OUTCOME FROM ${config.operationTable} WHERE OPERATION_KEY = '${operationKey}'`,
    );
  }

  async function readByRowId(selectedRowId) {
    const normalized = rowId(selectedRowId);
    return query(
      `SELECT ROWID, STATUS, LAST_OUTCOME FROM ${config.operationTable} WHERE ROWID = ${normalized}`,
    );
  }

  async function claim({ operationKey, operationFingerprint, action, dealId }) {
    if (
      !HASH.test(operationKey) || !HASH.test(operationFingerprint) ||
      !ACTION_SET.has(action) || !/^[1-9][0-9]{7,29}$/.test(dealId)
    ) throw new IdempotencyError("Operation claim input is invalid");
    let insertError = null;
    try {
      const inserted = await withOperationTimeout(() => table.insertRow({
        OPERATION_KEY: operationKey,
        OPERATION_FINGERPRINT: operationFingerprint,
        ACTION: action,
        CRM_DEAL_ID: dealId,
        STATUS: "processing",
        SOURCE_REVISION: config.sourceRevision,
        SOURCE_ENVIRONMENT: config.deploymentEnvironment,
        LAST_OUTCOME: "claimed",
      }), config.platformOperationTimeoutMs, { ambiguous: true });
      return Object.freeze({ outcome: "claimed", rowId: rowId(inserted?.ROWID) });
    } catch (error) {
      insertError = error;
    }
    const existing = await readByKey(operationKey);
    if (!existing) {
      const code = String(extractErrorCode(insertError) ?? "");
      if (!config.duplicateErrorCodes.includes(code)) {
        throw new IdempotencyError("Operation claim failed or timed out");
      }
      throw new IdempotencyError("Duplicate operation claim has no readback", "reconciliation_required");
    }
    const matches = (
      safeHashEqual(String(existing.OPERATION_FINGERPRINT ?? ""), operationFingerprint) &&
      existing.ACTION === action && String(existing.CRM_DEAL_ID ?? "") === dealId
    );
    if (!matches) return Object.freeze({ outcome: "duplicate-conflict", rowId: rowId(existing.ROWID) });
    return Object.freeze({
      outcome: existing.STATUS === "completed" ? "duplicate-completed" : "duplicate-unresolved",
      rowId: rowId(existing.ROWID),
    });
  }

  async function mark(selectedRowId, status, lastOutcome) {
    const normalized = rowId(selectedRowId);
    if (!new Set(["completed", "failed", "reconciliation_required"]).has(status)) {
      throw new IdempotencyError("Operation status is invalid");
    }
    if (!OUTCOME.test(lastOutcome)) throw new IdempotencyError("Operation outcome is invalid");
    try {
      await withOperationTimeout(() => table.updateRow({
        ROWID: normalized,
        STATUS: status,
        LAST_OUTCOME: lastOutcome,
      }), config.platformOperationTimeoutMs, { ambiguous: true });
    } catch {
      // The exact row readback below is authoritative after an uncertain update.
    }
    const readback = await readByRowId(normalized);
    if (!readback || readback.STATUS !== status || readback.LAST_OUTCOME !== lastOutcome) {
      throw new IdempotencyError("Operation result readback does not match", "reconciliation_required");
    }
    return Object.freeze({ rowId: normalized, status, lastOutcome });
  }

  return Object.freeze({ claim, mark, readByKey, readByRowId });
}

module.exports = { IdempotencyError, createOperationStore, deriveOperationIdentity };
