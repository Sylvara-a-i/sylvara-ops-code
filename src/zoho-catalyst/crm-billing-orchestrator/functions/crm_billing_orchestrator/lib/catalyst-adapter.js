"use strict";

const crypto = require("node:crypto");
const {
  DEVELOPMENT_COMPATIBILITY_PROBE_ACTION,
  RequestContractError,
  parseActionRequest,
} = require("./action-contract");
const { createBillingClient } = require("./billing-client");
const { createConnectionAuthorizationProvider } = require("./connection-boundary");
const { ConfigurationError, loadConfig } = require("./config");
const { createCrmClient } = require("./crm-client");
const { createOperationStore } = require("./idempotency");
const { createAnalyticsOutboxStore } = require("./analytics-outbox");
const { createLifecycleHandler } = require("./lifecycle-handler");
const {
  runDevelopmentCompatibilityProbe,
} = require("./development-compatibility-probe");
const { safeLog } = require("./safe-log");

const SHA256_HEX = /^[a-f0-9]{64}$/;
const PAID_LIFECYCLE_ACTIONS = new Set(["prepare_paid_subscription", "reconcile"]);

function validatedHeaderValue(values, maximumLength = 253) {
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new ConfigurationError("Catalyst runtime binding is unavailable");
  }
  const result = values[0];
  if (!result || result.length > maximumLength || /[\u0000-\u0020\u007f]/.test(result)) {
    throw new ConfigurationError("Catalyst runtime binding is invalid");
  }
  return result;
}

function readSingleHeader(request, headerName, maximumLength = 253) {
  const normalizedName = headerName.toLowerCase();
  const distinctEntries = Object.entries(request?.headersDistinct ?? {})
    .filter(([name]) => name.toLowerCase() === normalizedName);
  if (distinctEntries.length > 0) {
    if (distinctEntries.length !== 1 || !Array.isArray(distinctEntries[0][1])) {
      throw new ConfigurationError("Catalyst runtime binding is unavailable");
    }
    return validatedHeaderValue(distinctEntries[0][1], maximumLength);
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
    if (rawValues.length > 0) return validatedHeaderValue(rawValues, maximumLength);
  }

  const values = Object.entries(request?.headers ?? {})
    .filter(([name]) => name.toLowerCase() === normalizedName)
    .map(([, value]) => value);
  return validatedHeaderValue(values, maximumLength);
}

function equalHexDigest(left, right) {
  if (!SHA256_HEX.test(left) || !SHA256_HEX.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function matchesArtifactDevelopmentZaid(projectKey, config) {
  if (
    typeof projectKey !== "string" || !projectKey || projectKey.length > 253 ||
    /[\u0000-\u0020\u007f]/.test(projectKey)
  ) return false;
  const actualHmac = crypto
    .createHmac("sha256", config.developmentRuntimeProof)
    .update(projectKey, "utf8")
    .digest("hex");
  return equalHexDigest(actualHmac, config.artifactDevelopmentZaidHmacSha256);
}

function assertDevelopmentHostAuthority(authority, configuredHost) {
  if (typeof authority !== "string" || typeof configuredHost !== "string") {
    throw new ConfigurationError("Catalyst runtime is outside the approved Development host");
  }
  const defaultPortSuffix = ":443";
  const hostname = authority.endsWith(defaultPortSuffix)
    ? authority.slice(0, -defaultPortSuffix.length)
    : authority;
  if (hostname.toLowerCase() !== configuredHost) {
    throw new ConfigurationError("Catalyst runtime is outside the approved Development host");
  }
}

function assertCatalystRequestBinding(request, config) {
  if (config.deploymentEnvironment !== "development") {
    throw new ConfigurationError("Production activation is blocked in this source revision");
  }
  assertDevelopmentHostAuthority(
    readSingleHeader(request, "host", 257),
    config.developmentFunctionHost,
  );
  const developmentZaid = readSingleHeader(request, "x-zc-project-key");
  if (!matchesArtifactDevelopmentZaid(developmentZaid, config)) {
    throw new ConfigurationError("Catalyst runtime is outside the approved Development project");
  }
  return developmentZaid;
}

function assertCatalystSdkBinding(app, preSdkDevelopmentZaid, config) {
  const sdkProjectKey = typeof app?.config?.projectKey === "string"
    ? app.config.projectKey
    : "";
  const sdkEnvironment = typeof app?.config?.environment === "string"
    ? app.config.environment.trim().toLowerCase()
    : "";
  if (
    !matchesArtifactDevelopmentZaid(sdkProjectKey, config) ||
    sdkProjectKey !== preSdkDevelopmentZaid ||
    sdkEnvironment !== "development"
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
  const makeAnalyticsOutboxStore = factories.createAnalyticsOutboxStore
    ?? createAnalyticsOutboxStore;
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
      if (config.darkMode) {
        safeLog(logger, "info", {
          requestId,
          sourceRevision,
          stage: "request",
          action: "unknown",
          outcome: "dark_mode",
          elapsedMs: now() - startedAt,
        });
        sendJson(response, 503, {
          ok: false,
          code: "service_unavailable",
          request_id: requestId,
        });
        return;
      }
      const preSdkDevelopmentZaid = assertCatalystRequestBinding(request, config);
      const payload = await parseActionRequest(request, config);
      action = payload.action;
      if (PAID_LIFECYCLE_ACTIONS.has(action) && !config.enablePaidSubscriptionPreparation) {
        throw new RequestContractError(
          "Paid lifecycle actions are disabled",
          409,
          "operation_invalid",
        );
      }
      if (action === DEVELOPMENT_COMPATIBILITY_PROBE_ACTION) {
        if (!config.enableDevelopmentCompatibilityProbe) {
          throw new RequestContractError(
            "Development compatibility probe is disabled",
            409,
            "operation_invalid",
          );
        }
        const result = runDevelopmentCompatibilityProbe(config, payload.case);
        stage = "readback";
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
          compatibility_case: result.compatibilityCase,
          report_summary_schema_version: result.reportSummarySchemaVersion,
          workflow_failure_mapping: result.workflowFailureMapping,
          request_id: requestId,
        });
        return;
      }
      const sdk = catalystSdk ?? require("zcatalyst-sdk-node");
      const app = sdk.initialize(request);
      assertCatalystSdkBinding(app, preSdkDevelopmentZaid, config);

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
      const analyticsOutbox = makeAnalyticsOutboxStore(app, config);
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
        analyticsOutbox,
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
  assertDevelopmentHostAuthority,
  assertCatalystRequestBinding,
  assertCatalystSdkBinding,
  codeForError,
  createRequestListener,
  equalHexDigest,
  readSingleHeader,
  sendJson,
  statusForError,
};
