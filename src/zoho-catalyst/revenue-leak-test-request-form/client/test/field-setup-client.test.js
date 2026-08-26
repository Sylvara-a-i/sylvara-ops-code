"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const CLIENT_ROOT = path.resolve(__dirname, "..");
const ROUTE_ROOT = path.join(CLIENT_ROOT, "field-setup");
const PROJECT_ROOT = path.resolve(CLIENT_ROOT, "..");
const BROWSER_FILES = [
  path.join(ROUTE_ROOT, "index.html"),
  path.join(ROUTE_ROOT, "styles.css"),
  path.join(ROUTE_ROOT, "launch-fragment.js"),
  path.join(ROUTE_ROOT, "protocol.generated.js"),
  path.join(ROUTE_ROOT, "state-model.js"),
  path.join(ROUTE_ROOT, "api-adapter.js"),
  path.join(ROUTE_ROOT, "main.js")
];

const launchContract = require(path.join(ROUTE_ROOT, "launch-fragment.js"));
const generatedProtocol = require(path.join(ROUTE_ROOT, "protocol.generated.js"));
const stateModel = require(path.join(ROUTE_ROOT, "state-model.js"));
const apiContract = require(path.join(ROUTE_ROOT, "api-adapter.js"));
const canonicalProtocol = require(path.join(
  PROJECT_ROOT,
  "functions",
  "revenue_leak_test_request_form",
  "lib",
  "field-setup-protocol.js"
));

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function browserBundle() {
  return BROWSER_FILES.map(read).join("\n");
}

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.match(/[a-f\d]{2}/gi).map((channel) => parseInt(channel, 16) / 255);
    const [red, green, blue] = channels.map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
    return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    readValues() {
      return [...values.values()];
    }
  };
}

const CSRF_TOKEN = "c".repeat(43);
const LAUNCH_NONCE = "n".repeat(43);
const FORM_DESTINATIONS = Object.freeze({
  form1: "https://forms.zohopublic.com/synthetic/free-test-request",
  form2: "https://forms.zohopublic.com/synthetic/free-test-authorization"
});

function authenticatedRuntime(overrides = {}) {
  const routes = {
    conversionConfirmPath: "/field-setup-api/conversion/confirm",
    conversionPreviewPath: "/field-setup-api/conversion/preview",
    decisionPath: "/field-setup-api/intent",
    exchangePath: "/field-setup-api/exchange",
    forwardingInstructionsPath: "/field-setup-operations/forwarding/instructions",
    numberClaimPath: "/field-setup-operations/number/claim",
    numberStatusPath: "/field-setup-operations/number/status",
    routeVerificationWindowPath: "/field-setup-operations/route-verification/window",
    setupControlPath: "/field-setup-operations/control",
    statusPath: "/field-setup-api/status"
  };
  return {
    mode: apiContract.AUTHENTICATED_MODE,
    csrfHeaderName: "x-sylvara-field-setup-csrf",
    routes: { ...routes, ...(overrides.routes || {}) },
    formNavigationDestinations: { ...FORM_DESTINATIONS },
    ...overrides,
    routes: { ...routes, ...(overrides.routes || {}) }
  };
}

function publicJourney(state, revision) {
  const progress = stateModel.getStateIndex(state) + 1;
  return {
    state,
    progress,
    totalSteps: stateModel.FIELD_SETUP_STATES.length,
    revision
  };
}

function jsonResponse(payload, status = 200) {
  const responsePayload = payload?.ok === true
    ? {
      ...payload,
      protocolId: stateModel.PROTOCOL_ID,
      schemaVersion: stateModel.PROTOCOL_SCHEMA_VERSION
    }
    : payload;
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return responsePayload; }
  };
}

function conversionPreview() {
  return {
    account: {
      action: "create_from_conversion_mapping",
      displayName: "ZZZ SYNTHETIC Plumbing"
    },
    contact: {
      action: "create_from_conversion_mapping",
      displayName: "ZZZ SYNTHETIC Contact"
    },
    deal: {
      closingDate: "2026-09-01",
      dealName: "ZZZ SYNTHETIC Plumbing — 7-Day Free Test",
      mandatoryDealFields: [
        "Deal_Name",
        "Closing_Date",
        "Pipeline",
        "Stage",
        "Type",
        "Free_Test_Setup_Status"
      ],
      pipeline: "Standard (Standard)",
      stage: "Free Test Scheduled",
      type: "New Business"
    },
    noEmailOrRoutingEffect: true
  };
}

