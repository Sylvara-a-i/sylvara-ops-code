'use strict';
// Trusted Node/bootstrap, core intrinsics and dependencies are assumed. This is
// continuity from startup capture, not pre-capture authenticity or TLS attestation.
// The actual entrypoint must initialize before every other application import.
const https=require('node:https');
const {types}=require('node:util');
const CODE='REPORT_RUN_RECONCILIATION_REQUIRED';
let initializationAttempted=false,capturedRequest;
function fail(){throw Object.assign(new Error(CODE),{code:CODE,ambiguous:true});}
function currentRequest(){
 if(types.isProxy(https))fail();
 const descriptor=Object.getOwnPropertyDescriptor(https,'request');
 if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function'
  ||types.isProxy(descriptor.value))fail();
 return descriptor.value;
}
function initializeHttpsBootstrap(){
 if(initializationAttempted)fail();
 initializationAttempted=true;capturedRequest=currentRequest();
}
function assertHttpsBootstrap(){
 if(capturedRequest===undefined)fail();
 if(currentRequest()!==capturedRequest)fail();
 return capturedRequest;
}
module.exports=Object.freeze({initializeHttpsBootstrap,assertHttpsBootstrap});
