'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {installOfflineGuard}=require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard=installOfflineGuard();test.after(()=>{guard.restore();assert.deepEqual(guard.blocked,[]);});
const {createReportRecipientWriter}=require('../lib/report-recipient-writer');
const {loadReportBootstrapBinding,workerReportActor,protectedDestinations}=require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/report-bootstrap-binding');
const {createProtectedWorkerReportOptions}=require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_worker/lib/report-bootstrap');
const {createReportSetupReader}=require('../../../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/report-setup-reader');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const at=1800000000000,actor={kind:'internal_controller',identity:'operator_'+sha('controller')};
function fixture(){
 const rows=new Map();let inserts=0,reads=0;
 const b={schemaVersion:1,environment:'development',sourceRevision:'a'.repeat(40),projectId:'123456789',controllerFunctionId:'123456781',workerFunctionId:'123456782',
  verifiedAt:at-1000,expiresAt:at+3600000,attestation:{enabled:true,authorityDigest:sha('authority'),crm:{}},delivery:{enabled:false},reporting:{enabled:false}};
 const proof={authorizedActor:actor.identity,identity:{clientId:'client',deploymentId:'deployment',dealId:'190000001',accountId:'190000002',contactId:'190000003',configurationVersion:'form2cfgv1:1:'+ 'b'.repeat(40),configurationVersionId:'configuration',originalLeadId:'190000004',intakeSubmissionId:'journey'},
  recipientEmail:'owner@example.invalid',crmEmailOptOut:false,nativeRelationshipEvidenceSha256:sha('native'),configurationSourceDigest:sha('config'),
  suppression:{status:'qualified_clear',evidenceDigest:sha('synthetic suppression'),expiresAt:at+3600000}};
 const options={store:{async get(k){return structuredClone(rows.get(k)||null);},async insert(k,state){inserts++;if(!rows.has(k))rows.set(k,{key:k,state:structuredClone(state)});return structuredClone(rows.get(k));}},
  readSetup:async()=>{reads++;return structuredClone(proof);},authorityDigest:b.attestation.authorityDigest,systemActor:workerReportActor(b),now:()=>at,expiresAt:b.expiresAt};
 const command={profile:'report_delivery_v1',action:'attest_recipient',dealId:'190000001',recipientEmail:proof.recipientEmail,confirmed:true};
 return {b,proof,options,command,rows,write:createReportRecipientWriter(options),counts:()=>({inserts,reads})};
}
test('unique immutable selection accepts concurrent identical requests and holds conflicting selection without CAS',async()=>{
 const f=fixture();const results=await Promise.all([f.write(f.command,{actor}),f.write(f.command,{actor})]);
 assert.equal(results.every(x=>x.status==='recipient_attested'),true);assert.equal(f.rows.size,1);
 assert.equal((await f.write(f.command,{actor})).replayed,true);
 f.proof.recipientEmail='other@example.invalid';await assert.rejects(f.write({...f.command,recipientEmail:f.proof.recipientEmail},{actor}));assert.equal(f.rows.size,1);
});
test('missing confirmation, body actor, identity spoof, opt-out and unresolved suppression hold before insert',async()=>{
 for(const change of [f=>f.command.confirmed=false,f=>f.command.actor=actor,f=>f.proof.authorizedActor='foreign',
  f=>f.proof.crmEmailOptOut=true,f=>f.proof.crmEmailOptOut=null,f=>f.proof.crmEmailOptOut='false',
  f=>f.proof.suppression.status='unqualified',f=>f.proof.suppression.expiresAt=at]){
  const f=fixture();change(f);await assert.rejects(f.write(f.command,{actor}));assert.equal(f.counts().inserts,0);
 }
});
test('setup drift, cancellation and unknown insertion result never produce a second dispatch',async()=>{
 const f=fixture();let n=0;f.options.readSetup=async()=>({...f.proof,configurationSourceDigest:sha(String(n++))});
 await assert.rejects(createReportRecipientWriter(f.options)(f.command,{actor}));assert.equal(f.counts().inserts,0);
 const x=fixture();let dispatches=0;x.options.store.insert=async()=>{dispatches++;return null;};
 await assert.rejects(createReportRecipientWriter(x.options)(x.command,{actor}));assert.equal(dispatches,1);
 const abort=new AbortController();abort.abort();await assert.rejects(x.write(x.command,{actor,signal:abort.signal}));
});
test('server binding verifies bytes/revision/expiry and defaults off; worker actor stable per fixed function',async()=>{
 const f=fixture(),raw=JSON.stringify(f.b),env={REPORT_RUNTIME_BINDING_JSON:raw,REPORT_RUNTIME_BINDING_SHA256:sha(raw),DEPLOYMENT_ENVIRONMENT:'development',SOURCE_REVISION:f.b.sourceRevision};
 assert.equal(loadReportBootstrapBinding({}, {now:()=>at}),null);assert.equal(createProtectedWorkerReportOptions({}).terminalDraftReconcilerFactory,null);
 const accepted=loadReportBootstrapBinding(env,{now:()=>at});assert.ok(Object.isFrozen(accepted.attestation));
 assert.deepEqual(workerReportActor(accepted),workerReportActor(accepted));assert.notDeepEqual(workerReportActor(accepted),workerReportActor({...accepted,workerFunctionId:'123456783'}));
 for(const modified of [{...env,REPORT_RUNTIME_BINDING_SHA256:sha('wrong')},{...env,SOURCE_REVISION:'b'.repeat(40)},
  {...env,REPORT_RUNTIME_BINDING_JSON:raw+' '},{...env,REPORT_RUNTIME_BINDING_SHA256:undefined}])assert.throws(()=>loadReportBootstrapBinding(modified,{now:()=>at}));
 f.b.reporting.enabled=true;const changed=JSON.stringify(f.b);assert.throws(()=>loadReportBootstrapBinding({...env,REPORT_RUNTIME_BINDING_JSON:changed,REPORT_RUNTIME_BINDING_SHA256:sha(changed)},{now:()=>at}));
 const destination=protectedDestinations([{scope:{clientKey:'client',deploymentKey:'test'},binding:{parentId:'synthetic'}}]);
 assert.equal((await destination({deploymentKey:'test',clientKey:'client'})).parentId,'synthetic');await assert.rejects(destination({clientKey:'foreign',deploymentKey:'test'}));
});
test('setup reader validates inactive approval and native lineage without terminal/report/activation evidence',async()=>{
 const {createReconciledReportFixture}=require('./helpers/reconciled-report-fixture');const f=await createReconciledReportFixture();
 const row=await f.runtime.store.unique(f.runtime.config.tables.DEPLOYMENT_TABLE,'DEPLOYMENT_ID',f.identity.deploymentId);
 const cfg=await f.runtime.store.unique(f.runtime.config.tables.CONFIGURATION_VERSION_TABLE,'CONFIGURATION_VERSION_ID',row.ACTIVE_CONFIGURATION_VERSION_ID);
 const label='form2cfgv1:1:'+'b'.repeat(40);cfg.CONFIGURATION_VERSION=label;row.TEST_STATUS='Not Started';row.REPORT_RECONCILIATION_STATUS='NotRequired';
 const config={...f.runtime.config,deploymentMode:'active',operatorIdHash:actor.identity};
 const records={deal:{id:'190000001',Intake_Submission_ID:'journey',Configuration_Version:label,Deployment_Record_ID:row.DEPLOYMENT_ID,Account_Name:{id:'190000002'},Contact_Name:{id:'190000003'}},
  contact:{id:'190000003',Account_Name:{id:'190000002'},Email:'owner@example.invalid',Email_Opt_Out:false}};
 const store={unique:async(table)=>table===config.tables.DEPLOYMENT_TABLE?row:cfg};let approvals=0;
 const reader=createReportSetupReader({config,store,crm:{getReportRecords:async()=>structuredClone(records)},now:()=>at,
  staging:{assertApprovalSource:async()=>({configurationStaged:true,priorCoreApproval:{configurationVersionId:label}})},
  core:{async readStagingSource(command,options){approvals++;assert.equal(command.configurationVersionId,label);assert.equal(options.expectedDeploymentId,row.DEPLOYMENT_ID);return {priorApproval:{configurationVersionId:label}};}},
  sourceReader:{findAssistedLineage:async()=>({originalLeadId:'190000004'})},conversionReader:{readConversion:async()=>({originalLeadId:'190000004',journeyId:'journey',dealId:'190000001',accountId:'190000002',contactId:'190000003',convertedAt:'2026-01-01T00:00:00.000Z'})}});
 const proof=await reader({dealId:'190000001',actor});assert.equal(approvals,1);assert.equal(proof.suppression.status,'unqualified');assert.equal(proof.identity.configurationVersion,label);
 records.contact.Account_Name.id='foreign';await assert.rejects(reader({dealId:'190000001',actor}));
});

