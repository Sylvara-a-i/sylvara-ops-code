'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'../../../../revenue-desk-call-runtime/functions');
const binding=require(path.join(base,'revenue_desk_call_gateway/lib/report-bootstrap-binding'));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),at=1800000000000;
function fixture(){const q={mechanism:'unique_insert_successor_v1',status:'qualified',evidenceDigest:sha('storage'),expiresAt:at+10000};
 const destinations=[{scope:{clientId:'synthetic',deploymentId:'test'},binding:{contractQualificationDigest:sha('destination')}}];
 return {schemaVersion:1,environment:'development',sourceRevision:'a'.repeat(40),projectId:'123456789',controllerFunctionId:'123456781',workerFunctionId:'123456782',verifiedAt:at-1000,expiresAt:at+10000,
  attestation:{enabled:false},delivery:{enabled:true,claimQualification:q,binding:{},destinations},reporting:{enabled:true,claimQualification:q,options:{},destinations:structuredClone(destinations)}};}
function execution(flags={}){return {deliveryEnabled:false,autoDeliveryEnabled:false,projectionEnabled:false,...flags,
 qualification:Object.values(flags).some(x=>x===true)?{status:'qualified',evidenceDigest:sha('independently accepted execution bundle'),verifiedAt:at-1000,expiresAt:at+1000}:null};}
function environment(b){const raw=JSON.stringify(b);return {REPORT_RUNTIME_BINDING_JSON:raw,REPORT_RUNTIME_BINDING_SHA256:sha(raw),SOURCE_REVISION:b.sourceRevision,DEPLOYMENT_ENVIRONMENT:b.environment};}
function load(b,now=()=>at){return binding.loadReportBootstrapBinding(environment(b),{now});}
function factories(role,env,now){let captured,effects=0;
 const source=fs.readFileSync(path.join(base,role==='controller'?'revenue_desk_route_control':'revenue_desk_call_worker','lib/report-bootstrap.js'),'utf8');
 const deliveryFactory=options=>{captured=options;return ()=>({async handle(){options.now();effects++;return {status:'synthetic'};}});};
 const reportingFactory=options=>()=>{const reconcile=async()=>{options.now();if(options.deliveryFactory){options.deliveryFactory() ;effects++;}return {status:'synthetic'};};Object.defineProperty(reconcile,'attemptTimeoutMs',{value:1000});return reconcile;};
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require(name){
  if(name==='revenue_desk_call_gateway/lib/report-bootstrap-binding')return binding;
  if(name==='./report-delivery-composition')return {createReportDeliveryFactory:deliveryFactory};
  if(name==='./terminal-draft-composition')return {createReportDeliveryFactory:deliveryFactory,createReportingFactory:reportingFactory};
  return {};
 },process:{env},Date,Object,globalThis:{fetch:()=>assert.fail('No provider')},String});
 const app={config:{projectId:'123456789',environment:'Development'}},config={sourceRevision:'a'.repeat(40)};
 const service=role==='controller'?module.exports.createProtectedReportController({environment:env,now})(app,config,{}):module.exports.createProtectedWorkerReportOptions(env,{now}).terminalDraftReconcilerFactory(app,config,{});
 return {captured,service,effects:()=>effects};
}
test('actual Controller and Worker select only protected flags, with legacy defaults false',()=>{
 for(const role of ['controller','worker'])for(const flags of [undefined,{}, {projectionEnabled:true},{deliveryEnabled:true},{deliveryEnabled:true,autoDeliveryEnabled:true,projectionEnabled:true}]){
  const b=fixture();if(flags!==undefined)b.delivery.execution=execution(flags);const f=factories(role,environment(b),()=>at);
  assert.equal(f.captured.deliveryEnabled,flags?.deliveryEnabled===true);assert.equal(f.captured.projectionEnabled,flags?.projectionEnabled===true);
  assert.equal(f.captured.autoDeliveryEnabled,role==='worker'&&flags?.autoDeliveryEnabled===true);assert.equal(f.effects(),0);
 }
});
test('closed qualification, dependencies, destination isolation and finite expiry fail before factories',()=>{
 const changes=[b=>b.delivery.execution.deliveryEnabled='true',b=>b.delivery.execution.extra=true,b=>b.delivery.execution.qualification=null,
  b=>b.delivery.execution.qualification.evidenceDigest='0'.repeat(64),b=>b.delivery.execution.qualification.status='synthetic_success',
  b=>b.delivery.execution.qualification.extra=true,b=>b.delivery.execution.qualification.verifiedAt=at+1,b=>b.delivery.execution.qualification.expiresAt=at,
  b=>b.delivery.execution.qualification.expiresAt=b.expiresAt+1,b=>b.delivery.enabled=false,b=>b.reporting.enabled=false,
  b=>b.delivery.execution.deliveryEnabled=false,b=>b.reporting.destinations[0].binding.contractQualificationDigest=sha('foreign'),
  b=>b.delivery.destinations.push(structuredClone(b.delivery.destinations[0]))];
 for(const change of changes){const b=fixture();b.delivery.execution=execution({deliveryEnabled:true,autoDeliveryEnabled:true});change(b);assert.throws(()=>load(b),{code:'REPORT_BOOTSTRAP_HELD'});}
 const b=fixture();b.delivery.execution=execution();b.delivery.execution.qualification={status:'qualified'};assert.throws(()=>load(b),{code:'REPORT_BOOTSTRAP_HELD'});
});
test('captured warm factories expire before effects; environment removal is not revocation',async()=>{
 for(const role of ['controller','worker']){let clock=at;const b=fixture();b.delivery.execution=execution({deliveryEnabled:true,autoDeliveryEnabled:true});
  const env=environment(b),f=factories(role,env,()=>clock);delete env.REPORT_RUNTIME_BINDING_JSON;delete env.REPORT_RUNTIME_BINDING_SHA256;
  assert.equal(f.captured.now(),at);clock=at+1000;
  await assert.rejects(async()=>role==='controller'?f.service.handle({}):f.service({clientId:'synthetic',deploymentId:'test'}),{code:'REPORT_BOOTSTRAP_HELD'});assert.equal(f.effects(),0);
 }
});
test('recipient-only binding and attempted caller flags do not enable delivery',()=>{
 const b=fixture();b.delivery={enabled:false};b.reporting={enabled:false};b.attestation={enabled:true,authorityDigest:sha('authority'),crm:{},claimQualification:fixture().delivery.claimQualification};
 const loaded=load(b);assert.deepEqual(binding.protectedDeliveryExecution(loaded,{role:'controller',now:()=>at}).deliveryEnabled,false);
 const {createProtectedWorkerReportOptions}=require(path.join(base,'revenue_desk_call_worker/lib/report-bootstrap'));
 const result=createProtectedWorkerReportOptions(environment(b),{now:()=>at,deliveryEnabled:true,autoDeliveryEnabled:true,projectionEnabled:true});assert.equal(result.terminalDraftReconcilerFactory,null);
});
