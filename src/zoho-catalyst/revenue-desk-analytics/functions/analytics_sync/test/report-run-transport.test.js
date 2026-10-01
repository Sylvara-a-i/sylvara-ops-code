'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const https=require('node:https'),http=require('node:http');
const {Writable,PassThrough}=require('node:stream');
const {createReportRunTransport}=require('../lib/report-run-transport');
const {createReportSuccessorStore}=require('../lib/report-successor-store');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const held={code:'REPORT_RUN_RECONCILIATION_REQUIRED'};
const key='a'.repeat(64),sql=`SELECT * FROM ReportRuns WHERE IdempotencyKey = 'revenue-desk-report-v1:${key}' LIMIT 2`;
const state={kind:'report_attempt_v1',identity:{clientId:'client_A',deploymentId:'deployment_A',periodStart:'2026-09-20',periodEnd:'2026-09-27'},phase:'working',owner:'synthetic',failures:1,nextAttemptAt:1800000000000,lastGenerationKey:null};
function fixture(){
 let at=1800000000000;const rows=new Map(),requests=[],principals=[],created=[];let sequence=0,authDelay=null,mode='normal',clientCalls=0;
 const binding={schemaVersion:1,enabled:true,environment:'development',sourceRevision:'a'.repeat(40),projectId:'123456789',
  controlHost:'synthetic.invalid',tableId:'123456788',nonce:'c'.repeat(32),verifiedAt:at-1,expiresAt:at+60000,timeoutMs:1000};
 const config={environment:'development',sourceRevision:binding.sourceRevision,controlHost:binding.controlHost,
  expectedProjectIdSha256:sha(binding.projectId),operatorIdHash:'operator_'+sha('synthetic')};
 let user='admin';
 const app={config:{projectId:binding.projectId,projectKey:'synthetic-key',environment:'Development'},
  credential:{switchUser(value){user=value;principals.push(value);},getCurrentUser:()=>user,getCurrentUserType:()=> 'admin'},
  async authenticateRequest(request){if(authDelay)await authDelay;request.headers.Authorization='synthetic-managed-credential';}};
 function query(sql){
  const key=/IdempotencyKey = '([^']+)'/.exec(sql)?.[1];
  if(key)return rows.has(key)?[{ReportRuns:structuredClone(rows.get(key))}]:[];
  const prefix=/IdempotencyKey LIKE '([^']+)%'/.exec(sql)?.[1];
  return [...rows.values()].filter(r=>r.IdempotencyKey.startsWith(prefix)).sort((a,b)=>b.RD_REPORT_VERSION-a.RD_REPORT_VERSION).slice(0,2).map(r=>({ReportRuns:structuredClone(r)}));
 }
 const originalHttps=https.request,originalHttp=http.request;
 https.request=function(options,callback){
  clientCalls++;const parts=[];let request;
  request=new Writable({autoDestroy:false,write(chunk,_encoding,done){parts.push(Buffer.from(chunk));done();},final(done){
   const payload=JSON.parse(Buffer.concat(parts));requests.push({path:options.path,payload});
   assert.equal(options.headers.Authorization,'synthetic-managed-credential');
   assert.equal(options.headers['X-CATALYST-USER'],'admin');
   const path=options.path.replace(`/baas/v1/project/${binding.projectId}`,'');
   queueMicrotask(()=>{
    if(mode==='network_error'){request.destroy(new Error('synthetic socket error'));return;}
    if(mode==='stall')return;
    let status=200,data;
    if(path==='/query')data=query(payload.query);
    else {assert.equal(path,'/table/ReportRuns/row');assert.equal(payload.length,1);
     const row=payload[0];if(rows.has(row.IdempotencyKey)){status=409;data=[];}
     else {row.ROWID=String(++sequence);rows.set(row.IdempotencyKey,structuredClone(row));data=[row];}}
    if(mode==='lost_insert'&&path!=='/query'){request.destroy(new Error('synthetic response lost after insert'));return;}
    const stream=new PassThrough();stream.statusCode=status;stream.headers={'content-type':'application/json'};
    callback(stream);request.emit('response',stream);
    if(mode==='oversize')stream.end('x'.repeat(65537));else stream.end(JSON.stringify({data}));
   });done();}});
  request.method='POST';request.protocol='https:';request.host='synthetic.invalid';request.path=options.path;created.push(request);return request;
 };
 http.request=()=>{throw Error('HTTP/network prohibited');};
 return {app,rows,requests,principals,created,get clientCalls(){return clientCalls;},set mode(v){mode=v;},set authDelay(v){authDelay=v;},restore(){https.request=originalHttps;http.request=originalHttp;}};
}

test('actual SDK unique insert and exact readback preserve managed principal',async()=>{
 const f=fixture();try{const store=createReportSuccessorStore({app:f.app,environment:'development'});
 const root=await store.insert(key,state);assert.equal(root.version,1);
 const next=await store.compareAndSwap(root,{...state,phase:'waiting'});assert.equal(next.version,2);
 assert.equal((await store.get(key)).version,2);assert.equal(f.rows.size,2);
 assert.equal(f.requests.length,6);assert.ok(f.principals.every(v=>v==='user'));
 }finally{f.restore();}
});
test('actual SDK network failure dispatches once without automatic retry',async()=>{
 const f=fixture();try{f.mode='network_error';await assert.rejects(createReportRunTransport({app:f.app}).query(sql),held);
 assert.equal(f.clientCalls,1);assert.equal(f.requests.length,1);
 }finally{f.restore();}
});
test('actual SDK lost insertion response reconciles one immutable dispatch',async()=>{
 const f=fixture();try{f.mode='lost_insert';const store=createReportSuccessorStore({app:f.app,environment:'development'});
 assert.equal((await store.insert(key,state)).version,1);assert.equal(f.rows.size,1);
 assert.equal(f.requests.filter(r=>r.path.includes('/table/')).length,1);
 }finally{f.restore();}
});
test('native deadline cancels stalled response; late auth cannot dispatch',async()=>{
 for(const delayed of [false,true]){const f=fixture();let resume;
 try{if(delayed)f.authDelay=new Promise(resolve=>resume=resolve);else f.mode='stall';
 await assert.rejects(createReportRunTransport({app:f.app,timeoutMs:15}).query(sql),held);
 if(delayed){resume();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.clientCalls,0);}
 else {assert.equal(f.clientCalls,1);assert.ok(f.created[0].destroyed);}
 }finally{f.restore();}}
});
test('oversized response holds and invalid SQL never dispatches',async()=>{
 const f=fixture();try{f.mode='oversize';const transport=createReportRunTransport({app:f.app});
 await assert.rejects(transport.query(sql),held);assert.equal(f.clientCalls,1);
 await assert.rejects(transport.query('DELETE FROM ReportRuns'),held);assert.equal(f.clientCalls,1);
 }finally{f.restore();}
});

test('monotonic expiry rejects authentication before a delayed timer turn',async()=>{
 const f=fixture();try{f.app.authenticateRequest=async()=>{
 const {performance}=require('node:perf_hooks');const until=performance.now()+25;
 while(performance.now()<until){} // Deliberately block the timer only in this regression.
 };
 await assert.rejects(createReportRunTransport({app:f.app,timeoutMs:5}).query(sql),held);
 assert.equal(f.clientCalls,0);
 }finally{f.restore();}
});
