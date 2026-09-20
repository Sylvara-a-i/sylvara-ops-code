'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installOfflineGuard } = require('./helpers/offline-guard');
const offlineGuard = installOfflineGuard();
const { prepareFreeTestConfiguration, MAX_READBACK_AGE_MS } = require('../lib/free-test-preparation');
const { SYNTHETIC_NOW, syntheticPreparationInputs } = require('./fixtures/free-test-preparation');
const { crmBaselineFixture } = require('../../revenue-desk-analytics/functions/analytics_sync/test/helpers/crm-baseline-fixture');
const { providerTimingFixture } = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/test/provider-timing-fixture');

function withBaseline(input = syntheticPreparationInputs()[0]) {
  const baseline = crmBaselineFixture();
  delete baseline.context.testStartedAt;
  const deal = input.crm.deal;
  input.review.configurationVersionId = 'synthetic_config_row_A';
  input.review.analyticsClientKey = baseline.context.clientKey;
  input.review.analyticsDeploymentKey = baseline.context.deploymentKey;
  for (const value of [baseline.context, baseline.evidence]) {
    value.relationships = { ...input.evidence.nativeConversion };
    value.configurationVersion = deal.Configuration_Version;
    value.configurationVersionId = input.review.configurationVersionId;
    value.crmModifiedAt = deal.Modified_Time;
  }
  baseline.context.approvedTestRoute = deal.Approved_Test_Route;
  baseline.evidence.readAt = input.evidence.capturedAt;
  baseline.evidence.capturedAt = input.evidence.capturedAt;
  baseline.metadata.observedAt = input.evidence.capturedAt;
  for (const field of ['id', 'Account_Name', 'Contact_Name', 'Modified_Time',
    'Configuration_Version', 'Intake_Submission_ID', 'Approved_Test_Route']) {
    baseline.deal[field] = structuredClone(deal[field]);
  }
  // The selected baseline must be the same source projection as the submitted
  // CRM readback, not a second independently seeded downstream success object.
  for (const [field, value] of Object.entries(baseline.deal)) {
    if (!Object.hasOwn(deal, field)) deal[field] = value;
  }
  input.reportBaseline = baseline;
  return input;
}

function prepare(input, now = SYNTHETIC_NOW) {
  return prepareFreeTestConfiguration(input, { now });
}
test.after(() => {
  offlineGuard.restore();
  assert.deepEqual(offlineGuard.blocked, []);
});

test('two distinct synthetic preparations remain unapproved and provider-unverified', () => {
  const inputs = syntheticPreparationInputs();
  const before = JSON.stringify(inputs);
  const [a, b] = inputs.map((input) => prepare(input));
  for (const result of [a, b]) {
    assert.equal(result.status, 'prepared_local_only');
    assert.equal(result.classification, 'synthetic-demonstration');
    assert.equal(result.deploymentAuthorized, false);
    assert.equal(result.providerVerified, false);
    assert.equal(result.evidenceStatus, 'locally_consistent_not_authenticated');
    assert.equal(result.candidate.approved, false);
    assert.equal(result.candidate.notificationRecipient.approved, false);
    assert.equal(result.candidate.notificationRecipient.channel, 'email');
    assert.equal(result.reviewContext.forwardingVerified, false);
    assert.equal(result.reviewContext.sourceInterpretationAuthenticated, false);
    assert.equal(result.reviewContext.crmPhoneFormattingMatchesCandidate, true);
    assert.deepEqual(result.unresolved, []);
  }
  assert.notEqual(a.candidate.clientId, b.candidate.clientId);
  assert.notEqual(a.candidate.crmDealId, b.candidate.crmDealId);
  assert.notEqual(a.candidate.deploymentId, b.candidate.deploymentId);
  assert.notDeepEqual(a.candidate.serviceArea, b.candidate.serviceArea);
  assert.notEqual(a.candidate.notificationRecipient.email, b.candidate.notificationRecipient.email);
  assert.notEqual(a.reviewContext.timeZone, b.reviewContext.timeZone);
  assert.equal(a.reviewContext.mainBusinessNumber, '+19135550101');
  assert.equal(JSON.stringify(inputs), before);
  assert.deepEqual(prepare(inputs[0]), a);
});

