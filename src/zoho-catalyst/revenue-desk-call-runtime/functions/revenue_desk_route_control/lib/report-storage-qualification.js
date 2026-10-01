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
module.exports={createProtectedStorageQualification};
