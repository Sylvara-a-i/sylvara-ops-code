'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONTRACT,
  COVERAGE_LABEL_TO_MODE,
  COVERAGE_MODES,
  CRM_APPROVED_ROUTE_TO_LABEL,
  decodeCrmApprovedTestRoute,
  COVERAGE_TRIGGER_COMPATIBILITY,
  COVERAGE_TRIGGERS,
  UNKNOWN_COVERAGE_TRIGGER_POLICY,
} = require('../lib/contracts');
const { triggerAllowedForMode } = require('../lib/analysis');
const { validateConfiguration, assertExecutionTimingSupported,
  assertNotificationHandoffReady, validateProviderTimingBinding } = require('../lib/validation');
const { configuration, runtimeFixture } = require('./runtime-fixture');
const { providerTimingFixture } = require('./provider-timing-fixture');
const { routeFingerprint, routeFromRows, configurationSnapshotFingerprint }
  = require('../lib/approval-control');
const { CHOICES, buildPrefillPayload } = require(
  '../../../../revenue-leak-test-setup-form/functions/revenue_leak_test_setup_form/lib/form-contract',
);

const CANONICAL_MODES = Object.freeze([
  'AfterHoursOnly',
  'NoAnswerOverflowOnly',
  'AfterHoursAndOverflow',
]);

test('notification monitoring is optional historical structure but mandatory new-admission evidence', () => {
  const legacy = configuration('A');
  delete legacy.notificationHandoff;
  assert.equal(Object.hasOwn(validateConfiguration(legacy), 'notificationHandoff'), false);
  assert.throws(() => assertNotificationHandoffReady(validateConfiguration(legacy)),
    { code: 'NOTIFICATION_HANDOFF_UNAPPROVED' });
  const now = Date.parse('2026-09-15T12:00:00.000Z');
  const ready = { ...legacy, notificationHandoff: {
    schemaVersion: 1, timeZone: 'America/Chicago', channel: 'email',
    recipientId: legacy.notificationRecipient.recipientId, monitored: true,
    acknowledgedAt: '2026-09-15T11:59:00.000Z', acknowledgmentReference: 'synthetic_monitoring_A',
  } };
  assert.equal(assertNotificationHandoffReady(validateConfiguration(ready), { now }).timeZone,
    'America/Chicago');
  for (const patch of [{ monitored: false }, { acknowledgedAt: '2026-09-15T12:01:00.000Z' }]) {
    const input = { ...ready, notificationHandoff: { ...ready.notificationHandoff, ...patch } };
    assert.doesNotThrow(() => validateConfiguration(input));
    assert.throws(() => assertNotificationHandoffReady(validateConfiguration(input), { now }),
      { code: 'NOTIFICATION_HANDOFF_UNAPPROVED' });
  }
  for (const patch of [{ schemaVersion: 2 }, { timeZone: '+05:00' }, { timeZone: 'Unknown/Zone' },
    { channel: 'mobile' }, { recipientId: 'another_recipient' }, { monitored: 'true' },
    { acknowledgedAt: 'September 15, 2026' }, { acknowledgmentReference: '' }, { email: 'other@example.invalid' }]) {
    assert.throws(() => validateConfiguration({ ...ready,
      notificationHandoff: { ...ready.notificationHandoff, ...patch } }), { code: 'INVALID_SCHEMA' });
  }
  assert.throws(() => assertNotificationHandoffReady({ ...ready,
    notificationRecipient: { ...ready.notificationRecipient, name: ' ' } }, { now }),
  { code: 'NOTIFICATION_HANDOFF_UNAPPROVED' });
  assert.throws(() => assertNotificationHandoffReady({ ...ready,
    notificationRecipient: { ...ready.notificationRecipient, approved: false } }, { now }),
  { code: 'NOTIFICATION_HANDOFF_UNAPPROVED' });
});

