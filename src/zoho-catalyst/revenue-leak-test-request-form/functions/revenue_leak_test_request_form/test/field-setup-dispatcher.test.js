"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRequestListener } = require("../lib/catalyst-adapter");
const {
  createDefaultDeniedFieldSetupComposition,
  createInjectedFieldSetupComposition,
} = require("../lib/field-setup-composition");
const { FIELD_SETUP_STATES } = require("../lib/field-setup-contract");
const {
  SESSION_COOKIE_NAME,
  createFieldSetupDispatcher,
  csrfToken,
} = require("../lib/field-setup-dispatcher");
const { JOURNEY_TABLE } = require("../lib/field-setup-launch");
const {
  LAUNCH_STORE_METHODS,
  createDefaultDeniedFieldSetupStoreComposition,
  createInjectedFieldSetupStoreComposition,
} = require("../lib/field-setup-store");
const { REVISION, environment } = require("./helpers");

const ORIGIN = "https://field-setup.example.invalid";
const ROUTES = Object.freeze({
  launchPath: "/synthetic-field-setup/launch",
  exchangePath: "/synthetic-field-setup/exchange",
  statusPath: "/synthetic-field-setup/status",
  decisionPath: "/synthetic-field-setup/decision",
});
const CSRF_HEADER = "x-sylvara-field-setup-csrf";
const CSRF_PEPPER = "c".repeat(48);
const DIGEST_PEPPER = "d".repeat(48);
const NONCE = "n".repeat(43);
const SESSION_TOKEN = "s".repeat(43);
const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}; Path=/; Max-Age=900; Secure; HttpOnly; SameSite=Strict`;
const AUTHENTICATED_OPERATOR = Object.freeze({
  authenticated: true,
  environment: "development",
  operatorUserId: "123456789012345",
  role: "field_setup_operator",
});

function dispatcherConfig(overrides = {}) {
  return {
    bodyTimeoutMs: 1000,
    csrfHeaderName: CSRF_HEADER,
    csrfPepper: CSRF_PEPPER,
    deploymentAuthorized: false,
    environment: "development",
    maxBodyBytes: 4096,
    routes: { ...ROUTES },
    runtimeAuthority: false,
    status: "NOT_READY",
    webClientOrigin: ORIGIN,
    ...overrides,
  };
}

function launchConfig() {
  return {
    digestPepper: DIGEST_PEPPER,
    environment: "development",
    launchTtlSeconds: 60,
    sessionAbsoluteTtlSeconds: 900,
    sessionIdleTtlSeconds: 300,
    tableName: JOURNEY_TABLE,
    webClientOrigin: ORIGIN,
  };
}

function post(path, body, headers = {}) {
  const rawBody = Buffer.from(JSON.stringify(body), "utf8");
  return {
    method: "POST",
    url: path,
    rawBody,
    headers: {
      "content-encoding": "identity",
      "content-length": String(rawBody.length),
      "content-type": "application/json",
      ...headers,
    },
  };
}

function browserHeaders(overrides = {}) {
  return {
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    ...overrides,
  };
}

function sessionHeaders(overrides = {}) {
  return browserHeaders({
    cookie: SESSION_COOKIE.split(";", 1)[0],
    [CSRF_HEADER]: csrfToken(SESSION_TOKEN, CSRF_PEPPER),
    ...overrides,
  });
}

function get(path, headers = {}) {
  return { method: "GET", url: path, headers, rawBody: Buffer.alloc(0) };
}

function createResponse() {
  return {
    headers: Object.create(null),
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    send(value) { this.payload = value; },
  };
}

function fakeCatalystSdk() {
  const app = {
    config: { environment: "development" },
    connections() { throw new Error("Connection access was not expected"); },
    datastore() { throw new Error("Data Store access was not expected"); },
    zcql() { throw new Error("ZCQL access was not expected"); },
  };
  return {
    app,
    sdk: {
      initialize(request) {
        assert.equal(request.headers["x-zc-environment"], "development");
        return app;
      },
    },
  };
}

function fakeLaunchStore() {
  return {
    async issueLaunch(value) { return value; },
    async consumeLaunch(value) { return value; },
    async readBySessionDigest(value) { return value; },
    async compareAndSetJourney(value) { return value; },
  };
}

function createDispatcherHarness() {
  const operatorCalls = [];
  const serviceCalls = [];
  let journey = {
    state: "ready_for_approval",
    revision: 7,
    recordId: "987654321098765",
    operatorUserId: AUTHENTICATED_OPERATOR.operatorUserId,
    internalNote: "must-never-leave-the-server",
  };
  const launchService = {
    async issueLaunch(input) {
      serviceCalls.push({ method: "issueLaunch", input });
      return {
        ok: true,
        launchUrl: `${ORIGIN}/field-setup/#launch=${NONCE}`,
        expiresAt: "2026-08-25T12:01:00.000Z",
        internalRecordId: input.recordId,
      };
    },
    async exchangeLaunch(input, operator) {
      serviceCalls.push({ method: "exchangeLaunch", input, operator });
      return {
        ok: true,
        setCookie: SESSION_COOKIE,
        publicJourney: {
          state: "company_progress_summary",
          revision: 2,
          progress: FIELD_SETUP_STATES.indexOf("company_progress_summary") + 1,
          totalSteps: FIELD_SETUP_STATES.length,
          recordId: "must-not-be-returned",
          operatorUserId: "must-not-be-returned",
        },
      };
    },
    async authenticateSession(sessionToken, operator) {
      serviceCalls.push({ method: "authenticateSession", sessionToken, operator });
      return { ...journey };
    },
    async transitionSession() {
      throw new Error("The source-only dispatcher must never mutate journey state");
    },
  };
  const dispatcher = createFieldSetupDispatcher({
    config: dispatcherConfig(),
    launchService,
    async authenticatedOperatorResolver(input) {
      operatorCalls.push(input);
      assert.equal(Object.hasOwn(input.request, "rawBody"), false);
      assert.equal(Object.hasOwn(input.request, "body"), false);
      return AUTHENTICATED_OPERATOR;
    },
  });
  return {
    dispatcher,
    operatorCalls,
    serviceCalls,
    setJourney(next) { journey = { ...next }; },
  };
}

