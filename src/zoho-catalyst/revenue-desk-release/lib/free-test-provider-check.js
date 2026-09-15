'use strict';

const contract = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json');

const ANALYSIS_TYPES = Object.freeze({
  outcome: 'enum', coverage_trigger: 'enum', caller_name: 'string',
  callback_number: 'string', customer_type: 'enum', caller_intent: 'enum',
  issue_summary: 'string', city_or_zip: 'string', urgency: 'enum',
  specific_person_requested: 'string', sensitive_data_detected: 'boolean',
  bookable_opportunity: 'boolean', office_follow_up_required: 'boolean',
  workflow_failure_code: 'string', workflow_failure_text: 'string',
});
const ANALYSIS_ENUMS = Object.freeze({
  outcome: Object.freeze(contract.outcomes.map(({ value }) => value)),
  coverage_trigger: Object.freeze([...contract.coverage_triggers]),
  customer_type: Object.freeze([...contract.customer_types]),
  urgency: Object.freeze([...contract.urgencies]),
});

function exactChoices(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((value) => actual.includes(value));
}

function reviewedCallerIntentChoices(reviewed) {
  if (!reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(reviewed))) return null;
  const keys = ['schemaVersion', 'evidenceClass', 'sourceSha256', 'choices'];
  if (!exactChoices(Reflect.ownKeys(reviewed), keys) || reviewed.schemaVersion !== 1
    || reviewed.evidenceClass !== 'reviewed_export_snapshot'
    || typeof reviewed.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(reviewed.sourceSha256)
    || !Array.isArray(reviewed.choices) || reviewed.choices.length === 0
    || new Set(reviewed.choices).size !== reviewed.choices.length
    || Array.from(reviewed.choices).some((value) => typeof value !== 'string' || value.length === 0
      || value.length > 160 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value))) return null;
  return reviewed.choices;
}

/** Compare an already-minimized metadata projection, never a raw provider export.
 * This is preparation evidence only: matching names/types cannot prove model
 * extraction, webhook delivery, privacy enforcement or telephone handling.
 * The optional expected caller-intent contract must be reviewed separately and
 * kept private. Its hash links that review to an export; this pure comparison
 * does not read the export, authenticate the review or prove live freshness.
 */
function compareFreeTestProviderMetadata(metadata, reviewedCallerIntentContract) {
  const gaps = [];
  const input = metadata && typeof metadata === 'object' ? metadata : {};
  const fields = Array.isArray(input.analysisFields) ? input.analysisFields : [];
  const variables = Array.isArray(input.variableNames) ? input.variableNames : [];
  const names = fields.map((field) => field?.name);
  const missing = contract.retell_custom_analysis_fields.filter((name) => !names.includes(name));
  if (missing.length) gaps.push('ANALYSIS_FIELDS_MISSING');
  if (new Set(names).size !== names.length) gaps.push('ANALYSIS_FIELDS_DUPLICATE');
  if (names.some((name) => !Object.hasOwn(ANALYSIS_TYPES, name))) gaps.push('ANALYSIS_FIELDS_UNEXPECTED');
  if (fields.some((field) => field?.type !== ANALYSIS_TYPES[field?.name])) gaps.push('ANALYSIS_TYPES_MISMATCH');
  const unverifiedEnums = [];
  const mismatchedEnums = [];
  const callerIntentChoices = reviewedCallerIntentChoices(reviewedCallerIntentContract);
  const enumContracts = { ...ANALYSIS_ENUMS,
    ...(callerIntentChoices ? { caller_intent: callerIntentChoices } : {}) };
  for (const [name, expected] of Object.entries(enumContracts)) {
    const field = fields.find((candidate) => candidate?.name === name);
    if (!field || !Array.isArray(field.choices)) unverifiedEnums.push(name);
    else if (!exactChoices(field.choices, expected)) mismatchedEnums.push(name);
  }
  if (unverifiedEnums.length) gaps.push('ANALYSIS_ENUM_VALUES_UNVERIFIED');
  if (mismatchedEnums.length) gaps.push('ANALYSIS_ENUM_VALUES_MISMATCH');
  // Do not infer an expected set from the very metadata being checked or turn
  // a provider's reviewed enum into a new closed backend text contract.
  let callerIntentValueContract = 'bounded_text_runtime_only_provider_enum_unverified';
  if (!callerIntentChoices) gaps.push('CALLER_INTENT_VALUE_CONTRACT_UNVERIFIED');
  else if (unverifiedEnums.includes('caller_intent')) {
    callerIntentValueContract = 'reviewed_export_enum_provider_choices_unverified';
  } else if (mismatchedEnums.includes('caller_intent')) {
    callerIntentValueContract = 'reviewed_export_enum_mismatch';
  } else callerIntentValueContract = 'reviewed_export_enum_match';
  if (variables.length !== contract.retell_conversation_variable_fields.length
    || new Set(variables).size !== variables.length
    || contract.retell_conversation_variable_fields.some((name) => !variables.includes(name))) {
    gaps.push('VARIABLE_CONTRACT_MISMATCH');
  }
  if (!Array.isArray(input.webhookEvents) || input.webhookEvents.length !== 2
    || !input.webhookEvents.includes('call_ended') || !input.webhookEvents.includes('call_analyzed')) {
    gaps.push('EVENT_SUBSCRIPTIONS_MISMATCH');
  }
  if (input.webhookTimeoutMs !== 10000) gaps.push('WEBHOOK_TIMEOUT_MISMATCH');
  if (input.endpointMatchesApprovedBinding !== true) gaps.push('WEBHOOK_BINDING_UNVERIFIED');
  if (input.publishedVersionMatchesApprovedBinding !== true) gaps.push('VERSION_BINDING_UNVERIFIED');
  if (input.phoneMachineReadbackComplete !== true) gaps.push('PHONE_BINDING_UNVERIFIED');
  if (input.dataHandlingMatchesApprovedScope !== true) gaps.push('DATA_HANDLING_UNVERIFIED');
  return Object.freeze({
    evidenceClass: 'local_comparison_of_supplied_metadata',
    requiredAnalysisCount: contract.retell_custom_analysis_fields.length,
    observedAnalysisCount: fields.length,
    missingAnalysisFields: Object.freeze(missing),
    unverifiedEnumFields: Object.freeze(unverifiedEnums),
    mismatchedEnumFields: Object.freeze(mismatchedEnums),
    callerIntentValueContract,
    gaps: Object.freeze(gaps),
    metadataMatches: gaps.length === 0,
    liveExecutionVerified: false,
    actionAuthorized: false,
  });
}

module.exports = { ANALYSIS_TYPES, ANALYSIS_ENUMS, compareFreeTestProviderMetadata };
