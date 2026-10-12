'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture:network}=require('./helpers/report-run-sdk-fixture');
const {logicalStorageTransport}=require('./helpers/report-storage-logical-transport');
const {canonicalJson}=require('../lib/facts');
const {encodeStorageBinding}=require('../lib/report-storage-binding');
const {createProtectedStorageQualification}=require('../lib/report-storage-qualification');
const {activateDormantBinding,dormantOperationDigest}=require('../lib/report-storage-activation');
const {REPORT_FIELDS,RECEIPT_FIELDS,projectionDigest}=require('../lib/report-storage-capability');
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:canonicalJson(x)).digest('hex');
const held={code:'REPORT_STORAGE_QUALIFICATION_HELD'};
function fixture(){
 const sdk=network({deferResponses:true,storageSchema:true});let at=1800000000000,constructors=0;
 const binding={schemaVersion:6,enabled:false,environment:'development',sourceRevision:'a'.repeat(40),projectId:'123456789',
  controlHost:'synthetic.invalid',tableId:'123456788',nonce:'b'.repeat(32),
  capability:{region:'US',origin:'https://api.catalyst.zoho.com',controllerFunctionId:'123456786',deploymentId:'synthetic_controller',sdkVersion:'3.4.0',authMode:'user',authType:'admin',creatorPolicy:'observed_consistent_v1',
   tables:{reportRuns:{id:'123456788',name:'ReportRuns',schemaSha256:sha('synthetic-schema-runs'),uniquenessSha256:sha('synthetic-unique-runs'),uniqueField:'IdempotencyKey',projectionSha256:projectionDigest(REPORT_FIELDS)},
    eventReceipts:{id:'123456787',name:'RevenueDeskEventReceipts',schemaSha256:sha('synthetic-schema-receipts'),uniquenessSha256:sha('synthetic-unique-receipts'),uniqueField:'EVENT_KEY',projectionSha256:projectionDigest(RECEIPT_FIELDS)}},
   evidence:Object.fromEntries(['ownerAuthorization','ownership','access'].map(role=>[role,{digest:sha('fixed-facts-'+role),verifiedAt:0,expiresAt:0}]))},
  verifiedAt:0,expiresAt:0,timeoutMs:25000,singleAdmittedInvocation:true};
 const config={environment:'development',sourceRevision:binding.sourceRevision,controlHost:binding.controlHost,
  expectedProjectIdSha256:sha(binding.projectId),operatorIdHash:'operator_'+sha('synthetic')};
 const pin=()=>sha(JSON.stringify(binding));
 const environment=()=>{const raw=JSON.stringify(binding),wire=encodeStorageBinding(raw,{partSize:400,format:'tuple-v1'});return {
  SOURCE_REVISION:binding.sourceRevision,DEPLOYMENT_ENVIRONMENT:'development',REPORT_CONTROLLER_FUNCTION_ID:'123456786',
  REPORT_DEPLOYMENT_ID:'synthetic_controller',...wire.parts,REPORT_STORAGE_QUALIFICATION_JSON:wire.marker,REPORT_STORAGE_QUALIFICATION_SHA256:sha(raw)};};
 const factory=()=>createProtectedStorageQualification({environment:environment(),now:()=>at,transportFactory:options=>{
  constructors++;assert.equal(options.timeoutMs,3000);assert.equal(options.storagePhysicalContainment,true);return logicalStorageTransport(options,sdk);
 }});
 const activation=()=>({schemaVersion:1,bindingSha256:pin(),operationDigest:dormantOperationDigest(pin()),verifiedAt:at,expiresAt:at+60000,
  evidence:Object.fromEntries(Object.entries(binding.capability.evidence).map(([role,e])=>[role,{stateSha256:e.digest,digest:sha(role+at),verifiedAt:at-1,expiresAt:at+60000}]))});
 const command=()=>({profile:'report_storage_qualification_v1',action:'qualify_storage',activation:activation()});
 return {sdk,binding,config,pin,factory,activation,command,make:()=>factory()(sdk.app,config),
  actor:{kind:'internal_controller',identity:config.operatorIdHash},advance:n=>at+=n,get now(){return at;},get constructors(){return constructors;}};
}
test('arbitrarily delayed dormant owner setup grants no transport without fresh activation',async()=>{
 const f=fixture();try{
  const handler=f.make();f.advance(365*86400000);
  await assert.rejects(handler.handle({profile:'report_storage_qualification_v1',action:'qualify_storage'},{actor:f.actor}),held);
  assert.equal(f.constructors,0);assert.equal(f.sdk.clientCalls,0);
  const result=await handler.handle(f.command(),{actor:f.actor});
  assert.equal(result.operationDigest,dormantOperationDigest(f.pin()));assert.equal(result.status,'storage_unique_successor_observed');
  assert.equal(f.sdk.requests.length,13);assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/row')).length,5);
  assert.equal(result.reads+result.admissionReads,8);assert.equal(result.overlappingRounds,2);
  assert.equal(f.sdk.rows.size+f.sdk.receipts.size,3);assert.equal(result.qualificationAuthority,false);assert.equal(result.deliveryAuthority,false);
 }finally{f.sdk.restore();}
});
for(const [label,mutate]of [
 ['missing',c=>delete c.activation],['null',c=>c.activation=null],['extra scope',c=>c.activation.projectId='123456789'],
 ['wrong version',c=>c.activation.schemaVersion=2],['wrong binding',c=>c.activation.bindingSha256='c'.repeat(64)],
 ['wrong operation',c=>c.activation.operationDigest='c'.repeat(64)],['future activation',c=>c.activation.verifiedAt++],
 ['expired',c=>c.activation.expiresAt=c.activation.verifiedAt],['insufficient dispatch headroom',c=>c.activation.expiresAt=c.activation.verifiedAt+26999],
 ['long lease',c=>c.activation.expiresAt=c.activation.verifiedAt+3600001],
 ['bad state',c=>c.activation.evidence.access.stateSha256='c'.repeat(64)],['bad receipt digest',c=>c.activation.evidence.access.digest='bad'],
 ['receipt digest trailing newline',c=>c.activation.evidence.access.digest+='\n'],
 ['array receipt digest',c=>c.activation.evidence.access.digest=['c'.repeat(64)]],
 ['object receipt digest',c=>c.activation.evidence.access.digest={value:'c'.repeat(64)}],
 ['future evidence',c=>c.activation.evidence.access.verifiedAt=c.activation.verifiedAt+1],
 ['stale evidence',c=>c.activation.evidence.access.verifiedAt=c.activation.verifiedAt-3600001],
 ['evidence expires early',c=>c.activation.evidence.access.expiresAt--],
 ['evidence spans too long',c=>c.activation.evidence.access.expiresAt=c.activation.evidence.access.verifiedAt+3600001],
 ['extra evidence role',c=>c.activation.evidence.extra=c.activation.evidence.access],
 ['fractional time',c=>c.activation.verifiedAt+=0.5],['caller scope override',c=>c.nonce='c'.repeat(32)]
])test('schema6 '+label+' fails before transport construction',async()=>{
 const f=fixture();try{const command=f.command();mutate(command);await assert.rejects(f.make().handle(command,{actor:f.actor}),held);
  assert.equal(f.constructors,0);assert.equal(f.sdk.clientCalls,0);
 }finally{f.sdk.restore();}
});
for(const [label,mutate]of [
 ['enabled',b=>b.enabled=true],['binding start',b=>b.verifiedAt=1],['binding expiry',b=>b.expiresAt=1],
 ['evidence start',b=>b.capability.evidence.access.verifiedAt=1],['evidence expiry',b=>b.capability.evidence.ownerAuthorization.expiresAt=1],
 ['evidence digest trailing newline',b=>b.capability.evidence.access.digest+='\n'],
 ['array evidence digest',b=>b.capability.evidence.access.digest=['c'.repeat(64)]],
 ['shortened execution budget',b=>b.timeoutMs=1000],['larger execution budget',b=>b.timeoutMs=25001]
])test('dormant schema6 rejects non-dormant '+label,()=>{
 const f=fixture();try{mutate(f.binding);assert.throws(()=>f.make(),held);assert.equal(f.constructors,0);}finally{f.sdk.restore();}
});
test('schema6 preserves live managed capability and actor checks',async()=>{
 const f=fixture();try{
  await assert.rejects(f.make().handle(f.command(),{actor:{kind:'customer',identity:f.actor.identity}}),held);
  f.sdk.app.credential.getCurrentUserType=()=> 'user';await assert.rejects(f.make().handle(f.command(),{actor:f.actor}),held);
  f.sdk.app.credential.getCurrentUserType=()=> 'admin';f.binding.capability.tables.reportRuns.projectionSha256='c'.repeat(64);
  await assert.rejects(f.make().handle(f.command(),{actor:f.actor}),held);assert.equal(f.constructors,0);assert.equal(f.sdk.clientCalls,0);
 }finally{f.sdk.restore();}
});
test('fresh evidence cannot renew a warm or cold consumed operation identity',async()=>{
 const f=fixture();try{
  const handler=f.make(),first=await handler.handle(f.command(),{actor:f.actor}),prior=f.sdk.clientCalls;
  f.advance(120000);const command=f.command();
  assert.equal(command.activation.operationDigest,first.operationDigest);
  await assert.rejects(handler.handle(command,{actor:f.actor}),held);assert.equal(f.sdk.clientCalls,prior);
  await assert.rejects(f.make().handle(command,{actor:f.actor}),held);
  assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,2);assert.equal(f.sdk.clientCalls,prior+1);
  assert.equal(f.sdk.requests.at(-1).payload[0].EVENT_KEY,'report-storage:'+first.operationDigest);
 }finally{f.sdk.restore();}
});
test('concurrent independently fresh commands share one same-process admission latch',async()=>{
 const f=fixture();try{
  const factory=f.factory(),left=factory(f.sdk.app,f.config),right=factory(f.sdk.app,f.config);
  const a=f.command(),b=f.command();b.activation.evidence.access.digest=sha('another-current-read');
  const results=await Promise.allSettled([left.handle(a,{actor:f.actor}),right.handle(b,{actor:f.actor})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.constructors,1);assert.equal(f.sdk.requests.length,13);
 }finally{f.sdk.restore();}
});
test('ambiguous admission stays consumed after new activation and cold reconstruction',async()=>{
 const f=fixture();try{
  f.sdk.mode='admission_lost';const handler=f.make();await assert.rejects(handler.handle(f.command(),{actor:f.actor}),held);
  assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,0);const prior=f.sdk.clientCalls;
  f.advance(120000);f.sdk.mode='normal';await assert.rejects(handler.handle(f.command(),{actor:f.actor}),held);
  assert.equal(f.sdk.clientCalls,prior);await assert.rejects(f.make().handle(f.command(),{actor:f.actor}),held);
  assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,0);assert.equal(f.sdk.clientCalls,prior+1);
 }finally{f.sdk.restore();}
});
test('activation is frozen and delayed authentication cannot extend its original expiry',async()=>{
 const f=fixture();let release;try{
  const command=f.command();const merged=activateDormantBinding(f.binding,f.pin(),command.activation,f.now);
  assert.ok(Object.isFrozen(merged.binding.capability.evidence.access));
  f.sdk.authDelay=new Promise(resolve=>{release=resolve;});const handler=f.make(),pending=handler.handle(command,{actor:f.actor});
  await new Promise(resolve=>setImmediate(resolve));f.advance(60000);
  command.activation.expiresAt=f.now+60000;for(const e of Object.values(command.activation.evidence))e.expiresAt=f.now+60000;
  release();await assert.rejects(pending,held);assert.equal(f.sdk.clientCalls,0);assert.equal(f.sdk.rows.size,0);
  await assert.rejects(handler.handle(f.command(),{actor:f.actor}),held);assert.equal(f.sdk.clientCalls,0);
 }finally{release?.();f.sdk.restore();}
});
test('evidence read also requires fresh activation and cannot refresh qualification authority',async()=>{
 const f=fixture();try{
  await f.make().handle(f.command(),{actor:f.actor});const handler=f.make();f.advance(120000);
  await assert.rejects(handler.handle({profile:'report_storage_qualification_v1',action:'read_storage_evidence'},{actor:f.actor}),held);
  const command={...f.command(),action:'read_storage_evidence'},result=await handler.handle(command,{actor:f.actor});
  assert.equal(result.status,'storage_evidence_unattested');assert.equal(result.qualificationAuthority,false);assert.equal(result.inserts,0);
 }finally{f.sdk.restore();}
});