async function rejectsWith(promise, { status, publicCode }) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status);
    assert.equal(error.publicCode, publicCode);
    return true;
  });
}

test("default composition registers no field-setup route or store", async () => {
  const composition = createDefaultDeniedFieldSetupComposition();
  const stores = createDefaultDeniedFieldSetupStoreComposition();
  assert.equal(composition.status, "NOT_READY");
  assert.equal(composition.catalystHeaderMapping, "NOT_READY_INJECTED_ONLY");
  assert.equal(composition.catalystIdentityMapping, "NOT_READY_INJECTED_ONLY");
  assert.equal(composition.catalystStoreMapping, "NOT_READY_INJECTED_ONLY");
  assert.equal(composition.deploymentAuthorized, false);
  assert.equal(composition.runtimeAuthority, false);
  assert.equal(composition.claimsRequest(post(ROUTES.launchPath, {})), false);
  assert.equal(composition.claimsRequest(get(ROUTES.statusPath)), false);
  assert.equal(stores.launchStore, null);
  assert.equal(stores.conversionStore, null);
  await rejectsWith(composition.dispatch(), { status: 404, publicCode: "route_not_found" });
});

test("injected store composition exposes only the reviewed service methods", async () => {
  const calls = [];
  const adapter = {
    async issueLaunch(value) { calls.push(["issueLaunch", value, this === adapter]); },
    async consumeLaunch(value) { calls.push(["consumeLaunch", value, this === adapter]); },
    async readBySessionDigest(value) {
      calls.push(["readBySessionDigest", value, this === adapter]);
    },
    async compareAndSetJourney(value) {
      calls.push(["compareAndSetJourney", value, this === adapter]);
    },
    async unreviewedDeleteAll() { throw new Error("must not be exposed"); },
  };
  const stores = createInjectedFieldSetupStoreComposition({ launchStore: adapter });
  assert.deepEqual(Object.keys(stores.launchStore), [...LAUNCH_STORE_METHODS]);
  assert.equal(stores.conversionStore, null);
  assert.equal(stores.launchStore.unreviewedDeleteAll, undefined);
  for (const method of LAUNCH_STORE_METHODS) await stores.launchStore[method](method);
  assert.deepEqual(
    calls,
    LAUNCH_STORE_METHODS.map((method) => [method, method, true]),
  );
  assert.throws(
    () => createInjectedFieldSetupStoreComposition({ launchStore: { ...adapter, compareAndSetJourney: null } }),
    /missing compareAndSetJourney/,
  );
});

