'use strict';
const crypto=require('node:crypto');
const {canonicalJson}=require('../functions/analytics_sync/lib/facts');
const {createReportAttemptBudget,REPORT_ATTEMPT_MAXIMUMS}=require('../functions/analytics_sync/lib/report-attempt-budget');
const {createReportDeliveryAttestationReader}=require('../functions/analytics_sync/lib/report-delivery-attestation');
const {createDealReportSnapshotReader}=require('../functions/analytics_sync/lib/report-delivery-snapshot');
const {createReconciledFreeTestInputReader}=require('./read-reconciled-free-test-input');
const {prepareFreeTestDocument}=require('./prepare-free-test-draft');
const {loadDeployment}=require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/runtime-service');
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:canonicalJson(x)).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
function held(){throw Object.assign(new Error('REPORT_DELIVERY_SELECTION_HELD'),{code:'REPORT_DELIVERY_SELECTION_HELD'});}
/** Concrete read-only canonical selection. The existing complete Analytics gate
 * and renderer's source identity own freshness; a completed CRM field, receipt
 * timestamp or protected binding cannot replace them. Never import, reattest a
 * checkpoint, render a PDF or replay a CRM effect from a delivery read.
 */
function createReportDeliveryReaders({runtimeStore,runtimeConfig,analyticsStore,readCompleteScope,
 reportRunStore:runs,crm,readNativeConversion,readIntakeLineage,authorityDigest,privateView,
 readOpportunityReview=null,now=Date.now,synthetic=false}={}){
 if(!runs||typeof runs.get!=='function'||typeof crm?.getReportRecords!=='function'
  ||![readNativeConversion,readIntakeLineage,now].every(f=>typeof f==='function')
  ||(readOpportunityReview!==null&&typeof readOpportunityReview!=='function'))held();
 const attestation=createReportDeliveryAttestationReader({store:runs,authorityDigest,now,
  async resolveDeployment(dealId,{signal}={}){
   if(signal?.aborted)held();const records=await crm.getReportRecords(dealId,{signal});
   const id=records?.deal?.Deployment_Record_ID;if(signal?.aborted||typeof id!=='string')held();
   const row=await runtimeStore.unique(runtimeConfig.tables.DEPLOYMENT_TABLE,'DEPLOYMENT_ID',id);
   if(signal?.aborted)held();const deployment=await loadDeployment(runtimeStore,row,runtimeConfig);
   if(signal?.aborted||deployment.crmDealId!==dealId||deployment.configurationVersion!==records.deal.Configuration_Version)held();
   return id;
  }});
 async function readCanonicalSelection({dealId,signal}={}){
  const budget=createReportAttemptBudget({signal,timeoutMs:10000,now,limits:{...REPORT_ATTEMPT_MAXIMUMS,
   checkpoint_write:0,workdrive_read:0,workdrive_write:0,report_run_write:0}});
  const active=()=>budget.assertActive(),options={signal:budget.signal,budget};
  const guarded={};for(const method of ['unique','query','queryBounded'])guarded[method]=async(...args)=>{
   active();budget.consume('source_read');const value=await runtimeStore[method](...args);active();return value;};
  try{
   active();const proof=await attestation.read(dealId,options);active();const b=proof.identity;
   const row=await guarded.unique(runtimeConfig.tables.DEPLOYMENT_TABLE,'DEPLOYMENT_ID',b.deploymentId);active();
   if(row?.CLIENT_ID!==b.clientId||row.TEST_STATUS!=='Completed'||row.REPORT_RECONCILIATION_STATUS!=='Completed')held();
   const deployment=await loadDeployment(guarded,row,runtimeConfig);active();
   if(deployment.crmDealId!==dealId||deployment.configurationVersion!==b.configurationVersion
    ||deployment.configurationVersionId!==b.configurationVersionId)held();
   const configRow=await guarded.unique(runtimeConfig.tables.CONFIGURATION_VERSION_TABLE,'CONFIGURATION_VERSION_ID',b.configurationVersionId);
   if(sha(configRow?.CONFIGURATION_JSON||'')!==proof.configurationSourceDigest)held();
   const lineage=await readIntakeLineage(b.intakeSubmissionId,options);active();
   if(lineage?.originalLeadId!==b.originalLeadId||lineage.journeyId!==b.intakeSubmissionId)held();
   const read=createReconciledFreeTestInputReader({runtimeStore,runtimeConfig,analyticsStore,readCompleteScope,now});
   const prepared=await read({clientId:b.clientId,deploymentId:b.deploymentId},options);active();
   const review=readOpportunityReview===null?null:await readOpportunityReview({clientId:b.clientId,deploymentId:b.deploymentId},options);active();
   const source=prepareFreeTestDocument(prepared.input,{callDetails:prepared.callDetails,opportunityReview:review,now:now(),synthetic});
   const identity={clientId:b.clientId,deploymentId:b.deploymentId,environment:runtimeConfig.environment,
    sourceRevision:runtimeConfig.sourceRevision,configurationVersionId:b.configurationVersionId,
    periodStart:source.periodStart,periodEnd:source.periodEnd};
   const attempt=await runs.get(sha(`report-attempt-v1\0${canonicalJson(identity)}`),options);active();
   if(attempt?.state?.kind!=='report_attempt_v1'||attempt.state.phase!=='verified'
    ||canonicalJson(attempt.state.identity)!==canonicalJson(identity)||!HASH.test(attempt.state.lastGenerationKey||''))held();
   const bundle=await runs.get(attempt.state.lastGenerationKey,options);active();
   const state=bundle?.state,m=state?.manifest,reviewSha=sha({review:review??null});
   if(state?.kind!=='report_bundle_v1'||state.phase!=='accepted'||!m
    ||state.identity?.clientId!==b.clientId||state.identity.deploymentId!==b.deploymentId
    ||state.identity.configurationVersionId!==b.configurationVersionId||state.identity.sourceRevision!==runtimeConfig.sourceRevision
    ||state.identity.periodStart!==source.periodStart||state.identity.periodEnd!==source.periodEnd
    ||state.identity.sourceGenerationKey!==source.generationKey||m.sourceGenerationKey!==source.generationKey
    ||state.identity.reviewSnapshotSha256!==reviewSha||m.reviewSnapshotSha256!==reviewSha
    ||sha(m)!==state.manifestSha256||m.initialDeliveryArtifact!=='summary'||m.supportingAvailability!=='private')held();
   const fresh=await attestation.read(dealId,options);active();if(canonicalJson(fresh)!==canonicalJson(proof))held();
   return {binding:Object.fromEntries(['clientId','deploymentId','dealId','accountId','contactId','configurationVersion','periodStart','periodEnd'].map(k=>[k,k==='periodStart'?source.periodStart:k==='periodEnd'?source.periodEnd:b[k]])),
    originalLeadId:b.originalLeadId,report:{completed:true,fresh:true,validated:true,generationKey:bundle.key,
     manifestSha256:state.manifestSha256,sourceRevisionDigest:sha({sourceGenerationKey:source.generationKey,
      configurationSourceDigest:proof.configurationSourceDigest,reviewSnapshotSha256:reviewSha}),
     summary:{role:'summary',...m.artifacts.summary}}};
  }catch{held();}finally{budget.close();}
 }
 const readRecipientAttestation=async({binding,nativeRelationshipEvidenceSha256,signal}={})=>{
  const proof=await attestation.read(binding.dealId,{signal,deploymentId:binding.deploymentId});
  if(proof.nativeRelationshipEvidenceSha256!==nativeRelationshipEvidenceSha256
   ||!Object.entries(binding).filter(([k])=>!['periodStart','periodEnd'].includes(k)).every(([k,v])=>proof.identity[k]===v))held();return proof.recipient;
 };
 const common={crm,readCanonicalSelection,readRecipientAttestation,readNativeConversion,now};
 const readSnapshot=createDealReportSnapshotReader(common);
 const readProjectionSnapshot=createDealReportSnapshotReader({...common,requireProjection:false});
 async function readPrivateView({dealId,summary,manifestSha256,signal}={}){
  if(signal?.aborted||!privateView||!HASH.test(privateView.qualificationDigest||'')
   ||!Number.isSafeInteger(privateView.expiresAt)||privateView.expiresAt<=now()
   ||typeof privateView.template!=='string'||!privateView.template.includes('{resourceId}')
   ||!/(\{versionId\}|\{versionNumber\})/.test(privateView.template))held();
  const proof=await attestation.read(dealId,{signal});
  const row=await runs.get(summary.privateReceiptKey,{signal});if(signal?.aborted)held();
  const state=row?.state,r=state?.receipt;
  if(state?.kind!=='workdrive_draft_v1'||state.phase!=='verified'||state.identity.clientId!==proof.identity.clientId
   ||state.identity.deploymentId!==proof.identity.deploymentId||state.identity.documentSha256!==summary.documentSha256
   ||state.identity.generationKey!==summary.generationKey||!r||r.documentSha256!==summary.documentSha256)held();
  let url=privateView.template;
  for(const k of ['resourceId','versionId','versionNumber']){
   if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(r[k]||''))held();url=url.replaceAll(`{${k}}`,encodeURIComponent(r[k]));
  }
  let parsed;try{parsed=new URL(url);}catch{held();}
  if(parsed.origin!=='https://workdrive.zoho.com'||parsed.username||parsed.password||url.length>450
   ||/[{}\r\n\x00]/.test(url)||privateView.expiresAt<=now())held();
  return {url,access:'authenticated_private',qualificationDigest:privateView.qualificationDigest,
   expiresAt:Math.min(privateView.expiresAt,proof.expiresAt),manifestSha256,documentSha256:summary.documentSha256};
 }
 return Object.freeze({readSnapshot,authorize:attestation.authorize,readPrivateView,
  async readProjection({dealId,signal}={}){
   const snapshot=await readProjectionSnapshot({dealId,signal});
   const link=await readPrivateView({dealId,signal,summary:snapshot.report.summary,manifestSha256:snapshot.report.manifestSha256});
   return {snapshot,link};
  }});
}
/** Existing SDK/read Connections composition. Constructor arguments are private
 * installation bindings; none are accepted from a Job or CRM command body.
 */
