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
  const guards = new Map();
  const guardKey = (binding) => binding.dealId;
  const exactBinding = (guard, binding) => ['dealId', 'accountId', 'deploymentId',
    'configurationVersion'].every((key) => guard[key] === binding[key]);
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
    async readReportGuard(binding) {
      const guard = guards.get(guardKey(binding));
      assert.ok(!guard || exactBinding(guard, binding), 'Report guard binding cannot change');
      return structuredClone(guard || null);
    },
    async claimReportGuard(binding, operationKey, expectedConfirmedKey) {
      const key = guardKey(binding);
      let guard = guards.get(key);
      if (!guard) {
        guard = { ...structuredClone(binding), confirmedOperationKey: null,
          inflightOperationKey: null };
        guards.set(key, guard);
      }
      assert.ok(exactBinding(guard, binding), 'Report guard binding cannot change');
      const claimed = guard.confirmedOperationKey === expectedConfirmedKey
        && (guard.inflightOperationKey === null || guard.inflightOperationKey === operationKey);
      if (claimed) guard.inflightOperationKey = operationKey;
      return { claimed, guard: structuredClone(guard) };
    },
    async completeReportGuard(binding, operationKey) {
      const guard = guards.get(guardKey(binding));
      assert.ok(guard && exactBinding(guard, binding), 'Exact report guard is required');
      const completed = guard.inflightOperationKey === operationKey
        || (guard.inflightOperationKey === null && guard.confirmedOperationKey === operationKey);
      if (completed) Object.assign(guard, {
        confirmedOperationKey: operationKey, inflightOperationKey: null,
      });
      return { completed, guard: structuredClone(guard) };
    },
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
      Subscription_Acceptance_Version: null, Subscription_Start_Date: null,
      Subscription_Status: null, Billing_Customer_ID: null, Billing_Subscription_ID: null,
      Plan: null,
    },
    account: structuredClone(inputs[index].crm.account),
  }]));
  const effects = { reads: 0, writes: 0, dispatches: 0, replayed: 0, failureCodes: [] };
  const config = {
    analyticsPartitionSecret: runtime.config.analyticsPartitionSecret,
    deploymentEnvironment: 'development', sourceRevision: runtime.config.sourceRevision,
    revenueDeskPipelineValue: 'Revenue Desk Sales', freeTestEntryOfferValue: 'Free 7-Day Missed-Call',
    initialSaleTypeValue: 'Initial Sale', testCompletedStatusValue: 'Completed',
    reportMutableStageValue: 'Test Live',
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
    if (options.controlVersionIdentity) {
      // The control service uses one immutable version identity. Establish that
      // fixture identity before generating its simulated authorization history.
      configRows[index].CONFIGURATION_VERSION_ID = config.configurationVersion;
      deploymentRows[index].ACTIVE_CONFIGURATION_VERSION_ID = config.configurationVersion;
    }
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
  const inbound = (letter, timestamp) => invoke('/retell/inbound', fixture.payloadInbound(letter, timestamp));
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

// Reuse the same fictional setup in a separate memory-only rehearsal so the
// original expiry/call-limit reports remain immutable. The production control
// service owns the revoke claim, decision, persistence and replay; only storage,
// CRM and the route readback are fakes. No live provider adapter is constructed.
async function earlyStopRehearsal() {
  const h = await createOfflineHarness({ controlVersionIdentity: true });
  const { createRouteControlService } = require(path.join(runtimeRoot, 'lib/route-control-service'));
  const { verifyAuthorizationReceiptIntegrity } = require(path.join(runtimeRoot, 'lib/authorization-receipt'));
  const store = h.runtime.store;
  const tables = h.runtime.config.tables;
  const deployment = () => store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', 'deployment_A');
  const original = await deployment();
  const originalReceipts = structuredClone(store.authorizationRows);
  const activation = originalReceipts.find((row) => row.EVENT_KEY === original.ACTIVATION_EVENT_KEY);
  const binding = verifyAuthorizationReceiptIntegrity(activation,
    h.runtime.config.authorizationEventSecret).data.controlBinding;
  const crmState = structuredClone(h.crm.contexts.get(h.configurations[0].crmDealId).deal);
  // The existing runtime fixture supplies simulated approval/activation facts;
  // this is not a new claim about the accepted live Form 1/Form 2 lineage.
  Object.assign(crmState, { Intake_Submission_ID: binding.journeyId,
    Go_Live_Approval_Status: 'Approved', Go_Live_Approved_At: original.GO_LIVE_APPROVED_AT,
    Approved_Deployment_Record_ID: original.DEPLOYMENT_ID,
    Approved_Configuration_Version: original.ACTIVE_CONFIGURATION_VERSION_ID,
    Test_Start_At: original.ACTUAL_START_AT, Test_End_At: null });
  const effects = { routeReadbacks: 0, crmRollbackWrites: 0 };
  const memoryControlStore = {
    unique: (...args) => store.unique(...args),
    insertUnique: (...args) => store.insertUnique(...args),
    mutate: (...args) => store.mutate(...args),
    async queryBounded(table, column, value, order, limit, additional = {}) {
      const rows = [...store.rows.get(table),
        ...(table === tables.EVENT_RECEIPT_TABLE ? store.authorizationRows : [])];
      return structuredClone(rows.filter((row) => String(row[column]) === String(value)
        && Object.entries(additional).every(([key, expected]) => String(row[key]) === String(expected)))
        .sort((a, b) => String(a[order]).localeCompare(String(b[order]))).slice(0, limit));
    },
    async conditionalUpdate(table, rowId, patch, expected) {
      assert.ok(Object.keys(expected).length <= 4);
      const row = store.rows.get(table).find((candidate) => String(candidate.ROWID) === String(rowId));
      assert.ok(row, 'Control writes require an existing synthetic row');
      if (Object.entries(expected).every(([key, value]) => (row[key] ?? null) === value)) {
        Object.assign(row, structuredClone(patch));
      }
      return structuredClone(row);
    },
  };
  const service = createRouteControlService({
    config: { environment: 'development', deploymentMode: 'active',
      sourceRevision: h.runtime.config.sourceRevision, tables,
      operatorVerificationSecret: 'synthetic_operator_only_'.padEnd(32, 'x'),
      eventChainSecret: h.runtime.config.authorizationEventSecret,
      operatorIdHash: `operator_${'e'.repeat(64)}` },
    store: memoryControlStore, now: () => h.runtime.clock.value,
    crm: {
      async getDeal(id) { assert.equal(id, crmState.id); return structuredClone(crmState); },
      async recordRollback(id, value) {
        assert.equal(id, crmState.id);
        assert.equal(value.routeInactive, true);
        const patch = { Stage: 'Closed Lost', Test_Status: 'Rolled Back',
          Test_End_At: value.stoppedAt, Test_End_Reason: value.reason,
          Rollback_Completed_At: value.stoppedAt };
        if (Object.entries(patch).some(([key, expected]) => crmState[key] !== expected)) {
          effects.crmRollbackWrites += 1;
          Object.assign(crmState, patch);
        }
        return structuredClone(crmState);
      },
    },
    provider: { async disableRoute({ deployment: row }) {
      assert.equal(row.DEPLOYMENT_ID, original.DEPLOYMENT_ID);
      assert.equal((await deployment()).TEST_STATUS, 'Stopped', 'Contain admission before route work');
      effects.routeReadbacks += 1;
      return { status: 'route_inactive', instructions: 'SIMULATED ONLY: original handling is not verified.' };
    } },
  });
  const firstAdmission = await h.inbound('A', h.runtime.clock.value);
  assert.equal(firstAdmission.status, 200);
  h.runtime.clock.value += 1;
  const secondAdmission = await h.inbound('A', h.runtime.clock.value);
  assert.equal(secondAdmission.status, 200);
  const firstMetadata = firstAdmission.body.call_inbound.metadata;
  const secondMetadata = secondAdmission.body.call_inbound.metadata;
  assert.notEqual(firstMetadata.correlation_id, secondMetadata.correlation_id);
  assert.equal(firstMetadata.resolver_status, 'Resolved');
  assert.equal(secondMetadata.resolver_status, 'Resolved');
  await h.event('A', firstMetadata, 'before_operator_stop');
  const before = await deployment();
  h.runtime.clock.value += 1000;
  const command = { dealId: binding.dealId, journeyId: binding.journeyId,
    deploymentId: original.DEPLOYMENT_ID,
    configurationVersionId: original.ACTIVE_CONFIGURATION_VERSION_ID,
    idempotencyKey: '00000000-0000-4000-8000-000000000009', reason: 'operator_requested' };
  const stopped = await service.rollback(command);
  assert.equal(stopped.deployment.TEST_STATUS, 'Stopped');
  assert.equal(stopped.deployment.GO_LIVE_APPROVAL_STATUS, 'Revoked');
  assert.notEqual((await h.inbound('A')).body?.call_inbound?.metadata?.resolver_status, 'Resolved');
  // Admission ended, but a previously admitted call retains its immutable
  // interval and may settle. Late evidence must not restart the route or clock.
  await h.event('A', secondMetadata, 'already_admitted_after_stop');
  const settled = await deployment();
  for (const key of ['TEST_STATUS', 'GO_LIVE_APPROVAL_STATUS', 'STOP_REASON',
    'STOPPED_AT', 'ACTUAL_START_AT', 'EXPIRES_AT']) {
    assert.equal(settled[key], stopped.deployment[key]);
  }
  const receiptsBeforeReplay = structuredClone(store.rows.get(tables.EVENT_RECEIPT_TABLE));
  const replay = await service.rollback(command);
  assert.equal(replay.replayed, true);
  assert.deepEqual(await deployment(), settled);
  assert.deepEqual(store.rows.get(tables.EVENT_RECEIPT_TABLE), receiptsBeforeReplay);
  assert.deepEqual(store.authorizationRows, originalReceipts);
  assert.equal(effects.crmRollbackWrites, 1);
  assert.equal(h.runtime.mailAccesses, 0);
  const report = await h.report('A');
  assert.equal(report.callsCaptured, 2);
  assert.equal(report.testEndReason, 'Sylvara Stopped');
  assert.equal(report.testEnd, settled.STOPPED_AT);
  assert.ok(Date.parse(report.sourceModifiedAt) >= Date.parse(settled.STOPPED_AT));
  assert.ok(Date.parse(report.sourceModifiedAt) >= Math.max(...store.rows.get('RevenueDeskCalls')
    .map((row) => Date.parse(row.UPDATED_AT))));
  const receipts = store.rows.get(tables.EVENT_RECEIPT_TABLE);
  return { evidenceClass: 'production_control_service_with_memory_adapters',
    before: { testStatus: before.TEST_STATUS, callsCaptured: Number(before.HANDLED_COUNT) },
    after: { testStatus: settled.TEST_STATUS, approvalStatus: settled.GO_LIVE_APPROVAL_STATUS,
      stopReason: settled.STOP_REASON, stoppedAt: settled.STOPPED_AT,
      callsCaptured: Number(settled.HANDLED_COUNT) },
    report: { callsCaptured: report.callsCaptured, testEndReason: report.testEndReason,
      testEnd: report.testEnd, sourceModifiedAt: report.sourceModifiedAt },
    newAdmissionRejected: true, alreadyAdmittedCallSettled: Number(settled.HANDLED_COUNT) === 2,
    terminalEvidencePreserved: true, sameCommandReplay: replay.replayed,
    revocationReceiptCount: receipts.filter((row) => row.EVENT_TYPE === 'revoke').length,
    rollbackClaimStatus: receipts.find((row) => row.EVENT_TYPE === 'rollback_claim').STATUS,
    crmRollbackReadback: crmState.Test_Status === 'Rolled Back',
    originalHandlingRestorationVerified: false,
    effects: { network: 0, provider: 0, crm: 0, email: 0, sms: 0 },
    simulatedEffects: { ...effects, rollbackCommands: 2,
      canonicalCalls: store.rows.get('RevenueDeskCalls').length } };
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
    for (let index = 0; index < 25; index += 1) {
      await h.event('B', entries.B, index, { outcome: 'potential_job', bookable_opportunity: true });
    }
    const limitDenied = await h.inbound('B');
    assert.notEqual(limitDenied.body?.call_inbound?.metadata?.resolver_status, 'Resolved');
    h.runtime.clock.value = Date.parse('2026-08-27T12:00:01.000Z');
    const expiryDenied = await h.inbound('A');
    assert.notEqual(expiryDenied.body?.call_inbound?.metadata?.resolver_status, 'Resolved');
    const beforeLate = await h.report('A');
    await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_A' });
    await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_B' });
    await h.job({ mode: 'retry_scan' });
    assert.equal(h.crm.effects.writes, 2);
    assert.equal(h.crm.contexts.get(h.configurations[0].crmDealId).deal.Test_Status, 'Completed');
    assert.equal(h.crm.contexts.get(h.configurations[0].crmDealId)
      .deal.Test_Bookable_Opportunities, 2);
    const originalOperations = h.runtime.store.rows.get('CRMBillingOperations')
      .filter((row) => row.STATUS === 'completed').map((row) => structuredClone(row));
    // An already-admitted call ends late and initially has no analysis. Unknown
    // remains unknown; its first analysis revises the terminal report, not zero.
    await h.event('A', entries.A, 'late', {}, 'call_ended');
    const preliminary = await h.report('A');
    assert.equal(preliminary.bookableOpportunities, null);
    // A newly versioned source event arrives after terminal CRM completion. The
    // report guard advances only from the exact previous confirmed summary.
    await h.event('A', entries.A, 'late', { outcome: 'potential_job', bookable_opportunity: true });
    const revised = await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_A' });
    assert.equal(revised.report.bookableOpportunities, 3);
    assert.notEqual(revised.report.sourceModifiedAt, beforeLate.sourceModifiedAt);
    // The actual worker dispatches the report through the production dispatcher
    // into an in-memory HTTP-shaped adapter and actual CRM lifecycle handler.
    await h.job({ mode: 'retry_scan' });
    const operations = h.runtime.store.rows.get('CRMBillingOperations');
    const latest = [];
    for (const configuration of h.configurations) {
      const guard = await h.crm.operations.readReportGuard({
        dealId: configuration.crmDealId,
        accountId: h.crm.contexts.get(configuration.crmDealId).account.id,
        deploymentId: configuration.deploymentId,
        configurationVersion: configuration.configurationVersion,
      });
      latest.push(operations.find((row) => row.OPERATION_KEY === guard.confirmedOperationKey));
    }
    assert.equal(latest.length, 2);
    assert.equal(operations.filter((row) => row.STATUS === 'completed').length, 3);
    for (const original of originalOperations) {
      assert.deepEqual(operations.find((row) => row.OPERATION_KEY === original.OPERATION_KEY), original);
    }
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
    const operatorStop = await earlyStopRehearsal();
    assert.equal(guard.blocked.length, 0);
    return {
      label: 'SYNTHETIC DEMONSTRATION — NO LIVE CALLS', companies,
      earlyStopRehearsal: operatorStop,
      checks: { distinctCompanyOwnership: true, gatewayWorkerReportConnected: true,
        preparedConfigurationUsed: true, approvalAndActivationExplicitlySimulated: true,
        reportOnlyCrmReadback: true, replayWithoutSecondWrite: true, sevenDayExpiry: true,
        connectedCallLimit: true,
        earlyOperatorStop: true,
        absentAnalysisWithheld: true, lateAnalysisReportRevision: true,
        completedCrmSummaryRevision: true, previousCompletedReceiptPreserved: true,
        actualVoiceOrForwardingProved: false },
      effects: { network: 0, provider: 0, crm: 0, email: 0, sms: 0 },
      simulatedEffects: { ...h.crm.effects,
        inboundEvents: 4, canonicalCalls: h.runtime.store.rows.get('RevenueDeskCalls').length,
        notificationPreviews: companies.reduce((sum, company) => sum + company.notificationPreviews.length, 0) },
    };
  } finally { guard.restore(); }
}

module.exports = { runFreeTestDemo, createOfflineHarness, reportOperationStore };
