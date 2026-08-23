"use strict";

const crypto = require("node:crypto");
const { createCatalystDataStoreAdapter } = require("./catalyst-datastore-adapter");
const { createConnectionAuthorizationProvider } = require("./connection-boundary");
const { ConfigurationError, loadConfig } = require("./config");
const { createCrmClient } = require("./crm-client");
const { handleRequest } = require("./handler");
const { safeLog } = require("./safe-log");
const { createSessionStore } = require("./session-store");
const { ARTIFACT_SOURCE_REVISION } = require("./source-revision");

const PUBLIC_CODES = new Set([
  "authentication_failed",
  "body_invalid",
  "body_required",
  "body_timeout",
  "body_too_large",
  "body_unavailable",
  "configuration_invalid",
  "content_encoding_not_allowed",
  "content_length_invalid",
  "content_type_not_allowed",
  "context_conflict",
  "method_not_allowed",
  "request_invalid",
  "route_not_found",
  "service_unavailable",
  "session_not_found",
]);

function statusForError(error) {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) {
    return error.status;
  }
  return error?.publicCode === "configuration_invalid" ? 503 : 500;
}

function codeForError(error) {
  return PUBLIC_CODES.has(error?.publicCode) ? error.publicCode : "internal_error";
}

function sendJson(response, status, body) {
  const serialized = JSON.stringify(body);
  if (typeof response.status === "function") response.status(status);
  else response.statusCode = status;
  if (typeof response.setHeader === "function") {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store, max-age=0");
    response.setHeader("pragma", "no-cache");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
  }
  if (typeof response.send === "function") response.send(serialized);
  else if (typeof response.end === "function") response.end(serialized);
  else throw new Error("Catalyst response adapter is unavailable");
}

function readCatalystEnvironmentHeader(request) {
  const headers = request?.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    throw new ConfigurationError("Catalyst environment header is unavailable");
  }
  const matches = Object.entries(headers).filter(
    ([name]) => typeof name === "string" && name.toLowerCase() === "x-zc-environment",
  );
  if (matches.length !== 1 || typeof matches[0][1] !== "string") {
    throw new ConfigurationError("Catalyst environment header is unavailable");
  }
  const value = matches[0][1].trim().toLowerCase();
  if (value !== "development") {
    throw new ConfigurationError("Catalyst environment header is invalid");
  }
  return value;
}

function assertCatalystEnvironment(request, app, configuredEnvironment) {
  const headerEnvironment = readCatalystEnvironmentHeader(request);
  const sdkEnvironment = typeof app?.config?.environment === "string"
    ? app.config.environment.trim().toLowerCase()
    : "";
  if (
    sdkEnvironment !== "development" ||
    headerEnvironment !== sdkEnvironment ||
    sdkEnvironment !== configuredEnvironment
  ) {
    throw new ConfigurationError("Catalyst runtime environment does not match configuration");
  }
}

function createRequestListener({
  catalystSdk,
  environment = process.env,
  logger = console,
  now = Date.now,
  randomBytes = crypto.randomBytes,
  randomUUID = crypto.randomUUID,
  fetchImpl = globalThis.fetch,
  requestHandler = handleRequest,
  artifactSourceRevision = ARTIFACT_SOURCE_REVISION,
} = {}) {
  const runtimeSdk = catalystSdk ?? require("zcatalyst-sdk-node");
  return async function requestListener(request, response) {
    const startedAt = now();
    const requestId = randomUUID();
    try {
      const config = loadConfig(environment, artifactSourceRevision);
      readCatalystEnvironmentHeader(request);
      const app = runtimeSdk.initialize(request);
      assertCatalystEnvironment(request, app, config.deploymentEnvironment);
      const adapter = createCatalystDataStoreAdapter(app, config);
      const sessionStore = createSessionStore(adapter, config, { now });
      const crmClient = createCrmClient(config, {
        readAuthorizationProvider: createConnectionAuthorizationProvider(
          app,
          config.crmReadConnectionLinkName,
          config.platformOperationTimeoutMs,
        ),
        writeAuthorizationProvider: createConnectionAuthorizationProvider(
          app,
          config.crmWriteConnectionLinkName,
          config.platformOperationTimeoutMs,
        ),
        fetchImpl,
      });
      const result = await requestHandler(request, {
        config,
        crmClient,
        now,
        randomBytes,
        randomUUID,
        sessionStore,
      });
      safeLog(logger, result.status >= 500 ? "error" : "info", {
        requestId,
        stage: result.stage,
        outcome: result.outcome,
        elapsedMs: now() - startedAt,
      });
      sendJson(response, result.status, result.body);
    } catch (error) {
      const status = statusForError(error);
      const code = codeForError(error);
      safeLog(logger, status >= 500 ? "error" : "info", {
        requestId,
        stage: "request",
        outcome: code,
        elapsedMs: now() - startedAt,
      });
      sendJson(response, status, { ok: false, code, requestId });
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
