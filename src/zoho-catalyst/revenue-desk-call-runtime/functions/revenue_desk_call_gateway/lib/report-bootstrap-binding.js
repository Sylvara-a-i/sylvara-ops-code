'use strict';
const crypto=require('node:crypto');
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[1-9][0-9]{2,29}$/;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function held(){throw Object.assign(new Error('REPORT_BOOTSTRAP_HELD'),{code:'REPORT_BOOTSTRAP_HELD'});}
function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
/** Server configuration only. This is a local byte bound, not a claim about
 * Catalyst environment-variable capacity. Installation must qualify capacity.
 * No tokens, Job parameters or HTTP payloads enter this loader. */
function loadReportBootstrapBinding(env=process.env,{now=Date.now}={}){
 const raw=env.REPORT_RUNTIME_BINDING_JSON,pin=env.REPORT_RUNTIME_BINDING_SHA256;
 if(raw===undefined&&pin===undefined)return null;
 if(typeof now!=='function'||!Number.isSafeInteger(now())||now()<0)held();
 if(typeof raw!=='string'||Buffer.byteLength(raw)>65536||!HASH.test(pin||'')||sha(raw)!==pin)held();
 let b;try{b=JSON.parse(raw);}catch{held();}
 const keys=['schemaVersion','environment','sourceRevision','projectId','controllerFunctionId','workerFunctionId','verifiedAt','expiresAt','attestation','delivery','reporting'];
 if(!b||Array.isArray(b)||Object.keys(b).sort().join(',')!==keys.sort().join(',')||b.schemaVersion!==1
  ||b.environment!=='development'||env.DEPLOYMENT_ENVIRONMENT!==b.environment||env.SOURCE_REVISION!==b.sourceRevision
  ||!/^[a-f0-9]{40}$/.test(b.sourceRevision||'')||!['projectId','controllerFunctionId','workerFunctionId'].every(k=>ID.test(b[k]||''))
  ||b.controllerFunctionId===b.workerFunctionId||!Number.isSafeInteger(b.verifiedAt)||b.verifiedAt<0||b.verifiedAt>now()
  ||!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=now())held();
 for(const key of ['attestation','delivery','reporting'])if(!b[key]||typeof b[key].enabled!=='boolean')held();
 // Conditional UPDATE documentation does not establish atomic CAS. These
 // effectful paths remain held until separately qualified live evidence is
 // installed. An evidence pin is not itself proof of provider atomicity.
 for(const part of [b.delivery,b.reporting]){
  if(part.enabled){const q=part.casQualification;
   if(q?.status!=='qualified'||!HASH.test(q.evidenceDigest||'')||!Number.isSafeInteger(q.expiresAt)||q.expiresAt<=now())held();
  }
 }
 if(b.attestation.enabled){
  if(!HASH.test(b.attestation.authorityDigest||'')||!b.attestation.crm)held();
  const allowed=['form1DestinationSha256','form1PublicSubmissionChannel'];
  if(Object.keys(b.attestation.crm).some(k=>!allowed.includes(k)))held();
 }
 return freeze(b);
}
function workerReportActor(b){
 if(!b||!ID.test(b.projectId)||!ID.test(b.workerFunctionId))held();
 return Object.freeze({kind:'terminal_worker',identity:'operator_'+sha(`report-worker-actor-v1\0${b.environment}\0${b.projectId}\0${b.workerFunctionId}`)});
}
function protectedDestinations(entries){
 if(!Array.isArray(entries)||entries.length<1||entries.length>100)held();
 const canonical=x=>JSON.stringify(Object.fromEntries(Object.entries(x||{}).sort(([a],[b])=>a.localeCompare(b))));
 return async function readDestinationBinding(scope,{signal}={}){
  if(signal?.aborted)held();const matches=entries.filter(e=>canonical(e.scope)===canonical(scope));
  if(matches.length!==1||!matches[0].binding)held();return structuredClone(matches[0].binding);
 };
}
module.exports={loadReportBootstrapBinding,workerReportActor,protectedDestinations};
