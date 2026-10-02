'use strict';
const {Readable}=require('node:stream');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
// Structural observations contain only closed types/presence flags, never provider values.
const structureType=value=>value===undefined?'absent':value===null?'null':Array.isArray(value)?'array':typeof value;
const has=(value,key)=>value!==null&&typeof value==='object'&&Object.hasOwn(value,key);
function principalStructure(root){
 const out={};
 const describe=(value,prefix)=>{out[prefix+'_type']=structureType(value);
  for(const key of ['user_id','role_details','status'])out[prefix+'_has_'+key]=has(value,key);};
 const status=value=>!has(value,'status')?'absent':value.status==='success'?'success':value.status==='error'?'error':'other';
 const describeEnvelope=(value,prefix='')=>{
  const data=has(value,'data')?value.data:undefined;
  const array=Array.isArray(data)?data:Array.isArray(value)?value:undefined;
  const singleton=array?.length===1?array[0]:undefined;
  describe(value,prefix+'root');describe(data,prefix+'data');describe(singleton,prefix+'singleton');
  out[prefix+'root_status']=status(value);
  out[prefix+'array_location']=Array.isArray(data)?'data':Array.isArray(value)?'root':'none';
  out[prefix+'array_bucket']=!array?'not_array':array.length===0?'zero':array.length===1?'one':'multiple';
  return {data,singleton};
 };
 const {data,singleton}=describeEnvelope(root);describeEnvelope(undefined,'decoded_');
 out.decoded_location='none';out.decoded_parse='not_attempted';
 const candidate=typeof root==='string'?{location:'root',value:root}:typeof data==='string'?{location:'data',value:data}
  :typeof singleton==='string'?{location:'singleton',value:singleton}:null;
 if(candidate){out.decoded_location=candidate.location;
  if(Buffer.byteLength(candidate.value)>65536)out.decoded_parse='held';
  else try{describeEnvelope(JSON.parse(candidate.value),'decoded_');out.decoded_parse='parsed';}catch{out.decoded_parse='invalid';}}
 return Object.freeze(out);
}
function held(){throw Object.assign(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'),{code:'REPORT_RUN_RECONCILIATION_REQUIRED'});}
function sdkClient(app){
 const root=path.dirname(require.resolve('zcatalyst-sdk-node/package.json'));
 if(require(path.join(root,'package.json')).version!=='3.4.0')held();
 const {AuthorizedHttpClient}=require(path.join(root,'lib/utils/api-request'));
 return new AuthorizedHttpClient(app);
}
/** Fixed ReportRuns and diagnostic admission-receipt transport. RAW SDK bodies suppress implicit retries.
 * Same managed runtime principal; no credential extraction or SDK mutation.
 * Every request owns an actual deadline/cancellation, with bounded response.
 */
function createReportRunTransport({app,timeoutMs=3000,createClient=sdkClient,storageCapability=null,storageOperationKey=null,storageAssertActive=null,storageSourceRevision=null,storageBindingSha256=null}={}){
 if(typeof app?.authenticateRequest!=='function'||!Number.isSafeInteger(timeoutMs)
  ||timeoutMs<1||timeoutMs>30000||String(process.env.ZC_SECURE||'').toLowerCase()==='override')held();
 if(storageCapability){require('./report-storage-capability').assertIssuedCapability(storageCapability);if(!/^[a-f0-9]{64}$/.test(storageOperationKey||'')||typeof storageAssertActive!=='function'||!/^[a-f0-9]{40}$/.test(storageSourceRevision||'')||!/^[a-f0-9]{64}$/.test(storageBindingSha256||''))held();}
 const target=role=>storageCapability?storageCapability.tables[role].id:role==='reportRuns'?'ReportRuns':'RevenueDeskEventReceipts';
 async function send(endpoint,data,query,options={},method='POST'){
 const controller=new AbortController(),signal=controller.signal;
 const expiresAt=performance.now()+timeoutMs;
 const parentAbort=()=>controller.abort();options.signal?.addEventListener('abort',parentAbort,{once:true});
 if(options.signal?.aborted)controller.abort();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 const admit=()=>{if(signal.aborted||performance.now()>=expiresAt)held();storageAssertActive?.();options.budget?.assertActive();};
 const guarded=new Proxy(app,{get(target,key){
  if(key==='authenticateRequest')return async request=>{admit();if(storageCapability&&(request.user!=='user'||target.credential?.getCurrentUser?.()!=='user'||target.credential?.getCurrentUserType?.()!=='admin'))held();
   await target.authenticateRequest(request);admit();
   if(storageCapability&&(target.credential.getCurrentUser()!=='user'||target.credential.getCurrentUserType()!=='admin'))held();};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const requests=new Set(),streams=new Set();let failed=false,rejectDeadline;
 const deadline=new Promise((_,reject)=>{rejectDeadline=reject;});deadline.catch(()=>{});
 const trace=event=>{if(typeof options.trace==='function')options.trace(Object.freeze({...event,at:performance.now()}));};
 let responseStatus,principalFailureClass,responseSettled=false,responseStream;
 const principalTrace=event=>{if(endpoint==='/project-user/current'&&!signal.aborted&&!responseSettled)trace(event);};
 // Fixed classifications only; never pass response data or errors into trace.
 const principalFailure=kind=>{if(endpoint!=='/project-user/current'||signal.aborted||responseSettled||principalFailureClass)return;
  principalFailureClass=kind;trace({event:'principal_failure',failureClass:kind});};
 let client;try{client=createClient(guarded);}catch{clearTimeout(timer);options.signal?.removeEventListener('abort',parentAbort);held();}
 const cancel=()=>{rejectDeadline(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));for(const r of requests)r.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));
  for(const s of streams)s.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));};
 signal.addEventListener('abort',cancel,{once:true});

  let bytes;try{if(failed)held();admit();bytes=method==='GET'?Buffer.alloc(0):Buffer.from(JSON.stringify(data));if(bytes.length>32768)held();}
  catch{clearTimeout(timer);options.signal?.removeEventListener('abort',parentAbort);signal.removeEventListener('abort',cancel);cancel();held();}
  const body=Readable.from([bytes]);let requestStream,resolveBody,rejectBody;
  const responseBody=new Promise((resolve,reject)=>{resolveBody=resolve;rejectBody=reject;});
  responseBody.catch(()=>{}); // SDK can reject before a response is available.
  const originalPipe=body.pipe;
  body.pipe=function(request,...args){
   requestStream=request;requests.add(request);
   request.once('close',()=>requests.delete(request));
   // Applies to error responses too, which SDK 3.4.0 otherwise buffers itself.
   request.once('response',stream=>{
    responseStatus=stream.statusCode;trace({event:'response',operation:endpoint.endsWith('/row')?'insert':'read',status:responseStatus});
    responseStream=stream;streams.add(stream);let total=0,chunks=0,ended=false;const parts=[];
    stream.on('data',chunk=>{if(++chunks>128||(total+=Buffer.byteLength(chunk))>65536){
     principalFailure('size');rejectBody(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));
     request.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));stream.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));
    }else parts.push(Buffer.from(chunk));});
    stream.once('end',()=>{ended=true;principalTrace({event:'principal_body',complete:true});resolveBody(Buffer.concat(parts));});
    stream.once('error',()=>{principalFailure('stream');rejectBody(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));});
    stream.once('aborted',()=>{principalFailure('stream');rejectBody(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));});
    stream.once('close',()=>{streams.delete(stream);if(!ended&&!signal.aborted&&!responseSettled){principalFailure('stream');rejectBody(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));}});
    if(signal.aborted){request.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));stream.destroy();}
   });
   try{admit();trace({event:'dispatch',operation:endpoint.endsWith('/row')?'insert':'read'});
    principalTrace({event:'principal_request',getExact:method==='GET',pathExact:endpoint==='/project-user/current'});}catch{request.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));return request;}
   return originalPipe.call(this,request,...args);
  };
  try{
   const response=await Promise.race([deadline,client.send({method,path:endpoint,data:body,type:'raw',expecting:'raw',
    catalyst:true,track:true,user:'user',headers:{'Content-Type':'application/json','Content-Length':String(bytes.length),
     ...(query?{Accept:'application/vnd.catalyst.v2+zcql'}:{})}})]);
   admit();if(response.statusCode<200||response.statusCode>=300)held();
   try{const raw=response.data;principalTrace({event:'principal_raw',same:raw===responseStream});
    if(!raw||typeof raw.on!=='function')held();}catch{principalFailure('stream');held();}
   const received=await responseBody;let text,result;
   try{text=new TextDecoder('utf-8',{fatal:true}).decode(received);}catch{principalFailure('utf8');held();}
   try{result=JSON.parse(text);}catch{principalFailure('json');held();}admit();
   if(endpoint==='/project-user/current'){
    principalTrace({event:'principal_structure',structure:principalStructure(result)});
    const p=result?.data;if(!p||Array.isArray(p)||typeof p!=='object'){principalFailure('envelope');held();}
    return Object.freeze({userId:String(p.user_id||''),roleId:String(p.role_details?.role_id||''),roleName:p.role_details?.role_name,status:p.status});
   }
   if(!Array.isArray(result?.data))held();trace({event:'outcome',operation:endpoint.endsWith('/row')?'insert':'read',accepted:true,duplicate:false});return result.data;
  }catch{failed=true;
   // Diagnostic observes only a documented duplicate code, never provider text.
   if(typeof options.trace==='function'&&responseStatus!==undefined){try{
    const raw=await Promise.race([responseBody,deadline]);
    const error=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    trace({event:'outcome',operation:endpoint.endsWith('/row')?'insert':'read',accepted:false,
     duplicate:responseStatus===409&&error?.data?.error_code==='DUPLICATE_VALUE'});
   }catch{}}
   held();}finally{responseSettled=true;body.destroy();requestStream?.destroy();clearTimeout(timer);
   options.signal?.removeEventListener('abort',parentAbort);signal.removeEventListener('abort',cancel);cancel();}
 }

 const namespace=key=>!storageCapability||key===`revenue-desk-report-v1:${storageOperationKey}`||new RegExp(`^revenue-desk-report-v2:${storageOperationKey}:[0-9]{10}$`).test(key);
 const valid=key=>namespace(key)&&/^revenue-desk-report-v[12]:[a-f0-9]{64}(?::[0-9]{10})?$/.test(key||'');
 return Object.freeze({
  async insertAdmission(row,options){
   if(storageCapability&&row?.EVENT_KEY!==`report-storage:${storageOperationKey}`)held();
   const fields=['EVENT_KEY','RECEIPT_KIND','STATUS','EVENT_TYPE','EVENT_DATA_JSON','PAYLOAD_FINGERPRINT',
    'RECEIPT_VERSION','SOURCE_REVISION','SOURCE_ENVIRONMENT','RECEIVED_AT','PROCESSED_AT'];
   if(!row||Object.keys(row).sort().join(',')!==fields.sort().join(',')||row.EVENT_TYPE!=='storage_qualification'
    ||row.SOURCE_ENVIRONMENT!=='development'||!/^([a-f0-9]{64})$/.test(row.PAYLOAD_FINGERPRINT||'')
    ||![row.RECEIVED_AT,row.PROCESSED_AT].every(x=>typeof x==='string'&&Number.isFinite(Date.parse(x)))
    ||!/^report-storage:[a-f0-9]{64}$/.test(row?.EVENT_KEY||'')||row.RECEIPT_KIND!=='report_storage_admission'
    ||row.STATUS!=='Completed'||row.RECEIPT_VERSION!==1||!/^([a-f0-9]{40})$/.test(row.SOURCE_REVISION||'')
    ||typeof row.EVENT_DATA_JSON!=='string'||Buffer.byteLength(row.EVENT_DATA_JSON)>2048)held();
   if(storageCapability){
    const {canonicalJson}=require('./facts'),crypto=require('node:crypto');let payload;try{payload=JSON.parse(row.EVENT_DATA_JSON);}catch{held();}
    const expected={kind:'report_storage_admission_v1',operationDigest:storageOperationKey,owner:payload?.owner,sourceRevision:storageSourceRevision,
     capabilitySha256:crypto.createHash('sha256').update(canonicalJson(storageCapability)).digest('hex'),bindingSha256:storageBindingSha256};
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload?.owner||'')
     ||row.SOURCE_REVISION!==storageSourceRevision||canonicalJson(expected)!==row.EVENT_DATA_JSON
     ||crypto.createHash('sha256').update(row.EVENT_DATA_JSON).digest('hex')!==row.PAYLOAD_FINGERPRINT)held();
   }
   return send(`/table/${target('eventReceipts')}/row`,[row],false,options);
  },
  async readAdmission(key,options){
   if(storageCapability&&key!==`report-storage:${storageOperationKey}`)held();
   if(!/^report-storage:[a-f0-9]{64}$/.test(key||''))held();
   return send('/query',{query:`SELECT * FROM RevenueDeskEventReceipts WHERE EVENT_KEY = '${key}' LIMIT 2`},true,options);
  },
  // Fixed read-only SDK-documented principal endpoint, same managed user path.
  async currentPrincipal(options){if(storageCapability)held();return send('/project-user/current',null,false,options,'GET');},
  async insert(row,options){
   if(storageCapability)require('./report-storage-capability').validateReportInsert(row);
   if(!valid(row?.IdempotencyKey)||row.ReportRunId!==row.IdempotencyKey
    ||!Number.isSafeInteger(row.RD_REPORT_VERSION)||row.RD_REPORT_VERSION<1)held();
   return send(`/table/${target('reportRuns')}/row`,[row],false,options);
  },
  async query(sql,options){
   const exact=/^SELECT \* FROM ReportRuns WHERE IdempotencyKey = '(revenue-desk-report-v[12]:[a-f0-9]{64}(?::[0-9]{10})?)' LIMIT 2$/.exec(sql);
   const head=/^SELECT \* FROM ReportRuns WHERE IdempotencyKey LIKE 'revenue-desk-report-v2:[a-f0-9]{64}:%' ORDER BY RD_REPORT_VERSION DESC LIMIT 2$/.test(sql);
   if(!head&&!valid(exact?.[1]))held();
   if(storageCapability&&head&&!sql.includes(`LIKE 'revenue-desk-report-v2:${storageOperationKey}:%'`))held();
   return send('/query',{query:sql},true,options);
  }
 });
}
module.exports={createReportRunTransport};
