"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const { CreatorDeliveryError, createCreatorClient } = require("../lib/creator-client");
const { TEST_EVENT_TIME, TEST_NOW_MS, creatorEnvironment } = require("./helpers");

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function envelope() {
  return {
    schema_version: 1,
    event_key: "f".repeat(64),
    billing_event_id: "event_sample_001",
    billing_event_time: TEST_EVENT_TIME,
    event_type: "subscription_created",
    fields: { "data.plan_code": "starter" },
  };
}

test("uses Catalyst Connection authorization and requires authoritative readback", async () => {
  const config = loadConfig(creatorEnvironment(), { nowMs: TEST_NOW_MS });
  const requests = [];
  let authorizationCalls = 0;
  const client = createCreatorClient(config, {
    authorizationProvider: async () => {
      authorizationCalls += 1;
      return "Zoho-oauthtoken SyntheticAccessToken1234";
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const body = JSON.parse(options.body);
      return jsonResponse({
        accepted: true,
        authoritative_readback: true,
        event_key: body.event_key,
      });
    },
  });

  await client.deliver(envelope());
  await client.deliver(envelope());
  assert.equal(authorizationCalls, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(requests[0].options.headers.environment, undefined);
  assert.equal(
    requests[0].url,
    "https://creator.example.invalid/creator/custom/sylvara/billing_gateway",
  );
});

test("missing or mismatched downstream readback is ambiguous", async () => {
  const config = loadConfig(creatorEnvironment(), { nowMs: TEST_NOW_MS });
  const client = createCreatorClient(config, {
    authorizationProvider: async () => "Zoho-oauthtoken SyntheticAccessToken1234",
    fetchImpl: async () => jsonResponse({
      accepted: true,
      authoritative_readback: false,
      event_key: "wrong",
    }),
  });
  await assert.rejects(
    client.deliver(envelope()),
    (error) => error instanceof CreatorDeliveryError && error.ambiguous === true,
  );
});

test("Connection authorization failure occurs before the side-effecting request", async () => {
  const config = loadConfig(creatorEnvironment(), { nowMs: TEST_NOW_MS });
  let fetchCalls = 0;
  const client = createCreatorClient(config, {
    authorizationProvider: async () => { throw new Error("synthetic connection failure"); },
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({});
    },
  });
  await assert.rejects(
    client.deliver(envelope()),
    (error) => error instanceof CreatorDeliveryError && error.ambiguous === false,
  );
  assert.equal(fetchCalls, 0);
});
