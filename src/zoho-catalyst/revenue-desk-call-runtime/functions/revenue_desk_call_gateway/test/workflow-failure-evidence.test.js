'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCrmReportSummary } = require('../lib/crm-report-outbox');
const { queryClientReport } = require('../lib/reporting');
const { createRuntimeService, loadDeployment } = require('../lib/runtime-service');
const { CatalystMailAdapter } = require('../lib/catalyst-mail');
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

function makeReceiptDue(fixture, receipt, status) {
  const dueAt = new Date(fixture.clock.value - 1000).toISOString();
  Object.assign(receipt, {
    STATUS: status, RECEIVED_AT: dueAt, PROCESSED_AT: null,
    LEASE_TOKEN: null,
    LEASE_EXPIRES_AT: status === 'Processing' ? dueAt : null,
    NEXT_ATTEMPT_AT: status === 'RetryRequired' ? dueAt : null,
  });
  if (status === 'Processing') receipt.LEASE_TOKEN = 'b'.repeat(32);
}

function eventRetryService(fixture) {
  const mailAdapter = new CatalystMailAdapter({ app: fixture.app, config: fixture.config });
  let preparations = 0;
  const prepare = mailAdapter.prepare.bind(mailAdapter);
  mailAdapter.prepare = (...args) => { preparations += 1; return prepare(...args); };
  return {
    service: createRuntimeService({ store: fixture.store, mailAdapter,
      config: fixture.config, now: () => fixture.clock.value }),
    get preparations() { return preparations; },
  };
}

async function queuedAnalysisReceipt(data) {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const event = eventPayload('call_analyzed', 'retry_analysis_A',
    inbound.body.call_inbound.metadata, 'A', data);
  const response = await invoke(fixture.listener, { url: '/retell/events',
    payload: event, env: fixture.env, processJobs: false });
  assert.equal(response.status, 200);
  const receipt = fixture.store.rows.get(fixture.config.tables.EVENT_RECEIPT_TABLE)
    .find((row) => row.RECEIPT_KIND === 'provider_event');
  return { fixture, event, receipt };
}

for (const status of ['Pending', 'Queued', 'RetryRequired', 'Processing']) {
  for (const outcome of ['configuration_failure', 'unresolved']) {
    test(`event retry scan holds historical ${outcome} in due ${status} before any mutation`, async () => {
      const { fixture, receipt } = await priorTerminalReceipt(outcome, false);
      receipt.SOURCE_REVISION = 'a'.repeat(40);
      makeReceiptDue(fixture, receipt, status);
      const deploymentRow = fixture.store.rows.get(fixture.config.tables.DEPLOYMENT_TABLE)[0];
      const deployment = await loadDeployment(fixture.store, deploymentRow, fixture.config);
      assert.equal(deployment.deploymentId, 'deployment_A',
        'current approved ownership must not mask the historical receipt guard');
      const before = structuredClone(fixture.store.rows);
      const retry = eventRetryService(fixture);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await retry.service.retryDueEvents();
        assert.equal(fixture.store.rows.get(fixture.config.tables.CANONICAL_CALL_TABLE).length, 0);
        assert.equal(fixture.store.rows.get(fixture.config.tables.NOTIFICATION_TABLE).length, 0);
        assert.equal(retry.preparations, 0);
        assert.equal(fixture.mailAccesses, 0);
        assert.deepEqual(fixture.store.rows, before,
          'held evidence, counters, leases and outboxes remain byte-for-byte unchanged');
        assert.deepEqual(result, { examined: 1, results: [
          { status: 'Failed', errorCode: 'REPORT_RECONCILIATION_REQUIRED' },
        ] });
      }
    });
  }
}

