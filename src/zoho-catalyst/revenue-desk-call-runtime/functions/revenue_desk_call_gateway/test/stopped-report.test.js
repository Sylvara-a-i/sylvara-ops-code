'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStoppedOfflineHarness } = require('../../../../revenue-desk-release/test/helpers/free-test-demo');
const { createRuntimeService, loadDeployment } = require('../lib/runtime-service');
const { buildCrmReportSummary } = require('../lib/crm-report-outbox');
const { assertStoppedReportEvidence } = require('../lib/route-control-service');

function service(h, onTerminalReportReconciled = null) {
  return createRuntimeService({ store: h.runtime.store, config: h.runtime.config,
    mailAdapter: {}, crmSummaryDispatcher: h.dispatcher, now: () => h.runtime.clock.value,
    onTerminalReportReconciled });
}
const rows = (h, table) => h.runtime.store.rows.get(table);
const deployment = (h) => rows(h, 'RevenueDeskDeployments').find((row) => row.DEPLOYMENT_ID === 'deployment_A');

async function dispatch(h) {
  for (const operation of rows(h, 'CRMBillingOperations')) {
    await h.dispatcher.dispatch(operation.CRM_DEAL_ID, operation.OPERATION_KEY);
  }
}

test('manual zero-call and settled early-stop closeouts preserve rollback and replay without a second write', async () => {
  for (const empty of [false, true]) {
    const h = await createStoppedOfflineHarness({ empty });
    const before = structuredClone(deployment(h));
    const attempts = [];
    const runtime = service(h, async (scope) => {
      attempts.push(scope); return { status: 'awaiting_reconciled_evidence' };
    });
    assert.equal((await runtime.reconcileDueDeployments()).examined, 0);
    assert.equal(rows(h, 'CRMBillingOperations').length, 0);
    const built = await runtime.rebuildReport('deployment_A');
    assert.equal(built.terminalSettlementReady, true);
    assert.equal(built.report.callsCaptured, empty ? 0 : 2);
    assert.equal(built.report.testEnd, before.STOPPED_AT);
    assert.equal(built.report.testEndReason, 'Sylvara Stopped');
    assert.equal(JSON.parse(rows(h, 'CRMBillingOperations')[0].OPERATION_PAYLOAD_JSON).testStatus, 'Rolled Back');
    await assert.rejects(runtime.assertStoppedReportReady('deployment_A'), { code: 'REPORT_RECONCILIATION_REQUIRED' });
    await assert.rejects(runtime.reconcileDeployment('deployment_A'), { code: 'REPORT_RECONCILIATION_REQUIRED' });
    assert.equal(attempts.length, 0);
    await dispatch(h);
    const operationCount = rows(h, 'CRMBillingOperations').length;
    const finalCount = rows(h, 'AnalyticsSyncOutbox').filter((row) => row.RECORD_TYPE === 'final_test_result').length;
    assert.equal((await runtime.reconcileDeployment('deployment_A')).status, 'DeploymentReconciled');
    assert.equal((await runtime.assertStoppedReportReady('deployment_A')).testStatus, 'Stopped');
    assert.equal(attempts.length, 1);
    await runtime.reconcileDueDeployments();
    assert.equal(attempts.length, 1, 'Stopped drafts never gain an automatic retry lane');
    await runtime.rebuildReport('deployment_A');
    await dispatch(h);
    await runtime.reconcileDeployment('deployment_A');
    assert.equal(h.crm.effects.writes, 1);
    assert.equal(rows(h, 'CRMBillingOperations').length, operationCount);
    assert.equal(rows(h, 'AnalyticsSyncOutbox').filter((row) => row.RECORD_TYPE === 'final_test_result').length, finalCount);
    assert.deepEqual(deployment(h), before);
    const crm = h.crm.contexts.get(h.configurations[0].crmDealId).deal;
    assert.equal(crm.Test_Status, 'Rolled Back'); assert.equal(crm.Stage, 'Closed Lost');
    assert.equal(crm.Test_End_At, before.STOPPED_AT); assert.equal(crm.Rollback_Completed_At, before.STOPPED_AT);
  }
});

test('pending previously admitted evidence withholds final artifacts until actual settlement', async () => {
  const h = await createStoppedOfflineHarness();
  const receipt = rows(h, 'RevenueDeskEventReceipts').find((row) => row.RECEIPT_KIND === 'provider_event');
  assert.ok(receipt);
  receipt.STATUS = 'RetryRequired';
  const runtime = service(h);
  assert.equal((await runtime.rebuildReport('deployment_A')).status, 'ReportRebuiltAwaitingSettlement');
  await assert.rejects(runtime.reconcileDeployment('deployment_A'), { code: 'REPORT_RECONCILIATION_REQUIRED' });
  assert.equal(rows(h, 'CRMBillingOperations').length, 0);
  assert.equal(rows(h, 'AnalyticsSyncOutbox').some((row) => row.RECORD_TYPE === 'final_test_result'), false);
  receipt.STATUS = 'Completed';
  assert.equal((await runtime.rebuildReport('deployment_A')).terminalSettlementReady, true);
  await dispatch(h);
  assert.equal((await runtime.reconcileDeployment('deployment_A')).status, 'DeploymentReconciled');
});

test('missing, unfinished, forged or differently bound rollback proof cannot produce final artifacts', async () => {
  for (const alter of [
    (h, claim) => { claim.STATUS = 'ReconciliationRequired'; },
    (h, claim) => { claim.PAYLOAD_FINGERPRINT = 'a'.repeat(64); },
    (h, claim) => { claim.CONFIGURATION_VERSION_ID = 'other'; },
    (h, claim) => { rows(h, 'RevenueDeskEventReceipts').splice(rows(h, 'RevenueDeskEventReceipts').indexOf(claim), 1); },
    (h) => { deployment(h).STOPPED_AT = '2026-08-22T12:00:00.000Z'; },
    (h) => { rows(h, 'RevenueDeskEventReceipts').find((row) => row.EVENT_TYPE === 'revoke').STATUS = 'Prepared'; },
  ]) {
    const h = await createStoppedOfflineHarness();
    const claim = rows(h, 'RevenueDeskEventReceipts').find((row) => row.EVENT_TYPE === 'rollback_claim');
    alter(h, claim);
    await assert.rejects(service(h).rebuildReport('deployment_A'));
    assert.equal(rows(h, 'CRMBillingOperations').length, 0);
    assert.equal(rows(h, 'AnalyticsSyncOutbox').some((row) => row.RECORD_TYPE === 'final_test_result'), false);
  }
});

test('rollback proof is freshly validated and cannot be forged by a caller boolean', async () => {
  const h = await createStoppedOfflineHarness();
  const loaded = await loadDeployment(h.runtime.store, deployment(h), h.runtime.config);
  const report = await h.report('A');
  assert.throws(() => buildCrmReportSummary(h.runtime.config,
    { ...loaded, stoppedReportEvidenceValidated: true }, report), { code: 'REPORT_RECONCILIATION_REQUIRED' });
  const proven = await assertStoppedReportEvidence(h.runtime.store, loaded, h.runtime.config);
  assert.equal(buildCrmReportSummary(h.runtime.config, proven, report).testStatus, 'Rolled Back');
});
