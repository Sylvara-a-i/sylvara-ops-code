"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  FIELD_SETUP_PROTOCOL,
  FIELD_SETUP_STATES,
  PROHIBITED_BROWSER_ACTIONS,
  QUALIFICATION_FACTORS,
  assertBrowserAction,
  authorizeQualification,
  resolveTransition,
} = require("../lib/field-setup-contract");
const {
  JOURNEY_TABLE,
  createFieldSetupLaunchService,
  digestToken,
} = require("../lib/field-setup-launch");

const BASE_TIME = Date.parse("2026-08-25T12:00:00.000Z");
const PEPPER = "synthetic-field-setup-pepper-00000000000000000000000000000000";
const SCHEMA_PATH = path.resolve(
  __dirname,
  "../../../config/field-setup-datastore-schema.proposed.json",
);

function config() {
  return {
    digestPepper: PEPPER,
    environment: "development",
    launchTtlSeconds: 60,
    sessionAbsoluteTtlSeconds: 900,
    sessionIdleTtlSeconds: 300,
    tableName: JOURNEY_TABLE,
    webClientOrigin: "https://field-setup.example.invalid",
  };
}

function operator(id = "123456789012345") {
  return {
    authenticated: true,
    environment: "development",
    operatorUserId: id,
    role: "field_setup_operator",
  };
}

function context(overrides = {}) {
  return {
    environment: "development",
    moduleApiName: "Leads",
    operatorUserId: "123456789012345",
    recordId: "987654321098765",
    ...overrides,
  };
}

function storeError(message, publicCode = "field_setup_not_found") {
  const error = new Error(message);
  error.publicCode = publicCode;
  return error;
}

class MemoryStore {
  constructor(now) {
    this.now = now;
    this.rows = [];
    this.consumeInputs = [];
    this.transitionInputs = [];
  }

  async issueLaunch(row) {
    assert.equal(undefined, row.nonce);
    assert.match(row.launchDigest, /^[a-f0-9]{64}$/);
    assert.equal(null, row.sessionDigest);
    if (this.rows.some((candidate) => candidate.launchDigest === row.launchDigest)) {
      throw storeError("duplicate launch", "conflict");
    }
    this.rows.push({ ...row });
    return { ...row };
  }

  async consumeLaunch(input) {
    this.consumeInputs.push({ ...input });
    const row = this.rows.find((candidate) => candidate.launchDigest === input.launchDigest);
    if (
      !row ||
      row.launchConsumedAt !== input.expectedLaunchConsumedAt ||
      row.sessionDigest !== input.expectedSessionDigest ||
      row.revision !== input.expectedRevision ||
      row.state !== input.expectedState ||
      Date.parse(row.launchExpiresAt) <= this.now() ||
      row.operatorUserId !== input.operatorUserId ||
      row.environment !== input.environment ||
      this.rows.some((candidate) => candidate.sessionDigest === input.sessionDigest)
    ) {
      throw storeError("launch compare-and-set did not match");
    }
    Object.assign(row, {
      idleExpiresAt: input.idleExpiresAt,
      launchConsumedAt: input.launchConsumedAt,
      lastOutcome: input.lastOutcome,
      revision: input.nextRevision,
      sessionDigest: input.sessionDigest,
      state: input.nextState,
      updatedAt: input.updatedAt,
    });
    return { ...row };
  }

  async readBySessionDigest(digest) {
    const row = this.rows.find((candidate) => candidate.sessionDigest === digest);
    if (!row) throw storeError("session not found");
    return { ...row };
  }

  async compareAndSetJourney(input) {
    this.transitionInputs.push({ ...input });
    const row = this.rows.find((candidate) => candidate.sessionDigest === input.sessionDigest);
    if (
      !row ||
      row.revision !== input.expectedRevision ||
      row.state !== input.expectedState ||
      row.operatorUserId !== input.operatorUserId ||
      row.environment !== input.environment
    ) {
      throw storeError("stale revision", "stale_revision");
    }
    Object.assign(row, {
      ...input.statusPatch,
      ...input.fingerprintPatch,
      idleExpiresAt: input.idleExpiresAt,
      lastOutcome: input.lastOutcome,
      qualificationStatus: input.qualificationStatus,
      revision: input.nextRevision,
      state: input.nextState,
      updatedAt: input.updatedAt,
    });
    return { ...row };
  }
}

