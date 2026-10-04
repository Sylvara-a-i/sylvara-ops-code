'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture:network}=require('./helpers/report-run-sdk-fixture');
const {canonicalJson}=require('../lib/facts');
const {encodeStorageBinding}=require('../lib/report-storage-binding');
const {createProtectedStorageQualification}=require('../lib/report-storage-qualification');
const {storageFailureDiagnostic}=require('../lib/report-storage-diagnostic');
const {REPORT_FIELDS,RECEIPT_FIELDS,projectionDigest}=require('../lib/report-storage-capability');
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:canonicalJson(x)).digest('hex');
function fixture(options={}){
 const sdk=network({deferResponses:true,...options});let at=1800000000000;
 const binding={schemaVersion:3,enabled:true,environment:'development',sourceRevision:'a'.repeat(40),projectId:'123456789',
  controlHost:'synthetic.invalid',tableId:'123456788',nonce:crypto.randomBytes(16).toString('hex'),
  capability:{region:'US',origin:'https://api.catalyst.zoho.com',controllerFunctionId:'123456786',deploymentId:'synthetic_controller',sdkVersion:'3.4.0',authMode:'user',authType:'admin',creatorPolicy:'observed_consistent_v1',
   tables:{reportRuns:{id:'123456788',name:'ReportRuns',schemaSha256:sha('synthetic-schema-runs'),uniquenessSha256:sha('synthetic-unique-runs'),uniqueField:'IdempotencyKey',projectionSha256:projectionDigest(REPORT_FIELDS)},
    eventReceipts:{id:'123456787',name:'RevenueDeskEventReceipts',schemaSha256:sha('synthetic-schema-receipts'),uniquenessSha256:sha('synthetic-unique-receipts'),uniqueField:'EVENT_KEY',projectionSha256:projectionDigest(RECEIPT_FIELDS)}},
   evidence:Object.fromEntries(['ownerAuthorization','ownership','access'].map(kind=>[kind,{digest:sha('synthetic-'+kind),verifiedAt:at-2,expiresAt:at+60000}]))},
  verifiedAt:at-1,expiresAt:at+60000,timeoutMs:1000,singleAdmittedInvocation:true};
 const config={environment:'development',sourceRevision:binding.sourceRevision,controlHost:binding.controlHost,
  expectedProjectIdSha256:sha(binding.projectId),operatorIdHash:'operator_'+sha('synthetic')};
 const environment=()=>{const raw=JSON.stringify(binding);return {REPORT_CONTROLLER_FUNCTION_ID:'123456786',REPORT_DEPLOYMENT_ID:'synthetic_controller',DEPLOYMENT_ENVIRONMENT:'development',SOURCE_REVISION:binding.sourceRevision,
  ...(options.multipart?{...encodeStorageBinding(raw,{partSize:options.multipart,format:options.compact?'tuple-v1':'json'}).parts,REPORT_STORAGE_QUALIFICATION_JSON:encodeStorageBinding(raw,{partSize:options.multipart,format:options.compact?'tuple-v1':'json'}).marker}:{REPORT_STORAGE_QUALIFICATION_JSON:raw}),REPORT_STORAGE_QUALIFICATION_SHA256:sha(raw)};};
 const factory=()=>createProtectedStorageQualification({environment:environment(),now:()=>at});
 const command={profile:'report_storage_qualification_v1',action:'qualify_storage'},actor={kind:'internal_controller',identity:config.operatorIdHash};
 return {sdk,binding,config,environment,factory,make:()=>factory()(sdk.app,config),command,actor,advance:n=>at+=n};
}
const held={code:'REPORT_STORAGE_QUALIFICATION_HELD'};
test('actual SDK admission covers every mandatory schema column and accepts null-only full table responses',async()=>{
 const schema=require('./helpers/report-storage-schema-fixture'),f=fixture({storageSchema:true});
 try{const result=await f.make().handle(f.command,{actor:f.actor});
  const admission=f.sdk.requests.find(x=>x.path.endsWith('/table/123456787/row')).payload[0];
  assert.deepEqual(schema.missingMandatory(admission,'eventReceipts'),[]);
  assert.equal(admission.ATTEMPT_COUNT,0);assert.equal(typeof admission.ATTEMPT_COUNT,'number');
  assert.equal(Object.keys([...f.sdk.receipts.values()][0]).length,29);
  assert.ok([...f.sdk.rows.values()].every(row=>Object.keys(row).length===33));
  assert.equal(result.durableAdmissionObserved,true);assert.equal(result.qualificationAuthority,false);
  assert.equal(f.sdk.requests.length,13);assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,2);
 }finally{f.sdk.restore();}
});
for(const target of ['admission ACK','admission readback'])for(const [label,value]of [
 ['missing',undefined],['null',null],['nonzero',1],['boolean',false],['object',{}],['array',[]],['leading zero','00'],['fraction','0.0'],['whitespace',' 0']
])test(target+' malformed attempt count '+label+' holds without report dispatch or replay',async()=>{
 const f=fixture({storageResponseTransform({path,data}){
  if(target==='admission ACK'&&path==='/table/123456787/row'&&Array.isArray(data))data[0].ATTEMPT_COUNT=value;
  if(target==='admission readback'&&path==='/query'&&data[0]?.RevenueDeskEventReceipts)data[0].RevenueDeskEventReceipts.ATTEMPT_COUNT=value;
 }});
 try{const handler=f.make();await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.rows.size,0);const requests=f.sdk.requests.length;
  await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);assert.equal(f.sdk.requests.length,requests);
 }finally{f.sdk.restore();}
});
for(const role of ['eventReceipts','reportRuns'])for(const target of ['ACK','readback'])for(const mutation of ['unknown_null','known_nonnull','known_object'])test(role+' full schema '+target+' rejects '+mutation,async()=>{
 const f=fixture({storageSchema:true,storageResponseTransform({path,data}){
  const expected=role==='eventReceipts'?'/table/123456787/row':'/table/123456788/row';
  if(path!==(target==='ACK'?expected:'/query')||!Array.isArray(data))return;
  const row=target==='ACK'?data[0]:data.map(x=>x.ReportRuns||x.RevenueDeskEventReceipts||x).find(x=>Object.hasOwn(x,role==='eventReceipts'?'EVENT_KEY':'IdempotencyKey'));
  if(!row)return;
  const field=role==='eventReceipts'?'CALL_KEY':'RecipientSnapshotJson';
  if(mutation==='unknown_null')row.UNREVIEWED_COLUMN=null;
  else row[field]=mutation==='known_object'?{}:'unexpected';
 }});
 try{const handler=f.make();await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
  assert.ok(f.sdk.rows.size<2);const requests=f.sdk.requests.length;
  await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);assert.equal(f.sdk.requests.length,requests);
 }finally{f.sdk.restore();}
});
test('actual managed SDK proof makes exactly four inserts/seven reads, retains two rows and proves overlapping rounds',async()=>{
 const f=fixture();try{
  const result=await f.make().handle(f.command,{actor:f.actor});
  assert.equal(result.status,'storage_unique_successor_observed');assert.equal(result.inserts,4);assert.equal(result.reads,7);
  assert.equal(result.physicalRows,2);assert.equal(result.overlappingRounds,2);assert.equal(result.qualificationAuthority,false);
  assert.equal(result.deliveryAuthority,false);assert.equal(result.namedIdentityVerified,false);
  assert.equal(result.creatorProvenance,'observed_consistent_v1');assert.equal(f.sdk.rows.size,2);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/table/123456788/row')).length,4);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/query')).length,8);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/project-user/current')).length,0);
  assert.ok(f.sdk.requests.every(x=>/\/(?:query|table\/(?:123456788|123456787)\/row)$/.test(x.path)));
  assert.ok(!JSON.stringify(result).includes('987654321'));assert.ok(!JSON.stringify(result).includes('private-unused'));
  assert.match(result.evidenceDigest,/^[a-f0-9]{64}$/);assert.ok(f.sdk.principals.every(x=>x==='user'));
 }finally{f.sdk.restore();}
});
test('warm double tap and cold repeat cannot restart a durable diagnostic; readback never re-attests qualification',async()=>{
 const f=fixture();try{
  const factory=f.factory(),first=factory(f.sdk.app,f.config),second=factory(f.sdk.app,f.config);
  const outcomes=await Promise.allSettled([first.handle(f.command,{actor:f.actor}),second.handle(f.command,{actor:f.actor})]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.sdk.rows.size,2);
  const writes=()=>f.sdk.requests.filter(x=>x.path.endsWith('/table/123456788/row')).length;
  assert.equal(writes(),4);await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);assert.equal(writes(),4);
  const evidence=await f.make().handle({...f.command,action:'read_storage_evidence'},{actor:f.actor});
  assert.equal(evidence.status,'storage_evidence_unattested');assert.equal(evidence.inserts,0);assert.equal(evidence.reads,2);
  assert.equal(evidence.headVersion,2);assert.equal(evidence.qualificationAuthority,false);assert.equal(writes(),4);
 }finally{f.sdk.restore();}
});
test('missing/disabled/expired or mismatched protected binding and invalid actor never access provider',async()=>{
 const f=fixture();try{
  assert.throws(()=>createProtectedStorageQualification({environment:{}})(f.sdk.app,f.config),held);
  for(const field of ['enabled','singleAdmittedInvocation']){const saved=f.binding[field];f.binding[field]=false;assert.throws(()=>f.make(),held);f.binding[field]=saved;}
  const old=f.sdk.app.config.environment;f.sdk.app.config.environment='Production';assert.throws(()=>f.make(),held);f.sdk.app.config.environment=old;
  await assert.rejects(f.make().handle({...f.command,nonce:'caller-controlled'},{actor:f.actor}),held);
  await assert.rejects(f.make().handle(f.command,{actor:{kind:'terminal_worker',identity:f.actor.identity}}),held);
  f.advance(60000);assert.throws(()=>f.make(),held);assert.equal(f.sdk.requests.length,0);
 }finally{f.sdk.restore();}
});
test('missing observed creator policy stops before any managed dispatch',async()=>{
 const f=fixture();try{
  delete f.binding.capability.creatorPolicy;assert.throws(()=>f.make(),held);
  assert.equal(f.sdk.requests.length,0);assert.equal(f.sdk.rows.size,0);
 }finally{f.sdk.restore();}
});
test('lost insert response retains partial immutable evidence and never qualifies or retries a mutation',async()=>{
 const f=fixture();try{
  f.sdk.mode='lost_insert';const handler=f.make();await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/table/123456788/row')).length,2);assert.equal(f.sdk.rows.size,1);
  await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
  f.sdk.mode='normal';const evidence=await f.make().handle({...f.command,action:'read_storage_evidence'},{actor:f.actor});
  assert.equal(evidence.headVersion,1);assert.equal(evidence.qualificationAuthority,false);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/table/123456788/row')).length,2);assert.equal(f.sdk.rows.size,1);
 }finally{f.sdk.restore();}
});
test('creator or stored envelope mismatch is held on readback without destructive cleanup or extra writes',async()=>{
 const f=fixture();try{
  await f.make().handle(f.command,{actor:f.actor});const saved=[...f.sdk.rows.values()][0];saved.CREATORID='123456789';
  await assert.rejects(f.make().handle({...f.command,action:'read_storage_evidence'},{actor:f.actor}),held);
  saved.CREATORID='987654321';saved.ReportPayloadJson+=' ';
  await assert.rejects(f.make().handle({...f.command,action:'read_storage_evidence'},{actor:f.actor}),held);
  assert.equal(f.sdk.rows.size,2);assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/table/123456788/row')).length,4);
 }finally{f.sdk.restore();}
});
test('late authentication and deadline cannot dispatch after diagnostic admission expires',async()=>{
 const f=fixture();try{
  f.binding.timeoutMs=20;let release;f.sdk.authDelay=new Promise(resolve=>{release=resolve;});
  await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);release();
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.sdk.requests.length,0);assert.equal(f.sdk.rows.size,0);
 }finally{f.sdk.restore();}
});

