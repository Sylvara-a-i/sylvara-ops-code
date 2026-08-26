"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
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
  setupControlFenceFingerprint,
} = require("../lib/field-setup-operations");

const NOW_MS = Date.parse("2026-08-25T15:00:00.000Z");
const fp = (character) => character.repeat(64);
const CONTROL_SCOPE_FINGERPRINT = fp("c");
const CONTROL_FENCE_FINGERPRINT = fp("d");

function reservationCommand(overrides = {}) {
  return {
    operationFingerprint: fp("1"),
    clientFingerprint: fp("2"),
    environmentFingerprint: fp("3"),
    journeyFingerprint: fp("4"),
    deploymentFingerprint: fp("5"),
    configurationFingerprint: fp("6"),
    controlScopeFingerprint: CONTROL_SCOPE_FINGERPRINT,
    expectedControlFenceFingerprint: CONTROL_FENCE_FINGERPRINT,
    ...overrides,
  };
}

function atomicInventory(numberFingerprint = fp("7")) {
  let reservation = null;
  const claims = [];
  const postClaimControlFenceFingerprint = fp("e");
  return {
    claims,
    async readNumberReservationStatus({ bindingFingerprint }) {
      if (!reservation) {
        return {
          outcome: "available",
          bindingFingerprint,
          numberFingerprint,
          state: "Available",
        };
      }
      if (reservation.bindingFingerprint !== bindingFingerprint) {
        return { outcome: "none_available" };
      }
      return {
        outcome: "bound",
        bindingFingerprint,
        numberFingerprint,
        state: "Reserved",
      };
    },
    async claimExistingAvailableNumberWithControlFenceAtomically(claim) {
      claims.push(claim);
      assert.equal(Object.isFrozen(claim), true);
      if (!reservation) {
        reservation = {
          ...claim,
          numberFingerprint,
          previousControlFenceFingerprint: claim.expectedControlFenceFingerprint,
          controlFenceFingerprint: postClaimControlFenceFingerprint,
        };
        return {
          outcome: "reserved",
          operationFingerprint: claim.operationFingerprint,
          bindingFingerprint: claim.bindingFingerprint,
          numberFingerprint,
          state: "Reserved",
          controlScopeFingerprint: claim.controlScopeFingerprint,
          previousControlFenceFingerprint: reservation.previousControlFenceFingerprint,
          controlFenceFingerprint: reservation.controlFenceFingerprint,
          claimedAt: reservation.claimedAt,
        };
      }
      if (
        reservation.operationFingerprint === claim.operationFingerprint &&
        reservation.bindingFingerprint === claim.bindingFingerprint
      ) {
        return {
          outcome: "idempotent_replay",
          operationFingerprint: claim.operationFingerprint,
          bindingFingerprint: claim.bindingFingerprint,
          numberFingerprint,
          state: "Reserved",
          controlScopeFingerprint: claim.controlScopeFingerprint,
          previousControlFenceFingerprint: reservation.previousControlFenceFingerprint,
          controlFenceFingerprint: reservation.controlFenceFingerprint,
          claimedAt: reservation.claimedAt,
        };
      }
      if (reservation.operationFingerprint === claim.operationFingerprint) {
        return { outcome: "binding_conflict" };
      }
      return { outcome: "none_available" };
    },
  };
}

const typed = (prefix, character) => `${prefix}_${fp(character)}`;

function routeWindowIssueCommand(overrides = {}) {
  return {
    operation_scope_fingerprint: typed("operation_scope", "8"),
    client_fingerprint: typed("client", "9"),
    environment_fingerprint: typed("environment", "a"),
    journey_fingerprint: typed("journey", "b"),
    deployment_fingerprint: typed("deployment", "c"),
    configuration_fingerprint: typed("configuration", "d"),
    control_fence_fingerprint: `control_fence_${CONTROL_FENCE_FINGERPRINT}`,
    provider_fingerprint: typed("provider", "1"),
    instruction_evidence_fingerprint: typed("instruction_evidence", "2"),
    number_fingerprint: typed("number", "e"),
    route_fingerprint: typed("route", "f"),
    approved_qa_caller_fingerprint: typed("qa_caller", "0"),
    ...overrides,
  };
}

