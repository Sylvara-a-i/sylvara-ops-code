'use strict';
const {loadReportBootstrapBinding,workerReportActor,protectedDestinations}=require('revenue_desk_call_gateway/lib/report-bootstrap-binding');
const {createCrmControlClient}=require('./crm-client');
const {createAuthorizationProvider}=require('./connection');
const {createConfigurationSourceReader}=require('./configuration-source-reader');
const {createConfigurationConversionReader}=require('./configuration-conversion-reader');
const {createJourneyCoreControlService}=require('./journey-core-service');
const {createForm2EvidenceStore}=require('./form2-evidence-store');
const {createReportSetupReader}=require('./report-setup-reader');
const {createConfigurationStagingService}=require('./configuration-staging-service');
function held(){throw Object.assign(new Error('REPORT_BOOTSTRAP_HELD'),{code:'REPORT_BOOTSTRAP_HELD'});}
function createProtectedReportController({environment=process.env,now=Date.now,fetchImpl=globalThis.fetch}={}){
 return function reportDelivery(app,config,store){
  const b=loadReportBootstrapBinding(environment,{now});
  if(!b||(!b.attestation.enabled&&!b.delivery.enabled)||String(app?.config?.projectId)!==b.projectId
   ||String(app.config.environment).toLowerCase()!=='development'||config.sourceRevision!==b.sourceRevision)held();
  const active=()=>{const at=now();if(at<b.verifiedAt||at>=b.expiresAt
   ||(b.delivery.enabled&&at>=b.delivery.casQualification.expiresAt))held();return at;};active();
  const delivery=b.delivery.enabled?require('./report-delivery-composition').createReportDeliveryFactory({
   binding:{...b.delivery.binding,systemActor:workerReportActor(b)},
   readDestinationBinding:protectedDestinations(b.delivery.destinations),
   deliveryEnabled:false,autoDeliveryEnabled:false,projectionEnabled:false,now:active,fetchImpl})(app,config,store):null;
  if(!b.attestation.enabled)return delivery;
  const {createReportRunStore}=require('../reporting/revenue-desk-analytics/functions/analytics_sync/lib/report-run-store');
  const {createReportRecipientWriter}=require('../reporting/revenue-desk-analytics/functions/analytics_sync/lib/report-recipient-writer');
  const c={...config,...b.attestation.crm};
  // Private CRM metadata may not override authenticated controller authority.
  if(c.operatorIdHash!==config.operatorIdHash||c.environment!==config.environment||c.sourceRevision!==config.sourceRevision
   ||c.crmOrganizationId!==config.crmOrganizationId||c.crmOrganizationSha256!==config.crmOrganizationSha256)held();
  const crm=createCrmControlClient(c,{readAuthorization:createAuthorizationProvider(app,c.crmReadConnectionLinkName,
   /^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/,c.platformTimeoutMs),writeAuthorization:async()=>held(),fetchImpl});
  const core=createJourneyCoreControlService({config:c,store,crm,now,evidenceStore:createForm2EvidenceStore(app,{timeoutMs:c.platformTimeoutMs})});
  const sourceReader=createConfigurationSourceReader(app,c,{now});
  const conversionReader=createConfigurationConversionReader({crm,now,timeoutMs:c.platformTimeoutMs});
  const staging=createConfigurationStagingService({config:c,store,crm,core,sourceReader,conversionReader,now});
  const readSetup=createReportSetupReader({config:c,store,crm,core,now,sourceReader,conversionReader,staging});
  const attest=createReportRecipientWriter({store:createReportRunStore({app,environment:'development'}),readSetup,
   authorityDigest:b.attestation.authorityDigest,systemActor:workerReportActor(b),now:active,expiresAt:b.expiresAt});
  return Object.freeze({async handle(command,options){
   if(command?.action==='attest_recipient')return attest(command,options);
   if(!delivery)held();active();const result=await delivery.handle(command,options);active();return result;
  }});
 };
}
module.exports={createProtectedReportController};
