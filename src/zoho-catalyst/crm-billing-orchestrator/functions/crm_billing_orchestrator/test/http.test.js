"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { requestJson, HttpBoundaryError } = require("../lib/http");

const boundary = { timeoutMs: 50, maximumBytes: 64, sideEffecting: true };
const unknownWrite = error => error instanceof HttpBoundaryError
  && error.ambiguous === true && error.publicCode === "reconciliation_required";

test("headers do not end the deadline; stalled read is cancelled without waiting for cancellation", async () => {
  let signal, reads = 0, cancels = 0, release;
  // Cold Headers initialization belongs to fixture setup, not the body deadline.
  const headers = new Headers();
  const output = requestJson("https://synthetic.invalid", { method: "POST" }, boundary,
    async (_url, options) => {
      signal = options.signal;
      return { status: 200, headers, body: { getReader: () => ({
        read() { reads += 1; return new Promise(resolve => { release = resolve; }); },
        cancel() { cancels += 1; return new Promise(() => {}); },
        releaseLock() {},
      }) }, arrayBuffer() { assert.fail("Never buffer the full response"); } };
    });
  await assert.rejects(output, unknownWrite);
  assert.equal(signal.aborted, true);
  assert.equal(cancels, 1);
  release({ done: false, value: Buffer.from("{}") });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
});

test("late headers are cancelled and never read after a single timed-out dispatch", async () => {
  let calls = 0, signal, release, cancelled = 0;
  const output = requestJson("https://synthetic.invalid", { method: "POST" }, boundary,
    async (_url, options) => {
      calls += 1; signal = options.signal;
      return new Promise(resolve => { release = resolve; });
    });
  await assert.rejects(output, unknownWrite);
  assert.equal(signal.aborted, true);
  release({ status: 200, body: {
    cancel() { cancelled += 1; }, getReader() { assert.fail("No late body read"); },
  } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(cancelled, 1);
});

test("actual stream bytes are bounded before full buffering; oversized chunk cancels before another read", async () => {
  for (const parts of [[Buffer.alloc(65)], [Buffer.alloc(32), Buffer.alloc(33)]]) {
    let reads = 0, cancels = 0, signal;
    await assert.rejects(requestJson("https://synthetic.invalid", {}, boundary,
      async (_url, options) => {
        signal = options.signal;
        return { status: 200, headers: new Headers(), body: { getReader: () => ({
          async read() { const value = parts[reads++]; assert.ok(value); return { done: false, value }; },
          cancel() { cancels += 1; }, releaseLock() {},
        }) }, arrayBuffer() { assert.fail("Unbounded buffer path"); } };
      }), unknownWrite);
    assert.equal(reads, parts.length); assert.equal(cancels, 1); assert.equal(signal.aborted, true);
  }
});

test("invalid or oversized declared size cancels the unread body", async () => {
  for (const length of ["65", "invalid"]) {
    let cancelled = 0;
    await assert.rejects(requestJson("https://synthetic.invalid", {}, boundary, async () => ({
      status: 200, headers: new Headers({ "content-length": length }), body: {
        cancel() { cancelled += 1; }, getReader() { assert.fail("Rejected before read"); },
      },
    })), unknownWrite);
    assert.equal(cancelled, 1);
  }
});

test("exact byte limit and split Unicode remain readable; empty and non-success responses preserve status", async () => {
  const bytes = Buffer.from(JSON.stringify({ text: "é" }));
  let part = 0;
  const response = new Response(new ReadableStream({ pull(controller) {
    if (part < bytes.length) controller.enqueue(bytes.subarray(part, ++part));
    else controller.close();
  } }), { status: 400 });
  assert.deepEqual(await requestJson("https://synthetic.invalid", {},
    { ...boundary, timeoutMs: 1000, maximumBytes: bytes.length }, async () => response),
  { status: 400, json: { text: "é" } });
  assert.deepEqual(await requestJson("https://synthetic.invalid", {}, boundary,
    async () => new Response(null, { status: 204 })), { status: 204, json: null });
});

test("invalid JSON, malformed UTF8 and unavailable stream keep read/write error classification", async () => {
  for (const sideEffecting of [true, false]) {
    for (const make of [() => new Response("{bad"), () => new Response(Buffer.from([255])),
      () => ({ status: 200, headers: new Headers(), arrayBuffer() { assert.fail("No fallback"); } })]) {
      await assert.rejects(requestJson("https://synthetic.invalid", {},
        { ...boundary, sideEffecting }, async () => make()), error =>
        error.ambiguous === sideEffecting
          && error.publicCode === (sideEffecting ? "reconciliation_required" : "dependency_failed"));
    }
  }
});

test("monotonic deadline rejects a late body even before the timer can run", async () => {
  let signal, cancelled = 0;
  await assert.rejects(requestJson("https://synthetic.invalid", {}, { ...boundary, timeoutMs: 10 },
    async (_url, options) => {
      signal = options.signal;
      return { status: 200, headers: new Headers(), body: { getReader: () => ({
        async read() { const end = performance.now() + 30; while (performance.now() < end) {}
          return { done: false, value: Buffer.from("{}") }; },
        cancel() { cancelled += 1; }, releaseLock() {},
      }) } };
    }), unknownWrite);
  assert.equal(signal.aborted, true); assert.equal(cancelled, 1);
});
