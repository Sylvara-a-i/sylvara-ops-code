'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { prepareFreeTestDraft, createReconciledDraftTrigger } = require('../../../tools/prepare-free-test-draft');
const { CLIENT_DRAFT_RENDERER_VERSION } = require('../../../tools/render-free-test-report');
const { NOW, refreshDigests } = require('./helpers/free-test-report-fixture');
const { privateCallLedgerFixture } = require('./helpers/private-call-ledger-fixture');
const { queryClientCallDetails } = require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/reporting');
const { METHOD_ID, METHOD_VERSION } = require('../../../tools/opportunity-value');
const { createOfflineHarness } = require('../../../../revenue-desk-release/test/helpers/free-test-demo');
const { createAnalyticsSyncService } = require('../lib/service');
const { MemoryStore, serviceConfig } = require('./helpers');
const { parseOutboxRow, createOutboxRow, targetRow } = require('../lib/facts');
const { readbackRowsetDigest } = require('../../../tools/build-free-test-report');
const { scopeInventoryDigest } = require('../../../tools/evaluate-dashboard-pre-render-gate');

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const rejected = { code: 'DRAFT_RECONCILIATION_REQUIRED', message: 'DRAFT_RECONCILIATION_REQUIRED' };

function privateOutput(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sylvara-draft-generation-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function paths(directory, receipt) {
  const base = path.join(directory, `free-test-${receipt.generationKey}`);
  return { document: `${base}.html`, intent: `${base}.intent.json`, receipt: `${base}.receipt.json` };
}

function refreshEvidence(input, now) {
  input.evidence.evaluated_at = new Date(now).toISOString();
  for (const checkpoint of Object.values(input.evidence.scopes[0].checkpoints)) {
    if (!checkpoint) continue;
    checkpoint.last_reconciled_at = new Date(now).toISOString();
    checkpoint.stale_after_at = new Date(now + 300_000).toISOString();
  }
}

test('reconciled canonical records generate one private client draft and hash-only receipt, never approval or delivery', async (t) => {
  const { input, snapshot, now } = await privateCallLedgerFixture({
    caller_intent: 'Synthetic repair request', issue_summary: 'Synthetic dripping kitchen fixture',
  });
  const directory = privateOutput(t);
  const result = await prepareFreeTestDraft(input, {
    privateDirectory: directory, now, synthetic: true, callDetails: snapshot,
  });
  assert.equal(result.status, 'draft_created_not_for_delivery');
  const files = paths(directory, result);
  assert.equal(fs.readdirSync(directory).length, 3);
  const html = fs.readFileSync(files.document, 'utf8');
  assert.match(html, /Private Review Draft - Not for delivery/);
  assert.match(html, /Synthetic dripping kitchen fixture/);
  assert.equal(result.documentSha256, sha256(html));
  const receipt = fs.readFileSync(files.receipt, 'utf8');
  assert.equal(result.receiptSha256, sha256(receipt));
  assert.deepEqual(JSON.parse(receipt), {
    schemaVersion: 1, generationKey: result.generationKey, documentSha256: result.documentSha256,
    rendererVersion: CLIENT_DRAFT_RENDERER_VERSION,
    status: 'draft_generated_owner_review_required_delivery_not_authorized',
  });
  for (const content of [receipt, fs.readFileSync(files.intent, 'utf8')]) {
    assert.doesNotMatch(content, /Synthetic dripping|Synthetic repair|client_A|deployment_A|reviewed|delivered/);
    assert.ok(!content.includes(input.deployment.CLIENT_KEY));
    assert.ok(!content.includes(input.deployment.DEPLOYMENT_KEY));
  }
});

test('a terminal marker without the three-type evidence gate cannot create a file', async (t) => {
  const directory = privateOutput(t);
  await assert.rejects(prepareFreeTestDraft({ REPORT_RECONCILIATION_STATUS: 'Completed' },
    { privateDirectory: directory, now: NOW }), rejected);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('the new completion coordinator refuses an aggregate-only draft without trusted call details', async (t) => {
  const directory = privateOutput(t);
  const { input, now } = await privateCallLedgerFixture();
  for (const callDetails of [undefined, null, { rows: [] }]) {
    await assert.rejects(prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails }), rejected);
  }
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('each missing, stale or mismatched record-type readback blocks generation before mutation', async (t) => {
  const directory = privateOutput(t);
  const { input, snapshot, now } = await privateCallLedgerFixture();
  for (const type of ['deployment', 'call', 'final_test_result']) {
    const missing = structuredClone(input);
    delete missing.evidence.scopes[0].checkpoints[type];
    await assert.rejects(prepareFreeTestDraft(missing, { privateDirectory: directory, now, callDetails: snapshot }), rejected);
    const stale = structuredClone(input);
    stale.evidence.scopes[0].checkpoints[type].stale_after_at = new Date(now - 1).toISOString();
    await assert.rejects(prepareFreeTestDraft(stale, { privateDirectory: directory, now, callDetails: snapshot }), rejected);
    const mismatched = structuredClone(input);
    mismatched.evidence.scopes[0].analytics_readback.record_types[type].rowset_digest = '0'.repeat(64);
    await assert.rejects(prepareFreeTestDraft(mismatched, { privateDirectory: directory, now, callDetails: snapshot }), rejected);
  }
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('concurrent duplicate reconciliation creates exactly one document and returns verified readbacks', async (t) => {
  const directory = privateOutput(t);
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const results = await Promise.all(Array.from({ length: 8 }, () => prepareFreeTestDraft(input,
    { privateDirectory: directory, now, callDetails: snapshot, synthetic: true })));
  assert.equal(results.filter((item) => item.status === 'draft_created_not_for_delivery').length, 1);
  assert.equal(results.filter((item) => item.status === 'existing_draft_verified_not_for_delivery').length, 7);
  assert.equal(new Set(results.map((item) => item.generationKey)).size, 1);
  assert.equal(new Set(results.map((item) => item.documentSha256)).size, 1);
  assert.equal(fs.readdirSync(directory).length, 3);
});

test('fresh evidence on the next day reuses the original draft and immutable source revision date', async (t) => {
  const directory = privateOutput(t);
  const { input, snapshot, now, runtime } = await privateCallLedgerFixture();
  const first = await prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot });
  const files = paths(directory, first);
  const original = fs.readFileSync(files.document);
  const nextDay = now + 86_400_000;
  refreshEvidence(input, nextDay);
  const freshSnapshot = await queryClientCallDetails(runtime.store, runtime.config, 'client_A', 'deployment_A', nextDay);
  const second = await prepareFreeTestDraft(input, { privateDirectory: directory, now: nextDay, callDetails: freshSnapshot });
  assert.equal(second.status, 'existing_draft_verified_not_for_delivery');
  assert.equal(second.generationKey, first.generationKey);
  assert.equal(second.documentSha256, first.documentSha256);
  assert.deepEqual(fs.readFileSync(files.document), original);
  assert.ok(original.toString('utf8').includes(`Rev. ${input.finalResult.SOURCE_MODIFIED_AT.slice(0, 10)}`));
  assert.ok(!original.toString('utf8').includes(`Rev. ${new Date(nextDay).toISOString().slice(0, 10)}`));
  assert.equal(fs.readdirSync(directory).length, 3);
});

test('a corrected terminal source creates a distinct immutable version without changing the prior draft', async (t) => {
  const directory = privateOutput(t);
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const first = await prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot });
  const prior = fs.readFileSync(paths(directory, first).document);
  input.finalResult.SOURCE_MODIFIED_AT = new Date(Date.parse(input.finalResult.SOURCE_MODIFIED_AT) + 1000).toISOString();
  const scope = input.evidence.scopes[0];
  scope.analytics_readback.record_types.final_test_result.latest_source_modified_at = input.finalResult.SOURCE_MODIFIED_AT;
  scope.checkpoints.final_test_result.last_source_modified_at = input.finalResult.SOURCE_MODIFIED_AT;
  scope.checkpoints.final_test_result.provider_watermark = input.finalResult.SOURCE_MODIFIED_AT;
  refreshDigests(input);
  const second = await prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot });
  assert.notEqual(second.generationKey, first.generationKey);
  assert.equal(second.status, 'draft_created_not_for_delivery');
  assert.deepEqual(fs.readFileSync(paths(directory, first).document), prior);
  assert.equal(fs.readdirSync(directory).length, 6);
});