test("injected composition remains source-only and depends on explicit mappings", () => {
  const composition = createInjectedFieldSetupComposition({
    authenticatedOperatorResolver: async () => AUTHENTICATED_OPERATOR,
    dispatcherConfig: dispatcherConfig(),
    launchConfig: launchConfig(),
    launchStore: fakeLaunchStore(),
  });
  assert.equal(composition.status, "NOT_READY");
  assert.equal(composition.catalystHeaderMapping, "NOT_READY_INJECTED_ONLY");
  assert.equal(composition.catalystIdentityMapping, "NOT_READY_INJECTED_ONLY");
  assert.equal(composition.catalystStoreMapping, "NOT_READY_INJECTED_ONLY");
  assert.equal(composition.deploymentAuthorized, false);
  assert.equal(composition.runtimeAuthority, false);
  assert.equal(composition.claimsRequest(post(ROUTES.launchPath, {})), true);
  assert.throws(
    () => createInjectedFieldSetupComposition({
      authenticatedOperatorResolver: async () => AUTHENTICATED_OPERATOR,
      dispatcherConfig: dispatcherConfig(),
      launchConfig: launchConfig(),
      launchStore: {},
    }),
    /missing issueLaunch/,
  );
});

test("existing issue and prefill routes retain their listener path and response contract", async () => {
  const calls = [];
  const { sdk } = fakeCatalystSdk();
  const listener = createRequestListener({
    artifactSourceRevision: REVISION,
    catalystSdk: sdk,
    environment: environment(),
    logger: { info() {}, error() {} },
    now: () => 100,
    randomUUID: () => "10000000-0000-4000-8000-000000000001",
    async requestHandler(request, dependencies) {
      calls.push({ request, config: dependencies.config });
      const issue = request.url === environment().ISSUE_PATH;
      return {
        status: issue ? 201 : 200,
        body: { ok: true, legacyRoute: issue ? "issue" : "prefill" },
        stage: issue ? "issue" : "prefill",
        outcome: issue ? "issued" : "prefilled",
      };
    },
  });

  for (const path of [environment().ISSUE_PATH, environment().PREFILL_PATH]) {
    const request = post(path, { synthetic: true }, { "x-zc-environment": "development" });
    const response = createResponse();
    await listener(request, response);
    const issue = path === environment().ISSUE_PATH;
    assert.equal(response.statusCode, issue ? 201 : 200);
    assert.deepEqual(JSON.parse(response.payload), {
      ok: true,
      legacyRoute: issue ? "issue" : "prefill",
    });
    assert.equal(Object.hasOwn(response.headers, "set-cookie"), false);
    assert.equal(calls.at(-1).request, request);
    assert.equal(calls.at(-1).config.issuePath, environment().ISSUE_PATH);
    assert.equal(calls.at(-1).config.prefillPath, environment().PREFILL_PATH);
  }
  assert.equal(calls.length, 2);
});

