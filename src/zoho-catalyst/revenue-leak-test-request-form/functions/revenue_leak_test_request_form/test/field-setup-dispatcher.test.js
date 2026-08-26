"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { isDeepStrictEqual } = require("node:util");
const { createRequestListener } = require("../lib/catalyst-adapter");
const {
  createDefaultDeniedFieldSetupComposition,
  createInjectedFieldSetupComposition,
} = require("../lib/field-setup-composition");
const {
  FIELD_SETUP_PROTOCOL,
  FIELD_SETUP_STATES,
  FieldSetupContractError,
  QUALIFICATION_FACTORS,
  resolveTransition,
} = require("../lib/field-setup-contract");
const {
  MANDATORY_DEAL_FIELDS,
  createFieldSetupConversionService,
} = require("../lib/field-setup-conversion");
const {
  PROTOCOL_ID_HEADER,
  PROTOCOL_VERSION_HEADER,
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
  conversionPreviewPath: "/synthetic-field-setup/conversion-preview",
  conversionConfirmPath: "/synthetic-field-setup/conversion-confirm",
});
const CSRF_HEADER = "x-sylvara-field-setup-csrf";
const CSRF_PEPPER = "c".repeat(48);
const DIGEST_PEPPER = "d".repeat(48);
const NONCE = "n".repeat(43);
const SESSION_TOKEN = "s".repeat(43);
const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}; Path=/; Max-Age=900; Secure; HttpOnly; SameSite=Strict`;
const FORM1_NAVIGATION_INTENT = Object.freeze({
  mode: "top_level",
  target: "form1",
  url: "https://forms.zohopublic.com/synthetic/free-test-request?token=opaque-test-token",
});
const AUTHENTICATED_OPERATOR = Object.freeze({
  authenticated: true,
  environment: "development",
  operatorUserId: "123456789012345",
  role: "field_setup_operator",
});
const FORM_NAVIGATION_DESTINATIONS = Object.freeze({
  form1: "https://forms.zohopublic.com/synthetic/free-test-request",
  form2: "https://forms.zohopublic.com/synthetic/free-test-authorization",
});
const CONTROLLED_CONVERSION_DEFAULTS = Object.freeze({
  closingDate: "2026-09-01",
  pipeline: "Revenue Desk Sales",
  stage: "Setup and Authorization",
  type: "Initial Sale",
});
const CONVERSION_PREVIEW_FINGERPRINT = "a".repeat(64);
const CONVERSION_SIDE_EFFECT_FINGERPRINT = "b".repeat(64);
const CONVERSION_OUTCOME_FINGERPRINT = "c".repeat(64);
const DEAL_RESUME_BINDING_DIGEST = "e".repeat(64);
const SANITIZED_CONVERSION_PREVIEW = Object.freeze({
  account: Object.freeze({
    action: "create_from_conversion_mapping",
    displayName: "ZZZ SYNTHETIC Plumbing",
  }),
  contact: Object.freeze({
    action: "create_from_conversion_mapping",
    displayName: "ZZZ SYNTHETIC Contact",
  }),
  deal: Object.freeze({
    closingDate: CONTROLLED_CONVERSION_DEFAULTS.closingDate,
    dealName: "ZZZ SYNTHETIC Plumbing — Free Revenue Leak Test",
    mandatoryDealFields: Object.freeze([
      "Deal_Name",
      "Account_Name",
      "Closing_Date",
      "Pipeline",
      "Stage",
      "Type",
    ]),
    pipeline: CONTROLLED_CONVERSION_DEFAULTS.pipeline,
    stage: CONTROLLED_CONVERSION_DEFAULTS.stage,
    type: CONTROLLED_CONVERSION_DEFAULTS.type,
  }),
  noEmailOrRoutingEffect: true,
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
    formNavigationDestinations: FORM_NAVIGATION_DESTINATIONS,
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
    [PROTOCOL_ID_HEADER]: FIELD_SETUP_PROTOCOL.protocolId,
    [PROTOCOL_VERSION_HEADER]: String(FIELD_SETUP_PROTOCOL.schemaVersion),
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
    async issueOrResumeLaunch(value) { return value; },
    async readByLaunchDigest(value) { return value; },
    async consumeLaunch(value) { return value; },
    async readBySessionDigest(value) { return value; },
    async compareAndSetJourney(value) { return value; },
    async claimConversion(value) { return value; },
    async completeConversion(value) { return value; },
    async createPreview(value) { return value; },
    async markReconciliationRequired(value) { return value; },
    async markWriteStarted(value) { return value; },
  };
}

function fakeConversionCrm() {
  return Object.fromEntries([
    "convertLead",
    "findConversionCandidates",
    "getConversionOptions",
    "getDealFieldMetadata",
    "getLead",
    "readConversionResult",
  ].map((method) => [method, async () => { throw new Error(`${method} was not expected`); }]));
}

function qualification(decision, overrides = {}) {
  return {
    ...Object.fromEntries(QUALIFICATION_FACTORS.map((factor) => [factor, true])),
    decision,
    ...overrides,
  };
}

function createDispatcherHarness() {
  const operatorCalls = [];
  const serviceCalls = [];
  const conversionCalls = [];
  const dealDigestCalls = [];
  let committedTransition = null;
  let transitionCommits = 0;
  let exchangeJourney = {
    state: "company_progress_summary",
    revision: 2,
  };
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
          ...exchangeJourney,
          progress: FIELD_SETUP_STATES.indexOf(exchangeJourney.state) + 1,
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
    async transitionSession(input, operator) {
      serviceCalls.push({ method: "transitionSession", input, operator });
      if (
        input.expectedRevision === journey.revision - 1 &&
        committedTransition !== null &&
        committedTransition.result.revision === journey.revision &&
        committedTransition.result.state === journey.state &&
        committedTransition.input.actionId === input.actionId &&
        committedTransition.input.expectedRevision === input.expectedRevision &&
        isDeepStrictEqual(committedTransition.input.qualification, input.qualification)
      ) {
        return { ...committedTransition.result };
      }
      if (input.expectedRevision !== journey.revision) {
        throw new FieldSetupContractError("stale revision", "stale_revision");
      }
      const transition = resolveTransition(journey.state, input.actionId);
      journey = {
        ...journey,
        revision: journey.revision + 1,
        state: transition.nextState,
      };
      transitionCommits += 1;
      committedTransition = {
        input: {
          ...input,
          qualification: input.qualification === null
            ? null
            : { ...input.qualification },
        },
        result: {
          authoritative: true,
          conversionAuthorized: false,
          navigationIntent: input.actionId === "open_form1"
            ? FORM1_NAVIGATION_INTENT
            : null,
          revision: journey.revision,
          state: journey.state,
        },
      };
      return { ...committedTransition.result };
    },
  };
  const conversionService = {
    async buildPreview(input, currentJourney, authenticatedOperator, controlledDefaults) {
      conversionCalls.push({
        method: "buildPreview",
        input,
        journey: currentJourney,
        operator: authenticatedOperator,
        controlledDefaults,
      });
      journey = {
        ...journey,
        conversionPreviewFingerprint: CONVERSION_PREVIEW_FINGERPRINT,
        conversionStatus: "preview_ready",
        revision: journey.revision + 1,
        state: "lead_conversion_confirmation",
      };
      return {
        previewFingerprint: CONVERSION_PREVIEW_FINGERPRINT,
        revision: journey.revision,
        sanitizedPreview: SANITIZED_CONVERSION_PREVIEW,
      };
    },
    async readPreview(input, currentJourney, authenticatedOperator, controlledDefaults) {
      conversionCalls.push({
        method: "readPreview",
        input,
        journey: currentJourney,
        operator: authenticatedOperator,
        controlledDefaults,
      });
      return {
        previewFingerprint: currentJourney.conversionPreviewFingerprint,
        revision: currentJourney.revision,
        sanitizedPreview: SANITIZED_CONVERSION_PREVIEW,
      };
    },
    async confirmConversion(
      input,
      currentJourney,
      authenticatedOperator,
      controlledDefaults,
      dealResumeBindingDigest,
    ) {
      conversionCalls.push({
        method: "confirmConversion",
        input,
        journey: currentJourney,
        operator: authenticatedOperator,
        controlledDefaults,
      });
      const dealResumeDigest = dealResumeBindingDigest({
        dealId: "876543210987654",
        environment: currentJourney.environment,
      });
      journey = {
        ...journey,
        conversionOutcomeFingerprint: CONVERSION_OUTCOME_FINGERPRINT,
        conversionSideEffectFingerprint: CONVERSION_SIDE_EFFECT_FINGERPRINT,
        conversionStatus: "completed",
        dealResumeBindingDigest: dealResumeDigest,
        revision: journey.revision + 1,
        state: "handoff_to_client_form2",
      };
      return { ok: true, replay: false, revision: journey.revision };
    },
  };
  const dispatcher = createFieldSetupDispatcher({
    config: dispatcherConfig(),
    controlledConversionDefaults: CONTROLLED_CONVERSION_DEFAULTS,
    conversionService,
    dealResumeBindingDigest(value) {
      dealDigestCalls.push(value);
      return DEAL_RESUME_BINDING_DIGEST;
    },
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
    conversionCalls,
    dealDigestCalls,
    operatorCalls,
    serviceCalls,
    setExchangeJourney(next) { exchangeJourney = { ...next }; },
    setJourney(next) { journey = { ...next }; },
    transitionCommitCount() { return transitionCommits; },
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
    async issueOrResumeLaunch(value) {
      calls.push(["issueOrResumeLaunch", value, this === adapter]);
    },
    async readByLaunchDigest(value) {
      calls.push(["readByLaunchDigest", value, this === adapter]);
    },
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
  const store = fakeLaunchStore();
  const composition = createInjectedFieldSetupComposition({
    authenticatedOperatorResolver: async () => AUTHENTICATED_OPERATOR,
    controlledConversionDefaults: CONTROLLED_CONVERSION_DEFAULTS,
    conversionCrm: fakeConversionCrm(),
    conversionStore: store,
    dispatcherConfig: dispatcherConfig(),
    launchConfig: launchConfig(),
    launchStore: store,
  });
  assert.equal(composition.status, "NOT_READY");
  assert.equal(composition.catalystHeaderMapping, "NOT_READY_INJECTED_ONLY");
  assert.equal(composition.catalystIdentityMapping, "NOT_READY_INJECTED_ONLY");
  assert.equal(composition.catalystStoreMapping, "NOT_READY_INJECTED_ONLY");
  assert.equal(composition.deploymentAuthorized, false);
  assert.equal(composition.runtimeAuthority, false);
  assert.equal(composition.claimsRequest(post(ROUTES.launchPath, {})), true);
  assert.equal(composition.claimsRequest(post(ROUTES.conversionPreviewPath, {})), true);
  assert.equal(composition.claimsRequest(post(ROUTES.conversionConfirmPath, {})), true);
  const missingMethodsStore = {};
  assert.throws(
    () => createInjectedFieldSetupComposition({
      authenticatedOperatorResolver: async () => AUTHENTICATED_OPERATOR,
      controlledConversionDefaults: CONTROLLED_CONVERSION_DEFAULTS,
      conversionCrm: fakeConversionCrm(),
      conversionStore: missingMethodsStore,
      dispatcherConfig: dispatcherConfig(),
      launchConfig: launchConfig(),
      launchStore: missingMethodsStore,
    }),
    /missing issueOrResumeLaunch/,
  );
  const invalidConfigStore = fakeLaunchStore();
  assert.throws(
    () => createInjectedFieldSetupComposition({
      authenticatedOperatorResolver: async () => AUTHENTICATED_OPERATOR,
      controlledConversionDefaults: CONTROLLED_CONVERSION_DEFAULTS,
      conversionCrm: fakeConversionCrm(),
      conversionStore: invalidConfigStore,
      dispatcherConfig: dispatcherConfig(),
      launchConfig: { ...launchConfig(), formNavigationDestinations: undefined },
      launchStore: invalidConfigStore,
    }),
    (error) => error.publicCode === "configuration_invalid",
  );
  assert.throws(
    () => createInjectedFieldSetupComposition({
      authenticatedOperatorResolver: async () => AUTHENTICATED_OPERATOR,
      controlledConversionDefaults: CONTROLLED_CONVERSION_DEFAULTS,
      conversionCrm: fakeConversionCrm(),
      conversionStore: fakeLaunchStore(),
      dispatcherConfig: dispatcherConfig(),
      launchConfig: launchConfig(),
      launchStore: fakeLaunchStore(),
    }),
    /one authoritative journey store/,
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
          protocolId: FIELD_SETUP_PROTOCOL.protocolId,
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
    protocolId: FIELD_SETUP_PROTOCOL.protocolId,
    schemaVersion: 1,
    moduleApiName: "Leads",
    recordId: "987654321098765",
  }), { app: { synthetic: true } });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {
    ok: true,
    launchUrl: `${ORIGIN}/field-setup/#launch=${NONCE}`,
    expiresAt: "2026-08-25T12:01:00.000Z",
    protocolId: FIELD_SETUP_PROTOCOL.protocolId,
    schemaVersion: FIELD_SETUP_PROTOCOL.schemaVersion,
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

