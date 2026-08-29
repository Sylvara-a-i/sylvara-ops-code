"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  FORBIDDEN_LEGACY_VARIABLES,
  loadConfig,
} = require("../lib/config");
const { constantTimeEqual, verifySharedSecret } = require("../lib/security");
const {
  REVISION,
  SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
  environment,
} = require("./helpers");

const ACTIVE_CONFIG_KEYS = [
  "darkMode",
  "deploymentEnvironment",
  "deploymentMode",
  "expectedCatalystProjectIdSha256",
  "issueHeaderName",
  "issueHeaderSecret",
  "issuePath",
  "prefillHeaderName",
  "prefillHeaderSecret",
  "prefillPath",
  "sourceRevision",
];

test("configuration binds contained Development and dark Production to the stamped revision", () => {
  const config = loadConfig(environment(), REVISION);
  assert.equal(config.deploymentEnvironment, "development");
  assert.equal(config.deploymentMode, "contained");
  assert.equal(config.darkMode, false);
  assert.equal(
    config.expectedCatalystProjectIdSha256,
    SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
  );
  assert.equal(config.sourceRevision, REVISION);
  assert.deepEqual(Object.keys(config).sort(), ACTIVE_CONFIG_KEYS.sort());

  const dark = loadConfig(environment({
    DEPLOYMENT_ENVIRONMENT: "production",
    DEPLOYMENT_MODE: "dark",
  }), REVISION);
  assert.deepEqual(dark, {
    darkMode: true,
    deploymentEnvironment: "production",
    deploymentMode: "dark",
    sourceRevision: REVISION,
  });
  assert.throws(
    () => loadConfig(environment({ DEPLOYMENT_ENVIRONMENT: "production" }), REVISION),
    /production\/dark/,
  );
  assert.throws(
    () => loadConfig(environment({ DEPLOYMENT_MODE: "active" }), REVISION),
    /development\/contained/,
  );
  assert.throws(() => loadConfig(environment(), "2".repeat(40)), /stamped function artifact/);
  assert.throws(
    () => loadConfig(environment({ EXPECTED_CATALYST_PROJECT_ID_SHA256: "A".repeat(64) }), REVISION),
    /lowercase SHA-256 digest/,
  );
  assert.throws(
    () => loadConfig(environment(), "__SYLVARA_UNSTAMPED_SOURCE_REVISION__"),
    /40-character Git commit/,
  );
});

test("every superseded token, URL, CRM, Connection, Data Store, and session variable fails closed", () => {
  assert.deepEqual(FORBIDDEN_LEGACY_VARIABLES, [
    "CRM_API_BASE_URL",
    "CRM_READ_CONNECTION_LINK_NAME",
    "CRM_WRITE_CONNECTION_LINK_NAME",
    "FORM1_ENTRY_OFFER_VALUE",
    "FORM1_INTAKE_FORM_VERSION",
    "FORM1_LEAD_STATUS_VALUE",
    "FORM1_PUBLIC_URL",
    "FORM1_SOURCE_PAGE_VALUE",
    "FORM1_SUBMISSION_CHANNEL_VALUE",
    "FORM1_TOKEN_FIELD_ALIAS",
    "INBOUND_BODY_TIMEOUT_MS",
    "MAX_BODY_BYTES",
    "MAX_PREFILLS",
    "OUTBOUND_MAX_BYTES",
    "OUTBOUND_TIMEOUT_MS",
    "PLATFORM_OPERATION_TIMEOUT_MS",
    "SESSION_TABLE_NAME",
    "SESSION_TTL_SECONDS",
    "TOKEN_PEPPER",
  ]);
  for (const name of FORBIDDEN_LEGACY_VARIABLES) {
    assert.throws(
      () => loadConfig(environment({ [name]: "synthetic-forbidden-value" }), REVISION),
      /Legacy Form 1 capability variable is forbidden/,
      name,
    );
    assert.throws(
      () => loadConfig(environment({
        DEPLOYMENT_ENVIRONMENT: "production",
        DEPLOYMENT_MODE: "dark",
        [name]: "synthetic-forbidden-value",
      }), REVISION),
      /Legacy Form 1 capability variable is forbidden/,
      `dark Production: ${name}`,
    );
  }
});

test("route identities and authentication remain exact and independently secret", () => {
  assert.throws(
    () => loadConfig(environment({ PREFILL_HEADER_SECRET: "i".repeat(43) }), REVISION),
    /independently generated/,
  );
  assert.throws(
    () => loadConfig(environment({ PREFILL_PATH: "/form1/issue-test" }), REVISION),
    /must be different/,
  );
  assert.throws(
    () => loadConfig(environment({ PREFILL_HEADER_NAME: "x-sylvara-issue-test" }), REVISION),
    /must be different/,
  );
  assert.equal(constantTimeEqual("a".repeat(43), "a".repeat(43)), true);
  assert.equal(constantTimeEqual("a".repeat(43), "b".repeat(43)), false);
  assert.equal(
    verifySharedSecret(
      { "x-sylvara-issue-test": "i".repeat(43) },
      "x-sylvara-issue-test",
      "i".repeat(43),
    ),
    true,
  );
});