function deterministicEntropy() {
  let counter = 0;
  return (size) => {
    counter += 1;
    return crypto.createHash("sha256").update(`synthetic-${counter}`).digest().subarray(0, size);
  };
}

function syntheticFingerprint(field) {
  return crypto.createHash("sha256").update(`synthetic-${field}`).digest("hex");
}

async function syntheticServerPrerequisiteResolver({ binding, prerequisite }) {
  return {
    ...binding,
    authoritative: true,
    fingerprintPatch: Object.fromEntries(
      prerequisite.requiredFingerprintFields.map((field) => [field, syntheticFingerprint(field)]),
    ),
    receiptType: prerequisite.receiptType,
    statusPatch: { ...prerequisite.statusPatch },
  };
}

function createHarness(StoreType = MemoryStore, options = {}) {
  let current = BASE_TIME;
  const now = () => current;
  const store = new StoreType(now);
  let uuidCounter = 0;
  const service = createFieldSetupLaunchService({
    config: config(),
    now,
    randomBytes: deterministicEntropy(),
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
    serverPrerequisiteResolver: Object.hasOwn(options, "serverPrerequisiteResolver")
      ? options.serverPrerequisiteResolver
      : syntheticServerPrerequisiteResolver,
    store,
  });
  return {
    advance: (milliseconds) => { current += milliseconds; },
    now,
    service,
    store,
  };
}

async function issueAndExchange(harness) {
  const launch = await harness.service.issueLaunch(context());
  const nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  const exchange = await harness.service.exchangeLaunch({ nonce }, operator());
  const sessionToken = exchange.setCookie.match(/=([^;]+);/)[1];
  return { exchange, launch, nonce, sessionToken };
}

function qualification(decision, overrides = {}) {
  return {
    ...Object.fromEntries(QUALIFICATION_FACTORS.map((factor) => [factor, true])),
    decision,
    ...overrides,
  };
}

test("one canonical protocol defines all 22 states and every transition target", () => {
  assert.equal(1, FIELD_SETUP_PROTOCOL.schemaVersion);
  assert.equal(22, FIELD_SETUP_STATES.length);
  assert.equal(22, new Set(FIELD_SETUP_STATES).size);
  assert.deepEqual(FIELD_SETUP_STATES, FIELD_SETUP_PROTOCOL.states.map((state) => state.id));
  assert.equal("ready_for_approval", FIELD_SETUP_STATES[18]);
  assert.ok(!FIELD_SETUP_STATES.includes("activate_test"));
  for (const state of FIELD_SETUP_PROTOCOL.states) {
    for (const action of [state.primaryAction, ...state.secondaryActions]) {
      assert.equal(resolveTransition(state.id, action.id).nextState, action.nextState);
      assert.ok(FIELD_SETUP_STATES.includes(action.nextState));
    }
    const prerequisites = FIELD_SETUP_PROTOCOL.serverPrerequisites[state.id];
    assert.equal(Boolean(prerequisites), state.serverOutcomeRequired);
    if (state.serverOutcomeRequired) {
      assert.deepEqual(
        Object.keys(prerequisites).sort(),
        [state.primaryAction, ...state.secondaryActions].map((action) => action.id).sort(),
      );
    }
  }
  assert.deepEqual(
    Object.keys(FIELD_SETUP_PROTOCOL.persistence.stateStatusRequirements).sort(),
    [...FIELD_SETUP_STATES].sort(),
  );
});

test("launch rows initialize every schema column and every mandatory field is read back", async () => {
  const { service, store } = createHarness();
  const launch = await service.issueLaunch(context());
  const row = store.rows[0];
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const mappedFields = schema.table.columns.map(
    (column) => schema.source_property_map[column.api_name],
  );
  assert.deepEqual(Object.keys(row).sort(), [...FIELD_SETUP_PROTOCOL.persistence.rowFields].sort());
  assert.deepEqual(mappedFields.sort(), [...FIELD_SETUP_PROTOCOL.persistence.rowFields].sort());
  for (const field of FIELD_SETUP_PROTOCOL.persistence.mandatoryFields) {
    assert.notEqual(row[field], null, field);
    assert.notEqual(row[field], undefined, field);
  }
  for (const [field, expected] of Object.entries(FIELD_SETUP_PROTOCOL.persistence.initialValues)) {
    assert.equal(row[field], expected, field);
  }
  assert.equal(row.updatedAt, row.issuedAt);
  assert.equal(undefined, row.nonce);
  assert.ok(!launch.launchUrl.includes(context().recordId));
  assert.ok(!launch.launchUrl.includes(context().operatorUserId));
});

