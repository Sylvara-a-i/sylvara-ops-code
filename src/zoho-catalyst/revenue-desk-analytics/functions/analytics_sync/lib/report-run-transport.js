'use strict';
const {Readable}=require('node:stream');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
function held(){throw Object.assign(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'),{code:'REPORT_RUN_RECONCILIATION_REQUIRED'});}
function sdkClient(app){
 const root=path.dirname(require.resolve('zcatalyst-sdk-node/package.json'));
 if(require(path.join(root,'package.json')).version!=='3.4.0')held();
 const {AuthorizedHttpClient}=require(path.join(root,'lib/utils/api-request'));
 return new AuthorizedHttpClient(app);
}
/** Fixed ReportRuns-only transport. RAW SDK bodies suppress implicit retries.
 * Same managed runtime principal; no credential extraction or SDK mutation.
 * Every request owns an actual deadline/cancellation, with bounded response.
 */
function createReportRunTransport({app,timeoutMs=3000,createClient=sdkClient}={}){
 if(typeof app?.authenticateRequest!=='function'||!Number.isSafeInteger(timeoutMs)
  ||timeoutMs<1||timeoutMs>30000||String(process.env.ZC_SECURE||'').toLowerCase()==='override')held();
 async function send(endpoint,data,query,options={}){
 const controller=new AbortController(),signal=controller.signal;
 const expiresAt=performance.now()+timeoutMs;
 const parentAbort=()=>controller.abort();options.signal?.addEventListener('abort',parentAbort,{once:true});
 if(options.signal?.aborted)controller.abort();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 const admit=()=>{if(signal.aborted||performance.now()>=expiresAt)held();options.budget?.assertActive();};
 const guarded=new Proxy(app,{get(target,key){
  if(key==='authenticateRequest')return async request=>{admit();await target.authenticateRequest(request);admit();};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const requests=new Set(),streams=new Set();let failed=false,rejectDeadline;
 const deadline=new Promise((_,reject)=>{rejectDeadline=reject;});deadline.catch(()=>{});
 let client;try{client=createClient(guarded);}catch{clearTimeout(timer);options.signal?.removeEventListener('abort',parentAbort);held();}
 const cancel=()=>{rejectDeadline(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));for(const r of requests)r.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));
  for(const s of streams)s.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));};
 signal.addEventListener('abort',cancel,{once:true});

  let bytes;try{if(failed)held();admit();bytes=Buffer.from(JSON.stringify(data));if(bytes.length>32768)held();}
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
    streams.add(stream);let total=0,chunks=0;const parts=[];
    stream.on('data',chunk=>{if(++chunks>128||(total+=Buffer.byteLength(chunk))>65536){
     rejectBody(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));
     request.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));stream.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));
    }else parts.push(Buffer.from(chunk));});
    stream.once('end',()=>resolveBody(Buffer.concat(parts)));
    stream.once('error',rejectBody);
    stream.once('aborted',()=>rejectBody(new Error('REPORT_RUN_RECONCILIATION_REQUIRED')));
    stream.once('close',()=>streams.delete(stream));
    if(signal.aborted){request.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));stream.destroy();}
   });
   try{admit();}catch{request.destroy(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'));return request;}
   return originalPipe.call(this,request,...args);
  };
  try{
   const response=await Promise.race([deadline,client.send({method:'POST',path:endpoint,data:body,type:'raw',expecting:'raw',
    catalyst:true,track:true,user:'user',headers:{'Content-Type':'application/json','Content-Length':String(bytes.length),
     ...(query?{Accept:'application/vnd.catalyst.v2+zcql'}:{})}})]);
   admit();if(response.statusCode<200||response.statusCode>=300)held();
   if(!response.data||typeof response.data.on!=='function')held();
   const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await responseBody));admit();
   if(!Array.isArray(result?.data))held();return result.data;
  }catch{failed=true;held();}finally{body.destroy();requestStream?.destroy();clearTimeout(timer);
   options.signal?.removeEventListener('abort',parentAbort);signal.removeEventListener('abort',cancel);cancel();}
 }

 const valid=key=>/^revenue-desk-report-v[12]:[a-f0-9]{64}(?::[0-9]{10})?$/.test(key||'');
 return Object.freeze({
  async insert(row,options){
   if(!valid(row?.IdempotencyKey)||row.ReportRunId!==row.IdempotencyKey
    ||!Number.isSafeInteger(row.RD_REPORT_VERSION)||row.RD_REPORT_VERSION<1)held();
   return send('/table/ReportRuns/row',[row],false,options);
  },
  async query(sql,options){
   const exact=/^SELECT \* FROM ReportRuns WHERE IdempotencyKey = '(revenue-desk-report-v[12]:[a-f0-9]{64}(?::[0-9]{10})?)' LIMIT 2$/.exec(sql);
   const head=/^SELECT \* FROM ReportRuns WHERE IdempotencyKey LIKE 'revenue-desk-report-v2:[a-f0-9]{64}:%' ORDER BY RD_REPORT_VERSION DESC LIMIT 2$/.test(sql);
   if(!head&&!valid(exact?.[1]))held();
   return send('/query',{query:sql},true,options);
  }
 });
}
module.exports={createReportRunTransport};
