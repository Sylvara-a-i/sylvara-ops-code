"use strict";

const crypto = require("node:crypto");
const { parseActionRequest } = require("./action-contract");
const { createBillingClient } = require("./billing-client");
const { createConnectionAuthorizationProvider } = require("./connection-boundary");
const { ConfigurationError, loadConfig } = require("./config");
const { createCrmClient } = require("./crm-client");
const { createOperationStore } = require("./idempotency");
const { createLifecycleHandler } = require("./lifecycle-handler");
const { safeLog } = require("./safe-log");

const SHA256_HEX = /^[a-f0-9]{64}$/;

function validatedHeaderValue(values) {
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new ConfigurationError("Catalyst runtime binding is unavailable");
  }
  const result = values[0].trim();
  if (!result || result.length > 253 || /[\u0000-\u0020\u007f]/.test(result)) {
    throw new ConfigurationError("Catalyst runtime binding is invalid");
  }
  return result;
}

function readSingleHeader(request, headerName) {
  const normalizedName = headerName.toLowerCase();
  const distinctEntries = Object.entries(request?.headersDistinct ?? {})
    .filter(([name]) => name.toLowerCase() === normalizedName);
  if (distinctEntries.length > 0) {
    if (distinctEntries.length !== 1 || !Array.isArray(distinctEntries[0][1])) {
      throw new ConfigurationError("Catalyst runtime binding is unavailable");
    }
    return validatedHeaderValue(distinctEntries[0][1]);
  }

  const rawHeaders = request?.rawHeaders;
  if (Array.isArray(rawHeaders)) {
    if (rawHeaders.length % 2 !== 0) {
      throw new ConfigurationError("Catalyst runtime binding is unavailable");
    }
    const rawValues = [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (
        typeof rawHeaders[index] === "string" &&
        rawHeaders[index].toLowerCase() === normalizedName
      ) rawValues.push(rawHeaders[index + 1]);
    }
    if (rawValues.length > 0) return validatedHeaderValue(rawValues);
  }

  const values = Object.entries(request?.headers ?? {})
    .filter(([name]) => name.toLowerCase() === normalizedName)
    .map(([, value]) => value);
  return validatedHeaderValue(values);
}

