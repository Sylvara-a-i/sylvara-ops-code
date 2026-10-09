'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Writable,PassThrough}=require('node:stream');
const {createReportRunTransport}=require('../lib/report-run-transport');
const diag=require('../lib/report-storage-diagnostic');
const key='a'.repeat(64),sql=`SELECT * FROM ReportRuns WHERE IdempotencyKey = 'revenue-desk-report-v1:${key}' LIMIT 2`;
async function run(body,{headers={'content-type':'application/json'},enabled=true,stall=false,timeoutMs=100,blockMs=0,authorityHeld=false}={}){
 const tracker=diag.createStorageDiagnostic();let dispatches=0,received=false;
 const app={async authenticateRequest(){}};
 const createClient=()=>({send(request){return new Promise(resolve=>{
  const sink=new Writable({write(_chunk,_encoding,done){done();},final(done){dispatches++;done();
   if(stall)return;
   queueMicrotask(()=>{const stream=new PassThrough();stream.statusCode=200;stream.headers=headers;stream.on('error',()=>{});sink.emit('response',stream);received=true;resolve({statusCode:200,data:stream});stream.end(body);if(blockMs){const end=performance.now()+blockMs;while(performance.now()<end){}}});}});
  sink.on('error',()=>{});request.data.pipe(sink);
 });}});
 const transport=createReportRunTransport({app,createClient,timeoutMs,storageDiagnostic:tracker,storageProviderDiagnostics:enabled,storageAssertActive:()=>{if(authorityHeld&&received)throw Error('private guard detail');}});
 let result,error;try{result=await transport.query(sql);}catch(e){error=e;}
 return {result,error,dispatches,diagnostic:diag.storageFailureDiagnostic(diag.storageDiagnosticError(tracker))};
}
test('valid official REST-shaped response preserves acceptance and reports only closed shape',async()=>{const r=await run(JSON.stringify({status:'success',data:[{privateCustomer:'never_log',secret:'never_log'}]}));assert.equal(r.dispatches,1);assert.equal(r.result.length,1);assert.deepEqual(Object.fromEntries(Object.entries(r.diagnostic).filter(([k])=>k.startsWith('decode'))),{decodeUtf8:'valid',decodeJson:'valid',decodeRootType:'object',decodeDataType:'array',decodeArrayCardinality:'one',decodeEnvelopeStatus:'success',decodeDeadline:'active',decodeFailure:'none'});assert(!JSON.stringify(r.diagnostic).includes('never_log'));});
test('invalid UTF8 distinguished without recording bytes',async()=>{const r=await run(Buffer.from([0xff]));assert(r.error);assert.equal(r.diagnostic.decodeUtf8,'invalid');assert.equal(r.diagnostic.decodeJson,'not_attempted');assert.equal(r.diagnostic.decodeFailure,'utf8_invalid');assert.equal(r.dispatches,1);});
test('valid UTF8 but invalid JSON distinguished without body content',async()=>{const r=await run('private body not json');assert(r.error);assert.equal(r.diagnostic.decodeUtf8,'valid');assert.equal(r.diagnostic.decodeJson,'invalid');assert.equal(r.diagnostic.decodeFailure,'json_invalid');assert(!JSON.stringify(r.diagnostic).includes('private body'));});
for(const [value,type]of [[null,'null'],['private root','string'],[17,'number'],[false,'boolean'],[[],'array']])test('closed root type '+type,async()=>{const r=await run(JSON.stringify(value));assert(r.error);assert.equal(r.diagnostic.decodeRootType,type);assert.equal(r.diagnostic.decodeDataType,'absent');assert.equal(r.diagnostic.decodeFailure,'data_not_array');});
for(const [value,type]of [[null,'null'],['private data','string'],[17,'number'],[false,'boolean'],[{},'object']])test('closed data type '+type,async()=>{const r=await run(JSON.stringify({data:value,status:'private status'}));assert(r.error);assert.equal(r.diagnostic.decodeDataType,type);assert.equal(r.diagnostic.decodeEnvelopeStatus,'other');assert(!JSON.stringify(r.diagnostic).includes('private'));});
for(const [data,bucket]of [[[],'zero'],[[{}],'one'],[[{},{}],'multiple']])test('array cardinality '+bucket+' does not change transport acceptance',async()=>{const r=await run(JSON.stringify({data,status:'error'}));assert.equal(r.error,undefined);assert.equal(r.diagnostic.decodeArrayCardinality,bucket);assert.equal(r.diagnostic.decodeEnvelopeStatus,'error');assert.deepEqual(r.result,data);});
for(const [header,expected]of [['application/json; charset=UTF-8','json'],['text/plain','text'],['text/html','html'],['private-sensitive-header','other']])test('content type maps to '+expected,async()=>{const r=await run('{"data":[]}',{headers:{'content-type':header}});assert.equal(r.diagnostic.responseContentType,expected);assert(!JSON.stringify(r.diagnostic).includes('private-sensitive-header'));assert.equal(r.diagnostic.requestApiVersion,'v1');});
test('header getters are never called or serialized',async()=>{let called=0;const headers={};Object.defineProperty(headers,'content-type',{get(){called++;throw Error('secret')}});const r=await run('{"data":[]}',{headers});assert.equal(called,0);assert.equal(r.diagnostic.responseContentType,'other');});
test('missing headers preserve absent classification before response or cancellation',async()=>{const r=await run('',{stall:true,timeoutMs:5});assert.equal(r.diagnostic.responseContentType,'absent');assert.equal(r.diagnostic.firstDecodeFailure.responseContentType,'absent');});
// Hold the cancellation timer so this case exercises the monotonic expiry guard, not scheduler ordering.
test('deadline expiry is distinct from response shape',async context=>{context.mock.timers.enable({apis:['setTimeout']});const r=await run('{"data":[]}',{timeoutMs:1,blockMs:10});assert(r.error);assert.equal(r.diagnostic.decodeDeadline,'expired');assert.equal(r.dispatches,1);});
test('cancellation stays single dispatch without retry',async()=>{const r=await run('',{timeoutMs:5,stall:true});assert(r.error);assert.equal(r.diagnostic.decodeDeadline,'cancelled');assert.equal(r.dispatches,1);});
test('authority guard failure is distinct from local timeout',async()=>{const r=await run('{"data":[]}',{authorityHeld:true});assert(r.error);assert.equal(r.diagnostic.decodeDeadline,'authority_held');assert.equal(r.dispatches,1);});
test('ordinary transport does not emit additional closed diagnostic fields',async()=>{const r=await run('{"data":[]}',{enabled:false});assert.equal(r.diagnostic.decodeUtf8,undefined);assert.equal(r.diagnostic.requestApiVersion,undefined);assert.deepEqual(r.result,[]);});
test('forged errors and arbitrary events do not acquire diagnostic authority',()=>{assert.equal(diag.storageFailureDiagnostic(Object.assign(Error('x'),{decodeFailure:'json_invalid'})),undefined);const t=diag.createStorageDiagnostic();diag.recordStorageDecodeEvent(t,'private content');const r=diag.storageFailureDiagnostic(diag.storageDiagnosticError(t));assert.equal(r.decodeFailure,undefined);});
