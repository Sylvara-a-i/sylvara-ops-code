'use strict';
// Successor qualification only. No SDK HTTP client, redirect, retry, generic SQL,
// caller-provided client, or credential refresh path is admitted here.
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {types}=require('node:util');
const crypto=require('node:crypto');
const {initializePhysicalDiagnostic,recordPhysicalFailure,recordPhysicalConstructor,recordPhysicalDrain,guardPhysicalDiagnostic}=require('./report-storage-diagnostic');
const {assertHttpsBootstrap}=require('./report-https-bootstrap');
const request=assertHttpsBootstrap();
const {isNonEmptyString}=require(path.join(path.dirname(require.resolve('zcatalyst-sdk-node/package.json')),'lib/utils/validator'));
const SDK=path.dirname(require.resolve('zcatalyst-sdk-node/package.json'));
const {CatalystApp}=require(path.join(SDK,'lib/catalyst-app'));
const {CatalystCredential,AccessTokenCredential}=require(path.join(SDK,'lib/utils/credential'));
const constants=require(path.join(SDK,'lib/utils/constants')).default;
assertHttpsBootstrap();
const AppBase=Object.getPrototypeOf(CatalystApp.prototype);
const auth=AppBase.authenticateRequest,oauth=AppBase.setOauthHeader;
const token=CatalystCredential.prototype.getToken,access=AccessTokenCredential.prototype.getToken;
const user=CatalystCredential.prototype.getCurrentUser,userType=CatalystCredential.prototype.getCurrentUserType;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const SDK_METHOD_PINS=Object.freeze([
 [auth,'3024e4522af77e93cca9bbf4e3e89ee8bbcd6ad5a2492d66ac5687f21e206f76'],
 [oauth,'5cb1b5926972d46a3ca2f992adedfb4eb18bbedde4659641df3f334636238e10'],
 [token,'43b967dc19d39a118d92395c37aefd93b25cfff08dafde61bb68d6be6f18a3a3'],
 [access,'e3ec140c3facea110a294ba4a69b693cf537932d1e29f710d6eb9c3bc2288200'],
 [user,'3cae4b4e61f75c9193b6203baa10da2bb259917c9cf849b1f2cd52bd4651efce'],
 [userType,'2912f040723c77e20393abdc873f139dd71d473d93fa18bc1609e45fe19f283f']]);
