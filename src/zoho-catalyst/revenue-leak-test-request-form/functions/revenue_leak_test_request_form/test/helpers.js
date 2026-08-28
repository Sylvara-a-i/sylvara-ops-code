"use strict";

const crypto = require("node:crypto");

const REVISION = "1".repeat(40);
const SYNTHETIC_CATALYST_PROJECT_ID = "100000000000001";
const SYNTHETIC_CATALYST_PROJECT_ID_SHA256 = crypto
  .createHash("sha256")
  .update(SYNTHETIC_CATALYST_PROJECT_ID, "utf8")
  .digest("hex");
const LEAD_ID = "9".repeat(19);
const INTAKE_ID = "f1a_11111111-1111-4111-8111-111111111111";

function environment(overrides = {}) {
  return {
    DEPLOYMENT_ENVIRONMENT: "development",
    DEPLOYMENT_MODE: "active",
    EXPECTED_CATALYST_PROJECT_ID_SHA256: SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
    SOURCE_REVISION: REVISION,
    ISSUE_PATH: "/form1/issue-test",
    PREFILL_PATH: "/form1/prefill-test",
    ISSUE_HEADER_NAME: "x-sylvara-issue-test",
    PREFILL_HEADER_NAME: "x-sylvara-prefill-test",
    ISSUE_HEADER_SECRET: "i".repeat(43),
    PREFILL_HEADER_SECRET: "p".repeat(43),
    TOKEN_PEPPER: "t".repeat(43),
    FORM1_PUBLIC_URL:
      "https://forms.zohopublic.com/sylvara/form/FreeTest/formperma/example",
    FORM1_TOKEN_FIELD_ALIAS: "assisted_token",
    FORM1_ENTRY_OFFER_VALUE: "Synthetic test offer",
    FORM1_INTAKE_FORM_VERSION: "test-version",
    FORM1_LEAD_STATUS_VALUE: "Synthetic requested status",
    FORM1_SOURCE_PAGE_VALUE: "synthetic-assisted",
    FORM1_SUBMISSION_CHANNEL_VALUE: "Synthetic In Person",
    CRM_API_BASE_URL: "https://www.zohoapis.com/crm/v8",
    CRM_READ_CONNECTION_LINK_NAME: "form1_leads_read",
    CRM_WRITE_CONNECTION_LINK_NAME: "form1_leads_update",
    SESSION_TABLE_NAME: "RevenueLeakTestRequestFormSessions",
    SESSION_TTL_SECONDS: "900",
    MAX_PREFILLS: "10",
    MAX_BODY_BYTES: "4096",
    INBOUND_BODY_TIMEOUT_MS: "5000",
    OUTBOUND_TIMEOUT_MS: "5000",
    OUTBOUND_MAX_BYTES: "131072",
    PLATFORM_OPERATION_TIMEOUT_MS: "5000",
    ...overrides,
  };
}

function lead(overrides = {}) {
  return {
    id: LEAD_ID,
    Modified_Time: "2026-08-21T18:00:00-05:00",
    First_Name: "Synthetic",
    Last_Name: "Canary",
    Company: "Synthetic Service Co",
    Decision_Maker_Role: "Owner",
    Designation: "Owner",
    Email: "form1-canary@example.invalid",
    Mobile: "+15550101010",
    Lead_Source: "Synthetic original source",
    Main_Business_Phone: "+15550101011",
    Current_Call_Handling: "Owner answers",
    Requested_Test_Route: "Forward existing number",
    Phone_System_Provider: "Other",
    Primary_Service_Area: "Synthetic area",
    Field_Team_Size_Band: "1-5",
    Intake_Submission_ID: INTAKE_ID,
    Free_Test_Request_Notes: "internal-only-note",
    ...overrides,
  };
}

module.exports = {
  INTAKE_ID,
  LEAD_ID,
  REVISION,
  SYNTHETIC_CATALYST_PROJECT_ID,
  SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
  environment,
  lead,
};
