"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  createDefaultDeniedFieldSetupOperationsComposition,
  createInjectedFieldSetupOperationsComposition,
} = require("../lib/field-setup-operations-composition");
const {
  FieldSetupOperationsDispatchError,
  SESSION_COOKIE_NAME,
  csrfToken,
} = require("../lib/field-setup-operations-dispatcher");
const {
  setupControlBindingFingerprint,
  setupControlFenceFingerprint,
  setupControlScopeFingerprint,
} = require("../lib/field-setup-operations");

const NOW_MS = Date.parse("2026-08-25T15:00:00.000Z");
const SESSION_TOKEN = "s".repeat(43);
const CSRF_PEPPER = "C".repeat(43);
const PROTOCOL_ID = "free_revenue_leak_test_field_setup_v1";
const PROTOCOL_VERSION = "1";
const fp = (character) => character.repeat(64);

const ROUTES = Object.freeze({
  numberStatusPath: "/field-setup/operations/number/status",
  numberClaimPath: "/field-setup/operations/number/claim",
  forwardingInstructionsPath: "/field-setup/operations/forwarding/instructions",
  routeVerificationWindowPath: "/field-setup/operations/route-verification/window",
  setupControlPath: "/field-setup/operations/control",
});

function dispatcherConfig(overrides = {}) {
  return {
    status: "NOT_READY",
    runtimeAuthority: false,
    deploymentAuthorized: false,
    environment: "development",
    maxBodyBytes: 4096,
    bodyTimeoutMs: 1000,
    csrfHeaderName: "x-sylvara-field-setup-csrf",
    csrfPepper: CSRF_PEPPER,
    routes: ROUTES,
    webClientOrigin: "https://synthetic.development.catalystserverless.com",
    ...overrides,
  };
}

function setupContext(overrides = {}) {
  return {
    approvedQaCallerFingerprint: null,
    clientFingerprint: fp("1"),
    configurationFingerprint: fp("2"),
    deploymentFingerprint: fp("3"),
    environment: "development",
    environmentFingerprint: fp("4"),
    forwardingState: "Not Configured",
    instructionEvidenceFingerprint: null,
    journeyFingerprint: fp("5"),
    latestControlOperationFingerprint: null,
    numberFingerprint: null,
    numberState: null,
    operatorFingerprint: fp("6"),
    providerFingerprint: fp("7"),
    journeyRevision: 9,
    controlRevision: 0,
    rollbackReady: false,
    routeFingerprint: null,
    sessionFingerprint: fp("8"),
    setupStatus: "in_progress",
    ...overrides,
  };
}

function instructionEvidence(context, registryEntry) {
  const parts = [
    ["client", context.clientFingerprint],
    ["environment", context.environmentFingerprint],
    ["journey", context.journeyFingerprint],
    ["deployment", context.deploymentFingerprint],
    ["configuration", context.configurationFingerprint],
    ["number", context.numberFingerprint],
    ["provider", context.providerFingerprint],
    ["route", context.routeFingerprint],
    ["reviewed_evidence", registryEntry.reviewedEvidenceFingerprint],
    ["reviewed_at", registryEntry.reviewedAt],
    ["reviewed_until", registryEntry.reviewedUntil],
    ["enable_steps", registryEntry.enableSteps
      .map((step) => `${step.length}:${step}`)
      .join("|")],
    ["rollback_steps", registryEntry.rollbackSteps
      .map((step) => `${step.length}:${step}`)
      .join("|")],
  ];
  const serialized = parts
    .map(([name, value]) => `${name.length}:${name}:${value.length}:${value}`)
    .join("|");
  return crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
}

function reviewedEntry(overrides = {}) {
  return {
    providerFingerprint: fp("7"),
    reviewedEvidenceFingerprint: fp("b"),
    reviewedAt: "2026-08-25T12:00:00.000Z",
    reviewedUntil: "2026-09-01T12:00:00.000Z",
    enableSteps: ["Use the reviewed synthetic provider procedure."],
    rollbackSteps: ["Restore the reviewed synthetic prior route."],
    ...overrides,
  };
}

function assignedContext(overrides = {}) {
  return setupContext({
    numberFingerprint: fp("9"),
    numberState: "Assigned",
    routeFingerprint: fp("e"),
    ...overrides,
  });
}

function evidencedContext(registryEntry, overrides = {}) {
  const context = assignedContext(overrides);
  context.instructionEvidenceFingerprint = instructionEvidence(context, registryEntry);
  return context;
}

function browserRequest(method, url, body, overrides = {}) {
  const headers = {
    origin: "https://synthetic.development.catalystserverless.com",
    "sec-fetch-site": "same-origin",
    cookie: `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`,
    "x-sylvara-field-setup-protocol-id": PROTOCOL_ID,
    "x-sylvara-field-setup-protocol-version": PROTOCOL_VERSION,
    "x-sylvara-field-setup-csrf": csrfToken(SESSION_TOKEN, CSRF_PEPPER),
    ...(method === "POST" ? { "content-type": "application/json" } : {}),
    ...(overrides.headers ?? {}),
  };
  const request = { method, url, headers };
  if (body !== undefined) request.rawBody = Buffer.from(JSON.stringify(body));
  return request;
}

function inMemoryNumberInventory(numberFingerprint = fp("9")) {
  let reservation = null;
  return {
    claims: [],
    contexts: [],
    numberFingerprint,
    receiptReads: [],
    reads: [],
    reservationMutations: 0,
    purchaseAttempts: 0,
    peekReservation() { return reservation ? { ...reservation } : null; },
    async readNumberReservationStatus(query, adapterContext) {
      this.contexts.push(adapterContext);
      this.reads.push(query);
      if (!reservation) {
        return {
          outcome: "available",
          bindingFingerprint: query.bindingFingerprint,
          numberFingerprint,
          state: "Available",
        };
      }
      if (reservation.bindingFingerprint !== query.bindingFingerprint) {
        return { outcome: "none_available" };
      }
      return {
        outcome: "bound",
        bindingFingerprint: reservation.bindingFingerprint,
        numberFingerprint,
        state: "Reserved",
      };
    },
    async claimExistingAvailableNumberAtomically(claim, adapterContext) {
      this.contexts.push(adapterContext);
      this.claims.push(claim);
      if (!reservation) {
        this.reservationMutations += 1;
        reservation = { ...claim };
        return {
          outcome: "reserved",
          operationFingerprint: claim.operationFingerprint,
          bindingFingerprint: claim.bindingFingerprint,
          numberFingerprint,
          state: "Reserved",
          claimedAt: claim.claimedAt,
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
          claimedAt: reservation.claimedAt,
        };
      }
      if (reservation.operationFingerprint === claim.operationFingerprint) {
        return { outcome: "binding_conflict" };
      }
      return { outcome: "none_available" };
    },
    async readNumberReservationReceiptByOperationFingerprint(
      { operationFingerprint },
      adapterContext,
    ) {
      this.contexts.push(adapterContext);
      this.receiptReads.push(operationFingerprint);
      if (!reservation || reservation.operationFingerprint !== operationFingerprint) {
        return { outcome: "not_found" };
      }
      return {
        operationFingerprint: reservation.operationFingerprint,
        bindingFingerprint: reservation.bindingFingerprint,
        numberFingerprint,
        state: "Reserved",
        controlScopeFingerprint: reservation.controlScopeFingerprint,
        previousControlFenceFingerprint: reservation.previousControlFenceFingerprint,
        controlFenceFingerprint: reservation.controlFenceFingerprint,
        claimedAt: reservation.claimedAt,
      };
    },
    async purchaseNumber() {
      this.purchaseAttempts += 1;
      throw new Error("must never be called");
    },
  };
}

