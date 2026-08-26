"use strict";

const crypto = require("node:crypto");
const { createCatalystDataStoreAdapter } = require("./catalyst-datastore-adapter");
const { createCatalystMailAdapter } = require("./catalyst-mail");
const { createConnectionAuthorizationProvider } = require("./connection-boundary");
const { ConfigurationError, loadConfig } = require("./config");
const { createCrmClient } = require("./crm-client");
const {
  createDefaultDeniedFieldSetupOperationsComposition,
} = require("./field-setup-operations-composition");
const { handleForm2Request } = require("./handler");
const { safeLog } = require("./safe-log");
const { createCatalystSessionStore } = require("./session-store");
const { createWorkflowStore } = require("./workflow-store");
const { createVerificationProofStore } = require("./verification-proof-store");
const { createVerificationService } = require("./verification-service");

const PUBLIC_CODES = new Set([
  "authentication_failed",
  "body_invalid",
  "body_required",
  "body_timeout",
  "body_too_large",
  "body_unavailable",
  "configuration_invalid",
  "connection_unavailable",
  "content_length_invalid",
  "content_type_not_allowed",
  "context_conflict",
  "context_invalid",
  "context_mismatch",
  "form_invalid",
  "identity_mismatch",
  "method_not_allowed",
  "mobile_reverification_required",
  "prefill_consumed",
  "prefill_stale",
  "record_stale",
  "reconciliation_required",
  "relationship_mismatch",
  "request_invalid",
  "route_not_found",
  "service_unavailable",
  "session_not_found",
  "setup_not_found",
  "submission_conflict",
  "submission_unresolved",
  "unknown_field",
  "verification_required",
]);

function statusForError(error) {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) {
    return error.status;
  }
  const byCode = {
    authentication_failed: 401,
    body_timeout: 408,
    body_too_large: 413,
    configuration_invalid: 503,
    connection_unavailable: 503,
    context_conflict: 409,
    context_invalid: 409,
    context_mismatch: 409,
    identity_mismatch: 409,
    mobile_reverification_required: 409,
    prefill_consumed: 409,
    prefill_stale: 409,
    reconciliation_required: 503,
    relationship_mismatch: 409,
    session_not_found: 404,
    setup_not_found: 404,
    submission_conflict: 409,
    submission_unresolved: 409,
    verification_required: 403,
  };
  return byCode[error?.publicCode] ?? 500;
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

function sendControllerResult(response, result, requestId) {
  if (typeof result?.body !== "string") {
    // Field-setup operation bodies are an exact cross-function protocol shared
    // with the request-form web client. Do not append the legacy requestId field
    // to this lane; all other setup-form controller responses retain it.
    const body = result.stage === "field_setup_operations"
      ? result.body
      : { ...result.body, requestId };
    sendJson(response, result.status, body);
    return;
  }
  if (typeof response.status === "function") response.status(result.status);
  else response.statusCode = result.status;
  if (typeof response.setHeader === "function") {
    for (const [name, value] of Object.entries(result.headers ?? {})) {
      response.setHeader(name, value);
    }
  }
  if (typeof response.send === "function") response.send(result.body);
  else if (typeof response.end === "function") response.end(result.body);
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
  const value = matches[0][1].trim().toLowerCase();
  if (!new Set(["development", "production"]).has(value)) {
    throw new ConfigurationError("Catalyst runtime environment header is invalid");
  }
  return value;
}

function assertCatalystEnvironment(request, app, configuredEnvironment) {
  const headerEnvironment = readCatalystEnvironmentHeader(request);
  const sdkEnvironment = typeof app?.config?.environment === "string"
    ? app.config.environment.trim().toLowerCase()
    : "";
  if (
    headerEnvironment !== "development" ||
    sdkEnvironment !== "development" ||
    configuredEnvironment !== "development" ||
    headerEnvironment !== sdkEnvironment ||
    sdkEnvironment !== configuredEnvironment
  ) {
    throw new ConfigurationError("Catalyst runtime environment does not match Development");
  }
}

