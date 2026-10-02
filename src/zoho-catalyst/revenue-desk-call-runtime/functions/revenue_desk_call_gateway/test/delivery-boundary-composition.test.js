'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {composeReviewedDeliveryBoundary}=require('../../../scripts/compose-reporting-artifact');
const file='src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/http-boundary.js';
const current=fs.readFileSync(path.resolve(__dirname,'../../revenue_desk_route_control/lib/http-boundary.js'));
const source=current.toString(),start=source.indexOf("      if (body.profile === 'report_storage_qualification_v1') {");
const end=source.indexOf('      const crm = ',start),addition=source.slice(start,end);
const contextStart=source.indexOf("      if (body.profile === 'report_runtime_context_v1') {");
const contextEnd=source.indexOf('      const app = runtime.initialize(request);',contextStart);
const context=source.slice(contextStart,contextEnd);
const base=Buffer.from((source.slice(0,start)+source.slice(end)).replace(context,''));
const anchor="      const crm = (factories.crm || createCrmControlClient)(config, {\n";
const selected=Buffer.from(base.toString().replace('async function readBody(request, maximum)',
 'async function readBody(request, maximum, timeoutMs = 3000)'));
const held=fn=>assert.throws(fn,error=>error.phase==='source_overlap');
test('reviewed additive delivery branch preserves every selected authentication byte',()=>{
 const result=composeReviewedDeliveryBoundary(file,base,current,selected);
 assert.deepEqual(Buffer.from(result.bytes.toString().replace(addition,'').replace(context,'')),selected);
 assert.equal(result.bytes.toString().split(addition).length,2);
 assert.ok(result.bytes.toString().indexOf("body.profile === 'report_delivery_v1'")>
 result.bytes.toString().indexOf('Control runtime identity is invalid.'));
 assert.ok(result.bytes.toString().indexOf("body.profile === 'report_delivery_v1'")<result.bytes.toString().indexOf(anchor));
 assert.equal(result.composition,'reviewed-report-delivery-sender-storage-boundary-addition-v1');
});
test('altered delivery branch is rejected',()=>held(()=>composeReviewedDeliveryBoundary(file,base,
 Buffer.from(source.replace('identity: config.operatorIdHash','identity: body.actor')),selected)));
test('any reporting change outside the reviewed addition is rejected',()=>held(()=>composeReviewedDeliveryBoundary(file,
 base,Buffer.concat([current,Buffer.from('\n// unrelated overlap\n')]),selected)));
test('duplicate selected-auth insertion anchor is rejected',()=>held(()=>composeReviewedDeliveryBoundary(file,base,current,
 Buffer.concat([selected,Buffer.from(anchor)]))));
test('missing selected-auth insertion anchor is rejected',()=>held(()=>composeReviewedDeliveryBoundary(file,base,current,
 Buffer.from(selected.toString().replace(anchor,'')))));
test('existing selected-auth delivery branch is rejected',()=>held(()=>composeReviewedDeliveryBoundary(file,base,current,current)));
test('other paths cannot use the reviewed exception',()=>held(()=>composeReviewedDeliveryBoundary('other.js',base,current,selected)));


test('historical delivery-only composition remains exact and exportable',()=>{
 const delivery=addition.slice(addition.indexOf("      if (body.profile === 'report_delivery_v1') {"));
 const historical=Buffer.from(base.toString().replace(anchor,delivery+anchor));
 const result=composeReviewedDeliveryBoundary(file,base,historical,selected);
 assert.equal(result.composition,'reviewed-report-delivery-boundary-addition-v1');
 assert.deepEqual(Buffer.from(result.bytes.toString().replace(delivery,'')),selected);
});
test('altered sender diagnostic cannot weaken selected authentication',()=>held(()=>composeReviewedDeliveryBoundary(file,base,
 Buffer.from(source.replace("kind: 'internal_controller'","kind: 'terminal_worker'")),selected)));

test('already integrated selected auth permits only the same reviewed additive boundary',()=>{
 const integrated=Buffer.from(selected.toString().replace(anchor,addition+anchor));
 const result=composeReviewedDeliveryBoundary(file,base,integrated,selected);
 assert.deepEqual(result.bytes,integrated);
 assert.deepEqual(Buffer.from(result.bytes.toString().replace(addition,'').replace(context,'')),selected);
});
test('integrated auth with unrelated source overlap remains rejected',()=>{
 const integrated=Buffer.from(selected.toString().replace(anchor,addition+anchor)+'\n// unrelated overlap\n');
 held(()=>composeReviewedDeliveryBoundary(file,base,integrated,selected));
});


test('context branch is separately pinned, before initialization and removable without changing auth',()=>{
 const result=composeReviewedDeliveryBoundary(file,base,current,selected);
 assert.equal(result.context_addition_sha256,'47e2bebff359c47d9779b45987a3f251df284f02005fb279154d790f04fb6a1b');
 assert.ok(result.bytes.toString().indexOf('report_runtime_context_v1')<result.bytes.toString().indexOf('const app = runtime.initialize(request)'));
 held(()=>composeReviewedDeliveryBoundary(file,base,Buffer.from(source.replace('factories.runtimeContext(request','factories.runtimeContext(body')),selected));
 held(()=>composeReviewedDeliveryBoundary(file,base,current,Buffer.from(selected.toString().replace('      const app = runtime.initialize(request);',''))));
});