const CODE='REPORT_RUN_RECONCILIATION_REQUIRED';
function error(){return Object.assign(new Error(CODE),{code:CODE,ambiguous:true});}
function fail(){throw error();}
function data(object,key){if(!object||types.isProxy(object))fail();const d=Object.getOwnPropertyDescriptor(object,key);if(!d||!Object.hasOwn(d,'value'))fail();return d.value;}
function method(object,key,expected){
 if(types.isProxy(object)||Object.hasOwn(object,key))fail();
 let owner=Object.getPrototypeOf(object),d;
 while(owner){if(types.isProxy(owner))fail();d=Object.getOwnPropertyDescriptor(owner,key);if(d)break;owner=Object.getPrototypeOf(owner);}
 if(!d||!Object.hasOwn(d,'value')||d.value!==expected)fail();
}
function managed(app){
 if(!app||types.isProxy(app)||Object.getPrototypeOf(app)!==CatalystApp.prototype)fail();
 method(app,'authenticateRequest',auth);method(app,'setOauthHeader',oauth);
 const c=data(app,'credential');
 if(types.isProxy(c)||Object.getPrototypeOf(c)!==CatalystCredential.prototype)fail();
 method(c,'getToken',token);method(c,'getCurrentUser',user);method(c,'getCurrentUserType',userType);
 if(data(c,'currentUser')!=='user'||data(c,'userType')!=='admin'||data(c,'strictScope')!==false)fail();
 const u=data(c,'userCred');if(types.isProxy(u)||Object.getPrototypeOf(u)!==AccessTokenCredential.prototype)fail();
 method(u,'getToken',access);
 // Inspect descriptor/type/nonemptiness only. SDK alone formats the opaque token;
 // it never enters a trace, diagnostic, returned value, pin, or persisted record.
 const tokenField=Object.getOwnPropertyDescriptor(u,'accessToken');
 if(!tokenField||!Object.hasOwn(tokenField,'value')||typeof tokenField.value!=='string'||tokenField.value.length===0)fail();
 return data(app,'config');
}
function runtime(check){
 check('sdk_version',()=>{if(require(path.join(SDK,'package.json')).version!=='3.4.0')fail();});
 check('node_version',()=>{if(process.version!=='v24.19.0')fail();});
 check('runtime_environment',()=>{if(constants.IS_LOCAL!=='false'||constants.CATALYST_ORIGIN!=='https://api.catalyst.zoho.com'
  ||String(process.env.ZC_SECURE||'').toLowerCase()==='override')fail();});
 check('https_continuity',()=>{if(assertHttpsBootstrap()!==request||types.isProxy(request))fail();});
 check('sdk_contract',()=>{if(SDK_METHOD_PINS.some(([fn,pin])=>types.isProxy(fn)||sha(Function.prototype.toString.call(fn).replace(/\r\n/g,'\n'))!==pin))fail();});
 // Detect loaded third-party request instrumentation. This is not proof against
 // arbitrary prior process tampering or provider infrastructure instrumentation.
 check('runtime_environment',()=>{if(Object.keys(require.cache).some(p=>/[\\/]node_modules[\\/](?:apminsight|newrelic|dd-trace|@opentelemetry)[\\/]/i.test(p)))fail();});
}
function createSuccessorPhysicalTransport({app,capability,operationKey,assertActive,timeoutMs=3000,storageDiagnostic=null}={}){
 let recorderFailed=false;
 const record=(fn,...args)=>{if(!guardPhysicalDiagnostic(storageDiagnostic,fn,...args))recorderFailed=true;return !recorderFailed;};
 if(!record(initializePhysicalDiagnostic))fail();
 const note=code=>record(recordPhysicalFailure,code);
 const deny=code=>{note(code);fail();};
 const check=(code,fn)=>{try{return fn();}catch{note(code);throw error();}};
 const scope=check('capability_scope',()=>require('./report-storage-capability').getIssuedCapabilityScope(capability,app));
 if(!/^[a-f0-9]{64}$/.test(operationKey||'')||typeof assertActive!=='function'
  ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3000)deny('transport_precondition');
 const {projectId:PROJECT,organizationId:ORG,controllerFunctionId}=scope;
  if(![PROJECT,ORG,controllerFunctionId].every(v=>typeof v==='string'&&/^[1-9][0-9]{2,29}$/.test(v)))deny('capability_scope');
 const config=check('managed_context',()=>data(app,'config'));runtime(check);
 const environment=check('target_scope',()=>data(config,'environment')),projectKey=check('target_scope',()=>data(config,'projectKey')),projectSecretKey=check('target_scope',()=>data(config,'projectSecretKey'));
 check('target_scope',()=>{
  if(data(config,'projectId')!==PROJECT||typeof environment!=='string'||environment.toLowerCase()!=='development'
  ||typeof projectKey!=='string'||projectKey.length===0||projectSecretKey!==undefined&&typeof projectSecretKey!=='string'
  ||capability.origin!=='https://api.catalyst.zoho.com'||capability.controllerFunctionId!==controllerFunctionId)fail();
 if(process.env.X_ZOHO_CATALYST_ORG_ID!==ORG)fail();
 });
 check('managed_context',()=>{if(managed(app)!==config)fail();});
 const credential=check('managed_context',()=>data(app,'credential')),userCredential=check('managed_context',()=>data(credential,'userCred'));
 const tables={eventReceipts:capability.tables.eventReceipts.id,reportRuns:capability.tables.reportRuns.id};
 if(!Object.values(tables).every(v=>/^[1-9][0-9]{2,29}$/.test(v))||tables.eventReceipts===tables.reportRuns)deny('target_scope');
 let held=false,closed=false,starts=0,inserts=0,maxConcurrent=0,authPending=0,settlementUnknown=false;
 const handles=new Set(),authTasks=new Set();
 const snapshot=()=>Object.freeze({physicalStarts:starts,insertStarts:inserts,activePhysical:handles.size,maxConcurrent,authPending,held,closed,quiescent:!recorderFailed&&!settlementUnknown&&handles.size===0&&authPending===0});
 if(!record(recordPhysicalDrain,'owned_quiescent'))fail();
 function destroy(h){try{h.req?.destroy();}catch{}try{h.res?.destroy();}catch{}}
 function stop(){held=true;for(const h of handles){h.failure=error();destroy(h);h.complete();}}
 function active(){if(recorderFailed)fail();if(held||closed)deny('cancelled');if(process.env.X_ZOHO_CATALYST_ORG_ID!==ORG)deny('target_scope');runtime(check);const current=check('managed_context',()=>managed(app));
  check('target_scope',()=>{
  if(current!==config||data(app,'credential')!==credential||data(credential,'userCred')!==userCredential
   ||data(current,'projectId')!==PROJECT||data(current,'environment')!==environment||data(current,'projectKey')!==projectKey
   ||data(current,'projectSecretKey')!==projectSecretKey)fail();});check('admission',assertActive);}
 function allowed(endpoint,body,query){
  const eventKey=`report-storage:${operationKey}`,root=`revenue-desk-report-v1:${operationKey}`;
  const second=`revenue-desk-report-v2:${operationKey}:0000000002`;
  if(query){if(endpoint!=='/query'||!body||Object.keys(body).join(',')!=='query')fail();
   const sql=body.query;
   if(![`SELECT * FROM RevenueDeskEventReceipts WHERE EVENT_KEY = '${eventKey}' LIMIT 2`,
    `SELECT * FROM ReportRuns WHERE IdempotencyKey = '${root}' LIMIT 2`,
    `SELECT * FROM ReportRuns WHERE IdempotencyKey = '${second}' LIMIT 2`,
    `SELECT * FROM ReportRuns WHERE IdempotencyKey LIKE 'revenue-desk-report-v2:${operationKey}:*' ORDER BY RD_REPORT_VERSION DESC LIMIT 2`].includes(sql))fail();
   return false;
  }
  if(!Array.isArray(body)||body.length!==1)fail();const row=body[0];
  if(endpoint===`/table/${tables.eventReceipts}/row`){if(row?.EVENT_KEY!==eventKey)fail();return true;}
  if(endpoint!==`/table/${tables.reportRuns}/row`||![root,second].includes(row?.IdempotencyKey))fail();
  require('./report-storage-capability').validateReportInsert(row);return true;
 }
 async function send(endpoint,body,query,options={}){
  let insert,bytes;
  try{active();check('request_contract',()=>{insert=allowed(endpoint,body,query);bytes=Buffer.from(JSON.stringify(body));if(bytes.length>32768)fail();});}
  catch(e){stop();throw error();}
  const expires=performance.now()+timeoutMs;
  const admit=()=>{active();check('admission',()=>options.budget?.assertActive());if(options.signal?.aborted)deny('cancelled');if(performance.now()>=expires)deny('deadline');};
  const reqData={user:'user',external:false,headers:{'Content-Type':'application/json','Content-Length':String(bytes.length)}};
  let authDone=false;
  authPending++;
  const authTask=(async()=>{try{admit();try{await auth.call(app,reqData);}catch{note('authentication');throw error();}authDone=true;admit();}finally{authPending--;}})();
  authTasks.add(authTask);authTask.finally(()=>authTasks.delete(authTask)).catch(()=>{});
  let authTimer,authAbort;
  const authDeadline=new Promise((_,reject)=>{
   authTimer=setTimeout(()=>{note('deadline');stop();reject(error());},Math.max(0,expires-performance.now()));
   authAbort=()=>{note('cancelled');stop();reject(error());};options.signal?.addEventListener('abort',authAbort,{once:true});
  });
  try{await Promise.race([authTask,authDeadline]);}
  catch{stop();throw error();}
  finally{clearTimeout(authTimer);options.signal?.removeEventListener('abort',authAbort);}
  if(!authDone){note('authentication');stop();throw error();}
  const h={req:null,res:null,requestClosed:false,responseClosed:false,ended:false,failure:null,value:null,duplicate:false,complete:()=>{}};
  const trace=event=>{if(typeof options.trace==='function')options.trace(Object.freeze({...event,at:performance.now()}));};
  let resolve,reject;
  const result=new Promise((a,b)=>{resolve=a;reject=b;});result.catch(()=>{});
  let timer,parentAbort,done=false,total=0,chunks=0;const parts=[];
  h.complete=()=>{
   if(done||!h.requestClosed||h.res&&!h.responseClosed)return;
   done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',parentAbort);handles.delete(h);
   if(h.failure||!h.ended){reject(error());return;}
   try{admit();trace({event:'outcome',operation:insert?'insert':'read',accepted:!h.duplicate,duplicate:h.duplicate});}
   catch{note('admission');stop();reject(error());return;}
   if(h.duplicate)reject(error());else resolve(h.value);
  };
  const fatal=(code='request_io')=>{note(code);h.failure=error();stop();destroy(h);h.complete();};
  const callback=(fn,code='request_io')=>(...args)=>{try{fn(...args);}catch{fatal(code);}};
  const response=callback(res=>{
   h.res=res;
   // Attach all containment listeners before admitting trace/body callbacks.
   res.on('error',callback(()=>fatal()));res.once('aborted',callback(()=>fatal()));
   res.once('close',callback(()=>{h.responseClosed=true;if(!h.ended)fatal();h.complete();}));
   res.on('data',callback(chunk=>{admit();if(++chunks>128||(total+=Buffer.byteLength(chunk))>65536)deny('response_body');parts.push(Buffer.from(chunk));},'response_body'));
   res.once('end',callback(()=>{
    admit();h.ended=true;
    const parsed=check('response_body',()=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))));
    const status=res.statusCode;
    h.duplicate=insert&&status===409&&parsed?.data?.error_code==='DUPLICATE_VALUE';
    if(!h.duplicate&&(!Number.isInteger(status)||status<200||status>=300))deny('response_status');
    if(!h.duplicate&&!Array.isArray(parsed?.data))deny('response_body');
    h.value=h.duplicate?null:parsed.data;h.complete();
   },'response_body'));
   admit();trace({event:'response',operation:insert?'insert':'read',status:res.statusCode});
   // Redirects never follow; errors other than exact 409 are terminal even if no body follows.
   if(!Number.isInteger(res.statusCode)||res.statusCode<200||res.statusCode>=300&&res.statusCode!==409)deny('response_status');
  });
  let constructorEntered=false,constructorReturned=false;
  try{
   const current=check('managed_context',()=>managed(app));
   reqData.headers.PROJECT_ID=data(current,'projectKey');
   reqData.headers['X-Catalyst-Environment']=data(current,'environment');reqData.headers.Environment=data(current,'environment');
   reqData.headers['CATALYST-ORG']=ORG;reqData.headers['X-CATALYST-USER']='admin';
   const secret=data(current,'projectSecretKey');if(isNonEmptyString(secret))reqData.headers['x-zc-project-secret-key']=secret;
   reqData.headers.Accept='application/vnd.catalyst.v2+json, '+(query?'application/vnd.catalyst.v2+zcql':'');
   reqData.headers['User-Agent']='zcatalyst-node/3.4.0';
   // No queue: a third admission is held, and an occupied/unknown-close slot is never recycled.
   // This is the final synchronous check immediately before the real constructor.
   admit();if(starts>=13||insert&&inserts>=5||handles.size>=2)deny('request_limit');
   check('https_continuity',()=>{if(assertHttpsBootstrap()!==request)fail();});
   if(!record(recordPhysicalConstructor,insert))fail();
   handles.add(h);starts++;if(insert)inserts++;maxConcurrent=Math.max(maxConcurrent,handles.size);constructorEntered=true;
   h.req=request({protocol:'https:',hostname:'api.catalyst.zoho.com',port:443,method:'POST',
    path:`/baas/v1/project/${PROJECT}${endpoint}`,headers:reqData.headers,agent:false,
    rejectUnauthorized:true,servername:'api.catalyst.zoho.com'},response);
   constructorReturned=Boolean(h.req);
   h.req.on('error',callback(()=>fatal()));
   h.req.once('close',callback(()=>{h.requestClosed=true;if(!h.res)fatal();h.complete();}));
   parentAbort=callback(()=>fatal('cancelled'));options.signal?.addEventListener('abort',parentAbort,{once:true});
   timer=setTimeout(callback(()=>fatal('deadline')),Math.max(0,expires-performance.now()));
   trace({event:'dispatch',operation:insert?'insert':'read'});admit();h.req.end(bytes);
  }catch{
   if(constructorEntered&&!constructorReturned){settlementUnknown=true;record(recordPhysicalDrain,'unknown');note('constructor_threw');}
   if(!h.req){h.requestClosed=true;h.failure=error();}fatal();
  }
  // A physically unclosed handle intentionally leaves result pending. Qualification
  // has a separate bounded drain/held path; late callbacks can never re-admit work.
  return result;
 }
 async function stopAndDrain(){
  closed=true;stop();let timer;
  // Cleanup window grants no new request admission. Unknown closure remains explicit.
  await Promise.race([Promise.allSettled([...authTasks,...[...handles].map(h=>new Promise(resolve=>{
   const old=h.complete;h.complete=()=>{old();if(h.requestClosed&&(!h.res||h.responseClosed))resolve();};h.complete();
  }))]),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);clearTimeout(timer);
  const drain=settlementUnknown?'unknown':authPending&&handles.size?'both_pending':authPending?'auth_pending':handles.size?'handles_pending':'owned_quiescent';
  record(recordPhysicalDrain,drain);if(drain!=='owned_quiescent')note('drain');
  return snapshot();
 }
 return Object.freeze({send,stop,stopAndDrain,snapshot});
}
module.exports={createSuccessorPhysicalTransport};
