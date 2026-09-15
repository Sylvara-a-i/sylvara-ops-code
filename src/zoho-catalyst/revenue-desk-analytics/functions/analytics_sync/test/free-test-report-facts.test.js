'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  callFact: runtimeCallFact, finalTestResultFact, ensureOutboxRow,
  createOutboxRow: runtimeOutboxRow,
} = require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/analytics-outbox');
const { CONTRACT } = require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/contracts');
const { createOutboxRow, minimizeFact, parseOutboxRow } = require('../lib/facts');
const { callFact, key } = require('./helpers');

const config = { analyticsPartitionSecret: 'synthetic-only-partition-proof-value' };
const deployment = {
  clientId: 'ZZZ-client', deploymentId: 'ZZZ-deployment',
  configurationVersionId: 'ZZZ-config-id', configurationVersion: 'ZZZ-config-v1',
  engagementType: 'free_test', capabilityProfile: 'free_test_v1',
  coverageMode: 'AfterHoursOnly',
};
const row = {
  CLIENT_ID: deployment.clientId, DEPLOYMENT_ID: deployment.deploymentId,
  CONFIGURATION_VERSION_ID: deployment.configurationVersionId,
  ENGAGEMENT_TYPE: deployment.engagementType, SOURCE_ENVIRONMENT: 'development',
  SOURCE_REVISION: 'd'.repeat(40), UPDATED_AT: '2026-08-24T12:05:00.000Z',
  CALL_KEY: `call_${key('a')}`, HANDLED_RECORDED: true,
};
const report = () => ({
  ...deployment, testStart: '2026-08-24T12:00:00.000Z',
  testEnd: '2026-08-25T12:00:00.000Z', testEndReason: 'Operator Stop',
  sourceModifiedAt: '2026-08-25T12:01:00.000Z',
  callsCaptured: 2, callLimit: 25, qualifiedOpportunities: 1, urgentRequests: 0,
  existingCustomerCalls: 1, outOfAreaOrWrongFitCalls: 0,
  bookableOpportunities: 1, officeFollowUpCalls: 1,
  durationEvidenceComplete: true, structuredAnalysisComplete: true,
  actualAverageCallDurationSeconds: 1.25, expectedMonthlyConnectedMinutesMin: 1.17,
  expectedMonthlyConnectedMinutesMax: 1.29,
  expectedMonthlyConnectedMinutesMethodology: CONTRACT.reporting.monthly_connected_minutes_methodology,
  observedWorkflowFailures: 0, workflowFailureEvidenceComplete: true,
  durationWithheldCalls: 0, legacySchemaCallsWithheld: 0,
  recommendedPaidCoverage: 'After Hours Only', inFlightOvershoot: 0,
});

test('call producer preserves exact fractional-second durations without changing legacy seconds', () => {
  const canonical = {
    startedAt: '2026-08-24T12:00:00.000Z', endedAt: '2026-08-24T12:00:02.000Z',
    callStatus: 'ended', outcome: 'potential_job', durationMs: 1500,
  };
  const fact = runtimeCallFact(config, row, canonical);
  assert.equal(fact.DURATION_MILLISECONDS, 1500);
  assert.equal(Object.hasOwn(fact, 'DURATION_SECONDS'), false);
  assert.equal(minimizeFact('call', fact).DURATION_MILLISECONDS, 1500);
  const wholeSecond = runtimeCallFact(config, row, { ...canonical, durationMs: 2000 });
  assert.equal(wholeSecond.DURATION_SECONDS, 2);
  assert.equal(wholeSecond.DURATION_MILLISECONDS, 2000);
  const unavailable = runtimeCallFact(config, row, { ...canonical, durationMs: null });
  assert.equal(Object.hasOwn(unavailable, 'DURATION_MILLISECONDS'), false);
});

test('additive fact fields leave legacy outbox payloads and hashes unchanged', () => {
  const oldFact = callFact();
  const oldRow = createOutboxRow('call', oldFact, '2026-08-24T12:06:00.000Z');
  assert.deepEqual(parseOutboxRow(oldRow, 'development').fact, oldFact);
  assert.deepEqual(createOutboxRow('call', minimizeFact('call', oldFact), oldRow.CREATED_AT), oldRow);
  assert.equal(Object.hasOwn(parseOutboxRow(oldRow, 'development').fact, 'DURATION_MILLISECONDS'), false);
  assert.throws(() => minimizeFact('call', { ...oldFact, DURATION_MILLISECONDS: 1000.5 }), /integer/);
  assert.throws(() => minimizeFact('call', { ...oldFact, DURATION_MILLISECONDS: -1 }), /integer/);
});

