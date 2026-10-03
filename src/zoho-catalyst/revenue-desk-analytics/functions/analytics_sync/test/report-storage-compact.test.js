'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {installOfflineGuard}=require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard=installOfflineGuard();test.after(()=>{guard.restore();assert.deepEqual(guard.blocked,[]);});
const {encodeStorageBinding:encode,decodeStorageBinding:decode,preflightStorageEnvironment:preflight,JSON_KEY,HASH_KEY,PART_PREFIX,TOTAL_LIMIT,TUPLE_COUNT,PLANNING_BUDGET}=require('../lib/report-storage-binding');
const held={code:'REPORT_STORAGE_QUALIFICATION_HELD'},sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function binding(){return {schemaVersion:3,enabled:true,environment:'development',sourceRevision:'a'.repeat(40),projectId:'123456789',controlHost:'synthetic.invalid',tableId:'123456788',nonce:'c'.repeat(32),
 capability:{region:'US',origin:'https://api.catalyst.zoho.com',controllerFunctionId:'123456786',deploymentId:'synthetic_controller',sdkVersion:'3.4.0',authMode:'user',authType:'admin',creatorPolicy:'observed_consistent_v1',
  tables:{reportRuns:{id:'123456788',name:'ReportRuns',schemaSha256:sha('runs-schema'),uniquenessSha256:sha('runs-unique'),uniqueField:'IdempotencyKey',projectionSha256:sha('runs-projection')},
   eventReceipts:{id:'123456787',name:'RevenueDeskEventReceipts',schemaSha256:sha('receipts-schema'),uniquenessSha256:sha('receipts-unique'),uniqueField:'EVENT_KEY',projectionSha256:sha('receipts-projection')}},
  evidence:{ownerAuthorization:{digest:sha('authorization'),verifiedAt:1800000000000,expiresAt:1800000060000},ownership:{digest:sha('ownership'),verifiedAt:1800000000001,expiresAt:1800000060000},access:{digest:sha('access'),verifiedAt:1800000000002,expiresAt:1800000060000}}},
 verifiedAt:1800000000003,expiresAt:1800000060000,timeoutMs:30000,singleAdmittedInvocation:true};}
function leafValues(x){return Object.values(x).flatMap(v=>v&&typeof v==='object'?leafValues(v):[v]);}
function env(transport){return {...transport.parts,[JSON_KEY]:transport.marker};}
function frame(bytes,{rawLength=JSON.stringify(binding()).length,partSize=400,compressed}={}){
 const payload=(compressed||zlib.deflateRawSync(bytes)).toString('base64'),parts={};
 for(let i=0;i<Math.ceil(payload.length/partSize);i++)parts[PART_PREFIX+i]=payload.slice(i*partSize,(i+1)*partSize);
 return {parts,marker:'tuple-v1:'+partSize+':'+Object.keys(parts).length+':'+payload.length+':'+bytes.length+':'+rawLength};
}
function metrics(map){const controlled=new Set(['REPORT_SENDER_QUALIFICATION_JSON','REPORT_SENDER_QUALIFICATION_SHA256','REPORT_CONTROLLER_FUNCTION_ID','REPORT_DEPLOYMENT_ID',JSON_KEY,HASH_KEY]);return {serializedBytes:Buffer.byteLength(JSON.stringify(map)),entryCount:Object.keys(map).length,
 controlledEntries:Object.entries(map).filter(([key])=>controlled.has(key)||key.startsWith(PART_PREFIX)).map(([key,value])=>({key,serializedEntryBytes:Buffer.byteLength(JSON.stringify(key)+':'+JSON.stringify(value))}))};}