test('simultaneous cold instances admit exactly one durable owner before the four target inserts',async()=>{
 const f=fixture();try{
  const outcomes=await Promise.allSettled([f.make().handle(f.command,{actor:f.actor}),f.make().handle(f.command,{actor:f.actor})]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,2);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/table/123456788/row')).length,4);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/table/123456787/row')).length,2);
  const result=outcomes.find(x=>x.status==='fulfilled').value;
  assert.equal(result.admissionReads,1);assert.equal(result.admissionInserts,1);
  assert.equal(result.durableAdmissionObserved,true);assert.match(result.admissionEvidenceDigest,/^[a-f0-9]{64}$/);
 }finally{f.sdk.restore();}
});
for(const mode of ['admission_lost','admission_conflict'])test(mode+' never grants target dispatch or repeats admission',async()=>{
 const f=fixture();try{
  f.sdk.mode=mode;await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.rows.size,0);assert.equal(f.sdk.receipts.size,1);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/table/123456787/row')).length,1);
  f.sdk.mode='normal';await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.rows.size,0);assert.equal(f.sdk.receipts.size,1);
 }finally{f.sdk.restore();}
});

test('admission response timeout permanently consumes claim and cannot dispatch after cancellation',async()=>{
 const f=fixture();try{
  f.binding.timeoutMs=25;f.sdk.mode='admission_stall';
  await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(f.sdk.rows.size,0);assert.equal(f.sdk.receipts.size,1);
  f.sdk.mode='normal';await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.rows.size,0);
 }finally{f.sdk.restore();}
});
test('source mismatch and expiration fail before admission requests',async()=>{
 const f=fixture();try{
  const original=f.config.sourceRevision;f.config.sourceRevision='f'.repeat(40);assert.throws(()=>f.make(),held);
  f.config.sourceRevision=original;f.advance(60000);assert.throws(()=>f.make(),held);
  assert.equal(f.sdk.requests.length,0);assert.equal(f.sdk.receipts.size,0);
 }finally{f.sdk.restore();}
});

