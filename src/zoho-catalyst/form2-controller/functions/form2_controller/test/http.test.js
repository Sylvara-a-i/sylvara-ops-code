"use strict";

const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const test = require("node:test");
const {
  HttpBoundaryError,
  getHeader,
  parseJsonObject,
  readRawBody,
  validateJsonPost,
} = require("../lib/http");

function request(body, overrides = {}) {
  const stream = Readable.from([Buffer.from(body)]);
  stream.method = "POST";
  stream.url = "/synthetic-prefill";
  stream.headers = {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
  };
  return Object.assign(stream, overrides);
}

test("accepts one exact JSON POST route and parses a bounded object", async () => {
  const input = request('{"setup_token":"synthetic"}');
  const path = validateJsonPost(input, new Set(["/synthetic-prefill"]));
  const raw = await readRawBody(input, { maximumBytes: 1024, timeoutMs: 100 });
  assert.equal(path, "/synthetic-prefill");
  assert.deepEqual(parseJsonObject(raw), { setup_token: "synthetic" });
});

test("rejects query strings, wrong methods, and non-JSON content", () => {
  assert.throws(
    () => validateJsonPost(request("{}", { url: "/synthetic-prefill?token=unsafe" }), new Set(["/synthetic-prefill"])),
    (error) => error instanceof HttpBoundaryError && error.publicCode === "route_not_found",
  );
  assert.throws(
    () => validateJsonPost(request("{}", { method: "GET" }), new Set(["/synthetic-prefill"])),
    (error) => error.publicCode === "method_not_allowed",
  );
  assert.throws(
    () => validateJsonPost(request("{}", { headers: { "content-type": "text/plain" } }), new Set(["/synthetic-prefill"])),
    (error) => error.publicCode === "content_type_not_allowed",
  );
});

test("rejects oversized streamed bodies and JSON arrays", async () => {
  const input = request('{"value":"too-long"}', {
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(
    readRawBody(input, { maximumBytes: 4, timeoutMs: 100 }),
    (error) => error.publicCode === "body_too_large",
  );
  assert.throws(() => parseJsonObject(Buffer.from("[]")), /JSON object/);
});

test("header lookup is case-insensitive and rejects duplicate casing", () => {
  assert.equal(getHeader({ headers: { "X-Synthetic": "one" } }, "x-synthetic"), "one");
  assert.equal(
    getHeader({ headers: { "X-Synthetic": "one", "x-synthetic": "two" } }, "x-synthetic"),
    undefined,
  );
});
