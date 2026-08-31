"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { FORM_KEYS } = require("../lib/form-contract");
const { ZOHO_FORMS_SUBMISSION_KEYS } = require("../lib/handler");

const functionRoot = path.resolve(__dirname, "..");
const componentRoot = path.resolve(functionRoot, "../..");
const repositoryRoot = path.resolve(componentRoot, "../../..");

function json(selected) {
  return JSON.parse(fs.readFileSync(selected, "utf8"));
}

test("the variable registry and placeholder environment remain in exact lockstep", () => {
  const registry = json(path.join(componentRoot, "config/variables.json"));
  assert.equal(registry.schema_version, 5);
  assert.equal(registry.status, "development-active-production-dark");
  const names = registry.variables.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  const example = fs.readFileSync(path.join(functionRoot, ".env.example"), "utf8");
  const exampleNames = example.split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.slice(0, line.indexOf("=")));
  assert.deepEqual([...names].sort(), [...exampleNames].sort());
  for (const secret of registry.variables.filter((entry) => entry.classification === "secret")) {
    assert.match(example, new RegExp(`^${secret.name}=<`, "m"));
  }
  assert.doesNotMatch(example, /Zoho-oauthtoken|client_secret|refresh_token|@/i);
});

test("the exact manifest exposes five Development routes with three server callers", () => {
  const manifest = json(path.join(componentRoot, "config/routes.json"));
  assert.equal(manifest.schema_version, 4);
  assert.equal(manifest.environment, "Development");
  assert.equal(manifest.default_action, "reject");
  assert.equal(manifest.cors, false);
  assert.deepEqual(manifest.routes.map((route) => route.id), [
    "FORM1_ISSUE", "FORM1_ACCESS", "FORM1_EXCHANGE", "FORM1_PREFILL", "FORM1_SUBMISSION",
  ]);
  const secretReferences = manifest.routes
    .map((route) => route.authentication.secret_reference)
    .filter(Boolean);
  assert.equal(new Set(secretReferences).size, 3);
  assert.equal(secretReferences.length, 3);
  const access = manifest.routes.find((route) => route.id === "FORM1_ACCESS");
  assert.equal(access.method, "GET");
  assert.equal(Object.hasOwn(access, "content_type"), false);
  assert.equal(Object.hasOwn(access, "body_keys"), false);
  assert.equal(manifest.routes.filter((route) => route.method === "POST").every((route) =>
    route.content_type === "application/json"), true);
  const submission = manifest.routes.find((route) => route.id === "FORM1_SUBMISSION");
  const providerKeys = [
    "prefillId", "configurationRevision", "submissionId", ...FORM_KEYS,
  ];
  assert.deepEqual(submission.zoho_forms_transport_body_keys, providerKeys);
  assert.deepEqual([...ZOHO_FORMS_SUBMISSION_KEYS], providerKeys);
  assert.equal(submission.success_status, 200);

  const schema = json(path.join(componentRoot, "config/datastore-schema.json"));
  assert.equal(schema.schema_version, 7);
  assert.deepEqual(schema.tables.map((table) => table.expected_api_name),
    ["RevenueLeakTestRequestFormSessions"]);
  assert.equal(schema.tables[0].columns.some((column) =>
    column.api_name === "SUBMISSION_FINGERPRINT"), true);
  assert.equal(schema.tables[0].columns.some((column) =>
    column.api_name === "CRM_RECORD_VERSION"), true);
  assert.equal(schema.tables[0].columns.some((column) =>
    column.api_name === "SESSION_VERSION"), true);
  assert.deepEqual(schema.tables[0].required_unique_columns,
    ["TOKEN_HASH", "PREFILL_HANDLE_HASH", "PREFILL_ID", "INTAKE_SUBMISSION_ID"]);
  for (const name of [
    "FORM_IDENTITY_HASH", "CONFIGURATION_REVISION", "PREFILL_HANDLE_ISSUED_AT",
    "PREFILL_HANDLE_EXPIRES_AT", "PREFILL_HANDLE_CONSUMED_AT",
    "PREFILL_CONSUMPTION_OWNER",
  ]) {
    assert.equal(schema.tables[0].columns.some((column) => column.api_name === name), true);
  }
  assert.equal(schema.data_policy.raw_tokens_or_form_payloads_stored, false);
  assert.equal(schema.data_policy.delete_permission, false);
});

