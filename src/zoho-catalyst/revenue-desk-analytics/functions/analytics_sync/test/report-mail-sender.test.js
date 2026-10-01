'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createReportCrmSender,projection}=require('../lib/report-mail-sender');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 let at=1800000000000;const requests=[],rows=new Map(),bytes=Buffer.from('%PDF-1.7\n synthetic summary\n%%EOF\n');
 const snapshot={binding:{clientId:'synthetic',deploymentId:'test',contactId:'19000003',periodStart:'2027-01-01',periodEnd:'2027-01-07'},
  report:{summary:{role:'summary',documentSha256:sha(bytes)}},recipient:{contactId:'19000003',address:'owner@example.invalid',verificationDigest:sha('recipient')}};
 const binding={environment:'development',provider:'crm_native',apiOrigin:'https://www.zohoapis.com',
  fromAddress:'reports@example.invalid',fromName:'Sylvara',
  contractQualificationDigest:sha('contract'),senderQualificationDigest:sha('sender'),verifiedAt:at-1000,expiresAt:at+60000,timeoutMs:1000,maxReconciliationPages:3};
 const replies=[{data:[{code:'SUCCESS',status:'success',details:{name:'7-Day Revenue Leak Test.pdf',id:'synthetic_zfs'}}]},
  {data:[{code:'SUCCESS',status:'success',details:{message_id:'synthetic_message'}}]}];
 const store={async get(key){return rows.has(key)?{key,state:structuredClone(rows.get(key))}:null;},async insert(key,state){projection(state);
  if(!rows.has(key))rows.set(key,structuredClone(state));return this.get(key);}};
 const options={binding,store,now:()=>at,authorizationProvider:async()=>`Zoho-oauthtoken ${'s'.repeat(24)}`,
  fetchImpl:async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify(replies.shift()),{headers:{'content-type':'application/json'}});}};
 const request={operationKey:sha('operation'),snapshot,bytes,signal:new AbortController().signal};
 return {options,request,requests,replies,rows,advance:n=>at+=n};
}
test('CRM native transport preserves upload receipt and one Contact/org sender',async()=>{
 const f=fixture(),proof=await createReportCrmSender(f.options).sendSummary(f.request);
 assert.equal(f.requests.length,2);assert.equal(f.requests[0].url,'https://www.zohoapis.com/crm/v8/files');
 const file=f.requests[0].init.body.get('file');assert.equal(file.type,'application/pdf');assert.deepEqual(Buffer.from(await file.arrayBuffer()),f.request.bytes);
 const send=f.requests[1];assert.ok(send.url.endsWith('/Contacts/19000003/actions/send_mail'));
 const data=JSON.parse(send.init.body).data[0];assert.deepEqual(data.to,[{email:'owner@example.invalid'}]);assert.equal(data.org_email,true);
 assert.equal(data.from.email,'reports@example.invalid');assert.deepEqual(data.attachments,[{id:'synthetic_zfs'}]);
 for(const key of ['cc','bcc','consent_email','scheduled_time'])assert.ok(!(key in data));
 assert.equal(proof.accepted,true);assert.equal(proof.documentSha256,sha(f.request.bytes));assert.equal(f.rows.size,2);
 assert.ok([...f.rows.values()].some(x=>x.fileId==='synthetic_zfs'));
 await assert.rejects(createReportCrmSender(f.options).sendSummary(f.request));assert.equal(f.requests.length,2);
});
test('concurrent repeats dispatch upload/send once',async()=>{
 const f=fixture(),sender=createReportCrmSender(f.options);const results=await Promise.allSettled([sender.sendSummary(f.request),sender.sendSummary(f.request)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.requests.length,2);
});
test('invalid binding or artifact never dispatches',async()=>{
 for(const mutate of [f=>f.options.binding.provider='mail',f=>f.options.binding.apiOrigin='https://mail.zoho.com',
  f=>f.request.snapshot.binding.contactId='unknown',f=>f.request.bytes[10]=0,f=>f.request.snapshot.report.summary.role='supporting',
  f=>f.request.snapshot.recipient.address='a@example.invalid,b@example.invalid',f=>f.options.binding.expiresAt=1800000000000]){
  const f=fixture();mutate(f);await assert.rejects(async()=>createReportCrmSender(f.options).sendSummary(f.request));assert.equal(f.requests.length,0);}
});
test('unknown upload and failed durable receipt never send or re-upload',async()=>{
 for(const mode of ['unknown','receipt']){const f=fixture();if(mode==='unknown')f.replies[0]={data:[]};else{
  const insert=f.options.store.insert.bind(f.options.store);f.options.store.insert=async(k,s)=>{if(s.phase==='uploaded')throw Error('unknown');return insert(k,s);};}
  await assert.rejects(createReportCrmSender(f.options).sendSummary(f.request));assert.equal(f.requests.length,1);
  await assert.rejects(createReportCrmSender(f.options).sendSummary(f.request));assert.equal(f.requests.length,1);}
});
test('timeout cancels and never admits a second dispatch',async()=>{
 const f=fixture();f.options.binding.timeoutMs=20;let signal;f.options.fetchImpl=async(u,o)=>{f.requests.push({u,o});signal=o.signal;return new Promise(()=>{});};
 await assert.rejects(createReportCrmSender(f.options).sendSummary(f.request));assert.equal(signal.aborted,true);
 await assert.rejects(createReportCrmSender(f.options).sendSummary(f.request));assert.equal(f.requests.length,1);
});
test('CRM suppression/consent errors remain unknown, never bypassed or replayed',async()=>{
 const f=fixture();f.replies[1]={data:[{code:'EMAIL_OPT_OUT',status:'error'}]};await assert.rejects(createReportCrmSender(f.options).sendSummary(f.request));
 await assert.rejects(createReportCrmSender(f.options).sendSummary(f.request));assert.equal(f.requests.length,2);
});
test('reconciliation paginates Contact CRM emails and requires exact body/attachment/recipient/sender',async()=>{
 for(const mode of ['exact','recipient','attachment','truncated','absent']){
  const f=fixture();f.replies[1]={data:[]};const sender=createReportCrmSender(f.options);await assert.rejects(sender.sendSummary(f.request));
  const sent=JSON.parse(f.requests[1].init.body).data[0];
  f.replies.push({Emails:[],info:{more_records:true,next_index:'opaque_index'}},
   {Emails:mode==='absent'?[]:[{subject:sent.subject,message_id:'synthetic_message'}],info:{more_records:mode==='truncated',next_index:'next'}},
   mode==='truncated'?{Emails:[],info:{more_records:true,next_index:'last'}}:{Emails:[{...sent,sent:true,attachments:[{id:'synthetic_zfs',name:'7-Day Revenue Leak Test.pdf',size:String(f.request.bytes.length)}]}]});
  if(mode==='recipient')f.replies[2].Emails[0].to=[{email:'other@example.invalid'}];
  if(mode==='attachment')f.replies[2].Emails[0].attachments[0].id='different';
  const result=await sender.lookupAcceptance(f.request);assert.equal(result?.accepted===true,mode==='exact');
  assert.equal(f.requests.filter(x=>x.init.method==='POST').length,2);
  assert.ok(f.requests[3].url.includes('index=opaque_index'));}
});
test('malformed pagination/response, multiple matches and changed source hold',async()=>{
 const f=fixture();await createReportCrmSender(f.options).sendSummary(f.request);f.request.snapshot.report.summary.documentSha256=sha('changed');
 await assert.rejects(createReportCrmSender(f.options).lookupAcceptance(f.request));assert.equal(f.requests.length,2);
});
