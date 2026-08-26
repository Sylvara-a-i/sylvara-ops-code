"use strict";

const crypto = require("node:crypto");
const { createCatalystDataStoreAdapter } = require("./catalyst-datastore-adapter");
const { createConnectionAuthorizationProvider } = require("./connection-boundary");
const { ConfigurationError, loadConfig } = require("./config");
const { createCrmClient } = require("./crm-client");
const { createDefaultDeniedFieldSetupComposition } = require("./field-setup-composition");
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
  "reconciliation_required",
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

function sendJson(response, status, body, { setCookie } = {}) {
  const serialized = JSON.stringify(body);
  if (typeof response.status === "function") response.status(status);
  else response.statusCode = status;
  if (typeof response.setHeader === "function") {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store, max-age=0");
    response.setHeader("pragma", "no-cache");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    if (setCookie !== undefined) {
      if (
        typeof setCookie !== "string" ||
        setCookie.length > 4096 ||
        !/^__Host-sylvara_field_setup=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=[1-9][0-9]{1,3}; Secure; HttpOnly; SameSite=Strict$/.test(setCookie)
      ) {
        throw new ConfigurationError("Field-setup response cookie is invalid");
      }
      response.setHeader("set-cookie", setCookie);
    }
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
  fieldSetupComposition = createDefaultDeniedFieldSetupComposition(),
  artifactSourceRevision = ARTIFACT_SOURCE_REVISION,
} = {}) {
  if (
    !fieldSetupComposition ||
    fieldSetupComposition.status !== "NOT_READY" ||
    fieldSetupComposition.catalystHeaderMapping !== "NOT_READY_INJECTED_ONLY" ||
    fieldSetupComposition.catalystIdentityMapping !== "NOT_READY_INJECTED_ONLY" ||
    fieldSetupComposition.catalystStoreMapping !== "NOT_READY_INJECTED_ONLY" ||
    fieldSetupComposition.deploymentAuthorized !== false ||
    fieldSetupComposition.runtimeAuthority !== false ||
    typeof fieldSetupComposition.claimsRequest !== "function" ||
    typeof fieldSetupComposition.dispatch !== "function" ||
    typeof fieldSetupComposition.assertNoRouteCollision !== "function"
  ) {
    throw new ConfigurationError("Field-setup composition is invalid");
  }
  return async function requestListener(request, response) {
    const startedAt = now();
    const requestId = randomUUID();
    try {
      const config = loadConfig(environment, artifactSourceRevision);
      if (config.darkMode) {
        safeLog(logger, "info", {
          requestId,
          stage: "request",
          outcome: "dark_mode",
          elapsedMs: now() - startedAt,
        });
        sendJson(response, 503, { ok: false, code: "service_unavailable", requestId });
        return;
      }
      const runtimeSdk = catalystSdk ?? require("zcatalyst-sdk-node");
      readCatalystEnvironmentHeader(request);
      const app = runtimeSdk.initialize(request);
      assertCatalystEnvironment(request, app, config.deploymentEnvironment);
      fieldSetupComposition.assertNoRouteCollision([config.issuePath, config.prefillPath]);
      let result;
      const fieldSetupClaimed = fieldSetupComposition.claimsRequest(request);
      if (typeof fieldSetupClaimed !== "boolean") {
        throw new ConfigurationError("Field-setup route claim is invalid");
      }
      if (fieldSetupClaimed) {
        result = await fieldSetupComposition.dispatch(request, { app });
      } else {
        // Preserve the existing Form 1 dependency path exactly. The default field-setup
        // composition claims no routes, so issue/prefill continue through this branch only.
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
        result = await requestHandler(request, {
          config,
          crmClient,
          now,
          randomBytes,
          randomUUID,
          sessionStore,
        });
      }
      safeLog(logger, result.status >= 500 ? "error" : "info", {
        requestId,
        stage: result.stage,
        outcome: result.outcome,
        elapsedMs: now() - startedAt,
      });
      sendJson(response, result.status, result.body, { setCookie: result.setCookie });
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
