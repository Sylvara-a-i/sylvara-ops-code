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

const zlib=require('node:zlib');
const {preflightReportBootstrapEnvironment:preflight,PLANNING_BUDGET}=require(base+'revenue_desk_call_gateway/lib/report-bootstrap-transport');
const {prepareReportBootstrapBinding:prepare}=require(base+'revenue_desk_call_gateway/lib/report-bootstrap-binding');
function compact(raw,size=400){const t=encode(raw,{partSize:size,format:'deflate-v1'});return {...t.parts,[JSON_KEY]:t.marker,[HASH_KEY]:sha(raw)};}
function compactWire(bytes,rawLength,size=400){const encoded=bytes.toString('base64'),parts={};for(let i=0;i<Math.ceil(encoded.length/size);i++)parts[PART_PREFIX+i]=encoded.slice(i*size,(i+1)*size);return {...parts,[JSON_KEY]:'runtime-deflate-v1:'+size+':'+Object.keys(parts).length+':'+encoded.length+':'+rawLength};}
function accounting(map){return {observedAt:at-1,serializedBytes:Buffer.byteLength(JSON.stringify(map)),entryCount:Object.keys(map).length,
 controlledEntries:Object.entries(map).filter(([k])=>['SOURCE_REVISION','DEPLOYMENT_ENVIRONMENT'].includes(k)).map(([key,value])=>({key,serializedEntryBytes:Buffer.byteLength(JSON.stringify(key)+':'+JSON.stringify(value))}))};}
function preparation(){const b=fixture();b.attestation.note='Café — 東京 😀';const raw=JSON.stringify(b,null,2),identityPins={SOURCE_REVISION:b.sourceRevision,DEPLOYMENT_ENVIRONMENT:b.environment};
 const map={...identityPins,unrelated:'quotes " and slash \\ and 東京'};return {raw,bindingSha256:sha(raw),identityPins,baseline:accounting(map),now:()=>at,map};}
