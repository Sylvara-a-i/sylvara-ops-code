'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWeeklyCallReport, weekBounds } = require('../../../tools/build-weekly-call-report');
const { callFact, key } = require('./helpers');

// Synthetic facts only. Passing these assertions does not attest a live source inventory.
const SCOPE = Object.freeze({
  ENVIRONMENT: 'development', CLIENT_KEY: key('b'), DEPLOYMENT_KEY: key('c'),
  CONFIGURATION_VERSION: 'config-v1', ENGAGEMENT_TYPE: 'free_test',
  METRIC_VERSION: 'revenue_desk_metrics_v1',
});
const START = '2026-08-24T04:00:00.000Z';
const END = '2026-08-31T04:00:00.000Z';
const WATERMARK = '2026-08-31T08:00:00.000Z';
const REVISION = 'd'.repeat(40);
const MIX_FIELDS = ['QUALIFIED_OPPORTUNITIES', 'EXISTING_CUSTOMER_CALLS', 'WRONG_FIT_CALLS',
  'SPAM_CALLS', 'UNRESOLVED_CALLS', 'GENERAL_INQUIRY_CALLS', 'PRIVACY_STOP_CALLS'];

function evidence(overrides = {}) {
  return { scope: { ...SCOPE }, periodStartAt: START, periodEndAt: END,
    sourceWatermark: WATERMARK, coveredStartAt: START, completeThroughAt: END,
    inventoryComplete: true, correctionsComplete: true, ...overrides };
}

function options(calls = [], overrides = {}) {
  return { calls, scope: { ...SCOPE }, weekContaining: '2026-08-26T12:00:00.000Z',
    timeZone: 'America/New_York', weekStartsOn: 1, sourceWatermark: WATERMARK,
    sourceRevision: REVISION, completeness: evidence(), ...overrides };
}

function at(startedAt, character, overrides = {}) {
  return callFact({ RECORD_KEY: key(character), CALL_KEY: key(character), STARTED_AT: startedAt,
    ENDED_AT: new Date(Date.parse(startedAt) + 180000).toISOString(),
    SOURCE_MODIFIED_AT: '2026-08-31T06:00:00.000Z', ...overrides });
}

function metric(report, field, observed, total = observed) {
  assert.deepEqual(report.metrics[field], { observed, total, state: total === null ? 'unknown' : 'known' });
}

test('week bounds follow explicit local calendar policy across spring and fall DST', () => {
  const spring = weekBounds('2026-03-08T12:00:00.000Z', 'America/New_York', 1);
  assert.deepEqual(spring, { timeZone: 'America/New_York', weekStartsOn: 1,
    startDate: '2026-03-02', endDate: '2026-03-09',
    startAt: '2026-03-02T05:00:00.000Z', endAt: '2026-03-09T04:00:00.000Z' });
  assert.equal((Date.parse(spring.endAt) - Date.parse(spring.startAt)) / 3600000, 167);
  const fall = weekBounds('2026-11-01T12:00:00.000Z', 'America/New_York', 1);
  assert.deepEqual(fall, { timeZone: 'America/New_York', weekStartsOn: 1,
    startDate: '2026-10-26', endDate: '2026-11-02',
    startAt: '2026-10-26T04:00:00.000Z', endAt: '2026-11-02T05:00:00.000Z' });
  assert.equal((Date.parse(fall.endAt) - Date.parse(fall.startAt)) / 3600000, 169);
});

test('week bounds handle year rollover, fractional timezone offsets, and week-start policy', () => {
  assert.deepEqual(weekBounds('2027-01-01T12:00:00.000Z', 'Asia/Kathmandu', 1), {
    timeZone: 'Asia/Kathmandu', weekStartsOn: 1, startDate: '2026-12-28', endDate: '2027-01-04',
    startAt: '2026-12-27T18:15:00.000Z', endAt: '2027-01-03T18:15:00.000Z',
  });
  assert.equal(weekBounds('2026-08-26T12:00:00.000Z', 'UTC', 0).startAt,
    '2026-08-23T00:00:00.000Z');
  assert.equal(weekBounds('2026-08-26T12:00:00.000Z', 'UTC', 6).startAt,
    '2026-08-22T00:00:00.000Z');
  assert.equal(weekBounds('2026-08-24T03:59:59.999Z', 'America/New_York', 1).startDate,
    '2026-08-17', 'week selection uses the local date of the instant');
});

