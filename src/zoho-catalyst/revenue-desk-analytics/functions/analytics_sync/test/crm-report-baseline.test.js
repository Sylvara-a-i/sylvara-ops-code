'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Guard only this synchronous adapter's import and execution. A process-global
// hook left installed would incorrectly block unrelated combined-suite imports.
function withOfflineGuard(action) {
  const originalLoad = Module._load;
  Module._load = function offlineOnly(request, ...rest) {
    if (/^(?:node:)?(?:http|https|http2|net|tls|dns|child_process)$/.test(request)
      || /(?:catalyst|retell|axios|undici)/i.test(request)) {
      throw new Error('Outbound dependency forbidden in baseline tests.');
    }
    return originalLoad.call(this, request, ...rest);
  };
  try {
    return action();
  } finally {
    Module._load = originalLoad;
  }
}
const { buildCrmReportBaseline, buildCrmPreTestSnapshot, MAX_READBACK_AGE_MS } =
  withOfflineGuard(() => require('../lib/crm-report-baseline'));
const { crmBaselineFixture: fixture } = require('./helpers/crm-baseline-fixture');
const NOW = Date.parse('2026-09-08T12:00:00.000Z');

function build(input = fixture()) {
  return withOfflineGuard(() => buildCrmReportBaseline(input, { now: NOW }));
}
function rejects(change, expected = /^CRM_BASELINE_/) {
  const input = fixture();
  change(input);
  assert.throws(() => build(input), (error) => expected.test(error.code));
}

function captureFixture() {
  const input = fixture();
  delete input.context.testStartedAt;
  return input;
}

function capture(input = captureFixture(), now = Date.parse(input.evidence.capturedAt)) {
  return withOfflineGuard(() => buildCrmPreTestSnapshot(input, { now }));
}

test('pre-start capture needs no invented start and returns the same minimized historical snapshot', () => {
  const input = captureFixture();
  const before = structuredClone(input);
  const snapshot = capture(input);
  assert.deepEqual(snapshot, build(fixture()));
  assert.deepEqual(input, before);
  assert.equal(Object.hasOwn(snapshot, 'testStartedAt'), false);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.values)
    && Object.isFrozen(snapshot.sourcePeriod));
  for (const start of ['2026-09-01T12:00:00.000Z', null]) {
    const withStart = captureFixture();
    withStart.context.testStartedAt = start;
    assert.throws(() => capture(withStart), { code: 'CRM_BASELINE_INVALID' });
  }
});

test('fresh capture is deterministic but stale replay or historical backfill is rejected', () => {
  const input = captureFixture();
  const capturedAt = Date.parse(input.evidence.capturedAt);
  assert.deepEqual(capture(input), capture(input, capturedAt + 1));
  assert.throws(() => capture(input, capturedAt + MAX_READBACK_AGE_MS + 1),
    { code: 'CRM_BASELINE_TIMING_INVALID' });
  assert.throws(() => capture(input, NOW), { code: 'CRM_BASELINE_TIMING_INVALID' });
  // A later report validates history, not fresh capture. It must still work.
  assert.deepEqual(build(fixture()), capture(input));
});

test('capture freshness measures reads and metadata against now, not a backdated capture label', () => {
  const input = captureFixture();
  const capturedAt = Date.parse(input.evidence.capturedAt);
  // The read was already one minute old and metadata two minutes old at capture.
  assert.throws(() => capture(input, capturedAt + MAX_READBACK_AGE_MS),
    { code: 'CRM_BASELINE_TIMING_INVALID' });
  assert.throws(() => capture(input, capturedAt + MAX_READBACK_AGE_MS - 60_000),
    { code: 'CRM_BASELINE_METADATA_UNVERIFIED' });
  assert.doesNotThrow(() => capture(input, capturedAt + MAX_READBACK_AGE_MS - 120_000));
});

test('future captures and future claimed report starts fail closed', () => {
  const input = captureFixture();
  assert.throws(() => capture(input, Date.parse(input.evidence.capturedAt) - 1),
    { code: 'CRM_BASELINE_TIMING_INVALID' });
  const report = fixture();
  report.context.testStartedAt = new Date(NOW + 1).toISOString();
  assert.throws(() => build(report), { code: 'CRM_BASELINE_TIMING_INVALID' });
});

