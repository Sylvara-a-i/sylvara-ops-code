'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { buildOpportunityValue, METHOD_ID, METHOD_VERSION } = require('../../../tools/opportunity-value');

const key = (value) => crypto.createHash('sha256').update(`synthetic-opportunity-${value}`).digest('hex');
const NOW = Date.parse('2026-08-31T13:00:00.000Z');
const REVIEWED = '2026-08-31T12:30:00.000Z';
const scope = Object.freeze({ CLIENT_KEY: key('client'), DEPLOYMENT_KEY: key('deployment'),
  CONFIGURATION_VERSION: 'synthetic-config-v1', ENVIRONMENT: 'development',
  ENGAGEMENT_TYPE: 'free_test', SOURCE_REVISION: 'd'.repeat(40) });

function basis(reference, amountMinorUnits, currency = 'USD') {
  return { amountMinorUnits, currency, evidenceReference: key(reference), effectiveDate: '2026-08-01' };
}

function fixture() {
  const calls = ['potential_job', 'urgent_potential_job', 'spam'].map((OUTCOME, index) => ({
    ...scope, CALL_KEY: key(`call-${index}`), HANDLED_RECORDED: true, OUTCOME,
    SOURCE_MODIFIED_AT: '2026-08-31T12:00:00.000Z',
  }));
  const callRowsetDigest = key('rowset');
  return { calls, scope: { ...scope }, callRowsetDigest, now: NOW,
    evidence: { schemaVersion: 1, methodId: METHOD_ID, methodVersion: METHOD_VERSION,
      scope: { ...scope }, callRowsetDigest,
      review: { status: 'reviewed', reviewedAt: REVIEWED, reviewerReference: key('reviewer') },
      groups: [
        { groupKey: key('group-0'), callKeys: [calls[0].CALL_KEY], reviewStatus: 'qualified',
          knownJobValue: basis('job-0', 12500), averageJobValue: basis('average', 40000) },
        { groupKey: key('group-1'), callKeys: [calls[1].CALL_KEY], reviewStatus: 'qualified',
          knownJobValue: null, averageJobValue: basis('average', 40000) },
      ] },
  };
}

test('known job amount wins over an applicable contractor average and remains estimate-only', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const output = buildOpportunityValue(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(output.label, 'Estimated Opportunity Value');
  assert.equal(output.status, 'complete');
  assert.equal(output.qualifiedCallCount, 2);
  assert.equal(output.reviewedGroupCount, 2);
  assert.equal(output.valuedGroupCount, 2);
  assert.equal(output.unknownGroupCount, 0);
  assert.equal(output.ungroupedQualifiedCallCount, 0);
  assert.deepEqual(output.subtotals, [{ currency: 'USD', amountMinorUnits: 52500, valuedGroupCount: 2 }]);
  assert.deepEqual(new Set(output.groups.map((group) => group.basisType)),
    new Set(['contractor_known_job', 'contractor_average_job']));
  assert.match(output.limitation, /not lost, booked, recovered, invoiced or collected revenue/);
  assert.equal(JSON.stringify(output).includes(key('reviewer')), false);
  assert.equal(JSON.stringify(output).includes(key('job-0')), false);
  assert.equal(JSON.stringify(output).includes(key('average')), false);
  assert.equal(Object.isFrozen(output.groups[0].callKeys), true);
});

test('explicit repeat-call membership values one service opportunity once', () => {
  const input = fixture();
  input.evidence.groups[0].callKeys.push(input.calls[1].CALL_KEY);
  input.evidence.groups.pop();
  const output = buildOpportunityValue(input);
  assert.equal(output.qualifiedCallCount, 2);
  assert.equal(output.valuedGroupCount, 1);
  assert.equal(output.groups[0].callKeys.length, 2);
  assert.equal(output.subtotals[0].amountMinorUnits, 12500);
  assert.equal(output.status, 'complete');
});

test('missing evidence is unknown and creates neither fictitious groups nor monetary zero', () => {
  for (const evidence of [null, undefined]) {
    const input = fixture();
    input.evidence = evidence;
    const output = buildOpportunityValue(input);
    assert.equal(output.status, 'not_available');
    assert.equal(output.unknownGroupCount, 0);
    assert.equal(output.ungroupedQualifiedCallCount, 2);
    assert.deepEqual(output.subtotals, []);
    assert.deepEqual(output.groups, []);
  }
  const empty = fixture();
  empty.calls = [];
  empty.evidence.groups = [];
  const output = buildOpportunityValue(empty);
  assert.equal(output.qualifiedCallCount, 0);
  assert.deepEqual(output.subtotals, []);
  assert.equal(output.status, 'not_available');
});