function inMemoryVerificationStore() {
  const operations = new Map();
  const latestByScope = new Map();
  const active = new Map();
  const binding = (window) => [
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
  return {
    active,
    operations,
    latestByScope,
    issues: [],
    reads: [],
    consumeAttempts: 0,
    async issueWindowAtomically(request) {
      this.issues.push(request);
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
          existing.window = {
            ...existing.window,
            status: "Expired",
            closed_at: request.current_time,
          };
          active.delete(binding(existing.window));
          expiredWindow = { ...existing.window };
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
      const selectedBinding = binding(request.proposed_window);
      if (active.has(selectedBinding)) return { outcome: "active_window_conflict" };
      const stored = {
        attempt_epoch: existing ? existing.attempt_epoch + 1 : 1,
        request_binding_key: request.request_binding_key,
        window: { ...request.proposed_window },
      };
      const operationKey = `${request.operation_scope_fingerprint}:${stored.attempt_epoch}`;
      operations.set(operationKey, stored);
      latestByScope.set(request.operation_scope_fingerprint, stored);
      active.set(selectedBinding, operationKey);
      return {
        outcome: "issued",
        attempt_epoch: stored.attempt_epoch,
        window: { ...request.proposed_window },
        expired_window: expiredWindow,
      };
    },
    async readLatestWindowByOperationScopeFingerprint({ operation_scope_fingerprint }) {
      this.reads.push(operation_scope_fingerprint);
      const latest = latestByScope.get(operation_scope_fingerprint);
      return {
        attempt_epoch: latest.attempt_epoch,
        window: { ...latest.window },
      };
    },
    async consumeOpenWindow() {
      this.consumeAttempts += 1;
      throw new Error("must never be called");
    },
  };
}

function inMemorySetupControlStore() {
  const operations = new Map();
  const records = new Map();
  let commitSequence = 0;
  return {
    applies: [],
    records,
    reads: [],
    activationAttempts: 0,
    liveRouteMutationAttempts: 0,
    async applyIntentAtomically(intent) {
      this.applies.push(intent);
      const existingOperation = operations.get(intent.operationFingerprint);
      if (existingOperation) {
        return { outcome: "idempotent_replay", record: { ...existingOperation } };
      }
      const current = records.get(intent.controlScopeFingerprint);
      if (
        current &&
        (
          current.setupStatus !== intent.previousSetupStatus ||
          current.forwardingState !== intent.previousForwardingState ||
          current.rollbackReady !== intent.previousRollbackReady ||
          current.controlRevision !== intent.previousControlRevision
        )
      ) {
        return { outcome: "context_conflict" };
      }
      const record = {
        ...intent,
        committedAt: new Date(NOW_MS + commitSequence).toISOString(),
      };
      commitSequence += 1;
      operations.set(intent.operationFingerprint, record);
      records.set(intent.controlScopeFingerprint, record);
      return { outcome: "applied", record: { ...record } };
    },
    async readByOperationFingerprint({ operationFingerprint }) {
      this.reads.push(operationFingerprint);
      return { ...operations.get(operationFingerprint) };
    },
    peekByOperationFingerprint(operationFingerprint) {
      const record = operations.get(operationFingerprint);
      return record ? { ...record } : null;
    },
    async activateDeployment() {
      this.activationAttempts += 1;
      throw new Error("must never be called");
    },
    async mutateLiveRoute() {
      this.liveRouteMutationAttempts += 1;
      throw new Error("must never be called");
    },
  };
}

function inMemoryStateCoordinator(context, {
    beforeClaim = null,
    beforeControlReceiptRead = null,
    beforeIssue = null,
    syncContextOnNumberClaim = true,
    syncContextOnControlApply = false,
} = {}) {
  const numberInventory = inMemoryNumberInventory();
  const verificationStore = inMemoryVerificationStore();
  const setupControlStore = inMemorySetupControlStore();
  const controlScopeFingerprint = setupControlScopeFingerprint(context);
  let currentControlBindingFingerprint = setupControlBindingFingerprint(
    context,
    context.instructionEvidenceFingerprint,
  );
  let currentControlFenceFingerprint = setupControlFenceFingerprint(context);
  let currentControlUpdatedAt = null;
  let mutationTransactionTail = Promise.resolve();
  const runMutationTransaction = (transaction) => {
    const pending = mutationTransactionTail.then(transaction, transaction);
    mutationTransactionTail = pending.then(() => undefined, () => undefined);
    return pending;
  };
  const coordinator = {
    numberInventory,
    verificationStore,
    setupControlStore,
    get currentControlFenceFingerprint() {
      return currentControlFenceFingerprint;
    },
    get currentControlBindingFingerprint() {
      return currentControlBindingFingerprint;
    },
    get currentControlUpdatedAt() {
      return currentControlUpdatedAt;
    },
    async readNumberReservationStatus(query, adapterContext) {
      return numberInventory.readNumberReservationStatus(query, adapterContext);
    },
    async claimExistingAvailableNumberWithControlFenceAtomically(claim, adapterContext) {
      if (beforeClaim) await beforeClaim();
      const transaction = async () => {
        const existingReservation = numberInventory.peekReservation();
        const exactReplay = existingReservation &&
          existingReservation.operationFingerprint === claim.operationFingerprint &&
          existingReservation.bindingFingerprint === claim.bindingFingerprint;
        if (
          claim.controlScopeFingerprint !== controlScopeFingerprint ||
          (
            exactReplay
              ? ![
                existingReservation.previousControlFenceFingerprint,
                existingReservation.controlFenceFingerprint,
              ].includes(claim.expectedControlFenceFingerprint) ||
                currentControlFenceFingerprint !== existingReservation.controlFenceFingerprint
              : claim.expectedControlFenceFingerprint !== currentControlFenceFingerprint
          )
        ) {
          return { outcome: "control_fence_conflict" };
        }
        let transactionClaim = claim;
        if (!exactReplay) {
          const postClaimContext = {
            ...context,
            numberFingerprint: numberInventory.numberFingerprint,
            numberState: "Reserved",
          };
          const postClaimBinding = setupControlBindingFingerprint(
            postClaimContext,
            postClaimContext.instructionEvidenceFingerprint,
          );
          const postClaimFence = setupControlFenceFingerprint(postClaimContext);
          transactionClaim = {
            ...claim,
            controlBindingFingerprint: postClaimBinding,
            previousControlFenceFingerprint: claim.expectedControlFenceFingerprint,
            controlFenceFingerprint: postClaimFence,
            controlUpdatedAt: claim.claimedAt,
          };
        }
        const claimed = await numberInventory
          .claimExistingAvailableNumberAtomically(transactionClaim, adapterContext);
        if (!["reserved", "idempotent_replay"].includes(claimed.outcome)) return claimed;
        const reservation = numberInventory.peekReservation();
        currentControlBindingFingerprint = reservation.controlBindingFingerprint;
        currentControlFenceFingerprint = reservation.controlFenceFingerprint;
        currentControlUpdatedAt = reservation.controlUpdatedAt;
        if (syncContextOnNumberClaim) {
          Object.assign(context, {
            numberFingerprint: claimed.numberFingerprint,
            numberState: "Reserved",
          });
        }
        return {
          ...claimed,
          controlScopeFingerprint: claim.controlScopeFingerprint,
          previousControlFenceFingerprint: reservation.previousControlFenceFingerprint,
          controlFenceFingerprint: reservation.controlFenceFingerprint,
          claimedAt: claimed.claimedAt,
        };
      };
      return runMutationTransaction(transaction);
    },
    async readNumberReservationReceiptByOperationFingerprint(query, adapterContext) {
      return numberInventory.readNumberReservationReceiptByOperationFingerprint(
        query,
        adapterContext,
      );
    },
    async issueWindowWithControlFenceAtomically(request, adapterContext) {
      if (beforeIssue) await beforeIssue();
      return runMutationTransaction(async () => {
        if (
          request.control_scope_fingerprint !== controlScopeFingerprint ||
          request.expected_control_fence_fingerprint !== currentControlFenceFingerprint ||
          request.proposed_window.control_fence_fingerprint !==
            `control_fence_${currentControlFenceFingerprint}`
        ) {
          return { outcome: "control_fence_conflict" };
        }
        return verificationStore.issueWindowAtomically(request, adapterContext);
      });
    },
    async readLatestWindowByOperationScopeFingerprint(query, adapterContext) {
      return verificationStore.readLatestWindowByOperationScopeFingerprint(
        query,
        adapterContext,
      );
    },
    async applyControlIntentAtomically(intent, adapterContext) {
      return runMutationTransaction(async () => {
        const existingOperation = setupControlStore
          .peekByOperationFingerprint(intent.operationFingerprint);
        const exactReplay = existingOperation &&
          existingOperation.bindingFingerprint === intent.bindingFingerprint &&
          existingOperation.controlScopeFingerprint === intent.controlScopeFingerprint &&
          existingOperation.controlFenceFingerprint === currentControlFenceFingerprint &&
          existingOperation.bindingFingerprint === currentControlBindingFingerprint;
        const expectedCurrentBindingFingerprint = setupControlBindingFingerprint(
          context,
          intent.previousInstructionEvidenceFingerprint,
        );
        if (
          intent.controlScopeFingerprint !== controlScopeFingerprint ||
          (!exactReplay && (
            intent.previousControlFenceFingerprint !== currentControlFenceFingerprint ||
            expectedCurrentBindingFingerprint !== currentControlBindingFingerprint
          ))
        ) {
          return { outcome: "context_conflict" };
        }
        const applied = await setupControlStore.applyIntentAtomically(intent, adapterContext);
        if (applied.outcome === "applied") {
          currentControlBindingFingerprint = intent.bindingFingerprint;
          currentControlFenceFingerprint = intent.controlFenceFingerprint;
          currentControlUpdatedAt = applied.record.committedAt;
        } else if (
          applied.outcome === "idempotent_replay" &&
          applied.record.controlFenceFingerprint !== currentControlFenceFingerprint
        ) {
          return { outcome: "context_conflict" };
        }
        if (["applied", "idempotent_replay"].includes(applied.outcome)) {
          context.latestControlOperationFingerprint = applied.record.operationFingerprint;
          if (syncContextOnControlApply) {
            Object.assign(context, {
              controlRevision: applied.record.controlRevision,
              forwardingState: applied.record.forwardingState,
              instructionEvidenceFingerprint: applied.record.instructionEvidenceFingerprint,
              rollbackReady: applied.record.rollbackReady,
              setupStatus: applied.record.setupStatus,
            });
          }
        }
        return applied;
      });
    },
    async readControlOperationByOperationFingerprint(query, adapterContext) {
      if (beforeControlReceiptRead) await beforeControlReceiptRead(query);
      return setupControlStore.readByOperationFingerprint(query, adapterContext);
    },
  };
  return coordinator;
}

function injectedFixture({
  beforeAuthenticatedSetupReturn = null,
  context = setupContext(),
  coordinatorHooks,
  now = () => NOW_MS,
  registry = [],
} = {}) {
  const stateCoordinator = inMemoryStateCoordinator(context, coordinatorHooks);
  const { numberInventory, setupControlStore, verificationStore } = stateCoordinator;
  const authentications = [];
  const composition = createInjectedFieldSetupOperationsComposition({
    authenticatedSetupResolver: async (requestContext) => {
      authentications.push(requestContext);
      const setupSnapshot = { ...context };
      if (beforeAuthenticatedSetupReturn) await beforeAuthenticatedSetupReturn();
      return setupSnapshot;
    },
    config: dispatcherConfig(),
    forwardingRegistry: registry,
    stateCoordinator,
    windowKeyFactory: () => `window_${fp("a")}`,
    now,
  });
  return {
    authentications,
    composition,
    context,
    numberInventory,
    stateCoordinator,
    setupControlStore,
    verificationStore,
  };
}

function isDispatchError(code) {
  return (error) => (
    error instanceof FieldSetupOperationsDispatchError && error.publicCode === code
  );
}

function oneShotBarrier() {
  let enteredResolve;
  let releaseResolve;
  let used = false;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const released = new Promise((resolve) => { releaseResolve = resolve; });
  return {
    entered,
    release() { releaseResolve(); },
    async wait() {
      if (used) return;
      used = true;
      enteredResolve();
      await released;
    },
  };
}

function rendezvousBarrier(participantCount) {
  let arrived = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  return {
    async wait() {
      arrived += 1;
      if (arrived === participantCount) release();
      await ready;
    },
  };
}

test("default composition claims no routes and exposes no runtime authority", async () => {
  const denied = createDefaultDeniedFieldSetupOperationsComposition();
  assert.equal(denied.status, "NOT_READY");
  assert.equal(denied.deploymentAuthorized, false);
  assert.equal(denied.runtimeAuthority, false);
  for (const route of Object.values(ROUTES)) {
    assert.equal(denied.claimsRequest({ url: route }), false);
  }
  await assert.rejects(
    denied.dispatch(),
    isDispatchError("route_not_found"),
  );
});

test("every operation rejects protocol mismatch before identity or store work", async () => {
  const fixture = injectedFixture();
  const requests = [
    browserRequest("GET", ROUTES.numberStatusPath),
    browserRequest("POST", ROUTES.numberClaimPath, { journeyRevision: 9 }),
    browserRequest("POST", ROUTES.forwardingInstructionsPath, {
      journeyRevision: 9,
      view: "enable",
    }),
    browserRequest("POST", ROUTES.routeVerificationWindowPath, { journeyRevision: 9 }),
    browserRequest("POST", ROUTES.setupControlPath, {
      action: "stop",
      journeyRevision: 9,
    }),
  ];
  for (const request of requests) {
    request.headers["x-sylvara-field-setup-protocol-version"] = "2";
    await assert.rejects(
      fixture.composition.dispatch(request),
      isDispatchError("context_conflict"),
    );
  }
  assert.equal(fixture.authentications.length, 0);
  assert.equal(fixture.numberInventory.claims.length, 0);
  assert.equal(fixture.numberInventory.reads.length, 0);
  assert.equal(fixture.setupControlStore.applies.length, 0);
  assert.equal(fixture.verificationStore.issues.length, 0);
});

test("bodyless same-origin number GET tolerates a missing Origin, but POST never does", async () => {
  const fixture = injectedFixture();
  const acceptedGet = browserRequest("GET", ROUTES.numberStatusPath);
  delete acceptedGet.headers.origin;
  const response = await fixture.composition.dispatch(acceptedGet);
  assert.equal(response.body.state, "Available");
  assert.equal(response.body.protocolId, PROTOCOL_ID);

  const badMetadataGet = browserRequest("GET", ROUTES.numberStatusPath);
  delete badMetadataGet.headers.origin;
  badMetadataGet.headers["sec-fetch-site"] = "cross-site";
  await assert.rejects(
    fixture.composition.dispatch(badMetadataGet),
    isDispatchError("authentication_failed"),
  );

  const missingOriginPost = browserRequest(
    "POST",
    ROUTES.numberClaimPath,
    { journeyRevision: 9 },
  );
  delete missingOriginPost.headers.origin;
  await assert.rejects(
    fixture.composition.dispatch(missingOriginPost),
    isDispatchError("authentication_failed"),
  );
  assert.equal(fixture.numberInventory.claims.length, 0);
});

test("number routes authenticate before body parsing, bind server context, and read back claims", async () => {
  const fixture = injectedFixture();
  const app = Object.freeze({ syntheticCatalystApp: true });
  const runtimeContext = Object.freeze({ app });
  assert.equal(fixture.composition.claimsRequest({ url: ROUTES.numberClaimPath }), true);

  await assert.rejects(
    fixture.composition.dispatch(browserRequest(
      "POST",
      ROUTES.numberClaimPath,
      { journeyRevision: 9 },
      { headers: { "x-sylvara-field-setup-csrf": "x".repeat(43) } },
    )),
    isDispatchError("authentication_failed"),
  );
  assert.equal(fixture.numberInventory.claims.length, 0);

  await assert.rejects(
    fixture.composition.dispatch(browserRequest("POST", ROUTES.numberClaimPath, {
      journeyRevision: 9,
      clientFingerprint: fp("f"),
    })),
    isDispatchError("request_invalid"),
  );
  assert.equal(fixture.numberInventory.claims.length, 0);
  assert.equal(fixture.authentications.at(-1).request.rawBody, undefined);
  assert.equal(fixture.authentications.at(-1).request.body, undefined);

  const available = await fixture.composition.dispatch(
    browserRequest("GET", ROUTES.numberStatusPath),
    runtimeContext,
  );
  assert.deepEqual(available.body, {
    ok: true,
    state: "Available",
    color: "Gray",
    protocolId: PROTOCOL_ID,
    schemaVersion: Number(PROTOCOL_VERSION),
  });

  const request = browserRequest("POST", ROUTES.numberClaimPath, { journeyRevision: 9 });
  const [first, second] = await Promise.all([
    fixture.composition.dispatch(request, runtimeContext),
    fixture.composition.dispatch(request, runtimeContext),
  ]);
  assert.deepEqual([first.body.replayed, second.body.replayed].sort(), [false, true]);
  assert.equal(first.body.state, "Reserved");
  assert.equal(first.body.numberFingerprint, undefined);
  assert.equal(fixture.numberInventory.claims.length, 2);
  assert.equal(fixture.numberInventory.reads.length >= 3, true);
  assert.equal(
    fixture.numberInventory.contexts.every((context) => context.app === app),
    true,
  );
  assert.equal(fixture.numberInventory.purchaseAttempts, 0);
});

test("a committed number claim replays from post-claim context after its response is lost", async () => {
  let currentMs = NOW_MS;
  const context = setupContext();
  const fixture = injectedFixture({
    context,
    coordinatorHooks: { syncContextOnNumberClaim: true },
    now: () => currentMs,
  });
  const request = browserRequest(
    "POST",
    ROUTES.numberClaimPath,
    { journeyRevision: 9 },
  );

  const committed = await fixture.composition.dispatch(request);
  const committedReceipt = fixture.numberInventory.peekReservation();
  currentMs += 1000;
  const replayed = await fixture.composition.dispatch(request);

  assert.equal(committed.body.replayed, false);
  assert.equal(replayed.body.replayed, true);
  assert.equal(context.numberFingerprint, fixture.numberInventory.numberFingerprint);
  assert.equal(context.numberState, "Reserved");
  assert.equal(
    fixture.stateCoordinator.currentControlBindingFingerprint,
    setupControlBindingFingerprint(context, context.instructionEvidenceFingerprint),
  );
  assert.equal(
    fixture.stateCoordinator.currentControlUpdatedAt,
    committedReceipt.claimedAt,
  );
  assert.equal(fixture.numberInventory.reservationMutations, 1);
  assert.equal(fixture.numberInventory.claims.length, 2);
  assert.equal(
    fixture.numberInventory.claims[0].operationFingerprint,
    fixture.numberInventory.claims[1].operationFingerprint,
  );
  assert.notEqual(
    fixture.numberInventory.claims[0].expectedControlFenceFingerprint,
    fixture.numberInventory.claims[1].expectedControlFenceFingerprint,
  );
  assert.equal(
    committedReceipt.claimedAt,
    new Date(NOW_MS).toISOString(),
  );
  assert.equal(fixture.numberInventory.peekReservation().claimedAt, committedReceipt.claimedAt);
  assert.equal(fixture.numberInventory.receiptReads.length, 2);
});

test("number claim fails closed when the independent receipt omits or rebinds fence evidence", async () => {
  for (const mutation of ["omit", "wrong_fence"]) {
    const fixture = injectedFixture();
    const originalRead = fixture.stateCoordinator
      .readNumberReservationReceiptByOperationFingerprint.bind(fixture.stateCoordinator);
    fixture.stateCoordinator.readNumberReservationReceiptByOperationFingerprint = async (...args) => {
      const receipt = await originalRead(...args);
      if (mutation === "omit") {
        const { claimedAt: _omitted, ...withoutClaimedAt } = receipt;
        return withoutClaimedAt;
      }
      return { ...receipt, controlFenceFingerprint: fp("f") };
    };
    await assert.rejects(
      fixture.composition.dispatch(browserRequest(
        "POST",
        ROUTES.numberClaimPath,
        { journeyRevision: 9 },
      )),
      isDispatchError("service_unavailable"),
      mutation,
    );
    assert.equal(fixture.numberInventory.claims.length, 1, mutation);
    assert.equal(fixture.numberInventory.receiptReads.length, 1, mutation);
  }
});

test("forwarding routes persist bounded reviewed evidence and expose no provider identifiers", async () => {
  const reviewedProvider = fp("7");
  const registryEntry = reviewedEntry();
  const context = assignedContext();
  const fixture = injectedFixture({
    context,
    registry: [registryEntry],
  });
  const reviewed = await fixture.composition.dispatch(
    browserRequest("POST", ROUTES.forwardingInstructionsPath, {
      journeyRevision: 9,
      view: "enable",
    }),
  );
  assert.equal(reviewed.body.status, "Reviewed Instructions Available");
  assert.equal(reviewed.body.view, "enable");
  assert.deepEqual(reviewed.body.steps, [
    "Use the reviewed synthetic provider procedure.",
  ]);
  assert.equal(reviewed.body.providerFingerprint, undefined);
  assert.equal(reviewed.body.reviewedEvidenceFingerprint, undefined);
  assert.equal(reviewed.body.protocolId, PROTOCOL_ID);
  assert.equal(reviewed.body.schemaVersion, Number(PROTOCOL_VERSION));
  assert.equal(fixture.setupControlStore.applies.length, 1);
  assert.equal(fixture.setupControlStore.applies[0].forwardingState, "Instructions Issued");
  const boundEvidence = fixture.setupControlStore.applies[0].instructionEvidenceFingerprint;
  assert.equal(boundEvidence, instructionEvidence(context, registryEntry));
  Object.assign(context, {
    controlRevision: 1,
    forwardingState: "Instructions Issued",
    instructionEvidenceFingerprint: boundEvidence,
  });
  const enabled = await fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.setupControlPath,
    { action: "confirm_forwarding_enabled", journeyRevision: 9 },
  ));
  assert.equal(enabled.body.forwardingState, "Customer Reported Enabled");
  Object.assign(context, {
    controlRevision: 2,
    forwardingState: "Customer Reported Enabled",
  });
  const rollback = await fixture.composition.dispatch(
    browserRequest("POST", ROUTES.forwardingInstructionsPath, {
      journeyRevision: 9,
      view: "rollback",
    }),
  );
  assert.deepEqual(rollback.body.steps, [
    "Restore the reviewed synthetic prior route.",
  ]);
  assert.equal(fixture.setupControlStore.applies.length, 2);

  const unknown = injectedFixture({
    context: assignedContext({ providerFingerprint: fp("c") }),
    registry: [reviewedEntry({ providerFingerprint: reviewedProvider })],
  });
  const blocked = await unknown.composition.dispatch(
    browserRequest("POST", ROUTES.forwardingInstructionsPath, {
      journeyRevision: 9,
      view: "enable",
    }),
  );
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.status, "Technical Setup Required");
  assert.deepEqual(blocked.body.steps, []);
});

