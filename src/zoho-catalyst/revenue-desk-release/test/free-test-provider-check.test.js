'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ANALYSIS_TYPES, ANALYSIS_ENUMS, compareFreeTestProviderMetadata } = require('../lib/free-test-provider-check');
const contract = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json');

function complete() {
  return {
    analysisFields: Object.entries(ANALYSIS_TYPES).map(([name, type]) => ({ name, type,
      ...(ANALYSIS_ENUMS[name] ? { choices: [...ANALYSIS_ENUMS[name]] } : {}) })),
    variableNames: [...contract.retell_conversation_variable_fields],
    webhookEvents: ['call_ended', 'call_analyzed'], webhookTimeoutMs: 10000,
    endpointMatchesApprovedBinding: true, publishedVersionMatchesApprovedBinding: true,
    phoneMachineReadbackComplete: true, dataHandlingMatchesApprovedScope: true,
  };
}

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