function createDomHarness(api) {
  class Element {
    constructor() {
      this.children = [];
      this.disabled = false;
      this.hidden = false;
      this.style = {};
      this.textContent = "";
    }
    addEventListener() {}
    append(...children) { this.children.push(...children); }
    focus() { this.focused = true; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
  }
  const ids = [
    "progress-copy",
    "progress-track",
    "progress-fill",
    "source-badge",
    "audience-badge",
    "step-status",
    "step-kicker",
    "step-title",
    "step-description",
    "step-notice",
    "step-details",
    "qualification-panel",
    "error-message",
    "primary-action",
    "decision-actions",
    "stop-action",
    "live-announcer"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const documentLike = {
    createElement() { return new Element(); },
    getElementById(id) { return elements[id]; }
  };
  const windowLike = {
    FieldSetupApi: {
      AUTHENTICATED_MODE: apiContract.AUTHENTICATED_MODE,
      createApi() { return api; },
      createSyntheticApi() { return api; }
    },
    FieldSetupLaunch: { consumeLaunchNonce() { return null; } },
    FieldSetupRuntimeConfig: Object.freeze({}),
    FieldSetupStateModel: stateModel,
    location: { assign() {}, search: "" },
    sessionStorage: memoryStorage()
  };
  vm.runInNewContext(read(path.join(ROUTE_ROOT, "main.js")), {
    URLSearchParams,
    document: documentLike,
    window: windowLike
  });
  return { elements };
}

test("the state inventory contains the exact 22 required screens in order", () => {
  const expectedNames = [
    "Loading and session validation",
    "Company and progress summary",
    "Hand-iPad-to-client instruction",
    "Open or resume Form 1",
    "Form 1 completion confirmation",
    "Return-iPad-to-Gabriel instruction",
    "Operator qualification review",
    "Lead-conversion preview",
    "Explicit conversion confirmation",
    "Hand-iPad-to-client instruction",
    "Email verification for Form 2",
    "Open or resume Form 2",
    "Form 2 completion confirmation",
    "Return-iPad-to-Gabriel instruction",
    "Test-number reservation status",
    "Forwarding instructions",
    "Rollback instructions",
    "Route-verification status",
    "Ready for approval",
    "Live status",
    "Stop/rollback status",
    "Specific recoverable blocked/error state"
  ];

  assert.equal(stateModel.FIELD_SETUP_STATES.length, 22);
  assert.deepEqual(stateModel.FIELD_SETUP_STATES.map((state) => state.name), expectedNames);
  assert.equal(new Set(stateModel.FIELD_SETUP_STATES.map((state) => state.id)).size, 22);
});

test("the generated client protocol exactly matches the one canonical server contract", () => {
  assert.deepEqual(generatedProtocol, canonicalProtocol);
  assert.equal(stateModel.PROTOCOL_ID, canonicalProtocol.protocolId);
  assert.equal(stateModel.PROTOCOL_SCHEMA_VERSION, canonicalProtocol.schemaVersion);
  assert.deepEqual(
    stateModel.FIELD_SETUP_STATES.map((state) => state.id),
    canonicalProtocol.states.map((state) => state.id)
  );
  for (const state of stateModel.FIELD_SETUP_STATES) {
    const contract = canonicalProtocol.states.find((candidate) => candidate.id === state.id);
    assert.deepEqual(
      [state.primaryAction, ...state.secondaryActions].map((action) => ({
        id: action.id,
        nextState: action.syntheticNextState
      })),
      [contract.primaryAction, ...contract.secondaryActions].map((action) => ({
        id: action.id,
        nextState: action.nextState
      }))
    );
  }
});

test("every screen has exactly one primary action", () => {
  for (const state of stateModel.FIELD_SETUP_STATES) {
    assert.deepEqual(Object.keys(state).filter((key) => key === "primaryAction"), ["primaryAction"]);
    assert.equal(typeof state.primaryAction.id, "string", state.id);
    assert.ok(state.primaryAction.id.length > 0, state.id);
    assert.equal(typeof state.primaryAction.label, "string", state.id);
    assert.ok(state.primaryAction.label.length > 0, state.id);
  }

  const html = read(path.join(ROUTE_ROOT, "index.html"));
  assert.equal((html.match(/data-role="primary-action"/g) || []).length, 1);
});

test("qualification criteria and decision choices match the operator contract", () => {
  assert.deepEqual([...stateModel.QUALIFICATION_CRITERIA], [
    "Company Has Meaningful Call Volume",
    "Can Accept Additional Profitable Work",
    "Has A Repeatable Intake Process",
    "Will Authorize A Controlled Forwarding Path",
    "Has An Accountable Callback / Handoff Owner",
    "Decision-Maker Is Present"
  ]);

  const qualification = stateModel.getState("operator_qualification_review");
  assert.equal(qualification.serverOutcomeRequired, true);
  assert.equal(qualification.primaryAction.label, "Qualified — Continue Setup");
  assert.deepEqual(qualification.secondaryActions.map((action) => action.label), [
    "Not Ready — Save And Follow Up",
    "Disqualified"
  ]);
});

test("launch fragments are removed without leaking them into the replacement URL", () => {
  const syntheticNonce = "a".repeat(43);
  const calls = [];
  const locationLike = {
    hash: `#launch=${syntheticNonce}`,
    pathname: "/field-setup/",
    search: "?preview=session-validation"
  };
  const historyLike = {
    replaceState(...args) {
      calls.push(args);
    }
  };

  assert.equal(launchContract.captureAndRemove(locationLike, historyLike), true);
  assert.deepEqual(calls, [[null, "", "/field-setup/?preview=session-validation"]]);
  assert.equal(calls[0][2].includes(syntheticNonce), false);
  assert.equal(launchContract.consumeLaunchNonce(), syntheticNonce);
  assert.equal(launchContract.consumeLaunchNonce(), null);
});

test("malformed fragments are still removed and never accepted as launch material", () => {
  const calls = [];
  const locationLike = { hash: "#unexpected=value", pathname: "/field-setup/", search: "" };
  const historyLike = { replaceState: (...args) => calls.push(args) };

  assert.equal(launchContract.captureAndRemove(locationLike, historyLike), false);
  assert.deepEqual(calls, [[null, "", "/field-setup/"]]);
  assert.equal(launchContract.consumeLaunchNonce(), null);
});

test("fragment removal script runs synchronously before route styles and application scripts", () => {
  const html = read(path.join(ROUTE_ROOT, "index.html"));
  const fragmentScript = html.indexOf('<script src="./launch-fragment.js"></script>');
  const stylesheet = html.indexOf('<link rel="stylesheet" href="./styles.css">');
  const application = html.indexOf('<script defer src="./main.js"></script>');

  assert.ok(fragmentScript > -1);
  assert.ok(fragmentScript < stylesheet);
  assert.ok(fragmentScript < application);
});

test("the synthetic adapter autosaves safe state only and exposes no activation operation", async () => {
  const storage = memoryStorage();
  const api = apiContract.createSyntheticApi({ stateModel, storage });
  const validation = stateModel.getState("loading_session_validation");
  const outcome = await api.completeStep({
    stateId: validation.id,
    actionId: validation.primaryAction.id
  });

  assert.equal(outcome.authoritative, false);
  assert.equal(outcome.nextState, "company_progress_summary");
  assert.deepEqual(storage.readValues(), ["company_progress_summary"]);

  const operationNames = Object.keys(api).join(" ").toLowerCase();
  assert.doesNotMatch(operationNames, /activate|approve|start.?test|route.?traffic/);
  assert.deepEqual(Object.keys(api).sort(), [
    "completeStep",
    "loadJourney",
    "loadStepData",
    "mode",
    "requestStop",
    "submitOperatorDecision"
  ]);
});

test("a launch nonce cannot be exchanged by the source-preview adapter", async () => {
  const api = apiContract.createSyntheticApi({ stateModel });
  const outcome = await api.loadJourney({ launchNonce: "a".repeat(43) });

  assert.equal(outcome.authoritative, false);
  assert.equal(outcome.nextState, "recoverable_blocked");
});

test("default API selection remains synthetic and never invokes an available transport", async () => {
  let networkAttempts = 0;
  const api = apiContract.createApi({
    stateModel,
    storage: memoryStorage(),
    async fetchImpl() {
      networkAttempts += 1;
      throw new Error("default wiring must not call fetch");
    }
  });

  assert.equal(api.mode, apiContract.SYNTHETIC_MODE);
  const outcome = await api.loadJourney({ previewState: "company_progress_summary" });
  assert.equal(outcome.authoritative, false);
  assert.equal(outcome.nextState, "company_progress_summary");
  assert.equal(networkAttempts, 0);
});

test("authenticated adapter exchanges once, persists only CSRF, autosaves intent, and resumes status", async () => {
  const calls = [];
  const storage = memoryStorage();
  const responses = [
    jsonResponse({
      ok: true,
      csrfToken: CSRF_TOKEN,
      journey: publicJourney("company_progress_summary", 2)
    }),
    jsonResponse({
      ok: true,
      journey: publicJourney("handoff_to_client_form1", 3),
      navigationIntent: null
    }),
    jsonResponse({
      ok: true,
      journey: publicJourney("handoff_to_client_form1", 3)
    })
  ];
  const fetchImpl = async (pathName, options) => {
    calls.push({ pathName, options });
    return responses.shift();
  };
  const api = apiContract.createApi({
    fetchImpl,
    runtime: authenticatedRuntime(),
    stateModel,
    storage
  });

  const exchanged = await api.loadJourney({ launchNonce: LAUNCH_NONCE });
  assert.equal(exchanged.authoritative, true);
  assert.equal(exchanged.nextState, "company_progress_summary");
  assert.deepEqual(JSON.parse(calls[0].options.body), { nonce: LAUNCH_NONCE });
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.mode, "same-origin");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  assert.equal(
    calls[0].options.headers["x-sylvara-field-setup-protocol-id"],
    stateModel.PROTOCOL_ID
  );
  assert.equal(
    calls[0].options.headers["x-sylvara-field-setup-protocol-version"],
    String(stateModel.PROTOCOL_SCHEMA_VERSION)
  );
  assert.equal(Object.hasOwn(calls[0].options.headers, "x-sylvara-field-setup-csrf"), false);
  assert.deepEqual(storage.readValues(), [CSRF_TOKEN]);
  assert.equal(storage.readValues().includes(LAUNCH_NONCE), false);

  const saved = await api.completeStep({
    stateId: "company_progress_summary",
    actionId: "acknowledge_company_summary"
  });
  assert.equal(saved.authoritative, true);
  assert.equal(saved.nextState, "handoff_to_client_form1");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    action: "acknowledge_company_summary",
    qualification: null,
    revision: 2
  });
  assert.equal(calls[1].options.headers["x-sylvara-field-setup-csrf"], CSRF_TOKEN);

  const resumedApi = apiContract.createApi({
    fetchImpl,
    runtime: authenticatedRuntime(),
    stateModel,
    storage
  });
  const resumed = await resumedApi.loadJourney();
  assert.equal(resumed.nextState, "handoff_to_client_form1");
  assert.equal(calls[2].options.method, "GET");
  assert.equal(calls[2].options.headers["x-sylvara-field-setup-csrf"], CSRF_TOKEN);
});