test('capture preserves the same privacy, ownership, field and source-period boundary', () => {
  const input = captureFixture();
  const encoded = JSON.stringify(capture(input));
  for (const value of Object.values(input.context.relationships)) assert.ok(!encoded.includes(value));
  for (const mutate of [
    (value) => { value.deal.Email = 'synthetic@example.invalid'; },
    (value) => { value.deal.Account_Name.name = 'Synthetic private name'; },
    (value) => { value.context.deploymentKey = 'c'.repeat(64); },
    (value) => { value.deal.Monthly_Inbound_Call_Band = '9135550123'; },
    (value) => { value.evidence.sourcePeriod.end = value.evidence.sourcePeriod.start; },
  ]) {
    const invalid = captureFixture();
    mutate(invalid);
    assert.throws(() => capture(invalid), (error) => /^CRM_BASELINE_/.test(error.code)
      && !error.message.includes('synthetic@') && !error.message.includes('9135550123'));
  }
});

test('offline guard blocks outbound imports and restores the loader after success and rejection', () => {
  const before = Module._load;
  build();
  assert.equal(Module._load, before);
  assert.throws(() => withOfflineGuard(() => require('node:https')),
    /Outbound dependency forbidden/);
  assert.equal(Module._load, before);
  rejects((input) => { input.context.environment = 'production'; });
  assert.equal(Module._load, before);
});

test('baseline retains exact ranges, decimal values and explicit source period without revenue claims', () => {
  const result = build();
  assert.deepEqual(result.values, {
    currentCallHandling: 'Voicemail', monthlyInboundCalls: 140, monthlyInboundCallBand: '100-249',
    afterHoursCallBand: '25-49', afterHoursCallShare: 20.25, estimatedUnansweredCallRate: 12.5,
    averageJobValueMinorUnits: 35025,
    averageJobValueBand: '$250-$499', currentMonthlyAnsweringCostMinorUnits: 0,
  });
  assert.equal(result.currency, 'USD');
  assert.equal(result.coverageMode, 'AfterHoursOnly');
  assert.equal(result.configurationVersionId, 'synthetic-config-row-1');
  assert.equal(result.configurationVersion, 'synthetic-config-v1');
  assert.notEqual(result.configurationVersionId, result.configurationVersion);
  assert.equal(result.sourceModifiedAt, '2026-09-01T11:50:00.000Z');
  assert.equal(result.evidenceClass, 'customer_supplied_estimate');
  assert.equal(result.provenanceStatus, 'locally_consistent_not_authenticated');
  assert.equal(result.comparisonStatus, 'context_only_not_before_after_proof');
  assert.equal(result.sourcePeriod.start, '2026-08-01T00:00:00.000Z');
});

test('unknown is not zero and a metadata no-selection is not an answer', () => {
  const input = fixture();
  for (const field of Object.keys(input.metadata.fields)) {
    if (field !== 'Approved_Test_Route') input.deal[field] = null;
  }
  input.deal.Current_Call_Handling = '-None-';
  input.deal.After_Hours_Call_Band = 'None';
  input.deal.Average_Job_Value_Band = 'Unknown';
  const result = build(input);
  assert.equal(result.values.monthlyInboundCalls, null);
  assert.equal(result.values.currentCallHandling, null);
  assert.equal(result.values.afterHoursCallBand, 'None');
  assert.equal(result.values.averageJobValueBand, 'Unknown');
  assert.equal(result.values.averageJobValueMinorUnits, null);
  assert.equal(result.values.estimatedUnansweredCallRate, null);
  assert.equal(result.currency, null);
});

