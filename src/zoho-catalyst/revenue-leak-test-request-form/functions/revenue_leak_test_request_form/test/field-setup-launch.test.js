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
  resumeBindingDigest,
} = require("../lib/field-setup-launch");

const BASE_TIME = Date.parse("2026-08-25T12:00:00.000Z");
const PEPPER = "synthetic-field-setup-pepper-00000000000000000000000000000000";
const SYNTHETIC_DEAL_ID = "876543210987654";
const SCHEMA_PATH = path.resolve(
  __dirname,
  "../../../config/field-setup-datastore-schema.proposed.json",
);
const FORM_NAVIGATION_DESTINATIONS = Object.freeze({
  form1: "https://forms.zohopublic.com/synthetic/free-test-request",
  form2: "https://forms.zohopublic.com/synthetic/free-test-authorization",
});

function config() {
  return {
    digestPepper: PEPPER,
    environment: "development",
    formNavigationDestinations: FORM_NAVIGATION_DESTINATIONS,
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

  async issueOrResumeLaunch(input) {
    const bindingField = input.moduleApiName === "Leads"
      ? "leadResumeBindingDigest"
      : "dealResumeBindingDigest";
    const matches = this.rows.filter(
      (candidate) => candidate[bindingField] === input.bindingDigest,
    );
    if (matches.length > 1) throw storeError("ambiguous resume binding", "conflict");
    if (matches.length === 0) {
      if (input.moduleApiName !== "Leads" || !input.createRow) {
        throw storeError("mapped journey not found");
      }
      assert.equal(input.createRow.leadResumeBindingDigest, input.bindingDigest);
      assert.equal(undefined, input.createRow.nonce);
      assert.match(input.createRow.launchDigest, /^[a-f0-9]{64}$/);
      assert.equal(null, input.createRow.sessionDigest);
      if (
        this.rows.some((candidate) => (
          candidate.launchDigest === input.createRow.launchDigest ||
          candidate.leadResumeBindingDigest === input.bindingDigest
        ))
      ) {
        throw storeError("duplicate launch", "conflict");
      }
      this.rows.push({ ...input.createRow });
      return { after: { ...input.createRow }, before: null, created: true };
    }

    const row = matches[0];
    if (
      row.operatorUserId !== input.operatorUserId ||
      row.environment !== input.environment ||
      this.rows.some((candidate) => candidate !== row && candidate.launchDigest === input.launchDigest)
    ) {
      throw storeError("resume binding rejected");
    }
    const before = { ...row };
    Object.assign(row, {
      absoluteExpiresAt: input.absoluteExpiresAt,
      idleExpiresAt: null,
      issuedAt: input.issuedAt,
      launchConsumedAt: null,
      launchDigest: input.launchDigest,
      launchExpiresAt: input.launchExpiresAt,
      lastOutcome: "launch_reissued",
      revision: row.revision + 1,
      sessionDigest: null,
      updatedAt: input.updatedAt,
    });
    return { after: { ...row }, before, created: false };
  }

  async readByLaunchDigest(digest) {
    const row = this.rows.find((candidate) => candidate.launchDigest === digest);
    if (!row) throw storeError("launch not found");
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
  const navigationTarget = ["open_form1", "resume_form1"].includes(binding.actionId)
    ? "form1"
    : ["open_form2", "resume_form2"].includes(binding.actionId)
      ? "form2"
      : null;
  return {
    ...binding,
    authoritative: true,
    fingerprintPatch: Object.fromEntries(
      prerequisite.requiredFingerprintFields.map((field) => [
        field,
        field === "dealResumeBindingDigest"
          ? resumeBindingDigest({
            environment: binding.environment,
            moduleApiName: "Deals",
            recordId: SYNTHETIC_DEAL_ID,
          }, PEPPER)
          : syntheticFingerprint(field),
      ]),
    ),
    navigationIntent: navigationTarget === null
      ? null
      : {
        mode: "top_level",
        target: navigationTarget,
        url: `${FORM_NAVIGATION_DESTINATIONS[navigationTarget]}?token=${"n".repeat(43)}`,
      },
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
    config: { ...config(), ...(options.configOverrides ?? {}) },
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

function applySyntheticConversionCoordinatorCompletion(row) {
  Object.assign(row, {
    conversionOutcomeFingerprint: syntheticFingerprint("conversionOutcomeFingerprint"),
    conversionPreviewFingerprint: syntheticFingerprint("conversionPreviewFingerprint"),
    conversionSideEffectFingerprint: syntheticFingerprint("conversionSideEffectFingerprint"),
    conversionStatus: "completed",
    dealResumeBindingDigest: resumeBindingDigest({
      environment: "development",
      moduleApiName: "Deals",
      recordId: SYNTHETIC_DEAL_ID,
    }, PEPPER),
    lastOutcome: "conversion_completion_reconciled",
    // Preview CAS (+1), durable write-boundary CAS (+1), and completion CAS (+1)
    // belong to the dedicated conversion coordinator rather than transitionSession.
    revision: row.revision + 3,
    state: "handoff_to_client_form2",
  });
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

test("every action-bound outcome fits LAST_OUTCOME and the longest uses all 80 characters", () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const lastOutcomeColumn = schema.table.columns.find(
    (column) => column.api_name === "LAST_OUTCOME",
  );
  assert.equal(80, lastOutcomeColumn.max_length);

  const outcomes = FIELD_SETUP_PROTOCOL.states.flatMap((state) => (
    [state.primaryAction, ...state.secondaryActions].map((action) => {
      const prerequisite = FIELD_SETUP_PROTOCOL.serverPrerequisites[state.id]?.[action.id] ?? null;
      return prerequisite === null
        ? `transition:${action.id}`
        : `server_outcome:${prerequisite.receiptType}:${action.id}`;
    })
  ));
  for (const action of FIELD_SETUP_PROTOCOL.globalActions) {
    const prerequisite = FIELD_SETUP_PROTOCOL.globalServerPrerequisites[action.id];
    outcomes.push(`server_outcome:${prerequisite.receiptType}:${action.id}`);
  }
  assert.ok(outcomes.every((outcome) => outcome.length <= lastOutcomeColumn.max_length));
  const longest = outcomes.toSorted((left, right) => right.length - left.length)[0];
  assert.equal(80, longest.length);
  assert.equal(
    "server_outcome:form2_email_verification_reconciled:open_form2_email_verification",
    longest,
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
    async issueOrResumeLaunch(input) {
      const stored = await super.issueOrResumeLaunch(input);
      delete stored.after.form1Status;
      return stored;
    }
  }
  await assert.rejects(
    () => createHarness(CorruptInsertStore).service.issueLaunch(context()),
    /Stored journey is invalid/,
  );

  class ChangedReadbackStore extends MemoryStore {
    async issueOrResumeLaunch(input) {
      const stored = await super.issueOrResumeLaunch(input);
      stored.after.lastOutcome = "unexpected_store_value";
      return stored;
    }
  }
  await assert.rejects(
    () => createHarness(ChangedReadbackStore).service.issueLaunch(context()),
    /readback was inconsistent/,
  );

  class DealOwnedJourneyStore extends MemoryStore {
    async issueOrResumeLaunch(input) {
      const stored = await super.issueOrResumeLaunch(input);
      stored.after.moduleApiName = "Deals";
      return stored;
    }
  }
  await assert.rejects(
    () => createHarness(DealOwnedJourneyStore).service.issueLaunch(context()),
    /Stored journey is invalid/,
  );
});

test("launch uses 256-bit entropy, fragment only, and digest-only storage", async () => {
  const { service, store } = createHarness();
  const first = await service.issueLaunch(context());
  const second = await service.issueLaunch(context());
  assert.notEqual(first.launchUrl, second.launchUrl);
  assert.equal(store.rows.length, 1);
  const url = new URL(first.launchUrl);
  assert.equal("", url.search);
  assert.match(url.hash, /^#launch=[A-Za-z0-9_-]{43}$/);
  assert.equal("/field-setup/", url.pathname);
  assert.equal(null, store.rows[0].sessionDigest);
  assert.match(store.rows[0].launchDigest, /^[a-f0-9]{64}$/);
});

test("concurrent Lead launches keep one journey and only the newest launch nonce can exchange", async () => {
  const harness = createHarness();
  const launches = await Promise.all([
    harness.service.issueLaunch(context()),
    harness.service.issueLaunch(context()),
  ]);
  assert.equal(harness.store.rows.length, 1);
  assert.equal(harness.store.rows[0].revision, 2);
  const nonces = launches.map((launch) => new URL(launch.launchUrl).hash.slice("#launch=".length));
  assert.equal(new Set(nonces).size, 2);
  const outcomes = await Promise.allSettled(
    nonces.map((nonce) => harness.service.exchangeLaunch({ nonce }, operator())),
  );
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.equal(harness.store.rows.length, 1);
  assert.equal(harness.store.rows[0].state, "company_progress_summary");
  assert.equal(harness.store.rows[0].revision, 3);
});

test("Deal resume uses the coordinator-persisted digest without resetting the Lead journey", async () => {
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
  };
  for (const [actionId, qualificationBody] of [
    ["acknowledge_company_summary", null],
    ["handoff_to_client_form1", null],
    ["open_form1", null],
    ["confirm_form1_return", null],
    ["handoff_to_operator_after_form1", null],
    ["qualification_qualified", qualification("qualified_continue_setup")],
  ]) {
    await step(actionId, qualificationBody);
  }
  assert.equal(harness.store.rows[0].state, "lead_conversion_preview");
  applySyntheticConversionCoordinatorCompletion(harness.store.rows[0]);
  const beforeResume = { ...harness.store.rows[0] };
  assert.equal(beforeResume.state, "handoff_to_client_form2");
  assert.equal(beforeResume.conversionStatus, "completed");
  assert.equal(
    beforeResume.dealResumeBindingDigest,
    resumeBindingDigest({
      environment: "development",
      moduleApiName: "Deals",
      recordId: SYNTHETIC_DEAL_ID,
    }, PEPPER),
  );

  const dealLaunch = await harness.service.issueLaunch(context({
    moduleApiName: "Deals",
    recordId: SYNTHETIC_DEAL_ID,
  }));
  assert.equal(harness.store.rows.length, 1);
  assert.equal(harness.store.rows[0].journeyKey, beforeResume.journeyKey);
  assert.equal(harness.store.rows[0].state, beforeResume.state);
  assert.equal(harness.store.rows[0].conversionOutcomeFingerprint, beforeResume.conversionOutcomeFingerprint);
  assert.equal(harness.store.rows[0].revision, beforeResume.revision + 1);
  await assert.rejects(
    () => harness.service.authenticateSession(sessionToken, operator()),
    /session not found/,
  );

  const dealNonce = new URL(dealLaunch.launchUrl).hash.slice("#launch=".length);
  const resumed = await harness.service.exchangeLaunch({ nonce: dealNonce }, operator());
  assert.equal(resumed.publicJourney.state, beforeResume.state);
  assert.equal(resumed.publicJourney.revision, beforeResume.revision + 2);

  await assert.rejects(
    () => harness.service.issueLaunch(context({
      moduleApiName: "Deals",
      recordId: "776543210987654",
    })),
    /mapped journey not found/,
  );
  assert.equal(harness.store.rows.length, 1);
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

test("delayed exchange caps equal idle and absolute TTLs at the stored absolute deadline", async () => {
  const harness = createHarness(MemoryStore, {
    configOverrides: {
      sessionAbsoluteTtlSeconds: 300,
      sessionIdleTtlSeconds: 300,
    },
  });
  const launch = await harness.service.issueLaunch(context());
  const nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  harness.advance(1000);
  const exchange = await harness.service.exchangeLaunch({ nonce }, operator());
  assert.match(exchange.setCookie, /; Max-Age=299;/);
  const row = harness.store.rows[0];
  assert.equal(row.idleExpiresAt, row.absoluteExpiresAt);
  const sessionToken = exchange.setCookie.match(/=([^;]+);/)[1];
  const authenticated = await harness.service.authenticateSession(sessionToken, operator());
  assert.equal(authenticated.sessionDigest, row.sessionDigest);
});

test("expired, cross-user, cross-environment, and malformed record launches fail closed", async () => {
  const expired = createHarness();
  let launch = await expired.service.issueLaunch(context());
  expired.advance(60_000);
  let nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  await assert.rejects(() => expired.service.exchangeLaunch({ nonce }, operator()), /token was not found/);

  const user = createHarness();
  launch = await user.service.issueLaunch(context());
  nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  await assert.rejects(
    () => user.service.exchangeLaunch({ nonce }, operator("223456789012345")),
    /token was not found/,
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

test("concurrent transitions use revision CAS and a later exact retry replays without another CAS", async () => {
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
  const committed = outcomes.find((outcome) => outcome.status === "fulfilled").value;
  const replayed = await harness.service.transitionSession(input, operator());
  assert.deepEqual(replayed, committed);
  assert.equal(3, harness.store.rows[0].revision);
  assert.equal(2, harness.store.transitionInputs.length);
});

test("global Stop replays one lost response from immutable action evidence without another CAS", async () => {
  const harness = createHarness();
  const { sessionToken } = await issueAndExchange(harness);
  const input = {
    actionId: "stop_setup",
    expectedRevision: 2,
    qualification: null,
    sessionToken,
  };
  const committed = await harness.service.transitionSession(input, operator());
  assert.deepEqual(committed, {
    authoritative: true,
    conversionAuthorized: false,
    navigationIntent: null,
    qualificationStatus: "not_started",
    revision: 3,
    state: "stop_rollback_status",
  });
  assert.equal("server_outcome:setup_stop_reconciled:stop_setup", harness.store.rows[0].lastOutcome);
  assert.equal("requested", harness.store.rows[0].rollbackStatus);
  assert.equal(1, harness.store.transitionInputs.length);

  const replayed = await harness.service.transitionSession(input, operator());
  assert.deepEqual(replayed, committed);
  assert.equal(1, harness.store.transitionInputs.length);

  await assert.rejects(() => harness.service.transitionSession({
    ...input,
    qualification: qualification("not_ready_save_and_follow_up"),
  }, operator()), /Qualification payload is not permitted/);
  assert.equal(1, harness.store.transitionInputs.length);
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

test("Form navigation is returned only after authoritative CAS and stays on the injected exact base", async () => {
  let serverReads = 0;
  const harness = createHarness(MemoryStore, {
    serverPrerequisiteResolver: async (input) => {
      serverReads += 1;
      return syntheticServerPrerequisiteResolver(input);
    },
  });
  const { sessionToken } = await issueAndExchange(harness);
  let revision = 2;
  for (const actionId of ["acknowledge_company_summary", "handoff_to_client_form1"]) {
    const result = await harness.service.transitionSession({
      actionId,
      expectedRevision: revision,
      qualification: null,
      sessionToken,
    }, operator());
    revision = result.revision;
    assert.equal(result.navigationIntent, null);
  }
  const openInput = {
    actionId: "open_form1",
    expectedRevision: revision,
    qualification: null,
    sessionToken,
  };
  const transitionsBeforeOpen = harness.store.transitionInputs.length;
  const opened = await harness.service.transitionSession(openInput, operator());
  assert.equal(opened.state, "form1_completion_confirmation");
  assert.equal(harness.store.rows[0].form1Status, "in_progress");
  assert.deepEqual(opened.navigationIntent, {
    mode: "top_level",
    target: "form1",
    url: `${FORM_NAVIGATION_DESTINATIONS.form1}?token=${"n".repeat(43)}`,
  });
  assert.equal(transitionsBeforeOpen + 1, harness.store.transitionInputs.length);

  const replayedOpen = await harness.service.transitionSession(openInput, operator());
  assert.deepEqual(replayedOpen, opened);
  assert.equal(replayedOpen.navigationIntent.url, opened.navigationIntent.url);
  assert.equal(2, serverReads);
  assert.equal(transitionsBeforeOpen + 1, harness.store.transitionInputs.length);

  await assert.rejects(() => harness.service.transitionSession({
    ...openInput,
    actionId: "resume_form1",
  }, operator()), (error) => error.publicCode === "stale_revision");
  await assert.rejects(() => harness.service.transitionSession({
    ...openInput,
    expectedRevision: openInput.expectedRevision - 1,
  }, operator()), (error) => error.publicCode === "stale_revision");

  harness.store.rows[0].lastOutcome = "transition:open_form1";
  await assert.rejects(
    () => harness.service.transitionSession(openInput, operator()),
    (error) => error.publicCode === "stale_revision",
  );
  harness.store.rows[0].lastOutcome = "server_outcome:form1_opened_or_resumed:open_form1";

  harness.store.rows[0].form1Status = "submitted";
  await assert.rejects(
    () => harness.service.transitionSession(openInput, operator()),
    (error) => error.publicCode === "stale_revision",
  );
  harness.store.rows[0].form1Status = "in_progress";
  assert.equal(transitionsBeforeOpen + 1, harness.store.transitionInputs.length);

  const resumed = await harness.service.transitionSession({
    actionId: "resume_form1",
    expectedRevision: opened.revision,
    qualification: null,
    sessionToken,
  }, operator());
  assert.equal(resumed.state, "form1_completion_confirmation");
  assert.equal(resumed.revision, opened.revision + 1);
  assert.equal(harness.store.rows[0].form1Status, "in_progress");
  assert.deepEqual(resumed.navigationIntent, opened.navigationIntent);

  const maliciousResolver = async (input) => {
    const receipt = await syntheticServerPrerequisiteResolver(input);
    if (input.binding.actionId !== "open_form1") return receipt;
    return {
      ...receipt,
      navigationIntent: {
        ...receipt.navigationIntent,
        url: `https://attacker.example.invalid/free-test-request?token=${"n".repeat(43)}`,
      },
    };
  };
  const blocked = createHarness(MemoryStore, { serverPrerequisiteResolver: maliciousResolver });
  const blockedSession = await issueAndExchange(blocked);
  revision = 2;
  for (const actionId of ["acknowledge_company_summary", "handoff_to_client_form1"]) {
    const result = await blocked.service.transitionSession({
      actionId,
      expectedRevision: revision,
      qualification: null,
      sessionToken: blockedSession.sessionToken,
    }, operator());
    revision = result.revision;
  }
  await assert.rejects(() => blocked.service.transitionSession({
    actionId: "open_form1",
    expectedRevision: revision,
    qualification: null,
    sessionToken: blockedSession.sessionToken,
  }, operator()), /outside the approved destination/);
  assert.equal(blocked.store.rows[0].state, "form1_open_or_resume");
  assert.equal(blocked.store.rows[0].form1Status, "not_started");
});

test("generic replay uses durable fingerprints and rejects missing required fingerprint evidence", async () => {
  let serverReads = 0;
  const harness = createHarness(MemoryStore, {
    serverPrerequisiteResolver: async (input) => {
      serverReads += 1;
      return syntheticServerPrerequisiteResolver(input);
    },
  });
  const { sessionToken } = await issueAndExchange(harness);
  Object.assign(harness.store.rows[0], {
    conversionOutcomeFingerprint: syntheticFingerprint("conversionOutcomeFingerprint"),
    conversionPreviewFingerprint: syntheticFingerprint("conversionPreviewFingerprint"),
    conversionSideEffectFingerprint: syntheticFingerprint("conversionSideEffectFingerprint"),
    conversionStatus: "completed",
    dealResumeBindingDigest: resumeBindingDigest({
      environment: "development",
      moduleApiName: "Deals",
      recordId: SYNTHETIC_DEAL_ID,
    }, PEPPER),
    form1Status: "reconciled",
    form2Status: "reconciled",
    qualificationStatus: "qualified",
    revision: 14,
    state: "number_reservation_status",
  });
  const input = {
    actionId: "refresh_number_status",
    expectedRevision: 14,
    qualification: null,
    sessionToken,
  };
  const committed = await harness.service.transitionSession(input, operator());
  assert.equal("forwarding_instructions", committed.state);
  assert.equal(1, harness.store.transitionInputs.length);
  assert.equal(1, serverReads);

  const replayed = await harness.service.transitionSession(input, operator());
  assert.deepEqual(replayed, committed);
  assert.equal(1, harness.store.transitionInputs.length);
  assert.equal(1, serverReads);

  harness.store.rows[0].configVersionFingerprint = null;
  await assert.rejects(
    () => harness.service.transitionSession(input, operator()),
    /Stored journey is invalid/,
  );
  assert.equal(1, harness.store.transitionInputs.length);
  assert.equal(15, harness.store.rows[0].revision);
});

test("non-conversion authoritative receipts reconcile every guarded step before readiness", async () => {
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
  ]) {
    await step(actionId, qualificationBody);
  }
  await assert.rejects(
    () => step("accept_conversion_preview"),
    (error) => error.publicCode === "server_outcome_required",
  );
  assert.equal(revision, 8);
  assert.equal(harness.store.rows[0].state, "lead_conversion_preview");
  applySyntheticConversionCoordinatorCompletion(harness.store.rows[0]);
  revision = harness.store.rows[0].revision;
  for (const [actionId, qualificationBody] of [
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
  assert.equal(20, revision);
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

test("generic prerequisite resolution cannot run or alter coordinated conversion evidence", async () => {
  let resolverCalls = 0;
  const resolver = async (input) => {
    resolverCalls += 1;
    return syntheticServerPrerequisiteResolver(input);
  };
  const harness = createHarness(MemoryStore, { serverPrerequisiteResolver: resolver });
  const { sessionToken } = await issueAndExchange(harness);
  const previewFingerprint = syntheticFingerprint("conversionPreviewFingerprint");
  Object.assign(harness.store.rows[0], {
    conversionPreviewFingerprint: previewFingerprint,
    conversionStatus: "preview_ready",
    form1Status: "reconciled",
    qualificationStatus: "qualified",
    revision: 9,
    state: "lead_conversion_confirmation",
  });
  await assert.rejects(() => harness.service.transitionSession({
    actionId: "confirm_conversion_intent",
    expectedRevision: 9,
    qualification: null,
    sessionToken,
  }, operator()), (error) => error.publicCode === "server_outcome_required");
  assert.equal(resolverCalls, 0);
  assert.equal("lead_conversion_confirmation", harness.store.rows[0].state);
  assert.equal("preview_ready", harness.store.rows[0].conversionStatus);
  assert.equal(previewFingerprint, harness.store.rows[0].conversionPreviewFingerprint);
  assert.equal(9, harness.store.rows[0].revision);
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
    navigationIntent: null,
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

test("qualification replay cannot confuse not-ready with disqualified evidence", async () => {
  let serverReads = 0;
  const harness = createHarness(MemoryStore, {
    serverPrerequisiteResolver: async (input) => {
      serverReads += 1;
      return syntheticServerPrerequisiteResolver(input);
    },
  });
  const { sessionToken } = await issueAndExchange(harness);
  Object.assign(harness.store.rows[0], {
    form1Status: "reconciled",
    revision: 7,
    state: "operator_qualification_review",
  });
  const input = {
    actionId: "qualification_not_ready",
    expectedRevision: 7,
    qualification: qualification("not_ready_save_and_follow_up", {
      canAcceptAdditionalProfitableWork: false,
    }),
    sessionToken,
  };
  const committed = await harness.service.transitionSession(input, operator());
  assert.deepEqual(committed, {
    authoritative: true,
    conversionAuthorized: false,
    navigationIntent: null,
    qualificationStatus: "not_ready",
    revision: 8,
    state: "recoverable_blocked",
  });
  assert.equal(
    "server_outcome:qualification_not_ready:qualification_not_ready",
    harness.store.rows[0].lastOutcome,
  );
  assert.equal(1, harness.store.transitionInputs.length);
  assert.equal(1, serverReads);

  const replayed = await harness.service.transitionSession(input, operator());
  assert.deepEqual(replayed, committed);
  assert.equal(1, harness.store.transitionInputs.length);
  assert.equal(1, serverReads);

  await assert.rejects(() => harness.service.transitionSession({
    ...input,
    actionId: "qualification_disqualified",
    qualification: qualification("disqualified"),
  }, operator()), (error) => error.publicCode === "stale_revision");
  await assert.rejects(() => harness.service.transitionSession({
    ...input,
    qualification: qualification("disqualified"),
  }, operator()), /Qualification action and decision do not match/);

  harness.store.rows[0].qualificationStatus = "disqualified";
  await assert.rejects(
    () => harness.service.transitionSession(input, operator()),
    (error) => error.publicCode === "stale_revision",
  );
  assert.equal(1, harness.store.transitionInputs.length);
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