test("an incompatible exchange response is rejected before CSRF or journey state is retained", async () => {
  const storage = memoryStorage();
  const api = apiContract.createAuthenticatedApi({
    async fetchImpl() {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            csrfToken: CSRF_TOKEN,
            journey: publicJourney("company_progress_summary", 2),
            protocolId: stateModel.PROTOCOL_ID,
            schemaVersion: stateModel.PROTOCOL_SCHEMA_VERSION + 1
          };
        }
      };
    },
    runtime: authenticatedRuntime(),
    stateModel,
    storage
  });

  await assert.rejects(
    () => api.loadJourney({ launchNonce: LAUNCH_NONCE }),
    /protocol is incompatible/
  );
  assert.deepEqual(storage.readValues(), []);
});

test("authenticated runtime wiring accepts only relative same-origin routes and exact form bases", () => {
  const invalid = [
    authenticatedRuntime({
      routes: {
        exchangePath: "https://attacker.example.invalid/exchange",
        statusPath: "/field-setup-api/status",
        decisionPath: "/field-setup-api/intent"
      }
    }),
    authenticatedRuntime({
      routes: {
        exchangePath: "/field-setup-api/shared",
        statusPath: "/field-setup-api/shared",
        decisionPath: "/field-setup-api/intent"
      }
    }),
    authenticatedRuntime({
      formNavigationDestinations: {
        form1: "http://forms.zohopublic.com/synthetic/free-test-request",
        form2: FORM_DESTINATIONS.form2
      }
    }),
    authenticatedRuntime({
      formNavigationDestinations: {
        form1: "https://forms.attacker.example/synthetic/free-test-request",
        form2: FORM_DESTINATIONS.form2
      }
    }),
    { ...authenticatedRuntime(), unexpected: true }
  ];
  for (const runtime of invalid) {
    assert.throws(() => apiContract.createAuthenticatedApi({
      fetchImpl: async () => jsonResponse({}),
      runtime,
      stateModel
    }));
  }
});

