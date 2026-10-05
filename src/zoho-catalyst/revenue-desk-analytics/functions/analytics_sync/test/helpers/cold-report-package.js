'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'../../../../..');
const runtime=path.join(root,'revenue-desk-call-runtime');
const assert=require('node:assert/strict');
function stageReportPackage(sourceRevision){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'sylvara-cold-report-'));
  const controller=path.join(temporary,'controller'),analytics=path.join(controller,'reporting/revenue-desk-analytics');
  const put=(relative,source,replace)=>{const target=path.join(controller,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
    let bytes=fs.readFileSync(source);if(replace)bytes=Buffer.from(bytes.toString().replace(...replace));fs.writeFileSync(target,bytes);};
  const builder=fs.readFileSync(path.join(runtime,'scripts/build-release.js'),'utf8');
  const names=/const DELIVERY_LIBS = \[([\s\S]*?)\];/.exec(builder)[1].match(/'([a-z-]+)'/g).map(x=>x.slice(1,-1));
  assert.ok(names.includes('report-storage-capability')&&names.includes('report-storage-window'));
  assert.ok(names.includes('config')&&names.includes('source-revision')&&names.includes('report-recipient-preflight'));
  for(const name of names)put(`reporting/revenue-desk-analytics/functions/analytics_sync/lib/${name}.js`,path.join(root,`revenue-desk-analytics/functions/analytics_sync/lib/${name}.js`),
    name==='source-revision'?['__SYLVARA_UNSTAMPED_SOURCE_REVISION__',sourceRevision]:null);
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

 const modules=path.resolve(__dirname,'../../node_modules');
 for(const name of fs.readdirSync(modules))if(name!=='revenue_desk_call_gateway')fs.cpSync(path.join(modules,name),path.join(controller,'node_modules',name),{recursive:true});
 return {controller,analytics,gateway,restore(){fs.rmSync(temporary,{recursive:true,force:true});}};
}
module.exports={stageReportPackage};
