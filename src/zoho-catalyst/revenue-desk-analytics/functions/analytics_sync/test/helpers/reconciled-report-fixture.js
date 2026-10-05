'use strict';

// Reuse the accepted offline runtime/CRM harness and Analytics service/store.
// All rows below are synthetic local test state, never provider receipts.
const assert = require('node:assert/strict');
const { createOfflineHarness, createStoppedOfflineHarness } = require('../../../../../revenue-desk-release/test/helpers/free-test-demo');
const { createAnalyticsSyncService } = require('../../lib/service');
const { MemoryStore, serviceConfig } = require('../helpers');
const { createReconciledFreeTestInputReader } = require('../../../../tools/read-reconciled-free-test-input');

const TYPES = ['deployment', 'call', 'final_test_result'];
const READBACK_KEYS = ['RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT', 'PAYLOAD_HASH', 'SOURCE_MODIFIED_AT'];

async function createReconciledReportFixture({ empty = false, reconcile = true, analyses,
  endedBeforeAnalysis = false, mailBehavior, lateFinalCall = false, inFlightOvershoot = false, stopped = false, crmIdentity } = {}) {
  const h = stopped ? await createStoppedOfflineHarness({ empty }) : await createOfflineHarness({ mailBehavior, crmIdentity });
  const runtime = h.runtime;
  const calls = stopped ? Array.from({ length: runtime.store.rows.get('RevenueDeskCalls').length }, () => ({}))
    : analyses === undefined ? (empty ? [] : [{}]) : analyses;
  assert.ok(Array.isArray(calls) && calls.length <= (inFlightOvershoot ? 26 : 25) && (empty ? calls.length === 0 : calls.length >= 1)
    && calls.every((value) => value && typeof value === 'object' && !Array.isArray(value)),
  'Synthetic analyses must be bounded call-analysis objects.');
  assert.ok(!(lateFinalCall && inFlightOvershoot) && (!lateFinalCall || calls.length === 25)
    && (!inFlightOvershoot || calls.length === 26));
  const admitted = [];
  if (inFlightOvershoot) {
    // All admissions precede the stop; already accepted calls remain accountable.
    for (let index = 0; index < calls.length; index += 1) admitted.push(await h.inbound('A'));
    for (const [index, admission] of admitted.entries()) {
      await h.event('A', admission.body.call_inbound.metadata, `reconciled_report_fixture_${index}`, {}, 'call_ended');
    }
  }
  async function analyze(index, admission) {
    await h.event('A', admission.body.call_inbound.metadata, `reconciled_report_fixture_${index}`, {
      caller_intent: 'Synthetic repair request', issue_summary: 'Synthetic leaking tap',
      bookable_opportunity: true, office_follow_up_required: true,
      workflow_failure_code: null, workflow_failure_text: null, ...structuredClone(calls[index]),
    });
  }
  for (const [index] of (stopped ? [] : calls).entries()) {
    const admission = inFlightOvershoot ? admitted[index] : await h.inbound('A');
    if (lateFinalCall && index === calls.length - 1) { admitted.push(admission); break; }
    if (endedBeforeAnalysis && !inFlightOvershoot) {
      await h.event('A', admission.body.call_inbound.metadata, `reconciled_report_fixture_${index}`, {}, 'call_ended');
    }
    await analyze(index, admission);
  }
  async function completeTerminal() {
    await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_A' });
    const operations = runtime.store.rows.get('CRMBillingOperations');
    assert.ok(operations.length, 'Runtime terminal reconciliation must produce the CRM operation.');
    for (const operation of operations.filter((row) => row.STATUS !== 'completed')) {
      await h.dispatcher.dispatch(operation.CRM_DEAL_ID, operation.OPERATION_KEY);
      assert.equal(operation.STATUS, 'completed');
    }
    await h.job({ mode: 'reconcile_deployment', deployment_id: 'deployment_A' });
  }
  if (!stopped) runtime.clock.value = Date.parse('2026-08-27T12:00:01.000Z');
  if (lateFinalCall) {
    const waiting = await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_A' });
    assert.equal(waiting.status, 'ReportRebuiltAwaitingSettlement');
    assert.equal(runtime.store.rows.get('CRMBillingOperations').length, 0);
  } else await completeTerminal();
  if (lateFinalCall) {
    const index = calls.length - 1;
    const admission = admitted[0];
    await h.event('A', admission.body.call_inbound.metadata, `reconciled_report_fixture_${index}`, {}, 'call_ended');
    await analyze(index, admission);
    await completeTerminal();
  }
  const all = runtime.store.rows.get('AnalyticsSyncOutbox');
  const final = all.find((row) => row.RECORD_TYPE === 'final_test_result');
  assert.ok(final, 'Final fact must be emitted by runtime terminal processing.');
  const scope = Object.fromEntries(['CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
    'ENGAGEMENT_TYPE', 'ENVIRONMENT', 'SOURCE_REVISION'].map((key) => [key, final[key]]));
  // Retain the complete source history, including old versions. Processing only
  // the latest rows would hide the unresolved-history regression under test.
  const sourceRows = all.filter((row) => TYPES.includes(row.RECORD_TYPE)
    && row.CLIENT_KEY === scope.CLIENT_KEY && row.DEPLOYMENT_KEY === scope.DEPLOYMENT_KEY);
  const analyticsStore = new MemoryStore(sourceRows.map((row) => {
    const copy = structuredClone(row);
    // This separate synthetic table owns its row IDs. Reusing sparse runtime
    // IDs can collide with daily metrics subsequently inserted by the service.
    delete copy.ROWID;
    return copy;
  }));
  const imported = new Map();
  const jobs = new Map();
  const exported = new Map();
  let sequence = 1000;
  let random = 1;
  const now = () => runtime.clock.value;
  const adapter = {
    async submitBatch(type, rows) {
      const id = String(sequence++);
      jobs.set(id, rows.length);
      const table = imported.get(type) || new Map();
      for (const row of rows) table.set(row.RECORD_KEY, structuredClone(row));
      imported.set(type, table);
      return { jobId: id };
    },
    async pollImport(id) { return { state: 'complete', totalRows: jobs.get(id), acceptedRows: jobs.get(id), rejectedRows: 0 }; },
    async startReadback(type, rows) {
      const id = String(sequence++);
      exported.set(id, rows.map((row) => structuredClone(imported.get(type).get(row.RECORD_KEY))));
      return { jobId: id };
    },
    async pollReadback(id) { return { state: 'complete', rows: structuredClone(exported.get(id)) }; },
  };
  const service = createAnalyticsSyncService({ store: analyticsStore, adapter,
    config: serviceConfig({ sourceRevision: runtime.config.sourceRevision }), now,
    randomBytes: (size) => Buffer.alloc(size, random++) });
  async function runAnalyticsStep() {
    const result = await service.run();
    assert.notEqual(result.state, 'ReconciliationRequired');
    assert.notEqual(result.state, 'TerminalFailure');
    if (result.state !== 'Idle') runtime.clock.value += 30_000;
    return result;
  }
  async function reconcileAnalytics() {
    let idle = false;
    // Each source version requires import, readback and checkpoint transitions;
    // daily metrics add work. Keep the fixture bounded at the supported cohort.
    const maxRuns = 16 * (calls.length + TYPES.length);
    for (let run = 0; run < maxRuns; run += 1) {
      if ((await runAnalyticsStep()).state === 'Idle') { idle = true; break; }
    }
    assert.ok(idle, 'Existing Analytics fixture must drain through authoritative service transitions.');
    assert.ok(analyticsStore.rows.every((row) => row.SYNC_STATUS === 'Succeeded'));
  }
  if (reconcile) await reconcileAnalytics();
  async function readCompleteScope(expectedScope, type) {
    assert.deepEqual(expectedScope, scope);
    assert.ok(TYPES.includes(type));
    const rows = [...(imported.get(type)?.values() || [])].map((row) =>
      Object.fromEntries(READBACK_KEYS.map((key) => [key, row[key]])));
    return { scope: structuredClone(scope), recordType: type, rows,
      complete: true, bindingVerified: true, observedAt: new Date(now()).toISOString() };
  }
  const readerOptions = { runtimeStore: runtime.store, runtimeConfig: runtime.config,
    analyticsStore, readCompleteScope, now };
  return { h, runtime, analyticsStore, imported, scope, now, readCompleteScope, readerOptions,
    identity: { clientId: 'client_A', deploymentId: 'deployment_A' }, runAnalyticsStep, reconcileAnalytics,
    readInput: createReconciledFreeTestInputReader(readerOptions) };
}

module.exports = { createReconciledReportFixture };
