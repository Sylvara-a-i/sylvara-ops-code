'use strict';
const crypto=require('node:crypto');
const {canonicalJson}=require('./facts');
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function held(){throw Object.assign(new Error('REPORT_DELIVERY_ATTESTATION_HELD'),{code:'REPORT_DELIVERY_ATTESTATION_HELD'});}
function validate(state,at){
 const b=state?.identity,r=state?.recipient;
 if(state?.kind!=='report_delivery_attestation_v1'||state.phase!=='approved'||!b
  ||!['clientId','deploymentId','dealId','accountId','contactId','configurationVersionId','originalLeadId'].every(k=>ID.test(b[k]||''))
  ||!['configurationVersion','intakeSubmissionId'].every(k=>/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(b[k]||''))
  ||!['authorityDigest','nativeRelationshipEvidenceSha256','configurationSourceDigest'].every(k=>HASH.test(state[k]||''))
  ||!Number.isSafeInteger(state.verifiedAt)||state.verifiedAt<0||state.verifiedAt>at||!Number.isSafeInteger(state.expiresAt)||state.expiresAt<=at
  ||!r||r.contactId!==b.contactId||r.explicitlySelected!==true||r.verified!==true||r.eligible!==true||r.suppressed!==null
  ||r.suppressionStatus!=='provider_enforcement_pending'||!HASH.test(r.consentEvidenceDigest||'')||!HASH.test(r.preflightEvidenceDigest||'')
  ||typeof r.address!=='string'||r.address.length>100||!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(r.address)
  ||!HASH.test(r.verificationDigest||'')||r.nativeRelationshipEvidenceSha256!==state.nativeRelationshipEvidenceSha256
  ||!Number.isSafeInteger(r.verifiedAt)||r.verifiedAt<0||r.verifiedAt%1000!==0||r.verifiedAt>at
  ||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=at||r.expiresAt>state.expiresAt
  ||!Array.isArray(state.actors)||state.actors.length<1||state.actors.length>3
  ||state.actors.some(a=>!['internal_controller','terminal_worker'].includes(a.kind)||!/^operator_[a-f0-9]{64}$/.test(a.identity||'')))held();
 if(new Set(state.actors.map(canonicalJson)).size!==state.actors.length)held();
 return state;
}
function projection(state){
 validate(state,state.verifiedAt);const b=state.identity;
 return {ClientId:b.clientId,DeploymentId:b.deploymentId,ReportType:'free_test_report_delivery_attestation',
  PeriodStart:new Date(state.verifiedAt).toISOString().slice(0,10),PeriodEnd:new Date(state.verifiedAt).toISOString().slice(0,10),ReportVersion:'report-delivery-attestation-v1',
  GenerationStatus:'VerificationPending',ApprovalStatus:'OwnerReviewRequired',DeliveryStatus:'NotSent',
  ReconciliationStatus:'Verified',ActualEstimatedSeparated:true,CrossClientIsolationPassed:true,
  DuplicateSendGuardPassed:false,ReportTotalsReconciled:false,AutoDeliveryEnabledAtRun:false,SchemaVersion:2,ReportFormat:'none'};
}
/** Read only the protected per-test, explicitly selected recipient and exact
 * authenticated actors. No Contacts.Email fallback or mailbox authorization
 * inferred from a timestamp. Authoring this record is an owner-approved binding
 * operation, not a public handler option or automatic qualification.
 */
function createReportDeliveryAttestationReader({store,authorityDigest,resolveDeployment,now=Date.now}={}){
 if(typeof store?.get!=='function'||!HASH.test(authorityDigest||'')||typeof now!=='function')held();
 const read=async(dealId,{signal,deploymentId}={})=>{
  if(!ID.test(dealId||'')||signal?.aborted)held();
  if(deploymentId===undefined){if(typeof resolveDeployment!=='function')held();deploymentId=await resolveDeployment(dealId,{signal});}
  if(signal?.aborted||!ID.test(deploymentId||''))held();
  const row=await store.get(sha(`report-delivery-attestation-v1\0${dealId}\0${deploymentId}`),{signal});
  if(signal?.aborted||row?.state?.authorityDigest!==authorityDigest||row.state.identity?.dealId!==dealId||row.state.identity?.deploymentId!==deploymentId)held();
  return structuredClone(validate(row.state,now()));
 };
 return Object.freeze({read,async authorize({dealId,actor,action,signal}={}){
  if(!['view','initial','resend','project'].includes(action)||!actor||signal?.aborted)return false;
  try{const attestation=await read(dealId,{signal});return attestation.actors.some(a=>canonicalJson(a)===canonicalJson(actor))
   &&(action!=='initial'||actor.kind==='terminal_worker')&&(action!=='resend'||actor.kind==='internal_controller');}catch{return false;}
 }});
}
module.exports={createReportDeliveryAttestationReader,projection,validate};