test('approved route actual/reference values require exact fresh metadata and normalize identically', () => {
  for (const [forms, expected] of [
    [['After Hours Only', 'After-Hours'], 'AfterHoursOnly'],
    [['No Answer / Overflow Only', 'No-Answer/Overflow'], 'NoAnswerOverflowOnly'],
    [['After Hours + Overflow', 'Both'], 'AfterHoursAndOverflow'],
  ]) {
    for (const form of forms) {
      const input = fixture();
      input.deal.Approved_Test_Route = form;
      input.context.approvedTestRoute = form;
      assert.equal(build(input).coverageMode, expected);
      input.metadata.fields.Approved_Test_Route.activeValues = ['-None-'];
      assert.throws(() => build(input), { code: 'CRM_BASELINE_CHOICE_UNVERIFIED' });
    }
  }
});

test('accepts a historical pre-test snapshot at final-report time and does not mutate it', () => {
  const input = fixture();
  const before = structuredClone(input);
  const first = build(input);
  assert.deepEqual(build(input), first);
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.values)
    && Object.isFrozen(first.sourcePeriod));
});

test('output excludes CRM record IDs, intake ID, names, contact details and arbitrary source text', () => {
  const input = fixture();
  const encoded = JSON.stringify(build(input));
  for (const value of Object.values(input.context.relationships)) assert.ok(!encoded.includes(value));
  for (const key of ['Account_Name', 'Contact_Name', 'id', 'Intake_Submission_ID']) {
    assert.ok(!Object.hasOwn(build(input), key));
  }
  rejects((value) => { value.deal.Email = 'synthetic@example.invalid'; });
  rejects((value) => { value.deal.Pain_Point_Summary = 'Unreviewed source text'; });
  rejects((value) => { value.deal.Account_Name.name = 'ZZZ Synthetic Business'; });
});

test('wrong private relationships, deployment, configuration, intake and CRM version fail closed', () => {
  const otherSyntheticRecordId = '9'.repeat(16);
  for (const change of [
    (v) => { v.deal.id = otherSyntheticRecordId; },
    (v) => { v.deal.Account_Name.id = otherSyntheticRecordId; },
    (v) => { v.deal.Contact_Name.id = otherSyntheticRecordId; },
    (v) => { v.deal.Intake_Submission_ID = 'different-intake'; },
    (v) => { v.evidence.relationships.leadId = otherSyntheticRecordId; },
    (v) => { v.evidence.clientKey = 'c'.repeat(64); },
    (v) => { v.evidence.deploymentKey = 'c'.repeat(64); },
    (v) => { v.evidence.configurationVersionId = 'different-physical-row'; },
    (v) => { v.deal.Configuration_Version = 'different-config'; },
    (v) => { v.deal.Modified_Time = '2026-09-01T06:50:01-05:00'; },
    (v) => { v.deal.Approved_Test_Route = 'Both'; },
  ]) rejects(change, /^CRM_BASELINE_OWNERSHIP_CONFLICT$/);
});

test('physical configuration identity is required and never substituted with the CRM version label', () => {
  for (const value of [undefined, null, '', 1234, 'x'.repeat(129), 'row/with/path']) {
    const input = fixture();
    input.context.configurationVersionId = value;
    input.evidence.configurationVersionId = value;
    assert.throws(() => build(input), { code: 'CRM_BASELINE_INVALID' });
  }
  const input = fixture();
  delete input.context.configurationVersionId;
  delete input.evidence.configurationVersionId;
  assert.throws(() => build(input), { code: 'CRM_BASELINE_INVALID' });
  const exactLimit = fixture();
  exactLimit.context.configurationVersionId = 'x'.repeat(128);
  exactLimit.evidence.configurationVersionId = exactLimit.context.configurationVersionId;
  assert.equal(build(exactLimit).configurationVersionId, 'x'.repeat(128));
});

test('freshness uses the original source capture and rejects future or post-start baselines', () => {
  for (const change of [
    (v) => { v.evidence.readAt = '2026-09-01T11:40:00.000Z'; },
    (v) => { v.evidence.readAt = '2026-09-01T11:57:00.000Z'; },
    (v) => { v.evidence.capturedAt = '2026-09-01T12:01:00.000Z'; },
    (v) => { v.context.testStartedAt = '2026-09-01T11:55:59.000Z'; },
    (v) => { v.evidence.capturedAt = '2026-09-09T11:56:00.000Z'; },
  ]) rejects(change, /^CRM_BASELINE_TIMING_INVALID$/);
  rejects((v) => { v.metadata.observedAt = '2026-09-01T11:40:00.000Z'; },
    /^CRM_BASELINE_METADATA_UNVERIFIED$/);
});