for (const bookableOpportunity of [true, false, null]) {
  test(`event retry scan normalizes missing legacy intent with bookability ${bookableOpportunity}`, async () => {
    const { fixture, event, receipt } = await queuedAnalysisReceipt({
      outcome: 'potential_job', bookable_opportunity: bookableOpportunity,
    });
    const prior = JSON.parse(receipt.EVENT_DATA_JSON);
    prior.analysis = require('../lib/analysis').priorRequestIntentAnalysis(event.call);
    receipt.EVENT_DATA_JSON = JSON.stringify(prior);
    receipt.SOURCE_REVISION = 'a'.repeat(40);
    makeReceiptDue(fixture, receipt, 'RetryRequired');
    const originalPayload = receipt.EVENT_DATA_JSON;
    const retry = eventRetryService(fixture);
    const result = await retry.service.retryDueEvents();
    assert.equal(result.results[0].status, 'Completed');
    const canonical = JSON.parse(fixture.store.rows.get(fixture.config.tables.CANONICAL_CALL_TABLE)[0]
      .CANONICAL_CALL_JSON);
    assert.equal(canonical.requestKind, 'unknown');
    assert.equal(canonical.bookableOpportunity, bookableOpportunity === true ? null : bookableOpportunity);
    assert.equal(receipt.EVENT_DATA_JSON, originalPayload,
      'normalization must not rewrite durable historical evidence');
    assert.equal(fixture.mailAccesses, 0);
  });
}

for (const recovery of ['retry scan', 'direct processing']) {
 test(`event ${recovery} contains changed claimed evidence without a stranded processing lease`, async () => {
  const { fixture, receipt } = await queuedAnalysisReceipt({ outcome: 'configuration_failure' });
  const changed = JSON.parse(receipt.EVENT_DATA_JSON);
  changed.analysis.sensitiveDataMinimized = false;
  changed.analysis.callerName = 'Synthetic historical content';
  const changedPayload = JSON.stringify(changed);
  const mutate = fixture.store.mutate.bind(fixture.store);
  let changedBeforeClaim = false;
  fixture.store.mutate = async (table, column, key, ...args) => {
    if (!changedBeforeClaim && table === fixture.config.tables.EVENT_RECEIPT_TABLE
      && key === receipt.EVENT_KEY) {
      changedBeforeClaim = true;
      receipt.EVENT_DATA_JSON = changedPayload;
      receipt.SOURCE_REVISION = 'a'.repeat(40);
    }
    return mutate(table, column, key, ...args);
  };
  const retry = eventRetryService(fixture);
  let result;
  if (recovery === 'direct processing') {
    await assert.rejects(retry.service.processEventReceipt(receipt.EVENT_KEY),
      { code: 'REPORT_RECONCILIATION_REQUIRED' });
  } else result = await retry.service.retryDueEvents();
  assert.equal(changedBeforeClaim, true);
  assert.equal(fixture.store.rows.get(fixture.config.tables.CANONICAL_CALL_TABLE).length, 0);
  assert.equal(fixture.store.rows.get(fixture.config.tables.NOTIFICATION_TABLE).length, 0);
  assert.equal(fixture.store.rows.get(fixture.config.tables.DEPLOYMENT_TABLE)[0].HANDLED_COUNT, 0);
  assert.equal(retry.preparations, 0);
  assert.equal(fixture.mailAccesses, 0);
  assert.equal(receipt.EVENT_DATA_JSON, changedPayload);
  assert.equal(receipt.STATUS, 'TerminalFailure');
  assert.equal(receipt.LAST_ERROR_CODE, 'REPORT_RECONCILIATION_REQUIRED');
  assert.equal(receipt.LEASE_TOKEN, null);
  assert.equal(receipt.LEASE_EXPIRES_AT, null);
  if (recovery === 'retry scan') assert.deepEqual(result, { examined: 1, results: [
      { status: 'TerminalFailure', errorCode: 'REPORT_RECONCILIATION_REQUIRED' },
    ] });
 });
}

