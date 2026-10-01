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
  recipient:{contactId:b.contactId,address:'owner@example.invalid',explicitlySelected:true,verified:true,eligible:true,suppressed:false,
   verificationDigest:sha('verified recipient'),nativeRelationshipEvidenceSha256:sha(native),verifiedAt:f.now(),expiresAt:f.now()+3600000},actors:[actor,worker]};
 await d.runs.insert(sha(`report-delivery-attestation-v1\0${b.dealId}\0${b.deploymentId}`),proof);
 const records={deal:{id:b.dealId,Deployment_Record_ID:b.deploymentId,Configuration_Version:b.configurationVersion,Test_Status:'Completed',
  Account_Name:{id:b.accountId},Contact_Name:{id:b.contactId},Intake_Submission_ID:b.intakeSubmissionId,Test_Report_Revision:pair.manifestSha256,
  Test_Report_Recipient_Email:proof.recipient.address,Email_Opt_Out:false,Test_Report_Recipient_Verified_At:new Date(f.now()).toISOString()},
  contact:{id:b.contactId,Account_Name:{id:b.accountId},Email:proof.recipient.address,Email_Opt_Out:false}};
 const options={...f.readerOptions,reportRunStore:d.runs,crm:{getReportRecords:async()=>structuredClone(records)},
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
 const x=await fixture(),raw=new Map();let credentials=0,network=0;
 const app={config:{projectId:'123456789',environment:'Development'},zcql(){return {executeZCQLQuery:async sql=>{
  assert.match(sql,/^SELECT /);const key=/IdempotencyKey = '([^']+)'/.exec(sql)[1];return raw.has(key)?[{ReportRuns:structuredClone(raw.get(key))}]:[];}};},
  datastore(){return {table:()=>({insertRow:async row=>{if(!raw.has(row.IdempotencyKey))raw.set(row.IdempotencyKey,{...row,ROWID:String(raw.size+1)});}})};},
  connections(){credentials++;assert.fail('No credential read allowed');}};
 const runs=createReportRunStore({app,environment:'development'});
 for(const r of x.d.rows.values())await runs.insert(r.key,r.state);
 const now=x.f.now(),binding={environment:'development',sourceRevision:x.f.runtime.config.sourceRevision,projectId:app.config.projectId,
  verifiedAt:now-1000,expiresAt:now+3600000,...Object.fromEntries(['schemaDigest','nativeLineageDigest','recipientContractDigest','authorizationContractDigest','storageContractDigest'].map(k=>[k,sha(k)])),
  systemActor:x.worker,mail:{environment:'development',apiOrigin:'https://mail.zoho.com',
   accountId:'123456789',fromAddress:'sender@example.invalid',
   contractQualificationDigest:sha('mail'),verifiedAt:now-1000,expiresAt:now+3600000,timeoutMs:1000,connectionReference:'synthetic_mail'}};
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
 const select=app.zcql;app.zcql=()=>({executeZCQLQuery:async sql=>{
  if(sql.startsWith('SELECT '))return select().executeZCQLQuery(sql);
  assert.match(sql,/^UPDATE ReportRuns /);
  const key=/IdempotencyKey = '([^']+)'/.exec(sql)[1],row=raw.get(key);
  const expected=Number(/AND RD_REPORT_VERSION = (\d+)$/.exec(sql)[1]);
  if(row.RD_REPORT_VERSION===expected){row.ReportPayloadJson=/ReportPayloadJson = '((?:''|[^'])*)'/.exec(sql)[1].replaceAll("''", "'");
   row.RD_REPORT_VERSION=expected+1;row.ReconciliationStatus='Verified';}
  return [];
 }});
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