test('bounded primitive representation does not change admission ownership or protected expiry',async()=>{
 const f=fixture();try{
  f.sdk.mode='admission_representation';const result=await f.make().handle(f.command,{actor:f.actor});
  assert.equal(result.durableAdmissionObserved,true);assert.equal(result.inserts,4);
 }finally{f.sdk.restore();}
});


test('real SDK console-admin path qualifies bounded storage without application-user lookup',async()=>{
 const f=fixture({credentialType:'admin',principalData:null});try{
  const result=await f.make().handle(f.command,{actor:f.actor});
  assert.equal(result.reads,7);assert.equal(result.qualificationAuthority,false);
  assert.equal(f.sdk.requests.length,13);assert.ok(f.sdk.requests.every(r=>!r.path.includes('project-user')));
 }finally{f.sdk.restore();}
});
for(const [name,mutate]of [
 ['legacy binding',b=>b.schemaVersion=1],['prior creator binding',b=>b.schemaVersion=2],['extra binding key',b=>b.principalSha256='b'.repeat(64)],
 ['region',b=>b.capability.region='EU'],['origin',b=>b.capability.origin='https://synthetic.invalid'],
 ['SDK',b=>b.capability.sdkVersion='3.3.0'],['scope switch',b=>b.capability.authMode='admin'],
 ['credential type',b=>b.capability.authType='user'],['controller identity',b=>b.capability.controllerFunctionId='123456780'],
 ['deployment identity',b=>b.capability.deploymentId='wrong'],['table ID mismatch',b=>b.capability.tables.reportRuns.id='123456780'],
 ['table alias',b=>b.capability.tables.eventReceipts.name='ReportRuns'],['duplicate IDs',b=>b.capability.tables.eventReceipts.id=b.tableId],
 ['extra table',b=>b.capability.tables.other={}],['wrong unique field',b=>b.capability.tables.eventReceipts.uniqueField='STATUS'],
 ['missing schema',b=>delete b.capability.tables.reportRuns.schemaSha256],['wrong projection',b=>b.capability.tables.reportRuns.projectionSha256='b'.repeat(64)],
 ['missing ownership',b=>delete b.capability.evidence.ownership],['missing access',b=>delete b.capability.evidence.access],
 ['missing owner authorization',b=>delete b.capability.evidence.ownerAuthorization],
 ['future owner evidence',b=>b.capability.evidence.ownerAuthorization.verifiedAt=b.verifiedAt+1],
 ['stale permission evidence',b=>b.capability.evidence.access.verifiedAt=b.verifiedAt-900001],
 ['short evidence expiry',b=>b.capability.evidence.access.expiresAt=b.expiresAt-1],
 ['unsupported creator policy',b=>b.capability.creatorPolicy='named_identity'],
 ['legacy creator evidence',b=>b.capability.evidence.creator={creatorIdSha256:sha('987654321')}]
])test(name+' fails closed before managed dispatch',()=>{
 const f=fixture();try{mutate(f.binding);assert.throws(()=>f.make(),held);assert.equal(f.sdk.requests.length,0);}finally{f.sdk.restore();}
});

