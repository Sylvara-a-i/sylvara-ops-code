'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture:network}=require('./helpers/report-run-sdk-fixture');
const {canonicalJson}=require('../lib/facts');
const {createProtectedStorageQualification}=require('../lib/report-storage-qualification');
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:canonicalJson(x)).digest('hex');
function fixture(){
 const sdk=network({deferResponses:true});let at=1800000000000;
 const binding={schemaVersion:1,enabled:true,environment:'development',sourceRevision:'a'.repeat(40),projectId:'123456789',
  controlHost:'synthetic.invalid',tableId:'123456788',nonce:crypto.randomBytes(16).toString('hex'),
  principalSha256:sha({projectId:'123456789',userId:'987654321',roleId:'987654320'}),creatorIdSha256:sha('987654321'),
  verifiedAt:at-1,expiresAt:at+60000,timeoutMs:1000,singleAdmittedInvocation:true};
 const config={environment:'development',sourceRevision:binding.sourceRevision,controlHost:binding.controlHost,
  expectedProjectIdSha256:sha(binding.projectId),operatorIdHash:'operator_'+sha('synthetic')};
 const environment=()=>{const raw=JSON.stringify(binding);return {DEPLOYMENT_ENVIRONMENT:'development',SOURCE_REVISION:binding.sourceRevision,
  REPORT_STORAGE_QUALIFICATION_JSON:raw,REPORT_STORAGE_QUALIFICATION_SHA256:sha(raw)};};
 const factory=()=>createProtectedStorageQualification({environment:environment(),now:()=>at});
 const command={profile:'report_storage_qualification_v1',action:'qualify_storage'},actor={kind:'internal_controller',identity:config.operatorIdHash};
 return {sdk,binding,config,environment,factory,make:()=>factory()(sdk.app,config),command,actor,advance:n=>at+=n};
}
const held={code:'REPORT_STORAGE_QUALIFICATION_HELD'};
test('actual managed SDK proof makes exactly four inserts/eight reads, retains two rows and proves overlapping rounds',async()=>{
 const f=fixture();try{
  const result=await f.make().handle(f.command,{actor:f.actor});
  assert.equal(result.status,'storage_unique_successor_observed');assert.equal(result.inserts,4);assert.equal(result.reads,8);
  assert.equal(result.physicalRows,2);assert.equal(result.overlappingRounds,2);assert.equal(result.qualificationAuthority,false);
  assert.equal(result.deliveryAuthority,false);assert.equal(f.sdk.rows.size,2);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/row')).length,4);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/query')).length,7);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/project-user/current')).length,1);
  assert.ok(f.sdk.requests.every(x=>/\/(?:query|project-user\/current|table\/ReportRuns\/row)$/.test(x.path)));
  assert.ok(!JSON.stringify(result).includes('987654321'));assert.ok(!JSON.stringify(result).includes('private-unused'));
  assert.match(result.evidenceDigest,/^[a-f0-9]{64}$/);assert.ok(f.sdk.principals.every(x=>x==='user'));
 }finally{f.sdk.restore();}
});
test('warm double tap and cold repeat cannot restart a durable diagnostic; readback never re-attests qualification',async()=>{
 const f=fixture();try{
  const factory=f.factory(),first=factory(f.sdk.app,f.config),second=factory(f.sdk.app,f.config);
  const outcomes=await Promise.allSettled([first.handle(f.command,{actor:f.actor}),second.handle(f.command,{actor:f.actor})]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.sdk.rows.size,2);
  const writes=()=>f.sdk.requests.filter(x=>x.path.endsWith('/row')).length;
  assert.equal(writes(),4);await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);assert.equal(writes(),4);
  const evidence=await f.make().handle({...f.command,action:'read_storage_evidence'},{actor:f.actor});
  assert.equal(evidence.status,'storage_evidence_unattested');assert.equal(evidence.inserts,0);assert.equal(evidence.reads,3);
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
test('wrong current principal stops after one read and before any ReportRuns write',async()=>{
 const f=fixture();try{
  f.binding.principalSha256='b'.repeat(64);await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.requests.length,1);assert.equal(f.sdk.rows.size,0);
 }finally{f.sdk.restore();}
});
test('lost insert response retains partial immutable evidence and never qualifies or retries a mutation',async()=>{
 const f=fixture();try{
  f.sdk.mode='lost_insert';const handler=f.make();await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/row')).length,2);assert.equal(f.sdk.rows.size,1);
  await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
  f.sdk.mode='normal';const evidence=await f.make().handle({...f.command,action:'read_storage_evidence'},{actor:f.actor});
  assert.equal(evidence.headVersion,1);assert.equal(evidence.qualificationAuthority,false);
  assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/row')).length,2);assert.equal(f.sdk.rows.size,1);
 }finally{f.sdk.restore();}
});
test('creator or stored envelope mismatch is held on readback without destructive cleanup or extra writes',async()=>{
 const f=fixture();try{
  await f.make().handle(f.command,{actor:f.actor});const saved=[...f.sdk.rows.values()][0];saved.CREATORID='123456789';
  await assert.rejects(f.make().handle({...f.command,action:'read_storage_evidence'},{actor:f.actor}),held);
  saved.CREATORID='987654321';saved.ReportPayloadJson+=' ';
  await assert.rejects(f.make().handle({...f.command,action:'read_storage_evidence'},{actor:f.actor}),held);
  assert.equal(f.sdk.rows.size,2);assert.equal(f.sdk.requests.filter(x=>x.path.endsWith('/row')).length,4);
 }finally{f.sdk.restore();}
});
test('late authentication and deadline cannot dispatch after diagnostic admission expires',async()=>{
 const f=fixture();try{
  f.binding.timeoutMs=20;let release;f.sdk.authDelay=new Promise(resolve=>{release=resolve;});
  await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);release();
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.sdk.requests.length,0);assert.equal(f.sdk.rows.size,0);
 }finally{f.sdk.restore();}
});
