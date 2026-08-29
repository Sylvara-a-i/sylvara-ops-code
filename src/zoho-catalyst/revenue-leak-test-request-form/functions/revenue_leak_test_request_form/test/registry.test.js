"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const functionRoot = path.resolve(__dirname, "..");
const controllerRoot = path.resolve(functionRoot, "../..");
const repositoryRoot = path.resolve(controllerRoot, "../../..");

const EXACT_VARIABLE_NAMES = [
  "DEPLOYMENT_ENVIRONMENT",
  "DEPLOYMENT_MODE",
  "EXPECTED_CATALYST_PROJECT_ID_SHA256",
  "SOURCE_REVISION",
  "ISSUE_PATH",
  "PREFILL_PATH",
  "ISSUE_HEADER_NAME",
  "PREFILL_HEADER_NAME",
  "ISSUE_HEADER_SECRET",
  "PREFILL_HEADER_SECRET",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sorted(values) {
  return [...values].sort();
}

test("the reduced variable registry and placeholder environment stay in exact lockstep", () => {
  const registry = readJson(path.join(controllerRoot, "config/variables.json"));
  const names = registry.variables.map((entry) => entry.name);
  assert.equal(registry.schema_version, 3);
  assert.equal(registry.status, "development-contained-production-dark");
  assert.deepEqual(names, EXACT_VARIABLE_NAMES);
  assert.equal(new Set(names).size, names.length);
  assert.match(registry.rules.development, /before reading the request body or initializing the Catalyst SDK, Data Store adapter, CRM Connection/);

  const schema = readJson(path.join(controllerRoot, "config/datastore-schema.json"));
  assert.equal(schema.schema_version, 2);
  assert.equal(schema.status, "retained-unbound-containment-evidence");
  assert.deepEqual(
    schema.tables.map((table) => [
      table.runtime_variable,
      table.runtime_binding,
      table.expected_api_name,
    ]),
    [[null, "none-controller-contained", "RevenueLeakTestRequestFormSessions"]],
  );

  const example = fs.readFileSync(path.join(functionRoot, ".env.example"), "utf8");
  const exampleNames = example
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.slice(0, line.indexOf("=")));
  assert.deepEqual(sorted(names), sorted(exampleNames));
  assert.match(example, /^DEPLOYMENT_MODE=contained$/m);
  assert.doesNotMatch(
    example,
    /TOKEN|FORM1_PUBLIC_URL|CRM_|CONNECTION|SESSION|OUTBOUND|Zoho-oauthtoken|client_secret|refresh_token|@/i,
  );
});

test("the exact route manifest keeps both assisted routes disabled and non-successful", () => {
  const manifest = readJson(path.join(controllerRoot, "config/routes.json"));
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.environment, "Development");
  assert.equal(manifest.gateway_state, "required-disabled-assisted-token-transport-unresolved");
  assert.equal(manifest.default_action, "reject");
  assert.equal(manifest.cors, false);
  assert.deepEqual(
    manifest.routes.map((route) => route.id),
    ["FORM1_ISSUE", "FORM1_PREFILL"],
  );
  assert.deepEqual(
    manifest.routes.map((route) => route.path_reference),
    ["ISSUE_PATH", "PREFILL_PATH"],
  );
  assert.equal(
    new Set(manifest.routes.map((route) => route.authentication.secret_reference)).size,
    2,
  );
  for (const route of manifest.routes) {
    assert.equal(route.method, "POST");
    assert.equal(route.content_type, "application/json");
    assert.equal(route.route_state, "disabled");
    assert.equal(route.caller_binding_state, "unbound");
    assert.equal(
      route.controller_state,
      "fail-closed-after-header-validation-before-body-sdk-datastore-adapter-crm-connection-or-outbound-io",
    );
    assert.equal(route.current_response_status, 503);
    assert.equal(route.successful_response_available, false);
    assert.equal(Object.hasOwn(route, "success_status"), false);
    assert.equal(Object.hasOwn(route, "future_success_status_requires_new_transport_review"), false);
    assert.equal(Object.hasOwn(route, "body_size_reference"), false);
    assert.equal(Object.hasOwn(route, "body_timeout_reference"), false);
  }
  assert.match(manifest.rollback.containment_target, /both current and predecessor/);
  assert.match(manifest.rollback.prohibited, /do not restore any pre-containment Form 1/i);
  assert.equal(manifest.activation_gates.some((gate) => /optional-auth|wildcard/.test(gate)), true);
});

