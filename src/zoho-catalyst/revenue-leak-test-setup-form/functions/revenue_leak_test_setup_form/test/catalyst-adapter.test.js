"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertCatalystEnvironment,
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

function listenerEnvironment() {
  return {
    DEPLOYMENT_ENVIRONMENT: "development",
    DEPLOYMENT_MODE: "active",
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
    CRM_READ_CONNECTION_LINK_NAME: "SyntheticCrmRead",
    CRM_WRITE_CONNECTION_LINK_NAME: "SyntheticCrmWrite",
    SOURCE_REVISION: "a".repeat(40),
  };
}

function catalystSdkStub() {
  return {
    initialize() {
      return {
        config: { environment: "development" },
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

function fieldSetupOperationsComposition(overrides = {}) {
  return {
    status: "NOT_READY",
    catalystHeaderMapping: "NOT_READY_INJECTED_ONLY",
    catalystIdentityMapping: "NOT_READY_INJECTED_ONLY",
    catalystStoreMapping: "NOT_READY_INJECTED_ONLY",
    deploymentAuthorized: false,
    runtimeAuthority: false,
    assertNoRouteCollision() {},
    claimsRequest() { return false; },
    async dispatch() {
      throw new Error("must not dispatch");
    },
    ...overrides,
  };
}

test("requires one injected Development header matching the SDK and configuration", () => {
  const request = { headers: { "x-zc-environment": "Development" } };
  assert.equal(readCatalystEnvironmentHeader(request), "development");
  assert.doesNotThrow(() => assertCatalystEnvironment(
    request,
    { config: { environment: "development" } },
    "development",
  ));
  for (const candidate of [
    [{ headers: {} }, { config: { environment: "development" } }, "development"],
    [request, { config: { environment: "production" } }, "development"],
    [{ headers: { "x-zc-environment": "production" } }, { config: { environment: "production" } }, "production"],
    [{ headers: { "X-ZC-Environment": "development", "x-zc-environment": "development" } }, { config: { environment: "development" } }, "development"],
  ]) {
    assert.throws(() => assertCatalystEnvironment(...candidate), ConfigurationError);
  }
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
      { headers: { "x-zc-environment": "Development" } },
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

test("listener explicitly dispatches an injected setup-operation route without entering Form 2", async () => {
  let handled = false;
  let dispatched = false;
  let collisionPaths;
  let dispatchContext;
  const listener = createRequestListener({
    catalystSdk: catalystSdkStub(),
    environment: listenerEnvironment(),
    artifactSourceRevision: listenerEnvironment().SOURCE_REVISION,
    artifactFormDestinationSha256: FORM2_DESTINATION_SHA256,
    logger: { info() {}, error() {} },
    randomUUID: () => "10000000-0000-4000-8000-000000000001",
    now: () => 100,
    requestHandler: async () => {
      handled = true;
      throw new Error("must not enter Form 2");
    },
    fieldSetupOperationsComposition: fieldSetupOperationsComposition({
      assertNoRouteCollision(paths) { collisionPaths = paths; },
      claimsRequest(request) {
        return request.url === "/field-setup/operations/number/status";
      },
      async dispatch(_request, context) {
        dispatched = true;
        dispatchContext = context;
        return {
          status: 200,
          body: {
            ok: true,
            state: "Available",
            color: "Gray",
            protocolId: "free_revenue_leak_test_field_setup_v1",
            schemaVersion: 1,
          },
          stage: "field_setup_operations",
          outcome: "number_status_read",
        };
      },
    }),
  });
  const output = responseStub();

  await listener({
    method: "GET",
    url: "/field-setup/operations/number/status",
    headers: { "x-zc-environment": "Development" },
  }, output);

  assert.equal(dispatched, true);
  assert.equal(handled, false);
  assert.equal(typeof dispatchContext.app.datastore, "function");
  assert.deepEqual(collisionPaths, [
    "/form2/session/issue",
    "/form2/session/access",
    "/form2/session/otp/request",
    "/form2/session/otp/verify",
    "/form2/session/prefill",
    "/form2/session/submit",
  ]);
  assert.deepEqual(JSON.parse(output.payload), {
    ok: true,
    state: "Available",
    color: "Gray",
    protocolId: "free_revenue_leak_test_field_setup_v1",
    schemaVersion: 1,
  });
});

test("default setup-operation composition preserves the existing Form 2 handler path", async () => {
  let handled = false;
  const listener = createRequestListener({
    catalystSdk: catalystSdkStub(),
    environment: listenerEnvironment(),
    artifactSourceRevision: listenerEnvironment().SOURCE_REVISION,
    artifactFormDestinationSha256: FORM2_DESTINATION_SHA256,
    logger: { info() {}, error() {} },
    randomUUID: () => "10000000-0000-4000-8000-000000000001",
    now: () => 100,
    requestHandler: async () => {
      handled = true;
      return {
        status: 404,
        body: { ok: false, code: "route_not_found" },
        stage: "request",
        outcome: "route_not_found",
      };
    },
  });
  const output = responseStub();

  await listener({
    method: "GET",
    url: "/field-setup/operations/number/status",
    headers: { "x-zc-environment": "Development" },
  }, output);

  assert.equal(handled, true);
  assert.equal(output.statusCode, 404);
  assert.equal(JSON.parse(output.payload).code, "route_not_found");
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

  await listener({ headers: { "x-zc-environment": "Development" } }, output);

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

  await listener({ headers: { "x-zc-environment": "Development" } }, output);

  assert.equal(initialized, false);
  assert.equal(output.statusCode, 503);
  assert.equal(JSON.parse(output.payload).code, "configuration_invalid");
});

test("dark Production rejects before SDK, route, store, mail, CRM, or secret access", async () => {
  let initialized = false;
  let handled = false;
  let compositionUsed = false;
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
    fieldSetupOperationsComposition: fieldSetupOperationsComposition({
      assertNoRouteCollision() { compositionUsed = true; },
      claimsRequest() { compositionUsed = true; return true; },
      async dispatch() { compositionUsed = true; throw new Error("must not dispatch"); },
    }),
  });
  const output = responseStub();

  await listener({ headers: {} }, output);

  assert.equal(initialized, false);
  assert.equal(handled, false);
  assert.equal(compositionUsed, false);
  assert.equal(output.statusCode, 503);
  assert.deepEqual(JSON.parse(output.payload), {
    ok: false,
    code: "connection_unavailable",
    requestId: "10000000-0000-4000-8000-000000000001",
  });
});
