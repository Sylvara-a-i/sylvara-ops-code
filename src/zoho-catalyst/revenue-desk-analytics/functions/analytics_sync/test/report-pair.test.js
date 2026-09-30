'use strict';
const assert=require('node:assert/strict'), test=require('node:test'), crypto=require('node:crypto');
const {installOfflineGuard}=require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard=installOfflineGuard();test.after(()=>{guard.restore();assert.deepEqual(guard.blocked,[]);});
const {createReconciledReportFixture}=require('./helpers/reconciled-report-fixture');
const {createWorkDriveDraftFixture}=require('./helpers/workdrive-draft-fixture');
const {prepareFreeTestDocument}=require('../../../tools/prepare-free-test-draft');
const {createDurableReportComposition}=require('../../../tools/create-durable-report-composition');
const {categoryChart}=require('../../../tools/report-packet-layout');
const {preparePdfPayload}=require('../lib/native-pdf-renderer');
const {METHOD_ID,METHOD_VERSION,SCOPE_FIELDS}=require('../../../tools/opportunity-value');
const {factRowsetDigest}=require('../../../tools/build-free-test-report');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const rejection={code:'DRAFT_RECONCILIATION_REQUIRED'};
async function fixture(count=1){
 const f=await createReconciledReportFixture({analyses:Array.from({length:count},(_,n)=>({issue_summary:`Synthetic request ${n+1}`}))});
 const data=await f.readInput(f.identity);
 const source=prepareFreeTestDocument(data.input,{now:f.now(),synthetic:true,callDetails:data.callDetails});
 const d=createWorkDriveDraftFixture(source,{now:f.now()});let renders=0;
 const renderer={version:'synthetic-pair-v1',qualificationDigest:'d'.repeat(64),async render({html}){
  renders++;assert.ok([...d.rows.values()].some(r=>r.state.kind==='report_bundle_v1'));
  preparePdfPayload(html);return Buffer.from(`%PDF-1.7\n% synthetic ${hash(html)}\n%%EOF\n`);
 }};
 const options={...f.readerOptions,reportRunStore:d.runs,workdrive:d.workdrive,readDestinationBinding:d.readDestinationBinding,now:f.now,synthetic:true,pdfRenderer:renderer,reportBundle:true};
 const advance=()=>{f.runtime.clock.value=[...d.rows.values()].find(r=>r.state.kind==='report_attempt_v1').state.nextAttemptAt;};
 return {f,d,data,source,renderer,options,advance,get renders(){return renders;}};
}
test('summary suppresses chart below five and uses only existing labeled counts at five',()=>{
 const mix=[{category:'new_job_opportunities',label:'New jobs',calls:4},{category:'needs_review',label:'Unclear',calls:0}];
 assert.doesNotMatch(categoryChart(mix),/class="call-chart"/);
 mix[1].calls=1;const html=categoryChart(mix);assert.match(html,/class="call-chart"/);
 assert.match(html,/Potential new-job inquiries/);assert.match(html,/>4<\/strong>/);assert.match(html,/>1<\/strong>/);
 assert.match(html,/Call counts are not unique jobs/);assert.doesNotMatch(html,/pie|svg|canvas/);
});
test('one snapshot produces distinct role identities and full supporting call evidence',async()=>{
 const x=await fixture(25), before=structuredClone(x.data.input);
 const options={now:x.f.now(),synthetic:true,callDetails:x.data.callDetails};
 const summary=prepareFreeTestDocument(x.data.input,{...options,packetRole:'summary'});
 const supporting=prepareFreeTestDocument(x.data.input,{...options,packetRole:'supporting'});
 assert.notEqual(summary.generationKey,supporting.generationKey);
 assert.equal((summary.document.toString().match(/class="page"/g)||[]).length,2);
 assert.match(summary.document.toString(),/class="call-chart"/);
 assert.equal((supporting.document.toString().match(/class="call-detail"/g)||[]).length,25);
 assert.match(supporting.document.toString(),/C-0025/);assert.match(supporting.document.toString(),/Complete supporting packet/);
 assert.match(summary.document.toString(),/Sylvara premium digital mark/);
 assert.deepEqual(x.data.input,before);
});
test('pair accepts both actual byte hashes and repeats with no rendering or uploads',async()=>{
 const x=await fixture(25), reconcile=createDurableReportComposition(x.options);
 const first=await reconcile(x.f.identity);assert.equal(first.status,'report_pair_verified_not_for_delivery');
 assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
 assert.equal(first.manifest.initialDeliveryArtifact,'summary');assert.equal(first.manifest.supportingAvailability,'private');
 for(const [role,a] of Object.entries(first.manifest.artifacts)){
  const uploaded=[...x.d.resources.values()].find(r=>r.metadata.name.includes(a.generationKey));
  assert.equal(hash(uploaded.bytes),a.documentSha256);assert.equal(a.documentSha256,first.artifacts[role].documentSha256);
 }
 x.advance();const second=await reconcile(x.f.identity);assert.deepEqual(second.manifest,first.manifest);
 assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
});
test('concurrent pair requests have only two total conversions and uploads',async()=>{
 const x=await fixture();const results=await Promise.all([createDurableReportComposition(x.options)(x.f.identity),createDurableReportComposition(x.options)(x.f.identity)]);
 assert.equal(results.filter(r=>r.status==='report_pair_verified_not_for_delivery').length,1);
 assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
});
test('unknown second rendering keeps pair incomplete and cannot rerender either artifact',async()=>{
 const x=await fixture();let calls=0;
 const renderer={...x.renderer,async render(input){calls++;if(calls===2)throw Error('synthetic unknown render outcome');return x.renderer.render(input);}};
 const reconcile=createDurableReportComposition({...x.options,pdfRenderer:renderer});
 await assert.rejects(reconcile(x.f.identity),rejection);assert.equal(x.d.uploads.length,1);
 assert.equal([...x.d.rows.values()].find(r=>r.state.kind==='report_bundle_v1').state.phase,'working');
 x.advance();await assert.rejects(reconcile(x.f.identity),rejection);assert.equal(calls,2);assert.equal(x.d.uploads.length,1);
});
test('stored-content mismatch blocks accepted pair reuse without more effects',async()=>{
 const x=await fixture(), reconcile=createDurableReportComposition(x.options);await reconcile(x.f.identity);
 const resource=[...x.d.resources.values()][0];resource.bytes[10]^=1;x.advance();
 await assert.rejects(reconcile(x.f.identity),rejection);assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
});
test('lost pair acceptance response recovers exact manifest without repeated effects',async()=>{
 const x=await fixture();const original=x.d.runs.compareAndSwap.bind(x.d.runs);
 x.d.runs.compareAndSwap=async(row,state,context)=>{const result=await original(row,state,context);return state.kind==='report_bundle_v1'&&state.phase==='accepted'?null:result;};
 const result=await createDurableReportComposition(x.options)(x.f.identity);
 assert.equal(result.status,'report_pair_verified_not_for_delivery');assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
});
test('corrected reviewed source creates a new immutable pair preserving both prior artifacts',async()=>{
 const x=await fixture(), first=await createDurableReportComposition(x.options)(x.f.identity);x.advance();
 const input=x.data.input, now=x.f.now();
 const review={schemaVersion:1,methodId:METHOD_ID,methodVersion:METHOD_VERSION,scope:Object.fromEntries(SCOPE_FIELDS.map(k=>[k,input.deployment[k]])),callRowsetDigest:factRowsetDigest('call',input.calls),review:{status:'reviewed',reviewedAt:new Date(now).toISOString(),reviewerReference:hash('synthetic reviewer')},groups:[{groupKey:hash('synthetic group'),callKeys:[input.calls[0].CALL_KEY],reviewStatus:'qualified',knownJobValue:{amountMinorUnits:125000,currency:'USD',evidenceReference:hash('synthetic valuation'),effectiveDate:new Date(now).toISOString().slice(0,10)},averageJobValue:null}]};
 const second=await createDurableReportComposition({...x.options,readOpportunityReview:async()=>review})(x.f.identity);
 assert.notEqual(second.generationKey,first.generationKey);assert.equal(x.renders,4);assert.equal(x.d.uploads.length,4);
 for(const a of Object.values(first.manifest.artifacts))assert.ok([...x.d.resources.values()].some(r=>r.metadata.name.includes(a.generationKey)&&hash(r.bytes)===a.documentSha256));
});

