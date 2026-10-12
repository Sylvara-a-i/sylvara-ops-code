'use strict';
const {createReportRunTransport}=require('../../lib/report-run-transport');
// Logical SDK/projection fixture only. Native socket containment is exercised by
// report-successor-physical.test.js, not by these synthetic Writable requests.
function logicalStorageTransport(options,sdk){
 const io=createReportRunTransport({...options,storagePhysicalContainment:false});
 const stop=()=>{for(const request of sdk.created)if(!request.destroyed)request.destroy();};
 return Object.freeze({...io,stop,async stopAndDrain(){stop();await new Promise(resolve=>setImmediate(resolve));return {quiescent:sdk.created.every(request=>request.closed)};}});
}
module.exports={logicalStorageTransport};
