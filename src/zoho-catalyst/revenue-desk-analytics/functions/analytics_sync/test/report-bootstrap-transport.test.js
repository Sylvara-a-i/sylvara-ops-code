'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {installOfflineGuard}=require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard=installOfflineGuard();test.after(()=>{guard.restore();assert.deepEqual(guard.blocked,[]);});
const base='../../../../revenue-desk-call-runtime/functions/';
const {encodeReportBootstrap:encode,decodeReportBootstrap:decode,JSON_KEY,HASH_KEY,PART_PREFIX,MAX_BYTES}=require(base+'revenue_desk_call_gateway/lib/report-bootstrap-transport');
const {loadReportBootstrapBinding:load}=require(base+'revenue_desk_call_gateway/lib/report-bootstrap-binding');
const {createProtectedWorkerReportOptions}=require(base+'revenue_desk_call_worker/lib/report-bootstrap');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex'),at=1800000000000;
function packed(raw,partSize=400){const x=encode(raw,{partSize});return {...x.parts,[JSON_KEY]:x.marker,[HASH_KEY]:sha(raw)};}
function fixture(){return {schemaVersion:1,environment:'development',sourceRevision:'a'.repeat(40),projectId:'123456789',controllerFunctionId:'123456781',workerFunctionId:'123456782',verifiedAt:at-1000,expiresAt:at+1000,attestation:{enabled:false},delivery:{enabled:false},reporting:{enabled:false}};}
function env(b=fixture()){const raw=JSON.stringify(b,null,2);return {...packed(raw),DEPLOYMENT_ENVIRONMENT:'development',SOURCE_REVISION:b.sourceRevision};}
const held=fn=>assert.throws(fn,{code:'REPORT_BOOTSTRAP_HELD'});
test('100/200/400 values preserve exact UTF8 bytes, whitespace and raw SHA',()=>{
 for(const size of [100,200,400])for(const raw of ['x'.repeat(629),'x'.repeat(2700),' {\n"name":"Café — 東京 😀"\n} ']){
  const e=packed(raw,size);assert.equal(decode(e),raw);assert.equal(sha(decode(e)),e[HASH_KEY]);
  for(const [key,value] of Object.entries(e))if(key.startsWith(PART_PREFIX))assert.ok(value.length<=size);
 }
});
test('bounded raw bytes and valid Unicode; no compression or allocation from oversized input',()=>{
 const raw='x'.repeat(MAX_BYTES);assert.equal(decode(packed(raw)),raw);
 for(const raw of ['', 'x'.repeat(MAX_BYTES+1), '\ud800'])held(()=>encode(raw));
 for(const partSize of [0,99,401,'400'])held(()=>encode('x',{partSize}));
});
test('missing, extra, malformed, unarmed and conflicting staged values hold',()=>{
 const good=packed('x'.repeat(629)),key=PART_PREFIX+'0';
 for(const mutate of [e=>delete e[key],e=>e[PART_PREFIX+'99']='x',e=>e[key]+='x',e=>e[key]='!'.repeat(400),e=>e[JSON_KEY]='runtime-parts-v1:400:999:840:629',e=>delete e[JSON_KEY],e=>e[JSON_KEY]='legacy']){
  const e={...good};mutate(e);held(()=>decode(e));
 }
 held(()=>load({[PART_PREFIX+'0']:'abcd'},{now:()=>at}));
 held(()=>load({[JSON_KEY]:undefined},{now:()=>at}));
 held(()=>load({[HASH_KEY]:''},{now:()=>at}));
 assert.equal(load({}, {now:()=>at}),null);
});
test('canonical Base64 and valid UTF8 required',()=>{
 for(const encoded of ['Zh==','/w==','Zg=','Zg===']){
  const e={[JSON_KEY]:'runtime-parts-v1:400:1:'+encoded.length+':1',[PART_PREFIX+'0']:encoded};held(()=>decode(e));
 }
});
test('actual loader retains immutable identity, expiry and claim authority checks',()=>{
 const e=env(),b=load(e,{now:()=>at});assert.ok(Object.isFrozen(b));assert.ok(Object.isFrozen(b.delivery));
 assert.equal(createProtectedWorkerReportOptions(e,{now:()=>at}).terminalDraftReconcilerFactory,null);
 for(const mutate of [e=>delete e[HASH_KEY],e=>e[HASH_KEY]=sha('wrong'),e=>e.SOURCE_REVISION='b'.repeat(40),e=>e.DEPLOYMENT_ENVIRONMENT='production',e=>e[PART_PREFIX+'0']='A'+e[PART_PREFIX+'0'].slice(1)]){const x={...e};mutate(x);held(()=>load(x,{now:()=>at}));}
 for(const mutate of [b=>b.expiresAt=at,b=>b.reporting.enabled=true,b=>b.attestation.enabled=true,b=>b.delivery.enabled=true]){const b=fixture();mutate(b);held(()=>load(env(b),{now:()=>at}));}
});
test('legacy exact bytes remain supported without any staged parts',()=>{
 const raw=JSON.stringify(fixture()),e={[JSON_KEY]:raw,[HASH_KEY]:sha(raw),DEPLOYMENT_ENVIRONMENT:'development',SOURCE_REVISION:'a'.repeat(40)};
 assert.equal(load(e,{now:()=>at}).delivery.enabled,false);held(()=>load({...e,[PART_PREFIX+'0']:''},{now:()=>at}));
});
test('current Controller and Worker composition keeps all delivery switches disabled',()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const name of ['revenue_desk_route_control','revenue_desk_call_worker']){
  const source=fs.readFileSync(path.resolve(__dirname,base+name+'/lib/report-bootstrap.js'),'utf8');
  for(const flag of ['deliveryEnabled','autoDeliveryEnabled','projectionEnabled'])assert.match(source,new RegExp(flag+':false'));
 }
});
