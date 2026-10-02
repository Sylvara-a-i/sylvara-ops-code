'use strict';
// Historical filename retained for archive closure; this module never uses Zoho Mail.
const crypto=require('node:crypto'),same=require('node:util').isDeepStrictEqual;
const HASH=/^[a-f0-9]{64}$/,ID=/^[1-9][0-9]{2,29}$/,REF=/^[A-Za-z0-9_-]{1,512}$/;
const ADDRESS=/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const NAME='7-Day Revenue Leak Test.pdf',MAX_PDF=2*1024*1024;
const SEND_REJECTIONS=new Set(['NOT_ALLOWED','NO_PERMISSION','INVALID_DATA','MANDATORY_NOT_FOUND','FILE_SIZE_EXCEEDS','LIMIT_EXCEEDED','RECORD_LOCKED']);
const {unsubscribed}=require('./report-recipient-preflight');
function held(ambiguous=false){return Object.assign(new Error('REPORT_CRM_EMAIL_HELD'),{code:'REPORT_CRM_EMAIL_HELD',ambiguous});}
function projection(s){
 if(s?.kind!=='report_crm_attachment_v1'||!['upload_started','uploaded'].includes(s.phase)
  ||!HASH.test(s.operationKey||'')||!HASH.test(s.documentSha256||'')||!HASH.test(s.claimToken||'')
  ||!HASH.test(s.recipientVerificationDigest||'')||!ID.test(s.contactId||'')||!HASH.test(s.senderDigest||'')
  ||!Number.isSafeInteger(s.createdAt)||s.createdAt<0||!Number.isSafeInteger(s.byteLength)||s.byteLength<16||s.byteLength>MAX_PDF
  ||!s.identity||!['clientId','deploymentId'].every(k=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(s.identity[k]||''))
  ||!['periodStart','periodEnd'].every(k=>/^\d{4}-\d{2}-\d{2}$/.test(s.identity[k]||''))
  ||(s.phase==='uploaded'&&(!REF.test(s.fileId||'')||!Number.isSafeInteger(s.acceptedAt)||s.acceptedAt<s.createdAt)))throw held();
 return {ClientId:s.identity.clientId,DeploymentId:s.identity.deploymentId,ReportType:'free_test_crm_attachment',
  PeriodStart:s.identity.periodStart,PeriodEnd:s.identity.periodEnd,ReportVersion:'report-crm-attachment-v1',
  GenerationStatus:'DraftGenerated',ApprovalStatus:'StandingInitialDelivery',DeliveryStatus:'NotSent',
  ReconciliationStatus:s.phase==='uploaded'?'Verified':'Pending',ActualEstimatedSeparated:true,
  CrossClientIsolationPassed:true,DuplicateSendGuardPassed:true,ReportTotalsReconciled:true,
  AutoDeliveryEnabledAtRun:false,SchemaVersion:2,ReportFormat:'pdf'};
}
/** One CRM-native send under the outer Deal claim. Separate unique upload and
 * accepted-receipt rows preserve the ZFS ID without replay or upload CAS.
 * No SMTP/Mail fallback, CC/BCC, consent bypass, retries or scheduling.
 * Provider acceptance is never inbox delivery/read/follow-up evidence. */
