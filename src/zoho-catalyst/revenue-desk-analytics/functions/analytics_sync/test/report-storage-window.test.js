'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PROFILE,diagnosticWindowMs}=require('../lib/report-storage-window');
const held={code:'REPORT_STORAGE_QUALIFICATION_HELD'};
const contract=schemaVersion=>({schemaVersion,profile:PROFILE,environment:'development'});
for(const [schemaVersion,expected]of [[3,900000],[4,3600000],[5,900000],[6,3600000]])
 test('schema'+schemaVersion+' retains its exact Development window',()=>{
  const input=Object.freeze(contract(schemaVersion));assert.equal(diagnosticWindowMs(input),expected);
 });
test('schema6 window rejects unsupported versions and broadened or malformed contract',()=>{
 for(const schemaVersion of [0,2,7,'6',6.5,null])assert.throws(()=>diagnosticWindowMs(contract(schemaVersion)),held);
 for(const input of [null,{},[],{...contract(6),environment:'production'},{...contract(6),environment:'Development'},
  {...contract(6),profile:'other'},{...contract(6),expiresAt:0},{profile:PROFILE,environment:'development'}])
  assert.throws(()=>diagnosticWindowMs(input),held);
});
