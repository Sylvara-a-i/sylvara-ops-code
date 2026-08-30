"use strict";

const { renderAccessPage } = require("./access-page");
const {
  buildCrmPatch,
  buildPrefillPayload,
  FormContractError,
  normalizeFormData,
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
  generateToken,
  hashPrefillHandle,
  hashToken,
  isValidToken,
  normalizeConfigurationRevision,
  normalizeCrmModule,
  normalizeCrmRecordId,
  normalizeJourneyId,
  normalizePrefillId,
  normalizeSubmissionId,
  submissionFingerprint,
  verifySharedSecret,
} = require("./security");

const ISSUE_KEYS = new Set(["crmModule", "recordId"]);
const EXCHANGE_KEYS = new Set(["journeyToken"]);
const PREFILL_KEYS = new Set(["prefillHandle"]);
const PUBLIC_SUBMISSION_KEYS = new Set(["submissionId"]);
const ASSISTED_SUBMISSION_KEYS = new Set([
  "prefillId", "configurationRevision", "submissionId", "formData",
]);
const STAGES = new Set(["issue", "access", "exchange", "prefill", "submission"]);

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

function response(status, body, stage, outcome, headers = undefined) {
  if (!STAGES.has(stage) || !/^[a-z][a-z0-9_]{1,63}$/.test(outcome)) {
    throw new ControllerError("Response metadata is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  return Object.freeze({
    status,
    body: typeof body === "object" && body !== null ? Object.freeze(body) : body,
    stage,
    outcome,
    headers: headers ? Object.freeze(headers) : undefined,
  });
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

function buildFormUrl(config, prefillHandle) {
  if (!isValidToken(prefillHandle)) {
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
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(config.form1PrefillHandleFieldAlias ?? "")) {
    throw new ControllerError("Form URL configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  url.searchParams.set(config.form1PrefillHandleFieldAlias, prefillHandle);
  return url.toString();
}

function buildAccessUrl(config, journeyToken) {
  if (!isValidToken(journeyToken)) {
    throw new ControllerError("Assisted session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  let url;
  try {
    url = new URL(config.form1AccessPublicUrl);
  } catch {
    throw new ControllerError("Access URL configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.search || url.hash || url.pathname !== config.accessPath) {
    throw new ControllerError("Access URL configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  url.hash = new URLSearchParams({ journeyToken }).toString();
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
    accessUrl: buildAccessUrl(dependencies.config, token),
    expiresAt: session.expiresAt,
  }, "issue", "issued");
}

async function resolveJourneySession(token, dependencies) {
  if (!isValidToken(token)) {
    throw new ControllerError("Assisted session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  const tokenHash = hashToken(token, dependencies.config.tokenPepper);
  const session = await dependencies.sessionStore.readByTokenHash(tokenHash);
  if (!session || session.status !== "issued") {
    throw new ControllerError("Assisted session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  dependencies.sessionStore.assertRuntimeBinding(session);
  await dependencies.sessionStore.assertUsable(session);
  return Object.freeze({ session, tokenHash });
}

function access(dependencies) {
  const rendered = renderAccessPage({
    exchangePath: dependencies.config.exchangePath,
    randomBytes: dependencies.randomBytes,
  });
  return response(200, rendered.html, "access", "served", rendered.headers);
}

async function exchange(body, dependencies) {
  requireExact(body, EXCHANGE_KEYS);
  const selected = await resolveJourneySession(body.journeyToken, dependencies);
  const prefillHandle = generateToken(dependencies.randomBytes);
  const handleHash = hashPrefillHandle(
    prefillHandle,
    dependencies.config.prefillHandlePepper,
  );
  const prefillId = normalizePrefillId(dependencies.randomUUID());
  const session = await dependencies.sessionStore.issuePrefillHandle(selected.session, {
    handleHash,
    prefillId,
  });
  return response(200, {
    ok: true,
    formUrl: buildFormUrl(dependencies.config, prefillHandle),
    expiresAt: session.prefillHandleExpiresAt,
  }, "exchange", "exchanged");
}

async function prefill(body, dependencies) {
  requireExact(body, PREFILL_KEYS);
  let handleHash;
  try {
    handleHash = hashPrefillHandle(
      body.prefillHandle,
      dependencies.config.prefillHandlePepper,
    );
  } catch {
    throw new ControllerError("Assisted session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  const session = await dependencies.sessionStore.resolvePrefillHandle(handleHash);
  const record = await dependencies.crmClient.getRecord(
    session.crmModule,
    session.recordId,
  );
  dependencies.crmClient.assertJourney(record, session.journeyId);
  const payload = buildPrefillPayload(record, dependencies.config.assistedConstants);
  const consumed = await dependencies.sessionStore.consumePrefillHandle(
    session,
    handleHash,
    dependencies.crmClient.recordVersion(record),
  );
  return response(200, {
    ...payload,
    prefillId: consumed.row.prefillId,
    configurationRevision: consumed.row.configurationRevision,
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
  const prefillId = normalizePrefillId(body.prefillId);
  const configurationRevision = normalizeConfigurationRevision(body.configurationRevision);
  const session = await dependencies.sessionStore.readByPrefillId(prefillId);
  if (!session || session.prefillId !== prefillId ||
      session.configurationRevision !== configurationRevision ||
      configurationRevision !== dependencies.config.sourceRevision ||
      !new Set(["prefilled", "submitting", "consumed"]).has(session.status)) {
    throw new ControllerError("Assisted session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  dependencies.sessionStore.assertRuntimeBinding(session);
  // Bind durable submission ownership to the complete allowlisted payload so
  // an ambiguous retry cannot change CRM fields under the original identity.
  const normalizedFormData = normalizeFormData(body.formData);
  const fingerprint = submissionFingerprint(
    submissionId,
    prefillId,
    configurationRevision,
    normalizedFormData,
    dependencies.config.tokenPepper,
  );
  if (session.status === "consumed") {
    await dependencies.sessionStore.beginSubmission(session, fingerprint);
    return response(200, { ok: true, replayed: true }, "submission", "replayed");
  }
  const record = await dependencies.crmClient.getRecord(
    session.crmModule,
    session.recordId,
  );
  dependencies.crmClient.assertJourney(record, session.journeyId);
  if (dependencies.crmClient.recordVersion(record) !== session.crmRecordVersion) {
    throw new ControllerError("CRM record changed after prefill", {
      status: 409,
      publicCode: "record_stale",
    });
  }
  const ownership = await dependencies.sessionStore.beginSubmission(
    session,
    fingerprint,
    dependencies.crmClient.recordVersion(record),
  );
  const patch = buildCrmPatch(body.formData, dependencies.config.assistedConstants, {
    journeyId: ownership.row.journeyId,
    submittedAt: ownership.row.submissionStartedAt,
  });
  if (ownership.replayed && dependencies.crmClient.recordMatches(record, patch)) {
    await dependencies.sessionStore.consume(ownership.row, fingerprint);
    return response(200, { ok: true, replayed: true }, "submission", "replayed");
  }
  if (ownership.replayed &&
      dependencies.crmClient.recordVersion(record) !== ownership.row.crmRecordVersion) {
    const error = new Error("Submission ownership is already in progress");
    error.publicCode = "submission_in_progress";
    error.status = 409;
    error.ambiguous = true;
    throw error;
  }
  // A matching durable claim with an unchanged authoritative CRM version is a
  // crash-safe resume, not a new submission. Reuse the original conditional
  // write boundary; provider version fencing prevents concurrent retries from
  // applying the patch more than once.
  await dependencies.crmClient.completeAssistedSubmission(
    ownership.row.crmModule,
    record,
    patch,
    ownership.row.crmRecordVersion,
  );
  const completed = await dependencies.sessionStore.consume(ownership.row, fingerprint);
  const replayed = ownership.replayed || completed.replayed;
  return response(200, { ok: true, replayed },
    "submission", replayed ? "replayed" : "submitted");
}

function routeAuth(path, config) {
  if (path === config.issuePath) return [config.issueHeaderName, config.issueHeaderSecret];
  if (path === config.prefillPath) return [config.prefillHeaderName, config.prefillHeaderSecret];
  return [config.submissionHeaderName, config.submissionHeaderSecret];
}

function authenticateRequest(request, config) {
  const requestedPath = parseRequestPath(request);
  if (requestedPath === config?.accessPath) {
    if (String(request?.method ?? "").toUpperCase() !== "GET") {
      throw new HttpBoundaryError("Method is not approved", {
        status: 405,
        publicCode: "method_not_allowed",
      });
    }
    return requestedPath;
  }
  const path = validateJsonPost(
    request,
    new Set([
      config?.issuePath,
      config?.exchangePath,
      config?.prefillPath,
      config?.submissionPath,
    ]),
  );
  if (path === config.exchangePath) return path;
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
    if (typeof dependencies?.randomBytes !== "function" ||
        typeof dependencies?.randomUUID !== "function") {
      throw new ControllerError("Controller entropy is unavailable", {
        publicCode: "configuration_invalid",
      });
    }
    const path = authenticateRequest(request, config);
    if (path === config.accessPath) return access(dependencies);
    const raw = await readRawBody(request, {
      maximumBytes: config.maxBodyBytes,
      timeoutMs: config.inboundBodyTimeoutMs,
    });
    const body = parseJsonObject(raw);
    if (path === config.issuePath) return await issue(body, dependencies);
    if (path === config.exchangePath) return await exchange(body, dependencies);
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
  buildAccessUrl,
  buildFormUrl,
  handleRequest,
  normalizeError,
};
