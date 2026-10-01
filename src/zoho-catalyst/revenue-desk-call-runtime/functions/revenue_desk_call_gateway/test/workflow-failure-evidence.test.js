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
  assert.equal(summary.schemaVersion, 3);
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


test('configuration failure erases personal content despite confirmed callback and false sensitive flag', async () => {
  const fixture = await recordAnalyzedCall({
    outcome: 'configuration_failure', callback_number_confirmed: true,
    sensitive_data_detected: false, office_follow_up_required: true,
    bookable_opportunity: false, workflow_failure_code: 'configuration_unresolved',
    workflow_failure_text: 'Synthetic caller details must not persist',
    caller_name: 'Synthetic Caller', caller_intent: 'Synthetic personal request',
    specific_person_requested: 'Synthetic person',
  });
  const report = await queryClientReport(
    fixture.store, fixture.config, 'client_A', 'deployment_A', TERMINAL_AS_OF,
  );
  const call = report.calls[0];
  assert.equal(call.outcome, 'configuration_failure');
  assert.equal(call.analysisEvidenceComplete, false);
  assert.equal(call.workflowFailureEvidenceComplete, false);
  assert.equal(call.officeFollowUpRequired, null);
  assert.equal(call.workflowFailureCode, null);
  assert.equal(report.observedWorkflowFailures, null);
  const { extractAnalysis } = require('../lib/analysis');
  const analysis = extractAnalysis({ call_analysis: { custom_analysis_data: {
    outcome: 'configuration_failure', callback_number: '+12025550123',
    callback_number_confirmed: true, sensitive_data_detected: false,
    caller_name: 'Synthetic Caller', caller_intent: 'Synthetic request',
    issue_summary: 'Synthetic issue', city_or_zip: 'Synthetic city',
    specific_person_requested: 'Synthetic person',
  } } });
  for (const field of ['callerName', 'callbackNumber', 'callbackNumberConfirmed',
    'callerIntent', 'issueSummary', 'cityOrZip', 'specificPersonRequested',
    'bookableOpportunity', 'officeFollowUpRequired', 'workflowFailureText']) {
    assert.equal(analysis[field], null, field);
  }
  assert.equal(analysis.sensitiveDataMinimized, true);
});

test('privacy erasure preserves explicit immediate-danger category through canonical reporting', async () => {
  for (const outcome of ['unresolved', 'configuration_failure']) {
    const fixture = await recordAnalyzedCall({
      outcome, urgency: 'immediate_danger', sensitive_data_detected: true,
      callback_number_confirmed: true, bookable_opportunity: false,
      office_follow_up_required: true,
    });
    const report = await queryClientReport(
      fixture.store, fixture.config, 'client_A', 'deployment_A', TERMINAL_AS_OF,
    );
    assert.equal(report.calls[0].outcome,
      outcome === 'configuration_failure' ? outcome : 'sensitive_data_ended');
    assert.equal(report.calls[0].urgency, 'immediate_danger');
    assert.equal(report.calls[0].safetyFlag, true);
    assert.equal(report.calls[0].bookableOpportunity, null);
    assert.equal(report.calls[0].analysisEvidenceComplete, false);
  }
});


async function priorTerminalReceipt(outcome, completed, legacyCallback = false) {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const event = eventPayload('call_analyzed', 'prior_terminal_A',
    inbound.body.call_inbound.metadata, 'A', {
      outcome, urgency: outcome === 'unresolved' ? 'immediate_danger' : 'routine',
      sensitive_data_detected: outcome === 'unresolved', callback_number_confirmed: true,
    });
  if (legacyCallback) delete event.call.call_analysis.custom_analysis_data.callback_number_confirmed;
  await invoke(fixture.listener, { url: '/retell/events', payload: event,
    env: fixture.env, processJobs: completed });
  const receipt = fixture.store.rows.get('RevenueDeskEventReceipts')
    .find((row) => row.RECEIPT_KIND === 'provider_event');
  const prior = JSON.parse(receipt.EVENT_DATA_JSON);
  prior.analysis = { ...require('../lib/analysis').priorTerminalAnalysis(event.call) };
  if (legacyCallback) {
    delete prior.analysis.callbackNumberConfirmed;
    prior.analysis.callbackNumber = prior.analysis.sensitiveDataMinimized ? null
      : event.call.call_analysis.custom_analysis_data.callback_number;
  }
  receipt.EVENT_DATA_JSON = JSON.stringify(prior);
  return { fixture, event, receipt };
}

test('exact prior terminal receipt replay preserves completed evidence without replaying effects', async () => {
  for (const outcome of ['configuration_failure', 'unresolved']) {
    const { fixture, event, receipt } = await priorTerminalReceipt(outcome, true);
    const before = structuredClone(receipt);
    const replay = await invoke(fixture.listener, { url: '/retell/events', payload: event,
      env: fixture.env, processJobs: false });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.duplicate, true);
    assert.deepEqual(receipt, before);
    assert.equal(fixture.jobQueue.length, 0);
    assert.equal(fixture.mailAccesses, 0);
    event.call.call_analysis.custom_analysis_data.issue_summary = 'Changed synthetic issue';
    const changed = await invoke(fixture.listener, { url: '/retell/events', payload: event,
      env: fixture.env, processJobs: false });
    assert.equal(changed.status, 400);
    assert.deepEqual(receipt, before);
  }
});

