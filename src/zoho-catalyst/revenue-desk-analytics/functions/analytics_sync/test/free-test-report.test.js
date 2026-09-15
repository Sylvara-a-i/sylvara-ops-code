'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const profile = require('../../../config/free-test-report-contract.json');
const broadModel = require('../../../config/analytics-model-contract.json');
const { buildFreeTestReport, factRowsetDigest } = require('../../../tools/build-free-test-report');
const { crmBaselineFixture } = require('./helpers/crm-baseline-fixture');
const { evaluateFreeTestReportGate, evaluatePreRenderGate, scopeInventoryDigest } =
  require('../../../tools/evaluate-dashboard-pre-render-gate');
const { callFact } = require('./helpers');

const NOW = Date.parse('2026-08-31T13:00:00.000Z');
const START = '2026-08-24T11:00:00.000Z';
const END = '2026-08-31T11:00:00.000Z';
const WATERMARK = '2026-08-31T12:00:00.000Z';
const REVISION = 'd'.repeat(40);
const EVALUATED = '2026-08-31T12:59:00.000Z';

function fixture(empty = false) {
  const outcomes = profile.outcome_groups.flatMap((group) => group.outcomes);
  const calls = empty ? [] : outcomes.map((outcome, index) => {
    const key = crypto.createHash('sha256').update(`synthetic-call-${index}`).digest('hex');
    return callFact({ RECORD_KEY: key, CALL_KEY: key, OUTCOME: outcome,
      URGENCY_CLASS: outcome === 'urgent_potential_job' ? 'urgent' : 'routine',
      BOOKABLE_OPPORTUNITY: outcome === 'potential_job' || outcome === 'urgent_potential_job',
      OFFICE_FOLLOW_UP_REQUIRED: false, NOTIFICATION_STATE: 'dry_run', SOURCE_MODIFIED_AT: WATERMARK,
      COVERAGE_MODE: 'after_hours_only' });
  });
  const common = { SCHEMA_VERSION: 1, METRIC_VERSION: 'revenue_desk_metrics_v1',
    RECORD_KEY: 'c'.repeat(64), CLIENT_KEY: 'b'.repeat(64), DEPLOYMENT_KEY: 'c'.repeat(64),
    CONFIGURATION_VERSION: 'config-v1', ENGAGEMENT_TYPE: 'free_test', ENVIRONMENT: 'development',
    SOURCE_MODIFIED_AT: WATERMARK, SOURCE_REVISION: REVISION };
  const deployment = { ...common, CAPABILITY_PROFILE: 'free_test', PLAN_TIER: 'free_test',
    DEPLOYMENT_STATUS: 'completed', GO_LIVE_APPROVAL_STATUS: 'approved', LIMIT_POLICY: 'seven_days_or_25',
    BILLING_MODE: 'disabled', COVERAGE_MODE: 'after_hours_only', HANDLED_COUNT: calls.length, CALL_LIMIT: 25,
    ACTUAL_START_AT: START, EXPIRES_AT: END, STOPPED_AT: END, STOP_REASON: 'seven_day_limit_reached' };
  const finalResult = { ...common, TEST_STARTED_AT: START, TEST_ENDED_AT: END, TEST_END_REASON: 'seven_day_limit_reached',
    CALLS_CAPTURED: calls.length, CALL_LIMIT: 25, QUALIFIED_OPPORTUNITIES: empty ? 0 : 2,
    URGENT_REQUESTS: empty ? 0 : 1, EXISTING_CUSTOMER_CALLS: empty ? 0 : 1, WRONG_FIT_CALLS: empty ? 0 : 2,
    BOOKABLE_OPPORTUNITIES: empty ? 0 : 2, OFFICE_FOLLOW_UP_CALLS: 0,
    DURATION_EVIDENCE_COMPLETE: !empty, ANALYSIS_EVIDENCE_COMPLETE: !empty };
  const recordTypes = profile.pre_render_gate.required_record_types;
  const scope = { ENVIRONMENT: 'development', ENGAGEMENT_TYPE: 'free_test',
    CLIENT_KEY: common.CLIENT_KEY, DEPLOYMENT_KEY: common.DEPLOYMENT_KEY,
    unresolved_v2_outbox_rows: 0, source_call_count: calls.length,
    checkpoints: Object.fromEntries(recordTypes.map((kind) => [kind, empty && kind === 'call' ? null : {
      status: 'Healthy', last_error_code: null, last_rejected_row_count: 0,
      last_source_modified_at: WATERMARK, provider_watermark: WATERMARK,
      last_reconciled_at: '2026-08-31T12:30:00.000Z', stale_after_at: '2026-08-31T14:00:00.000Z',
      source_revision: REVISION }])),
    analytics_readback: { binding_verified: true, partition_isolation_verified: true,
      record_types: Object.fromEntries(recordTypes.map((kind) => [kind, {
        row_count: kind === 'call' ? calls.length : 1, duplicate_record_key_count: 0,
        payload_hash_mismatch_count: 0, source_revision: REVISION,
        rowset_digest: factRowsetDigest(kind, kind === 'call' ? calls : [kind === 'deployment' ? deployment : finalResult]),
        ...(empty && kind === 'call' ? { empty_source_verified: true, verified_at: EVALUATED }
          : { latest_source_modified_at: WATERMARK }) }])) } };
  const digest = scopeInventoryDigest([scope]);
  return { deployment, calls, finalResult, crmBaseline: null,
    evidence: { schema_version: 1, evaluated_at: EVALUATED, approved_source_revision: REVISION,
      scope_inventory: { expected_scope_count: 1, catalyst_scope_digest: digest, analytics_scope_digest: digest },
      scopes: [scope] },
    approval: { schema_version: 1, approved_source_revision: REVISION, approved_scope_inventory_digest: digest } };
}

