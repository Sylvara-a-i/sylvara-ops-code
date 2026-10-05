'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {installOfflineGuard}=require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard=installOfflineGuard();test.after(()=>{guard.restore();assert.deepEqual(guard.blocked,[]);});
const {canonicalJson}=require('../lib/facts');
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:canonicalJson(x)).digest('hex');
const json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const {stageReportPackage}=require('./helpers/cold-report-package');
const {createReconciledReportFixture}=require('./helpers/reconciled-report-fixture');
const {createCrmReportDeliveryTransport}=require('./helpers/crm-report-delivery-transport-fixture');
const {requestEvidence}=require('./helpers/report-recipient-fixture');

// This stages the reviewed release closure, not a deployed artifact. Both protected
// factories use their defaults; only SDK HTTPS and provider fetch are intercepted.
// Seeded recipient approval is prior durable state, not Controller attestation proof.
async function coldFixture(outcome){
 const ids={deal:'19000000001',account:'19000000002',contact:'19000000003'};
 const f=await createReconciledReportFixture({crmIdentity:ids});
 const pkg=stageReportPackage(f.runtime.config.sourceRevision),at=f.now(),until=at+3600000;
 let sdk,originalFetch;
 try{
 const b={...f.identity,dealId:ids.deal,accountId:ids.account,contactId:ids.contact,
  configurationVersionId:'configuration_A',configurationVersion:f.scope.CONFIGURATION_VERSION,
  originalLeadId:'19000000004',intakeSubmissionId:'synthetic_journey_A'};
 const deployment=await f.runtime.store.unique(f.runtime.config.tables.DEPLOYMENT_TABLE,'DEPLOYMENT_ID',b.deploymentId);
 b.configurationVersionId=deployment.ACTIVE_CONFIGURATION_VERSION_ID;
 const configRow=await f.runtime.store.unique(f.runtime.config.tables.CONFIGURATION_VERSION_TABLE,'CONFIGURATION_VERSION_ID',b.configurationVersionId);
 b.configurationVersion=configRow.CONFIGURATION_VERSION;
 const native={originalLeadId:b.originalLeadId,journeyId:b.intakeSubmissionId,accountId:b.accountId,
  contactId:b.contactId,dealId:b.dealId,convertedAt:'2026-08-20T12:00:00.000Z'};
 const request={...requestEvidence(native,'owner@example.invalid'),Submission_Channel:'Synthetic Public Form',Modified_Time:native.convertedAt};
 const records={deal:{id:b.dealId,Modified_Time:'2026-08-27T12:00:00+00:00',Intake_Submission_ID:b.intakeSubmissionId,
  Deployment_Record_ID:b.deploymentId,Configuration_Version:b.configurationVersion,Test_Status:'Completed',
  Account_Name:{id:b.accountId},Contact_Name:{id:b.contactId}},
  contact:{id:b.contactId,Account_Name:{id:b.accountId},Email:request.Email,Email_Opt_Out:false,
   Unsubscribed_Mode:null,Unsubscribed_Time:null}};
 const {TARGET_TABLE_NAMES}=require('../lib/config');
 const analytics={environment:'development',catalystEnvironment:'Development',sourceRevision:f.runtime.config.sourceRevision,
  expectedProjectId:'123456789',tables:{outbox:'AnalyticsSyncOutbox',checkpoint:'AnalyticsSyncCheckpoints'},
  analyticsTimeoutMs:1000,responseMaxBytes:1048576,platformTimeoutMs:3000,staleAfterMs:7200000,
  provider:{readConnection:'synthetic_analytics',migrationEvidenceDigest:sha('migration'),apiBaseUrl:'https://analyticsapi.zoho.com',
   organizationId:'606',workspaceId:'987654321',targets:Object.fromEntries(Object.entries(TARGET_TABLE_NAMES).map(([kind,table],i)=>[kind,{table,viewId:String(1000+i)}]))}};
 const source=require('../../../tools/prepare-free-test-draft').prepareFreeTestDocument((await f.readInput(f.identity)).input,
  {now:at,callDetails:(await f.readInput(f.identity)).callDetails});
 const wd=require('./helpers/workdrive-draft-fixture').createWorkDriveDraftFixture(source,{now:at});
 const storage={connectionReference:'synthetic_workdrive',apiOrigin:'https://www.zohoapis.com',downloadOrigin:'https://download.zoho.com',
  timeoutMs:1000,contractQualificationDigest:wd.binding.contractQualificationDigest};
 const authorityDigest=sha('authority'),qualification={mechanism:'unique_insert_successor_v1',status:'qualified',evidenceDigest:sha('claim'),expiresAt:until};
 const destinations=[{scope:source.scope,binding:wd.binding}];
 const binding={schemaVersion:1,environment:'development',sourceRevision:f.runtime.config.sourceRevision,projectId:'123456789',
  controllerFunctionId:'123456781',workerFunctionId:'123456782',verifiedAt:at-1000,expiresAt:until,
  attestation:{enabled:false},reporting:{enabled:true,claimQualification:qualification,destinations,
   options:{analyticsConfig:analytics,workdriveBinding:storage,pdfBinding:{apiOrigin:'https://api.catalyst.zoho.com',projectId:'123456789',
    organizationId:'606',environment:'Development',connectionReference:'synthetic_pdf',timeoutMs:1000,version:'smartbrowz-native-inter41-v1',qualificationDigest:sha('pdf')},
    acceptance:{environment:'development',sourceRevision:f.runtime.config.sourceRevision,verifiedAt:at-1000,expiresAt:until,
     schemaDigest:sha('schema'),analyticsContractDigest:sha('analytics'),workdriveContractDigest:storage.contractQualificationDigest,
     releaseCompositionDigest:sha('release'),pdfRendererDigest:sha('pdf')}}},
  delivery:{enabled:true,claimQualification:qualification,destinations,
   execution:{deliveryEnabled:true,autoDeliveryEnabled:true,projectionEnabled:true,
    qualification:{status:'qualified',evidenceDigest:sha('execution'),verifiedAt:at-1000,expiresAt:until}},
   binding:{environment:'development',sourceRevision:f.runtime.config.sourceRevision,projectId:'123456789',verifiedAt:at-1000,expiresAt:until,
    schemaDigest:sha('schema'),nativeLineageDigest:sha('native'),recipientContractDigest:sha('recipient'),authorizationContractDigest:sha('authorization'),
    storageContractDigest:storage.contractQualificationDigest,storage,
    readers:{analytics,authorityDigest,crm:{environment:'development',crmApiBaseUrl:'https://www.zohoapis.com/crm/v8',crmOrganizationId:'606',
     readConnection:'synthetic_report_read',crmOrganizationSha256:sha('org'),form1DestinationSha256:sha('form'),form1PublicSubmissionChannel:request.Submission_Channel,platformTimeoutMs:1000},
     privateView:{template:'https://workdrive.zoho.com/file/{resourceId}?version={versionNumber}',qualificationDigest:sha('private URL'),expiresAt:until}},
    crmProjection:{environment:'development',apiOrigin:'https://www.zohoapis.com',principalQualificationDigest:sha('principal'),schemaDigest:sha('fields'),
     verifiedAt:at-1000,expiresAt:until,timeoutMs:1000,connectionReference:'synthetic_projection'},
    crmEmail:{environment:'development',provider:'crm_native',apiOrigin:'https://www.zohoapis.com',
     fromAddress:'reports@example.invalid',fromName:'Sylvara',
     connectionReference:'synthetic_report_mail',contractQualificationDigest:sha('mail'),senderQualificationDigest:sha('sender'),verifiedAt:at-1000,
     expiresAt:until,timeoutMs:1000,maxReconciliationPages:3}}}};
 const gateway=file=>require(path.join(pkg.gateway,'lib',file));
 const worker=gateway('report-bootstrap-binding').workerReportActor(binding);
 const actor={kind:'internal_controller',identity:'operator_'+sha('controller')};
 const selected=require('../lib/report-recipient-preflight').qualifyReportRecipient({request,contact:records.contact,native,now:at});
 const proof={kind:'report_delivery_attestation_v1',phase:'approved',identity:b,authorityDigest,
  nativeRelationshipEvidenceSha256:sha(native),configurationSourceDigest:sha(configRow.CONFIGURATION_JSON),verifiedAt:at,expiresAt:until,
  recipient:{contactId:b.contactId,address:request.Email,explicitlySelected:true,verified:true,eligible:true,suppressed:null,
   suppressionStatus:'provider_enforcement_pending',consentEvidenceDigest:selected.consentEvidenceDigest,preflightEvidenceDigest:selected.evidenceDigest,
   verificationDigest:sha('recipient verification'),nativeRelationshipEvidenceSha256:sha(native),verifiedAt:at,expiresAt:until},actors:[worker,actor]};
 const mail=await createCrmReportDeliveryTransport({f,b,records,proof,d:wd,options:{crm:{getReportRequestEvidence:async()=>request}}},{outcome});
 const checkpoints=[...f.analyticsStore.checkpoints.values()].map((r,i)=>({...r,ROWID:String(6000+i)}));
 let queries=0,checkpointWrites=0,puts=0,pdfs=0;const connections=[];
 const sqlValue=text=>text.startsWith("'")?text.slice(1,-1).replaceAll("''","'"):text==='NULL'?null:text==='TRUE'?true:text==='FALSE'?false:Number(text);
 const equalities=text=>[...text.matchAll(/([A-Z_]+) = ('(?:''|[^'])*'|NULL|TRUE|FALSE|\d+)/g)].map(m=>[m[1],sqlValue(m[2])]);
 sdk=require('./helpers/report-run-sdk-fixture').fixture({credentialType:'admin',async providerTransport({path:route,payload,principal}){
  if(route.startsWith('/connection-details?')){
   assert.equal(principal,'admin');const ref=new URL('https://synthetic.invalid'+route).searchParams.get('connection-link-name');
   const allowed=['synthetic_analytics','synthetic_workdrive','synthetic_pdf','synthetic_report_read','synthetic_report_mail','synthetic_projection'];assert.ok(allowed.includes(ref));
   connections.push(ref);
   return {data:{headers:{Authorization:mail.tokens[ref]||'Zoho-oauthtoken '+ref.padEnd(30,'x')},parameters:{}}};
  }
  if(route!=='/query'||payload.query.includes('ReportRuns'))return null;
  queries++;const sql=payload.query;
  if(sql.startsWith('UPDATE AnalyticsSyncCheckpoints SET ')){
   const [set,where]=sql.split(' SET ')[1].split(' WHERE '),conditions=equalities(where);
   assert.equal(conditions.length,5);const row=checkpoints.find(r=>conditions.every(([k,v])=>r[k]===v));assert.ok(row);
   Object.assign(row,Object.fromEntries(equalities(set)));checkpointWrites++;return {data:[]};
  }
  assert.ok(sql.startsWith('SELECT '));const table=/ FROM ([A-Za-z0-9_]+)/.exec(sql)?.[1];
  if(table==='RevenueLeakTestRequestFormSessions')return {data:[]};
  const rows=table==='AnalyticsSyncOutbox'?f.analyticsStore.rows:table==='AnalyticsSyncCheckpoints'?checkpoints:
   table==='RevenueDeskEventReceipts'?[...f.runtime.store.authorizationRows,...f.runtime.store.rows.get(table)]:f.runtime.store.rows.get(table);
  assert.ok(rows,`Unexpected synthetic table ${table}`);const conditions=equalities(sql);
  return {data:rows.filter(r=>conditions.every(([k,v])=>r[k]===v)).map(r=>({[table]:structuredClone(r)}))};
 }});
 const metadata=m=>({id:m.id,type:'files',attributes:{name:m.name,parent_id:m.parentId,org_id:m.organizationId,library_id:m.teamFolderId,
  is_folder:m.isFolder,storage_info:{size_in_bytes:m.sizeBytes}}});
 async function fetchImpl(url,init){
  const u=new URL(url);f.runtime.clock.value++;
  if(u.origin==='https://analyticsapi.zoho.com'){
   assert.equal(init.headers.Authorization,'Zoho-oauthtoken '+'synthetic_analytics'.padEnd(30,'x'));
   assert.equal(init.method,'GET');const view=/\/views\/(\d+)/.exec(u.pathname)?.[1],entry=Object.entries(analytics.provider.targets).find(([,v])=>v.viewId===view);assert.ok(entry);
   const [kind,target]=entry;
   if(!u.pathname.endsWith('/data'))return json({status:'success',data:{views:{viewId:view,viewName:target.table,viewType:'Table',workspaceId:analytics.provider.workspaceId,orgId:'606'}}});
   const config=JSON.parse(u.searchParams.get('CONFIG'));assert.equal(config.keyValueFormat,true);assert.doesNotMatch(config.criteria,/LIMIT|RECORD_KEY/);
   return json({data:[...(f.imported.get(kind)?.values()||[])].map(r=>Object.fromEntries(config.selectedColumns.map(k=>[k,r[k]])))});
  }
  if(u.origin==='https://api.catalyst.zoho.com'){
   assert.equal(init.headers.Authorization,'Zoho-oauthtoken '+'synthetic_pdf'.padEnd(30,'x'));
   assert.equal(u.pathname,'/browser360/v1/project/123456789/convert');assert.equal(init.method,'POST');assert.equal(init.headers.Environment,'Development');
   const payload=JSON.parse(init.body);assert.equal(payload.page_options.javascript_enabled,false);assert.match(payload.html,/@font-face/);pdfs++;
   return new Response(Buffer.from('%PDF-1.7\n synthetic cold composition\n%%EOF\n'),{headers:{'content-type':'application/pdf'}});
  }
  if(u.origin==='https://download.zoho.com'){
   assert.equal(init.headers.Authorization,'Zoho-oauthtoken '+'synthetic_workdrive'.padEnd(30,'x'));
   assert.equal(init.method,'GET');assert.equal(u.searchParams.get('version'),'1');return new Response(wd.resources.get(u.pathname.split('/').at(-1)).bytes,{headers:{'content-type':'application/pdf'}});
  }
  if(u.pathname.startsWith('/workdrive/')){
   assert.equal(init.headers.Authorization,'Zoho-oauthtoken '+'synthetic_workdrive'.padEnd(30,'x'));
   if(u.pathname.endsWith('/upload')){
    assert.equal(init.method,'POST');assert.equal(init.body.get('override-name-exist'),'false');
    const content=init.body.get('content');await wd.workdrive.upload({parentId:init.body.get('parent_id'),filename:decodeURIComponent(init.body.get('filename')),bytes:Buffer.from(await content.arrayBuffer())});return json({});
   }
   assert.equal(init.method,'GET');const id=u.pathname.split('/').at(-1),resource=u.pathname.split('/').at(-2);
   if(id==='files')return json({data:[...wd.resources.values()].map(r=>metadata(r.metadata)),links:{cursor:{has_next:false}}});
   if(id==='versions')return json({data:wd.resources.get(resource).versions.map(v=>({id:v.versionId,type:'versions',attributes:{resource_id:resource,version_id:v.versionId,version_number:v.versionNumber,file_size:v.sizeBytes}}))});
   return json({data:metadata(id===wd.parent.id?wd.parent:wd.resources.get(id).metadata)});
  }
  if(u.pathname==='/crm/v8/Leads/search'){
   assert.equal(init.headers.Authorization,mail.tokens.synthetic_report_read);
   assert.equal(init.method,'GET');assert.equal(u.searchParams.get('criteria'),`(Intake_Submission_ID:equals:${b.intakeSubmissionId})`);
   return json({data:[request],info:{count:1,page:1,more_records:false}});
  }
  if(u.pathname==='/crm/v8/Leads'&&u.searchParams.get('fields').split(',').length===8){
   assert.equal(init.headers.Authorization,mail.tokens.synthetic_report_read);
   assert.equal(init.method,'GET');assert.equal(u.searchParams.get('ids'),b.originalLeadId);return json({data:[request],info:{count:1,more_records:false}});
  }
  if(init.method==='PUT'){
   assert.equal(init.headers.Authorization,'Zoho-oauthtoken '+'synthetic_projection'.padEnd(30,'x'));
   assert.equal(u.pathname,'/crm/v8/Deals/'+b.dealId);assert.equal(init.headers['If-Unmodified-Since'],records.deal.Modified_Time);
   const payload=JSON.parse(init.body);assert.deepEqual(payload.trigger,[]);for(const [k,v]of Object.entries(payload.data[0]))if(k!=='skip_feature_execution')records.deal[k]=v;
   puts++;return json({data:[{status:'success',code:'SUCCESS',details:{id:b.dealId}}]});
  }
  return mail.fetchImpl(url,init);
 }
 originalFetch=globalThis.fetch;globalThis.fetch=fetchImpl;
 const runtimeConfig={...f.runtime.config,projectId:'123456789'};
 const runtimeStore=gateway('catalyst-store').createCatalystStore(sdk.app,runtimeConfig);
 const runs=require(path.join(pkg.analytics,'functions/analytics_sync/lib/report-successor-store')).createReportSuccessorStore({app:sdk.app,environment:'development'});
 await runs.insert(sha(`report-delivery-attestation-v1\0${b.dealId}\0${b.deploymentId}`),proof);
 const raw=JSON.stringify(binding),environment={SOURCE_REVISION:binding.sourceRevision,DEPLOYMENT_ENVIRONMENT:'development',REPORT_RUNTIME_BINDING_JSON:raw,REPORT_RUNTIME_BINDING_SHA256:sha(raw)};
 const boot=()=>require(path.join(pkg.controller,'worker-lib/report-bootstrap')).createProtectedWorkerReportOptions(environment,{now:f.now})
  .terminalDraftReconcilerFactory(sdk.app,runtimeConfig,runtimeStore);
 const controller=()=>require(path.join(pkg.controller,'lib/report-bootstrap')).createProtectedReportController({environment,now:f.now,fetchImpl})(sdk.app,runtimeConfig,runtimeStore);
 return {f,b,records,proof,wd,mail,sdk,boot,controller,actor,binding,connections,
  counters:()=>({queries,checkpointWrites,puts,pdfs}),restore(){globalThis.fetch=originalFetch;sdk.restore();pkg.restore();}};
 }catch(error){if(originalFetch)globalThis.fetch=originalFetch;sdk?.restore();pkg.restore();throw error;}
}

test('cold protected worker/default adapters publish private pair and deliver once; new Controller and worker resume exact state',async()=>{
 for(const outcome of ['accepted','unknown_send']){
  const x=await coldFixture(outcome);
  try{
   const first=await x.boot()(x.f.identity);
   assert.equal(first.status,'report_pair_verified_not_for_delivery');
   assert.equal(first.deliveryStatus,outcome==='accepted'?'provider_accepted':'delivery_reconciliation_required');
   assert.equal(x.mail.sends,1);assert.equal(x.mail.uploads,1);assert.equal(x.wd.uploads.length,2);
   assert.equal(x.counters().pdfs,2);assert.equal(x.counters().checkpointWrites,0);assert.ok(x.counters().queries>0);
   assert.deepEqual([...new Set(x.connections)].sort(),['synthetic_analytics','synthetic_pdf','synthetic_projection','synthetic_report_mail','synthetic_report_read','synthetic_workdrive']);
   // The protected worker preserves the normal retry cadence on a new instance.
   assert.equal((await x.boot()(x.f.identity)).status,'awaiting_reconciled_evidence');
   assert.equal(x.mail.sends,1);
   if(outcome==='unknown_send'){
    x.records.contact.Email_Opt_Out=true;x.f.runtime.clock.value+=900001;
    assert.equal((await x.boot()(x.f.identity)).deliveryStatus,'held');
    await assert.rejects(x.controller().handle({profile:'report_delivery_v1',action:'view',dealId:x.b.dealId},{actor:x.actor}));
    assert.equal(x.mail.details,0);assert.equal(x.mail.sends,1);
    x.records.contact.Email_Opt_Out=false;
   }
   x.f.runtime.clock.value+=900001;
   const resumed=await x.boot()(x.f.identity);assert.equal(resumed.deliveryStatus,'provider_accepted');
   assert.equal(x.mail.sends,1);assert.equal(x.mail.uploads,1);assert.equal(x.counters().pdfs,2);assert.equal(x.wd.uploads.length,2);
   const view=await x.controller().handle({profile:'report_delivery_v1',action:'view',dealId:x.b.dealId},{actor:x.actor});
   assert.match(view.url,/version=1$/);assert.equal(x.records.deal.Test_Report_Delivery_Status,'Provider Accepted');
   x.records.contact.Email_Opt_Out=true;
   x.f.runtime.clock.value+=900001;
   assert.equal((await x.boot()(x.f.identity)).deliveryStatus,'held');
   await assert.rejects(x.controller().handle({profile:'report_delivery_v1',action:'view',dealId:x.b.dealId},{actor:x.actor}));
   assert.equal(x.mail.sends,1);assert.equal(x.mail.uploads,1);
  }finally{x.restore();}
 }
});
