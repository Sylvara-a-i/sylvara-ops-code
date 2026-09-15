'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ANALYSIS_TYPES, ANALYSIS_ENUMS, compareFreeTestProviderMetadata } = require('../lib/free-test-provider-check');
const contract = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json');

function complete() {
  return {
    analysisFields: contract.retell_custom_analysis_fields.map((name) => ({ name, type: ANALYSIS_TYPES[name],
      ...(ANALYSIS_ENUMS[name] ? { choices: [...ANALYSIS_ENUMS[name]] } : {}) })),
    variableNames: [...contract.retell_conversation_variable_fields],
    webhookEvents: ['call_ended', 'call_analyzed'], webhookTimeoutMs: 10000,
    endpointMatchesApprovedBinding: true, publishedVersionMatchesApprovedBinding: true,
    phoneMachineReadbackComplete: true, dataHandlingMatchesApprovedScope: true,
  };
}

function reviewedContract() {
  return { schemaVersion: 1, evidenceClass: 'reviewed_export_snapshot',
    sourceSha256: 'a'.repeat(64), choices: ['synthetic_intent_alpha', 'synthetic_intent_beta'] };
}

function completeWithReviewedChoices() {
  const input = complete();
  input.analysisFields.find((field) => field.name === 'caller_intent').choices = [...reviewedContract().choices];
  return input;
}

test('optional callback confirmation is typed but never proves live confirmation', () => {
  const input = completeWithReviewedChoices();
  input.analysisFields.push({ name: 'callback_number_confirmed', type: 'boolean' });
  let result = compareFreeTestProviderMetadata(input, reviewedContract());
  assert.equal(result.metadataMatches, true);
  assert.equal(result.callbackConfirmationEvidence, 'definition_present_extraction_unverified');
  assert.equal(result.liveExecutionVerified, false);
  input.analysisFields.find((field) => field.name === 'callback_number_confirmed').type = 'string';
  assert.ok(compareFreeTestProviderMetadata(input, reviewedContract()).gaps.includes('ANALYSIS_TYPES_MISMATCH'));
  input.analysisFields = input.analysisFields.filter((field) => field.name !== 'callback_number_confirmed');
  result = compareFreeTestProviderMetadata(input, reviewedContract());
  assert.equal(result.metadataMatches, true);
  assert.equal(result.requiredAnalysisCount, 15);
  assert.equal(result.callbackConfirmationEvidence, 'not_configured_callback_unknown');
});

test('fifteen analysis fields are required; historical eleven cannot prove preparation complete', () => {
  const input = complete();
  input.analysisFields = input.analysisFields.slice(0, 11);
  const result = compareFreeTestProviderMetadata(input);
  assert.equal(result.metadataMatches, false);
  assert.deepEqual(result.missingAnalysisFields, ['bookable_opportunity',
    'office_follow_up_required', 'workflow_failure_code', 'workflow_failure_text']);
});

test('matching known metadata preserves the unresolved caller-intent contract and never authorizes execution', () => {
  const result = compareFreeTestProviderMetadata(complete());
  assert.equal(result.metadataMatches, false);
  assert.deepEqual(result.gaps, ['CALLER_INTENT_VALUE_CONTRACT_UNVERIFIED']);
  assert.deepEqual(result.unverifiedEnumFields, []);
  assert.deepEqual(result.mismatchedEnumFields, []);
  assert.equal(result.actionAuthorized, false);
  assert.equal(result.liveExecutionVerified, false);
});

test('duplicates, incorrect types, variables, events and unknown bindings fail visibly', () => {
  const mutations = [
    (x) => x.analysisFields.push(x.analysisFields[0]),
    (x) => { x.analysisFields[11].type = 'string'; },
    (x) => x.variableNames.pop(),
    (x) => { x.variableNames[0] = 'unknown_variable'; },
    (x) => x.webhookEvents.push('call_started'),
    (x) => { x.webhookTimeoutMs = 10; },
    ...['endpointMatchesApprovedBinding', 'publishedVersionMatchesApprovedBinding',
      'phoneMachineReadbackComplete', 'dataHandlingMatchesApprovedScope'].map((key) => (x) => { delete x[key]; }),
  ];
  for (const mutate of mutations) {
    const input = complete(); mutate(input);
    assert.equal(compareFreeTestProviderMetadata(input).metadataMatches, false);
    assert.ok(compareFreeTestProviderMetadata(input).gaps.length > 1);
  }
  assert.equal(compareFreeTestProviderMetadata(null).metadataMatches, false);
});

