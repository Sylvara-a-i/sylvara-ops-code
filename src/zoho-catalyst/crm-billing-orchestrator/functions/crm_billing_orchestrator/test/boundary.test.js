"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const functionRoot = path.resolve(__dirname, "..");
const packageRoot = path.resolve(functionRoot, "../..");

test("runtime contains no Zoho Books client or endpoint", () => {
  const libRoot = path.join(functionRoot, "lib");
  for (const name of fs.readdirSync(libRoot)) {
    const source = fs.readFileSync(path.join(libRoot, name), "utf8");
    assert.doesNotMatch(source, /zoho\s*books|\/books\/v\d|ZohoBooks/i, name);
  }
});

test("Catalyst and Node package names match the deployment target", () => {
  const packageConfig = JSON.parse(fs.readFileSync(
    path.join(functionRoot, "package.json"),
    "utf8",
  ));
  const catalystConfig = JSON.parse(fs.readFileSync(
    path.join(functionRoot, "catalyst-config.json"),
    "utf8",
  ));
  assert.equal(packageConfig.name, "crm_billing_orchestrator");
  assert.equal(catalystConfig.deployment.name, packageConfig.name);
  assert.equal(catalystConfig.deployment.stack, "node24");
  assert.equal(catalystConfig.deployment.type, "advancedio");
});

test("blank environment and reviewed variable registry have the same names", () => {
  const envNames = fs.readFileSync(path.join(functionRoot, ".env.example"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split("=", 1)[0])
    .sort();
  const registry = JSON.parse(fs.readFileSync(
    path.join(packageRoot, "config", "variables.json"),
    "utf8",
  ));
  const registryNames = registry.variables.map((entry) => entry.name).sort();
  assert.deepEqual(envNames, registryNames);
});

test("public configuration contains no populated live identifiers, secrets, or prices", () => {
  const environment = fs.readFileSync(path.join(functionRoot, ".env.example"), "utf8");
  for (const line of environment.split(/\r?\n/)) {
    if (!line || /^(DEPLOYMENT_ENVIRONMENT|CRM_API_BASE_URL|BILLING_API_BASE_URL|MAX_BODY_BYTES|OUTBOUND_TIMEOUT_MS|OUTBOUND_MAX_BYTES|PLATFORM_OPERATION_TIMEOUT_MS)=/.test(line)) {
      continue;
    }
    assert.match(line, /^[A-Z0-9_]+=$/);
  }
  assert.doesNotMatch(environment, /\$\d|[1-9][0-9]{7,}/);
});
