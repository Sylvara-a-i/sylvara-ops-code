'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {extractAnalysis}=require('../lib/analysis');
const callback=require('../../../../../retell/agents/7-day-free-test/contracts/callback-confirmation-contract.json');
const canonical=require('../contracts/revenue-desk-call-contract.json');
const event=(confirmed,number='+12025550123')=>({from_number:'+12025550999',call_analysis:{custom_analysis_data:{outcome:'potential_job',coverage_trigger:'AfterHours',customer_type:'new',urgency:'routine',sensitive_data_detected:false,callback_number:number,...(confirmed===undefined?{}:{callback_number_confirmed:confirmed})}}});
test('callback contract aligns optional boolean/null semantics without changing required resolver/event schemas',()=>{
 assert.equal(callback.post_call_field.name,'callback_number_confirmed');assert.equal(callback.post_call_field.type,canonical.optional_handoff_analysis.callback_number_confirmed.type);
 assert.equal(callback.post_call_field.required,false);assert.equal(callback.post_call_field.format_or_caller_id_is_confirmation,false);
 assert.equal(callback.runtime_authority,false);assert.equal(callback.deployment_authorized,false);
 assert.deepEqual(callback.status_alignment.confirmed_usable_requires,['usable_final_caller_stated_number','explicit_confirmation_of_final_number','callback_number_confirmed_exactly_true']);
 assert.equal(callback.status_alignment.backend_retains_number_only_for_exact_true,true);
});
test('missing/null/false confirmation never makes formatted extraction or caller ID actionable',()=>{
 for(const value of [undefined,null,false]){
  const result=extractAnalysis(event(value));assert.equal(result.callbackNumber,null);assert.equal(result.callbackNumberConfirmed,value===false?false:null);
 }
});
test('only explicit boolean true retains the final extracted number, never caller ID',()=>{
 const result=extractAnalysis(event(true));assert.equal(result.callbackNumber,'+12025550123');assert.equal(result.callbackNumberConfirmed,true);
 assert.notEqual(result.callbackNumber,event(true).from_number);
});
test('string/numeric/truthy confirmation and true without a usable final number fail closed',()=>{
 for(const value of ['true','false',1,0,{},[]])assert.throws(()=>extractAnalysis(event(value)));
 for(const value of [null,'','2025550123','unconfirmed'])assert.throws(()=>extractAnalysis(event(true,value)));
});
test('a corrected number without fresh explicit confirmation is withheld',()=>{
 assert.equal(extractAnalysis(event(true)).callbackNumber,'+12025550123');
 assert.equal(extractAnalysis(event(null,'+12025550124')).callbackNumber,null);
 assert.equal(extractAnalysis(event(true,'+12025550124')).callbackNumber,'+12025550124');
});
test('sensitive-data minimization overrides otherwise confirmed callback evidence',()=>{
 const e=event(true);e.call_analysis.custom_analysis_data.sensitive_data_detected=true;
 const result=extractAnalysis(e);assert.equal(result.callbackNumber,null);assert.equal(result.callbackNumberConfirmed,null);
 assert.equal(result.sensitiveDataMinimized,true);
 assert.deepEqual(callback.precedence,['immediate_safety_end','consent_withdrawal_end','sensitive_data_minimization','ordinary_callback_confirmation']);
 assert.equal(callback.collection.read_back_alternate_number_once,true);assert.equal(callback.collection.maximum_clarifications,1);
});