test('ambiguous or nonexistent midnight boundaries fail instead of silently selecting an offset', () => {
  assert.throws(() => weekBounds('2020-11-01T12:00:00.000Z', 'America/Havana', 0),
    /ambiguous or nonexistent/);
  assert.throws(() => weekBounds('2018-11-04T12:00:00.000Z', 'America/Sao_Paulo', 0),
    /ambiguous or nonexistent/);
});

test('missing or unsupported calendar policy and noncanonical timestamps fail closed', () => {
  for (const zone of [undefined, '', 'EST', '+05:30', 'Invalid/Timezone']) {
    assert.throws(() => weekBounds('2026-08-26T12:00:00.000Z', zone, 1));
  }
  for (const day of [undefined, null, -1, 7, 1.5, '1']) {
    assert.throws(() => weekBounds('2026-08-26T12:00:00.000Z', 'UTC', day));
  }
  for (const instant of ['2026-08-26', '2026-08-26T12:00:00Z',
    '2026-08-26T12:00:00.000+00:00', '2026-02-30T12:00:00.000Z']) {
    assert.throws(() => weekBounds(instant, 'UTC', 1));
  }
  for (const instant of ['1999-12-31T12:00:00.000Z', '2099-12-31T12:00:00.000Z']) {
    assert.throws(() => weekBounds(instant, 'UTC', 1), /2000 through 2099/);
  }
});

test('exact local week boundaries are start-inclusive and end-exclusive within UTC dates', () => {
  const report = buildWeeklyCallReport(options([
    at('2026-08-24T03:59:59.999Z', '1'), at(START, '2'),
    at('2026-08-31T03:59:59.999Z', '3'), at(END, '4'),
  ]));
  metric(report, 'TOTAL_CALLS_HANDLED', 2);
  assert.deepEqual(report.period, { timeZone: 'America/New_York', weekStartsOn: 1,
    startDate: '2026-08-24', endDate: '2026-08-31', startAt: START, endAt: END });
  assert.equal(report.sourceWatermark, WATERMARK);
  assert.equal(report.sourceRevision, REVISION);
  assert.deepEqual(report.scope, SCOPE);
});

test('a complete empty period is verified zero while missing evidence remains unknown', () => {
  const verified = buildWeeklyCallReport(options());
  const missing = buildWeeklyCallReport(options([], { completeness: null }));
  assert.equal(verified.coverage.state, 'complete');
  assert.equal(missing.coverage.state, 'unknown');
  for (const field of Object.keys(verified.metrics)) {
    metric(verified, field, 0);
    metric(missing, field, 0, null);
  }
  assert.equal(verified.corrections.state, 'reconciled_through_watermark');
  assert.equal(missing.corrections.state, 'unknown');
  assert.equal(missing.corrections.latestCallWatermark, null);
  assert.equal(missing.corrections.observedSupersededVersions, 0);
});

test('partial opening and current weeks preserve observations and withhold whole-week totals', () => {
  for (const coverage of [
    { coveredStartAt: '2026-08-25T04:00:00.000Z' },
    { completeThroughAt: '2026-08-27T04:00:00.000Z' },
  ]) {
    const report = buildWeeklyCallReport(options([callFact()], { completeness: evidence(coverage) }));
    assert.equal(report.coverage.state, 'partial');
    metric(report, 'TOTAL_CALLS_HANDLED', 1, null);
    metric(report, 'SPAM_CALLS', 0, null);
  }
  const early = '2026-08-27T04:00:00.000Z';
  const current = buildWeeklyCallReport(options([callFact()], { sourceWatermark: early,
    completeness: evidence({ sourceWatermark: early, completeThroughAt: early }) }));
  assert.equal(current.coverage.completeThroughAt, early);
  metric(current, 'TOTAL_CALLS_HANDLED', 1, null);
});

