'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createOutboxRow, minimizeFact, outboxKey, parseOutboxRow, providerVersionKey, targetRow,
} = require('../lib/facts');
const { callFact, key } = require('./helpers');

test('minimized call facts create deterministic v2 outbox rows and changed facts create new keys', () => {
  const createdAt = '2026-08-24T12:06:00.000Z';
  const first = createOutboxRow('call', callFact(), createdAt);
  const duplicate = createOutboxRow('call', { ...callFact() }, createdAt);
  const corrected = createOutboxRow('call', callFact({
    OUTCOME: 'existing_customer', SOURCE_MODIFIED_AT: '2026-08-24T12:07:00.000Z',
  }), createdAt);
  const sameWatermarkConflict = createOutboxRow('call', callFact({ OUTCOME: 'spam' }), createdAt);
  assert.deepEqual(first, duplicate);
  assert.equal(first.ROW_SCHEMA_VERSION, 2);
  assert.equal(first.SYNC_STATUS, 'Pending');
  assert.equal(Object.hasOwn(first, 'STATUS'), false);
  assert.equal(first.SOURCE_DATE_UTC, '2026-08-24');
  assert.equal(first.OUTBOX_KEY, outboxKey('call', callFact()));
  assert.equal(first.PROVIDER_VERSION_KEY, providerVersionKey('call', callFact()));
  assert.notEqual(first.OUTBOX_KEY, corrected.OUTBOX_KEY);
  assert.notEqual(first.PROVIDER_VERSION_KEY, corrected.PROVIDER_VERSION_KEY);
  assert.notEqual(first.OUTBOX_KEY, sameWatermarkConflict.OUTBOX_KEY);
  assert.equal(first.PROVIDER_VERSION_KEY, sameWatermarkConflict.PROVIDER_VERSION_KEY);
  assert.match(first.OUTBOX_KEY, /^[a-f0-9]{64}$/);
  assert.match(first.PROVIDER_VERSION_KEY, /^[a-f0-9]{64}$/);
  const parsed = parseOutboxRow(first, 'development');
  assert.deepEqual(targetRow(parsed), { ...callFact(), PAYLOAD_HASH: first.PAYLOAD_HASH });
});

test('fact allowlists reject PII, transcripts, URLs, raw summaries, nested data, and unknown fields', () => {
  for (const forbidden of [
    { CALLER_NAME: 'Synthetic Person' },
    { PHONE_NUMBER: '+15555550100' },
    { PERSONAL_EMAIL: 'synthetic@example.invalid' },
    { TRANSCRIPT: 'synthetic transcript' },
    { RECORDING_URL: 'https://example.invalid/audio' },
    { ['SECRET_' + 'TOKEN']: 'synthetic-rejected-value' },
    { SUMMARY: 'synthetic summary' },
    { UNKNOWN_FIELD: 'value' },
    { OUTCOME: { nested: true } },
  ]) assert.throws(() => minimizeFact('call', { ...callFact(), ...forbidden }),
    /unapproved|sensitive|safe enum/);
});

test('opaque ownership, call identity, environment, and payload hash conflicts fail closed', () => {
  assert.throws(() => minimizeFact('call', callFact({ CLIENT_KEY: 'raw-client-id' })),
    /opaque SHA-256/);
  assert.throws(() => minimizeFact('call', callFact({ CALL_KEY: key('e') })),
    /must equal/);
  const row = createOutboxRow('call', callFact(), '2026-08-24T12:06:00.000Z');
  assert.throws(() => parseOutboxRow(row, 'production'), /crosses environment/);
  assert.throws(() => parseOutboxRow({ ...row, PAYLOAD_HASH: key('f') }, 'development'),
    /binding conflicts/);
  assert.throws(() => parseOutboxRow({ ...row, PROVIDER_VERSION_KEY: key('f') }, 'development'),
    /provider-version binding conflicts/);
  assert.throws(() => parseOutboxRow({ ...row, SYNC_STATUS: undefined }, 'development'),
    /sync status is invalid/);
  assert.throws(() => parseOutboxRow({ ...row, ROW_SCHEMA_VERSION: 1 }, 'development'),
    /additive v2/);
  assert.throws(() => parseOutboxRow({ ...row, SOURCE_DATE_UTC: '2026-08-25' }, 'development'),
    /source-date binding/);
});