test('runtime user credential cannot be reinterpreted as admin deployment capability',()=>{
 const f=fixture({credentialType:'user'});try{assert.throws(()=>f.make(),held);assert.equal(f.sdk.requests.length,0);}finally{f.sdk.restore();}
});
test('extra stored column is held and cannot authorize another successor',async()=>{
 const f=fixture();try{await f.make().handle(f.command,{actor:f.actor});[...f.sdk.rows.values()][0].UnapprovedColumn='synthetic';
  await assert.rejects(f.make().handle({...f.command,action:'read_storage_evidence'},{actor:f.actor}),held);
  assert.equal(f.sdk.rows.size,2);
 }finally{f.sdk.restore();}
});
test('numeric-ID transport refuses other operation namespaces, arbitrary queries and extra INSERT columns',async()=>{
 const f=fixture();let io;try{
  const {createReportRunTransport}=require('../lib/report-run-transport');
  const make=createProtectedStorageQualification({environment:f.environment(),now:()=>1800000000000,
   transportFactory:options=>{io=createReportRunTransport(options);return io;}});
  await make(f.sdk.app,f.config).handle(f.command,{actor:f.actor});const before=f.sdk.requests.length;
  await assert.rejects(io.query("SELECT * FROM ReportRuns WHERE IdempotencyKey = 'revenue-desk-report-v1:"+'f'.repeat(64)+"' LIMIT 2"));
  await assert.rejects(io.query('DELETE FROM ReportRuns'));await assert.rejects(io.query('SELECT * FROM ReportRuns LIMIT 100'));
  await assert.rejects(io.readAdmission('report-storage:'+'f'.repeat(64)));
  const row=structuredClone([...f.sdk.rows.values()][0]);delete row.ROWID;delete row.CREATORID;
  await assert.rejects(io.insert({...row,ExtraColumn:true}));await assert.rejects(io.insert({...row,GenerationStatus:'DraftGenerated'}));
  assert.equal(f.sdk.requests.length,before);
 }finally{f.sdk.restore();}
});