test('both explicit completeness flags are required before counts become known', () => {
  for (const flags of [{ inventoryComplete: false }, { correctionsComplete: false },
    { inventoryComplete: false, correctionsComplete: false }]) {
    const report = buildWeeklyCallReport(options([callFact()], { completeness: evidence(flags) }));
    assert.equal(report.coverage.state, 'unknown');
    metric(report, 'TOTAL_CALLS_HANDLED', 1, null);
  }
  const zeroWidth = buildWeeklyCallReport(options([], {
    completeness: evidence({ completeThroughAt: START }),
  }));
  assert.equal(zeroWidth.coverage.state, 'unknown');
  metric(zeroWidth, 'TOTAL_CALLS_HANDLED', 0, null);
  for (const field of ['inventoryComplete', 'correctionsComplete']) {
    const missing = evidence();
    delete missing[field];
    assert.throws(() => buildWeeklyCallReport(options([], { completeness: missing })), /booleans/);
  }
});

test('completeness evidence binds exact scope, period, watermark, and valid coverage bounds', () => {
  const invalid = [
    { scope: { ...SCOPE, CLIENT_KEY: key('e') } },
    { periodStartAt: '2026-08-24T00:00:00.000Z' },
    { periodEndAt: '2026-08-31T00:00:00.000Z' },
    { sourceWatermark: '2026-08-31T07:00:00.000Z' },
    { coveredStartAt: '2026-08-24T03:59:59.999Z' },
    { completeThroughAt: '2026-08-31T04:00:00.001Z' },
    { coveredStartAt: END, completeThroughAt: START },
    { inventoryComplete: 'true' },
  ];
  for (const override of invalid) {
    assert.throws(() => buildWeeklyCallReport(options([], { completeness: evidence(override) })));
  }
  const early = '2026-08-27T04:00:00.000Z';
  assert.throws(() => buildWeeklyCallReport(options([], { sourceWatermark: early,
    completeness: evidence({ sourceWatermark: early }) })), /coverage bounds/);
});

test('duplicate replays and permutation of distinct call versions are deterministic and pure', () => {
  const first = callFact();
  const corrected = callFact({ SOURCE_MODIFIED_AT: '2026-08-26T12:00:00.000Z',
    OUTCOME: 'out_of_area', BOOKABLE_OPPORTUNITY: false });
  const second = at('2026-08-25T12:00:00.000Z', 'e', { OUTCOME: 'existing_customer' });
  const input = options([first, corrected, second, { ...first }, { ...corrected }]);
  const before = structuredClone(input);
  const report = buildWeeklyCallReport(input);
  assert.deepEqual(input, before);
  assert.deepEqual(report, buildWeeklyCallReport(options([second, corrected, first])));
  metric(report, 'TOTAL_CALLS_HANDLED', 2);
  metric(report, 'QUALIFIED_OPPORTUNITIES', 0);
  metric(report, 'WRONG_FIT_CALLS', 1);
  assert.equal(report.corrections.observedSupersededVersions, 1);
});

test('same-watermark conflicts reject every ordering including conflicts hidden by a successor', () => {
  const first = callFact();
  const conflict = callFact({ OUTCOME: 'spam' });
  const later = callFact({ SOURCE_MODIFIED_AT: '2026-08-25T12:00:00.000Z' });
  for (const calls of [[first, conflict], [first, conflict, later], [later, first, conflict],
    [first, later, conflict], [conflict, later, first]]) {
    assert.throws(() => buildWeeklyCallReport(options(calls)), /same source watermark/);
  }
});

test('late timestamp corrections move calls out of and into a week before counting', () => {
  const movedOut = at('2026-08-30T12:00:00.000Z', 'a', {
    SOURCE_MODIFIED_AT: '2026-08-30T13:00:00.000Z',
  });
  const successorOut = at(END, 'a', { SOURCE_MODIFIED_AT: '2026-08-31T07:00:00.000Z' });
  const movedIn = at('2026-08-24T03:59:59.999Z', 'e', {
    SOURCE_MODIFIED_AT: '2026-08-24T06:00:00.000Z',
  });
  const successorIn = at(START, 'e', { SOURCE_MODIFIED_AT: '2026-08-31T07:30:00.000Z' });
  const report = buildWeeklyCallReport(options([successorOut, movedIn, movedOut, successorIn]));
  metric(report, 'TOTAL_CALLS_HANDLED', 1);
  assert.equal(report.corrections.observedSupersededVersions, 2);
  assert.equal(report.corrections.latestCallWatermark, successorIn.SOURCE_MODIFIED_AT);
  assert.equal(report.corrections.modifiedAfterWeekEnd, 1);
  const removed = buildWeeklyCallReport(options([movedOut, successorOut]));
  metric(removed, 'TOTAL_CALLS_HANDLED', 0);
  assert.equal(removed.corrections.latestCallWatermark, successorOut.SOURCE_MODIFIED_AT);
});

