'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {installOfflineGuard}=require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard=installOfflineGuard();test.after(()=>{guard.restore();assert.deepEqual(guard.blocked,[]);});
const {createReconciledReportFixture}=require('./helpers/reconciled-report-fixture');
const {createWorkDriveDraftFixture}=require('./helpers/workdrive-draft-fixture');
const {prepareFreeTestDocument}=require('../../../tools/prepare-free-test-draft');
const {createDurableReportComposition}=require('../../../tools/create-durable-report-composition');
const {createReportDeliveryReaders,createManagedReportDeliveryReaders}=require('../../../tools/create-report-delivery-readers');
const {createReportDeliveryFactory}=require('../../../tools/create-report-delivery-factory');
const {createReportRunStore}=require('../lib/report-run-store');
const {canonicalJson}=require('../lib/facts');
const {loadDeployment}=require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/runtime-service');
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:canonicalJson(x)).digest('hex');
async function fixture(){
 const f=await createReconciledReportFixture(),prepared=await f.readInput(f.identity);
 const source=prepareFreeTestDocument(prepared.input,{now:f.now(),synthetic:true,callDetails:prepared.callDetails});
 const d=createWorkDriveDraftFixture(source,{now:f.now()});
 const pair=await createDurableReportComposition({...f.readerOptions,reportRunStore:d.runs,workdrive:d.workdrive,
  readDestinationBinding:d.readDestinationBinding,now:f.now,synthetic:true,reportBundle:true,
  pdfRenderer:{version:'synthetic-pair-v1',qualificationDigest:'d'.repeat(64),async render(){return Buffer.from('%PDF-1.7\n synthetic source proof\n%%EOF\n');}}})(f.identity);
 const row=await f.runtime.store.unique(f.runtime.config.tables.DEPLOYMENT_TABLE,'DEPLOYMENT_ID',f.identity.deploymentId);
 const deployment=await loadDeployment(f.runtime.store,row,f.runtime.config);
 const config=await f.runtime.store.unique(f.runtime.config.tables.CONFIGURATION_VERSION_TABLE,'CONFIGURATION_VERSION_ID',deployment.configurationVersionId);
 const b={...f.identity,dealId:deployment.crmDealId,accountId:'190000002',contactId:'190000003',configurationVersion:deployment.configurationVersion,
  configurationVersionId:deployment.configurationVersionId,originalLeadId:'190000004',intakeSubmissionId:'intake:test'};
 const native={originalLeadId:b.originalLeadId,journeyId:b.intakeSubmissionId,accountId:b.accountId,contactId:b.contactId,dealId:b.dealId,convertedAt:'2026-08-20T12:00:00.000Z'};
 const actor={kind:'internal_controller',identity:'operator_'+sha('actor')},worker={kind:'terminal_worker',identity:'operator_'+sha('worker')};
 const authorityDigest=sha('authority'),proof={kind:'report_delivery_attestation_v1',phase:'approved',identity:b,authorityDigest,
  nativeRelationshipEvidenceSha256:sha(native),configurationSourceDigest:sha(config.CONFIGURATION_JSON),verifiedAt:f.now(),expiresAt:f.now()+3600000,
  recipient:{contactId:b.contactId,address:'owner@example.invalid',explicitlySelected:true,verified:true,eligible:true,suppressed:null,suppressionStatus:'provider_enforcement_pending',consentEvidenceDigest:'a'.repeat(64),preflightEvidenceDigest:'b'.repeat(64),
   verificationDigest:sha('verified recipient'),nativeRelationshipEvidenceSha256:sha(native),verifiedAt:f.now(),expiresAt:f.now()+3600000},actors:[actor,worker]};
 const request=require('./helpers/report-recipient-fixture').requestEvidence(native,proof.recipient.address);
 const preflight=require('../lib/report-recipient-preflight').qualifyReportRecipient({request,contact:{id:b.contactId,Account_Name:{id:b.accountId},Email:proof.recipient.address,Email_Opt_Out:false},native,now:f.now()});
 proof.recipient.consentEvidenceDigest=preflight.consentEvidenceDigest;proof.recipient.preflightEvidenceDigest=preflight.evidenceDigest;
 await d.runs.insert(sha(`report-delivery-attestation-v1\0${b.dealId}\0${b.deploymentId}`),proof);
 const records={deal:{id:b.dealId,Deployment_Record_ID:b.deploymentId,Configuration_Version:b.configurationVersion,Test_Status:'Completed',
  Account_Name:{id:b.accountId},Contact_Name:{id:b.contactId},Intake_Submission_ID:b.intakeSubmissionId,Test_Report_Revision:pair.manifestSha256,
  Test_Report_Recipient_Email:proof.recipient.address,Email_Opt_Out:false,Test_Report_Recipient_Verified_At:new Date(f.now()).toISOString()},
  contact:{id:b.contactId,Account_Name:{id:b.accountId},Email:proof.recipient.address,Email_Opt_Out:false}};
 const options={...f.readerOptions,reportRunStore:d.runs,crm:{getReportRecords:async()=>structuredClone(records),getReportRequestEvidence:async()=>structuredClone(request)},
  readNativeConversion:async()=>structuredClone(native),readIntakeLineage:async()=>({originalLeadId:b.originalLeadId,journeyId:b.intakeSubmissionId}),
  authorityDigest,privateView:{template:'https://workdrive.zoho.com/file/{resourceId}?version={versionNumber}',qualificationDigest:sha('version URL'),expiresAt:f.now()+3600000},synthetic:true};
 return {f,d,b,pair,proof,records,options,actor,worker};
}
test('actual canonical gate joins immutable pair, native lineage and per-test recipient without render/upload/import effects',async()=>{
 const x=await fixture(),readers=createReportDeliveryReaders(x.options),before=x.d.uploads.length;
 const snapshot=await readers.readSnapshot({dealId:x.b.dealId});
 assert.equal(snapshot.report.manifestSha256,x.pair.manifestSha256);assert.equal(snapshot.recipient.address,'owner@example.invalid');
 assert.equal(snapshot.binding.periodEnd,'2026-08-27');assert.equal(await readers.authorize({dealId:x.b.dealId,actor:x.actor,action:'view'}),true);
 const link=await readers.readPrivateView({dealId:x.b.dealId,summary:snapshot.report.summary,manifestSha256:snapshot.report.manifestSha256});
 assert.equal(link.access,'authenticated_private');assert.match(link.url,/\?version=1$/);assert.equal(x.d.uploads.length,before);
});
test('stale complete-partition proof, corrected source and native lineage mismatch hold before projection',async()=>{
 for(const change of [x=>{x.options.readCompleteScope=async(...args)=>({...await x.f.readCompleteScope(...args),complete:false});},
  x=>{x.proof.configurationSourceDigest=sha('wrong');for(const r of x.d.rows.values())if(r.state.kind==='report_delivery_attestation_v1')r.state.configurationSourceDigest=x.proof.configurationSourceDigest;},
  x=>{x.options.readNativeConversion=async()=>({dealId:'foreign'});}]){
  const x=await fixture();change(x);await assert.rejects(createReportDeliveryReaders(x.options).readProjection({dealId:x.b.dealId}));
 }
});
test('actual SDK ledger factory composes protected readers and private view with delivery switches off',async()=>{
 const x=await fixture(),sdk=require('./helpers/report-run-sdk-fixture').fixture();let credentials=0,network=0;
 const app=sdk.app;app.connections=()=>{credentials++;assert.fail('No credential read allowed');};try{
 const runs=require('../lib/report-successor-store').createReportSuccessorStore({app,environment:'development'});
 for(const r of x.d.rows.values())await runs.insert(r.key,r.state);
 const now=x.f.now(),binding={environment:'development',sourceRevision:x.f.runtime.config.sourceRevision,projectId:app.config.projectId,
  verifiedAt:now-1000,expiresAt:now+3600000,...Object.fromEntries(['schemaDigest','nativeLineageDigest','recipientContractDigest','authorizationContractDigest','storageContractDigest'].map(k=>[k,sha(k)])),
  systemActor:x.worker,crmEmail:{environment:'development',provider:'crm_native',apiOrigin:'https://www.zohoapis.com',fromName:'Sylvara',maxReconciliationPages:3,senderQualificationDigest:sha('sender'),
   fromAddress:'sender@example.invalid',
   contractQualificationDigest:sha('crm email'),verifiedAt:now-1000,expiresAt:now+3600000,timeoutMs:1000,connectionReference:'synthetic_crm_email'}};
 const handler=createReportDeliveryFactory({binding,now:x.f.now,fetchImpl:async()=>{network++;assert.fail('No provider dispatch');},
  createReaders(app,config,store,{reportRunStore}){return {...createReportDeliveryReaders({...x.options,reportRunStore}),readSummary:async()=>Buffer.from('%PDF-1.7\n synthetic source proof\n%%EOF\n')};}})(app,x.f.runtime.config,x.f.runtime.store);
 const result=await handler.handle({profile:'report_delivery_v1',action:'view',dealId:x.b.dealId},{actor:x.actor});
 assert.equal(result.manifestSha256,x.pair.manifestSha256);assert.match(result.url,/version=1$/);
 assert.equal((await handler.afterPair(x.f.identity,x.pair)).status,'held');assert.equal(credentials,0);assert.equal(network,0);
 // Enable only projection in this synthetic local factory. Mail stays disabled.
 x.records.deal.Modified_Time='2026-08-27T12:00:00+00:00';
 delete x.records.deal.Test_Report_Revision;delete x.records.deal.Test_Report_Recipient_Email;
 delete x.records.deal.Test_Report_Recipient_Verified_At;
 binding.crmProjection={environment:'development',apiOrigin:'https://www.zohoapis.com',
  principalQualificationDigest:sha('principal'),schemaDigest:sha('fields'),verifiedAt:now-1000,expiresAt:now+3600000,
  timeoutMs:5000,connectionReference:'synthetic_projection'};
 app.connections=()=>({getConnectionCredentials:async name=>{credentials++;assert.equal(name,'synthetic_projection');
  return {headers:{Authorization:`Zoho-oauthtoken ${'x'.repeat(30)}`}};}});
 const projecting=createReportDeliveryFactory({binding,projectionEnabled:true,now:x.f.now,
  fetchImpl:async(url,request)=>{network++;assert.equal(request.method,'PUT');
   const patch=JSON.parse(request.body).data[0];for(const [k,v] of Object.entries(patch))if(k!=='skip_feature_execution')x.records.deal[k]=v;
   return new Response(JSON.stringify({data:[{status:'success',code:'SUCCESS',details:{id:x.b.dealId}}]}),{headers:{'content-type':'application/json'}});},
  createReaders(app,config,store,{reportRunStore}){return {...createReportDeliveryReaders({...x.options,reportRunStore}),
   readRecords:x.options.crm.getReportRecords,readSummary:async()=>Buffer.from('%PDF-1.7\n synthetic source proof\n%%EOF\n')};}})(app,x.f.runtime.config,x.f.runtime.store);
 assert.equal((await projecting.afterPair(x.f.identity,x.pair)).status,'held');
 assert.equal(network,1);assert.equal(credentials,1);assert.equal(x.records.deal.Test_Report_Revision,x.pair.manifestSha256);
 assert.equal(x.records.deal.Test_Report_Delivery_Status,'Held');
 assert.equal((await projecting.afterPair(x.f.identity,x.pair)).status,'held');assert.equal(network,1);

 }finally{sdk.restore();}

});