test("Form actions accept only an authoritative allowlisted top-level navigation intent", async () => {
  const storage = memoryStorage();
  storage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
  const calls = [];
  const responses = [
    jsonResponse({ ok: true, journey: publicJourney("form1_open_or_resume", 4) }),
    jsonResponse({
      ok: true,
      journey: publicJourney("form1_completion_confirmation", 5),
      navigationIntent: {
        mode: "top_level",
        target: "form1",
        url: `${FORM_DESTINATIONS.form1}?token=${LAUNCH_NONCE}`
      }
    }),
    jsonResponse({
      ok: true,
      journey: publicJourney("form1_completion_confirmation", 6),
      navigationIntent: {
        mode: "top_level",
        target: "form1",
        url: `${FORM_DESTINATIONS.form1}?token=${LAUNCH_NONCE}`
      }
    })
  ];
  const api = apiContract.createAuthenticatedApi({
    async fetchImpl(pathName, options) {
      calls.push({ pathName, options });
      return responses.shift();
    },
    runtime: authenticatedRuntime(),
    stateModel,
    storage
  });
  await api.loadJourney();
  const outcome = await api.completeStep({ stateId: "form1_open_or_resume", actionId: "open_form1" });
  assert.deepEqual(outcome.navigationIntent, {
    mode: "top_level",
    target: "form1",
    url: `${FORM_DESTINATIONS.form1}?token=${LAUNCH_NONCE}`
  });
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    action: "open_form1",
    qualification: null,
    revision: 4
  });
  const reopened = await api.completeStep({
    stateId: "form1_completion_confirmation",
    actionId: "resume_form1"
  });
  assert.equal(reopened.nextState, "form1_completion_confirmation");
  assert.deepEqual(reopened.navigationIntent, outcome.navigationIntent);
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    action: "resume_form1",
    qualification: null,
    revision: 5
  });

  const blockedResponses = [
    jsonResponse({ ok: true, journey: publicJourney("form1_open_or_resume", 4) }),
    jsonResponse({
      ok: true,
      journey: publicJourney("form1_completion_confirmation", 5),
      navigationIntent: {
        mode: "top_level",
        target: "form1",
        url: `https://attacker.example.invalid/free-test-request?token=${LAUNCH_NONCE}`
      }
    })
  ];
  const blocked = apiContract.createAuthenticatedApi({
    fetchImpl: async () => blockedResponses.shift(),
    runtime: authenticatedRuntime(),
    stateModel,
    storage
  });
  await blocked.loadJourney();
  await assert.rejects(
    () => blocked.completeStep({ stateId: "form1_open_or_resume", actionId: "open_form1" }),
    /outside the approved destination/
  );
});

test("a lost Form navigation response replays the exact decision and preserves its URL", async () => {
  const storage = memoryStorage();
  storage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
  const runtime = authenticatedRuntime();
  const calls = [];
  const navigationIntent = {
    mode: "top_level",
    target: "form1",
    url: `${FORM_DESTINATIONS.form1}?token=${LAUNCH_NONCE}`
  };
  let decisionAttempts = 0;
  const api = apiContract.createAuthenticatedApi({
    async fetchImpl(pathName, options) {
      calls.push({ pathName, options });
      if (pathName === runtime.routes.statusPath) {
        return jsonResponse({ ok: true, journey: publicJourney("form1_open_or_resume", 4) });
      }
      if (pathName === runtime.routes.decisionPath) {
        decisionAttempts += 1;
        if (decisionAttempts === 1) throw new Error("Synthetic committed response loss");
        return jsonResponse({
          ok: true,
          journey: publicJourney("form1_completion_confirmation", 5),
          navigationIntent
        });
      }
      throw new Error("Unexpected synthetic request");
    },
    runtime,
    stateModel,
    storage
  });

  await api.loadJourney();
  const outcome = await api.completeStep({
    stateId: "form1_open_or_resume",
    actionId: "open_form1"
  });
  assert.equal(outcome.actionId, "open_form1");
  assert.equal(outcome.nextState, "form1_completion_confirmation");
  assert.deepEqual(outcome.navigationIntent, navigationIntent);
  assert.deepEqual(calls.map(({ pathName }) => pathName), [
    runtime.routes.statusPath,
    runtime.routes.decisionPath,
    runtime.routes.decisionPath
  ]);
  assert.deepEqual(calls[1].options, calls[2].options);
});

test("authenticated qualification sends exact six-factor intent and trusts only server state", async () => {
  const storage = memoryStorage();
  storage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
  const calls = [];
  const responses = [
    jsonResponse({ ok: true, journey: publicJourney("operator_qualification_review", 7) }),
    jsonResponse({
      ok: true,
      journey: publicJourney("lead_conversion_preview", 8),
      navigationIntent: null
    })
  ];
  const api = apiContract.createAuthenticatedApi({
    async fetchImpl(pathName, options) {
      calls.push({ pathName, options });
      return responses.shift();
    },
    runtime: authenticatedRuntime(),
    stateModel,
    storage
  });
  await api.loadJourney();
  const qualification = {
    ...Object.fromEntries(stateModel.QUALIFICATION_FACTORS.map((factor) => [factor.id, true])),
    decision: "qualified_continue_setup"
  };
  const outcome = await api.submitOperatorDecision({
    stateId: "operator_qualification_review",
    actionId: "qualification_qualified",
    qualification
  });
  assert.equal(outcome.nextState, "lead_conversion_preview");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    action: "qualification_qualified",
    qualification,
    revision: 7
  });
  await assert.rejects(() => api.submitOperatorDecision({
    stateId: "operator_qualification_review",
    actionId: "qualification_qualified",
    qualification
  }), /stale/);
  assert.equal(calls.length, 2);
});