function atomicVerificationStore() {
  const operations = new Map();
  const latestByScope = new Map();
  const activeBindings = new Map();
  const routeBinding = (window) => [
    window.environment_fingerprint,
    window.client_fingerprint,
    window.deployment_fingerprint,
    window.configuration_fingerprint,
    window.control_fence_fingerprint,
    window.provider_fingerprint,
    window.instruction_evidence_fingerprint,
    window.number_fingerprint,
    window.route_fingerprint,
  ].join("\0");
  const expire = (existing, currentTime) => {
    const closed = {
      ...existing.window,
      status: "Expired",
      closed_at: currentTime,
    };
    existing.window = closed;
    activeBindings.delete(routeBinding(closed));
    return { ...closed };
  };
  return {
    issued: [],
    operations,
    latestByScope,
    activeBindings,
    async issueWindowWithControlFenceAtomically(request) {
      this.issued.push(request);
      assert.equal(Object.isFrozen(request), true);
      assert.equal(Object.isFrozen(request.proposed_window), true);
      assert.equal(request.current_time, request.proposed_window.issued_at);
      const currentMs = Date.parse(request.current_time);
      const existing = latestByScope.get(request.operation_scope_fingerprint);
      let expiredWindow = null;
      if (existing) {
        if (existing.request_binding_key !== request.request_binding_key) {
          return { outcome: "operation_conflict" };
        }
        if (
          existing.window.status === "Open" &&
          currentMs >= Date.parse(existing.window.expires_at)
        ) {
          expiredWindow = expire(existing, request.current_time);
        }
        if (existing.window.status === "Open") {
          return {
            outcome: "idempotent_replay",
            attempt_epoch: existing.attempt_epoch,
            window: { ...existing.window },
            expired_window: null,
          };
        }
        if (existing.window.status !== "Expired") return { outcome: "operation_closed" };
      }
      const binding = routeBinding(request.proposed_window);
      const activeOperation = activeBindings.get(binding);
      if (activeOperation !== undefined) {
        const active = operations.get(activeOperation);
        if (
          active.window.status === "Open" &&
          currentMs >= Date.parse(active.window.expires_at)
        ) {
          expiredWindow = expire(active, request.current_time);
        } else {
          return { outcome: "active_window_conflict" };
        }
      }
      const stored = {
        attempt_epoch: existing ? existing.attempt_epoch + 1 : 1,
        request_binding_key: request.request_binding_key,
        window: { ...request.proposed_window },
      };
      const operationKey = `${request.operation_scope_fingerprint}:${stored.attempt_epoch}`;
      operations.set(operationKey, stored);
      latestByScope.set(request.operation_scope_fingerprint, stored);
      activeBindings.set(binding, operationKey);
      return {
        outcome: "issued",
        attempt_epoch: stored.attempt_epoch,
        window: { ...request.proposed_window },
        expired_window: expiredWindow,
      };
    },
    async readLatestWindowByOperationScopeFingerprint({ operation_scope_fingerprint }) {
      const latest = latestByScope.get(operation_scope_fingerprint);
      return {
        attempt_epoch: latest.attempt_epoch,
        window: { ...latest.window },
      };
    },
  };
}

function routeWindowDependencies(stateCoordinator, overrides = {}) {
  return {
    stateCoordinator,
    controlScopeFingerprint: CONTROL_SCOPE_FINGERPRINT,
    expectedControlFenceFingerprint: CONTROL_FENCE_FINGERPRINT,
    nowMs: () => NOW_MS,
    ...overrides,
  };
}

function isOperationError(code) {
  return (error) => error instanceof FieldSetupOperationError && error.publicCode === code;
}

test("publishes every approved number and forwarding display state without permitting mutation", () => {
  assert.deepEqual(NUMBER_STATES, {
    Available: { color: "Gray" },
    Reserved: { color: "Blue" },
    Assigned: { color: "Teal" },
    Live: { color: "Green" },
    Cooldown: { color: "Amber" },
    Retired: { color: "Red" },
  });
  assert.deepEqual(FORWARDING_STATES, {
    "Not Configured": { color: "Gray" },
    "Instructions Issued": { color: "Blue" },
    "Customer Reported Enabled": { color: "Amber" },
    "Verification In Progress": { color: "Orange" },
    Verified: { color: "Green" },
    "Verification Failed": { color: "Red" },
    Disabled: { color: "Gray" },
    "Rollback Verified": { color: "Purple" },
  });
  assert.equal(Object.isFrozen(NUMBER_STATES.Reserved), true);
  assert.throws(() => { NUMBER_STATES.Reserved.color = "Red"; }, TypeError);
});

