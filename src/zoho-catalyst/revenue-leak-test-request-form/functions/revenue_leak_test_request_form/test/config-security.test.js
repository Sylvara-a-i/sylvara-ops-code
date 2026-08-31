"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const {
  constantTimeEqual,
  generateToken,
  hashToken,
  isValidToken,
  verifySharedSecret,
} = require("../lib/security");
const {
  REVISION,
  SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
  environment,
} = require("./helpers");
const SYNTHETIC_CRM_READ_LINK = "syntheticfixturevalue123456789";

test("configuration binds active Development and dark Production to the stamped release", () => {
  const config = loadConfig(environment(), REVISION);
  assert.equal(config.deploymentEnvironment, "development");
  assert.equal(config.deploymentMode, "active");
  assert.equal(config.darkMode, false);
  assert.equal(config.expectedCatalystProjectIdSha256, SYNTHETIC_CATALYST_PROJECT_ID_SHA256);
  assert.equal(config.sourceRevision, REVISION);
  assert.equal(config.sessionTtlSeconds, 1800);
  assert.equal(config.sessionTableName, "RevenueLeakTestRequestFormSessions");

  const dark = loadConfig(environment({
    DEPLOYMENT_ENVIRONMENT: "production",
    DEPLOYMENT_MODE: "dark",
    ZOHO_CATALYST_ZCQL_PARSER: undefined,
  }), REVISION);
  assert.deepEqual(dark, {
    darkMode: true,
    deploymentEnvironment: "production",
    deploymentMode: "dark",
    sourceRevision: REVISION,
  });
  assert.throws(() => loadConfig(environment({ DEPLOYMENT_MODE: "contained" }), REVISION),
    /development\/active/);
  for (const invalidParser of [undefined, "V1", "v2", "V2 "]) {
    assert.throws(
      () => loadConfig(environment({ ZOHO_CATALYST_ZCQL_PARSER: invalidParser }), REVISION),
      /ZOHO_CATALYST_ZCQL_PARSER/,
    );
  }
  assert.throws(() => loadConfig(environment(), "2".repeat(40)), /stamped function artifact/);
  for (const invalidRevision of [
    "a".repeat(39), "a".repeat(41), "a".repeat(80), "A".repeat(40),
  ]) {
    assert.throws(
      () => loadConfig(environment({ SOURCE_REVISION: invalidRevision }), REVISION),
      /lowercase 40-character Git commit/,
    );
  }
});

test("paths, credentials, organization identity, and Connections remain exact and independent", () => {
  assert.throws(
    () => loadConfig(environment({ SUBMISSION_PATH: "/form1/issue-test" }), REVISION),
    /paths must be different/,
  );
  assert.throws(
    () => loadConfig(environment({ SUBMISSION_HEADER_SECRET: "i".repeat(43) }), REVISION),
    /must be different/,
  );
  assert.throws(
    () => loadConfig(environment({
      CRM_WRITE_CONNECTION_LINK_NAME: SYNTHETIC_CRM_READ_LINK,
    }), REVISION),
    /Connections must be different/,
  );
  assert.throws(
    () => loadConfig(environment({ CRM_ORGANIZATION_ID_SHA256: "A".repeat(64) }), REVISION),
    /lowercase SHA-256/,
  );
  assert.throws(
    () => loadConfig(environment({ CRM_API_BASE_URL: "https://example.invalid/crm/v8" }), REVISION),
    /exact reviewed/,
  );
});

test("bearers are cryptographically random, digest-only, and route secrets compare exactly", () => {
  const token = generateToken(() => Buffer.alloc(32, 7));
  assert.equal(isValidToken(token), true);
  assert.match(hashToken(token, "t".repeat(43)), /^[a-f0-9]{64}$/);
  assert.notEqual(hashToken(token, "t".repeat(43)), token);
  assert.equal(constantTimeEqual("a".repeat(43), "a".repeat(43)), true);
  assert.equal(constantTimeEqual("a".repeat(43), "b".repeat(43)), false);
  assert.equal(verifySharedSecret(
    { "x-sylvara-issue-test": "i".repeat(43) },
    "x-sylvara-issue-test",
    "i".repeat(43),
  ), true);
});
