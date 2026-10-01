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
async function fixture(count=1, physical=false){
 const f=await createReconciledReportFixture({analyses:Array.from({length:count},(_,n)=>({issue_summary:`Synthetic request ${n+1}`}))});
 const data=await f.readInput(f.identity);
 const source=prepareFreeTestDocument(data.input,{now:f.now(),synthetic:true,callDetails:data.callDetails});
 const d=createWorkDriveDraftFixture(source,{now:f.now()});let renders=0;
 const physicalStore=physical?require('./helpers/report-successor-fixture').fixture():null;
 if(physicalStore)d.runs=physicalStore.store;
 const renderer={version:'synthetic-pair-v1',qualificationDigest:'d'.repeat(64),async render({html}){
  renders++;assert.ok(physicalStore?[...physicalStore.rows.values()].some(r=>JSON.parse(r.ReportPayloadJson).state.kind==='report_bundle_v1'):[...d.rows.values()].some(r=>r.state.kind==='report_bundle_v1'));
  preparePdfPayload(html);return Buffer.from(`%PDF-1.7\n% synthetic ${hash(html)}\n%%EOF\n`);
 }};
 const options={...f.readerOptions,reportRunStore:d.runs,workdrive:d.workdrive,readDestinationBinding:d.readDestinationBinding,now:f.now,synthetic:true,pdfRenderer:renderer,reportBundle:true};
 const advance=()=>{const rows=physicalStore?[...physicalStore.rows.values()].sort((a,b)=>b.RD_REPORT_VERSION-a.RD_REPORT_VERSION).map(r=>({state:JSON.parse(r.ReportPayloadJson).state})):[...d.rows.values()];f.runtime.clock.value=rows.find(r=>r.state.kind==='report_attempt_v1').state.nextAttemptAt;};
 return {f,d,data,source,renderer,options,advance,physicalStore,get renders(){return renders;}};
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
test('corrected reviewed source creates a new immutable pair preserving both prior artifacts',async t=>{
 const x=await fixture(1,true), first=await createDurableReportComposition(x.options)(x.f.identity);x.advance();
 const input=x.data.input, now=x.f.now();
 const review={schemaVersion:1,methodId:METHOD_ID,methodVersion:METHOD_VERSION,scope:Object.fromEntries(SCOPE_FIELDS.map(k=>[k,input.deployment[k]])),callRowsetDigest:factRowsetDigest('call',input.calls),review:{status:'reviewed',reviewedAt:new Date(now).toISOString(),reviewerReference:hash('synthetic reviewer')},groups:[{groupKey:hash('synthetic group'),callKeys:[input.calls[0].CALL_KEY],reviewStatus:'qualified',knownJobValue:{amountMinorUnits:125000,currency:'USD',evidenceReference:hash('synthetic valuation'),effectiveDate:new Date(now).toISOString().slice(0,10)},averageJobValue:null}]};
 const second=await createDurableReportComposition({...x.options,readOpportunityReview:async()=>review})(x.f.identity);
 assert.notEqual(second.generationKey,first.generationKey);assert.equal(x.renders,4);assert.equal(x.d.uploads.length,4);
 t.diagnostic(`two corrected revisions: ${x.physicalStore.rows.size} immutable rows`);
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

test('physical immutable successors fit pair ceilings and accepted replay has no new effects',async t=>{
 const x=await fixture(25,true),baseline=structuredClone({analytics:x.f.analyticsStore.rows,crm:x.f.runtime.store.rows.get('CRMBillingOperations')});
 const first=await createDurableReportComposition(x.options)(x.f.identity);
 assert.equal(first.status,'report_pair_verified_not_for_delivery');
 const rows=x.physicalStore.rows.size,reads=x.physicalStore.queries.length,writes=x.physicalStore.writes.length;
 t.diagnostic(`cold pair: ${rows} physical rows, ${reads} reads, ${writes} insert attempts`);
 assert.ok(reads<=40);assert.ok(writes<=26);assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
 x.advance();const second=await createDurableReportComposition(x.options)(x.f.identity);
 assert.deepEqual(second.manifest,first.manifest);assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
 assert.deepEqual({analytics:x.f.analyticsStore.rows,crm:x.f.runtime.store.rows.get('CRMBillingOperations')},baseline);
 t.diagnostic(`accepted replay: ${x.physicalStore.queries.length-reads} reads, ${x.physicalStore.writes.length-writes} insert attempts`);
});

test('physical concurrent pair claims have one accepted owner and exactly two effects',async()=>{
 const x=await fixture(1,true);
 const results=await Promise.all([createDurableReportComposition(x.options)(x.f.identity),createDurableReportComposition(x.options)(x.f.identity)]);
 assert.equal(results.filter(r=>r.status==='report_pair_verified_not_for_delivery').length,1);
 assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
});
test('physical ambiguous render and stored mismatch cannot repeat provider effects',async()=>{
 for(const mismatch of [false,true]){const x=await fixture(1,true);let calls=0;
 const renderer=mismatch?x.renderer:{...x.renderer,async render(input){calls++;if(calls===2)throw Error('synthetic unknown');return x.renderer.render(input);}};
 const run=createDurableReportComposition({...x.options,pdfRenderer:renderer});
 if(mismatch){await run(x.f.identity);[...x.d.resources.values()][0].bytes[10]^=1;}
 else await assert.rejects(run(x.f.identity),rejection);
 const before={renders:x.renders,uploads:x.d.uploads.length,calls};x.advance();
 await assert.rejects(run(x.f.identity),rejection);
 assert.deepEqual({renders:x.renders,uploads:x.d.uploads.length,calls},before);
 }
});

function realAnalyticsAccounting(x){
 const {createAnalyticsClient}=require('../lib/analytics-client'),{TARGET_TABLE_NAMES}=require('../lib/config');
 const config={environment:'development',sourceRevision:x.f.scope.SOURCE_REVISION,analyticsTimeoutMs:20000,responseMaxBytes:1048576,
 provider:{apiBaseUrl:'https://analyticsapi.zoho.com',organizationId:'123456789',workspaceId:'987654321',targets:Object.fromEntries(Object.entries(TARGET_TABLE_NAMES).map(([type,table],i)=>[type,{table,viewId:String(1000+i)}]))}};
 let reads=0;
 const client=createAnalyticsClient({config,now:x.f.now,readAuthorizationProvider:async()=>'Zoho-oauthtoken '+'s'.repeat(32),writeAuthorizationProvider:async()=>assert.fail('No Analytics import allowed'),
 fetchImpl:async(url,init)=>{reads++;assert.equal(init.method,'GET');const parsed=new URL(url),id=/\/views\/([0-9]+)/.exec(parsed.pathname)[1],type=Object.keys(config.provider.targets).find(t=>config.provider.targets[t].viewId===id),target=config.provider.targets[type];
 if(!parsed.pathname.endsWith('/data'))return new Response(JSON.stringify({status:'success',data:{views:{viewId:id,viewName:target.table,viewType:'Table',workspaceId:'987654321',orgId:'123456789'}}}),{headers:{'content-type':'application/json'}});
 const rows=[...(x.f.imported.get(type)?.values()||[])].map(row=>Object.fromEntries(['RECORD_KEY','CLIENT_KEY','DEPLOYMENT_KEY','ENVIRONMENT','PAYLOAD_HASH','SOURCE_MODIFIED_AT'].map(key=>[key,row[key]])));
 return new Response(JSON.stringify({data:rows}),{headers:{'content-type':'application/json'}});
 }});
 x.options.readCompleteScope=client.readCompleteScope;return ()=>reads;
}

test('real Analytics HTTP accounting and immutable successors complete cold/replay/correction with and without review',async t=>{
 for(const reviewed of [false,true]){const x=await fixture(25,true),reads=realAnalyticsAccounting(x);let review=documentedReview(x);
 const budgets=[],runs=x.options.reportRunStore;
 x.options.reportRunStore={...runs,async compareAndSwap(row,state,context){const result=await runs.compareAndSwap(row,state,context);if(state.kind==='report_attempt_v1'&&state.phase==='verified')budgets.push(context.budget.snapshot());return result;}};
 if(reviewed)x.options.readOpportunityReview=async()=>review;
 const first=await createDurableReportComposition(x.options)(x.f.identity);assert.equal(reads(),reviewed?24:18);assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
 x.advance();const before=reads(),replay=await createDurableReportComposition(x.options)(x.f.identity);assert.deepEqual(replay.manifest,first.manifest);assert.equal(reads()-before,reviewed?24:18);assert.equal(x.renders,2);assert.equal(x.d.uploads.length,2);
 x.advance();review=structuredClone(review);review.groups[0].knownJobValue.amountMinorUnits=225000;x.options.readOpportunityReview=async()=>review;
 const correctionStart=reads(),corrected=await createDurableReportComposition(x.options)(x.f.identity);assert.equal(reads()-correctionStart,24);assert.notEqual(corrected.generationKey,first.generationKey);assert.equal(x.renders,4);assert.equal(x.d.uploads.length,4);
 const ceilings=require('../lib/report-attempt-budget').REPORT_PAIR_ATTEMPT_MAXIMUMS;
 assert.equal(budgets.length,3);for(const budget of budgets)for(const [kind,count]of Object.entries(budget))assert.ok(count<=ceilings[kind],`${kind} must fit planned attempt`);
 assert.equal(budgets[0].analytics_read,reviewed?24:18);assert.equal(budgets[0].report_run_read,26);assert.equal(budgets[0].report_run_write,14);assert.equal(budgets[0].workdrive_write,2);
 t.diagnostic(`review=${reviewed}: cold operation plan ${JSON.stringify(budgets[0])}`);
 t.diagnostic(`review=${reviewed}: cold/replay/correction Analytics reads ${reviewed?24:18}/${reviewed?24:18}/24`);
 }
});

test('known undersized pair Analytics plan fails before consuming durable/render/provider claims',async()=>{
 for(const reviewed of [false,true]){const x=await fixture(1,true);if(reviewed)x.options.readOpportunityReview=async()=>documentedReview(x);
 assert.throws(()=>createDurableReportComposition({...x.options,budgetOptions:{limits:{analytics_read:reviewed?23:17}}}),rejection);
 assert.equal(x.physicalStore.rows.size,0);assert.equal(x.renders,0);assert.equal(x.d.uploads.length,0);}
});

test('actual managed-SDK successor summary reader completes all eight ledger and six WorkDrive reads',async()=>{
 const x=await fixture(1,true),result=await createDurableReportComposition(x.options)(x.f.identity);
 const sdk=require('./helpers/report-run-sdk-fixture').fixture();try{
 for(const [key,row] of x.physicalStore.rows)sdk.rows.set(key,structuredClone(row));
 const runs=require('../lib/report-successor-store').createReportSuccessorStore({app:sdk.app,environment:'development'});
 const bundle=await x.d.runs.get(result.generationKey),identity=bundle.state.identity;let workdriveReads=0;
 const workdrive=Object.fromEntries(['getMetadata','listVersions','downloadVersion'].map(method=>[method,async(...args)=>{workdriveReads++;return x.d.workdrive[method](...args);} ]));
 sdk.requests.length=0;
 const snapshot={binding:{clientId:identity.clientId,deploymentId:identity.deploymentId,periodStart:identity.periodStart,periodEnd:identity.periodEnd},report:{generationKey:result.generationKey,manifestSha256:result.manifestSha256,summary:{role:'summary',...result.manifest.artifacts.summary}}};
 const bytes=await require('../lib/report-delivery-storage').createReportDeliveryStorageReader({reportRunStore:runs,workdrive,readDestinationBinding:x.d.readDestinationBinding,now:x.f.now})({snapshot});
 assert.equal(hash(bytes),result.manifest.artifacts.summary.documentSha256);assert.equal(sdk.requests.filter(r=>r.path.endsWith('/query')).length,8);assert.equal(workdriveReads,6);assert.equal(sdk.requests.filter(r=>r.path.endsWith('/row')).length,0);
 }finally{sdk.restore();}
});
test('pair reserves its complete finite operation and elapsed plan before any claim',async()=>{
 const x=await fixture(1,true),ceilings=require('../lib/report-attempt-budget').REPORT_PAIR_ATTEMPT_MAXIMUMS;
 for(const kind of Object.keys(ceilings).filter(kind=>kind!=='analytics_read'))assert.throws(()=>createDurableReportComposition({...x.options,budgetOptions:{limits:{[kind]:ceilings[kind]-1}}}),rejection);
 assert.throws(()=>createDurableReportComposition({...x.options,budgetOptions:{timeoutMs:119999}}),rejection);
 assert.equal(x.physicalStore.rows.size,0);assert.equal(x.renders,0);assert.equal(x.d.uploads.length,0);
});

async function exhaustedFixture() {
 const x=await fixture(); await createDurableReportComposition(x.options)(x.f.identity);
 const attempt=[...x.d.rows.values()].find(row=>row.state.kind==='report_attempt_v1');
 attempt.state.failures=6;attempt.state.phase='waiting';
 let writes=0;
 for(const method of ['insert','compareAndSwap'])x.d.runs[method]=async()=>{writes++;throw Error('inspection wrote');};
 x.d.workdrive.upload=async()=>{writes++;throw Error('inspection uploaded');};
 x.options.reattestCheckpoints=async()=>{writes++;throw Error('inspection reattested');};
 return {...x,get writes(){return writes;}};
}
test('exhausted inspection freshly verifies both bytes without resetting claims or repeating effects',async()=>{
 const x=await exhaustedFixture(),before=structuredClone([...x.d.rows]);
 const reconcile=createDurableReportComposition(x.options);
 assert.equal((await reconcile(x.f.identity)).status,'awaiting_reconciled_evidence');
 const result=await reconcile.inspectExhausted(x.f.identity);
 assert.equal(result.status,'exhausted_report_evidence_inspected_not_adopted');
 assert.equal(result.persisted,false);assert.equal(result.deliveryAuthority,false);
 assert.deepEqual([...x.d.rows],before);assert.equal(x.writes,0);assert.equal(x.d.uploads.length,2);
});
test('late completed receipts can be inspected while bundle/render acceptance remains unpersisted',async()=>{
 const x=await exhaustedFixture();
 for(const row of x.d.rows.values()){
  if(row.state.kind==='report_bundle_v1'){row.state.phase='working';row.state.manifest=null;delete row.state.manifestSha256;}
  if(row.state.kind==='pdf_generation_v1'){row.state.phase='render_started';row.state.accepted=null;}
 }
 const before=structuredClone([...x.d.rows]);
 assert.equal((await createDurableReportComposition(x.options).inspectExhausted(x.f.identity)).persisted,false);
 assert.deepEqual([...x.d.rows],before);assert.equal(x.writes,0);
});
test('legacy immutable rows require current source and destination authority without durable adoption',async()=>{
 const x=await exhaustedFixture();for(const row of x.d.rows.values())row.storageRevision='legacy_read_only_v1';
 const before=structuredClone([...x.d.rows]);
 assert.equal((await createDurableReportComposition(x.options).inspectExhausted(x.f.identity)).legacyEvidence,true);
 assert.deepEqual([...x.d.rows],before);assert.equal(x.writes,0);
 x.d.binding.expiresAt=x.f.now();
 await assert.rejects(createDurableReportComposition(x.options).inspectExhausted(x.f.identity),rejection);
 assert.equal(x.writes,0);
});
test('contradictory acceptance receipts hold read-only inspection',async()=>{
 const x=await exhaustedFixture();const generation=[...x.d.rows.values()].find(r=>r.state.kind==='pdf_generation_v1');
 generation.state.accepted.receiptSha256='f'.repeat(64);
 await assert.rejects(createDurableReportComposition(x.options).inspectExhausted(x.f.identity),rejection);
 assert.equal(x.writes,0);
});
test('stale complete Analytics source cannot be repaired by exhausted inspection',async()=>{
 const x=await exhaustedFixture();x.f.imported.get('call').clear();
 await assert.rejects(createDurableReportComposition(x.options).inspectExhausted(x.f.identity),rejection);
 assert.equal(x.writes,0);
});
test('tenant mismatch and changed source revision hold without any write',async()=>{
 const x=await exhaustedFixture();
 await assert.rejects(createDurableReportComposition(x.options).inspectExhausted({...x.f.identity,clientId:'other_client'}),rejection);
 await assert.rejects(createDurableReportComposition({...x.options,runtimeConfig:{...x.options.runtimeConfig,sourceRevision:'f'.repeat(40)}}).inspectExhausted(x.f.identity),rejection);
 assert.equal(x.writes,0);
});
test('missing stored PDF or verified receipt never authorizes inspection rerender or upload',async()=>{
 const x=await exhaustedFixture(),draft=[...x.d.rows.values()].find(r=>r.state.kind==='workdrive_draft_v1');
 draft.state.phase='upload_started';draft.state.receipt=null;
 await assert.rejects(createDurableReportComposition(x.options).inspectExhausted(x.f.identity),rejection);
 assert.equal(x.writes,0);assert.equal(x.d.uploads.length,2);
});
test('changed immutable bytes or receipt during final fencing holds inspection',async()=>{
 const x=await exhaustedFixture(),original=x.d.workdrive.downloadVersion.bind(x.d.workdrive);
 x.d.workdrive.downloadVersion=async(...args)=>{const bytes=await original(...args);bytes[10]^=1;return bytes;};
 await assert.rejects(createDurableReportComposition(x.options).inspectExhausted(x.f.identity),rejection);
 assert.equal(x.writes,0);
});
