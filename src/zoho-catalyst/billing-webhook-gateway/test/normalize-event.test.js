"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventValidationError, normalizeEvent } = require("../lib/normalize-event");
const { TEST_EVENT_TIME, TEST_NOW_MS } = require("./helpers");

const config = {
  deploymentEnvironment: "development",
  billingSourceKey: "SyntheticBillingSource",
  eventFingerprintSecret: "SyntheticFingerprintSecretValue123456",
  maxEventAgeSeconds: 604800,
  maxFutureSkewSeconds: 300,
  allowedEventTypes: Object.freeze(["subscription_created"]),
  creatorFieldAllowlist: Object.freeze(["data.plan_code", "data.active", "data.quantity"]),
};

function normalize(payload, rawText = JSON.stringify(payload)) {
  return normalizeEvent(payload, config, {
    rawBody: Buffer.from(rawText, "utf8"),
    nowMs: TEST_NOW_MS,
  });
}

test("normalizes the minimum reconciliation contract and only allowlisted fields", () => {
  const payload = {
    event_id: "event_sample_001",
    event_type: "subscription_created",
    event_time: TEST_EVENT_TIME,
    data: {
      plan_code: "starter",
      active: true,
      quantity: 2,
      customer_email: "person@example.invalid",
      nested: { private: "excluded" },
    },
  };
  const event = normalize(payload);
  assert.equal(event.eventKey.length, 64);
  assert.equal(event.eventFingerprint.length, 64);
  assert.equal(event.sourceEventId, "event_sample_001");
  assert.equal(event.downstreamEnvelope.billing_event_id, "event_sample_001");
  assert.equal(event.downstreamEnvelope.billing_event_time, TEST_EVENT_TIME);
  assert.deepEqual({ ...event.downstreamEnvelope.fields }, {
    "data.plan_code": "starter",
    "data.active": true,
    "data.quantity": 2,
  });
  assert.doesNotMatch(JSON.stringify(event.downstreamEnvelope), /customer_email|person@/);
});

test("keyed fingerprints ignore transport formatting and detect semantic conflicts", () => {
  const payload = {
    event_id: "event_sample_001",
    event_type: "subscription_created",
    event_time: TEST_EVENT_TIME,
  };
  const compact = normalize(payload);
  const spaced = normalize(payload, JSON.stringify(payload, null, 2));
  assert.equal(compact.eventKey, spaced.eventKey);
  assert.equal(compact.eventFingerprint, spaced.eventFingerprint);
  const changed = normalize({
    ...payload,
    event_time: "2026-08-04T11:58:00Z",
  });
  assert.notEqual(compact.eventFingerprint, changed.eventFingerprint);
});

test("rejects stale, future, malformed, and incomplete event timestamps", () => {
  for (const eventTime of [
    undefined,
    "2026-08-04",
    "August 4, 2026 11:59 UTC",
    "2026-02-30T00:00:00Z",
    "2026-07-20T11:59:00Z",
    "2026-08-04T12:06:00Z",
  ]) {
    const payload = {
      event_id: "event_sample_001",
      event_type: "subscription_created",
      event_time: eventTime,
    };
    assert.throws(() => normalize(payload), EventValidationError);
  }
  assert.equal(normalize({
    event_id: "event_sample_001",
    event_type: "subscription_created",
    event_time: "2026-08-04T04:59:00-0700",
  }).eventType, "subscription_created");
});

test("rejects missing IDs, unknown events, and unsafe selected values", () => {
  assert.throws(
    () => normalize({ event_type: "subscription_created", event_time: TEST_EVENT_TIME }),
    EventValidationError,
  );
  assert.throws(
    () => normalize({
      event_id: "event_sample_001",
      event_type: "invented_event",
      event_time: TEST_EVENT_TIME,
    }),
    EventValidationError,
  );
  assert.throws(
    () => normalize({
      event_id: "event_sample_001",
      event_type: "subscription_created",
      event_time: TEST_EVENT_TIME,
      data: { plan_code: { nested: true } },
    }),
    EventValidationError,
  );
  assert.throws(
    () => normalize({
      event_id: "event_sample_001",
      event_type: "subscription_created",
      event_time: TEST_EVENT_TIME,
      data: { quantity: 1.25 },
    }),
    EventValidationError,
  );
});
