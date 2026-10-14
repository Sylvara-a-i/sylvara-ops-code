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
const held={code:'REPORT_STORAGE_QUALIFICATION_HELD'},DAY=86400000;
// All identities, nonces and receipt observations below are synthetic. The SDK
// fixture traps requests; its rows survive new handler factories for cold tests.
function fixture(){
 const sdk=network({deferResponses:true,storageSchema:true});let at=1800000000000,constructors=0,drains=0;
 const binding={schemaVersion:7,enabled:false,environment:'development',sourceRevision:'a'.repeat(40),projectId:'123456789',
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
 const factory=(wrap=io=>io)=>createProtectedStorageQualification({environment:environment(),now:()=>at,transportFactory:options=>{
  constructors++;assert.equal(options.timeoutMs,3000);assert.equal(options.storagePhysicalContainment,true);
  const io=logicalStorageTransport(options,sdk);
  return wrap({...io,async stopAndDrain(){drains++;return io.stopAndDrain();}},options);
 }});
 const activation=()=>({schemaVersion:2,bindingSha256:pin(),operationDigest:dormantOperationDigest(pin()),
  evidence:Object.fromEntries(Object.entries(binding.capability.evidence).map(([role,e])=>[role,{stateSha256:e.digest,digest:sha('synthetic-observation-'+role),observedAt:at}]))});
 const timedActivation=()=>({schemaVersion:1,bindingSha256:pin(),operationDigest:dormantOperationDigest(pin()),verifiedAt:at,expiresAt:at+60000,
  evidence:Object.fromEntries(Object.entries(binding.capability.evidence).map(([role,e])=>[role,{stateSha256:e.digest,digest:sha(role+at),verifiedAt:at-1,expiresAt:at+60000}]))});
 const command=()=>({profile:'report_storage_qualification_v1',action:'qualify_storage',activation:activation()});
 return {sdk,binding,config,pin,factory,activation,timedActivation,command,make:wrap=>factory(wrap)(sdk.app,config),
  actor:{kind:'internal_controller',identity:config.operatorIdHash},advance:n=>at+=n,get now(){return at;},
  get constructors(){return constructors;},get drains(){return drains;}};
}
for(const days of [31,365,3650])test('unchanged serialized activation survives '+days+' days of setup delay',async()=>{
 const f=fixture();try{
  const handler=f.make(),saved=JSON.stringify(f.command()),bindingPin=f.pin();f.advance(days*DAY);
  const result=await handler.handle(JSON.parse(saved),{actor:f.actor});
  assert.equal(f.pin(),bindingPin);assert.equal(result.operationDigest,dormantOperationDigest(bindingPin));
  assert.equal(result.status,'storage_unique_successor_observed');assert.equal(result.observedAt,f.now);
  assert.equal(f.sdk.requests.length,13);assert.equal(result.inserts+result.admissionInserts,5);
  assert.equal(result.reads+result.admissionReads,8);assert.equal(result.overlappingRounds,2);
  assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,2);assert.equal(f.drains,1);
  assert.equal(result.qualificationAuthority,false);assert.equal(result.deliveryAuthority,false);
 }finally{f.sdk.restore();}
});
test('activation2 metadata never creates a lease and the pure validator does not consult now',()=>{
 const f=fixture();try{
  const a=f.activation();a.evidence.ownerAuthorization.observedAt=0;
  a.evidence.ownership.observedAt=f.now+3650*DAY;a.evidence.access.observedAt=Number.MAX_SAFE_INTEGER;
  const expected=sha({schemaVersion:2,bindingSha256:f.pin(),operationDigest:a.operationDigest,evidence:a.evidence});
  for(const now of [undefined,0,f.now,f.now+36500*DAY,NaN]){
   const active=activateDormantBinding(f.binding,f.pin(),a,now);
   assert.equal(active.activationDigest,expected);assert.equal(active.binding.enabled,true);
   assert.equal(active.binding.verifiedAt,0);assert.equal(active.binding.expiresAt,0);
   for(const e of Object.values(active.binding.capability.evidence)){assert.equal(e.verifiedAt,0);assert.equal(e.expiresAt,0);assert.ok(Object.isFrozen(e));}
   assert.ok(Object.isFrozen(active.binding));assert.notStrictEqual(active.binding,f.binding);
  }
  assert.equal(f.binding.enabled,false);assert.equal(f.sdk.clientCalls,0);
 }finally{f.sdk.restore();}
});
test('future observedAt is metadata at the protected runtime boundary too',async()=>{
 const f=fixture();try{
  const command=f.command();for(const e of Object.values(command.activation.evidence))e.observedAt=f.now+3650*DAY;
  const result=await f.make().handle(command,{actor:f.actor});assert.equal(result.status,'storage_unique_successor_observed');
  assert.equal(f.sdk.requests.length,13);
 }finally{f.sdk.restore();}
});
for(const [label,mutate]of [
 ['missing activation',c=>delete c.activation],['legacy version',c=>c.activation.schemaVersion=1],
 ['extra expiry',c=>c.activation.expiresAt=0],['extra start',c=>c.activation.verifiedAt=0],
 ['binding mismatch',c=>c.activation.bindingSha256='c'.repeat(64)],['operation mismatch',c=>c.activation.operationDigest='c'.repeat(64)],
 ['changed committed facts',c=>c.activation.evidence.access.stateSha256='c'.repeat(64)],
 ['missing role',c=>delete c.activation.evidence.ownership],['extra role',c=>c.activation.evidence.extra=c.activation.evidence.access],
 ['timed evidence field',c=>c.activation.evidence.access.expiresAt=0],['missing observation',c=>delete c.activation.evidence.access.observedAt],
 ['negative observation',c=>c.activation.evidence.access.observedAt=-1],['fractional observation',c=>c.activation.evidence.access.observedAt=0.5],
 ['unsafe observation',c=>c.activation.evidence.access.observedAt=Number.MAX_SAFE_INTEGER+1],
 ['string observation',c=>c.activation.evidence.access.observedAt='0'],['null observation',c=>c.activation.evidence.access.observedAt=null],
 ['nonfinite observation',c=>c.activation.evidence.access.observedAt=Infinity],
 ['invalid digest',c=>c.activation.evidence.access.digest='bad'],['digest trailing newline',c=>c.activation.evidence.access.digest+='\n'],
 ['caller scope override',c=>c.nonce='c'.repeat(32)]
])test('untimed activation rejects '+label+' before transport',async()=>{
 const f=fixture();try{const command=f.command();mutate(command);await assert.rejects(f.make().handle(command,{actor:f.actor}),held);
  assert.equal(f.constructors,0);assert.equal(f.sdk.clientCalls,0);
 }finally{f.sdk.restore();}
});
for(const [label,mutate]of [
 ['enabled',b=>b.enabled=true],['start sentinel',b=>b.verifiedAt=1],['expiry sentinel',b=>b.expiresAt=1],
 ['evidence start sentinel',b=>b.capability.evidence.access.verifiedAt=1],['evidence expiry sentinel',b=>b.capability.evidence.access.expiresAt=1],
 ['extra field',b=>b.setupExpiresAt=1],['short operation budget',b=>b.timeoutMs=24999],['long operation budget',b=>b.timeoutMs=25001],
 ['repeat permission',b=>b.singleAdmittedInvocation=false]
])test('schema7 rejects '+label+' before runtime construction',()=>{
 const f=fixture();try{mutate(f.binding);assert.throws(()=>f.make(),held);assert.equal(f.constructors,0);assert.equal(f.sdk.clientCalls,0);}finally{f.sdk.restore();}
});
test('legacy6/1 retains expiry and both mixed protocol pairs reject',()=>{
 const f=fixture();try{
  const untimedPin=f.pin(),untimedKey=dormantOperationDigest(untimedPin);
  assert.throws(()=>activateDormantBinding(f.binding,f.pin(),f.timedActivation(),f.now),held);
  f.binding.schemaVersion=6;
  assert.notEqual(f.pin(),untimedPin);assert.notEqual(dormantOperationDigest(f.pin()),untimedKey);
  assert.throws(()=>activateDormantBinding(f.binding,f.pin(),f.activation(),f.now),held);
  const timed=f.timedActivation();assert.equal(activateDormantBinding(f.binding,f.pin(),timed,f.now).binding.enabled,true);
  assert.throws(()=>activateDormantBinding(f.binding,f.pin(),timed,f.now+31*DAY),held);
  assert.throws(()=>activateDormantBinding(f.binding,f.pin(),timed,f.now+33001),held);
  assert.equal(f.sdk.clientCalls,0);
 }finally{f.sdk.restore();}
});
for(const [label,mutate]of [
 ['project',f=>f.sdk.app.config.projectId='123456780'],['production',f=>f.sdk.app.config.environment='Production'],
 ['source',f=>f.config.sourceRevision='c'.repeat(40)],['control host',f=>f.config.controlHost='other.invalid'],
 ['controller',f=>f.binding.capability.controllerFunctionId='123456780'],['deployment',f=>f.binding.capability.deploymentId='other_controller'],
 ['SDK version',f=>f.binding.capability.sdkVersion='3.4.1'],['auth type',f=>f.sdk.app.credential.getCurrentUserType=()=> 'user'],
 ['origin',f=>f.binding.capability.origin='https://other.invalid'],['projection',f=>f.binding.capability.tables.reportRuns.projectionSha256='c'.repeat(64)],
 ['receipt projection',f=>f.binding.capability.tables.eventReceipts.projectionSha256='c'.repeat(64)],
 ['table mismatch',f=>f.binding.tableId='123456780']
])test('untimed setup preserves exact '+label+' restriction',async()=>{
 const f=fixture();try{
  mutate(f);const command=f.command();
  await assert.rejects(async()=>f.make().handle(command,{actor:f.actor}),held);
  assert.equal(f.constructors,0);assert.equal(f.sdk.clientCalls,0);
 }finally{f.sdk.restore();}
});
test('untimed command still requires the internal Controller identity',async()=>{
 const f=fixture();try{
  for(const actor of [{kind:'customer',identity:f.actor.identity},{kind:'internal_controller',identity:'other'}])
   await assert.rejects(f.make().handle(f.command(),{actor}),held);
  assert.equal(f.constructors,0);assert.equal(f.sdk.clientCalls,0);
 }finally{f.sdk.restore();}
});
test('changed metadata after years cannot renew warm or cold durable admission',async()=>{
 const f=fixture();try{
  const handler=f.make(),first=await handler.handle(f.command(),{actor:f.actor}),prior=f.sdk.clientCalls;
  f.advance(3650*DAY);const later=f.command();later.activation.evidence.access.digest=sha('different-synthetic-observation');
  assert.equal(later.activation.operationDigest,first.operationDigest);
  await assert.rejects(handler.handle(later,{actor:f.actor}),held);assert.equal(f.sdk.clientCalls,prior);
  await assert.rejects(f.make().handle(later,{actor:f.actor}),held);assert.equal(f.sdk.clientCalls,prior+1);
  assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,2);
  assert.equal(f.sdk.requests.at(-1).payload[0].EVENT_KEY,'report-storage:'+first.operationDigest);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/table/123456788/row')).length,4);
 }finally{f.sdk.restore();}
});
test('concurrent cold untimed activations compete for exactly one admission key',async()=>{
 const f=fixture();try{
  const a=f.command(),b=f.command();b.activation.evidence.access.observedAt+=3650*DAY;
  const outcomes=await Promise.allSettled([f.make().handle(a,{actor:f.actor}),f.make().handle(b,{actor:f.actor})]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  const admissions=f.sdk.requests.filter(x=>x.path.endsWith('/table/123456787/row'));
  assert.equal(admissions.length,2);assert.equal(new Set(admissions.map(x=>x.payload[0].EVENT_KEY)).size,1);
  assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,2);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/table/123456788/row')).length,4);
 }finally{f.sdk.restore();}
});
test('ambiguous untimed admission remains consumed after years and cold reconstruction',async()=>{
 const f=fixture();try{
  f.sdk.mode='admission_lost';const handler=f.make();await assert.rejects(handler.handle(f.command(),{actor:f.actor}),held);
  assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,0);const prior=f.sdk.clientCalls;
  f.advance(3650*DAY);f.sdk.mode='normal';await assert.rejects(handler.handle(f.command(),{actor:f.actor}),held);
  assert.equal(f.sdk.clientCalls,prior);await assert.rejects(f.make().handle(f.command(),{actor:f.actor}),held);
  assert.equal(f.sdk.clientCalls,prior+1);assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,0);
 }finally{f.sdk.restore();}
});
for(const elapsed of [24999,25000])test('execution elapsed '+elapsed+'ms is checked after arbitrary setup delay',async()=>{
 const f=fixture();let release;try{
  const handler=f.make(),command=f.command();f.advance(3650*DAY);
  f.sdk.authDelay=new Promise(resolve=>{release=resolve;});
  const pending=handler.handle(command,{actor:f.actor});pending.catch(()=>{});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.constructors,1);
  f.advance(elapsed);release();
  if(elapsed===24999){assert.equal((await pending).status,'storage_unique_successor_observed');assert.equal(f.sdk.requests.length,13);}
  else {await assert.rejects(pending,held);assert.equal(f.sdk.clientCalls,0);assert.equal(f.sdk.rows.size,0);}
  assert.equal(f.drains,1);
  await assert.rejects(handler.handle(command,{actor:f.actor}),held);assert.equal(f.constructors,1);
 }finally{release?.();f.sdk.restore();}
});
test('untimed execution still has an independent scheduled 25000ms cancellation',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['setTimeout']});let stopped=0,drained=0,operationSignal,settled=false;
 try{
  const handler=f.make(io=>({...io,insertAdmission(_row,{signal}){operationSignal=signal;return new Promise(()=>{});},
   stop(){stopped++;io.stop();},async stopAndDrain(){drained++;return io.stopAndDrain();}}));
  const pending=handler.handle(f.command(),{actor:f.actor});pending.then(()=>{settled=true;},()=>{settled=true;});
  t.mock.timers.tick(24999);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);assert.equal(stopped,0);assert.equal(operationSignal.aborted,false);
  t.mock.timers.tick(1);await assert.rejects(pending,held);
  assert.equal(operationSignal.aborted,true);assert.equal(stopped,1);assert.equal(drained,1);assert.equal(f.sdk.clientCalls,0);
  await assert.rejects(handler.handle(f.command(),{actor:f.actor}),held);assert.equal(f.constructors,1);
 }finally{t.mock.timers.reset();f.sdk.restore();}
});
test('untimed stalled SDK request retains its 3000ms timeout without retry',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['setTimeout']});let settled=false;
 try{
  f.sdk.mode='stall';const handler=f.make(),pending=handler.handle(f.command(),{actor:f.actor});
  pending.then(()=>{settled=true;},()=>{settled=true;});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.sdk.clientCalls,1);t.mock.timers.tick(2999);await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  t.mock.timers.tick(1);await assert.rejects(pending,held);assert.equal(f.drains,1);assert.equal(f.sdk.clientCalls,1);
  await assert.rejects(handler.handle(f.command(),{actor:f.actor}),held);assert.equal(f.sdk.clientCalls,1);
 }finally{t.mock.timers.reset();f.sdk.restore();}
});
test('unconfirmed drain rejects untimed success and leaves admission consumed',async()=>{
 const f=fixture();try{
  let drained=0;const handler=f.make(io=>({...io,async stopAndDrain(){await io.stopAndDrain();drained++;return {quiescent:false};}}));
  await assert.rejects(handler.handle(f.command(),{actor:f.actor}),held);
  assert.equal(drained,1);assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.rows.size,2);
  const prior=f.sdk.clientCalls;await assert.rejects(handler.handle(f.command(),{actor:f.actor}),held);assert.equal(f.sdk.clientCalls,prior);
 }finally{f.sdk.restore();}
});
