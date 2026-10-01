'use strict';

// Existing in-memory runtime + existing Analytics evidence fixture. No provider,
// cloud record or live receipt is created by this local report composition.
const { fixture, refreshDigests } = require('./free-test-report-fixture');
const { scopeInventoryDigest } = require('../../../../tools/evaluate-dashboard-pre-render-gate');
const { queryClientCallDetails } = require('../../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/reporting');
const { NOW, runtimeFixture, payloadInbound, eventPayload, invoke } = require('../../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/test/runtime-fixture');

async function privateCallLedgerFixture(analysis = {}) {
  const analyses = Array.isArray(analysis) ? analysis : [analysis];
  if (analyses.length < 1 || analyses.length > 4 || analyses.some((value) => !value
    || typeof value !== 'object' || Array.isArray(value))) throw new Error('SYNTHETIC_LEDGER_INPUT_INVALID');
  const runtime = runtimeFixture();
  for (const [index, item] of analyses.entries()) {
    const inbound = await invoke(runtime.listener, {
      url: '/retell/inbound', payload: payloadInbound('A'), env: runtime.env,
    });
    const event = eventPayload('call_analyzed', analyses.length === 1
      ? 'synthetic_ledger_call' : `synthetic_ledger_call_${index}`,
    inbound.body.call_inbound.metadata, 'A', {
      bookable_opportunity: !item.outcome || ['potential_job', 'urgent_potential_job'].includes(item.outcome),
      office_follow_up_required: true,
      workflow_failure_code: null, workflow_failure_text: null, ...item,
    });
    await invoke(runtime.listener, { url: '/retell/events', payload: event, env: runtime.env });
  }
  if (runtime.workerErrors.length) throw new Error('SYNTHETIC_LEDGER_FIXTURE_FAILED');
  const now = NOW + 120_000;
  const snapshot = await queryClientCallDetails(runtime.store, runtime.config, 'client_A', 'deployment_A', now);
  const input = fixture();
  input.calls = snapshot.rows.map((row) => ({ ...row.fact }));
  const handled = input.calls.filter((call) => call.HANDLED_RECORDED);
  const countOutcome = (outcomes) => handled.filter((call) => outcomes.includes(call.OUTCOME)).length;
  const watermark = new Date(NOW + 61_000).toISOString();
  const start = new Date(NOW).toISOString();
  const end = new Date(NOW + 60_000).toISOString();
  for (const fact of [input.deployment, input.finalResult]) Object.assign(fact, {
    CLIENT_KEY: snapshot.clientKey, DEPLOYMENT_KEY: snapshot.deploymentKey,
    RECORD_KEY: snapshot.deploymentKey, CONFIGURATION_VERSION: snapshot.configurationVersionId,
    SOURCE_REVISION: snapshot.sourceRevision, SOURCE_MODIFIED_AT: watermark,
  });
  Object.assign(input.deployment, { ACTUAL_START_AT: start, STOPPED_AT: end,
    EXPIRES_AT: new Date(NOW + 7 * 86_400_000).toISOString(),
    STOP_REASON: 'sylvara_stopped', HANDLED_COUNT: handled.length });
  Object.assign(input.finalResult, { TEST_STARTED_AT: start, TEST_ENDED_AT: end,
    TEST_END_REASON: 'sylvara_stopped', CALLS_CAPTURED: handled.length,
    QUALIFIED_OPPORTUNITIES: countOutcome(['potential_job', 'urgent_potential_job']),
    URGENT_REQUESTS: handled.filter((call) => ['urgent', 'immediate_danger'].includes(call.URGENCY_CLASS)).length,
    EXISTING_CUSTOMER_CALLS: countOutcome(['existing_customer']),
    WRONG_FIT_CALLS: countOutcome(['unsupported_service', 'out_of_area']),
    ACTUAL_AVERAGE_CALL_DURATION_MILLISECONDS: Math.round((handled.reduce((sum, call) =>
      sum + call.DURATION_MILLISECONDS, 0) / 1000 / handled.length + Number.EPSILON) * 100) * 10,
  });
  for (const [source, target] of [['BOOKABLE_OPPORTUNITY', 'BOOKABLE_OPPORTUNITIES'],
    ['OFFICE_FOLLOW_UP_REQUIRED', 'OFFICE_FOLLOW_UP_CALLS']]) {
    if (handled.every((call) => typeof call[source] === 'boolean')) {
      input.finalResult[target] = handled.filter((call) => call[source]).length;
    } else delete input.finalResult[target];
  }
  const scope = input.evidence.scopes[0];
  Object.assign(scope, { CLIENT_KEY: snapshot.clientKey, DEPLOYMENT_KEY: snapshot.deploymentKey,
    source_call_count: input.calls.length });
  const evaluated = new Date(now).toISOString();
  input.evidence.evaluated_at = evaluated;
  for (const [kind, facts] of [['deployment', [input.deployment]], ['call', input.calls], ['final_test_result', [input.finalResult]]]) {
    const latest = facts.map((fact) => fact.SOURCE_MODIFIED_AT).sort().at(-1);
    Object.assign(scope.checkpoints[kind], { last_source_modified_at: latest,
      provider_watermark: latest, last_reconciled_at: evaluated,
      stale_after_at: new Date(now + 300_000).toISOString() });
    Object.assign(scope.analytics_readback.record_types[kind], {
      row_count: facts.length, latest_source_modified_at: latest,
    });
  }
  const digest = scopeInventoryDigest([scope]);
  input.evidence.scope_inventory.catalyst_scope_digest = digest;
  input.evidence.scope_inventory.analytics_scope_digest = digest;
  input.approval.approved_scope_inventory_digest = digest;
  refreshDigests(input);
  return { input, snapshot, now, runtime };
}

module.exports = { privateCallLedgerFixture };
