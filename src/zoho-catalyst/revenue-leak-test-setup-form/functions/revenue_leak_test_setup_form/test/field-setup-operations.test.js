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
  reserveExistingAvailableNumber,
  resolveForwardingInstructions,
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

const typed = (prefix, character) => `${prefix}_${fp(character)}`;

function routeWindowIssueCommand(overrides = {}) {
  return {
    operation_fingerprint: typed("operation", "8"),
    client_fingerprint: typed("client", "9"),
    environment_fingerprint: typed("environment", "a"),
    journey_fingerprint: typed("journey", "b"),
    deployment_fingerprint: typed("deployment", "c"),
    configuration_fingerprint: typed("configuration", "d"),
    number_fingerprint: typed("number", "e"),
    route_fingerprint: typed("route", "f"),
    approved_qa_caller_fingerprint: typed("qa_caller", "0"),
    ...overrides,
  };
}

function atomicVerificationStore() {
  const operations = new Map();
  const activeBindings = new Map();
  const routeBinding = (window) => [
    window.environment_fingerprint,
    window.client_fingerprint,
    window.deployment_fingerprint,
    window.configuration_fingerprint,
    window.number_fingerprint,
    window.route_fingerprint,
  ].join("\0");
  const expire = (operationFingerprint, currentTime) => {
    const existing = operations.get(operationFingerprint);
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
    activeBindings,
    async issueWindowAtomically(request) {
      this.issued.push(request);
      assert.equal(Object.isFrozen(request), true);
      assert.equal(Object.isFrozen(request.proposed_window), true);
      assert.equal(request.current_time, request.proposed_window.issued_at);
      const currentMs = Date.parse(request.current_time);
      const existing = operations.get(request.operation_fingerprint);
      if (existing) {
        if (existing.request_binding_key !== request.request_binding_key) {
          return { outcome: "operation_conflict" };
        }
        if (
          existing.window.status === "Open" &&
          currentMs >= Date.parse(existing.window.expires_at)
        ) {
          return {
            outcome: "operation_expired",
            window: expire(request.operation_fingerprint, request.current_time),
          };
        }
        if (existing.window.status === "Expired") {
          return { outcome: "operation_expired", window: { ...existing.window } };
        }
        return {
          outcome: "idempotent_replay",
          window: { ...existing.window },
          expired_window: null,
        };
      }
      const binding = routeBinding(request.proposed_window);
      const activeOperation = activeBindings.get(binding);
      let expiredWindow = null;
      if (activeOperation !== undefined) {
        const active = operations.get(activeOperation);
        if (
          active.window.status === "Open" &&
          currentMs >= Date.parse(active.window.expires_at)
        ) {
          expiredWindow = expire(activeOperation, request.current_time);
        } else {
          return { outcome: "active_window_conflict" };
        }
      }
      const stored = {
        request_binding_key: request.request_binding_key,
        window: { ...request.proposed_window },
      };
      operations.set(request.operation_fingerprint, stored);
      activeBindings.set(binding, request.operation_fingerprint);
      return {
        outcome: "issued",
        window: { ...request.proposed_window },
        expired_window: expiredWindow,
      };
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

test("setup issues the exact gateway window atomically and cannot consume route evidence", async () => {
  const verificationStore = atomicVerificationStore();
  let generated = 0;
  const dependencies = {
    verificationStore,
    nowMs: () => NOW_MS,
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  };
  const opened = await issueRouteVerificationWindow(routeWindowIssueCommand(), dependencies);
  const replay = await issueRouteVerificationWindow(routeWindowIssueCommand(), dependencies);
  assert.equal(opened.outcome, "issued");
  assert.equal(replay.outcome, "idempotent_replay");
  assert.deepEqual(replay.window, opened.window);
  assert.deepEqual(Object.keys(opened.window), ROUTE_VERIFICATION_WINDOW_FIELDS);
  assert.equal(opened.window.status, "Open");
  assert.equal(opened.window.closed_at, null);
  assert.equal(Date.parse(opened.window.expires_at) - Date.parse(opened.window.issued_at),
    ROUTE_WINDOW_TTL_MS);
  assert.deepEqual(Object.keys(verificationStore.issued[0]), [
    "operation_fingerprint",
    "request_binding_key",
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
  const dependencies = {
    verificationStore,
    nowMs: () => NOW_MS,
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  };
  await issueRouteVerificationWindow(routeWindowIssueCommand(), dependencies);
  const mutations = {
    client_fingerprint: typed("client", "1"),
    environment_fingerprint: typed("environment", "2"),
    journey_fingerprint: typed("journey", "3"),
    deployment_fingerprint: typed("deployment", "4"),
    configuration_fingerprint: typed("configuration", "5"),
    number_fingerprint: typed("number", "6"),
    route_fingerprint: typed("route", "7"),
    approved_qa_caller_fingerprint: typed("qa_caller", "8"),
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
      operation_fingerprint: typed("operation", "a"),
    }), dependencies),
    isOperationError("route_window_active_window_conflict"),
  );
});

test("route-window issuance fails closed on invalid clocks and key generation", async () => {
  const verificationStore = atomicVerificationStore();
  await assert.rejects(
    issueRouteVerificationWindow(routeWindowIssueCommand(), {
      verificationStore,
      nowMs: () => Number.MAX_SAFE_INTEGER,
    }),
    isOperationError("route_verification_clock_invalid"),
  );
  await assert.rejects(
    issueRouteVerificationWindow(routeWindowIssueCommand(), {
      verificationStore,
      nowMs: () => NOW_MS,
      windowKeyFactory() { throw new Error("private generator failure"); },
    }),
    isOperationError("route_verification_key_invalid"),
  );
  await assert.rejects(
    issueRouteVerificationWindow(routeWindowIssueCommand(), {
      verificationStore,
      nowMs: () => NOW_MS,
      windowKeyFactory: () => routeWindowIssueCommand().operation_fingerprint,
    }),
    isOperationError("route_verification_key_invalid"),
  );
  assert.equal(verificationStore.issued.length, 0);
});

test("concurrent exact issuance has one winner and never creates two open windows", async () => {
  const verificationStore = atomicVerificationStore();
  let generated = 0;
  const dependencies = {
    verificationStore,
    nowMs: () => NOW_MS,
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  };
  const [first, second] = await Promise.all([
    issueRouteVerificationWindow(routeWindowIssueCommand(), dependencies),
    issueRouteVerificationWindow(routeWindowIssueCommand(), dependencies),
  ]);
  assert.deepEqual([first.outcome, second.outcome].sort(), ["idempotent_replay", "issued"]);
  assert.equal(first.window.window_key, second.window.window_key);
  assert.equal(verificationStore.issued.length, 2);
});

test("an expired operation is atomically closed and every old-operation replay fails closed", async () => {
  const verificationStore = atomicVerificationStore();
  let currentMs = NOW_MS;
  let generated = 0;
  const dependencies = {
    verificationStore,
    nowMs: () => currentMs,
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  };
  const command = routeWindowIssueCommand();
  await issueRouteVerificationWindow(command, dependencies);

  currentMs += ROUTE_WINDOW_TTL_MS;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      issueRouteVerificationWindow(command, dependencies),
      isOperationError("route_window_operation_expired"),
    );
  }

  const expired = verificationStore.operations.get(command.operation_fingerprint).window;
  assert.equal(expired.status, "Expired");
  assert.equal(expired.closed_at, new Date(currentMs).toISOString());
  assert.equal(verificationStore.activeBindings.size, 0);
});

