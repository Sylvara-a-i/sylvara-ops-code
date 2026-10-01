'use strict';

const {createReportRunStore}=require('../functions/analytics_sync/lib/report-run-store');
const {createReportDeliveryControl}=require('../functions/analytics_sync/lib/report-delivery-control');
const {createManagedReportCrmSender}=require('../functions/analytics_sync/lib/report-mail-sender');
const {createReportDeliveryHandlers}=require('../functions/analytics_sync/lib/report-delivery-handlers');
const {createReportDeliveryStorageReader}=require('../functions/analytics_sync/lib/report-delivery-storage');
const {createWorkDriveClient}=require('../functions/analytics_sync/lib/workdrive-client');
const {createConnectionAuthorizationProvider}=require('../functions/analytics_sync/lib/connection-boundary');
const {createManagedReportDeliveryReaders}=require('./create-report-delivery-readers');
const {createReportCrmProjectionWriter}=require('../functions/analytics_sync/lib/report-crm-projection');
const {loadDeployment}=require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/runtime-service');

function held(){throw Object.assign(new Error('REPORT_DELIVERY_BINDING_REQUIRED'),{code:'REPORT_DELIVERY_BINDING_REQUIRED'});}
/** Actual SDK composition for the existing encrypted ReportRuns, CRM-native
 * Connection, canonical scope-to-Deal resolver and authenticated handlers.
 * Qualified snapshot/content/authorization readers are protected installation
 * dependencies, not caller-supplied flags or public Job/HTTP parameters.
 * Default auto admission is false. This factory provisions no access grant.
 */
function createReportDeliveryFactory({binding,createReaders,fetchImpl=globalThis.fetch,now=Date.now,
  autoDeliveryEnabled=false,deliveryEnabled=false,projectionEnabled=false,readDestinationBinding,readOpportunityReview=null,synthetic=false}={}) {
  const b=structuredClone(binding);
  if(!b||b.environment!=='development'||!/^[a-f0-9]{40}$/.test(b.sourceRevision||'')
    ||!/^[1-9][0-9]{2,29}$/.test(b.projectId||'')
    ||!Number.isSafeInteger(b.verifiedAt)||!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=b.verifiedAt
    ||!['schemaDigest','nativeLineageDigest','recipientContractDigest','authorizationContractDigest','storageContractDigest'].every(k=>
      /^[a-f0-9]{64}$/.test(b[k]||''))
    ||(createReaders!==undefined&&typeof createReaders!=='function')||typeof now!=='function'||typeof autoDeliveryEnabled!=='boolean'
    ||typeof deliveryEnabled!=='boolean'||typeof projectionEnabled!=='boolean'||typeof synthetic!=='boolean'
    ||!b.systemActor)held();
  const active=()=>{const at=now();if(!Number.isSafeInteger(at)||at<b.verifiedAt||at>=b.expiresAt)held();return at;};
  active();
  return function reportDeliveryFactory(app,config,store) {
    active();
    if(config?.environment!=='development'||config.sourceRevision!==b.sourceRevision
      ||String(app?.config?.projectId||'')!==b.projectId
      ||String(app.config.environment||'').toLowerCase()!=='development'
      ||typeof store?.unique!=='function')held();
    const runs=createReportRunStore({app,environment:'development',timeoutMs:3000});
    const readers=createReaders ? createReaders(app,config,store,{reportRunStore:runs})
      :createManagedReportDeliveryReaders({app,runtimeConfig:config,runtimeStore:store,reportRunStore:runs,
        binding:b.readers,readDestinationBinding,readOpportunityReview,fetchImpl,now:active,synthetic});
    if(!readers||!['readSnapshot','authorize'].every(k=>typeof readers[k]==='function'))held();
    const wrap=method=>async(...args)=>{active();const result=await readers[method](...args);active();return result;};
    const readSnapshot=wrap('readSnapshot');
    let readSummary;
    if(typeof readers.readSummary==='function')readSummary=wrap('readSummary');
    else {
      const storage=b.storage;
      if(typeof readers.readDestinationBinding!=='function'||!storage
        ||storage.contractQualificationDigest!==b.storageContractDigest)held();
      const workdrive=createWorkDriveClient({authorizationProvider:createConnectionAuthorizationProvider(app,
        storage.connectionReference,3000),fetchImpl,apiOrigin:storage.apiOrigin,downloadOrigin:storage.downloadOrigin,
        timeoutMs:storage.timeoutMs,now:active});
      const stored=createReportDeliveryStorageReader({reportRunStore:runs,workdrive,
        readDestinationBinding:wrap('readDestinationBinding'),now:active});
      readSummary=async({snapshot,signal}={})=>{active();const bytes=await stored({snapshot,signal});active();return bytes;};
    }
    const authorize=async request=>((request.action==='view'||request.action==='project'||deliveryEnabled)
      &&await wrap('authorize')(request)===true);
    let projectReport=null;
    if(projectionEnabled){
      if(!b.crmProjection||typeof readers.readProjection!=='function'||typeof readers.readRecords!=='function')held();
      const writer=createReportCrmProjectionWriter({store:runs,readRecords:wrap('readRecords'),
        async readProjection(request){const result=await wrap('readProjection')(request);
          await readSummary({snapshot:result.snapshot,signal:request.signal});return result;},
        authorizationProvider:createConnectionAuthorizationProvider(app,b.crmProjection.connectionReference,3000),
        binding:b.crmProjection,authorize,fetchImpl,now:active});
      projectReport=async(request)=>{if(!await authorize({...request,action:'project'}))held();return writer(request);};
    }
    const control=createReportDeliveryControl({store:runs,
      readSnapshot,readSummary,authorize,now:active,autoDeliveryEnabled,
      sender:createManagedReportCrmSender({app,binding:b.crmEmail,store:runs,fetchImpl,now:active})});
    return createReportDeliveryHandlers({control,readSnapshot,projectReport,systemActor:b.systemActor,now:active,
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
