"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertCatalystRequestBinding,
  assertCatalystSdkBinding,
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

test("request and SDK project identities must match the reviewed private digest", () => {
  const config = loadConfig(environment(), REVISION);
  const request = { headers: requestHeaders() };
  assert.equal(assertCatalystRequestBinding(request, config), SYNTHETIC_CATALYST_PROJECT_ID);
  assert.doesNotThrow(() => assertCatalystSdkBinding({
    config: {
      environment: "development",
      projectId: SYNTHETIC_CATALYST_PROJECT_ID,
    },
  }, SYNTHETIC_CATALYST_PROJECT_ID, config));

  assert.throws(
    () => assertCatalystRequestBinding({ headers: requestHeaders({
      "x-zc-projectid": "100000000000002",
    }) }, config),
    ConfigurationError,
  );
  assert.throws(
    () => assertCatalystRequestBinding({ headers: {
      ...requestHeaders(),
      "X-ZC-ProjectId": SYNTHETIC_CATALYST_PROJECT_ID,
    } }, config),
    ConfigurationError,
  );
  assert.throws(
    () => assertCatalystSdkBinding({
      config: { environment: "development", projectId: "100000000000002" },
    }, SYNTHETIC_CATALYST_PROJECT_ID, config),
    ConfigurationError,
  );
  assert.equal(config.expectedCatalystProjectIdSha256, SYNTHETIC_CATALYST_PROJECT_ID_SHA256);
});

test("project mismatch fails before SDK initialization or any controller side effect", async () => {
  let initialized = false;
  let handled = false;
  const listener = createRequestListener({
    artifactSourceRevision: REVISION,
    catalystSdk: {
      initialize() {
        initialized = true;
        throw new Error("must not initialize");
      },
    },
    environment: environment(),
    logger: { info() {}, error() {} },
    now: () => 100,
    randomUUID: () => "10000000-0000-4000-8000-000000000001",
    async requestHandler() {
      handled = true;
      throw new Error("must not handle");
    },
  });
  const response = responseStub();

  await listener({ headers: requestHeaders({
    "x-zc-projectid": "100000000000002",
  }) }, response);

  assert.equal(initialized, false);
  assert.equal(handled, false);
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.payload).code, "configuration_invalid");
});

test("SDK project mismatch fails before store, Connection, CRM, or controller access", async () => {
  let handled = false;
  let platformAccessed = false;
  const listener = createRequestListener({
    artifactSourceRevision: REVISION,
    catalystSdk: {
      initialize() {
        return {
          config: { environment: "development", projectId: "100000000000002" },
          connections() { platformAccessed = true; },
          datastore() { platformAccessed = true; },
          zcql() { platformAccessed = true; },
        };
      },
    },
    environment: environment(),
    logger: { info() {}, error() {} },
    now: () => 100,
    randomUUID: () => "10000000-0000-4000-8000-000000000002",
    async requestHandler() {
      handled = true;
      throw new Error("must not handle");
    },
  });
  const response = responseStub();

  await listener({ headers: requestHeaders() }, response);

  assert.equal(platformAccessed, false);
  assert.equal(handled, false);
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.payload).code, "configuration_invalid");
});
