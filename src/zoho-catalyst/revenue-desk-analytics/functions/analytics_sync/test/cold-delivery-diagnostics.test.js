'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {observeColdDelivery}=require('./helpers/cold-delivery-diagnostics');

function fixture(replacement=null){
 let clock=1000,wall=10;
 const projection={createReportCrmProjectionWriter:options=>replacement?async function(...args){
  try{return await Reflect.apply(options.readProjection,this,args);}catch{throw replacement;}
 }:options.readProjection};
 const handlers={createReportDeliveryHandlers:options=>({afterPair:options.projectReport})};
 const originals={projection:projection.createReportCrmProjectionWriter,handlers:handlers.createReportDeliveryHandlers};
 const observer=observeColdDelivery({handlers,projection,now:()=>clock,wallNow:()=>wall});
 const bind={timeoutMs:1000,verifiedAt:500,expiresAt:5000};
 return {observer,projection,handlers,bind,originals,advance(){clock+=7;wall+=13;}};
}

test('cold diagnostics preserve receiver, arguments, values and staged exports',async()=>{
 const x=fixture(),receiver={},argument={},value={status:'verified',private:'synthetic-private-value'};
 try{
  const operation=x.projection.createReportCrmProjectionWriter({binding:x.bind,readProjection:function(actual){
   assert.equal(this,receiver);assert.equal(actual,argument);x.advance();return Promise.resolve(value);
  }});
  assert.equal(await operation.call(receiver,argument),value);
  const evidence=x.observer.snapshot();assert.equal(evidence.events.length,2);
  assert.deepEqual(evidence.events[1],{stage:'projection',outcome:'returned',code:null,status:'verified',
   boundarySyntheticElapsedMs:7,boundaryWallElapsedMs:13,timeoutMs:1000,qualificationAgeMs:507,
   qualificationExpiresInMs:3993,signalAborted:false});
  assert.equal(JSON.stringify(evidence).includes(value.private),false);
 }finally{x.observer.restore();}
 assert.equal(x.projection.createReportCrmProjectionWriter,x.originals.projection);
 assert.equal(x.handlers.createReportDeliveryHandlers,x.originals.handlers);
});

test('cold diagnostics retain dependency evidence before a held catch without disclosing error text',async()=>{
 const secret='synthetic-private-error',failure=Object.assign(new Error(secret),{code:secret});
 const replacement=Object.assign(new Error(secret),{code:'REPORT_CRM_PROJECTION_HELD'}),x=fixture(replacement);
 try{
  const operation=x.projection.createReportCrmProjectionWriter({binding:x.bind,readProjection:()=>{
   x.advance();return Promise.reject(failure);
  }});
  await assert.rejects(operation(),error=>error===replacement);
  const evidence=x.observer.snapshot();
  assert.deepEqual(evidence.events.map(event=>[event.stage,event.code]),
   [['projection.readProjection','unclassified'],['projection','REPORT_CRM_PROJECTION_HELD']]);
  assert.equal(JSON.stringify(evidence).includes(secret),false);
  failure.code='REPORT_DELIVERY_SELECTION_HELD';
  await assert.rejects(operation(),error=>error===replacement);
  assert.equal(x.observer.snapshot().events.at(-2).code,failure.code);
  assert.equal(x.observer.snapshot().events.at(-1).code,replacement.code);
 }finally{x.observer.restore();}
});

test('cold diagnostics bound history and retain synchronous throws and returned held status',()=>{
 const x=fixture(),failure=Object.assign(new Error('synthetic'),{code:'REPORT_CRM_PROJECTION_HELD'});
 try{
  const operation=x.projection.createReportCrmProjectionWriter({binding:x.bind,readProjection:()=>{throw failure;}});
  assert.throws(()=>operation(),error=>error===failure);
  const value={status:'held'},handlers=x.handlers.createReportDeliveryHandlers({control:{initial:()=>{}},projectReport:()=>value});
  for(let index=0;index<30;index++)assert.equal(handlers.afterPair(),value);
  const evidence=x.observer.snapshot();assert.equal(evidence.events.length,48);assert.equal(evidence.dropped,14);
  assert.equal(evidence.events.at(-1).stage,'delivery.afterPair');assert.equal(evidence.events.at(-1).status,'held');
 }finally{x.observer.restore();}
});
