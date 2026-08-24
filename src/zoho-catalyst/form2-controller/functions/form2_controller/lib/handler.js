"use strict";

const {
  isApprovedCatalystDevelopmentHostname,
  isArtifactBoundFormUrl,
} = require("./destinations");
const {
  CLIENT_KEYS,
  FormContractError,
  buildPrefillPayload,
  validateForm2Payload,
  validateForm2PayloadTypes,
  verifyRecordRelationships,
} = require("./form-contract");
const {
  HttpBoundaryError,
  parseJsonObject,
  parseRequestPath,
  readRawBody,
  validateJsonPost,
} = require("./http");
const {
  SecurityError,
  deriveAccessToken,
  deriveIssueRequestKey,
  hashAccessToken,
  isValidAccessToken,
  verifyCustomHeader,
} = require("./security");
const { fingerprintSnapshot, fingerprintSubmission } = require("./snapshot");
const { requireEmailOtpVerified } = require("./verification-proof");
const { renderAccessPage } = require("./access-page");

const ISSUE_REQUEST_KEYS = new Set(["dealId", "issueRequestId"]);
const PREFILL_KEYS = new Set(["setupToken"]);
const OTP_REQUEST_KEYS = new Set(["setupToken"]);
const OTP_VERIFY_KEYS = new Set(["setupToken", "code"]);
const SUBMISSION_KEYS = new Set(["setupToken", "prefillId", "submissionId", ...CLIENT_KEYS]);
const RECORD_ID_PATTERN = /^[1-9][0-9]{9,29}$/;
const SUBMISSION_ID_PATTERN = /^[0-9]{1,30}$/;
const RESPONSE_STAGES = new Set([
  "request",
  "issue",
  "access",
  "otp_request",
  "otp_verify",
  "prefill",
  "submission",
]);
const RESPONSE_OUTCOME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const NO_STORE_HEADERS = Object.freeze({
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Content-Type": "application/json; charset=utf-8",
});

class ControllerError extends Error {
  constructor(
    message,
    { status = 503, publicCode = "service_unavailable", ambiguous = false } = {},
  ) {
    super(message);
    this.name = "ControllerError";
    this.status = status;
    this.publicCode = publicCode;
    this.ambiguous = ambiguous;
  }
}

function response(status, body, stage, outcome, headers = NO_STORE_HEADERS) {
  if (
    !RESPONSE_STAGES.has(stage) ||
    typeof outcome !== "string" ||
    !RESPONSE_OUTCOME_PATTERN.test(outcome)
  ) {
    throw new ControllerError("Controller response metadata is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  return Object.freeze({
    status,
    headers,
    body: body && typeof body === "object" ? Object.freeze(body) : body,
    stage,
    outcome,
  });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, expected, message) {
  if (!isPlainObject(value)) {
    throw new ControllerError(message, { status: 422, publicCode: "form_invalid" });
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.size ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(key) ||
        !expected.has(key),
    ) ||
    [...expected].some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new ControllerError(message, { status: 422, publicCode: "form_invalid" });
  }
}

function normalizeRecordId(value, name) {
  if (typeof value !== "string" || !RECORD_ID_PATTERN.test(value)) {
    throw new ControllerError(`${name} is invalid`, {
      status: 422,
      publicCode: "form_invalid",
    });
  }
  return value;
}

