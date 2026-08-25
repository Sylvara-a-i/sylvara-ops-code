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
  applyBrowserSetupControl,
  createForwardingRegistry,
  openRouteVerificationWindow,
  reserveExistingAvailableNumber,
  resolveForwardingInstructions,
  verifyQaRouteEvidence,
} = require("../lib/field-setup-operations");

const NOW_MS = Date.parse("2026-08-25T15:00:00.000Z");
const fp = (character) => character.repeat(64);

function reservationCommand(overrides = {}) {
  return {
    operationFingerprint: fp("1"),
    clientFingerprint: fp("2"),
    environmentFingerprint: fp("3"),
    journeyFingerprint: fp("4"),
    deploymentFingerprint: fp("5"),
    configurationFingerprint: fp("6"),
    ...overrides,
  };
}

function atomicInventory(numberFingerprint = fp("7")) {
  let reservation = null;
  const claims = [];
  return {
    claims,
    async claimExistingAvailableNumberAtomically(claim) {
      claims.push(claim);
      assert.equal(Object.isFrozen(claim), true);
      if (!reservation) {
        reservation = { ...claim, numberFingerprint };
        return {
          outcome: "reserved",
          operationFingerprint: claim.operationFingerprint,
          bindingFingerprint: claim.bindingFingerprint,
          numberFingerprint,
          state: "Reserved",
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
        };
      }
      if (reservation.operationFingerprint === claim.operationFingerprint) {
        return { outcome: "binding_conflict" };
      }
      return { outcome: "none_available" };
    },
  };
}

function routeWindowCommand(overrides = {}) {
  return {
    windowFingerprint: fp("8"),
    clientFingerprint: fp("9"),
    environmentFingerprint: fp("a"),
    journeyFingerprint: fp("b"),
    deploymentFingerprint: fp("c"),
    configurationFingerprint: fp("d"),
    numberFingerprint: fp("e"),
    routeFingerprint: fp("f"),
    approvedQaCallerFingerprint: fp("0"),
    issuedAt: "2026-08-25T14:59:00.000Z",
    expiresAt: "2026-08-25T15:05:00.000Z",
    ...overrides,
  };
}

function atomicVerificationStore() {
  const windows = new Map();
  const receipts = new Map();
  return {
    opened: [],
    consumed: [],
    async openWindowAtomically(window) {
      this.opened.push(window);
      assert.equal(Object.isFrozen(window), true);
      const existing = windows.get(window.windowFingerprint);
      if (!existing) {
        windows.set(window.windowFingerprint, window);
        return { outcome: "opened", window: { ...window } };
      }
      if (existing.bindingFingerprint !== window.bindingFingerprint) {
        return { outcome: "binding_conflict" };
      }
      return { outcome: "idempotent_replay", window: { ...existing } };
    },
    async consumeQaEvidenceAtomically(claim) {
      this.consumed.push(claim);
      assert.equal(Object.isFrozen(claim), true);
      const window = windows.get(claim.windowFingerprint);
      if (!window || window.bindingFingerprint !== claim.bindingFingerprint) {
        return { outcome: "binding_conflict" };
      }
      const existing = receipts.get(claim.windowFingerprint);
      if (existing) {
        if (
          existing.evidenceFingerprint !== claim.evidenceFingerprint ||
          existing.receiptFingerprint !== claim.receiptFingerprint
        ) {
          return { outcome: "replay_conflict" };
        }
        return { outcome: "idempotent_replay", ...existing };
      }
      const receipt = {
        windowFingerprint: claim.windowFingerprint,
        bindingFingerprint: claim.bindingFingerprint,
        evidenceFingerprint: claim.evidenceFingerprint,
        receiptFingerprint: claim.receiptFingerprint,
        verifiedAt: claim.verifiedAt,
        status: "verified",
      };
      receipts.set(claim.windowFingerprint, receipt);
      return { outcome: "verified", ...receipt };
    },
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
  const dependencies = { inventory, nowMs: () => NOW_MS };
  const first = await reserveExistingAvailableNumber(reservationCommand(), dependencies);
  const replay = await reserveExistingAvailableNumber(reservationCommand(), dependencies);

  assert.equal(first.outcome, "reserved");
  assert.equal(first.state, "Reserved");
  assert.equal(first.color, "Blue");
  assert.equal(first.purchaseAttempted, false);
  assert.equal(replay.outcome, "idempotent_replay");
  assert.equal(replay.numberFingerprint, first.numberFingerprint);
  assert.equal(replay.bindingFingerprint, first.bindingFingerprint);
  assert.deepEqual(inventory.claims.map(({ expectedState, nextState }) => ({ expectedState, nextState })), [
    { expectedState: "Available", nextState: "Reserved" },
    { expectedState: "Available", nextState: "Reserved" },
  ]);
  assert.equal(Object.hasOwn(inventory, "purchaseNumber"), false);
});