test("provider, configuration, number, route, or exact instruction rotation invalidates old evidence", async () => {
  const originalEntry = reviewedEntry();
  const variants = [
    {
      name: "provider",
      mutate(context) { context.providerFingerprint = fp("a"); },
      entry: reviewedEntry({ providerFingerprint: fp("a") }),
    },
    {
      name: "configuration",
      mutate(context) { context.configurationFingerprint = fp("a"); },
      entry: originalEntry,
    },
    {
      name: "number",
      mutate(context) { context.numberFingerprint = fp("a"); },
      entry: originalEntry,
    },
    {
      name: "route",
      mutate(context) { context.routeFingerprint = fp("a"); },
      entry: originalEntry,
    },
    {
      name: "enable steps",
      mutate() {},
      entry: reviewedEntry({
        enableSteps: ["Use a newly reviewed synthetic provider procedure."],
      }),
    },
    {
      name: "rollback steps",
      mutate() {},
      entry: reviewedEntry({
        rollbackSteps: ["Restore a newly reviewed synthetic prior route."],
      }),
    },
  ];

  for (const variant of variants) {
    const acknowledgementContext = assignedContext({
      controlRevision: 1,
      forwardingState: "Instructions Issued",
    });
    acknowledgementContext.instructionEvidenceFingerprint = instructionEvidence(
      acknowledgementContext,
      originalEntry,
    );
    variant.mutate(acknowledgementContext);
    const acknowledgement = injectedFixture({
      context: acknowledgementContext,
      registry: [variant.entry],
    });
    await assert.rejects(
      acknowledgement.composition.dispatch(browserRequest(
        "POST",
        ROUTES.setupControlPath,
        { action: "confirm_forwarding_enabled", journeyRevision: 9 },
      )),
      isDispatchError("context_conflict"),
      variant.name,
    );
    assert.equal(acknowledgement.setupControlStore.applies.length, 0, variant.name);

    const verificationContext = assignedContext({
      approvedQaCallerFingerprint: fp("f"),
      controlRevision: 3,
      forwardingState: "Customer Reported Enabled",
      rollbackReady: true,
    });
    verificationContext.instructionEvidenceFingerprint = instructionEvidence(
      verificationContext,
      originalEntry,
    );
    variant.mutate(verificationContext);
    const verification = injectedFixture({
      context: verificationContext,
      registry: [variant.entry],
    });
    await assert.rejects(
      verification.composition.dispatch(browserRequest(
        "POST",
        ROUTES.routeVerificationWindowPath,
        { journeyRevision: 9 },
      )),
      isDispatchError("context_conflict"),
      variant.name,
    );
    assert.equal(verification.verificationStore.issues.length, 0, variant.name);
  }
});

