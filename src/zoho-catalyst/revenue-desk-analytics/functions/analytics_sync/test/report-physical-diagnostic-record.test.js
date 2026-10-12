'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const diagnostic=require('../lib/report-storage-diagnostic');
const {createStorageDiagnostic,initializePhysicalDiagnostic,recordPhysicalFailure,
 recordPhysicalConstructor,recordPhysicalDrain,invalidatePhysicalDiagnostic,
 storageDiagnosticError,storageFailureDiagnostic}=diagnostic;
const baseline={lastStage:'command',lastOperation:'none',attempted:0,dispatchStarted:0,responses:0,counterOverflow:false};
const fields=['schemaVersion','firstFailure','constructorAttempts','insertConstructorAttempts','drain'];
const failures=['module_load','transport_precondition','capability_scope','node_version','sdk_version',
 'runtime_environment','https_continuity','sdk_contract','managed_context','target_scope','request_contract',
 'admission','authentication','request_limit','constructor_threw','request_io','response_status','response_body',
 'deadline','cancelled','drain','unclassified'];
const drains=['not_created','owned_quiescent','auth_pending','handles_pending','both_pending','unknown'];
function tracker(){const value=createStorageDiagnostic();initializePhysicalDiagnostic(value);return value;}
function snapshot(value){return storageFailureDiagnostic(storageDiagnosticError(value));}
function physical(value){const s=snapshot(value);return Object.fromEntries(fields.map(k=>[k,s[k]]));}

test('physical evidence adds exactly five fixed fields only to initialized issued trackers',()=>{
 assert.deepEqual(snapshot(createStorageDiagnostic()),baseline);
 const t=tracker();assert.deepEqual(snapshot(t),{...baseline,schemaVersion:1,firstFailure:'unclassified',
  constructorAttempts:0,insertConstructorAttempts:0,drain:'not_created'});
 assert.deepEqual(Object.keys(snapshot(t)).sort(),[...Object.keys(baseline),...fields].sort());
 assert.equal(storageFailureDiagnostic(new Error('SYNTHETIC_PRIVATE_ERROR')),undefined);
 assert.equal(storageFailureDiagnostic({diagnostic:snapshot(t)}),undefined);
});

test('first initiating failure survives cancellation, drain changes and repeated initialization',()=>{
 const t=tracker();recordPhysicalConstructor(t,true);recordPhysicalFailure(t,'response_body');
 recordPhysicalFailure(t,'cancelled');initializePhysicalDiagnostic(t);recordPhysicalFailure(t,'drain');
 recordPhysicalDrain(t,'handles_pending');
 assert.deepEqual(physical(t),{schemaVersion:1,firstFailure:'response_body',constructorAttempts:1,
  insertConstructorAttempts:1,drain:'handles_pending'});
});

test('every source-assigned failure and drain classification remains closed and finite',()=>{
 for(const failure of failures){const t=tracker();recordPhysicalFailure(t,failure);assert.equal(snapshot(t).firstFailure,failure);}
 for(const drain of drains){const t=tracker();recordPhysicalDrain(t,drain);assert.equal(snapshot(t).drain,drain);}
});

test('request and insert count ceilings are exact; overflow permanently invalidates both counts',()=>{
 for(const insertOverflow of [false,true]){
  const t=tracker();
  if(insertOverflow){for(let i=0;i<5;i++)recordPhysicalConstructor(t,true);assert.equal(snapshot(t).insertConstructorAttempts,5);}
  else {for(let i=0;i<13;i++)recordPhysicalConstructor(t,i<5);assert.equal(snapshot(t).constructorAttempts,13);assert.equal(snapshot(t).insertConstructorAttempts,5);}
  recordPhysicalConstructor(t,insertOverflow);recordPhysicalDrain(t,'owned_quiescent');initializePhysicalDiagnostic(t);
  const s=snapshot(t);assert.equal(s.constructorAttempts,null);assert.equal(s.insertConstructorAttempts,null);assert.equal(s.drain,'unknown');
 }
});

test('recorder faults preserve the first failure but never manufacture exact zero or quiescence',()=>{
 const t=tracker();recordPhysicalFailure(t,'request_io');invalidatePhysicalDiagnostic(t);
 recordPhysicalConstructor(t,false);recordPhysicalDrain(t,'owned_quiescent');initializePhysicalDiagnostic(t);
 assert.deepEqual(physical(t),{schemaVersion:1,firstFailure:'request_io',constructorAttempts:null,
  insertConstructorAttempts:null,drain:'unknown'});
});

test('hostile recorder arguments are not inspected or coerced and cannot leak sentinels',()=>{
 let touched=0;
 const hostile=new Proxy({}, {get(){touched++;throw Error('SYNTHETIC_PRIVATE_SENTINEL');},
  getOwnPropertyDescriptor(){touched++;throw Error('SYNTHETIC_PRIVATE_SENTINEL');},
  getPrototypeOf(){touched++;throw Error('SYNTHETIC_PRIVATE_SENTINEL');}});
 const accessor={get code(){touched++;throw Error('SYNTHETIC_PRIVATE_SENTINEL');},
  [Symbol.toPrimitive](){touched++;throw Error('SYNTHETIC_PRIVATE_SENTINEL');}};
 for(const argument of [hostile,accessor,null,undefined,'SYNTHETIC_PRIVATE_SENTINEL',42]){
  for(const record of [recordPhysicalFailure,recordPhysicalConstructor,recordPhysicalDrain]){
   const t=tracker();assert.doesNotThrow(()=>record(t,argument));
   const s=snapshot(t);assert.equal(s.constructorAttempts,null);assert.equal(s.insertConstructorAttempts,null);assert.equal(s.drain,'unknown');
   assert.equal(JSON.stringify(s).includes('SYNTHETIC_PRIVATE'),false);
  }
  assert.equal(storageFailureDiagnostic(argument),undefined);
 }
 for(const record of [initializePhysicalDiagnostic,recordPhysicalFailure,recordPhysicalConstructor,recordPhysicalDrain,invalidatePhysicalDiagnostic])
  assert.doesNotThrow(()=>record(hostile,hostile));
 assert.equal(touched,0);
});

test('issued final snapshots remain immutable after later recorder updates or forged error properties',()=>{
 const t=tracker();recordPhysicalConstructor(t,true);recordPhysicalFailure(t,'constructor_threw');recordPhysicalDrain(t,'unknown');
 const error=storageDiagnosticError(t),s=storageFailureDiagnostic(error),bytes=JSON.stringify(s);
 Object.defineProperty(error,'diagnostic',{get(){assert.fail('forged error getter');}});
 recordPhysicalConstructor(t,false);recordPhysicalFailure(t,'cancelled');recordPhysicalDrain(t,'owned_quiescent');
 assert.ok(Object.isFrozen(s));assert.throws(()=>{s.constructorAttempts=0;},TypeError);
 assert.equal(JSON.stringify(s),bytes);assert.equal(storageFailureDiagnostic(error),s);
 assert.equal(s.constructorAttempts,1);assert.equal(s.drain,'unknown');
});
