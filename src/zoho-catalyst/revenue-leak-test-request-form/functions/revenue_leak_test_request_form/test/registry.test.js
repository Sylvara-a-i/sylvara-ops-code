"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { FIELD_CONTRACT } = require("../lib/form-contract");

const functionRoot = path.resolve(__dirname, "..");
const controllerRoot = path.resolve(functionRoot, "../..");
const repositoryRoot = path.resolve(controllerRoot, "../../..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sorted(values) {
  return [...values].sort();
}

test("the variable registry and placeholder environment stay in lockstep", () => {
  const registry = readJson(path.join(controllerRoot, "config/variables.json"));
  const names = registry.variables.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(
    registry.variables.find((entry) => entry.name === "SESSION_TABLE_NAME")?.safe_default,
    "RevenueLeakTestRequestFormSessions",
  );
  assert.equal(names.includes("FORM1_ASSISTED_BY_VALUE"), false);

  const schema = readJson(path.join(controllerRoot, "config/datastore-schema.json"));
  assert.equal(schema.schema_version, 2);
  assert.deepEqual(
    schema.tables.map((table) => [table.runtime_variable, table.expected_api_name]),
    [["SESSION_TABLE_NAME", "RevenueLeakTestRequestFormSessions"]],
  );

  const example = fs.readFileSync(path.join(functionRoot, ".env.example"), "utf8");
  const exampleNames = example
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.slice(0, line.indexOf("=")));
  assert.deepEqual(sorted(names), sorted(exampleNames));
  assert.match(example, /^SESSION_TABLE_NAME=RevenueLeakTestRequestFormSessions$/m);
  assert.doesNotMatch(example, /Zoho-oauthtoken|client_secret|refresh_token|@/i);
});

test("the route manifest exposes only the two authenticated assisted routes", () => {
  const manifest = readJson(path.join(controllerRoot, "config/routes.json"));
  assert.equal(manifest.environment, "Development");
  assert.equal(manifest.default_action, "reject");
  assert.equal(manifest.cors, false);
  assert.equal(manifest.routes.length, 2);
  assert.deepEqual(
    manifest.routes.map((route) => route.id),
    ["FORM1_ISSUE", "FORM1_PREFILL"],
  );
  assert.deepEqual(new Set(manifest.routes.map((route) => route.method)), new Set(["POST"]));
  assert.deepEqual(
    manifest.routes.map((route) => route.path_reference),
    ["ISSUE_PATH", "PREFILL_PATH"],
  );
  assert.equal(
    new Set(manifest.routes.map((route) => route.authentication.secret_reference)).size,
    2,
  );
  for (const route of manifest.routes) {
    assert.equal(route.content_type, "application/json");
    assert.equal(route.body_size_reference, "MAX_BODY_BYTES");
    assert.equal(route.body_timeout_reference, "INBOUND_BODY_TIMEOUT_MS");
    assert.ok(route.rate_limit_per_minute > 0);
    assert.ok(route.rate_limit_per_ip_per_minute > 0);
  }
  assert.equal(manifest.activation_gates.some((gate) => /optional-auth|wildcard/.test(gate)), true);
});

