'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { buildOpportunityScenario, scenarioCohortDigest, METHOD_ID } = require('../../../tools/opportunity-scenario');

const key = (value) => crypto.createHash('sha256').update(`synthetic-scenario-${value}`).digest('hex');
const scope = Object.freeze({ CLIENT_KEY: key('client'), DEPLOYMENT_KEY: key('deployment'),
  CONFIGURATION_VERSION: 'synthetic-config-v1', ENVIRONMENT: 'development',
  ENGAGEMENT_TYPE: 'free_test', SOURCE_REVISION: 'd'.repeat(40) });

function bind(input) {
  input.evidence.cohortDigest = scenarioCohortDigest(input.cohort);
  return input;
}

function fixture() {
  const qualifiedCalls = ['new_service_request', 'existing_job_follow_up', 'new_service_request']
    .map((requestKind, index) => ({ ...scope, CALL_KEY: key(`call-${index}`),
      STARTED_AT: `2026-08-31T11:0${index}:00.000Z`, SOURCE_MODIFIED_AT: '2026-08-31T12:00:00.000Z',
      HANDLED_RECORDED: true, OUTCOME: index === 2 ? 'urgent_potential_job' : 'potential_job',
      requestKind, sourceVersion: 1 }));
  return bind({ cohort: { scope: { ...scope },
    period: { startAtUtc: '2026-08-31T10:00:00.000Z', endAtUtc: '2026-08-31T12:30:00.000Z' },
    currency: { code: 'USD', minorUnitDigits: 2 }, callRowsetDigest: key('rowset'), qualifiedCalls },
  evidence: { schemaVersion: 1, cohortDigest: '',
    review: { status: 'reviewed', reviewedAt: '2026-08-31T13:00:00.000Z', reviewerReference: key('reviewer') },
    groups: [
      { groupKey: key('group-0'), callKeys: qualifiedCalls.slice(0, 2).map((call) => call.CALL_KEY), reviewStatus: 'qualified' },
      { groupKey: key('group-1'), callKeys: [qualifiedCalls[2].CALL_KEY], reviewStatus: 'qualified' },
    ] },
  assumptions: { bookingRateBasisPoints: 2500, averageJobValueMinorUnits: 12501, currency: 'USD' } });
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test('reviewed distinct groups produce fractional expectations with transparent aggregate rounding', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const output = buildOpportunityScenario(deepFreeze(input));
  assert.equal(JSON.stringify(input), before);
  assert.equal(output.methodId, METHOD_ID);
  assert.equal(output.label, 'Opportunity scenario');
  assert.equal(output.status, 'complete');
  assert.equal(output.qualifiedCallCount, 3);
  assert.equal(output.reviewedGroupCount, 2);
  assert.equal(output.eligibleGroupCount, 2);
  assert.equal(output.unknownGroupCount, 0);
  assert.equal(output.followUpOnlyGroupCount, 0);
  assert.equal(output.ungroupedQualifiedCallCount, 0);
  assert.equal(output.expectedBookings, 0.5);
  assert.equal(output.scenarioGrossValueMinorUnits, 6251);
  assert.deepEqual(output.assumptions, input.assumptions);
  assert.deepEqual(output.scope, input.cohort.scope);
  assert.deepEqual(output.period, input.cohort.period);
  assert.deepEqual(output.currency, input.cohort.currency);
  assert.deepEqual(output.formula, { eligibleGroupCount: 2, bookingRateBasisPoints: 2500,
    averageJobValueMinorUnits: 12501, expectedBookingsNumerator: '5000', expectedBookingsDenominator: 10000,
    grossValueNumeratorMinorUnits: '62505000', grossValueDenominator: 10000,
    moneyRounding: 'half_up_once_to_minor_unit' });
  for (const object of [output, output.scope, output.period, output.currency, output.assumptions, output.formula]) {
    assert.equal(Object.isFrozen(object), true);
  }
  assert.match(output.limitation, /expectations, not actual bookings or completed jobs/);
  assert.match(output.limitation, /not recovered revenue, collected revenue, profit or ROI/);
  assert.equal(JSON.stringify(output).includes(key('reviewer')), false);
  assert.equal(JSON.stringify(output).includes(key('call-0')), false);
  assert.equal(Object.hasOwn(output, 'actualBookings'), false);
  assert.equal(Object.hasOwn(output, 'paidRevenue'), false);
});

