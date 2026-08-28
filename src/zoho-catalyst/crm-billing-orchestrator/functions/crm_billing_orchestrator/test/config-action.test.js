"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEVELOPMENT_COMPATIBILITY_PROBE_ACTION,
  DEVELOPMENT_COMPATIBILITY_PROBE_CASES,
  parseActionRequest,
  validatePayload,
} = require("../lib/action-contract");
const {
  ANALYTICS_OUTBOX_TABLE_NAME, OPERATION_TABLE_NAME, loadConfig,
} = require("../lib/config");
const { safeLog } = require("../lib/safe-log");
const {
  PAID_TERMS_VARIABLE,
  REVISION,
  SYNTHETIC_COMMERCIAL_TERMS,
  baseEnvironment,
} = require("./helpers");

const CONDITIONAL_PAID_VARIABLES = Object.freeze([
  PAID_TERMS_VARIABLE,
  "PAID_PLAN_CODE_MAP",
  "PAID_USAGE_ADDON_CODE",
  "PAID_USAGE_ADDON_UNIT",
  "PAID_USAGE_ADDON_PRODUCT_ID",
  "PAID_SUBSCRIPTION_STATUS_MAP",
  "PAID_ACCEPTANCE_VALUE",
  "CLOSED_WON_STAGE_VALUE",
]);

function withoutConditionalPaidVariables(overrides = {}) {
  const environment = baseEnvironment({
    ENABLE_PAID_SUBSCRIPTION_PREPARATION: "false",
    ...overrides,
  });
  for (const name of CONDITIONAL_PAID_VARIABLES) delete environment[name];
  return environment;
}

