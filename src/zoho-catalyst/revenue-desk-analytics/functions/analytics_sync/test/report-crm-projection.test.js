'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createReportCrmProjectionWriter,FIELDS,projection}=require('../lib/report-crm-projection');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),clone=x=>structuredClone(x);
function fixture(){
 const at=1800000000000,rows=new Map();let puts=0;const calls=[];
 const binding={clientId:'client',deploymentId:'test',dealId:'19000001',accountId:'19000002',contactId:'19000003',
  configurationVersion:'config',periodStart:'2026-09-01',periodEnd:'2026-09-08'};
 const snapshot={binding,nativeRelationshipEvidenceSha256:hash('native'),
  report:{completed:true,fresh:true,validated:true,generationKey:hash('bundle'),manifestSha256:hash('manifest'),
   sourceRevisionDigest:hash('source'),summary:{role:'summary',generationKey:hash('summary'),documentSha256:hash('pdf'),privateReceiptKey:hash('receipt')}},
  recipient:{contactId:binding.contactId,address:'synthetic@example.com',explicitlySelected:true,verified:true,eligible:true,suppressed:false,
   verifiedAt:at-1000,expiresAt:at+60000,verificationDigest:hash('recipient')}};
 const link={url:'https://workdrive.zoho.com/file/synthetic?version=1',access:'authenticated_private',qualificationDigest:hash('link'),
  expiresAt:at+60000,manifestSha256:snapshot.report.manifestSha256,documentSha256:snapshot.report.summary.documentSha256};
 const records={deal:{id:binding.dealId,Modified_Time:'2026-09-08T00:00:00+00:00',Deployment_Record_ID:'test',
  Configuration_Version:'config',Test_Status:'Completed',Account_Name:{id:binding.accountId},Contact_Name:{id:binding.contactId}},
  contact:{id:binding.contactId,Account_Name:{id:binding.accountId},Email:snapshot.recipient.address}};
 const store={get:async key=>clone(rows.get(key)||null),insert:async(key,state)=>{
  if(!rows.has(key)){projection(state);rows.set(key,{key,version:1,state:clone(state)});}return clone(rows.get(key));},
  compareAndSwap:async(row,state)=>{if(rows.get(row.key)?.version!==row.version)return null;
   projection(state);const fresh={key:row.key,version:row.version+1,state:clone(state)};rows.set(row.key,fresh);return clone(fresh);}};
 const options={store,readRecords:async()=>clone(records),readProjection:async()=>clone({snapshot,link}),
  authorize:async()=>true,authorizationProvider:async()=>`Zoho-oauthtoken ${'x'.repeat(30)}`,now:()=>at,
  binding:{apiOrigin:'https://www.zohoapis.com',environment:'development',principalQualificationDigest:hash('principal'),
   schemaDigest:hash('schema'),verifiedAt:at-1000,expiresAt:at+60000,timeoutMs:1000},
  fetchImpl:async(url,request)=>{puts++;calls.push({url,request});const body=JSON.parse(request.body);
   Object.assign(records.deal,Object.fromEntries(FIELDS.map(k=>[k,body.data[0][k]])));
   return new Response(JSON.stringify({data:[{status:'success',code:'SUCCESS',details:{id:binding.dealId}}]}),
    {status:200,headers:{'content-type':'application/json'}});}};
 return {options,records,snapshot,link,rows,calls,get puts(){return puts;},write:()=>createReportCrmProjectionWriter(options)({dealId:binding.dealId})};
}
test('five-field conditional PUT suppresses workflows/cadences, verifies and never repeats',async()=>{
 const f=fixture();assert.deepEqual(await f.write(),{status:'verified'});assert.deepEqual(await f.write(),{status:'verified'});
 assert.equal(f.puts,1);const {url,request}=f.calls[0];assert.equal(url,'https://www.zohoapis.com/crm/v8/Deals/19000001');
 assert.equal(request.method,'PUT');assert.equal(request.redirect,'error');assert.equal(request.headers['If-Unmodified-Since'],'2026-09-08T00:00:00+00:00');
 const body=JSON.parse(request.body);assert.deepEqual(body.trigger,[]);assert.deepEqual(body.data[0].skip_feature_execution,[{name:'cadences'}]);
 assert.deepEqual(Object.keys(body.data[0]).filter(k=>k!=='skip_feature_execution').sort(),[...FIELDS].sort());
 assert.equal(body.data[0].Test_Report_Delivery_Status,'Held');
});
test('concurrent repeats own one claim and PUT',async()=>{const f=fixture();const results=await Promise.allSettled([f.write(),f.write()]);
 assert.equal(f.puts,1);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);});
