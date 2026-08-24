"use strict";

const crypto = require("node:crypto");

const REVISION = "a".repeat(40);
const DEVELOPMENT_RUNTIME_PROOF = "r".repeat(64);
const SYNTHETIC_DEVELOPMENT_ZAID = "synthetic-development-zaid";
const DEVELOPMENT_ZAID_HMAC_SHA256 = crypto
  .createHmac("sha256", DEVELOPMENT_RUNTIME_PROOF)
  .update(SYNTHETIC_DEVELOPMENT_ZAID, "utf8")
  .digest("hex");
const PAID_TERMS_VARIABLE = ["PAID", "COMMERCIAL", "TERMS", "JSON"].join("_");

// Deliberately non-commercial fixture values prove exact matching without
// publishing the privately configured paid terms.
const SYNTHETIC_COMMERCIAL_TERMS = Object.freeze({
  currency: "USD",
  interval: 1,
  intervalUnit: "months",
  commonUsageRateMinor: 37,
  plans: Object.freeze({
    "Launch::Monthly": Object.freeze({ recurringMinor: 12345, setupMinor: 23456 }),
    "Growth::Monthly": Object.freeze({ recurringMinor: 34567, setupMinor: 45678 }),
    "Scale::Monthly": Object.freeze({ recurringMinor: 56789, setupMinor: 67890 }),
  }),
});

function baseEnvironment(overrides = {}) {
  const environment = {
    DEPLOYMENT_ENVIRONMENT: "development",
    SOURCE_REVISION: REVISION,
    DEVELOPMENT_FUNCTION_HOST: "synthetic.development.catalystserverless.com",
    DEVELOPMENT_RUNTIME_PROOF,
    ALLOWED_PATH: "/synthetic/crm-billing",
    SHARED_HEADER_NAME: "x-synthetic-lifecycle-key",
    SHARED_HEADER_VALUE: "s".repeat(32),
    CRM_API_BASE_URL: "https://www.zohoapis.com/crm/v8",
    BILLING_API_BASE_URL: "https://www.zohoapis.com/billing/v1",
    BILLING_ORGANIZATION_ID: "100000000000001",
    CUSTOMER_PROVISIONING_MODE: "test_direct_customer",
    ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "true",
    CRM_READ_CONNECTION_LINK_NAME: "CrmRead",
    CRM_WRITE_CONNECTION_LINK_NAME: "CrmWrite",
    BILLING_READ_CONNECTION_LINK_NAME: "BillingRead",
    BILLING_WRITE_CONNECTION_LINK_NAME: "BillingWrite",
    OPERATION_TABLE: "LifecycleOperations",
    DATASTORE_DUPLICATE_ERROR_CODES: "DUPLICATE",
    IDEMPOTENCY_PEPPER: "p".repeat(32),
    ENABLE_PAID_SUBSCRIPTION_PREPARATION: "true",
    PAID_PLAN_CODE_MAP: JSON.stringify({
      "Launch::Monthly": "launch_monthly",
      "Growth::Monthly": "growth_monthly",
      "Scale::Monthly": "scale_monthly",
    }),
    PAID_USAGE_ADDON_CODE: "connected_minute_usage",
    PAID_USAGE_ADDON_UNIT: "Connected AI minute",
    PAID_USAGE_ADDON_PRODUCT_ID: "400000000000001",
    PAID_SUBSCRIPTION_STATUS_MAP: JSON.stringify({ future: "Scheduled", live: "Active" }),
    PAID_ACCEPTANCE_VALUE: "Accepted",
    REVENUE_DESK_PIPELINE_VALUE: "Revenue Desk Sales",
    FREE_TEST_ENTRY_OFFER_VALUE: "Free Test",
    INITIAL_SALE_TYPE_VALUE: "Initial Sale",
    SUBSCRIPTION_PROPOSED_STAGE_VALUE: "Subscription Proposed",
    CLOSED_WON_STAGE_VALUE: "Closed Won",
    TEST_COMPLETED_STATUS_VALUE: "Completed",
    MAX_BODY_BYTES: "2048",
    OUTBOUND_TIMEOUT_MS: "1000",
    OUTBOUND_MAX_BYTES: "65536",
    PLATFORM_OPERATION_TIMEOUT_MS: "1000",
    ...overrides,
  };
  environment[PAID_TERMS_VARIABLE] = Object.hasOwn(overrides, PAID_TERMS_VARIABLE)
    ? overrides[PAID_TERMS_VARIABLE]
    : JSON.stringify(SYNTHETIC_COMMERCIAL_TERMS);
  return environment;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

module.exports = {
  DEVELOPMENT_RUNTIME_PROOF,
  DEVELOPMENT_ZAID_HMAC_SHA256,
  PAID_TERMS_VARIABLE,
  REVISION,
  SYNTHETIC_COMMERCIAL_TERMS,
  SYNTHETIC_DEVELOPMENT_ZAID,
  baseEnvironment,
  jsonResponse,
};
