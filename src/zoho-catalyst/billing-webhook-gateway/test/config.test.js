"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ConfigurationError, loadConfig } = require("../lib/config");
const {
  TEST_NOW_MS,
  baseEnvironment,
  creatorEnvironment,
} = require("./helpers");

function load(environment) {
  return loadConfig(environment, { nowMs: TEST_NOW_MS });
}

test("loads an immutable fail-closed registration configuration", () => {
  const config = load(baseEnvironment());
  assert.equal(config.deliveryMode, "register-only");
  assert.equal(config.billingSourceTier, "test");
  assert.equal(config.maxBodyBytes, 262144);
  assert.deepEqual(config.allowedEventTypes, ["subscription_created", "payment_declined"]);
  assert.equal(config.creatorUrl, undefined);
  assert.throws(() => config.allowedEventTypes.push("payment_voided"), TypeError);
});

test("enforces Zoho Billing's 12-50 alphanumeric signing-secret contract", () => {
  assert.equal(load(baseEnvironment({ BILLING_WEBHOOK_SECRET: "Abcdef123456" }))
    .webhookSecrets[0], "Abcdef123456");
  for (const secret of ["Abcde123456", "A".repeat(51), "Not-valid-secret!"]) {
    assert.throws(
      () => load(baseEnvironment({ BILLING_WEBHOOK_SECRET: secret })),
      ConfigurationError,
    );
  }
});

test("enforces a bounded previous-secret rotation window", () => {
  const previous = "PreviousSecret1234";
  const active = load(baseEnvironment({
    BILLING_WEBHOOK_SECRET_PREVIOUS: previous,
    BILLING_WEBHOOK_SECRET_PREVIOUS_EXPIRES_AT: "2026-08-10T12:00:00Z",
  }));
  assert.equal(active.webhookSecrets.length, 2);

  const expired = load(baseEnvironment({
    BILLING_WEBHOOK_SECRET_PREVIOUS: previous,
    BILLING_WEBHOOK_SECRET_PREVIOUS_EXPIRES_AT: "2026-08-03T12:00:00Z",
  }));
  assert.equal(expired.webhookSecrets.length, 1);

  assert.throws(
    () => load(baseEnvironment({ BILLING_WEBHOOK_SECRET_PREVIOUS: previous })),
    ConfigurationError,
  );
  assert.throws(
    () => load(baseEnvironment({
      BILLING_WEBHOOK_SECRET_PREVIOUS: previous,
      BILLING_WEBHOOK_SECRET_PREVIOUS_EXPIRES_AT: "2026-08-12T12:00:01Z",
    })),
    ConfigurationError,
  );
  for (const invalidExpiry of [
    "2026-02-30T00:00:00Z",
    "2026-08-05T24:00:00Z",
    "2026-08-05T12:00:00+14:01",
  ]) {
    assert.throws(
      () => load(baseEnvironment({
        BILLING_WEBHOOK_SECRET_PREVIOUS: previous,
        BILLING_WEBHOOK_SECRET_PREVIOUS_EXPIRES_AT: invalidExpiry,
      })),
      ConfigurationError,
    );
  }
});

test("requires verified encodings and a composite budget below the runtime limit", () => {
  for (const overrides of [
    { BILLING_SIGNATURE_ENCODING: "" },
    { MAX_BODY_BYTES: "NaN" },
    { MAX_BODY_BYTES: "999999999" },
    {
      DELIVERY_MODE: "creator",
      CREATOR_FIELD_ALLOWLIST: "",
      CREATOR_FORWARD_URL: "https://creator.example.invalid/creator/custom/sylvara/billing_gateway",
      CREATOR_ALLOWED_HOSTS: "creator.example.invalid",
      CREATOR_ENDPOINT_KIND: "custom-api",
      CREATOR_TARGET_ENVIRONMENT: "development",
      CREATOR_CONNECTION_LINK_NAME: "SyntheticCreatorConnection",
      INBOUND_BODY_TIMEOUT_MS: "5000",
      PLATFORM_OPERATION_TIMEOUT_MS: "4000",
      OUTBOUND_TIMEOUT_MS: "6000",
      EXECUTION_BUDGET_MS: "25000",
    },
  ]) {
    assert.throws(() => load(baseEnvironment(overrides)), ConfigurationError);
  }
});

test("retired and weakening variables fail startup", () => {
  for (const overrides of [
    { ENABLE_PING: "false" },
    { FORWARD_RAW_PAYLOAD: "true" },
    { REQUIRE_SIGNATURE: "false" },
    { ENABLE_REPLAY_DEFENSE: "false" },
    { CREATOR_ALLOWED_HOST_SUFFIXES: "example.invalid" },
    { ["ZOHO_REFRESH" + "_TOKEN"]: "legacy-value" },
  ]) {
    assert.throws(() => load(baseEnvironment(overrides)), ConfigurationError);
  }
});

test("Creator mode requires an exact Custom API target and approved environment mapping", () => {
  const config = load(creatorEnvironment());
  assert.equal(
    config.creatorUrl,
    "https://creator.example.invalid/creator/custom/sylvara/billing_gateway",
  );
  assert.equal(config.creatorConnectionLinkName, "SyntheticCreatorConnection");

  for (const overrides of [
    { CREATOR_FORWARD_URL: "https://other.example.invalid/creator/custom/sylvara/billing_gateway" },
    { CREATOR_FORWARD_URL: "https://creator.example.invalid:444/creator/custom/sylvara/billing_gateway" },
    { CREATOR_FORWARD_URL: "https://creator.example.invalid/arbitrary/path" },
    { CREATOR_FORWARD_URL: "https://creator.example.invalid/creator/custom/sylvara/billing_gateway?mode=test" },
    { CREATOR_ENDPOINT_KIND: "data-api" },
    { CREATOR_FIELD_ALLOWLIST: "event_id" },
  ]) {
    assert.throws(() => load(creatorEnvironment(overrides)), ConfigurationError);
  }
  assert.equal(
    load(creatorEnvironment({ CREATOR_TARGET_ENVIRONMENT: "stage" }))
      .creatorTargetEnvironment,
    "stage",
  );
  assert.throws(
    () => load(creatorEnvironment({ CREATOR_TARGET_ENVIRONMENT: "production" })),
    ConfigurationError,
  );
});

test("Production remains code-blocked until external contracts are proven", () => {
  assert.throws(
    () => load(baseEnvironment({ DEPLOYMENT_ENVIRONMENT: "production" })),
    ConfigurationError,
  );
  assert.throws(
    () => load(baseEnvironment({
      DEPLOYMENT_ENVIRONMENT: "production",
      BILLING_SOURCE_TIER: "live",
    })),
    ConfigurationError,
  );
  assert.throws(
    () => load(creatorEnvironment({
      DEPLOYMENT_ENVIRONMENT: "production",
      BILLING_SOURCE_TIER: "live",
      CREATOR_TARGET_ENVIRONMENT: "production",
    })),
    ConfigurationError,
  );
});