test('a fresh canonical detail snapshot changes no document identity when its call content is unchanged', async (t) => {
  const { input, snapshot, now, runtime } = await privateCallLedgerFixture();
  const directory = privateOutput(t);
  const first = await prepareFreeTestDraft(input, { privateDirectory: directory,
    now, synthetic: true, callDetails: snapshot });
  const nextDay = now + 86_400_000;
  refreshEvidence(input, nextDay);
  const freshSnapshot = await queryClientCallDetails(runtime.store, runtime.config, 'client_A', 'deployment_A', nextDay);
  assert.notEqual(freshSnapshot.capturedAt, snapshot.capturedAt);
  const second = await prepareFreeTestDraft(input, { privateDirectory: directory,
    now: nextDay, synthetic: true, callDetails: freshSnapshot });
  assert.equal(second.status, 'existing_draft_verified_not_for_delivery');
  assert.equal(second.generationKey, first.generationKey);
  assert.equal(second.documentSha256, first.documentSha256);
  assert.equal(fs.readdirSync(directory).length, 3);
});

test('changed validated request content creates a new draft even when Analytics facts are unchanged', async (t) => {
  const firstFixture = await privateCallLedgerFixture({ issue_summary: 'Synthetic kitchen leak' });
  const secondFixture = await privateCallLedgerFixture({ issue_summary: 'Synthetic bathroom leak' });
  const directory = privateOutput(t);
  assert.deepEqual(firstFixture.input.calls, secondFixture.input.calls);
  const first = await prepareFreeTestDraft(firstFixture.input, { privateDirectory: directory,
    now: firstFixture.now, synthetic: true, callDetails: firstFixture.snapshot });
  const second = await prepareFreeTestDraft(secondFixture.input, { privateDirectory: directory,
    now: secondFixture.now, synthetic: true, callDetails: secondFixture.snapshot });
  assert.notEqual(first.generationKey, second.generationKey);
  assert.notEqual(first.documentSha256, second.documentSha256);
  assert.match(fs.readFileSync(paths(directory, first).document, 'utf8'), /Synthetic kitchen leak/);
  assert.match(fs.readFileSync(paths(directory, second).document, 'utf8'), /Synthetic bathroom leak/);
});

