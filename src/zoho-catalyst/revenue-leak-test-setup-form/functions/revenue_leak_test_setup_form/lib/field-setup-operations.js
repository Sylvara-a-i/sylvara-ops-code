"use strict";

const { createHash, randomBytes } = require("node:crypto");

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

const NUMBER_STATES = deepFreeze({
  Available: { color: "Gray" },
  Reserved: { color: "Blue" },
  Assigned: { color: "Teal" },
  Live: { color: "Green" },
  Cooldown: { color: "Amber" },
  Retired: { color: "Red" },
});

const FORWARDING_STATES = deepFreeze({
  "Not Configured": { color: "Gray" },
  "Instructions Issued": { color: "Blue" },
  "Customer Reported Enabled": { color: "Amber" },
  "Verification In Progress": { color: "Orange" },
  Verified: { color: "Green" },
  "Verification Failed": { color: "Red" },
  Disabled: { color: "Gray" },
  "Rollback Verified": { color: "Purple" },
});

const QA_RUNTIME_DISPOSITION = deepFreeze({
  startAgent: false,
  collectAgentIntake: false,
  createTranscript: false,
  createPostCallAnalysis: false,
  incrementHandledCallCount: false,
  sendNotification: false,
  activateDeployment: false,
  performOperationalAction: false,
});

const RESERVATION_KEYS = new Set([
  "operationFingerprint",
  "clientFingerprint",
  "environmentFingerprint",
  "journeyFingerprint",
  "deploymentFingerprint",
  "configurationFingerprint",
  "controlScopeFingerprint",
  "expectedControlFenceFingerprint",
]);

const RESERVATION_STATUS_KEYS = new Set([
  "clientFingerprint",
  "environmentFingerprint",
  "journeyFingerprint",
  "deploymentFingerprint",
  "configurationFingerprint",
]);

const ROUTE_WINDOW_TTL_MS = 300_000;
const FORWARDING_REVIEW_MAX_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

// This is the exact window shape consumed by the v2 gateway candidate. The setup
// function may issue this record, but it must never accept or consume one from a
// browser request. Consumption and receipt creation belong to the gateway only.
const ROUTE_VERIFICATION_WINDOW_FIELDS = Object.freeze([
  "window_key",
  "status",
  "environment_fingerprint",
  "client_fingerprint",
  "journey_fingerprint",
  "deployment_fingerprint",
  "configuration_fingerprint",
  "control_fence_fingerprint",
  "provider_fingerprint",
  "instruction_evidence_fingerprint",
  "number_fingerprint",
  "route_fingerprint",
  "approved_qa_caller_fingerprint",
  "issued_at",
  "expires_at",
  "closed_at",
]);

const ROUTE_WINDOW_ISSUE_COMMAND_FIELDS = new Set([
  "operation_scope_fingerprint",
  "environment_fingerprint",
  "client_fingerprint",
  "journey_fingerprint",
  "deployment_fingerprint",
  "configuration_fingerprint",
  "control_fence_fingerprint",
  "provider_fingerprint",
  "instruction_evidence_fingerprint",
  "number_fingerprint",
  "route_fingerprint",
  "approved_qa_caller_fingerprint",
]);

const ROUTE_WINDOW_FINGERPRINT_PREFIXES = Object.freeze({
  operation_scope_fingerprint: "operation_scope",
  environment_fingerprint: "environment",
  client_fingerprint: "client",
  journey_fingerprint: "journey",
  deployment_fingerprint: "deployment",
  configuration_fingerprint: "configuration",
  control_fence_fingerprint: "control_fence",
  provider_fingerprint: "provider",
  instruction_evidence_fingerprint: "instruction_evidence",
  number_fingerprint: "number",
  route_fingerprint: "route",
  approved_qa_caller_fingerprint: "qa_caller",
});

const ROUTE_ACTIVE_BINDING_FIELDS = Object.freeze([
  "environment_fingerprint",
  "client_fingerprint",
  "deployment_fingerprint",
  "configuration_fingerprint",
  "control_fence_fingerprint",
  "provider_fingerprint",
  "instruction_evidence_fingerprint",
  "number_fingerprint",
  "route_fingerprint",
]);

