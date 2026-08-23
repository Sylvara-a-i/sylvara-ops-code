'use strict';

const { COVERAGE_TRIGGERS, VALUE_EVIDENCE_CLASSES } = require('./contracts');
const { invariant } = require('./errors');
const { optionalString, integer, e164, validateOutcome } = require('./validation');

function text(value, name, maximum) {
  return optionalString(value, name, { maximum });
}

function containsObviousSensitiveData(values) {
  const joined = values.filter((value) => typeof value === 'string').join(' ');
  return /\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/.test(joined)
    || /\b(?:[0-9][ -]?){13,19}\b/.test(joined)
    || /\b(?:ssn|social security(?: number)?|bank routing|routing number|bank account|account number)\b\s*(?:is|:)?\s*(?:[0-9][ -]?){4,}/i.test(joined)
    || /\b(?:password|passcode|authentication code|verification code|one[- ]time code|otp|government id|driver'?s license|passport number|state id)\b\s*(?:is|:)?\s*[A-Za-z0-9-]{4,}/i.test(joined)
    || /\b(?:medical|diagnosis|diagnosed|health condition|patient|medication|prescription)\b/i.test(joined);
}

function isHighConfidencePaymentCard(value) {
  if (typeof value !== 'string') return false;
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length < 13 || digits.length > 19
    || !/^(?:4|3[47]|5[1-5]|2(?:2[2-9]|[3-6][0-9]|7[01]|720)|6(?:011|5)|35)/.test(digits)) return false;
  let sum = 0;
  let doubled = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubled) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubled = !doubled;
  }
  return sum % 10 === 0;
}

function validateValueEvidence(data, documentedMethods = new Set(), source = 'retell') {
  const evidenceClass = data.value_evidence_class || 'unknown';
  invariant(VALUE_EVIDENCE_CLASSES.has(evidenceClass), 'INVALID_ANALYSIS', 'Value evidence class is invalid.');
  const allowlist = {
    retell: new Set(['unknown', 'customer_supplied_estimate']),
    verified_downstream: new Set(['unknown', 'confirmed_revenue', 'booked_revenue']),
    server_method: new Set(['unknown', 'internal_estimate_with_method']),
  };
  invariant(allowlist[source]?.has(evidenceClass), 'UNAUTHORIZED_VALUE_EVIDENCE',
    'Value evidence class is not authorized for this source.');
  const supplied = data.value_minor_units !== undefined && data.value_minor_units !== null;
  const valueMinorUnits = supplied ? integer(data.value_minor_units, 'value_minor_units', 0, 1_000_000_000) : null;
  const currency = supplied ? text(data.value_currency, 'value_currency', 3) : null;
  if (currency) invariant(/^[A-Z]{3}$/.test(currency), 'INVALID_ANALYSIS', 'Value currency is invalid.');
  const methodId = text(data.value_method_id, 'value_method_id', 100);
  const methodVersion = text(data.value_method_version, 'value_method_version', 100);
  if (evidenceClass === 'unknown') invariant(!supplied && !methodId && !methodVersion,
    'INVALID_ANALYSIS', 'Unknown value cannot carry an estimate.');
  else invariant(supplied && currency, 'INVALID_ANALYSIS', 'Value evidence requires amount and currency.');
  if (evidenceClass === 'internal_estimate_with_method') invariant(methodId && methodVersion
    && documentedMethods.has(`${methodId}:${methodVersion}`), 'UNDOCUMENTED_VALUE_METHOD',
  'Internal estimate methodology is not documented.');
  else invariant(!methodId && !methodVersion, 'INVALID_ANALYSIS',
    'Method identifiers are reserved for documented internal estimates.');
  return Object.freeze({ evidenceClass, valueMinorUnits, currency, methodId, methodVersion });
}

function extractAnalysis(call, documentedMethods = new Set()) {
  const analysis = call?.call_analysis && typeof call.call_analysis === 'object' ? call.call_analysis : {};
  const data = analysis.custom_analysis_data && typeof analysis.custom_analysis_data === 'object'
    ? analysis.custom_analysis_data : {};
  const sensitive = data.sensitive_data_detected === true || data.outcome === 'sensitive_data_ended'
    || isHighConfidencePaymentCard(data.callback_number) || containsObviousSensitiveData([
      data.caller_name, data.caller_intent, data.issue_summary, data.city_or_zip,
      data.specific_person_requested,
    ]);
  if (sensitive) return Object.freeze({
    outcome: 'sensitive_data_ended',
    coverageTrigger: COVERAGE_TRIGGERS.has(data.coverage_trigger) ? data.coverage_trigger : 'Unknown',
    callerName: null, callbackNumber: null, customerType: 'unknown', callerIntent: null,
    issueSummary: null, cityOrZip: null, urgency: 'unknown', specificPersonRequested: null,
    value: Object.freeze({ evidenceClass: 'unknown', valueMinorUnits: null, currency: null,
      methodId: null, methodVersion: null }),
    sensitiveDataMinimized: true,
  });
  const outcome = validateOutcome(data.outcome || 'unresolved');
  const coverageTrigger = data.coverage_trigger || 'Unknown';
  invariant(COVERAGE_TRIGGERS.has(coverageTrigger), 'INVALID_ANALYSIS', 'Coverage trigger is invalid.');
  const callbackNumber = data.callback_number === undefined || data.callback_number === null
    || data.callback_number === '' ? null : e164(data.callback_number, 'callback_number');
  const customerType = data.customer_type || 'unknown';
  invariant(new Set(['new', 'existing', 'unknown']).has(customerType),
    'INVALID_ANALYSIS', 'Customer type is invalid.');
  const urgency = data.urgency || 'unknown';
  invariant(new Set(['routine', 'urgent', 'immediate_danger', 'unknown']).has(urgency),
    'INVALID_ANALYSIS', 'Urgency is invalid.');
  return Object.freeze({
    outcome, coverageTrigger, callerName: text(data.caller_name, 'caller_name', 120), callbackNumber,
    customerType, callerIntent: text(data.caller_intent, 'caller_intent', 160),
    issueSummary: text(data.issue_summary, 'issue_summary', 500),
    cityOrZip: text(data.city_or_zip, 'city_or_zip', 120), urgency,
    specificPersonRequested: text(data.specific_person_requested, 'specific_person_requested', 120),
    value: validateValueEvidence(data, documentedMethods), sensitiveDataMinimized: false,
  });
}

function triggerAllowedForMode(trigger, coverageMode) {
  if (trigger === 'Unknown') return true;
  if (coverageMode === 'AfterHoursOnly') return trigger === 'AfterHours';
  if (coverageMode === 'NoAnswerOverflowOnly') return trigger === 'NoAnswerOverflow';
  return coverageMode === 'AfterHoursAndOverflow'
    && (trigger === 'AfterHours' || trigger === 'NoAnswerOverflow');
}

function makeNotificationPayload(call) {
  return Object.freeze({
    callerName: call.callerName, callbackNumber: call.callbackNumber,
    customerType: call.customerType, cityOrZip: call.cityOrZip,
    issueSummary: call.issueSummary, urgency: call.urgency,
    specificPersonRequested: call.specificPersonRequested,
    callTimestamp: call.startedAt,
    callOutcome: call.outcome,
  });
}

module.exports = {
  extractAnalysis, validateValueEvidence, triggerAllowedForMode,
  makeNotificationPayload, isHighConfidencePaymentCard,
};
