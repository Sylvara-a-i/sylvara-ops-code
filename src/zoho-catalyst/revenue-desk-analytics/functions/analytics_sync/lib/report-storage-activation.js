'use strict';
const crypto=require('node:crypto');
const {canonicalJson}=require('./facts');
const {diagnosticWindowMs,PROFILE}=require('./report-storage-window');
const HASH=/^[a-f0-9]{64}$(?![\s\S])/,ID=/^[1-9][0-9]{2,29}$(?![\s\S])/;
const ROLES=Object.freeze(['ownerAuthorization','ownership','access']);
const MINIMUM_ACTIVATION_REMAINING_MS=27000;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function held(){throw Object.assign(new Error('REPORT_STORAGE_QUALIFICATION_HELD'),{code:'REPORT_STORAGE_QUALIFICATION_HELD'});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function dormantOperationDigest(bindingSha256){
 if(typeof bindingSha256!=='string'||!HASH.test(bindingSha256))held();
 // Fresh evidence and lease timestamps must never create another receipt key.
 return hash(canonicalJson({mechanism:'dormant_unique_insert_successor_v1',bindingSha256}));
}
/** Schema 6 uses the existing lossless tuple shape. Zero times mean dormant,
 * never infinite authority. Only a separately authenticated command can supply
 * current evidence. Static evidence digests commit reviewed facts/approval scope,
 * not a falsely refreshed timestamp on a historical provider response. */
function validateDormantBinding(b){
 if(!exact(b,['schemaVersion','enabled','environment','sourceRevision','projectId','controlHost','tableId','nonce',
  'capability','verifiedAt','expiresAt','timeoutMs','singleAdmittedInvocation'])
  ||b.schemaVersion!==6||b.enabled!==false||b.environment!=='development'||b.singleAdmittedInvocation!==true
  ||b.verifiedAt!==0||b.expiresAt!==0||b.timeoutMs!==25000
  ||typeof b.sourceRevision!=='string'||!/^[a-f0-9]{40}$(?![\s\S])/.test(b.sourceRevision)
  ||typeof b.projectId!=='string'||!ID.test(b.projectId)||typeof b.tableId!=='string'||!ID.test(b.tableId)
  ||typeof b.controlHost!=='string'||!/^[a-z0-9][a-z0-9.-]{0,252}$(?![\s\S])/.test(b.controlHost)
  ||typeof b.nonce!=='string'||!/^[a-f0-9]{32}$(?![\s\S])/.test(b.nonce)
  ||!exact(b.capability,['region','origin','controllerFunctionId','deploymentId','sdkVersion','authMode','authType','creatorPolicy','tables','evidence'])
  ||!exact(b.capability.evidence,ROLES))held();
 for(const evidence of Object.values(b.capability.evidence)){
  if(!exact(evidence,['digest','verifiedAt','expiresAt'])||typeof evidence.digest!=='string'||!HASH.test(evidence.digest)
   ||evidence.verifiedAt!==0||evidence.expiresAt!==0)held();
 }
 return b;
}
/** Pure validation, not authentication or a provider read. The HTTP boundary
 * authenticates the operator before this command is accepted. Fresh receipts
 * attest independent reads of the committed facts; hashes/times alone do not
 * prove those reads occurred. Runtime capability validation remains mandatory. */
function activateDormantBinding(binding,bindingSha256,activation,now){
 validateDormantBinding(binding);
 if(hash(JSON.stringify(binding))!==bindingSha256
  ||!exact(activation,['schemaVersion','bindingSha256','operationDigest','verifiedAt','expiresAt','evidence'])
  ||activation.schemaVersion!==1||activation.bindingSha256!==bindingSha256
  ||activation.operationDigest!==dormantOperationDigest(bindingSha256)
  ||!exact(activation.evidence,ROLES)||!Number.isSafeInteger(now)||now<0)held();
 const windowMs=diagnosticWindowMs({schemaVersion:6,profile:PROFILE,environment:'development'});
 const {verifiedAt,expiresAt}=activation;
 if(!Number.isSafeInteger(verifiedAt)||verifiedAt<0||!Number.isSafeInteger(expiresAt)
  ||verifiedAt>now||expiresAt-verifiedAt>windowMs||expiresAt-now<MINIMUM_ACTIVATION_REMAINING_MS)held();
 const evidence={};
 for(const role of ROLES){
  const current=activation.evidence[role];
  if(!exact(current,['stateSha256','digest','verifiedAt','expiresAt'])
   ||current.stateSha256!==binding.capability.evidence[role].digest||typeof current.digest!=='string'||!HASH.test(current.digest)
   ||!Number.isSafeInteger(current.verifiedAt)||current.verifiedAt<0||current.verifiedAt>verifiedAt
   ||verifiedAt-current.verifiedAt>windowMs||!Number.isSafeInteger(current.expiresAt)
   ||current.expiresAt-current.verifiedAt>windowMs||current.expiresAt<expiresAt)held();
  evidence[role]={digest:current.digest,verifiedAt:current.verifiedAt,expiresAt:current.expiresAt};
 }
 // No reference to the mutable request survives validation or the first await.
 const active=structuredClone(binding);
 Object.assign(active,{enabled:true,verifiedAt,expiresAt});active.capability.evidence=evidence;
 return Object.freeze({binding:freeze(active),activationDigest:hash(canonicalJson({bindingSha256,verifiedAt,expiresAt,evidence}))});
}
module.exports={validateDormantBinding,activateDormantBinding,dormantOperationDigest,MINIMUM_ACTIVATION_REMAINING_MS};
