'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDailyMetricFact, deduplicateCalls } = require('../lib/daily-rollup');
const { callFact, key } = require('./helpers');

function options(calls, overrides = {}) {
  return {
    calls,
    reportingDateUtc: '2026-08-24',
    clientKey: key('b'),
    deploymentKey: key('c'),
    configurationVersion: 'config-v1',
    engagementType: 'free_test',
    environment: 'development',
    metricVersion: 'revenue_desk_metrics_v1',
    sourceRevision: 'd'.repeat(40),
    ...overrides,
  };
}

test('daily rollup is deterministic, replay-safe, and preserves metric semantics', () => {
  const first = callFact();
  const second = callFact({
    RECORD_KEY: key('e'), CALL_KEY: key('e'),
    SOURCE_MODIFIED_AT: '2026-08-24T12:15:00.000Z',
    STARTED_AT: '2026-08-24T12:10:00.000Z', ENDED_AT: '2026-08-24T12:12:00.000Z',
    DURATION_SECONDS: 120, OUTCOME: 'existing_customer', URGENCY_CLASS: 'urgent',
    BOOKABLE_OPPORTUNITY: false, OFFICE_FOLLOW_UP_REQUIRED: true,
  });
  const result = buildDailyMetricFact(options([second, first, { ...first }]));
  assert.equal(result.TOTAL_CALLS_HANDLED, 2);
  assert.equal(result.QUALIFIED_OPPORTUNITIES, 1);
  assert.equal(result.URGENT_REQUESTS, 1);
  assert.equal(result.EXISTING_CUSTOMER_CALLS, 1);
  assert.equal(result.BOOKABLE_OPPORTUNITIES, 1);
  assert.equal(result.OFFICE_FOLLOW_UP_CALLS, 2);
  assert.equal(result.SOURCE_MODIFIED_AT, second.SOURCE_MODIFIED_AT);
  assert.match(result.RECORD_KEY, /^[a-f0-9]{64}$/);
  assert.deepEqual(result, buildDailyMetricFact(options([first, second])));
});

test('a later correction replaces an older call fact without double counting', () => {
  const original = callFact();
  const correction = callFact({
    SOURCE_MODIFIED_AT: '2026-08-24T12:20:00.000Z',
    OUTCOME: 'out_of_area', BOOKABLE_OPPORTUNITY: false,
  });
  const unique = deduplicateCalls([correction, original]);
  assert.equal(unique.length, 1);
  assert.equal(unique[0].OUTCOME, 'out_of_area');
  const result = buildDailyMetricFact(options([original, correction]));
  assert.equal(result.TOTAL_CALLS_HANDLED, 1);
  assert.equal(result.QUALIFIED_OPPORTUNITIES, 0);
  assert.equal(result.WRONG_FIT_CALLS, 1);
});

test('same-watermark conflicts and cross-partition or cross-date rows fail closed', () => {
  assert.throws(() => deduplicateCalls([
    callFact(), callFact({ OUTCOME: 'spam' }),
  ]), /same source watermark/);
  assert.throws(() => buildDailyMetricFact(options([
    callFact({ CLIENT_KEY: key('e') }),
  ])), /immutable partition/);
  assert.throws(() => buildDailyMetricFact(options([
    callFact({
      STARTED_AT: '2026-08-25T00:00:00.000Z',
      ENDED_AT: '2026-08-25T00:01:00.000Z',
      SOURCE_MODIFIED_AT: '2026-08-25T00:02:00.000Z',
    }),
  ])), /another UTC date/);
});

test('incomplete structured evidence is withheld rather than converted to zero', () => {
  const incomplete = callFact();
  delete incomplete.BOOKABLE_OPPORTUNITY;
  delete incomplete.OFFICE_FOLLOW_UP_REQUIRED;
  const result = buildDailyMetricFact(options([incomplete]));
  assert.equal(Object.hasOwn(result, 'BOOKABLE_OPPORTUNITIES'), false);
  assert.equal(Object.hasOwn(result, 'OFFICE_FOLLOW_UP_CALLS'), false);
});

test('an empty UTC day produces zero metrics only with an explicit source watermark', () => {
  assert.throws(() => buildDailyMetricFact(options([])), /explicit source watermark/);
  const result = buildDailyMetricFact(options([], {
    sourceModifiedAt: '2026-08-24T23:59:59.000Z',
  }));
  assert.equal(result.TOTAL_CALLS_HANDLED, 0);
  assert.equal(result.QUALIFIED_OPPORTUNITIES, 0);
  assert.equal(result.BOOKABLE_OPPORTUNITIES, 0);
  assert.equal(result.OFFICE_FOLLOW_UP_CALLS, 0);
});

test('every supported handled outcome belongs to exactly one exhaustive call-mix bucket', () => {
  const outcomes = ['potential_job', 'urgent_potential_job', 'existing_customer', 'spam',
    'unsupported_service', 'out_of_area', 'other_general_inquiry', 'sensitive_data_ended',
    'configuration_failure', 'caller_abandoned', 'unresolved'];
  const calls = outcomes.map((OUTCOME, index) => callFact({
    OUTCOME, RECORD_KEY: key(index.toString(16)), CALL_KEY: key(index.toString(16)),
  }));
  const result = buildDailyMetricFact(options(calls));
  assert.equal(result.GENERAL_INQUIRY_CALLS, 1);
  assert.equal(result.PRIVACY_STOP_CALLS, 1);
  assert.equal(result.UNRESOLVED_CALLS, 3, 'legacy unresolved grouping remains unchanged');
  const fields = ['QUALIFIED_OPPORTUNITIES', 'EXISTING_CUSTOMER_CALLS', 'WRONG_FIT_CALLS',
    'SPAM_CALLS', 'UNRESOLVED_CALLS', 'GENERAL_INQUIRY_CALLS', 'PRIVACY_STOP_CALLS'];
  assert.equal(fields.reduce((total, field) => total + result[field], 0), result.TOTAL_CALLS_HANDLED);
  assert.throws(() => buildDailyMetricFact(options([callFact({ OUTCOME: 'unknown_new_outcome' })])),
    /unsupported call outcome/);
});