test('optional compact values preserve exact UTF8, whitespace and SHA at every supported size',()=>{
 for(const size of [100,200,400])for(const raw of ['x'.repeat(629),'x'.repeat(2700),' {\n"name":"Café — 東京 😀"\n} ', 'x'.repeat(MAX_BYTES)]){
  const e=compact(raw,size);assert.equal(decode(e),raw);assert.equal(sha(decode(e)),e[HASH_KEY]);for(const [k,v]of Object.entries(e))if(k.startsWith(PART_PREFIX))assert.ok(v.length<=size);
 }
 for(const format of ['unknown',false,null])held(()=>encode('x',{format}));
 const raw='exact unchanged \n 東京',a=compactWire(zlib.deflateRawSync(Buffer.from(raw),{level:1}),Buffer.byteLength(raw));assert.equal(decode(a),raw);
});
test('compact malformed/mixed/versioned parts and inherited activation are held',()=>{
 const good=compact('x'.repeat(2700)),key=PART_PREFIX+'0';
 for(const mutate of [e=>delete e[key],e=>e[PART_PREFIX+'99']='a',e=>e[key]+='a',e=>e[key]='!',e=>delete e[JSON_KEY],e=>e[JSON_KEY]='legacy',e=>e[JSON_KEY]=e[JSON_KEY].replace('v1','v2'),e=>e[JSON_KEY]='runtime-deflate-v1:400:999:99999:99999']){const x={...good};mutate(x);held(()=>decode(x));}
 held(()=>decode(Object.create(good)));held(()=>decode(null));held(()=>decode([]));
 for(const marker of ['runtime-deflate-v2:400:1:4:1','runtime-parts-v2:400:1:4:1'])held(()=>decode({[JSON_KEY]:marker}));
});
test('compact inflation is bounded and trailing, truncated, invalid UTF8 and lying lengths hold',()=>{
 const raw='bound',wire=zlib.deflateRawSync(Buffer.from(raw));
 for(const bytes of [Buffer.concat([wire,Buffer.from('junk')]),Buffer.concat([wire,wire]),wire.subarray(0,wire.length-1)])held(()=>decode(compactWire(bytes,raw.length)));
 held(()=>decode(compactWire(zlib.deflateRawSync(Buffer.alloc(MAX_BYTES+1,65)),MAX_BYTES)));
 held(()=>decode(compactWire(wire,raw.length+1)));
 held(()=>decode(compactWire(zlib.deflateRawSync(Buffer.from([255])),1)));
 const e=compactWire(wire,raw.length);e[PART_PREFIX+'0']='Zh==';e[JSON_KEY]='runtime-deflate-v1:400:1:4:1';held(()=>decode(e));
});
test('safe preflight accounts for complete UTF8 serialized map and identity replacements without mutation',()=>{
 const p=preparation(),before=JSON.stringify(p),t=encode(p.raw,{format:'deflate-v1'}),r=preflight({...p,transport:t});
 const target={...p.map,...p.identityPins,...t.parts,[HASH_KEY]:p.bindingSha256,[JSON_KEY]:t.marker};
 assert.equal(r.serializedBytes,Buffer.byteLength(JSON.stringify(target)));assert.equal(r.entryCount,Object.keys(target).length);
 assert.equal(r.remainingPlanningBytes,PLANNING_BUDGET-r.serializedBytes);assert.equal(r.providerLimitVerified,false);assert.equal(r.configurationChanged,false);assert.ok(Object.isFrozen(r));assert.equal(JSON.stringify(p),before);
 const empty=preflight({...p,transport:t,baseline:accounting({})});assert.equal(empty.serializedBytes,Buffer.byteLength(JSON.stringify({...p.identityPins,...t.parts,[HASH_KEY]:p.bindingSha256,[JSON_KEY]:t.marker})));
 const prepared=prepare(p);assert.match(prepared.marker,/^runtime-deflate-v1:/);assert.equal(prepared.preflight.serializedBytes,r.serializedBytes);
 assert.equal(decode({...prepared.parts,[JSON_KEY]:prepared.marker}),p.raw);
});
test('engineering budget includes every contribution and exact boundary, never claims provider capacity',()=>{
 const p=preparation(),t=encode(p.raw,{format:'deflate-v1'}),r=preflight({...p,transport:t}),baseline={...p.baseline,serializedBytes:p.baseline.serializedBytes+PLANNING_BUDGET-r.serializedBytes};
 assert.equal(preflight({...p,transport:t,baseline}).serializedBytes,PLANNING_BUDGET);held(()=>preflight({...p,transport:t,baseline:{...baseline,serializedBytes:baseline.serializedBytes+1}}));
});
test('bad metadata, staged representations, foreign keys and stale raw pin hold before preparation',()=>{
 for(const mutate of [p=>p.baseline.observedAt=at-900001,p=>p.baseline.observedAt=at+1,p=>p.baseline.entryCount=-1,p=>p.baseline.serializedBytes=NaN,p=>p.baseline.extra=true,p=>p.baseline.controlledEntries.push(p.baseline.controlledEntries[0]),
  p=>p.baseline.controlledEntries[0].serializedEntryBytes=1,p=>p.baseline.controlledEntries.push({key:JSON_KEY,serializedEntryBytes:100}),p=>p.baseline.controlledEntries.push({key:PART_PREFIX+'0',serializedEntryBytes:100}),
  p=>p.identityPins.extra='bad',p=>p.identityPins.DEPLOYMENT_ENVIRONMENT='production',p=>p.bindingSha256=sha('stale')]){const p=preparation();mutate(p);held(()=>prepare(p));}
 const p=preparation(),t=encode(p.raw,{format:'deflate-v1'});t.parts.unrelated='x';held(()=>preflight({...p,transport:t}));
});
test('pure preparation preserves original source/expiry/qualification gates and legacy formats',()=>{
 for(const mutate of [p=>p.now=()=>at+1000,p=>p.identityPins.SOURCE_REVISION='b'.repeat(40),p=>{const b=JSON.parse(p.raw);b.delivery.enabled=true;p.raw=JSON.stringify(b);p.bindingSha256=sha(p.raw);}]){const p=preparation();mutate(p);held(()=>prepare(p));}
 const p=preparation(),legacy=prepare({...p,format:'parts-v1'});assert.match(legacy.marker,/^runtime-parts-v1:/);assert.equal(load({...p.identityPins,...legacy.parts,[JSON_KEY]:legacy.marker,[HASH_KEY]:legacy.bindingSha256},{now:p.now}).delivery.enabled,false);
});