test('explicit source period is required, immutable and must end before the baseline capture', () => {
  rejects((v) => { v.evidence.sourcePeriod.end = v.evidence.sourcePeriod.start; });
  rejects((v) => { v.evidence.sourcePeriod.end = '2026-08-31T00:00:00.000Z'; });
  rejects((v) => { delete v.evidence.sourcePeriod; });
  rejects((v) => { v.context.sourcePeriod = null; });
  rejects((v) => {
    v.context.sourcePeriod.end = '2026-09-02T00:00:00.000Z';
    v.evidence.sourcePeriod.end = v.context.sourcePeriod.end;
  });
});

test('active metadata type and exact picklist choices are prerequisites, not catalog assumptions', () => {
  rejects((v) => { v.metadata.fields.Average_Job_Value.dataType = 'integer'; });
  rejects((v) => { v.metadata.fields.Monthly_Inbound_Calls.active = false; });
  rejects((v) => { delete v.metadata.fields.Average_Job_Value; });
  rejects((v) => { v.deal.Monthly_Inbound_Call_Band = '999-1000'; });
  rejects((v) => { v.deal.Current_Call_Handling = 'voicemail'; });
  rejects((v) => {
    v.metadata.fields.Current_Call_Handling.activeValues.push('Arbitrary private text');
    v.deal.Current_Call_Handling = 'Arbitrary private text';
  });
  rejects((v) => {
    v.metadata.fields.Monthly_Inbound_Call_Band.activeValues.push('synthetic@example.invalid');
    v.deal.Monthly_Inbound_Call_Band = 'synthetic@example.invalid';
  });
  rejects((v) => {
    const unapprovedNumericOption = '9135550123';
    v.metadata.fields.Monthly_Inbound_Call_Band.activeValues.push(unapprovedNumericOption);
    v.deal.Monthly_Inbound_Call_Band = unapprovedNumericOption;
  });
  rejects((v) => {
    v.metadata.fields.Monthly_Inbound_Call_Band.activeValues.push('25-49');
    v.deal.Monthly_Inbound_Call_Band = '25-49';
  });
});

test('numeric fields reject coercion, negatives, fractional call counts and undocumented rounding', () => {
  for (const [field, value] of [
    ['Monthly_Inbound_Calls', '140'], ['Monthly_Inbound_Calls', 1.5],
    ['Monthly_Inbound_Calls', -1], ['After_Hours_Call_Share', 100.01],
    ['After_Hours_Call_Share', 1.111], ['Average_Job_Value', '350.25'],
    ['Estimated_Unanswered_Call_Rate', -1], ['Estimated_Unanswered_Call_Rate', 100.01],
    ['Estimated_Unanswered_Call_Rate', 1.111], ['Estimated_Unanswered_Call_Rate', '12.5'],
    ['Average_Job_Value', -1], ['Average_Job_Value', 1.005],
    ['Current_Monthly_Answering_Cost', Infinity],
  ]) rejects((v) => { v.deal[field] = value; });
  const input = fixture();
  input.deal.Average_Job_Value = 0.29;
  assert.equal(build(input).values.averageJobValueMinorUnits, 29);
});

test('wrong evidence class, environment, currency, source and malformed dates are rejected safely', () => {
  for (const change of [
    (v) => { v.context.environment = 'production'; },
    (v) => { v.context.currency = 'EUR'; },
    (v) => { v.evidence.source = 'operator_guess'; },
    (v) => { v.metadata.source = 'historical_catalog'; },
    (v) => { v.context.evidenceClass = 'confirmed_revenue'; v.evidence.evidenceClass = 'confirmed_revenue'; },
    (v) => { v.evidence.readAt = '2026-02-30T00:00:00.000Z'; },
  ]) rejects(change);
  const input = fixture();
  input.deal.Monthly_Inbound_Call_Band = 'synthetic@example.invalid';
  assert.throws(() => build(input), (error) => !error.message.includes('synthetic@'));
});