test("protocol mismatch fails before identity, nonce consumption, session lookup, or CAS", async (t) => {
  const incompatibleHeaders = browserHeaders({
    [PROTOCOL_ID_HEADER]: `${FIELD_SETUP_PROTOCOL.protocolId}_attacker`,
    [PROTOCOL_VERSION_HEADER]: String(FIELD_SETUP_PROTOCOL.schemaVersion + 1),
  });
  const cases = [
    {
      name: "launch body",
      request: post(ROUTES.launchPath, {
        protocolId: `${FIELD_SETUP_PROTOCOL.protocolId}_attacker`,
        schemaVersion: FIELD_SETUP_PROTOCOL.schemaVersion,
        moduleApiName: "Leads",
        recordId: "987654321098765",
      }),
      expected: { status: 422, publicCode: "request_invalid" },
    },
    {
      name: "exchange headers",
      request: post(ROUTES.exchangePath, { nonce: NONCE }, incompatibleHeaders),
      expected: { status: 409, publicCode: "context_conflict" },
    },
    {
      name: "status headers",
      request: get(ROUTES.statusPath, sessionHeaders({
        [PROTOCOL_VERSION_HEADER]: String(FIELD_SETUP_PROTOCOL.schemaVersion + 1),
      })),
      expected: { status: 409, publicCode: "context_conflict" },
    },
    {
      name: "intent headers",
      request: post(
        ROUTES.decisionPath,
        { action: "refresh_approval_readiness", qualification: null, revision: 7 },
        sessionHeaders({ [PROTOCOL_ID_HEADER]: "wrong_protocol" }),
      ),
      expected: { status: 409, publicCode: "context_conflict" },
    },
  ];

  for (const value of cases) {
    await t.test(value.name, async () => {
      const harness = createDispatcherHarness();
      await rejectsWith(harness.dispatcher.dispatch(value.request), value.expected);
      assert.equal(harness.operatorCalls.length, 0);
      assert.equal(harness.serviceCalls.length, 0);
    });
  }
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
    protocolId: FIELD_SETUP_PROTOCOL.protocolId,
    schemaVersion: FIELD_SETUP_PROTOCOL.schemaVersion,
  });
  assert.equal(JSON.stringify(result.body).includes("recordId"), false);
  assert.equal(JSON.stringify(result.body).includes("operatorUserId"), false);
  assert.equal(JSON.stringify(result.body).includes(SESSION_TOKEN), false);
});

