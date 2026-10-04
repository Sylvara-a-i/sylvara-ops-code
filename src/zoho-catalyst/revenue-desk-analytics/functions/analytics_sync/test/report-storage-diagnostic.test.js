'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createStorageDiagnostic,recordStorageDiagnostic,storageDiagnosticError,storageFailureDiagnostic}=require('../lib/report-storage-diagnostic');
const {recordStorageProviderResult}=require('../lib/report-storage-diagnostic');
test('provider diagnostic projects only bounded status and exact own data-property code',()=>{
 const tracker=createStorageDiagnostic();let accessed=false;
 recordStorageProviderResult(tracker,409,{code:'DUPLICATE_VALUE',message:'synthetic-private-message'});
 let s=storageFailureDiagnostic(storageDiagnosticError(tracker));assert.equal(s.httpStatus,409);assert.equal(s.providerCode,'duplicate_value');assert.equal(JSON.stringify(s).includes('synthetic-private'),false);
 recordStorageProviderResult(tracker,400,{code:'INVALID_DATA'});s=storageFailureDiagnostic(storageDiagnosticError(tracker));assert.equal(s.providerCode,'invalid_data');
 recordStorageProviderResult(tracker,600,{get code(){accessed=true;throw Error('private');}});assert.equal(accessed,false);
 s=storageFailureDiagnostic(storageDiagnosticError(tracker));assert.equal(Object.hasOwn(s,'httpStatus'),false);assert.equal(s.providerCode,'unknown');
 recordStorageProviderResult(tracker,403,{code:'PRIVATE_BODY'});assert.equal(storageFailureDiagnostic(storageDiagnosticError(tracker)).providerCode,'other');
});
test('only issued errors expose immutable closed snapshots without inspecting arbitrary properties',()=>{
 const tracker=createStorageDiagnostic();recordStorageDiagnostic(tracker,'authenticate_enter','admission_insert','attempted');
 const error=storageDiagnosticError(tracker),snapshot=storageFailureDiagnostic(error);
 assert.deepEqual(snapshot,{lastStage:'authenticate_enter',lastOperation:'admission_insert',attempted:1,dispatchStarted:0,responses:0,counterOverflow:false});
 assert.ok(Object.isFrozen(snapshot));assert.throws(()=>{snapshot.attempted=99;},TypeError);
 recordStorageDiagnostic(tracker,'dispatch_admitted','admission_insert','dispatchStarted');assert.equal(snapshot.dispatchStarted,0);
 const hostile=new Proxy({storageDiagnostic:snapshot},{get(){assert.fail('arbitrary error getter');}});
 assert.equal(storageFailureDiagnostic(hostile),undefined);assert.equal(storageFailureDiagnostic(null),undefined);
 assert.equal(storageFailureDiagnostic('private error'),undefined);
});
test('unknown trackers, enum values and arbitrary counters cannot enter or grow the log projection',()=>{
 const tracker=createStorageDiagnostic();
 for(const stage of ['SYNTHETIC_PRIVATE_TOKEN',null,{},'authenticate_enter'])recordStorageDiagnostic(tracker,stage,'private operation','attempted');
 recordStorageDiagnostic({},'authenticate_enter','admission_insert','attempted');
 recordStorageDiagnostic(tracker,'authenticate_enter','admission_insert','private counter');
 assert.equal(storageFailureDiagnostic(storageDiagnosticError(tracker)).attempted,0);
 for(let i=0;i<30;i++)recordStorageDiagnostic(tracker,'request_prepare','report_read','attempted');
 const s=storageFailureDiagnostic(storageDiagnosticError(tracker));assert.equal(s.attempted,13);assert.equal(s.counterOverflow,true);
 assert.equal(JSON.stringify(s).includes('private'),false);assert.deepEqual(Object.keys(s).sort(),['attempted','counterOverflow','dispatchStarted','lastOperation','lastStage','responses']);
});
