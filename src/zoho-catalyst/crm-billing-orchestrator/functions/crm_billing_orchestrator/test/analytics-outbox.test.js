"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  conversionStatusFact,
  createAnalyticsOutboxStore,
  createOutboxRow,
} = require("../lib/analytics-outbox");
const { loadConfig } = require("../lib/config");
const { REVISION, baseEnvironment } = require("./helpers");

const canonicalFacts = require(path.resolve(
  __dirname,
  "../../../../revenue-desk-analytics/functions/analytics_sync/lib/facts.js",
));
const { keyedDigest: runtimeKeyedDigest } = require(path.resolve(
  __dirname,
  "../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/security.js",
));

function evidence(overrides = {}) {
  return {
    deal: {
      id: "100000000000001",
      Modified_Time: "2026-08-21T10:01:00-05:00",
      Billing_Automation_Status: "Paid Verified",
      Subscription_Status: "Active",
      Test_Status: "Completed",
      Subscription_Acceptance_Status: "Accepted",
      ...overrides.deal,
    },
    accountId: "100000000000002",
    deploymentId: "deployment_A",
    configurationVersion: "cfg_A_v1",
    billingStatus: "Active",
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "deal")),
  };
}

function memoryApp() {
  const rows = [];
  return {
    rows,
    app: {
      datastore() {
        return { table: () => ({
          async insertRow(row) {
            if (rows.some((item) => item.PROVIDER_VERSION_KEY === row.PROVIDER_VERSION_KEY)) {
              throw Object.assign(new Error("synthetic duplicate"), { code: "DUPLICATE" });
            }
            rows.push({ ...row, ROWID: String(rows.length + 1) });
            return rows.at(-1);
          },
        }) };
      },
      zcql() {
        return { async executeZCQLQuery(statement) {
          const key = /PROVIDER_VERSION_KEY = '([a-f0-9]{64})'$/.exec(statement)?.[1];
          return rows.filter((row) => row.PROVIDER_VERSION_KEY === key)
            .map((row) => ({ AnalyticsSyncOutbox: { ...row } }));
        } };
      },
    },
  };
}

test("conversion producer is byte-for-byte compatible with the canonical v2 fact contract", () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const fact = conversionStatusFact(config, evidence());
  const createdAt = "2026-08-21T15:02:00.000Z";
  const local = createOutboxRow(fact, createdAt);
  const canonical = canonicalFacts.createOutboxRow("conversion_status", fact, createdAt);
  assert.deepEqual(local, canonical);
  assert.equal(fact.CLIENT_KEY, runtimeKeyedDigest(
    config.analyticsPartitionSecret, "revenue-desk-analytics-client-v1",
    ["100000000000002"],
  ));
  assert.equal(fact.DEPLOYMENT_KEY, runtimeKeyedDigest(
    config.analyticsPartitionSecret, "revenue-desk-analytics-deployment-v1",
    ["deployment_A"],
  ));
  assert.deepEqual({
    originEngagement: fact.ENGAGEMENT_TYPE,
    targetEngagement: fact.TARGET_ENGAGEMENT_TYPE,
    crm: fact.CRM_CONVERSION_STATUS,
    billing: fact.BILLING_CONVERSION_STATUS,
    review: fact.RESULTS_REVIEW_STATUS,
    acceptance: fact.PAID_ACCEPTANCE_STATUS,
  }, {
    originEngagement: "free_test", targetEngagement: "paid_service",
    crm: "paid_verified", billing: "active",
    review: "completed", acceptance: "accepted",
  });
  assert.doesNotMatch(local.PAYLOAD_JSON,
    /10000000000000|deployment_A|ZZZ|name|email|phone|secret|token|billing_customer/i);
});

test("conversion producer converges exact replays and rejects a same-watermark payload conflict", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const memory = memoryApp();
  const store = createAnalyticsOutboxStore(memory.app, config);
  const createdAt = "2026-08-21T15:02:00.000Z";
  const first = await store.ensureConversionStatus(evidence(), createdAt);
  const replay = await store.ensureConversionStatus(evidence(), createdAt);
  assert.equal(first.inserted, true);
  assert.equal(replay.inserted, false);
  assert.equal(memory.rows.length, 1);
  await assert.rejects(() => store.ensureConversionStatus(evidence({
    deal: { Subscription_Status: "Scheduled" }, billingStatus: "Scheduled",
  }), createdAt), (error) => error.publicCode === "reconciliation_required");
  assert.equal(memory.rows.length, 1);
});

test("conversion producer rejects unknown insert outcomes and unverified Billing state", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const app = {
    datastore: () => ({ table: () => ({ insertRow: async () => { throw new Error("unknown"); } }) }),
    zcql: () => ({ executeZCQLQuery: async () => [] }),
  };
  const store = createAnalyticsOutboxStore(app, config);
  await assert.rejects(() => store.ensureConversionStatus(
    evidence(), "2026-08-21T15:02:00.000Z",
  ), (error) => error.publicCode === "reconciliation_required");
  assert.throws(() => conversionStatusFact(config, evidence({ billingStatus: "Scheduled" })),
    (error) => error.publicCode === "reconciliation_required");
  assert.throws(() => conversionStatusFact(config, evidence({
    deal: { Billing_Automation_Status: "Failed" },
  })), (error) => error.publicCode === "reconciliation_required");
});
