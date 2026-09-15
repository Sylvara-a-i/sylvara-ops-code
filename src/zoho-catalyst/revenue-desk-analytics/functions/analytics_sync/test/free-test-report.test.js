'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const profile = require('../../../config/free-test-report-contract.json');
const broadModel = require('../../../config/analytics-model-contract.json');
const { buildFreeTestReport } = require('../../../tools/build-free-test-report');
const { evaluateFreeTestReportGate, evaluatePreRenderGate, scopeInventoryDigest } =
  require('../../../tools/evaluate-dashboard-pre-render-gate');

const { NOW, START, END, WATERMARK, REVISION, fixture, refreshDigests, attachBaseline } =
  require('./helpers/free-test-report-fixture');

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