test('repeat calls are one opportunity and input ordering does not change the scenario', () => {
  const input = fixture();
  input.evidence.groups[0].callKeys.push(input.cohort.qualifiedCalls[2].CALL_KEY);
  input.evidence.groups.pop();
  const output = buildOpportunityScenario(input);
  assert.equal(output.qualifiedCallCount, 3);
  assert.equal(output.eligibleGroupCount, 1);
  assert.equal(output.expectedBookings, 0.25);
  assert.equal(output.scenarioGrossValueMinorUnits, 3125);
  const reordered = fixture();
  const original = buildOpportunityScenario(reordered);
  const originalDigest = scenarioCohortDigest(reordered.cohort);
  reordered.cohort.qualifiedCalls.reverse();
  reordered.evidence.groups.reverse();
  reordered.evidence.groups.forEach((group) => group.callKeys.reverse());
  assert.deepEqual(buildOpportunityScenario(reordered), original);
  const reverseKeys = (value) => Object.fromEntries(Object.entries(value).reverse());
  reordered.cohort.scope = reverseKeys(reordered.cohort.scope);
  reordered.cohort.period = reverseKeys(reordered.cohort.period);
  reordered.cohort.currency = reverseKeys(reordered.cohort.currency);
  reordered.cohort.qualifiedCalls = reordered.cohort.qualifiedCalls.map(reverseKeys);
  reordered.cohort = reverseKeys(reordered.cohort);
  assert.equal(scenarioCohortDigest(reordered.cohort), originalDigest);
  assert.deepEqual(buildOpportunityScenario(reordered), original);
});

test('duplicate groups, repeated members and duplicate qualified calls fail closed', () => {
  for (const [mutate, code] of [
    [(f) => { f.evidence.groups[1].groupKey = f.evidence.groups[0].groupKey; }, 'SCENARIO_GROUP_INVALID'],
    [(f) => { f.evidence.groups[0].callKeys.push(f.evidence.groups[0].callKeys[0]); }, 'SCENARIO_MEMBER_DUPLICATE'],
    [(f) => { f.evidence.groups[1].callKeys = [f.evidence.groups[0].callKeys[0]]; }, 'SCENARIO_MEMBER_DUPLICATE'],
    [(f) => { f.cohort.qualifiedCalls.push({ ...f.cohort.qualifiedCalls[0] }); }, 'SCENARIO_CALL_INVALID'],
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => buildOpportunityScenario(input), { code });
  }
});

test('value assumptions change money only while booking rates change expected bookings', () => {
  const input = fixture();
  const original = buildOpportunityScenario(input);
  input.assumptions.averageJobValueMinorUnits *= 2;
  const higherValue = buildOpportunityScenario(input);
  assert.equal(higherValue.expectedBookings, original.expectedBookings);
  assert.equal(higherValue.formula.expectedBookingsNumerator, original.formula.expectedBookingsNumerator);
  assert.equal(higherValue.scenarioGrossValueMinorUnits, 12501);
  input.assumptions.averageJobValueMinorUnits = 12501;
  input.assumptions.bookingRateBasisPoints = 5000;
  const higherRate = buildOpportunityScenario(input);
  assert.equal(higherRate.expectedBookings, original.expectedBookings * 2);
  assert.equal(higherRate.scenarioGrossValueMinorUnits, 12501);
  for (const field of ['qualifiedCallCount', 'reviewedGroupCount', 'eligibleGroupCount',
    'unknownGroupCount', 'followUpOnlyGroupCount', 'ungroupedQualifiedCallCount']) {
    assert.equal(higherValue[field], original[field]);
    assert.equal(higherRate[field], original[field]);
  }
  assert.deepEqual(input.cohort, fixture().cohort);
  assert.deepEqual(input.evidence, fixture().evidence);
});

test('explicit zero, full booking rate and an explicitly reviewed empty cohort are valid', () => {
  for (const [rate, value, expectedBookings, gross] of [[0, 12501, 0, 0], [10000, 12501, 2, 25002],
    [2500, 0, 0.5, 0], [0, 0, 0, 0]]) {
    const input = fixture();
    input.assumptions.bookingRateBasisPoints = rate;
    input.assumptions.averageJobValueMinorUnits = value;
    const output = buildOpportunityScenario(input);
    assert.equal(output.status, 'complete');
    assert.equal(output.expectedBookings, expectedBookings);
    assert.equal(output.scenarioGrossValueMinorUnits, gross);
  }
  const empty = fixture();
  empty.cohort.qualifiedCalls = [];
  empty.evidence.groups = [];
  const output = buildOpportunityScenario(bind(empty));
  assert.equal(output.status, 'complete');
  assert.equal(output.eligibleGroupCount, 0);
  assert.equal(output.expectedBookings, 0);
  assert.equal(output.scenarioGrossValueMinorUnits, 0);
  assert.equal(output.formula.expectedBookingsNumerator, '0');
});

