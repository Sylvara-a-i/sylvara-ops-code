"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  assertCatalystEnvironment,
  assertCatalystRequestBinding,
  assertCatalystSdkBinding,
  codeForError,
  createRequestListener,
  readCatalystEnvironmentHeader,
  sendJson,
  statusForError,
} = require("../lib/catalyst-adapter");
const { ConfigurationError } = require("../lib/config");
const { destinationDigest } = require("../lib/destinations");

const FORM2_PUBLIC_URL =
  "https://forms.zohopublic.com/synthetic/form/perma/synthetic";
const FORM2_DESTINATION_SHA256 = destinationDigest(FORM2_PUBLIC_URL);
const SYNTHETIC_CRM_READ_LINK = "syntheticfixturevalue123456789";
const SYNTHETIC_CRM_WRITE_LINK = "syntheticbillingsecret1234";
const SYNTHETIC_CATALYST_PROJECT_ID = "100000000000001";
const SYNTHETIC_CATALYST_PROJECT_ID_SHA256 = crypto
  .createHash("sha256")
  .update(SYNTHETIC_CATALYST_PROJECT_ID, "utf8")
  .digest("hex");

function catalystHeaders(overrides = {}) {
  return {
    "x-zc-environment": "Development",
    "x-zc-projectid": SYNTHETIC_CATALYST_PROJECT_ID,
    ...overrides,
  };
}

function listenerEnvironment() {
  return {
    DEPLOYMENT_ENVIRONMENT: "development",
    DEPLOYMENT_MODE: "active",
    EXPECTED_CATALYST_PROJECT_ID_SHA256: SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
    SESSION_TABLE_NAME: "Form2SessionsV3Runtime",
    PREFILL_TABLE_NAME: "Form2PrefillsV3",
    SUBMISSION_TABLE_NAME: "Form2SubmissionsV3",
    FORM2_PROOF_TABLE_NAME: "Form2VerificationProofsV3",
    ISSUE_PATH: "/form2/session/issue",
    FORM2_ACCESS_PATH: "/form2/session/access",
    FORM2_OTP_REQUEST_PATH: "/form2/session/otp/request",
    FORM2_OTP_VERIFY_PATH: "/form2/session/otp/verify",
    PREFILL_PATH: "/form2/session/prefill",
    SUBMISSION_PATH: "/form2/session/submit",
    ISSUE_HEADER_NAME: "x-sylvara-issue-key",
    ISSUE_HEADER_SECRET: "I".repeat(43),
    FORMS_HEADER_NAME: "x-sylvara-forms-key",
    PREFILL_HEADER_SECRET: "F".repeat(43),
    SUBMISSION_HEADER_SECRET: "S".repeat(43),
    TOKEN_PEPPER: "P".repeat(43),
    WORKFLOW_HMAC_SECRET: "W".repeat(43),
    FORM2_PROOF_HMAC_SECRET: "V".repeat(43),
    FORM2_ACCESS_PUBLIC_URL: "https://synthetic.development.catalystserverless.com/form2/session/access",
    FORM2_PUBLIC_URL,
    FORM2_PROOF_MODE: "stub",
    FORM2_MAIL_FROM: "synthetic@example.invalid",
    FORM2_PROOF_ALLOWED_RECIPIENT_DIGESTS: "[]",
    FORM2_PROOF_TEMPLATE_VERSION: "email-otp-v1",
    FORM2_TOKEN_FIELD_ALIAS: "access_token",
    FORM2_FORM_VERSION: "form2-v1",
    FORM2_ENTRY_OFFER_VALUE: "Synthetic Free Test",
    FORM2_PHONE_SYSTEM_PROVIDERS: '["Synthetic PBX"]',
    FORM2_FIELD_TEAM_SIZE_BANDS: '["Synthetic Approved Band"]',
    FORM2_ACCESS_STATUS_INITIAL_VALUE: "Synthetic Initial",
    FORM2_ACCESS_STATUS_ISSUED_VALUE: "Synthetic Issued",
    FORM2_ACCESS_STATUS_VERIFIED_VALUE: "Synthetic Verified",
    FORM2_ACCESS_STATUS_SUBMITTED_VALUE: "Synthetic Submitted",
    FORM2_ACCESS_STATUS_EXPIRED_VALUE: "Synthetic Expired",
    CRM_API_BASE_URL: "https://www.zohoapis.com/crm/v8",
    CRM_READ_CONNECTION_LINK_NAME: SYNTHETIC_CRM_READ_LINK,
    CRM_WRITE_CONNECTION_LINK_NAME: SYNTHETIC_CRM_WRITE_LINK,
    SOURCE_REVISION: "a".repeat(40),
  };
}