test("configuration is immutable active Development or dependency-free dark Production", () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  assert.equal(config.deploymentEnvironment, "development");
  assert.equal(config.deploymentMode, "active");
  assert.equal(config.darkMode, false);
  assert.equal(config.developmentFunctionHost, "synthetic.development.catalystserverless.com");
  assert.equal(config.developmentRuntimeProof.length, 64);
  assert.equal(config.enablePaidSubscriptionPreparation, true);
  assert.equal(config.enableDevelopmentCompatibilityProbe, false);
  assert.notEqual(config.reportSummaryHeaderValue, config.sharedHeaderValue);
  assert.equal(config.operationTable, OPERATION_TABLE_NAME);
  assert.equal(config.analyticsOutboxTable, ANALYTICS_OUTBOX_TABLE_NAME);
  assert.equal(
    config.paidCommercialTerms.acceptanceVersion,
    SYNTHETIC_COMMERCIAL_TERMS.acceptanceVersion,
  );
  assert.equal(config.paidCommercialTerms.currency, "USD");
  assert.equal(config.paidCommercialTerms.interval, 1);
  assert.equal(config.paidCommercialTerms.intervalUnit, "months");
  assert.equal(
    config.paidCommercialTerms.commonUsageRateMinor,
    SYNTHETIC_COMMERCIAL_TERMS.commonUsageRateMinor,
  );
  assert.deepEqual(Object.keys(config.paidCommercialTerms.plans).sort(), [
    "Growth::Monthly",
    "Launch::Monthly",
    "Scale::Monthly",
  ]);
  assert.equal(config.customerProvisioningMode, "test_direct_customer");
  assert.equal(config.enableTestDirectCustomerProvisioning, true);
  assert.deepEqual(Object.keys(config.paidPlanCodeMap).sort(), [
    "Growth::Monthly",
    "Launch::Monthly",
    "Scale::Monthly",
  ]);
  assert.equal(config.paidUsageAddonCode, "connected_minute_usage");
  assert.equal(config.paidUsageAddonUnit, "minute");
  assert.equal(config.paidUsageAddonProductId, "400000000000001");
  assert.deepEqual(config.paidSubscriptionStatusMap, { future: "Scheduled", live: "Active" });
  const dark = loadConfig(baseEnvironment({
    DEPLOYMENT_ENVIRONMENT: "production",
    DEPLOYMENT_MODE: "dark",
  }), { artifactRevision: REVISION });
  assert.deepEqual(dark, {
    darkMode: true,
    deploymentEnvironment: "production",
    deploymentMode: "dark",
    sourceRevision: REVISION,
  });
  assert.throws(
    () => loadConfig(baseEnvironment({
      DEPLOYMENT_ENVIRONMENT: "production",
      DEPLOYMENT_MODE: "active",
    }), {
      artifactRevision: REVISION,
    }),
    /production\/dark/,
  );
  assert.equal(loadConfig(baseEnvironment({
    ENABLE_DEVELOPMENT_COMPATIBILITY_PROBE: "true",
  }), { artifactRevision: REVISION }).enableDevelopmentCompatibilityProbe, true);
  for (const invalid of ["", "TRUE", "1", "yes"]) {
    assert.throws(() => loadConfig(baseEnvironment({
      ENABLE_DEVELOPMENT_COMPATIBILITY_PROBE: invalid,
    }), { artifactRevision: REVISION }), /ENABLE_DEVELOPMENT_COMPATIBILITY_PROBE/);
  }
  const disabled = loadConfig(baseEnvironment({
    ENABLE_PAID_SUBSCRIPTION_PREPARATION: "false",
  }), { artifactRevision: REVISION });
  assert.equal(disabled.enablePaidSubscriptionPreparation, false);
  for (const invalidMap of [
    {},
    { "Launch::Monthly": "launch_monthly" },
    {
      "Launch::Monthly": "same",
      "Growth::Monthly": "same",
      "Scale::Monthly": "scale_monthly",
    },
    {
      "Launch::Monthly": "launch_monthly",
      "Growth::Annual": "growth_annual",
      "Scale::Monthly": "scale_monthly",
    },
  ]) {
    assert.throws(
      () => loadConfig(baseEnvironment({ PAID_PLAN_CODE_MAP: JSON.stringify(invalidMap) }), {
        artifactRevision: REVISION,
      }),
      /PAID_PLAN_CODE_MAP/,
    );
  }
  const { acceptanceVersion: _omittedAcceptanceVersion, ...termsWithoutAcceptanceVersion } =
    SYNTHETIC_COMMERCIAL_TERMS;
  for (const invalidTerms of [
    "",
    "not-json",
    JSON.stringify(termsWithoutAcceptanceVersion),
    JSON.stringify({ ...SYNTHETIC_COMMERCIAL_TERMS, extra: true }),
    JSON.stringify({ ...SYNTHETIC_COMMERCIAL_TERMS, acceptanceVersion: "unsafe version" }),
    JSON.stringify({
      ...SYNTHETIC_COMMERCIAL_TERMS,
      acceptanceVersion: `terms-v1:${"0".repeat(64)}`,
    }),
    JSON.stringify({ ...SYNTHETIC_COMMERCIAL_TERMS, currency: "usd" }),
    JSON.stringify({ ...SYNTHETIC_COMMERCIAL_TERMS, currency: "CAD" }),
    JSON.stringify({ ...SYNTHETIC_COMMERCIAL_TERMS, interval: 2 }),
    JSON.stringify({ ...SYNTHETIC_COMMERCIAL_TERMS, intervalUnit: "years" }),
    JSON.stringify({ ...SYNTHETIC_COMMERCIAL_TERMS, commonUsageRateMinor: 0 }),
    JSON.stringify({
      ...SYNTHETIC_COMMERCIAL_TERMS,
      plans: {
        ...SYNTHETIC_COMMERCIAL_TERMS.plans,
        "Growth::Monthly": {
          ...SYNTHETIC_COMMERCIAL_TERMS.plans["Growth::Monthly"],
          recurringMinor: "34567",
        },
      },
    }),
    JSON.stringify({
      ...SYNTHETIC_COMMERCIAL_TERMS,
      plans: {
        "Launch::Monthly": SYNTHETIC_COMMERCIAL_TERMS.plans["Launch::Monthly"],
        "Growth::Monthly": SYNTHETIC_COMMERCIAL_TERMS.plans["Growth::Monthly"],
      },
    }),
  ]) {
    assert.throws(
      () => loadConfig(baseEnvironment({ [PAID_TERMS_VARIABLE]: invalidTerms }), {
        artifactRevision: REVISION,
      }),
      /PAID_COMMERCIAL_TERMS_JSON/,
    );
  }
  for (const unsafeStatusMap of [
    {},
    { future: "Scheduled" },
    { future: "Ready", live: "Ready" },
    { future: "Active", live: "Scheduled" },
    { future: "Pending", live: "Active" },
    { future: "Scheduled", trial: "Trial" },
  ]) {
    assert.throws(
      () => loadConfig(baseEnvironment({
        PAID_SUBSCRIPTION_STATUS_MAP: JSON.stringify(unsafeStatusMap),
      }), { artifactRevision: REVISION }),
      /PAID_SUBSCRIPTION_STATUS_MAP/,
    );
  }
  assert.throws(
    () => loadConfig(baseEnvironment(), { artifactRevision: "b".repeat(40) }),
    /immutable artifact/,
  );
  assert.throws(
    () => loadConfig(baseEnvironment({ OPERATION_TABLE: "LifecycleOperations" }), {
      artifactRevision: REVISION,
    }),
    /canonical CRMBillingOperations table/,
  );
  assert.throws(
    () => loadConfig(baseEnvironment({ ANALYTICS_OUTBOX_TABLE: "AnotherOutbox" }), {
      artifactRevision: REVISION,
    }),
    /canonical AnalyticsSyncOutbox table/,
  );
  const reusedSecretEnvironment = baseEnvironment();
  reusedSecretEnvironment[["ANALYTICS", "PARTITION", "HMAC", "SECRET"].join("_")] =
    reusedSecretEnvironment.IDEMPOTENCY_PEPPER;
  assert.throws(
    () => loadConfig(reusedSecretEnvironment, { artifactRevision: REVISION }),
    /must differ/,
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
      CUSTOMER_PROVISIONING_MODE: "native_crm_import",
      ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "false",
    },
    { ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "false" },
    { CUSTOMER_PROVISIONING_MODE: "unbounded" },
  ]) {
    assert.throws(
      () => loadConfig(baseEnvironment(unsafe), { artifactRevision: REVISION }),
      /CUSTOMER_PROVISIONING_MODE|Development TEST customer gate/,
    );
  }
  for (const unsafe of [
    { PAID_USAGE_ADDON_UNIT: "" },
    { PAID_USAGE_ADDON_UNIT: "connected_minute" },
    { PAID_USAGE_ADDON_UNIT: "Connected AI minute" },
    { PAID_USAGE_ADDON_UNIT: "Connected\nAI minute" },
    { PAID_USAGE_ADDON_PRODUCT_ID: "not-an-id" },
  ]) {
    assert.throws(
      () => loadConfig(baseEnvironment(unsafe), { artifactRevision: REVISION }),
      /PAID_USAGE_ADDON_UNIT|PAID_USAGE_ADDON_PRODUCT_ID/,
    );
  }
});