test('assumptions are required and reject coercion, fractions, out-of-range rates and unsafe amounts', () => {
  for (const assumptions of [undefined, null, {}, { bookingRateBasisPoints: 2500 },
    { averageJobValueMinorUnits: 12501, currency: 'USD' },
    { bookingRateBasisPoints: 2500, averageJobValueMinorUnits: 12501 }]) {
    const input = fixture(); input.assumptions = assumptions;
    assert.throws(() => buildOpportunityScenario(input), { code: 'SCENARIO_ASSUMPTIONS_INVALID' });
  }
  for (const [field, values] of [
    ['bookingRateBasisPoints', [-1, 10001, 0.5, '2500', NaN, Infinity]],
    ['averageJobValueMinorUnits', [-1, 0.5, '12501', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]],
  ]) {
    for (const value of values) {
      const input = fixture(); input.assumptions[field] = value;
      assert.throws(() => buildOpportunityScenario(input), { code: 'SCENARIO_ASSUMPTIONS_INVALID' });
    }
  }
  const absent = fixture(); delete absent.assumptions;
  assert.throws(() => buildOpportunityScenario(absent), { code: 'SCENARIO_INPUT_INVALID' });
});

test('large exact intermediates are supported but unsafe final currency totals are rejected', () => {
  const input = fixture();
  input.assumptions.averageJobValueMinorUnits = Number.MAX_SAFE_INTEGER;
  input.assumptions.bookingRateBasisPoints = 1;
  const tinyRate = buildOpportunityScenario(input);
  assert.equal(tinyRate.expectedBookings, 0.0002);
  assert.equal(tinyRate.formula.grossValueNumeratorMinorUnits, 18_014_398_509_481_982n.toString());
  assert.equal(tinyRate.scenarioGrossValueMinorUnits, 1801439850948);
  input.assumptions.bookingRateBasisPoints = 5000;
  assert.equal(buildOpportunityScenario(input).scenarioGrossValueMinorUnits, Number.MAX_SAFE_INTEGER);
  input.assumptions.bookingRateBasisPoints = 10000;
  assert.throws(() => buildOpportunityScenario(input), { code: 'SCENARIO_TOTAL_OVERFLOW' });
  input.assumptions.bookingRateBasisPoints = 0;
  assert.equal(buildOpportunityScenario(input).scenarioGrossValueMinorUnits, 0);
});

test('reporting currency uses an explicit valid code and matching minor-unit exponent without conversion', () => {
  for (const [code, minorUnitDigits] of [['USD', 2], ['JPY', 0], ['BHD', 3]]) {
    const input = fixture();
    input.cohort.currency = { code, minorUnitDigits };
    input.assumptions.currency = code;
    const output = buildOpportunityScenario(bind(input));
    assert.deepEqual(output.currency, { code, minorUnitDigits });
    assert.equal(output.scenarioGrossValueMinorUnits, 6251);
  }
  for (const currency of [{ code: 'usd', minorUnitDigits: 2 }, { code: 'ZZZ', minorUnitDigits: 2 },
    { code: 'USD', minorUnitDigits: 3 }, { code: 'JPY', minorUnitDigits: 2 },
    { code: 'BHD', minorUnitDigits: '3' }, { code: 'USD' }]) {
    const input = fixture(); input.cohort.currency = currency;
    assert.throws(() => buildOpportunityScenario(input), { code: 'SCENARIO_CURRENCY_INVALID' });
  }
  const mismatch = fixture(); mismatch.assumptions.currency = 'EUR';
  assert.throws(() => buildOpportunityScenario(mismatch), { code: 'SCENARIO_CURRENCY_CONFLICT' });
});

test('cross-scope calls and reviewed evidence for a changed cohort cannot be reused', () => {
  const otherScope = { CLIENT_KEY: key('other-client'), DEPLOYMENT_KEY: key('other-deployment'),
    CONFIGURATION_VERSION: 'synthetic-config-v2', ENVIRONMENT: 'production',
    ENGAGEMENT_TYPE: 'paid_service', SOURCE_REVISION: 'e'.repeat(40) };
  for (const [field, value] of Object.entries(otherScope)) {
    const crossScope = fixture(); crossScope.cohort.qualifiedCalls[0][field] = value;
    assert.throws(() => buildOpportunityScenario(crossScope), { code: 'SCENARIO_SCOPE_CONFLICT' });
    const rebound = fixture();
    rebound.cohort.scope[field] = value;
    rebound.cohort.qualifiedCalls.forEach((call) => { call[field] = value; });
    assert.throws(() => buildOpportunityScenario(rebound), { code: 'SCENARIO_COHORT_CONFLICT' });
  }
  for (const mutate of [
    (f) => { f.cohort.callRowsetDigest = key('other-rowset'); },
    (f) => { f.cohort.qualifiedCalls[0].sourceVersion += 1; },
    (f) => { f.cohort.qualifiedCalls[0].requestKind = 'unknown'; },
    (f) => { f.cohort.qualifiedCalls[0].SOURCE_MODIFIED_AT = '2026-08-31T12:15:00.000Z'; },
    (f) => { f.cohort.period.endAtUtc = '2026-08-31T12:45:00.000Z'; },
    (f) => { f.cohort.currency.code = 'EUR'; f.assumptions.currency = 'EUR'; },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => buildOpportunityScenario(input), { code: 'SCENARIO_COHORT_CONFLICT' });
  }
});

