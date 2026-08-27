"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  OUTBOX_IMMUTABLE,
  conversionStatusFact,
  createAnalyticsOutboxStore,
  createOutboxRow,
  outboxKey,
  sha256,
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

function quotedValue(statement, column) {
  const value = new RegExp(`${column} = '((?:''|[^'])*)'`).exec(statement)?.[1];
  return value?.replaceAll("''", "'");
}

function memoryApp(initialRows = []) {
  const rows = initialRows.map((row, index) => ({
    ROWID: String(index + 1), ...row,
  }));
  const statements = [];
  return {
    rows,
    statements,
    app: {
      datastore() {
        return { table: () => ({
          async insertRow(row) {
            if (rows.some((item) => item.OUTBOX_KEY === row.OUTBOX_KEY)) {
              throw Object.assign(new Error("synthetic duplicate"), { code: "DUPLICATE" });
            }
            rows.push({ ...row, ROWID: String(rows.length + 1) });
            return rows.at(-1);
          },
        }) };
      },
      zcql() {
        return { async executeZCQLQuery(statement) {
          statements.push(statement);
          assert.match(statement, / LIMIT 2$/);
          let matches;
          if (statement.includes(" OUTBOX_KEY = ")) {
            matches = rows.filter((row) => (
              row.OUTBOX_KEY === quotedValue(statement, "OUTBOX_KEY")
            ));
          } else {
            matches = rows.filter((row) => Number(row.ROW_SCHEMA_VERSION) === 2
              && row.RECORD_TYPE === quotedValue(statement, "RECORD_TYPE")
              && row.ENVIRONMENT === quotedValue(statement, "ENVIRONMENT")
              && row.CLIENT_KEY === quotedValue(statement, "CLIENT_KEY")
              && row.DEPLOYMENT_KEY === quotedValue(statement, "DEPLOYMENT_KEY")
              && row.RECORD_KEY === quotedValue(statement, "RECORD_KEY")
              && row.SOURCE_MODIFIED_AT === quotedValue(statement, "SOURCE_MODIFIED_AT"));
          }
          return matches.slice(0, 2)
            .map((row) => ({ AnalyticsSyncOutbox: { ...row } }));
        } };
      },
    },
  };
}

test("conversion producer preserves the canonical fact and derives the single outbox key", () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const fact = conversionStatusFact(config, evidence());
  const createdAt = "2026-08-21T15:02:00.000Z";
  const local = createOutboxRow(fact, createdAt);
  const canonical = canonicalFacts.minimizeFact("conversion_status", fact);
  assert.deepEqual(fact, canonical);
  const canonicalRow = canonicalFacts.createOutboxRow("conversion_status", canonical, createdAt);
  assert.deepEqual(local, canonicalRow);
  const expectedKey = sha256([
    "analytics-provider-version-v1", "conversion_status", fact.ENVIRONMENT,
    fact.CLIENT_KEY, fact.DEPLOYMENT_KEY, fact.RECORD_KEY, fact.SOURCE_MODIFIED_AT,
  ].join("\0"));
  assert.equal(local.OUTBOX_KEY, expectedKey);
  assert.equal(outboxKey(fact), expectedKey);
  assert.equal(outboxKey(fact), canonicalFacts.outboxKey("conversion_status", canonical));
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

test("conversion producer converges an exact replay by OUTBOX_KEY", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const memory = memoryApp();
  const store = createAnalyticsOutboxStore(memory.app, config);
  const createdAt = "2026-08-21T15:02:00.000Z";
  const first = await store.ensureConversionStatus(evidence(), createdAt);
  const replay = await store.ensureConversionStatus(evidence(), createdAt);
  assert.equal(first.inserted, true);
  assert.equal(replay.inserted, false);
  assert.equal(memory.rows.length, 1);
  assert.equal(OUTBOX_IMMUTABLE.every(
    (column) => replay.row[column] === first.row[column],
  ), true);
});

test("conversion producer converges concurrent exact replays through the unique outbox key", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const memory = memoryApp();
  const store = createAnalyticsOutboxStore(memory.app, config);
  const results = await Promise.all([
    store.ensureConversionStatus(evidence(), "2026-08-21T15:02:00.000Z"),
    store.ensureConversionStatus(evidence(), "2026-08-21T15:02:00.000Z"),
  ]);
  assert.deepEqual(results.map(({ inserted }) => inserted).sort(), [false, true]);
  assert.equal(memory.rows.length, 1);
  assert.equal(results[0].row.OUTBOX_KEY, results[1].row.OUTBOX_KEY);
});

