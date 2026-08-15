"use strict";

const { isApprovedFormsPublicHostname } = require("./destinations");
const {
  CLIENT_KEYS,
  FormContractError,
  buildPrefillPayload,
  validateForm2Payload,
  verifyRecordRelationships,
} = require("./form-contract");
const {
  HttpBoundaryError,
  parseJsonObject,
  readRawBody,
  validateJsonPost,
} = require("./http");
const {
  SecurityError,
  deriveAccessToken,
  hashAccessToken,
  hashIssueRequestId,
  isValidAccessToken,
  verifyCustomHeader,
} = require("./security");
const { fingerprintSnapshot, fingerprintSubmission } = require("./snapshot");

const ISSUE_KEYS = new Set(["dealId", "issueRequestId"]);
const PREFILL_KEYS = new Set(["setupToken"]);
const SUBMISSION_KEYS = new Set(["setupToken", "prefillId", "submissionId", ...CLIENT_KEYS]);
const RECORD_ID_PATTERN = /^[1-9][0-9]{9,29}$/;
const SUBMISSION_ID_PATTERN = /^[0-9]{1,30}$/;
const RESPONSE_STAGES = new Set(["request", "issue", "prefill", "submission"]);
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

function response(status, body, stage, outcome) {
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
    headers: NO_STORE_HEADERS,
    body: Object.freeze(body),
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
    !isApprovedFormsPublicHostname(url.hostname) ||
    url.pathname === "/" ||
    url.pathname.includes("//") ||
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(config.form2TokenFieldAlias ?? "")
  ) {
    throw new ControllerError("Form URL configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  url.searchParams.set(config.form2TokenFieldAlias, setupToken);
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
    left.issueKey === right.issueKey &&
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
    await synchronizeExpiredSession(dependencies, session);
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
    await synchronizeExpiredSession(dependencies, session);
    throw genericSetupNotFound();
  }
  if (
    !session ||
    !new Set(["verified", "submitted"]).has(session.status) ||
    !Number.isFinite(expiresAt) ||
    !hasValue(session.verifiedAt) ||
    (session.status === "submitted" && !hasValue(session.submittedAt))
  ) {
    throw genericSetupNotFound();
  }
  return Object.freeze({
    expired: expiresAt <= nowMs,
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

function dealMatchesIssuedSession(deal, session, config) {
  return dealMatchesSessionBinding(deal, session) &&
    dealRemainsSetupEligible(deal, config) &&
    deal.Setup_Access_Status === config.form2AccessStatuses.issued &&
    sameInstant(deal.Setup_Access_Issued_At, session.issuedAt) &&
    !hasValue(deal.Setup_Access_Verified_At);
}

function dealMatchesVerifiedSession(deal, session, config) {
  return dealMatchesSessionBinding(deal, session) &&
    dealRemainsSetupEligible(deal, config) &&
    deal.Setup_Access_Status === config.form2AccessStatuses.verified &&
    sameInstant(deal.Setup_Access_Issued_At, session.issuedAt) &&
    sameInstant(deal.Setup_Access_Verified_At, session.verifiedAt);
}

function dealMatchesExpiredSession(deal, session, config) {
  return dealMatchesSessionBinding(deal, session) &&
    dealRemainsSetupEligible(deal, config) &&
    deal.Setup_Access_Status === config.form2AccessStatuses.expired &&
    sameInstant(deal.Setup_Access_Issued_At, session.issuedAt) &&
    (hasValue(session.verifiedAt)
      ? sameInstant(deal.Setup_Access_Verified_At, session.verifiedAt)
      : !hasValue(deal.Setup_Access_Verified_At));
}

async function synchronizeExpiredSession(dependencies, session) {
  try {
    const deal = await dependencies.crmClient.getRecord("Deals", session.crmDealId);
    if (dealMatchesExpiredSession(deal, session, dependencies.config)) return deal;
    const expectedCurrentState = hasValue(session.verifiedAt)
      ? dealMatchesVerifiedSession(deal, session, dependencies.config)
      : dealMatchesIssuedSession(deal, session, dependencies.config);
    if (!expectedCurrentState) throw new Error("CRM expiry state did not match");
    const readback = await dependencies.crmClient.updateRecord(
      "Deals",
      session.crmDealId,
      { Setup_Access_Status: dependencies.config.form2AccessStatuses.expired },
      { ifUnmodifiedSince: deal.Modified_Time },
    );
    if (!dealMatchesExpiredSession(readback, session, dependencies.config)) {
      throw new Error("CRM expiry readback did not match");
    }
    return readback;
  } catch {
    const observed = await bestEffort(
      () => dependencies.crmClient.getRecord("Deals", session.crmDealId),
    );
    if (dealMatchesExpiredSession(observed, session, dependencies.config)) return observed;
    await markSessionReconciliation(
      dependencies.sessionStore,
      session,
      "crm_expiry_outcome_unknown",
    );
    throw new ControllerError("Expired setup state requires reconciliation", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
}

async function expireSession(candidate, tokenHash, dependencies) {
  let expiredSession = null;
  try {
    const result = await dependencies.sessionStore.verify(tokenHash);
    if (
      result?.outcome === "expired" &&
      sameSessionIdentity(candidate, result.session) &&
      result.session.status === "expired" &&
      hasValue(result.session.expiredAt)
    ) {
      expiredSession = result.session;
    }
  } catch {
    expiredSession = await bestEffort(
      () => dependencies.sessionStore.readByTokenHash(tokenHash),
    );
  }
  if (
    !sameSessionIdentity(candidate, expiredSession) ||
    expiredSession.status !== "expired" ||
    !hasValue(expiredSession.expiredAt)
  ) {
    await markSessionReconciliation(
      dependencies.sessionStore,
      candidate,
      "session_expiry_outcome_unknown",
    );
    throw new ControllerError("Setup expiry requires reconciliation", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  await synchronizeExpiredSession(dependencies, expiredSession);
  return expiredSession;
}

async function readIssueSessionState(dependencies, session) {
  try {
    const [readback, deal] = await Promise.all([
      dependencies.sessionStore.readByRowId(session.rowId),
      dependencies.crmClient.getRecord("Deals", session.crmDealId),
    ]);
    if (!sameSessionIdentity(session, readback)) return null;
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
  } catch {
    // A failed or non-exact readback never proves convergence.
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

async function handleIssue(body, dependencies) {
  assertExactKeys(body, ISSUE_KEYS, "Issue request is invalid");
  const dealId = normalizeRecordId(body.dealId, "Deal identifier");
  let setupToken;
  let issueKey;
  let tokenHash;
  try {
    setupToken = deriveAccessToken(body.issueRequestId, dependencies.config.tokenPepper);
    issueKey = hashIssueRequestId(body.issueRequestId, dependencies.config.tokenPepper);
    tokenHash = hashAccessToken(setupToken, dependencies.config.tokenPepper);
  } catch (error) {
    throw publicError(error);
  }

  let priorSession;
  try {
    priorSession = await dependencies.sessionStore.readByIssueKey(issueKey);
  } catch (error) {
    throw publicError(error);
  }

  const initialDeal = await dependencies.crmClient.getRecord("Deals", dealId);
  const binding = {
    crmContactId: lookupId(initialDeal, "Contact_Name"),
    crmAccountId: lookupId(initialDeal, "Account_Name"),
    crmDealId: dealId,
  };
  let existing = await fetchSessionContext(dependencies.crmClient, binding);
  const statuses = dependencies.config.form2AccessStatuses;
  if (!priorSession) {
    requireEligibleContext(existing, dependencies.config, new Set([statuses.initial]));
    if (
      hasValue(existing.deal.Setup_Access_Issued_At) ||
      hasValue(existing.deal.Setup_Access_Verified_At)
    ) {
      throw new ControllerError("Setup context is not eligible", {
        status: 409,
        publicCode: "setup_conflict",
      });
    }
  } else {
    requireEligibleContext(
      existing,
      dependencies.config,
      new Set([statuses.initial, statuses.issued, statuses.verified]),
    );
  }
  // Validate every prefilled value that cannot be repaired by the respondent,
  // especially the locked Email and Mobile identity, before creating durable
  // session state or changing the Deal.
  buildPrefillPayload(existing);

  let session;
  try {
    session = await dependencies.sessionStore.issue({
      issueKey,
      tokenHash,
      ...binding,
    });
  } catch (error) {
    throw publicError(error);
  }
  const issuedUpdate = {
    Setup_Access_Status: statuses.issued,
    Setup_Access_Issued_At: session.issuedAt,
  };
  const issuedStateMatches =
    existing.deal.Setup_Access_Status === statuses.issued &&
    sameInstant(existing.deal.Setup_Access_Issued_At, session.issuedAt) &&
    !hasValue(existing.deal.Setup_Access_Verified_At);
  const initialStateMatches =
    existing.deal.Setup_Access_Status === statuses.initial &&
    !hasValue(existing.deal.Setup_Access_Issued_At) &&
    !hasValue(existing.deal.Setup_Access_Verified_At);
  const verifiedStateMatches =
    session.status === "verified" &&
    existing.deal.Setup_Access_Status === statuses.verified &&
    sameInstant(existing.deal.Setup_Access_Issued_At, session.issuedAt) &&
    sameInstant(existing.deal.Setup_Access_Verified_At, session.verifiedAt);

  if (session.status === "issued" && initialStateMatches) {
    try {
      await dependencies.crmClient.updateRecord("Deals", dealId, issuedUpdate, {
        ifUnmodifiedSince: existing.deal.Modified_Time,
      });
    } catch {
      const observed = await readIssueSessionState(dependencies, session);
      if (observed?.outcome === "converged") {
        session = observed.session;
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
    (session.status === "issued" && !issuedStateMatches) ||
    (session.status === "verified" && !verifiedStateMatches)
  ) {
    const observed = await readIssueSessionState(dependencies, session);
    if (observed?.outcome === "converged") {
      session = observed.session;
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
      formUrl: buildFormUrl(dependencies.config, setupToken),
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
  // Fail deterministic CRM/Form contract defects before consuming a bounded
  // prefill attempt or changing Deal state. Verified retries still consume an
  // attempt so repeated prefill-row creation cannot continue until TTL.
  buildPrefillPayload(existing);
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
    sameInstant(existing.deal.Setup_Access_Verified_At, session.verifiedAt);
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
  const prefill = buildPrefillPayload(existing);
  const snapshotFingerprint = fingerprintSnapshot(prefill, dependencies.config.tokenPepper);
  const minted = await dependencies.workflowStore.mintPrefill(
    prefillBinding(session, existing, snapshotFingerprint),
  );
  return response(200, { ...prefill, prefillId: minted.prefillId }, "prefill", "prepared");
}

async function verifySucceededDuplicate(session, namespacedSubmissionId, dependencies) {
  const deal = await dependencies.crmClient.getRecord("Deals", session.crmDealId);
  if (
    !dealMatchesSessionBinding(deal, session) ||
    deal.Setup_Form_Submission_ID !== namespacedSubmissionId ||
    deal.Setup_Access_Status !== dependencies.config.form2AccessStatuses.submitted ||
    !hasValue(deal.Setup_Form_Submitted_At)
  ) {
    await markSessionReconciliation(
      dependencies.sessionStore,
      session,
      "succeeded_receipt_crm_mismatch",
    );
    throw new ControllerError("Completed submission readback does not match", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  if (session.status !== "submitted") {
    await repairSubmittedSession(session, dependencies);
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
    hasValue(readback.submittedAt) &&
    readback.attemptCount === candidate.attemptCount &&
    readback.maxAttempts === candidate.maxAttempts &&
    sameInstant(readback.issuedAt, candidate.issuedAt) &&
    sameInstant(readback.expiresAt, candidate.expiresAt) &&
    sameInstant(readback.verifiedAt, candidate.verifiedAt);
}

async function repairSubmittedSession(session, dependencies) {
  let readback = null;
  try {
    readback = await dependencies.sessionStore.markSubmitted(session.rowId);
  } catch {
    readback = await bestEffort(
      () => dependencies.sessionStore.readByRowId(session.rowId),
    );
  }
  if (submittedSessionMatches(session, readback)) return readback;
  await markSessionReconciliation(
    dependencies.sessionStore,
    session,
    "submission_session_repair_unknown",
  );
  throw new ControllerError("Completed submission session repair requires reconciliation", {
    status: 503,
    publicCode: "service_unavailable",
    ambiguous: true,
  });
}

function submissionFormPayload(body) {
  return Object.fromEntries(CLIENT_KEYS.map((key) => [key, body[key]]));
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

async function handleSubmission(body, dependencies, nowMs) {
  assertExactKeys(body, SUBMISSION_KEYS, "Submission request is invalid");
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
  const session = resolvedSession.session;
  const submissionBinding = {
    submissionId: namespacedSubmissionId,
    prefillId: body.prefillId,
    sessionRowId: session.rowId,
    submissionFingerprint: fingerprintSubmission({
      submissionId: namespacedSubmissionId,
      prefillId: body.prefillId,
      values: submissionFormPayload(body),
    }, dependencies.config.tokenPepper),
  };
  let existingReceipt;
  try {
    existingReceipt = await dependencies.workflowStore.readSubmission(submissionBinding);
  } catch (error) {
    throw publicError(error);
  }
  if (session.status === "submitted") {
    if (!existingReceipt || existingReceipt.status !== "succeeded") {
      throw new ControllerError("Submitted session does not match a completed receipt", {
        status: 409,
        publicCode: "setup_conflict",
      });
    }
    return verifySucceededDuplicate(session, namespacedSubmissionId, dependencies);
  }
  if (existingReceipt?.status === "succeeded") {
    return verifySucceededDuplicate(session, namespacedSubmissionId, dependencies);
  }
  if (expired) {
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

  let claim;
  try {
    claim = await dependencies.workflowStore.claimSubmission(submissionBinding);
  } catch (error) {
    throw publicError(error);
  }
  if (claim.outcome === "succeeded") {
    return verifySucceededDuplicate(session, namespacedSubmissionId, dependencies);
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
  let crmCommitted = false;
  try {
    if (session.status !== "verified") {
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
      buildPrefillPayload(existing),
      dependencies.config.tokenPepper,
    );
    if (currentFingerprint !== revision.snapshotFingerprint) {
      throw new ControllerError("Prefill snapshot no longer matches", {
        status: 409,
        publicCode: "setup_conflict",
      });
    }

    const updates = validateForm2Payload(submissionFormPayload(body), {
      existing,
      trustedNow: new Date(nowMs).toISOString(),
      setupFormVersion: dependencies.config.form2FormVersion,
      submissionId: namespacedSubmissionId,
      setupAccessSubmittedStatus: dependencies.config.form2AccessStatuses.submitted,
      allowedFieldTeamSizeBands: dependencies.config.form2FieldTeamSizeBands,
    });
    consumedPrefill = await dependencies.workflowStore.consumePrefill({
      prefillId: body.prefillId,
      ...prefillBinding(session, existing, currentFingerprint),
    });
    const crmOutcome = await dependencies.crmClient.updateForm2Composite(existing, updates);
    crmCommitted = true;
    await dependencies.workflowStore.markSubmissionSucceeded(receiptReference);
    await repairSubmittedSession(session, dependencies);
    const duplicate = crmOutcome?.replayed === true;
    return response(
      200,
      { ok: true, accepted: true, duplicate },
      "submission",
      duplicate ? "duplicate_succeeded" : "accepted",
    );
  } catch (error) {
    const normalized = publicError(error);
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
    await bestEffort(() => dependencies.workflowStore.markSubmissionFailed(
      receiptReference,
      failedOutcome,
    ));
    throw normalized;
  }
}

function verifyRouteHeader(request, path, config) {
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
    !dependencies.crmClient
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
    const path = validateJsonPost(
      request,
      new Set([config.issuePath, config.prefillPath, config.submissionPath]),
    );
    stage = path === config.issuePath
      ? "issue"
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
    if (path === config.issuePath) return await handleIssue(body, dependencies);
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
  fetchSessionContext,
  handleForm2Request,
};
