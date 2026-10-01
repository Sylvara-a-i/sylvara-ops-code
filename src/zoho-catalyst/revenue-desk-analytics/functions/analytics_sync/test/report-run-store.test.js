'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createReportRunStore } = require('../lib/report-run-store');
const key = 'a'.repeat(64);
const syntheticRowId = `1${'0'.repeat(15)}1`;
const state = { kind: 'report_attempt_v1', identity: { clientId: 'client_A', deploymentId: 'deployment_A',
  periodStart: '2026-09-20', periodEnd: '2026-09-27' }, phase: 'working', owner: 'synthetic',
failures: 1, nextAttemptAt: 1800000000000, lastGenerationKey: null };
function fixture() {
  let row = null;
  const statements = [];
  const f = { failInsertResponse: false, failUpdateResponse: false, conflict: false,
    read: () => row, corrupt: fn => { row = fn(row); } };
  const app = { datastore: () => ({ table(name) {
    assert.equal(name, 'ReportRuns');
    return { async insertRow(value) {
      assert.equal(row, null);
      row = { ...value, ROWID: syntheticRowId };
      if (f.failInsertResponse) throw new Error('private provider response');
      return { ...row };
    } };
  } }), zcql: () => ({ async executeZCQLQuery(sql) {
    statements.push(sql);
    assert.ok(sql.includes('ReportRuns'));
    if (sql.startsWith('UPDATE')) {
      assert.match(sql, new RegExp(`WHERE ROWID = ${syntheticRowId} AND IdempotencyKey = 'revenue-desk-report-v1:[a-f0-9]{64}' AND RD_REPORT_VERSION = 1$`));
      if (!f.conflict) {
        for (const match of sql.split(' WHERE ')[0].matchAll(/([A-Za-z_]+) = ('(?:[^']|'')*'|NULL|TRUE|FALSE|\d+)/g)) {
          const raw = match[2];
          row[match[1]] = raw.startsWith("'") ? raw.slice(1, -1).replaceAll("''", "'")
            : raw === 'NULL' ? null : raw === 'TRUE' ? true : raw === 'FALSE' ? false : Number(raw);
        }
      }
      if (f.failUpdateResponse) throw new Error('ambiguous provider response');
      return [];
    }
    assert.match(sql, /^SELECT \* FROM ReportRuns WHERE IdempotencyKey = 'revenue-desk-report-v1:[a-f0-9]{64}' LIMIT 2$/);
    return row ? [{ ReportRuns: structuredClone(row) }] : [];
  } }) };
  return Object.assign(f, { app, statements, store: createReportRunStore({ app, environment: 'development' }) });
}

test('observed mandatory ReportRuns columns are populated without fabricated approval/delivery', async () => {
  const f = fixture();
  const result = await f.store.insert(key, state);
  assert.equal(result.state.phase, 'working');
  assert.equal(f.read().ClientId, 'client_A');
  assert.equal(f.read().DeploymentId, 'deployment_A');
  assert.equal(f.read().PeriodStart, '2026-09-20');
  assert.equal(f.read().PeriodEnd, '2026-09-27');
  assert.equal(f.read().ReportType, 'free_test_report_verification_attempt');
  assert.equal(f.read().ApprovalStatus, 'OwnerReviewRequired');
  assert.equal(f.read().DeliveryStatus, 'NotSent');
  assert.equal(f.read().ReportTotalsReconciled, false);
  assert.equal(f.read().AutoDeliveryEnabledAtRun, false);
  assert.equal(f.read().RecipientSnapshotJson, undefined);
});

test('existing unique IdempotencyKey scopes reads away from retained legacy rows', async () => {
  const f = fixture();
  assert.equal(await f.store.get(key), null);
  assert.equal(f.statements.length, 1);
  await assert.rejects(f.store.get("' OR true"));
  assert.equal(f.statements.length, 1);
  assert.throws(() => createReportRunStore({ app: f.app, environment: 'production' }));
});

test('CAS requires independent row/version/state and operator-index readback', async () => {
  const f = fixture();
  const first = await f.store.insert(key, state);
  const next = await f.store.compareAndSwap(first, { ...state, phase: 'waiting' });
  assert.equal(next.version, 2);
  assert.equal(next.state.phase, 'waiting');
  f.corrupt(row => ({ ...row, DeliveryStatus: 'Sent' }));
  await assert.rejects(f.store.get(key));
});

