"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const functionRoot = path.resolve(__dirname, "..");
const componentRoot = path.resolve(functionRoot, "../..");
const repositoryRoot = path.resolve(componentRoot, "../../..");

function json(selected) {
  return JSON.parse(fs.readFileSync(selected, "utf8"));
}

test("the variable registry and placeholder environment remain in exact lockstep", () => {
  const registry = json(path.join(componentRoot, "config/variables.json"));
  assert.equal(registry.schema_version, 4);
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

test("the exact manifest exposes only three authenticated Development routes", () => {
  const manifest = json(path.join(componentRoot, "config/routes.json"));
  assert.equal(manifest.schema_version, 3);
  assert.equal(manifest.environment, "Development");
  assert.equal(manifest.default_action, "reject");
  assert.equal(manifest.cors, false);
  assert.deepEqual(manifest.routes.map((route) => route.id), [
    "FORM1_ISSUE", "FORM1_PREFILL", "FORM1_SUBMISSION",
  ]);
  assert.equal(new Set(manifest.routes.map((route) =>
    route.authentication.secret_reference)).size, 3);
  assert.equal(manifest.routes.every((route) =>
    route.method === "POST" && route.content_type === "application/json"), true);

  const schema = json(path.join(componentRoot, "config/datastore-schema.json"));
  assert.equal(schema.schema_version, 5);
  assert.deepEqual(schema.tables.map((table) => table.expected_api_name),
    ["RevenueLeakTestRequestFormSessions"]);
  assert.equal(schema.tables[0].columns.some((column) =>
    column.api_name === "SUBMISSION_FINGERPRINT"), true);
  assert.equal(schema.tables[0].columns.some((column) =>
    column.api_name === "CRM_RECORD_VERSION"), true);
  assert.equal(schema.tables[0].columns.some((column) =>
    column.api_name === "SESSION_VERSION"), true);
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
    "FORM1_ISSUE", "FORM1_PREFILL", "FORM1_SUBMISSION",
  ]);
  assert.equal(form1.assisted_prefill.submission_lanes.public.writer,
    "existing native CRM upsert");
  assert.equal(form1.assisted_prefill.submission_lanes.assisted
    .browser_supplied_record_or_journey_identity_accepted, false);
  assert.equal(form1.assisted_prefill.production_enabled, false);
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