test('prior pending configuration failure is held before HTTP replay or worker recovery can expose content', async () => {
  const { fixture, event, receipt } = await priorTerminalReceipt('configuration_failure', false);
  const before = structuredClone(receipt);
  const replay = await invoke(fixture.listener, { url: '/retell/events', payload: event,
    env: fixture.env, processJobs: false });
  assert.equal(replay.status, 409);
  assert.deepEqual(receipt, before);
  await fixture.listener.processQueuedJobs();
  assert.equal(fixture.store.rows.get('RevenueDeskCalls').length, 0);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0);
  assert.equal(fixture.workerErrors.at(-1).code, 'REPORT_RECONCILIATION_REQUIRED');
  assert.deepEqual(receipt, before);
  assert.equal(fixture.mailAccesses, 0);
});

test('historical unminimized configuration-failure canonical record requires correction and re-attestation', async () => {
  const fixture = await recordAnalyzedCall({ outcome: 'configuration_failure' });
  const row = fixture.store.rows.get('RevenueDeskCalls')[0];
  const prior = JSON.parse(row.CANONICAL_CALL_JSON);
  prior.sensitiveDataMinimized = false;
  prior.callerName = 'Synthetic historical caller';
  row.CANONICAL_CALL_JSON = JSON.stringify(prior);
  await assert.rejects(queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', TERMINAL_AS_OF), { code: 'REPORT_DATA_INVALID' });
});


test('historical terminal notification retry is contained before preparation or provider attempts', async () => {
  const { createWorkerJobHandler } = require('../lib/job-handler');
  const { retryJobRequest, retryJobContext } = require('./runtime-fixture');
  for (const status of ['Pending', 'RetryRequired']) {
   for (const historicalSafety of [false, true]) {
    const fixture = await recordAnalyzedCall({
      outcome: historicalSafety ? 'sensitive_data_ended' : 'configuration_failure',
    });
    const call = fixture.store.rows.get('RevenueDeskCalls')[0];
    const notification = fixture.store.rows.get('RevenueDeskNotifications')[0];
    const prior = JSON.parse(call.CANONICAL_CALL_JSON);
    if (historicalSafety) call.SOURCE_REVISION = 'a'.repeat(40);
    else {
      prior.sensitiveDataMinimized = false;
      prior.callerName = 'Synthetic historical caller';
    }
    call.CANONICAL_CALL_JSON = JSON.stringify(prior);
    notification.STATUS = status;
    notification.NEXT_ATTEMPT_AT = new Date(fixture.clock.value - 1000).toISOString();
    notification.ATTEMPT_COUNT = 0;
    call.NOTIFICATION_STATE = status;
    const immutable = [notification.NOTIFICATION_KEY, notification.PAYLOAD_JSON,
      notification.TEMPLATE_VERSION, notification.RECIPIENT_FINGERPRINT];
    const canonical = call.CANONICAL_CALL_JSON;
    const env = { ...fixture.env, REVENUE_DESK_NOTIFICATION_MODE: 'send_development' };
    const handler = createWorkerJobHandler({ catalystSdk: fixture.catalystSdk,
      environment: env, artifactSourceRevision: fixture.env.SOURCE_REVISION, now: () => fixture.clock.value, storeFactory: () => fixture.store });
    await handler(retryJobRequest(env), retryJobContext());
    assert.equal(notification.STATUS, 'ReconciliationRequired');
    assert.equal(call.NOTIFICATION_STATE, 'ReconciliationRequired');
    assert.equal(notification.ATTEMPT_COUNT, 0);
    assert.equal(notification.SEND_TOKEN, null);
    assert.equal(fixture.mailAccesses, 0);
    assert.equal(call.CANONICAL_CALL_JSON, canonical);
    assert.deepEqual([notification.NOTIFICATION_KEY, notification.PAYLOAD_JSON,
      notification.TEMPLATE_VERSION, notification.RECIPIENT_FINGERPRINT], immutable);
   }
  }
});

 test('combined old terminal and callback receipt preserves completed bytes and holds pending',async()=>{
  for(const completed of [true,false]){
   const {fixture,event,receipt}=await priorTerminalReceipt('configuration_failure',completed,true);
   const before=structuredClone(receipt),queued=fixture.jobQueue.length;
   const result=await invoke(fixture.listener,{url:'/retell/events',payload:event,env:fixture.env,processJobs:false});
   assert.equal(result.status,completed?200:409);assert.deepEqual(receipt,before);
   assert.equal(fixture.jobQueue.length,queued);assert.equal(fixture.mailAccesses,0);
   event.call.call_analysis.custom_analysis_data.issue_summary='Changed synthetic issue';
   const changed=await invoke(fixture.listener,{url:'/retell/events',payload:event,env:fixture.env,processJobs:false});
   assert.equal(changed.status,400);assert.deepEqual(receipt,before);
  }
 });
 test('signed returning-customer new work keeps intent; absent intent is Unknown',async()=>{
  for(const explicit of [true,false]){
   const data={outcome:'potential_job',customer_type:'existing',bookable_opportunity:true};
   if(explicit)data.request_kind='new_service_request';
   const fixture=await recordAnalyzedCall(data);
   const canonical=JSON.parse(fixture.store.rows.get('RevenueDeskCalls')[0].CANONICAL_CALL_JSON);
   const report=await queryClientReport(fixture.store,fixture.config,'client_A','deployment_A',TERMINAL_AS_OF);
   assert.equal(canonical.requestKind,explicit?'new_service_request':'unknown');
   assert.equal(canonical.bookableOpportunity,explicit?true:null);
   assert.equal(report.calls[0].requestKind,canonical.requestKind);
   assert.equal(report.calls[0].bookableOpportunity,canonical.bookableOpportunity);
  }
 });