test('preparation never infers monitored-channel acknowledgment from Form 2 recipient fields', () => {
  const input = syntheticPreparationInputs()[0];
  const acknowledged = prepare(input);
  assert.deepEqual(acknowledged.candidate.notificationHandoff, input.review.notificationHandoff);
  assert.equal(acknowledged.candidate.notificationRecipient.approved, false);
  delete input.review.notificationHandoff;
  const missing = prepare(input);
  assert.equal(missing.status, 'prepared_local_only');
  assert.equal(Object.hasOwn(missing.candidate, 'notificationHandoff'), false);
  assert.deepEqual(missing.unresolved, ['NOTIFICATION_HANDOFF_ACKNOWLEDGMENT_REQUIRED']);
  const unmonitored = syntheticPreparationInputs()[0];
  unmonitored.review.notificationHandoff.monitored = false;
  assert.deepEqual(prepare(unmonitored).unresolved, ['NOTIFICATION_HANDOFF_ACKNOWLEDGMENT_REQUIRED']);
  for (const patch of [{ timeZone: 'America/Denver' },
    { acknowledgedAt: new Date(SYNTHETIC_NOW + 1).toISOString() }]) {
    const invalid = syntheticPreparationInputs()[0];
    Object.assign(invalid.review.notificationHandoff, patch);
    assert.equal(prepare(invalid).status, 'blocked');
    assert.deepEqual(prepare(invalid).unresolved, ['NOTIFICATION_HANDOFF_REVIEW_REQUIRED']);
  }
  for (const patch of [{ channel: 'mobile' }, { recipientId: 'other_recipient' }]) {
    const invalid = syntheticPreparationInputs()[0];
    Object.assign(invalid.review.notificationHandoff, patch);
    assert.equal(prepare(invalid).status, 'blocked');
  }
});