test("a fresh operation atomically closes a stale Open window before reissue", async () => {
  const verificationStore = atomicVerificationStore();
  let currentMs = NOW_MS;
  let generated = 0;
  const dependencies = {
    verificationStore,
    nowMs: () => currentMs,
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  };
  const staleCommand = routeWindowIssueCommand();
  await issueRouteVerificationWindow(staleCommand, dependencies);

  currentMs += ROUTE_WINDOW_TTL_MS;
  const freshCommand = routeWindowIssueCommand({
    operation_fingerprint: typed("operation", "a"),
  });
  const fresh = await issueRouteVerificationWindow(freshCommand, dependencies);
  const stale = verificationStore.operations.get(staleCommand.operation_fingerprint).window;
  assert.equal(stale.status, "Expired");
  assert.equal(stale.closed_at, new Date(currentMs).toISOString());
  assert.equal(fresh.outcome, "issued");
  assert.equal(fresh.window.status, "Open");
  assert.equal(fresh.window.issued_at, new Date(currentMs).toISOString());
  assert.equal(Date.parse(fresh.window.expires_at) - Date.parse(fresh.window.issued_at),
    ROUTE_WINDOW_TTL_MS);
  assert.equal(verificationStore.activeBindings.size, 1);
});

test("concurrent fresh operations after expiry close once and leave exactly one Open window", async () => {
  const verificationStore = atomicVerificationStore();
  let currentMs = NOW_MS;
  let generated = 0;
  const dependencies = {
    verificationStore,
    nowMs: () => currentMs,
    windowKeyFactory: () => typed("window", (++generated % 16).toString(16)),
  };
  const staleCommand = routeWindowIssueCommand();
  await issueRouteVerificationWindow(staleCommand, dependencies);
  currentMs += ROUTE_WINDOW_TTL_MS;

  const results = await Promise.allSettled([
    issueRouteVerificationWindow(routeWindowIssueCommand({
      operation_fingerprint: typed("operation", "a"),
    }), dependencies),
    issueRouteVerificationWindow(routeWindowIssueCommand({
      operation_fingerprint: typed("operation", "b"),
    }), dependencies),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = results.find(({ status }) => status === "rejected");
  assert.equal(rejected.reason.publicCode, "route_window_active_window_conflict");
  assert.equal(
    verificationStore.operations.get(staleCommand.operation_fingerprint).window.status,
    "Expired",
  );
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
  assert.equal(contract.route_verification.setup_responsibility,
    "atomically_expire_stale_open_window_then_issue_server_generated_open_window_only");
  assert.equal(contract.route_verification.gateway_responsibility,
    "atomically_consume_open_window_and_create_receipt");
  assert.equal(contract.route_verification.issue_command_authority,
    "server_resolved_from_authenticated_operator_and_stored_journey_only");
  assert.deepEqual(contract.route_verification.issue_store_request_fields, [
    "operation_fingerprint",
    "request_binding_key",
    "current_time",
    "proposed_window",
  ]);
  assert.equal(contract.route_verification.current_time_source, "injected_server_clock");
  assert.equal(contract.route_verification.window_ttl_ms, ROUTE_WINDOW_TTL_MS);
  assert.deepEqual(contract.route_verification.setup_window_statuses, ["Open", "Expired"]);
  assert.match(contract.route_verification.stale_open_policy, /atomically changed to Expired/);
  assert.match(contract.route_verification.expired_operation_replay_policy,
    /always fails closed/);
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
});
