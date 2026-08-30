"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertCatalystRequestBinding,
  createRequestListener,
} = require("../lib/catalyst-adapter");
const { ConfigurationError, loadConfig } = require("../lib/config");
const {
  REVISION,
  SYNTHETIC_CATALYST_PROJECT_ID,
  SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
  environment,
} = require("./helpers");

function requestHeaders(overrides = {}) {
  return {
    "x-zc-environment": "development",
    "x-zc-projectid": SYNTHETIC_CATALYST_PROJECT_ID,
    "content-type": "application/json",
    "x-sylvara-issue-test": "i".repeat(43),
    ...overrides,
  };
}

function responseStub() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.payload = value; },
  };
}

test("request project identity must match the reviewed private digest before SDK access", () => {
  const config = loadConfig(environment(), REVISION);
  assert.equal(
    assertCatalystRequestBinding({ headers: requestHeaders() }, config),
    SYNTHETIC_CATALYST_PROJECT_ID,
  );
  assert.throws(
    () => assertCatalystRequestBinding({ headers: requestHeaders({
      "x-zc-projectid": "100000000000002",
    }) }, config),
    ConfigurationError,
  );
  assert.equal(config.expectedCatalystProjectIdSha256, SYNTHETIC_CATALYST_PROJECT_ID_SHA256);
});

test("authentication failure occurs before SDK, body, Data Store, Connection, or fetch access", async () => {
  const events = [];
  const listener = createRequestListener({
    artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { events.push("sdk"); throw new Error("must not initialize"); } },
    environment: environment(),
    logger: { info() {}, error() {} },
    now: () => 100,
    randomUUID: () => "10000000-0000-4000-8000-000000000001",
  });
  const request = {
    method: "POST",
    url: "/form1/issue-test",
    headers: requestHeaders({ "x-sylvara-issue-test": "wrong" }),
    on() { events.push("body"); throw new Error("must not read"); },
  };
  const response = responseStub();
  await listener(request, response);
  assert.deepEqual(events, []);
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.payload).code, "authentication_failed");
});

test("an authenticated Development request initializes only the bound SDK and dispatches", async () => {
  const events = [];
  const app = {
    config: { environment: "development", projectId: SYNTHETIC_CATALYST_PROJECT_ID },
    datastore() { return { table() { return {}; } }; },
    zcql() { return {}; },
    connections() { return {}; },
  };
  const listener = createRequestListener({
    artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { events.push("sdk"); return app; } },
    environment: environment(),
    logger: { info() {}, error() {} },
    now: () => 100,
    randomUUID: () => "10000000-0000-4000-8000-000000000002",
    async requestHandler() {
      events.push("handler");
      return {
        status: 201,
        body: { ok: true },
        stage: "issue",
        outcome: "issued",
      };
    },
  });
  const response = responseStub();
  await listener({
    method: "POST",
    url: "/form1/issue-test",
    headers: requestHeaders(),
    rawBody: Buffer.from("{}", "utf8"),
  }, response);
  assert.deepEqual(events, ["sdk", "handler"]);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(JSON.parse(response.payload), {
    ok: true,
    requestId: "10000000-0000-4000-8000-000000000002",
  });
});

test("an access-page response preserves exact HTML and security headers", async () => {
  const html = "<!doctype html><title>Continue</title>";
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "content-security-policy": "default-src 'none'; script-src 'nonce-test'; connect-src 'self'",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  };
  const app = {
    config: { environment: "development", projectId: SYNTHETIC_CATALYST_PROJECT_ID },
    datastore() { return { table() { return {}; } }; },
    zcql() { return {}; },
    connections() { return {}; },
  };
  const listener = createRequestListener({
    artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { return app; } },
    environment: environment(),
    logger: { info() {}, error() {} },
    now: () => 100,
    randomUUID: () => "10000000-0000-4000-8000-000000000003",
    async requestHandler() {
      return { status: 200, body: html, headers, stage: "access", outcome: "served" };
    },
  });
  const response = responseStub();
  await listener({
    method: "GET",
    url: "/form1/access-test",
    headers: requestHeaders({ "x-sylvara-issue-test": undefined }),
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload, html);
  assert.deepEqual(response.headers, headers);
  assert.doesNotMatch(response.payload, /requestId/);
});