class FieldSetupOperationError extends Error {
  constructor(publicCode, status = 409) {
    super("Field setup operation could not be completed");
    this.name = "FieldSetupOperationError";
    this.publicCode = publicCode;
    this.status = status;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function exactPlainObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.size && actual.every(
    (key) => typeof key === "string" && keys.has(key),
  );
}

function canonicalInstant(value) {
  if (typeof value !== "string") return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : NaN;
}

function fingerprint(parts) {
  const serialized = parts.map(([name, value]) => `${name.length}:${name}:${value.length}:${value}`).join("|");
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

function assertFingerprint(value, publicCode = "invalid_fingerprint") {
  if (!FINGERPRINT_PATTERN.test(value ?? "")) {
    throw new FieldSetupOperationError(publicCode, 400);
  }
}

function assertFingerprintObject(value, keys, publicCode) {
  if (!exactPlainObject(value, keys)) {
    throw new FieldSetupOperationError(publicCode, 400);
  }
  for (const key of keys) assertFingerprint(value[key], publicCode);
}

function reservationBindingFingerprint(command) {
  return fingerprint([
    ["client", command.clientFingerprint],
    ["environment", command.environmentFingerprint],
    ["journey", command.journeyFingerprint],
    ["deployment", command.deploymentFingerprint],
    ["configuration", command.configurationFingerprint],
  ]);
}

async function readExistingNumberReservationStatus(command, dependencies) {
  assertFingerprintObject(
    command,
    RESERVATION_STATUS_KEYS,
    "invalid_reservation_status_request",
  );
  if (typeof dependencies?.stateCoordinator?.readNumberReservationStatus !== "function") {
    throw new FieldSetupOperationError("reservation_dependency_unavailable", 503);
  }

  const bindingFingerprint = reservationBindingFingerprint(command);
  const result = await dependencies.stateCoordinator.readNumberReservationStatus(
    deepFreeze({ bindingFingerprint }),
  );
  if (exactPlainObject(result, new Set(["outcome"])) && result.outcome === "none_available") {
    return deepFreeze({
      outcome: "blocked",
      publicCode: "test_number_required",
      message: "Test Number Required — Sylvara Must Assign A Number Before Continuing",
    });
  }

  const expectedKeys = new Set([
    "outcome",
    "bindingFingerprint",
    "numberFingerprint",
    "state",
  ]);
  if (
    !exactPlainObject(result, expectedKeys) ||
    !["available", "bound"].includes(result.outcome) ||
    result.bindingFingerprint !== bindingFingerprint ||
    !FINGERPRINT_PATTERN.test(result.numberFingerprint ?? "") ||
    !Object.prototype.hasOwnProperty.call(NUMBER_STATES, result.state) ||
    (result.outcome === "available" && result.state !== "Available") ||
    (result.outcome === "bound" && result.state === "Available")
  ) {
    throw new FieldSetupOperationError("reservation_readback_invalid", 502);
  }

  return deepFreeze({
    outcome: result.outcome,
    bindingFingerprint,
    numberFingerprint: result.numberFingerprint,
    state: result.state,
    color: NUMBER_STATES[result.state].color,
  });
}

async function reserveExistingAvailableNumber(command, dependencies) {
  assertFingerprintObject(command, RESERVATION_KEYS, "invalid_reservation_request");
  if (
    typeof dependencies?.stateCoordinator
      ?.claimExistingAvailableNumberWithControlFenceAtomically !== "function" ||
    typeof dependencies?.nowMs !== "function"
  ) {
    throw new FieldSetupOperationError("reservation_dependency_unavailable", 503);
  }

  const selectedNow = dependencies.nowMs();
  if (!Number.isSafeInteger(selectedNow) || selectedNow < 0) {
    throw new FieldSetupOperationError("reservation_clock_invalid", 503);
  }
  const bindingFingerprint = reservationBindingFingerprint(command);
  const claim = deepFreeze({
    operationFingerprint: command.operationFingerprint,
    bindingFingerprint,
    expectedState: "Available",
    nextState: "Reserved",
    controlScopeFingerprint: command.controlScopeFingerprint,
    expectedControlFenceFingerprint: command.expectedControlFenceFingerprint,
    claimedAt: new Date(selectedNow).toISOString(),
  });
  const result = await dependencies.stateCoordinator
    .claimExistingAvailableNumberWithControlFenceAtomically(claim);

  if (exactPlainObject(result, new Set(["outcome"])) && result.outcome === "none_available") {
    return deepFreeze({
      outcome: "blocked",
      publicCode: "test_number_required",
      message: "Test Number Required — Sylvara Must Assign A Number Before Continuing",
      purchaseAttempted: false,
    });
  }
  if (exactPlainObject(result, new Set(["outcome"])) && result.outcome === "binding_conflict") {
    throw new FieldSetupOperationError("reservation_binding_conflict");
  }
  if (
    exactPlainObject(result, new Set(["outcome"])) &&
    result.outcome === "control_fence_conflict"
  ) {
    throw new FieldSetupOperationError("reservation_control_fence_conflict");
  }

  const expectedKeys = new Set([
    "outcome",
    "operationFingerprint",
    "bindingFingerprint",
    "numberFingerprint",
    "state",
    "controlScopeFingerprint",
    "previousControlFenceFingerprint",
    "controlFenceFingerprint",
    "claimedAt",
  ]);
  const resultClaimedAtMs = canonicalInstant(result?.claimedAt);
  if (
    !exactPlainObject(result, expectedKeys) ||
    !["reserved", "idempotent_replay"].includes(result.outcome) ||
    result.operationFingerprint !== command.operationFingerprint ||
    result.bindingFingerprint !== bindingFingerprint ||
    result.controlScopeFingerprint !== command.controlScopeFingerprint ||
    !FINGERPRINT_PATTERN.test(result.previousControlFenceFingerprint ?? "") ||
    !FINGERPRINT_PATTERN.test(result.controlFenceFingerprint ?? "") ||
    (
      result.outcome === "reserved" &&
      result.previousControlFenceFingerprint !== command.expectedControlFenceFingerprint
    ) ||
    (
      result.outcome === "idempotent_replay" &&
      ![
        result.previousControlFenceFingerprint,
        result.controlFenceFingerprint,
      ].includes(command.expectedControlFenceFingerprint)
    ) ||
    !Number.isFinite(resultClaimedAtMs) ||
    resultClaimedAtMs > selectedNow ||
    (result.outcome === "reserved" && result.claimedAt !== claim.claimedAt) ||
    result.state !== "Reserved" ||
    !FINGERPRINT_PATTERN.test(result.numberFingerprint ?? "")
  ) {
    throw new FieldSetupOperationError("reservation_response_invalid", 502);
  }

  return deepFreeze({
    outcome: result.outcome,
    operationFingerprint: result.operationFingerprint,
    bindingFingerprint,
    numberFingerprint: result.numberFingerprint,
    controlScopeFingerprint: result.controlScopeFingerprint,
    previousControlFenceFingerprint: result.previousControlFenceFingerprint,
    controlFenceFingerprint: result.controlFenceFingerprint,
    claimedAt: result.claimedAt,
    state: "Reserved",
    color: NUMBER_STATES.Reserved.color,
    purchaseAttempted: false,
  });
}

function createForwardingRegistry(reviewedEntries = []) {
  if (!Array.isArray(reviewedEntries)) {
    throw new FieldSetupOperationError("forwarding_registry_invalid", 500);
  }
  const providerFingerprints = new Set();
  const entries = reviewedEntries.map((entry) => {
    const keys = new Set([
      "providerFingerprint",
      "reviewedEvidenceFingerprint",
      "reviewedAt",
      "reviewedUntil",
      "enableSteps",
      "rollbackSteps",
    ]);
    const reviewedAtMs = canonicalInstant(entry.reviewedAt);
    const reviewedUntilMs = canonicalInstant(entry.reviewedUntil);
    if (
      !exactPlainObject(entry, keys) ||
      !FINGERPRINT_PATTERN.test(entry.providerFingerprint ?? "") ||
      !FINGERPRINT_PATTERN.test(entry.reviewedEvidenceFingerprint ?? "") ||
      !Number.isFinite(reviewedAtMs) ||
      !Number.isFinite(reviewedUntilMs) ||
      reviewedUntilMs <= reviewedAtMs ||
      reviewedUntilMs - reviewedAtMs > FORWARDING_REVIEW_MAX_VALIDITY_MS ||
      !validInstructionSteps(entry.enableSteps) ||
      !validInstructionSteps(entry.rollbackSteps) ||
      providerFingerprints.has(entry.providerFingerprint)
    ) {
      throw new FieldSetupOperationError("forwarding_registry_invalid", 500);
    }
    providerFingerprints.add(entry.providerFingerprint);
    return {
      providerFingerprint: entry.providerFingerprint,
      reviewedEvidenceFingerprint: entry.reviewedEvidenceFingerprint,
      reviewedAt: entry.reviewedAt,
      reviewedUntil: entry.reviewedUntil,
      enableSteps: [...entry.enableSteps],
      rollbackSteps: [...entry.rollbackSteps],
    };
  });
  return deepFreeze(entries);
}

function validInstructionSteps(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every(
    (step) => typeof step === "string" && step.trim() === step && step.length > 0 && step.length <= 500,
  );
}

function resolveForwardingInstructions(providerFingerprint, reviewedRegistry = [], nowMs) {
  assertFingerprint(providerFingerprint, "provider_fingerprint_invalid");
  const registry = createForwardingRegistry(reviewedRegistry);
  const match = registry.find((entry) => entry.providerFingerprint === providerFingerprint);
  if (!match || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    if (match && (!Number.isSafeInteger(nowMs) || nowMs < 0)) {
      throw new FieldSetupOperationError("forwarding_clock_invalid", 503);
    }
    return deepFreeze({
      providerFingerprint,
      status: "Technical Setup Required",
      forwardingState: "Not Configured",
      color: FORWARDING_STATES["Not Configured"].color,
      reviewedEvidenceFingerprint: null,
      reviewedAt: null,
      reviewedUntil: null,
      enableSteps: [],
      rollbackSteps: [],
    });
  }
  const reviewedAtMs = canonicalInstant(match.reviewedAt);
  const reviewedUntilMs = canonicalInstant(match.reviewedUntil);
  if (nowMs < reviewedAtMs || nowMs >= reviewedUntilMs) {
    return deepFreeze({
      providerFingerprint,
      status: "Technical Setup Required",
      forwardingState: "Not Configured",
      color: FORWARDING_STATES["Not Configured"].color,
      reviewedEvidenceFingerprint: null,
      reviewedAt: null,
      reviewedUntil: null,
      enableSteps: [],
      rollbackSteps: [],
    });
  }
  return deepFreeze({
    providerFingerprint,
    status: "Reviewed Instructions Available",
    forwardingState: "Instructions Issued",
    color: FORWARDING_STATES["Instructions Issued"].color,
    reviewedEvidenceFingerprint: match.reviewedEvidenceFingerprint,
    reviewedAt: match.reviewedAt,
    reviewedUntil: match.reviewedUntil,
    enableSteps: [...match.enableSteps],
    rollbackSteps: [...match.rollbackSteps],
  });
}

function typedFingerprint(value, prefix) {
  return typeof value === "string" && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(value);
}

function assertRouteWindowIssueCommand(command) {
  if (!exactPlainObject(command, ROUTE_WINDOW_ISSUE_COMMAND_FIELDS)) {
    throw new FieldSetupOperationError("route_window_issue_invalid", 400);
  }
  for (const [field, prefix] of Object.entries(ROUTE_WINDOW_FINGERPRINT_PREFIXES)) {
    if (!typedFingerprint(command[field], prefix)) {
      throw new FieldSetupOperationError("route_window_issue_invalid", 400);
    }
  }
}

function routeWindowRequestBindingKey(command) {
  return `request_${fingerprint([
    ["operation_scope", command.operation_scope_fingerprint],
    ["environment", command.environment_fingerprint],
    ["client", command.client_fingerprint],
    ["journey", command.journey_fingerprint],
    ["deployment", command.deployment_fingerprint],
    ["configuration", command.configuration_fingerprint],
    ["control_fence", command.control_fence_fingerprint],
    ["provider", command.provider_fingerprint],
    ["instruction_evidence", command.instruction_evidence_fingerprint],
    ["number", command.number_fingerprint],
    ["route", command.route_fingerprint],
    ["approved_qa_caller", command.approved_qa_caller_fingerprint],
  ])}`;
}

function assertIssuedWindow(window, command, selectedNow, proposedWindow, outcome) {
  if (
    !exactPlainObject(window, new Set(ROUTE_VERIFICATION_WINDOW_FIELDS)) ||
    window.status !== "Open" ||
    window.closed_at !== null ||
    !typedFingerprint(window.window_key, "window")
  ) {
    throw new FieldSetupOperationError("route_window_response_invalid", 502);
  }
  for (const field of [
    "environment_fingerprint",
    "client_fingerprint",
    "journey_fingerprint",
    "deployment_fingerprint",
    "configuration_fingerprint",
    "control_fence_fingerprint",
    "provider_fingerprint",
    "instruction_evidence_fingerprint",
    "number_fingerprint",
    "route_fingerprint",
    "approved_qa_caller_fingerprint",
  ]) {
    if (window[field] !== command[field]) {
      throw new FieldSetupOperationError("route_window_response_invalid", 502);
    }
  }
  const issuedAtMs = canonicalInstant(window.issued_at);
  const expiresAtMs = canonicalInstant(window.expires_at);
  if (
    !Number.isFinite(issuedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    issuedAtMs > selectedNow ||
    selectedNow >= expiresAtMs ||
    expiresAtMs - issuedAtMs !== ROUTE_WINDOW_TTL_MS
  ) {
    throw new FieldSetupOperationError("route_window_response_invalid", 502);
  }
  if (
    outcome === "issued" &&
    ROUTE_VERIFICATION_WINDOW_FIELDS.some((field) => window[field] !== proposedWindow[field])
  ) {
    throw new FieldSetupOperationError("route_window_response_invalid", 502);
  }
}

function assertExpiredWindow(
  window,
  command,
  selectedNow,
  { closedInCurrentTransaction = false, requireFullBinding = false } = {},
) {
  if (
    !exactPlainObject(window, new Set(ROUTE_VERIFICATION_WINDOW_FIELDS)) ||
    window.status !== "Expired" ||
    !typedFingerprint(window.window_key, "window")
  ) {
    throw new FieldSetupOperationError("route_window_response_invalid", 502);
  }
  for (const [field, prefix] of Object.entries(ROUTE_WINDOW_FINGERPRINT_PREFIXES)) {
    if (field === "operation_scope_fingerprint") continue;
    if (!typedFingerprint(window[field], prefix)) {
      throw new FieldSetupOperationError("route_window_response_invalid", 502);
    }
  }
  const fields = requireFullBinding
    ? Object.keys(ROUTE_WINDOW_FINGERPRINT_PREFIXES).filter(
      (field) => field !== "operation_scope_fingerprint",
    )
    : ROUTE_ACTIVE_BINDING_FIELDS;
  if (fields.some((field) => window[field] !== command[field])) {
    throw new FieldSetupOperationError("route_window_response_invalid", 502);
  }
  const issuedAtMs = canonicalInstant(window.issued_at);
  const expiresAtMs = canonicalInstant(window.expires_at);
  const closedAtMs = canonicalInstant(window.closed_at);
  if (
    !Number.isFinite(issuedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    !Number.isFinite(closedAtMs) ||
    expiresAtMs - issuedAtMs !== ROUTE_WINDOW_TTL_MS ||
    expiresAtMs > selectedNow ||
    closedAtMs < expiresAtMs ||
    closedAtMs > selectedNow ||
    (closedInCurrentTransaction && closedAtMs !== selectedNow)
  ) {
    throw new FieldSetupOperationError("route_window_response_invalid", 502);
  }
}

async function issueRouteVerificationWindow(command, dependencies) {
  if (
    typeof dependencies?.stateCoordinator
      ?.issueWindowWithControlFenceAtomically !== "function" ||
    typeof dependencies?.nowMs !== "function"
  ) {
    throw new FieldSetupOperationError("route_verification_dependency_unavailable", 503);
  }
  assertRouteWindowIssueCommand(command);
  assertFingerprint(
    dependencies?.controlScopeFingerprint,
    "route_window_issue_invalid",
  );
  assertFingerprint(
    dependencies?.expectedControlFenceFingerprint,
    "route_window_issue_invalid",
  );
  if (
    command.control_fence_fingerprint !==
      `control_fence_${dependencies.expectedControlFenceFingerprint}`
  ) {
    throw new FieldSetupOperationError("route_window_issue_invalid", 400);
  }
  const selectedNow = dependencies.nowMs();
  if (
    !Number.isSafeInteger(selectedNow) ||
    selectedNow < 0 ||
    selectedNow > 8_640_000_000_000_000 - ROUTE_WINDOW_TTL_MS
  ) {
    throw new FieldSetupOperationError("route_verification_clock_invalid", 503);
  }
  const windowKeyFactory = dependencies.windowKeyFactory ?? (() => (
    `window_${randomBytes(32).toString("hex")}`
  ));
  if (typeof windowKeyFactory !== "function") {
    throw new FieldSetupOperationError("route_verification_dependency_unavailable", 503);
  }
  let windowKey;
  try {
    windowKey = windowKeyFactory();
  } catch {
    throw new FieldSetupOperationError("route_verification_key_invalid", 503);
  }
  if (!typedFingerprint(windowKey, "window")) {
    throw new FieldSetupOperationError("route_verification_key_invalid", 503);
  }
  const proposedWindow = deepFreeze({
    window_key: windowKey,
    status: "Open",
    environment_fingerprint: command.environment_fingerprint,
    client_fingerprint: command.client_fingerprint,
    journey_fingerprint: command.journey_fingerprint,
    deployment_fingerprint: command.deployment_fingerprint,
    configuration_fingerprint: command.configuration_fingerprint,
    control_fence_fingerprint: command.control_fence_fingerprint,
    provider_fingerprint: command.provider_fingerprint,
    instruction_evidence_fingerprint: command.instruction_evidence_fingerprint,
    number_fingerprint: command.number_fingerprint,
    route_fingerprint: command.route_fingerprint,
    approved_qa_caller_fingerprint: command.approved_qa_caller_fingerprint,
    issued_at: new Date(selectedNow).toISOString(),
    expires_at: new Date(selectedNow + ROUTE_WINDOW_TTL_MS).toISOString(),
    closed_at: null,
  });
  const issueRequest = deepFreeze({
    operation_scope_fingerprint: command.operation_scope_fingerprint,
    request_binding_key: routeWindowRequestBindingKey(command),
    control_scope_fingerprint: dependencies.controlScopeFingerprint,
    expected_control_fence_fingerprint: dependencies.expectedControlFenceFingerprint,
    current_time: proposedWindow.issued_at,
    proposed_window: proposedWindow,
  });
  const result = await dependencies.stateCoordinator
    .issueWindowWithControlFenceAtomically(issueRequest);
  if (
    exactPlainObject(result, new Set(["outcome"])) &&
    [
      "operation_conflict",
      "operation_closed",
      "active_window_conflict",
      "control_fence_conflict",
    ].includes(result.outcome)
  ) {
    throw new FieldSetupOperationError(`route_window_${result.outcome}`);
  }
  if (
    !exactPlainObject(
      result,
      new Set(["outcome", "attempt_epoch", "window", "expired_window"]),
    ) ||
    !["issued", "idempotent_replay"].includes(result.outcome) ||
    !Number.isSafeInteger(result.attempt_epoch) ||
    result.attempt_epoch < 1
  ) {
    throw new FieldSetupOperationError("route_window_response_invalid", 502);
  }
  if (result.expired_window !== null) {
    if (result.outcome !== "issued" || result.attempt_epoch < 2) {
      throw new FieldSetupOperationError("route_window_response_invalid", 502);
    }
    assertExpiredWindow(result.expired_window, command, selectedNow, {
      closedInCurrentTransaction: true,
    });
  }
  assertIssuedWindow(result.window, command, selectedNow, proposedWindow, result.outcome);
  return deepFreeze({
    outcome: result.outcome,
    attemptEpoch: result.attempt_epoch,
    window: { ...result.window },
  });
}

function setupControlBindingFingerprint(command, instructionEvidenceFingerprint) {
  return fingerprint([
    ["client", command.clientFingerprint],
    ["environment", command.environmentFingerprint],
    ["journey", command.journeyFingerprint],
    ["deployment", command.deploymentFingerprint],
    ["configuration", command.configurationFingerprint],
    ["number", command.numberFingerprint ?? "none"],
    ["number_state", command.numberState ?? "none"],
    ["provider", command.providerFingerprint],
    ["route", command.routeFingerprint ?? "none"],
    ["instruction_evidence", instructionEvidenceFingerprint ?? "none"],
    ["approved_qa_caller", command.approvedQaCallerFingerprint ?? "none"],
  ]);
}

function setupControlScopeFingerprint(command) {
  return fingerprint([
    ["client", command.clientFingerprint],
    ["environment", command.environmentFingerprint],
    ["journey", command.journeyFingerprint],
  ]);
}

function setupControlFenceFingerprint(command) {
  const bindingFingerprint = setupControlBindingFingerprint(
    command,
    command.instructionEvidenceFingerprint,
  );
  return fingerprint([
    ["binding", bindingFingerprint],
    ["control_revision", String(command.controlRevision)],
    ["setup_status", command.setupStatus],
    ["forwarding_state", command.forwardingState],
    ["rollback_ready", String(command.rollbackReady)],
  ]);
}

function applyBrowserSetupControl(command) {
  const keys = new Set([
    "action",
    "currentForwardingState",
    "currentInstructionEvidenceFingerprint",
    "currentRollbackReady",
    "currentSetupStatus",
    "clientFingerprint",
    "configurationFingerprint",
    "numberFingerprint",
    "numberState",
    "environmentFingerprint",
    "journeyFingerprint",
    "deploymentFingerprint",
    "providerFingerprint",
    "routeFingerprint",
    "approvedQaCallerFingerprint",
    "instructionEvidenceFingerprint",
  ]);
  if (!exactPlainObject(command, keys)) {
    throw new FieldSetupOperationError("browser_setup_control_invalid", 400);
  }
  for (const key of [
    "clientFingerprint",
    "configurationFingerprint",
    "environmentFingerprint",
    "journeyFingerprint",
    "deploymentFingerprint",
    "providerFingerprint",
  ]) {
    assertFingerprint(command[key], "browser_setup_control_invalid");
  }
  for (const key of ["numberFingerprint", "routeFingerprint"]) {
    if (command[key] !== null) {
      assertFingerprint(command[key], "browser_setup_control_invalid");
    }
  }
  if (
    command.numberState !== null &&
    !Object.prototype.hasOwnProperty.call(NUMBER_STATES, command.numberState)
  ) {
    throw new FieldSetupOperationError("browser_setup_control_invalid", 400);
  }
  if (command.approvedQaCallerFingerprint !== null) {
    assertFingerprint(command.approvedQaCallerFingerprint, "browser_setup_control_invalid");
  }
  for (const key of [
    "currentInstructionEvidenceFingerprint",
    "instructionEvidenceFingerprint",
  ]) {
    if (command[key] !== null) {
      assertFingerprint(command[key], "browser_setup_control_invalid");
    }
  }
  if (![
    "confirm_forwarding_enabled",
    "confirm_rollback_ready",
    "issue_forwarding_instructions",
    "resume",
    "stop",
  ].includes(command.action)) {
    throw new FieldSetupOperationError("browser_action_forbidden", 403);
  }
  if (
    !["in_progress", "stopped"].includes(command.currentSetupStatus) ||
    !Object.hasOwn(FORWARDING_STATES, command.currentForwardingState) ||
    typeof command.currentRollbackReady !== "boolean"
  ) {
    throw new FieldSetupOperationError("browser_setup_control_invalid", 400);
  }
  let nextSetupStatus = command.currentSetupStatus;
  let nextForwardingState = command.currentForwardingState;
  let nextRollbackReady = command.currentRollbackReady;
  let nextInstructionEvidenceFingerprint = command.currentInstructionEvidenceFingerprint;
  if (command.action === "stop") {
    nextSetupStatus = "stopped";
  } else if (command.action === "resume") {
    nextSetupStatus = "in_progress";
  } else {
    if (command.currentSetupStatus !== "in_progress") {
      throw new FieldSetupOperationError("browser_setup_control_invalid", 409);
    }
    if (command.action === "issue_forwarding_instructions") {
      if (
        !["Not Configured", "Instructions Issued"].includes(command.currentForwardingState) ||
        command.instructionEvidenceFingerprint === null ||
        (
          command.currentForwardingState === "Instructions Issued" &&
          command.currentInstructionEvidenceFingerprint !== command.instructionEvidenceFingerprint
        )
      ) {
        throw new FieldSetupOperationError("browser_setup_control_invalid", 409);
      }
      nextForwardingState = "Instructions Issued";
      nextInstructionEvidenceFingerprint = command.instructionEvidenceFingerprint;
    } else if (command.action === "confirm_forwarding_enabled") {
      if (
        !["Instructions Issued", "Customer Reported Enabled"].includes(command.currentForwardingState) ||
        command.instructionEvidenceFingerprint === null ||
        command.currentInstructionEvidenceFingerprint !== command.instructionEvidenceFingerprint
      ) {
        throw new FieldSetupOperationError("browser_setup_control_invalid", 409);
      }
      nextForwardingState = "Customer Reported Enabled";
    } else if (command.action === "confirm_rollback_ready") {
      if (
        command.currentForwardingState !== "Customer Reported Enabled" ||
        command.instructionEvidenceFingerprint === null ||
        command.currentInstructionEvidenceFingerprint !== command.instructionEvidenceFingerprint
      ) {
        throw new FieldSetupOperationError("browser_setup_control_invalid", 409);
      }
      nextRollbackReady = true;
    }
  }
  return deepFreeze({
    action: command.action,
    previousSetupStatus: command.currentSetupStatus,
    setupStatus: nextSetupStatus,
    previousForwardingState: command.currentForwardingState,
    forwardingState: nextForwardingState,
    previousInstructionEvidenceFingerprint: command.currentInstructionEvidenceFingerprint,
    instructionEvidenceFingerprint: nextInstructionEvidenceFingerprint,
    previousRollbackReady: command.currentRollbackReady,
    rollbackReady: nextRollbackReady,
    bindingFingerprint: setupControlBindingFingerprint(
      command,
      nextInstructionEvidenceFingerprint,
    ),
    activateDeployment: false,
    mutateLiveRoute: false,
    requiresSeparateOperatorApproval: true,
  });
}

module.exports = {
  FORWARDING_REVIEW_MAX_VALIDITY_MS,
  FORWARDING_STATES,
  FieldSetupOperationError,
  NUMBER_STATES,
  QA_RUNTIME_DISPOSITION,
  ROUTE_VERIFICATION_WINDOW_FIELDS,
  ROUTE_WINDOW_TTL_MS,
  applyBrowserSetupControl,
  createForwardingRegistry,
  issueRouteVerificationWindow,
  readExistingNumberReservationStatus,
  reserveExistingAvailableNumber,
  resolveForwardingInstructions,
  setupControlBindingFingerprint,
  setupControlFenceFingerprint,
  setupControlScopeFingerprint,
};