test("acknowledged forwarding instructions reload read-only and the lost journey transition can retry", async () => {
  const entry = reviewedEntry();
  const context = evidencedContext(entry, {
    controlRevision: 1,
    forwardingState: "Instructions Issued",
  });
  const fixture = injectedFixture({ context, registry: [entry] });
  const acknowledgementRequest = browserRequest(
    "POST",
    ROUTES.setupControlPath,
    {
      action: "confirm_forwarding_enabled",
      journeyRevision: context.journeyRevision,
    },
  );
  const acknowledged = await fixture.composition.dispatch(acknowledgementRequest);
  assert.equal(acknowledged.body.forwardingState, "Customer Reported Enabled");
  Object.assign(context, {
    controlRevision: 2,
    forwardingState: "Customer Reported Enabled",
  });

  const reloaded = await fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.forwardingInstructionsPath,
    { journeyRevision: context.journeyRevision, view: "enable" },
  ));
  assert.deepEqual(reloaded.body.steps, entry.enableSteps);
  assert.equal(reloaded.outcome, "forwarding_instructions_reloaded");
  assert.equal(fixture.setupControlStore.applies.length, 1);

  const retried = await fixture.composition.dispatch(acknowledgementRequest);
  assert.equal(retried.body.replayed, true);
  assert.equal(retried.body.forwardingState, "Customer Reported Enabled");
  assert.equal(fixture.setupControlStore.applies.length, 1);
});