test('a changed reviewed contractor value creates a distinct draft without overwriting the prior amount', async (t) => {
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const directory = privateOutput(t);
  const opportunityReview = {
    schemaVersion: 1, methodId: METHOD_ID, methodVersion: METHOD_VERSION,
    scope: Object.fromEntries(['CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
      'ENVIRONMENT', 'ENGAGEMENT_TYPE', 'SOURCE_REVISION'].map((key) => [key, input.deployment[key]])),
    callRowsetDigest: input.evidence.scopes[0].analytics_readback.record_types.call.rowset_digest,
    review: { status: 'reviewed', reviewedAt: new Date(now).toISOString(), reviewerReference: sha256('synthetic-reviewer') },
    groups: [{ groupKey: sha256('synthetic-group'), callKeys: [input.calls[0].CALL_KEY], reviewStatus: 'qualified',
      knownJobValue: { amountMinorUnits: 12000, currency: 'USD', evidenceReference: sha256('synthetic-basis'),
        effectiveDate: input.finalResult.SOURCE_MODIFIED_AT.slice(0, 10) }, averageJobValue: null }],
  };
  const options = { privateDirectory: directory, now, synthetic: true, callDetails: snapshot, opportunityReview };
  const first = await prepareFreeTestDraft(input, options);
  const original = fs.readFileSync(paths(directory, first).document, 'utf8');
  opportunityReview.groups[0].knownJobValue.amountMinorUnits = 18000;
  const second = await prepareFreeTestDraft(input, options);
  assert.notEqual(second.generationKey, first.generationKey);
  assert.notEqual(second.documentSha256, first.documentSha256);
  assert.equal(fs.readFileSync(paths(directory, first).document, 'utf8'), original);
  assert.equal(fs.readdirSync(directory).length, 6);
});

