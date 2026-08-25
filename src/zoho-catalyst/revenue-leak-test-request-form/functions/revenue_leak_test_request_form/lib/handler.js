"use strict";

const { isApprovedFormsPublicHostname } = require("./destinations");
const { buildPrefillPayload, FormContractError } = require("./form-contract");
const {
  HttpBoundaryError,
  parseJsonObject,
  readRawBody,
  validateJsonPost,
} = require("./http");
const {
  SecurityError,
  generateIntakeSubmissionId,
  generateToken,
  hashToken,
  isValidToken,
  normalizeLeadId,
  verifySharedSecret,
} = require("./security");

const ISSUE_KEYS = new Set(["leadId"]);
const PREFILL_KEYS = new Set(["token"]);
const RESPONSE_STAGES = new Set(["issue", "prefill", "request"]);
const OUTCOME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

class ControllerError extends Error {
  constructor(message, { status = 503, publicCode = "service_unavailable", ambiguous = false } = {}) {
    super(message);
    this.name = "ControllerError";
    this.status = status;
    this.publicCode = publicCode;
    this.ambiguous = ambiguous;
  }
}

function response(status, body, stage, outcome) {
  if (!RESPONSE_STAGES.has(stage) || !OUTCOME_PATTERN.test(outcome)) {
    throw new ControllerError("Response metadata is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  return Object.freeze({ status, body: Object.freeze(body), stage, outcome });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, expected) {
  if (!isPlainObject(value)) {
    throw new ControllerError("Request body is invalid", {
      status: 422,
      publicCode: "request_invalid",
    });
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
    throw new ControllerError("Request body does not match the approved contract", {
      status: 422,
      publicCode: "request_invalid",
    });
  }
}

function currentTime(now) {
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
    throw new ControllerError("Assisted token is invalid", {
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
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(config.form1TokenFieldAlias ?? "")
  ) {
    throw new ControllerError("Form URL configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  url.searchParams.set(config.form1TokenFieldAlias, token);
  return url.toString();
}

function normalizePublicError(error) {
  if (error instanceof ControllerError) return error;
  if (error instanceof HttpBoundaryError) {
    return new ControllerError("HTTP boundary rejected the request", {
      status: error.status,
      publicCode: error.publicCode,
      ambiguous: error.ambiguous,
    });
  }
  if (error instanceof SecurityError) {
    if (error.publicCode === "token_invalid") {
      return new ControllerError("Assisted session was not found", {
        status: 404,
        publicCode: "session_not_found",
      });
    }
    const configuration = error.publicCode === "configuration_invalid";
    return new ControllerError("Security boundary rejected the request", {
      status: configuration ? 503 : 422,
      publicCode: configuration ? "configuration_invalid" : "request_invalid",
    });
  }
  if (error instanceof FormContractError) {
    return new ControllerError("CRM context does not match the assisted session", {
      status: error.status,
      publicCode: error.publicCode === "configuration_invalid"
        ? "configuration_invalid"
        : "context_conflict",
    });
  }
  if (error?.publicCode === "record_stale" || error?.publicCode === "context_invalid") {
    return new ControllerError("CRM context changed during issuance", {
      status: 409,
      publicCode: "context_conflict",
    });
  }
  if (error?.ambiguous === true || error?.publicCode === "reconciliation_required") {
    return new ControllerError("Dependency outcome requires reconciliation", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  if (error?.publicCode === "configuration_invalid") {
    return new ControllerError("Controller configuration is invalid", {
      status: 503,
      publicCode: "configuration_invalid",
    });
  }
  return new ControllerError("A required dependency is unavailable", {
    status: 503,
    publicCode: "service_unavailable",
  });
}

function notFound() {
  return new ControllerError("Assisted session was not found", {
    status: 404,
    publicCode: "session_not_found",
  });
}

async function bestEffort(operation) {
  try {
    return await operation();
  } catch {
    return null;
  }
}

async function issueSession(body, dependencies) {
  assertExactKeys(body, ISSUE_KEYS);
  const leadId = normalizeLeadId(body.leadId);
  const lead = await dependencies.crmClient.getLead(leadId);
  if (lead?.id !== leadId) {
    throw new ControllerError("CRM Lead context is invalid", {
      status: 409,
      publicCode: "context_conflict",
    });
  }

  // Every button press creates a new intake identity. Updating CRM before the
  // URL is returned invalidates any older, still-unexpired assisted token.
  const intakeSubmissionId = generateIntakeSubmissionId(dependencies.randomUUID);
  const token = generateToken(dependencies.randomBytes);
  const tokenHash = hashToken(token, dependencies.config.tokenPepper);
  const pending = await dependencies.sessionStore.createSession({
    tokenHash,
    leadId,
    intakeSubmissionId,
  });

  try {
    const updated = await dependencies.crmClient.updateIntakeSubmissionId(
      lead,
      intakeSubmissionId,
    );
    if (updated?.id !== leadId || updated?.Intake_Submission_ID !== intakeSubmissionId) {
      throw new ControllerError("CRM update readback is inconsistent", {
        status: 503,
        publicCode: "service_unavailable",
        ambiguous: true,
      });
    }
  } catch (error) {
    if (error?.ambiguous === true || error?.publicCode === "reconciliation_required") {
      await bestEffort(() => dependencies.sessionStore.markReconciliationRequired(pending));
    } else {
      await bestEffort(() => dependencies.sessionStore.markFailed(pending));
    }
    throw error;
  }

  const issued = await dependencies.sessionStore.markIssued(pending);
  if (issued.status !== "issued" || issued.intakeSubmissionId !== intakeSubmissionId) {
    throw new ControllerError("Assisted session issuance could not be verified", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  return response(
    201,
    {
      ok: true,
      formUrl: buildFormUrl(dependencies.config, token),
      expiresAt: issued.expiresAt,
    },
    "issue",
    "issued",
  );
}

async function prefillSession(body, dependencies) {
  assertExactKeys(body, PREFILL_KEYS);
  if (!isValidToken(body.token)) throw notFound();
  const tokenHash = hashToken(body.token, dependencies.config.tokenPepper);
  const session = await dependencies.sessionStore.readByTokenHash(tokenHash);
  if (!session || !new Set(["issued", "prefilled"]).has(session.status)) throw notFound();
  const nowMs = currentTime(dependencies.now);
  const expiresAtMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    await bestEffort(() => dependencies.sessionStore.markExpired(session));
    throw notFound();
  }

  // Reserve one bounded disclosure before reading CRM. LAST_OUTCOME carries a
  // unique, non-PII reservation owner so a racing request cannot piggyback on
  // another request's counter increment.
  const reservationOwner = dependencies.randomUUID();
  let reserved;
  try {
    reserved = await dependencies.sessionStore.reservePrefill(session, reservationOwner);
  } catch (error) {
    if (error?.publicCode === "prefill_limit_reached") throw notFound();
    throw error;
  }

  let payload;
  try {
    const lead = await dependencies.crmClient.getLead(reserved.leadId);
    payload = buildPrefillPayload(
      lead,
      reserved,
      dependencies.config.assistedConstants,
    );
  } catch (error) {
    await bestEffort(() => dependencies.sessionStore.cancelPrefill(reserved, reservationOwner));
    throw error;
  }

  const completed = await dependencies.sessionStore.completePrefill(
    reserved,
    reservationOwner,
  );
  if (completed.status !== "prefilled") {
    throw new ControllerError("Assisted prefill state could not be verified", {
      status: 503,
      publicCode: "service_unavailable",
      ambiguous: true,
    });
  }
  return response(200, payload, "prefill", "prefilled");
}

async function handleRequest(request, dependencies) {
  try {
    const config = dependencies?.config;
    const allowedPaths = new Set([config?.issuePath, config?.prefillPath]);
    const path = validateJsonPost(request, allowedPaths);
    const headerName = path === config.issuePath
      ? config.issueHeaderName
      : config.prefillHeaderName;
    const headerSecret = path === config.issuePath
      ? config.issueHeaderSecret
      : config.prefillHeaderSecret;
    if (!verifySharedSecret(request?.headers, headerName, headerSecret)) {
      throw new ControllerError("Route authentication failed", {
        status: 401,
        publicCode: "authentication_failed",
      });
    }
    const raw = await readRawBody(request, {
      maximumBytes: config.maxBodyBytes,
      timeoutMs: config.inboundBodyTimeoutMs,
    });
    const body = parseJsonObject(raw);
    return path === config.issuePath
      ? await issueSession(body, dependencies)
      : await prefillSession(body, dependencies);
  } catch (error) {
    throw normalizePublicError(error);
  }
}

module.exports = {
  ControllerError,
  buildFormUrl,
  handleRequest,
  normalizePublicError,
};
