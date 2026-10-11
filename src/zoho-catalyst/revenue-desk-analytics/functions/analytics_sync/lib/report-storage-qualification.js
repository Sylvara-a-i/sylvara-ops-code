'use strict';
const crypto=require('node:crypto');
const {decodeStorageBinding}=require('./report-storage-binding');
const {canonicalJson}=require('./facts');
const {createReportSuccessorStore}=require('./report-successor-store');
const {createReportRunTransport}=require('./report-run-transport');
const {validateStorageCapability,validateStoredProjection,matchesStoredReportField}=require('./report-storage-capability');
const {diagnosticWindowMs}=require('./report-storage-window');
const {createStorageDiagnostic,recordStorageDiagnostic,storageDiagnosticError,recordStorageValidationFailure}=require('./report-storage-diagnostic');
const PROFILE='report_storage_qualification_v1',HASH=/^[a-f0-9]{64}$/,ID=/^[1-9][0-9]{2,29}$/;
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:canonicalJson(x)).digest('hex');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.sort().join(',');
// Only the ReportRuns insert ACK accepts these schema-pinned Boolean encodings.
// Compare without rewriting the submitted row, ACK or independent readback.
const REPORT_ACK_BOOLEAN_FIELDS=Object.freeze(['ActualEstimatedSeparated','CrossClientIsolationPassed',
 'DuplicateSendGuardPassed','ReportTotalsReconciled','AutoDeliveryEnabledAtRun']);
function matchesReportAckField(field,expected,actual){
 if(!REPORT_ACK_BOOLEAN_FIELDS.includes(field))return matchesStoredReportField(field,expected,actual);
 if(typeof expected!=='boolean')return false;
 return actual===expected||actual===(expected?'true':'false');
}
function held(){throw Object.assign(new Error('REPORT_STORAGE_QUALIFICATION_HELD'),{code:'REPORT_STORAGE_QUALIFICATION_HELD'});}
/** Diagnostic only. A permanently consumed unique receipt admits one owner
 * across cold instances. Ambiguous acceptance never grants dispatch. Admission
 * requests are counted separately; replays still incur request/read cost. */
