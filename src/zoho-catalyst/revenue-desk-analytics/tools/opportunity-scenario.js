'use strict';

const { createHash } = require('node:crypto');
const { canonicalJson } = require('../functions/analytics_sync/lib/facts');
const { SCOPE_FIELDS } = require('./opportunity-value');

const HASH = /^[a-f0-9]{64}$/;
const RATE_DENOMINATOR = 10_000;
const METHOD_ID = 'reviewed-opportunity-scenario';
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

function requireCondition(condition, code) {
  if (!condition) { const error = new Error(code); error.code = code; throw error; }
}

function exactObject(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}

function validInstant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validateCohort(cohort) {
  requireCondition(exactObject(cohort, ['scope', 'period', 'currency', 'callRowsetDigest', 'qualifiedCalls']),
    'SCENARIO_COHORT_REQUIRED');
  const { scope, period, currency, qualifiedCalls } = cohort;
  requireCondition(exactObject(scope, SCOPE_FIELDS)
    && typeof scope.CLIENT_KEY === 'string' && HASH.test(scope.CLIENT_KEY)
    && typeof scope.DEPLOYMENT_KEY === 'string' && HASH.test(scope.DEPLOYMENT_KEY)
    && typeof scope.CONFIGURATION_VERSION === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(scope.CONFIGURATION_VERSION)
    && ['development', 'production'].includes(scope.ENVIRONMENT)
    && ['free_test', 'paid_service'].includes(scope.ENGAGEMENT_TYPE)
    && typeof scope.SOURCE_REVISION === 'string' && /^[a-f0-9]{40}$/.test(scope.SOURCE_REVISION),
  'SCENARIO_SCOPE_INVALID');
  requireCondition(exactObject(period, ['startAtUtc', 'endAtUtc'])
    && validInstant(period.startAtUtc) && validInstant(period.endAtUtc)
    && period.startAtUtc <= period.endAtUtc, 'SCENARIO_PERIOD_INVALID');
  requireCondition(exactObject(currency, ['code', 'minorUnitDigits'])
    && CURRENCIES.has(currency.code) && Number.isInteger(currency.minorUnitDigits)
    && currency.minorUnitDigits === new Intl.NumberFormat('en', {
      style: 'currency', currency: currency.code,
    }).resolvedOptions().maximumFractionDigits, 'SCENARIO_CURRENCY_INVALID');
  requireCondition(typeof cohort.callRowsetDigest === 'string' && HASH.test(cohort.callRowsetDigest)
    && Array.isArray(qualifiedCalls), 'SCENARIO_COHORT_INVALID');
  const calls = new Map();
  for (const call of qualifiedCalls) {
    requireCondition(exactObject(call, [...SCOPE_FIELDS, 'CALL_KEY', 'STARTED_AT', 'SOURCE_MODIFIED_AT',
      'HANDLED_RECORDED', 'OUTCOME', 'requestKind', 'sourceVersion']), 'SCENARIO_CALL_INVALID');
    requireCondition(SCOPE_FIELDS.every((field) => call[field] === scope[field]), 'SCENARIO_SCOPE_CONFLICT');
    requireCondition(typeof call.CALL_KEY === 'string' && HASH.test(call.CALL_KEY)
      && !calls.has(call.CALL_KEY) && validInstant(call.STARTED_AT) && validInstant(call.SOURCE_MODIFIED_AT)
      && call.STARTED_AT >= period.startAtUtc && call.STARTED_AT <= period.endAtUtc
      && call.SOURCE_MODIFIED_AT >= call.STARTED_AT
      && call.HANDLED_RECORDED === true && ['potential_job', 'urgent_potential_job'].includes(call.OUTCOME)
      && ['new_service_request', 'existing_job_follow_up', 'unknown'].includes(call.requestKind)
      && Number.isSafeInteger(call.sourceVersion) && call.sourceVersion > 0, 'SCENARIO_CALL_INVALID');
    calls.set(call.CALL_KEY, call);
  }
  return calls;
}

/** Review binding for a producer-verified cohort; a digest is not authentication.
 * Unlike the Analytics rowset digest, this also binds canonical request kinds,
 * source versions, the explicit reporting period and reporting currency.
 */
function scenarioCohortDigest(cohort) {
  validateCohort(cohort);
  // The shared fact serializer sorts flat fields only; normalize each nested
  // flat projection as well so property insertion order cannot invalidate review.
  const ordered = (value) => Object.fromEntries(Object.keys(value).sort().map((field) => [field, value[field]]));
  return createHash('sha256').update(canonicalJson({ ...cohort,
    scope: ordered(cohort.scope), period: ordered(cohort.period), currency: ordered(cohort.currency),
    qualifiedCalls: cohort.qualifiedCalls.slice().sort((a, b) => a.CALL_KEY.localeCompare(b.CALL_KEY)).map(ordered),
  })).digest('hex');
}

/** Pure, source-only scenario calculation. See opportunity-scenario.md for the
 * required trusted producer boundary, which is not implemented by this helper.
 */
