"use strict";

const { SOURCE_REVISION_PATTERN } = require("./config");

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OUTCOME_PATTERN = /^[a-z0-9_]{1,80}$/;
const VERIFICATION_OWNER_PATTERN = /^verify_[a-f0-9]{64}$/;
// A short lease serializes OTP comparisons without retaining the submitted code.
// An abandoned lease can be reclaimed, while an active lease returns a retryable
// in-progress result instead of evaluating a second concurrent guess.
const VERIFICATION_LEASE_MS = 15_000;
const STATUS_SET = new Set([
  "pending_send",
  "sending",
  "issued",
  "verifying",
  "verified",
  "consumed",
  "expired",
  "failed",
  "ambiguous",
  "retry_required",
  "terminal_failure",
  "reconciliation_required",
]);
const PROOF_STORED_FIELDS = Object.freeze([
  "ROWID",
  "PROOF_KEY",
  "SESSION_ROW_ID",
  "BINDING_DIGEST",
  "DESTINATION_DIGEST",
  "OTP_DIGEST",
  "OTP_GENERATION",
  "STATUS",
  "ATTEMPT_COUNT",
  "MAX_ATTEMPTS",
  "SEND_COUNT",
  "MAX_SENDS",
  "ISSUED_AT",
  "EXPIRES_AT",
  "LAST_ATTEMPT_AT",
  "VERIFICATION_OWNER",
  "VERIFICATION_LEASE_EXPIRES_AT",
  "VERIFIED_AT",
  "CONSUMED_AT",
  "PROVIDER_STATE",
  "PROVIDER_ATTEMPT_COUNT",
  "PROVIDER_INVOKED_AT",
  "PROVIDER_RESULT_REFERENCE",
  "SOURCE_REVISION",
  "SOURCE_ENVIRONMENT",
  "LAST_OUTCOME",
  "UPDATED_AT",
]);

class VerificationProofStoreError extends Error {
  constructor(message, publicCode = "verification_store_unavailable") {
    super(message);
    this.name = "VerificationProofStoreError";
    this.publicCode = publicCode;
  }
}

function fail(message, publicCode) {
  throw new VerificationProofStoreError(message, publicCode);
}

