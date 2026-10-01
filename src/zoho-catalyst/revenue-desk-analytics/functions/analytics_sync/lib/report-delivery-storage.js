'use strict';
const crypto=require('node:crypto');
const {canonicalJson}=require('./facts');
const {createReportAttemptBudget,REPORT_ATTEMPT_MAXIMUMS}=require('./report-attempt-budget');
const HASH=/^[a-f0-9]{64}$/;
const digest=x=>crypto.createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:canonicalJson(x)).digest('hex');
function held(){throw Object.assign(new Error('REPORT_DELIVERY_STORAGE_HELD'),{code:'REPORT_DELIVERY_STORAGE_HELD'});}
/** Read-only bridge from accepted ReportRuns to actual immutable WorkDrive bytes.
 * No filename discovery, rendering, upload, shared URL or missing-receipt recovery.
 * The caller has already authorized its exact Deal snapshot; this adapter also
 * fences every stored client/deployment, receipt, destination and actual byte.
 */
function createReportDeliveryStorageReader({reportRunStore:runs,workdrive,readDestinationBinding,
 now=Date.now,timeoutMs=10000}={}){
 if(!runs||typeof runs.get!=='function'||!workdrive||!['getMetadata','listVersions','downloadVersion'].every(k=>typeof workdrive[k]==='function')
 ||typeof readDestinationBinding!=='function'||typeof now!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)held();
 return async function readSummary({snapshot,signal}={}){
  const budget=createReportAttemptBudget({signal,timeoutMs,now,limits:{...REPORT_ATTEMPT_MAXIMUMS,
   analytics_read:0,source_read:0,checkpoint_write:0,workdrive_read:6,workdrive_write:0,report_run_read:4,report_run_write:0}});
  const options={signal:budget.signal,budget};
  const active=()=>budget.assertActive();
  try{
   active();
   const report=snapshot?.report,b=snapshot?.binding;
   if(!b||!report||!HASH.test(report.generationKey)||!HASH.test(report.manifestSha256)||!report.summary)held();
   const bundle=await runs.get(report.generationKey,options);active();
   const state=bundle?.state,m=state?.manifest;
   if(state?.kind!=='report_bundle_v1'||state.phase!=='accepted'||state.identity?.clientId!==b.clientId
    ||state.identity.deploymentId!==b.deploymentId||state.identity.periodStart!==b.periodStart||state.identity.periodEnd!==b.periodEnd
    ||state.manifestSha256!==report.manifestSha256
    ||digest(m)!==report.manifestSha256||m.initialDeliveryArtifact!=='summary'||m.supportingAvailability!=='private'
    ||Object.keys(m.artifacts||{}).sort().join(',')!=='summary,supporting')held();
   const ref=m.artifacts.summary;
   if(report.summary.role!=='summary'||!['generationKey','documentSha256','privateReceiptKey'].every(k=>
    HASH.test(ref[k]||'')&&ref[k]===report.summary[k])
    ||ref.privateReceiptKey!==digest(`workdrive-draft-v1\0${ref.generationKey}`))held();
   const draft=await runs.get(ref.privateReceiptKey,options);active();
   const d=draft?.state,i=d?.identity,r=d?.receipt;
   if(d?.kind!=='workdrive_draft_v1'||d.phase!=='verified'||i?.format!=='pdf'||i.generationKey!==ref.generationKey
    ||i.documentSha256!==ref.documentSha256||i.clientId!==b.clientId||i.deploymentId!==b.deploymentId
    ||i.periodStart!==b.periodStart||i.periodEnd!==b.periodEnd||!Number.isSafeInteger(i.byteLength)||i.byteLength<9||i.byteLength>2*1024*1024
    ||!r||r.status!=='draft_generated_owner_review_required_delivery_not_authorized'||r.documentSha256!==ref.documentSha256||r.parentId!==i.parentId||digest(r)!==ref.receiptSha256)held();
   const binding=structuredClone(await readDestinationBinding(i.scope,options));active();
   const validBinding=value=>value&&value.environment==='development'&&value.company==='Sylvara'
    &&value.externalSharing===false&&value.ownerReviewRequired===true&&Number.isSafeInteger(value.verifiedAt)
    &&value.verifiedAt<=now()&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>now()
    &&canonicalJson(value.scope)===canonicalJson(i.scope)
    &&['clientId','deploymentId','parentId','organizationId','teamFolderId','writerId','accessApprovalDigest','retentionApprovalDigest','contractQualificationDigest']
    .every(k=>value[k]===i[k]);
   if(i.scope?.configurationVersion!==state.identity.configurationVersionId||!validBinding(binding))held();
   const parent=await workdrive.getMetadata(binding.parentId,options);active();
   if(parent?.id!==binding.parentId||parent.isFolder!==true||parent.parentId!==binding.parentParentId
    ||parent.organizationId!==binding.organizationId||parent.teamFolderId!==binding.teamFolderId)held();
   const meta=await workdrive.getMetadata(r.resourceId,options);active();
   if(meta?.id!==r.resourceId||meta.isFolder!==false||meta.parentId!==binding.parentId
    ||meta.organizationId!==binding.organizationId||meta.teamFolderId!==binding.teamFolderId
    ||meta.sizeBytes!==i.byteLength||meta.name!==i.filename)held();
   const versions=await workdrive.listVersions(r.resourceId,options);active();
   const selected=Array.isArray(versions)?versions.filter(v=>v.resourceId===r.resourceId&&v.versionId===r.versionId
    &&v.versionNumber===r.versionNumber&&v.sizeBytes===i.byteLength):[];
   if(selected.length!==1)held();
   const bytes=await workdrive.downloadVersion(r.resourceId,{versionId:r.versionId,versionNumber:r.versionNumber},options);active();
   if(!Buffer.isBuffer(bytes)||bytes.length!==i.byteLength||bytes.subarray(0,5).toString()!=='%PDF-'||digest(bytes)!==ref.documentSha256)held();
   const after=await workdrive.getMetadata(r.resourceId,options);active();
   const finalParent=await workdrive.getMetadata(binding.parentId,options);active();
   if(canonicalJson(parent)!==canonicalJson(finalParent))held();
   const freshBinding=await readDestinationBinding(i.scope,options);active();
   if(canonicalJson(meta)!==canonicalJson(after)||!validBinding(freshBinding)||canonicalJson(binding)!==canonicalJson(freshBinding))held();
   const finalDraft=await runs.get(ref.privateReceiptKey,options);active();
   const finalBundle=await runs.get(report.generationKey,options);active();
   if(canonicalJson(finalDraft)!==canonicalJson(draft)||canonicalJson(finalBundle)!==canonicalJson(bundle))held();
   return Buffer.from(bytes);
  }catch{held();}finally{budget.close();}
 };
}
module.exports={createReportDeliveryStorageReader};
