"use strict";

const crypto = require("node:crypto");
const catalyst = require("zcatalyst-sdk-node");
const { createConnectionAuthorizationProvider } = require("./connection-boundary");
const { ConfigurationError, loadConfig } = require("./config");
const { createCreatorClient } = require("./creator-client");
const { handleBillingWebhook } = require("./handler");
const { createCatalystIdempotencyStore } = require("./idempotency");
const { safeLog } = require("./redact");

function statusForError(error) {
  if (Number.isInteger(error?.status)) return error.status;
  const statusByCode = {
    authentication_failed: 401,
    body_too_large: 413,
    body_timeout: 408,
    body_unavailable: 400,
    configuration_invalid: 503,
    connection_unavailable: 503,
    dependency_timeout: 503,
    event_invalid: 400,
    idempotency_unavailable: 503,
    reconciliation_required: 503,
  };
  return statusByCode[error?.publicCode] ?? 500;
}

function codeForError(error) {
  const allowed = new Set([
    "authentication_failed",
    "body_encoding_invalid",
    "body_invalid",
    "body_required",
    "body_timeout",
    "body_too_large",
    "body_unavailable",
    "configuration_invalid",
    "connection_unavailable",
    "content_length_invalid",
    "content_type_not_allowed",
    "dependency_timeout",
    "event_invalid",
    "idempotency_unavailable",
    "method_not_allowed",
    "reconciliation_required",
    "route_not_found",
  ]);
  return allowed.has(error?.publicCode) ? error.publicCode : "internal_error";
}

function sendJson(response, status, body) {
  const serialized = JSON.stringify(body);
  if (typeof response.status === "function") response.status(status);
  else response.statusCode = status;
  if (typeof response.setHeader === "function") {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
  }
  if (typeof response.send === "function") response.send(serialized);
  else if (typeof response.end === "function") response.end(serialized);
  else throw new Error("Catalyst response adapter is unavailable");
}

function readCatalystEnvironmentHeader(request) {
  const headers = request?.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    throw new ConfigurationError("Catalyst runtime environment header is unavailable");
  }
  const matches = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === "x-zc-environment");
  if (matches.length !== 1 || typeof matches[0][1] !== "string") {
    throw new ConfigurationError("Catalyst runtime environment header is unavailable");
  }
  const runtimeEnvironment = matches[0][1].trim().toLowerCase();
  if (!new Set(["development", "production"]).has(runtimeEnvironment)) {
    throw new ConfigurationError("Catalyst runtime environment header is invalid");
  }
  return runtimeEnvironment;
}

function assertCatalystEnvironment(request, app, configuredEnvironment) {
  const headerEnvironment = readCatalystEnvironmentHeader(request);
  const runtimeEnvironment = typeof app?.config?.environment === "string"
    ? app.config.environment.trim().toLowerCase()
    : "";
  if (
    !new Set(["development", "production"]).has(runtimeEnvironment) ||
    runtimeEnvironment !== headerEnvironment ||
    headerEnvironment !== configuredEnvironment
  ) {
    throw new ConfigurationError(
      "Catalyst runtime environment does not match DEPLOYMENT_ENVIRONMENT",
    );
  }
}

function createRequestListener({
  catalystSdk = catalyst,
  environment = process.env,
  logger = console,
  randomUUID = crypto.randomUUID,
  now = Date.now,
  fetchImpl = globalThis.fetch,
} = {}) {
  return async function requestListener(request, response) {
    const startedAt = now();
    const requestId = randomUUID();
    let sourceRevision = "unavailable";
    try {
      const config = loadConfig(environment);
      sourceRevision = config.sourceRevision;
      // Require Catalyst's injected header explicitly because the pinned SDK
      // otherwise defaults absent environment metadata to Development.
      readCatalystEnvironmentHeader(request);
      const app = catalystSdk.initialize(request);
      // The platform-derived environment, not an editable variable alone,
      // anchors every source-tier and delivery-mode safety decision.
      assertCatalystEnvironment(request, app, config.deploymentEnvironment);
      const store = createCatalystIdempotencyStore(app, config);
      const creatorClient = config.deliveryMode === "creator"
        ? createCreatorClient(config, {
          authorizationProvider: createConnectionAuthorizationProvider(app, config),
          fetchImpl,
        })
        : null;
      const result = await handleBillingWebhook(request, {
        config,
        creatorClient,
        store,
        nowMs: now(),
      });
      safeLog(logger, result.status >= 500 ? "error" : "info", {
        requestId,
        sourceRevision,
        stage: result.stage,
        outcome: result.outcome,
        elapsedMs: now() - startedAt,
      });
      sendJson(response, result.status, { ...result.body, request_id: requestId });
    } catch (error) {
      const status = statusForError(error);
      const code = codeForError(error);
      safeLog(logger, status >= 500 ? "error" : "info", {
        requestId,
        sourceRevision,
        stage: "request",
        outcome: code,
        elapsedMs: now() - startedAt,
      });
      sendJson(response, status, { ok: false, code, request_id: requestId });
    }
  };
}

module.exports = {
  assertCatalystEnvironment,
  codeForError,
  createRequestListener,
  readCatalystEnvironmentHeader,
  sendJson,
  statusForError,
};