test("disabled paid mode accepts no paid catalog while report configuration stays mandatory", () => {
  const config = loadConfig(withoutConditionalPaidVariables(), { artifactRevision: REVISION });
  assert.equal(config.enablePaidSubscriptionPreparation, false);
  for (const property of [
    "paidCommercialTerms",
    "paidPlanCodeMap",
    "paidUsageAddonCode",
    "paidUsageAddonUnit",
    "paidUsageAddonProductId",
    "paidSubscriptionStatusMap",
    "paidAcceptanceValue",
    "closedWonStageValue",
  ]) assert.equal(Object.hasOwn(config, property), false);

  for (const requiredName of [
    "REPORT_SUMMARY_HEADER_VALUE",
    "CRM_API_BASE_URL",
    "CRM_READ_CONNECTION_LINK_NAME",
    "CRM_WRITE_CONNECTION_LINK_NAME",
    "OPERATION_TABLE",
    "ANALYTICS_OUTBOX_TABLE",
    "DATASTORE_DUPLICATE_ERROR_CODES",
    "ANALYTICS_PARTITION_HMAC_SECRET",
    "REVENUE_DESK_PIPELINE_VALUE",
    "FREE_TEST_ENTRY_OFFER_VALUE",
    "INITIAL_SALE_TYPE_VALUE",
    "SUBSCRIPTION_PROPOSED_STAGE_VALUE",
    "TEST_COMPLETED_STATUS_VALUE",
  ]) {
    const environment = withoutConditionalPaidVariables();
    delete environment[requiredName];
    assert.throws(
      () => loadConfig(environment, { artifactRevision: REVISION }),
      new RegExp(requiredName),
    );
  }
});

test("enabled paid mode requires and validates every conditional paid value", () => {
  const invalidValues = Object.freeze({
    [PAID_TERMS_VARIABLE]: "{}",
    PAID_PLAN_CODE_MAP: "{}",
    PAID_USAGE_ADDON_CODE: "invalid code",
    PAID_USAGE_ADDON_UNIT: "Connected\nAI minute",
    PAID_USAGE_ADDON_PRODUCT_ID: "not-an-id",
    PAID_SUBSCRIPTION_STATUS_MAP: "{}",
    PAID_ACCEPTANCE_VALUE: "Accepted\nUnsafe",
    CLOSED_WON_STAGE_VALUE: "Closed\nWon",
  });
  for (const name of CONDITIONAL_PAID_VARIABLES) {
    const missing = baseEnvironment();
    delete missing[name];
    assert.throws(
      () => loadConfig(missing, { artifactRevision: REVISION }),
      new RegExp(name),
    );
    assert.throws(
      () => loadConfig(baseEnvironment({ [name]: invalidValues[name] }), {
        artifactRevision: REVISION,
      }),
      new RegExp(name),
    );
  }
});