test("reserves one existing Available number atomically and replays the exact binding", async () => {
  const inventory = atomicInventory();
  let currentMs = NOW_MS;
  const dependencies = { stateCoordinator: inventory, nowMs: () => currentMs };
  const first = await reserveExistingAvailableNumber(reservationCommand(), dependencies);
  currentMs += 1000;
  const replay = await reserveExistingAvailableNumber(reservationCommand(), dependencies);

  assert.equal(first.outcome, "reserved");
  assert.equal(first.state, "Reserved");
  assert.equal(first.color, "Blue");
  assert.equal(first.purchaseAttempted, false);
  assert.equal(replay.outcome, "idempotent_replay");
  assert.equal(replay.numberFingerprint, first.numberFingerprint);
  assert.equal(replay.bindingFingerprint, first.bindingFingerprint);
  assert.equal(replay.claimedAt, first.claimedAt);
  assert.deepEqual(inventory.claims.map(({ expectedState, nextState }) => ({ expectedState, nextState })), [
    { expectedState: "Available", nextState: "Reserved" },
    { expectedState: "Available", nextState: "Reserved" },
  ]);
  assert.equal(Object.hasOwn(inventory, "purchaseNumber"), false);
});

test("reads only a fingerprint-bound number display state and rejects malformed readback", async () => {
  const inventory = atomicInventory();
  const command = { ...reservationCommand() };
  delete command.operationFingerprint;
  delete command.controlScopeFingerprint;
  delete command.expectedControlFenceFingerprint;
  const available = await readExistingNumberReservationStatus(command, {
    stateCoordinator: inventory,
  });
  assert.equal(available.state, "Available");
  assert.equal(available.color, "Gray");

  await reserveExistingAvailableNumber(reservationCommand(), {
    stateCoordinator: inventory,
    nowMs: () => NOW_MS,
  });
  const reserved = await readExistingNumberReservationStatus(command, {
    stateCoordinator: inventory,
  });
  assert.equal(reserved.state, "Reserved");
  assert.equal(reserved.color, "Blue");

  await assert.rejects(
    readExistingNumberReservationStatus(command, {
      stateCoordinator: {
        async readNumberReservationStatus() {
          return {
            outcome: "bound",
            bindingFingerprint: fp("a"),
            numberFingerprint: fp("7"),
            state: "Live",
          };
        },
      },
    }),
    isOperationError("reservation_readback_invalid"),
  );
});

test("reservation fails closed across clients and never promotes a non-reservation response", async () => {
  const inventory = atomicInventory();
  const dependencies = { stateCoordinator: inventory, nowMs: () => NOW_MS };
  await reserveExistingAvailableNumber(reservationCommand(), dependencies);
  await assert.rejects(
    reserveExistingAvailableNumber(
      reservationCommand({ clientFingerprint: fp("a") }),
      dependencies,
    ),
    isOperationError("reservation_binding_conflict"),
  );

  await assert.rejects(
    reserveExistingAvailableNumber(reservationCommand(), {
      nowMs: () => NOW_MS,
      stateCoordinator: {
        async claimExistingAvailableNumberWithControlFenceAtomically(claim) {
          return {
            outcome: "reserved",
            operationFingerprint: claim.operationFingerprint,
            bindingFingerprint: claim.bindingFingerprint,
            numberFingerprint: fp("7"),
            state: "Live",
            controlScopeFingerprint: claim.controlScopeFingerprint,
            previousControlFenceFingerprint: claim.expectedControlFenceFingerprint,
            controlFenceFingerprint: fp("e"),
            claimedAt: claim.claimedAt,
          };
        },
      },
    }),
    isOperationError("reservation_response_invalid"),
  );
});

test("concurrent claims cannot share the only available number", async () => {
  const inventory = atomicInventory();
  const dependencies = { stateCoordinator: inventory, nowMs: () => NOW_MS };
  const [first, second] = await Promise.all([
    reserveExistingAvailableNumber(reservationCommand(), dependencies),
    reserveExistingAvailableNumber(reservationCommand({ operationFingerprint: fp("a") }), dependencies),
  ]);
  assert.equal(first.state, "Reserved");
  assert.deepEqual(second, {
    outcome: "blocked",
    publicCode: "test_number_required",
    message: "Test Number Required — Sylvara Must Assign A Number Before Continuing",
    purchaseAttempted: false,
  });
});

test("an unreviewed provider returns Technical Setup Required with no invented instructions", () => {
  const selected = resolveForwardingInstructions(fp("a"), [], NOW_MS);
  assert.deepEqual(selected, {
    providerFingerprint: fp("a"),
    status: "Technical Setup Required",
    forwardingState: "Not Configured",
    color: "Gray",
    reviewedEvidenceFingerprint: null,
    reviewedAt: null,
    reviewedUntil: null,
    enableSteps: [],
    rollbackSteps: [],
  });
});

