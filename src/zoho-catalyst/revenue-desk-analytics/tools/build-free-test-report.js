'use strict';

const contract = require('../config/free-test-report-contract.json');
const { minimizeFact, canonicalJson, sha256 } = require('../functions/analytics_sync/lib/facts');
const runtimeContract = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json');
const { deduplicateCalls } = require('../functions/analytics_sync/lib/daily-rollup');
const { buildCrmReportBaseline } = require('../functions/analytics_sync/lib/crm-report-baseline');
const { evaluateFreeTestReportGate } = require('./evaluate-dashboard-pre-render-gate');

function requireCondition(condition, code) {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

function samePartition(left, right) {
  return ['CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION', 'ENVIRONMENT', 'ENGAGEMENT_TYPE']
    .every((key) => left[key] === right[key]);
}

const ratio = (value, divisor) => Number.isSafeInteger(value) ? value / divisor : null;
const STOP_REASONS = new Map([...runtimeContract.stop_reason_mappings,
  ...runtimeContract.rollback_control_reason_mappings].map((item) => [item.internal,
  item.crm_test_end_reason.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase()]));
// Analytics stores the runtime's closed PascalCase modes in snake_case. The
// CRM baseline must describe the same observed route, not a proposed next route.
const COVERAGE_FACT_VALUES = new Map(runtimeContract.canonical_coverage_modes
  .map((mode) => [mode, mode.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()]));

function factRowsetDigest(recordType, facts) {
  return readbackRowsetDigest(recordType, facts.map((fact) => {
    const value = minimizeFact(recordType, fact);
    return { RECORD_KEY: value.RECORD_KEY, PAYLOAD_HASH: sha256(canonicalJson(value)),
      SOURCE_MODIFIED_AT: value.SOURCE_MODIFIED_AT };
  }));
}

// This projection is derivable from the existing bounded Analytics readback;
// producing report evidence does not require exporting full live call rows.
function readbackRowsetDigest(recordType, rows) {
  requireCondition(['deployment', 'call', 'final_test_result'].includes(recordType)
    && Array.isArray(rows), 'REPORT_READBACK_INVALID');
  const projected = rows.map((row) => {
    requireCondition(row && /^[a-f0-9]{64}$/.test(row.RECORD_KEY)
      && /^[a-f0-9]{64}$/.test(row.PAYLOAD_HASH)
      && typeof row.SOURCE_MODIFIED_AT === 'string'
      && Number.isFinite(Date.parse(row.SOURCE_MODIFIED_AT)), 'REPORT_READBACK_INVALID');
    return { RECORD_KEY: row.RECORD_KEY, PAYLOAD_HASH: row.PAYLOAD_HASH,
      SOURCE_MODIFIED_AT: new Date(row.SOURCE_MODIFIED_AT).toISOString() };
  }).sort((a, b) => a.RECORD_KEY.localeCompare(b.RECORD_KEY));
  requireCondition(new Set(projected.map((row) => row.RECORD_KEY)).size === projected.length,
    'REPORT_READBACK_DUPLICATE');
  return sha256(`analytics-report-rowset-v1\0${recordType}\0${projected.map(canonicalJson).join('\n')}`);
}

/** Build a minimized operator-review report, never a send or an Analytics import.
 * Callers supply independently reconciled canonical facts and the CRM snapshot.
 * The gate is evidence validation, not authentication of caller-supplied evidence.
 */
function buildFreeTestReport(input, now = Date.now()) {
  requireCondition(input && typeof input === 'object', 'REPORT_INPUT_INVALID');
  const gate = evaluateFreeTestReportGate(contract.pre_render_gate,
    input.evidence, now, input.approval);
  requireCondition(gate.verdict === 'ready', 'REPORT_RECONCILIATION_REQUIRED');
  const deployment = minimizeFact('deployment', input.deployment);
  const final = minimizeFact('final_test_result', input.finalResult);
  const calls = deduplicateCalls(input.calls);
  const scope = input.evidence.scopes[0];
  requireCondition(samePartition(deployment, final)
    && deployment.ENVIRONMENT === 'development' && deployment.ENGAGEMENT_TYPE === 'free_test'
    && deployment.CLIENT_KEY === scope.CLIENT_KEY && deployment.DEPLOYMENT_KEY === scope.DEPLOYMENT_KEY
    && deployment.RECORD_KEY === deployment.DEPLOYMENT_KEY
    && final.RECORD_KEY === deployment.DEPLOYMENT_KEY, 'REPORT_OWNERSHIP_CONFLICT');
  requireCondition(calls.length === scope.source_call_count, 'REPORT_SOURCE_COUNT_MISMATCH');
  requireCondition(deployment.ACTUAL_START_AT === final.TEST_STARTED_AT
    && deployment.STOPPED_AT === final.TEST_ENDED_AT
    && STOP_REASONS.has(deployment.STOP_REASON)
    && STOP_REASONS.get(deployment.STOP_REASON) === final.TEST_END_REASON
    && ['completed', 'stopped', 'rolled_back', 'failed'].includes(deployment.DEPLOYMENT_STATUS)
    && final.TEST_ENDED_AT >= final.TEST_STARTED_AT, 'REPORT_NOT_TERMINAL');
  const approvedRevision = input.approval.approved_source_revision;
  // Bind the rendered values, not merely their totals, to the independently
  // read-back rowset. A recent checkpoint alone cannot authenticate a report.
  for (const [recordType, facts] of [['deployment', [deployment]], ['call', calls], ['final_test_result', [final]]]) {
    const readback = scope.analytics_readback.record_types[recordType];
    requireCondition(readback.rowset_digest === factRowsetDigest(recordType, facts), 'REPORT_ROWSET_MISMATCH');
    if (facts.length) {
      const latest = facts.reduce((value, fact) => fact.SOURCE_MODIFIED_AT > value ? fact.SOURCE_MODIFIED_AT : value, '');
      requireCondition(latest === readback.latest_source_modified_at
        && latest === scope.checkpoints[recordType].last_source_modified_at, 'REPORT_WATERMARK_MISMATCH');
    }
  }
  const supportedOutcomes = new Set(contract.outcome_groups.flatMap((group) => group.outcomes));
  for (const fact of [deployment, final, ...calls]) {
    requireCondition(samePartition(fact, deployment)
      && fact.SOURCE_REVISION === approvedRevision, 'REPORT_OWNERSHIP_CONFLICT');
    requireCondition(Date.parse(fact.SOURCE_MODIFIED_AT) <= now, 'REPORT_FUTURE_SOURCE');
  }
  for (const call of calls) {
    requireCondition(supportedOutcomes.has(call.OUTCOME), 'REPORT_UNKNOWN_OUTCOME');
    requireCondition(!Object.hasOwn(call, 'COVERAGE_MODE')
      || call.COVERAGE_MODE === deployment.COVERAGE_MODE, 'REPORT_CALL_COVERAGE_CONFLICT');
    requireCondition(call.STARTED_AT >= final.TEST_STARTED_AT
      && call.STARTED_AT <= final.TEST_ENDED_AT, 'REPORT_CALL_PERIOD_CONFLICT');
  }
  const handled = calls.filter((call) => call.HANDLED_RECORDED);
  requireCondition(handled.length === final.CALLS_CAPTURED
    && handled.length === deployment.HANDLED_COUNT
    && final.CALL_LIMIT === deployment.CALL_LIMIT, 'REPORT_TOTALS_CONFLICT');
  const callMix = contract.outcome_groups.map((group) => ({
    category: group.key, label: group.label,
    calls: handled.filter((call) => group.outcomes.includes(call.OUTCOME)).length,
  }));
  requireCondition(callMix.reduce((total, group) => total + group.calls, 0) === handled.length,
    'REPORT_CALL_MIX_CONFLICT');
  requireCondition(callMix[0].calls === final.QUALIFIED_OPPORTUNITIES
    && callMix[1].calls === final.EXISTING_CUSTOMER_CALLS
    && callMix[2].calls === final.WRONG_FIT_CALLS, 'REPORT_TOTALS_CONFLICT');
  const urgent = handled.filter((call) => ['urgent', 'immediate_danger'].includes(call.URGENCY_CLASS)).length;
  requireCondition(urgent === final.URGENT_REQUESTS, 'REPORT_TOTALS_CONFLICT');
  if (Object.hasOwn(final, 'ACTUAL_AVERAGE_CALL_DURATION_MILLISECONDS')) {
    requireCondition(handled.length > 0 && handled.every((call) =>
      Number.isSafeInteger(call.DURATION_MILLISECONDS)), 'REPORT_DURATION_UNVERIFIED');
    const totalMilliseconds = handled.reduce((total, call) => total + call.DURATION_MILLISECONDS, 0);
    requireCondition(Number.isSafeInteger(totalMilliseconds)
      && Math.round((totalMilliseconds / 1000 / handled.length + Number.EPSILON) * 100) * 10
        === final.ACTUAL_AVERAGE_CALL_DURATION_MILLISECONDS, 'REPORT_DURATION_CONFLICT');
    if (Object.hasOwn(final, 'EXPECTED_MONTHLY_CONNECTED_MINUTES_MIN_HUNDREDTHS')) {
      const days = (Math.min(Date.parse(final.TEST_ENDED_AT), Date.parse(deployment.EXPIRES_AT))
        - Date.parse(final.TEST_STARTED_AT)) / 86_400_000;
      requireCondition(days > 0, 'REPORT_PROJECTION_PERIOD_INVALID');
      for (const [field, multiplier] of [
        ['EXPECTED_MONTHLY_CONNECTED_MINUTES_MIN_HUNDREDTHS', runtimeContract.reporting.monthly_min_calendar_days],
        ['EXPECTED_MONTHLY_CONNECTED_MINUTES_MAX_HUNDREDTHS', runtimeContract.reporting.monthly_max_calendar_days],
      ]) requireCondition(Math.round((totalMilliseconds / 60000 / days * multiplier + Number.EPSILON) * 100)
        === final[field], 'REPORT_PROJECTION_CONFLICT');
    }
  } else requireCondition(!Object.hasOwn(final, 'EXPECTED_MONTHLY_CONNECTED_MINUTES_MIN_HUNDREDTHS'),
    'REPORT_DURATION_UNVERIFIED');
  if (Object.hasOwn(final, 'OBSERVED_WORKFLOW_FAILURES')) requireCondition(
    handled.filter((call) => Boolean(call.WORKFLOW_FAILURE_CODE)).length === final.OBSERVED_WORKFLOW_FAILURES,
    'REPORT_FAILURE_COUNT_CONFLICT');
  for (const [source, target] of [
    ['BOOKABLE_OPPORTUNITY', 'BOOKABLE_OPPORTUNITIES'],
    ['OFFICE_FOLLOW_UP_REQUIRED', 'OFFICE_FOLLOW_UP_CALLS'],
  ]) {
    const complete = handled.every((call) => typeof call[source] === 'boolean');
    requireCondition(complete
      ? final[target] === handled.filter((call) => call[source]).length
      : !Object.hasOwn(final, target), 'REPORT_OPTIONAL_EVIDENCE_CONFLICT');
  }
  let baseline = null;
  if (input.crmBaseline) {
    baseline = buildCrmReportBaseline(input.crmBaseline, { now });
    requireCondition(baseline.clientKey === deployment.CLIENT_KEY
      && baseline.deploymentKey === deployment.DEPLOYMENT_KEY
      // The producer's CONFIGURATION_VERSION is the immutable physical version
      // ID, not CRM's editable/version label. Never conflate the two joins.
      && baseline.configurationVersionId === deployment.CONFIGURATION_VERSION
      && baseline.environment === deployment.ENVIRONMENT
      && input.crmBaseline.context.testStartedAt === final.TEST_STARTED_AT
      && Date.parse(baseline.capturedAt) <= Date.parse(final.TEST_STARTED_AT),
    'REPORT_BASELINE_OWNERSHIP_CONFLICT');
    requireCondition(COVERAGE_FACT_VALUES.has(baseline.coverageMode)
      && COVERAGE_FACT_VALUES.get(baseline.coverageMode) === deployment.COVERAGE_MODE,
    'REPORT_BASELINE_COVERAGE_CONFLICT');
  }
  const daily = new Map();
  for (const call of handled) {
    const date = call.STARTED_AT.slice(0, 10);
    daily.set(date, (daily.get(date) || 0) + 1);
  }
  return Object.freeze({
    schemaVersion: 1,
    title: contract.title,
    status: 'operator_review_only_delivery_not_authorized',
    beforeTest: baseline ? {
      label: 'Before the test — business baseline',
      evidenceClass: baseline.evidenceClass, sourcePeriod: baseline.sourcePeriod,
      capturedAt: baseline.capturedAt, sourceModifiedAt: baseline.sourceModifiedAt,
      currency: baseline.currency, values: baseline.values,
      comparisonStatus: baseline.comparisonStatus,
    } : { label: 'Before the test — baseline not available', values: null },
    duringTest: {
      startedAtUtc: final.TEST_STARTED_AT, endedAtUtc: final.TEST_ENDED_AT,
      endReason: final.TEST_END_REASON, coverage: deployment.COVERAGE_MODE || null,
      callsCaptured: handled.length, unhandledAttempts: calls.length - handled.length,
      callLimit: final.CALL_LIMIT, callMix,
      outcomeDetail: [...supportedOutcomes].map((outcome) => ({
        outcome, calls: handled.filter((call) => call.OUTCOME === outcome).length,
      })),
      urgentRequests: urgent,
      bookableOpportunities: final.BOOKABLE_OPPORTUNITIES ?? null,
      officeFollowUpCalls: final.OFFICE_FOLLOW_UP_CALLS ?? null,
      observedWorkflowFailures: final.OBSERVED_WORKFLOW_FAILURES ?? null,
      averageCallDurationSeconds: ratio(final.ACTUAL_AVERAGE_CALL_DURATION_MILLISECONDS, 1000),
      dailyCallsUtc: [...daily].sort(([a], [b]) => a.localeCompare(b))
        .map(([dateUtc, count]) => ({ dateUtc, calls: count })),
    },
    nextSteps: {
      supportedCoverage: final.RECOMMENDED_COVERAGE_MODE ?? null,
      estimatedMonthlyConnectedMinutesMin: ratio(final.EXPECTED_MONTHLY_CONNECTED_MINUTES_MIN_HUNDREDTHS, 100),
      estimatedMonthlyConnectedMinutesMax: ratio(final.EXPECTED_MONTHLY_CONNECTED_MINUTES_MAX_HUNDREDTHS, 100),
      label: 'Directional estimate from this limited test; not a guarantee or a paid-service activation.',
    },
    evidence: {
      sourceRevision: approvedRevision, sourceModifiedAt: final.SOURCE_MODIFIED_AT,
      analysisComplete: final.ANALYSIS_EVIDENCE_COMPLETE,
      durationComplete: final.DURATION_EVIDENCE_COMPLETE,
      crmBaselineAvailable: baseline !== null,
      limits: [
        'Urgency and follow-up overlap the call categories; do not add them to the total.',
        'Missing evidence means Not available, not zero.',
        'Baseline estimates and observed route calls are not a like-for-like before/after comparison.',
        'Opportunities are not confirmed bookings, completed jobs, recovered revenue, or cost savings.',
        'This source report is not proof of provider delivery or permission to email a customer.',
      ],
    },
  });
}

module.exports = { buildFreeTestReport, factRowsetDigest, readbackRowsetDigest };
