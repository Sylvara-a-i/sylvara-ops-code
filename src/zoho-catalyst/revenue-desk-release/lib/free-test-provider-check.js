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

/** Compare an already-minimized metadata projection, never a raw provider export.
 * This is preparation evidence only: matching names/types cannot prove model
 * extraction, webhook delivery, privacy enforcement or telephone handling.
 */
function compareFreeTestProviderMetadata(metadata) {
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
  for (const [name, expected] of Object.entries(ANALYSIS_ENUMS)) {
    const field = fields.find((candidate) => candidate?.name === name);
    if (!field || !Array.isArray(field.choices)) unverifiedEnums.push(name);
    else if (!exactChoices(field.choices, expected)) mismatchedEnums.push(name);
  }
  if (unverifiedEnums.length) gaps.push('ANALYSIS_ENUM_VALUES_UNVERIFIED');
  if (mismatchedEnums.length) gaps.push('ANALYSIS_ENUM_VALUES_MISMATCH');
  // The canonical runtime accepts bounded caller-intent text, but the
  // historical provider field was an enum with no authoritative complete
  // choice set. Do not invent that set or turn matching field names into a
  // claim that the complete provider schema has been verified.
  gaps.push('CALLER_INTENT_VALUE_CONTRACT_UNVERIFIED');
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
    callerIntentValueContract: 'bounded_text_runtime_only_provider_enum_unverified',
    gaps: Object.freeze(gaps),
    metadataMatches: gaps.length === 0,
    liveExecutionVerified: false,
    actionAuthorized: false,
  });
}

module.exports = { ANALYSIS_TYPES, ANALYSIS_ENUMS, compareFreeTestProviderMetadata };
