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
// Closed decode observations only. These never confer acceptance or retry authority.
const DECODE_EVENTS=Object.freeze({
 utf8_valid:['decodeUtf8','valid'],utf8_invalid:['decodeUtf8','invalid'],
 json_valid:['decodeJson','valid'],json_invalid:['decodeJson','invalid'],
 deadline_active:['decodeDeadline','active'],deadline_expired:['decodeDeadline','expired'],
 deadline_cancelled:['decodeDeadline','cancelled'],deadline_authority_held:['decodeDeadline','authority_held'],
 failure_utf8:['decodeFailure','utf8_invalid'],failure_json:['decodeFailure','json_invalid'],
 failure_envelope:['decodeFailure','data_not_array']
});
function recordStorageDecodeEvent(tracker,event){
 const state=trackers.get(tracker),entry=Object.hasOwn(DECODE_EVENTS,event)?DECODE_EVENTS[event]:null;
 if(state&&entry){state[entry[0]]=entry[1];
  if(!state.firstDecodeFailure&&(event.startsWith('failure_')||['deadline_expired','deadline_cancelled','deadline_authority_held'].includes(event))&&Object.hasOwn(state,'decodeUtf8')){
   const fields=['decodeUtf8','decodeJson','decodeRootType','decodeDataType','decodeArrayCardinality','decodeEnvelopeStatus','decodeDeadline','decodeFailure','requestApiVersion','responseContentType'];
   state.firstDecodeFailure=Object.freeze({operation:state.lastOperation,...Object.fromEntries(fields.map(k=>[k,state[k]]))});
  }
 }
}
function recordStorageResponseMetadata(tracker,headers){
 const state=trackers.get(tracker);if(!state)return;
 Object.assign(state,{decodeUtf8:'not_attempted',decodeJson:'not_attempted',decodeRootType:'not_decoded',decodeDataType:'not_decoded',decodeArrayCardinality:'not_decoded',decodeEnvelopeStatus:'not_decoded',decodeDeadline:'not_observed',decodeFailure:'none',requestApiVersion:'v1',responseContentType:'absent'});
 if(headers===undefined||headers===null)return;
 try{const d=Object.getOwnPropertyDescriptor(headers,'content-type');if(!d)return;
  if(!Object.hasOwn(d,'value')||typeof d.value!=='string'||d.value.length>128){state.responseContentType='other';return;}
  const media=d.value.split(';',1)[0].trim().toLowerCase();
  state.responseContentType=media==='application/json'?'json':media==='text/plain'?'text':media==='text/html'?'html':'other';
 }catch{state.responseContentType='other';}
}
function recordStorageResponseShape(tracker,result){
 const state=trackers.get(tracker);if(!state)return;
 const type=v=>v===undefined?'absent':v===null?'null':Array.isArray(v)?'array':typeof v;
 try{const d=result&&typeof result==='object'?Object.getOwnPropertyDescriptor(result,'data'):undefined;
  const data=d&&Object.hasOwn(d,'value')?d.value:undefined;
  const s=result&&typeof result==='object'?Object.getOwnPropertyDescriptor(result,'status'):undefined;
  state.decodeRootType=type(result);state.decodeDataType=type(data);
  state.decodeArrayCardinality=!Array.isArray(data)?'not_array':data.length===0?'zero':data.length===1?'one':'multiple';
  state.decodeEnvelopeStatus=!s?'absent':!Object.hasOwn(s,'value')?'other':s.value==='success'?'success':s.value==='error'?'error':'other';
 }catch{} // No getter, provider value or thrown message is copied.
}
const VALIDATION_LOCATIONS=new Set(['admission_ack','admission_row','report_ack','report_row']);
const VALIDATION_REASONS=new Set(['projection_shape','projection_missing','projection_extra','row_id','creator_id','creator_mismatch','ack_cardinality','field_boolean_type','field_number_type','field_null_type','field_text_type','field_value','readback_mismatch']);
function recordStorageValidationFailure(tracker,location,reason){
 const state=trackers.get(tracker);
 if(state&&!state.firstValidationFailure&&VALIDATION_LOCATIONS.has(location)&&VALIDATION_REASONS.has(reason))
  state.firstValidationFailure=Object.freeze({location,reason});
}
module.exports={createStorageDiagnostic,recordStorageDiagnostic,storageDiagnosticError,storageFailureDiagnostic,recordStorageProviderResult,recordStorageDecodeEvent,recordStorageResponseMetadata,recordStorageResponseShape,recordStorageValidationFailure};