test('missing evidence and incomplete grouping expose unavailable calculations without invented zeroes', () => {
  const absent = fixture(); absent.evidence = null;
  absent.assumptions.bookingRateBasisPoints = 0;
  absent.assumptions.averageJobValueMinorUnits = 0;
  const noReview = buildOpportunityScenario(absent);
  assert.equal(noReview.status, 'not_available');
  assert.equal(noReview.reviewedGroupCount, 0);
  assert.equal(noReview.unknownGroupCount, 0);
  assert.equal(noReview.ungroupedQualifiedCallCount, 3);
  assert.equal(noReview.expectedBookings, null);
  assert.equal(noReview.scenarioGrossValueMinorUnits, null);
  assert.equal(noReview.formula, null);
  absent.cohort.qualifiedCalls = [];
  const emptyUnreviewed = buildOpportunityScenario(absent);
  assert.equal(emptyUnreviewed.status, 'not_available');
  assert.equal(emptyUnreviewed.expectedBookings, null);
  assert.equal(emptyUnreviewed.scenarioGrossValueMinorUnits, null);
  const partial = fixture(); partial.evidence.groups.pop();
  const ungrouped = buildOpportunityScenario(partial);
  assert.equal(ungrouped.status, 'not_available');
  assert.equal(ungrouped.eligibleGroupCount, 1);
  assert.equal(ungrouped.ungroupedQualifiedCallCount, 1);
  assert.equal(ungrouped.expectedBookings, null);
  assert.equal(ungrouped.scenarioGrossValueMinorUnits, null);
  const undefinedEvidence = fixture(); undefinedEvidence.evidence = undefined;
  assert.throws(() => buildOpportunityScenario(undefinedEvidence), { code: 'SCENARIO_EVIDENCE_INVALID' });
});

test('unknown intent or incomplete review excludes the entire group and reports uncertainty', () => {
  for (const mutate of [
    (f) => { f.evidence.groups[0].reviewStatus = 'incomplete'; },
    (f) => { f.cohort.qualifiedCalls[1].requestKind = 'unknown'; },
  ]) {
    const input = fixture(); mutate(input);
    const output = buildOpportunityScenario(bind(input));
    assert.equal(output.status, 'partial');
    assert.equal(output.eligibleGroupCount, 1);
    assert.equal(output.unknownGroupCount, 1);
    assert.equal(output.ungroupedQualifiedCallCount, 0);
    assert.equal(output.expectedBookings, 0.25);
    assert.equal(output.scenarioGrossValueMinorUnits, 3125);
  }
  const allUnknown = fixture();
  allUnknown.assumptions.bookingRateBasisPoints = 0;
  allUnknown.assumptions.averageJobValueMinorUnits = 0;
  allUnknown.cohort.qualifiedCalls.forEach((call) => { call.requestKind = 'unknown'; });
  const output = buildOpportunityScenario(bind(allUnknown));
  assert.equal(output.status, 'not_available');
  assert.equal(output.eligibleGroupCount, 0);
  assert.equal(output.unknownGroupCount, 2);
  assert.equal(output.expectedBookings, null);
  assert.equal(output.scenarioGrossValueMinorUnits, null);
});

test('new work can qualify without customer-type discrimination while follow-up-only groups cannot', () => {
  const input = fixture();
  // The reviewed projection deliberately has no customer-type field: new work
  // from an existing customer uses the same new_service_request contract.
  assert.equal(input.cohort.qualifiedCalls.every((call) => !Object.hasOwn(call, 'customerType')), true);
  assert.equal(buildOpportunityScenario(input).eligibleGroupCount, 2);
  input.cohort.qualifiedCalls[0].requestKind = 'existing_job_follow_up';
  const mixed = buildOpportunityScenario(bind(input));
  assert.equal(mixed.eligibleGroupCount, 1);
  assert.equal(mixed.followUpOnlyGroupCount, 1);
  input.cohort.qualifiedCalls[2].requestKind = 'existing_job_follow_up';
  const followUps = buildOpportunityScenario(bind(input));
  assert.equal(followUps.status, 'complete');
  assert.equal(followUps.eligibleGroupCount, 0);
  assert.equal(followUps.followUpOnlyGroupCount, 2);
  assert.equal(followUps.expectedBookings, 0);
  assert.equal(followUps.scenarioGrossValueMinorUnits, 0);
});

