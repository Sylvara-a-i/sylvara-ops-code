'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {installOfflineGuard}=require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard=installOfflineGuard();test.after(()=>{guard.restore();assert.deepEqual(guard.blocked,[]);});
const {createReconciledReportFixture}=require('./helpers/reconciled-report-fixture');
test('explicit new work and Unknown reconcile canonical report with complete Analytics partitions',async()=>{
 for(const explicit of [true,false]){
 const analysis={customer_type:'existing',outcome:'potential_job',bookable_opportunity:true};
 if(explicit)analysis.request_kind='new_service_request';
 const f=await createReconciledReportFixture({analyses:[analysis]});
 const out=await f.readInput(f.identity);
 const canonical=JSON.parse(f.runtime.store.rows.get('RevenueDeskCalls')[0].CANONICAL_CALL_JSON);
 assert.equal(canonical.requestKind,explicit?'new_service_request':'unknown');
 assert.equal(canonical.bookableOpportunity,explicit?true:null);
 assert.ok(f.analyticsStore.rows.every(row=>row.SYNC_STATUS==='Succeeded'));
 assert.equal(out.input.calls.length,1);
 const fact=JSON.parse(f.runtime.store.rows.get('AnalyticsSyncOutbox').filter(r=>r.RECORD_TYPE==='call').at(-1).PAYLOAD_JSON);
 assert.equal(fact.BOOKABLE_OPPORTUNITY,explicit?true:undefined);
 assert.equal(Object.hasOwn(fact,'BOOKABLE_OPPORTUNITY'),explicit);
 }
});

test('published provider-neutral request fixtures match the exact optional runtime contract',()=>{
 const contract=require('../../../../../retell/agents/7-day-free-test/contracts/request-intent-contract.json');
 const {extractAnalysis}=require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/analysis');
 assert.equal(contract.provider_field,'request_kind');assert.equal(contract.canonical_field,'requestKind');
 assert.equal(contract.runtime_authority,false);assert.equal(contract.deployment_authorized,false);
 assert.deepEqual(contract.values,['new_service_request','existing_job_follow_up','unknown']);
 for(const fixture of contract.fixtures){
 const data=Object.fromEntries(Object.entries(fixture).filter(([k])=>!k.startsWith('expected')));
 if(fixture.expected)assert.throws(()=>extractAnalysis({call_analysis:{custom_analysis_data:data}}),{code:fixture.expected});
 else {const result=extractAnalysis({call_analysis:{custom_analysis_data:data}});
 assert.equal(result.bookableOpportunity,fixture.expected_bookable);
 assert.equal(result.requestKind,fixture.expected_request_kind||fixture.request_kind);}
 }
});
