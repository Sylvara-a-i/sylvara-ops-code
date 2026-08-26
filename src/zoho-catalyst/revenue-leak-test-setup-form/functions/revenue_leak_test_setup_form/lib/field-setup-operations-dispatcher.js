"use strict";

const crypto = require("node:crypto");
const {
  FORWARDING_STATES,
  FieldSetupOperationError,
  NUMBER_STATES,
  ROUTE_VERIFICATION_WINDOW_FIELDS,
  ROUTE_WINDOW_TTL_MS,
  applyBrowserSetupControl,
  issueRouteVerificationWindow,
  readExistingNumberReservationStatus,
  reserveExistingAvailableNumber,
  resolveForwardingInstructions,
  setupControlBindingFingerprint,
  setupControlFenceFingerprint,
  setupControlScopeFingerprint,
} = require("./field-setup-operations");
const {
  HttpBoundaryError,
  getHeader,
  parseJsonObject,
  parseRequestPath,
  readRawBody,
  validateJsonPost,
} = require("./http");

const SESSION_COOKIE_NAME = "__Host-sylvara_field_setup";
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const PATH_PATTERN = /^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/;
const HEADER_PATTERN = /^x-[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const FIELD_SETUP_PROTOCOL_ID = "free_revenue_leak_test_field_setup_v1";
const FIELD_SETUP_PROTOCOL_VERSION = 1;
const PROTOCOL_ID_HEADER = "x-sylvara-field-setup-protocol-id";
const PROTOCOL_VERSION_HEADER = "x-sylvara-field-setup-protocol-version";
const ROUTE_KEYS = Object.freeze([
  "numberStatusPath",
  "numberClaimPath",
  "forwardingInstructionsPath",
  "routeVerificationWindowPath",
  "setupControlPath",
]);
const CONFIG_KEYS = Object.freeze([
  "bodyTimeoutMs",
  "csrfHeaderName",
  "csrfPepper",
  "deploymentAuthorized",
  "environment",
  "maxBodyBytes",
  "routes",
  "runtimeAuthority",
  "status",
  "webClientOrigin",
]);
const CONTEXT_KEYS = Object.freeze([
  "approvedQaCallerFingerprint",
  "clientFingerprint",
  "configurationFingerprint",
  "controlRevision",
  "deploymentFingerprint",
  "environment",
  "environmentFingerprint",
  "forwardingState",
  "instructionEvidenceFingerprint",
  "journeyFingerprint",
  "journeyRevision",
  "latestControlOperationFingerprint",
  "numberFingerprint",
  "numberState",
  "operatorFingerprint",
  "providerFingerprint",
  "rollbackReady",
  "routeFingerprint",
  "sessionFingerprint",
  "setupStatus",
]);
const CONTROL_RECORD_KEYS = Object.freeze([
  "operationFingerprint",
  "bindingFingerprint",
  "controlScopeFingerprint",
  "previousControlFenceFingerprint",
  "controlFenceFingerprint",
  "action",
  "previousControlRevision",
  "controlRevision",
  "previousSetupStatus",
  "setupStatus",
  "previousForwardingState",
  "forwardingState",
  "previousInstructionEvidenceFingerprint",
  "instructionEvidenceFingerprint",
  "previousRollbackReady",
  "rollbackReady",
  "configurationFingerprint",
  "numberFingerprint",
  "providerFingerprint",
  "routeFingerprint",
  "activateDeployment",
  "mutateLiveRoute",
  "committedAt",
]);
const RESERVATION_RECEIPT_KEYS = Object.freeze([
  "operationFingerprint",
  "bindingFingerprint",
  "numberFingerprint",
  "state",
  "controlScopeFingerprint",
  "previousControlFenceFingerprint",
  "controlFenceFingerprint",
  "claimedAt",
]);

class FieldSetupOperationsDispatchError extends Error {
  constructor(message, { status = 503, publicCode = "service_unavailable" } = {}) {
    super(message);
    this.name = "FieldSetupOperationsDispatchError";
    this.status = status;
    this.publicCode = publicCode;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label, errorOptions = {}) {
  if (!isPlainObject(value)) {
    throw new FieldSetupOperationsDispatchError(`${label} must be a plain object`, errorOptions);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => (
      typeof key !== "string" ||
      ["__proto__", "constructor", "prototype"].includes(key) ||
      !expected.includes(key)
    )) ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new FieldSetupOperationsDispatchError(
      `${label} does not match the approved contract`,
      errorOptions,
    );
  }
  return value;
}

function normalizeConfig(value) {
  exactKeys(value, CONFIG_KEYS, "Field-setup operations configuration", {
    publicCode: "configuration_invalid",
  });
  if (
    value.status !== "NOT_READY" ||
    value.runtimeAuthority !== false ||
    value.deploymentAuthorized !== false ||
    value.environment !== "development" ||
    !Number.isSafeInteger(value.maxBodyBytes) ||
    value.maxBodyBytes < 512 ||
    value.maxBodyBytes > 32768 ||
    !Number.isSafeInteger(value.bodyTimeoutMs) ||
    value.bodyTimeoutMs < 250 ||
    value.bodyTimeoutMs > 15000 ||
    typeof value.csrfHeaderName !== "string" ||
    !HEADER_PATTERN.test(value.csrfHeaderName) ||
    typeof value.csrfPepper !== "string" ||
    Buffer.byteLength(value.csrfPepper, "utf8") < 32 ||
    Buffer.byteLength(value.csrfPepper, "utf8") > 256 ||
    !/^[\x21-\x7e]+$/.test(value.csrfPepper)
  ) {
    throw new FieldSetupOperationsDispatchError(
      "Field-setup operations configuration is invalid",
      { publicCode: "configuration_invalid" },
    );
  }

  exactKeys(value.routes, ROUTE_KEYS, "Field-setup operations routes", {
    publicCode: "configuration_invalid",
  });
  const routeValues = ROUTE_KEYS.map((key) => value.routes[key]);
  if (
    routeValues.some((path) => (
      typeof path !== "string" ||
      !PATH_PATTERN.test(path) ||
      path.includes("//") ||
      path.endsWith("/")
    )) ||
    new Set(routeValues).size !== routeValues.length
  ) {
    throw new FieldSetupOperationsDispatchError(
      "Field-setup operation route configuration is invalid",
      { publicCode: "configuration_invalid" },
    );
  }

  let webClientOrigin;
  try {
    webClientOrigin = new URL(value.webClientOrigin);
  } catch {
    throw new FieldSetupOperationsDispatchError(
      "Field-setup operations origin is invalid",
      { publicCode: "configuration_invalid" },
    );
  }
  if (
    webClientOrigin.protocol !== "https:" ||
    webClientOrigin.username ||
    webClientOrigin.password ||
    webClientOrigin.port ||
    webClientOrigin.pathname !== "/" ||
    webClientOrigin.search ||
    webClientOrigin.hash
  ) {
    throw new FieldSetupOperationsDispatchError(
      "Field-setup operations origin is invalid",
      { publicCode: "configuration_invalid" },
    );
  }

  return Object.freeze({
    ...value,
    routes: Object.freeze({ ...value.routes }),
    webClientOrigin: webClientOrigin.origin,
  });
}

function normalizeFingerprint(value, label, { optional = false } = {}) {
  if (optional && value === null) return null;
  if (typeof value !== "string" || !FINGERPRINT_PATTERN.test(value)) {
    throw new FieldSetupOperationsDispatchError(`${label} is invalid`, {
      publicCode: "configuration_invalid",
    });
  }
  return value;
}

function normalizeContext(value) {
  exactKeys(value, CONTEXT_KEYS, "Authenticated setup context", {
    publicCode: "configuration_invalid",
  });
  for (const key of [
    "clientFingerprint",
    "configurationFingerprint",
    "deploymentFingerprint",
    "environmentFingerprint",
    "journeyFingerprint",
    "operatorFingerprint",
    "providerFingerprint",
    "sessionFingerprint",
  ]) {
    normalizeFingerprint(value[key], key);
  }
  for (const key of [
    "approvedQaCallerFingerprint",
    "instructionEvidenceFingerprint",
    "latestControlOperationFingerprint",
    "numberFingerprint",
    "routeFingerprint",
  ]) {
    normalizeFingerprint(value[key], key, { optional: true });
  }
  if (
    value.environment !== "development" ||
    !Number.isSafeInteger(value.journeyRevision) ||
    value.journeyRevision < 1 ||
    !Number.isSafeInteger(value.controlRevision) ||
    value.controlRevision < 0 ||
    typeof value.rollbackReady !== "boolean" ||
    !["in_progress", "stopped"].includes(value.setupStatus) ||
    (value.numberState !== null && !Object.hasOwn(NUMBER_STATES, value.numberState)) ||
    !Object.hasOwn(FORWARDING_STATES, value.forwardingState)
  ) {
    throw new FieldSetupOperationsDispatchError(
      "Authenticated setup context is invalid",
      { publicCode: "configuration_invalid" },
    );
  }
  return Object.freeze({ ...value });
}

function candidatePath(request) {
  try {
    return new URL(
      String(request?.url ?? request?.originalUrl ?? ""),
      "https://field-setup-operations.invalid",
    ).pathname;
  } catch {
    return null;
  }
}

function assertSameOrigin(request, expectedOrigin, { allowMissingOrigin = false } = {}) {
  const origin = getHeader(request, "origin");
  if (
    (origin !== expectedOrigin && !(allowMissingOrigin && origin === undefined)) ||
    getHeader(request, "sec-fetch-site") !== "same-origin"
  ) {
    throw new FieldSetupOperationsDispatchError(
      "Field-setup browser origin is not authorized",
      { status: 403, publicCode: "authentication_failed" },
    );
  }
}

function assertProtocolHeaders(request) {
  if (
    getHeader(request, PROTOCOL_ID_HEADER) !== FIELD_SETUP_PROTOCOL_ID ||
    getHeader(request, PROTOCOL_VERSION_HEADER) !== String(FIELD_SETUP_PROTOCOL_VERSION)
  ) {
    throw new FieldSetupOperationsDispatchError(
      "Field-setup protocol is incompatible",
      { status: 409, publicCode: "context_conflict" },
    );
  }
}

function readSessionCookie(request) {
  const rawCookie = getHeader(request, "cookie");
  if (
    typeof rawCookie !== "string" ||
    rawCookie.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(rawCookie)
  ) {
    throw new FieldSetupOperationsDispatchError("Field-setup session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  const matches = rawCookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (matches.length !== 1) {
    throw new FieldSetupOperationsDispatchError("Field-setup session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  const token = matches[0].slice(SESSION_COOKIE_NAME.length + 1);
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    throw new FieldSetupOperationsDispatchError("Field-setup session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  return token;
}

function csrfToken(sessionToken, pepper) {
  return crypto
    .createHmac("sha256", pepper)
    // Reuse the launch composition's exact session-derived CSRF namespace so
    // one authenticated field-setup session can cross the two function owners.
    .update(`sylvara.field-setup.csrf.v1\0${sessionToken}`, "utf8")
    .digest("base64url");
}

function verifyCsrf(request, sessionToken, config) {
  const supplied = getHeader(request, config.csrfHeaderName);
  const expected = csrfToken(sessionToken, config.csrfPepper);
  if (
    typeof supplied !== "string" ||
    !CSRF_TOKEN_PATTERN.test(supplied) ||
    !crypto.timingSafeEqual(Buffer.from(supplied, "utf8"), Buffer.from(expected, "utf8"))
  ) {
    throw new FieldSetupOperationsDispatchError("Field-setup CSRF validation failed", {
      status: 403,
      publicCode: "authentication_failed",
    });
  }
}

function assertBodylessGet(request, path) {
  if (String(request?.method ?? "").toUpperCase() !== "GET") {
    throw new HttpBoundaryError("Method is not approved", {
      status: 405,
      publicCode: "method_not_allowed",
    });
  }
  if (parseRequestPath(request) !== path) {
    throw new HttpBoundaryError("Route is not approved", {
      status: 404,
      publicCode: "route_not_found",
    });
  }
  const contentLength = getHeader(request, "content-length");
  if (
    (contentLength !== undefined && contentLength !== "0") ||
    (Buffer.isBuffer(request?.rawBody) && request.rawBody.length !== 0)
  ) {
    throw new HttpBoundaryError("GET body is prohibited", {
      status: 400,
      publicCode: "body_invalid",
    });
  }
}

function operationFingerprint(context, routeId, action = "read") {
  const parts = [
    ["route", routeId],
    ["action", action],
    ["operator", context.operatorFingerprint],
    ["session", context.sessionFingerprint],
    ["client", context.clientFingerprint],
    ["environment", context.environmentFingerprint],
    ["journey", context.journeyFingerprint],
    ["deployment", context.deploymentFingerprint],
    ["configuration", context.configurationFingerprint],
    ["number", context.numberFingerprint ?? "none"],
    ["provider", context.providerFingerprint],
    ["route", context.routeFingerprint ?? "none"],
    ["instruction_evidence", context.instructionEvidenceFingerprint ?? "none"],
    ["journey_revision", String(context.journeyRevision)],
  ];
  const serialized = parts
    .map(([name, value]) => `${name.length}:${name}:${value.length}:${value}`)
    .join("|");
  return crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
}

function numberClaimOperationFingerprint(context) {
  // Number assignment changes both the aggregate number binding and its control
  // fence. Key the immutable claim to the reservation owner instead, so an
  // exact concurrent request or a post-commit retry reaches the same receipt.
  const parts = [
    ["route", "FIELD_SETUP_NUMBER_CLAIM"],
    ["client", context.clientFingerprint],
    ["environment", context.environmentFingerprint],
    ["journey", context.journeyFingerprint],
    ["deployment", context.deploymentFingerprint],
    ["configuration", context.configurationFingerprint],
  ];
  const serialized = parts
    .map(([name, value]) => `${name.length}:${name}:${value.length}:${value}`)
    .join("|");
  return crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
}

function routeVerificationOperationScopeFingerprint(context) {
  // A verification attempt can outlive the browser session that requested it.
  // Keep its monotonic attempt scope bound to the durable route/evidence chain
  // and current control-fence epoch, not to rotating access-session or CRM
  // journey-revision metadata. Stop/resume advances the fence and therefore
  // cannot collide with an earlier, now-unconsumable attempt scope.
  const parts = [
    ["route", "FIELD_SETUP_ROUTE_VERIFICATION_WINDOW"],
    ["client", context.clientFingerprint],
    ["environment", context.environmentFingerprint],
    ["journey", context.journeyFingerprint],
    ["deployment", context.deploymentFingerprint],
    ["configuration", context.configurationFingerprint],
    ["number", context.numberFingerprint],
    ["provider", context.providerFingerprint],
    ["route_binding", context.routeFingerprint],
    ["instruction_evidence", context.instructionEvidenceFingerprint],
    ["approved_qa_caller", context.approvedQaCallerFingerprint],
    ["control_fence", setupControlFenceFingerprint(context)],
  ];
  const serialized = parts
    .map(([name, value]) => `${name.length}:${name}:${value.length}:${value}`)
    .join("|");
  return crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
}

function controlOperationFingerprint(context, action, expectedControlRevision) {
  const parts = [
    ["route", "FIELD_SETUP_CONTROL"],
    ["action", action],
    ["operator", context.operatorFingerprint],
    ["session", context.sessionFingerprint],
    ["client", context.clientFingerprint],
    ["environment", context.environmentFingerprint],
    ["journey", context.journeyFingerprint],
    ["deployment", context.deploymentFingerprint],
    ["configuration", context.configurationFingerprint],
    ["number", context.numberFingerprint ?? "none"],
    ["provider", context.providerFingerprint],
    ["route_binding", context.routeFingerprint ?? "none"],
    ["journey_revision", String(context.journeyRevision)],
    ["expected_control_revision", String(expectedControlRevision)],
  ];
  const serialized = parts
    .map(([name, value]) => `${name.length}:${name}:${value.length}:${value}`)
    .join("|");
  return crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
}

function reviewedInstructionFingerprint(
  setup,
  instructions,
  { requiredValidUntilMs = null } = {},
) {
  if (
    setup.numberState !== "Assigned" ||
    setup.numberFingerprint === null ||
    setup.routeFingerprint === null ||
    instructions.forwardingState !== "Instructions Issued" ||
    !FINGERPRINT_PATTERN.test(instructions.reviewedEvidenceFingerprint ?? "") ||
    typeof instructions.reviewedAt !== "string" ||
    typeof instructions.reviewedUntil !== "string" ||
    (
      requiredValidUntilMs !== null &&
      (
        !Number.isSafeInteger(requiredValidUntilMs) ||
        Date.parse(instructions.reviewedUntil) < requiredValidUntilMs
      )
    )
  ) {
    throw new FieldSetupOperationsDispatchError(
      "Reviewed forwarding evidence is not bound to the current route",
      { status: 409, publicCode: "context_conflict" },
    );
  }
  const parts = [
    ["client", setup.clientFingerprint],
    ["environment", setup.environmentFingerprint],
    ["journey", setup.journeyFingerprint],
    ["deployment", setup.deploymentFingerprint],
    ["configuration", setup.configurationFingerprint],
    ["number", setup.numberFingerprint],
    ["provider", setup.providerFingerprint],
    ["route", setup.routeFingerprint],
    ["reviewed_evidence", instructions.reviewedEvidenceFingerprint],
    ["reviewed_at", instructions.reviewedAt],
    ["reviewed_until", instructions.reviewedUntil],
    ["enable_steps", instructions.enableSteps
      .map((step) => `${step.length}:${step}`)
      .join("|")],
    ["rollback_steps", instructions.rollbackSteps
      .map((step) => `${step.length}:${step}`)
      .join("|")],
  ];
  const serialized = parts
    .map(([name, value]) => `${name.length}:${name}:${value.length}:${value}`)
    .join("|");
  return crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
}

function reservationBinding(context) {
  return Object.freeze({
    clientFingerprint: context.clientFingerprint,
    environmentFingerprint: context.environmentFingerprint,
    journeyFingerprint: context.journeyFingerprint,
    deploymentFingerprint: context.deploymentFingerprint,
    configurationFingerprint: context.configurationFingerprint,
  });
}

function typed(prefix, value) {
  return `${prefix}_${value}`;
}

function result(status, body, outcome) {
  return Object.freeze({
    status,
    body: Object.freeze({
      ...body,
      protocolId: FIELD_SETUP_PROTOCOL_ID,
      schemaVersion: FIELD_SETUP_PROTOCOL_VERSION,
    }),
    stage: "field_setup_operations",
    outcome,
  });
}

function assertCurrentRevision(body, context) {
  if (
    !Number.isSafeInteger(body.journeyRevision) ||
    body.journeyRevision < 1 ||
    body.journeyRevision !== context.journeyRevision
  ) {
    throw new FieldSetupOperationsDispatchError("Field-setup revision is stale", {
      status: 409,
      publicCode: "context_conflict",
    });
  }
}

function exactWindow(left, right) {
  return isPlainObject(left) &&
    Reflect.ownKeys(left).length === ROUTE_VERIFICATION_WINDOW_FIELDS.length &&
    ROUTE_VERIFICATION_WINDOW_FIELDS.every((field) => (
      Object.prototype.hasOwnProperty.call(left, field) && left[field] === right[field]
    ));
}

function canonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validateControlRecord(record, expected) {
  exactKeys(record, CONTROL_RECORD_KEYS, "Setup-control readback");
  if (
    record.operationFingerprint !== expected.operationFingerprint ||
    record.bindingFingerprint !== expected.bindingFingerprint ||
    record.controlScopeFingerprint !== expected.controlScopeFingerprint ||
    record.previousControlFenceFingerprint !== expected.previousControlFenceFingerprint ||
    record.controlFenceFingerprint !== expected.controlFenceFingerprint ||
    record.action !== expected.action ||
    record.previousControlRevision !== expected.previousControlRevision ||
    record.controlRevision !== expected.controlRevision ||
    record.previousSetupStatus !== expected.previousSetupStatus ||
    record.setupStatus !== expected.setupStatus ||
    record.previousForwardingState !== expected.previousForwardingState ||
    record.forwardingState !== expected.forwardingState ||
    record.previousInstructionEvidenceFingerprint !== expected.previousInstructionEvidenceFingerprint ||
    record.instructionEvidenceFingerprint !== expected.instructionEvidenceFingerprint ||
    record.previousRollbackReady !== expected.previousRollbackReady ||
    record.rollbackReady !== expected.rollbackReady ||
    record.configurationFingerprint !== expected.configurationFingerprint ||
    record.numberFingerprint !== expected.numberFingerprint ||
    record.providerFingerprint !== expected.providerFingerprint ||
    record.routeFingerprint !== expected.routeFingerprint ||
    record.activateDeployment !== false ||
    record.mutateLiveRoute !== false ||
    !canonicalTimestamp(record.committedAt)
  ) {
    throw new FieldSetupOperationsDispatchError("Setup-control readback is invalid");
  }
  return record;
}

function sameControlRecord(left, right) {
  return CONTROL_RECORD_KEYS.every((key) => left[key] === right[key]);
}

function validateReplayedControlRecord(record, setup, expectedIdentity) {
  exactKeys(record, CONTROL_RECORD_KEYS, "Setup-control replay readback");
  const replayedControl = applyBrowserSetupControl({
    action: record.action,
    currentForwardingState: record.previousForwardingState,
    currentInstructionEvidenceFingerprint: record.previousInstructionEvidenceFingerprint,
    currentRollbackReady: record.previousRollbackReady,
    currentSetupStatus: record.previousSetupStatus,
    approvedQaCallerFingerprint: setup.approvedQaCallerFingerprint,
    clientFingerprint: setup.clientFingerprint,
    configurationFingerprint: setup.configurationFingerprint,
    numberFingerprint: setup.numberFingerprint,
    numberState: setup.numberState,
    environmentFingerprint: setup.environmentFingerprint,
    journeyFingerprint: setup.journeyFingerprint,
    deploymentFingerprint: setup.deploymentFingerprint,
    providerFingerprint: setup.providerFingerprint,
    routeFingerprint: setup.routeFingerprint,
    instructionEvidenceFingerprint: record.instructionEvidenceFingerprint,
  });
  const stateChanged = replayedControl.previousSetupStatus !== replayedControl.setupStatus ||
    replayedControl.previousForwardingState !== replayedControl.forwardingState ||
    replayedControl.previousInstructionEvidenceFingerprint !==
      replayedControl.instructionEvidenceFingerprint ||
    replayedControl.previousRollbackReady !== replayedControl.rollbackReady;
  const expectedPreviousControlFence = setupControlFenceFingerprint({
    ...setup,
    controlRevision: record.previousControlRevision,
    setupStatus: record.previousSetupStatus,
    forwardingState: record.previousForwardingState,
    instructionEvidenceFingerprint: record.previousInstructionEvidenceFingerprint,
    rollbackReady: record.previousRollbackReady,
  });
  const expectedControlFence = setupControlFenceFingerprint({
    ...setup,
    controlRevision: record.controlRevision,
    setupStatus: record.setupStatus,
    forwardingState: record.forwardingState,
    instructionEvidenceFingerprint: record.instructionEvidenceFingerprint,
    rollbackReady: record.rollbackReady,
  });
  if (
    record.operationFingerprint !== expectedIdentity.operationFingerprint ||
    record.bindingFingerprint !== expectedIdentity.bindingFingerprint ||
    record.controlScopeFingerprint !== expectedIdentity.controlScopeFingerprint ||
    record.previousControlFenceFingerprint !== expectedPreviousControlFence ||
    record.controlFenceFingerprint !== expectedControlFence ||
    record.action !== expectedIdentity.action ||
    record.previousControlRevision < 0 ||
    record.controlRevision !== (
      stateChanged ? record.previousControlRevision + 1 : record.previousControlRevision
    ) ||
    record.setupStatus !== replayedControl.setupStatus ||
    record.forwardingState !== replayedControl.forwardingState ||
    record.instructionEvidenceFingerprint !== replayedControl.instructionEvidenceFingerprint ||
    record.rollbackReady !== replayedControl.rollbackReady ||
    record.configurationFingerprint !== setup.configurationFingerprint ||
    record.numberFingerprint !== setup.numberFingerprint ||
    record.providerFingerprint !== setup.providerFingerprint ||
    record.routeFingerprint !== setup.routeFingerprint ||
    record.activateDeployment !== false ||
    record.mutateLiveRoute !== false ||
    !canonicalTimestamp(record.committedAt)
  ) {
    throw new FieldSetupOperationsDispatchError("Setup-control replay readback is invalid");
  }
  return record;
}

function normalizeError(error) {
  if (error instanceof FieldSetupOperationsDispatchError || error instanceof HttpBoundaryError) {
    return error;
  }
  if (error instanceof FieldSetupOperationError) {
    if (error.status >= 500) {
      return new FieldSetupOperationsDispatchError("Field-setup dependency is unavailable");
    }
    if (
      error.publicCode.includes("conflict") ||
      error.publicCode.includes("expired")
    ) {
      return new FieldSetupOperationsDispatchError("Field-setup state conflicts", {
        status: 409,
        publicCode: "context_conflict",
      });
    }
    return new FieldSetupOperationsDispatchError("Field-setup request is invalid", {
      status: error.status === 403 ? 403 : 422,
      publicCode: "request_invalid",
    });
  }
  return new FieldSetupOperationsDispatchError("Field-setup dependency is unavailable");
}

function createFieldSetupOperationsDispatcher({
  authenticatedSetupResolver,
  config: inputConfig,
  forwardingRegistry = [],
  stateCoordinator,
  windowKeyFactory,
  now = Date.now,
} = {}) {
  const config = normalizeConfig(inputConfig);
  if (
    typeof authenticatedSetupResolver !== "function" ||
    typeof stateCoordinator?.readNumberReservationStatus !== "function" ||
    typeof stateCoordinator
      ?.readNumberReservationReceiptByOperationFingerprint !== "function" ||
    typeof stateCoordinator
      ?.claimExistingAvailableNumberWithControlFenceAtomically !== "function" ||
    typeof stateCoordinator?.issueWindowWithControlFenceAtomically !== "function" ||
    typeof stateCoordinator
      ?.readLatestWindowByOperationScopeFingerprint !== "function" ||
    typeof stateCoordinator?.applyControlIntentAtomically !== "function" ||
    typeof stateCoordinator
      ?.readControlOperationByOperationFingerprint !== "function" ||
    typeof now !== "function" ||
    (windowKeyFactory !== undefined && typeof windowKeyFactory !== "function") ||
    !Array.isArray(forwardingRegistry)
  ) {
    throw new FieldSetupOperationsDispatchError(
      "Field-setup injected adapters are unavailable",
      { publicCode: "configuration_invalid" },
    );
  }
  const fieldPaths = new Set(ROUTE_KEYS.map((key) => config.routes[key]));

  function scopedAdapters(runtimeContext) {
    const adapterContext = Object.freeze({ app: runtimeContext?.app });
    return Object.freeze({
      stateCoordinator: Object.freeze({
        readNumberReservationStatus: (query) => (
          stateCoordinator.readNumberReservationStatus(query, adapterContext)
        ),
        readNumberReservationReceiptByOperationFingerprint: (query) => (
          stateCoordinator.readNumberReservationReceiptByOperationFingerprint(
            query,
            adapterContext,
          )
        ),
        claimExistingAvailableNumberWithControlFenceAtomically: (claim) => (
          stateCoordinator.claimExistingAvailableNumberWithControlFenceAtomically(
            claim,
            adapterContext,
          )
        ),
        issueWindowWithControlFenceAtomically: (request) => (
          stateCoordinator.issueWindowWithControlFenceAtomically(request, adapterContext)
        ),
        readLatestWindowByOperationScopeFingerprint: (query) => (
          stateCoordinator.readLatestWindowByOperationScopeFingerprint(
            query,
            adapterContext,
          )
        ),
        applyControlIntentAtomically: (intent) => (
          stateCoordinator.applyControlIntentAtomically(intent, adapterContext)
        ),
        readControlOperationByOperationFingerprint: (query) => (
          stateCoordinator.readControlOperationByOperationFingerprint(query, adapterContext)
        ),
      }),
    });
  }

  function claimsRequest(request) {
    return fieldPaths.has(candidatePath(request));
  }

  function assertNoRouteCollision(existingPaths) {
    if (
      !Array.isArray(existingPaths) ||
      existingPaths.some((path) => typeof path !== "string") ||
      existingPaths.some((path) => fieldPaths.has(path))
    ) {
      throw new FieldSetupOperationsDispatchError(
        "Field-setup operation route collides with an existing route",
        { publicCode: "configuration_invalid" },
      );
    }
  }

  async function authenticate(request, context, routeId, { allowMissingOrigin = false } = {}) {
    assertProtocolHeaders(request);
    assertSameOrigin(request, config.webClientOrigin, { allowMissingOrigin });
    const sessionToken = readSessionCookie(request);
    verifyCsrf(request, sessionToken, config);
    let resolved;
    try {
      resolved = await authenticatedSetupResolver(Object.freeze({
        app: context?.app,
        request: Object.freeze({
          headers: Object.freeze({ ...(request?.headers ?? {}) }),
          method: String(request?.method ?? ""),
          url: String(request?.url ?? request?.originalUrl ?? ""),
        }),
        routeId,
        sessionToken,
      }));
    } catch {
      throw new FieldSetupOperationsDispatchError(
        "Field-setup authentication failed",
        { status: 401, publicCode: "authentication_failed" },
      );
    }
    return normalizeContext(resolved);
  }

  async function readPostBody(request, expectedKeys) {
    const raw = await readRawBody(request, {
      maximumBytes: config.maxBodyBytes,
      timeoutMs: config.bodyTimeoutMs,
    });
    return exactKeys(
      parseJsonObject(raw),
      expectedKeys,
      "Field-setup operation body",
      { status: 422, publicCode: "request_invalid" },
    );
  }

  async function dispatchNumberStatus(request, runtimeContext) {
    assertBodylessGet(request, config.routes.numberStatusPath);
    const setup = await authenticate(
      request,
      runtimeContext,
      "FIELD_SETUP_NUMBER_STATUS",
      { allowMissingOrigin: true },
    );
    const adapters = scopedAdapters(runtimeContext);
    const status = await readExistingNumberReservationStatus(
      reservationBinding(setup),
      { stateCoordinator: adapters.stateCoordinator },
    );
    if (status.outcome === "blocked") {
      return result(409, {
        ok: false,
        code: status.publicCode,
        message: status.message,
      }, status.publicCode);
    }
    return result(200, {
      ok: true,
      state: status.state,
      color: status.color,
    }, "number_status_read");
  }

  async function dispatchNumberClaim(request, runtimeContext) {
    validateJsonPost(request, new Set([config.routes.numberClaimPath]));
    const setup = await authenticate(
      request,
      runtimeContext,
      "FIELD_SETUP_NUMBER_CLAIM",
    );
    const adapters = scopedAdapters(runtimeContext);
    const body = await readPostBody(request, ["journeyRevision"]);
    assertCurrentRevision(body, setup);
    if (setup.setupStatus !== "in_progress") {
      throw new FieldSetupOperationsDispatchError("Stopped setup cannot claim a number", {
        status: 409,
        publicCode: "context_conflict",
      });
    }
    const selectedControlScopeFingerprint = setupControlScopeFingerprint(setup);
    const selectedControlFenceFingerprint = setupControlFenceFingerprint(setup);
    const selectedOperationFingerprint = numberClaimOperationFingerprint(setup);
    const reserved = await reserveExistingAvailableNumber({
      ...reservationBinding(setup),
      operationFingerprint: selectedOperationFingerprint,
      controlScopeFingerprint: selectedControlScopeFingerprint,
      expectedControlFenceFingerprint: selectedControlFenceFingerprint,
    }, { stateCoordinator: adapters.stateCoordinator, nowMs: now });
    if (reserved.outcome === "blocked") {
      return result(409, {
        ok: false,
        code: reserved.publicCode,
        message: reserved.message,
      }, reserved.publicCode);
    }
    const expectedPostClaimControlFenceFingerprint = setupControlFenceFingerprint({
      ...setup,
      numberFingerprint: reserved.numberFingerprint,
      numberState: "Reserved",
    });
    const receipt = await adapters.stateCoordinator
      .readNumberReservationReceiptByOperationFingerprint(Object.freeze({
        operationFingerprint: selectedOperationFingerprint,
      }));
    exactKeys(receipt, RESERVATION_RECEIPT_KEYS, "Number reservation receipt");
    if (
      receipt.operationFingerprint !== reserved.operationFingerprint ||
      receipt.bindingFingerprint !== reserved.bindingFingerprint ||
      receipt.numberFingerprint !== reserved.numberFingerprint ||
      receipt.state !== "Reserved" ||
      receipt.controlScopeFingerprint !== selectedControlScopeFingerprint ||
      receipt.previousControlFenceFingerprint !==
        reserved.previousControlFenceFingerprint ||
      receipt.controlFenceFingerprint !== reserved.controlFenceFingerprint ||
      receipt.controlFenceFingerprint !== expectedPostClaimControlFenceFingerprint ||
      receipt.claimedAt !== reserved.claimedAt
    ) {
      throw new FieldSetupOperationsDispatchError(
        "Number reservation receipt readback is invalid",
      );
    }
    const readback = await readExistingNumberReservationStatus(
      reservationBinding(setup),
      { stateCoordinator: adapters.stateCoordinator },
    );
    if (
      readback.outcome === "blocked" ||
      readback.state !== "Reserved" ||
      readback.numberFingerprint !== reserved.numberFingerprint ||
      readback.bindingFingerprint !== reserved.bindingFingerprint
    ) {
      throw new FieldSetupOperationsDispatchError("Number reservation readback is invalid");
    }
    return result(200, {
      ok: true,
      state: readback.state,
      color: readback.color,
      replayed: reserved.outcome === "idempotent_replay",
    }, reserved.outcome === "idempotent_replay"
      ? "number_reservation_replayed"
      : "number_reserved");
  }

  async function applyControlIntent(
    setup,
    adapters,
    action,
    instructionEvidenceFingerprint = null,
  ) {
    const control = applyBrowserSetupControl({
      action,
      currentForwardingState: setup.forwardingState,
      currentInstructionEvidenceFingerprint: setup.instructionEvidenceFingerprint,
      currentRollbackReady: setup.rollbackReady,
      currentSetupStatus: setup.setupStatus,
      approvedQaCallerFingerprint: setup.approvedQaCallerFingerprint,
      clientFingerprint: setup.clientFingerprint,
      configurationFingerprint: setup.configurationFingerprint,
      numberFingerprint: setup.numberFingerprint,
      numberState: setup.numberState,
      environmentFingerprint: setup.environmentFingerprint,
      journeyFingerprint: setup.journeyFingerprint,
      deploymentFingerprint: setup.deploymentFingerprint,
      providerFingerprint: setup.providerFingerprint,
      routeFingerprint: setup.routeFingerprint,
      instructionEvidenceFingerprint,
    });
    const selectedOperationFingerprint = controlOperationFingerprint(
      setup,
      action,
      setup.controlRevision,
    );
    const changedState = control.previousSetupStatus !== control.setupStatus ||
      control.previousForwardingState !== control.forwardingState ||
      control.previousInstructionEvidenceFingerprint !== control.instructionEvidenceFingerprint ||
      control.previousRollbackReady !== control.rollbackReady;
    const controlScopeFingerprint = setupControlScopeFingerprint(setup);
    if (!changedState) {
      if (!FINGERPRINT_PATTERN.test(setup.latestControlOperationFingerprint ?? "")) {
        throw new FieldSetupOperationsDispatchError("Setup-control replay is unavailable", {
          status: 409,
          publicCode: "context_conflict",
        });
      }
      const currentRecord = await adapters.stateCoordinator
        .readControlOperationByOperationFingerprint(Object.freeze({
          operationFingerprint: setup.latestControlOperationFingerprint,
        }));
      exactKeys(currentRecord, CONTROL_RECORD_KEYS, "Setup-control replay readback");
      const replayedRecord = validateReplayedControlRecord(currentRecord, setup, {
        operationFingerprint: setup.latestControlOperationFingerprint,
        bindingFingerprint: control.bindingFingerprint,
        controlScopeFingerprint,
        action,
      });
      if (
        replayedRecord.controlRevision !== setup.controlRevision ||
        replayedRecord.setupStatus !== setup.setupStatus ||
        replayedRecord.forwardingState !== setup.forwardingState ||
        replayedRecord.instructionEvidenceFingerprint !==
          setup.instructionEvidenceFingerprint ||
        replayedRecord.rollbackReady !== setup.rollbackReady ||
        replayedRecord.controlFenceFingerprint !== setupControlFenceFingerprint(setup)
      ) {
        throw new FieldSetupOperationsDispatchError("Setup-control replay is stale", {
          status: 409,
          publicCode: "context_conflict",
        });
      }
      return Object.freeze({ readback: replayedRecord, replayed: true });
    }
    const nextControlRevision = changedState
      ? setup.controlRevision + 1
      : setup.controlRevision;
    const previousControlFenceFingerprint = setupControlFenceFingerprint(setup);
    const nextControlFenceFingerprint = setupControlFenceFingerprint({
      ...setup,
      controlRevision: nextControlRevision,
      setupStatus: control.setupStatus,
      forwardingState: control.forwardingState,
      instructionEvidenceFingerprint: control.instructionEvidenceFingerprint,
      rollbackReady: control.rollbackReady,
    });
    const expected = Object.freeze({
      operationFingerprint: selectedOperationFingerprint,
      bindingFingerprint: control.bindingFingerprint,
      controlScopeFingerprint,
      previousControlFenceFingerprint,
      controlFenceFingerprint: nextControlFenceFingerprint,
      action: control.action,
      previousControlRevision: setup.controlRevision,
      controlRevision: nextControlRevision,
      previousSetupStatus: control.previousSetupStatus,
      setupStatus: control.setupStatus,
      previousForwardingState: control.previousForwardingState,
      forwardingState: control.forwardingState,
      previousInstructionEvidenceFingerprint: control.previousInstructionEvidenceFingerprint,
      instructionEvidenceFingerprint: control.instructionEvidenceFingerprint,
      previousRollbackReady: control.previousRollbackReady,
      rollbackReady: control.rollbackReady,
      configurationFingerprint: setup.configurationFingerprint,
      numberFingerprint: setup.numberFingerprint,
      providerFingerprint: setup.providerFingerprint,
      routeFingerprint: setup.routeFingerprint,
      activateDeployment: false,
      mutateLiveRoute: false,
    });
    const changed = await adapters.stateCoordinator.applyControlIntentAtomically(expected);
    if (
      isPlainObject(changed) &&
      Reflect.ownKeys(changed).length === 1 &&
      changed.outcome === "context_conflict"
    ) {
      throw new FieldSetupOperationsDispatchError("Setup-control state conflicts", {
        status: 409,
        publicCode: "context_conflict",
      });
    }
    exactKeys(changed, ["outcome", "record"], "Setup-control result");
    if (!new Set(["applied", "idempotent_replay"]).has(changed.outcome)) {
      throw new FieldSetupOperationsDispatchError("Setup-control response is invalid");
    }
    const acceptedRecord = changed.outcome === "idempotent_replay"
      ? validateReplayedControlRecord(changed.record, setup, {
        operationFingerprint: selectedOperationFingerprint,
        bindingFingerprint: control.bindingFingerprint,
        controlScopeFingerprint,
        action: control.action,
      })
      : validateControlRecord(changed.record, expected);
    const readback = await adapters.stateCoordinator
      .readControlOperationByOperationFingerprint(
        Object.freeze({ operationFingerprint: selectedOperationFingerprint }),
    );
    exactKeys(readback, CONTROL_RECORD_KEYS, "Setup-control readback");
    if (!sameControlRecord(readback, acceptedRecord)) {
      throw new FieldSetupOperationsDispatchError("Setup-control readback is invalid");
    }
    return Object.freeze({
      readback,
      replayed: changed.outcome === "idempotent_replay",
    });
  }

  async function dispatchForwardingInstructions(request, runtimeContext) {
    validateJsonPost(request, new Set([config.routes.forwardingInstructionsPath]));
    const setup = await authenticate(
      request,
      runtimeContext,
      "FIELD_SETUP_FORWARDING_INSTRUCTIONS",
    );
    const adapters = scopedAdapters(runtimeContext);
    const body = await readPostBody(request, ["journeyRevision", "view"]);
    assertCurrentRevision(body, setup);
    if (!new Set(["enable", "rollback"]).has(body.view)) {
      throw new FieldSetupOperationsDispatchError("Instruction view is invalid", {
        status: 422,
        publicCode: "request_invalid",
      });
    }
    const selectedNow = now();
    const instructions = resolveForwardingInstructions(
      setup.providerFingerprint,
      forwardingRegistry,
      selectedNow,
    );
    if (instructions.forwardingState !== "Instructions Issued") {
      return result(409, {
        ok: false,
        code: "technical_setup_required",
        status: instructions.status,
        color: instructions.color,
        view: body.view,
        steps: [],
      }, "technical_setup_required");
    }
    const instructionEvidence = reviewedInstructionFingerprint(setup, instructions);
    if (body.view === "enable") {
      const alreadyAcknowledged =
        setup.forwardingState === "Customer Reported Enabled" &&
        setup.instructionEvidenceFingerprint === instructionEvidence;
      if (!alreadyAcknowledged) {
        await applyControlIntent(
          setup,
          adapters,
          "issue_forwarding_instructions",
          instructionEvidence,
        );
      }
    } else if (
      setup.forwardingState !== "Customer Reported Enabled" ||
      setup.instructionEvidenceFingerprint !== instructionEvidence
    ) {
      throw new FieldSetupOperationsDispatchError(
        "Rollback instructions require forwarding acknowledgement",
        { status: 409, publicCode: "context_conflict" },
      );
    }
    return result(200, {
      ok: true,
      status: instructions.status,
      color: instructions.color,
      view: body.view,
      steps: body.view === "enable"
        ? instructions.enableSteps
        : instructions.rollbackSteps,
    }, body.view === "enable"
      ? setup.forwardingState === "Customer Reported Enabled"
        ? "forwarding_instructions_reloaded"
        : "forwarding_instructions_issued"
      : "rollback_instructions_issued");
  }

  async function dispatchRouteVerificationWindow(request, runtimeContext) {
    validateJsonPost(request, new Set([config.routes.routeVerificationWindowPath]));
    const setup = await authenticate(
      request,
      runtimeContext,
      "FIELD_SETUP_ROUTE_VERIFICATION_WINDOW",
    );
    const adapters = scopedAdapters(runtimeContext);
    const body = await readPostBody(
      request,
      ["journeyRevision"],
    );
    assertCurrentRevision(body, setup);
    if (
      setup.setupStatus !== "in_progress" ||
      setup.numberState !== "Assigned" ||
      setup.forwardingState !== "Customer Reported Enabled" ||
      setup.rollbackReady !== true ||
      setup.numberFingerprint === null ||
      setup.routeFingerprint === null ||
      setup.approvedQaCallerFingerprint === null
    ) {
      throw new FieldSetupOperationsDispatchError(
        "Route verification prerequisites are incomplete",
        { status: 409, publicCode: "context_conflict" },
      );
    }
    const selectedNow = now();
    const instructions = resolveForwardingInstructions(
      setup.providerFingerprint,
      forwardingRegistry,
      selectedNow,
    );
    const instructionEvidence = reviewedInstructionFingerprint(setup, instructions, {
      requiredValidUntilMs: selectedNow + ROUTE_WINDOW_TTL_MS,
    });
    if (setup.instructionEvidenceFingerprint !== instructionEvidence) {
      throw new FieldSetupOperationsDispatchError(
        "Route verification forwarding evidence is stale",
        { status: 409, publicCode: "context_conflict" },
      );
    }
    const operation = routeVerificationOperationScopeFingerprint(setup);
    const command = Object.freeze({
      operation_scope_fingerprint: typed("operation_scope", operation),
      environment_fingerprint: typed("environment", setup.environmentFingerprint),
      client_fingerprint: typed("client", setup.clientFingerprint),
      journey_fingerprint: typed("journey", setup.journeyFingerprint),
      deployment_fingerprint: typed("deployment", setup.deploymentFingerprint),
      configuration_fingerprint: typed("configuration", setup.configurationFingerprint),
      control_fence_fingerprint: typed(
        "control_fence",
        setupControlFenceFingerprint(setup),
      ),
      provider_fingerprint: typed("provider", setup.providerFingerprint),
      instruction_evidence_fingerprint: typed(
        "instruction_evidence",
        setup.instructionEvidenceFingerprint,
      ),
      number_fingerprint: typed("number", setup.numberFingerprint),
      route_fingerprint: typed("route", setup.routeFingerprint),
      approved_qa_caller_fingerprint: typed(
        "qa_caller",
        setup.approvedQaCallerFingerprint,
      ),
    });
    const issued = await issueRouteVerificationWindow(command, {
      nowMs: () => selectedNow,
      stateCoordinator: adapters.stateCoordinator,
      controlScopeFingerprint: setupControlScopeFingerprint(setup),
      expectedControlFenceFingerprint: setupControlFenceFingerprint(setup),
      windowKeyFactory,
    });
    const readback = await adapters.stateCoordinator
      .readLatestWindowByOperationScopeFingerprint(Object.freeze({
        operation_scope_fingerprint: command.operation_scope_fingerprint,
      }));
    exactKeys(readback, ["attempt_epoch", "window"], "Route window readback");
    if (
      readback.attempt_epoch !== issued.attemptEpoch ||
      !exactWindow(readback.window, issued.window)
    ) {
      throw new FieldSetupOperationsDispatchError(
        "Route verification window readback is invalid",
      );
    }
    return result(200, {
      ok: true,
      status: "Open",
      issuedAt: issued.window.issued_at,
      expiresAt: issued.window.expires_at,
      ttlMs: ROUTE_WINDOW_TTL_MS,
      replayed: issued.outcome === "idempotent_replay",
      startsAgent: false,
      activatesDeployment: false,
    }, issued.outcome === "idempotent_replay"
      ? "route_window_replayed"
      : "route_window_issued");
  }

  async function dispatchSetupControl(request, runtimeContext) {
    validateJsonPost(request, new Set([config.routes.setupControlPath]));
    const setup = await authenticate(request, runtimeContext, "FIELD_SETUP_CONTROL");
    const adapters = scopedAdapters(runtimeContext);
    const body = await readPostBody(request, ["action", "journeyRevision"]);
    assertCurrentRevision(body, setup);
    if (!new Set([
      "confirm_forwarding_enabled",
      "confirm_rollback_ready",
      "resume",
      "stop",
    ]).has(body.action)) {
      throw new FieldSetupOperationsDispatchError("Setup-control action is forbidden", {
        status: 403,
        publicCode: "request_invalid",
      });
    }
    let instructionEvidence = null;
    if (["confirm_forwarding_enabled", "confirm_rollback_ready"].includes(body.action)) {
      const selectedNow = now();
      const instructions = resolveForwardingInstructions(
        setup.providerFingerprint,
        forwardingRegistry,
        selectedNow,
      );
      if (instructions.forwardingState !== "Instructions Issued") {
        throw new FieldSetupOperationsDispatchError(
          "Reviewed forwarding evidence is unavailable",
          { status: 409, publicCode: "context_conflict" },
        );
      }
      instructionEvidence = reviewedInstructionFingerprint(setup, instructions);
      if (setup.instructionEvidenceFingerprint !== instructionEvidence) {
        throw new FieldSetupOperationsDispatchError(
          "Displayed forwarding evidence is stale",
          { status: 409, publicCode: "context_conflict" },
        );
      }
    }
    const applied = await applyControlIntent(
      setup,
      adapters,
      body.action,
      instructionEvidence,
    );
    const readback = applied.readback;
    return result(200, {
      ok: true,
      setupStatus: readback.setupStatus,
      forwardingState: readback.forwardingState,
      rollbackReady: readback.rollbackReady,
      controlRevision: readback.controlRevision,
      journeyRevision: setup.journeyRevision,
      replayed: applied.replayed,
      activatesDeployment: false,
      mutatesLiveRoute: false,
      requiresSeparateOperatorApproval: true,
    }, applied.replayed
      ? "setup_control_replayed"
      : body.action === "stop"
        ? "setup_stopped"
        : body.action === "resume"
          ? "setup_resumed"
          : body.action === "confirm_forwarding_enabled"
            ? "forwarding_enabled_acknowledged"
            : "rollback_ready_acknowledged");
  }

  async function dispatch(request, context = {}) {
    try {
      const path = parseRequestPath(request);
      if (path === config.routes.numberStatusPath) {
        return await dispatchNumberStatus(request, context);
      }
      if (path === config.routes.numberClaimPath) {
        return await dispatchNumberClaim(request, context);
      }
      if (path === config.routes.forwardingInstructionsPath) {
        return await dispatchForwardingInstructions(request, context);
      }
      if (path === config.routes.routeVerificationWindowPath) {
        return await dispatchRouteVerificationWindow(request, context);
      }
      if (path === config.routes.setupControlPath) {
        return await dispatchSetupControl(request, context);
      }
      throw new HttpBoundaryError("Route is not approved", {
        status: 404,
        publicCode: "route_not_found",
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    status: "NOT_READY",
    catalystHeaderMapping: "NOT_READY_INJECTED_ONLY",
    catalystIdentityMapping: "NOT_READY_INJECTED_ONLY",
    catalystStoreMapping: "NOT_READY_INJECTED_ONLY",
    deploymentAuthorized: false,
    runtimeAuthority: false,
    assertNoRouteCollision,
    claimsRequest,
    dispatch,
  });
}

module.exports = {
  FieldSetupOperationsDispatchError,
  SESSION_COOKIE_NAME,
  createFieldSetupOperationsDispatcher,
  csrfToken,
};
