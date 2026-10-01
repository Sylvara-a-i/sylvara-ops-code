'use strict';
const crypto=require('node:crypto');
const {createAuthorizationProvider}=require('./connection');
const HASH=/^[a-f0-9]{64}$/;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const PROFILE='report_sender_qualification_v1';
const URL='https://www.zohoapis.com/crm/v8/settings/emails/actions/from_addresses';
function held(){throw Object.assign(new Error('REPORT_SENDER_QUALIFICATION_HELD'),{code:'REPORT_SENDER_QUALIFICATION_HELD'});}
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.sort().join(',');
/** Private, independently enabled diagnostic. No caller controls sender, link,
 * endpoint or record. Reads do not approve delivery or suppression. SDK-managed
 * authentication stays inside this process; no credentials or provider body
 * enter responses/logs. SDK credential lookup cannot be cancelled, so every
 * continuation checks admission before the one cancellable native GET. */
function createProtectedSenderQualification({environment=process.env,now=Date.now,fetchImpl=globalThis.fetch}={}){
 return function senderQualification(app,config){
  const raw=environment.REPORT_SENDER_QUALIFICATION_JSON,pin=environment.REPORT_SENDER_QUALIFICATION_SHA256;
  if(typeof raw!=='string'||Buffer.byteLength(raw)>4096||!HASH.test(pin||'')||sha(raw)!==pin)held();
  let b;try{b=JSON.parse(raw);}catch{held();}
  const keys=['schemaVersion','enabled','environment','sourceRevision','projectId','controlHost','connectionReference','fromAddress','fromName','verifiedAt','expiresAt','timeoutMs','costQualificationDigest'];
  if(!exact(b,keys)||b.schemaVersion!==1||b.enabled!==true||b.environment!=='development'
   ||config?.environment!==b.environment||environment.DEPLOYMENT_ENVIRONMENT!==b.environment
   ||b.sourceRevision!==config.sourceRevision||environment.SOURCE_REVISION!==b.sourceRevision||!/^[a-f0-9]{40}$/.test(b.sourceRevision||'')
   ||!/^[1-9][0-9]{2,29}$/.test(b.projectId||'')||sha(b.projectId)!==config.expectedProjectIdSha256
   ||String(app?.config?.projectId)!==b.projectId||String(app.config.environment).toLowerCase()!=='development'
   ||b.controlHost!==config.controlHost||!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(b.connectionReference||'')
   ||typeof b.fromAddress!=='string'||b.fromAddress.length>100||!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(b.fromAddress)
   ||typeof b.fromName!=='string'||!b.fromName.length||b.fromName.length>100||/[\r\n\x00]/.test(b.fromName)
   ||!HASH.test(b.costQualificationDigest||'')||!Number.isSafeInteger(b.verifiedAt)||b.verifiedAt<0
   ||!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=b.verifiedAt||b.expiresAt-b.verifiedAt>900000
   ||!Number.isSafeInteger(b.timeoutMs)||b.timeoutMs<1||b.timeoutMs>10000||typeof now!=='function'||typeof fetchImpl!=='function')held();
  Object.freeze(b);
  const active=()=>{const at=now();if(!Number.isSafeInteger(at)||at<b.verifiedAt||at>=b.expiresAt)held();return at;};active();
  return Object.freeze({async handle(command,{actor,signal}={}){
   if(!exact(command,['profile','action'])||command.profile!==PROFILE||command.action!=='qualify_sender'
    ||actor?.kind!=='internal_controller'||actor.identity!==config.operatorIdHash
    ||(signal!==undefined&&!(signal instanceof AbortSignal)))held();
   const start=active(),wall=performance.now()+b.timeoutMs,controller=new AbortController();
   let reader,rejectDeadline;
   const deadline=new Promise((_,reject)=>{rejectDeadline=reject;});
   const cancel=()=>{controller.abort();try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}rejectDeadline(new Error('REPORT_SENDER_QUALIFICATION_HELD'));};
   signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const timer=setTimeout(cancel,b.timeoutMs);
   function admission(){const at=active();if(controller.signal.aborted||at<start||at-start>=b.timeoutMs||performance.now()>=wall)held();return at;}
   async function read(){
    admission();const authorization=await createAuthorizationProvider(app,b.connectionReference,/^Zoho-oauthtoken [A-Za-z0-9._-]{20,4096}$/,b.timeoutMs)();admission();
    const response=await fetchImpl(URL,{method:'GET',redirect:'error',signal:controller.signal,
     headers:{Authorization:authorization,Accept:'application/json','Accept-Encoding':'identity'}});admission();
    if(response?.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||'')
     ||(response.headers.get('content-encoding')&&response.headers.get('content-encoding')!=='identity')||!response.body?.getReader)held();
    const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>65536))held();
    reader=response.body.getReader();let n=0,chunks=0;const parts=[];
    while(true){admission();const part=await reader.read();admission();if(part.done)break;
     if(!(part.value instanceof Uint8Array)||++chunks>128||(n+=part.value.length)>65536)held();parts.push(Buffer.from(part.value));}
    let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{held();}
    if(!Array.isArray(data?.from_addresses)||data.from_addresses.length>1000)held();
    const found=data.from_addresses.filter(x=>x?.email===b.fromAddress);
    if(found.length!==1||found[0].type!=='org_email'||found[0].user_name!==b.fromName||!/^[1-9][0-9]{2,29}$/.test(found[0].id||''))held();
    const observedAt=admission();
    return Object.freeze({status:'sender_allowed',sender:Object.freeze({address:b.fromAddress,displayName:b.fromName,type:'org_email'}),observedAt,
     qualificationDigest:sha(JSON.stringify({bindingSha256:pin,senderId:found[0].id,observedAt})),deliveryAuthority:false});
   }
   try{const result=await Promise.race([read(),deadline]);admission();return result;}
   catch{held();}finally{clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',cancel);try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}}
  }});
 };
}
module.exports={createProtectedSenderQualification,PROFILE};
