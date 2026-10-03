'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {encodeStorageBinding,decodeStorageBinding,JSON_KEY,PART_PREFIX}=require('../lib/report-storage-binding');
const held={code:'REPORT_STORAGE_QUALIFICATION_HELD'};
for(const partSize of [100,200,400])test('exact bounded multipart round trip '+partSize,()=>{
 for(const length of [1,partSize,partSize+1,1856,4096]){const raw='x'.repeat(length),encoded=encodeStorageBinding(raw,{partSize});
  assert.equal(decodeStorageBinding({...encoded.parts,[JSON_KEY]:encoded.marker}),raw);assert.ok(Object.values(encoded.parts).every(p=>p.length<=partSize));}
});
test('partial saves and conflicting legacy or extra parts fail closed',()=>{
 const raw='x'.repeat(1856),e=encodeStorageBinding(raw),env={...e.parts,[JSON_KEY]:e.marker};
 assert.throws(()=>decodeStorageBinding(e.parts),held);
 for(const key of Object.keys(e.parts)){const copy={...env};delete copy[key];assert.throws(()=>decodeStorageBinding(copy),held);}
 for(const key of [PART_PREFIX+'10',PART_PREFIX+'01',PART_PREFIX+'-1',PART_PREFIX+'junk'])assert.throws(()=>decodeStorageBinding({...env,[key]:'x'}),held);
 assert.throws(()=>decodeStorageBinding({...env,[JSON_KEY]:raw}),held);
 assert.equal(decodeStorageBinding({[JSON_KEY]:'{"enabled":false}'}),'{"enabled":false}');
});
test('marker bounds, malformed parts and unsupported sizes are rejected',()=>{
 const e=encodeStorageBinding('x'.repeat(401)),env={...e.parts,[JSON_KEY]:e.marker};
 for(const marker of ['parts-v1:200:0:401','parts-v1:200:42:4096','parts-v1:200:3:4097','parts-v1:100:3:401','parts-v1:300:2:401','parts-v1:200:03:401'])assert.throws(()=>decodeStorageBinding({...env,[JSON_KEY]:marker}),held);
 for(const part of [null,{},'x'.repeat(201),'x'.repeat(199),'é'.repeat(200),'\n'.repeat(200)])assert.throws(()=>decodeStorageBinding({...env,[PART_PREFIX+'0']:part}),held);
 for(const raw of ['', 'x'.repeat(4097),'é'])assert.throws(()=>encodeStorageBinding(raw),held);
 for(const partSize of [0,99,201,401,'200'])assert.throws(()=>encodeStorageBinding('x',{partSize}),held);
});
