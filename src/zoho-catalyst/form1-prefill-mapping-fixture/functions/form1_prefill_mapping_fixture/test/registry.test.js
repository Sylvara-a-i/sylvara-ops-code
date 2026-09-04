"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { FORM1_PREFILL_MAPPING_SAMPLE } = require("../lib/sample");

const functionRoot = path.resolve(__dirname, "..");
const componentRoot = path.resolve(functionRoot, "../..");

function json(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("fixed sample keys stay aligned with the canonical Form 1 prefill contract", () => {
  const canonicalContract = require(path.resolve(
    componentRoot,
    "../revenue-leak-test-request-form/functions/revenue_leak_test_request_form/lib/form-contract.js"
  ));
  const expectedKeys = [
    ...canonicalContract.FIELD_SPECS.map(([key]) => key),
    "prefillId",
    "configurationRevision"
  ];
  assert.deepEqual(Object.keys(FORM1_PREFILL_MAPPING_SAMPLE), expectedKeys);
  assert.equal(Object.keys(FORM1_PREFILL_MAPPING_SAMPLE).length, 23);
  assert.equal(Object.hasOwn(FORM1_PREFILL_MAPPING_SAMPLE, "contactConsent"), false);
  for (const [key, , maximum] of canonicalContract.FIELD_SPECS) {
    assert.equal(typeof FORM1_PREFILL_MAPPING_SAMPLE[key], "string");
    assert.equal([...FORM1_PREFILL_MAPPING_SAMPLE[key]].length <= maximum, true, key);
  }
});

test("fixture is one dependency-free isolated Advanced I/O target", () => {
  const catalyst = json(path.join(componentRoot, "catalyst.json"));
  const descriptor = json(path.join(functionRoot, "catalyst-config.json"));
  const packageJson = json(path.join(functionRoot, "package.json"));
  const lock = json(path.join(functionRoot, "package-lock.json"));
  assert.deepEqual(catalyst.functions.targets, ["form1_prefill_mapping_fixture"]);
  assert.deepEqual(descriptor.deployment, {
    name: "form1_prefill_mapping_fixture",
    stack: "node24",
    type: "advancedio"
  });
  assert.deepEqual(packageJson.dependencies, {});
  assert.equal(Object.hasOwn(lock.packages[""], "dependencies"), false);
});

test("variable registry and placeholder environment stay in lockstep", () => {
  const registry = json(path.join(componentRoot, "config/variables.json"));
  const names = registry.variables.map((entry) => entry.name);
  const example = fs.readFileSync(path.join(functionRoot, ".env.example"), "utf8");
  const exampleNames = example.split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.slice(0, line.indexOf("=")));
  assert.equal(registry.status, "temporary-development-only-default-disabled");
  assert.equal(registry.maximum_active_window_seconds, 14400);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual([...names].sort(), [...exampleNames].sort());
  assert.match(example, /^FORM1_PREFILL_MAPPING_FIXTURE_MODE=disabled$/m);
  const fixtureSecretLine = example.split(/\r?\n/)
    .find((line) => line.startsWith("FIXTURE_HEADER_" + "SECRET="));
  assert.equal(
    fixtureSecretLine,
    "FIXTURE_HEADER_" + "SECRET=<independently-generated-32-plus-byte-secret>",
  );
  assert.doesNotMatch(example, /Zoho-oauthtoken|client_secret|refresh_token|@/i);
});

test("deployable source contains no integration or outbound dependency", () => {
  const sourceFiles = [
    "index.js",
    "lib/config.js",
    "lib/handler.js",
    "lib/sample.js",
    "lib/source-revision.js"
  ];
  const source = sourceFiles.map((file) => fs.readFileSync(path.join(functionRoot, file), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /zcatalyst-sdk-node|\.initialize\s*\(|globalThis\.fetch|\bfetch\s*\(|https?\.request|createConnection|datastore\s*\(|sendMail|sendSms/i);
  assert.equal((source.match(/require\(/g) ?? []).length, 5);
  assert.deepEqual(
    [...source.matchAll(/require\((?:"|')([^"']+)(?:"|')\)/g)].map((match) => match[1]),
    ["./lib/handler", "node:crypto", "./config", "./sample", "./source-revision"]
  );
});
