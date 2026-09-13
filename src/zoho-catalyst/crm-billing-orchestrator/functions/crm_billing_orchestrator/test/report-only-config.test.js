"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRequestListener } = require("../lib/catalyst-adapter");
const { loadConfig } = require("../lib/config");
const { createOperationStore } = require("../lib/idempotency");
const { createLifecycleHandler } = require("../lib/lifecycle-handler");
const {
  baseEnvironment, REVISION, DEVELOPMENT_ZAID_HMAC_SHA256, SYNTHETIC_DEVELOPMENT_ZAID,
} = require("./helpers");

const FINANCIAL_VARIABLES = Object.freeze([
  "SHARED_HEADER_VALUE", "BILLING_API_BASE_URL", "BILLING_ORGANIZATION_ID",
  "CUSTOMER_PROVISIONING_MODE", "BILLING_READ_CONNECTION_LINK_NAME", "BILLING_WRITE_CONNECTION_LINK_NAME",
  "ANALYTICS_OUTBOX_TABLE", "SUBSCRIPTION_PROPOSED_STAGE_VALUE", "PAID_COMMERCIAL_TERMS_JSON",
  "PAID_PLAN_CODE_MAP", "PAID_USAGE_ADDON_CODE", "PAID_USAGE_ADDON_UNIT", "PAID_USAGE_ADDON_PRODUCT_ID",
  "PAID_SUBSCRIPTION_STATUS_MAP", "PAID_ACCEPTANCE_VALUE", "CLOSED_WON_STAGE_VALUE",
]);
const PROOF = Object.freeze({ artifactRevision: REVISION,
  artifactDevelopmentZaidHmacSha256: DEVELOPMENT_ZAID_HMAC_SHA256 });

function reportEnvironment() {
  const environment = baseEnvironment({ ENABLE_PAID_SUBSCRIPTION_PREPARATION: "false",
    ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "false", ENABLE_DEVELOPMENT_COMPATIBILITY_PROBE: "false" });
  for (const key of FINANCIAL_VARIABLES) delete environment[key];
  return environment;
}

function request(environment, action = "sync_report_summary", credential = environment.REPORT_SUMMARY_HEADER_VALUE) {
  const body = JSON.stringify({ schemaVersion: "crm-billing-lifecycle-v2", action,
    ...(action === "validate_report_summary_contract" ? { case: "report_v2_null_workflow_failures" }
      : { dealId: "100000000000001" }),
    ...(action === "sync_report_summary" ? { operationKey: "a".repeat(64) } : {}),
  });
  return { method: "POST", url: environment.ALLOWED_PATH, body, headers: {
    host: environment.DEVELOPMENT_FUNCTION_HOST, "x-zc-project-key": SYNTHETIC_DEVELOPMENT_ZAID,
    "content-type": "application/json", "content-length": String(Buffer.byteLength(body)),
    [environment.SHARED_HEADER_NAME]: credential,
  } };
}

async function invoke(environment, input, { paidAction = false } = {}) {
  const calls = { sdk: 0, crm: 0, operation: 0, billing: 0, analytics: 0, lifecycle: 0 };
  const listener = createRequestListener({ ...PROOF, environment,
    logger: { error() {}, info() {} },
    catalystSdk: { initialize() { calls.sdk += 1; return {
      config: { projectKey: SYNTHETIC_DEVELOPMENT_ZAID, environment: "Development" },
    }; } },
    factories: {
      createCrmClient() { calls.crm += 1; return {}; },
      createOperationStore() { calls.operation += 1; return {}; },
      createBillingClient() { calls.billing += 1; assert.equal(paidAction, true); return {}; },
      createAnalyticsOutboxStore() { calls.analytics += 1; assert.equal(paidAction, true); return {}; },
      createLifecycleHandler(_config, dependencies) {
        assert.equal(Boolean(dependencies.billingClient), paidAction);
        assert.equal(Boolean(dependencies.analyticsOutbox), paidAction);
        return { async handle() { calls.lifecycle += 1; return {
          outcome: "report_summary_readback_confirmed", duplicate: false,
        }; } };
      },
    },
  });
  const response = { statusCode: null, body: null,
    status(value) { this.statusCode = value; }, setHeader() {},
    end(body) { this.body = JSON.parse(body); },
  };
  await listener(input, response);
  return { calls, status: response.statusCode, body: response.body };
}