test("the concrete Forms desired state keeps RevenueLeakTestRequestForm idempotent and both forms SMS-free", () => {
  const manifest = readJson(path.join(
    repositoryRoot,
    "src/zoho-forms/free-revenue-leak-test/forms-manifest.json",
  ));
  const releaseContract = readJson(path.join(
    repositoryRoot,
    "docs/product/free-revenue-leak-test-release-contract.json",
  ));
  assert.equal(manifest.schema_version, 2);
  assert.deepEqual(manifest.identifier_migration.logical_name_aliases, {
    FORM1_FREE_REVENUE_LEAK_REQUEST: "REVENUE_LEAK_TEST_REQUEST_FORM",
    FORM2_FREE_REVENUE_LEAK_AUTHORIZATION: "REVENUE_LEAK_TEST_SETUP_FORM",
  });
  assert.equal(manifest.identifier_migration.legacy_aliases_are_deployment_targets, false);
  assert.equal(manifest.customer_facing_offer, "Free Revenue Leak Test");
  assert.equal(manifest.real_form_ids_or_urls_in_git, false);
  assert.equal(manifest.forms.length, 2);

  const form1 = manifest.forms.find((form) => form.logical_name === "REVENUE_LEAK_TEST_REQUEST_FORM");
  const form2 = manifest.forms.find(
    (form) => form.logical_name === "REVENUE_LEAK_TEST_SETUP_FORM",
  );
  assert.ok(form1);
  assert.ok(form2);
  assert.deepEqual(form1.crm_integration.deduplication_order, ["Intake_Submission_ID", "Email"]);
  assert.equal(form1.crm_integration.entry_offer, "Free 7-Day Missed-Call");
  assert.equal(form1.crm_integration.entry_offer_crm_display_value, "7-Day Revenue Leak Test");
  assert.equal(form1.crm_integration.entry_offer_customer_label, "Free Revenue Leak Test");
  assert.equal(form1.fixed_metadata.intake_form_version, "revenue-leak-test-request-v1");
  assert.ok(form1.fixed_metadata.intake_form_version.length <= 30);
  assert.equal(form1.fixed_metadata.contact_consent_version, "form1-contact-consent-v1");
  assert.equal(form1.contact_consent.field_type, "Decision Box");
  assert.equal(form1.contact_consent.required, true);
  assert.equal(form1.contact_consent.default, false);
  assert.equal(form1.contact_consent.sms, false);
  assert.match(form1.contact_consent.copy, /calls and emails/i);
  assert.doesNotMatch(form1.contact_consent.copy, /text|sms|message and data|reply stop/i);
  assert.deepEqual(form1.native_notifications, {
    email: false,
    sms: false,
    whatsapp: false,
  });
  assert.equal(form1.native_otp, false);
  assert.match(form1.confirmation_copy, /does not change call routing/i);
  assert.match(form1.confirmation_copy, /start paid service/i);
  assert.deepEqual(form1.field_contract.assisted_path_hidden_audit_fields, ["Source_Page"]);
  const requiredDestinations = Object.values(releaseContract.form1.crm_field_mapping);
  assert.equal(requiredDestinations.length, 29);
  assert.equal(new Set(requiredDestinations).size, requiredDestinations.length);
  assert.deepEqual(form1.field_contract.canonical_required_crm_destinations, requiredDestinations);
  for (const { crm } of FIELD_CONTRACT) {
    assert.equal(requiredDestinations.includes(crm), true, crm);
  }
  assert.equal(form1.field_contract.live_crm_mapping_display_label_count_observed, 6);
  assert.equal(form1.field_contract.live_crm_mapping_api_name_crosswalk_proven, false);
  assert.equal(form1.field_contract.exact_missing_crm_api_destination_set_proven, false);
  const identity = form1.live_configuration_prerequisites.public_intake_submission_identity;
  assert.equal(identity.status, "generation_mechanism_observed_retry_behavior_unproven");
  assert.equal(identity.live_generation_owner, "Zoho Forms");
  assert.match(identity.live_generation_mechanism, /length 10/);
  assert.match(identity.live_generation_mechanism, /repetition restriction enabled/);
  assert.equal(identity.live_change_blocked, true);
  assert.match(identity.required_invariants.join(" "), /non-respondent source/i);
  const privacy = form1.live_configuration_prerequisites.privacy_dictionary;
  assert.equal(
    privacy.status,
    "observed_noncompliant_incomplete_field_by_field_and_runtime_editability_dictionary",
  );
  assert.equal(privacy.live_change_blocked, true);
  assert.equal(privacy.live_readback.observed_deployed_field_count, 26);
  assert.equal(privacy.live_readback.configured_alias_count, 0);
  assert.equal(privacy.live_readback.complete_private_alias_and_read_only_dictionary_proven, false);
  assert.ok(privacy.minimum_named_field_scope.includes("Intake_Submission_ID"));
  assert.ok(privacy.minimum_named_field_scope.includes("assisted prefill token field"));
  assert.match(privacy.rule, /Do not infer/);
  assert.equal(form2.notification.proof_channel, "email");
  assert.equal(form2.notification.sms, false);
  assert.equal(form2.notification.caller_supplied_destination, false);
  assert.match(form2.required_copy.join(" "), /does not approve phone-routing go-live/i);
  assert.match(form2.required_copy.join(" "), /does not authorize paid service/i);
});

test("the package and Catalyst manifests name one Node 24 Advanced I/O target", () => {
  const catalyst = readJson(path.join(controllerRoot, "catalyst.json"));
  const target = catalyst.functions.targets[0];
  assert.deepEqual(catalyst.functions.targets, ["revenue_leak_test_request_form"]);
  const catalystConfig = readJson(path.join(functionRoot, "catalyst-config.json"));
  const packageJson = readJson(path.join(functionRoot, "package.json"));
  const packageLock = readJson(path.join(functionRoot, "package-lock.json"));
  assert.deepEqual(
    [
      path.basename(functionRoot),
      catalystConfig.deployment.name,
      packageJson.name,
      packageLock.name,
      packageLock.packages[""].name,
    ],
    Array(5).fill(target),
  );
  assert.equal(catalystConfig.deployment.stack, "node24");
  assert.equal(catalystConfig.deployment.type, "advancedio");
  assert.equal(packageJson.engines.node, "24.x");
  assert.equal(packageJson.main, catalystConfig.execution.main);
});
