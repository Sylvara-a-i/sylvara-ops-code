'use strict';
const crypto=require('node:crypto');
const {validateConfigurationVersionRow}=require('revenue_desk_call_gateway/lib/configuration-version');
const {deterministicIdempotencyKey}=require('./journey-core-service');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function held(){throw Object.assign(new Error('REPORT_SETUP_SELECTION_HELD'),{code:'REPORT_SETUP_SELECTION_HELD'});}
function createReportSetupReader({config,store,crm,core,sourceReader,conversionReader,staging,qualifyRecipient,expiresAt,now=Date.now}={}){
 if(!config||!store||!crm||!core||!sourceReader||!conversionReader||typeof staging?.assertApprovalSource!=='function'||typeof crm.getReportRequestEvidence!=='function'||typeof qualifyRecipient!=='function'
  ||!Number.isSafeInteger(expiresAt)||expiresAt<=now())held();
 return async function readSetup({dealId,actor,signal}={}){
  const active=()=>{if(signal?.aborted)held();};active();
  if(actor?.kind!=='internal_controller'||actor.identity!==config.operatorIdHash)held();
  const records=await crm.getReportRecords(dealId,{signal});active();const d=records.deal,t=records.contact;
  if(!d||!t||d.id!==dealId||d.Contact_Name?.id!==t.id||d.Account_Name?.id!==t.Account_Name?.id
   ||!/^form2cfgv1:[1-9][0-9]{0,29}:[a-f0-9]{40}$/.test(d.Configuration_Version||''))held();
  const deployment=await store.unique(config.tables.DEPLOYMENT_TABLE,'DEPLOYMENT_ID',d.Deployment_Record_ID);active();
  if(!deployment||deployment.DEPLOYMENT_ID!==d.Deployment_Record_ID||deployment.SOURCE_ENVIRONMENT!==config.environment
   ||deployment.SOURCE_REVISION!==config.sourceRevision)held();
  const row=await store.unique(config.tables.CONFIGURATION_VERSION_TABLE,'CONFIGURATION_VERSION_ID',deployment.ACTIVE_CONFIGURATION_VERSION_ID);active();
  const version=validateConfigurationVersionRow(row,{expectedDeploymentId:deployment.DEPLOYMENT_ID,
   expectedEnvironment:config.environment,expectedSourceRevision:config.sourceRevision});
  if(version.configurationVersion!==d.Configuration_Version||version.engagementType!=='free_test')held();
  // Existing core reader validates consent, exact Form2 evidence/HMAC and the
  // non-revoked independent approval. It expressly accepts staged inactive
  // setup; no loadDeployment/activation/call/report-completion prerequisite.
  const command={dealId,journeyId:d.Intake_Submission_ID,configurationVersionId:d.Configuration_Version,
   idempotencyKey:deterministicIdempotencyKey('approve',dealId,d.Intake_Submission_ID,d.Configuration_Version)};
  const approved=await core.readStagingSource(command,{expectedDeploymentId:deployment.DEPLOYMENT_ID});active();
  if(!approved.priorApproval||approved.priorApproval.configurationVersionId!==d.Configuration_Version)held();
  const staged=await staging.assertApprovalSource({dealId,journeyId:d.Intake_Submission_ID,
   deploymentId:deployment.DEPLOYMENT_ID,configurationVersionId:version.configurationVersionId},{deployment,deal:approved.deal});active();
  if(staged?.configurationStaged!==true||staged.priorCoreApproval?.configurationVersionId!==d.Configuration_Version)held();
  let lineage=await sourceReader.findAssistedLineage(d.Intake_Submission_ID);active();
  if(lineage===null)lineage=await crm.getPublicOriginalLead(d.Intake_Submission_ID);active();
  const native=await conversionReader.readConversion(lineage?.originalLeadId);active();
  if(native?.originalLeadId!==lineage?.originalLeadId||native.journeyId!==d.Intake_Submission_ID
   ||native.dealId!==dealId||native.accountId!==d.Account_Name.id||native.contactId!==t.id)held();
  const request=await crm.getReportRequestEvidence(native.originalLeadId,{signal});active();
  const preflight=qualifyRecipient({request,contact:t,native,now:now()});
  const requestFresh=await crm.getReportRequestEvidence(native.originalLeadId,{signal});active();
  if(JSON.stringify(requestFresh)!==JSON.stringify(request))held();
  const fresh=await crm.getReportRecords(dealId,{signal});active();
  if(JSON.stringify(fresh)!==JSON.stringify(records))held();
  const relationship=Object.fromEntries(['originalLeadId','journeyId','accountId','contactId','dealId','convertedAt'].map(k=>[k,native[k]]));
  const canonical=x=>JSON.stringify(Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))));
  return {authorizedActor:actor.identity,identity:{clientId:deployment.CLIENT_ID,deploymentId:deployment.DEPLOYMENT_ID,
   dealId,accountId:native.accountId,contactId:native.contactId,configurationVersion:d.Configuration_Version,
   configurationVersionId:version.configurationVersionId,originalLeadId:native.originalLeadId,intakeSubmissionId:native.journeyId},
   nativeRelationshipEvidenceSha256:sha(canonical(relationship)),configurationSourceDigest:sha(row.CONFIGURATION_JSON),
   recipientEmail:t.Email,crmEmailOptOut:t.Email_Opt_Out,
   // Provider suppression remains pending. Exact request consent and current
   // known opt-out/unsubscribe contradictions are independently bound.
   suppression:{...preflight,expiresAt}};
 };
}
module.exports={createReportSetupReader};