for(const [label,value]of [['missing',undefined],['null',null],['blank',''],['zero','0'],['negative',-1],
 ['leading zero','0123'],['space','123 '],['fraction',1.5],['unsafe number',Number.MAX_SAFE_INTEGER+1],
 ['oversize','1'.repeat(31)],['object',{}],['boolean',true]])test('invalid admission ACK creator '+label+' holds before report dispatch',async()=>{
 const f=fixture({storageResponseTransform({path,data}){if(path==='/table/123456787/row'&&Array.isArray(data)){data[0].CREATORID=value;}}});
 try{await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.rows.size,0);assert.equal(f.sdk.receipts.size,1);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/table/123456787/row')).length,1);
  await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);assert.equal(f.sdk.rows.size,0);
 }finally{f.sdk.restore();}
});
for(const target of ['admission readback','report ACK','report readback'])test(target+' creator disagreement fails closed',async()=>{
 const f=fixture({storageResponseTransform({path,data}){
  if(target==='admission readback'&&path==='/query'&&data[0]?.RevenueDeskEventReceipts)data[0].RevenueDeskEventReceipts.CREATORID='987654322';
  if(target==='report ACK'&&path==='/table/123456788/row'&&Array.isArray(data))data[0].CREATORID='987654322';
  if(target==='report readback'&&path==='/query'&&data[0]?.ReportRuns)data[0].ReportRuns.CREATORID='987654322';
 }});try{const handler=f.make();await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
  const writes=f.sdk.requests.filter(x=>x.path.endsWith('/row')).length;
  assert.ok(f.sdk.rows.size<=1);await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/row')).length,writes);
 }finally{f.sdk.restore();}
});
test('report ACK row ID mismatch cannot pass exact independent readback',async()=>{
 const f=fixture({storageResponseTransform({path,data}){if(path==='/table/123456788/row'&&Array.isArray(data))data[0].ROWID='999999999';}});
 try{await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);assert.ok(f.sdk.rows.size<=1);}
 finally{f.sdk.restore();}
});
test('valid numeric creator representation remains observed provenance only',async()=>{
 const f=fixture({storageResponseTransform({path,data}){if(!Array.isArray(data))return;
  for(const entry of data){const row=entry.ReportRuns||entry.RevenueDeskEventReceipts||entry;
   if(Object.hasOwn(row,'CREATORID'))row.CREATORID=987654321;}
 }});try{const result=await f.make().handle(f.command,{actor:f.actor});
  assert.equal(result.creatorProvenance,'observed_consistent_v1');assert.equal(result.namedIdentityVerified,false);
  assert.equal(result.qualificationAuthority,false);assert.equal(result.deliveryAuthority,false);
 }finally{f.sdk.restore();}
});
test('read-only retrieval checks current evidence consistency without renewing identity',async()=>{
 const f=fixture();try{await f.make().handle(f.command,{actor:f.actor});
  for(const row of f.sdk.rows.values())row.CREATORID='987654322';
  const result=await f.make().handle({...f.command,action:'read_storage_evidence'},{actor:f.actor});
  assert.equal(result.status,'storage_evidence_unattested');assert.equal(result.namedIdentityVerified,false);
  assert.equal(result.qualificationAuthority,false);assert.equal(result.inserts,0);
 }finally{f.sdk.restore();}
});

