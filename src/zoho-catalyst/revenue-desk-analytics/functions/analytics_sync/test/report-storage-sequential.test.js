'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture:network}=require('./helpers/report-run-sdk-fixture');
const {canonicalJson}=require('../lib/facts');
const {encodeStorageBinding}=require('../lib/report-storage-binding');
const {createProtectedStorageQualification}=require('../lib/report-storage-qualification');
const {createReportRunTransport}=require('../lib/report-run-transport');
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
 const factory=()=>createProtectedStorageQualification({environment:environment(),now:()=>at,transportFactory:options.transportFactory});
 const command={profile:'report_storage_qualification_v1',action:'qualify_storage'},actor={kind:'internal_controller',identity:config.operatorIdHash};
 return {sdk,binding,config,environment,factory,make:()=>factory()(sdk.app,config),command,actor,advance:n=>at+=n};
}
const held={code:'REPORT_STORAGE_QUALIFICATION_HELD'};
test('first insert decode failure remains closed and attributed after actual slot recovery read',async()=>{
 const f=sequential({storageSchema:true,storageBodyTransform:({path,data})=>JSON.stringify({data:path==='/table/123456788/row'?{privateBodyValue:'never_logged'}:data})});
 try{let failure;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){failure=e;}
  assert.equal(failure.code,held.code);const d=storageFailureDiagnostic(failure);
  assert.equal(d.firstDecodeFailure.operation,'report_insert');assert.equal(d.firstDecodeFailure.decodeFailure,'data_not_array');
  assert.equal(d.firstDecodeFailure.decodeDataType,'object');assert.equal(d.firstDecodeFailure.decodeArrayCardinality,'not_array');
  assert.equal(d.decodeDataType,'array');assert.equal(d.decodeFailure,'none');
  assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);assert.equal(f.sdk.requests.length,5);
  assert.equal(f.sdk.requests.filter(r=>r.path.endsWith('/table/123456788/row')).length,1);
  assert(!JSON.stringify(d).includes('never_logged'));assert(Object.isFrozen(d.firstDecodeFailure));
 }finally{f.sdk.restore();}
});
test('provider insert rejection survives later readback as closed numeric status and fixed code',async()=>{
 const f=sequential();f.sdk.mode='report_invalid_data';try{
  let failure;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){failure=e;}
  assert.equal(failure.code,held.code);const d=storageFailureDiagnostic(failure);
  assert.equal(d.insertHttpStatus,400);assert.equal(d.insertProviderCode,'invalid_data');
  assert.equal(f.sdk.rows.size,0);assert.equal(f.sdk.requests.length,5);
 }finally{f.sdk.restore();}
});
function sequential(options={}){const f=fixture(options);f.binding.schemaVersion=5;return f;}
const booleanFields=['ActualEstimatedSeparated','CrossClientIsolationPassed','DuplicateSendGuardPassed',
 'ReportTotalsReconciled','AutoDeliveryEnabledAtRun'];
// The diagnostic submits false for all five columns. Exercise the decoded ACK
// boundary as well as the wire so objects cannot hide behind JSON coercion.
function ackTransport(transform){return options=>{
 const io=createReportRunTransport(options);
 return {...io,async insert(row,options){const accepted=await io.insert(row,options);transform(accepted[0],row);return accepted;}};
};}
for(const strings of [false,true])test('Boolean ACK preserves payload, acknowledgement and stored row: strings='+strings,async()=>{
 const submitted=[],observed=[];
 const f=sequential({storageSchema:true,providerTransport({path,payload}){
  if(path==='/table/123456788/row')submitted.push(structuredClone(payload[0]));
 },storageBodyTransform({path,data}){
  if(strings&&path==='/table/123456788/row'&&Array.isArray(data)){
   data=structuredClone(data);for(const field of booleanFields)data[0][field]=String(data[0][field]);
  }
  return JSON.stringify({data});
 },transportFactory:ackTransport((ack,row)=>{
  observed.push({ack,row,ackBefore:structuredClone(ack),rowBefore:structuredClone(row)});
  Object.freeze(ack);Object.freeze(row);
 })});
 try{const result=await f.make().handle(f.command,{actor:f.actor});
  assert.equal(result.status,'storage_sequential_duplicate_rejected');assert.equal(f.sdk.requests.length,7);
  assert.equal(result.concurrencyProven,false);assert.equal(result.qualificationAuthority,false);assert.equal(result.deliveryAuthority,false);
  assert.equal(observed.length,1);assert.equal(submitted.length,2);
  const {ack,row,ackBefore,rowBefore}=observed[0],stored=[...f.sdk.rows.values()][0];
  assert.deepEqual(ack,ackBefore);assert.deepEqual(row,rowBefore);assert.deepEqual(row,submitted[0]);
  for(const field of booleanFields){
   assert.equal(ack[field],strings?'false':false);assert.equal(row[field],false);assert.equal(stored[field],false);
   assert.equal(submitted[1][field],false);
  }
  assert.equal(stored.ReportPayloadJson,row.ReportPayloadJson);assert.equal(ack.ReportPayloadJson,row.ReportPayloadJson);
  assert.equal(canonicalJson(JSON.parse(row.ReportPayloadJson)),row.ReportPayloadJson);
  assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
 }finally{f.sdk.restore();}
});
const invalidBooleans=[['opposite Boolean',true],['opposite string','true'],['uppercase','FALSE'],['mixed case','False'],
 ['leading space',' false'],['trailing space','false '],['numeric string','0'],['empty string',''],
 ['zero',0],['one',1],['null',null],['undefined',undefined],['array',[]],['object',{}],['boxed Boolean',new Boolean(false)]];
