'use strict';
const crypto=require('node:crypto');
const {canonicalJson}=require('./facts');
const {validateSnapshot,validState}=require('./report-delivery-control');
const HASH=/^[a-f0-9]{64}$/;
const FIELDS=Object.freeze(['Test_Report_PDF_URL','Test_Report_Revision','Test_Report_Recipient_Email',
 'Test_Report_Recipient_Verified_At','Test_Report_Delivery_Status']);
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function held(ambiguous=false){return Object.assign(new Error('REPORT_CRM_PROJECTION_HELD'),{code:'REPORT_CRM_PROJECTION_HELD',ambiguous});}
function projection(state){
 const s=state?.snapshot,b=s?.binding,p=state?.patch;
 if(state?.kind!=='report_crm_projection_v1'||!['dispatch_claimed','verified'].includes(state.phase)
  ||!HASH.test(state.owner||'')||!s||!p||Object.keys(p).sort().join(',')!==[...FIELDS].sort().join(',')
  ||p.Test_Report_Revision!==s.report?.manifestSha256||p.Test_Report_Recipient_Email!==s.recipient?.address
  ||!Number.isSafeInteger(state.at))throw held();
 validateSnapshot({...s,report:{...s.report,completed:true,fresh:true,validated:true},
  recipient:{...s.recipient,explicitlySelected:true,verified:true,eligible:true,suppressed:null}},state.at);
 return {ClientId:b.clientId,DeploymentId:b.deploymentId,ReportType:'free_test_crm_report_projection',
  PeriodStart:b.periodStart,PeriodEnd:b.periodEnd,ReportVersion:'report-crm-projection-v1',
  GenerationStatus:'DraftGenerated',ApprovalStatus:'OwnerReviewRequired',DeliveryStatus:'NotSent',
  ReconciliationStatus:state.phase==='verified'?'Verified':'Pending',ActualEstimatedSeparated:true,
  CrossClientIsolationPassed:true,DuplicateSendGuardPassed:false,ReportTotalsReconciled:true,
  AutoDeliveryEnabledAtRun:false,SchemaVersion:2,ReportFormat:'pdf',ReportObjectKey:canonicalJson(s.report)};
}
/** One scoped conditional PUT after a durable claim. Unknown outcomes only read
 * back; they never repeat PUT. Independent reads own CRM relationship evidence.
 * New writes require a protected fixed-principal qualification, not org.READ on
 * the narrow UPDATE credential. It grants no routing/approval/sending authority.
 */