test("reservation fails closed across clients and never promotes a non-reservation response", async () => {
  const inventory = atomicInventory();
  const dependencies = { inventory, nowMs: () => NOW_MS };
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
      inventory: {
        async claimExistingAvailableNumberAtomically(claim) {
          return {
            outcome: "reserved",
            operationFingerprint: claim.operationFingerprint,
            bindingFingerprint: claim.bindingFingerprint,
            numberFingerprint: fp("7"),
            state: "Live",
          };
        },
      },
    }),
    isOperationError("reservation_response_invalid"),
  );
});

test("concurrent claims cannot share the only available number", async () => {
  const inventory = atomicInventory();
  const dependencies = { inventory, nowMs: () => NOW_MS };
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
  const selected = resolveForwardingInstructions(fp("a"));
  assert.deepEqual(selected, {
    providerFingerprint: fp("a"),
    status: "Technical Setup Required",
    forwardingState: "Not Configured",
    color: "Gray",
    reviewedEvidenceFingerprint: null,
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
      enableSteps: ["Use the reviewed provider procedure."],
      rollbackSteps: ["Restore the reviewed prior route."],
    }]),
    isOperationError("forwarding_registry_invalid"),
  );
  const registry = createForwardingRegistry([{
    providerFingerprint: fp("a"),
    reviewedEvidenceFingerprint: fp("b"),
    reviewedAt: "2026-08-25T12:00:00.000Z",
    enableSteps: ["Use the reviewed provider procedure."],
    rollbackSteps: ["Restore the reviewed prior route."],
  }]);
  const selected = resolveForwardingInstructions(fp("a"), registry);
  assert.equal(selected.status, "Reviewed Instructions Available");
  assert.equal(selected.forwardingState, "Instructions Issued");
  assert.deepEqual(selected.rollbackSteps, ["Restore the reviewed prior route."]);
});

test("route window creation is atomic, idempotent, and bound across every isolation dimension", async () => {
  const verificationStore = atomicVerificationStore();
  const dependencies = { verificationStore, nowMs: () => NOW_MS };
  const opened = await openRouteVerificationWindow(routeWindowCommand(), dependencies);
  const replay = await openRouteVerificationWindow(routeWindowCommand(), dependencies);
  assert.equal(opened.outcome, "opened");
  assert.equal(replay.outcome, "idempotent_replay");
  assert.deepEqual(replay.window, opened.window);

  const mutations = {
    clientFingerprint: fp("1"),
    environmentFingerprint: fp("2"),
    journeyFingerprint: fp("3"),
    deploymentFingerprint: fp("4"),
    configurationFingerprint: fp("5"),
    numberFingerprint: fp("6"),
    routeFingerprint: fp("7"),
    approvedQaCallerFingerprint: fp("8"),
    expiresAt: "2026-08-25T15:04:00.000Z",
  };
  for (const [key, value] of Object.entries(mutations)) {
    await assert.rejects(
      openRouteVerificationWindow(routeWindowCommand({ [key]: value }), dependencies),
      isOperationError("route_window_binding_conflict"),
      key,
    );
  }
});