test('malformed durable state, impossible period and cancelled query fail closed', async () => {
  const f = fixture();
  await assert.rejects(f.store.insert(key, { ...state, identity: { ...state.identity, periodStart: '2026-02-30' } }));
  assert.equal(f.read(), null);
  const controller = new AbortController(); controller.abort();
  const count = f.statements.length;
  await assert.rejects(f.store.get(key, { signal: controller.signal }));
  assert.equal(f.statements.length, count);
  await f.store.insert(key, state);
  f.corrupt(row => ({ ...row, ReportPayloadJson: '{private-bad-json' }));
  await assert.rejects(f.store.get(key), { code: 'REPORT_RUN_RECONCILIATION_REQUIRED' });
});

test('immediate cancellation prevents SDK dispatch in the timeout microtask gap', async () => {
  for (const operation of ['get', 'insert', 'compareAndSwap']) {
    const f = fixture();
    const current = operation === 'compareAndSwap' ? await f.store.insert(key, state) : null;
    const before = f.statements.length;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const pending = operation === 'get' ? f.store.get(key, options)
      : operation === 'insert' ? f.store.insert(key, state, options)
        : f.store.compareAndSwap(current, { ...state, phase: 'waiting' }, options);
    controller.abort();
    await assert.rejects(pending, { code: 'REPORT_RUN_RECONCILIATION_REQUIRED' });
    assert.equal(f.statements.length, before);
    assert.equal(f.read()?.RD_REPORT_VERSION ?? null, current?.version ?? null);
  }
});

test('ambiguous insert and CAS recover by exact independent readback, while conflict stays unconfirmed', async () => {
  const f = fixture(); f.failInsertResponse = true; f.failUpdateResponse = true;
  const first = await f.store.insert(key, state);
  assert.equal(first.version, 1);
  f.conflict = true;
  assert.equal(await f.store.compareAndSwap(first, { ...state, phase: 'waiting' }), null);
  f.conflict = false;
  assert.equal((await f.store.compareAndSwap(first, { ...state, phase: 'waiting' })).version, 2);
  for (const version of [true, '', '01', 2147483648]) {
    f.corrupt(row => ({ ...row, RD_REPORT_VERSION: version }));
    await assert.rejects(f.store.get(key), { code: 'REPORT_RUN_RECONCILIATION_REQUIRED' });
  }
});

test('PDF ReportRuns projection preserves format and blocks corrupt index readback while old HTML remains valid', async () => {
  const draft = { kind: 'workdrive_draft_v1', identity: { ...state.identity, rendererVersion: 'synthetic-pdf-v1', format: 'pdf' },
    phase: 'intent', owner: 'synthetic', leaseUntil: 1800000000000, receipt: null };
  const pdf = fixture();
  await pdf.store.insert(key, draft);
  assert.equal(pdf.read().ReportFormat, 'pdf');
  pdf.corrupt(row => ({ ...row, ReportFormat: 'html' }));
  await assert.rejects(pdf.store.get(key));
  const legacy = fixture();
  const old = structuredClone(draft); delete old.identity.format;
  await legacy.store.insert(key, old);
  assert.equal(legacy.read().ReportFormat, 'html');
  await legacy.store.get(key);
  const invalid = fixture();
  await assert.rejects(invalid.store.insert(key, { ...draft, identity: { ...draft.identity, format: 'image' } }));
  assert.equal(invalid.read(), null);
});


test('durable PDF dispatch claims project as pending and accepted checksum state never fabricates report approval', async () => {
  const f = fixture();
  const claim = { kind: 'pdf_generation_v1', identity: { ...state.identity,
    generationKey: 'b'.repeat(64), sourceGenerationKey: 'c'.repeat(64),
    rendererQualificationDigest: 'd'.repeat(64), rendererVersion: 'synthetic-pdf-v2' },
    phase: 'render_started', owner: 'synthetic', accepted: null };
  const row = await f.store.insert(key, claim);
  assert.equal(f.read().ReportType, 'free_test_pdf_generation_claim');
  assert.equal(f.read().ReportFormat, 'pdf');
  assert.equal(f.read().GenerationStatus, 'VerificationPending');
  const accepted = { ...claim, phase: 'accepted', accepted: { generationKey: claim.identity.generationKey,
    documentSha256: 'e'.repeat(64), receiptSha256: 'f'.repeat(64) } };
  await f.store.compareAndSwap(row, accepted);
  assert.equal(f.read().ReconciliationStatus, 'Pending');
  assert.equal(f.read().ApprovalStatus, 'OwnerReviewRequired');
  assert.equal(f.read().DeliveryStatus, 'NotSent');
  assert.equal(f.read().ReportObjectKey, null);
  f.corrupt(row => ({ ...row, ReportFormat: 'html' }));
  await assert.rejects(f.store.get(key));
  await assert.rejects(fixture().store.insert(key, { ...accepted, accepted: null }));
  await assert.rejects(fixture().store.insert(key, { ...claim, phase: 'retry_render' }));
});