test('an exact complete document can recover a missing receipt by readback without rewriting the document', async (t) => {
  const directory = privateOutput(t);
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const first = await prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot });
  const files = paths(directory, first);
  const before = fs.statSync(files.document);
  fs.unlinkSync(files.receipt);
  const second = await prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot });
  assert.equal(second.status, 'existing_draft_verified_not_for_delivery');
  assert.equal(second.receiptSha256, first.receiptSha256);
  assert.equal(fs.statSync(files.document).mtimeMs, before.mtimeMs);
  assert.equal(fs.readdirSync(directory).length, 3);
});

test('a durable intent with absent or partial document requires reconciliation and never retries the write', async (t) => {
  for (const partial of [false, true]) {
    const directory = privateOutput(t);
    const { input, snapshot, now } = await privateCallLedgerFixture();
    const first = await prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot });
    const files = paths(directory, first);
    fs.unlinkSync(files.receipt);
    if (partial) fs.writeFileSync(files.document, '<html>partial private content');
    else fs.unlinkSync(files.document);
    await assert.rejects(prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot }), rejected);
    assert.equal(fs.existsSync(files.receipt), false);
    assert.equal(fs.existsSync(files.document), partial);
    if (partial) assert.equal(fs.readFileSync(files.document, 'utf8'), '<html>partial private content');
  }
});

test('a conflicting receipt or orphan document blocks without overwriting or adopting it', async (t) => {
  for (const orphan of [false, true]) {
    const directory = privateOutput(t);
    const { input, snapshot, now } = await privateCallLedgerFixture();
    const first = await prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot });
    const files = paths(directory, first);
    if (orphan) { fs.unlinkSync(files.intent); fs.unlinkSync(files.receipt); }
    else fs.writeFileSync(files.receipt, '{"private":"do-not-echo"}');
    await assert.rejects(prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot }), rejected);
    if (orphan) assert.equal(fs.existsSync(files.intent), false);
    else assert.equal(fs.readFileSync(files.receipt, 'utf8'), '{"private":"do-not-echo"}');
  }
});

test('linked private outputs and public, relative, network or absent directories are rejected', async (t) => {
  const directory = privateOutput(t);
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const first = await prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot });
  const files = paths(directory, first);
  fs.linkSync(files.document, path.join(directory, 'linked.html'));
  await assert.rejects(prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot }), rejected);
  const nestedRepository = path.join(privateOutput(t), 'repository');
  fs.mkdirSync(nestedRepository);
  fs.mkdirSync(path.join(nestedRepository, '.git'));
  for (const candidate of [nestedRepository, '.', '\\\\example.invalid\\reports', path.join(directory, 'missing')]) {
    await assert.rejects(prepareFreeTestDraft(input, { privateDirectory: candidate, now, callDetails: snapshot }), rejected);
  }
  assert.deepEqual(fs.readdirSync(nestedRepository), ['.git']);
});