test('second ambiguous completed upload recovers both exact versions without further conversion or POST',async()=>{
 const x=await fixture();const upload=x.d.workdrive.upload.bind(x.d.workdrive);let attempts=0;
 x.d.workdrive.upload=async(...args)=>{attempts++;const result=await upload(...args);if(attempts===2)throw Error('synthetic lost upload response');return result;};
 const reconcile=createDurableReportComposition(x.options);
 await assert.rejects(reconcile(x.f.identity),rejection);assert.equal(x.d.uploads.length,2);
 assert.equal([...x.d.rows.values()].find(r=>r.state.kind==='report_bundle_v1').state.phase,'working');
 x.advance();const result=await reconcile(x.f.identity);assert.equal(result.status,'report_pair_verified_not_for_delivery');
 assert.equal(attempts,2);assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
});
test('a stale snapshot during rendering cannot publish a mixed or accepted pair',async()=>{
 const x=await fixture();const renderer={...x.renderer,async render(input){const bytes=await x.renderer.render(input);x.f.imported.get('call').clear();return bytes;}};
 await assert.rejects(createDurableReportComposition({...x.options,pdfRenderer:renderer})(x.f.identity),rejection);
 assert.equal(x.renders,1);assert.equal(x.d.uploads.length,0);
 assert.equal([...x.d.rows.values()].find(r=>r.state.kind==='report_bundle_v1').state.phase,'working');
});