test('default managed SDK reader composition constructs without credentials, provider dispatch or datastore access',()=>{
 const {TARGET_TABLE_NAMES}=require('../lib/config');let effects=0;
 const blocked=()=>{effects++;assert.fail('Construction accessed external boundary');};
 const app={config:{projectId:'123456789'},zcql:blocked,datastore:blocked,connections:blocked};
 const runtimeConfig={environment:'development',sourceRevision:'a'.repeat(40)};
 const binding={authorityDigest:sha('authority'),analytics:{environment:'development',catalystEnvironment:'Development',
  sourceRevision:runtimeConfig.sourceRevision,expectedProjectId:app.config.projectId,tables:{outbox:'AnalyticsSyncOutbox',checkpoint:'AnalyticsSyncCheckpoints'},
  provider:{apiBaseUrl:'https://analyticsapi.zoho.com',readConnection:'synthetic_analytics_read',
   targets:Object.fromEntries(Object.entries(TARGET_TABLE_NAMES).map(([kind,table],i)=>[kind,{table,viewId:String(1000+i)}]))}},
  crm:{environment:'development',crmApiBaseUrl:'https://www.zohoapis.com/crm/v8',crmOrganizationId:'123456789',readConnection:'synthetic_crm_read',
   crmOrganizationSha256:sha('org'),form1DestinationSha256:sha('form'),platformTimeoutMs:1000}};
 const readers=createManagedReportDeliveryReaders({app,runtimeConfig,runtimeStore:{},reportRunStore:{get:blocked},binding,readDestinationBinding:blocked,fetchImpl:blocked});
 assert.equal(typeof readers.readSnapshot,'function');assert.equal(typeof readers.readRecords,'function');assert.equal(effects,0);
});

