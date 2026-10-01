'use strict';

const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const PROFILE='report_delivery_v1';
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)
  && Object.keys(x).sort().join(',')===[...keys].sort().join(',');
function held(){throw Object.assign(new Error('REPORT_DELIVERY_HELD'),{code:'REPORT_DELIVERY_HELD'});}

/** Authenticated server-side application handlers. actor comes from the private
 * controller/worker construction, never JSON. The existing delivery control
 * independently authorizes that principal for this exact Deal/action.
 * No request can select a recipient, attachment, sender, Connection or report.
 */
function createReportDeliveryHandlers({control,readDealForScope,readSnapshot,systemActor,readPrivateView=null,projectReport=null,now=Date.now,timeoutMs=15000}={}) {
  if(!control||!['initial','prepareResend','confirmResend','view'].every(k=>typeof control[k]==='function')
    ||typeof readDealForScope!=='function'||typeof readSnapshot!=='function'||!systemActor
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000
    ||typeof now!=='function'||(readPrivateView!==null&&typeof readPrivateView!=='function')
    ||(projectReport!==null&&typeof projectReport!=='function'))held();
  async function handleCommand(command,{actor,signal}={}) {
    if(!actor||command?.profile!==PROFILE||!ID.test(command.dealId)
      ||!['view','prepare_resend','confirm_resend'].includes(command.action))held();
    const keys=command.action==='confirm_resend'
      ?['profile','action','dealId','confirmationId','confirmed']:['profile','action','dealId'];
    if(!exact(command,keys))held();
    const request={dealId:command.dealId,actor,signal};
    if(command.action==='view') {
      const result=await control.view(request);
      if(readPrivateView===null)held();
      const link=await readPrivateView({...request,...result});
      let url;try{url=new URL(link?.url);}catch{held();}
      if(signal?.aborted||link.access!=='authenticated_private'||!HASH.test(link.qualificationDigest)
        ||link.manifestSha256!==result.manifestSha256||link.documentSha256!==result.summary.documentSha256
        ||!Number.isSafeInteger(link.expiresAt)||link.expiresAt<=now()||link.url.length>450
        ||url.origin!=='https://workdrive.zoho.com'||url.username||url.password
        ||/[\r\n\x00]/.test(link.url))held();
      // Link construction may await provider metadata. Reauthorize and reattest
      // the exact stored bytes again before returning a private opening target.
      const fresh=await control.view(request);
      if(signal?.aborted||link.expiresAt<=now()||fresh.manifestSha256!==result.manifestSha256
        ||fresh.summary.documentSha256!==result.summary.documentSha256)held();
      return {...result,url:link.url};
    }
    if(command.action==='prepare_resend')return control.prepareResend(request);
    const delivery=await control.confirmResend({...request,confirmationId:command.confirmationId,confirmed:command.confirmed});
    if(projectReport!==null&&delivery.status==='provider_accepted'){
      try{await projectReport({...request,deliveryOperationKey:delivery.operationKey});return {...delivery,crmProjectionStatus:'verified'};}
      catch{return {...delivery,crmProjectionStatus:'held'};}
    }return delivery;
  }
  async function handle(command,{actor,signal}={}) {
    if(signal!==undefined&&!(signal instanceof AbortSignal))held();
    const controller=new AbortController(),started=now(),wall=performance.now()+timeoutMs;
    let rejectDeadline;const deadline=new Promise((_,reject)=>{rejectDeadline=reject;});
    const cancel=()=>{controller.abort();rejectDeadline(Object.assign(new Error('REPORT_DELIVERY_HELD'),{code:'REPORT_DELIVERY_HELD'}));};
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    const timer=setTimeout(cancel,timeoutMs);
    try {
      const result=await Promise.race([handleCommand(command,{actor,signal:controller.signal}),deadline]);
      if(controller.signal.aborted||now()<started||now()-started>=timeoutMs||performance.now()>=wall)held();
      return result;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();}
  }
  async function afterPair(scope,pair,{signal}={}) {
    if(!exact(scope,['clientId','deploymentId'])||!ID.test(scope.clientId)||!ID.test(scope.deploymentId)
      ||pair?.status!=='report_pair_verified_not_for_delivery'||!HASH.test(pair.generationKey)
      ||!HASH.test(pair.manifestSha256)||pair.manifest?.initialDeliveryArtifact!=='summary')held();
    try{
      const selection=await readDealForScope(scope,{signal});
      if(signal?.aborted||!selection||selection.clientId!==scope.clientId
        ||selection.deploymentId!==scope.deploymentId||!ID.test(selection.dealId))held();
      // Stopped/failed terminal states keep their report and original status.
      // They never acquire completed-test automatic delivery authority.
      if(selection.testStatus!=='Completed')return {status:'held'};
      if(projectReport!==null)await projectReport({dealId:selection.dealId,actor:systemActor,signal});
      const snapshot=await readSnapshot({dealId:selection.dealId,signal});
      if(signal?.aborted||snapshot?.binding?.clientId!==scope.clientId
        ||snapshot.binding.deploymentId!==scope.deploymentId
        ||snapshot.report?.generationKey!==pair.generationKey
        ||snapshot.report.manifestSha256!==pair.manifestSha256)held();
      const delivery=await control.initial({dealId:selection.dealId,actor:systemActor,signal,
        expectedManifestSha256:pair.manifestSha256});
      // Initial identity is per test, not per revision. An old accepted send
      // cannot label this corrected PDF or recipient as newly accepted.
      const sameSummary=['generationKey','documentSha256','privateReceiptKey'].every(k=>
        delivery.summary?.[k]===snapshot.report.summary[k]);
      if(projectReport!==null&&delivery.status==='provider_accepted'&&sameSummary
        &&delivery.recipientVerificationDigest===snapshot.recipient.verificationDigest){
        try{await projectReport({dealId:selection.dealId,actor:systemActor,signal,deliveryOperationKey:delivery.operationKey});
          return {status:delivery.status,crmProjectionStatus:'verified'};}catch{return {status:delivery.status,crmProjectionStatus:'held'};}
      }
      return {status:sameSummary && delivery.recipientVerificationDigest===snapshot.recipient.verificationDigest
        ? delivery.status : 'held'};
    }catch{return {status:'held'};}
  }
  return Object.freeze({handle,afterPair});
}

/** Reuse the worker's existing terminal reconciler, without rerendering or
 * importing when delivery fails. Never expose private manifest/recipient data
 * through the worker result. The existing durable initial claim owns repeats.
 */
function attachTerminalReportDelivery(reconcile,handlers) {
  if(typeof reconcile!=='function'||typeof handlers?.afterPair!=='function'
    ||!Number.isSafeInteger(reconcile.attemptTimeoutMs))held();
  async function terminal(scope,options={}) {
    const pair=await reconcile(scope,options);
    if(pair?.status!=='report_pair_verified_not_for_delivery')return pair;
    const delivery=await handlers.afterPair(scope,pair,options);
    return {status:pair.status,deliveryStatus:delivery.status};
  }
  Object.defineProperty(terminal,'attemptTimeoutMs',{value:reconcile.attemptTimeoutMs});
  return Object.freeze(terminal);
}
module.exports={PROFILE,createReportDeliveryHandlers,attachTerminalReportDelivery};