test("report-only config needs no financial metadata or credential and keeps all financial flags false", () => {
  const environment = reportEnvironment();
  // Stale saved financial configuration must not be read into a report-only runtime.
  for (const key of FINANCIAL_VARIABLES) Object.defineProperty(environment, key, {
    get() { throw new Error("Financial configuration was accessed"); },
  });
  const config = loadConfig(environment, PROOF);
  assert.equal(config.enablePaidSubscriptionPreparation, false);
  assert.equal(config.enableTestDirectCustomerProvisioning, false);
  assert.equal(config.enableDevelopmentCompatibilityProbe, false);
  for (const key of ["sharedHeaderValue", "billingApiBaseUrl", "billingOrganizationId",
    "customerProvisioningMode", "billingReadConnectionLinkName", "billingWriteConnectionLinkName",
    "analyticsOutboxTable", "paidPlanCodeMap", "subscriptionProposedStageValue"]) {
    assert.equal(Object.hasOwn(config, key), false, key);
  }
  assert.equal(typeof config.analyticsPartitionSecret, "string");
  assert.equal(typeof config.idempotencyPepper, "string");
  assert.equal(config.operationTable, "CRMBillingOperations");
  const store = createOperationStore({ datastore: () => ({ table: () => ({}) }), zcql() {} }, config);
  assert.equal(typeof store.readReportGuard, "function");
});

test("report requests construct only CRM and operation dependencies in report-only or paid-enabled installations", async () => {
  for (const environment of [reportEnvironment(), baseEnvironment()]) {
    const result = await invoke(environment, request(environment));
    assert.equal(result.status, 200);
    assert.deepEqual(result.calls, { sdk: 1, crm: 1, operation: 1, billing: 0, analytics: 0, lifecycle: 1 });
  }
});

test("disabled paid actions and probe cannot pass the report credential before SDK initialization", async () => {
  const environment = reportEnvironment();
  for (const action of ["prepare_paid_subscription", "reconcile", "validate_report_summary_contract"]) {
    const result = await invoke(environment, request(environment, action));
    assert.equal(result.status, action === "validate_report_summary_contract" ? 409 : 401);
    assert.deepEqual(result.calls, { sdk: 0, crm: 0, operation: 0, billing: 0, analytics: 0, lifecycle: 0 });
  }
});

test("missing paid secret cannot authenticate coerced or stale credential values", async () => {
  const environment = reportEnvironment();
  for (const credential of ["undefined", "null", "", null, "s".repeat(32)]) {
    const result = await invoke(environment, request(environment, "reconcile", credential));
    assert.equal(result.status, 401);
    assert.equal(result.calls.sdk, 0);
  }
});

test("contradictory financial gates fail while paid-enabled validation and dependency behavior remain intact", async () => {
  assert.throws(() => loadConfig({ ...reportEnvironment(), ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "true" }, PROOF),
    /Report-only mode requires/);
  assert.throws(() => loadConfig(baseEnvironment({ ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING: "false" }), PROOF),
    /Paid conversion requires/);
  const missing = baseEnvironment();
  delete missing.BILLING_ORGANIZATION_ID;
  assert.throws(() => loadConfig(missing, PROOF), /BILLING_ORGANIZATION_ID/);
  const environment = baseEnvironment();
  const result = await invoke(environment, request(environment, "reconcile", environment.SHARED_HEADER_VALUE),
    { paidAction: true });
  assert.equal(result.status, 200);
  assert.deepEqual(result.calls, { sdk: 1, crm: 1, operation: 1, billing: 1, analytics: 1, lifecycle: 1 });
});

test("enabled paid actions still require financial dependencies before any CRM read or operation claim", async () => {
  const config = loadConfig(baseEnvironment(), PROOF);
  for (const missing of ["billingClient", "analyticsOutbox"]) {
    let reads = 0;
    let claims = 0;
    const dependencies = {
      crmClient: { async getContext() { reads += 1; throw new Error("Unexpected CRM read"); } },
      operationStore: { async claim() { claims += 1; throw new Error("Unexpected claim"); } },
      billingClient: {}, analyticsOutbox: {},
    };
    delete dependencies[missing];
    const lifecycle = createLifecycleHandler(config, dependencies);
    for (const action of ["prepare_paid_subscription", "reconcile"]) {
      await assert.rejects(() => lifecycle.handle({ action, dealId: "100000000000001" }),
        { publicCode: "configuration_invalid" });
    }
    assert.equal(reads, 0);
    assert.equal(claims, 0);
  }
});