test("default listener leaves proposed field-setup paths unreachable", async () => {
  const { sdk } = fakeCatalystSdk();
  const listener = createRequestListener({
    artifactSourceRevision: REVISION,
    catalystSdk: sdk,
    environment: environment(),
    logger: { info() {}, error() {} },
    now: () => 100,
    randomUUID: () => "10000000-0000-4000-8000-000000000002",
  });
  const response = createResponse();
  await listener(
    post(ROUTES.launchPath, { schemaVersion: 1 }, { "x-zc-environment": "development" }),
    response,
  );
  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.payload), {
    ok: false,
    code: "route_not_found",
    requestId: "10000000-0000-4000-8000-000000000002",
  });
  assert.equal(Object.hasOwn(response.headers, "set-cookie"), false);
});

test("configuration and route collisions fail closed", () => {
  const harness = createDispatcherHarness();
  assert.throws(
    () => createFieldSetupDispatcher({
      authenticatedOperatorResolver: async () => AUTHENTICATED_OPERATOR,
      config: { ...dispatcherConfig(), unexpected: true },
      launchService: {},
    }),
    (error) => error.status === 503 && error.publicCode === "configuration_invalid",
  );
  assert.throws(
    () => harness.dispatcher.assertNoRouteCollision([environment().ISSUE_PATH, ROUTES.launchPath]),
    (error) => error.status === 503 && error.publicCode === "configuration_invalid",
  );
  assert.throws(
    () => createRequestListener({
      fieldSetupComposition: {
        ...createDefaultDeniedFieldSetupComposition(),
        runtimeAuthority: true,
      },
    }),
    /Field-setup composition is invalid/,
  );
});

test("launch rejects every body-supplied identity field before authentication", async (t) => {
  for (const [key, value] of [
    ["operatorUserId", "999999999999999"],
    ["authenticated", true],
    ["role", "field_setup_operator"],
    ["environment", "development"],
  ]) {
    await t.test(key, async () => {
      const harness = createDispatcherHarness();
      await rejectsWith(
        harness.dispatcher.dispatch(post(ROUTES.launchPath, {
          schemaVersion: 1,
          moduleApiName: "Leads",
          recordId: "987654321098765",
          [key]: value,
        })),
        { status: 422, publicCode: "request_invalid" },
      );
      assert.equal(harness.operatorCalls.length, 0);
      assert.equal(harness.serviceCalls.length, 0);
    });
  }
});

test("launch receives identity only from the injected resolver and sanitizes output", async () => {
  const harness = createDispatcherHarness();
  const result = await harness.dispatcher.dispatch(post(ROUTES.launchPath, {
    schemaVersion: 1,
    moduleApiName: "Leads",
    recordId: "987654321098765",
  }), { app: { synthetic: true } });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {
    ok: true,
    launchUrl: `${ORIGIN}/field-setup/#launch=${NONCE}`,
    expiresAt: "2026-08-25T12:01:00.000Z",
  });
  assert.deepEqual(harness.serviceCalls[0], {
    method: "issueLaunch",
    input: {
      environment: "development",
      moduleApiName: "Leads",
      operatorUserId: AUTHENTICATED_OPERATOR.operatorUserId,
      recordId: "987654321098765",
    },
  });
  assert.equal(harness.operatorCalls[0].routeId, "FIELD_SETUP_LAUNCH");
  assert.deepEqual(harness.operatorCalls[0].app, { synthetic: true });
});

