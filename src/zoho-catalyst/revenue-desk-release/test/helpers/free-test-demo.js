'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { installOfflineGuard } = require('./offline-guard');

const catalystRoot = path.resolve(__dirname, '../../..');
const runtimeRoot = path.join(catalystRoot,
  'revenue-desk-call-runtime/functions/revenue_desk_call_gateway');
const crmRoot = path.join(catalystRoot,
  'crm-billing-orchestrator/functions/crm_billing_orchestrator');

function forbiddenAdapter() {
  return new Proxy({}, { get() { throw new Error('OFFLINE_ONLY: financial or Analytics adapter'); } });
}

// This memory adapter exercises the production claim/write-start/completion
// protocol. A stale cursor cannot mutate an operation owned by another execution.
function reportOperationStore(runtime) {
  const rows = runtime.store.rows.get('CRMBillingOperations');
  const read = (key) => rows.find((row) => row.OPERATION_KEY === key);
  const transition = (cursor, patch) => {
    const current = read(cursor.OPERATION_KEY);
    const matches = current && ['ROWID', 'OPERATION_FINGERPRINT', 'STATUS',
      'LAST_OUTCOME', 'OPERATION_VERSION'].every((key) => current[key] === cursor[key]);
    if (matches) Object.assign(current, patch, {
      OPERATION_VERSION: Number(current.OPERATION_VERSION) + 1,
    });
    return { matched: Boolean(matches), row: structuredClone(current) };
  };
  return {
    async readByKey(key) { return structuredClone(read(key)); },
    async claimReportSummary(cursor, claimToken, at) {
      const result = transition(cursor, {
        STATUS: 'processing', LAST_OUTCOME: claimToken, UPDATED_AT: at,
      });
      return { claimed: result.matched, row: result.row };
    },
    async beginReportSummaryWrite(cursor, claimToken, at) {
      assert.equal(cursor.LAST_OUTCOME, claimToken);
      const result = transition(cursor, {
        LAST_OUTCOME: claimToken.replace('report_claim_', 'report_write_started_'), UPDATED_AT: at,
      });
      return { started: result.matched, row: result.row };
    },
    async transitionReportSummary(cursor, status, outcome, at) {
      const result = transition(cursor, { STATUS: status, LAST_OUTCOME: outcome, UPDATED_AT: at });
      return { transitioned: result.matched, row: result.row };
    },
  };
}

