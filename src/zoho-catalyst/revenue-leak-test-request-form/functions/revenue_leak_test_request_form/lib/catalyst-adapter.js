"use strict";

const crypto = require("node:crypto");
const { ConfigurationError, loadConfig } = require("./config");
const { handleRequest } = require("./handler");
const { safeLog } = require("./safe-log");
const { ARTIFACT_SOURCE_REVISION } = require("./source-revision");

const CATALYST_PROJECT_ID_PATTERN = /^[1-9][0-9]{0,29}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

const PUBLIC_CODES = new Set([
  "authentication_failed",
  "configuration_invalid",
  "content_encoding_not_allowed",
  "content_type_not_allowed",
  "method_not_allowed",
  "route_not_found",
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

function headerValues(request, headerName) {
  const normalizedName = headerName.toLowerCase();
  const distinctEntries = Object.entries(request?.headersDistinct ?? {})
    .filter(([name]) => name.toLowerCase() === normalizedName);
  if (distinctEntries.length > 0) {
    return distinctEntries.length === 1 && Array.isArray(distinctEntries[0][1])
      ? distinctEntries[0][1]
      : [];
  }

  if (Array.isArray(request?.rawHeaders)) {
    if (request.rawHeaders.length % 2 !== 0) return [];
    const rawValues = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (
        typeof request.rawHeaders[index] === "string" &&
        request.rawHeaders[index].toLowerCase() === normalizedName
      ) rawValues.push(request.rawHeaders[index + 1]);
    }
    if (rawValues.length > 0) return rawValues;
  }

  return Object.entries(request?.headers ?? {})
    .filter(([name]) => name.toLowerCase() === normalizedName)
    .map(([, value]) => value);
}

function readCatalystProjectIdHeader(request) {
  const values = headerValues(request, "x-zc-projectid");
  if (
    values.length !== 1 ||
    typeof values[0] !== "string" ||
    !CATALYST_PROJECT_ID_PATTERN.test(values[0])
  ) {
    throw new ConfigurationError("Catalyst project identity header is unavailable");
  }
  return values[0];
}

function matchesExpectedProjectId(projectId, expectedSha256) {
  if (
    !CATALYST_PROJECT_ID_PATTERN.test(projectId) ||
    !SHA256_HEX_PATTERN.test(expectedSha256)
  ) return false;
  const actual = crypto.createHash("sha256").update(projectId, "utf8").digest();
  return crypto.timingSafeEqual(actual, Buffer.from(expectedSha256, "hex"));
}

function assertCatalystRequestBinding(request, config) {
  const headerEnvironment = readCatalystEnvironmentHeader(request);
  if (
    headerEnvironment !== "development" ||
    config?.deploymentEnvironment !== "development"
  ) {
    throw new ConfigurationError("Catalyst runtime environment does not match configuration");
  }
  const requestProjectId = readCatalystProjectIdHeader(request);
  if (!matchesExpectedProjectId(requestProjectId, config.expectedCatalystProjectIdSha256)) {
    throw new ConfigurationError("Catalyst runtime project does not match configuration");
  }
  return requestProjectId;
}

function createRequestListener({
  environment = process.env,
  logger = console,
  now = Date.now,
  randomUUID = crypto.randomUUID,
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
          requestId,
          stage: "request",
          outcome: "dark_mode",
          elapsedMs: now() - startedAt,
        });
        sendJson(response, 503, { ok: false, code: "service_unavailable", requestId });
        return;
      }

      assertCatalystRequestBinding(request, config);
      const result = await requestHandler(request, { config });
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
  assertCatalystRequestBinding,
  codeForError,
  createRequestListener,
  readCatalystEnvironmentHeader,
  readCatalystProjectIdHeader,
  sendJson,
  statusForError,
};