test('coverage contract owns the exact modes, labels, triggers, and compatibility matrix', () => {
  assert.deepEqual([...COVERAGE_MODES], CANONICAL_MODES);
  assert.deepEqual([...COVERAGE_LABEL_TO_MODE], [
    ['After Hours Only', 'AfterHoursOnly'],
    ['No Answer / Overflow Only', 'NoAnswerOverflowOnly'],
    ['After Hours + Overflow', 'AfterHoursAndOverflow'],
  ]);
  assert.deepEqual([...COVERAGE_TRIGGERS], ['AfterHours', 'NoAnswerOverflow', 'Unknown']);
  assert.deepEqual(CONTRACT.compatible_triggers_by_coverage_mode, {
    AfterHoursOnly: ['AfterHours'],
    NoAnswerOverflowOnly: ['NoAnswerOverflow'],
    AfterHoursAndOverflow: ['AfterHours', 'NoAnswerOverflow'],
  });
  assert.deepEqual(CONTRACT.coverage_validation, {
    case_sensitive: true,
    trim_inputs: false,
    unknown_mode_values_fail_closed: true,
    coverage_trigger_is_separate_from_coverage_mode: true,
  });
  assert.deepEqual(
    [...COVERAGE_TRIGGER_COMPATIBILITY]
      .map(([mode, triggers]) => [mode, [...triggers]]),
    [
      ['AfterHoursOnly', ['AfterHours']],
      ['NoAnswerOverflowOnly', ['NoAnswerOverflow']],
      ['AfterHoursAndOverflow', ['AfterHours', 'NoAnswerOverflow']],
    ],
  );
});

test('approved display labels map exactly while canonical runtime values remain separate', () => {
  for (const [label, mode] of COVERAGE_LABEL_TO_MODE) {
    assert.equal(COVERAGE_LABEL_TO_MODE.get(label), mode);
    assert.equal(COVERAGE_MODES.has(mode), true);
    assert.equal(COVERAGE_MODES.has(label), false);
  }
  for (const value of [
    undefined, null, '', ' ', '\tAfterHoursOnly', 'AfterHoursOnly ', 'afterhoursonly',
    'AfterHours', 'NoAnswerOverflow', 'AfterHoursAnd', 'After Hours+Overflow',
    'No Answer/Overflow Only', 'No Answer  / Overflow Only', 'Unknown',
  ]) {
    assert.equal(COVERAGE_MODES.has(value), false);
    assert.equal(COVERAGE_LABEL_TO_MODE.has(value), false);
  }
});

test('CRM route decoder agrees with Form 2 for exact stored and canonical values', () => {
  assert.deepEqual([...CRM_APPROVED_ROUTE_TO_LABEL], [
    ['After-Hours', 'After Hours Only'],
    ['No-Answer/Overflow', 'No Answer / Overflow Only'],
    ['Both', 'After Hours + Overflow'],
  ]);
  assert.deepEqual([...COVERAGE_LABEL_TO_MODE.keys()], CHOICES.testRoute);
  const modified = '2026-09-09T12:00:00Z';
  const records = {
    contact: { id: '400000001', Modified_Time: modified,
      Account_Name: { id: '400000002' }, Email: 'qa@example.invalid',
      Mobile: '+15550100101' },
    account: { id: '400000002', Modified_Time: modified },
    deal: { id: '400000003', Modified_Time: modified,
      Account_Name: { id: '400000002' }, Contact_Name: { id: '400000001' } },
  };
  for (const [stored, label] of CRM_APPROVED_ROUTE_TO_LABEL) {
    records.deal.Approved_Test_Route = stored;
    assert.equal(buildPrefillPayload(records, {
      allowedPhoneSystemProviders: ['Synthetic PBX'],
    }).approvedTestRoute, label);
    assert.equal(records.deal.Approved_Test_Route, stored);
    assert.equal(CRM_APPROVED_ROUTE_TO_LABEL.has(label), false);
    assert.equal(CRM_APPROVED_ROUTE_TO_LABEL.has(` ${stored}`), false);
    assert.equal(CRM_APPROVED_ROUTE_TO_LABEL.has(stored.toLowerCase()), false);
    assert.equal(decodeCrmApprovedTestRoute(stored), label);
    assert.equal(decodeCrmApprovedTestRoute(label), label);
    records.deal.Approved_Test_Route = label;
    assert.equal(buildPrefillPayload(records, {
      allowedPhoneSystemProviders: ['Synthetic PBX'],
    }).approvedTestRoute, label);
  }
  for (const invalid of [undefined, null, '', 'Unknown', ...CANONICAL_MODES,
    'after-hours', 'After-Hours ', 'After Hours Only ', ' After Hours Only', 'both']) {
    assert.equal(decodeCrmApprovedTestRoute(invalid), undefined);
  }
});

