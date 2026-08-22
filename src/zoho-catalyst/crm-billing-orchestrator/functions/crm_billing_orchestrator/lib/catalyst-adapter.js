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

function readCatalystEnvironmentHeader(request) {
  const entries = Object.entries(request?.headers ?? {})
    .filter(([name]) => name.toLowerCase() === "x-zc-environment");
  if (entries.length !== 1 || typeof entries[0][1] !== "string") {
    throw new ConfigurationError("Catalyst environment header is unavailable");
  }
  const value = entries[0][1].trim().toLowerCase();
  if (value !== "development") {
    throw new ConfigurationError("Production activation is blocked in this source revision");
  }
  return value;
}

function assertCatalystEnvironment(request, app, configuredEnvironment) {
  const headerEnvironment = readCatalystEnvironmentHeader(request);
  const runtimeEnvironment = typeof app?.config?.environment === "string"
    ? app.config.environment.trim().toLowerCase()
    : "";
  if (
    configuredEnvironment !== "development" ||
    headerEnvironment !== "development" ||
    runtimeEnvironment !== "development"
  ) throw new ConfigurationError("Catalyst runtime is outside Development");
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
      const config = loadConfig(environment, artifactRevision ? { artifactRevision } : undefined);
      sourceRevision = config.sourceRevision;
      readCatalystEnvironmentHeader(request);
      const payload = await parseActionRequest(request, config);
      action = payload.action;
      const sdk = catalystSdk ?? require("zcatalyst-sdk-node");
      const app = sdk.initialize(request);
      assertCatalystEnvironment(request, app, config.deploymentEnvironment);

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
      const billingClient = makeBillingClient(config, {
        readAuthorizationProvider: billingRead,
        writeAuthorizationProvider: billingWrite,
        fetchImpl,
      });
      const operationStore = makeOperationStore(app, config);
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
  assertCatalystEnvironment,
  codeForError,
  createRequestListener,
  readCatalystEnvironmentHeader,
  sendJson,
  statusForError,
};
