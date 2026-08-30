"use strict";

const crypto = require("node:crypto");
const { createCatalystDataStoreAdapter } = require("./catalyst-datastore-adapter");
const { createConnectionAuthorizationProvider } = require("./connection-boundary");
const { ConfigurationError, loadConfig } = require("./config");
const { createCrmClient } = require("./crm-client");
const { authenticateRequest, handleRequest, normalizeError } = require("./handler");
const { safeLog } = require("./safe-log");
const { createSessionStore } = require("./session-store");
const { ARTIFACT_SOURCE_REVISION } = require("./source-revision");

const CATALYST_PROJECT_ID_PATTERN = /^[1-9][0-9]{0,29}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const PUBLIC_CODES = new Set([
  "authentication_failed", "body_invalid", "body_required", "body_timeout", "body_too_large",
  "body_unavailable", "configuration_invalid", "content_encoding_not_allowed",
  "content_length_invalid", "content_type_not_allowed", "context_conflict",
  "form_data_invalid", "method_not_allowed", "record_stale", "request_invalid",
  "route_not_found", "session_binding_conflict", "session_consumed", "session_not_found",
  "session_state_invalid", "submission_conflict",
]);

function statusForError(error) {
  return Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : error?.publicCode === "configuration_invalid" ? 503 : 500;
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

function headerValues(request, headerName) {
  const normalizedName = headerName.toLowerCase();
  const distinct = Object.entries(request?.headersDistinct ?? {})
    .filter(([name]) => name.toLowerCase() === normalizedName);
  if (distinct.length > 0) {
    return distinct.length === 1 && Array.isArray(distinct[0][1]) ? distinct[0][1] : [];
  }
  if (Array.isArray(request?.rawHeaders)) {
    if (request.rawHeaders.length % 2 !== 0) return [];
    const values = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (typeof request.rawHeaders[index] === "string" &&
          request.rawHeaders[index].toLowerCase() === normalizedName) {
        values.push(request.rawHeaders[index + 1]);
      }
    }
    if (values.length > 0) return values;
  }
  return Object.entries(request?.headers ?? {})
    .filter(([name]) => name.toLowerCase() === normalizedName)
    .map(([, value]) => value);
}

function readCatalystEnvironmentHeader(request) {
  const values = headerValues(request, "x-zc-environment");
  if (values.length !== 1 || typeof values[0] !== "string" ||
      values[0].trim().toLowerCase() !== "development") {
    throw new ConfigurationError("Catalyst environment header is unavailable");
  }
  return "development";
}

function readCatalystProjectIdHeader(request) {
  const values = headerValues(request, "x-zc-projectid");
  if (values.length !== 1 || typeof values[0] !== "string" ||
      !CATALYST_PROJECT_ID_PATTERN.test(values[0])) {
    throw new ConfigurationError("Catalyst project identity header is unavailable");
  }
  return values[0];
}

function matchesExpectedProjectId(projectId, expectedSha256) {
  if (!CATALYST_PROJECT_ID_PATTERN.test(projectId) ||
      !SHA256_HEX_PATTERN.test(expectedSha256)) return false;
  return crypto.timingSafeEqual(
    crypto.createHash("sha256").update(projectId, "utf8").digest(),
    Buffer.from(expectedSha256, "hex"),
  );
}

function assertCatalystRequestBinding(request, config) {
  if (readCatalystEnvironmentHeader(request) !== config?.deploymentEnvironment) {
    throw new ConfigurationError("Catalyst runtime environment does not match configuration");
  }
  const projectId = readCatalystProjectIdHeader(request);
  if (!matchesExpectedProjectId(projectId, config.expectedCatalystProjectIdSha256)) {
    throw new ConfigurationError("Catalyst runtime project does not match configuration");
  }
  return projectId;
}

function assertCatalystSdkBinding(app, projectId, config) {
  const sdkEnvironment = String(app?.config?.environment ?? "").trim().toLowerCase();
  const sdkProjectId = String(app?.config?.projectId ?? "");
  if (sdkEnvironment !== "development" || sdkEnvironment !== config.deploymentEnvironment ||
      sdkProjectId !== projectId ||
      !matchesExpectedProjectId(sdkProjectId, config.expectedCatalystProjectIdSha256)) {
    throw new ConfigurationError("Catalyst SDK binding does not match configuration");
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
  return async function requestListener(request, response) {
    const startedAt = now();
    const requestId = randomUUID();
    try {
      const config = loadConfig(environment, artifactSourceRevision);
      if (config.darkMode) {
        safeLog(logger, "info", {
          requestId, stage: "request", outcome: "dark_mode", elapsedMs: now() - startedAt,
        });
        sendJson(response, 503, { ok: false, code: "service_unavailable", requestId });
        return;
      }
      const projectId = assertCatalystRequestBinding(request, config);
      // Authenticate the exact route before SDK, Data Store, Connection, body,
      // CRM, or outbound access. The controller repeats the check at dispatch.
      authenticateRequest(request, config);
      const runtimeSdk = catalystSdk ?? require("zcatalyst-sdk-node");
      const app = runtimeSdk.initialize(request);
      assertCatalystSdkBinding(app, projectId, config);
      const sessionStore = createSessionStore(
        createCatalystDataStoreAdapter(app, config),
        config,
        { now },
      );
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
        sessionStore,
      });
      safeLog(logger, result.status >= 500 ? "error" : "info", {
        requestId, stage: result.stage, outcome: result.outcome, elapsedMs: now() - startedAt,
      });
      sendJson(response, result.status, result.body);
    } catch (rawError) {
      const error = normalizeError(rawError);
      const status = statusForError(error);
      const code = codeForError(error);
      safeLog(logger, status >= 500 ? "error" : "info", {
        requestId, stage: "request", outcome: code, elapsedMs: now() - startedAt,
      });
      sendJson(response, status, { ok: false, code, requestId });
    }
  };
}

module.exports = {
  assertCatalystRequestBinding,
  assertCatalystSdkBinding,
  codeForError,
  createRequestListener,
  readCatalystEnvironmentHeader,
  readCatalystProjectIdHeader,
  sendJson,
  statusForError,
};
