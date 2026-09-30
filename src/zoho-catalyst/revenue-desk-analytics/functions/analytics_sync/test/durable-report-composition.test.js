'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { prepareFreeTestDocument } = require('../../../tools/prepare-free-test-draft');
const { createDurableReportComposition } = require('../../../tools/create-durable-report-composition');
const { createReportCheckpointReattestor } = require('../../../tools/reattest-report-checkpoints');
const { METHOD_ID, METHOD_VERSION } = require('../../../tools/opportunity-value');
const { factRowsetDigest } = require('../../../tools/build-free-test-report');
const { createReconciledReportFixture } = require('./helpers/reconciled-report-fixture');
const { createWorkDriveDraftFixture } = require('./helpers/workdrive-draft-fixture');
test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });

async function fixture() {
  const f = await createReconciledReportFixture();
  const input = await f.readInput(f.identity);
  const prepared = prepareFreeTestDocument(input.input, { callDetails: input.callDetails,
    now: f.now(), synthetic: true });
  const d = createWorkDriveDraftFixture(prepared, { now: f.now() });
  const options = { ...f.readerOptions, reportRunStore: d.runs, workdrive: d.workdrive,
    readDestinationBinding: d.readDestinationBinding, now: f.now, synthetic: true };
  return { f, d, options };
}

test('durable composition uses actual canonical/Analytics facts and does not repeat CRM/import work', async () => {
  const { f, d, options } = await fixture();
  const outbox = structuredClone(f.analyticsStore.rows);
  const operations = structuredClone(f.runtime.store.rows.get('CRMBillingOperations'));
  const reconcile = createDurableReportComposition(options);
  assert.equal((await reconcile(f.identity)).status, 'draft_created_not_for_delivery');
  assert.equal(d.uploads.length, 1);
  assert.deepEqual(f.analyticsStore.rows, outbox);
  assert.deepEqual(f.runtime.store.rows.get('CRMBillingOperations'), operations);
  let providerReads = 0;
  const repeated = createDurableReportComposition({ ...options,
    readCompleteScope: async () => { providerReads++; throw new Error('must not read during cooldown'); } });
  assert.equal((await repeated(f.identity)).status, 'awaiting_reconciled_evidence');
  assert.equal(providerReads, 0);
  assert.equal(d.uploads.length, 1);
});

test('concurrent worker compositions serialize the scope before either provider pass', async () => {
  const { f, d, options } = await fixture();
  let reads = 0;
  const readCompleteScope = async (...args) => { reads++; return f.readCompleteScope(...args); };
  const results = await Promise.all([
    createDurableReportComposition({ ...options, readCompleteScope })(f.identity),
    createDurableReportComposition({ ...options, readCompleteScope })(f.identity),
  ]);
  assert.ok(results.some(result => result.status === 'draft_created_not_for_delivery'));
  assert.equal(reads, 3);
  assert.equal(d.uploads.length, 1);
});

test('six failed attempts retain durable exponential backoff and stop further source/provider reads', async () => {
  const { f, d, options } = await fixture();
  let reads = 0;
  const reconcile = createDurableReportComposition({ ...options,
    readCompleteScope: async () => { reads++; throw new Error('synthetic unavailable'); } });
  for (let attempt = 1; attempt <= 6; attempt++) {
    await assert.rejects(reconcile(f.identity), { code: 'DRAFT_RECONCILIATION_REQUIRED' });
    const row = [...d.rows.values()].find(item => item.state.kind === 'report_attempt_v1');
    assert.equal(row.state.failures, attempt);
    assert.ok(row.state.nextAttemptAt > f.now());
    assert.equal((await reconcile(f.identity)).status, 'awaiting_reconciled_evidence');
    f.runtime.clock.value = row.state.nextAttemptAt;
  }
  const before = reads;
  assert.equal((await reconcile(f.identity)).status, 'awaiting_reconciled_evidence');
  assert.equal(reads, before);
  assert.equal(d.uploads.length, 0);
});

test('whole composition cancellation leaves durable attempt state and cannot dispatch a late upload', async () => {
  const { f, d, options } = await fixture();
  const controller = new AbortController();
  const reconcile = createDurableReportComposition({ ...options,
    readOpportunityReview: async () => { controller.abort(); return null; } });
  await assert.rejects(reconcile(f.identity, { signal: controller.signal }), { code: 'DRAFT_RECONCILIATION_REQUIRED' });
  assert.equal(d.uploads.length, 0);
  assert.equal([...d.rows.values()][0].state.phase, 'working');
});

