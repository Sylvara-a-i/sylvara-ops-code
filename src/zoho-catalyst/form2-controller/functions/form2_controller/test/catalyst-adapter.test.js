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

function listenerEnvironment() {
  return {
    DEPLOYMENT_ENVIRONMENT: "development",
    SESSION_TABLE_NAME: "Form2_Sessions",
    PREFILL_TABLE_NAME: "Form2_Prefills",
    SUBMISSION_TABLE_NAME: "Form2_Submissions",
    ISSUE_PATH: "/form2/session/issue",
    PREFILL_PATH: "/form2/session/prefill",
    SUBMISSION_PATH: "/form2/session/submit",
    ISSUE_HEADER_NAME: "x-sylvara-issue-key",
    ISSUE_HEADER_SECRET: "I".repeat(43),
    FORMS_HEADER_NAME: "x-sylvara-forms-key",
    PREFILL_HEADER_SECRET: "F".repeat(43),
    SUBMISSION_HEADER_SECRET: "S".repeat(43),
    TOKEN_PEPPER: "P".repeat(43),
    FORM2_PUBLIC_URL: "https://forms.zohopublic.com/synthetic/form/perma/synthetic",
    FORM2_TOKEN_FIELD_ALIAS: "access_token",
    FORM2_FORM_VERSION: "form2-v1",
    FORM2_ENTRY_OFFER_VALUE: "Synthetic Free Test",
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
      artifactRevision: "a".repeat(40),
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