test("conversion confirmation stays locked until the exact sanitized preview is loaded for display", async () => {
  const storage = memoryStorage();
  storage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
  const calls = [];
  const preview = conversionPreview();
  const responses = [
    jsonResponse({ ok: true, journey: publicJourney("lead_conversion_preview", 8) }),
    jsonResponse({
      ok: true,
      journey: publicJourney("lead_conversion_confirmation", 9),
      preview
    }),
    jsonResponse({
      ok: true,
      journey: publicJourney("lead_conversion_confirmation", 9),
      preview
    }),
    jsonResponse({
      ok: true,
      journey: publicJourney("handoff_to_client_form2", 11),
      replayed: false
    })
  ];
  const runtime = authenticatedRuntime();
  const api = apiContract.createAuthenticatedApi({
    async fetchImpl(pathName, options) {
      calls.push({ pathName, options });
      return responses.shift();
    },
    runtime,
    stateModel,
    storage
  });

  await api.loadJourney();
  const built = await api.completeStep({
    stateId: "lead_conversion_preview",
    actionId: "accept_conversion_preview"
  });
  assert.equal(built.nextState, "lead_conversion_confirmation");
  assert.equal(calls[1].pathName, runtime.routes.conversionPreviewPath);
  assert.deepEqual(JSON.parse(calls[1].options.body), { revision: 8 });

  await assert.rejects(
    () => api.completeStep({
      stateId: "lead_conversion_confirmation",
      actionId: "confirm_conversion_intent"
    }),
    /has not been displayed/
  );
  assert.equal(calls.length, 2);

  const display = await api.loadStepData({ stateId: "lead_conversion_confirmation" });
  assert.deepEqual(display.details, [
    "Account: ZZZ SYNTHETIC Plumbing — create from Lead conversion",
    "Contact: ZZZ SYNTHETIC Contact — create from Lead conversion",
    "Deal: ZZZ SYNTHETIC Plumbing — 7-Day Free Test",
    "Stage / Pipeline / Type: Free Test Scheduled / Standard (Standard) / New Business",
    "Closing date: 2026-09-01",
    "Mandatory fields: Deal_Name, Closing_Date, Pipeline, Stage, Type, Free_Test_Setup_Status",
    "Email and routing effects: none"
  ]);
  assert.equal(display.ready, true);
  assert.equal(calls[2].pathName, runtime.routes.conversionPreviewPath);

  const confirmed = await api.completeStep({
    stateId: "lead_conversion_confirmation",
    actionId: "confirm_conversion_intent"
  });
  assert.equal(confirmed.nextState, "handoff_to_client_form2");
  assert.equal(calls[3].pathName, runtime.routes.conversionConfirmPath);
  assert.deepEqual(JSON.parse(calls[3].options.body), { confirm: true, revision: 9 });
});

test("a lost conversion-preview response replays the exact request without rebuilding the preview", async () => {
  const storage = memoryStorage();
  storage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
  const calls = [];
  const preview = conversionPreview();
  const runtime = authenticatedRuntime();
  let serverJourney = publicJourney("lead_conversion_preview", 8);
  let previewBuilds = 0;
  const api = apiContract.createAuthenticatedApi({
    async fetchImpl(pathName, options) {
      calls.push({ pathName, options });
      if (pathName === runtime.routes.statusPath) {
        return jsonResponse({ ok: true, journey: serverJourney });
      }
      if (pathName === runtime.routes.conversionPreviewPath && previewBuilds === 0) {
        previewBuilds += 1;
        serverJourney = publicJourney("lead_conversion_confirmation", 9);
        throw new Error("Synthetic committed response loss");
      }
      if (pathName === runtime.routes.conversionPreviewPath) {
        return jsonResponse({ ok: true, journey: serverJourney, preview });
      }
      throw new Error("Unexpected synthetic request");
    },
    runtime,
    stateModel,
    storage
  });

  await api.loadJourney();
  const reconciled = await api.completeStep({
    stateId: "lead_conversion_preview",
    actionId: "accept_conversion_preview"
  });
  assert.equal(reconciled.actionId, "accept_conversion_preview");
  assert.equal(reconciled.nextState, "lead_conversion_confirmation");
  assert.equal(reconciled.revision, 9);
  assert.equal(previewBuilds, 1);
  assert.deepEqual(calls.map(({ pathName }) => pathName), [
    runtime.routes.statusPath,
    runtime.routes.conversionPreviewPath,
    runtime.routes.conversionPreviewPath
  ]);
  assert.deepEqual(calls[1].options, calls[2].options);

  await assert.rejects(
    () => api.completeStep({
      stateId: "lead_conversion_confirmation",
      actionId: "confirm_conversion_intent"
    }),
    /has not been displayed/
  );
  const displayed = await api.loadStepData({ stateId: "lead_conversion_confirmation" });
  assert.equal(displayed.ready, true);
});

test("a lost completed conversion response replays the exact confirmation without a second CRM write", async () => {
  const storage = memoryStorage();
  storage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
  const runtime = authenticatedRuntime();
  const calls = [];
  const preview = conversionPreview();
  let serverJourney = publicJourney("lead_conversion_confirmation", 9);
  let confirmAttempts = 0;
  let simulatedCrmConversions = 0;
  const api = apiContract.createAuthenticatedApi({
    async fetchImpl(pathName, options) {
      calls.push({ pathName, options });
      if (pathName === runtime.routes.statusPath) {
        return jsonResponse({ ok: true, journey: serverJourney });
      }
      if (pathName === runtime.routes.conversionPreviewPath) {
        return jsonResponse({ ok: true, journey: serverJourney, preview });
      }
      if (pathName === runtime.routes.conversionConfirmPath) {
        confirmAttempts += 1;
        if (confirmAttempts === 1) {
          simulatedCrmConversions += 1;
          serverJourney = publicJourney("handoff_to_client_form2", 11);
          throw new Error("Synthetic completed conversion response loss");
        }
        return jsonResponse({ ok: true, journey: serverJourney, replayed: true });
      }
      throw new Error("Unexpected synthetic request");
    },
    runtime,
    stateModel,
    storage
  });

  await api.loadJourney();
  await api.loadStepData({ stateId: "lead_conversion_confirmation" });
  const converted = await api.completeStep({
    stateId: "lead_conversion_confirmation",
    actionId: "confirm_conversion_intent"
  });
  assert.equal(converted.actionId, "confirm_conversion_intent");
  assert.equal(converted.nextState, "handoff_to_client_form2");
  assert.equal(simulatedCrmConversions, 1);
  assert.deepEqual(calls.map(({ pathName }) => pathName), [
    runtime.routes.statusPath,
    runtime.routes.conversionPreviewPath,
    runtime.routes.conversionConfirmPath,
    runtime.routes.conversionConfirmPath
  ]);
  assert.deepEqual(calls[2].options, calls[3].options);
});