for(const multipart of [100,200,400])test('multipart factory preserves exact operation and finite admission '+multipart,async()=>{const f=fixture({multipart});try{const result=await f.make().handle(f.command,{actor:f.actor});assert.equal(result.inserts,4);assert.equal(result.reads,7);assert.equal(result.admissionInserts,1);assert.equal(result.admissionReads,1);assert.equal(result.qualificationAuthority,false);assert.equal(result.deliveryAuthority,false);await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);}finally{f.sdk.restore();}});
test('mixed same-size chunk fails exact binding hash before provider dispatch',()=>{const f=fixture({multipart:200});try{const env=f.environment();env.REPORT_STORAGE_QUALIFICATION_PART_0='x'+env.REPORT_STORAGE_QUALIFICATION_PART_0.slice(1);assert.throws(()=>createProtectedStorageQualification({environment:env,now:()=>f.binding.verifiedAt+1})(f.sdk.app,f.config),held);assert.equal(f.sdk.requests.length,0);}finally{f.sdk.restore();}});

for(const multipart of [100,200,400])test('all-field tuple reaches actual immutable storage proof with unchanged thirteen-attempt ceiling '+multipart,async()=>{
 const f=fixture({multipart,compact:true});try{
  const result=await f.make().handle(f.command,{actor:f.actor});
  assert.equal(result.inserts,4);assert.equal(result.reads,7);assert.equal(result.admissionInserts,1);assert.equal(result.admissionReads,1);
  assert.equal(f.sdk.requests.length,13);assert.equal(result.qualificationAuthority,false);assert.equal(result.deliveryAuthority,false);assert.equal(result.namedIdentityVerified,false);
  await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/table/123456788/row')).length,4);
 }finally{f.sdk.restore();}
});
test('altered tuple raw hash and scope hold before transport construction',()=>{
 const f=fixture({multipart:400,compact:true});try{
  const e=f.environment();e.REPORT_STORAGE_QUALIFICATION_SHA256=sha('wrong');let constructed=0;
  assert.throws(()=>createProtectedStorageQualification({environment:e,now:()=>1800000000000,transportFactory:()=>{constructed++;throw Error('Must not construct');}})(f.sdk.app,f.config),held);
  f.config.expectedProjectIdSha256=sha('wrong-project');
  assert.throws(()=>createProtectedStorageQualification({environment:f.environment(),now:()=>1800000000000,transportFactory:()=>{constructed++;throw Error('Must not construct');}})(f.sdk.app,f.config),held);
  assert.equal(constructed,0);assert.equal(f.sdk.requests.length,0);
 }finally{f.sdk.restore();}
});


