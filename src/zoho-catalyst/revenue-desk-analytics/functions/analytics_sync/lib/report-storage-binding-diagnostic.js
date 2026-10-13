'use strict';
// Only errors issued here carry binding observations. Only bounded numeric length
// observations are retained, never string contents or arbitrary Error properties.
// This projection grants no acceptance/retry authority.
const failures=new WeakMap();
const REASONS=new Set([
 'environment_shape','marker_missing','marker_type','inline_shape','marker_syntax','marker_bounds','part_count',
 'part_missing','part_type','part_length','part_ascii','wire_length','base64_syntax','base64_canonical',
 'inflate_failed','inflate_consumption','tuple_length','tuple_utf8','tuple_json','tuple_canonical',
 'tuple_shape','tuple_scalar_type','tuple_scalar_bounds','tuple_schema','raw_bounds','raw_length',
 'raw_type_or_size','pin_syntax','pin_mismatch','binding_json','binding_fields','binding_schema','binding_enabled',
 'binding_environment','single_admission_flag','config_environment_mismatch','raw_environment_mismatch',
 'config_source_mismatch','raw_source_mismatch','source_syntax','project_id_syntax','project_digest_mismatch',
 'sdk_project_mismatch','sdk_environment_mismatch','control_host_mismatch','table_id_syntax','nonce_syntax',
 'verified_at','expires_at','legacy_expiry','timeout','clock_type','transport_factory_type',
 'dormant_fields','dormant_shape','dormant_times','dormant_source','dormant_project_or_table','dormant_host',
 'dormant_nonce','capability_fields','evidence_roles','evidence_fields','evidence_digest','evidence_times',
 'unclassified',
]);
const boundedInteger=(value,min,max)=>Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=min&&value<=max;
function bindingDiagnosticError(reason,partIndex,expectedCodeUnits,observedCodeUnits){
 const error=Object.assign(new Error('REPORT_STORAGE_QUALIFICATION_HELD'),{code:'REPORT_STORAGE_QUALIFICATION_HELD'});
 try{
  let failure={schemaVersion:1,firstFailure:typeof reason==='string'&&REASONS.has(reason)?reason:'unclassified'};
  // Primitive arguments only: no configuration/part object is inspected or saved.
  if(reason==='part_length'&&boundedInteger(partIndex,0,40)&&boundedInteger(expectedCodeUnits,1,400)
   &&boundedInteger(observedCodeUnits,0,Number.MAX_SAFE_INTEGER)&&observedCodeUnits!==expectedCodeUnits){
   failure={schemaVersion:2,firstFailure:'part_length',partIndex,expectedCodeUnits,
    observedCodeUnits:observedCodeUnits<=4096?observedCodeUnits:'above_limit'};
  }
  failures.set(error,Object.freeze(failure));
 }catch{}
 // Failed observation must still return the original generic held outcome.
 return error;
}
function storageBindingFailureDiagnostic(error){
 try{
  const failure=failures.get(error);
  return failure&&(failure.schemaVersion===1||failure.schemaVersion===2&&failure.firstFailure==='part_length')
   &&typeof failure.firstFailure==='string'
   &&REASONS.has(failure.firstFailure)?failure:undefined;
 }catch{return undefined;}
}
module.exports={bindingDiagnosticError,storageBindingFailureDiagnostic};