test('bad or unresolved inputs return no usable partial configuration', () => {
  const cases = [
    ['unknown country', (v) => { v.review.countryCode = 'Unknown'; }, 'PHONE_COUNTRY_UNRESOLVED'],
    ['extension', (v) => { v.crm.account.Phone = '9135550101 x22'; }, 'BUSINESS_PHONE_UNRESOLVED'],
    ['foreign prefix', (v) => { v.crm.account.Phone = '+449135550101'; }, 'BUSINESS_PHONE_UNRESOLVED'],
    ['missing timezone', (v) => { delete v.review.timeZone; }, 'TIMEZONE_REVIEW_REQUIRED'],
    ['bad timezone', (v) => { v.review.timeZone = 'Unknown/Zone'; }, 'TIMEZONE_REVIEW_REQUIRED'],
    ['fixed offset DST guess', (v) => { v.review.dstPolicy = 'UTC-6'; }, 'TIMEZONE_REVIEW_REQUIRED'],
    ['missing exceptions', (v) => { delete v.review.hoursExceptions; }, 'HOURS_EXCEPTIONS_REVIEW_REQUIRED'],
    ['source hours changed', (v) => { v.crm.account.Normal_Business_Hours = 'Open daily'; }, 'BUSINESS_HOURS_SOURCE_MISMATCH'],
    ['missing weekly hours', (v) => { delete v.review.weeklyHours; }, 'WEEKLY_HOURS_REVIEW_REQUIRED'],
    ['missing Sunday', (v) => { delete v.review.weeklyHours.Sunday; }, 'WEEKLY_HOURS_REVIEW_REQUIRED'],
    ['ambiguous weekly hours', (v) => { v.review.weeklyHours.Monday = '8-5'; }, 'WEEKLY_HOURS_REVIEW_REQUIRED'],
    ['overnight weekly hours', (v) => { v.review.weeklyHours.Monday = '22:00-06:00'; }, 'WEEKLY_HOURS_REVIEW_REQUIRED'],
    ['impossible exception date', (v) => { v.review.hoursExceptions[0].date = '2026-02-30'; }, 'HOURS_EXCEPTIONS_REVIEW_REQUIRED'],
    ['ambiguous overnight exception', (v) => { v.review.hoursExceptions[0].hours = '22:00-06:00'; }, 'HOURS_EXCEPTIONS_REVIEW_REQUIRED'],
    ['oversize hours', (v) => { v.crm.account.Normal_Business_Hours = 'x'.repeat(501); }, 'BUSINESS_HOURS_REVIEW_REQUIRED'],
    ['oversize company', (v) => { v.crm.account.Account_Name = 'x'.repeat(121); }, 'RUNTIME_CONFIGURATION_REVIEW_REQUIRED'],
    ['other service needs review', (v) => { v.crm.account.Services_Handled = ['Other']; }, 'SERVICES_REVIEW_REQUIRED'],
    ['missing urgency', (v) => { delete v.review.urgentConditions; }, 'URGENCY_REVIEW_REQUIRED'],
    ['missing callback', (v) => { delete v.review.callbackExpectation; }, 'CALLBACK_REVIEW_REQUIRED'],
    ['missing territory', (v) => { delete v.review.serviceArea; }, 'RUNTIME_CONFIGURATION_REVIEW_REQUIRED'],
    ['territory source changed', (v) => { v.crm.account.Primary_Service_Area = 'Another region'; }, 'SERVICE_AREA_SOURCE_MISMATCH'],
    ['urgency source changed', (v) => { v.crm.deal.Urgent_Call_Handling = 'Dispatch immediately'; }, 'URGENCY_SOURCE_MISMATCH'],
    ['missing existing-customer policy', (v) => { delete v.crm.deal.Existing_Customer_Call_Handling; }, 'EXISTING_CUSTOMER_HANDLING_REQUIRED'],
    ['unbound fallback', (v) => { v.crm.deal.Approved_Fallback_Destination = 'On-Call Mobile'; }, 'FALLBACK_REVIEW_REQUIRED'],
    ['unapproved SMS recipient', (v) => { v.crm.deal.Alert_Recipient_Mobile = '+19135550199'; }, 'EMAIL_ONLY_RECIPIENT_REQUIRED'],
    ['cross-client Contact', (v) => { v.crm.deal.Contact_Name.id = '300000002'; }, 'RELATIONSHIP_MISMATCH'],
    ['cross-client session', (v) => { v.evidence.session.CRM_ACCOUNT_ID = '200000002'; }, 'RELATIONSHIP_MISMATCH'],
    ['cross-journey conversion', (v) => { v.evidence.nativeConversion.intakeSubmissionId = 'another_journey'; }, 'RELATIONSHIP_MISMATCH'],
    ['changed record', (v) => { v.crm.account.Modified_Time = '2026-09-09T11:51:00Z'; }, 'RECORD_VERSION_MISMATCH'],
    ['pre-submission record', (v) => { v.crm.account.Modified_Time = '2026-09-09T11:49:00Z';
      v.evidence.recordVersions.account = v.crm.account.Modified_Time; }, 'RECORD_VERSION_MISMATCH'],
    ['unconsumed proof', (v) => { v.evidence.proof.STATUS = 'verified'; }, 'SUBMISSION_EVIDENCE_INCOMPLETE'],
    ['failed receipt', (v) => { v.evidence.submission.STATUS = 'failed'; }, 'SUBMISSION_EVIDENCE_INCOMPLETE'],
    ['different configuration revision', (v) => { v.crm.deal.Configuration_Version += 'x'; }, 'SUBMITTED_STATE_MISMATCH'],
    ['existing deployment', (v) => { v.crm.deal.Deployment_Record_ID = 'already_used'; }, 'SUBMITTED_STATE_MISMATCH'],
  ];
  for (const [label, mutate, expected] of cases) {
    const input = syntheticPreparationInputs()[0]; mutate(input);
    const result = prepare(input);
    assert.equal(result.status, 'blocked', label);
    assert.equal(result.candidate, null, label);
    assert.deepEqual(result.unresolved, [expected], label);
  }
});

