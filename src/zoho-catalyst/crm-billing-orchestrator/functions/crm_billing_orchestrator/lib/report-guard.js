"use strict";

const crypto = require("node:crypto");
const { withOperationTimeout } = require("./operation-timeout");

const ACTION = "report_summary_write_guard";
const DOMAIN = "sylvara.crm-report-writer.v1";
const HASH = /^[a-f0-9]{64}$/;
const RECORD_ID = /^[1-9][0-9]{7,29}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const BINDING_FIELDS = ["dealId", "accountId", "deploymentId", "configurationVersion"];
const PAYLOAD_FIELDS = ["schemaVersion", ...BINDING_FIELDS,
  "confirmedOperationKey", "inflightOperationKey"];

class ReportGuardError extends Error {
  constructor(message, publicCode = "reconciliation_required") {
    super(message);
    this.name = "ReportGuardError";
    this.publicCode = publicCode;
    this.status = publicCode === "operation_invalid" ? 409 : 503;
    this.ambiguous = publicCode === "reconciliation_required";
  }
}

function fail(message, code) { throw new ReportGuardError(message, code); }

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function validBinding(value) {
  if (!plain(value) || Object.keys(value).length !== BINDING_FIELDS.length
    || !BINDING_FIELDS.every((field) => Object.hasOwn(value, field))
    || !RECORD_ID.test(value.dealId) || typeof value.dealId !== "string"
    || !RECORD_ID.test(value.accountId) || typeof value.accountId !== "string"
    || typeof value.deploymentId !== "string" || !IDENTIFIER.test(value.deploymentId)
    || typeof value.configurationVersion !== "string"
    || !IDENTIFIER.test(value.configurationVersion)) {
    fail("Report writer binding is invalid", "operation_invalid");
  }
  return Object.fromEntries(BINDING_FIELDS.map((field) => [field, value[field]]));
}

function validHash(value, nullable = false) {
  return (nullable && value === null) || (typeof value === "string" && HASH.test(value));
}