function crmBridge(runtime, configurations, inputs, options = {}) {
  const { createLifecycleHandler } = require(path.join(crmRoot, 'lib/lifecycle-handler'));
  const { validatePayload } = require(path.join(crmRoot, 'lib/action-contract'));
  const contexts = new Map(configurations.map((config, index) => [config.crmDealId, {
    deal: {
      ...structuredClone(inputs[index].crm.deal),
      id: config.crmDealId, Deal_Name: `ZZZ SYNTHETIC Offline ${index + 1}`,
      Modified_Time: '2026-08-22T12:00:00.000Z',
      Pipeline: 'Revenue Desk Sales', Entry_Offer: 'Free 7-Day Missed-Call', Type: 'Initial Sale',
      Account_Name: structuredClone(inputs[index].crm.deal.Account_Name),
      Deployment_Record_ID: config.deploymentId, Configuration_Version: config.configurationVersion,
      Stage: 'Test Live', Test_Status: 'Live', Results_Review_At: null,
      Subscription_Acceptance_Status: null, Subscription_Accepted_At: null,
      Billing_Customer_ID: null, Billing_Subscription_ID: null,
    },
    account: structuredClone(inputs[index].crm.account),
  }]));
  const effects = { reads: 0, writes: 0, dispatches: 0, replayed: 0, failureCodes: [] };
  const config = {
    analyticsPartitionSecret: runtime.config.analyticsPartitionSecret,
    deploymentEnvironment: 'development', sourceRevision: runtime.config.sourceRevision,
    revenueDeskPipelineValue: 'Revenue Desk Sales', freeTestEntryOfferValue: 'Free 7-Day Missed-Call',
    initialSaleTypeValue: 'Initial Sale', testCompletedStatusValue: 'Completed',
    enablePaidSubscriptionPreparation: false,
  };
  const operations = reportOperationStore(runtime);
  const lifecycle = createLifecycleHandler(config, {
    crmClient: {
      async getContext(id) {
        effects.reads += 1;
        assert.ok(contexts.has(id), 'Exact server-bound synthetic Deal is required');
        return structuredClone(contexts.get(id));
      },
      async updateDealReportSummary(deal, patch) {
        const current = contexts.get(deal.id);
        assert.equal(current.deal.Modified_Time, deal.Modified_Time);
        assert.equal(Object.hasOwn(patch, 'Stage'), false);
        assert.equal(Object.keys(patch).some((key) => key.startsWith('Billing_')), false);
        effects.writes += 1;
        Object.assign(current.deal, patch, {
          Modified_Time: new Date(runtime.clock.value + effects.writes).toISOString(),
        });
        if (options.ambiguousWrite) throw new Error('Synthetic ambiguous write after persistence');
        return structuredClone(current.deal);
      },
    },
    billingClient: forbiddenAdapter(), analyticsOutbox: forbiddenAdapter(),
    operationStore: operations, now: () => runtime.clock.value,
  });
  const fetchImpl = async (url, request) => {
    assert.equal(url, runtime.config.crmBillingOrchestratorUrl);
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.ZCFKEY, runtime.config.crmBillingApiGatewayKey);
    assert.equal(request.headers[runtime.config.crmBillingSharedHeaderName],
      runtime.config.crmBillingSharedHeaderValue);
    effects.dispatches += 1;
    const payload = validatePayload(JSON.parse(request.body));
    assert.equal(payload.action, 'sync_report_summary');
    let result;
    try { result = await lifecycle.handle(payload); } catch (error) {
      effects.failureCodes.push(error.publicCode || 'unexpected');
      throw error;
    }
    if (result.duplicate) effects.replayed += 1;
    return new Response(JSON.stringify({ ok: true, action: payload.action, ...result }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  return { config, contexts, effects, lifecycle, operations, fetchImpl };
}

function workerContext() {
  return { succeeded: 0, failed: 0,
    closeWithSuccess() { this.succeeded += 1; }, closeWithFailure() { this.failed += 1; } };
}

async function createOfflineHarness(options = {}) {
  const fixture = require(path.join(runtimeRoot, 'test/runtime-fixture'));
  const { createWorkerJobHandler } = require(path.join(runtimeRoot, 'lib/job-handler'));
  const { createCrmReportDispatcher } = require(path.join(runtimeRoot, 'lib/crm-report-dispatch'));
  const { queryClientReport, reportToCsv } = require(path.join(runtimeRoot, 'lib/reporting'));
  const { syntheticPreparationInputs } = require('../fixtures/free-test-preparation');
  const { prepareFreeTestConfiguration } = require('../../lib/free-test-preparation');
  const runtime = fixture.runtimeFixture();
  // Align the fictional Journey records with the existing runtime fixture's
  // controlled clock. This touches no accepted evidence or external record.
  const inputs = JSON.parse(JSON.stringify(syntheticPreparationInputs())
    .replaceAll('2026-09-09', '2026-08-20'));
  const preparations = inputs.map((input, index) => {
    const letter = ['A', 'B'][index];
    input.crm.account.Account_Name = `ZZZ ${input.crm.account.Account_Name}`;
    Object.assign(input.review, { clientId: `client_${letter}`, deploymentId: `deployment_${letter}`,
      notificationRecipientId: `recipient_${letter}` });
    return prepareFreeTestConfiguration(input, { now: Date.parse('2026-08-20T12:00:00.000Z') });
  });
  const configurations = preparations.map((prepared) => {
    assert.equal(prepared.status, 'prepared_local_only');
    // The boundary remains visible: the offline harness, not the preparation
    // utility, injects approval and provider activation for backend simulation.
    return { ...structuredClone(prepared.candidate), approved: true,
      notificationRecipient: { ...prepared.candidate.notificationRecipient, approved: true } };
  });
  const deploymentRows = runtime.store.rows.get('RevenueDeskDeployments');
  const configRows = runtime.store.rows.get('RevenueDeskConfigurationVersions');
  runtime.store.authorizationRows = configurations.flatMap((config, index) => {
    Object.assign(configRows[index], { CONFIGURATION_VERSION: config.configurationVersion,
      CONFIGURATION_JSON: JSON.stringify(config) });
    return fixture.authorizationRows(deploymentRows[index], configRows[index], ['A', 'B'][index],
      runtime.config.authorizationEventSecret);
  });
  const crm = crmBridge(runtime, configurations, inputs, options);
  const dispatcher = createCrmReportDispatcher(runtime.config, crm.fetchImpl);
  const worker = createWorkerJobHandler({
    catalystSdk: runtime.catalystSdk, environment: runtime.env,
    artifactSourceRevision: fixture.SOURCE_REVISION, now: () => runtime.clock.value,
    storeFactory: () => runtime.store, dispatcherFactory: () => dispatcher,
  });
  const job = async (params) => {
    const context = workerContext();
    const result = await worker(fixture.retryJobRequest(runtime.env, params), context);
    if (context.failed) throw new Error(`Synthetic worker failed: ${result.errorCode}; ${crm.effects.failureCodes.join(',')}; ${runtime.store.rows.get('CRMBillingOperations').map((row) => row.LAST_OUTCOME).join(',')}`);
    return result;
  };
  const invoke = (url, payload, headers = {}) => fixture.invoke(runtime.listener, {
    url, payload, headers, env: runtime.env, processJobs: false,
    signatureTimestamp: runtime.clock.value,
  });
  const inbound = (letter) => invoke('/retell/inbound', fixture.payloadInbound(letter));
  const event = async (letter, metadata, id, analysis = {}, eventName = 'call_analyzed') => {
    // Existing event fixtures share a synthetic one-minute connected interval;
    // delivery occurs after its end, with a distinct durable update watermark.
    runtime.clock.value = Math.max(runtime.clock.value + 1000, fixture.NOW + 61_000);
    const payload = fixture.eventPayload(eventName, `offline_${letter}_${id}`, metadata, letter, {
      bookable_opportunity: false, office_follow_up_required: false,
      workflow_failure_code: null, workflow_failure_text: null, ...analysis,
    });
    const receipt = await invoke('/retell/events', payload);
    assert.equal(receipt.status, 200);
    while (runtime.jobQueue.length) await job(runtime.jobQueue.shift());
    return payload;
  };
  const report = async (letter) => queryClientReport(runtime.store, runtime.config,
    `client_${letter}`, `deployment_${letter}`, runtime.clock.value);
  return { fixture, runtime, crm, dispatcher, preparations, configurations,
    inbound, invoke, event, job, report, reportToCsv };
}

async function runFreeTestDemo() {
  const guard = installOfflineGuard();
  try {
    const h = await createOfflineHarness();
    const entries = Object.fromEntries(await Promise.all(['A', 'B'].map(async (letter) => {
      const result = await h.inbound(letter);
      assert.equal(result.status, 200);
      return [letter, result.body.call_inbound.metadata];
    })));
    const categories = [
      { outcome: 'potential_job', bookable_opportunity: true, office_follow_up_required: true },
      { outcome: 'urgent_potential_job', urgency: 'urgent', bookable_opportunity: true,
        office_follow_up_required: true },
      { outcome: 'existing_customer', customer_type: 'existing', office_follow_up_required: true },
      { outcome: 'out_of_area', city_or_zip: 'Synthetic outside territory' },
      { outcome: 'spam', caller_intent: 'unsolicited_sales' },
      { outcome: 'other_general_inquiry', workflow_failure_code: 'synthetic_capture_failure',
        workflow_failure_text: 'Illustrative missing intake detail requires operator review.' },
    ];
    for (const [index, analysis] of categories.entries()) await h.event('A', entries.A, index, analysis);
    // One admitted call initially has no analysis. Unknown remains unknown; its
    // late synthetic analysis revises the terminal report instead of becoming zero.
    await h.event('A', entries.A, 'late', {}, 'call_ended');
    const preliminary = await h.report('A');
    assert.equal(preliminary.bookableOpportunities, null);
    for (let index = 0; index < 25; index += 1) {
      await h.event('B', entries.B, index, { outcome: 'potential_job', bookable_opportunity: true });
    }
    const limitDenied = await h.inbound('B');
    assert.notEqual(limitDenied.body?.call_inbound?.metadata?.resolver_status, 'Resolved');
    h.runtime.clock.value = Date.parse('2026-08-27T12:00:01.000Z');
    const expiryDenied = await h.inbound('A');
    assert.notEqual(expiryDenied.body?.call_inbound?.metadata?.resolver_status, 'Resolved');
    const beforeLate = await h.report('A');
    await h.event('A', entries.A, 'late', { outcome: 'potential_job', bookable_opportunity: true });
    const revised = await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_A' });
    assert.equal(revised.report.bookableOpportunities, 3);
    assert.notEqual(revised.report.sourceModifiedAt, beforeLate.sourceModifiedAt);
    await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_B' });
    // The actual worker dispatches the report through the production dispatcher
    // into an in-memory HTTP-shaped adapter and actual CRM lifecycle handler.
    await h.job({ mode: 'retry_scan' });
    const operations = h.runtime.store.rows.get('CRMBillingOperations');
    const latest = operations.filter((row) => row.STATUS === 'completed');
    assert.equal(latest.length, 2);
    const writesBeforeReplay = h.crm.effects.writes;
    for (const operation of latest) await h.dispatcher.dispatch(operation.CRM_DEAL_ID, operation.OPERATION_KEY);
    assert.equal(h.crm.effects.writes, writesBeforeReplay);
    assert.equal(h.crm.effects.replayed, 2);
    const companies = [];
    for (const [index, letter] of ['A', 'B'].entries()) {
      const report = await h.report(letter);
      const state = h.runtime.store.rows.get('RevenueDeskDeployments')
        .find((row) => row.DEPLOYMENT_ID === `deployment_${letter}`);
      const { messageContent } = require(path.join(runtimeRoot, 'lib/catalyst-mail'));
      const { keyedDigest } = require(path.join(runtimeRoot, 'lib/security'));
      const notificationPreviews = h.runtime.store.rows.get('RevenueDeskNotifications')
        .filter((row) => row.CLIENT_ID === `client_${letter}`)
        .map((row) => {
          assert.equal(row.RECIPIENT_FINGERPRINT, keyedDigest(h.runtime.config.eventSecret,
            'free-test-mail-recipient-v1', [h.configurations[index].notificationRecipient.email]));
          const payload = JSON.parse(row.PAYLOAD_JSON);
          return { status: row.STATUS, channel: 'email preview only',
            recipient: h.configurations[index].notificationRecipient.email,
            summary: payload.issueSummary, outcome: payload.callOutcome,
            html: messageContent(payload) };
        });
      companies.push({ key: letter,
        preparation: h.preparations[index],
        report, csv: h.reportToCsv(report), notificationPreviews,
        crmSummary: structuredClone(h.crm.contexts.get(h.configurations[index].crmDealId).deal),
        state: { testStatus: state.TEST_STATUS, stopReason: state.STOP_REASON,
          reconciliation: state.REPORT_RECONCILIATION_STATUS,
          originalHandlingRestoration: 'Not demonstrated: requires controlled live forwarding acceptance.' },
      });
    }
    assert.equal(h.runtime.mailAccesses, 0);
    assert.equal(guard.blocked.length, 0);
    return {
      label: 'SYNTHETIC DEMONSTRATION — NO LIVE CALLS', companies,
      checks: { distinctCompanyOwnership: true, gatewayWorkerReportConnected: true,
        preparedConfigurationUsed: true, approvalAndActivationExplicitlySimulated: true,
        reportOnlyCrmReadback: true, replayWithoutSecondWrite: true, sevenDayExpiry: true,
        connectedCallLimit: true,
        absentAnalysisWithheld: true, lateAnalysisReportRevision: true,
        actualVoiceOrForwardingProved: false },
      effects: { network: 0, provider: 0, crm: 0, email: 0, sms: 0 },
      simulatedEffects: { ...h.crm.effects,
        inboundEvents: 4, canonicalCalls: h.runtime.store.rows.get('RevenueDeskCalls').length,
        notificationPreviews: companies.reduce((sum, company) => sum + company.notificationPreviews.length, 0) },
    };
  } finally { guard.restore(); }
}

module.exports = { runFreeTestDemo, createOfflineHarness, reportOperationStore };