test("verification route issues exactly 300000ms, reads back, and cannot consume or activate", async () => {
  const registryEntry = reviewedEntry();
  const context = evidencedContext(registryEntry, {
    approvedQaCallerFingerprint: fp("d"),
    forwardingState: "Customer Reported Enabled",
    rollbackReady: true,
  });
  const fixture = injectedFixture({ context, registry: [registryEntry] });
  const request = browserRequest(
    "POST",
    ROUTES.routeVerificationWindowPath,
    { journeyRevision: 9 },
  );
  const [first, second] = await Promise.all([
    fixture.composition.dispatch(request),
    fixture.composition.dispatch(request),
  ]);
  assert.deepEqual([first.body.replayed, second.body.replayed].sort(), [false, true]);
  assert.equal(first.body.ttlMs, 300000);
  assert.equal(Date.parse(first.body.expiresAt) - Date.parse(first.body.issuedAt), 300000);
  assert.equal(first.body.startsAgent, false);
  assert.equal(first.body.activatesDeployment, false);
  assert.equal(first.body.windowKey, undefined);
  assert.equal(fixture.verificationStore.issues.length, 2);
  assert.equal(fixture.verificationStore.reads.length, 2);
  assert.equal(fixture.verificationStore.consumeAttempts, 0);

  const incomplete = injectedFixture();
  await assert.rejects(
    incomplete.composition.dispatch(request),
    isDispatchError("context_conflict"),
  );
  assert.equal(incomplete.verificationStore.issues.length, 0);
});

