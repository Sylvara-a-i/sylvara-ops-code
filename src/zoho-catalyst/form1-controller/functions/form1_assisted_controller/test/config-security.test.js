"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const {
  generateToken,
  hashToken,
  isValidToken,
  normalizeLeadId,
} = require("../lib/security");
const { REVISION, environment } = require("./helpers");

test("configuration is Development-only and bound to the stamped revision", () => {
  const config = loadConfig(environment(), REVISION);
  assert.equal(config.deploymentEnvironment, "development");
  assert.equal(config.sourceRevision, REVISION);

  assert.throws(
    () => loadConfig(environment({ DEPLOYMENT_ENVIRONMENT: "production" }), REVISION),
    /must be development/,
  );
  assert.throws(() => loadConfig(environment(), "2".repeat(40)), /stamped function artifact/);
  assert.throws(
    () => loadConfig(environment(), "__SYLVARA_UNSTAMPED_SOURCE_REVISION__"),
    /40-character Git commit/,
  );
});

test("configuration rejects credential reuse and broadened destinations", () => {
  assert.throws(
    () => loadConfig(environment({ PREFILL_HEADER_SECRET: "i".repeat(43) }), REVISION),
    /independently generated/,
  );
  assert.throws(
    () => loadConfig(environment({
      CRM_WRITE_CONNECTION_LINK_NAME: "form1_leads_read",
    }), REVISION),
    /different link names/,
  );
  assert.throws(
    () => loadConfig(environment({
      FORM1_PUBLIC_URL: "https://example.com/form/FreeTest",
    }), REVISION),
    /approved US Zoho Forms/,
  );
  assert.throws(
    () => loadConfig(environment({
      CRM_API_BASE_URL: "https://evil.example/crm/v8",
    }), REVISION),
    /approved US Zoho CRM/,
  );
});

test("opaque tokens are canonical and only a domain-separated HMAC is persisted", () => {
  const token = generateToken(() => Buffer.alloc(32, 7));
  assert.equal(token.length, 43);
  assert.equal(isValidToken(token), true);
  const first = hashToken(token, "a".repeat(43));
  const second = hashToken(token, "b".repeat(43));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(token), false);
  const syntheticLeadId = "9".repeat(19);
  assert.equal(normalizeLeadId(syntheticLeadId), syntheticLeadId);
  assert.throws(() => normalizeLeadId("not-a-record"), /invalid/);
});