test('six report groups include every canonical outcome exactly once and reconcile', () => {
  const report = buildFreeTestReport(fixture(), NOW);
  assert.equal(report.duringTest.callsCaptured, 11);
  assert.deepEqual(report.duringTest.callMix.map((group) => group.calls), [2, 1, 2, 1, 1, 4]);
  assert.equal(report.duringTest.urgentRequests, 1);
  assert.equal(report.beforeTest.values, null);
  assert.equal(report.duringTest.averageCallDurationSeconds, null);
  assert.equal(report.status, 'operator_review_only_delivery_not_authorized');
  assert.equal(JSON.stringify(report).includes('b'.repeat(64)), false);
  const canonical = require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json');
  // The canonical contract owns classification; the report changes presentation only.
  const actual = profile.outcome_groups.flatMap((group) => group.outcomes);
  assert.equal(new Set(actual).size, 11);
  assert.equal(actual.every((outcome) => JSON.stringify(canonical).includes(`"${outcome}"`)), true);
});

test('free-test gate does not require paid conversion; broad dashboard contract still does', () => {
  const f = fixture();
  assert.equal(evaluateFreeTestReportGate(profile.pre_render_gate, f.evidence, NOW, f.approval).verdict, 'ready');
  assert.equal(evaluatePreRenderGate(broadModel.pre_render_gate, f.evidence, NOW, f.approval).verdict, 'blocked');
  assert.equal(evaluatePreRenderGate(profile.pre_render_gate, f.evidence, NOW, f.approval).verdict, 'blocked');
});

test('zero-call report requires explicit fresh zero evidence, never an invented checkpoint', () => {
  const f = fixture(true);
  assert.equal(buildFreeTestReport(f, NOW).duringTest.callsCaptured, 0);
  delete f.evidence.scopes[0].analytics_readback.record_types.call.empty_source_verified;
  assert.throws(() => buildFreeTestReport(f, NOW), { code: 'REPORT_RECONCILIATION_REQUIRED' });
});

test('duplicates reconcile once and stale corrected copies cannot inflate counts', () => {
  const f = fixture();
  f.calls.push({ ...f.calls[0], SOURCE_MODIFIED_AT: '2026-08-24T12:05:00.000Z' });
  assert.equal(buildFreeTestReport(f, NOW).duringTest.callsCaptured, 11);
  f.calls[f.calls.length - 1].SOURCE_MODIFIED_AT = WATERMARK;
  f.calls[f.calls.length - 1].OUTCOME = 'spam';
  assert.throws(() => buildFreeTestReport(f, NOW), { code: 'ROLLUP_CORRECTION_CONFLICT' });
});

test('wrong business, stale evidence, unexplained counts and unknown categories block', () => {
  for (const mutate of [
    (f) => { f.calls[0].CLIENT_KEY = 'e'.repeat(64); },
    (f) => { f.evidence.evaluated_at = '2026-08-31T12:00:00.000Z'; },
    (f) => { f.evidence.scopes[0].unresolved_v2_outbox_rows = 1; },
    (f) => { f.finalResult.CALLS_CAPTURED = 12; },
    (f) => { f.calls[0].OUTCOME = 'invented'; },
    (f) => { f.deployment.DEPLOYMENT_STATUS = 'live'; },
  ]) {
    const f = fixture(); mutate(f); assert.throws(() => buildFreeTestReport(f, NOW));
  }
});

