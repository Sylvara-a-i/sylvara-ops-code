"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { FORM2_PREFILL_MAPPING_SAMPLE: sample } = require("../lib/sample");

const functionRoot = path.resolve(__dirname, "..");
const componentRoot = path.resolve(functionRoot, "../..");
const canonicalContract = require(path.resolve(componentRoot,
  "../revenue-leak-test-setup-form/functions/revenue_leak_test_setup_form/lib/form-contract.js"));

function json(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function syntheticContext() {
  const contactId = "9".repeat(17) + "1";
  const accountId = "9".repeat(17) + "2";
  const dealId = "9".repeat(17) + "3";
  const modifiedTime = "2000-01-01T00:00:00Z";
  const context = {
    contact: { id: contactId, Modified_Time: modifiedTime, Account_Name: { id: accountId } },
    account: { id: accountId, Modified_Time: modifiedTime, Primary_Contact: { id: contactId } },
    deal: { id: dealId, Modified_Time: modifiedTime,
      Contact_Name: { id: contactId }, Account_Name: { id: accountId } }
  };
  const mapping = {
    contact: {
      First_Name: "firstName", Last_Name: "lastName", Decision_Maker_Role: "decisionMakerRole",
      Title: "jobTitle", Decision_Authority: "decisionAuthority", Email: "businessEmail",
      Mobile: "directMobileNumber"
    },
    account: {
      Account_Name: "companyName", Legal_Business_Name: "legalBusinessName",
      Phone: "mainBusinessNumber", Phone_System_Provider: "phoneSystemProvider",
      Primary_Service_Area: "primaryServiceArea", Normal_Business_Hours: "normalBusinessHours",
      Field_Team_Size_Band: "fieldTeamSizeBand", Services_Handled: "servicesHandled",
      Other_Service_Details: "otherServiceDetails"
    },
    deal: {
      Current_Call_Handling: "currentCallHandling", Requested_Test_Route: "requestedTestRoute",
      Approved_Test_Route: "approvedTestRoute", Target_Start_Date: "requestedStartDate",
      No_Answer_Delay: "noAnswerDelay", Forwarding_Administrator_Name: "forwardingAdministratorName",
      Forwarding_Administrator_Mobile: "forwardingAdministratorMobile",
      Approved_Fallback_Destination: "approvedFallbackDestination",
      Approved_Fallback_Number: "approvedFallbackNumber", Rollback_Contact_Name: "rollbackContactName",
      Rollback_Contact_Mobile: "rollbackContactMobile", Urgent_Call_Handling: "urgentCallHandling",
      Existing_Customer_Call_Handling: "existingCustomerCallHandling",
      Alert_Recipient_Name: "alertRecipientName", Alert_Recipient_Email: "alertRecipientEmail"
    }
  };
  for (const [record, fields] of Object.entries(mapping)) {
    for (const [apiName, key] of Object.entries(fields)) context[record][apiName] = sample[key];
  }
  return context;
}

test("35 keys and JSON types match the actual canonical Form 2 prefill builder", () => {
  const prefill = canonicalContract.buildPrefillPayload(syntheticContext(), {
    allowedPhoneSystemProviders: [sample.phoneSystemProvider]
  });
  const expected = { ...prefill, prefillId: sample.prefillId,
    configurationRevision: sample.configurationRevision };
  assert.equal(Object.keys(sample).length, 35);
  assert.deepEqual(Object.keys(sample), [
    ...canonicalContract.CLIENT_KEYS, "prefillId", "configurationRevision"
  ]);
  assert.deepEqual(sample, expected);
  canonicalContract.validateForm2PayloadTypes(prefill);
  assert.equal(sample.authorizedRepresentativeConfirmed, false);
  assert.equal(sample.testScopeAccepted, false);
  assert.equal(Object.isFrozen(sample.servicesHandled), true);
  assert.equal(Object.hasOwn(sample, "submissionId"), false);
});

test("samples contain reserved addresses and numbers, never usable authorization", () => {
  for (const key of ["businessEmail", "alertRecipientEmail"]) {
    assert.match(sample[key], /@example\.invalid$/);
  }
  for (const key of ["directMobileNumber", "mainBusinessNumber", "forwardingAdministratorMobile",
    "approvedFallbackNumber", "rollbackContactMobile"]) {
    assert.match(sample[key], /^\+1 202-555-01[0-9]{2}$/);
  }
  assert.equal(sample.configurationRevision, "0".repeat(40));
  assert.match(sample.prefillId, /^00000000-0000-4000-8000-000000000002$/);
});

test("fixture is one dependency-free isolated Advanced I/O target", () => {
  const catalyst = json(path.join(componentRoot, "catalyst.json"));
  const descriptor = json(path.join(functionRoot, "catalyst-config.json"));
  const packageJson = json(path.join(functionRoot, "package.json"));
  const lock = json(path.join(functionRoot, "package-lock.json"));
  assert.deepEqual(catalyst.functions.targets, ["form2_prefill_mapping_fixture"]);
  assert.deepEqual(descriptor.deployment, {
    name: "form2_prefill_mapping_fixture", stack: "node24", type: "advancedio"
  });
  assert.deepEqual(packageJson.dependencies, {});
  assert.equal(Object.hasOwn(lock.packages[""], "dependencies"), false);
  assert.equal(packageJson.engines.node, "24.x");
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
  assert.match(example, /^FORM2_PREFILL_MAPPING_FIXTURE_MODE=disabled$/m);
  const secretLine = example.split(/\r?\n/).find((line) => line.startsWith("FIXTURE_HEADER_" + "SECRET="));
  assert.equal(secretLine, "FIXTURE_HEADER_" + "SECRET=<independently-generated-32-plus-byte-secret>");
  assert.doesNotMatch(example, /Zoho-oauthtoken|client_secret|refresh_token|@/i);
});

test("deployable source has only the fixed dependency-free allowlist and no logging", () => {
  const sourceFiles = ["index.js", "lib/config.js", "lib/handler.js", "lib/sample.js", "lib/source-revision.js"];
  const source = sourceFiles.map((file) => fs.readFileSync(path.join(functionRoot, file), "utf8")).join("\n");
  assert.deepEqual([...source.matchAll(/require\((?:"|')([^"']+)(?:"|')\)/g)].map((m) => m[1]),
    ["./lib/handler", "node:crypto", "./config", "./sample", "./source-revision"]);
  assert.doesNotMatch(source, /zcatalyst-sdk-node|\.initialize\s*\(|\bfetch\s*\(|https?\.request|createConnection|datastore\s*\(|sendMail|sendSms|console\.|process\.stdout|process\.stderr|\beval\s*\(/i);
});

test("artifact wrapper delegates to the canonical immutable builder with the exact isolated target", () => {
  const wrapper = fs.readFileSync(path.join(componentRoot, "tools/build-release-artifact.js"), "utf8");
  assert.match(wrapper, /tools\/build-catalyst-function-artifact\.js/);
  assert.match(wrapper, /componentSubpath: "src\/zoho-catalyst\/form2-prefill-mapping-fixture"/);
  assert.match(wrapper, /target: "form2_prefill_mapping_fixture"/);
  assert.match(wrapper, /schemaVersion: "form2-prefill-mapping-fixture-release-v1"/);
});
