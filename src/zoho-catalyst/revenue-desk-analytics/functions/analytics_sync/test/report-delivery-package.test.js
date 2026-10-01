'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'../../../..');
const runtime=path.join(root,'revenue-desk-call-runtime');

test('isolated controller delivery package imports with one canonical gateway and stamped Analytics closure',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'sylvara-delivery-controller-'));
 try{
  const controller=path.join(temporary,'controller'),analytics=path.join(controller,'reporting/revenue-desk-analytics');
  const put=(relative,source,replace)=>{const target=path.join(controller,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
    let bytes=fs.readFileSync(source);if(replace)bytes=Buffer.from(bytes.toString().replace(...replace));fs.writeFileSync(target,bytes);};
  const builder=fs.readFileSync(path.join(runtime,'scripts/build-release.js'),'utf8');
  const names=/const DELIVERY_LIBS = \[([\s\S]*?)\];/.exec(builder)[1].match(/'([a-z-]+)'/g).map(x=>x.slice(1,-1));
  assert.ok(names.includes('config')&&names.includes('source-revision'));
  for(const name of names)put(`reporting/revenue-desk-analytics/functions/analytics_sync/lib/${name}.js`,path.join(root,`revenue-desk-analytics/functions/analytics_sync/lib/${name}.js`),
    name==='source-revision'?['__SYLVARA_UNSTAMPED_SOURCE_REVISION__','a'.repeat(40)]:null);
  const tools=/const REPORT_TOOLS = Object.freeze\(\[([\s\S]*?)\]\);/.exec(builder)[1].match(/'([a-z-]+)'/g).map(x=>x.slice(1,-1));
  for(const name of tools)put(`reporting/revenue-desk-analytics/tools/${name}.js`,path.join(root,`revenue-desk-analytics/tools/${name}.js`));
  for(const name of ['free-test-report-contract','analytics-model-contract'])put(`reporting/revenue-desk-analytics/config/${name}.json`,path.join(root,`revenue-desk-analytics/config/${name}.json`));
  for(const name of ['crm-client','configuration-source-reader','configuration-conversion-reader'])put(`reporting/revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/${name}.js`,path.join(runtime,`functions/revenue_desk_route_control/lib/${name}.js`));
  put('lib/report-delivery-composition.js',path.join(runtime,'functions/revenue_desk_route_control/lib/report-delivery-composition.js'));
  const gateway=path.join(controller,'node_modules/revenue_desk_call_gateway');
  fs.mkdirSync(gateway,{recursive:true});
  for(const name of ['lib','contracts'])fs.cpSync(path.join(runtime,'functions/revenue_desk_call_gateway',name),path.join(gateway,name),{recursive:true});
  for(const name of ['analytics-outbox','crm-report-baseline','reporting','runtime-service']){
  const bridge=path.join(controller,`reporting/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/${name}.js`);
  fs.mkdirSync(path.dirname(bridge),{recursive:true});fs.writeFileSync(bridge,`module.exports=require('revenue_desk_call_gateway/lib/${name}');\n`);
  }
  put('reporting/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json',path.join(runtime,'functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json'));
  assert.equal(typeof require(path.join(controller,'lib/report-delivery-composition.js')).createReportDeliveryFactory,'function');
  const {createManagedReportDeliveryReaders}=require(path.join(analytics,'tools/create-report-delivery-readers.js'));
  assert.equal(typeof createManagedReportDeliveryReaders,'function');
  for(const name of ['crm-client','configuration-source-reader','configuration-conversion-reader'])assert.doesNotThrow(()=>require(path.join(controller,`reporting/revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/${name}.js`)));
  assert.equal(require(path.join(analytics,'functions/analytics_sync/lib/source-revision.js')).ARTIFACT_SOURCE_REVISION,'a'.repeat(40));
  assert.match(builder,/stampSource\(stagingRoot, CONTROL_ANALYTICS_STAMP_PATH/);
  const composition=fs.readFileSync(path.join(runtime,'scripts/compose-reporting-artifact.js'),'utf8');
  assert.match(composition,/stampSource\(runtimeOutput, CONTROL_ANALYTICS_STAMP_PATH/);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