test('terminal report facts carry scaled duration, projection, failures and route evidence', () => {
  const result = minimizeFact('final_test_result', finalTestResultFact(config, deployment, row, report()));
  assert.equal(result.ACTUAL_AVERAGE_CALL_DURATION_MILLISECONDS, 1250);
  assert.equal(result.EXPECTED_MONTHLY_CONNECTED_MINUTES_MIN_HUNDREDTHS, 117);
  assert.equal(result.EXPECTED_MONTHLY_CONNECTED_MINUTES_MAX_HUNDREDTHS, 129);
  assert.equal(result.MONTHLY_MINUTES_METHODOLOGY_ID,
    CONTRACT.reporting.monthly_connected_minutes_methodology_id);
  assert.equal(result.OBSERVED_WORKFLOW_FAILURES, 0);
  assert.equal(result.WORKFLOW_FAILURE_EVIDENCE_COMPLETE, true);
  assert.equal(result.DURATION_WITHHELD_CALLS, 0);
  assert.equal(result.LEGACY_SCHEMA_CALLS_WITHHELD, 0);
  assert.equal(result.RECOMMENDED_COVERAGE_MODE, 'after_hours_only');
  assert.equal(result.IN_FLIGHT_OVERSHOOT, 0);
  for (const [coverageMode, recommendedPaidCoverage, expected] of [
    ['NoAnswerOverflowOnly', 'No Answer / Overflow Only', 'no_answer_overflow_only'],
    ['AfterHoursAndOverflow', 'After Hours + Overflow', 'after_hours_and_overflow'],
  ]) {
    const fact = finalTestResultFact(config, { ...deployment, coverageMode }, row,
      { ...report(), recommendedPaidCoverage });
    assert.equal(minimizeFact('final_test_result', fact).RECOMMENDED_COVERAGE_MODE, expected);
  }
});

test('unknown terminal metrics stay absent and false evidence is retained', () => {
  const incomplete = {
    ...report(), actualAverageCallDurationSeconds: null,
    expectedMonthlyConnectedMinutesMin: null, expectedMonthlyConnectedMinutesMax: null,
    observedWorkflowFailures: null, workflowFailureEvidenceComplete: false,
    durationEvidenceComplete: false, recommendedPaidCoverage: null,
  };
  const result = minimizeFact('final_test_result', finalTestResultFact(config, deployment, row, incomplete));
  for (const field of ['ACTUAL_AVERAGE_CALL_DURATION_MILLISECONDS',
    'EXPECTED_MONTHLY_CONNECTED_MINUTES_MIN_HUNDREDTHS',
    'EXPECTED_MONTHLY_CONNECTED_MINUTES_MAX_HUNDREDTHS', 'MONTHLY_MINUTES_METHODOLOGY_ID',
    'OBSERVED_WORKFLOW_FAILURES', 'RECOMMENDED_COVERAGE_MODE']) {
    assert.equal(Object.hasOwn(result, field), false, field);
  }
  assert.equal(result.WORKFLOW_FAILURE_EVIDENCE_COMPLETE, false);
});

test('richer report evidence rejects conflicting units, fabricated availability and new precision', () => {
  assert.throws(() => minimizeFact('call', {
    ...callFact(), DURATION_MILLISECONDS: 1499,
  }), /units conflict/);
  for (const changes of [
    { actualAverageCallDurationSeconds: 1.25001 },
    { actualAverageCallDurationSeconds: -1 },
    { actualAverageCallDurationSeconds: Number.POSITIVE_INFINITY },
    { observedWorkflowFailures: 0.0000000001 },
    { workflowFailureEvidenceComplete: false },
    { durationEvidenceComplete: false },
    { expectedMonthlyConnectedMinutesMin: 1.1701 },
    { expectedMonthlyConnectedMinutesMax: null },
    { expectedMonthlyConnectedMinutesMethodology: 'unknown-method' },
    { recommendedPaidCoverage: 'Paid Launch' },
  ]) assert.throws(() => finalTestResultFact(config, deployment, row, { ...report(), ...changes }),
    /invalid|incomplete|evidence|conflicts/);
  const fact = finalTestResultFact(config, deployment, row, report());
  for (const changes of [
    { DURATION_EVIDENCE_COMPLETE: false },
    { WORKFLOW_FAILURE_EVIDENCE_COMPLETE: false },
    { MONTHLY_MINUTES_METHODOLOGY_ID: null },
    { EXPECTED_MONTHLY_CONNECTED_MINUTES_MIN_HUNDREDTHS: 9999 },
    { RECOMMENDED_COVERAGE_MODE: 'launch' },
  ]) assert.throws(() => minimizeFact('final_test_result', { ...fact, ...changes }),
    /incomplete|invalid|supported route/);
});