function buildOpportunityScenario(input) {
  requireCondition(exactObject(input, ['cohort', 'evidence', 'assumptions']), 'SCENARIO_INPUT_INVALID');
  const { cohort, evidence, assumptions } = input;
  const calls = validateCohort(cohort);
  requireCondition(exactObject(assumptions, ['bookingRateBasisPoints', 'averageJobValueMinorUnits', 'currency'])
    && Number.isSafeInteger(assumptions.bookingRateBasisPoints)
    && assumptions.bookingRateBasisPoints >= 0 && assumptions.bookingRateBasisPoints <= RATE_DENOMINATOR
    && Number.isSafeInteger(assumptions.averageJobValueMinorUnits)
    && assumptions.averageJobValueMinorUnits >= 0, 'SCENARIO_ASSUMPTIONS_INVALID');
  requireCondition(assumptions.currency === cohort.currency.code, 'SCENARIO_CURRENCY_CONFLICT');
  let eligibleGroupCount = 0;
  let unknownGroupCount = 0;
  let followUpOnlyGroupCount = 0;
  const groupKeys = new Set();
  const members = new Set();
  if (evidence !== null) {
    requireCondition(exactObject(evidence, ['schemaVersion', 'cohortDigest', 'review', 'groups'])
      && evidence.schemaVersion === 1, 'SCENARIO_EVIDENCE_INVALID');
    requireCondition(evidence.cohortDigest === scenarioCohortDigest(cohort), 'SCENARIO_COHORT_CONFLICT');
    requireCondition(exactObject(evidence.review, ['status', 'reviewedAt', 'reviewerReference'])
      && evidence.review.status === 'reviewed' && validInstant(evidence.review.reviewedAt)
      && evidence.review.reviewedAt >= cohort.period.endAtUtc
      && cohort.qualifiedCalls.every((call) => call.SOURCE_MODIFIED_AT <= evidence.review.reviewedAt)
      && typeof evidence.review.reviewerReference === 'string' && HASH.test(evidence.review.reviewerReference),
    'SCENARIO_REVIEW_INVALID');
    requireCondition(Array.isArray(evidence.groups), 'SCENARIO_GROUP_INVALID');
    for (const group of evidence.groups) {
      requireCondition(exactObject(group, ['groupKey', 'callKeys', 'reviewStatus'])
        && typeof group.groupKey === 'string' && HASH.test(group.groupKey) && !groupKeys.has(group.groupKey)
        && Array.isArray(group.callKeys) && group.callKeys.length > 0
        && ['qualified', 'incomplete'].includes(group.reviewStatus), 'SCENARIO_GROUP_INVALID');
      groupKeys.add(group.groupKey);
      const kinds = [];
      for (const key of group.callKeys) {
        requireCondition(calls.has(key), 'SCENARIO_MEMBER_INVALID');
        requireCondition(!members.has(key), 'SCENARIO_MEMBER_DUPLICATE');
        members.add(key);
        kinds.push(calls.get(key).requestKind);
      }
      // A repeat follow-up cannot create another opportunity. Unknown intent
      // makes the whole reviewed group uncertain, even if another member is new.
      if (group.reviewStatus === 'incomplete' || kinds.includes('unknown')) unknownGroupCount += 1;
      else if (kinds.includes('new_service_request')) eligibleGroupCount += 1;
      else followUpOnlyGroupCount += 1;
    }
  }
  const ungroupedQualifiedCallCount = calls.size - members.size;
  // Ungrouped calls might belong to existing groups; never invent distinct jobs
  // or calculate against a potentially incomplete deduplication review.
  const available = evidence !== null && ungroupedQualifiedCallCount === 0
    && (eligibleGroupCount > 0 || unknownGroupCount === 0);
  let formula = null;
  let expectedBookings = null;
  let scenarioGrossValueMinorUnits = null;
  if (available) {
    const denominator = BigInt(RATE_DENOMINATOR);
    const bookingsNumerator = BigInt(eligibleGroupCount) * BigInt(assumptions.bookingRateBasisPoints);
    const grossNumerator = bookingsNumerator * BigInt(assumptions.averageJobValueMinorUnits);
    // Round the aggregate once, half up, to one currency minor unit. BigInt
    // protects intermediates; public numeric outputs must remain safe integers.
    const roundedGross = (grossNumerator + denominator / 2n) / denominator;
    requireCondition(bookingsNumerator <= BigInt(Number.MAX_SAFE_INTEGER)
      && roundedGross <= BigInt(Number.MAX_SAFE_INTEGER), 'SCENARIO_TOTAL_OVERFLOW');
    expectedBookings = Number(bookingsNumerator) / RATE_DENOMINATOR;
    scenarioGrossValueMinorUnits = Number(roundedGross);
    formula = Object.freeze({ eligibleGroupCount, bookingRateBasisPoints: assumptions.bookingRateBasisPoints,
      averageJobValueMinorUnits: assumptions.averageJobValueMinorUnits,
      expectedBookingsNumerator: bookingsNumerator.toString(), expectedBookingsDenominator: RATE_DENOMINATOR,
      grossValueNumeratorMinorUnits: grossNumerator.toString(), grossValueDenominator: RATE_DENOMINATOR,
      moneyRounding: 'half_up_once_to_minor_unit' });
  }
  return Object.freeze({ schemaVersion: 1, methodId: METHOD_ID, label: 'Opportunity scenario',
    status: !available ? 'not_available' : (unknownGroupCount > 0 ? 'partial' : 'complete'),
    scope: Object.freeze({ ...cohort.scope }), period: Object.freeze({ ...cohort.period }),
    currency: Object.freeze({ ...cohort.currency }), assumptions: Object.freeze({ ...assumptions }),
    qualifiedCallCount: calls.size, reviewedGroupCount: groupKeys.size, eligibleGroupCount,
    unknownGroupCount, followUpOnlyGroupCount, ungroupedQualifiedCallCount,
    expectedBookings, scenarioGrossValueMinorUnits, formula,
    limitation: 'Caller-assumed scenario for reviewed eligible groups only. Fractional expected bookings are expectations, not actual bookings or completed jobs. Gross value is not recovered revenue, collected revenue, profit or ROI. Unknown groups are excluded.',
  });
}

module.exports = { buildOpportunityScenario, scenarioCohortDigest, METHOD_ID };
