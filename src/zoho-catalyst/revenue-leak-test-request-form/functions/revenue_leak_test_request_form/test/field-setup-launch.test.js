"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  FIELD_SETUP_STATES,
  PROHIBITED_BROWSER_ACTIONS,
  QUALIFICATION_FACTORS,
  assertBrowserAction,
  authorizeQualification,
} = require("../lib/field-setup-contract");
const {
  JOURNEY_TABLE,
  createFieldSetupLaunchService,
  digestToken,
} = require("../lib/field-setup-launch");

const BASE_TIME = Date.parse("2026-08-25T12:00:00.000Z");
const PEPPER = "synthetic-field-setup-pepper-00000000000000000000000000000000";

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

class MemoryStore {
  constructor(now) {
    this.now = now;
    this.rows = [];
  }

  async issueLaunch(row) {
    assert.equal(undefined, row.nonce);
    assert.match(row.launchDigest, /^[a-f0-9]{64}$/);
    this.rows.push({ ...row });
    return { ...row };
  }

  async consumeLaunch(input) {
    const row = this.rows.find((candidate) => candidate.launchDigest === input.launchDigest);
    if (
      !row ||
      row.launchConsumedAt ||
      Date.parse(row.launchExpiresAt) <= this.now() ||
      row.operatorUserId !== input.operatorUserId ||
      row.environment !== input.environment
    ) {
      const error = new Error("not found");
      error.publicCode = "field_setup_not_found";
      throw error;
    }
    Object.assign(row, {
      idleExpiresAt: input.idleExpiresAt,
      launchConsumedAt: input.exchangedAt,
      lastOutcome: "launch_exchanged",
      revision: row.revision + 1,
      sessionDigest: input.sessionDigest,
      state: "company_progress_summary",
    });
    return { ...row };
  }

  async readBySessionDigest(digest) {
    return { ...this.rows.find((row) => row.sessionDigest === digest) };
  }
}

function deterministicEntropy() {
  let counter = 0;
  return (size) => {
    counter += 1;
    return crypto.createHash("sha256").update(`synthetic-${counter}`).digest().subarray(0, size);
  };
}

function createHarness() {
  let current = BASE_TIME;
  const now = () => current;
  const store = new MemoryStore(now);
  let uuidCounter = 0;
  const service = createFieldSetupLaunchService({
    config: config(),
    now,
    randomBytes: deterministicEntropy(),
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
    store,
  });
  return { advance: (milliseconds) => { current += milliseconds; }, service, store };
}

test("contract exposes exactly the 22 approved journey screens", () => {
  assert.equal(22, FIELD_SETUP_STATES.length);
  assert.equal(22, new Set(FIELD_SETUP_STATES).size);
  assert.equal("ready_for_approval", FIELD_SETUP_STATES[18]);
  assert.ok(!FIELD_SETUP_STATES.includes("activate_test"));
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
  assert.ok(!first.launchUrl.includes(context().recordId));
  assert.ok(!first.launchUrl.includes(context().operatorUserId));
  assert.equal(undefined, store.rows[0].nonce);
  assert.match(store.rows[0].launchDigest, /^[a-f0-9]{64}$/);
});

test("exchange issues a Secure HttpOnly SameSite cookie and rejects replay", async () => {
  const { service } = createHarness();
  const launch = await service.issueLaunch(context());
  const nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  const exchanged = await service.exchangeLaunch({ nonce }, operator());
  assert.match(
    exchanged.setCookie,
    /^__Host-sylvara_field_setup=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=900; Secure; HttpOnly; SameSite=Strict$/,
  );
  assert.deepEqual(exchanged.publicJourney, {
    state: "company_progress_summary",
    progress: 1,
    totalSteps: 22,
  });
  await assert.rejects(() => service.exchangeLaunch({ nonce }, operator()), /not found/);
});