test('the prepared record is limited to submitted free-test setup before internal approval', () => {
  const cases = [
    ['Entry_Offer', 'Launch'], ['Entry_Offer', 'Free 7-Day Missed-Call Test'],
    ['Pipeline', 'Other Pipeline'], ['Stage', 'Test Live'], ['Stage', 'Setup and QA'],
    ['Test_Status', 'Live'], ['Go_Live_Approval_Status', 'Approved'],
    ['Approved_Configuration_Version', 'already_approved'],
    ['Billing_Subscription_ID', 'existing_subscription'],
    ['Test_Start_At', '2026-09-09T11:55:00Z'], ['Rollback_Completed_At', '2026-09-09T11:55:00Z'],
  ];
  for (const [key, value] of cases) {
    const input = syntheticPreparationInputs()[0];
    input.crm.deal[key] = value;
    assert.deepEqual(prepare(input).unresolved, ['FREE_TEST_PREPARATION_STATE_REQUIRED'], key);
  }
});

test('US phone interpretation preserves source and exposes formatting reconciliation before approval', () => {
  const input = syntheticPreparationInputs()[0];
  input.crm.account.Phone = '(913) 555-0101';
  input.crm.deal.Forwarding_Administrator_Mobile = '9135550111';
  const before = JSON.stringify(input);
  const result = prepare(input);
  assert.equal(result.status, 'prepared_local_only');
  assert.equal(result.candidate.forwardingAdministratorMobile, '+19135550111');
  assert.deepEqual(result.unresolved, ['CRM_PHONE_FORMAT_RECONCILIATION_REQUIRED']);
  assert.deepEqual(result.reviewContext.phoneReconciliationFields,
    ['Account.Phone', 'Deal.Forwarding_Administrator_Mobile']);
  assert.equal(result.reviewContext.crmPhoneFormattingMatchesCandidate, false);
  assert.equal(result.deploymentAuthorized, false);
  assert.equal(JSON.stringify(input), before);
});

test('submitted handling preferences cannot silently enable transfer, fallback or suppress required alerts', () => {
  const { CHOICES } = require('../../revenue-leak-test-setup-form/functions/revenue_leak_test_setup_form/lib/form-contract');
  for (const [field, key] of [['Urgent_Call_Handling', 'urgentCallHandling'],
    ['Existing_Customer_Call_Handling', 'existingCustomerCallHandling']]) {
    assert.ok(CHOICES[key].includes('Alert + Capture Callback'));
    for (const value of CHOICES[key].filter((choice) => choice !== 'Alert + Capture Callback')) {
      const input = syntheticPreparationInputs()[0];
      input.crm.deal[field] = value;
      if (field === 'Urgent_Call_Handling') input.review.urgentHandlingSourceText = value;
      assert.deepEqual(prepare(input).unresolved, ['FREE_TEST_HANDLING_POLICY_UNSUPPORTED']);
    }
  }
});

test('verification, CRM attestation, receipt, and session chronology must agree', () => {
  const cases = [
    (v) => { delete v.evidence.session.VERIFIED_AT; },
    (v) => { v.evidence.session.ROWID = undefined; v.evidence.submission.SESSION_ROW_ID = undefined;
      v.evidence.proof.SESSION_ROW_ID = undefined; },
    (v) => { v.evidence.proof.VERIFIED_AT = '2026-09-09T11:44:00Z'; },
    (v) => { v.crm.deal.Setup_Access_Verified_At = '2026-09-09T11:44:00Z'; },
    (v) => { v.evidence.proof.CONSUMED_AT = '2026-09-09T11:44:00Z'; },
    (v) => { v.crm.deal.Test_Scope_Accepted_At = '2026-09-09T11:49:00Z'; },
    (v) => { v.evidence.submission.SUCCEEDED_AT = '2026-09-09T11:49:00Z'; },
    (v) => { v.evidence.session.SUBMITTED_AT = '2026-09-09T12:01:00Z'; },
  ];
  for (const mutate of cases) {
    const input = syntheticPreparationInputs()[0]; mutate(input);
    assert.deepEqual(prepare(input).unresolved, ['SUBMISSION_EVIDENCE_INCOMPLETE']);
  }
});