function catalystSdkStub() {
  return {
    initialize() {
      return {
        config: {
          environment: "development",
          projectId: SYNTHETIC_CATALYST_PROJECT_ID,
        },
        datastore() { return { table() { return {}; } }; },
        zcql() { return {}; },
        connections() { return {}; },
        email() { return {}; },
      };
    },
  };
}

function responseStub() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.payload = value; },
  };
}

test("requires request and SDK identity to match the reviewed Development project digest", () => {
  const request = { headers: catalystHeaders() };
  const config = {
    deploymentEnvironment: "development",
    expectedCatalystProjectIdSha256: SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
  };
  const app = {
    config: {
      environment: "development",
      projectId: SYNTHETIC_CATALYST_PROJECT_ID,
    },
  };
  assert.equal(readCatalystEnvironmentHeader(request), "development");
  assert.equal(assertCatalystRequestBinding(request, config), SYNTHETIC_CATALYST_PROJECT_ID);
  assert.doesNotThrow(() => assertCatalystSdkBinding(
    app,
    SYNTHETIC_CATALYST_PROJECT_ID,
    config,
  ));
  assert.doesNotThrow(() => assertCatalystEnvironment(
    request,
    app,
    "development",
    SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
  ));
  assert.throws(
    () => assertCatalystRequestBinding({ headers: catalystHeaders({
      "x-zc-projectid": "100000000000002",
    }) }, config),
    ConfigurationError,
  );
  assert.throws(
    () => assertCatalystRequestBinding({ headers: {
      ...catalystHeaders(),
      "X-ZC-ProjectId": SYNTHETIC_CATALYST_PROJECT_ID,
    } }, config),
    ConfigurationError,
  );
  assert.throws(
    () => assertCatalystSdkBinding(
      { config: { environment: "development", projectId: "100000000000002" } },
      SYNTHETIC_CATALYST_PROJECT_ID,
      config,
    ),
    ConfigurationError,
  );
});

test("project mismatch fails before SDK or Form 2 platform side effects", async () => {
  let initialized = false;
  let handled = false;
  const wrongRequestListener = createRequestListener({
    catalystSdk: {
      initialize() {
        initialized = true;
        throw new Error("must not initialize");
      },
    },
    environment: listenerEnvironment(),
    artifactSourceRevision: listenerEnvironment().SOURCE_REVISION,
    artifactFormDestinationSha256: FORM2_DESTINATION_SHA256,
    logger: { info() {}, error() {} },
    randomUUID: () => "10000000-0000-4000-8000-000000000001",
    now: () => 100,
    requestHandler: async () => {
      handled = true;
      throw new Error("must not handle");
    },
  });
  const wrongRequestOutput = responseStub();
  await wrongRequestListener({ headers: catalystHeaders({
    "x-zc-projectid": "100000000000002",
  }) }, wrongRequestOutput);
  assert.equal(initialized, false);
  assert.equal(handled, false);
  assert.equal(wrongRequestOutput.statusCode, 503);
  assert.equal(JSON.parse(wrongRequestOutput.payload).code, "configuration_invalid");

  let platformAccessed = false;
  const wrongSdkListener = createRequestListener({
    catalystSdk: {
      initialize() {
        initialized = true;
        return {
          config: { environment: "development", projectId: "100000000000002" },
          connections() { platformAccessed = true; },
          datastore() { platformAccessed = true; },
          email() { platformAccessed = true; },
          zcql() { platformAccessed = true; },
        };
      },
    },
    environment: listenerEnvironment(),
    artifactSourceRevision: listenerEnvironment().SOURCE_REVISION,
    artifactFormDestinationSha256: FORM2_DESTINATION_SHA256,
    logger: { info() {}, error() {} },
    randomUUID: () => "10000000-0000-4000-8000-000000000002",
    now: () => 100,
    requestHandler: async () => {
      handled = true;
      throw new Error("must not handle");
    },
  });
  const wrongSdkOutput = responseStub();
  await wrongSdkListener({ headers: catalystHeaders() }, wrongSdkOutput);
  assert.equal(initialized, true);
  assert.equal(platformAccessed, false);
  assert.equal(handled, false);
  assert.equal(wrongSdkOutput.statusCode, 503);
  assert.equal(JSON.parse(wrongSdkOutput.payload).code, "configuration_invalid");
});

test("maps only approved public codes and bounded statuses", () => {
  assert.equal(statusForError({ status: 422 }), 422);
  assert.equal(statusForError({ publicCode: "setup_not_found" }), 404);
  assert.equal(statusForError({ publicCode: "reconciliation_required" }), 503);
  assert.equal(statusForError({ status: 200 }), 500);
  assert.equal(codeForError({ publicCode: "setup_not_found" }), "setup_not_found");
  assert.equal(codeForError({ publicCode: "provider-secret-message" }), "internal_error");
});

