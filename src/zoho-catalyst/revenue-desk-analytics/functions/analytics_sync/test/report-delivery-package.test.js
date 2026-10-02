'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'../../../..');
const runtime=path.join(root,'revenue-desk-call-runtime');

test('isolated controller delivery package imports with one canonical gateway and stamped Analytics closure',async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'sylvara-delivery-controller-'));
 try{
  const controller=path.join(temporary,'controller'),analytics=path.join(controller,'reporting/revenue-desk-analytics');
  const put=(relative,source,replace)=>{const target=path.join(controller,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
    let bytes=fs.readFileSync(source);if(replace)bytes=Buffer.from(bytes.toString().replace(...replace));fs.writeFileSync(target,bytes);};
  const builder=fs.readFileSync(path.join(runtime,'scripts/build-release.js'),'utf8');
  const names=/const DELIVERY_LIBS = \[([\s\S]*?)\];/.exec(builder)[1].match(/'([a-z-]+)'/g).map(x=>x.slice(1,-1));
  assert.ok(names.includes('config')&&names.includes('source-revision')&&names.includes('report-recipient-preflight'));
  for(const name of names)put(`reporting/revenue-desk-analytics/functions/analytics_sync/lib/${name}.js`,path.join(root,`revenue-desk-analytics/functions/analytics_sync/lib/${name}.js`),
    name==='source-revision'?['__SYLVARA_UNSTAMPED_SOURCE_REVISION__','a'.repeat(40)]:null);
  const tools=/const REPORT_TOOLS = Object.freeze\(\[([\s\S]*?)\]\);/.exec(builder)[1].match(/'([a-z-]+)'/g).map(x=>x.slice(1,-1));
  for(const name of tools)put(`reporting/revenue-desk-analytics/tools/${name}.js`,path.join(root,`revenue-desk-analytics/tools/${name}.js`));
  for(const name of ['free-test-report-contract','analytics-model-contract'])put(`reporting/revenue-desk-analytics/config/${name}.json`,path.join(root,`revenue-desk-analytics/config/${name}.json`));
  for(const name of ['crm-client','configuration-source-reader','configuration-conversion-reader'])put(`reporting/revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/${name}.js`,path.join(runtime,`functions/revenue_desk_route_control/lib/${name}.js`));
  for(const file of fs.readdirSync(path.join(runtime,'functions/revenue_desk_route_control/lib')))
   if(file.endsWith('.js'))put(`lib/${file}`,path.join(runtime,'functions/revenue_desk_route_control/lib',file));
  put('index.js',path.join(runtime,'functions/revenue_desk_route_control/index.js'));
  put('worker-lib/report-bootstrap.js',path.join(runtime,'functions/revenue_desk_call_worker/lib/report-bootstrap.js'));
  // Preserve the worker's real reporting relative path in this isolated tree.
  put('worker-lib/terminal-draft-composition.js',path.join(runtime,'functions/revenue_desk_call_worker/lib/terminal-draft-composition.js'));
  const gateway=path.join(controller,'node_modules/revenue_desk_call_gateway');
  fs.mkdirSync(gateway,{recursive:true});
  for(const name of ['lib','contracts'])fs.cpSync(path.join(runtime,'functions/revenue_desk_call_gateway',name),path.join(gateway,name),{recursive:true});
  for(const name of ['analytics-outbox','crm-report-baseline','reporting','runtime-service']){
  const bridge=path.join(controller,`reporting/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/${name}.js`);
  fs.mkdirSync(path.dirname(bridge),{recursive:true});fs.writeFileSync(bridge,`module.exports=require('revenue_desk_call_gateway/lib/${name}');\n`);
  }
  put('reporting/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json',path.join(runtime,'functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json'));
  assert.equal(typeof require(path.join(controller,'index.js')),'function');
  assert.equal(typeof require(path.join(controller,'lib/report-delivery-composition.js')).createReportDeliveryFactory,'function');
  const {createProtectedWorkerReportOptions}=require(path.join(controller,'worker-lib/report-bootstrap.js'));
  const {TARGET_TABLE_NAMES}=require(path.join(analytics,'functions/analytics_sync/lib/config.js'));
  let at=1800000000000,effects=0;const sourceRevision='a'.repeat(40),projectId='123456789';
  const blocked=()=>{effects++;assert.fail('Bootstrap dispatched external effect');};
  const config={environment:'development',catalystEnvironment:'Development',sourceRevision,expectedProjectId:projectId,
   tables:{outbox:'AnalyticsSyncOutbox',checkpoint:'AnalyticsSyncCheckpoints'},analyticsTimeoutMs:20000,responseMaxBytes:1048576,platformTimeoutMs:3000,staleAfterMs:7200000,
   provider:{readConnection:'synthetic_read',migrationEvidenceDigest:'b'.repeat(64),apiBaseUrl:'https://analyticsapi.zoho.com',organizationId:'123456789',workspaceId:'987654321',
    targets:Object.fromEntries(Object.entries(TARGET_TABLE_NAMES).map(([kind,table],i)=>[kind,{table,viewId:String(i+1000)}]))}};
  const acceptance={environment:'development',sourceRevision,verifiedAt:at-1000,expiresAt:at+86400000,
   ...Object.fromEntries(['schemaDigest','analyticsContractDigest','workdriveContractDigest','releaseCompositionDigest','pdfRendererDigest'].map(k=>[k,'e'.repeat(64)]))};
  const b={schemaVersion:1,environment:'development',sourceRevision,projectId,controllerFunctionId:'123456781',workerFunctionId:'123456782',verifiedAt:at-1000,expiresAt:at+2000,
   attestation:{enabled:false},delivery:{enabled:false},reporting:{enabled:true,claimQualification:{mechanism:'unique_insert_successor_v1',status:'qualified',evidenceDigest:'e'.repeat(64),expiresAt:at+1000},destinations:[{scope:{},binding:{}}],
    options:{analyticsConfig:config,acceptance,workdriveBinding:{connectionReference:'synthetic_workdrive',apiOrigin:'https://www.zohoapis.com',downloadOrigin:'https://download.zoho.com',timeoutMs:20000},
     pdfBinding:{apiOrigin:'https://api.catalyst.zoho.com',projectId,organizationId:'123456789',environment:'Development',connectionReference:'synthetic_pdf',timeoutMs:1000,version:'smartbrowz-native-inter41-v1',qualificationDigest:'e'.repeat(64)}}}};
  const raw=JSON.stringify(b),pin=require('node:crypto').createHash('sha256').update(raw).digest('hex');
  const options=createProtectedWorkerReportOptions({REPORT_RUNTIME_BINDING_JSON:raw,REPORT_RUNTIME_BINDING_SHA256:pin,DEPLOYMENT_ENVIRONMENT:'development',SOURCE_REVISION:sourceRevision},{now:()=>at});
  const app={config:{projectId,environment:'Development'},authenticateRequest:blocked,datastore:blocked,zcql:blocked,connections:blocked};
  const runtimeConfig={environment:'development',sourceRevision,projectId,tables:{DEPLOYMENT_TABLE:'RevenueDeskDeployments'}};
  const store={unique:blocked,query:blocked,queryBounded:blocked};
  const hook=options.terminalDraftReconcilerFactory(app,runtimeConfig,store);assert.equal(typeof hook,'function');
  at+=1000;
  assert.throws(()=>options.terminalDraftReconcilerFactory(app,runtimeConfig,store),{code:'REPORT_BOOTSTRAP_HELD'});
  await assert.rejects(hook({clientId:'client',deploymentId:'deployment'}),{code:'REPORT_BOOTSTRAP_HELD'});assert.equal(effects,0);
  const {createManagedReportDeliveryReaders}=require(path.join(analytics,'tools/create-report-delivery-readers.js'));
  assert.equal(typeof createManagedReportDeliveryReaders,'function');
  for(const name of ['crm-client','configuration-source-reader','configuration-conversion-reader'])assert.doesNotThrow(()=>require(path.join(controller,`reporting/revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/${name}.js`)));
  assert.equal(require(path.join(analytics,'functions/analytics_sync/lib/source-revision.js')).ARTIFACT_SOURCE_REVISION,'a'.repeat(40));
  assert.match(builder,/stampSource\(stagingRoot, CONTROL_ANALYTICS_STAMP_PATH/);
  const composition=fs.readFileSync(path.join(runtime,'scripts/compose-reporting-artifact.js'),'utf8');
  assert.match(composition,/stampSource\(runtimeOutput, CONTROL_ANALYTICS_STAMP_PATH/);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