test('CRM whole-second verification and submitted stamps preserve Catalyst millisecond evidence', () => {
  const input = syntheticPreparationInputs()[0];
  input.evidence.session.VERIFIED_AT = '2026-09-09T11:45:00.654Z';
  input.evidence.proof.VERIFIED_AT = input.evidence.session.VERIFIED_AT;
  input.evidence.proof.CONSUMED_AT = '2026-09-09T11:50:00.123Z';
  input.evidence.submission.SUCCEEDED_AT = '2026-09-09T11:50:00.550Z';
  input.evidence.session.SUBMITTED_AT = '2026-09-09T11:50:00.660Z';
  assert.equal(prepare(input).status, 'prepared_local_only');
  input.crm.deal.Setup_Access_Verified_At = '2026-09-09T11:45:01Z';
  assert.deepEqual(prepare(input).unresolved, ['SUBMISSION_EVIDENCE_INCOMPLETE']);
});

test('overflow and combined remain blocked with numeric, ring or fabricated timing evidence', () => {
  for (const route of ['No-Answer/Overflow', 'No Answer / Overflow Only', 'Both', 'After Hours + Overflow']) {
    for (const delay of [25, '4 Rings', 'Provider Default', 'Not Sure']) {
      const input = syntheticPreparationInputs()[0];
      input.crm.deal.Approved_Test_Route = route;
      input.crm.deal.No_Answer_Delay = delay;
      input.review.providerTiming = { verified: true, value: 25, unit: 'seconds' };
      assert.deepEqual(prepare(input).unresolved, ['PROVIDER_TIMING_UNVERIFIED']);
    }
  }
  const invalid = syntheticPreparationInputs()[0];
  invalid.crm.deal.Approved_Test_Route = 'after hours only';
  assert.deepEqual(prepare(invalid).unresolved, ['APPROVED_ROUTE_UNRESOLVED']);
});

function preparationWithTiming(index = 0, route = 'No-Answer/Overflow') {
  const input = syntheticPreparationInputs()[index];
  input.crm.deal.Approved_Test_Route = route;
  input.crm.deal.No_Answer_Delay = '5 Rings';
  input.review.providerTiming = providerTimingFixture({
    clientId: input.review.clientId, crmDealId: input.crm.deal.id,
    deploymentId: input.review.deploymentId,
    configurationVersion: input.crm.deal.Configuration_Version,
    phoneSystemProvider: input.crm.account.Phone_System_Provider,
    coverageMode: ['Both', 'After Hours + Overflow'].includes(route)
      ? 'AfterHoursAndOverflow' : 'NoAnswerOverflowOnly',
  }, { businessNumber: input.crm.account.Phone });
  return input;
}

test('explicit owner-attested timing prepares overflow and combined without changing CRM or execution authority', () => {
  for (const route of ['No-Answer/Overflow', 'No Answer / Overflow Only', 'Both', 'After Hours + Overflow']) {
    for (const index of [0, 1]) {
      const input = preparationWithTiming(index, route);
      const before = structuredClone(input); const result = prepare(input);
      assert.equal(result.status, 'prepared_local_only'); assert.deepEqual(result.unresolved, []);
      assert.equal(result.providerVerified, false); assert.equal(result.deploymentAuthorized, false);
      assert.equal(result.candidate.approved, false);
      assert.equal(result.candidate.notificationRecipient.approved, false);
      assert.equal(result.candidate.noAnswerDelay, null);
      assert.deepEqual(result.candidate.providerTiming, input.review.providerTiming);
      assert.equal(result.candidate.providerTiming.submittedPreference, '5 Rings');
      assert.equal(result.candidate.providerTiming.value, '27.5', 'no ring-to-second calculation');
      assert.deepEqual(input, before); assert.deepEqual(prepare(input), result);
    }
  }
});

