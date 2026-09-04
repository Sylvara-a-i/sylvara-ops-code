"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { MAX_ACTIVE_WINDOW_MS, loadConfig } = require("../lib/config");
const {
  PROBE_VALUE,
  createRequestListener
} = require("../lib/handler");
const { FORM1_PREFILL_MAPPING_SAMPLE } = require("../lib/sample");

const ARTIFACT_REVISION = "1234567890abcdef1234567890abcdef12345678";
const PROJECT_ID = "1".repeat(15);
const HEADER_NAME = "x-sylvara-form1-mapping-fixture";
const HEADER_SECRET = "S".repeat(43);
const PATH = "/synthetic/form1-prefill-mapping";
const NOW = Date.parse("2026-09-04T12:00:00.000Z");

function environment(overrides = {}) {
  return {
    FORM1_PREFILL_MAPPING_FIXTURE_MODE: "active",
    DEPLOYMENT_ENVIRONMENT: "development",
    EXPECTED_CATALYST_PROJECT_ID_SHA256: crypto.createHash("sha256")
      .update(PROJECT_ID, "utf8").digest("hex"),
    SOURCE_REVISION: ARTIFACT_REVISION,
    FIXTURE_PATH: PATH,
    FIXTURE_HEADER_NAME: HEADER_NAME,
    FIXTURE_HEADER_SECRET: HEADER_SECRET,
    FIXTURE_EXPIRES_AT: new Date(NOW + 30 * 60 * 1000).toISOString(),
    ...overrides
  };
}

function request(overrides = {}) {
  return {
    method: "POST",
    url: PATH,
    headers: {
      "content-type": "application/json",
      "x-zc-environment": "Development",
      "x-zc-projectid": PROJECT_ID,
      [HEADER_NAME]: HEADER_SECRET
    },
    rawBody: Buffer.from(JSON.stringify({ prefillHandle: PROBE_VALUE })),
    ...overrides
  };
}