test("forwarding instructions require a reviewed evidence fingerprint and preserved rollback steps", () => {
  assert.throws(
    () => createForwardingRegistry([{
      providerFingerprint: fp("a"),
      reviewedEvidenceFingerprint: "",
      reviewedAt: "2026-08-25T12:00:00.000Z",
      reviewedUntil: "2026-09-01T12:00:00.000Z",
      enableSteps: ["Use the reviewed provider procedure."],
      rollbackSteps: ["Restore the reviewed prior route."],
    }]),
    isOperationError("forwarding_registry_invalid"),
  );
  const registry = createForwardingRegistry([{
    providerFingerprint: fp("a"),
    reviewedEvidenceFingerprint: fp("b"),
    reviewedAt: "2026-08-25T12:00:00.000Z",
    reviewedUntil: "2026-09-01T12:00:00.000Z",
    enableSteps: ["Use the reviewed provider procedure."],
    rollbackSteps: ["Restore the reviewed prior route."],
  }]);
  const selected = resolveForwardingInstructions(fp("a"), registry, NOW_MS);
  assert.equal(selected.status, "Reviewed Instructions Available");
  assert.equal(selected.forwardingState, "Instructions Issued");
  assert.deepEqual(selected.rollbackSteps, ["Restore the reviewed prior route."]);
});

test("stale or future-reviewed forwarding evidence fails closed", () => {
  const entry = {
    providerFingerprint: fp("a"),
    reviewedEvidenceFingerprint: fp("b"),
    reviewedAt: "2026-08-25T12:00:00.000Z",
    reviewedUntil: "2026-09-01T12:00:00.000Z",
    enableSteps: ["Use the reviewed provider procedure."],
    rollbackSteps: ["Restore the reviewed prior route."],
  };
  assert.equal(
    resolveForwardingInstructions(fp("a"), [entry], Date.parse(entry.reviewedUntil)).status,
    "Technical Setup Required",
  );
  assert.equal(
    resolveForwardingInstructions(
      fp("a"),
      [entry],
      Date.parse(entry.reviewedAt) - 1,
    ).status,
    "Technical Setup Required",
  );
  assert.throws(
    () => createForwardingRegistry([{
      ...entry,
      reviewedUntil: "2026-09-24T12:00:00.001Z",
    }]),
    isOperationError("forwarding_registry_invalid"),
  );
});

test("setup issues the exact gateway window atomically and cannot consume route evidence", async () => {
  const verificationStore = atomicVerificationStore();
  let generated = 0;
  const dependencies = routeWindowDependencies(verificationStore, {
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  });
  const opened = await issueRouteVerificationWindow(routeWindowIssueCommand(), dependencies);
  const replay = await issueRouteVerificationWindow(routeWindowIssueCommand(), dependencies);
  assert.equal(opened.outcome, "issued");
  assert.equal(opened.attemptEpoch, 1);
  assert.equal(replay.outcome, "idempotent_replay");
  assert.equal(replay.attemptEpoch, 1);
  assert.deepEqual(replay.window, opened.window);
  assert.deepEqual(Object.keys(opened.window), ROUTE_VERIFICATION_WINDOW_FIELDS);
  assert.equal(opened.window.status, "Open");
  assert.equal(opened.window.closed_at, null);
  assert.equal(Date.parse(opened.window.expires_at) - Date.parse(opened.window.issued_at),
    ROUTE_WINDOW_TTL_MS);
  assert.deepEqual(Object.keys(verificationStore.issued[0]), [
    "operation_scope_fingerprint",
    "request_binding_key",
    "control_scope_fingerprint",
    "expected_control_fence_fingerprint",
    "current_time",
    "proposed_window",
  ]);
  assert.equal(verificationStore.issued[0].current_time, opened.window.issued_at);
  assert.equal(Object.hasOwn(verificationStore, "consumeOpenWindow"), false);
  assert.equal(Object.hasOwn(verificationStore, "consumeQaEvidenceAtomically"), false);
  assert.equal(Object.hasOwn(opened, "receipt"), false);

  await assert.rejects(
    issueRouteVerificationWindow({
      ...routeWindowIssueCommand(),
      window: opened.window,
    }, dependencies),
    isOperationError("route_window_issue_invalid"),
  );
});