test("exchange requires same origin, authenticates independently, and strips private fields", async () => {
  const blocked = createDispatcherHarness();
  await rejectsWith(
    blocked.dispatcher.dispatch(post(ROUTES.exchangePath, { nonce: NONCE })),
    { status: 403, publicCode: "authentication_failed" },
  );
  assert.equal(blocked.operatorCalls.length, 0);
  assert.equal(blocked.serviceCalls.length, 0);

  const harness = createDispatcherHarness();
  const result = await harness.dispatcher.dispatch(post(
    ROUTES.exchangePath,
    { nonce: NONCE },
    browserHeaders(),
  ));
  assert.equal(result.status, 200);
  assert.equal(result.setCookie, SESSION_COOKIE);
  assert.deepEqual(result.body, {
    ok: true,
    csrfToken: csrfToken(SESSION_TOKEN, CSRF_PEPPER),
    journey: {
      state: "company_progress_summary",
      progress: FIELD_SETUP_STATES.indexOf("company_progress_summary") + 1,
      totalSteps: FIELD_SETUP_STATES.length,
      revision: 2,
    },
  });
  assert.equal(JSON.stringify(result.body).includes("recordId"), false);
  assert.equal(JSON.stringify(result.body).includes("operatorUserId"), false);
  assert.equal(JSON.stringify(result.body).includes(SESSION_TOKEN), false);
});

test("status requires exact origin, bound cookie, CSRF, and authenticated operator", async () => {
  for (const [headers, expected] of [
    [sessionHeaders({ origin: "https://attacker.example.invalid" }), {
      status: 403,
      publicCode: "authentication_failed",
    }],
    [browserHeaders({ [CSRF_HEADER]: csrfToken(SESSION_TOKEN, CSRF_PEPPER) }), {
      status: 404,
      publicCode: "session_not_found",
    }],
    [sessionHeaders({ [CSRF_HEADER]: "x".repeat(43) }), {
      status: 403,
      publicCode: "authentication_failed",
    }],
    [sessionHeaders({ cookie: `${SESSION_COOKIE.split(";", 1)[0]}; ${SESSION_COOKIE.split(";", 1)[0]}` }), {
      status: 404,
      publicCode: "session_not_found",
    }],
  ]) {
    const harness = createDispatcherHarness();
    await rejectsWith(
      harness.dispatcher.dispatch(get(ROUTES.statusPath, headers)),
      expected,
    );
    assert.equal(harness.serviceCalls.length, 0);
  }

  const harness = createDispatcherHarness();
  const result = await harness.dispatcher.dispatch(get(ROUTES.statusPath, sessionHeaders()));
  assert.deepEqual(result.body, {
    ok: true,
    journey: {
      state: "ready_for_approval",
      progress: FIELD_SETUP_STATES.indexOf("ready_for_approval") + 1,
      totalSteps: FIELD_SETUP_STATES.length,
      revision: 7,
    },
  });
  assert.equal(JSON.stringify(result.body).includes("recordId"), false);
  assert.equal(JSON.stringify(result.body).includes("internalNote"), false);
  assert.equal(harness.operatorCalls[0].routeId, "FIELD_SETUP_STATUS");
});

test("decision route is read-only, revision-bound, and cannot activate or stop", async () => {
  const harness = createDispatcherHarness();
  const refreshed = await harness.dispatcher.dispatch(post(
    ROUTES.decisionPath,
    { action: "refresh_approval_readiness", revision: 7 },
    sessionHeaders(),
  ));
  assert.equal(refreshed.outcome, "status_refreshed");
  assert.equal(
    harness.serviceCalls.filter((call) => call.method === "authenticateSession").length,
    1,
  );

  await rejectsWith(
    harness.dispatcher.dispatch(post(
      ROUTES.decisionPath,
      { action: "activate", revision: 7 },
      sessionHeaders(),
    )),
    { status: 401, publicCode: "authentication_failed" },
  );
  await rejectsWith(
    harness.dispatcher.dispatch(post(
      ROUTES.decisionPath,
      { action: "refresh_approval_readiness", revision: 6 },
      sessionHeaders(),
    )),
    { status: 409, publicCode: "context_conflict" },
  );

  harness.setJourney({ state: "stop_rollback_status", revision: 8 });
  await rejectsWith(
    harness.dispatcher.dispatch(post(
      ROUTES.decisionPath,
      { action: "stop_setup", revision: 8 },
      sessionHeaders(),
    )),
    { status: 404, publicCode: "route_not_found" },
  );
  assert.equal(
    harness.serviceCalls.some((call) => call.method === "transitionSession"),
    false,
  );
});
