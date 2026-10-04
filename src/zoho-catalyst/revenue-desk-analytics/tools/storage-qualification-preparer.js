'use strict';
// Local preparation only. No environment, credential, provider or runtime access.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// Codec is injected by the private kit or loaded from the existing source owner.
const defaultCodec=()=>require('../functions/analytics_sync/lib/report-storage-binding');
const canonical=x=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Invalid canonical object');return JSON.stringify(Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])));};
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:canonical(x)).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
function stop(){throw Error('LOCAL_PREPARATION_HELD');}
function read(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
const MINIMUM_REMAINING_MS=600000;
function diagnosticWindow(root,schemaVersion){
 const local=path.join(root,'report-storage-window.js');
 const policy=fs.existsSync(local)?require(local):require('../functions/analytics_sync/lib/report-storage-window');
 return policy.diagnosticWindowMs({schemaVersion,profile:policy.PROFILE,environment:'development'});
}
function remainingWindow(records,expiresAt,at,windowMs){
 if(!Number.isSafeInteger(at)||!Number.isSafeInteger(expiresAt)||expiresAt-at<MINIMUM_REMAINING_MS||expiresAt-at>windowMs)stop();
 for(const role of roles){const raw=records[role]?.[role==='installation'||role==='ownerAuthorization'?'verifiedAt':'observedAt'];const time=typeof raw==='string'?Date.parse(raw):raw;
  if(!Number.isSafeInteger(time)||time>at||time+windowMs-at<MINIMUM_REMAINING_MS||expiresAt>time+windowMs)stop();}
}
function validate(input,{at=Date.now(),root,staticOnly=false,nonce,codec}={}){
 if(!root)stop();
 if(!exact(input,['metadataFile','projectMappingFile','controlsFile','installationFile','sizingFile','ownerAuthorization',...(staticOnly?[]:['expiresAt','operatorReady'])]))stop();
 if((!staticOnly&&input.operatorReady!==true)||!exact(input.ownerAuthorization,['digest','verifiedAt'])||!HASH.test(input.ownerAuthorization.digest||''))stop();
 const b=read(path.join(root,'binding.template.json')),pins=read(path.join(root,'reviewed-pins.json'));
 if(![3,4].includes(b.schemaVersion)||b.environment!=='development'||b.enabled!==false||b.sourceRevision!==pins.sourceRevision||b.projectId!==pins.projectId||b.capability?.controllerFunctionId!==pins.controllerFunctionId||b.capability?.deploymentId!==pins.deploymentId||b.singleAdmittedInvocation!==true||b.nonce!=='<FRESH_32_HEX_NONCE_ONLY_WHEN_READY>')stop();
 const windowMs=diagnosticWindow(root,b.schemaVersion);
 const metadata=read(input.metadataFile),mapping=read(input.projectMappingFile),controls=read(input.controlsFile),install=read(input.installationFile);
 const sizing=read(input.sizingFile);
 const fresh=time=>Number.isSafeInteger(time)&&time>=0&&time<=at&&(staticOnly||at-time<=windowMs);
 if(!exact(sizing,['observedAt','baseline'])||!fresh(Date.parse(sizing.observedAt)))stop();
 const metaAt=Date.parse(metadata.observedAt),mapAt=Date.parse(mapping.observedAt),controlAt=Date.parse(controls.observedAt);
 if(![metaAt,mapAt,controlAt,install.verifiedAt,input.ownerAuthorization.verifiedAt].every(fresh)
  ||(!staticOnly&&(!Number.isSafeInteger(input.expiresAt)||input.expiresAt<=at||input.expiresAt-at>windowMs)))stop();
 if(metadata.organization!==pins.organization||metadata.project!==pins.projectId||metadata.environment!=='Development'
  ||mapping.project?.id!==pins.projectId||!Array.isArray(metadata.metadata)||metadata.metadata.length!==6||!Array.isArray(mapping.tables)||mapping.tables.length!==2)stop();
 if(!exact(install,['sourceRevision','controllerFunctionId','archiveSha256','fileCount','allFilesMatch','independentReadback','verifiedAt'])
  ||install.sourceRevision!==pins.sourceRevision||install.controllerFunctionId!==pins.controllerFunctionId
  ||install.archiveSha256!==pins.archiveSha256||install.fileCount!==pins.fileCount||install.allFilesMatch!==true||install.independentReadback!==true)stop();
 if(controls.organization!==pins.organization||controls.projectId!==pins.projectId||controls.environment!=='Development'
  ||controls.controllerFunctionId!==pins.controllerFunctionId||controls.sourceRevision!==pins.sourceRevision
  ||controls.retellRouteMode!=='disabled'||controls.deploymentMode!=='active'
  ||!Array.isArray(controls.storagePartKeys)||controls.storagePartKeys.length!==0
  ||controls.runtimeInvoked!==false)stop();
 // Static review can precede descriptor configuration, but absence must be explicit.
 // Active preparation still requires matching pins; configuration changes need a new review.
 const matchingDescriptors=controls.controllerPinMatches===true&&controls.deploymentPinMatches===true
  &&(!staticOnly||['controllerPinPresent','deploymentPinPresent'].every(key=>!Object.hasOwn(controls,key)||controls[key]===true));
 const absentDescriptors=staticOnly&&controls.controllerPinPresent===false&&controls.deploymentPinPresent===false
  &&controls.controllerPinMatches===false&&controls.deploymentPinMatches===false;
 if(!matchingDescriptors&&!absentDescriptors)stop();
 for(const role of ['runtime','storage','context']){
  const x=controls.bindings?.[role];if(!x||x.jsonPresent!==false||x.pinPresent!==false||x.enabled!==false)stop();
 }
 const sender=controls.bindings?.sender;
 if(!sender||sender.enabled!==false||sender.jsonPresent!==false||sender.pinPresent!==false)stop();
 for(const [role,count]of [['reportRuns',33],['eventReceipts',29]]){
  const descriptor=b.capability.tables[role],map=mapping.tables.find(x=>x.name===descriptor.name);
  const pid=typeof map?.projectId==='object'?map.projectId.id:map?.projectId;
  if(!map||map.id!==descriptor.id||pid!==pins.projectId)stop();
  const list=op=>{const found=metadata.metadata.filter(x=>x.name===descriptor.name&&x.id===descriptor.id&&x.op===op);
   if(found.length!==1||!Array.isArray(found[0].data)||found[0].held)stop();return found[0].data;};
  const columns=list('list_all_columns'),permissions=list('get_table_permissions'),scopes=list('get_table_scopes');
  if(columns.length!==count||new Set(columns.map(x=>x.column_name)).size!==count)stop();
  const unique=columns.filter(x=>x.is_unique===true),key=unique.find(x=>x.column_name===descriptor.uniqueField);
  if(!key||key.is_mandatory!==true||key.data_type!=='varchar')stop();
  const fields=pins.projections[role];
  if(!fields.every(k=>columns.some(x=>x.column_name===k))||descriptor.projectionSha256!==sha({projection:fields}))stop();
  for(const name of role==='reportRuns'?['ReportPayloadJson']:['EVENT_DATA_JSON']){
   if(columns.find(x=>x.column_name===name)?.data_type!=='encrypted text')stop();
  }
  const admin=permissions.find(x=>x.role_name==='App Administrator'),user=permissions.find(x=>x.role_name==='App User');
  if(permissions.length!==2||!admin?.permissions?.includes('SELECT')||!admin.permissions.includes('INSERT')
   ||!user||!Array.isArray(user.permissions)||user.permissions.length!==0||scopes.length!==2
   ||!scopes.some(x=>x.role_id===admin.role_id&&x.scope==='GLOBAL')
   ||!scopes.some(x=>x.role_id===user.role_id&&x.scope===(role==='reportRuns'?'USER':'GLOBAL')))stop();
  descriptor.schemaSha256=sha({tableId:descriptor.id,name:descriptor.name,columns});
  descriptor.uniquenessSha256=sha({tableId:descriptor.id,name:descriptor.name,unique});
 }
 const originals={metadata,mapping,controls,installation:install,sizing,ownerAuthorization:input.ownerAuthorization};
 const baseline=sizing.baseline;
 if(!exact(baseline,['serializedBytes','entryCount','controlledEntries'])||!Number.isSafeInteger(baseline.serializedBytes)||baseline.serializedBytes<2||!Number.isSafeInteger(baseline.entryCount)||baseline.entryCount<0||!Array.isArray(baseline.controlledEntries))stop();
 const known=new Set();let contributions=0;
 for(const e of baseline.controlledEntries){if(!exact(e,['key','serializedEntryBytes'])||!['REPORT_CONTROLLER_FUNCTION_ID','REPORT_DEPLOYMENT_ID'].includes(e.key)||known.has(e.key)||!Number.isSafeInteger(e.serializedEntryBytes)||e.serializedEntryBytes<Buffer.byteLength(JSON.stringify(e.key))+3)stop();known.add(e.key);contributions+=e.serializedEntryBytes;}
 if(known.size>baseline.entryCount||contributions>baseline.serializedBytes-2-Math.max(0,baseline.entryCount-1)||baseline.entryCount===0&&baseline.serializedBytes!==2)stop();
 if(staticOnly)return {originals,pins};
 if(!/^[a-f0-9]{32}$/.test(nonce||''))stop();b.nonce=nonce;
 const {encodeStorageBinding,preflightStorageEnvironment}=codec||defaultCodec();
 const evidence={ownerAuthorization:{digest:input.ownerAuthorization.digest,verifiedAt:input.ownerAuthorization.verifiedAt,expiresAt:input.expiresAt},
  ownership:{digest:sha({mapping,installation:install,controls}),verifiedAt:Math.min(mapAt,install.verifiedAt,controlAt),expiresAt:input.expiresAt},
  access:{digest:sha(metadata),verifiedAt:metaAt,expiresAt:input.expiresAt}};
 Object.assign(b,{enabled:true,verifiedAt:at,expiresAt:input.expiresAt});b.capability.evidence=evidence;
 const raw=JSON.stringify(b),pin=sha(raw),capabilitySha256=sha(b.capability);
 if(Buffer.byteLength(raw)>4096||![3,4].includes(b.schemaVersion)||b.capability.creatorPolicy!=='observed_consistent_v1'||!/^[a-f0-9]{32}$/.test(b.nonce||''))stop();
 const operationDigest=sha({mechanism:'unique_insert_successor_v1',projectId:b.projectId,tables:b.capability.tables,
  nonce:b.nonce,sourceRevision:b.sourceRevision,capabilitySha256});
 const caller=fs.readFileSync(path.join(root,'caller.template.ds'),'utf8')
  .replaceAll('__OPERATION_DIGEST__',operationDigest).replaceAll('__VERIFIED_AT__',String(at)).replaceAll('__EXPIRES_AT__',String(input.expiresAt));
 if(/__[A-Z_]+__/.test(caller))stop();
 const transport=encodeStorageBinding(raw,{partSize:400,format:'tuple-v1'});
 const sizePreflight=preflightStorageEnvironment({baseline:sizing.baseline,transport,bindingSha256:pin,descriptorPins:{REPORT_CONTROLLER_FUNCTION_ID:pins.controllerFunctionId,REPORT_DEPLOYMENT_ID:pins.deploymentId}});
 return {binding:b,raw,pin,operationDigest,capabilitySha256,caller,transport,
  manifest:{sourceRevision:b.sourceRevision,bindingSha256:pin,operationDigest,capabilitySha256,
   verifiedAt:at,expiresAt:input.expiresAt,maximumDataStoreAttempts:13,maximumRetainedSyntheticRows:3,sizePreflight,
   transport:{format:'tuple-v1',marker:transport.marker,partSize:400,partKeys:Object.keys(transport.parts),activationKey:'REPORT_STORAGE_QUALIFICATION_JSON',hashKey:'REPORT_STORAGE_QUALIFICATION_SHA256',activationLast:true,disarmFirst:true},
   keys:{admission:'report-storage:'+operationDigest,root:'revenue-desk-report-v1:'+operationDigest,
    successor:'revenue-desk-report-v2:'+operationDigest+':0000000002'},
   namedIdentityVerified:false,qualificationAuthority:false,deliveryAuthority:false,armed:false,invoked:false}};
}
function write(result,destination,{root,at=Date.now()}={}){
 if(!root||result?.binding?.enabled!==true||typeof result.raw!=='string'||sha(result.raw)!==result.pin||!HASH.test(result.operationDigest||'')||!result.reattestation||!path.isAbsolute(destination)||fs.existsSync(destination))stop();
 remainingWindow(result.reattestation.observations,result.binding.expiresAt,at,diagnosticWindow(root,result.binding.schemaVersion));
 // One final claim per kit workspace; failure never renews or overwrites it.
 const lock=path.join(root,'PREPARATION-CLAIM.json');
 fs.writeFileSync(lock,JSON.stringify({operationDigest:result.operationDigest,destination,preparedAt:at,invoked:false}),{flag:'wx'});
 fs.mkdirSync(destination,{recursive:false});
 const files={'REPORT_STORAGE_QUALIFICATION_JSON.txt':result.transport.marker,'reconstructed-binding-private.txt':result.raw,'REPORT_STORAGE_QUALIFICATION_SHA256.txt':result.pin,
  'managed-caller.ds':result.caller,'prepared-manifest.json':JSON.stringify(result.manifest,null,2),'reattestation-private.json':JSON.stringify(result.reattestation,null,2)};
 for(const [key,value]of Object.entries(result.transport.parts))files[key+'.txt']=value;
 for(const [name,bytes]of Object.entries(files))fs.writeFileSync(path.join(destination,name),bytes,{flag:'wx'});
 return {status:'prepared_local_only_not_armed',sourceRevision:result.binding.sourceRevision,
  operationDigest:result.operationDigest,bindingSha256:result.pin,expiresAt:result.binding.expiresAt,
  maximumDataStoreAttempts:13,maximumRetainedSyntheticRows:3,sizePreflight:result.manifest.sizePreflight,providerRequests:0};
}

// Recursive canonical state hashing preserves arrays and all original records.
function canonicalState(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalState).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalState(value[k])).join(',')+'}';
}
const digest=value=>sha(canonicalState(value));
const roles=['metadata','mapping','controls','installation','sizing','ownerAuthorization'];
const templates=['binding.template.json','reviewed-pins.json','caller.template.ds'];
function state(record,role){const copy=structuredClone(record);delete copy[role==='installation'||role==='ownerAuthorization'?'verifiedAt':'observedAt'];return copy;}
const templateDigests=root=>Object.fromEntries(templates.map(name=>[name,sha(fs.readFileSync(path.join(root,name),'utf8'))]));
function review(input,options={}){
 const {originals,pins}=validate(input,{...options,staticOnly:true});
 return {schemaVersion:1,status:'static_review_only',executable:false,reviewedAt:options.at??Date.now(),
  sourceRevision:pins.sourceRevision,templates:templateDigests(options.root),originals,
  originalsDigest:digest(originals),stateDigests:Object.fromEntries(roles.map(role=>[role,digest(state(originals[role],role))])),
  maximumDataStoreAttempts:13,maximumRetainedSyntheticRows:3,singleAdmittedInvocation:true};
}
function writeReview(result,destination){
 if(result?.status!=='static_review_only'||result.executable!==false||!path.isAbsolute(destination)||fs.existsSync(destination))stop();
 fs.writeFileSync(destination,JSON.stringify(result,null,2),{flag:'wx'});
 return {status:'static_review_only',executable:false,reviewSha256:sha(fs.readFileSync(destination,'utf8'))};
}
// Provenance references document independent reads; they are not provider signatures.
function validateReview(prior,root){
 if(!exact(prior,['schemaVersion','status','executable','reviewedAt','sourceRevision','templates','originals','originalsDigest','stateDigests','maximumDataStoreAttempts','maximumRetainedSyntheticRows','singleAdmittedInvocation'])||prior.schemaVersion!==1||prior.status!=='static_review_only'||prior.executable!==false||prior.maximumDataStoreAttempts!==13||prior.maximumRetainedSyntheticRows!==3||prior.singleAdmittedInvocation!==true||digest(prior.originals)!==prior.originalsDigest||!exact(prior.originals,roles)||!exact(prior.stateDigests,roles)||!exact(prior.templates,templates)||canonicalState(prior.templates)!==canonicalState(templateDigests(root)))stop();
}
function prepare(input,options={}){
 if(!exact(input,['staticReviewFile','metadataFile','projectMappingFile','controlsFile','installationFile','sizingFile','ownerAuthorization','expiresAt','operatorReady','nonce','provenanceFile']))stop();
 const prior=read(input.staticReviewFile),provenance=read(input.provenanceFile),at=options.at??Date.now();
 validateReview(prior,options.root);
 if(!exact(provenance,['schemaVersion','observations'])||provenance.schemaVersion!==1||!exact(provenance.observations,roles))stop();
 const files={metadata:input.metadataFile,mapping:input.projectMappingFile,controls:input.controlsFile,installation:input.installationFile,sizing:input.sizingFile};
 const records=Object.fromEntries(roles.map(role=>[role,role==='ownerAuthorization'?input.ownerAuthorization:read(files[role])]));
 return prepareRecords(input,options,prior,provenance,records,at);
}
function prepareRecords(input,options,prior,provenance,records,at){
 const windowMs=diagnosticWindow(options.root,read(path.join(options.root,'binding.template.json')).schemaVersion);
 remainingWindow(records,input.expiresAt,at,windowMs);
 for(const role of roles){
  const original=prior.originals[role],current=records[role],p=provenance.observations[role];
  const key=role==='installation'||role==='ownerAuthorization'?'verifiedAt':'observedAt';
  const time=x=>typeof x==='string'?Date.parse(x):x;
  const observed=time(current[key]),before=time(original[key]);
  if(digest(state(original,role))!==prior.stateDigests[role]||digest(state(current,role))!==prior.stateDigests[role]
   ||!Number.isSafeInteger(observed)||observed<=before||observed>at||at-observed>windowMs
   ||!exact(p,['method','reference','observedAt','recordSha256'])||p.method!=='independent_current_read'
   ||typeof p.reference!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(p.reference)||p.observedAt!==observed||p.recordSha256!==digest(current))stop();
 }
 const final={...input};for(const key of ['staticReviewFile','nonce','provenanceFile'])delete final[key];
 const result=validate(final,{...options,nonce:input.nonce});
 if(result.binding.sourceRevision!==prior.sourceRevision)stop();
 result.reattestation={schemaVersion:1,originals:prior.originals,originalsDigest:prior.originalsDigest,stateDigests:prior.stateDigests,observations:records,provenance,reviewSha256:sha(fs.readFileSync(input.staticReviewFile,'utf8'))};
 return result;
}
// This witness is an audit assertion from a genuine independent read, not a provider signature.
// The full record is explicitly derived from the retained original and the witnessed timestamp.
function prepareWitnesses(input,options={}){
 if(!exact(input,['staticReviewFile','witnessFile','expiresAt','operatorReady','stagingDirectory']))stop();
 if(input.operatorReady!==true)stop();
 const prior=read(input.staticReviewFile),envelope=read(input.witnessFile),at=options.at??Date.now();
 if(!exact(envelope,['schemaVersion','kind','staticReviewSha256','witnesses','sha256'])||envelope.schemaVersion!==1||envelope.kind!=='current_read_witnesses_v1'||envelope.staticReviewSha256!==sha(fs.readFileSync(input.staticReviewFile,'utf8'))||!exact(envelope.witnesses,roles))stop();
 const body={schemaVersion:envelope.schemaVersion,kind:envelope.kind,staticReviewSha256:envelope.staticReviewSha256,witnesses:envelope.witnesses};if(digest(body)!==envelope.sha256)stop();
 validateReview(prior,options.root);
 const records={},provenance={schemaVersion:1,observations:{}};
 for(const role of roles){const w=envelope.witnesses[role];
  if(!exact(w,['role','method','reference','observedAt','stateSha256','recordSha256'])||w.role!==role||w.method!=='independent_current_read'||typeof w.reference!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(w.reference)||!Number.isSafeInteger(w.observedAt)||w.stateSha256!==prior.stateDigests?.[role]||digest(state(prior.originals?.[role],role))!==w.stateSha256)stop();
  const key=['installation','ownerAuthorization'].includes(role)?'verifiedAt':'observedAt';records[role]=structuredClone(prior.originals[role]);records[role][key]=key==='observedAt'?new Date(w.observedAt).toISOString():w.observedAt;
  const originalTime=typeof prior.originals[role][key]==='string'?Date.parse(prior.originals[role][key]):prior.originals[role][key];if(w.observedAt<=originalTime)stop();
  if(digest(records[role])!==w.recordSha256)stop();provenance.observations[role]={method:w.method,reference:w.reference,observedAt:w.observedAt,recordSha256:w.recordSha256};
 }
 remainingWindow(records,input.expiresAt,at,diagnosticWindow(options.root,read(path.join(options.root,'binding.template.json')).schemaVersion));
 if(!path.isAbsolute(input.stagingDirectory)||fs.existsSync(input.stagingDirectory)||fs.existsSync(path.join(options.root,'PREPARATION-CLAIM.json')))stop();
 fs.mkdirSync(input.stagingDirectory);const save=(name,value)=>{const f=path.join(input.stagingDirectory,name);fs.writeFileSync(f,JSON.stringify(value),{flag:'wx'});return f;};
 const full={staticReviewFile:input.staticReviewFile,ownerAuthorization:records.ownerAuthorization,expiresAt:input.expiresAt,operatorReady:input.operatorReady,provenanceFile:save('provenance.json',provenance),nonce:crypto.randomBytes(16).toString('hex')};
 for(const [role,key]of Object.entries({metadata:'metadataFile',mapping:'projectMappingFile',controls:'controlsFile',installation:'installationFile',sizing:'sizingFile'}))full[key]=save(role+'.json',records[role]);
 const result=prepare(full,{...options,at});result.reattestation.evidenceForm='derived_original_plus_current_read_witness_v1';result.reattestation.witnessEnvelope=envelope;return result;
}
function verifyObservationText(envelope){
 if(!exact(envelope,['schemaVersion','kind','text','utf8Bytes','sha256'])||envelope.schemaVersion!==1||envelope.kind!=='synthetic_transport_probe_v1'||typeof envelope.text!=='string'||Buffer.byteLength(envelope.text)!==envelope.utf8Bytes||sha(envelope.text)!==envelope.sha256)stop();
 return {status:'synthetic_text_verified',utf8Bytes:envelope.utf8Bytes,sha256:envelope.sha256};
}
module.exports={review,writeReview,prepare,prepareWitnesses,write,canonical,sha,canonicalState,digest,verifyObservationText,MINIMUM_REMAINING_MS};
