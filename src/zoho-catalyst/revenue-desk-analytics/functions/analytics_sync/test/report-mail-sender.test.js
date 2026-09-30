'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createReportMailSender}=require('../lib/report-mail-sender');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
  let at=1800000000000;const requests=[],bytes=Buffer.from('%PDF-1.7\n synthetic summary\n%%EOF\n');
  const snapshot={report:{summary:{role:'summary',documentSha256:sha(bytes)}},recipient:{address:'owner@example.com',verificationDigest:sha('verified recipient')}};
  const binding={environment:'development',apiOrigin:'https://mail.zoho.com',
    accountId:'101000001',fromAddress:'reports@example.com',
    contractQualificationDigest:sha('synthetic proposed envelope'),verifiedAt:at-1000,expiresAt:at+60000,timeoutMs:1000};
  const replies=[{status:{code:200},data:{attachmentName:'7-Day Revenue Leak Test.pdf',attachmentPath:'/Mail/synthetic-summary.pdf',storeName:'synthetic'}},
    {status:{code:200},data:{messageId:'101000002'}}];
  const options={binding,now:()=>at,authorizationProvider:async()=>`Zoho-oauthtoken ${'s'.repeat(24)}`,
    fetchImpl:async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify(replies.shift()),{status:200,headers:{'content-type':'application/json'}});}};
  const request={operationKey:sha('operation'),snapshot,bytes,signal:new AbortController().signal};
  return {options,request,requests,replies,advance:n=>{at+=n;}};
}
test('Mail transport uploads exact summary and sends one attachment to one verified recipient',async()=>{
 const f=fixture(),proof=await createReportMailSender(f.options).sendSummary(f.request);
 assert.equal(f.requests.length,2);assert.ok(f.requests.every(x=>x.init.method==='POST'&&x.init.redirect==='error'));
 assert.deepEqual(f.requests[0].init.body,f.request.bytes);const body=JSON.parse(f.requests[1].init.body);
 assert.equal(body.toAddress,'owner@example.com');assert.equal(body.fromAddress,'reports@example.com');assert.equal(body.attachments.length,1);
 assert.equal(body.askReceipt,'no');assert.equal(body.isSchedule,false);assert.ok(!('ccAddress'in body)&&!('bccAddress'in body));
 assert.equal(proof.documentSha256,sha(f.request.bytes));assert.equal(proof.operationKey,f.request.operationKey);
 assert.equal(proof.recipientVerificationDigest,f.request.snapshot.recipient.verificationDigest);
 assert.equal(proof.accepted,true);assert.equal('messageId'in proof,false);
});
test('unqualified binding, recipient, artifact role and bytes never dispatch',async()=>{
 for(const mutate of [f=>f.request.bytes[10]=0,f=>f.request.snapshot.report.summary.role='supporting',f=>f.request.snapshot.recipient.address='a@example.com,b@example.com',f=>f.options.binding.expiresAt=1800000000000]){
  const f=fixture();mutate(f);await assert.rejects(async()=>createReportMailSender(f.options).sendSummary(f.request),{code:'REPORT_MAIL_HELD'});assert.equal(f.requests.length,0);
 }
});
test('upload timeout cancels native request and cannot issue message send',async()=>{
 const f=fixture();f.options.binding.timeoutMs=10;let release,signal;
 f.options.fetchImpl=async(url,init)=>{f.requests.push({url,init});signal=init.signal;return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify(f.replies[0]),{headers:{'content-type':'application/json'}}));});};
 await assert.rejects(createReportMailSender(f.options).sendSummary(f.request),e=>e.code==='REPORT_MAIL_HELD'&&e.ambiguous);
 assert.equal(signal.aborted,true);release();await new Promise(resolve=>setTimeout(resolve,15));assert.equal(f.requests.length,1);
});
test('late authorization cannot initiate a provider request after deadline',async()=>{
 const f=fixture();f.options.binding.timeoutMs=10;let release;
 f.options.authorizationProvider=()=>new Promise(resolve=>{release=()=>resolve(`Zoho-oauthtoken ${'s'.repeat(24)}`);});
 await assert.rejects(createReportMailSender(f.options).sendSummary(f.request));release();await new Promise(resolve=>setTimeout(resolve,15));assert.equal(f.requests.length,0);
});
test('unknown upload envelope and hostile attachment reference cannot progress to send',async()=>{
 for(const data of [[],{}, {attachmentName:'foreign.pdf',attachmentPath:'/Mail/synthetic',storeName:'synthetic'},
   {attachmentName:'7-Day Revenue Leak Test.pdf',attachmentPath:'https://external.invalid/file',storeName:'synthetic'}]){
  const f=fixture();f.replies[0].data=data;await assert.rejects(createReportMailSender(f.options).sendSummary(f.request));assert.equal(f.requests.length,1);
 }
});
test('send rejection or missing message identity remains ambiguous, never retries or claims receipt',async()=>{
 for(const data of [{}, {messageId:'unknown'}]){const f=fixture();f.replies[1].data=data;
  await assert.rejects(createReportMailSender(f.options).sendSummary(f.request),e=>e.ambiguous===true);assert.equal(f.requests.length,2);}
 const f=fixture();assert.equal(await createReportMailSender(f.options).lookupAcceptance({operationKey:f.request.operationKey}),null);assert.equal(f.requests.length,0);
});
test('oversized/unfinished response body is bounded and cancels before another dispatch',async()=>{
 const f=fixture();let cancelled=false;
 f.options.fetchImpl=async()=>{f.requests.push({});return {status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader(){let done=false;return {async read(){if(done)return {done:true};done=true;return {done:false,value:new Uint8Array(32769)};},async cancel(){cancelled=true;}};}}};};
 await assert.rejects(createReportMailSender(f.options).sendSummary(f.request));assert.equal(f.requests.length,1);
 // No second request occurs even when the provider response was malformed.
 assert.equal(cancelled,true);
});
test('elapsed clock admission blocks send after successful upload without timer dependence',async()=>{
 const f=fixture(),fetch=f.options.fetchImpl;f.options.fetchImpl=async(...args)=>{const reply=await fetch(...args);f.advance(1001);return reply;};
 await assert.rejects(createReportMailSender(f.options).sendSummary(f.request));assert.equal(f.requests.length,1);
});
