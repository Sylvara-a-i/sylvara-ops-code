'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONTRACT,
  COVERAGE_LABEL_TO_MODE,
  COVERAGE_MODES,
  COVERAGE_TRIGGER_COMPATIBILITY,
  COVERAGE_TRIGGERS,
  UNKNOWN_COVERAGE_TRIGGER_POLICY,
} = require('../lib/contracts');
const { triggerAllowedForMode } = require('../lib/analysis');

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