// Join production readers and orchestration; only provider transport and sending
// are synthetic. Every WorkDrive read parses the actual JSON:API/binary envelope.
async function deliveryIntegration({unknownSend=false,unknownProjection=false}={}){
 const x=await fixture();let storageReads=0,sends=0,puts=0,acceptance=null;
 const nativeReader=x.options.readNativeConversion;
 x.options.readNativeConversion=async(...args)=>({...await nativeReader(...args),observedAt:x.f.now()});
 const readers=createReportDeliveryReaders(x.options);
 const workdrive=require('../lib/workdrive-client').createWorkDriveClient({
  apiOrigin:'https://www.zohoapis.com',downloadOrigin:'https://download.zoho.com',timeoutMs:1000,now:x.f.now,
  authorizationProvider:async()=> 'Zoho-oauthtoken synthetic-only',
  async fetchImpl(url,request){
   assert.equal(request.method,'GET');storageReads++;x.f.runtime.clock.value++;
   const u=new URL(url),id=u.pathname.split('/').filter(Boolean).at(-1);
   if(u.origin==='https://download.zoho.com'){
    assert.equal(u.searchParams.get('version'),'1');
    return new Response(x.d.resources.get(id).bytes,{headers:{'content-type':'application/pdf'}});
   }
   let data;
   if(id==='versions'){
    const resourceId=u.pathname.split('/').at(-2),r=x.d.resources.get(resourceId);
    data=r.versions.map(v=>({id:v.versionId,type:'versions',attributes:{resource_id:resourceId,
     version_id:v.versionId,version_number:Number(v.versionNumber),file_size:r.bytes.length,size_in_bytes:'formatted bytes'}}));
   }else{
    const m=id===x.d.parent.id?x.d.parent:x.d.resources.get(id).metadata;
    data={id:m.id,type:'files',attributes:{name:m.name,parent_id:m.parentId,org_id:m.organizationId,
     library_id:m.teamFolderId,is_folder:m.isFolder,storage_info:{size_in_bytes:m.sizeBytes}}};
   }
   return new Response(JSON.stringify({data}),{headers:{'content-type':'application/vnd.api+json'}});
  }});
 const readSummary=require('../lib/report-delivery-storage').createReportDeliveryStorageReader({
  reportRunStore:x.d.runs,workdrive,readDestinationBinding:x.d.readDestinationBinding,now:x.f.now});
 const control=require('../lib/report-delivery-control').createReportDeliveryControl({store:x.d.runs,
  readSnapshot:readers.readSnapshot,authorize:readers.authorize,readSummary,now:x.f.now,autoDeliveryEnabled:true,
  sender:{async sendSummary({operationKey,snapshot,bytes}){
   sends++;assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),x.pair.manifest.artifacts.summary.documentSha256);
   acceptance={accepted:true,operationKey,documentSha256:snapshot.report.summary.documentSha256,
    recipientVerificationDigest:snapshot.recipient.verificationDigest,messageReferenceDigest:sha('synthetic acceptance'),acceptedAt:x.f.now()};
   if(unknownSend)throw Error('synthetic lost send response');return acceptance;
  },async lookupAcceptance(){return acceptance;}}});
 x.records.deal.Modified_Time='2026-08-27T12:00:00+00:00';
 const project=require('../lib/report-crm-projection').createReportCrmProjectionWriter({store:x.d.runs,
  readRecords:x.options.crm.getReportRecords,authorize:readers.authorize,now:x.f.now,
  async readProjection(request){const selected=await readers.readProjection(request);await readSummary({snapshot:selected.snapshot});return selected;},
  authorizationProvider:async()=> 'Zoho-oauthtoken '+ 's'.repeat(30),
  binding:{environment:'development',apiOrigin:'https://www.zohoapis.com',principalQualificationDigest:sha('principal'),
   schemaDigest:sha('schema'),verifiedAt:x.f.now()-1000,expiresAt:x.f.now()+3600000,timeoutMs:5000},
  async fetchImpl(url,request){puts++;assert.equal(request.method,'PUT');assert.ok(url.endsWith('/Deals/'+x.b.dealId));
   const body=JSON.parse(request.body);assert.deepEqual(body.trigger,[]);
   assert.equal(request.headers['If-Unmodified-Since'],x.records.deal.Modified_Time);
   for(const [key,value]of Object.entries(body.data[0]))if(key!=='skip_feature_execution')x.records.deal[key]=value;
   if(unknownProjection&&puts===1)throw Error('synthetic lost conditional PUT response');
   return new Response(JSON.stringify({data:[{status:'success',code:'SUCCESS',details:{id:x.b.dealId}}]}),{headers:{'content-type':'application/json'}});
  }});
 const handlers=require('../lib/report-delivery-handlers').createReportDeliveryHandlers({control,
  readSnapshot:readers.readSnapshot,readPrivateView:readers.readPrivateView,projectReport:project,systemActor:x.worker,now:x.f.now,
  readDealForScope:async()=>({...x.f.identity,dealId:x.b.dealId,testStatus:'Completed'})});
 return {...x,handlers,readers,readSummary,get sends(){return sends;},get puts(){return puts;},get storageReads(){return storageReads;}};
}