test('narrow request ceilings fail closed instead of silently expanding for a second pass', async () => {
  const { f, d, options } = await fixture();
  const reconcile = createDurableReportComposition({ ...options,
    budgetOptions: { limits: { source_read: 1 } } });
  await assert.rejects(reconcile(f.identity), { code: 'DRAFT_RECONCILIATION_REQUIRED' });
  assert.equal(d.uploads.length, 0);
  assert.throws(() => createDurableReportComposition({ ...options,
    budgetOptions: { limits: { workdrive_write: 2 } } }), { code: 'DRAFT_RECONCILIATION_REQUIRED' });
});

test('expired evidence and a later reviewed valuation create immutable drafts without replaying completed work', async () => {
  const { f, d, options } = await fixture();
  const initial = await f.readInput(f.identity);
  const baseline = structuredClone({ outbox: f.analyticsStore.rows, imports: [...f.imported],
    crm: f.runtime.store.rows.get('CRMBillingOperations') });
  const checkpointImports = [...f.analyticsStore.checkpoints.values()].map(row => row.LAST_SYNC_AT);
  f.runtime.clock.value = Math.max(...[...f.analyticsStore.checkpoints.values()]
    .map(row => Date.parse(row.STALE_AFTER_AT))) + 1;
  d.binding.verifiedAt = f.now(); d.binding.expiresAt = f.now() + 86400000;
  let review = null;
  const reconcile = createDurableReportComposition({ ...options,
    readOpportunityReview: async () => review,
    reattestCheckpoints: createReportCheckpointReattestor({ analyticsStore: f.analyticsStore,
      now: f.now, freshnessMs: 7200000 }) });
  const first = await reconcile(f.identity);
  assert.equal(first.status, 'draft_created_not_for_delivery');
  const original = [...d.resources.values()].map(row => Buffer.from(row.bytes));
  f.runtime.clock.value += 900001;
  review = { schemaVersion: 1, methodId: METHOD_ID, methodVersion: METHOD_VERSION,
    scope: f.scope, callRowsetDigest: factRowsetDigest('call', initial.input.calls),
    review: { status: 'reviewed', reviewedAt: new Date(f.now()).toISOString(), reviewerReference: 'b'.repeat(64) },
    groups: [{ groupKey: 'a'.repeat(64), callKeys: [initial.input.calls[0].CALL_KEY], reviewStatus: 'qualified',
      knownJobValue: { amountMinorUnits: 42500, currency: 'USD', evidenceReference: 'c'.repeat(64),
        effectiveDate: initial.input.calls[0].STARTED_AT.slice(0, 10) }, averageJobValue: null }] };
  const revised = await reconcile(f.identity);
  assert.notEqual(revised.generationKey, first.generationKey);
  assert.equal(d.uploads.length, 2);
  assert.deepEqual([...d.resources.values()][0].bytes, original[0]);
  assert.match([...d.resources.values()][1].bytes.toString(), /\$425/);
  assert.deepEqual({ outbox: f.analyticsStore.rows, imports: [...f.imported],
    crm: f.runtime.store.rows.get('CRMBillingOperations') }, baseline);
  assert.deepEqual([...f.analyticsStore.checkpoints.values()].map(row => row.LAST_SYNC_AT), checkpointImports);
});

test('actual manually stopped staged configuration reaches the durable writer after expired verification', async () => {
  const f = await createReconciledReportFixture({ stopped: true });
  const initial = await f.readInput(f.identity);
  const prepared = prepareFreeTestDocument(initial.input, { callDetails: initial.callDetails, now: f.now(), synthetic: true });
  const d = createWorkDriveDraftFixture(prepared, { now: f.now() });
  d.binding.clientId = f.identity.clientId; d.binding.deploymentId = f.identity.deploymentId;
  f.runtime.clock.value = Math.max(...[...f.analyticsStore.checkpoints.values()]
    .map(row => Date.parse(row.STALE_AFTER_AT))) + 1;
  d.binding.verifiedAt = f.now(); d.binding.expiresAt = f.now() + 86400000;
  const reconcile = createDurableReportComposition({ ...f.readerOptions,
    reportRunStore: d.runs, workdrive: d.workdrive, readDestinationBinding: d.readDestinationBinding,
    readOpportunityReview: async () => null,
    reattestCheckpoints: createReportCheckpointReattestor({ analyticsStore: f.analyticsStore,
      now: f.now, freshnessMs: 7200000 }), now: f.now, synthetic: true });
  assert.equal((await reconcile(f.identity)).status, 'draft_created_not_for_delivery');
  assert.equal(d.uploads.length, 1);
  assert.equal(f.runtime.store.rows.get('RevenueDeskDeployments')[0].TEST_STATUS, 'Stopped');
});