test('missing optional evidence stays unknown, not zero', () => {
  const f = fixture();
  delete f.calls[0].BOOKABLE_OPPORTUNITY;
  delete f.finalResult.BOOKABLE_OPPORTUNITIES;
  refreshDigests(f);
  assert.equal(buildFreeTestReport(f, NOW).duringTest.bookableOpportunities, null);
  f.finalResult.BOOKABLE_OPPORTUNITIES = 0;
  refreshDigests(f);
  assert.throws(() => buildFreeTestReport(f, NOW), { code: 'REPORT_OPTIONAL_EVIDENCE_CONFLICT' });
});

function refreshDigests(f) {
  for (const [kind, rows] of [['deployment', [f.deployment]], ['call', f.calls], ['final_test_result', [f.finalResult]]]) {
    f.evidence.scopes[0].analytics_readback.record_types[kind].rowset_digest = factRowsetDigest(kind, rows);
  }
}

function attachBaseline(f) {
  const b = crmBaselineFixture();
  for (const target of [b.context, b.evidence]) {
    target.clientKey = f.deployment.CLIENT_KEY; target.deploymentKey = f.deployment.DEPLOYMENT_KEY;
    target.configurationVersionId = f.deployment.CONFIGURATION_VERSION;
    target.crmModifiedAt = '2026-08-24T10:40:00.000Z';
    target.sourcePeriod = { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };
  }
  b.context.testStartedAt = START;
  b.deal.Configuration_Version = b.context.configurationVersion;
  b.deal.Modified_Time = b.context.crmModifiedAt;
  b.evidence.readAt = '2026-08-24T10:45:00.000Z'; b.evidence.capturedAt = '2026-08-24T10:46:00.000Z';
  b.metadata.observedAt = '2026-08-24T10:44:00.000Z';
  f.crmBaseline = b;
  f.deployment = { ...f.deployment,
    PRETEST_BASELINE_PRESENT: true, PRETEST_CAPTURED_AT: b.evidence.capturedAt,
    PRETEST_SOURCE_MODIFIED_AT: b.context.crmModifiedAt,
    PRETEST_PERIOD_START_AT: b.context.sourcePeriod.start, PRETEST_PERIOD_END_AT: b.context.sourcePeriod.end,
    PRETEST_EVIDENCE_CLASS: b.context.evidenceClass, PRETEST_CURRENCY: 'USD',
    PRETEST_CURRENT_CALL_HANDLING: 'Voicemail', PRETEST_MONTHLY_INBOUND_CALLS: 140,
    PRETEST_MONTHLY_INBOUND_CALL_BAND: '100-249', PRETEST_AFTER_HOURS_CALL_BAND: '25-49',
    PRETEST_AFTER_HOURS_CALL_SHARE_HUNDREDTHS: 2025, PRETEST_ESTIMATED_UNANSWERED_RATE_HUNDREDTHS: 1250,
    PRETEST_AVERAGE_JOB_VALUE_MINOR_UNITS: 35025, PRETEST_AVERAGE_JOB_VALUE_BAND: '$250-$499',
    PRETEST_MONTHLY_ANSWERING_COST_MINOR_UNITS: 0,
  };
  refreshDigests(f);
  return b;
}

test('attested deployment baseline renders without CRM reads and cannot be enriched from new raw evidence', () => {
  const f = fixture();
  const b = attachBaseline(f);
  const expected = buildFreeTestReport(f, NOW).beforeTest;
  f.crmBaseline = null;
  assert.deepEqual(buildFreeTestReport(f, NOW).beforeTest, expected);
  f.crmBaseline = b;
  b.deal.Monthly_Inbound_Calls += 1;
  assert.throws(() => buildFreeTestReport(f, NOW), { code: 'REPORT_BASELINE_EVIDENCE_CONFLICT' });
  b.deal.Monthly_Inbound_Calls -= 1;
  for (const field of Object.keys(f.deployment).filter((field) => field.startsWith('PRETEST_'))) delete f.deployment[field];
  refreshDigests(f);
  assert.throws(() => buildFreeTestReport(f, NOW), { code: 'REPORT_BASELINE_OWNERSHIP_CONFLICT' });
  f.crmBaseline = null;
  assert.equal(buildFreeTestReport(f, NOW).beforeTest.values, null);
});

test('CRM pre-test snapshot joins the exact test and excludes raw relationship IDs', () => {
  const f = fixture();
  const b = attachBaseline(f);
  const report = buildFreeTestReport(f, NOW);
  assert.equal(report.beforeTest.values.monthlyInboundCalls, 140);
  assert.equal(report.beforeTest.values.averageJobValueMinorUnits, 35025);
  assert.equal(report.beforeTest.comparisonStatus, 'context_only_not_before_after_proof');
  assert.equal(JSON.stringify(report).includes(b.deal.id), false);
  b.context.deploymentKey = 'f'.repeat(64); b.evidence.deploymentKey = 'f'.repeat(64);
  assert.throws(() => buildFreeTestReport(f, NOW), { code: 'REPORT_BASELINE_OWNERSHIP_CONFLICT' });
});

