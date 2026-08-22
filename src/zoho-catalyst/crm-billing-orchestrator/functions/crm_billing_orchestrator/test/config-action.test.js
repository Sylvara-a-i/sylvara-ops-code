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
  assert.equal(config.freeTestDurationDays, 7);
  assert.equal(config.enablePaidSubscriptionPreparation, true);
  assert.equal(config.setupQaStageValue, "Setup and QA");
  assert.equal(config.paidPlanCodeMap["Launch::Monthly"], "launch_plan");
  assert.throws(
    () => loadConfig(baseEnvironment({ DEPLOYMENT_ENVIRONMENT: "production" }), {
      artifactRevision: REVISION,
    }),
    /Production activation is blocked/,
  );
  const evaluationOnly = loadConfig(baseEnvironment({
    ENABLE_PAID_SUBSCRIPTION_PREPARATION: "false",
    PAID_PLAN_CODE_MAP: "{}",
  }), { artifactRevision: REVISION });
  assert.equal(evaluationOnly.enablePaidSubscriptionPreparation, false);
  assert.deepEqual(Object.keys(evaluationOnly.paidPlanCodeMap), []);
  assert.throws(
    () => loadConfig(baseEnvironment(), { artifactRevision: "b".repeat(40) }),
    /immutable artifact/,
  );
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