test("an ambiguous conversion retry stops for reconciliation without a second CRM write", async () => {
  const storage = memoryStorage();
  storage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
  const runtime = authenticatedRuntime();
  const calls = [];
  const journey = publicJourney("lead_conversion_confirmation", 9);
  let confirmAttempts = 0;
  let simulatedCrmConversions = 0;
  const api = apiContract.createAuthenticatedApi({
    async fetchImpl(pathName, options) {
      calls.push({ pathName, options });
      if (pathName === runtime.routes.statusPath) {
        return jsonResponse({ ok: true, journey });
      }
      if (pathName === runtime.routes.conversionPreviewPath) {
        return jsonResponse({ ok: true, journey, preview: conversionPreview() });
      }
      if (pathName === runtime.routes.conversionConfirmPath) {
        confirmAttempts += 1;
        if (confirmAttempts === 1) {
          simulatedCrmConversions += 1;
          throw new Error("Synthetic write-started response loss");
        }
        return jsonResponse({ ok: false, code: "reconciliation_required" }, 503);
      }
      throw new Error("Unexpected synthetic request");
    },
    runtime,
    stateModel,
    storage
  });

  await api.loadJourney();
  await api.loadStepData({ stateId: "lead_conversion_confirmation" });
  await assert.rejects(
    () => api.completeStep({
      stateId: "lead_conversion_confirmation",
      actionId: "confirm_conversion_intent"
    }),
    (error) => (
      error.operatorStop === true &&
      error.code === "reconciliation_required" &&
      error.operatorMessage === "Conversion outcome requires controlled reconciliation. Do not retry conversion."
    )
  );
  assert.equal(simulatedCrmConversions, 1);
  assert.deepEqual(calls.map(({ pathName }) => pathName), [
    runtime.routes.statusPath,
    runtime.routes.conversionPreviewPath,
    runtime.routes.conversionConfirmPath,
    runtime.routes.conversionConfirmPath
  ]);
  assert.deepEqual(calls[2].options, calls[3].options);
});

test("a lost generic decision response replays only the exact action-bound request", async () => {
  const storage = memoryStorage();
  storage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
  const runtime = authenticatedRuntime();
  const calls = [];
  let serverJourney = publicJourney("company_progress_summary", 2);
  let decisionAttempts = 0;
  const api = apiContract.createAuthenticatedApi({
    async fetchImpl(pathName, options) {
      calls.push({ pathName, options });
      if (pathName === runtime.routes.statusPath) {
        return jsonResponse({ ok: true, journey: serverJourney });
      }
      if (pathName === runtime.routes.decisionPath) {
        decisionAttempts += 1;
        if (decisionAttempts === 1) {
          serverJourney = publicJourney("handoff_to_client_form1", 3);
          throw new Error("Synthetic committed response loss");
        }
        return jsonResponse({ ok: true, journey: serverJourney, navigationIntent: null });
      }
      throw new Error("Unexpected synthetic request");
    },
    runtime,
    stateModel,
    storage
  });

  await api.loadJourney();
  const reconciled = await api.completeStep({
    stateId: "company_progress_summary",
    actionId: "acknowledge_company_summary"
  });
  assert.equal(reconciled.actionId, "acknowledge_company_summary");
  assert.equal(reconciled.nextState, "handoff_to_client_form1");
  assert.equal(reconciled.revision, 3);
  assert.deepEqual(calls.map(({ pathName }) => pathName), [
    runtime.routes.statusPath,
    runtime.routes.decisionPath,
    runtime.routes.decisionPath
  ]);
  assert.deepEqual(calls[1].options, calls[2].options);

  const unchangedStorage = memoryStorage();
  unchangedStorage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
  const unchangedJourney = publicJourney("company_progress_summary", 2);
  const unchangedCalls = [];
  const unchangedApi = apiContract.createAuthenticatedApi({
    async fetchImpl(pathName) {
      unchangedCalls.push(pathName);
      if (pathName === runtime.routes.statusPath) {
        return jsonResponse({ ok: true, journey: unchangedJourney });
      }
      throw new Error("Synthetic precommit failure");
    },
    runtime,
    stateModel,
    storage: unchangedStorage
  });
  await unchangedApi.loadJourney();
  await assert.rejects(
    () => unchangedApi.completeStep({
      stateId: "company_progress_summary",
      actionId: "acknowledge_company_summary"
    }),
    /Synthetic precommit failure/
  );
  assert.deepEqual(unchangedCalls, [
    runtime.routes.statusPath,
    runtime.routes.decisionPath,
    runtime.routes.decisionPath
  ]);
});

test("reviewed forwarding instructions load before acknowledgement and journey reconciliation", async () => {
  const storage = memoryStorage();
  storage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
  const calls = [];
  const runtime = authenticatedRuntime();
  const responses = [
    jsonResponse({ ok: true, journey: publicJourney("forwarding_instructions", 15) }),
    jsonResponse({
      ok: true,
      color: "Blue",
      status: "Reviewed Instructions Available",
      steps: [
        "Open the reviewed provider control.",
        "Apply only the documented forwarding destination."
      ],
      view: "enable"
    }),
    jsonResponse({ ok: false, code: "context_conflict" }, 409),
    jsonResponse({ ok: false, code: "context_conflict" }, 409),
    jsonResponse({ ok: true, journey: publicJourney("forwarding_instructions", 15) }),
    jsonResponse({
      ok: true,
      setupStatus: "in_progress",
      forwardingState: "Customer Reported Enabled",
      rollbackReady: false,
      controlRevision: 2,
      journeyRevision: 15,
      replayed: false,
      activatesDeployment: false,
      mutatesLiveRoute: false,
      requiresSeparateOperatorApproval: true
    }),
    jsonResponse({
      ok: true,
      journey: publicJourney("rollback_instructions", 16),
      navigationIntent: null
    })
  ];
  const api = apiContract.createAuthenticatedApi({
    async fetchImpl(pathName, options) {
      calls.push({ pathName, options });
      return responses.shift();
    },
    runtime,
    stateModel,
    storage
  });

  await api.loadJourney();
  const display = await api.loadStepData({ stateId: "forwarding_instructions" });
  assert.deepEqual(display.details, [
    "Open the reviewed provider control.",
    "Apply only the documented forwarding destination."
  ]);
  assert.equal(calls[1].pathName, runtime.routes.forwardingInstructionsPath);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    journeyRevision: 15,
    view: "enable"
  });

  const acknowledged = await api.completeStep({
    stateId: "forwarding_instructions",
    actionId: "view_forwarding_instructions"
  });
  assert.equal(acknowledged.nextState, "rollback_instructions");
  assert.deepEqual(calls.slice(2).map(({ pathName }) => pathName), [
    runtime.routes.decisionPath,
    runtime.routes.decisionPath,
    runtime.routes.statusPath,
    runtime.routes.setupControlPath,
    runtime.routes.decisionPath
  ]);
  assert.deepEqual(JSON.parse(calls[5].options.body), {
    action: "confirm_forwarding_enabled",
    journeyRevision: 15
  });
});

