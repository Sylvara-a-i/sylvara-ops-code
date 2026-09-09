'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONTRACT,
  COVERAGE_LABEL_TO_MODE,
  COVERAGE_MODES,
  CRM_APPROVED_ROUTE_TO_LABEL,
  COVERAGE_TRIGGER_COMPATIBILITY,
  COVERAGE_TRIGGERS,
  UNKNOWN_COVERAGE_TRIGGER_POLICY,
} = require('../lib/contracts');
const { triggerAllowedForMode } = require('../lib/analysis');
const { validateConfiguration } = require('../lib/validation');
const { configuration } = require('./runtime-fixture');
const { CHOICES, buildPrefillPayload } = require(
  '../../../../revenue-leak-test-setup-form/functions/revenue_leak_test_setup_form/lib/form-contract',
);

const CANONICAL_MODES = Object.freeze([
  'AfterHoursOnly',
  'NoAnswerOverflowOnly',
  'AfterHoursAndOverflow',
]);

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

test('CRM route references agree with Form 2 without accepting labels as stored values', () => {
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
  }
});

test('configuration accepts all three exact route/mode pairs with a verified delay only', () => {
  for (const [label, mode] of COVERAGE_LABEL_TO_MODE) {
    const candidate = { ...configuration('A'), coverageMode: mode,
      approvedTestRoute: label, noAnswerDelay: mode === 'AfterHoursOnly' ? null : 25 };
    assert.equal(validateConfiguration(candidate).coverageMode, mode);
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