test('a default or uncertain submitted preference needs a separate explicit accepted setting, never an inferred delay', () => {
  for (const preference of ['Provider Default', 'Not Sure']) {
    const input = preparationWithTiming();
    input.crm.deal.No_Answer_Delay = preference;
    input.review.providerTiming.submittedPreference = preference;
    assert.equal(prepare(input).status, 'prepared_local_only');
    input.review.providerTiming.value = preference;
    assert.deepEqual(prepare(input).unresolved, ['PROVIDER_TIMING_UNVERIFIED']);
  }
});

test('new timing preparation rejects absent evidence, stale review and unknown provider data', () => {
  const cases = [
    (input) => { delete input.review.providerTiming; },
    (input) => { input.review.providerTiming.verified = true; },
    (input) => { input.review.providerTiming.unit = 'Unknown'; },
    (input) => { input.review.providerTiming.value = 'Provider Default'; },
    (input) => { input.review.providerTiming.observedAt = '2026-09-09T11:44:59.999Z'; },
    (input) => { input.review.providerTiming.observedAt = '2026-09-09T12:01:00.000Z'; },
    (input) => { input.review.providerTiming.ownerAcceptedAt = '2026-09-09T12:01:00.000Z'; },
    (input) => { input.review.providerTiming.evidenceSha256 = ''; },
    (input) => { input.review.providerTiming.documentationReference = ''; },
    (input) => { input.review.providerTiming.ownerDecision = 'pending'; },
  ];
  for (const mutate of cases) {
    const input = preparationWithTiming(); mutate(input);
    assert.deepEqual(prepare(input).unresolved, ['PROVIDER_TIMING_UNVERIFIED']);
    assert.equal(prepare(input).candidate, null);
  }
});

test('timing preparation binds exact current phone/provider/route/preference and rejects cross-business reuse', () => {
  for (const mutate of [
    (input) => { input.crm.account.Phone = '+19135550999'; },
    (input) => { input.crm.deal.No_Answer_Delay = '6 Rings'; },
  ]) {
    const input = preparationWithTiming(); mutate(input);
    assert.deepEqual(prepare(input).unresolved, ['PROVIDER_TIMING_SOURCE_MISMATCH']);
  }
  for (const mutate of [
    (input) => { input.crm.account.Phone_System_Provider = 'Different synthetic PBX'; },
    (input) => { input.crm.deal.Approved_Test_Route = 'Both'; },
    (input) => { input.review.deploymentId = 'different_synthetic_deployment'; },
    (input) => { input.review.providerTiming = preparationWithTiming(1).review.providerTiming; },
  ]) {
    const input = preparationWithTiming(); mutate(input);
    assert.deepEqual(prepare(input).unresolved, ['PROVIDER_TIMING_UNVERIFIED']);
  }
  const afterHours = syntheticPreparationInputs()[0];
  afterHours.review.providerTiming = preparationWithTiming().review.providerTiming;
  assert.deepEqual(prepare(afterHours).unresolved, ['PROVIDER_TIMING_UNVERIFIED']);
});

test('readback age is bounded and future or stale metadata cannot be prepared', () => {
  const input = syntheticPreparationInputs()[0];
  const captured = Date.parse(input.evidence.capturedAt);
  assert.equal(prepare(input, captured + MAX_READBACK_AGE_MS).status, 'prepared_local_only');
  assert.deepEqual(prepare(input, captured + MAX_READBACK_AGE_MS + 1).unresolved,
    ['FRESH_READBACK_REQUIRED']);
  assert.deepEqual(prepare(input, captured - 1).unresolved, ['FRESH_READBACK_REQUIRED']);
});