for (const scenario of [
  { name: 'current minimized configuration failure', status: 'Pending',
    data: { outcome: 'configuration_failure' } },
  { name: 'current minimized sensitive outcome with unknown urgency', status: 'Queued',
    data: { outcome: 'sensitive_data_ended', urgency: 'unknown' } },
  { name: 'historical minimized sensitive outcome with explicit danger', status: 'RetryRequired',
    historical: true, data: { outcome: 'sensitive_data_ended', urgency: 'immediate_danger' } },
  { name: 'current explicit new-service opportunity', status: 'Processing',
    data: { outcome: 'potential_job', request_kind: 'new_service_request', bookable_opportunity: true } },
]) {
  test(`event retry scan preserves valid ${scenario.name}`, async () => {
    const { fixture, receipt } = await queuedAnalysisReceipt(scenario.data);
    if (scenario.historical) receipt.SOURCE_REVISION = 'a'.repeat(40);
    makeReceiptDue(fixture, receipt, scenario.status);
    const originalPayload = receipt.EVENT_DATA_JSON;
    const retry = eventRetryService(fixture);
    const result = await retry.service.retryDueEvents();
    assert.equal(result.results[0].status, 'Completed');
    assert.equal(receipt.STATUS, 'Completed');
    assert.equal(receipt.EVENT_DATA_JSON, originalPayload);
    const canonical = JSON.parse(fixture.store.rows.get(fixture.config.tables.CANONICAL_CALL_TABLE)[0]
      .CANONICAL_CALL_JSON);
    assert.equal(canonical.outcome, scenario.data.outcome);
    if (scenario.data.urgency) assert.equal(canonical.urgency, scenario.data.urgency);
    if (scenario.data.request_kind) {
      assert.equal(canonical.requestKind, 'new_service_request');
      assert.equal(canonical.bookableOpportunity, true);
    } else assert.equal(canonical.sensitiveDataMinimized, true);
    assert.equal(fixture.store.rows.get(fixture.config.tables.DEPLOYMENT_TABLE)[0].HANDLED_COUNT, 1);
    assert.equal(fixture.store.rows.get(fixture.config.tables.NOTIFICATION_TABLE).length, 1);
    assert.ok(retry.preparations > 0);
    assert.equal(fixture.mailAccesses, 0);
    const after = structuredClone(fixture.store.rows);
    assert.deepEqual(await retry.service.retryDueEvents(), { examined: 0, results: [] });
    assert.deepEqual(fixture.store.rows, after);
  });
}

test('admitted retry-scan Job fails closed on held historical evidence and accepts current evidence', async () => {
  const { createWorkerJobHandler } = require('../lib/job-handler');
  const { retryJobRequest, retryJobContext } = require('./runtime-fixture');
  for (const historical of [true, false]) {
    const { fixture, receipt } = historical
      ? await priorTerminalReceipt('unresolved', false)
      : await queuedAnalysisReceipt({ outcome: 'sensitive_data_ended', urgency: 'unknown' });
    if (historical) receipt.SOURCE_REVISION = 'a'.repeat(40);
    const before = structuredClone(receipt);
    const handler = createWorkerJobHandler({ catalystSdk: fixture.catalystSdk,
      environment: fixture.env, artifactSourceRevision: fixture.env.SOURCE_REVISION,
      now: () => fixture.clock.value, storeFactory: () => fixture.store });
    if (historical) {
      await assert.rejects(handler(retryJobRequest(fixture.env), retryJobContext()),
        { code: 'WORKER_MODE_FAILED' });
      assert.deepEqual(receipt, before);
      assert.equal(fixture.store.rows.get(fixture.config.tables.CANONICAL_CALL_TABLE).length, 0);
      assert.equal(fixture.store.rows.get(fixture.config.tables.NOTIFICATION_TABLE).length, 0);
      assert.equal(fixture.store.rows.get(fixture.config.tables.DEPLOYMENT_TABLE)[0].HANDLED_COUNT, 0);
    } else {
      const result = await handler(retryJobRequest(fixture.env), retryJobContext());
      assert.equal(result.events.results[0].status, 'Completed');
      assert.equal(receipt.STATUS, 'Completed');
    }
    assert.equal(fixture.mailAccesses, 0);
  }
});

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
