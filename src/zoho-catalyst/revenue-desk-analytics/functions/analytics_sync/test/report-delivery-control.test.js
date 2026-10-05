'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createReportDeliveryControl,deliveryProjection}=require('../lib/report-delivery-control');
const {canonicalJson}=require('../lib/facts');
const persisted=v=>JSON.parse(canonicalJson(v));
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function fixture(){
 let at=1800000000000,sends=0,lookups=0;
 const bytes=Buffer.from('%PDF-1.7\n synthetic summary only\n%%EOF\n');
 let snapshot={binding:{clientId:'synthetic_client',deploymentId:'synthetic_deployment',dealId:'synthetic_deal',accountId:'synthetic_account',contactId:'synthetic_contact',configurationVersion:'configuration_v1',periodStart:'2027-01-01',periodEnd:'2027-01-07'},nativeRelationshipEvidenceSha256:hash('native lineage'),report:{completed:true,fresh:true,validated:true,generationKey:hash('pair'),manifestSha256:hash('manifest'),sourceRevisionDigest:hash('source'),summary:{role:'summary',generationKey:hash('pdf'),documentSha256:hash(bytes),privateReceiptKey:hash('receipt')}},recipient:{contactId:'synthetic_contact',address:'owner@example.com',explicitlySelected:true,verified:true,eligible:true,suppressed:null,suppressionStatus:'provider_enforcement_pending',consentEvidenceDigest:'a'.repeat(64),preflightEvidenceDigest:'b'.repeat(64),verificationDigest:hash('recipient'),verifiedAt:at-1000,expiresAt:at+3600000}};
 const rows=new Map();const copy=structuredClone;
 const store={async get(key){return copy(rows.get(key)||null);},async insert(key,state){if(!rows.has(key))rows.set(key,{key,version:1,state:persisted(state)});return copy(rows.get(key));},async compareAndSwap(row,state){const old=rows.get(row.key);if(old.version!==row.version)return null;const next={key:row.key,version:row.version+1,state:persisted(state)};rows.set(row.key,next);return copy(next);}};
 const proofs=new Map();const sender={async sendSummary({operationKey,snapshot,bytes:actual}){sends++;assert.deepEqual(actual,bytes);const p={accepted:true,operationKey,documentSha256:snapshot.report.summary.documentSha256,recipientVerificationDigest:snapshot.recipient.verificationDigest,messageReferenceDigest:hash(operationKey),acceptedAt:at};proofs.set(operationKey,p);return p;},async lookupAcceptance({operationKey}){lookups++;return proofs.get(operationKey)||null;}};
 const options={store,sender,readSnapshot:async()=>copy(snapshot),authorize:async()=>true,readSummary:async()=>Buffer.from(bytes),now:()=>at,autoDeliveryEnabled:true};
 const req={dealId:'synthetic_deal',actor:'synthetic_authenticated_owner'};
 return {options,req,rows,proofs,sender,bytes,get snapshot(){return snapshot;},set snapshot(v){snapshot=v;},get sends(){return sends;},get lookups(){return lookups;},advance:n=>{at+=n;},control:()=>createReportDeliveryControl(options)};
}
test('one initial send per test retains exact PDF and recipient without claiming inbox/read/follow-up',async()=>{
 const f=fixture(),c=f.control(),first=await c.initial(f.req),second=await c.initial(f.req);
 assert.equal(first.status,'provider_accepted');assert.equal(second.operationKey,first.operationKey);assert.equal(f.sends,1);
 assert.equal(first.inboxReceipt,'unknown');assert.equal(first.readReceipt,'unknown');assert.equal(first.followUp,'unknown');
 const state=[...f.rows.values()][0].state;assert.equal(state.snapshot.recipient.address,'owner@example.com');assert.equal(deliveryProjection(state).DeliveryStatus,'ProviderAccepted');
});
test('concurrent initial requests and concurrent resend double taps dispatch once each',async()=>{
 const f=fixture(),c=f.control();await Promise.all([c.initial(f.req),c.initial(f.req)]);assert.equal(f.sends,1);
 const p=await c.prepareResend(f.req),r={...f.req,confirmationId:p.confirmationId,confirmed:true};
 await Promise.all([c.confirmResend(r),c.confirmResend(r)]);assert.equal(f.sends,2);
 await c.confirmResend(r);assert.equal(f.sends,2);
});
test('corrected report revision never causes another initial send; manual resend confirms exact new revision',async()=>{
 const f=fixture(),c=f.control();const first=await c.initial(f.req);
 f.snapshot.report.generationKey=hash('corrected pair');f.snapshot.report.manifestSha256=hash('corrected manifest');
 const repeated=await c.initial(f.req);assert.equal(repeated.operationKey,first.operationKey);assert.equal(f.sends,1);
 const p=await c.prepareResend(f.req);assert.equal(p.manifestSha256,f.snapshot.report.manifestSha256);
 await c.confirmResend({...f.req,confirmationId:p.confirmationId,confirmed:true});assert.equal(f.sends,2);
});
test('incomplete, stale, unvalidated, unverified, suppressed and ambiguous recipients fail without effects',async()=>{
 for(const change of [x=>x.report.completed=false,x=>x.report.fresh=false,x=>x.report.validated=false,x=>x.recipient.verified=false,x=>x.recipient.explicitlySelected=false,x=>x.recipient.eligible=false,x=>x.recipient.suppressed=true,x=>x.recipient.contactId='foreign_contact',x=>x.recipient.address='a@example.com,b@example.com',x=>x.nativeRelationshipEvidenceSha256='unknown']){
  const f=fixture();change(f.snapshot);await assert.rejects(f.control().initial(f.req),{code:'REPORT_DELIVERY_HELD'});assert.equal(f.sends,0);assert.equal(f.rows.size,0);
 }
});
test('no fallback to alert, signer or generic Account email and no recipient/PDF chosen by button',async()=>{
 const f=fixture();delete f.snapshot.recipient;f.snapshot.alertEmail='alert@example.com';f.snapshot.signerEmail='signer@example.com';f.snapshot.accountEmail='account@example.com';
 await assert.rejects(f.control().initial({...f.req,recipient:'guess@example.com'}),{code:'REPORT_DELIVERY_HELD'});assert.equal(f.sends,0);
});
test('authorization denial and wrong Deal hold view/send; view has no sender effects',async()=>{
 const f=fixture(),c=f.control();assert.equal((await c.view(f.req)).summary.documentSha256,hash(f.bytes));assert.equal(f.sends,0);
 f.options.authorize=async()=>false;await assert.rejects(f.control().initial(f.req),{code:'REPORT_DELIVERY_HELD'});
 await assert.rejects(c.view({...f.req,dealId:'foreign_deal'}),{code:'REPORT_DELIVERY_HELD'});
});
test('confirmation expires and changed recipient/revision invalidates pending resend',async()=>{
 for(const mutate of [f=>f.advance(900000),f=>f.snapshot.recipient.address='changed@example.com',f=>f.snapshot.report.manifestSha256=hash('later')]){
  const f=fixture(),c=f.control();await c.initial(f.req);const p=await c.prepareResend(f.req);mutate(f);
  await assert.rejects(c.confirmResend({...f.req,confirmationId:p.confirmationId,confirmed:true}),{code:'REPORT_DELIVERY_HELD'});assert.equal(f.sends,1);
 }
});
test('manual resend requires deliberate confirmation and prior accepted initial send',async()=>{
 const f=fixture(),c=f.control();await assert.rejects(c.prepareResend(f.req),{code:'REPORT_DELIVERY_HELD'});await c.initial(f.req);const p=await c.prepareResend(f.req);
 await assert.rejects(c.confirmResend({...f.req,confirmationId:p.confirmationId,confirmed:false}),{code:'REPORT_DELIVERY_HELD'});assert.equal(f.sends,1);
});
test('unknown send is held; exact independent provider acceptance recovers without resending',async()=>{
 const f=fixture();const send=f.sender.sendSummary;f.sender.sendSummary=async x=>{await send(x);throw Error('synthetic lost response');};
 const c=f.control(),first=await c.initial(f.req);assert.equal(first.status,'delivery_reconciliation_required');assert.equal(f.sends,1);
 const second=await c.initial(f.req);assert.equal(second.status,'provider_accepted');assert.equal(f.sends,1);
});
test('provider proof for another PDF/recipient cannot fabricate acceptance or cause retry',async()=>{
 const f=fixture();f.sender.sendSummary=async()=>({accepted:true,messageReferenceDigest:hash('wrong'),acceptedAt:1800000000000});
 const c=f.control();assert.equal((await c.initial(f.req)).status,'delivery_reconciliation_required');assert.equal((await c.initial(f.req)).status,'delivery_reconciliation_required');
});
test('stored-content mismatch and source drift after claim cannot dispatch',async()=>{
 for(const setup of [f=>{f.options.readSummary=async()=>Buffer.from('%PDF-1.7\nchanged');},f=>{f.options.readSummary=async()=>{f.snapshot.report.sourceRevisionDigest=hash('drift');return f.bytes;};}]){
  const f=fixture();setup(f);await assert.rejects(f.control().initial(f.req),{code:'REPORT_DELIVERY_HELD'});assert.equal(f.sends,0);
  const result=await f.control().initial(f.req);assert.equal(result.status,'delivery_reconciliation_required');assert.equal(f.sends,0);
 }
});
test('deadline cancels local admission and late provider completion cannot dispatch a second request',async()=>{
 const f=fixture();let seenSignal,release;f.options.timeoutMs=10;
 f.sender.sendSummary=async x=>{seenSignal=x.signal;return new Promise(resolve=>{release=()=>resolve(null);});};
 await assert.rejects(f.control().initial(f.req),{code:'REPORT_DELIVERY_HELD'});assert.equal(seenSignal.aborted,true);release();
 // Reconciliation tests consumed-state behavior, not another short wall deadline.
 f.options.timeoutMs=1000;
 assert.equal((await f.control().initial(f.req)).status,'delivery_reconciliation_required');
});
test('lost claim CAS/acceptance response recovers by exact state readback without double send',async()=>{
 const f=fixture();const cas=f.options.store.compareAndSwap;f.options.store.compareAndSwap=async(...x)=>{await cas(...x);return null;};
 const c=f.control();assert.equal((await c.initial(f.req)).status,'provider_accepted');const p=await c.prepareResend(f.req);
 assert.equal((await c.confirmResend({...f.req,confirmationId:p.confirmationId,confirmed:true})).status,'provider_accepted');assert.equal(f.sends,2);
});
test('repeat test with a different deployment retains both initial histories; cross-client collision holds',async()=>{
 const f=fixture(),c=f.control();const first=await c.initial(f.req);f.snapshot.binding.deploymentId='synthetic_deployment_2';
 const second=await c.initial(f.req);assert.notEqual(first.operationKey,second.operationKey);assert.equal(f.sends,2);
 f.snapshot.binding.clientId='foreign_client';await assert.rejects(c.initial(f.req),{code:'REPORT_DELIVERY_HELD'});assert.equal(f.sends,2);
});
test('standing automation disabled by default, and corrupt durable state holds',async()=>{
 const f=fixture();f.options.autoDeliveryEnabled=false;await assert.rejects(f.control().initial(f.req),{code:'REPORT_DELIVERY_HELD'});
 f.options.autoDeliveryEnabled=true;await f.control().initial(f.req);[...f.rows.values()][0].state.phase='sent_and_read';
 await assert.rejects(f.control().initial(f.req),{code:'REPORT_DELIVERY_HELD'});
});


