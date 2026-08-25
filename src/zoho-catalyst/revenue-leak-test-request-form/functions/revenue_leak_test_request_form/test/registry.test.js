"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

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
  assert.equal(form1.crm_integration.entry_offer, "Free Revenue Leak Test");
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