function createRequestListener({
  catalystSdk,
  environment = process.env,
  artifactSourceRevision,
  artifactFormDestinationSha256,
  logger = console,
  randomUUID = crypto.randomUUID,
  now = Date.now,
  fetchImpl = globalThis.fetch,
  requestHandler = handleForm2Request,
  fieldSetupOperationsComposition = createDefaultDeniedFieldSetupOperationsComposition(),
} = {}) {
  if (
    !fieldSetupOperationsComposition ||
    fieldSetupOperationsComposition.status !== "NOT_READY" ||
    fieldSetupOperationsComposition.catalystHeaderMapping !== "NOT_READY_INJECTED_ONLY" ||
    fieldSetupOperationsComposition.catalystIdentityMapping !== "NOT_READY_INJECTED_ONLY" ||
    fieldSetupOperationsComposition.catalystStoreMapping !== "NOT_READY_INJECTED_ONLY" ||
    fieldSetupOperationsComposition.deploymentAuthorized !== false ||
    fieldSetupOperationsComposition.runtimeAuthority !== false ||
    typeof fieldSetupOperationsComposition.claimsRequest !== "function" ||
    typeof fieldSetupOperationsComposition.dispatch !== "function" ||
    typeof fieldSetupOperationsComposition.assertNoRouteCollision !== "function"
  ) {
    throw new ConfigurationError("Field-setup operations composition is invalid");
  }
  // Keep the SDK load at the runtime boundary so pure policy tests can run
  // without installing deployment dependencies. Catalyst installs this exact
  // pinned package from package-lock.json for the deployed function.
  return async function requestListener(request, response) {
    const startedAt = now();
    const requestId = randomUUID();
    let sourceRevision = "unavailable";
    try {
      const config = loadConfig(
        environment,
        artifactSourceRevision,
        artifactFormDestinationSha256,
      );
      sourceRevision = config.sourceRevision;
      if (config.darkMode) {
        safeLog(logger, "info", {
          requestId,
          sourceRevision,
          stage: "request",
          outcome: "dark_mode",
          elapsedMs: now() - startedAt,
        });
        sendJson(response, 503, { ok: false, code: "connection_unavailable", requestId });
        return;
      }
      readCatalystEnvironmentHeader(request);
      const runtimeSdk = catalystSdk ?? require("zcatalyst-sdk-node");
      const app = runtimeSdk.initialize(request);
      assertCatalystEnvironment(request, app, config.deploymentEnvironment);
      fieldSetupOperationsComposition.assertNoRouteCollision([
        config.issuePath,
        config.accessPath,
        config.otpRequestPath,
        config.otpVerifyPath,
        config.prefillPath,
        config.submissionPath,
      ]);
      const operationsClaimed = fieldSetupOperationsComposition.claimsRequest(request);
      if (typeof operationsClaimed !== "boolean") {
        throw new ConfigurationError("Field-setup operation route claim is invalid");
      }
      let result;
      if (operationsClaimed) {
        result = await fieldSetupOperationsComposition.dispatch(request, { app });
      } else {
        // The committed default composition claims no operation routes, preserving
        // the six existing Form 2 paths until exact Development auth and stores are
        // separately injected and read back.
        const dataStoreAdapter = createCatalystDataStoreAdapter(app, config);
        const sessionStore = createCatalystSessionStore(dataStoreAdapter, config, { now });
        const workflowStore = createWorkflowStore(dataStoreAdapter, config, { now, randomUUID });
        const verificationProofStore = createVerificationProofStore(
          dataStoreAdapter,
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
        if (typeof requestHandler !== "function") {
          throw new ConfigurationError("Controller request handler is unavailable");
        }
        const verificationService = createVerificationService({
          config,
          crmClient,
          mailAdapter: createCatalystMailAdapter(app, config),
          proofStore: verificationProofStore,
          sessionStore,
          now,
          randomInt: crypto.randomInt,
          randomBytes: crypto.randomBytes,
        });
        result = await requestHandler(request, {
          config,
          crmClient,
          now,
          randomBytes: crypto.randomBytes,
          sessionStore,
          verificationService,
          workflowStore,
        });
      }
      safeLog(logger, result.status >= 500 ? "error" : "info", {
        requestId,
        sourceRevision,
        stage: result.stage,
        outcome: result.outcome,
        elapsedMs: now() - startedAt,
      });
      sendControllerResult(response, result, requestId);
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
  sendControllerResult,
  statusForError,
};