function sixtyMinuteDiagnostic(f,schemaVersion=4){
 f.binding.schemaVersion=schemaVersion;f.binding.expiresAt=f.binding.verifiedAt+3600000;
 for(const e of Object.values(f.binding.capability.evidence)){e.verifiedAt=f.binding.verifiedAt;e.expiresAt=f.binding.expiresAt;}
}
test('explicit Development schema4 admits the exact60minute bound with unchanged13requests and3retained rows',async()=>{
 const f=fixture({multipart:400,compact:true});try{
  sixtyMinuteDiagnostic(f);const result=await f.make().handle(f.command,{actor:f.actor});
  assert.equal(f.sdk.requests.length,13);assert.equal(result.inserts,4);assert.equal(result.reads,7);
  assert.equal(result.admissionInserts,1);assert.equal(result.admissionReads,1);
  assert.equal(f.sdk.rows.size,2);assert.equal(f.sdk.receipts.size,1);assert.equal(result.physicalRows,2);
  assert.equal(result.qualificationAuthority,false);assert.equal(result.deliveryAuthority,false);
 }finally{f.sdk.restore();}
});
for(const [label,mutate]of [
 ['60minutes plus1ms',f=>f.binding.expiresAt++],
 ['legacy schema3 extended window',f=>f.binding.schemaVersion=3],
 ['unknown schema6',f=>f.binding.schemaVersion=6],
 ['production binding',f=>f.binding.environment='production'],
 ['production control config',f=>f.config.environment='production'],
 ['production runtime app',f=>f.sdk.app.config.environment='Production'],
 ['permission evidence older than60minutes',f=>f.binding.capability.evidence.access.verifiedAt=f.binding.verifiedAt-3600001],
 ['permission evidence expiry beyondactual60minute horizon',f=>f.binding.capability.evidence.access.expiresAt++]
])test('schema4 '+label+' holds before any managed dispatch',()=>{
 const f=fixture();try{sixtyMinuteDiagnostic(f);mutate(f);assert.throws(()=>f.make(),held);assert.equal(f.sdk.requests.length,0);}finally{f.sdk.restore();}
});
test('legacy schema3 exact15minute boundary remains accepted and15minutes plus1ms holds',()=>{
 const f=fixture();try{
  f.binding.expiresAt=f.binding.verifiedAt+900000;for(const e of Object.values(f.binding.capability.evidence))e.expiresAt=f.binding.expiresAt;
  assert.doesNotThrow(()=>f.make());f.binding.expiresAt++;for(const e of Object.values(f.binding.capability.evidence))e.expiresAt=f.binding.expiresAt;
  assert.throws(()=>f.make(),held);assert.equal(f.sdk.requests.length,0);
 }finally{f.sdk.restore();}
});
test('schema4 exact expiry rejects cold construction and previously constructed warm handler',async()=>{
 const f=fixture();try{
  sixtyMinuteDiagnostic(f);const handler=f.make();f.advance(3599999);
  assert.throws(()=>f.make(),held);await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.requests.length,0);assert.equal(f.sdk.rows.size,0);assert.equal(f.sdk.receipts.size,0);
 }finally{f.sdk.restore();}
});
test('schema4 delayed authentication cannot dispatch after finite expiry or restart warm admission',async()=>{
 const f=fixture();try{
  sixtyMinuteDiagnostic(f);let release;f.sdk.authDelay=new Promise(resolve=>{release=resolve;});
  const handler=f.make(),pending=handler.handle(f.command,{actor:f.actor});
  await new Promise(resolve=>setImmediate(resolve));f.advance(3599999);release();
  await assert.rejects(pending,held);await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.requests.length,0);assert.equal(f.sdk.rows.size,0);assert.equal(f.sdk.receipts.size,0);
 }finally{f.sdk.restore();}
});
test('shared capability validation keeps15minute freshness without explicit diagnostic contract',()=>{
 const f=fixture();try{
  sixtyMinuteDiagnostic(f);f.binding.expiresAt=f.binding.verifiedAt+1800000;for(const e of Object.values(f.binding.capability.evidence))e.expiresAt=f.binding.expiresAt;f.binding.capability.evidence.access.verifiedAt=f.binding.verifiedAt-900001;
  const {validateStorageCapability}=require('../lib/report-storage-capability');
  const options={app:f.sdk.app,config:{projectId:f.binding.projectId,environment:'development'},environment:f.environment(),now:f.binding.verifiedAt+1,verifiedAt:f.binding.verifiedAt,expiresAt:f.binding.expiresAt};
  assert.throws(()=>validateStorageCapability(f.binding.capability,options),held);
  assert.doesNotThrow(()=>validateStorageCapability(f.binding.capability,{...options,diagnosticContract:{schemaVersion:4,profile:'report_storage_qualification_v1',environment:'development'}}));
  for(const diagnosticContract of [{schemaVersion:6,profile:'report_storage_qualification_v1',environment:'development'},{schemaVersion:4,profile:'other',environment:'development'},{schemaVersion:4,profile:'report_storage_qualification_v1',environment:'production'}])assert.throws(()=>validateStorageCapability(f.binding.capability,{...options,diagnosticContract}),held);
  assert.equal(f.sdk.requests.length,0);
 }finally{f.sdk.restore();}
});


