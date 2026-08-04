"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const registry = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "config", "variables.json"),
  "utf8",
));
const registryNames = new Set(registry.variables.map((entry) => entry.name));

const suppliedNames = [
  "ACCOUNTS_ALLOWED_HOST_SUFFIXES",
  "ALLOWED_PATH",
  "ALLOWED_PATHS",
  "BILLING_WEBHOOK_SECRET",
  "BILLING_WEBHOOK_SECRET_PREVIOUS",
  "CATALYST_ENV",
  "CREATOR_ALLOWED_HOST_SUFFIXES",
  "CREATOR_FORWARD_URL",
  "ENABLE_PING",
  "ENABLE_REPLAY_DEFENSE",
  "ENVIRONMENT",
  "FORWARD_PARSED_BILLING",
  "FORWARD_RAW_PAYLOAD",
  "GATEWAY_VERSION",
  "INBOUND_BODY_TIMEOUT_MS",
  "MAX_BODY_BYTES",
  "PING_TOKEN",
  "REPLAY_CACHE_SEGMENT_ID",
  "REPLAY_KEY_PREFIX",
  "REPLAY_WINDOW_SECONDS",
  "REQUIRE_JSON",
  "REQUIRE_SHARED_HEADER",
  "REQUIRE_SIGNATURE",
  "SHARED_HEADER_NAME",
  "SHARED_HEADER_VALUE",
  "ZOHO_ACCOUNTS_DOMAIN",
  "ZOHO_CLIENT_ID",
  "ZOHO_CLIENT_SECRET",
  "ZOHO_REFRESH_TOKEN",
];

test("registry includes every supplied variable name exactly once", () => {
  const names = registry.variables.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of suppliedNames) assert.ok(names.includes(name), name);
  assert.match(registry.coverage_attestation, /privately supplied export/);
});

test("registry covers replacement source and example environment names", () => {
  const configSource = fs.readFileSync(path.join(__dirname, "..", "lib", "config.js"), "utf8");
  const sourceNames = [...configSource.matchAll(/["']([A-Z][A-Z0-9_]{2,})["']/g)]
    .map((match) => match[1]);
  const example = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  const exampleNames = example
    .split(/\r?\n/)
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => line.split("=", 1)[0]);
  for (const name of [...sourceNames, ...exampleNames]) {
    assert.ok(registryNames.has(name), name);
  }
});

test("secret classifications never permit values or runtime logging", () => {
  const secrets = registry.variables.filter((entry) => entry.classification === "secret");
  assert.ok(secrets.length >= 6);
  for (const entry of secrets) {
    assert.equal(entry.repository_value_policy, "name-only");
    assert.equal(entry.runtime_log_policy, "never");
    assert.equal(Object.hasOwn(entry, "safe_default"), false);
  }
});

test("only the public source revision may be logged by value", () => {
  const valueLogged = registry.variables.filter((entry) => entry.runtime_log_policy === "value");
  assert.deepEqual(valueLogged.map((entry) => entry.name), ["SOURCE_REVISION"]);
});

test("proposed Data Store schema matches the durable adapter contract", () => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "config", "datastore-schema.json"),
    "utf8",
  ));
  const columns = new Map(schema.table.columns.map((column) => [column.api_name, column]));
  for (const name of [
    "EVENT_KEY",
    "EVENT_FINGERPRINT",
    "SOURCE_EVENT_ID",
    "STATUS",
    "EVENT_TYPE",
    "SOURCE_REVISION",
    "SOURCE_ENVIRONMENT",
    "LAST_OUTCOME",
  ]) {
    assert.ok(columns.has(name), name);
  }
  assert.equal(columns.get("EVENT_KEY").type, "varchar");
  assert.equal(columns.get("EVENT_KEY").max_length, 64);
  assert.equal(columns.get("EVENT_KEY").is_unique, true);
  for (const name of ["EVENT_KEY", "EVENT_FINGERPRINT", "SOURCE_EVENT_ID"]) {
    assert.equal(columns.get(name).pii_ephi, true);
  }
  assert.equal(columns.get("EVENT_KEY").is_mandatory, true);
  for (const column of columns.values()) assert.equal(column.type, "varchar");
  assert.equal(schema.table.contains_direct_customer_fields, false);
  assert.equal(schema.table.contains_sensitive_derived_data, true);
  assert.equal(schema.retention.minimum_days, 180);
});
