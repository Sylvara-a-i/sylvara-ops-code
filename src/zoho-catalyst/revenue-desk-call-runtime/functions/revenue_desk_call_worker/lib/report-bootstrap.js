'use strict';
const {loadReportBootstrapBinding,workerReportActor,protectedDestinations,protectedDeliveryExecution}=require('revenue_desk_call_gateway/lib/report-bootstrap-binding');
/** Factory options are private server configuration; never Job-controlled.
 * Missing binding preserves the old null hook. Enabled execution requires a
 * separately qualified unique-successor contract, access and execution acceptance. */
function createProtectedWorkerReportOptions(environment=process.env,{now=Date.now}={}){
 const b=loadReportBootstrapBinding(environment,{now});
 if(!b||!b.reporting.enabled)return Object.freeze({terminalDraftReconcilerFactory:null});
 const {createReportingFactory,createReportDeliveryFactory}=require('./terminal-draft-composition');
 const execution=protectedDeliveryExecution(b,{role:'worker',now});
 const active=()=>{
  const at=execution.assertActive();if(at<b.verifiedAt||at>=b.expiresAt||at>=b.reporting.claimQualification.expiresAt
   ||(b.delivery.enabled&&at>=b.delivery.claimQualification.expiresAt))throw Object.assign(new Error('REPORT_BOOTSTRAP_HELD'),{code:'REPORT_BOOTSTRAP_HELD'});
  return at;
 };
 const readDestinationBinding=protectedDestinations(b.reporting.destinations);
 const deliveryFactory=b.delivery.enabled?createReportDeliveryFactory({binding:{...b.delivery.binding,systemActor:workerReportActor(b)},
  readDestinationBinding,deliveryEnabled:execution.deliveryEnabled,autoDeliveryEnabled:execution.autoDeliveryEnabled,projectionEnabled:execution.projectionEnabled,now:active}):null;
 const compose=createReportingFactory({...b.reporting.options,readDestinationBinding,deliveryFactory,now:active});
 return Object.freeze({terminalDraftReconcilerFactory(app,config,store){
  active();const reconcile=compose(app,config,store);
  const guarded=async(scope,options)=>{active();const result=await reconcile(scope,options);active();return result;};
  Object.defineProperty(guarded,'attemptTimeoutMs',{value:reconcile.attemptTimeoutMs});return Object.freeze(guarded);
 }});
}
module.exports={createProtectedWorkerReportOptions};