test('historical configuration parses exact route/mode pairs without claiming timing verification', () => {
  for (const [label, mode] of COVERAGE_LABEL_TO_MODE) {
    const candidate = { ...configuration('A'), coverageMode: mode,
      approvedTestRoute: label, noAnswerDelay: mode === 'AfterHoursOnly' ? null : 25 };
    assert.equal(validateConfiguration(candidate).coverageMode, mode);
    if (mode === 'AfterHoursOnly') {
      assert.doesNotThrow(() => assertExecutionTimingSupported(validateConfiguration(candidate)));
    } else {
      assert.throws(() => assertExecutionTimingSupported(validateConfiguration(candidate)),
        { code: 'PROVIDER_TIMING_UNVERIFIED' });
    }
    for (const otherMode of COVERAGE_MODES) {
      if (otherMode !== mode) assert.throws(() => validateConfiguration({
        ...candidate, coverageMode: otherMode,
      }), { code: 'INVALID_SCHEMA' });
    }
    for (const noAnswerDelay of mode === 'AfterHoursOnly'
      ? [25, '4 Rings'] : [null, undefined, ...CHOICES.noAnswerDelay, '25', 0, 121]) {
      assert.throws(() => validateConfiguration({ ...candidate, noAnswerDelay }),
        { code: 'INVALID_SCHEMA' });
    }
  }
  for (const approvedTestRoute of [null, '', 'Unknown', 'After Hours Only ',
    ...CRM_APPROVED_ROUTE_TO_LABEL.keys(), ...COVERAGE_MODES]) {
    assert.throws(() => validateConfiguration({ ...configuration('A'), approvedTestRoute }),
      { code: 'INVALID_SCHEMA' });
  }
});

function boundTimingConfiguration(mode = 'NoAnswerOverflowOnly') {
  const candidate = { ...configuration('A'), coverageMode: mode,
    approvedTestRoute: mode === 'NoAnswerOverflowOnly'
      ? 'No Answer / Overflow Only' : 'After Hours + Overflow', noAnswerDelay: null };
  candidate.providerTiming = providerTimingFixture(candidate);
  return candidate;
}

test('owner-attested timing preserves native values but never grants live execution', () => {
  for (const mode of ['NoAnswerOverflowOnly', 'AfterHoursAndOverflow']) {
    for (const [value, unit] of [['27.5', 'seconds'], ['27500', 'milliseconds'], ['5', 'rings']]) {
      const candidate = boundTimingConfiguration(mode);
      Object.assign(candidate.providerTiming, { value, unit });
      const result = validateConfiguration(candidate);
      assert.deepEqual(result.providerTiming, candidate.providerTiming);
      assert.equal(result.noAnswerDelay, null, 'never converts a ring preference to a numeric delay');
      assert.ok(Object.isFrozen(result.providerTiming));
      assert.throws(() => assertExecutionTimingSupported(result), { code: 'PROVIDER_TIMING_UNVERIFIED' });
    }
  }
  const afterHours = configuration('A');
  assert.doesNotThrow(() => assertExecutionTimingSupported(validateConfiguration(afterHours)));
  assert.throws(() => validateConfiguration({ ...afterHours,
    providerTiming: providerTimingFixture(afterHours) }), { code: 'INVALID_SCHEMA' });
  assert.throws(() => validateConfiguration({ ...boundTimingConfiguration(), noAnswerDelay: 25 }),
    { code: 'INVALID_SCHEMA' });
});

