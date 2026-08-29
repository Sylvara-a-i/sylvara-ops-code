"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
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

function containedRequest(path, headerName, secret, events) {
  const request = {
    method: "POST",
    url: path,
    headers: {
      ...requestHeaders(),
      "content-type": "application/json",
      [headerName]: secret,
    },
    on() {
      events.push("payload-listener");
      throw new Error("must not attach a payload listener");
    },
  };
  for (const property of ["rawBody", "datastore", "zcql", "connections"]) {
    Object.defineProperty(request, property, {
      get() {
        events.push(property);
        throw new Error(`must not access ${property}`);
      },
    });
  }
  return request;
}

test("request project identity must match the reviewed private digest without SDK access", () => {
  const config = loadConfig(environment(), REVISION);
  const request = { headers: requestHeaders() };
  assert.equal(assertCatalystRequestBinding(request, config), SYNTHETIC_CATALYST_PROJECT_ID);
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
  assert.equal(config.expectedCatalystProjectIdSha256, SYNTHETIC_CATALYST_PROJECT_ID_SHA256);
});

test("real listener contains valid Issue and Prefill before SDK, Data Store adapter, body, fetch, or token entropy", async () => {
  const events = [];
  const logEntries = [];
  let sdkLoaded = false;
  const originalLoad = Module._load;
  const originalFetch = globalThis.fetch;
  Module._load = function guardedLoad(request, parent, isMain) {
    if (request === "zcatalyst-sdk-node") {
      sdkLoaded = true;
      throw new Error("contained listener must not load the Catalyst SDK");
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  globalThis.fetch = async () => {
    events.push("fetch");
    throw new Error("contained listener must not fetch");
  };
  try {
    let requestNumber = 0;
    const listener = createRequestListener({
      artifactSourceRevision: REVISION,
      catalystSdk: {
        initialize() {
          events.push("sdk-initialize");
          throw new Error("must not initialize");
        },
      },
      environment: environment(),
      logger: {
        info(value) { logEntries.push(value); },
        error(value) { logEntries.push(value); },
      },
      now: () => 100,
      randomBytes() {
        events.push("random-bytes");
        throw new Error("must not generate a token");
      },
      randomUUID: () => {
        requestNumber += 1;
        return `10000000-0000-4000-8000-00000000000${requestNumber}`;
      },
    });
    const cases = [
      ["/form1/issue-test", "x-sylvara-issue-test", "i".repeat(43)],
      ["/form1/prefill-test", "x-sylvara-prefill-test", "p".repeat(43)],
    ];
    for (const [path, headerName, secret] of cases) {
      const response = responseStub();
      await listener(containedRequest(path, headerName, secret, events), response);
      assert.equal(response.statusCode, 503);
      assert.deepEqual(JSON.parse(response.payload), {
        ok: false,
        code: "configuration_invalid",
      });
    }
  } finally {
    Module._load = originalLoad;
    globalThis.fetch = originalFetch;
  }

  assert.equal(sdkLoaded, false);
  assert.deepEqual(events, []);
  assert.equal(logEntries.length, 2);
  for (const entry of logEntries.map(JSON.parse)) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "elapsedMs",
      "outcome",
      "requestId",
      "stage",
    ]);
    assert.equal(entry.outcome, "assisted_route_disabled");
    assert.match(entry.stage, /^(issue|prefill)$/);
  }
});

test("project mismatch fails before handler or payload access", async () => {
  const events = [];
  let handled = false;
  const listener = createRequestListener({
    artifactSourceRevision: REVISION,
    environment: environment(),
    logger: { info() {}, error() {} },
    now: () => 100,
    randomUUID: () => "10000000-0000-4000-8000-000000000003",
    async requestHandler() {
      handled = true;
      throw new Error("must not handle");
    },
  });
  const response = responseStub();
  const request = containedRequest(
    "/form1/issue-test",
    "x-sylvara-issue-test",
    "i".repeat(43),
    events,
  );
  request.headers["x-zc-projectid"] = "100000000000002";
  await listener(request, response);

  assert.equal(handled, false);
  assert.deepEqual(events, []);
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.payload).code, "configuration_invalid");
});