test('late outcome and handled-state corrections replace old observations', () => {
  const original = callFact();
  const outcome = callFact({ SOURCE_MODIFIED_AT: '2026-08-31T07:00:00.000Z',
    OUTCOME: 'spam', BOOKABLE_OPPORTUNITY: false });
  const report = buildWeeklyCallReport(options([original, outcome]));
  metric(report, 'TOTAL_CALLS_HANDLED', 1);
  metric(report, 'QUALIFIED_OPPORTUNITIES', 0);
  metric(report, 'SPAM_CALLS', 1);
  assert.equal(report.corrections.modifiedAfterWeekEnd, 1);
  const removed = buildWeeklyCallReport(options([original, { ...outcome, HANDLED_RECORDED: false }]));
  metric(removed, 'TOTAL_CALLS_HANDLED', 0);
  metric(removed, 'SPAM_CALLS', 0);
});

test('every call version and off-period row must remain in the explicit report scope', () => {
  const otherScopes = { ENVIRONMENT: 'production', CLIENT_KEY: key('e'), DEPLOYMENT_KEY: key('f'),
    CONFIGURATION_VERSION: 'config-v2', ENGAGEMENT_TYPE: 'paid_service', METRIC_VERSION: 'metrics_v2' };
  for (const [field, value] of Object.entries(otherScopes)) {
    const stale = callFact({ [field]: value });
    const successor = callFact({ SOURCE_MODIFIED_AT: '2026-08-25T12:00:00.000Z' });
    assert.throws(() => buildWeeklyCallReport(options([successor, stale])), /scope/);
    assert.throws(() => buildWeeklyCallReport(options([at(END, 'e', { [field]: value })])), /scope/);
  }
});

test('full outcome mix is exhaustive and urgency overlaps the mix without inflating handled calls', () => {
  const outcomes = ['potential_job', 'urgent_potential_job', 'existing_customer', 'spam',
    'unsupported_service', 'out_of_area', 'other_general_inquiry', 'sensitive_data_ended',
    'configuration_failure', 'caller_abandoned', 'unresolved'];
  const calls = outcomes.map((OUTCOME, index) => callFact({
    RECORD_KEY: key(index.toString(16)), CALL_KEY: key(index.toString(16)), OUTCOME,
    URGENCY_CLASS: index === 1 ? 'urgent' : index === 2 ? 'immediate_danger' : 'routine',
    BOOKABLE_OPPORTUNITY: index < 2, OFFICE_FOLLOW_UP_REQUIRED: index < 3,
  }));
  calls.push(callFact({ RECORD_KEY: key('f'), CALL_KEY: key('f'), HANDLED_RECORDED: false,
    OUTCOME: 'unresolved', URGENCY_CLASS: 'urgent', BOOKABLE_OPPORTUNITY: true }));
  const report = buildWeeklyCallReport(options(calls));
  for (const [field, count] of Object.entries({ TOTAL_CALLS_HANDLED: 11, QUALIFIED_OPPORTUNITIES: 2,
    URGENT_REQUESTS: 2, EXISTING_CUSTOMER_CALLS: 1, WRONG_FIT_CALLS: 2, SPAM_CALLS: 1,
    GENERAL_INQUIRY_CALLS: 1, PRIVACY_STOP_CALLS: 1, UNRESOLVED_CALLS: 3,
    BOOKABLE_OPPORTUNITIES: 2, OFFICE_FOLLOW_UP_CALLS: 3 })) metric(report, field, count);
  assert.equal(MIX_FIELDS.reduce((sum, field) => sum + report.metrics[field].total, 0),
    report.metrics.TOTAL_CALLS_HANDLED.total);
});