test('timing binding rejects missing, unknown, malformed or self-declared verification evidence', () => {
  const mutations = [
    (v) => { delete v.evidenceSha256; }, (v) => { v.verified = true; },
    (v) => { v.evidenceClass = 'provider_verified'; }, (v) => { v.schemaVersion = 2; },
    (v) => { v.ownerDecision = 'pending'; }, (v) => { v.value = 25; },
    (v) => { v.value = 'Unknown'; }, (v) => { v.unit = 'Not Sure'; },
    (v) => { v.value = 'Provider Default'; }, (v) => { v.settingName = ''; },
    (v) => { v.value = '25\n'; }, (v) => { v.unit = ' seconds'; },
    (v) => { v.evidenceSha256 = 'not-a-digest'; },
    (v) => { v.documentationSha256 = 'not-a-digest'; },
    (v) => { v.evidenceReference = 'https://private.invalid/secret'; },
    (v) => { v.documentationReference = ''; }, (v) => { v.businessNumber = '9135550101'; },
    (v) => { v.observedAt = '2026-09-09T11:58:00Z'; },
    (v) => { v.ownerAcceptedAt = '2026-09-09T11:57:00.000Z'; },
    (v) => { v.submittedPreference = '25 seconds'; },
  ];
  for (const mutate of mutations) {
    const candidate = boundTimingConfiguration(); mutate(candidate.providerTiming);
    assert.throws(() => validateConfiguration(candidate), { code: 'PROVIDER_TIMING_UNVERIFIED' });
  }
  const candidate = boundTimingConfiguration();
  for (const missing of [null, undefined, {}, []]) {
    assert.throws(() => validateProviderTimingBinding(missing, candidate),
      { code: 'PROVIDER_TIMING_UNVERIFIED' });
  }
});

test('timing snapshot freshness is checked for new preparation without expiring historical parsing', () => {
  const candidate = boundTimingConfiguration();
  const capturedAt = '2026-09-09T11:59:00.000Z';
  const now = Date.parse('2026-09-09T12:00:00.000Z');
  assert.deepEqual(validateProviderTimingBinding(candidate.providerTiming, candidate, { now, capturedAt }),
    candidate.providerTiming);
  for (const options of [
    { now: now + 15 * 60 * 1000, capturedAt },
    { now, capturedAt: '2026-09-09T12:01:00.000Z' },
    { now, capturedAt: '2026-09-09T11:58:30.000Z' },
    { now: NaN, capturedAt }, { now }, { capturedAt },
  ]) assert.throws(() => validateProviderTimingBinding(candidate.providerTiming, candidate, options),
    { code: 'PROVIDER_TIMING_UNVERIFIED' });
  assert.doesNotThrow(() => validateConfiguration(candidate), 'historical parsing has no wall-clock freshness gate');
});

test('timing evidence cannot be transplanted across configuration ownership or route context', () => {
  for (const field of ['clientId', 'crmDealId', 'deploymentId', 'configurationVersion',
    'phoneSystemProvider', 'coverageMode']) {
    const candidate = boundTimingConfiguration();
    candidate.providerTiming[field] = 'other_synthetic_context';
    assert.throws(() => validateConfiguration(candidate), { code: 'PROVIDER_TIMING_UNVERIFIED' });
  }
  const first = boundTimingConfiguration();
  const second = { ...configuration('B'), coverageMode: first.coverageMode,
    approvedTestRoute: first.approvedTestRoute, noAnswerDelay: null, providerTiming: first.providerTiming };
  assert.throws(() => validateConfiguration(second), { code: 'PROVIDER_TIMING_UNVERIFIED' });
});