test('integrated pair receipts, advancing WorkDrive reads and CRM projection deliver once across resume',async()=>{
 for(const unknownSend of [false,true]){
  const x=await deliveryIntegration({unknownSend}),first=await x.handlers.afterPair(x.f.identity,x.pair);
  assert.equal(first.status,unknownSend?'delivery_reconciliation_required':'provider_accepted');
  assert.equal(x.sends,1);assert.ok(x.storageReads>=12);
  x.f.runtime.clock.value+=1000;
  const resumed=await x.handlers.afterPair(x.f.identity,x.pair);
  assert.equal(resumed.status,'provider_accepted');assert.equal(resumed.crmProjectionStatus,'verified');
  assert.equal(x.records.deal.Test_Report_Delivery_Status,'Provider Accepted');assert.equal(x.sends,1);assert.equal(x.puts,2);
  assert.equal((await x.handlers.afterPair(x.f.identity,x.pair)).status,'provider_accepted');assert.equal(x.puts,2);
  assert.equal(x.d.uploads.length,2);
 }
});

test('integrated unknown conditional projection recovers by exact readback before initial delivery',async()=>{
 const x=await deliveryIntegration({unknownProjection:true});
 assert.equal((await x.handlers.afterPair(x.f.identity,x.pair)).status,'held');assert.equal(x.sends,0);assert.equal(x.puts,1);
 x.f.runtime.clock.value+=1000;
 assert.equal((await x.handlers.afterPair(x.f.identity,x.pair)).status,'provider_accepted');
 assert.equal(x.sends,1);assert.equal(x.puts,2);assert.equal(x.records.deal.Test_Report_Delivery_Status,'Provider Accepted');
});