test("the Forms and central manifests keep public Form 1 separate from disabled assisted intake", () => {
  const manifest = readJson(path.join(
    repositoryRoot,
    "src/zoho-forms/free-revenue-leak-test/forms-manifest.json",
  ));
  const releaseContract = readJson(path.join(
    repositoryRoot,
    "docs/product/free-revenue-leak-test-release-contract.json",
  ));
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.customer_facing_offer, "Free Revenue Leak Test");
  assert.equal(manifest.real_form_ids_or_urls_in_git, false);
  assert.equal(manifest.forms.length, 2);

  const form1 = manifest.forms.find((form) => form.logical_name === "REVENUE_LEAK_TEST_REQUEST_FORM");
  const form2 = manifest.forms.find(
    (form) => form.logical_name === "REVENUE_LEAK_TEST_SETUP_FORM",
  );
  assert.ok(form1);
  assert.ok(form2);
  assert.equal(form1.purpose, "Public request intake; assisted intake is contained and unavailable");
  assert.deepEqual(form1.crm_integration.deduplication_order, ["Intake_Submission_ID", "Email"]);
  assert.equal(form1.crm_integration.entry_offer, "Free 7-Day Missed-Call");
  assert.equal(form1.crm_integration.entry_offer_crm_display_value, "7-Day Revenue Leak Test");
  assert.equal(form1.crm_integration.entry_offer_customer_label, "Free Revenue Leak Test");
  assert.equal(form1.fixed_metadata.intake_form_version, "revenue-leak-test-request-v1");
  assert.equal(form1.fixed_metadata.contact_consent_version, "form1-contact-consent-v1");
  assert.equal(form1.contact_consent.required, true);
  assert.equal(form1.contact_consent.default, false);
  assert.equal(form1.contact_consent.sms, false);
  assert.deepEqual(form1.native_notifications, {
    email: false,
    sms: false,
    whatsapp: false,
  });
  assert.equal(form1.native_otp, false);
  assert.match(form1.confirmation_copy, /does not change call routing/i);
  assert.match(form1.confirmation_copy, /start paid service/i);
  const requiredDestinations = Object.values(releaseContract.form1.crm_field_mapping);
  assert.equal(requiredDestinations.length, 29);
  assert.equal(new Set(requiredDestinations).size, requiredDestinations.length);
  assert.deepEqual(form1.field_contract.canonical_required_crm_destinations, requiredDestinations);
  assert.equal(form1.field_contract.live_crm_mapping_display_label_count_observed, 30);
  assert.equal(form1.field_contract.live_crm_mapping_api_name_crosswalk_proven, true);
  assert.deepEqual(form1.field_contract.exact_missing_crm_api_destination_set, []);

  const assisted = form1.assisted_prefill;
  assert.equal(assisted.enabled, false);
  assert.deepEqual(assisted.route_states, {
    FORM1_ISSUE: "disabled_returns_503_after_header_validation_before_body_sdk_datastore_adapter_crm_connection_or_outbound_io",
    FORM1_PREFILL: "disabled_returns_503_after_header_validation_before_body_sdk_datastore_adapter_crm_connection_or_outbound_io",
  });
  assert.equal(
    assisted.crm_button_binding_state,
    "retained_bound_to_exact_local_fail_closed_function",
  );
  assert.equal(assisted.crm_button_remote_route_caller, false);
  assert.equal(assisted.remote_assisted_route_caller_binding_state, "unbound");
  assert.equal(assisted.forms_prefill_webhook_binding_state, "unbound");
  assert.equal(assisted.controller_platform_data_dependencies, "none");
  assert.equal(assisted.controller_request_response_platform, "Catalyst Advanced I/O");
  assert.equal(assisted.safe_live_mutation_packet_available, false);
  assert.equal(assisted.pre_containment_rollback_allowed, false);

  const centralAssisted = releaseContract.form1.assisted_path;
  assert.equal(centralAssisted.enabled, false);
  assert.deepEqual(centralAssisted.route_states, assisted.route_states);
  assert.equal(centralAssisted.controller_platform_data_dependencies, "none");
  assert.equal(centralAssisted.controller_request_response_platform, "Catalyst Advanced I/O");
  assert.equal(centralAssisted.pre_containment_rollback_allowed, false);
  assert.deepEqual(releaseContract.oauth_connection_references.revenue_leak_test_request_form, []);
  assert.equal(
    releaseContract.deployment_order.includes("Form 1 cutover"),
    false,
  );
  assert.equal(
    releaseContract.rollback_order.some(
      (step) => /restore the last proven route.*Form 1|Form 1.*restore the last proven route/i.test(step),
    ),
    false,
  );

  assert.equal(form2.notification.proof_channel, "email");
  assert.equal(form2.notification.sms, false);
  assert.equal(form2.notification.caller_supplied_destination, false);
  assert.match(form2.required_copy.join(" "), /does not approve phone-routing go-live/i);
  assert.match(form2.required_copy.join(" "), /does not authorize paid service/i);
});

test("the package is a dependency-free Node 24 Advanced I/O containment target", () => {
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
  assert.equal(Object.hasOwn(packageJson, "dependencies"), false);
  assert.deepEqual(Object.keys(packageLock.packages), [""]);

  const source = fs.readdirSync(path.join(functionRoot, "lib"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => fs.readFileSync(path.join(functionRoot, "lib", name), "utf8"))
    .join("\n");
  for (const forbidden of [
    "zcatalyst-sdk-node",
    "generateToken",
    "hashToken",
    "createSessionStore",
    "createCrmClient",
    "requestJson",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