test('missing optional flags withhold only the affected totals across all selected UTC days', () => {
  const incomplete = at('2026-08-25T12:00:00.000Z', 'e');
  delete incomplete.BOOKABLE_OPPORTUNITY;
  delete incomplete.OFFICE_FOLLOW_UP_REQUIRED;
  const report = buildWeeklyCallReport(options([callFact(), incomplete]));
  metric(report, 'TOTAL_CALLS_HANDLED', 2);
  metric(report, 'BOOKABLE_OPPORTUNITIES', null, null);
  metric(report, 'OFFICE_FOLLOW_UP_CALLS', null, null);
  const bookableOnlyMissing = { ...incomplete, OFFICE_FOLLOW_UP_REQUIRED: false };
  const separate = buildWeeklyCallReport(options([callFact(), bookableOnlyMissing]));
  metric(separate, 'BOOKABLE_OPPORTUNITIES', null, null);
  metric(separate, 'OFFICE_FOLLOW_UP_CALLS', 1);
  const unhandled = { ...incomplete, HANDLED_RECORDED: false };
  const ignored = buildWeeklyCallReport(options([callFact(), unhandled]));
  metric(ignored, 'BOOKABLE_OPPORTUNITIES', 1);
  metric(ignored, 'OFFICE_FOLLOW_UP_CALLS', 1);
});

test('unknown outcomes and sensitive or unapproved input fields fail closed', () => {
  assert.throws(() => buildWeeklyCallReport(options([callFact({ OUTCOME: 'future_outcome' })])),
    /unsupported call outcome/);
  for (const extra of [{ CALLER_EMAIL: 'synthetic@example.invalid' },
    { TRANSCRIPT: 'synthetic private text' }, { UNAPPROVED_EXTRA: true }]) {
    assert.throws(() => buildWeeklyCallReport(options([callFact(extra)])), /unapproved or sensitive/);
  }
  assert.throws(() => buildWeeklyCallReport(options([], { customerName: 'Synthetic' })), /unsupported/);
  const report = buildWeeklyCallReport(options([callFact()]));
  assert.equal(JSON.stringify(report).includes(key('a')), false, 'output does not expose per-call keys');
});

test('invalid scopes, revisions, watermarks, and call containers fail even for empty periods', () => {
  for (const override of [{ calls: null }, { sourceRevision: 'main' }, { sourceWatermark: null },
    { sourceWatermark: '2026-08-31T08:00:00Z' }, { scope: { ...SCOPE, ENVIRONMENT: 'staging' } },
    { scope: { ...SCOPE, METRIC_VERSION: 'metrics_v2' } }]) {
    assert.throws(() => buildWeeklyCallReport(options([], override)));
  }
  for (const field of Object.keys(SCOPE)) {
    const scope = { ...SCOPE };
    delete scope[field];
    assert.throws(() => buildWeeklyCallReport(options([], { scope })));
  }
  assert.throws(() => buildWeeklyCallReport(options([callFact({
    SOURCE_MODIFIED_AT: '2026-08-31T08:00:00.001Z',
  })])), /watermark precedes/);
});

test('Lord Howe half-hour DST shift preserves the actual weekly interval', () => {
  const period = weekBounds('2026-10-04T12:00:00.000Z', 'Australia/Lord_Howe', 1);
  assert.deepEqual(period, { timeZone: 'Australia/Lord_Howe', weekStartsOn: 1,
    startDate: '2026-09-28', endDate: '2026-10-05',
    startAt: '2026-09-27T13:30:00.000Z', endAt: '2026-10-04T13:00:00.000Z' });
  assert.equal((Date.parse(period.endAt) - Date.parse(period.startAt)) / 3600000, 167.5);
});

test('call timestamps without milliseconds normalize as identical replay evidence', () => {
  const canonical = callFact();
  const withoutMillis = { ...canonical };
  for (const field of ['SOURCE_MODIFIED_AT', 'STARTED_AT', 'ENDED_AT']) {
    withoutMillis[field] = withoutMillis[field].replace('.000Z', 'Z');
  }
  const report = buildWeeklyCallReport(options([withoutMillis, canonical, { ...withoutMillis }]));
  assert.deepEqual(report, buildWeeklyCallReport(options([canonical])));
  metric(report, 'TOTAL_CALLS_HANDLED', 1);
  assert.equal(report.corrections.observedSupersededVersions, 0);
  assert.equal(report.corrections.latestCallWatermark, canonical.SOURCE_MODIFIED_AT);
});

test('omitted completeness keeps even an empty period unknown', () => {
  const input = options();
  delete input.completeness;
  const report = buildWeeklyCallReport(input);
  assert.equal(report.coverage.state, 'unknown');
  assert.equal(report.corrections.state, 'unknown');
  for (const field of Object.keys(report.metrics)) metric(report, field, 0, null);
});