test('integrated stored byte, version, privacy and recipient failures hold before any send or CRM PUT',async()=>{
 for(const mutate of [x=>{[...x.d.resources.values()][0].bytes[10]^=1;},
  x=>{[...x.d.resources.values()][0].versions[0].versionId='foreign_version';},
  x=>{x.d.binding.externalSharing=true;},x=>{x.records.contact.Email_Opt_Out=true;}]){
  const x=await deliveryIntegration();mutate(x);
  assert.equal((await x.handlers.afterPair(x.f.identity,x.pair)).status,'held');
  assert.equal(x.sends,0);assert.equal(x.puts,0);assert.equal(x.d.uploads.length,2);
 }
});

test('integrated expired authority and changed source cannot resume an ambiguous send',async()=>{
 for(const mutate of [x=>{x.f.runtime.clock.value=x.proof.expiresAt;},
  x=>{x.f.imported.get('call').clear();},
  x=>{x.records.deal.Contact_Name.id='foreign';}]){
  const x=await deliveryIntegration({unknownSend:true});
  assert.equal((await x.handlers.afterPair(x.f.identity,x.pair)).status,'delivery_reconciliation_required');
  mutate(x);
  assert.equal((await x.handlers.afterPair(x.f.identity,x.pair)).status,'held');assert.equal(x.sends,1);
  assert.equal(x.records.deal.Test_Report_Delivery_Status,'Held');assert.equal(x.d.uploads.length,2);
 }
});