test("verified QA evidence produces one immutable receipt and no runtime side effects", async () => {
  const verificationStore = atomicVerificationStore();
  const dependencies = { verificationStore, nowMs: () => NOW_MS };
  const { window } = await openRouteVerificationWindow(routeWindowCommand(), dependencies);
  const command = {
    window,
    evidenceFingerprint: fp("1"),
    observedAt: "2026-08-25T15:00:00.000Z",
  };
  const first = await verifyQaRouteEvidence(command, dependencies);
  const replay = await verifyQaRouteEvidence(command, dependencies);

  assert.equal(first.outcome, "verified");
  assert.equal(replay.outcome, "idempotent_replay");
  assert.deepEqual(replay.receipt, first.receipt);
  assert.deepEqual(first.receipt.runtimeDisposition, QA_RUNTIME_DISPOSITION);
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
  for (const key of [
    "clientFingerprint",
    "environmentFingerprint",
    "journeyFingerprint",
    "deploymentFingerprint",
    "configurationFingerprint",
    "numberFingerprint",
    "routeFingerprint",
    "approvedQaCallerFingerprint",
    "expiresAt",
  ]) {
    assert.equal(first.receipt[key], window[key], key);
  }
  assert.equal(Object.isFrozen(first.receipt.runtimeDisposition), true);
});

test("route evidence rejects cross-client mutation, conflicting replay, and expired windows", async () => {
  const verificationStore = atomicVerificationStore();
  const dependencies = { verificationStore, nowMs: () => NOW_MS };
  const { window } = await openRouteVerificationWindow(routeWindowCommand(), dependencies);
  const command = {
    window,
    evidenceFingerprint: fp("1"),
    observedAt: "2026-08-25T15:00:00.000Z",
  };
  await verifyQaRouteEvidence(command, dependencies);
  await assert.rejects(
    verifyQaRouteEvidence({ ...command, evidenceFingerprint: fp("2") }, dependencies),
    isOperationError("route_evidence_replay_conflict"),
  );
  await assert.rejects(
    verifyQaRouteEvidence({
      ...command,
      window: { ...window, clientFingerprint: fp("2") },
    }, dependencies),
    isOperationError("route_window_invalid"),
  );
  await assert.rejects(
    verifyQaRouteEvidence(command, {
      verificationStore,
      nowMs: () => Date.parse("2026-08-25T15:06:00.000Z"),
    }),
    isOperationError("route_evidence_expired"),
  );
});

test("browser setup control permits only stop and resume without activation or live route mutation", () => {
  const common = {
    clientFingerprint: fp("1"),
    environmentFingerprint: fp("2"),
    journeyFingerprint: fp("3"),
    deploymentFingerprint: fp("4"),
  };
  const stopped = applyBrowserSetupControl({ action: "stop", currentStatus: "in_progress", ...common });
  const resumed = applyBrowserSetupControl({ action: "resume", currentStatus: "stopped", ...common });
  assert.equal(stopped.nextStatus, "stopped");
  assert.equal(resumed.nextStatus, "in_progress");
  assert.equal(stopped.activateDeployment, false);
  assert.equal(stopped.mutateLiveRoute, false);
  assert.equal(stopped.requiresSeparateOperatorApproval, true);

  for (const action of ["activate", "mutate_live_route", "reserve_number"] ) {
    assert.throws(
      () => applyBrowserSetupControl({ action, currentStatus: "in_progress", ...common }),
      isOperationError("browser_action_forbidden"),
    );
  }
  assert.throws(
    () => applyBrowserSetupControl({
      action: "stop",
      currentStatus: "in_progress",
      ...common,
      rawPhoneNumber: "forbidden-raw-value",
    }),
    isOperationError("browser_setup_control_invalid"),
  );
});

test("the proposed contract is source-only, table-neutral, and matches executable display/runtime rules", () => {
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
    new_tables: 0,
    existing_handler_changed: false,
  });
  assert.deepEqual(
    contract.number_inventory.states,
    Object.entries(NUMBER_STATES).map(([value, { color }]) => ({ value, color })),
  );
  assert.deepEqual(
    contract.forwarding.states,
    Object.entries(FORWARDING_STATES).map(([value, { color }]) => ({ value, color })),
  );
  assert.deepEqual(contract.forwarding.reviewed_provider_entries, []);
  assert.equal(contract.forwarding.invent_steps_or_codes, false);
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
});