test("route-window issuance rejects every binding mutation and concurrent active-window replay", async () => {
  const verificationStore = atomicVerificationStore();
  let generated = 0;
  const dependencies = routeWindowDependencies(verificationStore, {
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  });
  await issueRouteVerificationWindow(routeWindowIssueCommand(), dependencies);
  const mutations = {
    client_fingerprint: typed("client", "1"),
    environment_fingerprint: typed("environment", "2"),
    journey_fingerprint: typed("journey", "3"),
    deployment_fingerprint: typed("deployment", "4"),
    configuration_fingerprint: typed("configuration", "5"),
    provider_fingerprint: typed("provider", "6"),
    instruction_evidence_fingerprint: typed("instruction_evidence", "7"),
    number_fingerprint: typed("number", "8"),
    route_fingerprint: typed("route", "9"),
    approved_qa_caller_fingerprint: typed("qa_caller", "a"),
  };
  for (const [key, value] of Object.entries(mutations)) {
    await assert.rejects(
      issueRouteVerificationWindow(routeWindowIssueCommand({ [key]: value }), dependencies),
      isOperationError("route_window_operation_conflict"),
      key,
    );
  }
  await assert.rejects(
    issueRouteVerificationWindow(routeWindowIssueCommand({
      control_fence_fingerprint: typed("control_fence", "6"),
    }), dependencies),
    isOperationError("route_window_issue_invalid"),
  );
  await assert.rejects(
    issueRouteVerificationWindow(routeWindowIssueCommand({
      operation_scope_fingerprint: typed("operation_scope", "a"),
    }), dependencies),
    isOperationError("route_window_active_window_conflict"),
  );
});

test("route-window issuance fails closed on invalid clocks and key generation", async () => {
  const verificationStore = atomicVerificationStore();
  await assert.rejects(
    issueRouteVerificationWindow(routeWindowIssueCommand(), {
      ...routeWindowDependencies(verificationStore),
      nowMs: () => Number.MAX_SAFE_INTEGER,
    }),
    isOperationError("route_verification_clock_invalid"),
  );
  await assert.rejects(
    issueRouteVerificationWindow(routeWindowIssueCommand(), {
      ...routeWindowDependencies(verificationStore),
      nowMs: () => NOW_MS,
      windowKeyFactory() { throw new Error("private generator failure"); },
    }),
    isOperationError("route_verification_key_invalid"),
  );
  await assert.rejects(
    issueRouteVerificationWindow(routeWindowIssueCommand(), {
      ...routeWindowDependencies(verificationStore),
      nowMs: () => NOW_MS,
      windowKeyFactory: () => routeWindowIssueCommand().operation_scope_fingerprint,
    }),
    isOperationError("route_verification_key_invalid"),
  );
  assert.equal(verificationStore.issued.length, 0);
});

test("concurrent exact issuance has one winner and never creates two open windows", async () => {
  const verificationStore = atomicVerificationStore();
  let generated = 0;
  const dependencies = routeWindowDependencies(verificationStore, {
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  });
  const [first, second] = await Promise.all([
    issueRouteVerificationWindow(routeWindowIssueCommand(), dependencies),
    issueRouteVerificationWindow(routeWindowIssueCommand(), dependencies),
  ]);
  assert.deepEqual([first.outcome, second.outcome].sort(), ["idempotent_replay", "issued"]);
  assert.equal(first.window.window_key, second.window.window_key);
  assert.equal(verificationStore.issued.length, 2);
});

test("an expired attempt is atomically closed and the same server scope reissues once", async () => {
  const verificationStore = atomicVerificationStore();
  let currentMs = NOW_MS;
  let generated = 0;
  const dependencies = routeWindowDependencies(verificationStore, {
    nowMs: () => currentMs,
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  });
  const command = routeWindowIssueCommand();
  const first = await issueRouteVerificationWindow(command, dependencies);

  currentMs += ROUTE_WINDOW_TTL_MS;
  const renewed = await issueRouteVerificationWindow(command, dependencies);
  const replay = await issueRouteVerificationWindow(command, dependencies);
  const windows = [...verificationStore.operations.values()].map(({ window }) => window);
  const expired = windows.find(({ status }) => status === "Expired");
  assert.equal(first.attemptEpoch, 1);
  assert.equal(renewed.outcome, "issued");
  assert.equal(renewed.attemptEpoch, 2);
  assert.equal(replay.outcome, "idempotent_replay");
  assert.equal(replay.attemptEpoch, 2);
  assert.equal(replay.window.window_key, renewed.window.window_key);
  assert.equal(expired.status, "Expired");
  assert.equal(expired.closed_at, new Date(currentMs).toISOString());
  assert.equal(windows.filter(({ status }) => status === "Open").length, 1);
  assert.equal(verificationStore.activeBindings.size, 1);
});

test("a different server scope cannot replace an active exact window", async () => {
  const verificationStore = atomicVerificationStore();
  let currentMs = NOW_MS;
  let generated = 0;
  const dependencies = routeWindowDependencies(verificationStore, {
    nowMs: () => currentMs,
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  });
  await issueRouteVerificationWindow(routeWindowIssueCommand(), dependencies);
  await assert.rejects(
    issueRouteVerificationWindow(routeWindowIssueCommand({
      operation_scope_fingerprint: typed("operation_scope", "a"),
    }), dependencies),
    isOperationError("route_window_active_window_conflict"),
  );
  assert.equal(verificationStore.activeBindings.size, 1);
});

