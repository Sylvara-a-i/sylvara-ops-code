'use strict';
// This versioned contract is exclusively the fixed Development synthetic storage diagnostic.
// It is not a credential, report-delivery, customer workflow or product duration setting.
const LEGACY_WINDOW_MS=900000,DEVELOPMENT_SYNTHETIC_WINDOW_MS=3600000;
const PROFILE='report_storage_qualification_v1';
// Schema 7 has no pre-execution lease. Do not represent that with Infinity or
// zero in the legacy duration API: callers must choose the explicit protocol.
function isUntimedDiagnostic(contract){
 return !!contract&&Object.keys(contract).sort().join(',')==='environment,profile,schemaVersion'
  &&contract.schemaVersion===7&&contract.environment==='development'&&contract.profile===PROFILE;
}
function diagnosticWindowMs(contract){
 if(!contract||Object.keys(contract).sort().join(',')!=='environment,profile,schemaVersion'
  ||contract.environment!=='development'||contract.profile!==PROFILE
  ||![3,4,5,6].includes(contract.schemaVersion))throw Object.assign(new Error('REPORT_STORAGE_QUALIFICATION_HELD'),{code:'REPORT_STORAGE_QUALIFICATION_HELD'});
 return [4,6].includes(contract.schemaVersion)?DEVELOPMENT_SYNTHETIC_WINDOW_MS:LEGACY_WINDOW_MS;
}
module.exports={LEGACY_WINDOW_MS,DEVELOPMENT_SYNTHETIC_WINDOW_MS,PROFILE,diagnosticWindowMs,isUntimedDiagnostic};