test("the real dispatcher closes an expired attempt and issues a fresh server-owned epoch", async () => {
  const entry = reviewedEntry();
  let currentMs = NOW_MS;
  const context = evidencedContext(entry, {
    approvedQaCallerFingerprint: fp("f"),
    controlRevision: 3,
    forwardingState: "Customer Reported Enabled",
    rollbackReady: true,
  });
  const fixture = injectedFixture({
    context,
    now: () => currentMs,
    registry: [entry],
  });
  const request = browserRequest(
    "POST",
    ROUTES.routeVerificationWindowPath,
    { journeyRevision: 9 },
  );
  const first = await fixture.composition.dispatch(request);
  const replay = await fixture.composition.dispatch(request);
  currentMs += 300000;
  const renewed = await fixture.composition.dispatch(request);

  assert.equal(first.body.replayed, false);
  assert.equal(replay.body.replayed, true);
  assert.equal(renewed.body.replayed, false);
  assert.equal(renewed.body.issuedAt, new Date(currentMs).toISOString());
  const attempts = [...fixture.verificationStore.operations.values()];
  assert.deepEqual(attempts.map(({ attempt_epoch }) => attempt_epoch), [1, 2]);
  assert.deepEqual(attempts.map(({ window }) => window.status), ["Expired", "Open"]);
  assert.equal(fixture.verificationStore.active.size, 1);
});

