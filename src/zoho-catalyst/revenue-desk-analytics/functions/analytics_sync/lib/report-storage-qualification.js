'use strict';
const crypto=require('node:crypto');
const {canonicalJson}=require('./facts');
const {createReportSuccessorStore}=require('./report-successor-store');
const {createReportRunTransport}=require('./report-run-transport');
const PROFILE='report_storage_qualification_v1',HASH=/^[a-f0-9]{64}$/,ID=/^[1-9][0-9]{2,29}$/;
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:canonicalJson(x)).digest('hex');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.sort().join(',');
function held(){throw Object.assign(new Error('REPORT_STORAGE_QUALIFICATION_HELD'),{code:'REPORT_STORAGE_QUALIFICATION_HELD'});}
/** Diagnostic only. A warm reservation plus immutable root prevents replayed
 * effects; a single admitted invocation remains required across cold instances.
 * No claim of a distributed invocation counter or complete history audit. */
function createProtectedStorageQualification({environment=process.env,now=Date.now,transportFactory=createReportRunTransport}={}){
 const consumed=new Set();
 return function storageQualification(app,config){
  const raw=environment.REPORT_STORAGE_QUALIFICATION_JSON,pin=environment.REPORT_STORAGE_QUALIFICATION_SHA256;
  if(typeof raw!=='string'||Buffer.byteLength(raw)>4096||!HASH.test(pin||'')||sha(raw)!==pin)held();
  let b;try{b=JSON.parse(raw);}catch{held();}
  if(!exact(b,['schemaVersion','enabled','environment','sourceRevision','projectId','controlHost','tableId','nonce',
   'principalSha256','creatorIdSha256','verifiedAt','expiresAt','timeoutMs','singleAdmittedInvocation'])
   ||b.schemaVersion!==1||b.enabled!==true||b.environment!=='development'||b.singleAdmittedInvocation!==true
   ||config?.environment!==b.environment||environment.DEPLOYMENT_ENVIRONMENT!==b.environment
   ||b.sourceRevision!==config.sourceRevision||environment.SOURCE_REVISION!==b.sourceRevision||!/^[a-f0-9]{40}$/.test(b.sourceRevision||'')
   ||!ID.test(b.projectId||'')||sha(b.projectId)!==config.expectedProjectIdSha256
   ||String(app?.config?.projectId)!==b.projectId||String(app.config.environment).toLowerCase()!=='development'
   ||b.controlHost!==config.controlHost||!ID.test(b.tableId||'')||!/^[a-f0-9]{32}$/.test(b.nonce||'')
   ||![b.principalSha256,b.creatorIdSha256].every(x=>HASH.test(x||''))
   ||!Number.isSafeInteger(b.verifiedAt)||b.verifiedAt<0||!Number.isSafeInteger(b.expiresAt)
   ||b.expiresAt<=b.verifiedAt||b.expiresAt-b.verifiedAt>900000
   ||!Number.isSafeInteger(b.timeoutMs)||b.timeoutMs<1||b.timeoutMs>60000||typeof now!=='function'||typeof transportFactory!=='function')held();
  const key=sha({mechanism:'unique_insert_successor_v1',projectId:b.projectId,tableId:b.tableId,nonce:b.nonce,sourceRevision:b.sourceRevision});
  const rootKey='revenue-desk-report-v1:'+key;
  const active=()=>{const at=now();if(!Number.isSafeInteger(at)||at<b.verifiedAt||at>=b.expiresAt)held();return at;};active();
  return Object.freeze({async handle(command,{actor,signal}={}){
   if(!exact(command,['profile','action'])||command.profile!==PROFILE
    ||!['qualify_storage','read_storage_evidence'].includes(command.action)
    ||actor?.kind!=='internal_controller'||actor.identity!==config.operatorIdHash
    ||(signal!==undefined&&!(signal instanceof AbortSignal)))held();
   const write=command.action==='qualify_storage';
   if(write&&consumed.has(key))held();
   if(write)consumed.add(key); // Before any await; unknown/failed admission is consumed.
   const start=active(),wall=performance.now()+b.timeoutMs,abort=new AbortController();
   let reject;const deadline=new Promise((_,r)=>{reject=r;});deadline.catch(()=>{});
   const cancel=()=>{abort.abort();reject(new Error('REPORT_STORAGE_QUALIFICATION_HELD'));};
   signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const timer=setTimeout(cancel,b.timeoutMs);
   const counts={reads:0,inserts:0};
   function admission(){const at=active();if(abort.signal.aborted||at<start||at-start>=b.timeoutMs||performance.now()>=wall)held();return at;}
   const budget={assertActive:admission,consume(kind){admission();if(kind==='report_run_read'){if(++counts.reads>8)held();}
    else if(kind==='report_run_write'){if(!write||++counts.inserts>4)held();}else held();}};
   const options={signal:abort.signal,budget};
   async function run(){
    admission();const io=transportFactory({app,timeoutMs:Math.min(b.timeoutMs,3000)});
    if(!['query','insert','currentPrincipal'].every(k=>typeof io?.[k]==='function'))held();
    budget.consume('report_run_read');const principal=await io.currentPrincipal(options);admission();
    if(principal?.status!=='ACTIVE'||principal.roleName!=='App Administrator'||!ID.test(principal.userId||'')||!ID.test(principal.roleId||'')
     ||sha({projectId:b.projectId,userId:principal.userId,roleId:principal.roleId})!==b.principalSha256
     ||sha(principal.userId)!==b.creatorIdSha256)held();
    const rows=new Map();
    const checked={async query(sql,o){const {trace,...readOptions}=o||{};const found=await io.query(sql,readOptions);admission();
     if(!Array.isArray(found)||found.length>2)held();
     for(const entry of found){const row=entry.ReportRuns||entry;
      if(sha(String(row?.CREATORID||''))!==b.creatorIdSha256||!/^[1-9][0-9]{0,29}$/.test(String(row?.ROWID||'')))held();
      if(rows.has(row.ROWID)&&canonicalJson(rows.get(row.ROWID))!==canonicalJson(row))held();
      rows.set(row.ROWID,structuredClone(row));}
     return found;},async insert(row,o){admission();if(!write)held();return io.insert(row,o);}};
    const left=createReportSuccessorStore({app,environment:'development',transport:checked});
    const right=createReportSuccessorStore({app,environment:'development',transport:checked});
    if(!write){
     const head=await left.get(key,options);admission();
     if(!head||head.storageRevision!=='unique_insert_successor_v1'||head.state?.diagnostic?.nonce!==b.nonce
      ||head.state.diagnostic.sourceRevision!==b.sourceRevision||head.version>2)held();
     return Object.freeze({status:'storage_evidence_unattested',mechanism:'unique_insert_successor_v1',
      operationDigest:key,evidenceDigest:sha({rows:[...rows.values()].sort((a,c)=>String(a.ROWID).localeCompare(String(c.ROWID)))}),
      physicalRows:rows.size,headVersion:head.version,reads:counts.reads,inserts:0,qualificationAuthority:false,deliveryAuthority:false});
    }
    budget.consume('report_run_read');const prior=await checked.query(`SELECT * FROM ReportRuns WHERE IdempotencyKey = '${rootKey}' LIMIT 2`,options);
    if(prior.length)held(); // A durable consumed identity is never restarted, even after a cold reload.
    const identity={clientId:'qualification_'+b.nonce,deploymentId:'qualification_'+b.nonce,periodStart:'1970-01-01',periodEnd:'1970-01-01'};
    const state=label=>({kind:'report_attempt_v1',identity,phase:'working',owner:'synthetic_'+label,failures:0,nextAttemptAt:0,lastGenerationKey:null,
     diagnostic:{nonce:b.nonce,sourceRevision:b.sourceRevision,label}});
    const traces=new Map();
    function contender(label){const events=[];traces.set(label,events);return {...options,trace:e=>{admission();events.push(e);}};}
    function round(labels,outcomes){
     if(outcomes.some(x=>x.status!=='fulfilled')||outcomes.filter(x=>x.value).length!==1)held();
     const winner=outcomes.findIndex(x=>x.value);
     const facts=labels.map(label=>traces.get(label));
     for(let i=0;i<facts.length;i++){
      const events=facts[i],dispatch=events.filter(e=>e.event==='dispatch'),result=events.filter(e=>e.event==='outcome');
      if(dispatch.length!==1||result.length!==1||dispatch[0].operation!=='insert'
       ||(i===winner?result[0].accepted!==true:result[0].duplicate!==true))held();
     }
     const lastDispatch=Math.max(...facts.map(e=>e.find(x=>x.event==='dispatch').at));
     const firstResponse=Math.min(...facts.map(e=>e.find(x=>x.event==='response')?.at??-1));
     if(lastDispatch>=firstResponse)held();
     return winner;
    }
    const root=await Promise.allSettled([left.insert(key,state('root_left'),contender('root_left')),
     right.insert(key,state('root_right'),contender('root_right'))]);admission();
    const rootWinner=round(['root_left','root_right'],root),owner=rootWinner===0?left:right,accepted=root[rootWinner].value;
    const successorState=label=>({...state(label),phase:'waiting'});
    const successors=await Promise.allSettled([owner.compareAndSwap(accepted,successorState('successor_left'),contender('successor_left')),
     owner.compareAndSwap(accepted,successorState('successor_right'),contender('successor_right'))]);admission();
    const successorWinner=round(['successor_left','successor_right'],successors),head=await owner.get(key,options);admission();
    if(head?.version!==2||head.rowId!==successors[successorWinner].value.rowId||rows.size!==2||counts.reads!==8||counts.inserts!==4)held();
    const observedAt=admission(),evidence={bindingSha256:pin,operationDigest:key,principalSha256:b.principalSha256,
     rows:[...rows.values()].sort((a,c)=>String(a.ROWID).localeCompare(String(c.ROWID))),rootWinner,successorWinner,
     requests:[...traces.entries()],counts,observedAt};
    return Object.freeze({status:'storage_unique_successor_observed',mechanism:'unique_insert_successor_v1',operationDigest:key,
     evidenceDigest:sha(evidence),observedAt,physicalRows:2,reads:8,inserts:4,overlappingRounds:2,
     singleAdmittedInvocationRequired:true,qualificationAuthority:false,deliveryAuthority:false});
   }
   try{const result=await Promise.race([run(),deadline]);admission();return result;}
   catch{held();}finally{clearTimeout(timer);abort.abort();signal?.removeEventListener('abort',cancel);}
  }});
 };
}
module.exports={createProtectedStorageQualification,PROFILE};
