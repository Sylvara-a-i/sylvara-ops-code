'use strict';

// Shared illustrative fixture for report and renderer checks; not live evidence.
// This module registers no tests and has no I/O or provider execution.
const crypto = require('node:crypto');
const profile = require('../../../../config/free-test-report-contract.json');
const { factRowsetDigest } = require('../../../../tools/build-free-test-report');
const { scopeInventoryDigest } = require('../../../../tools/evaluate-dashboard-pre-render-gate');
const { crmBaselineFixture } = require('./crm-baseline-fixture');
const { callFact } = require('../helpers');

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


module.exports = { NOW, START, END, WATERMARK, REVISION, fixture, refreshDigests, attachBaseline };
