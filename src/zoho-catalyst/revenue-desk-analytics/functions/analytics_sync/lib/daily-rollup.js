'use strict';

const { invariant } = require('./errors');
const { canonicalJson, minimizeFact, sha256 } = require('./facts');

const QUALIFIED_OUTCOMES = new Set(['potential_job', 'urgent_potential_job']);
const WRONG_FIT_OUTCOMES = new Set(['unsupported_service', 'out_of_area']);
const UNRESOLVED_OUTCOMES = new Set([
  'unresolved', 'configuration_failure', 'caller_abandoned',
]);
const URGENT_CLASSES = new Set(['urgent', 'immediate_danger']);

function sameOwnership(left, right) {
  return left.CLIENT_KEY === right.CLIENT_KEY
    && left.DEPLOYMENT_KEY === right.DEPLOYMENT_KEY
    && left.CONFIGURATION_VERSION === right.CONFIGURATION_VERSION
    && left.ENGAGEMENT_TYPE === right.ENGAGEMENT_TYPE
    && left.ENVIRONMENT === right.ENVIRONMENT;
}

function deduplicateCalls(candidates) {
  invariant(Array.isArray(candidates), 'ROLLUP_INVALID', 'Daily rollup calls must be an array.');
  const byCall = new Map();
  for (const candidate of candidates) {
    const call = minimizeFact('call', candidate);
    const existing = byCall.get(call.CALL_KEY);
    if (!existing) {
      byCall.set(call.CALL_KEY, call);
      continue;
    }
    invariant(sameOwnership(existing, call), 'ROLLUP_OWNERSHIP_CONFLICT',
      'Corrected call fact crosses its immutable partition.');
    const order = call.SOURCE_MODIFIED_AT.localeCompare(existing.SOURCE_MODIFIED_AT);
    if (order > 0) byCall.set(call.CALL_KEY, call);
    else if (order === 0) invariant(canonicalJson(call) === canonicalJson(existing),
      'ROLLUP_CORRECTION_CONFLICT', 'Call facts conflict at the same source watermark.');
  }
  return [...byCall.values()].sort((left, right) => left.CALL_KEY.localeCompare(right.CALL_KEY));
}

function buildDailyMetricFact(options) {
  const {
    calls,
    reportingDateUtc,
    clientKey,
    deploymentKey,
    configurationVersion,
    engagementType,
    environment,
    metricVersion,
    sourceRevision,
    sourceModifiedAt = null,
  } = options || {};
  invariant(/^\d{4}-\d{2}-\d{2}$/.test(reportingDateUtc || ''),
    'ROLLUP_INVALID', 'Daily rollup UTC date is invalid.');
  const unique = deduplicateCalls(calls);
  for (const call of unique) {
    invariant(call.CLIENT_KEY === clientKey && call.DEPLOYMENT_KEY === deploymentKey
      && call.CONFIGURATION_VERSION === configurationVersion
      && call.ENGAGEMENT_TYPE === engagementType && call.ENVIRONMENT === environment,
    'ROLLUP_OWNERSHIP_CONFLICT', 'Daily rollup crosses an immutable partition.');
    invariant(call.STARTED_AT.slice(0, 10) === reportingDateUtc,
      'ROLLUP_DATE_CONFLICT', 'Daily rollup contains a call from another UTC date.');
  }
  const handled = unique.filter((call) => call.HANDLED_RECORDED);
  const latestCallWatermark = unique.reduce((latest, call) => (
    call.SOURCE_MODIFIED_AT > latest ? call.SOURCE_MODIFIED_AT : latest
  ), '');
  const watermark = latestCallWatermark || sourceModifiedAt;
  invariant(typeof watermark === 'string', 'ROLLUP_INVALID',
    'An empty daily rollup requires an explicit source watermark.');
  if (sourceModifiedAt) invariant(sourceModifiedAt >= latestCallWatermark,
    'ROLLUP_INVALID', 'Daily rollup watermark precedes a call correction.');
  const evidenceComplete = (field) => handled.every((call) => typeof call[field] === 'boolean');
  const bookableComplete = evidenceComplete('BOOKABLE_OPPORTUNITY');
  const followUpComplete = evidenceComplete('OFFICE_FOLLOW_UP_REQUIRED');
  const recordKey = sha256([
    'revenue-desk-daily-metric-v1', environment, clientKey, deploymentKey,
    configurationVersion, reportingDateUtc, metricVersion,
  ].join('\0'));
  const fact = {
    SCHEMA_VERSION: 1,
    METRIC_VERSION: metricVersion,
    RECORD_KEY: recordKey,
    CLIENT_KEY: clientKey,
    DEPLOYMENT_KEY: deploymentKey,
    CONFIGURATION_VERSION: configurationVersion,
    ENGAGEMENT_TYPE: engagementType,
    ENVIRONMENT: environment,
    SOURCE_MODIFIED_AT: watermark,
    SOURCE_REVISION: sourceRevision,
    REPORTING_DATE_UTC: reportingDateUtc,
    TOTAL_CALLS_HANDLED: handled.length,
    QUALIFIED_OPPORTUNITIES: handled.filter((call) => QUALIFIED_OUTCOMES.has(call.OUTCOME)).length,
    URGENT_REQUESTS: handled.filter((call) => URGENT_CLASSES.has(call.URGENCY_CLASS)).length,
    EXISTING_CUSTOMER_CALLS: handled.filter((call) => call.OUTCOME === 'existing_customer').length,
    WRONG_FIT_CALLS: handled.filter((call) => WRONG_FIT_OUTCOMES.has(call.OUTCOME)).length,
    SPAM_CALLS: handled.filter((call) => call.OUTCOME === 'spam').length,
    UNRESOLVED_CALLS: handled.filter((call) => UNRESOLVED_OUTCOMES.has(call.OUTCOME)).length,
    ...(bookableComplete ? {
      BOOKABLE_OPPORTUNITIES: handled.filter((call) => call.BOOKABLE_OPPORTUNITY).length,
    } : {}),
    ...(followUpComplete ? {
      OFFICE_FOLLOW_UP_CALLS: handled.filter((call) => call.OFFICE_FOLLOW_UP_REQUIRED).length,
    } : {}),
  };
  return minimizeFact('daily_metric', fact);
}

module.exports = {
  buildDailyMetricFact, deduplicateCalls, QUALIFIED_OUTCOMES, UNRESOLVED_OUTCOMES,
  URGENT_CLASSES, WRONG_FIT_OUTCOMES,
};