test("concurrent exact requests after expiry allocate one fresh attempt and one replay", async () => {
  const verificationStore = atomicVerificationStore();
  let currentMs = NOW_MS;
  let generated = 0;
  const dependencies = routeWindowDependencies(verificationStore, {
    nowMs: () => currentMs,
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  });
  const staleCommand = routeWindowIssueCommand();
  await issueRouteVerificationWindow(staleCommand, dependencies);
  currentMs += ROUTE_WINDOW_TTL_MS;

  const results = await Promise.all([
    issueRouteVerificationWindow(staleCommand, dependencies),
    issueRouteVerificationWindow(staleCommand, dependencies),
  ]);
  assert.deepEqual(results.map(({ outcome }) => outcome).sort(), [
    "idempotent_replay",
    "issued",
  ]);
  assert.equal(results[0].attemptEpoch, 2);
  assert.equal(results[1].attemptEpoch, 2);
  assert.equal(results[0].window.window_key, results[1].window.window_key);
  const windows = [...verificationStore.operations.values()].map(({ window }) => window);
  assert.equal(windows.filter(({ status }) => status === "Open").length, 1);
  assert.equal(windows.filter(({ status }) => status === "Expired").length, 1);
  assert.equal(verificationStore.activeBindings.size, 1);
});

test("QA route runtime disposition remains a zero-side-effect gateway invariant", () => {
  assert.deepEqual(QA_RUNTIME_DISPOSITION, {
    startAgent: false,
    collectAgentIntake: false,
    createTranscript: false,
    createPostCallAnalysis: false,
    incrementHandledCallCount: false,
    sendNotification: false,
    activateDeployment: false,
    performOperationalAction: false,
  });
  assert.equal(Object.isFrozen(QA_RUNTIME_DISPOSITION), true);
});

test("browser setup control permits only bounded evidence and lifecycle intents", () => {
  const common = {
    clientFingerprint: fp("1"),
    configurationFingerprint: fp("5"),
    environmentFingerprint: fp("2"),
    journeyFingerprint: fp("3"),
    deploymentFingerprint: fp("4"),
    numberFingerprint: fp("6"),
    numberState: "Assigned",
    providerFingerprint: fp("7"),
    routeFingerprint: fp("8"),
    approvedQaCallerFingerprint: fp("a"),
    currentForwardingState: "Not Configured",
    currentInstructionEvidenceFingerprint: null,
    currentRollbackReady: false,
    instructionEvidenceFingerprint: null,
  };
  const stopped = applyBrowserSetupControl({
    action: "stop",
    currentSetupStatus: "in_progress",
    ...common,
  });
  const resumed = applyBrowserSetupControl({
    action: "resume",
    currentSetupStatus: "stopped",
    ...common,
  });
  const issued = applyBrowserSetupControl({
    action: "issue_forwarding_instructions",
    currentSetupStatus: "in_progress",
    ...common,
    instructionEvidenceFingerprint: fp("9"),
  });
  const forwardingAcknowledged = applyBrowserSetupControl({
    action: "confirm_forwarding_enabled",
    currentSetupStatus: "in_progress",
    ...common,
    currentForwardingState: "Instructions Issued",
    currentInstructionEvidenceFingerprint: fp("9"),
    instructionEvidenceFingerprint: fp("9"),
  });
  const rollbackAcknowledged = applyBrowserSetupControl({
    action: "confirm_rollback_ready",
    currentSetupStatus: "in_progress",
    ...common,
    currentForwardingState: "Customer Reported Enabled",
    currentInstructionEvidenceFingerprint: fp("9"),
    instructionEvidenceFingerprint: fp("9"),
  });
  assert.equal(stopped.setupStatus, "stopped");
  assert.equal(resumed.setupStatus, "in_progress");
  assert.equal(issued.forwardingState, "Instructions Issued");
  assert.equal(forwardingAcknowledged.forwardingState, "Customer Reported Enabled");
  assert.equal(rollbackAcknowledged.rollbackReady, true);
  assert.equal(stopped.activateDeployment, false);
  assert.equal(stopped.mutateLiveRoute, false);
  assert.equal(stopped.requiresSeparateOperatorApproval, true);
  assert.notEqual(
    setupControlFenceFingerprint({
      ...common,
      controlRevision: 3,
      forwardingState: "Customer Reported Enabled",
      rollbackReady: true,
      setupStatus: "in_progress",
    }),
    setupControlFenceFingerprint({
      ...common,
      controlRevision: 3,
      forwardingState: "Customer Reported Enabled",
      numberState: "Cooldown",
      rollbackReady: true,
      setupStatus: "in_progress",
    }),
  );
  assert.notEqual(
    setupControlFenceFingerprint({
      ...common,
      controlRevision: 3,
      forwardingState: "Customer Reported Enabled",
      rollbackReady: true,
      setupStatus: "in_progress",
    }),
    setupControlFenceFingerprint({
      ...common,
      approvedQaCallerFingerprint: fp("b"),
      controlRevision: 3,
      forwardingState: "Customer Reported Enabled",
      rollbackReady: true,
      setupStatus: "in_progress",
    }),
  );

  for (const action of ["activate", "mutate_live_route", "reserve_number"] ) {
    assert.throws(
      () => applyBrowserSetupControl({ action, currentSetupStatus: "in_progress", ...common }),
      isOperationError("browser_action_forbidden"),
    );
  }
  assert.throws(
    () => applyBrowserSetupControl({
      action: "stop",
      currentSetupStatus: "in_progress",
      ...common,
      rawPhoneNumber: "forbidden-raw-value",
    }),
    isOperationError("browser_setup_control_invalid"),
  );
});

