"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseActionRequest, validatePayload } = require("../lib/action-contract");
const { loadConfig } = require("../lib/config");
const { safeLog } = require("../lib/safe-log");
const { REVISION, baseEnvironment } = require("./helpers");

test("configuration is immutable Development-only and rejects Production", () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  assert.equal(config.deploymentEnvironment, "development");
  assert.equal(config.developmentFunctionHost, "synthetic.development.catalystserverless.com");
  assert.equal(config.developmentRuntimeProof.length, 64);
  assert.equal(config.freeTestDurationDays, 7);
  assert.equal(config.enablePaidSubscriptionPreparation, false);
  assert.equal(config.customerProvisioningMode, "native_crm_import");
  assert.equal(config.enableTestDirectCustomerProvisioning, false);
  assert.equal(config.setupQaStageValue, "Setup and QA");
  assert.deepEqual(Object.keys(config.paidPlanCodeMap), []);
  assert.throws(
    () => loadConfig(baseEnvironment({ DEPLOYMENT_ENVIRONMENT: "production" }), {
      artifactRevision: REVISION,
    }),
    /Production activation is blocked/,
  );
  assert.throws(
    () => loadConfig(baseEnvironment({
      ENABLE_PAID_SUBSCRIPTION_PREPARATION: "true",
      PAID_PLAN_CODE_MAP: JSON.stringify({ "Launch::Monthly": "launch_plan" }),
    }), { artifactRevision: REVISION }),
    /exact commercial terms/,
  );
  assert.throws(
    () => loadConfig(baseEnvironment({
      ENABLE_PAID_SUBSCRIPTION_PREPARATION: "false",
      PAID_PLAN_CODE_MAP: JSON.stringify({ "Launch::Monthly": "launch_plan" }),
    }), { artifactRevision: REVISION }),
    /invalid size/,
  );
  assert.throws(
    () => loadConfig(baseEnvironment(), { artifactRevision: "b".repeat(40) }),
    /immutable artifact/,
  );
  for (const unsafe of [
    { DEVELOPMENT_FUNCTION_HOST: "synthetic.catalystserverless.com" },
    { DEVELOPMENT_FUNCTION_HOST: "synthetic.development.catalystserverless.com:443" },
    { DEVELOPMENT_RUNTIME_PROOF: "" },
    { DEVELOPMENT_RUNTIME_PROOF: "short" },
  ]) {
    assert.throws(
      () => loadConfig(baseEnvironment(unsafe), { artifactRevision: REVISION }),
      /DEVELOPMENT_FUNCTION_HOST|DEVELOPMENT_RUNTIME_PROOF/,
    );
  }
  const direct = loadConfig(baseEnvironment({
    CUSTOMER_PROVISIONING_MODE: "test_direct_customer",
    ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "true",
  }), { artifactRevision: REVISION });
  assert.equal(direct.customerProvisioningMode, "test_direct_customer");
  assert.equal(direct.enableTestDirectCustomerProvisioning, true);
  for (const unsafe of [
    {
      CUSTOMER_PROVISIONING_MODE: "test_direct_customer",
      ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "false",
    },
    {
      CUSTOMER_PROVISIONING_MODE: "native_crm_import",
      ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "true",
    },
    { CUSTOMER_PROVISIONING_MODE: "unbounded" },
  ]) {
    assert.throws(
      () => loadConfig(baseEnvironment(unsafe), { artifactRevision: REVISION }),
      /CUSTOMER_PROVISIONING_MODE|exact Development test gate/,
    );
  }
});

test("action payload is exactly schemaVersion, action, and dealId", () => {
  assert.deepEqual(validatePayload({
    schemaVersion: "crm-billing-lifecycle-v1",
    action: "ensure_customer",
    dealId: "100000000000001",
  }), {
    schemaVersion: "crm-billing-lifecycle-v1",
    action: "ensure_customer",
    dealId: "100000000000001",
  });
  assert.throws(() => validatePayload({
    schemaVersion: "crm-billing-lifecycle-v1",
    action: "ensure_customer",
    dealId: "100000000000001",
    stage: "forged",
  }), /fields do not match/);
  assert.throws(() => validatePayload({
    schemaVersion: "crm-billing-lifecycle-v1",
    action: "provision_test_customer",
    dealId: "100000000000001",
  }), /unsupported/);
});

test("request boundary authenticates before accepting the exact JSON body", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const body = JSON.stringify({
    schemaVersion: "crm-billing-lifecycle-v1",
    action: "reconcile",
    dealId: "100000000000001",
  });
  const request = {
    method: "POST",
    url: config.allowedPath,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      [config.sharedHeaderName]: config.sharedHeaderValue,
    },
    body,
  };
  assert.equal((await parseActionRequest(request, config)).action, "reconcile");
  request.headers[config.sharedHeaderName] = "wrong";
  await assert.rejects(parseActionRequest(request, config), /authentication failed/);
});

test("safe logger accepts only its coarse six-field contract", () => {
  const lines = [];
  const logger = { info: (line) => lines.push(line) };
  const event = {
    requestId: "00000000-0000-4000-8000-000000000000",
    sourceRevision: REVISION,
    stage: "readback",
    action: "reconcile",
    outcome: "authoritative_readback_confirmed",
    elapsedMs: 12,
  };
  safeLog(logger, "info", event);
  safeLog(logger, "info", { ...event, dealId: "private" });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /private|dealId/);
});