test('all five bounded record types accept only their exact flat contracts', () => {
  const common = {
    SCHEMA_VERSION: 1, METRIC_VERSION: 'revenue_desk_metrics_v1', RECORD_KEY: key('1'),
    CLIENT_KEY: key('2'), DEPLOYMENT_KEY: key('3'), CONFIGURATION_VERSION: 'config-v1',
    ENGAGEMENT_TYPE: 'free_test', ENVIRONMENT: 'development',
    SOURCE_MODIFIED_AT: '2026-08-24T12:05:00.000Z', SOURCE_REVISION: '4'.repeat(40),
  };
  assert.equal(minimizeFact('deployment', {
    ...common, CAPABILITY_PROFILE: 'free_test_v1', PLAN_TIER: 'none',
    DEPLOYMENT_STATUS: 'active', GO_LIVE_APPROVAL_STATUS: 'approved',
    LIMIT_POLICY: 'seven_days_or_25_calls', BILLING_MODE: 'none', HANDLED_COUNT: 1,
    CALL_LIMIT: 25, ACTUAL_START_AT: '2026-08-24T12:00:00.000Z',
    EXPIRES_AT: '2026-08-31T12:00:00.000Z',
  }).CALL_LIMIT, 25);
  assert.equal(minimizeFact('daily_metric', {
    ...common, REPORTING_DATE_UTC: '2026-08-24', TOTAL_CALLS_HANDLED: 1,
    QUALIFIED_OPPORTUNITIES: 1, URGENT_REQUESTS: 0, EXISTING_CUSTOMER_CALLS: 0,
    WRONG_FIT_CALLS: 0, SPAM_CALLS: 0, UNRESOLVED_CALLS: 0,
  }).REPORTING_DATE_UTC, '2026-08-24');
  assert.equal(minimizeFact('final_test_result', {
    ...common, TEST_STARTED_AT: '2026-08-24T12:00:00.000Z',
    TEST_ENDED_AT: '2026-08-31T12:00:00.000Z', TEST_END_REASON: 'seven_day_limit_reached',
    CALLS_CAPTURED: 1, CALL_LIMIT: 25, QUALIFIED_OPPORTUNITIES: 1,
    URGENT_REQUESTS: 0, EXISTING_CUSTOMER_CALLS: 0, WRONG_FIT_CALLS: 0,
    DURATION_EVIDENCE_COMPLETE: true, ANALYSIS_EVIDENCE_COMPLETE: true,
  }).CALLS_CAPTURED, 1);
  assert.equal(minimizeFact('conversion_status', {
    ...common, CRM_CONVERSION_STATUS: 'results_review',
    BILLING_CONVERSION_STATUS: 'not_started', RESULTS_REVIEW_STATUS: 'scheduled',
    PAID_ACCEPTANCE_STATUS: 'not_accepted', TARGET_ENGAGEMENT_TYPE: 'paid_service',
  }).RESULTS_REVIEW_STATUS, 'scheduled');
  assert.throws(() => minimizeFact('conversion_status', {
    ...common, ENGAGEMENT_TYPE: 'paid_service', CRM_CONVERSION_STATUS: 'paid_verified',
    BILLING_CONVERSION_STATUS: 'active', RESULTS_REVIEW_STATUS: 'completed',
    PAID_ACCEPTANCE_STATUS: 'accepted', TARGET_ENGAGEMENT_TYPE: 'paid_service',
  }), /preserve the free-test origin/);
});