test("action payloads are exact and only report sync accepts an operation key", () => {
  assert.deepEqual(validatePayload({
    schemaVersion: "crm-billing-lifecycle-v2",
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), {
    schemaVersion: "crm-billing-lifecycle-v2",
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  });
  assert.throws(() => validatePayload({
    schemaVersion: "crm-billing-lifecycle-v2",
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
    stage: "forged",
  }), /fields do not match/);
  for (const action of ["ensure_customer", "start_evaluation", "end_evaluation", "provision_test_customer"]) {
    assert.throws(() => validatePayload({
      schemaVersion: "crm-billing-lifecycle-v2",
      action,
      dealId: "100000000000001",
    }), /unsupported/);
  }
  assert.throws(() => validatePayload({
    schemaVersion: "crm-billing-lifecycle-v1",
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  }), /unsupported/);
  const operationKey = "a".repeat(64);
  assert.deepEqual(validatePayload({
    schemaVersion: "crm-billing-lifecycle-v2",
    action: "sync_report_summary",
    dealId: "100000000000001",
    operationKey,
  }), {
    schemaVersion: "crm-billing-lifecycle-v2",
    action: "sync_report_summary",
    dealId: "100000000000001",
    operationKey,
  });
  assert.throws(() => validatePayload({
    schemaVersion: "crm-billing-lifecycle-v2",
    action: "reconcile",
    dealId: "100000000000001",
    operationKey,
  }), /fields do not match/);
  const selectedCase = DEVELOPMENT_COMPATIBILITY_PROBE_CASES[0];
  assert.deepEqual(validatePayload({
    schemaVersion: "crm-billing-lifecycle-v2",
    action: DEVELOPMENT_COMPATIBILITY_PROBE_ACTION,
    case: selectedCase,
  }), {
    schemaVersion: "crm-billing-lifecycle-v2",
    action: DEVELOPMENT_COMPATIBILITY_PROBE_ACTION,
    case: selectedCase,
  });
  for (const payload of [
    {
      schemaVersion: "crm-billing-lifecycle-v2",
      action: DEVELOPMENT_COMPATIBILITY_PROBE_ACTION,
      case: "unreviewed_case",
    },
    {
      schemaVersion: "crm-billing-lifecycle-v2",
      action: DEVELOPMENT_COMPATIBILITY_PROBE_ACTION,
      case: selectedCase,
      dealId: "100000000000001",
    },
  ]) assert.throws(() => validatePayload(payload), /fields do not match|case is invalid/);
});

test("request boundary authenticates before accepting the exact JSON body", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const body = JSON.stringify({
    schemaVersion: "crm-billing-lifecycle-v2",
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

test("paid and report caller credentials cannot authorize each other's actions", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const makeRequest = (body, credential) => ({
    method: "POST",
    url: config.allowedPath,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      [config.sharedHeaderName]: credential,
    },
    body,
  });
  const reportBody = JSON.stringify({
    schemaVersion: "crm-billing-lifecycle-v2",
    action: "sync_report_summary",
    dealId: "100000000000001",
    operationKey: "a".repeat(64),
  });
  const paidBody = JSON.stringify({
    schemaVersion: "crm-billing-lifecycle-v2",
    action: "prepare_paid_subscription",
    dealId: "100000000000001",
  });
  const probeBody = JSON.stringify({
    schemaVersion: "crm-billing-lifecycle-v2",
    action: DEVELOPMENT_COMPATIBILITY_PROBE_ACTION,
    case: DEVELOPMENT_COMPATIBILITY_PROBE_CASES[1],
  });
  assert.equal((await parseActionRequest(
    makeRequest(reportBody, config.reportSummaryHeaderValue), config,
  )).action, "sync_report_summary");
  await assert.rejects(
    parseActionRequest(makeRequest(reportBody, config.sharedHeaderValue), config),
    /not authorized/,
  );
  await assert.rejects(
    parseActionRequest(makeRequest(paidBody, config.reportSummaryHeaderValue), config),
    /not authorized/,
  );
  assert.equal((await parseActionRequest(
    makeRequest(probeBody, config.reportSummaryHeaderValue), config,
  )).action, DEVELOPMENT_COMPATIBILITY_PROBE_ACTION);
  await assert.rejects(
    parseActionRequest(makeRequest(probeBody, config.sharedHeaderValue), config),
    /not authorized/,
  );
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