function equalHexDigest(left, right) {
  if (!SHA256_HEX.test(left) || !SHA256_HEX.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function assertCatalystRequestBinding(request, config) {
  if (config.deploymentEnvironment !== "development") {
    throw new ConfigurationError("Production activation is blocked in this source revision");
  }
  const host = readSingleHeader(request, "host").toLowerCase();
  if (host !== config.developmentFunctionHost) {
    throw new ConfigurationError("Catalyst runtime is outside the approved Development host");
  }
  const developmentZaid = readSingleHeader(request, "x-zc-project-key");
  const actualHmac = crypto
    .createHmac("sha256", config.developmentRuntimeProof)
    .update(developmentZaid, "utf8")
    .digest("hex");
  if (!equalHexDigest(actualHmac, config.artifactDevelopmentZaidHmacSha256)) {
    throw new ConfigurationError("Catalyst runtime is outside the approved Development project");
  }
  return developmentZaid;
}

function assertCatalystSdkBinding(app, expectedDevelopmentZaid) {
  const sdkProjectKey = typeof app?.config?.projectKey === "string"
    ? app.config.projectKey
    : "";
  const sdkEnvironment = typeof app?.config?.environment === "string"
    ? app.config.environment
    : "";
  if (
    !sdkProjectKey || sdkProjectKey !== expectedDevelopmentZaid ||
    sdkEnvironment !== "Development"
  ) {
    throw new ConfigurationError("Catalyst SDK routing binding is invalid");
  }
}

function statusForError(error) {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) {
    return error.status;
  }
  return error?.ambiguous ? 503 : 500;
}

function codeForError(error) {
  const allowed = new Set([
    "authentication_failed",
    "billing_dependency_failed",
    "billing_rejected",
    "billing_state_invalid",
    "body_too_large",
    "configuration_invalid",
    "connection_unavailable",
    "content_type_not_allowed",
    "crm_dependency_failed",
    "crm_rejected",
    "crm_state_invalid",
    "dependency_timeout",
    "idempotency_unavailable",
    "lifecycle_state_invalid",
    "method_not_allowed",
    "operation_invalid",
    "record_stale",
    "reconciliation_required",
    "request_invalid",
    "route_not_found",
  ]);
  return allowed.has(error?.publicCode) ? error.publicCode : "internal_error";
}

function sendJson(response, status, body) {
  const serialized = JSON.stringify(body);
  if (typeof response.status === "function") response.status(status);
  else response.statusCode = status;
  response.setHeader?.("content-type", "application/json; charset=utf-8");
  response.setHeader?.("cache-control", "no-store");
  if (typeof response.send === "function") response.send(serialized);
  else if (typeof response.end === "function") response.end(serialized);
  else throw new Error("Catalyst response adapter is unavailable");
}

function createRequestListener({
  catalystSdk = null,
  environment = process.env,
  logger = console,
  randomUUID = crypto.randomUUID,
  now = Date.now,
  fetchImpl = globalThis.fetch,
  artifactRevision,
  artifactDevelopmentZaidHmacSha256,
  factories = {},
} = {}) {
  const makeCrmClient = factories.createCrmClient ?? createCrmClient;
  const makeBillingClient = factories.createBillingClient ?? createBillingClient;
  const makeOperationStore = factories.createOperationStore ?? createOperationStore;
  const makeLifecycleHandler = factories.createLifecycleHandler ?? createLifecycleHandler;

  return async function requestListener(request, response) {
    const startedAt = now();
    const requestId = randomUUID();
    let sourceRevision = "unavailable";
    let action = "unknown";
    let stage = "request";
    try {
      const config = loadConfig(environment, {
        artifactRevision,
        artifactDevelopmentZaidHmacSha256,
      });
      sourceRevision = config.sourceRevision;
      const expectedDevelopmentZaid = assertCatalystRequestBinding(request, config);
      const payload = await parseActionRequest(request, config);
      action = payload.action;
      const sdk = catalystSdk ?? require("zcatalyst-sdk-node");
      const app = sdk.initialize(request);
      assertCatalystSdkBinding(app, expectedDevelopmentZaid);

      const crmRead = createConnectionAuthorizationProvider(
        app,
        config.crmReadConnectionLinkName,
        config.platformOperationTimeoutMs,
      );
      const crmWrite = createConnectionAuthorizationProvider(
        app,
        config.crmWriteConnectionLinkName,
        config.platformOperationTimeoutMs,
      );
      const billingRead = createConnectionAuthorizationProvider(
        app,
        config.billingReadConnectionLinkName,
        config.platformOperationTimeoutMs,
      );
      const billingWrite = createConnectionAuthorizationProvider(
        app,
        config.billingWriteConnectionLinkName,
        config.platformOperationTimeoutMs,
      );
      const crmClient = makeCrmClient(config, {
        readAuthorizationProvider: crmRead,
        writeAuthorizationProvider: crmWrite,
        fetchImpl,
      });
      const operationStore = makeOperationStore(app, config);
      const billingClient = makeBillingClient(config, {
        readAuthorizationProvider: billingRead,
        writeAuthorizationProvider: billingWrite,
        operationStore,
        fetchImpl,
      });
      const lifecycle = makeLifecycleHandler(config, {
        crmClient,
        billingClient,
        operationStore,
        now,
      });
      stage = "readback";
      const result = await lifecycle.handle(payload);
      safeLog(logger, "info", {
        requestId,
        sourceRevision,
        stage,
        action,
        outcome: result.outcome,
        elapsedMs: now() - startedAt,
      });
      sendJson(response, 200, {
        ok: true,
        action,
        outcome: result.outcome,
        duplicate: result.duplicate,
        request_id: requestId,
      });
    } catch (error) {
      const status = statusForError(error);
      const code = codeForError(error);
      safeLog(logger, status >= 500 ? "error" : "info", {
        requestId,
        sourceRevision,
        stage,
        action,
        outcome: code,
        elapsedMs: now() - startedAt,
      });
      sendJson(response, status, { ok: false, code, request_id: requestId });
    }
  };
}

module.exports = {
  assertCatalystRequestBinding,
  assertCatalystSdkBinding,
  codeForError,
  createRequestListener,
  equalHexDigest,
  readSingleHeader,
  sendJson,
  statusForError,
};