test("conversion producer fails closed when one watermark resolves to conflicting payloads", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const memory = memoryApp();
  const store = createAnalyticsOutboxStore(memory.app, config);
  const createdAt = "2026-08-21T15:02:00.000Z";
  const original = createOutboxRow(conversionStatusFact(config, evidence()), createdAt);
  const conflictingEvidence = evidence({
    deal: { Subscription_Status: "Scheduled" }, billingStatus: "Scheduled",
  });
  const conflict = createOutboxRow(
    conversionStatusFact(config, conflictingEvidence), createdAt,
  );
  assert.equal(conflict.OUTBOX_KEY, original.OUTBOX_KEY);
  assert.notEqual(conflict.PAYLOAD_HASH, original.PAYLOAD_HASH);
  await store.ensureConversionStatus(evidence(), createdAt);
  await assert.rejects(() => store.ensureConversionStatus(evidence({
    deal: { Subscription_Status: "Scheduled" }, billingStatus: "Scheduled",
  }), createdAt), (error) => error.publicCode === "reconciliation_required");
  assert.equal(memory.rows.length, 1);
});

test("equivalent timestamp spellings normalize before payload and key derivation", () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const offsetFact = conversionStatusFact(config, evidence({
    deal: { Modified_Time: "2026-08-21T10:01:00-05:00" },
  }));
  const utcFact = conversionStatusFact(config, evidence({
    deal: { Modified_Time: "2026-08-21T15:01:00.000Z" },
  }));
  const offsetRow = createOutboxRow(offsetFact, "2026-08-21T10:02:00-05:00");
  const utcRow = createOutboxRow(utcFact, "2026-08-21T15:02:00.000Z");
  assert.equal(offsetFact.SOURCE_MODIFIED_AT, "2026-08-21T15:01:00.000Z");
  assert.deepEqual(offsetFact, utcFact);
  assert.deepEqual(offsetRow, utcRow);
});

test("conversion producer rejects timestamps without an explicit UTC zone or offset", () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  for (const modifiedTime of [
    "2026-08-21", "2026-08-21T15:01:00", "2026-08-21 15:01:00",
    "2026-02-30T15:01:00Z",
  ]) {
    assert.throws(() => conversionStatusFact(config, evidence({
      deal: { Modified_Time: modifiedTime },
    })), (error) => error.publicCode === "reconciliation_required");
  }
  const fact = conversionStatusFact(config, evidence());
  assert.throws(() => createOutboxRow(fact, "2026-08-21T15:02:00"),
    (error) => error.publicCode === "reconciliation_required");
});

test("conversion producer rejects a provider identity owned by a different key", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const createdAt = "2026-08-21T15:02:00.000Z";
  const expected = createOutboxRow(conversionStatusFact(config, evidence()), createdAt);
  const memory = memoryApp([{ ...expected, OUTBOX_KEY: "f".repeat(64) }]);
  const store = createAnalyticsOutboxStore(memory.app, config);
  await assert.rejects(() => store.ensureConversionStatus(evidence(), createdAt),
    (error) => error.publicCode === "reconciliation_required");
  assert.equal(memory.rows.length, 1);
});

test("conversion producer rejects disagreeing exact-key and provider-identity ROWIDs", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const createdAt = "2026-08-21T15:02:00.000Z";
  const expected = createOutboxRow(conversionStatusFact(config, evidence()), createdAt);
  const keyOwner = { ...expected, RECORD_KEY: "e".repeat(64) };
  const identityOwner = { ...expected, OUTBOX_KEY: "f".repeat(64) };
  const memory = memoryApp([keyOwner, identityOwner]);
  const store = createAnalyticsOutboxStore(memory.app, config);
  await assert.rejects(() => store.ensureConversionStatus(evidence(), createdAt),
    (error) => error.publicCode === "reconciliation_required");
  assert.equal(memory.rows.length, 2);
});

test("conversion producer rejects duplicate provider-identity owners before insert", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const createdAt = "2026-08-21T15:02:00.000Z";
  const expected = createOutboxRow(conversionStatusFact(config, evidence()), createdAt);
  const memory = memoryApp([
    { ...expected, OUTBOX_KEY: "e".repeat(64) },
    { ...expected, OUTBOX_KEY: "f".repeat(64) },
  ]);
  const store = createAnalyticsOutboxStore(memory.app, config);
  await assert.rejects(() => store.ensureConversionStatus(evidence(), createdAt),
    (error) => error.publicCode === "reconciliation_required");
  assert.equal(memory.rows.length, 2);
});

test("active conversion rows contain only OUTBOX_KEY for unique identity", () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const row = createOutboxRow(
    conversionStatusFact(config, evidence()), "2026-08-21T15:02:00.000Z",
  );
  const retiredColumn = ["PROVIDER", "VERSION", "KEY"].join("_");
  assert.equal(Object.hasOwn(row, retiredColumn), false);
  assert.deepEqual(OUTBOX_IMMUTABLE.filter((column) => column.endsWith("_KEY")), [
    "OUTBOX_KEY", "RECORD_KEY", "CLIENT_KEY", "DEPLOYMENT_KEY",
  ]);
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