test('stalled setup/readback and elapsed attempt hold without another insertion',async()=>{
 const f=fixture();f.options.timeoutMs=10;f.options.readSetup=async()=>new Promise(()=>{});
 await assert.rejects(createReportRecipientWriter(f.options)(f.command,{actor}));assert.equal(f.counts().inserts,0);
 const x=fixture();x.options.timeoutMs=10;let calls=0;x.options.store.insert=async()=>{calls++;return new Promise(()=>{});};
 await assert.rejects(createReportRecipientWriter(x.options)(x.command,{actor}));assert.equal(calls,1);
 const y=fixture();let clock=at;y.options.timeoutMs=10;y.options.now=()=>clock;
 y.options.readSetup=async()=>{clock+=11;return structuredClone(y.proof);};
 await assert.rejects(createReportRecipientWriter(y.options)(y.command,{actor}));assert.equal(y.counts().inserts,0);
});
test('shortened binding or suppression validity holds immutable replay without overwrite',async()=>{
 for(const key of ['binding','suppression']){
  const f=fixture();await f.write(f.command,{actor});
  if(key==='binding')f.options.expiresAt=at+1000;else f.proof.suppression.expiresAt=at+1000;
  await assert.rejects(createReportRecipientWriter(f.options)(f.command,{actor}));assert.equal(f.counts().inserts,1);
 }
});