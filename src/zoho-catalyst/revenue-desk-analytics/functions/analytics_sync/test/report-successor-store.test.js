'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReportSuccessorStore}=require('../lib/report-successor-store');
const {reportRunProjection}=require('../lib/report-run-store');
const {canonicalJson}=require('../lib/facts');
const key='a'.repeat(64),other='b'.repeat(64);
const state={kind:'report_attempt_v1',identity:{clientId:'client_A',deploymentId:'deployment_A',
 periodStart:'2026-09-20',periodEnd:'2026-09-27'},phase:'working',owner:'synthetic',failures:1,nextAttemptAt:1800000000000,lastGenerationKey:null};
const held={code:'REPORT_RUN_RECONCILIATION_REQUIRED'};
function fixture(){
 const rows=new Map(),queries=[],writes=[];let next=100,mode='normal';
 const transport={async insert(row){writes.push(structuredClone(row));
  if(rows.has(row.IdempotencyKey))throw Error('unique constraint');
  if(mode!=='lost')rows.set(row.IdempotencyKey,{...structuredClone(row),ROWID:String(++next)});
  if(mode==='unknown'||mode==='lost')throw Error('synthetic unknown response');
 },async query(sql){queries.push(sql);assert.ok(sql.startsWith('SELECT '));
  const exact=/IdempotencyKey = '([^']+)'/.exec(sql);
  if(exact)return rows.has(exact[1])?[structuredClone(rows.get(exact[1]))]:[];
  const prefix=/IdempotencyKey LIKE '([^']+)%'/.exec(sql)[1];
  return [...rows.values()].filter(r=>r.IdempotencyKey.startsWith(prefix))
   .sort((a,b)=>b.RD_REPORT_VERSION-a.RD_REPORT_VERSION).slice(0,2).map(row=>structuredClone(row));
 }};
 const make=()=>createReportSuccessorStore({app:{},environment:'development',transport});
 return {rows,queries,writes,make,store:make(),set mode(value){mode=value;}};
}
test('initial claim uses existing unique root; successors are insert-only and exact projections',async()=>{
 const f=fixture(),first=await f.store.insert(key,state);
 const next=await f.store.compareAndSwap(first,{...state,phase:'waiting'});
 assert.equal(first.version,1);assert.equal(next.version,2);assert.equal(f.rows.size,2);
 assert.equal(f.writes[0].IdempotencyKey,'revenue-desk-report-v1:'+key);
 assert.match(f.writes[1].IdempotencyKey,/:0000000002$/);
 assert.equal(f.writes[1].ApprovalStatus,'OwnerReviewRequired');
 assert.equal((await f.make().get(key)).state.phase,'waiting');
 assert.ok(f.queries.every(q=>!q.includes('UPDATE')));
});
test('concurrent different and identical states have exactly one successor owner',async()=>{
 for(const same of [false,true]){
  const f=fixture();await f.store.insert(key,state);
  const left=f.make(),right=f.make(),a=await left.get(key),b=await right.get(key);
  const outcomes=await Promise.all([left.compareAndSwap(a,{...state,phase:'waiting'}),
   right.compareAndSwap(b,{...state,phase:same?'waiting':'verified'})]);
  assert.equal(outcomes.filter(Boolean).length,1);assert.equal(f.rows.size,2);
  assert.notEqual(JSON.parse(f.writes[1].ReportPayloadJson).owner,JSON.parse(f.writes[2].ReportPayloadJson).owner);
 }
});
test('unknown accepted insert reconciles exact slot; lost insertion holds without retry',async()=>{
 const f=fixture();f.mode='unknown';const first=await f.store.insert(key,state);
 assert.equal(first.version,1);assert.equal(f.writes.length,1);
 const next=await f.store.compareAndSwap(first,{...state,phase:'waiting'});
 assert.equal(next.version,2);assert.equal(f.writes.length,2);
 const lost=fixture();lost.mode='lost';await assert.rejects(lost.store.insert(key,state),held);
 assert.equal(lost.writes.length,1);assert.equal(lost.rows.size,0);
});
test('stale issued row cannot overwrite successor or duplicate accepted effects',async()=>{
 const f=fixture(),first=await f.store.insert(key,state);
 await f.store.compareAndSwap(first,{...state,phase:'verified'});
 assert.equal(await f.store.compareAndSwap(first,{...state,phase:'working'}),null);
 assert.equal((await f.store.get(key)).state.phase,'verified');
 await assert.rejects(f.store.compareAndSwap({...first},state),held);
});
test('bounded head query selects current state from long history without a mutable pointer',async()=>{
 const f=fixture();let current=await f.store.insert(key,state);
 for(let i=0;i<20;i++)current=await f.store.compareAndSwap(current,{...state,nextAttemptAt:state.nextAttemptAt+i});
 const count=f.queries.length;assert.equal((await f.make().get(key)).version,21);
 assert.equal(f.queries.length-count,2);assert.equal(f.rows.size,21);
});
test('root/digest/ancestry corruption and skipped successors hold',async()=>{
 for(const field of ['rootDigest','digest','rowId','version']){
  const f=fixture(),first=await f.store.insert(key,state);await f.store.compareAndSwap(first,{...state,phase:'waiting'});
  const row=[...f.rows.values()][1],body=JSON.parse(row.ReportPayloadJson);
  if(field==='rootDigest')body.rootDigest='c'.repeat(64);
  else body.predecessor[field]=field==='version'?7:field==='digest'?'c'.repeat(64):'999';
  row.ReportPayloadJson=canonicalJson(body);await assert.rejects(f.make().get(key),held);
 }
 const f=fixture();let current=await f.store.insert(key,state);
 current=await f.store.compareAndSwap(current,{...state,phase:'waiting'});
 await f.store.compareAndSwap(current,{...state,phase:'verified'});
 f.rows.delete('revenue-desk-report-v2:'+key+':0000000002');await assert.rejects(f.make().get(key),held);
});
test('legacy accepted root remains exact and read-only; new insert cannot replace it',async()=>{
 const f=fixture(),legacy={...state,phase:'verified'},id='revenue-desk-report-v1:'+key;
 const row={...reportRunProjection(legacy),IdempotencyKey:id,ReportRunId:id,
  RD_REPORT_VERSION:4,ReportPayloadJson:canonicalJson(legacy),ROWID:'101'};f.rows.set(id,row);
 const before=structuredClone(row),current=await f.store.get(key);
 assert.equal(current.storageRevision,'legacy_read_only_v1');assert.equal(current.version,4);
 await assert.rejects(f.store.compareAndSwap(current,state),held);
 assert.equal(await f.store.insert(key,state),null);
 assert.equal((await f.store.get(key)).storageRevision,'legacy_read_only_v1');
 assert.deepEqual(f.rows.get(id),before);assert.equal(f.rows.size,1);
});
test('client keys stay isolated; caller-supplied SQL and invalid scope never dispatch',async()=>{
 const f=fixture();await f.store.insert(key,state);await f.store.insert(other,{...state,identity:{...state.identity,clientId:'client_B'}});
 assert.equal((await f.store.get(key)).state.identity.clientId,'client_A');
 const before=f.queries.length;await assert.rejects(f.store.get("' OR true"),held);assert.equal(f.queries.length,before);
});
test('aborted/budget-exhausted operation dispatches no insert; physical reads are counted',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();
 await assert.rejects(f.store.insert(key,state,{signal:controller.signal}),held);assert.equal(f.writes.length,0);
 await f.store.insert(key,state);const used={};const budget={consume(k){used[k]=(used[k]||0)+1;}};
 await f.store.get(key,{budget});assert.equal(used.report_run_read,2);
 await assert.rejects(f.store.get(key,{budget:{consume(){throw Error('limit');}}}));
});
module.exports={fixture,state,key};

test('identical concurrent roots grant insertion ownership once; replay uses get',async()=>{
 const f=fixture(),left=f.make(),right=f.make();
 const results=await Promise.all([left.insert(key,state),right.insert(key,state)]);
 assert.equal(results.filter(Boolean).length,1);assert.equal(f.rows.size,1);
 assert.equal((await right.get(key)).version,1);
});
