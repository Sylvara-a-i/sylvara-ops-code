'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deploymentFact, ensureOutboxRow, createOutboxRow: runtimeOutboxRow } =
  require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/analytics-outbox');
const { buildCrmReportBaseline } = require('../lib/crm-report-baseline');
const { PRETEST_FIELDS, createOutboxRow, minimizeFact, parseOutboxRow, deploymentReportBaseline } = require('../lib/facts');
const { crmBaselineFixture } = require('./helpers/crm-baseline-fixture');

function fixture() {
  const config = { analyticsPartitionSecret: 'synthetic-report-only-partition-value',
    tables: { ANALYTICS_OUTBOX_TABLE: 'SyntheticOutbox' } };
  const deployment = {
    clientId: 'ZZZ-client', deploymentId: 'ZZZ-deployment', configurationVersionId: 'physical-v1',
    configurationVersion: 'label-v1', engagementType: 'free_test', capabilityProfile: 'free_test_v1',
    planTier: 'free_test', limitPolicy: 'seven_days_or_25', billingMode: 'disabled',
    numberOwnership: 'dedicated', environment: 'development', coverageMode: 'AfterHoursOnly',
  };
  const row = { CLIENT_ID: deployment.clientId, DEPLOYMENT_ID: deployment.deploymentId,
    SOURCE_ENVIRONMENT: 'development', SOURCE_REVISION: 'd'.repeat(40),
    UPDATED_AT: '2026-09-08T12:00:00.000Z', TEST_STATUS: 'Completed', GO_LIVE_APPROVAL_STATUS: 'Approved',
    HANDLED_COUNT: 1, CALL_LIMIT: 25, ACTUAL_START_AT: '2026-09-01T12:00:00.000Z',
    EXPIRES_AT: '2026-09-08T12:00:00.000Z', STOPPED_AT: '2026-09-08T12:00:00.000Z', STOP_REASON: 'expired' };
  const original = deploymentFact(config, deployment, row);
  const source = crmBaselineFixture();
  for (const context of [source.context, source.evidence]) {
    context.clientKey = original.CLIENT_KEY; context.deploymentKey = original.DEPLOYMENT_KEY;
    context.configurationVersionId = deployment.configurationVersionId;
    context.configurationVersion = deployment.configurationVersion;
  }
  source.deal.Configuration_Version = deployment.configurationVersion;
  const snapshot = buildCrmReportBaseline(source, { now: Date.parse(row.UPDATED_AT) });
  deployment.configuration = { reportBaseline: structuredClone(snapshot) };
  return { config, deployment, row, source, snapshot, original };
}

test('producer carries exact nine baseline values and provenance through the canonical deployment fact', () => {
  const f = fixture();
  const produced = deploymentFact(f.config, f.deployment, f.row);
  const fact = minimizeFact('deployment', produced);
  assert.deepEqual(produced, fact);
  const baseline = deploymentReportBaseline(fact);
  assert.deepEqual(baseline.values, f.snapshot.values);
  assert.deepEqual(baseline.sourcePeriod, f.snapshot.sourcePeriod);
  assert.equal(baseline.currency, 'USD');
  assert.equal(baseline.evidenceClass, 'customer_supplied_estimate');
  assert.equal(fact.PRETEST_AFTER_HOURS_CALL_SHARE_HUNDREDTHS, 2025);
  assert.equal(fact.PRETEST_ESTIMATED_UNANSWERED_RATE_HUNDREDTHS, 1250);
  const canonical = createOutboxRow('deployment', fact, f.row.UPDATED_AT);
  const runtime = runtimeOutboxRow('deployment', produced, f.row.UPDATED_AT);
  assert.equal(runtime.PAYLOAD_JSON, canonical.PAYLOAD_JSON);
  assert.equal(runtime.PAYLOAD_HASH, canonical.PAYLOAD_HASH);
  assert.deepEqual(parseOutboxRow(canonical, 'development').fact, fact);
  for (const value of Object.values(f.source.context.relationships)) {
    assert.equal(canonical.PAYLOAD_JSON.includes(value), false);
  }
  assert.equal(canonical.PAYLOAD_JSON.includes(f.deployment.configurationVersion), false);
});

test('present baseline unknowns stay absent in transport and reconstruct as null, never zero', () => {
  const f = fixture();
  for (const field of Object.keys(f.deployment.configuration.reportBaseline.values)) {
    f.deployment.configuration.reportBaseline.values[field] = null;
  }
  f.deployment.configuration.reportBaseline.currency = null;
  const fact = minimizeFact('deployment', deploymentFact(f.config, f.deployment, f.row));
  assert.equal(fact.PRETEST_BASELINE_PRESENT, true);
  assert.equal(Object.hasOwn(fact, 'PRETEST_MONTHLY_INBOUND_CALLS'), false);
  assert.equal(Object.hasOwn(fact, 'PRETEST_CURRENCY'), false);
  assert.ok(Object.values(deploymentReportBaseline(fact).values).every((value) => value === null));
  assert.equal(deploymentReportBaseline(f.original), null);
  f.deployment.configuration.reportBaseline.values.monthlyInboundCalls = 0;
  f.deployment.configuration.reportBaseline.values.afterHoursCallBand = 'None';
  const known = deploymentReportBaseline(deploymentFact(f.config, f.deployment, f.row));
  assert.equal(known.values.monthlyInboundCalls, 0);
  assert.equal(known.values.afterHoursCallBand, 'None');
});

