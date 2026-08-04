"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const { handleBillingWebhook } = require("../lib/handler");
const {
  TEST_EVENT_TIME,
  TEST_NOW_MS,
  baseEnvironment,
  creatorEnvironment,
} = require("./helpers");

function signedRequest(config, payload, overrides = {}) {
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = crypto
    .createHmac("sha256", config.webhookSecrets[0])
    .update(rawBody)
    .digest(config.signatureEncoding);
  return {
    method: "POST",
    url: config.allowedPath,
    rawBody,
    headers: {
      "content-type": config.contentType,
      "content-length": String(rawBody.length),
      "x-zoho-webhook-signature": signature,
    },
    ...overrides,
  };
}

function payload() {
  return {
    event_id: "event_sample_001",
    event_type: "subscription_created",
    event_time: TEST_EVENT_TIME,
    data: {
      plan_code: "starter",
      status: "active",
      customer_email: "person@example.invalid",
    },
  };
}

function storeFixture(outcome = "claimed", { markError = null } = {}) {
  const calls = { claim: [], mark: [] };
  return {
    calls,
    store: {
      async claim(input) {
        calls.claim.push(input);
        return { outcome, rowId: "1000000000001" };
      },
      async mark(...args) {
        calls.mark.push(args);
        if (markError) throw markError;
      },
    },
  };
}

function dependencies(config, store, creatorClient = null) {
  return { config, creatorClient, store, nowMs: TEST_NOW_MS };
}

test("Development register-only mode succeeds after durable completion", async () => {
  const config = loadConfig(baseEnvironment(), { nowMs: TEST_NOW_MS });
  const { calls, store } = storeFixture();
  const result = await handleBillingWebhook(
    signedRequest(config, payload()),
    dependencies(config, store),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.accepted, true);
  assert.equal(calls.claim[0].sourceEventId, "event_sample_001");
  assert.equal(calls.claim[0].eventFingerprint.length, 64);
  assert.deepEqual(calls.mark, [["1000000000001", "completed", "registered_only"]]);
});

test("wrong routes and invalid signatures fail before a durable claim", async () => {
  const config = loadConfig(baseEnvironment(), { nowMs: TEST_NOW_MS });
  const routeStore = storeFixture();
  await assert.rejects(
    handleBillingWebhook(
      signedRequest(config, payload(), { url: "/other" }),
      dependencies(config, routeStore.store),
    ),
    (error) => error.publicCode === "route_not_found",
  );
  assert.equal(routeStore.calls.claim.length, 0);

  const signatureStore = storeFixture();
  const request = signedRequest(config, payload());
  request.headers["x-zoho-webhook-signature"] = "0".repeat(64);
  await assert.rejects(
    handleBillingWebhook(request, dependencies(config, signatureStore.store)),
    (error) => error.publicCode === "authentication_failed",
  );
  assert.equal(signatureStore.calls.claim.length, 0);
});

test("only exact completed duplicates are acknowledged", async () => {
  const config = loadConfig(baseEnvironment(), { nowMs: TEST_NOW_MS });
  const completed = storeFixture("duplicate-completed");
  const completedResult = await handleBillingWebhook(
    signedRequest(config, payload()),
    dependencies(config, completed.store),
  );
  assert.equal(completedResult.body.duplicate, true);

  for (const outcome of ["duplicate-unresolved", "duplicate-conflict"]) {
    const unresolved = storeFixture(outcome);
    const result = await handleBillingWebhook(
      signedRequest(config, payload()),
      dependencies(config, unresolved.store),
    );
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "reconciliation_required");
  }
});

test("Creator receives the minimum source reference plus allowlisted fields", async () => {
  const config = loadConfig(creatorEnvironment(), { nowMs: TEST_NOW_MS });
  const captured = [];
  const creatorClient = {
    async deliver(envelope) {
      captured.push(envelope);
      return { confirmed: true };
    },
  };
  const { calls, store } = storeFixture();
  const result = await handleBillingWebhook(
    signedRequest(config, payload()),
    dependencies(config, store, creatorClient),
  );
  assert.equal(result.status, 200);
  assert.equal(captured[0].billing_event_id, "event_sample_001");
  assert.equal(captured[0].billing_event_time, TEST_EVENT_TIME);
  assert.deepEqual(Object.keys(captured[0].fields).sort(), ["data.plan_code", "data.status"]);
  assert.doesNotMatch(JSON.stringify(captured), /customer_email|person@|signature/);
  assert.deepEqual(
    calls.mark,
    [["1000000000001", "completed", "creator_readback_confirmed"]],
  );
});

test("an uncertain Creator outcome requires a confirmed reconciliation mark", async () => {
  const config = loadConfig(creatorEnvironment(), { nowMs: TEST_NOW_MS });
  const { calls, store } = storeFixture();
  const result = await handleBillingWebhook(
    signedRequest(config, payload()),
    dependencies(config, store, { async deliver() { throw new Error("synthetic timeout"); } }),
  );
  assert.equal(result.status, 503);
  assert.deepEqual(calls.mark, [[
    "1000000000001",
    "reconciliation_required",
    "downstream_outcome_unknown",
  ]]);

  const failedMark = storeFixture("claimed", { markError: new Error("synthetic readback failure") });
  await assert.rejects(
    handleBillingWebhook(
      signedRequest(config, payload()),
      dependencies(
        config,
        failedMark.store,
        { async deliver() { throw new Error("synthetic timeout"); } },
      ),
    ),
    /synthetic readback failure/,
  );
});

test("a completion readback failure is never acknowledged", async () => {
  const config = loadConfig(creatorEnvironment(), { nowMs: TEST_NOW_MS });
  const failedMark = storeFixture("claimed", { markError: new Error("synthetic mismatch") });
  const result = await handleBillingWebhook(
    signedRequest(config, payload()),
    dependencies(config, failedMark.store, { async deliver() { return { confirmed: true }; } }),
  );
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "reconciliation_required");
});