function createProtectedStorageQualification({environment=process.env,now=Date.now,transportFactory=createReportRunTransport}={}){
 const consumed=new Set();
 return function storageQualification(app,config){
  const raw=decodeStorageBinding(environment),pin=environment.REPORT_STORAGE_QUALIFICATION_SHA256;
  if(typeof raw!=='string'||Buffer.byteLength(raw)>4096||!HASH.test(pin||'')||sha(raw)!==pin)held();
  let b;try{b=JSON.parse(raw);}catch{held();}
  if(!exact(b,['schemaVersion','enabled','environment','sourceRevision','projectId','controlHost','tableId','nonce',
   'capability','verifiedAt','expiresAt','timeoutMs','singleAdmittedInvocation'])
   ||![3,4,5].includes(b.schemaVersion)||b.enabled!==true||b.environment!=='development'||b.singleAdmittedInvocation!==true
   ||config?.environment!==b.environment||environment.DEPLOYMENT_ENVIRONMENT!==b.environment
   ||b.sourceRevision!==config.sourceRevision||environment.SOURCE_REVISION!==b.sourceRevision||!/^[a-f0-9]{40}$/.test(b.sourceRevision||'')
   ||!ID.test(b.projectId||'')||sha(b.projectId)!==config.expectedProjectIdSha256
   ||String(app?.config?.projectId)!==b.projectId||String(app.config.environment).toLowerCase()!=='development'
   ||b.controlHost!==config.controlHost||!ID.test(b.tableId||'')||!/^[a-f0-9]{32}$/.test(b.nonce||'')
      ||!Number.isSafeInteger(b.verifiedAt)||b.verifiedAt<0||!Number.isSafeInteger(b.expiresAt)
   ||b.expiresAt<=b.verifiedAt
   ||!Number.isSafeInteger(b.timeoutMs)||b.timeoutMs<1||b.timeoutMs>60000||typeof now!=='function'||typeof transportFactory!=='function')held();
  const diagnosticContract={schemaVersion:b.schemaVersion,profile:PROFILE,environment:b.environment};
  if(b.expiresAt-b.verifiedAt>diagnosticWindowMs(diagnosticContract))held();
  const capabilityOptions={app,config:{projectId:b.projectId,environment:b.environment},environment,verifiedAt:b.verifiedAt,expiresAt:b.expiresAt,diagnosticContract};
  const capability=validateStorageCapability(b.capability,{...capabilityOptions,now:now()});
  if(b.tableId!==capability.tables.reportRuns.id)held();
  const capabilitySha256=sha(capability);
  const sequential=b.schemaVersion===5;
  const mechanism=sequential?'sequential_unique_diagnostic_v1':'unique_insert_successor_v1';
  const key=sha({mechanism,projectId:b.projectId,tables:capability.tables,nonce:b.nonce,sourceRevision:b.sourceRevision,capabilitySha256});
  const rootKey='revenue-desk-report-v1:'+key;
  const active=()=>{const at=now();validateStorageCapability(capability,{...capabilityOptions,now:at});if(!Number.isSafeInteger(at)||at<b.verifiedAt||at>=b.expiresAt)held();return at;};active();
  return Object.freeze({async handle(command,{actor,signal}={}){
   const diagnostic=createStorageDiagnostic();
   function held(){throw storageDiagnosticError(diagnostic);}
   const observe=stage=>recordStorageDiagnostic(diagnostic,stage);
   if(!exact(command,['profile','action'])||command.profile!==PROFILE
    ||!['qualify_storage','read_storage_evidence'].includes(command.action)
    ||actor?.kind!=='internal_controller'||actor.identity!==config.operatorIdHash
    ||(signal!==undefined&&!(signal instanceof AbortSignal)))held();
   const write=command.action==='qualify_storage';
   if(write&&consumed.has(key))held();
   if(write)consumed.add(key); // Before any await; unknown/failed admission is consumed.
   observe('active');const start=active(),wall=performance.now()+b.timeoutMs,abort=new AbortController();
   let reject;const deadline=new Promise((_,r)=>{reject=r;});deadline.catch(()=>{});
   const cancel=()=>{abort.abort();reject(new Error('REPORT_STORAGE_QUALIFICATION_HELD'));};
   signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const timer=setTimeout(cancel,b.timeoutMs);
   const counts={reads:0,inserts:0,admissionReads:0,admissionInserts:0};
   let provenanceFailed=false;
   function admission(){const at=active();if(provenanceFailed||abort.signal.aborted||at<start||at-start>=b.timeoutMs||performance.now()>=wall)held();return at;}
   const budget={assertActive:admission,consume(kind){admission();if(kind==='report_run_read'){if(++counts.reads>(sequential?3:7))held();}
    else if(kind==='admission_read'){if(!write||++counts.admissionReads>1)held();}
    else if(kind==='admission_write'){if(!write||++counts.admissionInserts>1)held();}
    else if(kind==='report_run_write'){if(!write||++counts.inserts>(sequential?2:4))held();}else held();}};
   const options={signal:abort.signal,budget};
   async function run(){
    admission();observe('transport_construct');const io=transportFactory({storageDiagnostic:diagnostic,storageProviderDiagnostics:sequential,app,timeoutMs:Math.min(b.timeoutMs,3000),storageCapability:capability,storageOperationKey:key,storageAssertActive:admission,storageSourceRevision:b.sourceRevision,storageBindingSha256:pin});
    if(!['query','insert','insertAdmission','readAdmission'].every(k=>typeof io?.[k]==='function'))held();
    let admissionEvidenceDigest,observedCreator;
    const acknowledgments=new Map();
    // Observed provenance only; never account identity or a renewed attestation.
    // Latch validation failure because the successor store catches insert errors.
    const validationFailure=(location,reason)=>recordStorageValidationFailure(diagnostic,location,reason);
    function provenance(row,location){
     const value=row?.CREATORID;
     const id=typeof value==='string'?value:Number.isSafeInteger(value)&&value>0?String(value):'';
     if(!/^[1-9][0-9]{0,29}$/.test(id)||observedCreator!==undefined&&id!==observedCreator){
      validationFailure(location,!/^[1-9][0-9]{0,29}$/.test(id)?'creator_id':'creator_mismatch');provenanceFailed=true;held();}
     observedCreator=id;
    }
    function projection(row,role,location){try{validateStoredProjection(row,role,diagnostic,location);
     if(!/^[1-9][0-9]{0,29}$/.test(String(row?.ROWID||''))){validationFailure(location,'row_id');held();}provenance(row,location);
    }catch(error){provenanceFailed=true;throw error;}}
    if(write){
     // No pre-read race and no ambiguous-write recovery authorizing dispatch.
     const owner=crypto.randomUUID(),eventKey='report-storage:'+key;
     const payload=canonicalJson({kind:'report_storage_admission_v1',operationDigest:key,owner,
      sourceRevision:b.sourceRevision,capabilitySha256,bindingSha256:pin});
     const receipt={EVENT_KEY:eventKey,RECEIPT_KIND:'report_storage_admission',STATUS:'Completed',
      EVENT_TYPE:'storage_qualification',EVENT_DATA_JSON:payload,PAYLOAD_FINGERPRINT:sha(payload),
      RECEIPT_VERSION:1,ATTEMPT_COUNT:0,SOURCE_REVISION:b.sourceRevision,SOURCE_ENVIRONMENT:'development',
      RECEIVED_AT:new Date(admission()).toISOString(),PROCESSED_AT:new Date(admission()).toISOString()};
     budget.consume('admission_write');const accepted=await io.insertAdmission(receipt,options);admission();
     if(!Array.isArray(accepted)||accepted.length!==1)held();
     budget.consume('admission_read');const observed=await io.readAdmission(eventKey,options);admission();
     if(!Array.isArray(observed)||observed.length!==1)held();
     observe('admission_verify');const row=observed[0].RevenueDeskEventReceipts||observed[0],ack=accepted[0];
     projection(ack,'eventReceipts','admission_ack');projection(row,'eventReceipts','admission_row');
     if(String(row.ROWID)!==String(ack.ROWID))held();
     for(const [field,value] of Object.entries(receipt)){
      if(field==='RECEIPT_VERSION'||field==='ATTEMPT_COUNT'){
       // Only the exact numeric value or its canonical bigint string is allowed.
       if(![value,String(value)].includes(row[field])||![value,String(value)].includes(ack[field]))held();
      }
      else if(field==='RECEIVED_AT'||field==='PROCESSED_AT'){
       // Provider formatting is not an expiry authority; independent readback
       // must retain exactly the nonempty bounded timestamp acknowledged.
       if(typeof row[field]!=='string'||row[field].length<1||row[field].length>64||row[field]!==ack[field])held();
      }else if(row[field]!==value||ack[field]!==value)held();
     }
     admissionEvidenceDigest=sha({row:structuredClone(row)});
    }
    const rows=new Map();
    const checked={async query(sql,o){const {trace,...readOptions}=o||{};const found=await io.query(sql,readOptions);admission();
     if(!Array.isArray(found)||found.length>2)held();
     for(const entry of found){const row=entry.ReportRuns||entry;projection(row,'reportRuns','report_row');
      const ack=acknowledgments.get(row.IdempotencyKey);
      if(ack&&Object.keys(ack).some(k=>k!=='CREATORID'&&!matchesStoredReportField(k,ack[k],row[k]))){validationFailure('report_row','readback_mismatch');provenanceFailed=true;held();}
      if(rows.has(row.ROWID)&&canonicalJson(rows.get(row.ROWID))!==canonicalJson(row))held();
      rows.set(row.ROWID,structuredClone(row));}
     return found;},async insert(row,o){admission();if(!write)held();
     const accepted=await io.insert(row,o);admission();
     if(!Array.isArray(accepted)||accepted.length!==1){validationFailure('report_ack','ack_cardinality');provenanceFailed=true;held();}
     const ack=accepted[0];projection(ack,'reportRuns','report_ack');
     const fields=Object.keys(row);
     const mismatch=fields.find(k=>!matchesReportAckField(k,row[k],ack[k]));
     if(mismatch!==undefined){
      const expected=row[mismatch],actual=ack[mismatch];
      const reason=typeof actual===typeof expected&&!(expected===null&&actual!==null)?'field_value'
       :expected===null?'field_null_type':typeof expected==='boolean'?'field_boolean_type':typeof expected==='number'?'field_number_type':'field_text_type';
      validationFailure('report_ack',reason);provenanceFailed=true;held();}
     // Compare independent readback to the submitted canonical expectations,
     // preserving the original ACK/payload and supporting either allowed INT form.
     acknowledgments.set(ack.IdempotencyKey,{...Object.fromEntries(fields.map(k=>[k,row[k]])),ROWID:ack.ROWID});
     return accepted;}};
    const left=createReportSuccessorStore({app,environment:'development',transport:checked});
    const right=createReportSuccessorStore({app,environment:'development',transport:checked});
    if(!write){
     const head=await left.get(key,options);admission();
     if(!head||head.storageRevision!=='unique_insert_successor_v1'||head.state?.diagnostic?.nonce!==b.nonce
      ||head.state.diagnostic.sourceRevision!==b.sourceRevision||head.version>2||sequential&&head.version!==1)held();
     return Object.freeze({status:'storage_evidence_unattested',mechanism,...(sequential?{concurrencyProven:false}:{}),
      operationDigest:key,evidenceDigest:sha({rows:[...rows.values()].sort((a,c)=>String(a.ROWID).localeCompare(String(c.ROWID)))}),
      creatorProvenance:'observed_consistent_v1',namedIdentityVerified:false,
      physicalRows:rows.size,headVersion:head.version,reads:counts.reads,inserts:0,qualificationAuthority:false,deliveryAuthority:false});
    }
    observe('root_prior_read');budget.consume('report_run_read');const prior=await checked.query(`SELECT * FROM ReportRuns WHERE IdempotencyKey = '${rootKey}' LIMIT 2`,options);
    if(prior.length)held(); // A durable consumed identity is never restarted, even after a cold reload.
    const identity={clientId:'qualification_'+b.nonce,deploymentId:'qualification_'+b.nonce,periodStart:'1970-01-01',periodEnd:'1970-01-01'};
    const state=label=>({kind:'report_attempt_v1',identity,phase:'working',owner:'synthetic_'+label,failures:0,nextAttemptAt:0,lastGenerationKey:null,
     diagnostic:{nonce:b.nonce,sourceRevision:b.sourceRevision,label}});
    const traces=new Map();
    function contender(label){const events=[];traces.set(label,events);return {...options,trace:e=>{if(provenanceFailed)return;admission();events.push(e);}};}
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
    if(sequential){
     observe('root_round');const first=await left.insert(key,state('root_left'),contender('root_left'));admission();
     const firstEvents=traces.get('root_left');
     if(!first||provenanceFailed||firstEvents.filter(e=>e.event==='dispatch').length!==1
      ||firstEvents.filter(e=>e.event==='outcome'&&e.accepted===true).length!==1)held();
     const second=await right.insert(key,state('root_right'),contender('root_right'));admission();
     const a=traces.get('root_left'),c=traces.get('root_right');
     const events=(list,type)=>list.filter(e=>e.event===type);
     if(second!==null||provenanceFailed||rows.size!==1||counts.reads!==3||counts.inserts!==2
      ||counts.admissionReads!==1||counts.admissionInserts!==1
      ||events(a,'dispatch').length!==1||events(c,'dispatch').length!==1
      ||events(a,'outcome').length!==1||events(c,'outcome').length!==1
      ||events(a,'outcome')[0].accepted!==true||events(c,'outcome')[0].duplicate!==true
      ||events(a,'response').length!==1||events(c,'response').length!==1
      ||!Number.isInteger(events(a,'response')[0].status)||events(a,'response')[0].status<200||events(a,'response')[0].status>=300
      ||events(c,'response')[0].status!==409
      ||events(a,'response')[0].at>=events(c,'dispatch')[0].at)held();
     return Object.freeze({status:'storage_sequential_duplicate_rejected',mechanism:'sequential_unique_diagnostic_v1',
      operationDigest:key,evidenceDigest:sha({rows:[...rows.values()],requests:[...traces.entries()],counts,admissionEvidenceDigest}),
      physicalRows:1,reads:3,inserts:2,admissionReads:1,admissionInserts:1,
      firstInsertHttpStatus:events(a,'response')[0].status,secondInsertHttpStatus:409,secondInsertProviderCode:'duplicate_value',
      concurrencyProven:false,qualificationAuthority:false,deliveryAuthority:false});
    }
    observe('root_round');const root=await Promise.allSettled([left.insert(key,state('root_left'),contender('root_left')),
     right.insert(key,state('root_right'),contender('root_right'))]);admission();
    const rootWinner=round(['root_left','root_right'],root),owner=rootWinner===0?left:right,accepted=root[rootWinner].value;
    const successorState=label=>({...state(label),phase:'waiting'});
    observe('successor_round');const successors=await Promise.allSettled([owner.compareAndSwap(accepted,successorState('successor_left'),contender('successor_left')),
     owner.compareAndSwap(accepted,successorState('successor_right'),contender('successor_right'))]);admission();
    const successorWinner=round(['successor_left','successor_right'],successors),head=await owner.get(key,options);admission();
    observe('final_verify');if(head?.version!==2||head.rowId!==successors[successorWinner].value.rowId||rows.size!==2||counts.reads!==7||counts.inserts!==4)held();
    const observedAt=admission(),evidence={bindingSha256:pin,operationDigest:key,capabilitySha256,
     rows:[...rows.values()].sort((a,c)=>String(a.ROWID).localeCompare(String(c.ROWID))),rootWinner,successorWinner,
     requests:[...traces.entries()],counts,admissionEvidenceDigest,observedAt};
    return Object.freeze({status:'storage_unique_successor_observed',mechanism:'unique_insert_successor_v1',operationDigest:key,
     evidenceDigest:sha(evidence),observedAt,physicalRows:2,reads:7,inserts:4,overlappingRounds:2,
     admissionReads:counts.admissionReads,admissionInserts:counts.admissionInserts,admissionEvidenceDigest,
     creatorProvenance:'observed_consistent_v1',namedIdentityVerified:false,
     durableAdmissionObserved:true,singleAdmittedInvocationRequired:true,qualificationAuthority:false,deliveryAuthority:false});
   }
   try{const result=await Promise.race([run(),deadline]);admission();return result;}
   catch{held();}finally{clearTimeout(timer);abort.abort();signal?.removeEventListener('abort',cancel);}
  }});
 };
}
module.exports={createProtectedStorageQualification,PROFILE};