test('known analysis enums require exact values, not matching names and types alone', () => {
  for (const name of Object.keys(ANALYSIS_ENUMS)) {
    for (const choices of [[], ['unexpected'], [...ANALYSIS_ENUMS[name], ANALYSIS_ENUMS[name][0]],
      ANALYSIS_ENUMS[name].map((value) => `${value} `), ANALYSIS_ENUMS[name].slice(1)]) {
      const input = complete();
      input.analysisFields.find((field) => field.name === name).choices = choices;
      const result = compareFreeTestProviderMetadata(input);
      assert.equal(result.metadataMatches, false);
      assert.deepEqual(result.mismatchedEnumFields, [name]);
      assert.ok(result.gaps.includes('ANALYSIS_ENUM_VALUES_MISMATCH'));
    }
    const input = complete();
    delete input.analysisFields.find((field) => field.name === name).choices;
    assert.deepEqual(compareFreeTestProviderMetadata(input).unverifiedEnumFields, [name]);
  }
  const reordered = complete();
  for (const field of reordered.analysisFields) field.choices?.reverse();
  assert.deepEqual(compareFreeTestProviderMetadata(reordered).mismatchedEnumFields, []);
  assert.deepEqual(compareFreeTestProviderMetadata(reordered).gaps,
    ['CALLER_INTENT_VALUE_CONTRACT_UNVERIFIED']);
});

test('comparison output cannot echo arbitrary private input or extra provider fields', () => {
  const result = compareFreeTestProviderMetadata({ ...complete(), privateExtra: 'SYNTHETIC_DO_NOT_ECHO',
    analysisFields: [{ name: 'SYNTHETIC_DO_NOT_ECHO', type: 'string' }] });
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_DO_NOT_ECHO'), false);
});

test('a separately reviewed export contract closes only its exact supplied caller-intent comparison', () => {
  const input = completeWithReviewedChoices();
  const reviewed = reviewedContract();
  const before = JSON.stringify({ input, reviewed });
  const result = compareFreeTestProviderMetadata(input, reviewed);
  assert.equal(result.metadataMatches, true);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.callerIntentValueContract, 'reviewed_export_enum_match');
  assert.equal(result.evidenceClass, 'local_comparison_of_supplied_metadata');
  assert.equal(result.liveExecutionVerified, false);
  assert.equal(result.actionAuthorized, false);
  assert.equal(JSON.stringify({ input, reviewed }), before);
  assert.equal(JSON.stringify(result).includes(reviewed.sourceSha256), false);
  for (const choice of reviewed.choices) assert.equal(JSON.stringify(result).includes(choice), false);
});

test('supplied provider choices do not become their own expected contract', () => {
  const input = completeWithReviewedChoices();
  input.reviewedCallerIntentContract = reviewedContract();
  const result = compareFreeTestProviderMetadata(input);
  assert.equal(result.metadataMatches, false);
  assert.deepEqual(result.gaps, ['CALLER_INTENT_VALUE_CONTRACT_UNVERIFIED']);
});

test('reviewed caller-intent comparison rejects changed values but permits reordered exact choices', () => {
  const reviewed = reviewedContract();
  for (const choices of [[], ['unexpected'], reviewed.choices.slice(1),
    [...reviewed.choices, reviewed.choices[0]], [...reviewed.choices, 'extra'],
    reviewed.choices.map((choice) => choice.toUpperCase()),
    reviewed.choices.map((choice) => `${choice} `)]) {
    const input = completeWithReviewedChoices();
    input.analysisFields.find((field) => field.name === 'caller_intent').choices = choices;
    const result = compareFreeTestProviderMetadata(input, reviewed);
    assert.equal(result.metadataMatches, false);
    assert.deepEqual(result.mismatchedEnumFields, ['caller_intent']);
    assert.deepEqual(result.gaps, ['ANALYSIS_ENUM_VALUES_MISMATCH']);
    assert.equal(result.callerIntentValueContract, 'reviewed_export_enum_mismatch');
  }
  const reordered = completeWithReviewedChoices();
  reordered.analysisFields.find((field) => field.name === 'caller_intent').choices.reverse();
  assert.equal(compareFreeTestProviderMetadata(reordered, reviewed).metadataMatches, true);
});