test('baseline joins the physical configuration ID, never a coincidentally equal CRM label', () => {
  const f = fixture();
  const b = attachBaseline(f);
  assert.notEqual(b.context.configurationVersion, f.deployment.CONFIGURATION_VERSION);
  assert.equal(buildFreeTestReport(f, NOW).beforeTest.values.monthlyInboundCalls, 140);
  b.context.configurationVersionId = 'different-physical-version';
  b.evidence.configurationVersionId = b.context.configurationVersionId;
  b.context.configurationVersion = f.deployment.CONFIGURATION_VERSION;
  b.evidence.configurationVersion = b.context.configurationVersion;
  b.deal.Configuration_Version = b.context.configurationVersion;
  assert.throws(() => buildFreeTestReport(f, NOW), { code: 'REPORT_BASELINE_OWNERSHIP_CONFLICT' });
});

test('baseline coverage matches the actual producer coverage for each supported route', () => {
  for (const [storedRoute, coverage] of [
    ['After-Hours', 'after_hours_only'],
    ['No-Answer/Overflow', 'no_answer_overflow_only'],
    ['Both', 'after_hours_and_overflow'],
  ]) {
    const f = fixture();
    const b = attachBaseline(f);
    b.deal.Approved_Test_Route = storedRoute;
    b.context.approvedTestRoute = storedRoute;
    f.deployment.COVERAGE_MODE = coverage;
    for (const call of f.calls) call.COVERAGE_MODE = coverage;
    refreshDigests(f);
    assert.equal(buildFreeTestReport(f, NOW).duringTest.coverage, coverage);
    b.deal.Approved_Test_Route = storedRoute === 'Both' ? 'After-Hours' : 'Both';
    b.context.approvedTestRoute = b.deal.Approved_Test_Route;
    assert.throws(() => buildFreeTestReport(f, NOW), { code: 'REPORT_BASELINE_COVERAGE_CONFLICT' });
  }
});

test('present call coverage must match the deployment; recommendations remain separate', () => {
  const f = fixture();
  f.finalResult.RECOMMENDED_COVERAGE_MODE = 'after_hours_and_overflow';
  delete f.calls[0].COVERAGE_MODE;
  refreshDigests(f);
  assert.equal(buildFreeTestReport(f, NOW).nextSteps.supportedCoverage, 'after_hours_and_overflow');
  f.calls[0].COVERAGE_MODE = 'no_answer_overflow_only';
  refreshDigests(f);
  assert.throws(() => buildFreeTestReport(f, NOW), { code: 'REPORT_CALL_COVERAGE_CONFLICT' });
});

test('controller stop reasons use the canonical reason mapping', () => {
  for (const [internal, finalReason] of [['operator_requested', 'sylvara_stopped'],
    ['route_verification_failed', 'technical_failure'], ['configuration_changed', 'technical_failure']]) {
    const f = fixture(); f.deployment.STOP_REASON = internal; f.finalResult.TEST_END_REASON = finalReason;
    refreshDigests(f);
    assert.equal(buildFreeTestReport(f, NOW).duringTest.endReason, finalReason);
  }
});

test('attested rowsets prevent stale values or duplicate single-test rows from rendering', () => {
  const f = fixture(); f.finalResult.SOURCE_MODIFIED_AT = '2026-08-31T11:55:00.000Z';
  assert.throws(() => buildFreeTestReport(f, NOW), { code: 'REPORT_ROWSET_MISMATCH' });
  const duplicate = fixture(); duplicate.evidence.scopes[0].analytics_readback.record_types.deployment.row_count = 2;
  assert.throws(() => buildFreeTestReport(duplicate, NOW), { code: 'REPORT_RECONCILIATION_REQUIRED' });
});

