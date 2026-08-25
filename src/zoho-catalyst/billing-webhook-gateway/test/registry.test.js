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
  assert.equal(registry.status, "required_hardening_pending");
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

test("release registry binds one Development target without treating private build input as runtime config", () => {
  assert.deepEqual(registry.release_artifact, {
    builder: "tools/build-development-artifact.js",
    function_target: "sylvara_client_portal_hmac_gateway_function",
    function_type: "advancedio",
    environment_scope: "development-only",
    private_build_inputs_are_runtime_variables: false,
    creator_destination_digest_manifest_disclosure: "prohibited",
    deployment_side_effect: "none",
  });
  assert.equal(registryNames.has("APPROVED_SOURCE_REVISION"), false);
  assert.equal(registryNames.has("APPROVED_CREATOR_DESTINATION_SHA256"), false);
});

test("sanitized live-audit evidence preserves uncertainty and approval gates", () => {
  const evidencePath = path.join(
    __dirname,
    "..",
    "evidence",
    "sanitized-live-audit-2026-08-25.json",
  );
  const evidenceText = fs.readFileSync(evidencePath, "utf8");
  const evidence = JSON.parse(evidenceText);
  assert.equal(evidence.classification, "required_hardening_pending");
  assert.equal(evidence.billing_webhook.subscription_webhook_state, "active");
  assert.equal(
    evidence.billing_webhook.target_binding_assessment,
    "exactly_matches_development_route_path",
  );
  assert.deepEqual(
    evidence.billing_webhook_history.queries.map((entry) => entry.visible_delivery_rows),
    [0, 0],
  );
  assert.equal(evidence.private_full_source_scan.reviewed_live_revision_count, 3);
  assert.equal(evidence.private_full_source_scan.catalyst_connection_usage_reference_count, 0);
  assert.equal(evidence.creator_custom_api_inventory.status, "unverified");
  assert.equal(evidence.decision.live_changes, "approval_gated");
  assert.equal(evidence.decision.repository_artifact_status, "required_hardening_pending");
  assert.equal(evidence.decision.hardening_complete, false);
  assert.deepEqual(evidence.decision.required_before_reclassification, [
    "Creator Custom API inventory and exact authentication contract proven",
    "immutable reviewed Development artifact deployed and independently read back",
    "Billing webhook to Development route ownership and disabled-change-state proof",
    "Production duplicate removal, rollback, and independent absence-readback proof",
    "Billing webhook and durable event-fingerprint secrets rotated with old-key rejection",
    "least-privilege Creator Connection grant rotated and independently read back",
    "all historical raw OAuth grants revoked and retired runtime variables proven absent",
    "final Billing, Catalyst, Connection, inbox, Creator, route, source-revision, and Production-block readback",
  ]);
  assert.equal(evidence.decision.development_deployment_authorized, false);
  assert.equal(evidence.decision.credential_rotation_authorized, false);
  assert.equal(evidence.decision.duplicate_removal_authorized, false);
  assert.equal(evidence.decision.production_activation_authorized, false);
  assert.equal(evidence.decision.production_code_block_retained, true);
  assert.equal(evidenceText.includes("http://"), false);
  assert.equal(evidenceText.includes("https://"), false);
  assert.doesNotMatch(evidenceText, /\b[a-f0-9]{40,64}\b/i);
});

test("the package syntax-checks every runtime source file", () => {
  const packageJson = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "package.json"),
    "utf8",
  ));
  const expectedRuntimeSources = [
    "index.js",
    "lib/catalyst-adapter.js",
    "lib/config.js",
    "lib/connection-boundary.js",
    "lib/creator-client.js",
    "lib/creator-destination.js",
    "lib/destinations.js",
    "lib/handler.js",
    "lib/http.js",
    "lib/idempotency.js",
    "lib/iso-timestamp.js",
    "lib/normalize-event.js",
    "lib/operation-timeout.js",
    "lib/redact.js",
    "lib/signature.js",
    "lib/source-revision.js",
  ];
  const actualRuntimeSources = [
    "index.js",
    ...fs.readdirSync(path.join(__dirname, "..", "lib"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => `lib/${entry.name}`),
  ];
  assert.deepEqual(actualRuntimeSources.sort(), expectedRuntimeSources.sort());
  const expectedCheckedSources = [
    ...expectedRuntimeSources,
    "tools/build-development-artifact.js",
  ];
  assert.equal(
    packageJson.scripts.check,
    expectedCheckedSources.map((source) => `node --check ${source}`).join(" && "),
  );
  assert.equal(
    packageJson.scripts["artifact:build"],
    "node tools/build-development-artifact.js",
  );
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
