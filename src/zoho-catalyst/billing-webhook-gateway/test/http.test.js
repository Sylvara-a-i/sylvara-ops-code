"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const { createRequestListener } = require("../lib/catalyst-adapter");
const { HttpBoundaryError, readRawBody, requestJson } = require("../lib/http");
const {
  CREATOR_DESTINATION_SHA256,
  TEST_SOURCE_REVISION,
  baseEnvironment,
} = require("./helpers");

test("bounds direct and streamed request bodies", async () => {
  await assert.rejects(
    readRawBody({ rawBody: Buffer.alloc(5) }, { maximumBytes: 4, timeoutMs: 100 }),
    (error) => error instanceof HttpBoundaryError && error.publicCode === "body_too_large",
  );

  const stream = new PassThrough();
  const promise = readRawBody(stream, { maximumBytes: 4, timeoutMs: 100 });
  stream.end(Buffer.alloc(5));
  await assert.rejects(
    promise,
    (error) => error instanceof HttpBoundaryError && error.publicCode === "body_too_large",
  );
});

test("rejects oversized outbound responses before JSON parsing", async () => {
  const fetchImpl = async () => new Response("0123456789", {
    status: 200,
    headers: { "content-length": "10" },
  });
  await assert.rejects(
    requestJson(
      new URL("https://service.example.invalid/path"),
      { method: "POST" },
      { timeoutMs: 100, maximumBytes: 5, sideEffecting: true },
      fetchImpl,
    ),
    (error) => error instanceof HttpBoundaryError && error.ambiguous === true,
  );
});

test("classifies transport failure by side-effect boundary", async () => {
  const fetchImpl = async () => { throw new Error("synthetic transport failure"); };
  await assert.rejects(
    requestJson(
      new URL("https://service.example.invalid/path"),
      { method: "POST" },
      { timeoutMs: 100, maximumBytes: 100, sideEffecting: true },
      fetchImpl,
    ),
    (error) => error instanceof HttpBoundaryError && error.ambiguous === true,
  );
});

test("returns JSON 413 for an oversized chunked native request stream", async () => {
  const environment = baseEnvironment({ MAX_BODY_BYTES: "1024" });
  const catalystSdk = {
    initialize() {
      return {
        config: { environment: "Development" },
        datastore() {
          return { table() { return {}; } };
        },
        zcql() {
          return {};
        },
      };
    },
  };
  const logger = { info() {}, error() {} };
  const listener = createRequestListener({
    catalystSdk,
    environment,
    logger,
    randomUUID: () => "request_sample_oversized",
    now: () => 100,
    artifactCreatorDestinationSha256: CREATOR_DESTINATION_SHA256,
    artifactSourceRevision: TEST_SOURCE_REVISION,
  });
  const request = new PassThrough();
  Object.assign(request, {
    method: "POST",
    url: environment.ALLOWED_PATH,
    headers: {
      "content-type": environment.BILLING_CONTENT_TYPE,
      "x-zoho-webhook-signature": "0".repeat(64),
      "x-zc-environment": "Development",
    },
  });
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; },
  };
  const completion = listener(request, response);
  request.write(Buffer.alloc(600, "a"));
  request.write(Buffer.alloc(600, "b"));
  request.end();
  await completion;

  assert.equal(response.statusCode, 413);
  assert.match(response.headers["content-type"], /^application\/json\b/);
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    code: "body_too_large",
    request_id: "request_sample_oversized",
  });
});

test("returns JSON 413 for an oversized chunked native HTTP request", async (t) => {
  const environment = baseEnvironment({ MAX_BODY_BYTES: "1024" });
  const catalystSdk = {
    initialize() {
      return {
        config: { environment: "Development" },
        datastore() {
          return { table() { return {}; } };
        },
        zcql() {
          return {};
        },
      };
    },
  };
  const logger = { info() {}, error() {} };
  const listener = createRequestListener({
    catalystSdk,
    environment,
    logger,
    randomUUID: () => "request_sample_oversized_native",
    now: () => 100,
    artifactCreatorDestinationSha256: CREATOR_DESTINATION_SHA256,
    artifactSourceRevision: TEST_SOURCE_REVISION,
  });
  const server = http.createServer(listener);

  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip(`loopback bind is unavailable in this sandbox (${error.code})`);
      return;
    }
    throw error;
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const request = http.request({
        host: "127.0.0.1",
        port: server.address().port,
        path: environment.ALLOWED_PATH,
        method: "POST",
        headers: {
          "content-type": environment.BILLING_CONTENT_TYPE,
          "x-zoho-webhook-signature": "0".repeat(64),
          "x-zc-environment": "Development",
        },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          headers: response.headers,
          statusCode: response.statusCode,
        }));
      });
      request.on("error", reject);
      request.setTimeout(1000, () => {
        request.destroy(new Error("Native oversized-body response timed out"));
      });
      request.write(Buffer.alloc(600, "a"));
      request.write(Buffer.alloc(600, "b"));
      request.end();
    });

    assert.equal(result.statusCode, 413);
    assert.match(result.headers["content-type"], /^application\/json\b/);
    assert.deepEqual(JSON.parse(result.body), {
      ok: false,
      code: "body_too_large",
      request_id: "request_sample_oversized_native",
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