test("route verification keeps one attempt scope across CRM relaunch and session rotation", async () => {
  const entry = reviewedEntry();
  let currentMs = NOW_MS;
  const context = evidencedContext(entry, {
    approvedQaCallerFingerprint: fp("f"),
    controlRevision: 3,
    forwardingState: "Customer Reported Enabled",
    rollbackReady: true,
  });
  const fixture = injectedFixture({
    context,
    now: () => currentMs,
    registry: [entry],
  });
  const first = await fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.routeVerificationWindowPath,
    { journeyRevision: 9 },
  ));

  const resumedSessionToken = "r".repeat(43);
  Object.assign(context, {
    journeyRevision: 10,
    sessionFingerprint: fp("a"),
  });
  const resumedRequest = browserRequest(
    "POST",
    ROUTES.routeVerificationWindowPath,
    { journeyRevision: 10 },
    {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${resumedSessionToken}`,
        "x-sylvara-field-setup-csrf": csrfToken(resumedSessionToken, CSRF_PEPPER),
      },
    },
  );
  const resumedReplay = await fixture.composition.dispatch(resumedRequest);
  currentMs += 300000;
  const renewed = await fixture.composition.dispatch(resumedRequest);

  assert.equal(first.body.replayed, false);
  assert.equal(resumedReplay.body.replayed, true);
  assert.equal(renewed.body.replayed, false);
  assert.equal(
    fixture.verificationStore.issues[0].operation_scope_fingerprint,
    fixture.verificationStore.issues[2].operation_scope_fingerprint,
  );
  const attempts = [...fixture.verificationStore.operations.values()];
  assert.deepEqual(attempts.map(({ attempt_epoch }) => attempt_epoch), [1, 2]);
  assert.deepEqual(attempts.map(({ window }) => window.status), ["Expired", "Open"]);
});

test("Stop and resume advance the route-window scope without reviving the prior fence", async () => {
  const entry = reviewedEntry();
  const context = evidencedContext(entry, {
    approvedQaCallerFingerprint: fp("f"),
    controlRevision: 3,
    forwardingState: "Customer Reported Enabled",
    rollbackReady: true,
  });
  const fixture = injectedFixture({ context, registry: [entry] });
  const first = await fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.routeVerificationWindowPath,
    { journeyRevision: 9 },
  ));
  const firstFence = fixture.verificationStore.issues[0]
    .expected_control_fence_fingerprint;

  await fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.setupControlPath,
    { action: "stop", journeyRevision: 9 },
  ));
  Object.assign(context, { controlRevision: 4, setupStatus: "stopped" });
  await fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.setupControlPath,
    { action: "resume", journeyRevision: 9 },
  ));
  Object.assign(context, { controlRevision: 5, setupStatus: "in_progress" });

  const renewed = await fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.routeVerificationWindowPath,
    { journeyRevision: 9 },
  ));
  const [firstIssue, renewedIssue] = fixture.verificationStore.issues;

  assert.equal(first.body.replayed, false);
  assert.equal(renewed.body.replayed, false);
  assert.notEqual(
    firstIssue.operation_scope_fingerprint,
    renewedIssue.operation_scope_fingerprint,
  );
  assert.notEqual(firstFence, renewedIssue.expected_control_fence_fingerprint);
  assert.equal(fixture.verificationStore.latestByScope.size, 2);
  assert.deepEqual(
    [...fixture.verificationStore.operations.values()].map(({ attempt_epoch }) => attempt_epoch),
    [1, 1],
  );
});

test("setup stop intents use compare-and-set readback without activation or live-route mutation", async () => {
  const fixture = injectedFixture();
  const request = browserRequest("POST", ROUTES.setupControlPath, {
    action: "stop",
    journeyRevision: 9,
  });
  const [first, second] = await Promise.all([
    fixture.composition.dispatch(request),
    fixture.composition.dispatch(request),
  ]);
  assert.deepEqual([first.body.replayed, second.body.replayed].sort(), [false, true]);
  assert.equal(first.body.setupStatus, "stopped");
  assert.equal(first.body.controlRevision, 1);
  assert.equal(first.body.journeyRevision, 9);
  assert.equal(first.body.activatesDeployment, false);
  assert.equal(first.body.mutatesLiveRoute, false);
  assert.equal(first.body.requiresSeparateOperatorApproval, true);
  assert.equal(fixture.setupControlStore.applies.length, 2);
  assert.equal(fixture.setupControlStore.reads.length, 2);
  assert.equal(fixture.setupControlStore.activationAttempts, 0);
  assert.equal(fixture.setupControlStore.liveRouteMutationAttempts, 0);
  for (const intent of fixture.setupControlStore.applies) {
    assert.equal(intent.activateDeployment, false);
    assert.equal(intent.mutateLiveRoute, false);
  }

  const resumeFixture = injectedFixture({
    context: setupContext({
      journeyRevision: 10,
      controlRevision: 1,
      setupStatus: "stopped",
    }),
  });
  const resumed = await resumeFixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.setupControlPath,
    { action: "resume", journeyRevision: 10 },
  ));
  assert.equal(resumed.outcome, "setup_resumed");
  assert.equal(resumed.body.setupStatus, "in_progress");
  assert.equal(resumed.body.controlRevision, 2);
  assert.equal(resumed.body.journeyRevision, 10);
  assert.equal(resumed.body.activatesDeployment, false);
  assert.equal(resumed.body.mutatesLiveRoute, false);

  await assert.rejects(
    fixture.composition.dispatch(browserRequest("POST", ROUTES.setupControlPath, {
      action: "activate",
      journeyRevision: 9,
    })),
    isDispatchError("request_invalid"),
  );
});

test("control receipt readback remains exact when a successor commits first", async () => {
  const receiptBarrier = oneShotBarrier();
  const context = setupContext();
  const fixture = injectedFixture({
    context,
    coordinatorHooks: {
      beforeControlReceiptRead: () => receiptBarrier.wait(),
      syncContextOnControlApply: true,
    },
  });
  const stoppedPromise = fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.setupControlPath,
    { action: "stop", journeyRevision: 9 },
  ));
  await receiptBarrier.entered;
  const stopOperationFingerprint = context.latestControlOperationFingerprint;

  const resumed = await fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.setupControlPath,
    { action: "resume", journeyRevision: 9 },
  ));
  const resumeOperationFingerprint = context.latestControlOperationFingerprint;
  receiptBarrier.release();
  const stopped = await stoppedPromise;

  assert.equal(stopped.body.setupStatus, "stopped");
  assert.equal(stopped.body.controlRevision, 1);
  assert.equal(resumed.body.setupStatus, "in_progress");
  assert.equal(resumed.body.controlRevision, 2);
  assert.notEqual(stopOperationFingerprint, resumeOperationFingerprint);
  assert.deepEqual(
    new Set(fixture.setupControlStore.reads),
    new Set([stopOperationFingerprint, resumeOperationFingerprint]),
  );
  assert.equal(fixture.setupControlStore.applies.length, 2);
});

test("stop, resume, then stop uses three revision-bound control operations", async () => {
  const current = setupContext();
  const fixture = injectedFixture({ context: current });
  const apply = async (action) => fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.setupControlPath,
    { action, journeyRevision: current.journeyRevision },
  ));

  const firstStop = await apply("stop");
  Object.assign(current, { controlRevision: 1, setupStatus: "stopped" });
  const resumed = await apply("resume");
  Object.assign(current, { controlRevision: 2, setupStatus: "in_progress" });
  const secondStop = await apply("stop");

  assert.equal(firstStop.body.controlRevision, 1);
  assert.equal(resumed.body.controlRevision, 2);
  assert.equal(secondStop.body.controlRevision, 3);
  assert.equal(secondStop.body.setupStatus, "stopped");
  assert.equal(fixture.setupControlStore.applies.length, 3);
  assert.equal(new Set(
    fixture.setupControlStore.applies.map(({ operationFingerprint }) => operationFingerprint),
  ).size, 3);
});

test("every state-changing setup intent converges after a committed response is lost", async () => {
  const reviewedRegistry = [{
    providerFingerprint: fp("7"),
    reviewedEvidenceFingerprint: fp("b"),
    reviewedAt: "2026-08-25T12:00:00.000Z",
    reviewedUntil: "2026-09-01T12:00:00.000Z",
    enableSteps: ["Use the reviewed synthetic provider procedure."],
    rollbackSteps: ["Restore the reviewed synthetic prior route."],
  }];
  const evidenceEntry = reviewedRegistry[0];
  const cases = [
    {
      action: "confirm_forwarding_enabled",
      context: evidencedContext(evidenceEntry, {
        controlRevision: 1,
        forwardingState: "Instructions Issued",
      }),
      expected: {
        controlRevision: 2,
        setupStatus: "in_progress",
        forwardingState: "Customer Reported Enabled",
        rollbackReady: false,
      },
    },
    {
      action: "confirm_rollback_ready",
      context: evidencedContext(evidenceEntry, {
        controlRevision: 2,
        forwardingState: "Customer Reported Enabled",
      }),
      expected: {
        controlRevision: 3,
        setupStatus: "in_progress",
        forwardingState: "Customer Reported Enabled",
        rollbackReady: true,
      },
    },
    {
      action: "stop",
      context: setupContext(),
      expected: {
        controlRevision: 1,
        setupStatus: "stopped",
        forwardingState: "Not Configured",
        rollbackReady: false,
      },
    },
    {
      action: "resume",
      context: setupContext({ controlRevision: 1, setupStatus: "stopped" }),
      expected: {
        controlRevision: 2,
        setupStatus: "in_progress",
        forwardingState: "Not Configured",
        rollbackReady: false,
      },
    },
  ];

  for (const selected of cases) {
    const fixture = injectedFixture({ context: selected.context, registry: reviewedRegistry });
    const request = browserRequest("POST", ROUTES.setupControlPath, {
      action: selected.action,
      journeyRevision: selected.context.journeyRevision,
    });
    const first = await fixture.composition.dispatch(request);
    assert.equal(first.body.replayed, false, selected.action);
    Object.assign(selected.context, selected.expected);

    const replay = await fixture.composition.dispatch(request);
    assert.equal(replay.body.replayed, true, selected.action);
    for (const [key, value] of Object.entries(selected.expected)) {
      assert.equal(replay.body[key], value, `${selected.action}:${key}`);
    }
    assert.equal(fixture.setupControlStore.applies.length, 1, selected.action);
    assert.equal(fixture.setupControlStore.reads.length, 2, selected.action);
  }

  const issueContext = assignedContext();
  const issueFixture = injectedFixture({ context: issueContext, registry: reviewedRegistry });
  const issueRequest = browserRequest("POST", ROUTES.forwardingInstructionsPath, {
    journeyRevision: issueContext.journeyRevision,
    view: "enable",
  });
  const firstIssue = await issueFixture.composition.dispatch(issueRequest);
  Object.assign(issueContext, {
    controlRevision: 1,
    forwardingState: "Instructions Issued",
    instructionEvidenceFingerprint: instructionEvidence(issueContext, evidenceEntry),
  });
  const replayedIssue = await issueFixture.composition.dispatch(issueRequest);
  assert.deepEqual(replayedIssue.body.steps, firstIssue.body.steps);
  assert.equal(issueFixture.setupControlStore.applies.length, 1);
  assert.equal(issueFixture.setupControlStore.reads.length, 2);
});

test("concurrent stop and acknowledgement at one journey revision permit exactly one control winner", async () => {
  const registryEntry = reviewedEntry();
  const fixture = injectedFixture({
    context: evidencedContext(registryEntry, {
      controlRevision: 1,
      forwardingState: "Instructions Issued",
    }),
    registry: [registryEntry],
  });
  const results = await Promise.allSettled([
    fixture.composition.dispatch(browserRequest("POST", ROUTES.setupControlPath, {
      action: "stop",
      journeyRevision: 9,
    })),
    fixture.composition.dispatch(browserRequest("POST", ROUTES.setupControlPath, {
      action: "confirm_forwarding_enabled",
      journeyRevision: 9,
    })),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = results.find(({ status }) => status === "rejected");
  assert.equal(isDispatchError("context_conflict")(rejected.reason), true);
  assert.equal(fixture.setupControlStore.activationAttempts, 0);
  assert.equal(fixture.setupControlStore.liveRouteMutationAttempts, 0);
});

test("first forwarding instructions and Stop share one serializable control revision", async () => {
  const entry = reviewedEntry();
  const authenticationBarrier = rendezvousBarrier(2);
  const context = assignedContext();
  const fixture = injectedFixture({
    beforeAuthenticatedSetupReturn: () => authenticationBarrier.wait(),
    context,
    registry: [entry],
  });
  const results = await Promise.allSettled([
    fixture.composition.dispatch(browserRequest(
      "POST",
      ROUTES.forwardingInstructionsPath,
      { journeyRevision: context.journeyRevision, view: "enable" },
    )),
    fixture.composition.dispatch(browserRequest(
      "POST",
      ROUTES.setupControlPath,
      { action: "stop", journeyRevision: context.journeyRevision },
    )),
  ]);

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = results.find(({ status }) => status === "rejected");
  assert.equal(isDispatchError("context_conflict")(rejected.reason), true);
  assert.equal(fixture.setupControlStore.applies.length, 1);
  assert.equal(fixture.setupControlStore.records.size, 1);
  const [current] = fixture.setupControlStore.records.values();
  assert.equal(current.controlRevision, 1);
  assert.equal(
    new Set(["issue_forwarding_instructions", "stop"]).has(current.action),
    true,
  );
});

test("a stale number claim and Stop share one serializable mutation winner", async () => {
  const authenticationBarrier = rendezvousBarrier(2);
  const context = setupContext();
  const fixture = injectedFixture({
    beforeAuthenticatedSetupReturn: () => authenticationBarrier.wait(),
    context,
  });
  const results = await Promise.allSettled([
    fixture.composition.dispatch(browserRequest(
      "POST",
      ROUTES.numberClaimPath,
      { journeyRevision: context.journeyRevision },
    )),
    fixture.composition.dispatch(browserRequest(
      "POST",
      ROUTES.setupControlPath,
      { action: "stop", journeyRevision: context.journeyRevision },
    )),
  ]);

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = results.find(({ status }) => status === "rejected");
  assert.equal(isDispatchError("context_conflict")(rejected.reason), true);
  assert.equal(
    fixture.numberInventory.claims.length + fixture.setupControlStore.applies.length,
    1,
  );
  if (fixture.numberInventory.claims.length === 1) {
    assert.equal(context.numberState, "Reserved");
    assert.equal(fixture.setupControlStore.records.size, 0);
  } else {
    assert.equal(context.numberState, null);
    assert.equal(fixture.setupControlStore.records.size, 1);
    const [current] = fixture.setupControlStore.records.values();
    assert.equal(current.setupStatus, "stopped");
  }
});

test("a committed Stop fences a previously authenticated number claim in the shared coordinator", async () => {
  const barrier = oneShotBarrier();
  const fixture = injectedFixture({
    coordinatorHooks: { beforeClaim: () => barrier.wait() },
  });
  const pendingClaim = fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.numberClaimPath,
    { journeyRevision: 9 },
  ));
  await barrier.entered;
  const stopped = await fixture.composition.dispatch(browserRequest(
    "POST",
    ROUTES.setupControlPath,
    { action: "stop", journeyRevision: 9 },
  ));
  barrier.release();
  await assert.rejects(pendingClaim, isDispatchError("context_conflict"));
  assert.equal(stopped.body.setupStatus, "stopped");
  assert.equal(fixture.numberInventory.claims.length, 0);
  assert.equal(fixture.numberInventory.purchaseAttempts, 0);

  const claimFirst = injectedFixture();
  const claimed = await claimFirst.composition.dispatch(browserRequest(
    "POST",
    ROUTES.numberClaimPath,
    { journeyRevision: 9 },
  ));
  const stopAfterClaim = await claimFirst.composition.dispatch(browserRequest(
    "POST",
    ROUTES.setupControlPath,
    { action: "stop", journeyRevision: 9 },
  ));
  assert.equal(claimed.body.state, "Reserved");
  assert.equal(stopAfterClaim.body.setupStatus, "stopped");
  assert.equal(claimFirst.numberInventory.claims.length, 1);
});

test("a committed Stop fences window issuance and makes an earlier window stale for gateway use", async () => {
  const entry = reviewedEntry();
  const context = evidencedContext(entry, {
    approvedQaCallerFingerprint: fp("f"),
    controlRevision: 3,
    forwardingState: "Customer Reported Enabled",
    rollbackReady: true,
  });
  const barrier = oneShotBarrier();
  const stopFirst = injectedFixture({
    context,
    registry: [entry],
    coordinatorHooks: { beforeIssue: () => barrier.wait() },
  });
  const pendingIssue = stopFirst.composition.dispatch(browserRequest(
    "POST",
    ROUTES.routeVerificationWindowPath,
    { journeyRevision: 9 },
  ));
  await barrier.entered;
  const stopped = await stopFirst.composition.dispatch(browserRequest(
    "POST",
    ROUTES.setupControlPath,
    { action: "stop", journeyRevision: 9 },
  ));
  barrier.release();
  await assert.rejects(pendingIssue, isDispatchError("context_conflict"));
  assert.equal(stopped.body.setupStatus, "stopped");
  assert.equal(stopFirst.verificationStore.issues.length, 0);

  const issueFirstContext = evidencedContext(entry, {
    approvedQaCallerFingerprint: fp("f"),
    controlRevision: 3,
    forwardingState: "Customer Reported Enabled",
    rollbackReady: true,
  });
  const issueFirst = injectedFixture({ context: issueFirstContext, registry: [entry] });
  const issued = await issueFirst.composition.dispatch(browserRequest(
    "POST",
    ROUTES.routeVerificationWindowPath,
    { journeyRevision: 9 },
  ));
  const issuedWindow = [...issueFirst.verificationStore.operations.values()][0].window;
  const issuedFence = issuedWindow.control_fence_fingerprint.slice("control_fence_".length);
  const stopAfterIssue = await issueFirst.composition.dispatch(browserRequest(
    "POST",
    ROUTES.setupControlPath,
    { action: "stop", journeyRevision: 9 },
  ));
  assert.equal(issued.body.status, "Open");
  assert.equal(stopAfterIssue.body.setupStatus, "stopped");
  assert.notEqual(issuedFence, issueFirst.stateCoordinator.currentControlFenceFingerprint);
  assert.equal(issueFirst.verificationStore.consumeAttempts, 0);
});

test("injected route composition rejects collisions with every existing Form 2 path", () => {
  const fixture = injectedFixture();
  assert.doesNotThrow(() => fixture.composition.assertNoRouteCollision([
    "/form2/session/issue",
    "/form2/session/access",
    "/form2/session/otp/request",
    "/form2/session/otp/verify",
    "/form2/session/prefill",
    "/form2/session/submit",
  ]));
  assert.throws(
    () => fixture.composition.assertNoRouteCollision([ROUTES.numberClaimPath]),
    isDispatchError("configuration_invalid"),
  );
});