test('IANA zone and exact dated exceptions survive both DST seasons without clock creation', () => {
  const input = syntheticPreparationInputs()[0];
  input.review.hoursExceptions = [
    { date: '2026-03-08', hours: 'Closed' }, { date: '2026-11-01', hours: '10:00-14:00' },
  ];
  const result = prepare(input);
  assert.equal(result.status, 'prepared_local_only');
  assert.deepEqual(result.reviewContext.hoursExceptions, input.review.hoursExceptions);
  assert.deepEqual(result.reviewContext.weeklyHours, input.review.weeklyHours);
  assert.equal(result.reviewContext.hoursSourceText, input.crm.account.Normal_Business_Hours);
  assert.match(result.candidate.businessHours, /Saturday Closed; Sunday Closed/);
  assert.match(result.candidate.businessHours, /America\/Chicago \(IANA daylight-saving rules\)/);
  assert.equal(Object.hasOwn(result.candidate, 'actualStartAt'), false);
  assert.equal(Object.hasOwn(result.candidate, 'expiresAt'), false);
});

test('business input is never silently truncated to satisfy runtime limits', () => {
  const input = syntheticPreparationInputs()[0];
  input.review.callbackExpectation = 'x'.repeat(301);
  assert.deepEqual(prepare(input).unresolved, ['CALLBACK_REVIEW_REQUIRED']);
  input.review.callbackExpectation = 'x'.repeat(300);
  assert.equal(prepare(input).candidate.callbackExpectation.length, 300);
  input.review.hoursExceptions = Array.from({ length: 16 }, (_, index) => ({
    date: `2026-12-${String(index + 1).padStart(2, '0')}`, hours: '08:00-17:00',
  }));
  assert.deepEqual(prepare(input).unresolved, ['BUSINESS_HOURS_REVIEW_REQUIRED']);
});

test('bridge has no I/O, SDK, process environment, credentials, or provider execution imports', () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/free-test-preparation.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:|zcatalyst|https?|net|tls|child_process)/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|setInterval|setTimeout)\s*\(|process\.env|console\./);
});

test('optional pre-test capture is minimized inside the unapproved configuration without a start time', () => {
  const legacy = prepare(syntheticPreparationInputs()[0]);
  assert.equal(Object.hasOwn(legacy.candidate, 'reportBaseline'), false);
  const input = withBaseline();
  const before = structuredClone(input);
  const result = prepare(input);
  assert.equal(result.status, 'prepared_local_only');
  assert.equal(result.deploymentAuthorized, false);
  assert.equal(result.providerVerified, false);
  assert.equal(result.candidate.approved, false);
  const baseline = result.candidate.reportBaseline;
  assert.equal(baseline.configurationVersionId, input.review.configurationVersionId);
  assert.equal(baseline.configurationVersion, input.crm.deal.Configuration_Version);
  assert.equal(baseline.coverageMode, 'AfterHoursOnly');
  assert.equal(baseline.capturedAt, input.evidence.capturedAt);
  assert.equal(baseline.provenanceStatus, 'locally_consistent_not_authenticated');
  assert.equal(baseline.values.averageJobValueMinorUnits, 35025);
  assert.equal(baseline.values.estimatedUnansweredCallRate, 12.5);
  assert.equal(Object.hasOwn(baseline, 'relationships'), false);
  assert.equal(Object.hasOwn(baseline, 'testStartedAt'), false);
  assert.equal(Object.hasOwn(result.candidate, 'actualStartAt'), false);
  assert.equal(Object.keys(baseline.values).length, 9);
  assert.ok(Buffer.byteLength(JSON.stringify(result.candidate)) < 10000);
  assert.deepEqual(input, before);
  assert.deepEqual(prepare(input), result);
});