test('duration and directional minutes reconcile exactly with provider-duration facts', () => {
  const f = fixture();
  for (const call of f.calls) { delete call.DURATION_SECONDS; call.DURATION_MILLISECONDS = 1500; }
  Object.assign(f.finalResult, { ACTUAL_AVERAGE_CALL_DURATION_MILLISECONDS: 1500,
    EXPECTED_MONTHLY_CONNECTED_MINUTES_MIN_HUNDREDTHS: 110,
    EXPECTED_MONTHLY_CONNECTED_MINUTES_MAX_HUNDREDTHS: 122,
    MONTHLY_MINUTES_METHODOLOGY_ID: 'retell_duration_elapsed_calendar_run_rate_v1' });
  refreshDigests(f);
  const report = buildFreeTestReport(f, NOW);
  assert.equal(report.duringTest.averageCallDurationSeconds, 1.5);
  assert.equal(report.nextSteps.estimatedMonthlyConnectedMinutesMax, 1.22);
  f.finalResult.ACTUAL_AVERAGE_CALL_DURATION_MILLISECONDS = 1600; refreshDigests(f);
  assert.throws(() => buildFreeTestReport(f, NOW), { code: 'REPORT_DURATION_CONFLICT' });
  f.finalResult.ACTUAL_AVERAGE_CALL_DURATION_MILLISECONDS = 1500;
  f.finalResult.EXPECTED_MONTHLY_CONNECTED_MINUTES_MAX_HUNDREDTHS = 123; refreshDigests(f);
  assert.throws(() => buildFreeTestReport(f, NOW), { code: 'REPORT_PROJECTION_CONFLICT' });
});

test('actual runtime producers retain controller stop-to-report reason semantics', () => {
  const { deploymentFact, finalTestResultFact } = require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/analytics-outbox');
  const f = fixture(true);
  const config = { analyticsPartitionSecret: 'synthetic-report-only-partition-secret' };
  const deployment = { clientId: 'ZZZ-client', deploymentId: 'ZZZ-deployment',
    configurationVersionId: 'config-v1', configurationVersion: 'version-1', engagementType: 'free_test',
    capabilityProfile: 'free_test_v1', planTier: 'free_test', limitPolicy: 'seven_days_or_25',
    billingMode: 'disabled', numberOwnership: 'dedicated', environment: 'development', coverageMode: 'AfterHoursOnly' };
  const row = { CLIENT_ID: deployment.clientId, DEPLOYMENT_ID: deployment.deploymentId,
    CONFIGURATION_VERSION_ID: deployment.configurationVersionId, ENGAGEMENT_TYPE: 'free_test',
    SOURCE_ENVIRONMENT: 'development', SOURCE_REVISION: REVISION, UPDATED_AT: WATERMARK,
    TEST_STATUS: 'Stopped', GO_LIVE_APPROVAL_STATUS: 'Approved', HANDLED_COUNT: 0, CALL_LIMIT: 25,
    ACTUAL_START_AT: START, EXPIRES_AT: END, STOPPED_AT: END, STOP_REASON: 'operator_requested' };
  f.deployment = deploymentFact(config, deployment, row);
  f.finalResult = finalTestResultFact(config, deployment, row, { ...deployment,
    sourceModifiedAt: WATERMARK, testStart: START, testEnd: END, testEndReason: 'Sylvara Stopped',
    callsCaptured: 0, callLimit: 25, qualifiedOpportunities: 0, urgentRequests: 0,
    existingCustomerCalls: 0, outOfAreaOrWrongFitCalls: 0, bookableOpportunities: 0,
    officeFollowUpCalls: 0, durationEvidenceComplete: false, structuredAnalysisComplete: false });
  Object.assign(f.evidence.scopes[0], { CLIENT_KEY: f.deployment.CLIENT_KEY, DEPLOYMENT_KEY: f.deployment.DEPLOYMENT_KEY });
  const digest = scopeInventoryDigest(f.evidence.scopes);
  f.evidence.scope_inventory.catalyst_scope_digest = digest;
  f.evidence.scope_inventory.analytics_scope_digest = digest;
  f.approval.approved_scope_inventory_digest = digest;
  refreshDigests(f);
  assert.equal(buildFreeTestReport(f, NOW).duringTest.endReason, 'sylvara_stopped');
  const baseline = attachBaseline(f);
  baseline.context.configurationVersion = deployment.configurationVersion;
  baseline.evidence.configurationVersion = deployment.configurationVersion;
  baseline.deal.Configuration_Version = deployment.configurationVersion;
  assert.notEqual(deployment.configurationVersionId, deployment.configurationVersion);
  const { buildCrmReportBaseline } = require('../lib/crm-report-baseline');
  deployment.configuration = { reportBaseline: buildCrmReportBaseline(baseline, { now: NOW }) };
  f.deployment = deploymentFact(config, deployment, row);
  refreshDigests(f);
  assert.equal(buildFreeTestReport(f, NOW).beforeTest.values.monthlyInboundCalls, 140);
  f.crmBaseline = null;
  assert.equal(buildFreeTestReport(f, NOW).beforeTest.values.monthlyInboundCalls, 140);
});
