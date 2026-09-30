'use strict';

const {createReportRunStore}=require('../functions/analytics_sync/lib/report-run-store');
const {createReportDeliveryControl}=require('../functions/analytics_sync/lib/report-delivery-control');
const {createManagedReportMailSender}=require('../functions/analytics_sync/lib/report-mail-sender');
const {createReportDeliveryHandlers}=require('../functions/analytics_sync/lib/report-delivery-handlers');
const {loadDeployment}=require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/runtime-service');

function held(){throw Object.assign(new Error('REPORT_DELIVERY_BINDING_REQUIRED'),{code:'REPORT_DELIVERY_BINDING_REQUIRED'});}
/** Actual SDK composition for the existing encrypted ReportRuns, managed Mail
 * Connection, canonical scope-to-Deal resolver and authenticated handlers.
 * Qualified snapshot/content/authorization readers are protected installation
 * dependencies, not caller-supplied flags or public Job/HTTP parameters.
 * Default auto admission is false. This factory provisions no access grant.
 */
function createReportDeliveryFactory({binding,createReaders,fetchImpl=globalThis.fetch,now=Date.now,
  autoDeliveryEnabled=false}={}) {
  const b=structuredClone(binding);
  if(!b||b.environment!=='development'||!/^[a-f0-9]{40}$/.test(b.sourceRevision||'')
    ||!/^[1-9][0-9]{2,29}$/.test(b.projectId||'')
    ||!Number.isSafeInteger(b.verifiedAt)||!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=b.verifiedAt
    ||!['schemaDigest','nativeLineageDigest','recipientContractDigest','authorizationContractDigest','storageContractDigest'].every(k=>
      /^[a-f0-9]{64}$/.test(b[k]||''))
    ||typeof createReaders!=='function'||typeof now!=='function'||typeof autoDeliveryEnabled!=='boolean'
    ||!b.systemActor)held();
  const active=()=>{const at=now();if(!Number.isSafeInteger(at)||at<b.verifiedAt||at>=b.expiresAt)held();return at;};
  active();
  return function reportDeliveryFactory(app,config,store) {
    active();
    if(config?.environment!=='development'||config.sourceRevision!==b.sourceRevision
      ||String(app?.config?.projectId||'')!==b.projectId
      ||String(app.config.environment||'').toLowerCase()!=='development'
      ||typeof store?.unique!=='function')held();
    const readers=createReaders(app,config,store);
    if(!readers||!['readSnapshot','readSummary','authorize'].every(k=>typeof readers[k]==='function'))held();
    const wrap=method=>async(...args)=>{active();const result=await readers[method](...args);active();return result;};
    const readSnapshot=wrap('readSnapshot');
    const control=createReportDeliveryControl({store:createReportRunStore({app,environment:'development',timeoutMs:3000}),
      readSnapshot,readSummary:wrap('readSummary'),authorize:wrap('authorize'),now:active,autoDeliveryEnabled,
      sender:createManagedReportMailSender({app,binding:b.mail,fetchImpl,now:active,
        lookupAcceptance:readers.lookupAcceptance?wrap('lookupAcceptance'):null})});
    return createReportDeliveryHandlers({control,readSnapshot,systemActor:b.systemActor,now:active,
      readPrivateView:readers.readPrivateView?wrap('readPrivateView'):null,
      async readDealForScope(scope,{signal}={}) {
        active();if(signal?.aborted)held();
        const row=await store.unique(config.tables.DEPLOYMENT_TABLE,'DEPLOYMENT_ID',scope.deploymentId);
        active();if(signal?.aborted||row?.CLIENT_ID!==scope.clientId)held();
        const deployment=await loadDeployment(store,row,config);active();if(signal?.aborted)held();
        return {clientId:deployment.clientId,deploymentId:deployment.deploymentId,
          dealId:deployment.crmDealId,testStatus:deployment.testStatus};
      }});
  };
}
module.exports={createReportDeliveryFactory};
