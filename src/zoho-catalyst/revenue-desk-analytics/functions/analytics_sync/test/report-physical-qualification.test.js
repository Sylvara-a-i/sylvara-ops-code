'use strict';
const networkGuard=require('./helpers/report-physical-network-fixture');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {installSocketFixture}=require('./helpers/report-physical-socket-fixture');
const schema=require('./helpers/report-storage-schema-fixture');
const makeFixture=require('./helpers/report-physical-qualification-fixture');
const REVISION='a'.repeat(40),PROJECT_ID='123456789';
const environment=()=>({DEPLOYMENT_ENVIRONMENT:'development',SOURCE_REVISION:REVISION,
 ROUTE_CONTROL_HOST:'synthetic.invalid',X_ZOHO_CATALYST_ORG_ID:'987654321'});
// Actual SDK loading/authentication with synthetic managed headers; only the TLS
// socket is emulated. No inherited credential/configuration environment is used.
process.env=environment();
const bootstrap=require('../lib/report-https-bootstrap');bootstrap.initializeHttpsBootstrap();
const nativeRequest=bootstrap.assertHttpsBootstrap();
const sdk=require('zcatalyst-sdk-node');bootstrap.assertHttpsBootstrap();
const {canonicalJson}=require('../lib/facts');
const cap=require('../lib/report-storage-capability');
const {createProtectedStorageQualification}=require('../lib/report-storage-qualification');
const {storageFailureDiagnostic}=require('../lib/report-storage-diagnostic');
const {createReportRunTransport}=require('../lib/report-run-transport');
const sha=value=>crypto.createHash('sha256').update(typeof value==='string'?value:canonicalJson(value)).digest('hex');
const actor={kind:'internal_controller',identity:'synthetic-operator'};
const config={environment:'development',sourceRevision:REVISION,controlHost:'synthetic.invalid',
 expectedProjectIdSha256:sha(PROJECT_ID),operatorIdHash:actor.identity};
const qualify=createProtectedStorageQualification();
const customFactories=new WeakMap();
async function invoke(command,{appMutator,transportFactory}={}){
 const app=sdk.initialize({headers:{'x-zc-environment':'Development','x-zc-projectid':PROJECT_ID,
  'x-zc-project-key':'synthetic-project-key','x-zc-admin-cred-type':'token','x-zc-admin-cred-token':'synthetic-admin-token',
  'x-zc-user-cred-type':'token','x-zc-user-cred-token':'synthetic-user-token','x-zc-user-type':'admin'}});
 assert.equal(bootstrap.assertHttpsBootstrap(),nativeRequest);
 appMutator?.(app);
 if(transportFactory&&!customFactories.has(transportFactory))customFactories.set(transportFactory,createProtectedStorageQualification({transportFactory}));
 const factory=transportFactory?customFactories.get(transportFactory):qualify;
 try{return {statusCode:200,body:{result:await factory(app,config).handle(command,{actor})}};}
 catch(error){assert.equal(error.code,'REPORT_STORAGE_QUALIFICATION_HELD');return {statusCode:500,diagnostic:storageFailureDiagnostic(error)};}
}
const fixture=makeFixture({schema,sha,crypto,cap,environment,REVISION,installSocketFixture,invoke});
for(const schemaVersion of [3,4])test('real SDK and issued capability schema '+schemaVersion+' complete 13 contained requests',async t=>{
 assert.equal(process.version,'v24.19.0');
 const f=await fixture(t,{schemaVersion});const out=await f.run();assert.equal(out.statusCode,200);
 assert.equal(out.body.result.status,'storage_unique_successor_observed');assert.equal(out.body.result.overlappingRounds,2);
 assert.equal(out.body.result.reads+out.body.result.admissionReads,8);assert.equal(out.body.result.inserts+out.body.result.admissionInserts,5);
 assert.equal(f.network.requests.length,13);assert.equal(f.network.snapshot().maxActive,2);assert.equal(f.network.snapshot().active,0);
 assert.equal(f.rows.size,2);assert.equal(f.receipts.size,1);assert.equal(f.network.snapshot().fallbackAttempts,0);
 assert.equal(out.body.result.qualificationAuthority,false);assert.equal(out.body.result.deliveryAuthority,false);
 assert.deepEqual(Object.keys(out.body.result).sort(),['status','mechanism','operationDigest','evidenceDigest','observedAt','physicalRows','reads','inserts','overlappingRounds',
  'admissionReads','admissionInserts','admissionEvidenceDigest','creatorProvenance','namedIdentityVerified','durableAdmissionObserved','singleAdmittedInvocationRequired',
  'qualificationAuthority','deliveryAuthority'].sort());
 assert.equal(bootstrap.assertHttpsBootstrap(),nativeRequest);
 const replay=await f.run();assert.equal(replay.statusCode,500);assert.equal(f.network.requests.length,13);
});
for(const [label,options]of [['noncanonical capability',{wrongCapability:true}],['strict Boolean readback',{readBooleanString:true}],
 ['root socket failure',{failRoot:true}],['unconfirmed close',{holdClose:true,timeoutMs:30}]])