test('baseline capture cannot substitute another relationship, revision, partition or CRM source value', () => {
  const cases = [
    (v) => { v.reportBaseline.context.relationships.leadId = '100000009'; },
    (v) => { v.reportBaseline.deal.id = '400000009'; },
    (v) => { v.reportBaseline.deal.Account_Name.id = '200000009'; },
    (v) => { v.reportBaseline.deal.Contact_Name.id = '300000009'; },
    (v) => { v.reportBaseline.deal.Intake_Submission_ID = 'another_journey'; },
    (v) => { v.reportBaseline.deal.Configuration_Version = 'another_label'; },
    (v) => { v.reportBaseline.deal.Modified_Time = '2026-09-09T11:51:00.000Z'; },
    (v) => { v.reportBaseline.deal.Approved_Test_Route = 'Both'; },
    (v) => { v.reportBaseline.evidence.capturedAt = '2026-09-09T11:58:00.000Z'; },
    (v) => { v.reportBaseline.context.configurationVersionId = 'another_row'; },
    (v) => { v.reportBaseline.context.clientKey = 'c'.repeat(64); },
    (v) => { v.reportBaseline.context.deploymentKey = 'd'.repeat(64); },
    (v) => { delete v.review.configurationVersionId; },
    (v) => { delete v.review.analyticsClientKey; },
    (v) => { delete v.review.analyticsDeploymentKey; },
    (v) => { delete v.crm.deal.Monthly_Inbound_Calls; },
    (v) => { v.crm.deal.Estimated_Unanswered_Call_Rate += 1; },
    (v) => { v.reportBaseline.deal.Average_Job_Value += 1; },
  ];
  for (const mutate of cases) {
    const input = withBaseline(); mutate(input);
    const result = prepare(input);
    assert.equal(result.status, 'blocked');
    assert.equal(result.candidate, null);
    assert.deepEqual(result.unresolved, ['REPORT_BASELINE_BINDING_CONFLICT']);
  }
});

test('fresh capture rules, private-field rejection and pre-approval state remain enforced together', () => {
  const cases = [
    (v) => { v.reportBaseline.evidence.readAt = '2026-09-09T11:40:00.000Z'; },
    (v) => { v.reportBaseline.metadata.observedAt = '2026-09-09T11:40:00.000Z'; },
    (v) => { v.reportBaseline.evidence.readAt = '2026-09-09T12:01:00.000Z'; },
    (v) => { v.reportBaseline.context.testStartedAt = '2026-09-10T12:00:00.000Z'; },
    (v) => { v.reportBaseline.deal.Email = 'synthetic@example.invalid'; },
    (v) => { v.reportBaseline.context.currency = 'EUR'; },
  ];
  for (const mutate of cases) {
    const input = withBaseline(); mutate(input);
    const result = prepare(input);
    assert.equal(result.status, 'blocked');
    assert.equal(result.candidate, null);
    assert.match(result.unresolved[0], /^CRM_BASELINE_/);
  }
  const approved = withBaseline();
  approved.crm.deal.Go_Live_Approval_Status = 'Approved';
  assert.deepEqual(prepare(approved).unresolved, ['FREE_TEST_PREPARATION_STATE_REQUIRED']);
});

test('baseline and configuration must fit the same immutable 10,000-byte column without truncation', () => {
  const input = withBaseline();
  input.review.unsupportedServices = Array.from({ length: 30 }, (_, index) =>
    `${String(index).padStart(2, '0')}${'é'.repeat(118)}`);
  input.review.urgentConditions = Array.from({ length: 25 }, (_, index) =>
    `${String(index).padStart(2, '0')}${'é'.repeat(118)}`);
  const before = structuredClone(input);
  const result = prepare(input);
  assert.equal(result.candidate, null);
  assert.deepEqual(result.unresolved, ['RUNTIME_CONFIGURATION_REVIEW_REQUIRED']);
  assert.deepEqual(input, before);
});
