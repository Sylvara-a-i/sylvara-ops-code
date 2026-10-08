'use strict';
const CODES=new Set(['ERR_ASSERTION','REPORT_CRM_PROJECTION_HELD','REPORT_DELIVERY_HELD',
 'REPORT_DELIVERY_SELECTION_HELD','REPORT_DELIVERY_ATTESTATION_HELD','REPORT_DELIVERY_STORAGE_HELD',
 'REPORT_RECIPIENT_PREFLIGHT_HELD','REPORT_RECIPIENT_ATTESTATION_HELD']);
const STATUSES=new Set(['held','verified','provider_accepted','provider_rejected','delivery_reconciliation_required']);
const number=value=>Number.isFinite(value)?value:null;

// Observe only this fixture's staged exports before its factories import them.
// Clocks, timers, guard conditions and returned values remain owned by the runtime.
// Boundary elapsed time (and an aborted signal after cleanup) cannot prove which
// internal guard fired: some runtime catches deliberately replace the error code.
function observeColdDelivery({handlers,projection,now,wallNow=()=>performance.now()}){
 const events=[],restores=[];let dropped=0;
 const watch=(stage,operation,binding)=>function(...args){
  const start=now(),wallStart=wallNow();
  const signal=args.find(arg=>arg?.signal instanceof AbortSignal)?.signal;
  const record=(outcome,error,value)=>{
   const at=now();
   if(events.length===48){events.shift();dropped++;}
   events.push({stage,outcome,code:error?(CODES.has(error.code)?error.code:'unclassified'):null,
    status:STATUSES.has(value?.status)?value.status:null,
    boundarySyntheticElapsedMs:number(at-start),boundaryWallElapsedMs:number(wallNow()-wallStart),
    timeoutMs:number(binding?.timeoutMs),qualificationAgeMs:number(at-binding?.verifiedAt),
    qualificationExpiresInMs:number(binding?.expiresAt-at),signalAborted:signal?.aborted===true});
  };
  let result;try{result=Reflect.apply(operation,this,args);}catch(error){record('rejected',error);throw error;}
  if(result&&typeof result.then==='function')return result.then(value=>{record('returned',null,value);return value;},
   error=>{record('rejected',error);throw error;});
  record('returned',null,result);return result;
 };
 const replace=(target,key,build)=>{
  const original=target[key];target[key]=build(original);restores.push(()=>{target[key]=original;});
 };
 replace(projection,'createReportCrmProjectionWriter',original=>function(options){
  const observed={...options};
  // Capture dependency failures before the writer's fail-closed catch redacts them.
  for(const key of ['readProjection','readRecords','authorizationProvider','authorize','fetchImpl'])
   if(typeof options[key]==='function')observed[key]=watch('projection.'+key,options[key],options.binding);
  return watch('projection',Reflect.apply(original,this,[observed]),options.binding);
 });
 replace(handlers,'createReportDeliveryHandlers',original=>function(options){
  const observed={...options,control:{...options.control,
   initial:watch('delivery.initial',options.control.initial.bind(options.control))}};
  for(const key of ['readDealForScope','projectReport','readSnapshot'])
   if(typeof options[key]==='function')observed[key]=watch('delivery.'+key,options[key]);
  const result=Reflect.apply(original,this,[observed]);
  return Object.freeze({...result,afterPair:watch('delivery.afterPair',result.afterPair)});
 });
 return {snapshot:()=>({boundaryEvidenceOnly:true,dropped,events:structuredClone(events)}),
  restore(){for(const restore of restores.reverse())restore();restores.length=0;}};
}
module.exports={observeColdDelivery};
