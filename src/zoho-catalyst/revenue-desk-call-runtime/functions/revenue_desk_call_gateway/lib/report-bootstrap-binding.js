'use strict';
const crypto=require('node:crypto');
const {encodeReportBootstrap,decodeReportBootstrap,preflightReportBootstrapEnvironment,JSON_KEY,HASH_KEY,PART_PREFIX}=require('./report-bootstrap-transport');
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[1-9][0-9]{2,29}$/;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function held(){throw Object.assign(new Error('REPORT_BOOTSTRAP_HELD'),{code:'REPORT_BOOTSTRAP_HELD'});}
function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
/** Server configuration only. This is a local byte bound, not a claim about
 * Catalyst environment-variable capacity. Installation must qualify capacity.
 * No tokens, Job parameters or HTTP payloads enter this loader. */
function loadReportBootstrapBinding(env=process.env,{now=Date.now}={}){
 if(!Object.hasOwn(env,'REPORT_RUNTIME_BINDING_JSON')&&!Object.hasOwn(env,'REPORT_RUNTIME_BINDING_SHA256')&&!Object.keys(env).some(k=>k.startsWith(PART_PREFIX)))return null;
 const raw=decodeReportBootstrap(env),pin=env.REPORT_RUNTIME_BINDING_SHA256;
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
 // Documented uniqueness is the concurrency boundary. Effectful paths still
 // require exact table/principal/insert/readback qualification; an evidence pin
 // is not itself proof of live access or claim ownership.
 for(const part of [b.attestation,b.delivery,b.reporting]){
  if(part.enabled){const q=part.claimQualification;
   if(q?.mechanism!=='unique_insert_successor_v1'||q.status!=='qualified'||!HASH.test(q.evidenceDigest||'')||!Number.isSafeInteger(q.expiresAt)||q.expiresAt<=now())held();
  }
 }
 if(b.attestation.enabled){
  if(!HASH.test(b.attestation.authorityDigest||'')||!b.attestation.crm)held();
  const allowed=['form1DestinationSha256','form1PublicSubmissionChannel'];
  if(Object.keys(b.attestation.crm).some(k=>!allowed.includes(k)))held();
 }
 validateDeliveryExecution(b,now);
 return freeze(b);
}
// Receipt digests reference independently accepted evidence. They do not
// certify provider access or authorize a caller; only protected installation
// supplies this object, pinned together with the exact source and scope.
function validateDeliveryExecution(b,now){
 const x=b.delivery.execution;
 if(x===undefined)return {deliveryEnabled:false,autoDeliveryEnabled:false,projectionEnabled:false};
 const keys=['deliveryEnabled','autoDeliveryEnabled','projectionEnabled','qualification'];
 if(!x||Array.isArray(x)||Object.keys(x).sort().join(',')!==keys.sort().join(',')
  ||keys.slice(0,3).some(k=>typeof x[k]!=='boolean'))held();
 const enabled=keys.slice(0,3).some(k=>x[k]);
 if(!enabled){if(x.qualification!==null)held();return x;}
 const q=x.qualification,at=now();
 if(!b.delivery.enabled||(x.autoDeliveryEnabled&&(!x.deliveryEnabled||!b.reporting.enabled))
  ||!q||Array.isArray(q)||Object.keys(q).sort().join(',')!=='evidenceDigest,expiresAt,status,verifiedAt'
  ||q.status!=='qualified'||!HASH.test(q.evidenceDigest||'')||/^0+$/.test(q.evidenceDigest)
  ||!Number.isSafeInteger(at)||!Number.isSafeInteger(q.verifiedAt)||q.verifiedAt<0||q.verifiedAt>at
  ||!Number.isSafeInteger(q.expiresAt)||q.expiresAt<=at||q.expiresAt<=q.verifiedAt
  ||q.expiresAt>b.expiresAt||q.expiresAt>b.delivery.claimQualification.expiresAt)held();
 if(b.reporting.enabled){
  const normalize=entries=>{
   if(!Array.isArray(entries)||!entries.length||entries.length>100)held();
   const scope=e=>JSON.stringify(Object.entries(e?.scope||{}).sort(([a],[c])=>a.localeCompare(c)));
   if(new Set(entries.map(scope)).size!==entries.length)held();
   return [...entries].sort((a,c)=>scope(a).localeCompare(scope(c)));
  };
  if(!require('node:util').isDeepStrictEqual(normalize(b.delivery.destinations),normalize(b.reporting.destinations)))held();
 }
 return x;
}
function protectedDeliveryExecution(b,{role,now=Date.now}={}){
 if(!['controller','worker'].includes(role)||typeof now!=='function')held();
 const x=validateDeliveryExecution(b,now);
 // A warm runtime retains its captured binding. Finite expiry, not removal of
 // environment keys, fences future effects; operators must contain dispatch.
 const assertActive=()=>{const at=now();if(!Number.isSafeInteger(at)||at<b.verifiedAt||at>=b.expiresAt)held();validateDeliveryExecution(b,()=>at);return at;};
 assertActive();
 return Object.freeze({deliveryEnabled:x.deliveryEnabled,autoDeliveryEnabled:role==='worker'&&x.autoDeliveryEnabled,
  projectionEnabled:x.projectionEnabled,assertActive});
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
/** Pure offline preparation: complete-map sizing and the existing authority,
 * source and expiry gates pass before returning any stageable configuration.
 * This does not acquire a claim, change environment or invoke a provider. */
function prepareReportBootstrapBinding({raw,bindingSha256,baseline,identityPins,partSize=400,format='deflate-v2',now=Date.now}={}){
 const transport=encodeReportBootstrap(raw,{partSize,format});
 const preflight=preflightReportBootstrapEnvironment({baseline,transport,bindingSha256,identityPins,now});
 loadReportBootstrapBinding({...identityPins,...transport.parts,[JSON_KEY]:transport.marker,[HASH_KEY]:bindingSha256},{now});
 return Object.freeze({...transport,bindingSha256,preflight});
}
module.exports={loadReportBootstrapBinding,prepareReportBootstrapBinding,workerReportActor,protectedDestinations,protectedDeliveryExecution};
