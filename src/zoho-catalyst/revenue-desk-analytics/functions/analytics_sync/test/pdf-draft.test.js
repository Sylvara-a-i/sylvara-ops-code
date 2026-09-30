'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { prepareFreeTestDocument, prepareFreeTestDraft, prepareFreeTestPdfDocument, prepareFreeTestPdfDraft } = require('../../../tools/prepare-free-test-draft');
const { createWorkDriveDraftWriter } = require('../../../tools/prepare-workdrive-draft');
const { privateCallLedgerFixture } = require('./helpers/private-call-ledger-fixture');
const { createWorkDriveDraftFixture } = require('./helpers/workdrive-draft-fixture');
const { createReconciledReportFixture } = require('./helpers/reconciled-report-fixture');
const { createDurableReportComposition } = require('../../../tools/create-durable-report-composition');
test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });
// Envelope-only test fixture, never semantic PDF acceptance evidence.
const bytes = Buffer.from('%PDF-1.7\n% synthetic envelope fixture\n%%EOF\n');
const renderer = { version: 'synthetic-envelope-v1', qualificationDigest: 'e'.repeat(64), async render() { return bytes; } };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const rejected = { code: 'DRAFT_RECONCILIATION_REQUIRED' };
async function fixture() {
  const f = await privateCallLedgerFixture();
  return { ...f, options: { now: f.now, synthetic: true, callDetails: f.snapshot } };
}
test('PDF identity hashes rendered bytes, preserves source semantics and separates immutable HTML drafts', async () => {
  const f = await fixture();
  const source = prepareFreeTestDocument(f.input, f.options);
  const prepared = await prepareFreeTestPdfDocument(f.input, f.options, { ...renderer,
    async render(input) { assert.deepEqual(input.html, source.document); return bytes; } });
  assert.deepEqual(prepared.document, bytes);
  assert.equal(prepared.documentSha256, hash(bytes));
  assert.equal(prepared.format, 'pdf');
  assert.notEqual(prepared.generationKey, source.generationKey);
  assert.equal((await prepareFreeTestPdfDocument(f.input, f.options, renderer)).generationKey, prepared.generationKey);
  const revision = await prepareFreeTestPdfDocument(f.input, f.options, { ...renderer,
    async render() { return Buffer.from('%PDF-1.7\n% revised synthetic envelope\n%%EOF\n'); } });
  assert.equal(revision.generationKey, prepared.generationKey);
  assert.notEqual(revision.documentSha256, prepared.documentSha256);
  assert.deepEqual(source, prepareFreeTestDocument(f.input, f.options));
});
test('local PDF names and receipts retain old HTML bytes and reuse exact PDF drafts', async () => {
  const f = await fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-pdf-draft-'));
  try {
    const options = { ...f.options, privateDirectory: directory };
    const old = await prepareFreeTestDraft(f.input, options);
    const oldPath = path.join(directory, `free-test-${old.generationKey}.html`);
    const original = fs.readFileSync(oldPath);
    const result = await prepareFreeTestPdfDraft(f.input, options, renderer);
    const pdfPath = path.join(directory, `free-test-${result.generationKey}.pdf`);
    assert.deepEqual(fs.readFileSync(pdfPath), bytes);
    assert.equal((await prepareFreeTestPdfDraft(f.input, options, renderer)).status, 'existing_draft_verified_not_for_delivery');
    assert.deepEqual(fs.readFileSync(oldPath), original);
    assert.equal(result.documentSha256, hash(bytes));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('durable PDF WorkDrive name, hash, exact-version readback and duplicate prevention remain fenced', async () => {
  const f = await fixture();
  const document = await prepareFreeTestPdfDocument(f.input, f.options, renderer);
  const storage = createWorkDriveDraftFixture(document, { now: f.now });
  const write = createWorkDriveDraftWriter({ reportRunStore: storage.runs, workdrive: storage.workdrive,
    readDestinationBinding: storage.readDestinationBinding, now: storage.now });
  await write(document);
  const resource = [...storage.resources.values()][0];
  assert.ok(resource.metadata.name.endsWith('.pdf'));
  assert.equal(storage.uploads.length, 1);
  assert.equal((await write(document)).status, 'existing_draft_verified_not_for_delivery');
  const row = [...storage.rows.values()][0];
  assert.equal(row.state.receipt.documentSha256, hash(bytes));
  assert.equal(storage.uploads.length, 1);
});
test('missing qualification, HTML renamed as PDF, excessive output and cancellation fail closed', async () => {
  const f = await fixture();
  for (const invalid of [null, { ...renderer, qualificationDigest: '0'.repeat(64) },
    { ...renderer, async render() { return Buffer.from('<html>not a pdf</html>'); } },
    { ...renderer, async render() { return Buffer.alloc(2 * 1024 * 1024 + 1); } }]) {
    await assert.rejects(prepareFreeTestPdfDocument(f.input, f.options, invalid), rejected);
  }
  const controller = new AbortController();
  let attempts = 0;
  controller.abort();
  await assert.rejects(prepareFreeTestPdfDocument(f.input, f.options, { ...renderer,
    async render() { attempts++; return bytes; } }, { signal: controller.signal }), rejected);
  assert.equal(attempts, 0);
});
test('automatic durable PDF path completes 25-call evidence within existing budgets without CRM/import replay', async () => {
  const f = await createReconciledReportFixture({ analyses: Array.from({ length: 25 }, () => ({})) });
  const input = await f.readInput(f.identity);
  const source = prepareFreeTestDocument(input.input, { now: f.now(), synthetic: true, callDetails: input.callDetails });
  const storage = createWorkDriveDraftFixture(source, { now: f.now() });
  const before = structuredClone(f.analyticsStore.rows);
  const crm = structuredClone(f.runtime.store.rows.get('CRMBillingOperations'));
  let renders = 0;
  const reconcile = createDurableReportComposition({ ...f.readerOptions, reportRunStore: storage.runs,
    workdrive: storage.workdrive, readDestinationBinding: storage.readDestinationBinding, now: f.now,
    synthetic: true, pdfRenderer: { ...renderer, async render({ html }) {
      renders++; assert.equal((html.toString().match(/class="call-detail"/g) || []).length, 25); return bytes;
    } } });
  assert.equal((await reconcile(f.identity)).status, 'draft_created_not_for_delivery');
  assert.ok(storage.uploads[0].filename.endsWith('.pdf'));
  assert.equal(hash([...storage.resources.values()][0].bytes), hash(bytes));
  await reconcile(f.identity);
  assert.equal(storage.uploads.length, 1);
  assert.equal(renders, 1);
  assert.deepEqual(f.analyticsStore.rows, before);
  assert.deepEqual(f.runtime.store.rows.get('CRMBillingOperations'), crm);
});
test('evidence invalidated during asynchronous PDF rendering cannot dispatch a storage upload', async () => {
  const f = await createReconciledReportFixture();
  const input = await f.readInput(f.identity);
  const source = prepareFreeTestDocument(input.input, { now: f.now(), synthetic: true, callDetails: input.callDetails });
  const storage = createWorkDriveDraftFixture(source, { now: f.now() });
  const reconcile = createDurableReportComposition({ ...f.readerOptions, reportRunStore: storage.runs,
    workdrive: storage.workdrive, readDestinationBinding: storage.readDestinationBinding, now: f.now,
    synthetic: true, pdfRenderer: { ...renderer, async render() {
      f.imported.get('call').clear(); return bytes;
    } } });
  await assert.rejects(reconcile(f.identity), rejected);
  assert.equal(storage.uploads.length, 0);
});

test('cancellation between PDF completion and local storage cannot create an intent or document', async () => {
  const f = await fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-pdf-cancel-'));
  const controller = new AbortController();
  try {
    await assert.rejects(prepareFreeTestPdfDraft(f.input, { ...f.options, privateDirectory: directory }, {
      ...renderer, async render() {
        queueMicrotask(() => queueMicrotask(() => controller.abort())); return bytes;
      },
    }, { signal: controller.signal }), rejected);
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('existing worker terminal scan reaches durable PDF preparation through its trusted construction hook', async () => {
  const { createWorkerJobHandler } = require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/job-handler');
  const f = await createReconciledReportFixture();
  const input = await f.readInput(f.identity);
  const source = prepareFreeTestDocument(input.input, { now: f.now(), synthetic: true, callDetails: input.callDetails });
  const storage = createWorkDriveDraftFixture(source, { now: f.now() });
  const originalRows = structuredClone(f.analyticsStore.rows);
  const worker = createWorkerJobHandler({ catalystSdk: f.runtime.catalystSdk,
    environment: f.runtime.env, artifactSourceRevision: f.runtime.config.sourceRevision,
    now: f.now, storeFactory: () => f.runtime.store, dispatcherFactory: () => f.h.dispatcher,
    terminalDraftReconcilerFactory: (_app, config, store) => createDurableReportComposition({
      ...f.readerOptions, runtimeStore: store, runtimeConfig: config, reportRunStore: storage.runs,
      workdrive: storage.workdrive, readDestinationBinding: storage.readDestinationBinding,
      synthetic: true, pdfRenderer: renderer,
    }),
  });
  const request = f.h.fixture.retryJobRequest(f.runtime.env, { mode: 'retry_scan' });
  const context = { closeWithSuccess() {}, closeWithFailure() { assert.fail('offline PDF worker failed'); } };
  const result = await worker(request, context);
  assert.ok(result.deployments.results.some(row => row.reportDraftStatus === 'draft_created_not_for_delivery'));
  assert.ok(storage.uploads[0].filename.endsWith('.pdf'));
  assert.equal(hash([...storage.resources.values()][0].bytes), hash(bytes));
  assert.equal((await worker(request, context)).deployments.results.some(row =>
    row.reportDraftStatus === 'awaiting_reconciled_evidence'), true);
  assert.equal(storage.uploads.length, 1);
  assert.deepEqual(f.analyticsStore.rows, originalRows);
});


async function durablePdfFixture(render = async () => bytes) {
  const f = await createReconciledReportFixture();
  const input = await f.readInput(f.identity);
  const source = prepareFreeTestDocument(input.input, { now: f.now(), synthetic: true, callDetails: input.callDetails });
  const d = createWorkDriveDraftFixture(source, { now: f.now() });
  let renders = 0;
  const options = { ...f.readerOptions, reportRunStore: d.runs, workdrive: d.workdrive,
    readDestinationBinding: d.readDestinationBinding, now: f.now, synthetic: true,
    pdfRenderer: { ...renderer, async render(input) {
      renders++;
      const claim = [...d.rows.values()].find(x => x.state.kind === 'pdf_generation_v1');
      assert.equal(claim.state.phase, 'render_started');
      assert.equal(d.uploads.length, 0);
      return render(input);
    } } };
  function advance() {
    const row = [...d.rows.values()].find(x => x.state.kind === 'report_attempt_v1');
    f.runtime.clock.value = row.state.nextAttemptAt;
  }
  return { f, d, options, advance, renders: () => renders,
    reconcile: createDurableReportComposition(options) };
}

test('pre-render claim survives concurrent duplicates and cooldown; verified repeat returns exact stored PDF without rendering', async () => {
  const x = await durablePdfFixture();
  const results = await Promise.all([x.reconcile(x.f.identity),
    createDurableReportComposition(x.options)(x.f.identity)]);
  assert.equal(results.filter(r => r.status === 'draft_created_not_for_delivery').length, 1);
  const first = results.find(r => r.generationKey);
  const before = structuredClone(x.f.analyticsStore.rows);
  x.advance();
  const repeated = await createDurableReportComposition(x.options)(x.f.identity);
  assert.equal(repeated.status, 'existing_draft_verified_not_for_delivery');
  assert.equal(repeated.generationKey, first.generationKey);
  assert.equal(repeated.documentSha256, hash(bytes));
  assert.equal(x.renders(), 1);
  assert.equal(x.d.uploads.length, 1);
  assert.deepEqual(x.f.analyticsStore.rows, before);
});

test('unknown render outcome consumes its source claim permanently and cannot rerender after timeout/backoff', async () => {
  const x = await durablePdfFixture(async () => { throw new Error('synthetic ambiguous conversion'); });
  await assert.rejects(x.reconcile(x.f.identity), rejected);
  const claim = [...x.d.rows.values()].find(r => r.state.kind === 'pdf_generation_v1');
  assert.equal(claim.state.phase, 'render_started');
  x.advance();
  await assert.rejects(createDurableReportComposition(x.options)(x.f.identity), rejected);
  assert.equal(x.renders(), 1);
  assert.equal(x.d.uploads.length, 0);
  assert.deepEqual(x.d.rows.get(claim.key), claim);
});

test('cancelled render stops local admission; a late result cannot upload and a later attempt cannot rerender', async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const x = await durablePdfFixture(async () => { entered(); return pending; });
  const controller = new AbortController();
  const attempt = x.reconcile(x.f.identity, { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(attempt, rejected);
  release(bytes);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(x.d.uploads.length, 0);
  x.advance();
  await assert.rejects(x.reconcile(x.f.identity), rejected);
  assert.equal(x.renders(), 1);
});

test('accepted stored-content mismatch blocks without another render or upload', async () => {
  const x = await durablePdfFixture();
  await x.reconcile(x.f.identity);
  const resource = [...x.d.resources.values()][0];
  resource.bytes[12] ^= 1;
  x.advance();
  await assert.rejects(x.reconcile(x.f.identity), rejected);
  assert.equal(x.renders(), 1);
  assert.equal(x.d.uploads.length, 1);
});

test('completed upload with lost acceptance is recovered from exact immutable bytes without rendering again', async () => {
  const x = await durablePdfFixture();
  const original = x.d.workdrive.upload;
  x.d.workdrive.upload = async (...args) => { await original(...args); throw new Error('synthetic lost upload response'); };
  await assert.rejects(x.reconcile(x.f.identity), rejected);
  x.advance();
  const result = await x.reconcile(x.f.identity);
  assert.equal(result.documentSha256, hash(bytes));
  assert.equal(result.status, 'existing_draft_verified_not_for_delivery');
  assert.equal(x.renders(), 1);
  assert.equal(x.d.uploads.length, 1);
  assert.equal([...x.d.rows.values()].find(r => r.state.kind === 'pdf_generation_v1').state.phase, 'accepted');
});

test('changed reviewed source creates a new PDF claim and keeps the previous accepted bytes immutable', async () => {
  const x = await durablePdfFixture();
  const { METHOD_ID, METHOD_VERSION, SCOPE_FIELDS } = require('../../../tools/opportunity-value');
  const { factRowsetDigest } = require('../../../tools/build-free-test-report');
  const input = await x.f.readInput(x.f.identity);
  const review = { schemaVersion: 1, methodId: METHOD_ID, methodVersion: METHOD_VERSION,
    scope: Object.fromEntries(SCOPE_FIELDS.map(k => [k, input.input.deployment[k]])),
    callRowsetDigest: factRowsetDigest('call', input.input.calls),
    review: { status: 'reviewed', reviewedAt: new Date(x.f.now()).toISOString(), reviewerReference: 'a'.repeat(64) },
    groups: [{ groupKey: 'b'.repeat(64), callKeys: [input.input.calls[0].CALL_KEY], reviewStatus: 'qualified',
      knownJobValue: { amountMinorUnits: 42500, currency: 'USD', evidenceReference: 'c'.repeat(64),
        effectiveDate: input.input.calls[0].STARTED_AT.slice(0, 10) }, averageJobValue: null }] };
  const first = await x.reconcile(x.f.identity);
  const original = Buffer.from([...x.d.resources.values()][0].bytes);
  x.advance();
  const changed = createDurableReportComposition({ ...x.options, readOpportunityReview: async () => review,
    pdfRenderer: { ...renderer, async render() { return Buffer.from('%PDF-1.7\n% corrected synthetic source\n%%EOF\n'); } } });
  const second = await changed(x.f.identity);
  assert.notEqual(second.generationKey, first.generationKey);
  assert.equal(x.d.uploads.length, 2);
  assert.deepEqual([...x.d.resources.values()][0].bytes, original);
  assert.equal([...x.d.rows.values()].filter(r => r.state.kind === 'pdf_generation_v1').length, 2);
});

test('changed destination ownership is rejected before retrieving accepted private PDF bytes', async () => {
  const x = await durablePdfFixture();
  await x.reconcile(x.f.identity);
  let downloads = 0;
  const original = x.d.workdrive.downloadVersion;
  x.d.workdrive.downloadVersion = async (...args) => { downloads++; return original(...args); };
  x.d.binding.clientId = 'client_B';
  x.advance();
  await assert.rejects(x.reconcile(x.f.identity), rejected);
  assert.equal(downloads, 0);
  assert.equal(x.renders(), 1);
});


test('actual attempt deadline leaves unknown render claim consumed; late bytes cannot create storage effects', async () => {
  let release;
  const x = await durablePdfFixture(async () => new Promise(resolve => { release = resolve; }));
  const reconcile = createDurableReportComposition({ ...x.options, budgetOptions: { timeoutMs: 1000 } });
  await assert.rejects(reconcile(x.f.identity), rejected);
  assert.equal(x.renders(), 1);
  assert.equal([...x.d.rows.values()].find(r => r.state.kind === 'pdf_generation_v1').state.phase, 'render_started');
  release(bytes);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(x.d.uploads.length, 0);
  x.advance();
  await assert.rejects(reconcile(x.f.identity), rejected);
  assert.equal(x.renders(), 1);
});

test('lost generation-acceptance CAS recovers independently verified stored PDF without another conversion', async () => {
  const x = await durablePdfFixture();
  const original = x.d.runs.compareAndSwap;
  let lose = true;
  x.d.runs.compareAndSwap = async function(current, state, options) {
    if (lose && state.kind === 'pdf_generation_v1' && state.phase === 'accepted') { lose = false; return null; }
    return original.call(this, current, state, options);
  };
  await assert.rejects(x.reconcile(x.f.identity), rejected);
  x.advance();
  const result = await x.reconcile(x.f.identity);
  assert.equal(result.status, 'existing_draft_verified_not_for_delivery');
  assert.equal(result.documentSha256, hash(bytes));
  assert.equal(x.renders(), 1);
  assert.equal(x.d.uploads.length, 1);
});