function parseInteger(value, name, minimum, maximum) {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${name} is invalid`);
  }
  return parsed;
}

function parseIso(value, name) {
  if (typeof value !== "string" || !ISO_PATTERN.test(value)) fail(`${name} is invalid`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(`${name} is invalid`);
  }
  return parsed;
}

function unwrapRow(row, tableName) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const nested = row[tableName];
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested : row;
}

function normalizeRow(raw, tableName) {
  const row = unwrapRow(raw, tableName);
  if (!row) fail("Verification proof row is incomplete");
  const normalized = {
    rowId: String(row.ROWID ?? ""),
    proofKey: String(row.PROOF_KEY ?? ""),
    sessionRowId: String(row.SESSION_ROW_ID ?? ""),
    bindingDigest: String(row.BINDING_DIGEST ?? ""),
    destinationDigest: String(row.DESTINATION_DIGEST ?? ""),
    otpDigest: String(row.OTP_DIGEST ?? ""),
    otpGeneration: parseInteger(row.OTP_GENERATION, "OTP_GENERATION", 1, 100),
    status: String(row.STATUS ?? ""),
    attemptCount: parseInteger(row.ATTEMPT_COUNT, "ATTEMPT_COUNT", 0, 10),
    maxAttempts: parseInteger(row.MAX_ATTEMPTS, "MAX_ATTEMPTS", 2, 10),
    sendCount: parseInteger(row.SEND_COUNT, "SEND_COUNT", 0, 5),
    maxSends: parseInteger(row.MAX_SENDS, "MAX_SENDS", 1, 5),
    issuedAt: String(row.ISSUED_AT ?? ""),
    expiresAt: String(row.EXPIRES_AT ?? ""),
    lastAttemptAt: String(row.LAST_ATTEMPT_AT ?? ""),
    verificationOwner: String(row.VERIFICATION_OWNER ?? ""),
    verificationLeaseExpiresAt: String(row.VERIFICATION_LEASE_EXPIRES_AT ?? ""),
    verifiedAt: String(row.VERIFIED_AT ?? ""),
    consumedAt: String(row.CONSUMED_AT ?? ""),
    providerState: String(row.PROVIDER_STATE ?? ""),
    providerAttemptCount: parseInteger(
      row.PROVIDER_ATTEMPT_COUNT,
      "PROVIDER_ATTEMPT_COUNT",
      0,
      5,
    ),
    providerInvokedAt: String(row.PROVIDER_INVOKED_AT ?? ""),
    providerResultReference: String(row.PROVIDER_RESULT_REFERENCE ?? ""),
    sourceRevision: String(row.SOURCE_REVISION ?? ""),
    sourceEnvironment: String(row.SOURCE_ENVIRONMENT ?? ""),
    lastOutcome: String(row.LAST_OUTCOME ?? ""),
    updatedAt: String(row.UPDATED_AT ?? ""),
  };
  if (
    !ROW_ID_PATTERN.test(normalized.rowId) ||
    !ROW_ID_PATTERN.test(normalized.sessionRowId) ||
    ![
      normalized.proofKey,
      normalized.bindingDigest,
      normalized.destinationDigest,
      normalized.otpDigest,
    ].every((value) => HASH_PATTERN.test(value)) ||
    !STATUS_SET.has(normalized.status) ||
    !OUTCOME_PATTERN.test(normalized.lastOutcome) ||
    !/^[a-z][a-z0-9_]{1,31}$/.test(normalized.providerState) ||
    !/^(?:|(?:claim|mail|stub)_[a-f0-9]{64})$/.test(normalized.providerResultReference) ||
    normalized.sourceEnvironment !== "development" ||
    !SOURCE_REVISION_PATTERN.test(normalized.sourceRevision)
  ) {
    fail("Verification proof row contains invalid operational metadata");
  }
  parseIso(normalized.issuedAt, "ISSUED_AT");
  parseIso(normalized.expiresAt, "EXPIRES_AT");
  parseIso(normalized.updatedAt, "UPDATED_AT");
  for (const [name, value] of [
    ["LAST_ATTEMPT_AT", normalized.lastAttemptAt],
    ["VERIFIED_AT", normalized.verifiedAt],
    ["CONSUMED_AT", normalized.consumedAt],
    ["PROVIDER_INVOKED_AT", normalized.providerInvokedAt],
    ["VERIFICATION_LEASE_EXPIRES_AT", normalized.verificationLeaseExpiresAt],
  ]) {
    if (value) parseIso(value, name);
  }
  if (
    normalized.status === "verifying"
      ? !VERIFICATION_OWNER_PATTERN.test(normalized.verificationOwner) ||
        !normalized.verificationLeaseExpiresAt
      : normalized.verificationOwner !== "" || normalized.verificationLeaseExpiresAt !== ""
  ) {
    fail("Verification proof row contains an invalid verification lease");
  }
  const activeSendClaim = normalized.status === "sending" &&
    new Set(["claimed", "invoking"]).has(normalized.providerState) &&
    /^claim_[a-f0-9]{64}$/.test(normalized.providerResultReference) &&
    (
      normalized.providerState === "claimed"
        ? normalized.providerInvokedAt === ""
        : normalized.providerInvokedAt !== ""
    );
  if (
    normalized.status === "sending"
      ? !activeSendClaim
      : new Set(["claimed", "invoking"]).has(normalized.providerState)
  ) {
    fail("Verification proof row contains an invalid provider claim");
  }
  return Object.freeze(normalized);
}

function validateConfig(config) {
  if (
    config?.deploymentEnvironment !== "development" ||
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(config?.proofTableName ?? "") ||
    !SOURCE_REVISION_PATTERN.test(config?.sourceRevision ?? "") ||
    !Number.isSafeInteger(config?.form2ProofTtlSeconds) ||
    config.form2ProofTtlSeconds < 300 ||
    config.form2ProofTtlSeconds > 900 ||
    !Number.isSafeInteger(config?.form2ProofMaxAttempts) ||
    config.form2ProofMaxAttempts < 2 ||
    config.form2ProofMaxAttempts > 10 ||
    !Number.isSafeInteger(config?.form2ProofMaxSends) ||
    config.form2ProofMaxSends < 1 ||
    config.form2ProofMaxSends > 5 ||
    !Number.isSafeInteger(config?.form2ProofResendCooldownSeconds) ||
    config.form2ProofResendCooldownSeconds < 30 ||
    config.form2ProofResendCooldownSeconds > 300 ||
    !Number.isSafeInteger(config?.form2ProofSendLeaseSeconds) ||
    config.form2ProofSendLeaseSeconds < 10 ||
    config.form2ProofSendLeaseSeconds > 120
  ) {
    fail("Verification proof store configuration is invalid", "configuration_invalid");
  }
}

function validateAdapter(adapter) {
  for (const method of ["insertRow", "updateRow", "findRowsByProofKey", "findRowsByRowId"]) {
    if (typeof adapter?.[method] !== "function") {
      fail(`Verification proof adapter is missing ${method}`, "configuration_invalid");
    }
  }
}

function createVerificationProofStore(adapter, config, { now = Date.now } = {}) {
  validateAdapter(adapter);
  validateConfig(config);
  if (typeof now !== "function") fail("Verification proof clock is invalid");
  const tableName = config.proofTableName;

  function currentTime() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) fail("Verification proof clock is invalid");
    return value;
  }

  async function queryExactlyOne(operation, allowMissing = false) {
    const rows = await operation();
    if (!Array.isArray(rows) || rows.length > 1) {
      fail("Verification proof ownership is ambiguous", "reconciliation_required");
    }
    if (rows.length === 0) {
      if (allowMissing) return null;
      fail("Verification proof is unavailable", "verification_required");
    }
    return normalizeRow(rows[0], tableName);
  }

  async function readByProofKey(selectedProofKey) {
    if (!HASH_PATTERN.test(selectedProofKey ?? "")) {
      fail("Verification proof key is invalid", "verification_required");
    }
    return queryExactlyOne(
      () => adapter.findRowsByProofKey(tableName, selectedProofKey),
      true,
    );
  }

  async function readByRowId(rowId) {
    const normalized = String(rowId ?? "");
    if (!ROW_ID_PATTERN.test(normalized)) fail("Verification proof row identity is invalid");
    return queryExactlyOne(() => adapter.findRowsByRowId(tableName, normalized));
  }

  async function writeAndReadBack(current, patch, expected = {}) {
    try {
      await adapter.updateRow(tableName, { ROWID: current.rowId, ...patch }, {
        STATUS: current.status,
        OTP_GENERATION: current.otpGeneration,
        UPDATED_AT: current.updatedAt,
        ...expected,
      });
    } catch {
      // Conditional-write failures and timeouts are resolved only by durable readback.
    }
    return readByRowId(current.rowId);
  }

  function exactIdentity(left, right) {
    return Boolean(left && right) &&
      left.proofKey === right.proofKey &&
      left.sessionRowId === right.sessionRowId &&
      left.bindingDigest === right.bindingDigest &&
      left.destinationDigest === right.destinationDigest;
  }

  async function reserve(input) {
    if (
      ![input?.proofKey, input?.bindingDigest, input?.destinationDigest, input?.otpDigest]
        .every((value) => HASH_PATTERN.test(value ?? "")) ||
      !ROW_ID_PATTERN.test(String(input?.sessionRowId ?? "")) ||
      !Number.isSafeInteger(input?.generation) ||
      input.generation !== 1
    ) {
      fail("Verification proof reservation is invalid", "verification_required");
    }
    const nowMs = currentTime();
    const sessionExpiresAt = parseIso(input.sessionExpiresAt, "session expiration");
    const expiresAtMs = Math.min(
      nowMs + config.form2ProofTtlSeconds * 1000,
      sessionExpiresAt,
    );
    if (expiresAtMs <= nowMs) fail("Verification proof session has expired", "verification_required");
    const timestamp = new Date(nowMs).toISOString();
    const row = {
      PROOF_KEY: input.proofKey,
      SESSION_ROW_ID: String(input.sessionRowId),
      BINDING_DIGEST: input.bindingDigest,
      DESTINATION_DIGEST: input.destinationDigest,
      OTP_DIGEST: input.otpDigest,
      OTP_GENERATION: 1,
      STATUS: "pending_send",
      ATTEMPT_COUNT: 0,
      MAX_ATTEMPTS: config.form2ProofMaxAttempts,
      SEND_COUNT: 0,
      MAX_SENDS: config.form2ProofMaxSends,
      ISSUED_AT: timestamp,
      EXPIRES_AT: new Date(expiresAtMs).toISOString(),
      LAST_ATTEMPT_AT: "",
      VERIFICATION_OWNER: "",
      VERIFICATION_LEASE_EXPIRES_AT: "",
      VERIFIED_AT: "",
      CONSUMED_AT: "",
      PROVIDER_STATE: "not_invoked",
      PROVIDER_ATTEMPT_COUNT: 0,
      PROVIDER_INVOKED_AT: "",
      PROVIDER_RESULT_REFERENCE: "",
      SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: "development",
      LAST_OUTCOME: "pending_send",
      UPDATED_AT: timestamp,
    };
    try {
      await adapter.insertRow(tableName, row);
    } catch {
      // A unique conflict or timeout is resolved by the key readback below.
    }
    const readback = await readByProofKey(input.proofKey);
    if (!readback || !exactIdentity(readback, {
      proofKey: input.proofKey,
      sessionRowId: String(input.sessionRowId),
      bindingDigest: input.bindingDigest,
      destinationDigest: input.destinationDigest,
    })) {
      fail("Verification proof reservation requires reconciliation", "reconciliation_required");
    }
    return readback;
  }

  async function prepareResend(current, otpDigest, sessionExpiresAt) {
    if (!HASH_PATTERN.test(otpDigest ?? "")) fail("Verification resend digest is invalid");
    if (!new Set(["pending_send", "retry_required", "issued"]).has(current.status)) {
      return current;
    }
    const nowMs = currentTime();
    if (
      current.status === "issued" &&
      parseIso(current.expiresAt, "EXPIRES_AT") <= nowMs &&
      current.sendCount >= current.maxSends
    ) {
      const timestamp = new Date(nowMs).toISOString();
      return writeAndReadBack(current, {
        STATUS: "terminal_failure",
        PROVIDER_STATE: "terminal_failure",
        PROVIDER_RESULT_REFERENCE: "",
        LAST_OUTCOME: "otp_send_limit_exhausted",
        UPDATED_AT: timestamp,
      });
    }
    if (
      current.sendCount >= current.maxSends ||
      (current.status === "issued" && nowMs - parseIso(current.issuedAt, "ISSUED_AT") <
        config.form2ProofResendCooldownSeconds * 1000
      )
    ) {
      return current;
    }
    const expiresAtMs = Math.min(
      nowMs + config.form2ProofTtlSeconds * 1000,
      parseIso(sessionExpiresAt, "session expiration"),
    );
    if (expiresAtMs <= nowMs) return current;
    const timestamp = new Date(nowMs).toISOString();
    const readback = await writeAndReadBack(current, {
      OTP_DIGEST: otpDigest,
      OTP_GENERATION: current.otpGeneration + 1,
      STATUS: "pending_send",
      ATTEMPT_COUNT: 0,
      ISSUED_AT: timestamp,
      EXPIRES_AT: new Date(expiresAtMs).toISOString(),
      LAST_ATTEMPT_AT: "",
      VERIFICATION_OWNER: "",
      VERIFICATION_LEASE_EXPIRES_AT: "",
      PROVIDER_STATE: "not_invoked",
      PROVIDER_INVOKED_AT: "",
      PROVIDER_RESULT_REFERENCE: "",
      LAST_OUTCOME: "pending_resend",
      UPDATED_AT: timestamp,
    });
    if (
      readback.status === "pending_send" &&
      readback.otpGeneration === current.otpGeneration + 1 &&
      readback.otpDigest === otpDigest
    ) return readback;
    return readback;
  }

  async function claimSend(current, claimKey) {
    if (!new Set(["pending_send", "retry_required"]).has(current.status)) return current;
    if (!/^claim_[a-f0-9]{64}$/.test(claimKey ?? "")) {
      fail("Verification provider claim is invalid");
    }
    if (current.providerAttemptCount >= current.maxSends) {
      const exhaustedAt = new Date(currentTime()).toISOString();
      return writeAndReadBack(current, {
        STATUS: "terminal_failure",
        PROVIDER_STATE: "terminal_failure",
        PROVIDER_RESULT_REFERENCE: "",
        LAST_OUTCOME: "provider_claim_limit_exhausted",
        UPDATED_AT: exhaustedAt,
      });
    }
    const timestamp = new Date(currentTime()).toISOString();
    return writeAndReadBack(current, {
      STATUS: "sending",
      PROVIDER_STATE: "claimed",
      PROVIDER_ATTEMPT_COUNT: current.providerAttemptCount + 1,
      PROVIDER_INVOKED_AT: "",
      PROVIDER_RESULT_REFERENCE: claimKey,
      LAST_OUTCOME: "provider_claimed",
      UPDATED_AT: timestamp,
    });
  }

  async function markSendInvoking(current, claimKey) {
    if (
      current.status !== "sending" ||
      current.providerState !== "claimed" ||
      current.providerResultReference !== claimKey ||
      !/^claim_[a-f0-9]{64}$/.test(claimKey ?? "")
    ) return current;
    const timestamp = new Date(currentTime()).toISOString();
    return writeAndReadBack(current, {
      SEND_COUNT: current.sendCount + 1,
      PROVIDER_STATE: "invoking",
      PROVIDER_INVOKED_AT: timestamp,
      LAST_OUTCOME: "provider_invoking",
      UPDATED_AT: timestamp,
    }, {
      PROVIDER_STATE: "claimed",
      PROVIDER_RESULT_REFERENCE: claimKey,
    });
  }

  async function resolveStaleSend(current) {
    if (current.status !== "sending") return current;
    const nowMs = currentTime();
    const leaseStartedAt = current.providerState === "claimed"
      ? parseIso(current.updatedAt, "UPDATED_AT")
      : current.providerState === "invoking"
        ? parseIso(current.providerInvokedAt, "PROVIDER_INVOKED_AT")
        : NaN;
    if (!Number.isFinite(leaseStartedAt)) {
      fail("Verification provider claim state is invalid", "reconciliation_required");
    }
    if (nowMs < leaseStartedAt + config.form2ProofSendLeaseSeconds * 1000) {
      return current;
    }
    const timestamp = new Date(nowMs).toISOString();
    const safePreInvocationRetry = current.providerState === "claimed";
    return writeAndReadBack(current, {
      STATUS: safePreInvocationRetry ? "retry_required" : "ambiguous",
      PROVIDER_STATE: safePreInvocationRetry ? "retry_required" : "ambiguous",
      PROVIDER_INVOKED_AT: safePreInvocationRetry ? "" : current.providerInvokedAt,
      PROVIDER_RESULT_REFERENCE: "",
      LAST_OUTCOME: safePreInvocationRetry
        ? "stale_provider_claim_released"
        : "stale_provider_invocation_ambiguous",
      UPDATED_AT: timestamp,
    }, {
      PROVIDER_STATE: current.providerState,
      PROVIDER_RESULT_REFERENCE: current.providerResultReference,
    });
  }

  async function completeSend(current, result, claimKey) {
    if (current.status !== "sending") return current;
    if (
      current.providerState !== "invoking" ||
      current.providerResultReference !== claimKey ||
      !/^claim_[a-f0-9]{64}$/.test(claimKey ?? "")
    ) {
      fail("Verification provider claim does not match", "reconciliation_required");
    }
    const selected = {
      accepted: ["issued", "accepted", result?.providerResultReference ?? ""],
      stubbed: ["issued", "stubbed", result?.providerResultReference ?? ""],
      retry_required: ["retry_required", "retry_required", ""],
      terminal_failure: ["terminal_failure", "terminal_failure", ""],
      ambiguous: ["ambiguous", "ambiguous", ""],
    }[result?.outcome];
    if (!selected) fail("Verification provider result is invalid");
    if (
      new Set(["accepted", "stubbed"]).has(result.outcome) &&
      !new RegExp(`^${result.outcome === "accepted" ? "mail" : "stub"}_[a-f0-9]{64}$`)
        .test(selected[2])
    ) {
      fail("Verification provider acceptance is not evidenced", "reconciliation_required");
    }
    const timestamp = new Date(currentTime()).toISOString();
    let readback = await writeAndReadBack(current, {
      STATUS: selected[0],
      PROVIDER_STATE: selected[1],
      PROVIDER_RESULT_REFERENCE: selected[2],
      LAST_OUTCOME: `provider_${selected[1]}`,
      UPDATED_AT: timestamp,
    }, { PROVIDER_RESULT_REFERENCE: claimKey });
    if (
      readback.status === "sending" &&
      readback.providerResultReference === claimKey
    ) {
      const quarantineAt = new Date(currentTime()).toISOString();
      readback = await writeAndReadBack(readback, {
        STATUS: "ambiguous",
        PROVIDER_STATE: "ambiguous",
        PROVIDER_RESULT_REFERENCE: "",
        LAST_OUTCOME: "provider_commit_unknown",
        UPDATED_AT: quarantineAt,
      }, { PROVIDER_RESULT_REFERENCE: claimKey });
    }
    return readback;
  }

  async function claimVerificationAttempt(current, owner) {
    if (!VERIFICATION_OWNER_PATTERN.test(owner ?? "")) {
      fail("Verification attempt owner is invalid");
    }
    const nowMs = currentTime();
    if (current.status === "verifying") {
      if (parseIso(current.verificationLeaseExpiresAt, "VERIFICATION_LEASE_EXPIRES_AT") > nowMs) {
        return current;
      }
    } else if (current.status !== "issued") {
      return current;
    }
    if (parseIso(current.expiresAt, "EXPIRES_AT") <= nowMs) {
      const timestamp = new Date(nowMs).toISOString();
      return writeAndReadBack(current, {
        STATUS: "expired",
        VERIFICATION_OWNER: "",
        VERIFICATION_LEASE_EXPIRES_AT: "",
        LAST_ATTEMPT_AT: timestamp,
        LAST_OUTCOME: "otp_expired",
        UPDATED_AT: timestamp,
      }, {
        VERIFICATION_OWNER: current.verificationOwner,
        VERIFICATION_LEASE_EXPIRES_AT: current.verificationLeaseExpiresAt,
      });
    }
    const timestamp = new Date(nowMs).toISOString();
    return writeAndReadBack(current, {
      STATUS: "verifying",
      VERIFICATION_OWNER: owner,
      VERIFICATION_LEASE_EXPIRES_AT: new Date(
        Math.min(nowMs + VERIFICATION_LEASE_MS, parseIso(current.expiresAt, "EXPIRES_AT")),
      ).toISOString(),
      LAST_OUTCOME: "otp_verification_in_progress",
      UPDATED_AT: timestamp,
    }, {
      VERIFICATION_OWNER: current.verificationOwner,
      VERIFICATION_LEASE_EXPIRES_AT: current.verificationLeaseExpiresAt,
    });
  }

  async function recordFailedCode(current, owner) {
    if (
      current.status !== "verifying" ||
      current.verificationOwner !== owner ||
      !VERIFICATION_OWNER_PATTERN.test(owner ?? "")
    ) return current;
    const nowMs = currentTime();
    if (parseIso(current.expiresAt, "EXPIRES_AT") <= nowMs) {
      const timestamp = new Date(nowMs).toISOString();
      return writeAndReadBack(current, {
        STATUS: "expired",
        VERIFICATION_OWNER: "",
        VERIFICATION_LEASE_EXPIRES_AT: "",
        LAST_ATTEMPT_AT: timestamp,
        LAST_OUTCOME: "otp_expired",
        UPDATED_AT: timestamp,
      }, { VERIFICATION_OWNER: owner });
    }
    const nextCount = current.attemptCount + 1;
    const timestamp = new Date(nowMs).toISOString();
    return writeAndReadBack(current, {
      STATUS: nextCount >= current.maxAttempts ? "failed" : "issued",
      ATTEMPT_COUNT: nextCount,
      VERIFICATION_OWNER: "",
      VERIFICATION_LEASE_EXPIRES_AT: "",
      LAST_ATTEMPT_AT: timestamp,
      LAST_OUTCOME: nextCount >= current.maxAttempts ? "otp_attempts_exhausted" : "otp_invalid",
      UPDATED_AT: timestamp,
    }, { VERIFICATION_OWNER: owner });
  }

  async function markVerified(current, owner) {
    if (new Set(["verified", "consumed"]).has(current.status)) return current;
    if (
      current.status !== "verifying" ||
      current.verificationOwner !== owner ||
      !VERIFICATION_OWNER_PATTERN.test(owner ?? "") ||
      parseIso(current.expiresAt, "EXPIRES_AT") <= currentTime()
    ) {
      fail("Verification proof cannot be verified", "verification_required");
    }
    const timestamp = new Date(currentTime()).toISOString();
    return writeAndReadBack(current, {
      STATUS: "verified",
      VERIFICATION_OWNER: "",
      VERIFICATION_LEASE_EXPIRES_AT: "",
      VERIFIED_AT: timestamp,
      LAST_OUTCOME: "email_otp_verified",
      UPDATED_AT: timestamp,
    }, { VERIFICATION_OWNER: owner });
  }

  async function consume(current, bindingDigest, destinationDigest) {
    if (
      current.bindingDigest !== bindingDigest ||
      current.destinationDigest !== destinationDigest
    ) {
      fail("Verification proof binding does not match", "verification_required");
    }
    // The OTP deadline limits code entry, not recovery of a session that already
    // consumed the exact proof. The separately bounded session remains the retry
    // window after a downstream prefill failure.
    if (current.status === "consumed") return current;
    if (parseIso(current.expiresAt, "EXPIRES_AT") <= currentTime()) {
      fail("Verification proof has expired", "verification_required");
    }
    if (current.status !== "verified") fail("Verification proof is not verified", "verification_required");
    const timestamp = new Date(currentTime()).toISOString();
    const readback = await writeAndReadBack(current, {
      STATUS: "consumed",
      CONSUMED_AT: timestamp,
      LAST_OUTCOME: "proof_consumed",
      UPDATED_AT: timestamp,
    });
    if (readback.status !== "consumed") {
      fail("Verification proof consumption did not converge", "reconciliation_required");
    }
    return readback;
  }

  return Object.freeze({
    claimSend,
    claimVerificationAttempt,
    completeSend,
    consume,
    markVerified,
    markSendInvoking,
    prepareResend,
    readByProofKey,
    recordFailedCode,
    resolveStaleSend,
    reserve,
  });
}

module.exports = {
  PROOF_STORED_FIELDS,
  VerificationProofStoreError,
  createVerificationProofStore,
};