test("the Forms contract preserves exactly two forms and separates public and assisted writers", () => {
  const manifest = json(path.join(
    repositoryRoot,
    "src/zoho-forms/free-revenue-leak-test/forms-manifest.json",
  ));
  assert.equal(manifest.forms.length, 2);
  const form1 = manifest.forms.find((form) =>
    form.logical_name === "REVENUE_LEAK_TEST_REQUEST_FORM");
  const form2 = manifest.forms.find((form) =>
    form.logical_name === "REVENUE_LEAK_TEST_SETUP_FORM");
  assert.ok(form1);
  assert.ok(form2);
  assert.equal(form1.assisted_prefill.enabled, false,
    "live assisted handling remains disabled until installation readback");
  assert.equal(form1.assisted_prefill.source_candidate_enabled, true);
  assert.equal(form1.assisted_prefill.live_enabled, false);
  assert.deepEqual(form1.assisted_prefill.routes, [
    "FORM1_ISSUE", "FORM1_ACCESS", "FORM1_EXCHANGE", "FORM1_PREFILL",
    "FORM1_SUBMISSION",
  ]);
  assert.equal(
    form1.assisted_prefill.crm_launcher.zoho_forms_receives_journey_credential,
    false,
  );
  assert.equal(
    form1.assisted_prefill.prefill_handle_transport.ttl_seconds_default,
    600,
  );
  assert.equal(
    form1.assisted_prefill.prefill_handle_transport.maximum_successful_prefills,
    1,
  );
  assert.deepEqual(
    form1.assisted_prefill.prefill_webhook.request_keys,
    ["prefillHandle"],
  );
  assert.deepEqual(
    form1.assisted_prefill.submission_webhook.assisted_server_keys,
    ["prefillId", "configurationRevision", "submissionId"],
  );
  assert.deepEqual(
    form1.assisted_prefill.submission_webhook.provider_transport_keys,
    ["prefillId", "configurationRevision", "submissionId", ...FORM_KEYS],
  );
  assert.equal(form1.assisted_prefill.submission_lanes.public.writer,
    "existing native CRM upsert");
  assert.equal(form1.assisted_prefill.submission_lanes.assisted
    .browser_supplied_record_or_journey_identity_accepted, false);
  assert.equal(form1.assisted_prefill.production_enabled, false);
  assert.deepEqual(form1.approved_public_access_and_accessibility.desired_state, {
    public_url: "Enabled",
    enhanced_accessibility: "Yes",
    respondent_font_size_control: "Disabled",
    respondent_letter_spacing_control: "Disabled",
    respondent_themes_control: "Disabled",
  });
  const form1Readback = form1.approved_public_access_and_accessibility
    .authoritative_live_readback;
  assert.equal(form1Readback.status, "current_provider_readback_required_after_save");
  assert.equal(form1Readback.source_values_inferred_as_live, false);
  for (const field of Object.keys(form1.approved_public_access_and_accessibility.desired_state)) {
    assert.equal(form1Readback[field], null);
  }
  assert.deepEqual(form1.preserved_nonblocking_behavior, [
    "the legacy CRM review task may still be created when its existing workflow runs, but task creation is not a Journey-core acceptance dependency",
  ]);
  assert.equal(form2.logical_name, "REVENUE_LEAK_TEST_SETUP_FORM");
});

test("the package is a Node 24 Advanced I/O target with the pinned Catalyst SDK only", () => {
  const descriptor = json(path.join(functionRoot, "catalyst-config.json"));
  const packageJson = json(path.join(functionRoot, "package.json"));
  const lock = json(path.join(functionRoot, "package-lock.json"));
  assert.deepEqual([
    descriptor.deployment.name,
    packageJson.name,
    lock.name,
    lock.packages[""].name,
  ], Array(4).fill("revenue_leak_test_request_form"));
  assert.equal(descriptor.deployment.type, "advancedio");
  assert.equal(descriptor.deployment.stack, "node24");
  assert.equal(packageJson.engines.node, "24.x");
  assert.deepEqual(packageJson.dependencies, { "zcatalyst-sdk-node": "3.4.0" });
  assert.equal(lock.packages[""].dependencies["zcatalyst-sdk-node"], "3.4.0");
});