function plan(map,extra={}){const raw=JSON.stringify(binding());return {baseline:metrics(map),transport:encode(raw,{partSize:400,format:'tuple-v1'}),bindingSha256:sha(raw),descriptorPins:{REPORT_CONTROLLER_FUNCTION_ID:'123456786',REPORT_DEPLOYMENT_ID:'synthetic_controller'},...extra};}
for(const partSize of [100,200,400])test('all41 values, original bytes and raw SHA survive tuple transport '+partSize,()=>{
 const b=binding(),raw=JSON.stringify(b),packed=encode(raw,{partSize,format:'tuple-v1'}),result=decode(env(packed));
 assert.equal(leafValues(b).length,TUPLE_COUNT);assert.equal(result,raw);assert.equal(sha(result),sha(raw));assert.deepEqual(JSON.parse(result),b);
 assert.ok(Object.values(packed.parts).every(part=>part.length<=partSize));
 // Repeated values are legitimate; no deduplication or derived authority.
 b.capability.tables.eventReceipts.schemaSha256=b.capability.tables.reportRuns.schemaSha256;
 assert.equal(decode(env(encode(JSON.stringify(b),{partSize,format:'tuple-v1'}))),JSON.stringify(b));
});
test('exact raw bound and closed canonical source shape reject duplicate keys, omissions and normalization',()=>{
 const b=binding(),raw=JSON.stringify(b);b.controlHost='x'.repeat(TOTAL_LIMIT-raw.length+b.controlHost.length);
 assert.equal(decode(env(encode(JSON.stringify(b),{format:'tuple-v1'}))).length,TOTAL_LIMIT);
 for(const invalid of [JSON.stringify(b)+'x','{"schemaVersion":3,'+raw.slice(1),' '+raw,raw+' ',raw.replace('"schemaVersion":3','"schemaVersion":3.0')])assert.throws(()=>encode(invalid,{format:'tuple-v1'}),held);
 for(const mutate of [b=>b.extra=true,b=>delete b.nonce,b=>b.capability.extra=true,b=>b.schemaVersion=5,b=>b.verifiedAt=-1,b=>b.singleAdmittedInvocation='true',b=>b.capability.region=null]){const b=binding();mutate(b);assert.throws(()=>encode(JSON.stringify(b),{format:'tuple-v1'}),held);}
 const reordered={enabled:true,...binding()};assert.throws(()=>encode(JSON.stringify(reordered),{format:'tuple-v1'}),held);
 assert.throws(()=>encode(raw,{format:'tuple-v2'}),held);
});
test('partial, extra, malformed and mixed representations hold before binding parsing',()=>{
 const packed=encode(JSON.stringify(binding()),{partSize:100,format:'tuple-v1'}),e=env(packed);
 assert.throws(()=>decode(packed.parts),held);
 for(const key of Object.keys(packed.parts)){const x={...e};delete x[key];assert.throws(()=>decode(x),held);}
 for(const key of [PART_PREFIX+'00',PART_PREFIX+'41',PART_PREFIX+'junk'])assert.throws(()=>decode({...e,[key]:'AAAA'}),held);
 for(const marker of ['tuple-v2:100:1:4:1:1','tuple-v1:100:0:4:1:1','tuple-v1:100:42:4096:1:1','tuple-v1:100:1:4097:1:1','tuple-v1:100:1:4:4097:1','tuple-v1:100:1:4:1:4097','tuple-v1:100:01:4:1:1',JSON.stringify(binding())])assert.throws(()=>decode({...e,[JSON_KEY]:marker}),held);
 for(const part of ['!'.repeat(100),'A'.repeat(99),'A'.repeat(101),null])assert.throws(()=>decode({...e,[PART_PREFIX+'0']:part}),held);
 assert.throws(()=>decode({...e,[JSON_KEY]:encode(JSON.stringify(binding()),{partSize:100}).marker}),held);
});
test('bounded inflate rejects bombs, truncation, trailing streams and malformed UTF8 or Base64',()=>{
 const tuple=Buffer.from(JSON.stringify(leafValues(binding()))),compressed=zlib.deflateRawSync(tuple);
 for(const bytes of [Buffer.concat([compressed,Buffer.from('trailing')]),Buffer.concat([compressed,compressed]),compressed.subarray(0,compressed.length-1)])assert.throws(()=>decode(env(frame(tuple,{compressed:bytes}))),held);
 assert.throws(()=>decode(env(frame(Buffer.from('x'.repeat(100000)),{rawLength:100}))),held);
 // A lying small output declaration cannot evade the fixed inflate bound.
 const bomb=frame(Buffer.from('x'.repeat(100000)),{rawLength:100});bomb.marker=bomb.marker.replace(':100000:100',':100:100');assert.throws(()=>decode(env(bomb)),held);
 assert.throws(()=>decode(env(frame(Buffer.from([0xff])))),held);
 const invalid={parts:{[PART_PREFIX+'0']:'Zh=='},marker:'tuple-v1:400:1:4:1:1'};assert.throws(()=>decode(env(invalid)),held);
 // Alternate valid compression parameters are accepted; compressed-byte
 // determinism is not authority. Integrity remains the full raw JSON SHA.
 assert.equal(decode(env(frame(tuple,{compressed:zlib.deflateRawSync(tuple,{level:1})}))),JSON.stringify(binding()));
});
test('tuple count, scalar types, schema version and canonical tuple JSON are closed',()=>{
 const values=leafValues(binding());
 for(const tuple of [values.slice(1),[...values,true],{values},values.map((x,i)=>i===0?'3':x),values.map((x,i)=>i===0?5:x),values.map((x,i)=>i===1?1:x),values.map((x,i)=>i===2?{}:x),values.map((x,i)=>i===38?1.5:x)])assert.throws(()=>decode(env(frame(Buffer.from(JSON.stringify(tuple))))),held);
 assert.throws(()=>decode(env(frame(Buffer.from(' '+JSON.stringify(values))))),held);
 const repeated=values.map((x,i)=>i===37?-0:x);assert.throws(()=>decode(env(frame(Buffer.from(JSON.stringify(repeated).replace(',0,',',-0,'))))),held);
});
test('complete size preflight accounts exactly for escapes, UTF8, replacements and pair removal without values',()=>{
 for(const descriptorsPresent of [false,true]){
  const map={Existing:'quotes"\nCafé 😀',REPORT_SENDER_QUALIFICATION_JSON:'{"enabled":false,"expiresAt":1}',REPORT_SENDER_QUALIFICATION_SHA256:'a'.repeat(64)};
  if(descriptorsPresent)Object.assign(map,{REPORT_CONTROLLER_FUNCTION_ID:'123456786',REPORT_DEPLOYMENT_ID:'synthetic_controller'});
  const before=JSON.stringify(map),input=plan(map,{retireObsoleteSenderPair:true}),result=preflight(input);
  const expected={...map,...input.descriptorPins,...input.transport.parts,[HASH_KEY]:input.bindingSha256,[JSON_KEY]:input.transport.marker};delete expected.REPORT_SENDER_QUALIFICATION_JSON;delete expected.REPORT_SENDER_QUALIFICATION_SHA256;
  assert.equal(result.serializedBytes,Buffer.byteLength(JSON.stringify(expected)));assert.equal(result.entryCount,Object.keys(expected).length);assert.equal(result.remainingPlanningBytes,PLANNING_BUDGET-result.serializedBytes);
  assert.equal(result.providerLimitVerified,false);assert.equal(result.configurationChanged,false);assert.equal(JSON.stringify(map),before);
 }
});
test('sizing holds above engineering margin, malformed accounting, duplicate contributions and staged/armed keys',()=>{
 const input=plan({Existing:'x'}),ok=preflight(input),padding=PLANNING_BUDGET-ok.serializedBytes;
 assert.equal(preflight(plan({Existing:'x'+'y'.repeat(padding)})).serializedBytes,PLANNING_BUDGET);
 assert.throws(()=>preflight(plan({Existing:'x'+'y'.repeat(padding+1)})),held);
 for(const mutate of [x=>x.baseline.serializedBytes=1,x=>x.baseline.entryCount=-1,x=>x.baseline.controlledEntries=[{key:'unrelated',serializedEntryBytes:20}],x=>x.baseline.controlledEntries=[{key:'REPORT_CONTROLLER_FUNCTION_ID',serializedEntryBytes:100},{key:'REPORT_CONTROLLER_FUNCTION_ID',serializedEntryBytes:100}],x=>x.bindingSha256=sha('wrong'),x=>x.retireObsoleteSenderPair=true,x=>x.transport.parts.unrelated='x']){const x=plan({Existing:'x'});mutate(x);assert.throws(()=>preflight(x),held);}
 for(const key of [JSON_KEY,HASH_KEY,PART_PREFIX+'0',PART_PREFIX+'bad'])assert.throws(()=>preflight(plan({Existing:'x',[key]:''})),held);
 assert.throws(()=>preflight(plan({REPORT_SENDER_QUALIFICATION_JSON:'disabled'},{retireObsoleteSenderPair:true})),held);
 const raw=JSON.stringify(binding());assert.throws(()=>preflight({...input,transport:encode(raw)}),held);
});


test('schema4 retains all41 tuple-v1 fields and exact raw hash; unknown schema5 is rejected',()=>{
 const b=binding();b.schemaVersion=4;b.expiresAt=b.verifiedAt+3600000;
 for(const evidence of Object.values(b.capability.evidence))evidence.expiresAt=b.expiresAt;
 const raw=JSON.stringify(b),packed=encode(raw,{partSize:400,format:'tuple-v1'});
 assert.equal(leafValues(b).length,41);assert.equal(TUPLE_COUNT,41);
 assert.match(packed.marker,/^tuple-v1:/);assert.equal(decode(env(packed)),raw);assert.equal(sha(decode(env(packed))),sha(raw));
 b.schemaVersion=5;assert.throws(()=>encode(JSON.stringify(b),{format:'tuple-v1'}),held);
 const invalid=leafValues(b);assert.throws(()=>decode(env(frame(Buffer.from(JSON.stringify(invalid)),{rawLength:JSON.stringify(b).length}))),held);
});