test('elapsed deadline blocks dispatch even when synchronous work delays the timer',async()=>{
 const f=fixture();f.options.timeoutMs=10;f.options.readSummary=async()=>{const until=performance.now()+30;while(performance.now()<until){}return f.bytes;};
 await assert.rejects(f.control().initial(f.req),{code:'REPORT_DELIVERY_HELD'});assert.equal(f.sends,0);
});
test('elapsed deadline blocks an immediate promise chain before timer scheduling',async()=>{
 const f=fixture();f.options.timeoutMs=10;f.options.readSummary=async()=>{f.advance(11);return f.bytes;};
 await assert.rejects(f.control().initial(f.req),{code:'REPORT_DELIVERY_HELD'});assert.equal(f.sends,0);
});


test('revoked authorization during PDF retrieval blocks final initial and resend dispatch',async()=>{
 for(const resend of [false,true]){
  const f=fixture();let allowed=true;f.options.authorize=async()=>allowed;const c=f.control();
  let confirmation;
  if(resend){await c.initial(f.req);confirmation=await c.prepareResend(f.req);}
  f.options.readSummary=async()=>{allowed=false;return f.bytes;};
  const changed=f.control();
  await assert.rejects(resend?changed.confirmResend({...f.req,confirmationId:confirmation.confirmationId,confirmed:true}):changed.initial(f.req),{code:'REPORT_DELIVERY_HELD'});
  assert.equal(f.sends,resend?1:0);
 }
});
test('view rechecks exact current snapshot and current authorization after private bytes arrive',async()=>{
 for(const revoke of [false,true]){
  const f=fixture();let allowed=true;f.options.authorize=async()=>allowed;
  f.options.readSummary=async()=>{if(revoke)allowed=false;else f.snapshot.report.manifestSha256=hash('new revision during retrieval');return f.bytes;};
  await assert.rejects(f.control().view(f.req),{code:'REPORT_DELIVERY_HELD'});assert.equal(f.sends,0);
 }
});

