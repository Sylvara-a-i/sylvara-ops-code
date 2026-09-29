'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { createTerminalDraftReconciler } = require('../../../tools/prepare-free-test-draft');
const { buildFreeTestReport, factRowsetDigest } = require('../../../tools/build-free-test-report');
const { METHOD_ID, METHOD_VERSION, SCOPE_FIELDS } = require('../../../tools/opportunity-value');
const { createWorkerJobHandler } = require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/job-handler');
const { createReconciledReportFixture } = require('./helpers/reconciled-report-fixture');

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });
const failure = { code: 'DRAFT_RECONCILIATION_REQUIRED', message: 'DRAFT_RECONCILIATION_REQUIRED' };
const hash = (value) => crypto.createHash('sha256').update(`synthetic-terminal-draft-${value}`).digest('hex');

function directoryFor(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sylvara-terminal-draft-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function documents(directory) {
  return fs.readdirSync(directory).filter((name) => name.endsWith('.html'));
}

function reviewFor(prepared, now) {
  return { schemaVersion: 1, methodId: METHOD_ID, methodVersion: METHOD_VERSION,
    scope: Object.fromEntries(SCOPE_FIELDS.map((key) => [key, prepared.input.deployment[key]])),
    callRowsetDigest: factRowsetDigest('call', prepared.input.calls),
    review: { status: 'reviewed', reviewedAt: new Date(now).toISOString(), reviewerReference: hash('reviewer') },
    groups: [{ groupKey: hash('opportunity'), callKeys: prepared.input.calls.map((call) => call.CALL_KEY),
      reviewStatus: 'qualified', knownJobValue: { amountMinorUnits: 42500, currency: 'USD',
        evidenceReference: hash('contractor-known-job'), effectiveDate: new Date(now).toISOString().slice(0, 10) },
      averageJobValue: null }],
  };
}

function workerFor(fixture, directory, extra = {}) {
  const { runtime, h } = fixture;
  const worker = createWorkerJobHandler({ catalystSdk: runtime.catalystSdk,
    environment: runtime.env, artifactSourceRevision: runtime.config.sourceRevision,
    now: fixture.now, storeFactory: () => runtime.store, dispatcherFactory: () => h.dispatcher,
    terminalDraftReconcilerFactory: (_app, config, store) => createTerminalDraftReconciler({
      ...fixture.readerOptions, runtimeStore: store, runtimeConfig: config,
      privateDirectory: directory, synthetic: true, ...extra,
    }),
  });
  return async (params = { mode: 'retry_scan' }) => {
    const context = { successes: 0, failures: 0,
      closeWithSuccess() { this.successes += 1; }, closeWithFailure() { this.failures += 1; } };
    const result = await worker(h.fixture.retryJobRequest(runtime.env, params), context);
    return { result, context };
  };
}

test('existing worker scan waits for Analytics then assembles and renders one private client draft', async (t) => {
  const f = await createReconciledReportFixture({ reconcile: false });
  const directory = directoryFor(t);
  const run = workerFor(f, directory);
  const waiting = await run();
  assert.equal(waiting.context.failures, 0);
  assert.ok(waiting.result.deployments.results.some((row) =>
    row.deploymentId === f.identity.deploymentId && row.reportDraftStatus === 'awaiting_reconciled_evidence'));
  assert.deepEqual(fs.readdirSync(directory), []);
  await f.reconcileAnalytics();
  const created = await run();
  assert.equal(created.context.failures, 0);
  assert.ok(created.result.deployments.results.some((row) =>
    row.deploymentId === f.identity.deploymentId && row.reportDraftStatus === 'draft_created_not_for_delivery'));
  assert.equal(documents(directory).length, 1);
  assert.equal(fs.readdirSync(directory).length, 3);
  const html = fs.readFileSync(path.join(directory, documents(directory)[0]), 'utf8');
  assert.match(html, /Synthetic leaking tap/);
  assert.match(html, /C-0001/);
  assert.match(html, /Estimated Opportunity Value/);
  assert.match(html, /Unknown/);
  assert.match(html, /Not for delivery/);
  const sourceRows = structuredClone(f.analyticsStore.rows);
  const repeated = await run();
  assert.equal(repeated.context.failures, 0);
  assert.ok(repeated.result.deployments.results.some((row) =>
    row.reportDraftStatus === 'existing_draft_verified_not_for_delivery'));
  assert.deepEqual(f.analyticsStore.rows, sourceRows, 'Generating a draft must not resubmit Analytics facts');
  assert.equal(fs.readdirSync(directory).length, 3);
});

test('a failed full-scope read retries through the worker without replaying the completed import or CRM summary', async (t) => {
  const f = await createReconciledReportFixture();
  const directory = directoryFor(t);
  const before = structuredClone(f.analyticsStore.rows);
  const operation = structuredClone(f.runtime.store.rows.get('CRMBillingOperations')[0]);
  let attempts = 0;
  const run = workerFor(f, directory, { async readCompleteScope(...args) {
    if (attempts++ === 0) throw new Error('private-provider-response-and-path');
    return f.readCompleteScope(...args);
  } });
  const failed = await run();
  assert.equal(failed.context.failures, 1);
  assert.deepEqual(failed.result, { status: 'Failed', errorCode: 'WORKER_MODE_FAILED' });
  assert.deepEqual(fs.readdirSync(directory), []);
  assert.equal(f.runtime.store.rows.get('RevenueDeskDeployments')[0].REPORT_RECONCILIATION_STATUS, 'Completed');
  const retried = await run();
  assert.equal(retried.context.failures, 0);
  assert.ok(retried.result.deployments.results.some((row) => row.reportDraftStatus === 'draft_created_not_for_delivery'));
  assert.deepEqual(f.analyticsStore.rows, before);
  assert.deepEqual(f.runtime.store.rows.get('CRMBillingOperations')[0], operation);
  assert.equal(documents(directory).length, 1);
});

test('results review creates a distinct valued revision and preserves the original unvalued draft', async (t) => {
  const f = await createReconciledReportFixture();
  const directory = directoryFor(t);
  let review = null;
  const reconcile = createTerminalDraftReconciler({ ...f.readerOptions, privateDirectory: directory,
    synthetic: true, readOpportunityReview: async () => review });
  const initial = await reconcile(f.identity);
  const originalFile = path.join(directory, `free-test-${initial.generationKey}.html`);
  const original = fs.readFileSync(originalFile);
  review = reviewFor(await f.readInput(f.identity), f.now());
  const valued = await reconcile(f.identity);
  assert.notEqual(valued.generationKey, initial.generationKey);
  assert.deepEqual(fs.readFileSync(originalFile), original);
  const html = fs.readFileSync(path.join(directory, `free-test-${valued.generationKey}.html`), 'utf8');
  assert.match(html, /USD 425\.00/);
  assert.match(html, /Estimated Opportunity Value/);
  assert.equal((await reconcile(f.identity)).status, 'existing_draft_verified_not_for_delivery');
  assert.equal(documents(directory).length, 2);
  assert.doesNotMatch(html, /private-provider|contractor-known-job/);
});

test('source corrections during review retrieval and undefined review results cannot create a draft', async (t) => {
  for (const scenario of ['source_changed', 'undefined_review']) {
    const f = await createReconciledReportFixture();
    const directory = directoryFor(t);
    const reconcile = createTerminalDraftReconciler({ ...f.readerOptions, privateDirectory: directory,
      synthetic: true, async readOpportunityReview() {
        if (scenario === 'undefined_review') return undefined;
        f.runtime.store.rows.get('RevenueDeskDeployments')[0].STOP_REASON = 'client_requested_stop';
        return null;
      } });
    await assert.rejects(reconcile(f.identity), failure);
    assert.deepEqual(fs.readdirSync(directory), []);
  }
});

test('the reconciled backend retains repeat calls and values a reviewed opportunity once with an incomplete subtotal', async (t) => {
  const f = await createReconciledReportFixture({ analyses: [
    { caller_intent: 'Request a water heater repair', issue_summary: 'Leaking water heater repair request' },
    { caller_intent: 'Follow up on the same repair', issue_summary: 'Repeat water heater repair request' },
    { caller_intent: 'Request drain inspection', issue_summary: 'Separate slow kitchen drain request' },
  ] });
  const prepared = await f.readInput(f.identity);
  const repeatKeys = prepared.callDetails.rows.filter((row) => /water heater/.test(row.issueSummary))
    .map((row) => row.fact.CALL_KEY);
  const unknownKeys = prepared.callDetails.rows.filter((row) => /kitchen drain/.test(row.issueSummary))
    .map((row) => row.fact.CALL_KEY);
  assert.equal(repeatKeys.length, 2);
  assert.equal(unknownKeys.length, 1);
  const review = reviewFor(prepared, f.now());
  review.groups[0].callKeys = repeatKeys;
  review.groups.push({ groupKey: hash('unknown-drain'), callKeys: unknownKeys,
    reviewStatus: 'qualified', knownJobValue: null, averageJobValue: null });
  const directory = directoryFor(t);
  const reconcile = createTerminalDraftReconciler({ ...f.readerOptions, privateDirectory: directory,
    synthetic: true, readOpportunityReview: async () => review });
  await reconcile(f.identity);
  const html = fs.readFileSync(path.join(directory, documents(directory)[0]), 'utf8');
  const report = buildFreeTestReport(prepared.input, f.now(), prepared.callDetails, review);
  assert.deepEqual(report.opportunityValue.groups.map((group) => ({
    reference: group.groupReference, calls: group.callReferences, amount: group.amountMinorUnits,
  })), [
    { reference: 'O-0001', calls: ['C-0001'], amount: null },
    { reference: 'O-0002', calls: ['C-0002', 'C-0003'], amount: 42500 },
  ]);
  const cards = [...html.matchAll(/<section class="call-detail">([\s\S]*?)<\/section>/g)]
    .map((match) => match[1]);
  assert.equal(cards.length, 3);
  for (const [index, card] of cards.entries()) {
    assert.match(card, new RegExp(`<caption>C-000${index + 1} — Call record</caption>`));
    assert.equal((card.match(/Preview Only — Not Sent/g) || []).length, 1);
    for (const label of ['Inbox Receipt', 'Office Acknowledgment', 'Completed Follow-Up']) {
      assert.ok(card.includes(`<th scope="row">${label}</th><td>Unknown</td>`));
    }
  }
  const overview = html.slice(html.indexOf('<div class="summary-overview">'), html.indexOf('<caption>Connected-call breakdown'));
  assert.match(overview, /<dt>Calls Handled<\/dt><dd>3<\/dd>/);
  assert.match(overview, /<dt>Reviewed Opportunity Groups<\/dt><dd>2<\/dd>/);
  assert.match(overview, /USD 425\.00 — Partial Subtotal/);
  assert.match(overview, /Valued groups: 1 · Unknown \/ incomplete groups excluded: 1 · Potential new-job calls not yet grouped: 0/);
  const groupTable = html.slice(html.indexOf('<div class="opportunity-groups">'), html.indexOf('<h3>Value limitations'));
  const groupRows = [...groupTable.matchAll(/<tr><th scope="row">([\s\S]*?)<\/tr>/g)]
    .map((match) => match[1]);
  assert.equal(groupRows.length, 2);
  assert.match(groupRows[0], /O-0001 — Separate slow kitchen drain request<\/th><td>C-0001<\/td>/);
  assert.match(groupRows[0], /<td>Unknown<\/td>/);
  assert.match(groupRows[1], /O-0002 — .*<\/th><td>C-0002, C-0003<\/td>/);
  assert.equal((groupTable.match(/USD 425\.00/g) || []).length, 1);
  for (const reference of ['C-0001', 'C-0002', 'C-0003']) assert.ok(html.includes(reference));
  for (const description of ['Leaking water heater repair request', 'Repeat water heater repair request',
    'Separate slow kitchen drain request']) assert.ok(html.includes(description));
  assert.match(html, /USD 425\.00/);
  assert.doesNotMatch(html, /USD (850|1275)\.00/);
  assert.match(html, /Partial coverage — the amounts below are documented subtotals, not a complete test value\./);
  assert.match(html, /Unknown/);
});

test('aborted draft reconciliation discards late review results before creating any file', async (t) => {
  const f = await createReconciledReportFixture();
  const directory = directoryFor(t);
  const controller = new AbortController();
  let releaseReview;
  let announceReview;
  const started = new Promise((resolve) => { announceReview = resolve; });
  const reconcile = createTerminalDraftReconciler({ ...f.readerOptions, privateDirectory: directory,
    synthetic: true, readOpportunityReview: async (_identity, { signal }) => {
      assert.equal(signal, controller.signal);
      announceReview();
      return new Promise((resolve) => { releaseReview = resolve; });
    } });
  const result = reconcile(f.identity, { signal: controller.signal });
  await started;
  controller.abort();
  releaseReview(null);
  await assert.rejects(result, failure);
  assert.deepEqual(fs.readdirSync(directory), []);
  await assert.rejects(reconcile(f.identity, { signal: controller.signal }), failure);
});

test('unknown callback options and caller-selected scope fields fail before preparing a document', async (t) => {
  const f = await createReconciledReportFixture();
  const directory = directoryFor(t);
  const reconcile = createTerminalDraftReconciler({ ...f.readerOptions, privateDirectory: directory, synthetic: true });
  for (const [scope, options] of [[{ ...f.identity, deliver: true }, {}],
    [f.identity, { signal: { aborted: false } }], [f.identity, { deliver: true }],
    [{ clientId: 'client_B', deploymentId: f.identity.deploymentId }, {}]]) {
    await assert.rejects(reconcile(scope, options), failure);
  }
  assert.deepEqual(fs.readdirSync(directory), []);
});