test('missing or ineligible call evidence cannot be made eligible by a group claim', () => {
  const missing = fixture(); missing.evidence.groups[0].callKeys = [key('missing-call')];
  assert.throws(() => buildOpportunityScenario(missing), { code: 'SCENARIO_MEMBER_INVALID' });
  for (const mutate of [
    (f) => { delete f.cohort.qualifiedCalls[0].requestKind; },
    (f) => { delete f.cohort.qualifiedCalls[0].sourceVersion; },
    (f) => { f.cohort.qualifiedCalls[0].sourceVersion = 0; },
    (f) => { f.cohort.qualifiedCalls[0].requestKind = 'guessed_new_work'; },
    (f) => { f.cohort.qualifiedCalls[0].HANDLED_RECORDED = false; },
    (f) => { f.cohort.qualifiedCalls[0].OUTCOME = 'existing_customer'; },
    (f) => { f.cohort.qualifiedCalls[0].STARTED_AT = '2026-08-31T09:00:00.000Z'; },
    (f) => { f.cohort.qualifiedCalls[0].SOURCE_MODIFIED_AT = '2026-08-31T10:30:00.000Z'; },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => buildOpportunityScenario(input), { code: 'SCENARIO_CALL_INVALID' });
  }
});

test('bounded scenario cohorts include the end instant without changing successful totals', () => {
  // Scenario cohorts use inclusive bounds; they are not adjacent calendar partitions.
  const original = buildOpportunityScenario(fixture());
  for (const offsetMs of [-1, 0]) {
    const input = fixture();
    input.cohort.qualifiedCalls[0].STARTED_AT = new Date(
      Date.parse(input.cohort.period.endAtUtc) + offsetMs,
    ).toISOString();
    input.cohort.qualifiedCalls[0].SOURCE_MODIFIED_AT = input.evidence.review.reviewedAt;
    assert.deepEqual(buildOpportunityScenario(bind(input)), original, `end offset ${offsetMs} ms`);
  }
});

test('scenario calls starting one millisecond after the cohort end are invalid', () => {
  const input = fixture();
  input.cohort.qualifiedCalls[0].STARTED_AT = new Date(
    Date.parse(input.cohort.period.endAtUtc) + 1,
  ).toISOString();
  input.cohort.qualifiedCalls[0].SOURCE_MODIFIED_AT = input.evidence.review.reviewedAt;
  assert.throws(() => buildOpportunityScenario(input), { code: 'SCENARIO_CALL_INVALID' });
});

test('period, review and schema evidence must be explicit, valid and current for corrected facts', () => {
  for (const period of [null, {}, { startAtUtc: '2026-02-30T10:00:00.000Z', endAtUtc: '2026-08-31T12:30:00.000Z' },
    { startAtUtc: '2026-08-31T13:00:00.000Z', endAtUtc: '2026-08-31T12:30:00.000Z' }]) {
    const input = fixture(); input.cohort.period = period;
    assert.throws(() => buildOpportunityScenario(input), { code: 'SCENARIO_PERIOD_INVALID' });
  }
  for (const mutate of [
    (f) => { f.evidence.review.status = 'pending'; },
    (f) => { f.evidence.review.reviewedAt = '2026-08-31'; },
    (f) => { f.evidence.review.reviewedAt = '2026-08-31T12:29:00.000Z'; },
    (f) => { f.evidence.review.reviewerReference = null; },
    (f) => { f.cohort.qualifiedCalls[0].SOURCE_MODIFIED_AT = '2026-08-31T13:01:00.000Z'; bind(f); },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => buildOpportunityScenario(input), { code: 'SCENARIO_REVIEW_INVALID' });
  }
  const schema = fixture(); schema.evidence.schemaVersion = 2;
  assert.throws(() => buildOpportunityScenario(schema), { code: 'SCENARIO_EVIDENCE_INVALID' });
  const missingRowset = fixture(); delete missingRowset.cohort.callRowsetDigest;
  assert.throws(() => buildOpportunityScenario(missingRowset), { code: 'SCENARIO_COHORT_REQUIRED' });
});
