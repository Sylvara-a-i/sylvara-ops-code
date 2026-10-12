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
const sha=value=>crypto.createHash('sha256').update(typeof value==='string'?value:canonicalJson(value)).digest('hex');
const actor={kind:'internal_controller',identity:'synthetic-operator'};
const config={environment:'development',sourceRevision:REVISION,controlHost:'synthetic.invalid',
 expectedProjectIdSha256:sha(PROJECT_ID),operatorIdHash:actor.identity};
const qualify=createProtectedStorageQualification();
async function invoke(command){
 const app=sdk.initialize({headers:{'x-zc-environment':'Development','x-zc-projectid':PROJECT_ID,
  'x-zc-project-key':'synthetic-project-key','x-zc-admin-cred-type':'token','x-zc-admin-cred-token':'synthetic-admin-token',
  'x-zc-user-cred-type':'token','x-zc-user-cred-token':'synthetic-user-token','x-zc-user-type':'admin'}});
 assert.equal(bootstrap.assertHttpsBootstrap(),nativeRequest);
 try{return {statusCode:200,body:{result:await qualify(app,config).handle(command,{actor})}};}
 catch(error){assert.equal(error.code,'REPORT_STORAGE_QUALIFICATION_HELD');return {statusCode:500};}
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