function createReportCrmProjectionWriter({store,readRecords,readProjection,authorizationProvider,authorize=async()=>false,
 binding,fetchImpl=globalThis.fetch,now=Date.now}={}){
 const b=structuredClone(binding);
 if(!store||!['get','insert','compareAndSwap'].every(k=>typeof store[k]==='function')
  ||![readRecords,readProjection,authorizationProvider,authorize,fetchImpl,now].every(x=>typeof x==='function')
  ||b?.apiOrigin!=='https://www.zohoapis.com'||b.environment!=='development'
  ||!HASH.test(b.principalQualificationDigest||'')||!HASH.test(b.schemaDigest||'')
  ||!Number.isSafeInteger(b.verifiedAt)||!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=b.verifiedAt
  ||!Number.isSafeInteger(b.timeoutMs)||b.timeoutMs<1||b.timeoutMs>15000)throw held();
 return async function project({dealId,signal,deliveryOperationKey,actor}={}){
  const c=new AbortController(),start=now(),wall=performance.now()+b.timeoutMs;let reader,dispatched=false;
  let rejectCancelled;const cancelled=new Promise((_,reject)=>{rejectCancelled=reject;});cancelled.catch(()=>{});
  const cancel=()=>{c.abort();rejectCancelled(held(dispatched));};signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  const timer=setTimeout(cancel,b.timeoutMs);
  const options={signal:c.signal};
  const active=()=>{const at=now();if(c.signal.aborted||!Number.isSafeInteger(at)||at<start||at-start>=b.timeoutMs
   ||performance.now()>=wall||at<b.verifiedAt||at>=b.expiresAt)throw held(dispatched);};
  const bounded=operation=>Promise.race([Promise.resolve().then(()=>{active();return operation();}),cancelled]);
  try{
   active();const selected=await bounded(()=>readProjection({dealId,signal:c.signal}));active();
   const snapshot=validateSnapshot(selected.snapshot,now()),link=selected.link;
   if(snapshot.recipient.verifiedAt%1000!==0||snapshot.binding.dealId!==dealId||!/^[1-9]\d{7,29}$/.test(dealId||''))throw held();
   let url;try{url=new URL(link?.url);}catch{throw held();}
   if(link.access!=='authenticated_private'||link.url.length>450||url.origin!=='https://workdrive.zoho.com'
    ||url.username||url.password||link.manifestSha256!==snapshot.report.manifestSha256
    ||link.documentSha256!==snapshot.report.summary.documentSha256||!HASH.test(link.qualificationDigest||'')
    ||!Number.isSafeInteger(link.expiresAt)||link.expiresAt<=now())throw held();
   // Sending acceptance is projected only from an exact immutable delivery row.
   if(deliveryOperationKey!==undefined&&!HASH.test(deliveryOperationKey))throw held();
   const deliveryKey=deliveryOperationKey||sha(`report-initial-delivery-v1\0${snapshot.binding.deploymentId}`);
   const delivery=await bounded(()=>store.get(deliveryKey,options));active();
   if(delivery?.state?.kind==='report_delivery_v1')validState(delivery.state);
   const rejected=delivery?.state?.phase==='provider_rejected'&&delivery.state.kind==='report_delivery_v1'
    &&canonicalJson(delivery.state.snapshot)===canonicalJson(snapshot);
   const accepted=delivery?.state?.phase==='provider_accepted'&&delivery.state.kind==='report_delivery_v1'
    &&canonicalJson(delivery.state.snapshot)===canonicalJson(snapshot);
   const patch={Test_Report_PDF_URL:link.url,Test_Report_Revision:snapshot.report.manifestSha256,
    Test_Report_Recipient_Email:snapshot.recipient.address,
    Test_Report_Recipient_Verified_At:new Date(snapshot.recipient.verifiedAt).toISOString().replace(/\.\d{3}Z$/,'+00:00'),
    Test_Report_Delivery_Status:rejected?'Failed':accepted?'Provider Accepted':'Held'};
   // One durable admission slot per Deal/test serializes corrections and status changes.
   const key=sha(`report-crm-projection-v1\0${dealId}\0${snapshot.binding.deploymentId}`);
   const exact=record=>record?.deal?.id===dealId&&record.deal.Deployment_Record_ID===snapshot.binding.deploymentId
    &&record.deal.Configuration_Version===snapshot.binding.configurationVersion&&record.deal.Test_Status==='Completed'
    &&record.deal.Account_Name?.id===snapshot.binding.accountId&&record.deal.Contact_Name?.id===snapshot.binding.contactId
    &&record.contact?.id===snapshot.binding.contactId&&record.contact.Account_Name?.id===snapshot.binding.accountId
    &&record.contact.Email===snapshot.recipient.address;
   const matches=record=>exact(record)&&FIELDS.every(k=>k==='Test_Report_Recipient_Verified_At'
    ?Date.parse(record.deal[k])===snapshot.recipient.verifiedAt:record.deal[k]===patch[k]);
   let row=await bounded(()=>store.get(key,options));active();
   let cohort=await bounded(()=>readRecords(dealId,options));active();if(!exact(cohort))throw held();
   const state={kind:'report_crm_projection_v1',phase:'dispatch_claimed',owner:crypto.randomBytes(32).toString('hex'),
    snapshot,patch,at:now()};
   if(row){
    if(row.state.kind!=='report_crm_projection_v1')throw held(true);
    const same=canonicalJson(row.state.patch)===canonicalJson(patch)&&canonicalJson(row.state.snapshot)===canonicalJson(snapshot);
    if(same){
     if(!matches(cohort))throw held(true);
     if(row.state.phase==='dispatch_claimed')row=await bounded(()=>store.compareAndSwap(row,{...row.state,phase:'verified'},options));
     active();if(row?.state?.phase!=='verified')throw held(true);return {status:'verified'};
    }
    // A prior unknown dispatch blocks every later patch; only independently
    // verified history can advance, under the same compare-and-swap fence.
    if(row.state.phase!=='verified'||!FIELDS.every(k=>k==='Test_Report_Recipient_Verified_At'
     ?Date.parse(cohort.deal[k])===row.state.snapshot.recipient.verifiedAt:cohort.deal[k]===row.state.patch[k]))throw held(true);
    row=await bounded(()=>store.compareAndSwap(row,state,options));active();
   }else{
    if(matches(cohort))return {status:'verified'};
    row=await bounded(()=>store.insert(key,state,options));active();
   }
   if(!row||canonicalJson(row.state)!==canonicalJson(state))throw held();
   // Reattest after claim/auth: no email/recipient/link/body supplied by HTTP.
   const authorization=await bounded(()=>authorizationProvider());active();
   if(!/^Zoho-oauthtoken [A-Za-z0-9._-]{20,4096}$/.test(authorization||''))throw held();
   const fresh=await bounded(()=>readProjection({dealId,signal:c.signal}));active();
   if(canonicalJson(validateSnapshot(fresh.snapshot,now()))!==canonicalJson(snapshot)
    ||canonicalJson(fresh.link)!==canonicalJson(link)||link.expiresAt<=now())throw held();
   const before=await bounded(()=>readRecords(dealId,options));active();
   if(canonicalJson(before)!==canonicalJson(cohort)||typeof before.deal.Modified_Time!=='string'
    ||!Number.isFinite(Date.parse(before.deal.Modified_Time)))throw held();
   const currentDelivery=await bounded(()=>store.get(deliveryKey,options));active();
   if(canonicalJson({row:currentDelivery})!==canonicalJson({row:delivery}))throw held();
   if(await bounded(()=>authorize({dealId,actor,action:'project',signal:c.signal}))!==true)throw held();active();
   if(link.expiresAt<=now())throw held();
   validateSnapshot(selected.snapshot,now());active();
   dispatched=true;
   const response=await bounded(()=>fetchImpl(`${b.apiOrigin}/crm/v8/Deals/${dealId}`,{method:'PUT',redirect:'error',signal:c.signal,
    headers:{Authorization:authorization,Accept:'application/json','Content-Type':'application/json',
     'If-Unmodified-Since':before.deal.Modified_Time},
    body:JSON.stringify({data:[{...patch,skip_feature_execution:[{name:'cadences'}]}],trigger:[]})}));active();
   if(response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||''))throw held(true);
   reader=response.body?.getReader();if(!reader)throw held(true);let size=0;const chunks=[];
   while(true){const part=await bounded(()=>reader.read());active();if(part.done)break;size+=part.value.byteLength;
    if(size>32768)throw held(true);chunks.push(Buffer.from(part.value));}
   const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   if(json?.data?.length!==1||json.data[0].status!=='success'||json.data[0].code!=='SUCCESS'
    ||String(json.data[0].details?.id)!==dealId)throw held(true);
   const after=await bounded(()=>readRecords(dealId,options));active();if(!matches(after))throw held(true);
   const saved=await bounded(()=>store.compareAndSwap(row,{...state,phase:'verified'},options));active();
   if(saved?.state?.phase!=='verified')throw held(true);return {status:'verified'};
  }catch{throw held(dispatched);}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);c.abort();
   try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}}
 };
}
module.exports={createReportCrmProjectionWriter,projection,FIELDS};
