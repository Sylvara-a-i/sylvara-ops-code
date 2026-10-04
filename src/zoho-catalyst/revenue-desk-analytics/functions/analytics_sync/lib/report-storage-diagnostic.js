'use strict';
// Private issued trackers/errors only. No external object, Error property, header,
// provider body or identifier is read when producing the closed log projection.
const trackers=new WeakMap(),failures=new WeakMap();
const STAGES=new Set(['command','active','transport_construct','secure_override',
 'request_prepare','authenticate_guard','authenticate_enter','authenticate_rejected',
 'authenticate_complete','authenticate_postguard','dispatch_admitted','response_received',
 'response_decode','admission_verify','root_prior_read','root_round','successor_round','final_verify']);
const OPERATIONS=new Set(['none','admission_insert','admission_read','report_insert','report_read']);
const COUNTERS=new Set(['attempted','dispatchStarted','responses']);
function createStorageDiagnostic(){const tracker=Object.freeze({});trackers.set(tracker,
 {lastStage:'command',lastOperation:'none',attempted:0,dispatchStarted:0,responses:0,counterOverflow:false});return tracker;}
function recordStorageDiagnostic(tracker,stage,operation='none',counter){
 const state=trackers.get(tracker);if(!state||!STAGES.has(stage)||!OPERATIONS.has(operation)
  ||counter!==undefined&&!COUNTERS.has(counter))return;
 state.lastStage=stage;state.lastOperation=operation;
 if(counter){if(state[counter]<13)state[counter]++;else state.counterOverflow=true;}
}
function storageDiagnosticError(tracker){
 const error=Object.assign(new Error('REPORT_STORAGE_QUALIFICATION_HELD'),{code:'REPORT_STORAGE_QUALIFICATION_HELD'});
 const state=trackers.get(tracker);if(state)failures.set(error,Object.freeze({...state}));return error;
}
function storageFailureDiagnostic(error){return failures.get(error);}
// Only exact SDK own data properties are inspected; never messages or getters.
function recordStorageProviderResult(tracker,status,error,operation='none'){
 const state=trackers.get(tracker);if(!state)return;
 if(Number.isInteger(status)&&status>=100&&status<=599)state.httpStatus=status;else delete state.httpStatus;
 state.providerCode='unknown';
 try{const descriptor=Object.getOwnPropertyDescriptor(error,'code');
  if(descriptor&&Object.hasOwn(descriptor,'value'))state.providerCode=
   descriptor.value==='DUPLICATE_VALUE'?'duplicate_value':descriptor.value==='INVALID_DATA'?'invalid_data':'other';
 }catch{} // Proxy or absent/invalid rejection carries no diagnostic authority.
 if(operation==='report_insert'){
  if(Object.hasOwn(state,'httpStatus'))state.insertHttpStatus=state.httpStatus;else delete state.insertHttpStatus;
  state.insertProviderCode=state.providerCode;
 }
}
module.exports={createStorageDiagnostic,recordStorageDiagnostic,storageDiagnosticError,storageFailureDiagnostic,recordStorageProviderResult};