function validAt(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** Serializes report revisions without relying on CRM timestamp precision or a time-based lease.
 * The busy guard is released only after the caller proves the CRM patch and completed receipt.
 */
function createReportGuardStore(app, config, readByKey) {
  if (typeof app?.datastore !== "function" || typeof app?.zcql !== "function"
    || typeof readByKey !== "function"
    || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(config.operationTable)
    || config.deploymentEnvironment !== "development"
    || typeof config.analyticsPartitionSecret !== "string"
    || config.analyticsPartitionSecret.length < 32
    || !/^[a-f0-9]{40}$/.test(config.sourceRevision)
    || !Number.isSafeInteger(config.platformOperationTimeoutMs)
    || config.platformOperationTimeoutMs < 1) {
    fail("Report writer store is unavailable", "configuration_invalid");
  }
  const table = app.datastore().table(config.operationTable);
  const digest = (purpose, material) => crypto.createHmac("sha256", config.analyticsPartitionSecret)
    .update(`${DOMAIN}\0${config.deploymentEnvironment}\0${purpose}\0${material}`).digest("hex");
  const identity = (binding) => ({
    // Only the Deal determines the unique key; a changed Account/deployment cannot create a second writer.
    key: digest("guard", binding.dealId),
    fingerprint: digest("binding", JSON.stringify(binding)),
  });
  const payload = (binding, confirmedOperationKey, inflightOperationKey) => ({
    schemaVersion: 1, ...binding, confirmedOperationKey, inflightOperationKey,
  });

  function validateRow(row, binding) {
    if (row === null || row === undefined) return null;
    const expected = identity(binding);
    let guard;
    try { guard = JSON.parse(row.OPERATION_PAYLOAD_JSON); } catch {
      fail("Report writer state is malformed");
    }
    const version = Number(row.OPERATION_VERSION);
    if (!plain(guard) || Object.keys(guard).length !== PAYLOAD_FIELDS.length
      || !PAYLOAD_FIELDS.every((field) => Object.hasOwn(guard, field))
      || guard.schemaVersion !== 1
      || !BINDING_FIELDS.every((field) => guard[field] === binding[field])
      || !validHash(guard.confirmedOperationKey, true)
      || !validHash(guard.inflightOperationKey, true)
      || !/^[0-9]{1,30}$/.test(String(row.ROWID ?? ""))
      || row.OPERATION_KEY !== expected.key || row.OPERATION_FINGERPRINT !== expected.fingerprint
      || row.ACTION !== ACTION || row.CRM_DEAL_ID !== binding.dealId
      || row.SOURCE_ENVIRONMENT !== config.deploymentEnvironment
      || !/^[a-f0-9]{40}$/.test(String(row.SOURCE_REVISION ?? ""))
      || row.STATUS !== "processing"
      || row.LAST_OUTCOME !== (guard.inflightOperationKey === null
        ? "report_writer_idle" : "report_writer_busy")
      || !Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER
      || !validAt(row.CREATED_AT) || !validAt(row.UPDATED_AT)) {
      fail("Report writer ownership or state conflicts");
    }
    return { row, guard: Object.freeze(payload(binding,
      guard.confirmedOperationKey, guard.inflightOperationKey)) };
  }

  async function read(binding) {
    let row;
    try { row = await readByKey(identity(binding).key); } catch {
      fail("Report writer state readback is unavailable");
    }
    return validateRow(row, binding);
  }

  async function readReportGuard(input) {
    return (await read(validBinding(input)))?.guard ?? null;
  }

  async function ensure(binding, at) {
    const current = await read(binding);
    if (current) return current;
    const expected = identity(binding);
    try {
      await withOperationTimeout(() => table.insertRow({
        OPERATION_KEY: expected.key, OPERATION_FINGERPRINT: expected.fingerprint,
        ACTION, CRM_DEAL_ID: binding.dealId, STATUS: "processing",
        SOURCE_REVISION: config.sourceRevision, SOURCE_ENVIRONMENT: config.deploymentEnvironment,
        LAST_OUTCOME: "report_writer_idle", OPERATION_PAYLOAD_JSON: JSON.stringify(payload(binding, null, null)),
        OPERATION_VERSION: 1, CREATED_AT: at, UPDATED_AT: at,
      }), config.platformOperationTimeoutMs, { ambiguous: true });
    } catch {
      // Duplicate or ambiguous creation is resolved solely by the unique-key readback.
    }
    const created = await read(binding);
    if (!created) fail("Report writer creation requires reconciliation");
    return created;
  }

  async function transition(binding, current, next, at) {
    const version = Number(current.row.OPERATION_VERSION);
    const outcome = next.inflightOperationKey === null ? "report_writer_idle" : "report_writer_busy";
    const serialized = JSON.stringify(next);
    // Catalyst permits five WHERE predicates. ROWID and the version fence protect
    // this already-validated immutable identity; readback verifies it again.
    // Every interpolated value is a validated identifier, ISO timestamp or fixed JSON shape.
    const statement = `UPDATE ${config.operationTable} SET OPERATION_PAYLOAD_JSON = '${serialized}', LAST_OUTCOME = '${outcome}', OPERATION_VERSION = ${version + 1}, UPDATED_AT = '${at}' WHERE ROWID = ${current.row.ROWID} AND ACTION = '${ACTION}' AND STATUS = 'processing' AND LAST_OUTCOME = '${current.row.LAST_OUTCOME}' AND OPERATION_VERSION = ${version}`;
    try {
      await withOperationTimeout(() => app.zcql().executeZCQLQuery(statement),
        config.platformOperationTimeoutMs, { ambiguous: true });
    } catch {
      // Never retry a possibly successful CAS. Exact readback decides whether this state won.
    }
    const result = await read(binding);
    if (!result) fail("Report writer transition readback is unavailable");
    const exact = String(result.row.ROWID) === String(current.row.ROWID)
      && result.row.SOURCE_REVISION === current.row.SOURCE_REVISION
      && result.row.CREATED_AT === current.row.CREATED_AT
      && Number(result.row.OPERATION_VERSION) === version + 1
      && result.row.LAST_OUTCOME === outcome && result.row.UPDATED_AT === at
      && JSON.stringify(result.guard) === serialized;
    return { exact, guard: result.guard };
  }

  async function claimReportGuard(input, operationKey, expectedConfirmedKey, at) {
    const binding = validBinding(input);
    if (!validHash(operationKey) || !validHash(expectedConfirmedKey, true) || !validAt(at)) {
      fail("Report writer claim is invalid", "operation_invalid");
    }
    const current = await ensure(binding, at);
    if (current.guard.confirmedOperationKey !== expectedConfirmedKey) {
      return Object.freeze({ claimed: false, guard: current.guard });
    }
    if (current.guard.inflightOperationKey !== null) {
      return Object.freeze({ claimed: current.guard.inflightOperationKey === operationKey,
        guard: current.guard });
    }
    const result = await transition(binding, current, payload(binding, expectedConfirmedKey, operationKey), at);
    return Object.freeze({ claimed: result.exact, guard: result.guard });
  }

  async function completeReportGuard(input, operationKey, at) {
    const binding = validBinding(input);
    if (!validHash(operationKey) || !validAt(at)) {
      fail("Report writer completion is invalid", "operation_invalid");
    }
    const current = await read(binding);
    if (!current) fail("Report writer completion has no durable claim");
    if (current.guard.inflightOperationKey === null) {
      return Object.freeze({ completed: current.guard.confirmedOperationKey === operationKey,
        guard: current.guard });
    }
    if (current.guard.inflightOperationKey !== operationKey) {
      return Object.freeze({ completed: false, guard: current.guard });
    }
    const result = await transition(binding, current, payload(binding, operationKey, null), at);
    return Object.freeze({ completed: result.exact, guard: result.guard });
  }

  return Object.freeze({ readReportGuard, claimReportGuard, completeReportGuard });
}

module.exports = { ReportGuardError, createReportGuardStore };
