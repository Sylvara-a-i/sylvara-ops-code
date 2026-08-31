"use strict";

const crypto = require("node:crypto");

const REVISION = "1".repeat(40);
const SYNTHETIC_CRM_READ_LINK = "syntheticfixturevalue123456789";
const SYNTHETIC_CRM_WRITE_LINK = "syntheticbillingsecret1234";
const SYNTHETIC_CATALYST_PROJECT_ID = "100000000000001";
const SYNTHETIC_CATALYST_PROJECT_ID_SHA256 = crypto
  .createHash("sha256")
  .update(SYNTHETIC_CATALYST_PROJECT_ID, "utf8")
  .digest("hex");

function environment(overrides = {}) {
  return {
    DEPLOYMENT_ENVIRONMENT: "development",
    DEPLOYMENT_MODE: "active",
    EXPECTED_CATALYST_PROJECT_ID_SHA256: SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
    CRM_ORGANIZATION_ID_SHA256: "2".repeat(64),
    SOURCE_REVISION: REVISION,
    ZOHO_CATALYST_ZCQL_PARSER: "V2",
    ISSUE_PATH: "/form1/issue-test",
    ACCESS_PATH: "/form1/access-test",
    EXCHANGE_PATH: "/form1/exchange-test",
    PREFILL_PATH: "/form1/prefill-test",
    SUBMISSION_PATH: "/form1/submission-test",
    ISSUE_HEADER_NAME: "x-sylvara-issue-test",
    PREFILL_HEADER_NAME: "x-sylvara-prefill-test",
    SUBMISSION_HEADER_NAME: "x-sylvara-submission-test",
    ISSUE_HEADER_SECRET: "i".repeat(43),
    PREFILL_HEADER_SECRET: "p".repeat(43),
    SUBMISSION_HEADER_SECRET: "s".repeat(43),
    TOKEN_PEPPER: "t".repeat(43),
    PREFILL_HANDLE_PEPPER: "h".repeat(43),
    ISSUING_ACTOR_HASH: `operator_${"3".repeat(64)}`,
    FORM1_PUBLIC_URL: "https://forms.zohopublic.com/example/form/Request/formperma/example",
    FORM1_ACCESS_PUBLIC_URL:
      `https://synthetic.development.catalystserverless.com/sylvara-dev/${"A".repeat(43)}`,
    FORM1_PREFILL_HANDLE_FIELD_ALIAS: "AssistedPrefillHandle",
    CRM_READ_CONNECTION_LINK_NAME: SYNTHETIC_CRM_READ_LINK,
    CRM_WRITE_CONNECTION_LINK_NAME: SYNTHETIC_CRM_WRITE_LINK,
    SESSION_TABLE_NAME: "RevenueLeakTestRequestFormSessions",
    CRM_API_BASE_URL: "https://www.zohoapis.com/crm/v8",
    FORM1_ENTRY_OFFER_VALUE: "Free 7-Day Missed-Call",
    FORM1_INTAKE_FORM_VERSION: "revenue-leak-test-request-v1",
    FORM1_LEAD_STATUS_VALUE: "Free Test Requested",
    FORM1_SOURCE_PAGE_VALUE: "crm-assisted-form1",
    FORM1_SUBMISSION_CHANNEL_VALUE: "CRM Assisted",
    ...overrides,
  };
}

module.exports = {
  REVISION,
  SYNTHETIC_CATALYST_PROJECT_ID,
  SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
  environment,
};
