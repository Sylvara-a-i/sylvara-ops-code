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
  assert.equal(config.accessPath, "/form1/access-test");
  assert.equal(
    new URL(config.form1AccessPublicUrl).pathname,
    `/sylvara-dev/${"A".repeat(43)}`,
  );

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

test("the public access URL is one canonical Development Gateway source endpoint", () => {
  const valid = `https://synthetic.development.catalystserverless.com/sylvara-dev/${"A".repeat(43)}`;
  assert.equal(loadConfig(environment({ FORM1_ACCESS_PUBLIC_URL: valid }), REVISION)
    .form1AccessPublicUrl, valid);

  for (const FORM1_ACCESS_PUBLIC_URL of [
    "https://synthetic.development.catalystserverless.com/form1/access-test",
    "https://synthetic.development.catalystserverless.com/server/revenue_leak_test_request_form/form1/access-test",
    `https://synthetic.catalystserverless.com/sylvara-dev/${"A".repeat(43)}`,
    `https://synthetic.development.catalystserverless.com/Sylvara-dev/${"A".repeat(43)}`,
    `https://synthetic.development.catalystserverless.com/sy/${"A".repeat(43)}`,
    `https://synthetic.development.catalystserverless.com/sylvara-dev/${"A".repeat(31)}`,
    `https://synthetic.development.catalystserverless.com/sylvara-dev/${"A".repeat(65)}`,
    `https://synthetic.development.catalystserverless.com/sylvara-dev/${"A".repeat(43)}/extra`,
    `https://synthetic.development.catalystserverless.com/sylvara-dev/${"A".repeat(43)}/`,
    `https://synthetic.development.catalystserverless.com/sylvara-dev/${"A".repeat(43)}?`,
    `https://synthetic.development.catalystserverless.com/sylvara-dev/${"A".repeat(43)}#`,
    `http://synthetic.development.catalystserverless.com/sylvara-dev/${"A".repeat(43)}`,
    `https://${"user"}@synthetic.development.catalystserverless.com/sylvara-dev/${"A".repeat(43)}`,
    `https://synthetic.development.catalystserverless.com:443/sylvara-dev/${"A".repeat(43)}`,
  ]) {
    assert.throws(
      () => loadConfig(environment({ FORM1_ACCESS_PUBLIC_URL }), REVISION),
      /Gateway source URL/,
    );
  }
});

test("recovery is opt-in and its private one-claim manifest is exact", () => {
  const manifest = { schemaVersion: 1, mode: "inspect", originalSourceRevision: "a".repeat(40),
    claimBindingSha256: "b".repeat(64), assistedConstantsSha256: "c".repeat(64),
    originalSessionVersion: 17, originalUpdatedAt: "2026-09-04T12:00:00.000Z",
    originalLastOutcome: "submission_started" };
  const selected = value => loadConfig(environment({ FORM1_RECOVERY_MANIFEST_JSON: value }), REVISION);
  assert.equal(selected(undefined).recoveryManifest, null);
  assert.equal(selected("").recoveryManifest, null);
  assert.deepEqual(selected(JSON.stringify(manifest)).recoveryManifest, manifest);
  assert.equal(Object.isFrozen(selected(JSON.stringify(manifest)).recoveryManifest), true);
  for (const value of [null, "{}", "[]", "false", " ",
    JSON.stringify(manifest, null, 2),
    JSON.stringify(manifest).replace('"mode":"inspect"', '"mode":"inspect","mode":"complete"'),
    ...[ {mode:"all"}, {originalSourceRevision:REVISION}, {schemaVersion:2},
      {extra:true}, {originalSessionVersion:0}, {originalSessionVersion:Number.MAX_SAFE_INTEGER},
      {originalSessionVersion:"17"}, {originalLastOutcome:"submitted"},
      {originalUpdatedAt:"2026-02-30T12:00:00.000Z"}, {claimBindingSha256:"b".repeat(63)},
    ].map(overrides=>JSON.stringify({...manifest,...overrides}))]) {
    assert.throws(()=>selected(value), /FORM1_RECOVERY_MANIFEST_JSON is invalid/);
  }
  const dark = loadConfig(environment({DEPLOYMENT_ENVIRONMENT:"production", DEPLOYMENT_MODE:"dark",
    FORM1_RECOVERY_MANIFEST_JSON:JSON.stringify({...manifest,mode:"complete"})}), REVISION);
  assert.equal(dark.darkMode,true);
  assert.equal(dark.recoveryManifest,undefined);
});

test("follow-on recovery requires an exact predecessor marker from a different artifact", () => {
  const priorMarker = `r1_${"d".repeat(40)}_00000000000040008000000000000001`;
  const manifest = { schemaVersion: 1, mode: "inspect", originalSourceRevision: "a".repeat(40),
    claimBindingSha256: "b".repeat(64), assistedConstantsSha256: "c".repeat(64),
    originalSessionVersion: 18, originalUpdatedAt: "2026-09-04T12:01:00.000Z",
    originalLastOutcome: priorMarker };
  const selected = originalLastOutcome => loadConfig(environment({
    FORM1_RECOVERY_MANIFEST_JSON: JSON.stringify({ ...manifest, originalLastOutcome }),
  }), REVISION);
  assert.deepEqual(selected(priorMarker).recoveryManifest, manifest);
  assert.equal(Object.keys(selected(priorMarker).recoveryManifest).length, 8);
  for (const value of [null, [priorMarker], { marker: priorMarker }, "submitted",
    `${priorMarker} `, priorMarker.toUpperCase(), priorMarker.replace("r1_", "r2_"),
    `r1_${REVISION}_00000000000040008000000000000001`,
    `r1_${"d".repeat(40)}_${"0".repeat(32)}`,
  ]) {
    assert.throws(() => selected(value), /FORM1_RECOVERY_MANIFEST_JSON is invalid/);
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