test('incomplete grouping, absent values and ungrouped qualifying calls remain separate unknowns', () => {
  const incomplete = fixture();
  incomplete.evidence.groups[1].reviewStatus = 'incomplete';
  const first = buildOpportunityValue(incomplete);
  assert.equal(first.status, 'partial');
  assert.equal(first.reviewedGroupCount, 1);
  assert.equal(first.unknownGroupCount, 1);
  assert.equal(first.subtotals[0].amountMinorUnits, 12500);
  assert.equal(first.groups.find((group) => group.status === 'unknown').unknownReason,
    'group_review_incomplete');
  const absent = fixture();
  absent.evidence.groups[1].averageJobValue = null;
  const second = buildOpportunityValue(absent);
  assert.equal(second.reviewedGroupCount, 2);
  assert.equal(second.unknownGroupCount, 1);
  assert.equal(second.groups.find((group) => group.status === 'unknown').unknownReason, 'value_not_available');
  const ungrouped = fixture();
  ungrouped.evidence.groups.pop();
  const third = buildOpportunityValue(ungrouped);
  assert.equal(third.status, 'partial');
  assert.equal(third.unknownGroupCount, 0);
  assert.equal(third.ungroupedQualifiedCallCount, 1);
});

test('explicit documented zero differs from unknown and currencies never mix', () => {
  const input = fixture();
  input.evidence.groups[0].knownJobValue.amountMinorUnits = 0;
  input.evidence.groups[1].averageJobValue = basis('eur-average', 50000, 'EUR');
  assert.deepEqual(buildOpportunityValue(input).subtotals, [
    { currency: 'EUR', amountMinorUnits: 50000, valuedGroupCount: 1 },
    { currency: 'USD', amountMinorUnits: 0, valuedGroupCount: 1 },
  ]);
});

test('one call cannot belong to two groups or repeat inside a group', () => {
  for (const mutate of [
    (f) => { f.evidence.groups[1].callKeys = [f.calls[0].CALL_KEY]; },
    (f) => { f.evidence.groups[0].callKeys.push(f.calls[0].CALL_KEY); },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => buildOpportunityValue(input), { code: 'OPPORTUNITY_MEMBER_DUPLICATE' });
  }
  const duplicateGroup = fixture();
  duplicateGroup.evidence.groups[1].groupKey = duplicateGroup.evidence.groups[0].groupKey;
  assert.throws(() => buildOpportunityValue(duplicateGroup), { code: 'OPPORTUNITY_GROUP_INVALID' });
  const duplicateCall = fixture();
  duplicateCall.calls.push({ ...duplicateCall.calls[0] });
  assert.throws(() => buildOpportunityValue(duplicateCall), { code: 'OPPORTUNITY_CALL_INVALID' });
});

test('nonqualifying, unhandled, unknown and cross-scope memberships are rejected', () => {
  for (const outcome of ['spam', 'existing_customer', 'unsupported_service', 'out_of_area',
    'other_general_inquiry', 'unresolved', 'configuration_failure', 'sensitive_data_ended', 'caller_abandoned']) {
    const input = fixture(); input.calls[0].OUTCOME = outcome;
    assert.throws(() => buildOpportunityValue(input), { code: 'OPPORTUNITY_MEMBER_INELIGIBLE' });
  }
  const unhandled = fixture(); unhandled.calls[0].HANDLED_RECORDED = false;
  assert.throws(() => buildOpportunityValue(unhandled), { code: 'OPPORTUNITY_MEMBER_INELIGIBLE' });
  const unknown = fixture(); unknown.evidence.groups[0].callKeys = [key('missing-call')];
  assert.throws(() => buildOpportunityValue(unknown), { code: 'OPPORTUNITY_MEMBER_INELIGIBLE' });
  for (const field of ['CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION', 'SOURCE_REVISION']) {
    const input = fixture(); input.calls[0][field] = key('other-scope');
    assert.throws(() => buildOpportunityValue(input), { code: 'OPPORTUNITY_SCOPE_CONFLICT' });
  }
});