test('every timing field is covered by the existing immutable configuration and signed route fingerprint', () => {
  const fixture = runtimeFixture();
  const deployment = { ...fixture.store.rows.get('RevenueDeskDeployments')[0], COVERAGE_MODE: 'NoAnswerOverflowOnly' };
  const candidate = boundTimingConfiguration();
  const row = { ...fixture.store.rows.get('RevenueDeskConfigurationVersions')[0],
    CONFIGURATION_JSON: JSON.stringify(candidate) };
  const snapshot = configurationSnapshotFingerprint(row);
  const fingerprint = routeFingerprint(routeFromRows(deployment, row));
  assert.equal(routeFingerprint(routeFromRows(deployment, structuredClone(row))), fingerprint,
    'exact replay has the same authorization binding');
  for (const field of Object.keys(candidate.providerTiming)) {
    const changed = structuredClone(candidate);
    changed.providerTiming[field] = typeof changed.providerTiming[field] === 'number'
      ? changed.providerTiming[field] + 1 : `${changed.providerTiming[field]}_changed`;
    const changedRow = { ...row, CONFIGURATION_JSON: JSON.stringify(changed) };
    assert.notEqual(configurationSnapshotFingerprint(changedRow), snapshot, field);
    assert.notEqual(routeFingerprint(routeFromRows(deployment, changedRow)), fingerprint, field);
  }
});

test('configuration enforces the exact Form 2 fallback choices and number requirement', () => {
  assert.deepEqual(CHOICES.fallbackDestination,
    ['Existing Office Line', 'On-Call Mobile', 'Voicemail', 'Other']);
  for (const destination of CHOICES.fallbackDestination) {
    const numbered = destination !== 'Voicemail';
    const candidate = { ...configuration('A'), approvedFallbackDestination: destination,
      approvedFallbackNumber: numbered ? '+15550100102' : null };
    assert.equal(validateConfiguration(candidate).approvedFallbackDestination, destination);
    for (const number of numbered ? [null, undefined, '', '5550100102', 'unknown']
      : ['+15550100102']) {
      assert.throws(() => validateConfiguration({ ...candidate, approvedFallbackNumber: number }),
        { code: 'INVALID_SCHEMA' });
    }
  }
  for (const destination of [null, undefined, '', ' ', 'Unknown', 'Phone',
    'On-Call Mobile ', 'voicemail', 'Transfer to technician']) {
    assert.throws(() => validateConfiguration({ ...configuration('A'),
      approvedFallbackDestination: destination, approvedFallbackNumber: '+15550100102' }),
    { code: 'INVALID_SCHEMA' });
  }
});

test('coverage mode and classified trigger compatibility is exact', () => {
  const cases = [
    ['AfterHoursOnly', 'AfterHours', true],
    ['AfterHoursOnly', 'NoAnswerOverflow', false],
    ['NoAnswerOverflowOnly', 'NoAnswerOverflow', true],
    ['NoAnswerOverflowOnly', 'AfterHours', false],
    ['AfterHoursAndOverflow', 'AfterHours', true],
    ['AfterHoursAndOverflow', 'NoAnswerOverflow', true],
  ];
  for (const [mode, trigger, expected] of cases) {
    assert.equal(triggerAllowedForMode(trigger, mode), expected);
  }
});

test('Unknown retains unclassified calls only for a canonical coverage mode', () => {
  assert.equal(UNKNOWN_COVERAGE_TRIGGER_POLICY.value, 'Unknown');
  assert.equal(UNKNOWN_COVERAGE_TRIGGER_POLICY.allowed_for_all_canonical_coverage_modes, true);
  for (const mode of CANONICAL_MODES) assert.equal(triggerAllowedForMode('Unknown', mode), true);
  for (const mode of [undefined, null, '', 'Unknown', 'After Hours Only']) {
    assert.equal(triggerAllowedForMode('Unknown', mode), false);
  }
});

test('missing, unknown, malformed, and wrong-domain triggers fail closed', () => {
  for (const trigger of [
    undefined, null, '', ' ', 'afterhours', 'AfterHoursOnly', 'NoAnswerOverflowOnly',
    'AfterHoursAndOverflow', 'Unknown ', 'NotClassified',
  ]) {
    assert.equal(triggerAllowedForMode(trigger, 'AfterHoursOnly'), false);
  }
  assert.equal(triggerAllowedForMode('AfterHours', 'Unknown'), false);
  assert.equal(triggerAllowedForMode('AfterHours', 'After Hours Only'), false);
});