test('schema4 thirtyminute-old evidence remains usable only inside each actual60minute horizon',async()=>{
 const f=fixture();try{
  sixtyMinuteDiagnostic(f);f.binding.expiresAt=f.binding.verifiedAt+1800000;
  for(const e of Object.values(f.binding.capability.evidence)){e.verifiedAt=f.binding.verifiedAt-1800000;e.expiresAt=f.binding.expiresAt;}
  const result=await f.make().handle(f.command,{actor:f.actor});
  assert.equal(result.qualificationAuthority,false);assert.equal(f.sdk.requests.length,13);
  assert.equal(f.sdk.rows.size,2);assert.equal(f.sdk.receipts.size,1);
 }finally{f.sdk.restore();}
});

test('safe diagnostic records command rejection without provider construction or new authority',async()=>{
 const f=fixture();try{let error;try{await f.make().handle(f.command,{actor:{kind:'customer',identity:f.actor.identity}});}catch(e){error=e;}
  assert.equal(error.code,held.code);assert.deepEqual(storageFailureDiagnostic(error),{lastStage:'command',lastOperation:'none',attempted:0,dispatchStarted:0,responses:0,counterOverflow:false});assert.equal(f.sdk.requests.length,0);
 }finally{f.sdk.restore();}
});
for(const [mode,expectedStage,attempted,dispatchStarted,responses]of [
 ['auth_rejected','authenticate_rejected',1,0,0],['network_error','dispatch_admitted',1,1,0],['admission_lost','dispatch_admitted',1,1,0]
])test('safe diagnostic distinguishes '+mode+' without retry or raw error disclosure',async()=>{
 const f=fixture();try{if(mode==='auth_rejected')f.sdk.app.authenticateRequest=async()=>{throw Object.assign(new Error('SYNTHETIC_PRIVATE_TOKEN'),{code:'SYNTHETIC_PRIVATE_CODE'});};else f.sdk.mode=mode;
  const handler=f.make();let error;try{await handler.handle(f.command,{actor:f.actor});}catch(e){error=e;}
  assert.equal(error.code,held.code);const snapshot=storageFailureDiagnostic(error);
  assert.deepEqual(snapshot,{lastStage:expectedStage,lastOperation:'admission_insert',attempted,dispatchStarted,responses,counterOverflow:false});
  assert.equal(JSON.stringify({error,snapshot}).includes('SYNTHETIC_PRIVATE'),false);
  const requests=f.sdk.clientCalls;await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);assert.equal(f.sdk.clientCalls,requests);assert.equal(f.sdk.rows.size,0);
  assert.equal(f.sdk.receipts.size,mode==='admission_lost'?1:0);
 }finally{f.sdk.restore();}
});
test('diagnostic auth timeout remains cancelled with immutable counters and no late dispatch',async()=>{
 const f=fixture();try{f.binding.timeoutMs=20;let release;f.sdk.authDelay=new Promise(resolve=>{release=resolve;});
  let error;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){error=e;}
  const snapshot=storageFailureDiagnostic(error);assert.equal(snapshot.lastStage,'authenticate_enter');assert.equal(snapshot.attempted,1);assert.equal(snapshot.dispatchStarted,0);assert.equal(snapshot.responses,0);
  release();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.sdk.clientCalls,0);assert.equal(snapshot.lastStage,'authenticate_enter');
 }finally{f.sdk.restore();}
});
test('admission projection hold reports two attempted dispatched responses without report effects',async()=>{
 const f=fixture({storageResponseTransform({path,data}){if(path.endsWith('/row'))data[0].CREATORID=null;}});try{
  let error;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){error=e;}
  assert.deepEqual(storageFailureDiagnostic(error),{lastStage:'admission_verify',lastOperation:'none',attempted:2,dispatchStarted:2,responses:2,counterOverflow:false});
  assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,0);assert.equal(f.sdk.requests.length,2);
 }finally{f.sdk.restore();}
});
