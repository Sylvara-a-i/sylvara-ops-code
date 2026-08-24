"use strict";

const { destinationDigest } = require("../lib/destinations");

const TEST_NOW_MS = Date.parse("2026-08-04T12:00:00Z");
const TEST_EVENT_TIME = "2026-08-04T11:59:00Z";
const TEST_SOURCE_REVISION = "a".repeat(40);
const CREATOR_FORWARD_URL =
  "https://www.zohoapis.com/creator/custom/sylvara/billing_gateway";
const CREATOR_DESTINATION_SHA256 = destinationDigest(CREATOR_FORWARD_URL);

function baseEnvironment(overrides = {}) {
  return {
    DEPLOYMENT_ENVIRONMENT: "development",
    BILLING_SOURCE_TIER: "test",
    SOURCE_REVISION: TEST_SOURCE_REVISION,
    ALLOWED_PATH: "/billing/events",
    BILLING_CONTENT_TYPE: "application/json",
    BILLING_SIGNATURE_ENCODING: "hex",
    BILLING_WEBHOOK_SECRET: "SyntheticBillingSecret1234",
    BILLING_WEBHOOK_SECRET_PREVIOUS: "",
    BILLING_WEBHOOK_SECRET_PREVIOUS_EXPIRES_AT: "",
    BILLING_EVENT_FINGERPRINT_SECRET: "SyntheticFingerprintSecretValue123456",
    BILLING_SOURCE_KEY: "SyntheticBillingSource",
    ALLOWED_EVENT_TYPES: "subscription_created,payment_declined",
    BILLING_MAX_EVENT_AGE_SECONDS: "604800",
    BILLING_MAX_FUTURE_SKEW_SECONDS: "300",
    MAX_BODY_BYTES: "262144",
    INBOUND_BODY_TIMEOUT_MS: "5000",
    PLATFORM_OPERATION_TIMEOUT_MS: "3000",
    EXECUTION_BUDGET_MS: "25000",
    EVENT_INBOX_TABLE: "Billing_Webhook_Inbox",
    DATASTORE_DUPLICATE_ERROR_CODES: "DUPLICATE_SAMPLE",
    DELIVERY_MODE: "register-only",
    OUTBOUND_TIMEOUT_MS: "5000",
    MAX_OUTBOUND_BODY_BYTES: "65536",
    REQUIRE_SHARED_HEADER: "false",
    SHARED_HEADER_NAME: "",
    SHARED_HEADER_VALUE: "",
    ...overrides,
  };
}

function creatorEnvironment(overrides = {}) {
  return baseEnvironment({
    DELIVERY_MODE: "creator",
    CREATOR_FIELD_ALLOWLIST: "data.plan_code,data.status",
    CREATOR_FORWARD_URL,
    CREATOR_ENDPOINT_KIND: "custom-api",
    CREATOR_TARGET_ENVIRONMENT: "development",
    CREATOR_CONNECTION_LINK_NAME: "SyntheticCreatorConnection",
    ...overrides,
  });
}

module.exports = {
  CREATOR_DESTINATION_SHA256,
  CREATOR_FORWARD_URL,
  TEST_EVENT_TIME,
  TEST_NOW_MS,
  TEST_SOURCE_REVISION,
  baseEnvironment,
  creatorEnvironment,
};
