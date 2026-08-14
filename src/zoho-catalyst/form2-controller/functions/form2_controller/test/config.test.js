"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ConfigurationError, NUMERIC_LIMITS, loadConfig } = require("../lib/config");

function baseEnvironment(overrides = {}) {
  return {
    DEPLOYMENT_ENVIRONMENT: "development",
    SESSION_TABLE_NAME: "Form2_Sessions",
    PREFILL_TABLE_NAME: "Form2_Prefills",
    SUBMISSION_TABLE_NAME: "Form2_Submissions",
    ISSUE_PATH: "/form2/session/issue",
    PREFILL_PATH: "/form2/session/prefill",
    SUBMISSION_PATH: "/form2/session/submit",
    ISSUE_HEADER_NAME: "x-sylvara-issue-key",
    ISSUE_HEADER_SECRET: "I".repeat(43),
    FORMS_HEADER_NAME: "x-sylvara-forms-key",
    PREFILL_HEADER_SECRET: "F".repeat(43),
    SUBMISSION_HEADER_SECRET: "S".repeat(43),
    TOKEN_PEPPER: "P".repeat(43),
    FORM2_PUBLIC_URL: "https://forms.zohopublic.com/synthetic/form/perma/synthetic",
    FORM2_TOKEN_FIELD_ALIAS: "access_token",
    FORM2_FORM_VERSION: "form2-v1",
    FORM2_ENTRY_OFFER_VALUE: "Synthetic Free Test",
    FORM2_FIELD_TEAM_SIZE_BANDS: '["Synthetic Approved Band","Different Private Band"]',
    FORM2_ACCESS_STATUS_INITIAL_VALUE: "Synthetic Initial",
    FORM2_ACCESS_STATUS_ISSUED_VALUE: "Synthetic Issued",
    FORM2_ACCESS_STATUS_VERIFIED_VALUE: "Synthetic Verified",
    FORM2_ACCESS_STATUS_SUBMITTED_VALUE: "Synthetic Submitted",
    CRM_API_BASE_URL: "https://www.zohoapis.com/crm/v8",
    CRM_READ_CONNECTION_LINK_NAME: "SyntheticCrmRead",
    CRM_WRITE_CONNECTION_LINK_NAME: "SyntheticCrmWrite",
    SOURCE_REVISION: "synthetic-revision-001",
    ...overrides,
  };
}

test("loads an immutable Development-only configuration with bounded defaults", () => {
  const config = loadConfig(baseEnvironment());
  assert.equal(config.deploymentEnvironment, "development");
  assert.equal(config.prefillTableName, "Form2_Prefills");
  assert.equal(config.sessionTtlSeconds, 3600);
  assert.equal(config.maxVerificationAttempts, 3);
  assert.equal(config.maxSubmissionAttempts, 3);
  assert.equal(config.maxBodyBytes, 32768);
  assert.equal(config.outboundMaxBytes, 131072);
  assert.deepEqual(config.form2FieldTeamSizeBands, [
    "Synthetic Approved Band",
    "Different Private Band",
  ]);
  assert.ok(Object.isFrozen(config.form2FieldTeamSizeBands));
  assert.deepEqual(config.form2AccessStatuses, {
    initial: "Synthetic Initial",
    issued: "Synthetic Issued",
    verified: "Synthetic Verified",
    submitted: "Synthetic Submitted",
  });
  assert.ok(Object.isFrozen(config.form2AccessStatuses));
  assert.ok(Object.isFrozen(config));
});

test("hard-blocks every environment other than exact Development", () => {
  for (const value of ["production", "Production", "development ", "test", ""]) {
    assert.throws(
      () => loadConfig(baseEnvironment({ DEPLOYMENT_ENVIRONMENT: value })),
      ConfigurationError,
    );
  }
});

test("requires separate safe Data Store table identifiers", () => {
  for (const overrides of [
    { SESSION_TABLE_NAME: "unsafe-name" },
    { PREFILL_TABLE_NAME: "Form2_Sessions" },
    { SUBMISSION_TABLE_NAME: "Form2_Prefills" },
    { PREFILL_TABLE_NAME: "" },
  ]) {
    assert.throws(() => loadConfig(baseEnvironment(overrides)), ConfigurationError);
  }
});