function lookupId(record, key) {
  const lookup = record?.[key];
  if (!isPlainObject(lookup)) {
    throw new ControllerError("CRM relationship context is unavailable", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }
  return normalizeRecordId(lookup.id, key);
}

function normalizeNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ControllerError("Controller clock is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  return value;
}

function buildFormUrl(config, setupToken) {
  if (!isValidAccessToken(setupToken)) {
    throw new ControllerError("Setup token is invalid", {
      status: 404,
      publicCode: "setup_not_found",
    });
  }
  let url;
  try {
    url = new URL(config.form2PublicUrl);
  } catch {
    throw new ControllerError("Form URL configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !isArtifactBoundFormUrl(url.href, config.form2DestinationSha256) ||
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(config.form2TokenFieldAlias ?? "")
  ) {
    throw new ControllerError("Form URL configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  url.searchParams.set(config.form2TokenFieldAlias, setupToken);
  return url.toString();
}

function buildAccessUrl(config, setupToken) {
  if (!isValidAccessToken(setupToken)) throw genericSetupNotFound();
  let url;
  try {
    url = new URL(config.form2AccessPublicUrl);
  } catch {
    throw new ControllerError("Access URL configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !isApprovedCatalystDevelopmentHostname(url.hostname) ||
    url.pathname !== config.accessPath
  ) {
    throw new ControllerError("Access URL configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  url.hash = new URLSearchParams({ setupToken }).toString();
  return url.toString();
}

async function fetchSessionContext(crmClient, binding) {
  const crmContactId = normalizeRecordId(binding?.crmContactId, "Contact context");
  const crmAccountId = normalizeRecordId(binding?.crmAccountId, "Account context");
  const crmDealId = normalizeRecordId(binding?.crmDealId, "Deal context");
  const [contact, account, deal] = await Promise.all([
    crmClient.getRecord("Contacts", crmContactId),
    crmClient.getRecord("Accounts", crmAccountId),
    crmClient.getRecord("Deals", crmDealId),
  ]);
  if (contact?.id !== crmContactId || account?.id !== crmAccountId || deal?.id !== crmDealId) {
    throw new ControllerError("CRM context does not match", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }
  verifyRecordRelationships({ contact, account, deal });
  return Object.freeze({ contact, account, deal });
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function sameInstant(left, right) {
  if (!hasValue(left) || !hasValue(right)) return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function sameCrmInstant(left, right) {
  if (!hasValue(left) || !hasValue(right)) return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  // Zoho CRM DateTime fields round-trip at whole-second precision, while the
  // Catalyst session keeps ISO milliseconds. Compare only the precision CRM
  // can preserve; durable session-to-session comparisons remain exact.
  return Number.isFinite(leftMs) &&
    Number.isFinite(rightMs) &&
    Math.trunc(leftMs / 1000) === Math.trunc(rightMs / 1000);
}

function requireEligibleContext(existing, config, allowedAccessStatuses) {
  const deal = existing.deal;
  if (
    deal.Entry_Offer !== config.form2EntryOfferValue ||
    !hasValue(deal.Approved_Test_Route) ||
    hasValue(deal.Setup_Form_Submission_ID) ||
    hasValue(deal.Setup_Form_Submitted_At) ||
    !allowedAccessStatuses.has(deal.Setup_Access_Status)
  ) {
    throw new ControllerError("Setup context is not eligible", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }
}

function assertBindingMatchesSession(binding, session) {
  if (
    binding.crmContactId !== session.crmContactId ||
    binding.crmAccountId !== session.crmAccountId ||
    binding.crmDealId !== session.crmDealId ||
    String(binding.sessionRowId) !== String(session.rowId) ||
    binding.sessionAttemptCount !== session.attemptCount
  ) {
    throw new ControllerError("Setup binding does not match", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }
}

function prefillBinding(session, existing, snapshotFingerprint) {
  return {
    sessionRowId: session.rowId,
    sessionAttemptCount: session.attemptCount,
    crmContactId: session.crmContactId,
    crmAccountId: session.crmAccountId,
    crmDealId: session.crmDealId,
    contactModifiedTime: existing.contact.Modified_Time,
    accountModifiedTime: existing.account.Modified_Time,
    dealModifiedTime: existing.deal.Modified_Time,
    snapshotFingerprint,
  };
}

function assertFreshPrefill(existing, revision) {
  if (
    existing.contact.Modified_Time !== revision.contactModifiedTime ||
    existing.account.Modified_Time !== revision.accountModifiedTime ||
    existing.deal.Modified_Time !== revision.dealModifiedTime
  ) {
    throw new ControllerError("Prefill revision is stale", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }
}

function namespaceSubmissionId(config, submissionId) {
  if (typeof submissionId !== "string" || !SUBMISSION_ID_PATTERN.test(submissionId)) {
    throw new ControllerError("Submission identity is invalid", {
      status: 422,
      publicCode: "form_invalid",
    });
  }
  const namespaced = `${config.form2FormVersion}:${submissionId}`;
  if (namespaced.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/.test(namespaced)) {
    throw new ControllerError("Submission identity is invalid", {
      status: 422,
      publicCode: "form_invalid",
    });
  }
  return namespaced;
}

function publicError(error) {
  if (error instanceof ControllerError) return error;
  if (error instanceof HttpBoundaryError) {
    return new ControllerError("Request boundary rejected the request", {
      status: error.status,
      publicCode: error.publicCode,
      ambiguous: error.ambiguous,
    });
  }
  if (error instanceof FormContractError) {
    const contextFailure = new Set([
      "context_invalid",
      "context_mismatch",
      "identity_mismatch",
      "mobile_reverification_required",
      "relationship_mismatch",
    ]).has(error.publicCode) || error.status === 409;
    return new ControllerError("Form contract rejected the request", {
      status: contextFailure ? 409 : 422,
      publicCode: contextFailure ? "setup_conflict" : "form_invalid",
    });
  }
  if (error instanceof SecurityError) {
    return new ControllerError("Security input is invalid", {
      status: 422,
      publicCode: "form_invalid",
    });
  }

  if (error?.publicCode === "verification_required") {
    return new ControllerError("Verified email access is required", {
      status: 403,
      publicCode: "verification_required",
    });
  }

  if (error?.publicCode === "setup_not_found") return genericSetupNotFound();
  if (new Set(["identity_mismatch", "relationship_mismatch"]).has(error?.publicCode)) {
    return new ControllerError("Setup identity does not match", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }

  const code = error?.publicCode;
  if (code === "record_stale") {
    return new ControllerError("CRM record is stale", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }
  if (
    new Set([
      "prefill_not_found",
      "prefill_context_invalid",
      "prefill_stale",
      "prefill_consumed",
      "submission_conflict",
      "submission_unresolved",
      "session_state_invalid",
    ]).has(code)
  ) {
    return new ControllerError("Workflow state conflicts with the request", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }
  if (new Set(["workflow_input_invalid", "session_input_invalid"]).has(code)) {
    return new ControllerError("Workflow input is invalid", {
      status: 422,
      publicCode: "form_invalid",
    });
  }
  if (error?.ambiguous === true || code === "reconciliation_required") {
    return new ControllerError("Workflow outcome requires reconciliation", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  return new ControllerError("A required dependency is unavailable", {
    status: 503,
    publicCode: "service_unavailable",
  });
}

function genericSetupNotFound() {
  return new ControllerError("Setup session was not found", {
    status: 404,
    publicCode: "setup_not_found",
  });
}

function sameSessionIdentity(left, right) {
  return Boolean(left && right) &&
    String(left.rowId) === String(right.rowId) &&
    left.tokenHash === right.tokenHash &&
    left.crmContactId === right.crmContactId &&
    left.crmAccountId === right.crmAccountId &&
    left.crmDealId === right.crmDealId;
}

function sessionAttemptAdvanced(candidate, readback) {
  return Number.isSafeInteger(candidate?.attemptCount) &&
    Number.isSafeInteger(candidate?.maxAttempts) &&
    Number.isSafeInteger(readback?.attemptCount) &&
    Number.isSafeInteger(readback?.maxAttempts) &&
    readback.maxAttempts === candidate.maxAttempts &&
    readback.attemptCount > candidate.attemptCount &&
    readback.attemptCount <= readback.maxAttempts;
}

function pendingExpiryMatches(candidate, readback) {
  return sameSessionIdentity(candidate, readback) &&
    readback.status === "expired" &&
    new Set(["crm_expiry_pending", "issuing_expiry_pending"]).has(
      readback.lastOutcome,
    ) &&
    hasValue(readback.expiredAt);
}

function synchronizedExpiryMatches(candidate, readback) {
  return sameSessionIdentity(candidate, readback) &&
    readback.status === "expired" &&
    readback.lastOutcome === "crm_expiry_synced" &&
    hasValue(readback.expiredAt);
}

async function completeExpiredSession(
  expiredSession,
  dependencies,
  synchronizationOptions,
) {
  if (synchronizedExpiryMatches(expiredSession, expiredSession)) return expiredSession;
  await synchronizeExpiredSession(
    dependencies,
    expiredSession,
    synchronizationOptions,
  );
  let synchronized;
  try {
    synchronized = await dependencies.sessionStore.markExpirySynced(expiredSession.rowId);
  } catch {
    synchronized = await bestEffort(
      () => dependencies.sessionStore.readByRowId(expiredSession.rowId),
    );
  }
  if (!synchronizedExpiryMatches(expiredSession, synchronized)) {
    throw new ControllerError("Expired setup state did not finalize", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  return synchronized;
}

async function expireSession(candidate, tokenHash, dependencies) {
  if (synchronizedExpiryMatches(candidate, candidate)) return candidate;
  let expiredSession;
  if (pendingExpiryMatches(candidate, candidate)) {
    expiredSession = candidate;
  } else {
    try {
      const result = await dependencies.sessionStore.verify(tokenHash);
      if (synchronizedExpiryMatches(candidate, result?.session)) return result.session;
      if (result?.outcome !== "expired" || !pendingExpiryMatches(candidate, result.session)) {
        throw genericSetupNotFound();
      }
      expiredSession = result.session;
    } catch (error) {
      // A simultaneous request may have completed either expiry phase.
      // Accept only an exact durable readback; the write error is not proof.
      let readback = null;
      try {
        readback = await dependencies.sessionStore.readByTokenHash(tokenHash);
      } catch {
        // Preserve the original dependency failure below.
      }
      if (synchronizedExpiryMatches(candidate, readback)) return readback;
      if (!pendingExpiryMatches(candidate, readback)) throw publicError(error);
      expiredSession = readback;
    }
  }
  return completeExpiredSession(
    expiredSession,
    dependencies,
    expiredSession.lastOutcome === "issuing_expiry_pending"
      ? { allowInitialIssuingState: true }
      : undefined,
  );
}

async function readPrefillSession(setupToken, dependencies, nowMs) {
  let tokenHash;
  try {
    tokenHash = hashAccessToken(setupToken, dependencies.config.tokenPepper);
  } catch {
    throw genericSetupNotFound();
  }
  let session;
  try {
    session = await dependencies.sessionStore.readByTokenHash(tokenHash);
  } catch (error) {
    throw publicError(error);
  }
  const expiresAt = Date.parse(session?.expiresAt);
  if (
    session?.status === "expired" &&
    Number.isFinite(expiresAt) &&
    hasValue(session.expiredAt)
  ) {
    if (new Set(["crm_expiry_pending", "issuing_expiry_pending"]).has(
      session.lastOutcome,
    )) {
      await expireSession(session, tokenHash, dependencies);
    }
    throw genericSetupNotFound();
  }
  if (
    !session ||
    !new Set(["issued", "verified"]).has(session.status) ||
    !Number.isFinite(expiresAt)
  ) {
    throw genericSetupNotFound();
  }
  if (expiresAt <= nowMs) {
    await expireSession(session, tokenHash, dependencies);
    throw genericSetupNotFound();
  }
  if (session.status === "verified" && !hasValue(session.verifiedAt)) {
    throw genericSetupNotFound();
  }
  return Object.freeze({ session, tokenHash });
}

async function verifyPrefillSession(candidate, tokenHash, dependencies, nowMs) {
  let result;
  try {
    result = await dependencies.sessionStore.verify(tokenHash);
  } catch (error) {
    // A simultaneous request may have won the same conditional transition.
    // Accept only an exact, live durable winner; never infer success from the
    // write error itself.
    let readback = null;
    try {
      readback = await dependencies.sessionStore.readByTokenHash(tokenHash);
    } catch {
      // Preserve the original failure classification below.
    }
    if (
      sameSessionIdentity(candidate, readback) &&
      sessionAttemptAdvanced(candidate, readback) &&
      readback.status === "verified" &&
      hasValue(readback.verifiedAt) &&
      Number.isFinite(Date.parse(readback.expiresAt)) &&
      Date.parse(readback.expiresAt) > nowMs
    ) {
      return readback;
    }
    throw publicError(error);
  }
  if (
    result?.outcome !== "verified" ||
    !sameSessionIdentity(candidate, result.session) ||
    !sessionAttemptAdvanced(candidate, result.session) ||
    !hasValue(result.session.verifiedAt)
  ) {
    throw genericSetupNotFound();
  }
  return result.session;
}

async function resolveSubmissionSession(setupToken, dependencies, nowMs) {
  let tokenHash;
  try {
    tokenHash = hashAccessToken(setupToken, dependencies.config.tokenPepper);
  } catch {
    throw genericSetupNotFound();
  }
  let session;
  try {
    session = await dependencies.sessionStore.readByTokenHash(tokenHash);
  } catch (error) {
    throw publicError(error);
  }
  const expiresAt = Date.parse(session?.expiresAt);
  if (
    session?.status === "expired" &&
    Number.isFinite(expiresAt) &&
    hasValue(session.expiredAt)
  ) {
    if (new Set(["crm_expiry_pending", "issuing_expiry_pending"]).has(
      session.lastOutcome,
    )) {
      await expireSession(session, tokenHash, dependencies);
    }
    throw genericSetupNotFound();
  }
  if (
    !session ||
    !new Set(["verified", "submitting", "submitted"]).has(session.status) ||
    !Number.isFinite(expiresAt) ||
    !hasValue(session.verifiedAt) ||
    (session.status === "submitting" &&
      !/^submitting_[a-f0-9]{64}$/.test(session.lastOutcome)) ||
    (session.status === "submitted" && !hasValue(session.submittedAt))
  ) {
    throw genericSetupNotFound();
  }
  return Object.freeze({
    expired: session.status === "verified" && expiresAt <= nowMs,
    session,
    tokenHash,
  });
}

async function bestEffort(operation) {
  try {
    return await operation();
  } catch {
    return null;
  }
}

async function markSessionReconciliation(sessionStore, session, outcome) {
  if (!session?.rowId) return null;
  return bestEffort(() => sessionStore.markReconciliationRequired(session.rowId, outcome));
}

function dealMatchesSessionBinding(deal, session) {
  return Boolean(deal && session) &&
    deal.id === session.crmDealId &&
    deal.Account_Name?.id === session.crmAccountId &&
    deal.Contact_Name?.id === session.crmContactId;
}

function dealRemainsSetupEligible(deal, config) {
  return deal.Entry_Offer === config.form2EntryOfferValue &&
    hasValue(deal.Approved_Test_Route) &&
    !hasValue(deal.Setup_Form_Submission_ID) &&
    !hasValue(deal.Setup_Form_Submitted_At);
}

function dealMatchesInitialSession(deal, session, config) {
  return dealMatchesSessionBinding(deal, session) &&
    dealRemainsSetupEligible(deal, config) &&
    deal.Setup_Access_Status === config.form2AccessStatuses.initial &&
    !hasValue(deal.Setup_Access_Issued_At) &&
    !hasValue(deal.Setup_Access_Verified_At);
}

function dealMatchesIssuedSession(deal, session, config) {
  return dealMatchesSessionBinding(deal, session) &&
    dealRemainsSetupEligible(deal, config) &&
    deal.Setup_Access_Status === config.form2AccessStatuses.issued &&
    sameCrmInstant(deal.Setup_Access_Issued_At, session.issuedAt) &&
    !hasValue(deal.Setup_Access_Verified_At);
}

function dealMatchesVerifiedSession(deal, session, config) {
  return dealMatchesSessionBinding(deal, session) &&
    dealRemainsSetupEligible(deal, config) &&
    deal.Setup_Access_Status === config.form2AccessStatuses.verified &&
    sameCrmInstant(deal.Setup_Access_Issued_At, session.issuedAt) &&
    sameCrmInstant(deal.Setup_Access_Verified_At, session.verifiedAt);
}

function dealMatchesExpiredSession(deal, session, config) {
  const wasVerified = hasValue(session.verifiedAt);
  return dealMatchesSessionBinding(deal, session) &&
    dealRemainsSetupEligible(deal, config) &&
    hasValue(session.expiredAt) &&
    deal.Setup_Access_Status === config.form2AccessStatuses.expired &&
    sameCrmInstant(deal.Setup_Access_Issued_At, session.issuedAt) &&
    (wasVerified
      ? sameCrmInstant(deal.Setup_Access_Verified_At, session.verifiedAt)
      : !hasValue(deal.Setup_Access_Verified_At));
}

async function readActiveDealSession(dependencies, dealId) {
  try {
    return await dependencies.sessionStore.readActiveByCrmDealId(dealId);
  } catch (error) {
    throw publicError(error);
  }
}

function assertActiveDealSession(active, session) {
  if (!sameSessionIdentity(active, session)) {
    throw new ControllerError("Deal issuance ownership is not unique", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
}

function requireNewIssueLock(existing, active, config) {
  const statuses = config.form2AccessStatuses;
  if (active) {
    throw new ControllerError("A Deal issuance lock already exists", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }
  const initialWithoutPriorIssuance =
    existing.deal.Setup_Access_Status === statuses.initial &&
    !hasValue(existing.deal.Setup_Access_Issued_At) &&
    !hasValue(existing.deal.Setup_Access_Verified_At);
  if (initialWithoutPriorIssuance) {
    return;
  }

  const issuedAt = Date.parse(existing.deal.Setup_Access_Issued_At);
  const verifiedAt = hasValue(existing.deal.Setup_Access_Verified_At)
    ? Date.parse(existing.deal.Setup_Access_Verified_At)
    : null;
  if (
    existing.deal.Setup_Access_Status !== statuses.expired ||
    !Number.isFinite(issuedAt) ||
    (verifiedAt !== null && !Number.isFinite(verifiedAt))
  ) {
    throw new ControllerError("Expired setup history is not eligible for reissue", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }
}

async function synchronizeExpiredSession(
  dependencies,
  session,
  { allowInitialIssuingState = false } = {},
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let deal;
    try {
      deal = await dependencies.crmClient.getRecord("Deals", session.crmDealId);
    } catch {
      break;
    }
    if (dealMatchesExpiredSession(deal, session, dependencies.config)) return deal;

    const initialIssuingState = allowInitialIssuingState &&
      dealMatchesInitialSession(deal, session, dependencies.config);
    const expectedCurrentState = initialIssuingState || (hasValue(session.verifiedAt)
      ? dealMatchesVerifiedSession(deal, session, dependencies.config)
      : dealMatchesIssuedSession(deal, session, dependencies.config));
    if (!expectedCurrentState) break;

    const update = {
      Setup_Access_Status: dependencies.config.form2AccessStatuses.expired,
    };
    if (initialIssuingState) {
      // This write fences a delayed Issue writer through Modified_Time while
      // recording which never-returned generation was abandoned.
      update.Setup_Access_Issued_At = session.issuedAt;
      update.Setup_Access_Verified_At = null;
    }
    try {
      const readback = await dependencies.crmClient.updateRecord(
        "Deals",
        session.crmDealId,
        update,
        { ifUnmodifiedSince: deal.Modified_Time },
      );
      if (dealMatchesExpiredSession(readback, session, dependencies.config)) {
        return readback;
      }
    } catch {
      // Reread once. A delayed Issue writer may have won the first CRM race;
      // exact Issued state can still be expired while the active lock remains.
    }
  }

  try {
    const observed = await dependencies.crmClient.getRecord("Deals", session.crmDealId);
    if (dealMatchesExpiredSession(observed, session, dependencies.config)) {
      return observed;
    }
  } catch {
    // Only an exact independent readback can recover an ambiguous expiry.
  }
  await bestEffort(() => dependencies.sessionStore.markExpiryReconciliationRequired(
    session.rowId,
    "crm_expiry_outcome_unknown",
  ));
  throw new ControllerError("Expired setup state requires reconciliation", {
    status: 503,
    publicCode: "service_unavailable",
    ambiguous: true,
  });
}

async function readIssueSessionState(dependencies, session) {
  try {
    const [readback, deal, active] = await Promise.all([
      dependencies.sessionStore.readByRowId(session.rowId),
      dependencies.crmClient.getRecord("Deals", session.crmDealId),
      dependencies.sessionStore.readActiveByCrmDealId(session.crmDealId),
    ]);
    if (!sameSessionIdentity(session, readback)) return null;
    assertActiveDealSession(active, readback);
    if (
      (readback.status === "issued" &&
        dealMatchesIssuedSession(deal, readback, dependencies.config)) ||
      (readback.status === "verified" &&
        dealMatchesVerifiedSession(deal, readback, dependencies.config))
    ) {
      return Object.freeze({ outcome: "converged", session: readback });
    }
    // Verification necessarily advances the durable session before updating
    // the Deal. An overlapping issue retry may observe that exact intermediate
    // state; it is retryable, not evidence that the shared token is corrupt.
    if (
      readback.status === "verified" &&
      dealMatchesIssuedSession(deal, readback, dependencies.config)
    ) {
      return Object.freeze({ outcome: "verification_in_flight", session: readback });
    }
    if (
      readback.status === "issuing" &&
      dealMatchesIssuedSession(deal, readback, dependencies.config)
    ) {
      return Object.freeze({ outcome: "finalization_pending", session: readback });
    }
  } catch {
    // A failed or non-exact readback never proves convergence.
  }
  return null;
}

function issuedSessionMatches(candidate, readback) {
  return sameSessionIdentity(candidate, readback) &&
    readback.status === "issued" &&
    readback.attemptCount === candidate.attemptCount &&
    readback.maxAttempts === candidate.maxAttempts &&
    sameInstant(readback.issuedAt, candidate.issuedAt) &&
    sameInstant(readback.expiresAt, candidate.expiresAt);
}

async function finalizeIssuedSession(session, dependencies) {
  const active = await readActiveDealSession(dependencies, session.crmDealId);
  assertActiveDealSession(active, session);
  let readback = null;
  try {
    readback = await dependencies.sessionStore.markIssued(session.rowId);
  } catch {
    readback = await bestEffort(
      () => dependencies.sessionStore.readByRowId(session.rowId),
    );
  }
  if (issuedSessionMatches(session, readback)) return readback;
  if (
    sameSessionIdentity(session, readback) &&
    readback.status === "verified" &&
    hasValue(readback.verifiedAt)
  ) {
    throw new ControllerError("Setup verification is still in progress", {
      status: 503,
      publicCode: "service_unavailable",
    });
  }
  await markSessionReconciliation(
    dependencies.sessionStore,
    session,
    "setup_access_issue_finalize_unknown",
  );
  throw new ControllerError("Setup issuance requires reconciliation", {
    status: 503,
    publicCode: "service_unavailable",
    ambiguous: true,
  });
}

async function expireStaleIssuingSession(session, existing, dependencies) {
  if (dealMatchesIssuedSession(existing.deal, session, dependencies.config)) {
    try {
      const issued = await finalizeIssuedSession(session, dependencies);
      return await expireSession(issued, issued.tokenHash, dependencies);
    } catch (error) {
      const readback = await bestEffort(
        () => dependencies.sessionStore.readByRowId(session.rowId),
      );
      if (synchronizedExpiryMatches(session, readback)) return readback;
      if (pendingExpiryMatches(session, readback)) {
        return completeExpiredSession(readback, dependencies, {
          allowInitialIssuingState: true,
        });
      }
      throw error;
    }
  }

  if (!dealMatchesInitialSession(existing.deal, session, dependencies.config)) {
    await markSessionReconciliation(
      dependencies.sessionStore,
      session,
      "stale_issuing_crm_mismatch",
    );
    throw new ControllerError("Stale issuing state requires reconciliation", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }

  let expiring;
  try {
    expiring = await dependencies.sessionStore.markIssuingExpiryPending(session.rowId);
  } catch (error) {
    const readback = await bestEffort(
      () => dependencies.sessionStore.readByRowId(session.rowId),
    );
    if (synchronizedExpiryMatches(session, readback)) return readback;
    if (pendingExpiryMatches(session, readback)) {
      expiring = readback;
    } else if (
      sameSessionIdentity(session, readback) &&
      readback.status === "issued"
    ) {
      return expireSession(readback, readback.tokenHash, dependencies);
    } else {
      await markSessionReconciliation(
        dependencies.sessionStore,
        session,
        "stale_issuing_expiry_phase_unknown",
      );
      throw publicError(error);
    }
  }
  if (synchronizedExpiryMatches(session, expiring)) return expiring;
  if (!pendingExpiryMatches(session, expiring)) {
    throw new ControllerError("Stale issuing expiry phase did not converge", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  return completeExpiredSession(expiring, dependencies, {
    allowInitialIssuingState: true,
  });
}

async function recoverElapsedActiveSession(active, existing, dependencies, nowMs) {
  if (!active) return null;
  if (
    active.status === "expired" &&
    new Set(["crm_expiry_pending", "issuing_expiry_pending"]).has(active.lastOutcome)
  ) {
    return expireSession(active, active.tokenHash, dependencies);
  }
  if (Date.parse(active.expiresAt) > nowMs) return null;
  if (new Set(["issued", "verified"]).has(active.status)) {
    return expireSession(active, active.tokenHash, dependencies);
  }
  if (active.status === "issuing") {
    return expireStaleIssuingSession(active, existing, dependencies);
  }
  return null;
}

async function verifiedDealConverged(dependencies, session) {
  try {
    const deal = await dependencies.crmClient.getRecord("Deals", session.crmDealId);
    return dealMatchesVerifiedSession(deal, session, dependencies.config);
  } catch {
    return false;
  }
}

async function handleIssue(body, dependencies, nowMs) {
  assertExactKeys(body, ISSUE_REQUEST_KEYS, "Issue request is invalid");
  const dealId = normalizeRecordId(body.dealId, "Deal identifier");
  let setupToken;
  let issueRequestKey;
  let tokenHash;
  try {
    issueRequestKey = deriveIssueRequestKey(body.issueRequestId);
    setupToken = deriveAccessToken(body.issueRequestId, dependencies.config.tokenPepper);
    tokenHash = hashAccessToken(setupToken, dependencies.config.tokenPepper);
  } catch (error) {
    throw publicError(error);
  }

  let priorSession;
  try {
    priorSession = await dependencies.sessionStore.readByIssueRequestKey(issueRequestKey);
  } catch (error) {
    throw publicError(error);
  }
  if (priorSession && priorSession.tokenHash !== tokenHash) {
    throw new ControllerError("A fresh issuance identity is required", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }

  const initialDeal = await dependencies.crmClient.getRecord("Deals", dealId);
  const binding = {
    crmContactId: lookupId(initialDeal, "Contact_Name"),
    crmAccountId: lookupId(initialDeal, "Account_Name"),
    crmDealId: dealId,
  };
  let existing = await fetchSessionContext(dependencies.crmClient, binding);
  let activeSession = await readActiveDealSession(dependencies, dealId);
  const statuses = dependencies.config.form2AccessStatuses;
  const expiredGeneration = await recoverElapsedActiveSession(
    activeSession,
    existing,
    dependencies,
    nowMs,
  );
  if (expiredGeneration) {
    if (!synchronizedExpiryMatches(activeSession, expiredGeneration)) {
      throw new ControllerError("Expired Deal issuance lock did not converge", {
        status: 503,
        publicCode: "service_unavailable",
        ambiguous: true,
      });
    }
    // The immutable UUID belongs to the tombstoned generation. Recovery may
    // release the Deal lock, but that UUID can never mint the old token again.
    if (priorSession) {
      throw new ControllerError("A fresh issuance identity is required", {
        status: 409,
        publicCode: "setup_conflict",
      });
    }
    existing = await fetchSessionContext(dependencies.crmClient, binding);
    activeSession = await readActiveDealSession(dependencies, dealId);
  }
  if (!priorSession) {
    requireEligibleContext(
      existing,
      dependencies.config,
      new Set([statuses.initial, statuses.expired]),
    );
    requireNewIssueLock(existing, activeSession, dependencies.config);
  } else {
    requireEligibleContext(
      existing,
      dependencies.config,
      new Set([statuses.initial, statuses.issued, statuses.verified, statuses.expired]),
    );
    assertActiveDealSession(activeSession, priorSession);
  }
  // Validate every prefilled value that cannot be repaired by the respondent,
  // especially the locked Email and Mobile identity, before creating durable
  // session state or changing the Deal.
  buildPrefillPayload(existing, {
    allowedPhoneSystemProviders: dependencies.config.form2PhoneSystemProviders,
  });

  let session;
  try {
    session = await dependencies.sessionStore.issue({
      issueRequestKey,
      tokenHash,
      ...binding,
    });
  } catch (error) {
    throw publicError(error);
  }
  const issuedActiveSession = await readActiveDealSession(dependencies, dealId);
  assertActiveDealSession(issuedActiveSession, session);
  const issuedUpdate = {
    Setup_Access_Status: statuses.issued,
    Setup_Access_Issued_At: session.issuedAt,
    Setup_Access_Verified_At: null,
  };
  const issuedStateMatches =
    existing.deal.Setup_Access_Status === statuses.issued &&
    sameCrmInstant(existing.deal.Setup_Access_Issued_At, session.issuedAt) &&
    !hasValue(existing.deal.Setup_Access_Verified_At);
  const initialStateMatches =
    existing.deal.Setup_Access_Status === statuses.initial &&
    !hasValue(existing.deal.Setup_Access_Issued_At) &&
    !hasValue(existing.deal.Setup_Access_Verified_At);
  const expiredStateMatches = existing.deal.Setup_Access_Status === statuses.expired;
  const verifiedStateMatches =
    session.status === "verified" &&
    existing.deal.Setup_Access_Status === statuses.verified &&
    sameCrmInstant(existing.deal.Setup_Access_Issued_At, session.issuedAt) &&
    sameCrmInstant(existing.deal.Setup_Access_Verified_At, session.verifiedAt);

  if (session.status === "issuing" && (initialStateMatches || expiredStateMatches)) {
    try {
      await dependencies.crmClient.updateRecord("Deals", dealId, issuedUpdate, {
        ifUnmodifiedSince: existing.deal.Modified_Time,
      });
      session = await finalizeIssuedSession(session, dependencies);
    } catch {
      const observed = await readIssueSessionState(dependencies, session);
      if (observed?.outcome === "converged") {
        session = observed.session;
      } else if (observed?.outcome === "finalization_pending") {
        session = await finalizeIssuedSession(observed.session, dependencies);
      } else if (observed?.outcome === "verification_in_flight") {
        throw new ControllerError("Setup verification is still in progress", {
          status: 503,
          publicCode: "service_unavailable",
        });
      } else {
        await markSessionReconciliation(
          dependencies.sessionStore,
          session,
          "setup_access_issue_write_unknown",
        );
        throw new ControllerError("Setup issuance requires reconciliation", {
          status: 503,
          publicCode: "service_unavailable",
          ambiguous: true,
        });
      }
    }
  } else if (
    (session.status === "issuing") ||
    (session.status === "issued" && !issuedStateMatches) ||
    (session.status === "verified" && !verifiedStateMatches)
  ) {
    const observed = await readIssueSessionState(dependencies, session);
    if (observed?.outcome === "converged") {
      session = observed.session;
    } else if (observed?.outcome === "finalization_pending") {
      session = await finalizeIssuedSession(observed.session, dependencies);
    } else if (observed?.outcome === "verification_in_flight") {
      throw new ControllerError("Setup verification is still in progress", {
        status: 503,
        publicCode: "service_unavailable",
      });
    } else {
      await markSessionReconciliation(
        dependencies.sessionStore,
        session,
        "setup_access_issue_state_mismatch",
      );
      throw new ControllerError("Setup issuance requires reconciliation", {
        status: 503,
        publicCode: "service_unavailable",
        ambiguous: true,
      });
    }
  }
  return response(
    200,
    {
      ok: true,
      accessUrl: buildAccessUrl(dependencies.config, setupToken),
      expiresAt: session.expiresAt,
    },
    "issue",
    "issued",
  );
}

async function handlePrefill(body, dependencies, nowMs) {
  assertExactKeys(body, PREFILL_KEYS, "Prefill request is invalid");
  const candidate = await readPrefillSession(body.setupToken, dependencies, nowMs);
  let existing = await fetchSessionContext(dependencies.crmClient, candidate.session);
  const statuses = dependencies.config.form2AccessStatuses;
  requireEligibleContext(
    existing,
    dependencies.config,
    new Set([statuses.issued, statuses.verified]),
  );
  // Fail deterministic CRM/Form contract defects before consuming the
  // one-time email proof or changing durable session state.
  buildPrefillPayload(existing, {
    allowedPhoneSystemProviders: dependencies.config.form2PhoneSystemProviders,
  });
  const proofBinding = {
    sessionRowId: candidate.session.rowId,
    issueRequestKey: candidate.session.issueRequestKey,
    tokenHash: candidate.tokenHash,
    crmContactId: candidate.session.crmContactId,
    crmAccountId: candidate.session.crmAccountId,
    crmDealId: candidate.session.crmDealId,
    issuedAt: candidate.session.issuedAt,
    expiresAt: candidate.session.expiresAt,
  };
  await requireEmailOtpVerified(
    dependencies.verificationService,
    proofBinding,
    existing.contact.Email,
    nowMs,
  );
  const session = await verifyPrefillSession(
    candidate.session,
    candidate.tokenHash,
    dependencies,
    nowMs,
  );

  const verifiedUpdate = {
    Setup_Access_Status: statuses.verified,
    Setup_Access_Verified_At: session.verifiedAt,
  };
  const verifiedStateMatches =
    existing.deal.Setup_Access_Status === statuses.verified &&
    sameCrmInstant(existing.deal.Setup_Access_Verified_At, session.verifiedAt);
  if (existing.deal.Setup_Access_Status === statuses.issued) {
    try {
      await dependencies.crmClient.updateRecord("Deals", session.crmDealId, verifiedUpdate, {
        ifUnmodifiedSince: existing.deal.Modified_Time,
      });
    } catch {
      if (!await verifiedDealConverged(dependencies, session)) {
        await markSessionReconciliation(
          dependencies.sessionStore,
          session,
          "setup_access_verify_write_unknown",
        );
        throw new ControllerError("Setup verification requires reconciliation", {
          status: 503,
          publicCode: "service_unavailable",
          ambiguous: true,
        });
      }
    }
  } else if (!verifiedStateMatches) {
    if (!await verifiedDealConverged(dependencies, session)) {
      await markSessionReconciliation(
        dependencies.sessionStore,
        session,
        "setup_access_verify_state_mismatch",
      );
      throw new ControllerError("Setup verification requires reconciliation", {
        status: 503,
        publicCode: "service_unavailable",
        ambiguous: true,
      });
    }
  }

  existing = await fetchSessionContext(dependencies.crmClient, session);
  requireEligibleContext(existing, dependencies.config, new Set([statuses.verified]));
  try {
    // CRM may have changed after proof consumption and the verified-state
    // write. Re-read and rebind the consumed proof before minting any prefill.
    await requireEmailOtpVerified(
      dependencies.verificationService,
      proofBinding,
      existing.contact.Email,
      nowMs,
    );
  } catch {
    await markSessionReconciliation(
      dependencies.sessionStore,
      session,
      "proof_destination_changed_after_consumption",
    );
    throw new ControllerError("Verified email destination changed", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  const prefill = buildPrefillPayload(existing, {
    allowedPhoneSystemProviders: dependencies.config.form2PhoneSystemProviders,
  });
  const snapshotFingerprint = fingerprintSnapshot(prefill, dependencies.config.tokenPepper);
  const minted = await dependencies.workflowStore.mintPrefill(
    prefillBinding(session, existing, snapshotFingerprint),
  );
  return response(200, { ...prefill, prefillId: minted.prefillId }, "prefill", "prepared");
}

function handleAccessPage(dependencies) {
  const rendered = renderAccessPage({
    otpRequestPath: dependencies.config.otpRequestPath,
    otpVerifyPath: dependencies.config.otpVerifyPath,
    randomBytes: dependencies.randomBytes,
  });
  return response(200, rendered.html, "access", "served", rendered.headers);
}

async function handleOtpRequest(body, dependencies) {
  assertExactKeys(body, OTP_REQUEST_KEYS, "Verification request is invalid");
  const result = await dependencies.verificationService.requestEmailOtp(body.setupToken);
  if (!new Set([
    "already_verified",
    "sent_confirmed",
    "in_flight",
    "retryable_failure",
    "delivery_disabled",
    "terminal_failure",
  ]).has(result?.state)) {
    throw new ControllerError("Verification request did not converge", {
      publicCode: "service_unavailable",
    });
  }
  if (result.state === "already_verified") {
    return response(
      200,
      { ok: true, state: result.state, formUrl: buildFormUrl(dependencies.config, body.setupToken) },
      "otp_request",
      "already_verified",
    );
  }
  if (new Set(["sent_confirmed", "in_flight"]).has(result.state)) {
    return response(
      202,
      { ok: true, state: result.state },
      "otp_request",
      result.state,
    );
  }
  return response(
    503,
    { ok: false, state: result.state },
    "otp_request",
    result.state,
  );
}

async function handleOtpVerify(body, dependencies) {
  assertExactKeys(body, OTP_VERIFY_KEYS, "Verification request is invalid");
  const result = await dependencies.verificationService.verifyEmailOtp(
    body.setupToken,
    body.code,
  );
  if (result?.verified !== true) {
    throw new ControllerError("Verification did not converge", {
      publicCode: "service_unavailable",
    });
  }
  return response(
    200,
    { ok: true, formUrl: buildFormUrl(dependencies.config, body.setupToken) },
    "otp_verify",
    "verified",
  );
}

function sessionOwnsSubmission(session, submissionFingerprint) {
  return session.status !== "submitting" ||
    session.lastOutcome === `submitting_${submissionFingerprint}`;
}

async function terminalizeSubmissionState(session, outcome, dependencies) {
  let readback = null;
  try {
    readback = session.status === "submitted"
      ? await dependencies.sessionStore.markSubmittedReconciliationRequired(
        session.rowId,
        outcome,
      )
      : await dependencies.sessionStore.markReconciliationRequired(session.rowId, outcome);
  } catch {
    readback = await bestEffort(() => dependencies.sessionStore.readByRowId(session.rowId));
  }
  if (
    !sameSessionIdentity(session, readback) ||
    readback.status !== "reconciliation_required" ||
    readback.lastOutcome !== outcome
  ) {
    throw new ControllerError("Completed submission mismatch was not durably terminalized", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
}

async function terminalizeSucceededReceiptMismatch(session, dependencies) {
  return terminalizeSubmissionState(
    session,
    "succeeded_receipt_crm_mismatch",
    dependencies,
  );
}

async function verifySucceededDuplicate(
  session,
  namespacedSubmissionId,
  submissionFingerprint,
  dependencies,
) {
  if (!sessionOwnsSubmission(session, submissionFingerprint)) {
    throw new ControllerError("Submission ownership does not match", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }
  if (session.status === "submitted" && !submittedSessionMatches(session, session)) {
    await terminalizeSubmissionState(
      session,
      "submitted_session_state_invalid",
      dependencies,
    );
    throw new ControllerError("Completed submission session state is invalid", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  let deal;
  try {
    deal = await dependencies.crmClient.getRecord("Deals", session.crmDealId);
  } catch {
    // A read outage is not affirmative evidence of CRM drift. Preserve the
    // exact session owner so a later retry can perform the required readback.
    throw new ControllerError("Completed submission readback is unavailable", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  if (
    !dealMatchesSessionBinding(deal, session) ||
    deal.Setup_Form_Submission_ID !== namespacedSubmissionId ||
    deal.Setup_Access_Status !== dependencies.config.form2AccessStatuses.submitted ||
    !hasValue(deal.Setup_Form_Submitted_At) ||
    !Number.isFinite(Date.parse(deal.Setup_Form_Submitted_At))
  ) {
    await terminalizeSucceededReceiptMismatch(session, dependencies);
    throw new ControllerError("Completed submission readback does not match", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  if (new Set(["verified", "submitting"]).has(session.status)) {
    await repairSubmittedSession(session, submissionFingerprint, dependencies);
  }
  return response(
    200,
    { ok: true, accepted: true, duplicate: true },
    "submission",
    "duplicate_succeeded",
  );
}

function submittedSessionMatches(candidate, readback) {
  return sameSessionIdentity(candidate, readback) &&
    readback.status === "submitted" &&
    readback.lastOutcome === "submitted" &&
    hasValue(readback.submittedAt) &&
    readback.attemptCount === candidate.attemptCount &&
    readback.maxAttempts === candidate.maxAttempts &&
    sameInstant(readback.issuedAt, candidate.issuedAt) &&
    sameInstant(readback.expiresAt, candidate.expiresAt) &&
    sameInstant(readback.verifiedAt, candidate.verifiedAt);
}

async function repairSubmittedSession(session, submissionFingerprint, dependencies) {
  let readback = null;
  try {
    readback = await dependencies.sessionStore.markSubmitted(
      session.rowId,
      submissionFingerprint,
    );
  } catch {
    try {
      readback = await dependencies.sessionStore.readByRowId(session.rowId);
    } catch {
      // The succeeded receipt and CRM readback remain authoritative, but a
      // missing session repair must be reconciled before acknowledging.
    }
  }
  if (submittedSessionMatches(session, readback)) return readback;

  if (
    !readback ||
    (sameSessionIdentity(session, readback) &&
      (readback.status === "verified" ||
        (readback.status === "submitting" &&
          readback.lastOutcome === `submitting_${submissionFingerprint}`)))
  ) {
    throw new ControllerError("Completed submission session repair is pending", {
      status: 503,
      publicCode: "service_unavailable",
    });
  }

  await markSessionReconciliation(
    dependencies.sessionStore,
    session,
    "submission_session_repair_unknown",
  );
  throw new ControllerError("Completed submission session repair did not converge", {
    status: 503,
    publicCode: "service_unavailable",
    ambiguous: true,
  });
}

function submissionFormPayload(body) {
  return Object.fromEntries(CLIENT_KEYS.map((key) => [key, body[key]]));
}

function failedSubmissionReceiptMatches(candidate, readback, expectedOutcome) {
  return Boolean(candidate && readback) &&
    String(readback.rowId) === String(candidate.rowId) &&
    readback.submissionKey === candidate.submissionKey &&
    readback.prefillKey === candidate.prefillKey &&
    readback.leaseOwner === candidate.leaseOwner &&
    readback.leaseExpiresAt === candidate.leaseExpiresAt &&
    readback.claimedAt === candidate.claimedAt &&
    readback.sessionRowId === candidate.sessionRowId &&
    readback.submissionFingerprint === candidate.submissionFingerprint &&
    readback.attemptCount === candidate.attemptCount &&
    readback.status === "failed" &&
    readback.lastOutcome === expectedOutcome &&
    hasValue(readback.failedAt) &&
    Number.isFinite(Date.parse(readback.failedAt)) &&
    readback.updatedAt === readback.failedAt &&
    !hasValue(readback.succeededAt) &&
    !hasValue(readback.reconciliationRequiredAt);
}

async function finalizeFailedSubmissionReceipt(
  dependencies,
  { claimReceipt, receiptReference, submissionBinding, failedOutcome },
) {
  let readback = null;
  try {
    readback = await dependencies.workflowStore.markSubmissionFailed(
      receiptReference,
      failedOutcome,
    );
  } catch {
    // A lost transition response is recovered only by an exact binding read.
  }
  if (failedSubmissionReceiptMatches(claimReceipt, readback, failedOutcome)) {
    return Object.freeze({ outcome: "failed", receipt: readback });
  }
  try {
    readback = await dependencies.workflowStore.readSubmission(submissionBinding);
  } catch {
    return Object.freeze({ outcome: "unresolved", receipt: null });
  }
  if (readback?.status === "succeeded") {
    return Object.freeze({ outcome: "succeeded", receipt: readback });
  }
  return failedSubmissionReceiptMatches(claimReceipt, readback, failedOutcome)
    ? Object.freeze({ outcome: "failed", receipt: readback })
    : Object.freeze({ outcome: "unresolved", receipt: readback });
}

async function reconcileSubmission(
  dependencies,
  { receiptReference, consumedPrefill, session },
) {
  await bestEffort(() => dependencies.workflowStore.markSubmissionReconciliationRequired(
    receiptReference,
    "crm_outcome_unknown",
  ));
  if (consumedPrefill) {
    await bestEffort(() => dependencies.workflowStore.markPrefillReconciliationRequired(
      {
        rowId: consumedPrefill.rowId,
        consumptionOwner: consumedPrefill.consumptionOwner,
      },
      "crm_outcome_unknown",
    ));
  }
  await markSessionReconciliation(
    dependencies.sessionStore,
    session,
    "submission_outcome_unknown",
  );
}

async function beginSubmissionOwnership(session, submissionFingerprint, dependencies) {
  let readback;
  try {
    readback = await dependencies.sessionStore.beginSubmission(
      session.rowId,
      submissionFingerprint,
    );
  } catch (error) {
    throw publicError(error);
  }
  if (
    !sameSessionIdentity(session, readback) ||
    readback.status !== "submitting" ||
    readback.lastOutcome !== `submitting_${submissionFingerprint}`
  ) {
    throw new ControllerError("Submission ownership did not converge", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  return readback;
}

async function releaseSubmissionOwnership(session, submissionFingerprint, dependencies) {
  let readback;
  try {
    readback = await dependencies.sessionStore.releaseSubmission(
      session.rowId,
      submissionFingerprint,
    );
  } catch (error) {
    throw publicError(error);
  }
  if (
    !sameSessionIdentity(session, readback) ||
    readback.status !== "verified" ||
    readback.lastOutcome !== "submission_released"
  ) {
    throw new ControllerError("Submission ownership release did not converge", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  return readback;
}

async function handleSubmission(body, dependencies, nowMs) {
  assertExactKeys(body, SUBMISSION_KEYS, "Submission request is invalid");
  const formPayload = submissionFormPayload(body);
  validateForm2PayloadTypes(formPayload);
  const namespacedSubmissionId = namespaceSubmissionId(
    dependencies.config,
    body.submissionId,
  );
  const resolvedSession = await resolveSubmissionSession(
    body.setupToken,
    dependencies,
    nowMs,
  );
  const { expired, tokenHash } = resolvedSession;
  let session = resolvedSession.session;
  const submissionFingerprint = fingerprintSubmission({
    submissionId: namespacedSubmissionId,
    prefillId: body.prefillId,
    values: formPayload,
  }, dependencies.config.tokenPepper);
  const submissionBinding = {
    submissionId: namespacedSubmissionId,
    prefillId: body.prefillId,
    sessionRowId: session.rowId,
    submissionFingerprint,
  };

  let existingReceipt;
  try {
    existingReceipt = await dependencies.workflowStore.readSubmission(submissionBinding);
  } catch (error) {
    if (
      expired &&
      session.status === "verified" &&
      error?.publicCode === "submission_conflict"
    ) {
      await expireSession(session, tokenHash, dependencies);
      throw genericSetupNotFound();
    }
    throw publicError(error);
  }

  if (session.status === "submitted") {
    if (!existingReceipt || existingReceipt.status !== "succeeded") {
      throw new ControllerError("Submitted session does not match a completed receipt", {
        status: 409,
        publicCode: "setup_conflict",
      });
    }
    return verifySucceededDuplicate(
      session,
      namespacedSubmissionId,
      submissionFingerprint,
      dependencies,
    );
  }

  if (existingReceipt?.status === "succeeded") {
    if (session.status === "verified") {
      session = await beginSubmissionOwnership(session, submissionFingerprint, dependencies);
    }
    return verifySucceededDuplicate(
      session,
      namespacedSubmissionId,
      submissionFingerprint,
      dependencies,
    );
  }

  if (!sessionOwnsSubmission(session, submissionFingerprint)) {
    throw new ControllerError("A different submission owns this setup session", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }

  if (expired) {
    if (existingReceipt && existingReceipt.status !== "failed") {
      await markSessionReconciliation(
        dependencies.sessionStore,
        session,
        "expired_submission_outcome_unknown",
      );
      throw new ControllerError("Expired submission outcome requires reconciliation", {
        status: 503,
        publicCode: "service_unavailable",
        ambiguous: true,
      });
    }
    await expireSession(session, tokenHash, dependencies);
    throw genericSetupNotFound();
  }

  let revision;
  try {
    revision = await dependencies.workflowStore.readPrefill({
      prefillId: body.prefillId,
      sessionRowId: session.rowId,
    });
  } catch (error) {
    throw publicError(error);
  }
  if (!revision) {
    throw new ControllerError("Prefill revision was not found", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }
  assertBindingMatchesSession(revision, session);

  if (session.status === "verified") {
    session = await beginSubmissionOwnership(session, submissionFingerprint, dependencies);
  }

  let claim;
  try {
    claim = await dependencies.workflowStore.claimSubmission(submissionBinding);
  } catch (error) {
    await markSessionReconciliation(
      dependencies.sessionStore,
      session,
      "submission_claim_outcome_unknown",
    );
    throw new ControllerError("Submission claim requires reconciliation", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  if (claim.outcome === "succeeded") {
    return verifySucceededDuplicate(
      session,
      namespacedSubmissionId,
      submissionFingerprint,
      dependencies,
    );
  }
  if (claim.outcome !== "claimed") {
    throw new ControllerError("Submission result is unresolved", {
      status: 409,
      publicCode: "setup_conflict",
    });
  }

  const receiptReference = {
    rowId: claim.receipt.rowId,
    leaseOwner: claim.receipt.leaseOwner,
  };
  let consumedPrefill = null;
  let consumeStarted = false;
  let crmCommitted = false;
  let receiptSucceeded = false;
  try {
    if (!sessionOwnsSubmission(session, submissionFingerprint) || session.status !== "submitting") {
      throw new ControllerError("Setup session is not available for a new submission", {
        status: 409,
        publicCode: "setup_conflict",
      });
    }
    const existing = await fetchSessionContext(dependencies.crmClient, revision);
    requireEligibleContext(
      existing,
      dependencies.config,
      new Set([dependencies.config.form2AccessStatuses.verified]),
    );
    assertFreshPrefill(existing, revision);
    const currentFingerprint = fingerprintSnapshot(
      buildPrefillPayload(existing, {
        allowedPhoneSystemProviders: dependencies.config.form2PhoneSystemProviders,
      }),
      dependencies.config.tokenPepper,
    );
    if (currentFingerprint !== revision.snapshotFingerprint) {
      throw new ControllerError("Prefill snapshot no longer matches", {
        status: 409,
        publicCode: "setup_conflict",
      });
    }

    const updates = validateForm2Payload(formPayload, {
      existing,
      trustedNow: new Date(nowMs).toISOString(),
      setupFormVersion: dependencies.config.form2FormVersion,
      submissionId: namespacedSubmissionId,
      setupAccessSubmittedStatus: dependencies.config.form2AccessStatuses.submitted,
      allowedPhoneSystemProviders: dependencies.config.form2PhoneSystemProviders,
      allowedFieldTeamSizeBands: dependencies.config.form2FieldTeamSizeBands,
    });
    consumeStarted = true;
    consumedPrefill = await dependencies.workflowStore.consumePrefill({
      prefillId: body.prefillId,
      ...prefillBinding(session, existing, currentFingerprint),
    });
    const crmOutcome = await dependencies.crmClient.updateForm2Composite(existing, updates);
    crmCommitted = true;
    await dependencies.workflowStore.markSubmissionSucceeded(receiptReference);
    receiptSucceeded = true;
    await repairSubmittedSession(session, submissionFingerprint, dependencies);
    const duplicate = crmOutcome?.replayed === true;
    return response(
      200,
      { ok: true, accepted: true, duplicate },
      "submission",
      duplicate ? "duplicate_succeeded" : "accepted",
    );
  } catch (error) {
    const normalized = publicError(error);
    if (receiptSucceeded) {
      throw new ControllerError("Completed submission session repair is pending", {
        status: 503,
        publicCode: "service_unavailable",
      });
    }
    const ambiguous = normalized.ambiguous || crmCommitted || error?.publicCode === "reconciliation_required";
    if (ambiguous) {
      await reconcileSubmission(dependencies, {
        receiptReference,
        consumedPrefill,
        session,
      });
      throw new ControllerError("Submission requires reconciliation", {
        status: 503,
        publicCode: "service_unavailable",
        ambiguous: true,
      });
    }
    const failedOutcome = normalized.status === 422
      ? "form_invalid"
      : normalized.status >= 500 && consumedPrefill === null
        ? "retryable_precommit"
        : "processing_failed";
    const failedFinalization = await finalizeFailedSubmissionReceipt(
      dependencies,
      {
        claimReceipt: claim.receipt,
        receiptReference,
        submissionBinding,
        failedOutcome,
      },
    );
    if (failedFinalization.outcome === "succeeded") {
      return verifySucceededDuplicate(
        session,
        namespacedSubmissionId,
        submissionFingerprint,
        dependencies,
      );
    }
    if (failedFinalization.outcome !== "failed") {
      await reconcileSubmission(dependencies, {
        receiptReference,
        consumedPrefill,
        session,
      });
      throw new ControllerError("Submission failure finalization requires reconciliation", {
        status: 503,
        publicCode: "service_unavailable",
        ambiguous: true,
      });
    }
    if (!consumeStarted && consumedPrefill === null) {
      try {
        session = await releaseSubmissionOwnership(
          session,
          submissionFingerprint,
          dependencies,
        );
      } catch {
        await markSessionReconciliation(
          dependencies.sessionStore,
          session,
          "submission_release_outcome_unknown",
        );
        throw new ControllerError("Submission ownership release requires reconciliation", {
          status: 503,
          publicCode: "service_unavailable",
          ambiguous: true,
        });
      }
    }
    throw normalized;
  }
}

function verifyRouteHeader(request, path, config) {
  if (new Set([config.otpRequestPath, config.otpVerifyPath]).has(path)) return;
  const selected = path === config.issuePath
    ? [config.issueHeaderName, config.issueHeaderSecret]
    : path === config.prefillPath
      ? [config.formsHeaderName, config.prefillHeaderSecret]
      : [config.formsHeaderName, config.submissionHeaderSecret];
  if (!verifyCustomHeader(request?.headers, selected[0], selected[1])) {
    throw new ControllerError("Source authentication failed", {
      status: 401,
      publicCode: "unauthorized_source",
    });
  }
}

function validateDependencies(dependencies) {
  if (
    !isPlainObject(dependencies) ||
    !isPlainObject(dependencies.config) ||
    !dependencies.sessionStore ||
    !dependencies.workflowStore ||
    !dependencies.crmClient ||
    !dependencies.verificationService
  ) {
    throw new ControllerError("Controller dependencies are unavailable", {
      publicCode: "configuration_invalid",
    });
  }
}

async function handleForm2Request(request, dependencies) {
  let stage = "request";
  try {
    validateDependencies(dependencies);
    const config = dependencies.config;
    const requestedPath = parseRequestPath(request);
    if (requestedPath === config.accessPath) {
      stage = "access";
      if (String(request?.method ?? "").toUpperCase() !== "GET") {
        throw new HttpBoundaryError("Method is not approved", {
          status: 405,
          publicCode: "method_not_allowed",
        });
      }
      return handleAccessPage(dependencies);
    }
    const path = validateJsonPost(
      request,
      new Set([
        config.issuePath,
        config.otpRequestPath,
        config.otpVerifyPath,
        config.prefillPath,
        config.submissionPath,
      ]),
    );
    stage = path === config.issuePath
      ? "issue"
      : path === config.otpRequestPath
        ? "otp_request"
        : path === config.otpVerifyPath
          ? "otp_verify"
          : path === config.prefillPath
            ? "prefill"
            : "submission";
    verifyRouteHeader(request, path, config);
    const rawBody = await readRawBody(request, {
      maximumBytes: config.maxBodyBytes,
      timeoutMs: config.inboundBodyTimeoutMs,
    });
    const body = parseJsonObject(rawBody);
    const now = typeof dependencies.now === "function" ? dependencies.now : Date.now;
    const nowMs = normalizeNow(now);
    if (path === config.issuePath) return await handleIssue(body, dependencies, nowMs);
    if (path === config.otpRequestPath) return await handleOtpRequest(body, dependencies);
    if (path === config.otpVerifyPath) return await handleOtpVerify(body, dependencies);
    if (path === config.prefillPath) return await handlePrefill(body, dependencies, nowMs);
    return await handleSubmission(body, dependencies, nowMs);
  } catch (error) {
    const normalized = publicError(error);
    return response(
      normalized.status,
      { ok: false, code: normalized.publicCode },
      stage,
      normalized.publicCode,
    );
  }
}

module.exports = {
  ControllerError,
  buildFormUrl,
  buildAccessUrl,
  fetchSessionContext,
  handleForm2Request,
};