test('unsupported options and forged serialized call details cannot leak or create outputs', async (t) => {
  const directory = privateOutput(t);
  const { input, snapshot, now } = await privateCallLedgerFixture();
  for (const extra of [{ audience: 'internal' }, { send: true }, { recipient: 'do-not-echo' },
    { callDetails: { rows: [{ issueSummary: 'unvalidated private text' }] } }]) {
    await assert.rejects(prepareFreeTestDraft(input, { privateDirectory: directory, now, callDetails: snapshot, ...extra }), rejected);
  }
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('existing runtime terminal and CRM reconciliation feed actual Analytics checkpoint callbacks and one client draft locally', async (t) => {
  // Reuse the accepted connected runtime/CRM harness and Analytics MemoryStore.
  // These are local synthetic adapters, not provider receipts or cloud writes.
  const h = await createOfflineHarness();
  const admission = await h.inbound('A');
  await h.event('A', admission.body.call_inbound.metadata, 'draft_pipeline', {
    caller_intent: 'Synthetic repair request', issue_summary: 'Synthetic leaking tap',
    bookable_opportunity: true, office_follow_up_required: true,
    workflow_failure_code: null, workflow_failure_text: null,
  });
  h.runtime.clock.value = Date.parse('2026-08-27T12:00:01.000Z');
  await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_A' });
  const operation = h.runtime.store.rows.get('CRMBillingOperations')[0];
  await h.dispatcher.dispatch(operation.CRM_DEAL_ID, operation.OPERATION_KEY);
  await h.job({ mode: 'reconcile_deployment', deployment_id: 'deployment_A' });
  assert.equal(operation.STATUS, 'completed');
  assert.equal(operation.LAST_OUTCOME, 'report_summary_readback_confirmed');
  const deployment = h.runtime.store.rows.get('RevenueDeskDeployments')
    .find((row) => row.DEPLOYMENT_ID === 'deployment_A');
  assert.equal(deployment.REPORT_RECONCILIATION_STATUS, 'Completed');

  const required = ['deployment', 'call', 'final_test_result'];
  const all = h.runtime.store.rows.get('AnalyticsSyncOutbox');
  const final = all.find((row) => row.RECORD_TYPE === 'final_test_result');
  assert.ok(final, 'Final fact must be emitted by the runtime, not supplied by the test');
  const latest = new Map();
  for (const row of all.filter((candidate) => candidate.CLIENT_KEY === final.CLIENT_KEY
    && candidate.DEPLOYMENT_KEY === final.DEPLOYMENT_KEY && required.includes(candidate.RECORD_TYPE))) {
    const identity = `${row.RECORD_TYPE}:${row.RECORD_KEY}`;
    if (!latest.has(identity) || latest.get(identity).SOURCE_MODIFIED_AT < row.SOURCE_MODIFIED_AT) latest.set(identity, row);
  }
  const store = new MemoryStore([...latest.values()]);
  const imported = new Map(); const jobs = new Map(); const exported = new Map();
  let sequence = 1000; let random = 1; let clock = h.runtime.clock.value + 1000;
  const adapter = {
    async submitBatch(type, rows) {
      const id = String(sequence++); jobs.set(id, rows.length);
      const table = imported.get(type) || new Map();
      for (const row of rows) table.set(row.RECORD_KEY, structuredClone(row));
      imported.set(type, table); return { jobId: id };
    },
    async pollImport(id) { return { state: 'complete', totalRows: jobs.get(id), acceptedRows: jobs.get(id), rejectedRows: 0 }; },
    async startReadback(type, rows) {
      const id = String(sequence++);
      exported.set(id, rows.map((row) => structuredClone(imported.get(type).get(row.RECORD_KEY))));
      return { jobId: id };
    },
    async pollReadback(id) { return { state: 'complete', rows: structuredClone(exported.get(id)) }; },
  };
  const directory = privateOutput(t);
  const observed = []; const receipts = [];
  const trigger = createReconciledDraftTrigger({ privateDirectory: directory, synthetic: true,
    now: () => clock,
    async readReconciledInput(event) {
      observed.push(event);
      assert.ok(Object.isFrozen(event) && Object.isFrozen(event.scope));
      assert.deepEqual(Object.keys(event).sort(), ['reconciledAt', 'recordType', 'scope', 'sourceModifiedAt']);
      const checkpoints = [...store.checkpoints.values()];
      if (required.some((type) => !checkpoints.some((row) => row.RECORD_TYPE === type))) return null;
      const sourceRows = store.rows.filter((row) => required.includes(row.RECORD_TYPE));
      if (sourceRows.some((row) => row.SYNC_STATUS !== 'Succeeded')) return null;
      const facts = Object.fromEntries(required.map((type) => [type,
        sourceRows.filter((row) => row.RECORD_TYPE === type).map((row) => parseOutboxRow(row, 'development').fact)]));
      const scope = { ENVIRONMENT: final.ENVIRONMENT, ENGAGEMENT_TYPE: final.ENGAGEMENT_TYPE,
        CLIENT_KEY: final.CLIENT_KEY, DEPLOYMENT_KEY: final.DEPLOYMENT_KEY,
        unresolved_v2_outbox_rows: sourceRows.filter((row) => row.SYNC_STATUS !== 'Succeeded').length,
        source_call_count: facts.call.length,
        checkpoints: Object.fromEntries(required.map((type) => {
          const checkpoint = checkpoints.find((row) => row.RECORD_TYPE === type);
          return [type, { status: checkpoint.STATUS, last_error_code: checkpoint.LAST_ERROR_CODE,
            last_rejected_row_count: checkpoint.LAST_REJECTED_ROW_COUNT,
            last_source_modified_at: checkpoint.LAST_SOURCE_MODIFIED_AT,
            provider_watermark: checkpoint.PROVIDER_WATERMARK, last_reconciled_at: checkpoint.LAST_RECONCILED_AT,
            stale_after_at: checkpoint.STALE_AFTER_AT, source_revision: checkpoint.SOURCE_REVISION }];
        })),
        analytics_readback: { binding_verified: true, partition_isolation_verified: true,
          record_types: Object.fromEntries(required.map((type) => {
            const rows = [...imported.get(type).values()];
            return [type, { row_count: rows.length, duplicate_record_key_count: rows.length - new Set(rows.map((row) => row.RECORD_KEY)).size,
              payload_hash_mismatch_count: 0, source_revision: h.runtime.config.sourceRevision,
              rowset_digest: readbackRowsetDigest(type, rows),
              latest_source_modified_at: rows.map((row) => row.SOURCE_MODIFIED_AT).sort().at(-1) }];
          })) },
      };
      const scopeDigest = scopeInventoryDigest([scope]);
      const input = { deployment: facts.deployment[0], calls: facts.call, finalResult: facts.final_test_result[0],
        evidence: { schema_version: 1, evaluated_at: new Date(clock).toISOString(),
          approved_source_revision: h.runtime.config.sourceRevision,
          scope_inventory: { expected_scope_count: 1, catalyst_scope_digest: scopeDigest, analytics_scope_digest: scopeDigest },
          scopes: [scope] },
        approval: { schema_version: 1, approved_source_revision: h.runtime.config.sourceRevision,
          approved_scope_inventory_digest: scopeDigest },
      };
      const callDetails = await queryClientCallDetails(h.runtime.store, h.runtime.config, 'client_A', 'deployment_A', clock);
      return { input, callDetails };
    },
  });
  const service = createAnalyticsSyncService({ store, adapter,
    config: serviceConfig({ sourceRevision: h.runtime.config.sourceRevision }), now: () => clock,
    randomBytes: (size) => Buffer.alloc(size, random++),
    onReconciledScope: async (event) => { const result = await trigger(event); receipts.push(result); return result; },
  });
  for (let run = 0; run < 30; run += 1) {
    const result = await service.run();
    assert.notEqual(result.state, 'ReconciliationRequired');
    assert.notEqual(result.state, 'TerminalFailure');
    if (result.state === 'Idle') break;
    clock += 30_000;
  }
  assert.deepEqual(new Set(observed.map((event) => event.recordType)), new Set(required));
  assert.equal(receipts.filter((receipt) => receipt.status === 'awaiting_reconciled_evidence').length, 2);
  const generated = receipts.filter((receipt) => receipt.status === 'draft_created_not_for_delivery');
  assert.equal(generated.length, 1);
  assert.ok(store.rows.every((row) => row.SYNC_STATUS === 'Succeeded'));
  assert.ok([...store.checkpoints.values()].every((row) => row.STATUS === 'Healthy'));
  assert.equal(fs.readdirSync(directory).length, 3);
  const html = fs.readFileSync(paths(directory, generated[0]).document, 'utf8');
  assert.match(html, /Synthetic leaking tap/);
  assert.match(html, /C-0001/);
  assert.match(html, /Not for delivery/);
});

test('a failed post-checkpoint draft hook is explicit and cannot replay a completed Analytics import', async () => {
  const { input, now } = await privateCallLedgerFixture();
  const initial = createOutboxRow('deployment', input.deployment, new Date(now).toISOString());
  const expected = targetRow(parseOutboxRow(initial, 'development'));
  const store = new MemoryStore([initial]);
  let clock = now; let submitted = 0; let hookCalls = 0; let random = 1;
  const service = createAnalyticsSyncService({ store, config: serviceConfig({ sourceRevision: input.deployment.SOURCE_REVISION }),
    now: () => clock, randomBytes: (size) => Buffer.alloc(size, random++),
    adapter: {
      async submitBatch() { submitted += 1; return { jobId: '1001' }; },
      async pollImport() { return { state: 'complete', totalRows: 1, acceptedRows: 1, rejectedRows: 0 }; },
      async startReadback() { return { jobId: '2001' }; },
      async pollReadback() { return { state: 'complete', rows: [expected] }; },
    },
    async onReconciledScope() { hookCalls += 1; throw new Error('private-data-must-not-escape'); },
  });
  for (const state of ['Submitted', 'ReadbackSubmitted', 'CheckpointPending']) {
    assert.equal((await service.run()).state, state);
    assert.equal(hookCalls, 0);
    clock += 30_000;
  }
  const failed = await service.run();
  assert.equal(failed.state, 'ReconciliationRequired');
  assert.equal(failed.reportDraftStatus, 'draft_reconciliation_required');
  assert.equal(JSON.stringify(failed).includes('private-data-must-not-escape'), false);
  assert.equal(store.rows[0].SYNC_STATUS, 'Succeeded');
  assert.equal((await service.run()).state, 'Idle');
  assert.equal(submitted, 1);
  assert.equal(hookCalls, 1);
});

test('the completion adapter rejects mismatched scope and incomplete evidence rather than trusting a wakeup', async (t) => {
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const directory = privateOutput(t);
  const scope = Object.fromEntries(['CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
    'ENGAGEMENT_TYPE', 'ENVIRONMENT', 'SOURCE_REVISION'].map((key) => [key, input.deployment[key]]));
  const event = { scope, recordType: 'final_test_result', sourceModifiedAt: input.finalResult.SOURCE_MODIFIED_AT,
    reconciledAt: new Date(now).toISOString() };
  const trigger = createReconciledDraftTrigger({ privateDirectory: directory, now: () => now,
    readReconciledInput: async () => ({ input, callDetails: snapshot }) });
  await assert.rejects(trigger({ ...event, scope: { ...scope, CLIENT_KEY: '0'.repeat(64) } }), rejected);
  const incomplete = structuredClone(input);
  delete incomplete.evidence.scopes[0].checkpoints.call;
  const partial = createReconciledDraftTrigger({ privateDirectory: directory, now: () => now,
    readReconciledInput: async () => ({ input: incomplete, callDetails: snapshot }) });
  await assert.rejects(partial(event), rejected);
  assert.deepEqual(fs.readdirSync(directory), []);
});
