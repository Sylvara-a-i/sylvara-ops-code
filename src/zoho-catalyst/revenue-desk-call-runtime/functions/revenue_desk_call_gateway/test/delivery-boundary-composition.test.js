'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {composeReviewedDeliveryBoundary}=require('../../../scripts/compose-reporting-artifact');
const file='src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/http-boundary.js';
const current=fs.readFileSync(path.resolve(__dirname,'../../revenue_desk_route_control/lib/http-boundary.js'));
const source=current.toString(),start=source.indexOf("      if (body.profile === 'report_delivery_v1') {");
const end=source.indexOf('      const crm = ',start),addition=source.slice(start,end);
const base=Buffer.from(source.slice(0,start)+source.slice(end));
const anchor="      const crm = (factories.crm || createCrmControlClient)(config, {\n";
const selected=Buffer.from(base.toString().replace('async function readBody(request, maximum)',
 'async function readBody(request, maximum, timeoutMs = 3000)'));
const held=fn=>assert.throws(fn,error=>error.phase==='source_overlap');
test('reviewed additive delivery branch preserves every selected authentication byte',()=>{
 const result=composeReviewedDeliveryBoundary(file,base,current,selected);
 assert.deepEqual(Buffer.from(result.bytes.toString().replace(addition,'')),selected);
 assert.equal(result.bytes.toString().split(addition).length,2);
 assert.ok(result.bytes.toString().indexOf("body.profile === 'report_delivery_v1'")>
 result.bytes.toString().indexOf('Control runtime identity is invalid.'));
 assert.ok(result.bytes.toString().indexOf("body.profile === 'report_delivery_v1'")<result.bytes.toString().indexOf(anchor));
 assert.equal(result.composition,'reviewed-report-delivery-boundary-addition-v1');
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