test('missing observed caller-intent choices remain unverified despite a reviewed contract', () => {
  for (const choices of [undefined, null, 'not_an_array']) {
    const input = completeWithReviewedChoices();
    input.analysisFields.find((field) => field.name === 'caller_intent').choices = choices;
    const result = compareFreeTestProviderMetadata(input, reviewedContract());
    assert.equal(result.metadataMatches, false);
    assert.deepEqual(result.unverifiedEnumFields, ['caller_intent']);
    assert.deepEqual(result.gaps, ['ANALYSIS_ENUM_VALUES_UNVERIFIED']);
    assert.equal(result.callerIntentValueContract, 'reviewed_export_enum_provider_choices_unverified');
  }
});

test('missing, malformed or non-closed reviewed contracts preserve the unknown gate', () => {
  const valid = reviewedContract();
  const invalid = [undefined, null, [], 'unreviewed', new Date(),
    ...Object.keys(valid).map((key) => { const value = { ...valid }; delete value[key]; return value; }),
    { ...valid, extra: 'SYNTHETIC_PRIVATE_EXTRA' }, { ...valid, [Symbol('extra')]: true },
    Object.assign(Object.create({ inherited: true }), valid),
    { ...valid, schemaVersion: 2 }, { ...valid, evidenceClass: 'live_verified' },
    ...['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), 123].map((sourceSha256) => ({ ...valid, sourceSha256 })),
    ...[[], Array(1), null, 'not_an_array', ['duplicate', 'duplicate'], [''], [' leading'], ['trailing '],
      ['control\ncharacter'], ['delete\u007fcharacter'], ['x'.repeat(161)], [123], [null]]
      .map((choices) => ({ ...valid, choices })),
  ];
  for (const reviewed of invalid) {
    const result = compareFreeTestProviderMetadata(completeWithReviewedChoices(), reviewed);
    assert.equal(result.metadataMatches, false);
    assert.deepEqual(result.gaps, ['CALLER_INTENT_VALUE_CONTRACT_UNVERIFIED']);
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_EXTRA'), false);
  }
});

test('a valid reviewed contract cannot bypass any independent metadata gate', () => {
  const mutations = [
    [(x) => x.analysisFields.pop(), 'ANALYSIS_FIELDS_MISSING'],
    [(x) => x.analysisFields.push(x.analysisFields[0]), 'ANALYSIS_FIELDS_DUPLICATE'],
    [(x) => x.analysisFields.push({ name: 'unknown', type: 'string' }), 'ANALYSIS_FIELDS_UNEXPECTED'],
    [(x) => { x.analysisFields[11].type = 'string'; }, 'ANALYSIS_TYPES_MISMATCH'],
    [(x) => { x.analysisFields[0].choices = []; }, 'ANALYSIS_ENUM_VALUES_MISMATCH'],
    [(x) => x.variableNames.pop(), 'VARIABLE_CONTRACT_MISMATCH'],
    [(x) => x.webhookEvents.push('call_started'), 'EVENT_SUBSCRIPTIONS_MISMATCH'],
    [(x) => { x.webhookTimeoutMs = 10; }, 'WEBHOOK_TIMEOUT_MISMATCH'],
    ...Object.entries({ endpointMatchesApprovedBinding: 'WEBHOOK_BINDING_UNVERIFIED',
      publishedVersionMatchesApprovedBinding: 'VERSION_BINDING_UNVERIFIED',
      phoneMachineReadbackComplete: 'PHONE_BINDING_UNVERIFIED',
      dataHandlingMatchesApprovedScope: 'DATA_HANDLING_UNVERIFIED' })
      .map(([key, gap]) => [(x) => { delete x[key]; }, gap]),
  ];
  for (const [mutate, expectedGap] of mutations) {
    const input = completeWithReviewedChoices(); mutate(input);
    const result = compareFreeTestProviderMetadata(input, reviewedContract());
    assert.equal(result.metadataMatches, false);
    assert.ok(result.gaps.includes(expectedGap));
    assert.equal(result.actionAuthorized, false);
    assert.equal(result.liveExecutionVerified, false);
  }
});