test("requires three unique exact routes and isolated custom-header names", () => {
  for (const overrides of [
    { ISSUE_PATH: "/form2/session/prefill" },
    { PREFILL_PATH: "form2/session/prefill" },
    { SUBMISSION_PATH: "/form2//session/submit" },
    { ISSUE_HEADER_NAME: "X-Sylvara-Issue-Key" },
    { ISSUE_HEADER_NAME: "x-sylvara-forms-key" },
    { FORMS_HEADER_NAME: "authorization" },
  ]) {
    assert.throws(() => loadConfig(baseEnvironment(overrides)), ConfigurationError);
  }
});

test("requires independently generated printable route secrets and token pepper", () => {
  for (const overrides of [
    { TOKEN_PEPPER: "short" },
    { ISSUE_HEADER_SECRET: "I".repeat(31) },
    { PREFILL_HEADER_SECRET: `${"F".repeat(32)}\n` },
    { SUBMISSION_HEADER_SECRET: "P".repeat(43) },
    { PREFILL_HEADER_SECRET: "S".repeat(43) },
  ]) {
    assert.throws(() => loadConfig(baseEnvironment(overrides)), ConfigurationError);
  }
});

test("accepts only exact HTTPS form and regional Zoho CRM API URLs", () => {
  for (const overrides of [
    { FORM2_PUBLIC_URL: "http://forms.zohopublic.com/synthetic/form" },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.com/" },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.com/synthetic/form?token=value" },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.evil.com/synthetic/form" },
    { FORM2_PUBLIC_URL: "https://forms.example.invalid/synthetic/form" },
    { CRM_API_BASE_URL: "https://example.invalid/crm/v8" },
    { CRM_API_BASE_URL: "https://zohoapis.evil.com/crm/v8" },
    { CRM_API_BASE_URL: "https://www.zohoapis.evil.com/crm/v8" },
    { CRM_API_BASE_URL: "https://www.zohoapis.eu/crm/v8" },
    { CRM_API_BASE_URL: "https://www.zohoapis.com/crm/v8/Leads" },
    { CRM_API_BASE_URL: "https://www.zohoapis.com:444/crm/v8" },
  ]) {
    assert.throws(() => loadConfig(baseEnvironment(overrides)), ConfigurationError);
  }
});

test("parses all numeric controls as strict bounded base-10 integers", () => {
  for (const [name, limits] of Object.entries(NUMERIC_LIMITS)) {
    const propertyByName = {
      SESSION_TTL_SECONDS: "sessionTtlSeconds",
      MAX_VERIFICATION_ATTEMPTS: "maxVerificationAttempts",
      MAX_SUBMISSION_ATTEMPTS: "maxSubmissionAttempts",
      MAX_BODY_BYTES: "maxBodyBytes",
      INBOUND_BODY_TIMEOUT_MS: "inboundBodyTimeoutMs",
      OUTBOUND_TIMEOUT_MS: "outboundTimeoutMs",
      OUTBOUND_MAX_BYTES: "outboundMaxBytes",
      PLATFORM_OPERATION_TIMEOUT_MS: "platformOperationTimeoutMs",
    };
    assert.equal(
      loadConfig(baseEnvironment({ [name]: String(limits.minimum) }))[propertyByName[name]],
      limits.minimum,
    );
    for (const value of ["0", "01", "1.5", "-1", "NaN", String(limits.maximum + 1)]) {
      assert.throws(
        () => loadConfig(baseEnvironment({ [name]: value })),
        ConfigurationError,
      );
    }
  }
  assert.throws(
    () => loadConfig(baseEnvironment({ MAX_VERIFICATION_ATTEMPTS: "1" })),
    ConfigurationError,
  );
});

test("rejects malformed aliases, versions, revisions, and Connection link names", () => {
  for (const overrides of [
    { FORM2_TOKEN_FIELD_ALIAS: "access-token" },
    { FORM2_FORM_VERSION: "version with spaces" },
    { SOURCE_REVISION: "short" },
    { CRM_READ_CONNECTION_LINK_NAME: "unsafe-link" },
    { CRM_WRITE_CONNECTION_LINK_NAME: "SyntheticCrmRead" },
    { FORM2_ENTRY_OFFER_VALUE: "Unsafe\nValue" },
    { FORM2_FIELD_TEAM_SIZE_BANDS: "not-json" },
    { FORM2_FIELD_TEAM_SIZE_BANDS: "[]" },
    { FORM2_FIELD_TEAM_SIZE_BANDS: '["Duplicate","Duplicate"]' },
    { FORM2_ACCESS_STATUS_INITIAL_VALUE: "Synthetic Issued" },
  ]) {
    assert.throws(() => loadConfig(baseEnvironment(overrides)), ConfigurationError);
  }
});
