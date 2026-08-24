"use strict";

const crypto = require("node:crypto");

const REVISION = "a".repeat(40);
const DEVELOPMENT_RUNTIME_PROOF = "r".repeat(64);
const SYNTHETIC_DEVELOPMENT_ZAID = "synthetic-development-zaid";
const DEVELOPMENT_ZAID_HMAC_SHA256 = crypto
  .createHmac("sha256", DEVELOPMENT_RUNTIME_PROOF)
  .update(SYNTHETIC_DEVELOPMENT_ZAID, "utf8")
  .digest("hex");

function baseEnvironment(overrides = {}) {
  return {
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
    CUSTOMER_PROVISIONING_MODE: "native_crm_import",
    ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "false",
    CRM_READ_CONNECTION_LINK_NAME: "CrmRead",
    CRM_WRITE_CONNECTION_LINK_NAME: "CrmWrite",
    BILLING_READ_CONNECTION_LINK_NAME: "BillingRead",
    BILLING_WRITE_CONNECTION_LINK_NAME: "BillingWrite",
    OPERATION_TABLE: "LifecycleOperations",
    DATASTORE_DUPLICATE_ERROR_CODES: "DUPLICATE",
    IDEMPOTENCY_PEPPER: "p".repeat(32),
    EVALUATION_PLAN_CODE: "evaluation_plan",
    ENABLE_PAID_SUBSCRIPTION_PREPARATION: "false",
    PAID_PLAN_CODE_MAP: "{}",
    PAID_ACCEPTANCE_VALUE: "Accepted",
    REVENUE_DESK_PIPELINE_VALUE: "Revenue Desk Sales",
    FREE_TEST_ENTRY_OFFER_VALUE: "Free Test",
    INITIAL_SALE_TYPE_VALUE: "Initial Sale",
    SETUP_QA_STAGE_VALUE: "Setup and QA",
    TEST_LIVE_STAGE_VALUE: "Test Live",
    RESULTS_REVIEW_STAGE_VALUE: "Results Review",
    SUBSCRIPTION_PROPOSED_STAGE_VALUE: "Subscription Proposed",
    CLOSED_LOST_STAGE_VALUE: "Closed Lost",
    GO_LIVE_APPROVED_VALUE: "Approved",
    TEST_COMPLETED_STATUS_VALUE: "Completed",
    PAID_READY_STATUS_VALUE: "Paid Ready",
    FREE_TEST_DURATION_DAYS: "7",
    FREE_TEST_CALL_LIMIT: "17",
    MAX_BODY_BYTES: "2048",
    OUTBOUND_TIMEOUT_MS: "1000",
    OUTBOUND_MAX_BYTES: "65536",
    PLATFORM_OPERATION_TIMEOUT_MS: "1000",
    ...overrides,
  };
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
  REVISION,
  SYNTHETIC_DEVELOPMENT_ZAID,
  baseEnvironment,
  jsonResponse,
};