test('pair manifest is private, linked to both exact artifact identities and rejected when corrupt',async()=>{
 const crypto=require('node:crypto'),{canonicalJson}=require('../lib/facts');
 const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
 const identity={...state.identity,sourceGenerationKey:'b'.repeat(64),rendererVersion:'free-test-pair-v1',reviewSnapshotSha256:'c'.repeat(64),
  artifacts:Object.fromEntries(['summary','supporting'].map((role,n)=>[role,{generationKey:String(n+1).repeat(64),sourceGenerationKey:String(n+3).repeat(64),rendererQualificationDigest:'d'.repeat(64),rendererVersion:`free-test-packet-v1.${role}.pdf.synthetic-v1`}]))};
 const initial={kind:'report_bundle_v1',identity,phase:'working',manifest:null};
 const f=fixture(),row=await f.store.insert(key,initial);
 assert.equal(f.read().GenerationStatus,'VerificationPending');assert.equal(f.read().ReportObjectKey,null);
 const manifest={schemaVersion:1,sourceGenerationKey:identity.sourceGenerationKey,initialDeliveryArtifact:'summary',supportingAvailability:'private',reviewSnapshotSha256:identity.reviewSnapshotSha256,
  artifacts:Object.fromEntries(Object.entries(identity.artifacts).map(([role,a])=>[role,{generationKey:a.generationKey,documentSha256:'e'.repeat(64),receiptSha256:'f'.repeat(64),privateReceiptKey:hash(`workdrive-draft-v1\0${a.generationKey}`)}]))};
 const accepted={...initial,phase:'accepted',manifest,manifestSha256:hash(canonicalJson(manifest))};
 await f.store.compareAndSwap(row,accepted);assert.equal(f.read().GenerationStatus,'DraftGenerated');
 assert.equal(f.read().DeliveryStatus,'NotSent');assert.equal(f.read().AutoDeliveryEnabledAtRun,false);
 assert.equal(f.read().ReportType,'free_test_report_pair');assert.deepEqual(JSON.parse(f.read().ReportObjectKey),manifest);
 for(const mutate of [x=>delete x.manifest.artifacts.supporting,x=>x.manifest.initialDeliveryArtifact='supporting',x=>x.manifest.artifacts.summary.privateReceiptKey='a'.repeat(64),x=>x.manifest.artifacts.summary.documentSha256='0',x=>x.manifestSha256='0'.repeat(64),x=>x.manifest.reviewSnapshotSha256='a'.repeat(64)]){
  const invalid=structuredClone(accepted);mutate(invalid);await assert.rejects(fixture().store.insert(key,invalid));
 }
});


test('delivery reuses encrypted recipient and exact artifact projections with accepted-provider CAS readback', async () => {
 const f=fixture(),at=1800000000000,h=x=>require('node:crypto').createHash('sha256').update(x).digest('hex');
 const delivery={kind:'report_delivery_v1',mode:'initial',phase:'dispatch_started',claimToken:h('synthetic claim'),createdAt:at,confirmBy:at,inboxReceipt:'unknown',readReceipt:'unknown',followUp:'unknown',snapshot:{binding:{clientId:'synthetic_client',deploymentId:'synthetic_deployment',dealId:'synthetic_deal',accountId:'synthetic_account',contactId:'synthetic_contact',configurationVersion:'configuration_v1',periodStart:'2027-01-01',periodEnd:'2027-01-07'},nativeRelationshipEvidenceSha256:h('native lineage'),report:{generationKey:h('pair'),manifestSha256:h('manifest'),sourceRevisionDigest:h('source'),summary:{role:'summary',generationKey:h('pdf'),documentSha256:h('actual bytes'),privateReceiptKey:h('private receipt')}},recipient:{contactId:'synthetic_contact',address:'owner@example.com',verificationDigest:h('explicit verified recipient'),verifiedAt:at-1000,expiresAt:at+3600000}}};
 const first=await f.store.insert(key,delivery);assert.equal(f.read().DeliveryStatus,'ReconciliationRequired');
 assert.equal(JSON.parse(f.read().RecipientSnapshotJson).address,'owner@example.com');assert.equal(f.read().AutoDeliveryEnabledAtRun,true);
 f.failUpdateResponse=true;const accepted={...delivery,phase:'provider_accepted',provider:{accepted:true,messageReferenceDigest:h('exact provider reference'),acceptedAt:at}};
 const second=await f.store.compareAndSwap(first,accepted);assert.equal(second.state.phase,'provider_accepted');assert.equal(f.read().DeliveryStatus,'ProviderAccepted');
 f.corrupt(row=>({...row,RecipientSnapshotJson:'{}'}));await assert.rejects(f.store.get(key));
});
