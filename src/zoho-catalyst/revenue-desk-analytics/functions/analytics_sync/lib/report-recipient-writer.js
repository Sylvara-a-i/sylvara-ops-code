'use strict';
const crypto=require('node:crypto');
const {canonicalJson}=require('./facts');
const {validate}=require('./report-delivery-attestation');
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:canonicalJson(x)).digest('hex');
function held(){throw Object.assign(new Error('REPORT_RECIPIENT_ATTESTATION_HELD'),{code:'REPORT_RECIPIENT_ATTESTATION_HELD'});}
/** Immutable unique insertion, not read-then-write CAS. A changed/expired
 * recipient remains held for controlled revision design; no overwrite/retry. */
function createReportRecipientWriter({store,readSetup,authorityDigest,systemActor,now=Date.now,expiresAt,timeoutMs=15000}={}){
 if(typeof store?.get!=='function'||typeof store.insert!=='function'||typeof readSetup!=='function'
  ||!/^[a-f0-9]{64}$/.test(authorityDigest||'')||systemActor?.kind!=='terminal_worker'
  ||!/^operator_[a-f0-9]{64}$/.test(systemActor.identity||'')||typeof now!=='function'||!Number.isSafeInteger(expiresAt)
  ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)held();
 async function run(command,{actor,signal,started,wall}={}){
  const active=()=>{if(signal?.aborted||now()>=expiresAt||now()<started||now()-started>=timeoutMs||performance.now()>=wall)held();};active();
  if(Object.keys(command||{}).sort().join(',')!=='action,confirmed,dealId,profile,recipientEmail'
   ||command.profile!=='report_delivery_v1'||command.action!=='attest_recipient'||command.confirmed!==true
   ||actor?.kind!=='internal_controller'||!/^operator_[a-f0-9]{64}$/.test(actor.identity||''))held();
  const proof=await readSetup({dealId:command.dealId,actor,signal});active();
  if(proof?.authorizedActor!==actor.identity||proof.recipientEmail!==command.recipientEmail
   ||proof.crmEmailOptOut!==false||proof.suppression?.status!=='provider_enforcement_pending'
   ||!/^[a-f0-9]{64}$/.test(proof.suppression.consentEvidenceDigest||'')
   ||!/^[a-f0-9]{64}$/.test(proof.suppression.evidenceDigest||'')
   ||!Number.isSafeInteger(proof.suppression.expiresAt)||proof.suppression.expiresAt<=now())held();
  const identity=proof.identity,key=sha(`report-delivery-attestation-v1\0${identity?.dealId}\0${identity?.deploymentId}`);
  const selectionDigest=sha({identity,address:proof.recipientEmail,native:proof.nativeRelationshipEvidenceSha256,
   configuration:proof.configurationSourceDigest,suppression:proof.suppression.evidenceDigest,actor});
  const prior=await store.get(key,{signal});active();
  const matches=row=>{
   try{const s=validate(row?.state,now());return s.authorityDigest===authorityDigest
    &&s.expiresAt<=Math.min(expiresAt,proof.suppression.expiresAt)
    &&s.recipient.expiresAt<=Math.min(expiresAt,proof.suppression.expiresAt)
    &&s.recipient.verificationDigest===selectionDigest
    &&canonicalJson(s.identity)===canonicalJson(identity)&&s.recipient.address===proof.recipientEmail
    &&s.configurationSourceDigest===proof.configurationSourceDigest
    &&s.nativeRelationshipEvidenceSha256===proof.nativeRelationshipEvidenceSha256
    &&JSON.stringify(s.actors.map(canonicalJson))===JSON.stringify([actor,systemActor].map(canonicalJson));}catch{return false;}
  };
  if(prior){if(!matches(prior))held();return {status:'recipient_attested',replayed:true};}
  const fresh=await readSetup({dealId:command.dealId,actor,signal});active();
  if(canonicalJson(fresh)!==canonicalJson(proof))held();
  const verifiedAt=Math.floor(now()/1000)*1000,expiry=Math.min(expiresAt,proof.suppression.expiresAt);
  const state={kind:'report_delivery_attestation_v1',phase:'approved',identity,authorityDigest,
   configurationSourceDigest:proof.configurationSourceDigest,nativeRelationshipEvidenceSha256:proof.nativeRelationshipEvidenceSha256,
   verifiedAt,expiresAt:expiry,actors:[actor,systemActor],recipient:{contactId:identity.contactId,address:proof.recipientEmail,
    explicitlySelected:true,verified:true,eligible:true,suppressed:null,suppressionStatus:'provider_enforcement_pending',
    consentEvidenceDigest:proof.suppression.consentEvidenceDigest,preflightEvidenceDigest:proof.suppression.evidenceDigest,verificationDigest:selectionDigest,
    nativeRelationshipEvidenceSha256:proof.nativeRelationshipEvidenceSha256,verifiedAt,expiresAt:expiry}};
  validate(state,now());active();
  // Store.insert reconciles ambiguous acceptance by independent exact readback.
  // Never issue a second insertion after an unknown outcome in this request.
  const accepted=await store.insert(key,state,{signal});active();if(!matches(accepted))held();
  return {status:'recipient_attested',replayed:false};
 }
 return async function attest(command,{actor,signal}={}){
  if(signal!==undefined&&!(signal instanceof AbortSignal))held();
  const abort=new AbortController(),start=now(),wall=performance.now()+timeoutMs;
  let reject;const deadline=new Promise((_,r)=>{reject=r;});
  const cancel=()=>{abort.abort();reject(Object.assign(new Error('REPORT_RECIPIENT_ATTESTATION_HELD'),{code:'REPORT_RECIPIENT_ATTESTATION_HELD'}));};
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  const timer=setTimeout(cancel,timeoutMs);
  try{
   const result=await Promise.race([run(command,{actor,signal:abort.signal,started:start,wall}),deadline]);
   if(abort.signal.aborted||now()<start||now()-start>=timeoutMs||performance.now()>=wall)held();
   return result;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);abort.abort();}
  // Abort prevents subsequent dispatch. It does not promise cancellation of
  // already dispatched SDK writes; unknown outcomes remain held for readback.
 };
}
module.exports={createReportRecipientWriter};
