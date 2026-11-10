"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createCrmClient } = require("../lib/crm-client");
const { loadConfig } = require("../lib/config");
const { REVISION, baseEnvironment, jsonResponse } = require("./helpers");

const token = `Zoho-oauthtoken ${"t".repeat(24)}`;
const deal = Object.freeze({ id: "10000001", Modified_Time: "2026-09-08T00:01:00+00:00" });
const patch = Object.freeze({ Test_Status: "Completed", Test_End_At: "2026-09-08T00:00:00+00:00",
  Test_End_Reason: "Seven-Day Limit Reached" });
const acknowledgement = { data: [{ status: "success", code: "SUCCESS", details: { id: deal.id } }] };

function setup(fetchImpl) {
  const config = loadConfig(baseEnvironment({ OUTBOUND_TIMEOUT_MS: "250", OUTBOUND_MAX_BYTES: "4096" }),
    { artifactRevision: REVISION });
  const calls = [];
  const client = createCrmClient(config, { readAuthorizationProvider: async () => token,
    writeAuthorizationProvider: async () => token, fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return fetchImpl(url, options, calls.length);
    } });
  return { client, calls };
}

const invoke = (client, write) => write ? client.updateDealExpiryClosure(deal, patch)
  : client.getExpiryClosureContext(deal.id);
const failure = write => error => error.ambiguous === write
  && error.publicCode === (write ? "reconciliation_required" : "crm_dependency_failed");

for (const write of [false, true]) {
  const name = write ? "write" : "read";

  test(`expiry ${name} deadline includes the body and never waits for cancellation`, { timeout: 2000 }, async () => {
    let cancelCount = 0, readCount = 0, release;
    const headers = new Headers();
    const h = setup(async () => ({ status: 200, headers, body: { getReader: () => ({
      read() { readCount += 1; return new Promise(resolve => { release = resolve; }); },
      cancel() { cancelCount += 1; return new Promise(() => {}); }, releaseLock() {},
    }) }, arrayBuffer() { assert.fail("Full response buffering is prohibited"); } }));
    await assert.rejects(invoke(h.client, write), failure(write));
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].options.signal.aborted, true);
    assert.equal(cancelCount, 1);
    release({ done: false, value: Buffer.from(JSON.stringify(acknowledgement)) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readCount, 1);
    assert.equal(h.calls.length, 1);
  });

  test(`expiry ${name} cancels late headers without reading or redispatching`, { timeout: 2000 }, async () => {
    let release, cancelCount = 0;
    const h = setup(() => new Promise(resolve => { release = resolve; }));
    await assert.rejects(invoke(h.client, write), failure(write));
    release({ status: 200, body: { cancel() { cancelCount += 1; },
      getReader() { assert.fail("Late body must not be read"); } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].options.signal.aborted, true);
    assert.equal(cancelCount, 1);
  });

  test(`expiry ${name} rejects oversized chunks before another body read`, async () => {
    for (const parts of [[4097], [4096, 1]]) {
      let reads = 0, cancelled = 0;
      const h = setup(async () => ({ status: 200, headers: new Headers(), body: { getReader: () => ({
        async read() { assert.ok(reads < parts.length); return { done: false, value: Buffer.alloc(parts[reads++]) }; },
        cancel() { cancelled += 1; }, releaseLock() {},
      }) }, arrayBuffer() { assert.fail("Full response buffering is prohibited"); } }));
      await assert.rejects(invoke(h.client, write), failure(write));
      assert.equal(reads, parts.length);
      assert.equal(cancelled, 1);
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0].options.signal.aborted, true);
    }
  });

  test(`expiry ${name} rejects declared excess before acquiring a reader`, async () => {
    let cancelled = 0;
    const h = setup(async () => ({ status: 200, headers: new Headers({ "content-length": "4097" }),
      body: { cancel() { cancelled += 1; }, getReader() { assert.fail("Oversized body must remain unread"); } } }));
    await assert.rejects(invoke(h.client, write), failure(write));
    assert.equal(cancelled, 1);
    assert.equal(h.calls.length, 1);
  });
}

test("expiry context stops after its single failing Account read", { timeout: 2000 }, async () => {
  let cancelled = 0;
  const h = setup(async (_url, _options, attempt) => attempt === 1
    ? jsonResponse(200, { data: [{ ...deal, Account_Name: { id: "10000002" } }] })
    : new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled += 1; } })));
  await assert.rejects(h.client.getExpiryClosureContext(deal.id), failure(false));
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => call.options.method === "GET"));
  assert.equal(cancelled, 1);
});

test("expiry write accepts the exact byte cap without changing its three-field contract", async () => {
  const text = JSON.stringify(acknowledgement).padEnd(4096, " ");
  const h = setup(async () => new Response(text, { status: 200, headers: { "content-length": "4096" } }));
  await h.client.updateDealExpiryClosure(deal, patch);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.method, "PUT");
  assert.equal(h.calls[0].options.headers["If-Unmodified-Since"], deal.Modified_Time);
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { data: [{ id: deal.id, ...patch }], trigger: [],
    skip_feature_execution: [{ name: "cadences" }] });
});