test("any missing mandatory field or changed insert readback fails closed", async () => {
  class CorruptInsertStore extends MemoryStore {
    async issueLaunch(row) {
      const stored = await super.issueLaunch(row);
      delete stored.form1Status;
      return stored;
    }
  }
  await assert.rejects(
    () => createHarness(CorruptInsertStore).service.issueLaunch(context()),
    /Stored journey is invalid/,
  );

  class ChangedReadbackStore extends MemoryStore {
    async issueLaunch(row) {
      const stored = await super.issueLaunch(row);
      stored.lastOutcome = "unexpected_store_value";
      return stored;
    }
  }
  await assert.rejects(
    () => createHarness(ChangedReadbackStore).service.issueLaunch(context()),
    /readback was inconsistent/,
  );
});

test("launch uses 256-bit entropy, fragment only, and digest-only storage", async () => {
  const { service, store } = createHarness();
  const first = await service.issueLaunch(context());
  const second = await service.issueLaunch(context());
  assert.notEqual(first.launchUrl, second.launchUrl);
  const url = new URL(first.launchUrl);
  assert.equal("", url.search);
  assert.match(url.hash, /^#launch=[A-Za-z0-9_-]{43}$/);
  assert.equal("/field-setup/", url.pathname);
  assert.equal(null, store.rows[0].sessionDigest);
  assert.match(store.rows[0].launchDigest, /^[a-f0-9]{64}$/);
});

test("concurrent exchange of one nonce creates exactly one bound session", async () => {
  const harness = createHarness();
  const launch = await harness.service.issueLaunch(context());
  const nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  const outcomes = await Promise.allSettled([
    harness.service.exchangeLaunch({ nonce }, operator()),
    harness.service.exchangeLaunch({ nonce }, operator()),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.match(harness.store.rows[0].sessionDigest, /^[a-f0-9]{64}$/);
  assert.equal(2, harness.store.rows[0].revision);
  assert.equal("company_progress_summary", harness.store.rows[0].state);
  assert.equal(2, harness.store.consumeInputs.length);
});

test("exchange readback is complete, CAS-bound, and issues the bounded cookie", async () => {
  const harness = createHarness();
  const { exchange, sessionToken } = await issueAndExchange(harness);
  assert.match(
    exchange.setCookie,
    /^__Host-sylvara_field_setup=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=900; Secure; HttpOnly; SameSite=Strict$/,
  );
  assert.deepEqual(exchange.publicJourney, {
    state: "company_progress_summary",
    revision: 2,
    progress: 2,
    totalSteps: 22,
  });
  const cas = harness.store.consumeInputs[0];
  assert.deepEqual(
    {
      expectedLaunchConsumedAt: cas.expectedLaunchConsumedAt,
      expectedRevision: cas.expectedRevision,
      expectedSessionDigest: cas.expectedSessionDigest,
      expectedState: cas.expectedState,
      nextRevision: cas.nextRevision,
      nextState: cas.nextState,
    },
    {
      expectedLaunchConsumedAt: null,
      expectedRevision: 1,
      expectedSessionDigest: null,
      expectedState: "loading_session_validation",
      nextRevision: 2,
      nextState: "company_progress_summary",
    },
  );
  assert.equal(harness.store.rows[0].sessionDigest, digestToken(sessionToken, PEPPER));
  assert.equal(undefined, harness.store.rows[0].sessionToken);
});

test("expired, cross-user, cross-environment, and malformed record launches fail closed", async () => {
  const expired = createHarness();
  let launch = await expired.service.issueLaunch(context());
  expired.advance(60_000);
  let nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  await assert.rejects(() => expired.service.exchangeLaunch({ nonce }, operator()), /compare-and-set/);

  const user = createHarness();
  launch = await user.service.issueLaunch(context());
  nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  await assert.rejects(
    () => user.service.exchangeLaunch({ nonce }, operator("223456789012345")),
    /compare-and-set/,
  );

  const environment = createHarness();
  launch = await environment.service.issueLaunch(context());
  nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  await assert.rejects(
    () => environment.service.exchangeLaunch({ nonce }, { ...operator(), environment: "production" }),
    /field-setup operator is required/,
  );
  await assert.rejects(
    () => createHarness().service.issueLaunch(context({ recordId: "other-record" })),
    /Record is invalid/,
  );
});

test("session authentication is bound and expires at idle or absolute TTL", async () => {
  const harness = createHarness();
  const { sessionToken } = await issueAndExchange(harness);
  await harness.service.authenticateSession(sessionToken, operator());
  await assert.rejects(
    () => harness.service.authenticateSession(sessionToken, operator("223456789012345")),
    /not found/,
  );
  harness.advance(300_000);
  await assert.rejects(
    () => harness.service.authenticateSession(sessionToken, operator()),
    /not found/,
  );
});

test("concurrent transitions use revision CAS and stale revision never changes state", async () => {
  const harness = createHarness();
  const { sessionToken } = await issueAndExchange(harness);
  const input = {
    actionId: "acknowledge_company_summary",
    expectedRevision: 2,
    qualification: null,
    sessionToken,
  };
  const outcomes = await Promise.allSettled([
    harness.service.transitionSession(input, operator()),
    harness.service.transitionSession(input, operator()),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.equal("handoff_to_client_form1", harness.store.rows[0].state);
  assert.equal(3, harness.store.rows[0].revision);
  assert.equal(2, harness.store.transitionInputs.length);
  await assert.rejects(
    () => harness.service.transitionSession(input, operator()),
    /stale/,
  );
  assert.equal(3, harness.store.rows[0].revision);
});

test("browser-only sequential intents stop at the first server-required transition", async () => {
  const harness = createHarness(MemoryStore, { serverPrerequisiteResolver: null });
  const { sessionToken } = await issueAndExchange(harness);
  await assert.rejects(() => harness.service.transitionSession({
    actionId: "acknowledge_company_summary",
    expectedRevision: 2,
    qualification: null,
    serverReceipt: { authoritative: true },
    sessionToken,
  }, operator()), /Session transition is invalid/);
  const step = (actionId, expectedRevision, qualificationBody = null) => (
    harness.service.transitionSession({
      actionId,
      expectedRevision,
      qualification: qualificationBody,
      sessionToken,
    }, operator())
  );
  await step("acknowledge_company_summary", 2);
  await step("handoff_to_client_form1", 3);
  await assert.rejects(
    () => step("open_form1", 4),
    (error) => error.publicCode === "server_outcome_required",
  );
  assert.equal("form1_open_or_resume", harness.store.rows[0].state);
  assert.equal(4, harness.store.rows[0].revision);
  assert.equal("not_started", harness.store.rows[0].form1Status);
  assert.equal("not_started", harness.store.rows[0].conversionStatus);
  assert.equal("not_started", harness.store.rows[0].form2Status);
  assert.equal("not_started", harness.store.rows[0].numberStatus);
  assert.equal("not_configured", harness.store.rows[0].forwardingStatus);
  assert.equal("not_verified", harness.store.rows[0].routeVerificationStatus);
  assert.equal("not_prepared", harness.store.rows[0].rollbackStatus);
  assert.equal(2, harness.store.transitionInputs.length);
});

test("authoritative receipts reconcile every guarded step before readiness", async () => {
  const harness = createHarness();
  const { sessionToken } = await issueAndExchange(harness);
  let revision = 2;
  const step = async (actionId, qualificationBody = null) => {
    const result = await harness.service.transitionSession({
      actionId,
      expectedRevision: revision,
      qualification: qualificationBody,
      sessionToken,
    }, operator());
    revision = result.revision;
    return result;
  };
  for (const [actionId, qualificationBody] of [
    ["acknowledge_company_summary", null],
    ["handoff_to_client_form1", null],
    ["open_form1", null],
    ["confirm_form1_return", null],
    ["handoff_to_operator_after_form1", null],
    ["qualification_qualified", qualification("qualified_continue_setup")],
    ["accept_conversion_preview", null],
    ["confirm_conversion_intent", null],
    ["handoff_to_client_form2", null],
    ["open_form2_email_verification", null],
    ["open_form2", null],
    ["confirm_form2_return", null],
    ["handoff_to_operator_after_form2", null],
    ["refresh_number_status", null],
    ["view_forwarding_instructions", null],
    ["view_rollback_instructions", null],
    ["refresh_route_verification", null],
  ]) {
    await step(actionId, qualificationBody);
  }
  const row = harness.store.rows[0];
  assert.equal(19, revision);
  assert.equal("ready_for_approval", row.state);
  assert.deepEqual({
    conversionStatus: row.conversionStatus,
    form1Status: row.form1Status,
    form2Status: row.form2Status,
    forwardingStatus: row.forwardingStatus,
    numberStatus: row.numberStatus,
    qualificationStatus: row.qualificationStatus,
    rollbackStatus: row.rollbackStatus,
    routeVerificationStatus: row.routeVerificationStatus,
  }, {
    conversionStatus: "completed",
    form1Status: "reconciled",
    form2Status: "reconciled",
    forwardingStatus: "verified",
    numberStatus: "assigned",
    qualificationStatus: "qualified",
    rollbackStatus: "ready",
    routeVerificationStatus: "verified",
  });
  for (const field of [
    "conversionPreviewFingerprint",
    "conversionSideEffectFingerprint",
    "conversionOutcomeFingerprint",
    "configVersionFingerprint",
  ]) assert.match(row[field], /^[a-f0-9]{64}$/, field);
});

test("stored readiness cannot disagree with authoritative journey statuses", async () => {
  const harness = createHarness();
  const { sessionToken } = await issueAndExchange(harness);
  Object.assign(harness.store.rows[0], {
    revision: 19,
    state: "ready_for_approval",
  });
  await assert.rejects(
    () => harness.service.authenticateSession(sessionToken, operator()),
    /Stored journey is invalid/,
  );
});

test("server receipts are exact, immutable, and bound to state revision and journey", async () => {
  const corruptions = [
    (receipt) => ({ ...receipt, revision: receipt.revision + 1 }),
    (receipt) => ({ ...receipt, recordId: "111111111111111" }),
    (receipt) => ({
      ...receipt,
      statusPatch: { form1Status: "reconciled" },
    }),
    (receipt) => ({ ...receipt, unapproved: true }),
  ];
  for (const corrupt of corruptions) {
    const resolver = async (input) => corrupt(
      await syntheticServerPrerequisiteResolver(input),
    );
    const harness = createHarness(MemoryStore, { serverPrerequisiteResolver: resolver });
    const { sessionToken } = await issueAndExchange(harness);
    await harness.service.transitionSession({
      actionId: "acknowledge_company_summary",
      expectedRevision: 2,
      qualification: null,
      sessionToken,
    }, operator());
    await harness.service.transitionSession({
      actionId: "handoff_to_client_form1",
      expectedRevision: 3,
      qualification: null,
      sessionToken,
    }, operator());
    await assert.rejects(() => harness.service.transitionSession({
      actionId: "open_form1",
      expectedRevision: 4,
      qualification: null,
      sessionToken,
    }, operator()));
    assert.equal("form1_open_or_resume", harness.store.rows[0].state);
    assert.equal("not_started", harness.store.rows[0].form1Status);
    assert.equal(2, harness.store.transitionInputs.length);
  }
});

test("a later receipt cannot replace an immutable conversion fingerprint", async () => {
  const resolver = async (input) => {
    const receipt = await syntheticServerPrerequisiteResolver(input);
    if (receipt.receiptType !== "conversion_completion_reconciled") return receipt;
    return {
      ...receipt,
      fingerprintPatch: {
        ...receipt.fingerprintPatch,
        conversionPreviewFingerprint: "f".repeat(64),
      },
    };
  };
  const harness = createHarness(MemoryStore, { serverPrerequisiteResolver: resolver });
  const { sessionToken } = await issueAndExchange(harness);
  let revision = 2;
  for (const [actionId, qualificationBody] of [
    ["acknowledge_company_summary", null],
    ["handoff_to_client_form1", null],
    ["open_form1", null],
    ["confirm_form1_return", null],
    ["handoff_to_operator_after_form1", null],
    ["qualification_qualified", qualification("qualified_continue_setup")],
    ["accept_conversion_preview", null],
  ]) {
    const result = await harness.service.transitionSession({
      actionId,
      expectedRevision: revision,
      qualification: qualificationBody,
      sessionToken,
    }, operator());
    revision = result.revision;
  }
  await assert.rejects(() => harness.service.transitionSession({
    actionId: "confirm_conversion_intent",
    expectedRevision: revision,
    qualification: null,
    sessionToken,
  }, operator()), /immutable journey evidence/);
  assert.equal("lead_conversion_confirmation", harness.store.rows[0].state);
  assert.equal("preview_ready", harness.store.rows[0].conversionStatus);
  assert.equal(syntheticFingerprint("conversionPreviewFingerprint"),
    harness.store.rows[0].conversionPreviewFingerprint);
});

test("six-factor qualification payload is exact, operator-bound, and never authorizes conversion", async () => {
  const harness = createHarness();
  const { sessionToken } = await issueAndExchange(harness);
  Object.assign(harness.store.rows[0], {
    form1Status: "reconciled",
    revision: 7,
    state: "operator_qualification_review",
  });
  const body = qualification("qualified_continue_setup");
  const result = await harness.service.transitionSession({
    actionId: "qualification_qualified",
    expectedRevision: 7,
    qualification: body,
    sessionToken,
  }, operator());
  assert.deepEqual(result, {
    authoritative: true,
    conversionAuthorized: false,
    qualificationStatus: "qualified",
    revision: 8,
    state: "lead_conversion_preview",
  });
  assert.deepEqual(
    Object.keys(body).sort(),
    [...QUALIFICATION_FACTORS, "decision"].sort(),
  );
  assert.equal(undefined, harness.store.transitionInputs[0].qualification);
  assert.equal(undefined, harness.store.transitionInputs[0].factors);
});

test("qualification rejects missing, nonboolean, mismatched, and incomplete qualified payloads", async () => {
  const cases = [
    (() => { const value = qualification("qualified_continue_setup"); delete value.decisionMakerIsPresent; return value; })(),
    qualification("qualified_continue_setup", { decisionMakerIsPresent: "yes" }),
    qualification("disqualified"),
    qualification("qualified_continue_setup", { decisionMakerIsPresent: false }),
  ];
  for (const body of cases) {
    const harness = createHarness();
    const { sessionToken } = await issueAndExchange(harness);
    Object.assign(harness.store.rows[0], {
      form1Status: "reconciled",
      revision: 7,
      state: "operator_qualification_review",
    });
    await assert.rejects(() => harness.service.transitionSession({
      actionId: "qualification_qualified",
      expectedRevision: 7,
      qualification: body,
      sessionToken,
    }, operator()));
    assert.equal(7, harness.store.rows[0].revision);
    assert.equal("not_started", harness.store.rows[0].qualificationStatus);
  }
});

test("not-ready qualification may preserve false factors but remains non-converting and blocked", () => {
  const journey = context();
  const body = qualification("not_ready_save_and_follow_up", {
    canAcceptAdditionalProfitableWork: false,
    decisionMakerIsPresent: false,
  });
  const result = authorizeQualification(journey, body, operator());
  assert.equal("recoverable_blocked", result.nextState);
  assert.equal("not_ready", result.storedStatus);
  assert.equal(false, result.conversionAuthorized);
});

test("browser actions are intent-only and authority operations remain prohibited", () => {
  assert.equal("refresh_live_status", assertBrowserAction("refresh_live_status"));
  assert.equal("qualification_qualified", assertBrowserAction("qualification_qualified"));
  assert.equal(true, FIELD_SETUP_PROTOCOL.browserAuthority.intentOnly);
  for (const action of PROHIBITED_BROWSER_ACTIONS) {
    assert.throws(() => assertBrowserAction(action), /browser cannot perform/);
  }
});