test("exchange returns the authoritative current step for a resumed Lead or Deal journey", async () => {
  const harness = createDispatcherHarness();
  harness.setExchangeJourney({ state: "form2_open_or_resume", revision: 13 });
  const result = await harness.dispatcher.dispatch(post(
    ROUTES.exchangePath,
    { nonce: NONCE },
    browserHeaders(),
  ));
  assert.deepEqual(result.body.journey, {
    state: "form2_open_or_resume",
    progress: FIELD_SETUP_STATES.indexOf("form2_open_or_resume") + 1,
    totalSteps: FIELD_SETUP_STATES.length,
    revision: 13,
  });
});

test("status requires exact origin, bound cookie, CSRF, and authenticated operator", async () => {
  for (const [headers, expected] of [
    [sessionHeaders({ origin: "https://attacker.example.invalid" }), {
      status: 403,
      publicCode: "authentication_failed",
    }],
    [sessionHeaders({ "sec-fetch-site": undefined }), {
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
    protocolId: FIELD_SETUP_PROTOCOL.protocolId,
    schemaVersion: FIELD_SETUP_PROTOCOL.schemaVersion,
  });
  assert.equal(JSON.stringify(result.body).includes("recordId"), false);
  assert.equal(JSON.stringify(result.body).includes("internalNote"), false);
  assert.equal(harness.operatorCalls[0].routeId, "FIELD_SETUP_STATUS");

  const browserGetHarness = createDispatcherHarness();
  const browserGetHeaders = sessionHeaders({ origin: undefined });
  const browserGet = await browserGetHarness.dispatcher.dispatch(
    get(ROUTES.statusPath, browserGetHeaders),
  );
  assert.equal(browserGet.body.journey.state, "ready_for_approval");
});

test("intent route persists protocol transitions, is revision-bound, and cannot activate", async () => {
  const harness = createDispatcherHarness();
  const refreshed = await harness.dispatcher.dispatch(post(
    ROUTES.decisionPath,
    { action: "refresh_approval_readiness", qualification: null, revision: 7 },
    sessionHeaders(),
  ));
  assert.equal(refreshed.outcome, "intent_reconciled");
  assert.deepEqual(refreshed.body, {
    ok: true,
    journey: {
      state: "ready_for_approval",
      progress: FIELD_SETUP_STATES.indexOf("ready_for_approval") + 1,
      totalSteps: FIELD_SETUP_STATES.length,
      revision: 8,
    },
    navigationIntent: null,
    protocolId: FIELD_SETUP_PROTOCOL.protocolId,
    schemaVersion: FIELD_SETUP_PROTOCOL.schemaVersion,
  });
  assert.equal(
    harness.serviceCalls.filter((call) => call.method === "authenticateSession").length,
    1,
  );

  await rejectsWith(
    harness.dispatcher.dispatch(post(
      ROUTES.decisionPath,
      { action: "activate", qualification: null, revision: 8 },
      sessionHeaders(),
    )),
    { status: 401, publicCode: "authentication_failed" },
  );
  await rejectsWith(
    harness.dispatcher.dispatch(post(
      ROUTES.decisionPath,
      { action: "refresh_approval_readiness", qualification: null, revision: 6 },
      sessionHeaders(),
    )),
    { status: 409, publicCode: "context_conflict" },
  );

  harness.setJourney({ state: "company_progress_summary", revision: 2 });
  const advanced = await harness.dispatcher.dispatch(post(
    ROUTES.decisionPath,
    { action: "acknowledge_company_summary", qualification: null, revision: 2 },
    sessionHeaders(),
  ));
  assert.equal(advanced.body.journey.state, "handoff_to_client_form1");
  assert.equal(advanced.body.journey.revision, 3);

  const stopped = await harness.dispatcher.dispatch(post(
    ROUTES.decisionPath,
    { action: "stop_setup", qualification: null, revision: 3 },
    sessionHeaders(),
  ));
  assert.equal(stopped.body.journey.state, "stop_rollback_status");
  assert.equal(stopped.body.journey.revision, 4);
  assert.equal(
    harness.serviceCalls.filter((call) => call.method === "transitionSession").length,
    3,
  );
});

test("intent route replays exactly one committed generic decision without a second transition", async (t) => {
  const cases = [
    {
      action: "refresh_approval_readiness",
      initialJourney: { state: "ready_for_approval", revision: 7 },
      qualification: null,
      expectedNavigation: null,
      expectedState: "ready_for_approval",
      name: "browser-only action",
    },
    {
      action: "qualification_qualified",
      initialJourney: { state: "operator_qualification_review", revision: 10 },
      qualification: qualification("qualified_continue_setup"),
      expectedNavigation: null,
      expectedState: "lead_conversion_preview",
      name: "qualification action",
    },
    {
      action: "open_form1",
      initialJourney: { state: "form1_open_or_resume", revision: 4 },
      qualification: null,
      expectedNavigation: FORM1_NAVIGATION_INTENT,
      expectedState: "form1_completion_confirmation",
      name: "Form navigation action",
    },
  ];

  for (const value of cases) {
    await t.test(value.name, async () => {
      const harness = createDispatcherHarness();
      harness.setJourney(value.initialJourney);
      const requestBody = {
        action: value.action,
        qualification: value.qualification,
        revision: value.initialJourney.revision,
      };

      const committed = await harness.dispatcher.dispatch(post(
        ROUTES.decisionPath,
        requestBody,
        sessionHeaders(),
      ));
      const replayed = await harness.dispatcher.dispatch(post(
        ROUTES.decisionPath,
        requestBody,
        sessionHeaders(),
      ));

      assert.deepEqual(replayed.body, committed.body);
      assert.equal(replayed.body.journey.state, value.expectedState);
      assert.equal(replayed.body.journey.revision, value.initialJourney.revision + 1);
      assert.deepEqual(replayed.body.navigationIntent, value.expectedNavigation);
      assert.equal(harness.transitionCommitCount(), 1);
      const transitionCalls = harness.serviceCalls.filter(
        (call) => call.method === "transitionSession",
      );
      assert.equal(transitionCalls.length, 2);
      for (const call of transitionCalls) {
        assert.deepEqual(call.input, {
          actionId: value.action,
          expectedRevision: value.initialJourney.revision,
          qualification: value.qualification,
          sessionToken: SESSION_TOKEN,
        });
      }

      const transitionCallCountBeforeOldRequest = transitionCalls.length;
      await rejectsWith(harness.dispatcher.dispatch(post(
        ROUTES.decisionPath,
        {
          ...requestBody,
          revision: value.initialJourney.revision - 1,
        },
        sessionHeaders(),
      )), { status: 409, publicCode: "context_conflict" });
      assert.equal(
        harness.serviceCalls.filter((call) => call.method === "transitionSession").length,
        transitionCallCountBeforeOldRequest,
      );
      assert.equal(harness.transitionCommitCount(), 1);
    });
  }
});

test("one-behind generic replay rejects a changed action or qualification without another commit", async () => {
  const formHarness = createDispatcherHarness();
  formHarness.setJourney({ state: "form1_open_or_resume", revision: 4 });
  await formHarness.dispatcher.dispatch(post(
    ROUTES.decisionPath,
    { action: "open_form1", qualification: null, revision: 4 },
    sessionHeaders(),
  ));
  await rejectsWith(formHarness.dispatcher.dispatch(post(
    ROUTES.decisionPath,
    { action: "resume_form1", qualification: null, revision: 4 },
    sessionHeaders(),
  )), { status: 409, publicCode: "context_conflict" });
  assert.equal(formHarness.transitionCommitCount(), 1);

  const qualificationHarness = createDispatcherHarness();
  qualificationHarness.setJourney({ state: "operator_qualification_review", revision: 10 });
  const originalQualification = qualification("qualified_continue_setup");
  await qualificationHarness.dispatcher.dispatch(post(
    ROUTES.decisionPath,
    {
      action: "qualification_qualified",
      qualification: originalQualification,
      revision: 10,
    },
    sessionHeaders(),
  ));
  await rejectsWith(qualificationHarness.dispatcher.dispatch(post(
    ROUTES.decisionPath,
    {
      action: "qualification_qualified",
      qualification: {
        ...originalQualification,
        decisionMakerIsPresent: false,
      },
      revision: 10,
    },
    sessionHeaders(),
  )), { status: 409, publicCode: "context_conflict" });
  assert.equal(qualificationHarness.transitionCommitCount(), 1);
});

test("dedicated conversion routes render the exact preview, confirm once, and replay safely", async () => {
  const harness = createDispatcherHarness();
  harness.setJourney({
    conversionPreviewFingerprint: null,
    conversionStatus: "not_started",
    environment: "development",
    journeyKey: "00000000-0000-4000-8000-000000000001",
    moduleApiName: "Leads",
    operatorUserId: AUTHENTICATED_OPERATOR.operatorUserId,
    qualificationStatus: "qualified",
    recordId: "987654321098765",
    revision: 7,
    sessionDigest: "f".repeat(64),
    state: "lead_conversion_preview",
  });

  const preview = await harness.dispatcher.dispatch(post(
    ROUTES.conversionPreviewPath,
    { revision: 7 },
    sessionHeaders(),
  ));
  assert.equal(preview.outcome, "conversion_preview_reconciled");
  assert.deepEqual(preview.body, {
    ok: true,
    journey: {
      state: "lead_conversion_confirmation",
      progress: FIELD_SETUP_STATES.indexOf("lead_conversion_confirmation") + 1,
      totalSteps: FIELD_SETUP_STATES.length,
      revision: 8,
    },
    preview: SANITIZED_CONVERSION_PREVIEW,
    protocolId: FIELD_SETUP_PROTOCOL.protocolId,
    schemaVersion: FIELD_SETUP_PROTOCOL.schemaVersion,
  });
  assert.deepEqual(harness.conversionCalls[0], {
    method: "buildPreview",
    input: {
      journeyKey: "00000000-0000-4000-8000-000000000001",
      leadId: "987654321098765",
    },
    journey: {
      conversionPreviewFingerprint: null,
      conversionStatus: "not_started",
      environment: "development",
      journeyKey: "00000000-0000-4000-8000-000000000001",
      moduleApiName: "Leads",
      operatorUserId: AUTHENTICATED_OPERATOR.operatorUserId,
      qualificationStatus: "qualified",
      recordId: "987654321098765",
      revision: 7,
      sessionDigest: "f".repeat(64),
      state: "lead_conversion_preview",
    },
    operator: AUTHENTICATED_OPERATOR,
    controlledDefaults: CONTROLLED_CONVERSION_DEFAULTS,
  });

  const committedBuildReplay = await harness.dispatcher.dispatch(post(
    ROUTES.conversionPreviewPath,
    { revision: 7 },
    sessionHeaders(),
  ));
  assert.deepEqual(committedBuildReplay.body.preview, SANITIZED_CONVERSION_PREVIEW);
  assert.equal(committedBuildReplay.body.journey.revision, 8);
  assert.equal(harness.conversionCalls[1].method, "readPreview");
  assert.equal(harness.conversionCalls.filter(({ method }) => method === "buildPreview").length, 1);

  await rejectsWith(harness.dispatcher.dispatch(post(
    ROUTES.conversionPreviewPath,
    { revision: 6 },
    sessionHeaders(),
  )), { status: 409, publicCode: "context_conflict" });

  const reread = await harness.dispatcher.dispatch(post(
    ROUTES.conversionPreviewPath,
    { revision: 8 },
    sessionHeaders(),
  ));
  assert.deepEqual(reread.body.preview, SANITIZED_CONVERSION_PREVIEW);
  assert.equal(reread.body.journey.revision, 8);
  assert.equal(harness.conversionCalls[2].method, "readPreview");

  await rejectsWith(
    harness.dispatcher.dispatch(post(
      ROUTES.decisionPath,
      { action: "confirm_conversion_intent", qualification: null, revision: 8 },
      sessionHeaders(),
    )),
    { status: 409, publicCode: "context_conflict" },
  );
  assert.equal(
    harness.serviceCalls.filter((call) => call.method === "transitionSession").length,
    0,
  );

  const confirmed = await harness.dispatcher.dispatch(post(
    ROUTES.conversionConfirmPath,
    { confirm: true, revision: 8 },
    sessionHeaders(),
  ));
  assert.equal(confirmed.outcome, "conversion_completion_reconciled");
  assert.equal(confirmed.body.journey.state, "handoff_to_client_form2");
  assert.equal(confirmed.body.journey.revision, 9);
  assert.equal(confirmed.body.replayed, false);
  assert.deepEqual(harness.dealDigestCalls, [{
    dealId: "876543210987654",
    environment: "development",
  }]);
  assert.equal(harness.conversionCalls.filter((call) => call.method === "confirmConversion").length, 1);
  assert.equal(JSON.stringify(confirmed.body).includes("876543210987654"), false);

  const replayed = await harness.dispatcher.dispatch(post(
    ROUTES.conversionConfirmPath,
    { confirm: true, revision: 8 },
    sessionHeaders(),
  ));
  assert.equal(replayed.outcome, "conversion_completion_replayed");
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.journey.revision, 9);
  assert.equal(harness.conversionCalls.filter((call) => call.method === "confirmConversion").length, 1);
});

test("dispatcher exposes durable reconciliation across an ambiguous conversion retry without a second CRM write", async () => {
  const leadId = "987654321098765";
  const accountId = "876543210987650";
  const contactId = "876543210987651";
  const dealId = "876543210987652";
  let writes = 0;
  let journey = {
    conversionOutcomeFingerprint: null,
    conversionPreviewFingerprint: null,
    conversionSideEffectFingerprint: null,
    conversionStatus: "not_started",
    environment: "development",
    journeyKey: "00000000-0000-4000-8000-000000000001",
    moduleApiName: "Leads",
    operatorUserId: AUTHENTICATED_OPERATOR.operatorUserId,
    qualificationStatus: "qualified",
    recordId: leadId,
    revision: 7,
    sessionDigest: "f".repeat(64),
    state: "lead_conversion_preview",
  };
  let previewRecord = null;
  let conversionStatus = "not_started";
  const storeAudit = [];
  const conversionStore = {
    async createPreview(value) {
      storeAudit.push("createPreview");
      previewRecord = { ...value };
      conversionStatus = "preview_ready";
      journey = {
        ...journey,
        conversionPreviewFingerprint: value.previewFingerprint,
        conversionStatus,
        revision: value.expectedRevision + 1,
        state: value.nextState,
      };
      return {
        previewFingerprint: value.previewFingerprint,
        revision: journey.revision,
        state: journey.state,
        status: conversionStatus,
      };
    },
    async claimConversion(value) {
      storeAudit.push("claimConversion");
      if (conversionStatus !== "preview_ready") {
        return {
          previewFingerprint: previewRecord.previewFingerprint,
          revision: previewRecord.expectedRevision + 1,
          status: conversionStatus,
        };
      }
      assert.equal(value.previewFingerprint, previewRecord.previewFingerprint);
      return {
        previewFingerprint: value.previewFingerprint,
        revision: value.revision,
        status: "claimed",
      };
    },
    async markWriteStarted(value) {
      storeAudit.push("markWriteStarted");
      conversionStatus = "write_started";
      journey = {
        ...journey,
        conversionSideEffectFingerprint: value.sideEffectFingerprint,
        conversionStatus,
        revision: value.revision + 1,
      };
      return {
        revision: journey.revision,
        sideEffectFingerprint: value.sideEffectFingerprint,
        startedNow: true,
        status: conversionStatus,
      };
    },
    async completeConversion() {
      storeAudit.push("completeConversion");
      throw new Error("synthetic committed CRM write with lost completion persistence");
    },
    async markReconciliationRequired() {
      storeAudit.push("markReconciliationRequired");
      conversionStatus = "reconciliation_required";
      journey = { ...journey, conversionStatus };
      return { status: conversionStatus };
    },
  };
  const fields = MANDATORY_DEAL_FIELDS.map((apiName) => {
    const field = { apiName, writable: true };
    if (apiName === "Deal_Name") field.maxLength = 200;
    if (apiName === "Pipeline") field.allowedValues = [CONTROLLED_CONVERSION_DEFAULTS.pipeline];
    if (apiName === "Stage") field.allowedValues = [CONTROLLED_CONVERSION_DEFAULTS.stage];
    if (apiName === "Type") field.allowedValues = [CONTROLLED_CONVERSION_DEFAULTS.type];
    return field;
  });
  const crm = {
    async getLead() {
      return {
        id: leadId,
        company: "ZZZ SYNTHETIC Plumbing",
        contactDisplayName: "ZZZ SYNTHETIC Contact",
        locked: false,
      };
    },
    async getConversionOptions() {
      return {
        ambiguous: false,
        nativeV8: true,
        permissions: {
          associateAccount: true,
          associateContact: true,
          convertLead: true,
          createAccount: true,
          createContact: true,
          createDeal: true,
        },
        permitted: true,
        sourceLeadId: leadId,
      };
    },
    async getDealFieldMetadata() { return { sourceLeadId: leadId, fields }; },
    async findConversionCandidates() {
      return { sourceLeadId: leadId, accounts: [], contacts: [], deals: [] };
    },
    async convertLead() {
      writes += 1;
      return { accountId, contactId, dealId };
    },
    async readConversionResult() {
      return {
        account: { id: accountId, sourceLeadId: leadId },
        authorizationStatus: "Not Sent",
        contact: { accountId, id: contactId, sourceLeadId: leadId },
        conversionMappings: {
          accountId,
          contactId,
          dealId,
          leadId,
          requestedAccountId: null,
          requestedContactId: null,
        },
        converted: true,
        deal: {
          accountId,
          contactId,
          fields: {
            Account_Name: accountId,
            Closing_Date: CONTROLLED_CONVERSION_DEFAULTS.closingDate,
            Deal_Name: "ZZZ SYNTHETIC Plumbing — Free Revenue Leak Test",
            Pipeline: CONTROLLED_CONVERSION_DEFAULTS.pipeline,
            Stage: CONTROLLED_CONVERSION_DEFAULTS.stage,
            Type: CONTROLLED_CONVERSION_DEFAULTS.type,
          },
          id: dealId,
          sourceLeadId: leadId,
        },
        emailSent: false,
        leadId,
        routingStarted: false,
        testStatus: "Not Started",
      };
    },
  };
  const conversionService = createFieldSetupConversionService({ crm, store: conversionStore });
  const launchService = {
    async issueLaunch() { throw new Error("must not run"); },
    async exchangeLaunch() { throw new Error("must not run"); },
    async authenticateSession() { return { ...journey }; },
    async transitionSession() { throw new Error("must not run"); },
  };
  const dispatcher = createFieldSetupDispatcher({
    config: dispatcherConfig(),
    controlledConversionDefaults: CONTROLLED_CONVERSION_DEFAULTS,
    conversionService,
    dealResumeBindingDigest: () => DEAL_RESUME_BINDING_DIGEST,
    launchService,
    authenticatedOperatorResolver: async () => AUTHENTICATED_OPERATOR,
  });

  const preview = await dispatcher.dispatch(post(
    ROUTES.conversionPreviewPath,
    { revision: 7 },
    sessionHeaders(),
  ));
  assert.equal(preview.body.journey.state, "lead_conversion_confirmation");
  const confirmationRequest = post(
    ROUTES.conversionConfirmPath,
    { confirm: true, revision: 8 },
    sessionHeaders(),
  );
  await rejectsWith(dispatcher.dispatch(confirmationRequest), {
    status: 503,
    publicCode: "reconciliation_required",
  });
  await rejectsWith(dispatcher.dispatch(confirmationRequest), {
    status: 503,
    publicCode: "reconciliation_required",
  });

  assert.equal(writes, 1);
  assert.equal(conversionStatus, "reconciliation_required");
  assert.equal(storeAudit.filter((method) => method === "claimConversion").length, 1);
  assert.equal(storeAudit.filter((method) => method === "completeConversion").length, 1);
});