test('ambiguous response with exact independent readback settles without another PUT',async()=>{
 const f=fixture(),send=f.options.fetchImpl;f.options.fetchImpl=async(...args)=>{await send(...args);throw Error('lost response');};
 await assert.rejects(f.write(),{code:'REPORT_CRM_PROJECTION_HELD',ambiguous:true});
 assert.deepEqual(await f.write(),{status:'verified'});assert.equal(f.puts,1);
});
test('unknown outcome without matching readback remains held without replay',async()=>{
 const f=fixture();let requests=0;f.options.fetchImpl=async()=>{requests++;throw Error('unknown');};
 await assert.rejects(f.write());await assert.rejects(f.write());assert.equal(requests,1);
});
test('foreign relationship, stale source, recipient mismatch or public link cannot PUT',async()=>{
 for(const change of [f=>f.records.deal.Deployment_Record_ID='foreign',f=>f.snapshot.report.fresh=false,
  f=>f.records.contact.Email='other@example.com',f=>f.link.access='public']){
  const f=fixture();change(f);await assert.rejects(f.write());assert.equal(f.puts,0);
 }
});
test('cohort drift after durable claim cannot PUT',async()=>{
 const f=fixture(),read=f.options.readRecords;let reads=0;f.options.readRecords=async()=>{if(++reads===2)f.records.deal.Modified_Time='2026-09-08T00:00:01+00:00';return read();};
 await assert.rejects(f.write());assert.equal(f.puts,0);
});
test('timeout cancels native request and a late result cannot verify or dispatch another PUT',async()=>{
 const f=fixture();f.options.binding.timeoutMs=15;let requests=0,signal;
 f.options.fetchImpl=async(url,request)=>{requests++;signal=request.signal;return new Promise(()=>{});};
 await assert.rejects(f.write(),{code:'REPORT_CRM_PROJECTION_HELD',ambiguous:true});assert.equal(signal.aborted,true);
 await assert.rejects(f.write());assert.equal(requests,1);
});
test('already cancelled operation performs no store or network operation',async()=>{
 const f=fixture(),c=new AbortController();c.abort();let reads=0;f.options.readProjection=async()=>{reads++;throw Error('unexpected');};
 await assert.rejects(createReportCrmProjectionWriter(f.options)({dealId:'19000001',signal:c.signal}));assert.equal(reads,0);assert.equal(f.puts,0);
});

test('revoked actor immediately before dispatch prevents PUT despite unchanged PDF and recipient',async()=>{
 const f=fixture();let authorized=0;f.options.authorize=async request=>{authorized++;assert.equal(request.action,'project');return false;};
 await assert.rejects(f.write());assert.equal(authorized,1);assert.equal(f.puts,0);
});
test('corrected revision advances one verified per-test claim and preserves unknown-write barrier',async()=>{
 const f=fixture();await f.write();const old=[...f.rows.values()][0];
 f.snapshot.report.manifestSha256=hash('corrected manifest');f.link.manifestSha256=f.snapshot.report.manifestSha256;
 await f.write();assert.equal(f.puts,2);assert.equal(f.rows.size,1);assert.equal([...f.rows.values()][0].version,old.version+2);
 const g=fixture();g.options.fetchImpl=async()=>{throw Error('unknown');};await assert.rejects(g.write());
 g.snapshot.report.manifestSha256=hash('corrected');g.link.manifestSha256=g.snapshot.report.manifestSha256;
 await assert.rejects(g.write());assert.equal(g.rows.size,1);
});

test('link or recipient expiring during final actor authorization cannot dispatch PUT',async()=>{
 for(const type of ['link','recipient']){
  const f=fixture();const at=f.options.now();f.options.now=()=>at;
  if(type==='link')f.link.expiresAt=at+10;else f.snapshot.recipient.expiresAt=at+10;
  f.options.authorize=async()=>{f.options.now=()=>at+11;return true;};
  // The writer captures now; advance its shared closure rather than replacing it.
  let clock=at;f.options.now=()=>clock;f.options.authorize=async()=>{clock=at+11;return true;};
  await assert.rejects(f.write());assert.equal(f.puts,0);
 }
});