test("expired, cross-user, cross-environment, and cross-record launches fail closed", async () => {
  const expired = createHarness();
  let launch = await expired.service.issueLaunch(context());
  expired.advance(60_000);
  let nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  await assert.rejects(() => expired.service.exchangeLaunch({ nonce }, operator()), /not found/);

  const user = createHarness();
  launch = await user.service.issueLaunch(context());
  nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  await assert.rejects(
    () => user.service.exchangeLaunch({ nonce }, operator("223456789012345")),
    /not found/,
  );

  const environment = createHarness();
  launch = await environment.service.issueLaunch(context());
  nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  await assert.rejects(
    () => environment.service.exchangeLaunch(
      { nonce },
      { ...operator(), environment: "production" },
    ),
    /field-setup operator is required/,
  );

  await assert.rejects(
    () => createHarness().service.issueLaunch(context({ recordId: "other-record" })),
    /Record is invalid/,
  );
});

test("session authentication is bound and expires at idle or absolute TTL", async () => {
  const harness = createHarness();
  const launch = await harness.service.issueLaunch(context());
  const nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  const exchange = await harness.service.exchangeLaunch({ nonce }, operator());
  const sessionToken = exchange.setCookie.match(/=([^;]+);/)[1];
  assert.equal(harness.store.rows[0].sessionDigest, digestToken(sessionToken, PEPPER));
  assert.equal(undefined, harness.store.rows[0].sessionToken);
  await harness.service.authenticateSession(sessionToken, operator());
  await assert.rejects(
    () => harness.service.authenticateSession(sessionToken, operator("223456789012345")),
    /not found/,
  );
  harness.advance(300_000);
  await assert.rejects(() => harness.service.authenticateSession(sessionToken, operator()), /not found/);
});

test("malformed or noncanonical stored expiry values fail closed", async () => {
  for (const [field, value] of [
    ["absoluteExpiresAt", "not-a-timestamp"],
    ["idleExpiresAt", "2026-08-25T12:05:00+00:00"],
    ["idleExpiresAt", ""],
  ]) {
    const harness = createHarness();
    const launch = await harness.service.issueLaunch(context());
    const nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
    const exchange = await harness.service.exchangeLaunch({ nonce }, operator());
    const sessionToken = exchange.setCookie.match(/=([^;]+);/)[1];
    harness.store.rows[0][field] = value;
    await assert.rejects(
      () => harness.service.authenticateSession(sessionToken, operator()),
      /not found/,
    );
  }

  const inverted = createHarness();
  const launch = await inverted.service.issueLaunch(context());
  const nonce = new URL(launch.launchUrl).hash.slice("#launch=".length);
  const exchange = await inverted.service.exchangeLaunch({ nonce }, operator());
  const sessionToken = exchange.setCookie.match(/=([^;]+);/)[1];
  inverted.store.rows[0].idleExpiresAt = "2026-08-25T12:16:00.000Z";
  await assert.rejects(
    () => inverted.service.authenticateSession(sessionToken, operator()),
    /not found/,
  );
});

test("qualification is an authenticated operator decision and never authorizes conversion", () => {
  const journey = context();
  const body = Object.fromEntries(QUALIFICATION_FACTORS.map((factor) => [factor, true]));
  body.decision = "qualified_continue_setup";
  const result = authorizeQualification(journey, body, operator());
  assert.equal("lead_conversion_preview", result.nextState);
  assert.equal(false, result.conversionAuthorized);
  assert.throws(() => authorizeQualification(journey, body, { ...operator(), authenticated: false }));
  assert.throws(() => authorizeQualification(journey, { ...body, decision: "invalid" }, operator()));
  assert.throws(() => authorizeQualification(journey, { ...body, decision: "qualified_continue_setup", decisionMakerIsPresent: false }, operator()));
});

test("browser action allowlist excludes qualification, conversion, and activation", () => {
  assert.equal("refresh_status", assertBrowserAction("refresh_status"));
  for (const action of PROHIBITED_BROWSER_ACTIONS) {
    assert.throws(() => assertBrowserAction(action), /browser cannot perform/);
  }
});