test("sends JSON with strict no-store and browser-sniffing protections", () => {
  const headers = {};
  let body;
  const response = {
    setHeader(name, value) { headers[name] = value; },
    end(value) { body = value; },
  };
  sendJson(response, 200, { ok: true });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(body), { ok: true });
  assert.equal(headers["cache-control"], "no-store, max-age=0");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["access-control-allow-origin"], undefined);
});

test("listener logs stage and outcome for controller successes and handled errors", async () => {
  const cases = [
    {
      result: { status: 200, body: { ok: true }, stage: "issue", outcome: "issued" },
      level: "info",
    },
    {
      result: {
        status: 503,
        body: { ok: false, code: "service_unavailable" },
        stage: "submission",
        outcome: "service_unavailable",
      },
      level: "error",
    },
  ];
  for (const selected of cases) {
    const lines = [];
    let clock = 100;
    const listener = createRequestListener({
      catalystSdk: catalystSdkStub(),
      environment: listenerEnvironment(),
      artifactSourceRevision: listenerEnvironment().SOURCE_REVISION,
      artifactFormDestinationSha256: FORM2_DESTINATION_SHA256,
      logger: {
        info(line) { lines.push(["info", line]); },
        error(line) { lines.push(["error", line]); },
      },
      randomUUID: () => "10000000-0000-4000-8000-000000000001",
      now: () => {
        clock += 7;
        return clock;
      },
      requestHandler: async () => selected.result,
    });
    const output = responseStub();
    await listener(
      { headers: catalystHeaders() },
      output,
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0][0], selected.level);
    const logged = JSON.parse(lines[0][1]);
    assert.equal(logged.stage, selected.result.stage);
    assert.equal(logged.outcome, selected.result.outcome);
    const publicBody = JSON.parse(output.payload);
    assert.equal(publicBody.stage, undefined);
    assert.equal(publicBody.outcome, undefined);
  }
});

test("listener fails before SDK initialization when runtime and artifact revisions differ", async () => {
  let initialized = false;
  const sdk = catalystSdkStub();
  const originalInitialize = sdk.initialize.bind(sdk);
  sdk.initialize = (...argumentsList) => {
    initialized = true;
    return originalInitialize(...argumentsList);
  };
  const listener = createRequestListener({
    catalystSdk: sdk,
    environment: listenerEnvironment(),
    artifactSourceRevision: "b".repeat(40),
    logger: { info() {}, error() {} },
    randomUUID: () => "10000000-0000-4000-8000-000000000001",
    now: () => 100,
  });
  const output = responseStub();

  await listener({ headers: catalystHeaders() }, output);

  assert.equal(initialized, false);
  assert.equal(output.statusCode, 503);
  assert.deepEqual(JSON.parse(output.payload), {
    ok: false,
    code: "configuration_invalid",
    requestId: "10000000-0000-4000-8000-000000000001",
  });
});

test("listener fails before SDK initialization when the artifact destination differs", async () => {
  let initialized = false;
  const sdk = catalystSdkStub();
  const originalInitialize = sdk.initialize.bind(sdk);
  sdk.initialize = (...argumentsList) => {
    initialized = true;
    return originalInitialize(...argumentsList);
  };
  const environment = listenerEnvironment();
  const listener = createRequestListener({
    catalystSdk: sdk,
    environment,
    artifactSourceRevision: environment.SOURCE_REVISION,
    artifactFormDestinationSha256: "b".repeat(64),
    logger: { info() {}, error() {} },
    randomUUID: () => "10000000-0000-4000-8000-000000000001",
    now: () => 100,
  });
  const output = responseStub();

  await listener({ headers: catalystHeaders() }, output);

  assert.equal(initialized, false);
  assert.equal(output.statusCode, 503);
  assert.equal(JSON.parse(output.payload).code, "configuration_invalid");
});

test("dark Production rejects before SDK, route, store, mail, CRM, or secret access", async () => {
  let initialized = false;
  let handled = false;
  const environment = {
    DEPLOYMENT_ENVIRONMENT: "production",
    DEPLOYMENT_MODE: "dark",
    SOURCE_REVISION: "a".repeat(40),
  };
  const listener = createRequestListener({
    catalystSdk: { initialize() { initialized = true; throw new Error("must not initialize"); } },
    environment,
    artifactSourceRevision: environment.SOURCE_REVISION,
    artifactFormDestinationSha256: "b".repeat(64),
    logger: { info() {}, error() {} },
    randomUUID: () => "10000000-0000-4000-8000-000000000001",
    now: () => 100,
    requestHandler: async () => { handled = true; throw new Error("must not handle"); },
  });
  const output = responseStub();

  await listener({ headers: {} }, output);

  assert.equal(initialized, false);
  assert.equal(handled, false);
  assert.equal(output.statusCode, 503);
  assert.deepEqual(JSON.parse(output.payload), {
    ok: false,
    code: "connection_unavailable",
    requestId: "10000000-0000-4000-8000-000000000001",
  });
});