function response() {
  const selected = {
    statusCode: null,
    headers: {},
    body: null,
    status(value) {
      this.statusCode = value;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    send(value) {
      this.body = value;
    }
  };
  return selected;
}

async function invoke({ selectedEnvironment = environment(), selectedRequest = request(),
  now = () => NOW } = {}) {
  const selectedResponse = response();
  const listener = createRequestListener({
    environment: selectedEnvironment,
    now,
    artifactSourceRevision: ARTIFACT_REVISION
  });
  await listener(selectedRequest, selectedResponse);
  return {
    body: JSON.parse(selectedResponse.body),
    response: selectedResponse
  };
}

test("default configuration is disabled before request body access", async () => {
  const selected = request();
  Object.defineProperty(selected, "rawBody", {
    get() {
      throw new Error("disabled fixture must not inspect a request body");
    }
  });
  const result = await invoke({ selectedEnvironment: {}, selectedRequest: selected });
  assert.equal(result.response.statusCode, 503);
  assert.deepEqual(result.body, { ok: false, code: "service_unavailable" });
});

test("active fixture returns only the exact fixed 23-key mapping sample", async () => {
  const result = await invoke();
  assert.equal(result.response.statusCode, 200);
  assert.deepEqual(result.body, FORM1_PREFILL_MAPPING_SAMPLE);
  assert.equal(Object.keys(result.body).length, 23);
  assert.equal(Object.hasOwn(result.body, "contactConsent"), false);
  assert.equal(Object.hasOwn(result.body, "requestId"), false);
  assert.equal(result.response.headers["cache-control"], "no-store, max-age=0");
  assert.equal(JSON.stringify(result.body).includes("ZZZ"), true);
});

test("fixture rejects Production, unstamped source, and mismatched projects", async () => {
  for (const selectedEnvironment of [
    environment({ DEPLOYMENT_ENVIRONMENT: "production" }),
    environment({ SOURCE_REVISION: "a".repeat(40) })
  ]) {
    const result = await invoke({ selectedEnvironment });
    assert.equal(result.response.statusCode, 503);
    assert.equal(result.body.code, "configuration_invalid");
  }
  const mismatch = request();
  mismatch.headers["x-zc-projectid"] = "9999999999999999999";
  const result = await invoke({ selectedRequest: mismatch });
  assert.equal(result.response.statusCode, 503);
  assert.equal(result.body.code, "configuration_invalid");
});

test("fixture requires one dedicated protected header before body access", async () => {
  for (const values of [[], ["wrong"], [HEADER_SECRET, HEADER_SECRET]]) {
    const selected = request({
      headersDistinct: {
        "content-type": ["application/json"],
        "x-zc-environment": ["Development"],
        "x-zc-projectid": [PROJECT_ID],
        [HEADER_NAME]: values
      }
    });
    Object.defineProperty(selected, "rawBody", {
      get() {
        throw new Error("unauthenticated fixture must not inspect a request body");
      }
    });
    const result = await invoke({ selectedRequest: selected });
    assert.equal(result.response.statusCode, 401);
    assert.equal(result.body.code, "authentication_failed");
  }
});

test("fixture enforces a bounded absolute expiration before body access", async () => {
  assert.throws(
    () => loadConfig(environment({
      FIXTURE_EXPIRES_AT: new Date(NOW + MAX_ACTIVE_WINDOW_MS + 1).toISOString()
    }), ARTIFACT_REVISION, NOW),
    /four-hour safety window/
  );
  const selected = request();
  Object.defineProperty(selected, "rawBody", {
    get() {
      throw new Error("expired fixture must not inspect a request body");
    }
  });
  const result = await invoke({
    selectedEnvironment: environment({ FIXTURE_EXPIRES_AT: new Date(NOW).toISOString() }),
    selectedRequest: selected
  });
  assert.equal(result.response.statusCode, 410);
  assert.equal(result.body.code, "fixture_expired");
});

test("fixture accepts only the exact synthetic prefill probe", async () => {
  for (const body of [
    {},
    { prefillHandle: "real-looking-value" },
    { prefillHandle: PROBE_VALUE, extra: "not-allowed" },
    { prefillHandle: null }
  ]) {
    const result = await invoke({
      selectedRequest: request({ rawBody: Buffer.from(JSON.stringify(body)) })
    });
    assert.equal(result.response.statusCode, 422);
    assert.equal(result.body.code, "request_invalid");
  }
});

test("fixture rejects query strings, alternate methods, and unsupported media", async () => {
  const duplicatedEncoding = request({
    headersDistinct: {
      "content-type": ["application/json"],
      "content-encoding": ["identity", "identity"],
      "x-zc-environment": ["Development"],
      "x-zc-projectid": [PROJECT_ID],
      [HEADER_NAME]: [HEADER_SECRET]
    }
  });
  const cases = [
    [request({ url: `${PATH}?probe=1` }), 404, "route_not_found"],
    [request({ method: "GET" }), 405, "method_not_allowed"],
    [request({ headers: { ...request().headers, "content-type": "text/plain" } }),
      415, "content_type_not_allowed"],
    [duplicatedEncoding, 415, "content_encoding_not_allowed"]
  ];
  for (const [selectedRequest, status, code] of cases) {
    const result = await invoke({ selectedRequest });
    assert.equal(result.response.statusCode, status);
    assert.equal(result.body.code, code);
  }
});

test("bounded streamed request bodies remain independently testable", async () => {
  const stream = new EventEmitter();
  Object.assign(stream, request({ rawBody: undefined }), {
    removeListener: EventEmitter.prototype.removeListener,
    resume() {}
  });
  const pending = invoke({ selectedRequest: stream });
  stream.emit("data", Buffer.from(JSON.stringify({ prefillHandle: PROBE_VALUE })));
  stream.emit("end");
  const result = await pending;
  assert.equal(result.response.statusCode, 200);
  assert.deepEqual(result.body, FORM1_PREFILL_MAPPING_SAMPLE);
});