test('runtime rematerialization preserves historical call and final facts without a write', async () => {
  const call = runtimeCallFact(config, row, {
    startedAt: '2026-08-24T12:00:00.000Z', endedAt: '2026-08-24T12:00:02.000Z',
    callStatus: 'ended', outcome: 'potential_job', durationMs: 1500,
  });
  const final = finalTestResultFact(config, deployment, row, report());
  const finalAdded = ['ACTUAL_AVERAGE_CALL_DURATION_MILLISECONDS',
    'EXPECTED_MONTHLY_CONNECTED_MINUTES_MIN_HUNDREDTHS',
    'EXPECTED_MONTHLY_CONNECTED_MINUTES_MAX_HUNDREDTHS', 'MONTHLY_MINUTES_METHODOLOGY_ID',
    'OBSERVED_WORKFLOW_FAILURES', 'WORKFLOW_FAILURE_EVIDENCE_COMPLETE',
    'DURATION_WITHHELD_CALLS', 'LEGACY_SCHEMA_CALLS_WITHHELD',
    'RECOMMENDED_COVERAGE_MODE', 'IN_FLIGHT_OVERSHOOT'];
  for (const [kind, fact, added] of [['call', call, ['DURATION_MILLISECONDS']],
    ['final_test_result', final, finalAdded]]) {
    const historicalFact = { ...fact };
    for (const field of added) delete historicalFact[field];
    const historical = { ...runtimeOutboxRow(kind, historicalFact, fact.SOURCE_MODIFIED_AT), ROWID: '1' };
    const rows = [historical];
    let inserts = 0;
    const store = {
      unique: async (_table, _column, key) => rows.find((item) => item.OUTBOX_KEY === key) || null,
      uniqueOutboxProviderIdentity: async (_table, expected) => rows.find((item) => (
        ['RECORD_TYPE', 'ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'RECORD_KEY', 'SOURCE_MODIFIED_AT']
          .every((field) => item[field] === expected[field])
      )) || null,
      insertUnique: async (_table, _column, expected) => {
        inserts += 1;
        const inserted = { ...expected, ROWID: String(rows.length + 1) };
        rows.push(inserted);
        return { inserted: true, row: inserted };
      },
    };
    const runtimeConfig = { ...config, tables: { ANALYTICS_OUTBOX_TABLE: 'SyntheticAnalyticsOutbox' } };
    const result = await ensureOutboxRow(store, runtimeConfig, kind, fact, fact.SOURCE_MODIFIED_AT);
    assert.equal(result.inserted, false);
    assert.deepEqual(result.row, historical);
    assert.equal(inserts, 0);
    assert.equal(rows[0].PAYLOAD_HASH, historical.PAYLOAD_HASH);
    const changedOriginal = kind === 'call' ? { OUTCOME: 'spam' } : { CALLS_CAPTURED: 99 };
    await assert.rejects(() => ensureOutboxRow(store, runtimeConfig, kind,
      { ...fact, ...changedOriginal }, fact.SOURCE_MODIFIED_AT), { code: 'DURABLE_IDEMPOTENCY_CONFLICT' });
    await assert.rejects(() => ensureOutboxRow(store, runtimeConfig, kind,
      { ...fact, UNKNOWN_FIELD: true }, fact.SOURCE_MODIFIED_AT), { code: 'DURABLE_IDEMPOTENCY_CONFLICT' });
    await assert.rejects(() => ensureOutboxRow(store, runtimeConfig, kind,
      { ...fact, SOURCE_REVISION: 'e'.repeat(40) }, fact.SOURCE_MODIFIED_AT), { code: 'DURABLE_IDEMPOTENCY_CONFLICT' });
    const originalHash = rows[0].PAYLOAD_HASH;
    rows[0].PAYLOAD_HASH = '0'.repeat(64);
    await assert.rejects(() => ensureOutboxRow(store, runtimeConfig, kind, fact, fact.SOURCE_MODIFIED_AT),
      { code: 'DURABLE_IDEMPOTENCY_CONFLICT' });
    rows[0].PAYLOAD_HASH = originalHash;
    const originalIdentityRead = store.uniqueOutboxProviderIdentity;
    store.uniqueOutboxProviderIdentity = async () => ({
      ...runtimeOutboxRow(kind, fact, fact.SOURCE_MODIFIED_AT), ROWID: historical.ROWID,
    });
    await assert.rejects(() => ensureOutboxRow(store, runtimeConfig, kind, fact, fact.SOURCE_MODIFIED_AT),
      { code: 'DURABLE_IDEMPOTENCY_CONFLICT' });
    store.uniqueOutboxProviderIdentity = originalIdentityRead;
    const correction = { ...fact, SOURCE_MODIFIED_AT: '2026-08-26T12:01:00.000Z' };
    const newResult = await ensureOutboxRow(store, runtimeConfig, kind, correction, correction.SOURCE_MODIFIED_AT);
    assert.equal(newResult.inserted, true);
    assert.equal(inserts, 1);
    assert.equal(rows.length, 2);
    assert.equal(Object.hasOwn(JSON.parse(newResult.row.PAYLOAD_JSON), added[0]), true);
  }
});