function createManagedReportDeliveryReaders({app,runtimeConfig,runtimeStore,reportRunStore,binding,
 readDestinationBinding,readOpportunityReview=null,fetchImpl=globalThis.fetch,now=Date.now,synthetic=false}={}){
 const a=binding?.analytics,c=binding?.crm;
 if(!a||!c||a.environment!=='development'||a.catalystEnvironment!=='Development'
  ||a.sourceRevision!==runtimeConfig.sourceRevision||a.expectedProjectId!==String(app?.config?.projectId)
  ||!HASH.test(binding.authorityDigest||'')||typeof readDestinationBinding!=='function'
  ||c.crmApiBaseUrl!=='https://www.zohoapis.com/crm/v8'||!/^\d{3,30}$/.test(c.crmOrganizationId||'')
  ||!HASH.test(c.crmOrganizationSha256||'')||!HASH.test(c.form1DestinationSha256||''))held();
 const {createConnectionAuthorizationProvider}=require('../functions/analytics_sync/lib/connection-boundary');
 const {createCatalystStore}=require('../functions/analytics_sync/lib/catalyst-store');
 const {createAnalyticsClient}=require('../functions/analytics_sync/lib/analytics-client');
 const {analyticsHost,parseTargets}=require('../functions/analytics_sync/lib/config');
 const {createCrmControlClient}=require('../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/crm-client');
 const {createConfigurationSourceReader}=require('../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/configuration-source-reader');
 const {createConfigurationConversionReader}=require('../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/configuration-conversion-reader');
 const config=structuredClone(a);config.provider.apiBaseUrl=analyticsHost(config.provider.apiBaseUrl);
 config.provider.targets=parseTargets(JSON.stringify(Object.fromEntries(Object.entries(config.provider.targets||{}).map(([kind,target])=>
  [kind,{table:target.table,view_id:target.viewId}]))));
 const auth=ref=>createConnectionAuthorizationProvider(app,ref,3000);
 const analyticsStore=createCatalystStore(app,config);
 const analytics=createAnalyticsClient({config,readAuthorizationProvider:auth(config.provider.readConnection),
  writeAuthorizationProvider:async()=>held(),fetchImpl,now});
 const crm=createCrmControlClient(c,{readAuthorization:auth(c.readConnection),writeAuthorization:async()=>held(),fetchImpl});
 const source=createConfigurationSourceReader(app,c,{now});
 const conversion=createConfigurationConversionReader({crm,now});
 const readers=createReportDeliveryReaders({runtimeStore,runtimeConfig,analyticsStore,
  readCompleteScope:analytics.readCompleteScope,reportRunStore,crm,readNativeConversion:conversion.readConversion,
  async readIntakeLineage(journeyId,{signal}={}){
   if(signal?.aborted)held();const assisted=await source.findAssistedLineage(journeyId);if(signal?.aborted)held();
   if(assisted!==null)return assisted;const publicLead=await crm.getPublicOriginalLead(journeyId);
   if(signal?.aborted)held();return publicLead;
  },authorityDigest:binding.authorityDigest,privateView:binding.privateView,readOpportunityReview,now,synthetic});
 return Object.freeze({...readers,readDestinationBinding,readRecords:crm.getReportRecords});
}
module.exports={createReportDeliveryReaders,createManagedReportDeliveryReaders};
