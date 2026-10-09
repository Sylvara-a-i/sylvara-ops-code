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
const {createReportSuccessorStore}=require('../lib/report-successor-store');
const {reportRunProjection}=require('../lib/report-run-store');
for(const schemaForm of ['2','02','2e0','2.0',' 2']){
 test('compatibility: successor decoder numeric coercion for schema form '+JSON.stringify(schemaForm),async()=>{
  const key='c'.repeat(64),identity={clientId:'synthetic',deploymentId:'synthetic',periodStart:'1970-01-01',periodEnd:'1970-01-01'};
  const state={kind:'report_attempt_v1',identity,phase:'working',owner:'synthetic',failures:0,nextAttemptAt:0,lastGenerationKey:null};
  const envelope={storageRevision:'unique_insert_successor_v1',key,version:1,owner:'d'.repeat(32),predecessor:null,rootDigest:null,state};
  const rootKey='revenue-desk-report-v1:'+key;
  const row={...reportRunProjection(state),IdempotencyKey:rootKey,ReportRunId:rootKey,ReportPayloadJson:canonicalJson(envelope),RD_REPORT_VERSION:'1',SchemaVersion:schemaForm,ROWID:'12345',CREATORID:'98765'};
  let reads=0;const store=createReportSuccessorStore({app:{},environment:'development',transport:{
   query:async()=>{reads++;return reads===1?[{ReportRuns:row}]:[];},insert:async()=>{throw Error('no insertion allowed');}
  }});
  const found=await store.get(key);assert.equal(found.version,1);assert.equal(reads,2);
  assert.equal(matchesStoredReportField('SchemaVersion',2,schemaForm),schemaForm==='2');
 });
}
const {matchesStoredReportField}=require('../lib/report-storage-capability');
function sequential(options={}){const f=fixture(options);f.binding.schemaVersion=5;return f;}
const malformed=[
 ['empty',''],['space',' '],['leading space',' 1'],['trailing space','1 '],['newline','1\n'],['tab','\t1'],
 ['plus','+1'],['minus','-1'],['leading zero','01'],['multiple zero','001'],['exponent','1e0'],
 ['uppercase exponent','1E0'],['decimal','1.0'],['fraction text','1.5'],['hex','0x1'],['unicode digit','１'],
 ['zero text','0'],['negative zero text','-0'],['other text','3'],['overflow text','2147483648'],
 ['unsafe text',String(2 ** 53)],['true',true],['false',false],['null',null],['undefined',undefined],
 ['array',[]],['object',{}],['bigint',1n],['zero',0],['negative zero',-0],['negative',-1],
 ['fraction',1.5],['wrong integer',3],['overflow',2147483648],['unsafe',2 ** 53],
 ['NaN',NaN],['Infinity',Infinity],['negative Infinity',-Infinity]
];
for(const field of ['SchemaVersion','RD_REPORT_VERSION']){
 test('canonical INT accepts exact number/string only: '+field,()=>{
  for(const expected of [1,2,2147483647]){
   assert.equal(matchesStoredReportField(field,expected,expected),true);
   assert.equal(matchesStoredReportField(field,expected,String(expected)),true);
  }
  let calls=0;const untrusted={toString(){calls++;throw Error('never_coerce');}};
  assert.equal(matchesStoredReportField(field,1,untrusted),false);assert.equal(calls,0);
 });
 for(const [label,value]of malformed)test('canonical INT rejects '+field+': '+label,()=>{
  assert.equal(matchesStoredReportField(field,1,value),false);
  assert.equal(matchesStoredReportField(field,2,value),false);
 });
 test('canonical INT rejects malformed expected values: '+field,()=>{
  for(const [,value]of malformed)if(!Number.isSafeInteger(value)||value<1||value>2147483647)assert.equal(matchesStoredReportField(field,value,value),false);
 });
}
test('non-version fields retain strict value/type equality',()=>{
 for(const field of ['ClientId','ReportPayloadJson','ActualEstimatedSeparated','ROWID','SchemaVersion ','RECEIPT_VERSION']){
  assert.equal(matchesStoredReportField(field,1,'1'),false);
  assert.equal(matchesStoredReportField(field,false,'false'),false);
  assert.equal(matchesStoredReportField(field,null,'null'),false);
  assert.equal(matchesStoredReportField(field,'same','same'),true);
 }
});
for(const [ackString,readString]of [[false,false],[true,true],[true,false],[false,true]]){
 test('full synthetic qualification mixed INT forms ack='+ackString+' read='+readString,async()=>{
  const f=sequential({storageSchema:true,storageResponseTransform({path,data}){
   if(!Array.isArray(data))return;
   for(const item of data){const row=item.ReportRuns||item;
    if(!Object.hasOwn(row,'RD_REPORT_VERSION'))continue;
    const asString=path==='/table/123456788/row'?ackString:readString;
    for(const field of ['SchemaVersion','RD_REPORT_VERSION'])row[field]=asString?String(Number(row[field])):Number(row[field]);
   }
  }});f.sdk.mode='admission_representation';
  try{const result=await f.make().handle(f.command,{actor:f.actor});
   assert.equal(result.status,'storage_sequential_duplicate_rejected');assert.equal(result.concurrencyProven,false);
   assert.equal(result.qualificationAuthority,false);assert.equal(result.deliveryAuthority,false);
   assert.equal(f.sdk.requests.length,7);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
   const stored=[...f.sdk.rows.values()][0],envelope=JSON.parse(stored.ReportPayloadJson);
   assert.equal(canonicalJson(envelope),stored.ReportPayloadJson);
   assert.equal(envelope.version,1);assert.equal(typeof envelope.version,'number');
   assert.equal(envelope.state.diagnostic.sourceRevision,f.binding.sourceRevision);
  }finally{f.sdk.restore();}
 });
}
const badWire=malformed.filter(([,v])=>typeof v==='string'||typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'||v===null);
for(const field of ['SchemaVersion','RD_REPORT_VERSION'])for(const [label,value]of badWire){
 test('full synthetic ACK remains held '+field+': '+label,async()=>{
  const f=sequential({storageSchema:true,storageResponseTransform({path,data}){
   if(path==='/table/123456788/row'&&Array.isArray(data))data[0][field]=value;
  }});try{const handler=f.make();await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
   assert.equal(f.sdk.requests.length,4);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
   await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);assert.equal(f.sdk.requests.length,4);
  }finally{f.sdk.restore();}
 });
}
test('canonical readback must retain exact expected version before duplicate contender',async()=>{
 const f=sequential({storageSchema:true,storageResponseTransform({path,data}){
  if(path==='/query'&&Array.isArray(data))for(const entry of data)if(entry.ReportRuns)entry.ReportRuns.RD_REPORT_VERSION='2';
 }});try{let failure;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){failure=e;}
  assert.equal(failure?.code,held.code);assert.deepEqual(storageFailureDiagnostic(failure).firstValidationFailure,{location:'report_row',reason:'readback_mismatch'});
  assert.equal(f.sdk.requests.length,5);assert.equal(f.sdk.requests.filter(r=>r.path.endsWith('/table/123456788/row')).length,1);
 }finally{f.sdk.restore();}
});
test('non-version boolean representation remains held',async()=>{
 const f=sequential({storageSchema:true,storageResponseTransform({path,data}){
  if(path==='/table/123456788/row'&&Array.isArray(data))data[0].ActualEstimatedSeparated='false';
 }});try{await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);assert.equal(f.sdk.requests.length,4);}
 finally{f.sdk.restore();}
});
