'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCrmReportSummary } = require('../lib/crm-report-outbox');
const { queryClientReport } = require('../lib/reporting');
const { loadDeployment } = require('../lib/runtime-service');
const {
  eventPayload, invoke, payloadInbound, runtimeFixture,
} = require('./runtime-fixture');

const TERMINAL_AS_OF = Date.parse('2026-08-27T12:00:00.000Z');

async function recordAnalyzedCall(data, mutateAnalysis = null) {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, {
    url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env,
  });
  const payload = eventPayload(
    'call_analyzed', 'workflow_failure_evidence_A',
    inbound.body.call_inbound.metadata, 'A', data,
  );
  if (mutateAnalysis) mutateAnalysis(payload.call.call_analysis.custom_analysis_data);
  const analyzed = await invoke(fixture.listener, {
    url: '/retell/events', env: fixture.env,
    payload,
  });
  assert.equal(analyzed.status, 200);
  return fixture;
}

test('legacy analysis cannot become a false-zero workflow-failure total or CRM claim', async () => {
  const fixture = await recordAnalyzedCall({});
  const report = await queryClientReport(
    fixture.store, fixture.config, 'client_A', 'deployment_A', TERMINAL_AS_OF,
  );
  assert.equal(report.workflowFailureEvidenceComplete, false);
  assert.equal(report.observedWorkflowFailures, null);
  assert.match(report.dataConfidenceNotes.join(' '), /workflow-failure total is withheld/i);

  const deploymentRow = await fixture.store.unique(
    fixture.config.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', 'deployment_A',
  );
  const deployment = await loadDeployment(fixture.store, deploymentRow, fixture.config);
  const summary = buildCrmReportSummary(fixture.config, deployment, report);
  assert.equal(summary.schemaVersion, 2);
  assert.equal(summary.observedWorkflowFailures, null);
});

test('workflow-failure zero requires complete expanded-analysis evidence for every call', async () => {
  const fixture = await recordAnalyzedCall({
    bookable_opportunity: false,
    office_follow_up_required: false,
    workflow_failure_code: null,
    workflow_failure_text: null,
  });
  const report = await queryClientReport(
    fixture.store, fixture.config, 'client_A', 'deployment_A', TERMINAL_AS_OF,
  );
  assert.equal(report.workflowFailureEvidenceComplete, true);
  assert.equal(report.observedWorkflowFailures, 0);
  assert.equal(report.structuredAnalysisComplete, true);
});

test('missing required current analysis fields keep expanded evidence incomplete', async () => {
  const fixture = await recordAnalyzedCall({
    bookable_opportunity: false,
    office_follow_up_required: false,
    workflow_failure_code: null,
    workflow_failure_text: null,
  }, (analysis) => { delete analysis.sensitive_data_detected; });
  const report = await queryClientReport(
    fixture.store, fixture.config, 'client_A', 'deployment_A', TERMINAL_AS_OF,
  );
  assert.equal(report.workflowFailureEvidenceComplete, true);
  assert.equal(report.observedWorkflowFailures, 0);
  assert.equal(report.structuredAnalysisComplete, false);
  assert.equal(report.calls[0].analysisEvidenceComplete, false);
  assert.equal(report.calls[0].workflowFailureEvidenceComplete, true);
});

test('privacy-minimized analysis with positive evidence cannot become false-zero reporting', async () => {
  const fixture = await recordAnalyzedCall({
    bookable_opportunity: true,
    office_follow_up_required: true,
    workflow_failure_code: 'office_queue_unavailable',
    workflow_failure_text: ['Caller disclosed SSN 123', '45', '6789'].join('-'),
  });
  const report = await queryClientReport(
    fixture.store, fixture.config, 'client_A', 'deployment_A', TERMINAL_AS_OF,
  );
  assert.equal(report.calls[0].outcome, 'sensitive_data_ended');
  assert.equal(report.calls[0].bookableOpportunity, null);
  assert.equal(report.calls[0].officeFollowUpRequired, null);
  assert.equal(report.calls[0].workflowFailureCode, null);
  assert.equal(report.calls[0].workflowFailureEvidenceComplete, false);
  assert.equal(report.bookableOpportunities, null);
  assert.equal(report.officeFollowUpCalls, null);
  assert.equal(report.observedWorkflowFailures, null);
});
