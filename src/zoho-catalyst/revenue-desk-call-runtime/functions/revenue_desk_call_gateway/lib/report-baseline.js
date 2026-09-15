'use strict';

// Stored reporting evidence only. This validator neither captures CRM data nor
// authenticates source claims; the immutable configuration binds the snapshot.
const { invariant } = require('./errors');
const { COVERAGE_MODES } = require('./contracts');

const SNAPSHOT_FIELDS = Object.freeze([
  'schemaVersion', 'clientKey', 'deploymentKey', 'configurationVersionId', 'configurationVersion',
  'environment', 'coverageMode', 'capturedAt', 'sourceModifiedAt', 'sourcePeriod',
  'evidenceClass', 'provenanceStatus', 'comparisonStatus', 'currency', 'values',
]);
const VALUE_FIELDS = Object.freeze([
  'currentCallHandling', 'monthlyInboundCalls', 'monthlyInboundCallBand', 'afterHoursCallBand',
  'afterHoursCallShare', 'estimatedUnansweredCallRate', 'averageJobValueMinorUnits',
  'averageJobValueBand', 'currentMonthlyAnsweringCostMinorUnits',
]);
const CHOICES = Object.freeze({
  currentCallHandling: new Set(['Office Staff / Dispatcher', 'Owner / Technician Cell', 'Voicemail',
    'Phone Menu / IVR', 'Human Answering Service', 'Existing AI Receptionist', 'Mixed', 'Unknown']),
  monthlyInboundCallBand: new Set(['Under 20', '20-49', '50-99', '100-249', '250+', 'Unknown']),
  afterHoursCallBand: new Set(['None', '1-9', '10-24', '25-49', '50+', 'Unknown']),
  averageJobValueBand: new Set(['Under $250', '$250-$499', '$500-$999', '$1,000-$2,499', '$2,500+', 'Unknown']),
});

function valid(condition) {
  invariant(condition, 'INVALID_SCHEMA', 'Stored report baseline is invalid.');
}

function exact(value, fields) {
  valid(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === fields.length
    && Reflect.ownKeys(value).every((field) => typeof field === 'string' && fields.includes(field)));
}

function instant(value) {
  valid(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value));
  const epoch = Date.parse(value);
  valid(Number.isFinite(epoch) && new Date(epoch).toISOString() === value);
  return epoch;
}

function identifier(value, maximum = 128) {
  valid(typeof value === 'string' && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value));
}

/** Validate a normalized immutable snapshot, preserving nulls and exact ranges.
 * configurationVersion is the CRM label, not the physical configurationVersionId.
 * Optional expected ownership keys belong to a caller that independently derives
 * them; this pure validator never guesses a physical row or HMAC partition.
 */
function validateReportBaseline(input, expected = {}) {
  exact(input, SNAPSHOT_FIELDS);
  exact(input.values, VALUE_FIELDS);
  exact(input.sourcePeriod, ['start', 'end']);
  valid(input.schemaVersion === 1 && input.environment === 'development'
    && input.provenanceStatus === 'locally_consistent_not_authenticated'
    && input.comparisonStatus === 'context_only_not_before_after_proof'
    && ['customer_supplied_estimate', 'verified_business_records'].includes(input.evidenceClass)
    && COVERAGE_MODES.has(input.coverageMode));
  for (const field of ['clientKey', 'deploymentKey']) {
    valid(typeof input[field] === 'string' && /^[a-f0-9]{64}$/.test(input[field]));
  }
  valid(input.clientKey !== input.deploymentKey);
  identifier(input.configurationVersionId);
  identifier(input.configurationVersion, 100);
  for (const field of ['clientKey', 'deploymentKey', 'configurationVersionId',
    'configurationVersion', 'coverageMode']) {
    if (Object.hasOwn(expected, field)) valid(input[field] === expected[field]);
  }
  const captured = instant(input.capturedAt);
  valid(instant(input.sourceModifiedAt) <= captured
    && instant(input.sourcePeriod.start) < instant(input.sourcePeriod.end)
    && instant(input.sourcePeriod.end) <= captured);
  for (const [field, choices] of Object.entries(CHOICES)) {
    valid(input.values[field] === null || choices.has(input.values[field]));
  }
  for (const [field, maximum] of [
    ['monthlyInboundCalls', 999999999], ['averageJobValueMinorUnits', 99999999999],
    ['currentMonthlyAnsweringCostMinorUnits', 99999999999],
  ]) {
    const value = input.values[field];
    valid(value === null || (Number.isSafeInteger(value) && value >= 0 && value <= maximum));
  }
  for (const field of ['afterHoursCallShare', 'estimatedUnansweredCallRate']) {
    const value = input.values[field];
    valid(value === null || (typeof value === 'number' && Number.isFinite(value)
      && value >= 0 && value <= 100 && /^\d+(?:\.\d{1,2})?$/.test(String(value))));
  }
  const hasAmount = input.values.averageJobValueMinorUnits !== null
    || input.values.currentMonthlyAnsweringCostMinorUnits !== null;
  valid(input.currency === (hasAmount ? 'USD' : null));
  return Object.freeze({ ...input,
    sourcePeriod: Object.freeze({ ...input.sourcePeriod }),
    values: Object.freeze({ ...input.values }),
  });
}

module.exports = { validateReportBaseline };