function createReportCrmSender({binding,store,authorizationProvider,fetchImpl=globalThis.fetch,now=Date.now}={}){
 const b=structuredClone(binding);
 if(!b||b.environment!=='development'||b.provider!=='crm_native'||b.apiOrigin!=='https://www.zohoapis.com'
  ||!ADDRESS.test(b.fromAddress||'')||b.fromAddress.length>100||typeof b.fromName!=='string'||b.fromName.length>100||/[\r\n\x00]/.test(b.fromName)
  ||!['contractQualificationDigest','senderQualificationDigest'].every(k=>HASH.test(b[k]||''))
  ||!Number.isSafeInteger(b.verifiedAt)||!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=b.verifiedAt
  ||!Number.isSafeInteger(b.timeoutMs)||b.timeoutMs<1||b.timeoutMs>15000
  ||!Number.isSafeInteger(b.maxReconciliationPages)||b.maxReconciliationPages<1||b.maxReconciliationPages>20
  ||!['get','insert'].every(k=>typeof store?.[k]==='function')||typeof authorizationProvider!=='function'||typeof fetchImpl!=='function')throw held();
 function input(x){
  if(!HASH.test(x?.operationKey||'')||!ID.test(x.snapshot?.binding?.contactId||'')
   ||x.snapshot.recipient?.contactId!==x.snapshot.binding.contactId||!ADDRESS.test(x.snapshot.recipient?.address||'')
   ||!HASH.test(x.snapshot.recipient?.verificationDigest||'')||x.snapshot.report?.summary?.role!=='summary'
   ||!HASH.test(x.snapshot.report.summary.documentSha256||'')||!(x.signal instanceof AbortSignal))throw held();
  return x;
 }
 async function attempt(x,work){
  input(x);const controller=new AbortController(),start=now(),wall=performance.now()+b.timeoutMs;
  let dispatched=false,reader,rejectDeadline;
  const deadline=new Promise((_,reject)=>{rejectDeadline=reject;});
  const cancel=()=>{controller.abort();try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}rejectDeadline(held(dispatched));};
  x.signal.addEventListener('abort',cancel,{once:true});if(x.signal.aborted)cancel();const timer=setTimeout(cancel,b.timeoutMs);
  function active(){const at=now();if(controller.signal.aborted||!Number.isSafeInteger(at)||at<start||at>=start+b.timeoutMs
   ||performance.now()>=wall||at<b.verifiedAt||at>=b.expiresAt)throw held(dispatched);}
  async function request(path,{method='GET',body,authorization,allowSendRejection=false}={}){
   active();if(method==='POST')dispatched=true;
   const response=await fetchImpl(b.apiOrigin+'/crm/v8'+path,{method,body,redirect:'error',signal:controller.signal,
    headers:{Authorization:authorization,Accept:'application/json','Accept-Encoding':'identity',...(typeof body==='string'?{'Content-Type':'application/json'}:{})}});active();
   if(!([200,201,202].includes(response?.status)||(allowSendRejection&&[400,403].includes(response?.status)))||!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||'')
    ||(response.headers.get('content-encoding')&&response.headers.get('content-encoding')!=='identity')||!response.body?.getReader)throw held(dispatched);
   const size=response.headers.get('content-length');if(size!==null&&(!/^\d+$/.test(size)||Number(size)>262144))throw held(dispatched);
   reader=response.body.getReader();let n=0,count=0;const parts=[];
   while(true){active();const part=await reader.read();active();if(part.done)break;
    if(!(part.value instanceof Uint8Array)||++count>512||(n+=part.value.length)>262144)throw held(dispatched);parts.push(Buffer.from(part.value));}
   let json;try{json=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw held(dispatched);}
   if([400,403].includes(response.status)){
    // Only bounded documented send_mail rejection responses prove no message
    // acceptance. SMTP errors, 5xx, malformed or mixed responses stay ambiguous.
    const item=json?.data?.[0];
    const error=json?.data===undefined?json:item;
    if((json?.data===undefined||json.data?.length===1)&&error?.status==='error'&&SEND_REJECTIONS.has(error.code))
      return {definitiveSendRejection:error.code};
    throw held(dispatched);
   }
   return json;
  }
  async function run(){active();const authorization=await authorizationProvider({signal:controller.signal});active();
   if(typeof authorization!=='string'||!/^Zoho-oauthtoken [A-Za-z0-9._~-]{16,4096}$/.test(authorization))throw held();
   const result=await work({active,request:(path,o={})=>request(path,{...o,authorization}),signal:controller.signal});active();return result;}
  try{return await Promise.race([run(),deadline]);}catch{throw held(dispatched);}finally{clearTimeout(timer);controller.abort();
   x.signal.removeEventListener('abort',cancel);try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}}
 }
 const keys=x=>({claim:sha('report-crm-upload-v1\0'+x.operationKey),receipt:sha('report-crm-upload-receipt-v1\0'+x.operationKey)});
 function matches(s,x){return s?.operationKey===x.operationKey&&s.documentSha256===x.snapshot.report.summary.documentSha256
  &&s.recipientVerificationDigest===x.snapshot.recipient.verificationDigest&&s.contactId===x.snapshot.binding.contactId
  &&s.senderDigest===sha(b.fromAddress)&&same(s.identity,Object.fromEntries(['clientId','deploymentId','periodStart','periodEnd'].map(k=>[k,x.snapshot.binding[k]])));}
 const subject=x=>'Your 7-Day Revenue Leak Test results ['+x.operationKey+']';
 const content=x=>'Your 7-Day Revenue Leak Test summary is attached. Reply to discuss the findings.\nDelivery reference: '+x.operationKey+'\nPDF SHA-256: '+x.snapshot.report.summary.documentSha256;
 const proof=(x,id)=>Object.freeze({accepted:true,operationKey:x.operationKey,documentSha256:x.snapshot.report.summary.documentSha256,
  recipientVerificationDigest:x.snapshot.recipient.verificationDigest,messageReferenceDigest:sha(x.snapshot.binding.contactId+'\0'+id),acceptedAt:now()});
 async function sendSummary(x){input(x);if(!Buffer.isBuffer(x.bytes)||x.bytes.length<16||x.bytes.length>MAX_PDF
  ||!x.bytes.subarray(0,8).toString('ascii').startsWith('%PDF-')||sha(x.bytes)!==x.snapshot.report.summary.documentSha256)throw held();
  const pdf=Buffer.from(x.bytes);
  return attempt(x,async({active,request,signal})=>{
   // Current Contact and the latest ten related-email status summaries are
   // a bounded contradiction check, not complete suppression clearance. No
   // body/history absence is promoted to eligibility; Zoho still enforces it.
   const current=await request('/Contacts/'+x.snapshot.binding.contactId+'?'+new URLSearchParams({
    fields:'id,Email,Email_Opt_Out,Unsubscribed_Mode,Unsubscribed_Time'}));active();
   const contact=current?.data?.[0];
   if(current.data?.length!==1||contact?.id!==x.snapshot.binding.contactId
    ||contact.Email!==x.snapshot.recipient.address||contact.Email_Opt_Out!==false||unsubscribed(contact))throw held();
   const history=await request('/Contacts/'+x.snapshot.binding.contactId+'/Emails');active();
   if(!Array.isArray(history?.Emails)||history.Emails.length>10||typeof history.info?.more_records!=='boolean')throw held();
   for(const email of history.Emails){
    if(!Array.isArray(email.to)||!Array.isArray(email.status)||email.status.some(s=>typeof s?.type!=='string'))throw held();
    if(email.to.some(t=>t.email===x.snapshot.recipient.address)
      &&email.status.some(s=>['bounced','blocked','unsubscribed'].includes(s.type.toLowerCase())))throw held();
   }
   const k=keys(x),accepted=await store.get(k.receipt,{signal});active();
   // An existing receipt/claim means this operation already entered transport;
   // recovery is read-only through lookupAcceptance, never another send.
   if(accepted||await store.get(k.claim,{signal})){active();throw held(true);}active();
   const state={kind:'report_crm_attachment_v1',phase:'upload_started',operationKey:x.operationKey,
    documentSha256:sha(pdf),byteLength:pdf.length,recipientVerificationDigest:x.snapshot.recipient.verificationDigest,
    contactId:x.snapshot.binding.contactId,senderDigest:sha(b.fromAddress),createdAt:now(),claimToken:crypto.randomBytes(32).toString('hex'),
    identity:Object.fromEntries(['clientId','deploymentId','periodStart','periodEnd'].map(k=>[k,x.snapshot.binding[k]]))};projection(state);
   const claim=await store.insert(k.claim,state,{signal});active();if(!same(claim?.state,state))throw held(true);
   const form=new FormData();form.append('file',new Blob([pdf],{type:'application/pdf'}),NAME);
   const uploaded=await request('/files',{method:'POST',body:form});active();const item=uploaded?.data?.[0];
   if(uploaded.data?.length!==1||item?.code!=='SUCCESS'||item.status!=='success'||item.details?.name!==NAME||!REF.test(item.details?.id||''))throw held(true);
   const receipt={...state,phase:'uploaded',fileId:item.details.id,acceptedAt:now()};projection(receipt);
   const saved=await store.insert(k.receipt,receipt,{signal});active();if(!same(saved?.state,receipt))throw held(true);
   const sent=await request('/Contacts/'+x.snapshot.binding.contactId+'/actions/send_mail',{method:'POST',allowSendRejection:true,body:JSON.stringify({data:[{
    from:{user_name:b.fromName,email:b.fromAddress},to:[{email:x.snapshot.recipient.address}],org_email:true,
    subject:subject(x),content:content(x),mail_format:'text',attachments:[{id:receipt.fileId}]}]})});active();
   if(sent.definitiveSendRejection)return Object.freeze({accepted:false,rejected:true,rejectionCode:sent.definitiveSendRejection,
    operationKey:x.operationKey,documentSha256:x.snapshot.report.summary.documentSha256,
    recipientVerificationDigest:x.snapshot.recipient.verificationDigest,rejectedAt:now()});
   const result=sent?.data?.[0];
   if(sent.data?.length!==1||result?.code!=='SUCCESS'||result.status!=='success'||!REF.test(result.details?.message_id||''))throw held(true);
   return proof(x,result.details.message_id);
  });
 }
 async function lookupAcceptance(x){return attempt(x,async({active,request,signal})=>{
  const k=keys(x),receipt=await store.get(k.receipt,{signal});active();if(!receipt)return null;
  projection(receipt.state);if(receipt.state.phase!=='uploaded'||!matches(receipt.state,x))throw held();
  const candidates=[],indexes=new Set();let index;
  for(let page=0;page<b.maxReconciliationPages;page++){
   const query=new URLSearchParams({type:'sent_from_crm'});if(index)query.set('index',index);
   const list=await request('/Contacts/'+x.snapshot.binding.contactId+'/Emails?'+query);active();
   if(!Array.isArray(list.Emails)||list.Emails.length>10||typeof list.info?.more_records!=='boolean')throw held();
   for(const email of list.Emails)if(email.subject===subject(x)&&REF.test(email.message_id||''))candidates.push(email.message_id);
   if(!list.info.more_records){index=null;break;}
   index=list.info.next_index;if(typeof index!=='string'||index.length>512||indexes.has(index))throw held();indexes.add(index);
  }
  // Truncated or empty scans cannot prove absence; unknown remains consumed.
  if(index||candidates.length!==1)return null;
  const detail=await request('/Contacts/'+x.snapshot.binding.contactId+'/Emails/'+encodeURIComponent(candidates[0]));active();
  const e=detail?.Emails?.[0];if(detail.Emails?.length!==1||e?.sent!==true||e.subject!==subject(x)||e.content!==content(x)
   ||e.from?.email!==b.fromAddress||!Array.isArray(e.to)||e.to.length!==1||e.to[0].email!==x.snapshot.recipient.address
   ||(e.cc?.length||e.bcc?.length)||!Array.isArray(e.attachments)||e.attachments.length!==1
   ||e.attachments[0].id!==receipt.state.fileId||e.attachments[0].name!==NAME||Number(e.attachments[0].size)!==receipt.state.byteLength)return null;
  // Exact ZFS/email attachment ID equivalence must be qualified independently;
  // if provider transforms either bytes or body, this deliberately stays held.
  return proof(x,candidates[0]);
 });}
 return Object.freeze({sendSummary,lookupAcceptance});
}
function createManagedReportCrmSender({app,binding,store,fetchImpl,now}={}){
 if(!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(binding?.connectionReference||''))throw held();
 const {createConnectionAuthorizationProvider}=require('./connection-boundary');
 return createReportCrmSender({binding,store,fetchImpl,now,authorizationProvider:createConnectionAuthorizationProvider(app,binding.connectionReference,binding.timeoutMs)});
}
module.exports={createReportCrmSender,createManagedReportCrmSender,projection};