test("the proposed contract is source-only, one-table, and matches executable display/runtime rules", () => {
  const contractPath = path.join(
    __dirname,
    "../../../config/field-setup-operations.proposed.json",
  );
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  assert.equal(contract.status, "SOURCE_ONLY_NOT_DEPLOYABLE");
  assert.equal(contract.provider_route_verification_readiness, "NOT_READY");
  assert.deepEqual(contract.topology, {
    owning_function: "revenue_leak_test_setup_form",
    new_functions: 0,
    new_routes: 0,
    new_tables_required_if_installed: 1,
    new_tables_provisioned: 0,
    shared_workflow_table: "RevenueLeakTestFieldSetupJourneys",
    strict_record_types: [
      "journey",
      "current_control",
      "control_operation",
      "number_inventory",
      "reservation_receipt",
      "verification_attempt",
      "verification_window",
    ],
    source_route_adapters: 5,
    existing_handler_changed: true,
    default_composition: "deny_all_claims_no_routes",
  });
  assert.deepEqual(contract.source_composition, {
    runtime_status: "NOT_READY",
    catalyst_header_mapping: "NOT_READY_INJECTED_ONLY",
    catalyst_identity_mapping: "NOT_READY_INJECTED_ONLY",
    catalyst_store_mapping: "NOT_READY_INJECTED_ONLY",
    deployment_authorized: false,
    runtime_authority: false,
    request_scoped_catalyst_app_to_exact_adapters: true,
    provider_client_injected: false,
    activation_adapter_injected: false,
    live_route_adapter_injected: false,
    verification_consumption_adapter_injected: false,
    production_behavior: "dark_before_sdk_or_route_composition",
    state_coordinator: {
      authoritative_transaction_domain: "strict coordinator recordType families in the one RevenueLeakTestFieldSetupJourneys table; the journey family is projected to its exact canonical executable shape",
      required_methods: [
        "readNumberReservationStatus",
        "readNumberReservationReceiptByOperationFingerprint",
        "claimExistingAvailableNumberWithControlFenceAtomically",
        "issueWindowWithControlFenceAtomically",
        "readLatestWindowByOperationScopeFingerprint",
        "applyControlIntentAtomically",
        "readControlOperationByOperationFingerprint",
      ],
      gateway_shared_method: "consumeOpenWindowAtCurrentControlFence",
      serializable_control_fence_validation_required: true,
      private_mapping_status: "NOT_READY_INJECTED_ONLY",
    },
  });
  assert.deepEqual(contract.source_routes.map(({ id, method, enabled }) => ({
    id,
    method,
    enabled,
  })), [
    { id: "FIELD_SETUP_NUMBER_STATUS", method: "GET", enabled: false },
    { id: "FIELD_SETUP_NUMBER_CLAIM", method: "POST", enabled: false },
    { id: "FIELD_SETUP_FORWARDING_INSTRUCTIONS", method: "POST", enabled: false },
    { id: "FIELD_SETUP_ROUTE_VERIFICATION_WINDOW", method: "POST", enabled: false },
    { id: "FIELD_SETUP_CONTROL", method: "POST", enabled: false },
  ]);
  assert.deepEqual(contract.source_routes[2].body, ["journeyRevision", "view"]);
  assert.deepEqual(contract.source_routes[2].allowed_views, ["enable", "rollback"]);
  assert.deepEqual(
    contract.number_inventory.states,
    Object.entries(NUMBER_STATES).map(([value, { color }]) => ({ value, color })),
  );
  assert.deepEqual(contract.number_inventory.binding, [
    "client_fingerprint",
    "environment_fingerprint",
    "journey_fingerprint",
    "deployment_fingerprint",
    "configuration_fingerprint",
  ]);
  assert.deepEqual(contract.number_inventory.receipt_fields, [
    "operationFingerprint",
    "bindingFingerprint",
    "numberFingerprint",
    "state",
    "controlScopeFingerprint",
    "previousControlFenceFingerprint",
    "controlFenceFingerprint",
    "claimedAt",
  ]);
  assert.match(contract.number_inventory.atomic_replay_fence_rule,
    /pre-claim fence.*post-claim current fence/);
  assert.deepEqual(
    contract.forwarding.states,
    Object.entries(FORWARDING_STATES).map(([value, { color }]) => ({ value, color })),
  );
  assert.deepEqual(contract.forwarding.reviewed_provider_entries, []);
  assert.equal(contract.forwarding.invent_steps_or_codes, false);
  assert.match(contract.route_verification.setup_responsibility,
    /stable operation scope.*coordinator-owned attempt epoch/);
  assert.match(contract.route_verification.gateway_responsibility,
    /consumeOpenWindowAtCurrentControlFence.*current authoritative control fence/);
  assert.equal(contract.route_verification.issue_command_authority,
    "server_resolved_from_authenticated_operator_and_stored_journey_only");
  assert.deepEqual(contract.route_verification.issue_command_fields, [
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
  assert.deepEqual(contract.route_verification.issue_store_request_fields, [
    "operation_scope_fingerprint",
    "request_binding_key",
    "control_scope_fingerprint",
    "expected_control_fence_fingerprint",
    "current_time",
    "proposed_window",
  ]);
  assert.deepEqual(contract.route_verification.issue_store_result_fields,
    ["outcome", "attempt_epoch", "window", "expired_window"]);
  assert.equal(contract.route_verification.latest_readback_operation,
    "readLatestWindowByOperationScopeFingerprint");
  assert.deepEqual(contract.route_verification.latest_readback_request_fields,
    ["operation_scope_fingerprint"]);
  assert.deepEqual(contract.route_verification.latest_readback_result_fields,
    ["attempt_epoch", "window"]);
  assert.match(contract.route_verification.attempt_epoch_authority,
    /never browser supplied/);
  assert.equal(contract.route_verification.current_time_source, "injected_server_clock");
  assert.equal(contract.route_verification.window_ttl_ms, ROUTE_WINDOW_TTL_MS);
  assert.deepEqual(contract.route_verification.setup_window_statuses, ["Open", "Expired"]);
  assert.match(contract.route_verification.stale_open_policy, /atomically changed to Expired/);
  assert.match(contract.route_verification.expired_operation_replay_policy,
    /allocates the next monotone attempt_epoch/);
  assert.equal(contract.route_verification.browser_supplied_window_allowed, false);
  assert.equal(contract.route_verification.setup_evidence_consumption_allowed, false);
  assert.equal(contract.route_verification.consumption_replay_policy,
    "every consumed-window replay is rejected by the gateway");
  assert.deepEqual(contract.route_verification.window_fields,
    ROUTE_VERIFICATION_WINDOW_FIELDS);
  assert.deepEqual(contract.route_verification.authoritative_call_fields, [
    "actual_call_fingerprint",
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
    "qa_caller_fingerprint",
    "observed_at",
  ]);
  assert.deepEqual(contract.route_verification.receipt_fields, [
    "verification_claim_key",
    "window_key",
    "actual_call_fingerprint",
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
    "consumed_at",
  ]);
  assert.deepEqual(contract.route_verification.verified_qa_runtime_disposition, {
    start_agent: false,
    collect_agent_intake: false,
    create_transcript: false,
    create_post_call_analysis: false,
    increment_handled_call_count: false,
    send_notification: false,
    activate_deployment: false,
    perform_operational_action: false,
  });
  assert.equal(contract.route_verification.gateway_atomic_store_operation,
    "consumeOpenWindowAtCurrentControlFence");
  assert.equal(contract.route_verification.control_fence_mismatch_outcome,
    "stale_control_fence");
  assert.equal(contract.route_verification.stop_does_not_assert_physical_route_rollback,
    true);
  assert.deepEqual(contract.browser_setup_control.allowed_actions, [
    "confirm_forwarding_enabled",
    "confirm_rollback_ready",
    "stop",
    "resume",
  ]);
  assert.equal(contract.browser_setup_control.server_internal_action,
    "issue_forwarding_instructions");
});