test("requestStop completes its controlled setup operation before the exact global decision", async () => {
  const storage = memoryStorage();
  storage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
  const runtime = authenticatedRuntime();
  const calls = [];
  const responses = [
    jsonResponse({ ok: true, journey: publicJourney("forwarding_instructions", 15) }),
    jsonResponse({ ok: false, code: "context_conflict" }, 409),
    jsonResponse({ ok: false, code: "context_conflict" }, 409),
    jsonResponse({ ok: true, journey: publicJourney("forwarding_instructions", 15) }),
    jsonResponse({
      ok: true,
      setupStatus: "stopped",
      mutatesLiveRoute: false,
      activatesDeployment: false
    }),
    jsonResponse({
      ok: true,
      journey: publicJourney("stop_rollback_status", 16),
      navigationIntent: null
    })
  ];
  const api = apiContract.createAuthenticatedApi({
    async fetchImpl(pathName, options) {
      calls.push({ pathName, options });
      return responses.shift();
    },
    runtime,
    stateModel,
    storage
  });

  await api.loadJourney();
  const stopped = await api.requestStop();
  assert.equal(stopped.actionId, "stop_setup");
  assert.equal(stopped.nextState, "stop_rollback_status");
  assert.deepEqual(calls.map(({ pathName }) => pathName), [
    runtime.routes.statusPath,
    runtime.routes.decisionPath,
    runtime.routes.decisionPath,
    runtime.routes.statusPath,
    runtime.routes.setupControlPath,
    runtime.routes.decisionPath
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    action: "stop_setup",
    qualification: null,
    revision: 15
  });
  assert.deepEqual(calls[1].options, calls[2].options);
  assert.deepEqual(JSON.parse(calls[4].options.body), {
    action: "stop",
    journeyRevision: 15
  });
});

test("bounded setup stops preserve only approved operator messages", async () => {
  const cases = [
    {
      state: "number_reservation_status",
      payload: {
        ok: false,
        code: "test_number_required",
        message: "Test Number Required — Sylvara Must Assign A Number Before Continuing",
        protocolId: stateModel.PROTOCOL_ID,
        schemaVersion: stateModel.PROTOCOL_SCHEMA_VERSION
      },
      expected: "Test Number Required — Sylvara Must Assign A Number Before Continuing"
    },
    {
      state: "forwarding_instructions",
      payload: {
        ok: false,
        code: "technical_setup_required",
        status: "Technical Setup Required",
        color: "Gray",
        view: "enable",
        steps: [],
        protocolId: stateModel.PROTOCOL_ID,
        schemaVersion: stateModel.PROTOCOL_SCHEMA_VERSION
      },
      expected: "Technical Setup Required"
    }
  ];

  for (const selected of cases) {
    const storage = memoryStorage();
    storage.setItem(apiContract.CSRF_STORAGE_KEY, CSRF_TOKEN);
    const responses = [
      jsonResponse({ ok: true, journey: publicJourney(selected.state, 14) }),
      {
        ok: false,
        status: 409,
        async json() { return selected.payload; }
      }
    ];
    const api = apiContract.createAuthenticatedApi({
      fetchImpl: async () => responses.shift(),
      runtime: authenticatedRuntime(),
      stateModel,
      storage
    });
    await api.loadJourney();
    await assert.rejects(
      () => api.loadStepData({ stateId: selected.state }),
      (error) => (
        error.operatorStop === true &&
        error.operatorMessage === selected.expected
      )
    );
  }
});

test("operator-stop messages render as text and leave journey actions disabled", async () => {
  for (const selected of [
    {
      state: "number_reservation_status",
      message: "Test Number Required — Sylvara Must Assign A Number Before Continuing"
    },
    { state: "forwarding_instructions", message: "Technical Setup Required" }
  ]) {
    const operatorStop = new Error("redacted");
    operatorStop.operatorStop = true;
    operatorStop.operatorMessage = selected.message;
    const api = Object.freeze({
      mode: apiContract.AUTHENTICATED_MODE,
      async loadJourney() {
        return Object.freeze({ nextState: selected.state });
      },
      async loadStepData() { throw operatorStop; }
    });
    const { elements } = createDomHarness(api);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(elements["error-message"].textContent, selected.message);
    assert.equal(elements["error-message"].hidden, false);
    assert.equal(elements["primary-action"].disabled, true);
    assert.equal(elements["live-announcer"].textContent, selected.message);
  }
});

test("an unconfirmed step outcome never claims that the server could not have committed it", () => {
  const source = read(path.join(ROUTE_ROOT, "main.js"));
  assert.match(
    source,
    /The step outcome could not be confirmed\. Retry the same action or stop setup safely\./
  );
  assert.doesNotMatch(source, /No authoritative action was assumed complete/);
  assert.match(
    source,
    /The stop outcome could not be confirmed\. Retry Stop Setup to reconcile authoritative state; use controlled rollback only if instructed\./
  );
  assert.doesNotMatch(source, /The stop request was not saved/);
});