test('producer rejects cross-client, physical/CRM version, route, environment and post-start capture', () => {
  for (const mutate of [
    (f) => { f.deployment.configuration.reportBaseline.clientKey = 'a'.repeat(64); },
    (f) => { f.deployment.configuration.reportBaseline.deploymentKey = 'b'.repeat(64); },
    (f) => { f.deployment.configuration.reportBaseline.configurationVersionId = 'wrong-row'; },
    (f) => { f.deployment.configuration.reportBaseline.configurationVersion = 'wrong-label'; },
    (f) => { f.deployment.configuration.reportBaseline.coverageMode = 'AfterHoursAndOverflow'; },
    (f) => { f.deployment.configuration.reportBaseline.environment = 'production'; },
    (f) => { f.deployment.configuration.reportBaseline.capturedAt = '2026-09-01T12:00:00.001Z'; },
    (f) => { f.row.CLIENT_ID = 'ZZZ-other-client'; },
    (f) => { f.row.DEPLOYMENT_ID = 'ZZZ-other-deployment'; },
    (f) => { f.deployment.configuration.reportBaseline.values.currentCallHandling = 'synthetic@example.invalid'; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => deploymentFact(f.config, f.deployment, f.row),
      (error) => ['INVALID_SCHEMA', 'ANALYTICS_FACT_INVALID'].includes(error.code));
  }
});

test('flat baseline rejects incomplete groups, arbitrary choices, invalid units and late timestamps', () => {
  const f = fixture();
  const original = deploymentFact(f.config, f.deployment, f.row);
  for (const mutate of [
    (fact) => { delete fact.PRETEST_BASELINE_PRESENT; },
    (fact) => { fact.PRETEST_BASELINE_PRESENT = false; },
    (fact) => { delete fact.PRETEST_PERIOD_END_AT; },
    (fact) => { fact.PRETEST_PERIOD_END_AT = fact.PRETEST_PERIOD_START_AT; },
    (fact) => { fact.PRETEST_CAPTURED_AT = '2026-09-01T12:00:00.001Z'; },
    (fact) => { fact.PRETEST_EVIDENCE_CLASS = 'confirmed_revenue'; },
    (fact) => { fact.PRETEST_CURRENT_CALL_HANDLING = 'Arbitrary source text'; },
    (fact) => { fact.PRETEST_MONTHLY_INBOUND_CALL_BAND = '25-49'; },
    (fact) => { fact.PRETEST_AFTER_HOURS_CALL_BAND = 'synthetic@example.invalid'; },
    (fact) => { fact.PRETEST_AVERAGE_JOB_VALUE_BAND = '100-249'; },
    (fact) => { fact.PRETEST_AFTER_HOURS_CALL_SHARE_HUNDREDTHS = 10001; },
    (fact) => { fact.PRETEST_ESTIMATED_UNANSWERED_RATE_HUNDREDTHS = 10.5; },
    (fact) => { fact.PRETEST_MONTHLY_INBOUND_CALLS = 1000000000; },
    (fact) => { fact.PRETEST_CURRENCY = 'EUR'; },
    (fact) => { delete fact.PRETEST_CURRENCY; },
  ]) {
    const changed = { ...original }; mutate(changed);
    assert.throws(() => minimizeFact('deployment', changed), { code: 'FACT_INVALID' });
  }
  assert.throws(() => minimizeFact('deployment', { ...f.original, PRETEST_BASELINE_PRESENT: false }),
    { code: 'FACT_INVALID' });
  assert.deepEqual(minimizeFact('deployment', { ...f.original, PRETEST_BASELINE_PRESENT: null }), f.original);
});

test('existing immutable deployment rows retain baseline absence; same-watermark enrichments never rewrite history', async () => {
  const f = fixture();
  const enriched = deploymentFact(f.config, f.deployment, f.row);
  const old = { ...runtimeOutboxRow('deployment', f.original, f.row.UPDATED_AT), ROWID: '1' };
  const rows = [old]; let writes = 0;
  const store = {
    unique: async (_table, _column, value) => rows.find((item) => item.OUTBOX_KEY === value) || null,
    uniqueOutboxProviderIdentity: async (_table, expected) => rows.find((item) => (
      ['RECORD_TYPE', 'ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'RECORD_KEY', 'SOURCE_MODIFIED_AT']
        .every((field) => item[field] === expected[field]))) || null,
    insertUnique: async (_table, _column, expected) => {
      writes += 1; const row = { ...expected, ROWID: String(rows.length + 1) };
      rows.push(row); return { inserted: true, row };
    },
  };
  const before = structuredClone(old);
  const result = await ensureOutboxRow(store, f.config, 'deployment', enriched, f.row.UPDATED_AT);
  assert.equal(result.inserted, false); assert.equal(writes, 0); assert.deepEqual(rows[0], before);
  assert.equal(deploymentReportBaseline(parseOutboxRow(rows[0], 'development').fact), null);
  for (const changes of [{ HANDLED_COUNT: 2 }, { UNKNOWN_FIELD: true }, { SOURCE_REVISION: 'e'.repeat(40) }]) {
    await assert.rejects(() => ensureOutboxRow(store, f.config, 'deployment', { ...enriched, ...changes },
      f.row.UPDATED_AT), { code: 'DURABLE_IDEMPOTENCY_CONFLICT' });
  }
  const correction = { ...enriched, SOURCE_MODIFIED_AT: '2026-09-08T12:01:00.000Z' };
  assert.equal((await ensureOutboxRow(store, f.config, 'deployment', correction, correction.SOURCE_MODIFIED_AT)).inserted, true);
  assert.equal(writes, 1);
  for (const field of Object.keys(PRETEST_FIELDS)) assert.ok(Object.hasOwn(correction, field));
});
