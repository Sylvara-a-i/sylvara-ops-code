"use strict";

const { buildCrmPatch, FormContractError, normalizeFormData } = require("./form-contract");
const {
  HttpBoundaryError,
  parseJsonObject,
  readRawBody,
  validateJsonPost,
} = require("./http");
const {
  SecurityError,
  generateToken,
  hashToken,
  isValidToken,
  normalizeCrmModule,
  normalizeCrmRecordId,
  normalizeJourneyId,
  normalizeSubmissionId,
  submissionFingerprint,
  verifySharedSecret,
} = require("./security");

const ISSUE_KEYS = new Set(["crmModule", "recordId"]);
const PREFILL_KEYS = new Set(["token"]);
const PUBLIC_SUBMISSION_KEYS = new Set(["submissionId"]);
const ASSISTED_SUBMISSION_KEYS = new Set(["token", "submissionId", "formData"]);
const STAGES = new Set(["issue", "prefill", "submission"]);

class ControllerError extends Error {
  constructor(message, { status = 503, publicCode = "service_unavailable",
    ambiguous = false } = {}) {
    super(message);
    this.name = "ControllerError";
    this.status = status;
    this.publicCode = publicCode;
    this.ambiguous = ambiguous;
  }
}

function response(status, body, stage, outcome) {
  if (!STAGES.has(stage) || !/^[a-z][a-z0-9_]{1,63}$/.test(outcome)) {
    throw new ControllerError("Response metadata is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  return Object.freeze({ status, body: Object.freeze(body), stage, outcome });
}

function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!plain(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.size && keys.every((key) =>
    typeof key === "string" && expected.has(key) &&
    !["__proto__", "constructor", "prototype"].includes(key));
}

function requireExact(value, expected) {
  if (!exactKeys(value, expected)) {
    throw new ControllerError("Request body does not match the approved contract", {
      status: 422,
      publicCode: "request_invalid",
    });
  }
}

function nowMilliseconds(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ControllerError("Controller clock is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  return value;
}

function buildFormUrl(config, token) {
  if (!isValidToken(token)) {
    throw new ControllerError("Assisted session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  let url;
  try {
    url = new URL(config.form1PublicUrl);
  } catch {
    throw new ControllerError("Form URL configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  if (url.protocol !== "https:" || url.hostname !== "forms.zohopublic.com" ||
      url.username || url.password || url.port || url.search || url.hash ||
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(config.form1TokenFieldAlias ?? "")) {
    throw new ControllerError("Form URL configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  url.searchParams.set(config.form1TokenFieldAlias, token);
  return url.toString();
}

function normalizeError(error) {
  if (error instanceof ControllerError) return error;
  if (error instanceof HttpBoundaryError || error instanceof FormContractError) {
    return new ControllerError("Request boundary rejected the operation", {
      status: error.status,
      publicCode: error.publicCode,
      ambiguous: error.ambiguous === true,
    });
  }
  if (error instanceof SecurityError) {
    return new ControllerError("Security boundary rejected the operation", {
      status: error.publicCode === "token_invalid" ? 404 : error.status,
      publicCode: error.publicCode === "token_invalid" ? "session_not_found" : error.publicCode,
    });
  }
  const known = new Set([
    "configuration_invalid", "context_conflict", "context_not_found", "record_stale",
    "session_binding_conflict", "session_consumed", "session_not_found", "session_state_invalid",
    "submission_conflict", "submission_in_progress",
  ]);
  if (known.has(error?.publicCode)) {
    return new ControllerError("Assisted operation failed closed", {
      status: error.status,
      publicCode: error.publicCode,
      ambiguous: error.ambiguous === true,
    });
  }
  if (error?.ambiguous === true || error?.publicCode === "reconciliation_required") {
    return new ControllerError("Dependency outcome requires reconciliation", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  return new ControllerError("A required dependency is unavailable", {
    status: 503,
    publicCode: error?.publicCode === "configuration_invalid"
      ? "configuration_invalid"
      : "service_unavailable",
  });
}

async function issue(body, dependencies) {
  requireExact(body, ISSUE_KEYS);
  const crmModule = normalizeCrmModule(body.crmModule);
  const recordId = normalizeCrmRecordId(body.recordId);
  const context = await dependencies.crmClient.getOrInitializeJourney(crmModule, recordId);
  const journeyId = normalizeJourneyId(context.journeyId);
  dependencies.crmClient.assertJourney(context.record, journeyId);
  const token = generateToken(dependencies.randomBytes);
  const tokenHash = hashToken(token, dependencies.config.tokenPepper);
  const session = await dependencies.sessionStore.issue({
    tokenHash,
    crmModule,
    recordId,
    journeyId,
  });
  return response(201, {
    ok: true,
    formUrl: buildFormUrl(dependencies.config, token),
    expiresAt: session.expiresAt,
  }, "issue", "issued");
}

async function resolveSession(token, dependencies, { allowTerminal = false } = {}) {
  if (!isValidToken(token)) {
    throw new ControllerError("Assisted session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  const tokenHash = hashToken(token, dependencies.config.tokenPepper);
  const session = await dependencies.sessionStore.readByTokenHash(tokenHash);
  if (!session || (!allowTerminal && !new Set(["issued", "prefilled"]).has(session.status))) {
    throw new ControllerError("Assisted session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  dependencies.sessionStore.assertRuntimeBinding(session);
  if (!allowTerminal) await dependencies.sessionStore.assertUsable(session);
  return Object.freeze({ session, tokenHash });
}

async function prefill(body, dependencies) {
  requireExact(body, PREFILL_KEYS);
  const selected = await resolveSession(body.token, dependencies);
  const record = await dependencies.crmClient.getRecord(
    selected.session.crmModule,
    selected.session.recordId,
  );
  dependencies.crmClient.assertJourney(record, selected.session.journeyId);
  const updated = await dependencies.sessionStore.recordPrefill(selected.session);
  return response(200, {
    ok: true,
    assisted: true,
    entryOffer: dependencies.config.assistedConstants.entryOffer,
    submissionChannel: dependencies.config.assistedConstants.submissionChannel,
    sourcePage: dependencies.config.assistedConstants.sourcePage,
    expiresAt: updated.expiresAt,
  }, "prefill", "prepared");
}

async function submit(body, dependencies) {
  if (exactKeys(body, PUBLIC_SUBMISSION_KEYS)) {
    normalizeSubmissionId(body.submissionId);
    // Public Form 1 remains owned by its existing native CRM upsert. This
    // authenticated webhook acknowledgment carries no CRM or journey binding.
    return response(202, { ok: true, binding: "public_unbound" },
      "submission", "public_unbound");
  }
  requireExact(body, ASSISTED_SUBMISSION_KEYS);
  const submissionId = normalizeSubmissionId(body.submissionId);
  const selected = await resolveSession(body.token, dependencies, { allowTerminal: true });
  // Bind durable submission ownership to the complete allowlisted payload so
  // an ambiguous retry cannot change CRM fields under the original identity.
  const normalizedFormData = normalizeFormData(body.formData);
  const fingerprint = submissionFingerprint(
    submissionId,
    selected.tokenHash,
    normalizedFormData,
    dependencies.config.tokenPepper,
  );
  if (selected.session.status === "consumed") {
    await dependencies.sessionStore.beginSubmission(selected.session, fingerprint);
    return response(200, { ok: true, replayed: true }, "submission", "replayed");
  }
  const record = await dependencies.crmClient.getRecord(
    selected.session.crmModule,
    selected.session.recordId,
  );
  dependencies.crmClient.assertJourney(record, selected.session.journeyId);
  const ownership = await dependencies.sessionStore.beginSubmission(
    selected.session,
    fingerprint,
    dependencies.crmClient.recordVersion(record),
  );
  const patch = buildCrmPatch(body.formData, dependencies.config.assistedConstants, {
    journeyId: ownership.row.journeyId,
    submittedAt: ownership.row.submissionStartedAt,
  });
  if (ownership.replayed && dependencies.crmClient.recordMatches(record, patch)) {
    const completed = await dependencies.sessionStore.consume(ownership.row, fingerprint);
    return response(200, { ok: true, replayed: true }, "submission", "replayed");
  }
  if (ownership.replayed) {
    const error = new Error("Submission ownership is already in progress");
    error.publicCode = "submission_in_progress";
    error.status = 409;
    error.ambiguous = true;
    throw error;
  }
  await dependencies.crmClient.completeAssistedSubmission(
    ownership.row.crmModule,
    record,
    patch,
    ownership.row.crmRecordVersion,
  );
  const completed = await dependencies.sessionStore.consume(ownership.row, fingerprint);
  return response(200, { ok: true, replayed: completed.replayed },
    "submission", completed.replayed ? "replayed" : "submitted");
}

function routeAuth(path, config) {
  if (path === config.issuePath) return [config.issueHeaderName, config.issueHeaderSecret];
  if (path === config.prefillPath) return [config.prefillHeaderName, config.prefillHeaderSecret];
  return [config.submissionHeaderName, config.submissionHeaderSecret];
}

function authenticateRequest(request, config) {
  const path = validateJsonPost(
    request,
    new Set([config?.issuePath, config?.prefillPath, config?.submissionPath]),
  );
  const [headerName, headerSecret] = routeAuth(path, config);
  if (!verifySharedSecret(request?.headers, headerName, headerSecret)) {
    throw new ControllerError("Route authentication failed", {
      status: 401,
      publicCode: "authentication_failed",
    });
  }
  return path;
}

async function handleRequest(request, dependencies) {
  try {
    const config = dependencies?.config;
    const path = authenticateRequest(request, config);
    const raw = await readRawBody(request, {
      maximumBytes: config.maxBodyBytes,
      timeoutMs: config.inboundBodyTimeoutMs,
    });
    const body = parseJsonObject(raw);
    if (path === config.issuePath) return await issue(body, dependencies);
    if (path === config.prefillPath) return await prefill(body, dependencies);
    return await submit(body, dependencies);
  } catch (error) {
    throw normalizeError(error);
  }
}

module.exports = {
  ASSISTED_SUBMISSION_KEYS,
  ControllerError,
  PUBLIC_SUBMISSION_KEYS,
  authenticateRequest,
  buildFormUrl,
  handleRequest,
  normalizeError,
};
