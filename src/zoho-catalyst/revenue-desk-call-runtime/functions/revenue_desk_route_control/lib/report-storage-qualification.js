'use strict';
// Default managed composition is packaged with the controller. Loading stays
// lazy so missing/disabled diagnostics cannot construct any runtime adapter.
function createProtectedStorageQualification(options){
 let factory;
 return (...args)=>{
  factory ||= require('../reporting/revenue-desk-analytics/functions/analytics_sync/lib/report-storage-qualification')
   .createProtectedStorageQualification(options);
  return factory(...args);
 };
}
// Only issued failure snapshots cross the log boundary; no arbitrary Error fields.
function storageFailureDiagnostic(error){
 try{return require('../reporting/revenue-desk-analytics/functions/analytics_sync/lib/report-storage-diagnostic')
  .storageFailureDiagnostic(error);}catch{return undefined;}
}
module.exports={createProtectedStorageQualification,storageFailureDiagnostic};