test('reviewed evidence is bound to exact scope, method and current call-rowset digest', () => {
  const mismatch = fixture(); mismatch.evidence.scope.CLIENT_KEY = key('other-client');
  assert.throws(() => buildOpportunityValue(mismatch), { code: 'OPPORTUNITY_SCOPE_CONFLICT' });
  const stale = fixture(); stale.evidence.callRowsetDigest = key('prior-rowset');
  assert.throws(() => buildOpportunityValue(stale), { code: 'OPPORTUNITY_ROWSET_CONFLICT' });
  for (const mutate of [
    (f) => { f.evidence.methodId = 'generic-revenue-model'; },
    (f) => { f.evidence.methodVersion = 2; },
    (f) => { f.evidence.closeRate = 0.5; },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => buildOpportunityValue(input), { code: 'OPPORTUNITY_EVIDENCE_INVALID' });
  }
});

test('review and effective dates are valid, not future and not older than corrected facts', () => {
  for (const reviewedAt of ['2026-08-31T14:00:00.000Z', '2026-08-31T11:59:00.000Z',
    '2026-02-30T12:30:00.000Z', '2026-08-31']) {
    const input = fixture(); input.evidence.review.reviewedAt = reviewedAt;
    assert.throws(() => buildOpportunityValue(input), { code: 'OPPORTUNITY_REVIEW_INVALID' });
  }
  const unreviewed = fixture(); unreviewed.evidence.review.status = 'pending';
  assert.throws(() => buildOpportunityValue(unreviewed), { code: 'OPPORTUNITY_REVIEW_INVALID' });
  for (const effectiveDate of ['2026-09-01', '2026-02-30', '2026-8-1']) {
    const input = fixture(); input.evidence.groups[0].knownJobValue.effectiveDate = effectiveDate;
    assert.throws(() => buildOpportunityValue(input), { code: 'OPPORTUNITY_VALUE_BASIS_INVALID' });
  }
});

test('conflicting value provenance and reuse of a known job across groups are rejected', () => {
  const conflict = fixture(); conflict.evidence.groups[1].averageJobValue.amountMinorUnits = 40001;
  assert.throws(() => buildOpportunityValue(conflict), { code: 'OPPORTUNITY_VALUE_REFERENCE_CONFLICT' });
  const repeatedJob = fixture();
  repeatedJob.evidence.groups[1].knownJobValue = { ...repeatedJob.evidence.groups[0].knownJobValue };
  assert.throws(() => buildOpportunityValue(repeatedJob), { code: 'OPPORTUNITY_VALUE_REFERENCE_CONFLICT' });
  const changedKind = fixture();
  changedKind.evidence.groups[1].averageJobValue = { ...changedKind.evidence.groups[0].knownJobValue };
  assert.throws(() => buildOpportunityValue(changedKind), { code: 'OPPORTUNITY_VALUE_REFERENCE_CONFLICT' });
});

test('amounts are exact safe minor units, not bands, guessed prices or close-rate calculations', () => {
  for (const amount of [-1, 1.5, NaN, Infinity, '12500', Number.MAX_SAFE_INTEGER + 1]) {
    const input = fixture(); input.evidence.groups[0].knownJobValue.amountMinorUnits = amount;
    assert.throws(() => buildOpportunityValue(input), { code: 'OPPORTUNITY_VALUE_BASIS_INVALID' });
  }
  for (const field of ['genericPrice', 'priceBand', 'closeRate', 'lostRevenue']) {
    const input = fixture(); input.evidence.groups[0].knownJobValue[field] = 100;
    assert.throws(() => buildOpportunityValue(input), { code: 'OPPORTUNITY_VALUE_BASIS_INVALID' });
  }
  const sum = fixture();
  sum.evidence.groups[0].knownJobValue.amountMinorUnits = Number.MAX_SAFE_INTEGER;
  assert.throws(() => buildOpportunityValue(sum), { code: 'OPPORTUNITY_TOTAL_OVERFLOW' });
});

test('output order is deterministic and input errors do not print private evidence', () => {
  const original = fixture();
  const reordered = fixture();
  reordered.calls.reverse(); reordered.evidence.groups.reverse();
  assert.deepEqual(buildOpportunityValue(original), buildOpportunityValue(reordered));
  const bad = fixture(); bad.evidence.groups[0].knownJobValue.evidenceReference = 'private-document-name';
  assert.throws(() => buildOpportunityValue(bad), (error) =>
    error.code === 'OPPORTUNITY_VALUE_BASIS_INVALID' && !error.message.includes('private-document-name'));
});