test("the qualification UI submits exactly six booleans plus the matching decision", async () => {
  const api = apiContract.createSyntheticApi({ stateModel });
  const allTrue = Object.fromEntries(
    stateModel.QUALIFICATION_FACTORS.map((factor) => [factor.id, true])
  );
  const qualified = {
    ...allTrue,
    decision: "qualified_continue_setup"
  };
  assert.deepEqual(
    Object.keys(stateModel.normalizeQualificationPayload("qualification_qualified", qualified)).sort(),
    [...stateModel.QUALIFICATION_FACTORS.map((factor) => factor.id), "decision"].sort()
  );
  const outcome = await api.submitOperatorDecision({
    stateId: "operator_qualification_review",
    actionId: "qualification_qualified",
    qualification: qualified
  });
  assert.equal(outcome.authoritative, false);
  assert.equal(outcome.nextState, "lead_conversion_preview");

  const incomplete = { ...qualified, decisionMakerIsPresent: false };
  const blocked = await api.submitOperatorDecision({
    stateId: "operator_qualification_review",
    actionId: "qualification_qualified",
    qualification: incomplete
  });
  assert.equal(blocked.nextState, "recoverable_blocked");

  const main = read(path.join(ROUTE_ROOT, "main.js"));
  const css = read(path.join(ROUTE_ROOT, "styles.css"));
  assert.match(main, /data-qualification-factor/);
  assert.match(main, /collectQualificationPayload/);
  assert.match(main, /payload\.decision = action\.qualificationDecision/);
  assert.match(css, /\.qualification-option\s*\{[^}]*min-height:\s*44px;/s);
});

test("the browser bundle has no committed runtime mapping, secret-shaped value, PII, or durable identifier", () => {
  const bundle = browserBundle();
  const forbiddenPatterns = [
    /XMLHttpRequest/i,
    /sendBeacon/i,
    /WebSocket/i,
    /https?:\/\//i,
    /-----BEGIN [A-Z ]+-----/,
    /\bBearer\s+[A-Za-z0-9._~-]+/i,
    /(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'][^"']+["']/i,
    /\b[0-9]{12,}\b/,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:\+?1[-. (]*)?\d{3}[-. )]*\d{3}[-. ]*\d{4}/
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(bundle, pattern, pattern.toString());
  }
  const html = read(path.join(ROUTE_ROOT, "index.html"));
  assert.doesNotMatch(html, /FieldSetupRuntimeConfig/);
  assert.doesNotMatch(html, /runtime-config\.js/);
});

test("the bundle has no iframe or unsafe HTML injection path", () => {
  const bundle = browserBundle();
  assert.doesNotMatch(bundle, /<iframe\b/i);
  assert.doesNotMatch(bundle, /\.innerHTML\s*=/);
  assert.doesNotMatch(bundle, /insertAdjacentHTML/);
  assert.doesNotMatch(bundle, /document\.write/);
});

test("touch controls meet the minimum target and actions are not hover-only", () => {
  const css = read(path.join(ROUTE_ROOT, "styles.css"));
  assert.match(css, /button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*48px;/s);
  assert.match(css, /\.button:focus-visible/);
  assert.match(css, /\.button-primary\s*\{[^}]*background:/s);
  assert.match(css, /\.button-secondary\s*\{[^}]*border-color:/s);
});

test("the canonical Sylvara cyan uses accessible foregrounds", () => {
  const html = read(path.join(ROUTE_ROOT, "index.html"));
  const css = read(path.join(ROUTE_ROOT, "styles.css"));

  assert.match(html, /<meta name="theme-color" content="#00A6C1">/);
  assert.match(css, /--brand:\s*#00A6C1;/);
  assert.match(css, /--brand-strong:\s*#005B6A;/);
  assert.match(css, /--brand-ink:\s*#0B3138;/);
  assert.match(css, /\.progress-panel\s*\{[^}]*color:\s*var\(--brand-ink\);[^}]*background:\s*var\(--brand\);/s);
  assert.match(css, /\.button-primary\s*\{[^}]*color:\s*var\(--brand-ink\);[^}]*background:\s*var\(--brand\);/s);
  assert.ok(contrastRatio("0B3138", "00A6C1") >= 4.5);
  assert.ok(contrastRatio("FFFFFF", "005B6A") >= 4.5);
  assert.doesNotMatch(`${html}\n${css}`, /#173f35|#0d3028|#dce9e3/i);
});

test("the two required iPad viewport contracts are explicit", () => {
  assert.deepEqual(stateModel.SUPPORTED_VIEWPORTS, [
    { width: 768, height: 1024 },
    { width: 1024, height: 1366 }
  ]);

  const html = read(path.join(ROUTE_ROOT, "index.html"));
  const css = read(path.join(ROUTE_ROOT, "styles.css"));
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(css, /@media \(min-width: 48rem\) and \(max-height: 64rem\)/);
  assert.match(css, /width:\s*min\(100%, 72rem\)/);
});

test("semantic controls, focus movement, and status announcements support keyboard use", () => {
  const html = read(path.join(ROUTE_ROOT, "index.html"));
  const script = read(path.join(ROUTE_ROOT, "main.js"));
  const buttonCount = (html.match(/<button\b/g) || []).length;
  const typedButtonCount = (html.match(/<button\b[^>]*type="button"/g) || []).length;

  assert.equal(buttonCount, typedButtonCount);
  assert.match(html, /class="skip-link" href="#journey-content"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /id="step-title" tabindex="-1"/);
  assert.doesNotMatch(html, /tabindex="[1-9]/);
  assert.match(script, /elements\.title\.focus\(\)/);
});

test("the Catalyst source descriptor keeps the client unregistered and deployment-gated", () => {
  const catalyst = JSON.parse(read(path.join(PROJECT_ROOT, "catalyst.json")));
  const clientPackage = JSON.parse(read(path.join(CLIENT_ROOT, "client-package.json")));
  const gate = catalyst["x-sylvara-source-only-client"];

  assert.equal(Object.hasOwn(catalyst, "client"), false);
  assert.equal(gate.source, "client");
  assert.equal(gate.route, "/field-setup/");
  assert.equal(gate.published, false);
  assert.equal(gate.deploymentAllowed, false);
  assert.equal(gate.registrationRequired, true);
  assert.equal(gate.deploymentGate, "SEPARATE_DEVELOPMENT_WEB_CLIENT_REGISTRATION_AND_PUBLISH_APPROVAL_REQUIRED");
  assert.equal(clientPackage.homepage, "field-setup/index.html");
  assert.equal(fs.existsSync(path.join(CLIENT_ROOT, "index.html")), true);
});

test("the content security policy permits only same-origin API calls and blocks frames and forms", () => {
  const html = read(path.join(ROUTE_ROOT, "index.html"));
  assert.match(html, /form-action 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /connect-src 'self'/);
  assert.doesNotMatch(html, /connect-src[^;]*(?:https?:|\*)/);
});