test('real qualification holds '+label+' without later rounds',async t=>{
 const f=await fixture(t,options);const out=await f.run();assert.equal(out.statusCode,500);assert.ok(f.network.requests.length<13);
 if(options.holdClose){assert.equal(f.network.requests.length,1);assert.equal(f.network.snapshot().active,1);f.network.releaseClose(0);}
 else assert.equal(f.network.snapshot().active,0);
 assert.equal(f.network.snapshot().fallbackAttempts,0);
});
test('schema 5 keeps sequential SDK behavior and no physical module construction',async t=>{
 const f=await fixture(t,{schemaVersion:5});const Module=require('node:module'),load=Module._load;let physicalLoads=0;
 Module._load=function(id,...rest){if(id==='./report-successor-physical')physicalLoads++;return load.call(this,id,...rest);};
 let out;try{out=await f.run();}finally{Module._load=load;}
 assert.equal(out.statusCode,200);assert.equal(out.body.result.status,'storage_sequential_duplicate_rejected');
 assert.equal(out.body.result.concurrencyProven,false);assert.equal(f.network.requests.length,7);assert.equal(physicalLoads,0);
 assert.equal(f.network.snapshot().maxActive,1);assert.equal(f.network.snapshot().active,0);
});
test('real SDK qualification fixtures made no external network calls',()=>{
 assert.deepEqual(networkGuard.snapshot(),{blockedCalls:0});
});

test('real SDK strict context rejection has zero constructor attempts and remains consumed',async t=>{
 const f=await fixture(t,{invokeOptions:{appMutator:app=>{app.credential.strictScope=true;}}});
 const out=await f.run();assert.equal(out.statusCode,500);
 assert.deepEqual(Object.fromEntries(['schemaVersion','firstFailure','constructorAttempts','insertConstructorAttempts','drain'].map(k=>[k,out.diagnostic[k]])),
  {schemaVersion:1,firstFailure:'managed_context',constructorAttempts:0,insertConstructorAttempts:0,drain:'not_created'});
 assert.equal(f.network.requests.length,0);assert.equal((await f.run()).statusCode,500);assert.equal(f.network.requests.length,0);
});

test('real SDK failed branch snapshot is issued after peer physical cleanup',async t=>{
 const f=await fixture(t,{failRoot:true}),out=await f.run();assert.equal(out.statusCode,500);
 assert.equal(out.diagnostic.firstFailure,'request_io');assert.equal(out.diagnostic.drain,'owned_quiescent');
 assert.equal(out.diagnostic.constructorAttempts,f.network.requests.length);assert.equal(out.diagnostic.insertConstructorAttempts,3);
 assert.equal(f.network.snapshot().active,0);assert.equal(Object.isFrozen(out.diagnostic),true);
 const before=f.network.requests.length;assert.equal((await f.run()).statusCode,500);assert.equal(f.network.requests.length,before);
});

test('real SDK final read with unknown close cannot become qualification success',async t=>{
 const f=await fixture(t,{finalCloseHeld:true,timeoutMs:600}),out=await f.run();
 assert.equal(out.statusCode,500);assert.equal(f.network.requests.length,13);assert.equal(f.rows.size,2);assert.equal(f.receipts.size,1);
 assert.equal(out.diagnostic.constructorAttempts,13);assert.equal(out.diagnostic.insertConstructorAttempts,5);
 assert.equal(out.diagnostic.drain,'handles_pending');assert.equal(f.network.snapshot().active,1);
 const original=JSON.parse(JSON.stringify(out.diagnostic));f.network.releaseClose(12);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(out.diagnostic,original);assert.equal(Object.isFrozen(out.diagnostic),true);
 assert.equal((await f.run()).statusCode,500);assert.equal(f.network.requests.length,13);
});

for(const mode of ['confirmed','unconfirmed','rejected'])test('completed 13-request proof waits for '+mode+' final drain before publishing outcome',async t=>{
 let release,entered;const gate=new Promise(resolve=>{release=resolve;}),drainEntered=new Promise(resolve=>{entered=resolve;});
 t.after(()=>release());
 const transportFactory=options=>{
  const io=createReportRunTransport(options);
  return {...io,async stopAndDrain(){const settled=await io.stopAndDrain();entered(settled);await gate;
   if(mode==='rejected')throw Error('SYNTHETIC_PRIVATE_DRAIN_FAILURE');
   return mode==='unconfirmed'?{quiescent:false}:settled;}};
 };
 const f=await fixture(t,{invokeOptions:{transportFactory}});let completed=false;
 const result=f.run().then(value=>{completed=true;return value;});
 const settled=await drainEntered;assert.equal(settled.quiescent,true);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(completed,false);assert.equal(f.network.requests.length,13);assert.equal(f.network.snapshot().active,0);
 assert.equal(f.rows.size,2);assert.equal(f.receipts.size,1);assert.equal(f.network.snapshot().maxActive,2);
 release();const out=await result;
 if(mode==='confirmed'){assert.equal(out.statusCode,200);assert.equal(out.body.result.status,'storage_unique_successor_observed');assert.equal(out.body.result.qualificationAuthority,false);}
 else{assert.equal(out.statusCode,500);assert.equal(out.diagnostic.firstFailure,'drain');assert.equal(out.diagnostic.drain,'unknown');
  assert.equal(out.diagnostic.constructorAttempts,13);assert.equal(out.diagnostic.insertConstructorAttempts,5);
  assert.equal(JSON.stringify(out).includes('SYNTHETIC_PRIVATE'),false);assert.equal(Object.isFrozen(out.diagnostic),true);}
 assert.equal((await f.run()).statusCode,500);assert.equal(f.network.requests.length,13);
});