test('pair budget explicitly permits two uploads while legacy defaults retain one',()=>{
 const {createReportAttemptBudget,REPORT_ATTEMPT_MAXIMUMS,REPORT_PAIR_ATTEMPT_MAXIMUMS}=require('../lib/report-attempt-budget');
 assert.equal(REPORT_ATTEMPT_MAXIMUMS.workdrive_write,1);assert.equal(REPORT_PAIR_ATTEMPT_MAXIMUMS.workdrive_write,2);
 const b=createReportAttemptBudget({timeoutMs:1000,limits:REPORT_PAIR_ATTEMPT_MAXIMUMS});
 try{b.consume('workdrive_write',2);assert.throws(()=>b.consume('workdrive_write'),{code:'REPORT_ATTEMPT_LIMIT_EXCEEDED'});assert.equal(b.snapshot().workdrive_write,2);}finally{b.close();}
});

function documentedReview(x){const input=x.data.input,now=x.f.now();return {schemaVersion:1,methodId:METHOD_ID,methodVersion:METHOD_VERSION,scope:Object.fromEntries(SCOPE_FIELDS.map(k=>[k,input.deployment[k]])),callRowsetDigest:factRowsetDigest('call',input.calls),review:{status:'reviewed',reviewedAt:new Date(now).toISOString(),reviewerReference:hash('synthetic reviewer')},groups:[{groupKey:hash('synthetic group'),callKeys:[input.calls[0].CALL_KEY],reviewStatus:'qualified',knownJobValue:{amountMinorUnits:125000,currency:'USD',evidenceReference:hash('synthetic original valuation'),effectiveDate:new Date(now).toISOString().slice(0,10)},averageJobValue:null}]};}
test('a private evidence-only correction creates a new manifest while reusing both immutable PDFs',async()=>{
 const x=await fixture();let review=documentedReview(x);
 const reconcile=createDurableReportComposition({...x.options,readOpportunityReview:async()=>review});
 const first=await reconcile(x.f.identity);x.advance();review=structuredClone(review);
 review.groups[0].knownJobValue.evidenceReference=hash('synthetic corrected valuation reference');
 const second=await reconcile(x.f.identity);
 assert.notEqual(first.generationKey,second.generationKey);assert.notEqual(first.manifest.reviewSnapshotSha256,second.manifest.reviewSnapshotSha256);
 assert.deepEqual(first.manifest.artifacts,second.manifest.artifacts);assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
 assert.equal([...x.d.rows.values()].filter(r=>r.state.kind==='report_bundle_v1').length,2);
});
test('private review drift is held even when displayed amounts and request text are unchanged',async()=>{
 const x=await fixture(),original=documentedReview(x),changed=structuredClone(original);
 changed.groups[0].knownJobValue.evidenceReference=hash('synthetic changed during render');let reads=0;
 const reconcile=createDurableReportComposition({...x.options,readOpportunityReview:async()=>++reads===1?original:changed});
 await assert.rejects(reconcile(x.f.identity),rejection);assert.equal(x.renders,1);assert.equal(x.d.uploads.length,0);
 assert.equal([...x.d.rows.values()].find(r=>r.state.kind==='report_bundle_v1').state.phase,'working');
});
