"use strict";

const { createHash } = require("node:crypto");

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
]);

const ROUTE_WINDOW_KEYS = new Set([
  "windowFingerprint",
  "clientFingerprint",
  "environmentFingerprint",
  "journeyFingerprint",
  "deploymentFingerprint",
  "configurationFingerprint",
  "numberFingerprint",
  "routeFingerprint",
  "approvedQaCallerFingerprint",
  "issuedAt",
  "expiresAt",
]);

const OPEN_WINDOW_RECORD_KEYS = new Set([
  ...ROUTE_WINDOW_KEYS,
  "bindingFingerprint",
  "status",
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

async function reserveExistingAvailableNumber(command, dependencies) {
  assertFingerprintObject(command, RESERVATION_KEYS, "invalid_reservation_request");
  if (
    typeof dependencies?.inventory?.claimExistingAvailableNumberAtomically !== "function" ||
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
    claimedAt: new Date(selectedNow).toISOString(),
  });
  const result = await dependencies.inventory.claimExistingAvailableNumberAtomically(claim);

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

  const expectedKeys = new Set([
    "outcome",
    "operationFingerprint",
    "bindingFingerprint",
    "numberFingerprint",
    "state",
  ]);
  if (
    !exactPlainObject(result, expectedKeys) ||
    !["reserved", "idempotent_replay"].includes(result.outcome) ||
    result.operationFingerprint !== command.operationFingerprint ||
    result.bindingFingerprint !== bindingFingerprint ||
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
      "enableSteps",
      "rollbackSteps",
    ]);
    if (
      !exactPlainObject(entry, keys) ||
      !FINGERPRINT_PATTERN.test(entry.providerFingerprint ?? "") ||
      !FINGERPRINT_PATTERN.test(entry.reviewedEvidenceFingerprint ?? "") ||
      !Number.isFinite(canonicalInstant(entry.reviewedAt)) ||
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

function resolveForwardingInstructions(providerFingerprint, reviewedRegistry = []) {
  assertFingerprint(providerFingerprint, "provider_fingerprint_invalid");
  const registry = createForwardingRegistry(reviewedRegistry);
  const match = registry.find((entry) => entry.providerFingerprint === providerFingerprint);
  if (!match) {
    return deepFreeze({
      providerFingerprint,
      status: "Technical Setup Required",
      forwardingState: "Not Configured",
      color: FORWARDING_STATES["Not Configured"].color,
      reviewedEvidenceFingerprint: null,
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
    enableSteps: [...match.enableSteps],
    rollbackSteps: [...match.rollbackSteps],
  });
}

function routeWindowBindingFingerprint(window) {
  return fingerprint([
    ["window", window.windowFingerprint],
    ["client", window.clientFingerprint],
    ["environment", window.environmentFingerprint],
    ["journey", window.journeyFingerprint],
    ["deployment", window.deploymentFingerprint],
    ["configuration", window.configurationFingerprint],
    ["number", window.numberFingerprint],
    ["route", window.routeFingerprint],
    ["approved_qa_caller", window.approvedQaCallerFingerprint],
    ["issued_at", window.issuedAt],
    ["expires_at", window.expiresAt],
  ]);
}

function assertRouteWindowCommand(command, nowMs) {
  if (!exactPlainObject(command, ROUTE_WINDOW_KEYS)) {
    throw new FieldSetupOperationError("route_window_invalid", 400);
  }
  for (const key of ROUTE_WINDOW_KEYS) {
    if (!key.endsWith("At")) assertFingerprint(command[key], "route_window_invalid");
  }
  const issuedAtMs = canonicalInstant(command.issuedAt);
  const expiresAtMs = canonicalInstant(command.expiresAt);
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isFinite(issuedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    issuedAtMs > nowMs ||
    expiresAtMs <= nowMs ||
    expiresAtMs <= issuedAtMs
  ) {
    throw new FieldSetupOperationError("route_window_invalid", 400);
  }
}

async function openRouteVerificationWindow(command, dependencies) {
  if (
    typeof dependencies?.verificationStore?.openWindowAtomically !== "function" ||
    typeof dependencies?.nowMs !== "function"
  ) {
    throw new FieldSetupOperationError("route_verification_dependency_unavailable", 503);
  }
  const selectedNow = dependencies.nowMs();
  assertRouteWindowCommand(command, selectedNow);
  const bindingFingerprint = routeWindowBindingFingerprint(command);
  const requestedWindow = deepFreeze({
    ...command,
    bindingFingerprint,
    status: "open",
  });
  const result = await dependencies.verificationStore.openWindowAtomically(requestedWindow);

  if (exactPlainObject(result, new Set(["outcome"])) && result.outcome === "binding_conflict") {
    throw new FieldSetupOperationError("route_window_binding_conflict");
  }
  if (
    !exactPlainObject(result, new Set(["outcome", "window"])) ||
    !["opened", "idempotent_replay"].includes(result.outcome) ||
    !exactPlainObject(result.window, OPEN_WINDOW_RECORD_KEYS) ||
    Object.keys(requestedWindow).some((key) => result.window[key] !== requestedWindow[key])
  ) {
    throw new FieldSetupOperationError("route_window_response_invalid", 502);
  }
  return deepFreeze({ outcome: result.outcome, window: { ...result.window } });
}

function assertOpenWindow(window) {
  if (!exactPlainObject(window, OPEN_WINDOW_RECORD_KEYS) || window.status !== "open") {
    throw new FieldSetupOperationError("route_window_invalid", 400);
  }
  for (const key of ROUTE_WINDOW_KEYS) {
    if (!key.endsWith("At")) assertFingerprint(window[key], "route_window_invalid");
  }
  if (
    !FINGERPRINT_PATTERN.test(window.bindingFingerprint ?? "") ||
    routeWindowBindingFingerprint(window) !== window.bindingFingerprint ||
    !Number.isFinite(canonicalInstant(window.issuedAt)) ||
    canonicalInstant(window.expiresAt) <= canonicalInstant(window.issuedAt)
  ) {
    throw new FieldSetupOperationError("route_window_invalid", 400);
  }
}

function receiptFingerprint(window, evidenceFingerprint, verifiedAt) {
  return fingerprint([
    ["type", "route-verification-receipt-v1"],
    ["binding", window.bindingFingerprint],
    ["evidence", evidenceFingerprint],
    ["verified_at", verifiedAt],
  ]);
}

async function verifyQaRouteEvidence(command, dependencies) {
  if (!exactPlainObject(command, new Set(["window", "evidenceFingerprint", "observedAt"]))) {
    throw new FieldSetupOperationError("route_evidence_invalid", 400);
  }
  assertOpenWindow(command.window);
  assertFingerprint(command.evidenceFingerprint, "route_evidence_invalid");
  const observedAtMs = canonicalInstant(command.observedAt);
  const currentMs = typeof dependencies?.nowMs === "function" ? dependencies.nowMs() : NaN;
  if (
    typeof dependencies?.verificationStore?.consumeQaEvidenceAtomically !== "function" ||
    !Number.isSafeInteger(currentMs) ||
    currentMs < 0
  ) {
    throw new FieldSetupOperationError("route_verification_dependency_unavailable", 503);
  }
  if (
    !Number.isFinite(observedAtMs) ||
    observedAtMs < canonicalInstant(command.window.issuedAt) ||
    observedAtMs > canonicalInstant(command.window.expiresAt) ||
    observedAtMs > currentMs ||
    currentMs > canonicalInstant(command.window.expiresAt)
  ) {
    throw new FieldSetupOperationError("route_evidence_expired");
  }

  const expectedReceiptFingerprint = receiptFingerprint(
    command.window,
    command.evidenceFingerprint,
    command.observedAt,
  );
  const claim = deepFreeze({
    windowFingerprint: command.window.windowFingerprint,
    bindingFingerprint: command.window.bindingFingerprint,
    evidenceFingerprint: command.evidenceFingerprint,
    receiptFingerprint: expectedReceiptFingerprint,
    verifiedAt: command.observedAt,
  });
  const result = await dependencies.verificationStore.consumeQaEvidenceAtomically(claim);

  if (
    exactPlainObject(result, new Set(["outcome"])) &&
    ["binding_conflict", "replay_conflict", "not_open", "expired"].includes(result.outcome)
  ) {
    throw new FieldSetupOperationError(`route_evidence_${result.outcome}`);
  }
  const expectedKeys = new Set([
    "outcome",
    "windowFingerprint",
    "bindingFingerprint",
    "evidenceFingerprint",
    "receiptFingerprint",
    "verifiedAt",
    "status",
  ]);
  if (
    !exactPlainObject(result, expectedKeys) ||
    !["verified", "idempotent_replay"].includes(result.outcome) ||
    result.windowFingerprint !== claim.windowFingerprint ||
    result.bindingFingerprint !== claim.bindingFingerprint ||
    result.evidenceFingerprint !== claim.evidenceFingerprint ||
    result.receiptFingerprint !== claim.receiptFingerprint ||
    result.verifiedAt !== claim.verifiedAt ||
    result.status !== "verified"
  ) {
    throw new FieldSetupOperationError("route_evidence_response_invalid", 502);
  }

  const receipt = {
    receiptFingerprint: result.receiptFingerprint,
    windowFingerprint: command.window.windowFingerprint,
    bindingFingerprint: command.window.bindingFingerprint,
    clientFingerprint: command.window.clientFingerprint,
    environmentFingerprint: command.window.environmentFingerprint,
    journeyFingerprint: command.window.journeyFingerprint,
    deploymentFingerprint: command.window.deploymentFingerprint,
    configurationFingerprint: command.window.configurationFingerprint,
    numberFingerprint: command.window.numberFingerprint,
    routeFingerprint: command.window.routeFingerprint,
    approvedQaCallerFingerprint: command.window.approvedQaCallerFingerprint,
    evidenceFingerprint: result.evidenceFingerprint,
    issuedAt: command.window.issuedAt,
    expiresAt: command.window.expiresAt,
    verifiedAt: result.verifiedAt,
    status: "verified",
    runtimeDisposition: QA_RUNTIME_DISPOSITION,
  };
  return deepFreeze({ outcome: result.outcome, receipt });
}

function applyBrowserSetupControl(command) {
  const keys = new Set([
    "action",
    "currentStatus",
    "clientFingerprint",
    "environmentFingerprint",
    "journeyFingerprint",
    "deploymentFingerprint",
  ]);
  if (!exactPlainObject(command, keys)) {
    throw new FieldSetupOperationError("browser_setup_control_invalid", 400);
  }
  for (const key of [
    "clientFingerprint",
    "environmentFingerprint",
    "journeyFingerprint",
    "deploymentFingerprint",
  ]) {
    assertFingerprint(command[key], "browser_setup_control_invalid");
  }
  if (!["stop", "resume"].includes(command.action)) {
    throw new FieldSetupOperationError("browser_action_forbidden", 403);
  }
  if (!["in_progress", "stopped"].includes(command.currentStatus)) {
    throw new FieldSetupOperationError("browser_setup_control_invalid", 400);
  }
  const nextStatus = command.action === "stop" ? "stopped" : "in_progress";
  return deepFreeze({
    action: command.action,
    previousStatus: command.currentStatus,
    nextStatus,
    bindingFingerprint: fingerprint([
      ["client", command.clientFingerprint],
      ["environment", command.environmentFingerprint],
      ["journey", command.journeyFingerprint],
      ["deployment", command.deploymentFingerprint],
    ]),
    activateDeployment: false,
    mutateLiveRoute: false,
    requiresSeparateOperatorApproval: true,
  });
}

module.exports = {
  FORWARDING_STATES,
  FieldSetupOperationError,
  NUMBER_STATES,
  QA_RUNTIME_DISPOSITION,
  applyBrowserSetupControl,
  createForwardingRegistry,
  openRouteVerificationWindow,
  reserveExistingAvailableNumber,
  resolveForwardingInstructions,
  verifyQaRouteEvidence,
};