test('definitive provider rejection becomes terminal Failed without receipt claims or later dispatch',async()=>{
 const f=fixture();let calls=0;f.sender.sendSummary=async x=>{calls++;return {accepted:false,rejected:true,rejectionCode:'NOT_ALLOWED',
  operationKey:x.operationKey,documentSha256:x.snapshot.report.summary.documentSha256,
  recipientVerificationDigest:x.snapshot.recipient.verificationDigest,rejectedAt:1800000000000};};
 const c=f.control(),first=await c.initial(f.req);assert.equal(first.status,'provider_rejected');assert.equal(first.rejectionCode,'NOT_ALLOWED');
 const saved=[...f.rows.values()][0].state;assert.equal(deliveryProjection(saved).DeliveryStatus,'Failed');
 assert.equal(first.inboxReceipt,'unknown');assert.equal(first.readReceipt,'unknown');assert.equal(first.followUp,'unknown');
 assert.equal((await c.initial(f.req)).status,'provider_rejected');assert.equal(calls,1);assert.equal(f.lookups,0);
 await assert.rejects(c.prepareResend(f.req));assert.equal(calls,1);
});

test('lost failed-state acknowledgement reconciles exact immutable failure without another send',async()=>{
 const f=fixture();let calls=0;const cas=f.options.store.compareAndSwap;
 f.options.store.compareAndSwap=async(...args)=>{await cas(...args);return null;};
 f.sender.sendSummary=async x=>{calls++;return {accepted:false,rejected:true,rejectionCode:'NO_PERMISSION',operationKey:x.operationKey,
  documentSha256:x.snapshot.report.summary.documentSha256,recipientVerificationDigest:x.snapshot.recipient.verificationDigest,rejectedAt:1800000000000};};
 assert.equal((await f.control().initial(f.req)).status,'provider_rejected');assert.equal((await f.control().initial(f.req)).status,'provider_rejected');assert.equal(calls,1);
});

test('wrong rejection scope and unknown provider error cannot fabricate Failed',async()=>{
 for(const change of [p=>p.operationKey=hash('other'),p=>p.documentSha256=hash('other'),p=>p.recipientVerificationDigest=hash('other'),p=>p.rejectionCode='CUSTOM_ERROR']){
  const f=fixture();f.sender.sendSummary=async x=>{const p={accepted:false,rejected:true,rejectionCode:'NOT_ALLOWED',operationKey:x.operationKey,
   documentSha256:x.snapshot.report.summary.documentSha256,recipientVerificationDigest:x.snapshot.recipient.verificationDigest,rejectedAt:1800000000000};change(p);return p;};
  assert.equal((await f.control().initial(f.req)).status,'delivery_reconciliation_required');assert.equal([...f.rows.values()][0].state.phase,'dispatch_started');
 }
});