for(const field of booleanFields)for(const [label,value]of invalidBooleans)test('Boolean ACK rejects '+field+': '+label,async()=>{
 const f=sequential({storageSchema:true,transportFactory:ackTransport(ack=>{ack[field]=value;})});
 try{const handler=f.make();let failure;try{await handler.handle(f.command,{actor:f.actor});}catch(error){failure=error;}
  assert.equal(failure?.code,held.code);assert.equal(storageFailureDiagnostic(failure).firstValidationFailure.location,'report_ack');
  assert.equal(f.sdk.requests.length,4);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
  await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);assert.equal(f.sdk.requests.length,4);
 }finally{f.sdk.restore();}
});
test('Boolean ACK comparison never invokes object coercion',async()=>{
 let calls=0;const value={[Symbol.toPrimitive](){calls++;throw Error('coercion forbidden');}};
 const f=sequential({storageSchema:true,transportFactory:ackTransport(ack=>{ack.ActualEstimatedSeparated=value;})});
 try{await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);
  assert.equal(calls,0);assert.equal(f.sdk.requests.length,4);
 }finally{f.sdk.restore();}
});
for(const field of booleanFields)test('lowercase Boolean ACK does not relax independent readback: '+field,async()=>{
 const f=sequential({storageSchema:true,storageBodyTransform({path,data}){
  data=structuredClone(data);
  if(path==='/table/123456788/row'&&Array.isArray(data))for(const name of booleanFields)data[0][name]=String(data[0][name]);
  if(path==='/query'&&Array.isArray(data))for(const item of data)if(item.ReportRuns)item.ReportRuns[field]='false';
  return JSON.stringify({data});
 }});
 try{const handler=f.make();let failure;try{await handler.handle(f.command,{actor:f.actor});}catch(error){failure=error;}
  assert.equal(failure?.code,held.code);
  assert.deepEqual(storageFailureDiagnostic(failure).firstValidationFailure,{location:'report_row',reason:'readback_mismatch'});
  assert.equal(f.sdk.requests.length,5);assert.equal(f.sdk.requests.filter(r=>r.path.endsWith('/table/123456788/row')).length,1);
  await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);assert.equal(f.sdk.requests.length,5);
 }finally{f.sdk.restore();}
});
test('protected sequential diagnostic rejects duplicate in seven dispatches without concurrency authority',async()=>{
 const f=sequential({storageSchema:true});try{const result=await f.make().handle(f.command,{actor:f.actor});
  assert.equal(result.status,'storage_sequential_duplicate_rejected');assert.equal(result.concurrencyProven,false);
  assert.equal(result.qualificationAuthority,false);assert.equal(result.deliveryAuthority,false);
  assert.equal(result.secondInsertHttpStatus,409);assert.equal(result.secondInsertProviderCode,'duplicate_value');
  assert.equal(f.sdk.requests.length,7);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
  assert.equal(f.sdk.requests.filter(r=>r.path.endsWith('/table/123456788/row')).length,2);
  assert.equal(result.reads,3);assert.equal(result.inserts,2);
 }finally{f.sdk.restore();}
});
test('persisted duplicate unique keys hold and retain both rows; no successor or replay',async()=>{
 const f=sequential();f.sdk.mode='uniqueness_broken';try{const handler=f.make();
  await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.rows.size,2);assert.equal(f.sdk.requests.length,7);
  assert.ok([...f.sdk.rows.values()].every(r=>r.RD_REPORT_VERSION===1));
  await assert.rejects(handler.handle(f.command,{actor:f.actor}),held);assert.equal(f.sdk.requests.length,7);
 }finally{f.sdk.restore();}
});
test('sequential readback remains explicitly unattested and cannot imply concurrency acceptance',async()=>{
 const f=sequential({storageSchema:true});try{const handler=f.make();await handler.handle(f.command,{actor:f.actor});
  const result=await handler.handle({...f.command,action:'read_storage_evidence'},{actor:f.actor});
  assert.equal(result.status,'storage_evidence_unattested');assert.equal(result.mechanism,'sequential_unique_diagnostic_v1');
  assert.equal(result.concurrencyProven,false);assert.equal(result.headVersion,1);assert.equal(result.inserts,0);
  assert.equal(result.qualificationAuthority,false);assert.equal(result.deliveryAuthority,false);assert.equal(f.sdk.rows.size,1);
 }finally{f.sdk.restore();}
});
test('lost first insert acknowledgement holds before second contender despite retained row',async()=>{
 const f=sequential();f.sdk.mode='lost_insert';try{
  await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);
  assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.requests.length,5);
  assert.equal(f.sdk.requests.filter(r=>r.path.endsWith('/table/123456788/row')).length,1);
 }finally{f.sdk.restore();}
});
test('schema5 tuple binding preserves mode and short window; caller cannot select a different probe',async()=>{
 const f=sequential({multipart:400,compact:true});try{
  const decoded=require('../lib/report-storage-binding').decodeStorageBinding(f.environment());assert.equal(JSON.parse(decoded).schemaVersion,5);
  await assert.rejects(f.make().handle({...f.command,probeMode:'concurrent'},{actor:f.actor}),held);assert.equal(f.sdk.requests.length,0);
  f.binding.expiresAt=f.binding.verifiedAt+900001;assert.throws(()=>f.make(),held);
 }finally{f.sdk.restore();}
});
test('sequential diagnostic never retries ambiguous admission or authorizes a cold repeat',async()=>{
 const f=sequential();f.sdk.mode='admission_lost';try{
  await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);assert.equal(f.sdk.rows.size,0);
  assert.equal(f.sdk.requests.length,1);f.sdk.mode='normal';
  await assert.rejects(f.make().handle(f.command,{actor:f.actor}),held);assert.equal(f.sdk.rows.size,0);
 }finally{f.sdk.restore();}
});

test('closed report acknowledgement diagnostic: missing column',async()=>{
 const f=sequential({storageSchema:true,storageBodyTransform:({path,data})=>{
  if(path==='/table/123456788/row'){data=structuredClone(data);const row=data[0];delete row.ReportType;}
  return JSON.stringify({status:'success',data});
 }});try{let failure;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){failure=e;}
  assert.equal(failure?.code,held.code);const d=storageFailureDiagnostic(failure);
  assert.deepEqual(d.firstValidationFailure,{location:'report_ack',reason:'projection_missing'});
  assert(Object.isFrozen(d.firstValidationFailure));assert(!JSON.stringify(d).includes('never_logged'));
  assert.equal(f.sdk.requests.length,4);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
  assert.equal(d.decodeFailure,'none');assert.equal(d.decodeDataType,'array');
 }finally{f.sdk.restore();}
});
test('closed report acknowledgement diagnostic: unexpected private column',async()=>{
 const f=sequential({storageSchema:true,storageBodyTransform:({path,data})=>{
  if(path==='/table/123456788/row'){data=structuredClone(data);const row=data[0];row.privateExtra='never_logged';}
  return JSON.stringify({status:'success',data});
 }});try{let failure;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){failure=e;}
  assert.equal(failure?.code,held.code);const d=storageFailureDiagnostic(failure);
  assert.deepEqual(d.firstValidationFailure,{location:'report_ack',reason:'projection_extra'});
  assert(Object.isFrozen(d.firstValidationFailure));assert(!JSON.stringify(d).includes('never_logged'));
  assert.equal(f.sdk.requests.length,4);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
  assert.equal(d.decodeFailure,'none');assert.equal(d.decodeDataType,'array');
 }finally{f.sdk.restore();}
});
test('closed report acknowledgement diagnostic: invalid row id',async()=>{
 const f=sequential({storageSchema:true,storageBodyTransform:({path,data})=>{
  if(path==='/table/123456788/row'){data=structuredClone(data);const row=data[0];row.ROWID='never_logged';}
  return JSON.stringify({status:'success',data});
 }});try{let failure;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){failure=e;}
  assert.equal(failure?.code,held.code);const d=storageFailureDiagnostic(failure);
  assert.deepEqual(d.firstValidationFailure,{location:'report_ack',reason:'row_id'});
  assert(Object.isFrozen(d.firstValidationFailure));assert(!JSON.stringify(d).includes('never_logged'));
  assert.equal(f.sdk.requests.length,4);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
  assert.equal(d.decodeFailure,'none');assert.equal(d.decodeDataType,'array');
 }finally{f.sdk.restore();}
});
test('closed report acknowledgement diagnostic: invalid creator id',async()=>{
 const f=sequential({storageSchema:true,storageBodyTransform:({path,data})=>{
  if(path==='/table/123456788/row'){data=structuredClone(data);const row=data[0];row.CREATORID='never_logged';}
  return JSON.stringify({status:'success',data});
 }});try{let failure;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){failure=e;}
  assert.equal(failure?.code,held.code);const d=storageFailureDiagnostic(failure);
  assert.deepEqual(d.firstValidationFailure,{location:'report_ack',reason:'creator_id'});
  assert(Object.isFrozen(d.firstValidationFailure));assert(!JSON.stringify(d).includes('never_logged'));
  assert.equal(f.sdk.requests.length,4);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
  assert.equal(d.decodeFailure,'none');assert.equal(d.decodeDataType,'array');
 }finally{f.sdk.restore();}
});
test('closed report acknowledgement diagnostic: different creator',async()=>{
 const f=sequential({storageSchema:true,storageBodyTransform:({path,data})=>{
  if(path==='/table/123456788/row'){data=structuredClone(data);const row=data[0];row.CREATORID='999999999';}
  return JSON.stringify({status:'success',data});
 }});try{let failure;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){failure=e;}
  assert.equal(failure?.code,held.code);const d=storageFailureDiagnostic(failure);
  assert.deepEqual(d.firstValidationFailure,{location:'report_ack',reason:'creator_mismatch'});
  assert(Object.isFrozen(d.firstValidationFailure));assert(!JSON.stringify(d).includes('never_logged'));
  assert.equal(f.sdk.requests.length,4);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
  assert.equal(d.decodeFailure,'none');assert.equal(d.decodeDataType,'array');
 }finally{f.sdk.restore();}
});
test('closed report acknowledgement diagnostic: uppercase boolean',async()=>{
 const f=sequential({storageSchema:true,storageBodyTransform:({path,data})=>{
  if(path==='/table/123456788/row'){data=structuredClone(data);const row=data[0];row.ActualEstimatedSeparated=String(row.ActualEstimatedSeparated).toUpperCase();}
  return JSON.stringify({status:'success',data});
 }});try{let failure;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){failure=e;}
  assert.equal(failure?.code,held.code);const d=storageFailureDiagnostic(failure);
  assert.deepEqual(d.firstValidationFailure,{location:'report_ack',reason:'field_boolean_type'});
  assert(Object.isFrozen(d.firstValidationFailure));assert(!JSON.stringify(d).includes('never_logged'));
  assert.equal(f.sdk.requests.length,4);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
  assert.equal(d.decodeFailure,'none');assert.equal(d.decodeDataType,'array');
 }finally{f.sdk.restore();}
});
test('canonical INT version ACK accepts exact decimal strings with numeric readback',async()=>{
 const f=sequential({storageSchema:true,storageBodyTransform:({path,data})=>{
  if(path==='/table/123456788/row'&&Array.isArray(data)){data=structuredClone(data);const row=data[0];row.RD_REPORT_VERSION=String(row.RD_REPORT_VERSION);row.SchemaVersion=String(row.SchemaVersion);}
  return JSON.stringify({status:Array.isArray(data)?'success':'error',data});
 }});try{let failure;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){failure=e;}
  assert.equal(failure,undefined);
  assert.equal(f.sdk.requests.length,7);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
 }finally{f.sdk.restore();}
});
test('closed report acknowledgement diagnostic: changed text',async()=>{
 const f=sequential({storageSchema:true,storageBodyTransform:({path,data})=>{
  if(path==='/table/123456788/row'){data=structuredClone(data);const row=data[0];row.ReportType='never_logged';}
  return JSON.stringify({status:'success',data});
 }});try{let failure;try{await f.make().handle(f.command,{actor:f.actor});}catch(e){failure=e;}
  assert.equal(failure?.code,held.code);const d=storageFailureDiagnostic(failure);
  assert.deepEqual(d.firstValidationFailure,{location:'report_ack',reason:'field_value'});
  assert(Object.isFrozen(d.firstValidationFailure));assert(!JSON.stringify(d).includes('never_logged'));
  assert.equal(f.sdk.requests.length,4);assert.equal(f.sdk.rows.size,1);assert.equal(f.sdk.receipts.size,1);
  assert.equal(d.decodeFailure,'none');assert.equal(d.decodeDataType,'array');
 }finally{f.sdk.restore();}
});
