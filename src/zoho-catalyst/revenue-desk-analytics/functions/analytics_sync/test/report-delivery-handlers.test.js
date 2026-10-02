'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createReportDeliveryControl}=require('../lib/report-delivery-control');
const {createReportDeliveryHandlers,attachTerminalReportDelivery,PROFILE}=require('../lib/report-delivery-handlers');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture({reject=false,projectReport=null}={}){
 const at=1800000000000,rows=new Map(),bytes=Buffer.from('%PDF-1.7\nsynthetic\n%%EOF\n');let sends=0,reads=0;
 const snapshot={binding:{clientId:'client',deploymentId:'deployment',dealId:'deal',accountId:'account',contactId:'contact',configurationVersion:'v1',periodStart:'2027-01-01',periodEnd:'2027-01-07'},nativeRelationshipEvidenceSha256:sha('native'),
  report:{completed:true,fresh:true,validated:true,generationKey:sha('pair'),manifestSha256:sha('manifest'),sourceRevisionDigest:sha('source'),summary:{role:'summary',generationKey:sha('summary'),documentSha256:sha(bytes),privateReceiptKey:sha('receipt')}},
  recipient:{contactId:'contact',address:'owner@example.com',explicitlySelected:true,verified:true,eligible:true,suppressed:null,suppressionStatus:'provider_enforcement_pending',consentEvidenceDigest:'a'.repeat(64),preflightEvidenceDigest:'b'.repeat(64),verificationDigest:sha('recipient'),verifiedAt:at-1000,expiresAt:at+60000}};
 const copy=structuredClone;const store={async get(k){return copy(rows.get(k)||null);},async insert(k,state){if(!rows.has(k))rows.set(k,{key:k,version:1,state:copy(state)});return copy(rows.get(k));},async compareAndSwap(row,state){const old=rows.get(row.key);if(old.version!==row.version)return null;const next={key:row.key,version:row.version+1,state:copy(state)};rows.set(row.key,next);return copy(next);}};
 const readSnapshot=async()=>{reads++;return copy(snapshot);};const owner={kind:'internal_controller',identity:'synthetic_owner'},system={kind:'worker',identity:'synthetic_worker'};
 const control=createReportDeliveryControl({store,readSnapshot,readSummary:async()=>Buffer.from(bytes),now:()=>at,autoDeliveryEnabled:true,
  authorize:async({actor})=>actor===owner||actor===system,sender:{async sendSummary({operationKey,snapshot}){sends++;if(reject)return {accepted:false,rejected:true,rejectionCode:'NOT_ALLOWED',operationKey,documentSha256:sha(bytes),recipientVerificationDigest:snapshot.recipient.verificationDigest,rejectedAt:at};return {accepted:true,operationKey,documentSha256:sha(bytes),recipientVerificationDigest:snapshot.recipient.verificationDigest,messageReferenceDigest:sha('message'),acceptedAt:at};},async lookupAcceptance(){return null;}}});
 const selection={clientId:'client',deploymentId:'deployment',dealId:'deal',testStatus:'Completed'};
 const handlers=createReportDeliveryHandlers({control,readSnapshot,projectReport,systemActor:system,now:()=>at,readPrivateView:async({summary,manifestSha256})=>({url:'https://workdrive.zoho.com/file/synthetic',access:'authenticated_private',qualificationDigest:sha('synthetic version link'),expiresAt:at+60000,manifestSha256,documentSha256:summary.documentSha256}),readDealForScope:async()=>copy(selection)});
 const scope={clientId:'client',deploymentId:'deployment'},pair={status:'report_pair_verified_not_for_delivery',generationKey:sha('pair'),manifestSha256:sha('manifest'),manifest:{initialDeliveryArtifact:'summary'}};
 return {handlers,control,snapshot,scope,pair,owner,system,selection,rows,get sends(){return sends;},get reads(){return reads;}};
}
test('terminal pair enters actual control once; repeats retain immutable initial claim',async()=>{
 const f=fixture();assert.equal((await f.handlers.afterPair(f.scope,f.pair)).status,'provider_accepted');
 assert.equal((await f.handlers.afterPair(f.scope,f.pair)).status,'provider_accepted');assert.equal(f.sends,1);
});
test('Stopped report preserves report eligibility without completed initial-send authority',async()=>{
 const f=fixture();f.selection.testStatus='Stopped';assert.equal((await f.handlers.afterPair(f.scope,f.pair)).status,'held');assert.equal(f.sends,0);assert.equal(f.rows.size,0);
});
test('foreign scope and stale manifest cannot acquire an initial claim',async()=>{
 for(const change of [f=>f.selection.clientId='foreign',f=>f.snapshot.report.manifestSha256=sha('corrected')]){
  const f=fixture();change(f);assert.equal((await f.handlers.afterPair(f.scope,f.pair)).status,'held');assert.equal(f.sends,0);assert.equal(f.rows.size,0);
 }
 const f=fixture();await assert.rejects(f.control.initial({dealId:'deal',actor:f.system,expectedManifestSha256:sha('foreign')}));assert.equal(f.rows.size,0);
});
test('view and resend commands use authenticated actor and existing durable double-tap guard',async()=>{
 const f=fixture(),context={actor:f.owner};await f.handlers.afterPair(f.scope,f.pair);
 const view=await f.handlers.handle({profile:PROFILE,action:'view',dealId:'deal'},context);assert.equal(view.manifestSha256,f.pair.manifestSha256);
 const prepared=await f.handlers.handle({profile:PROFILE,action:'prepare_resend',dealId:'deal'},context);
 const cmd={profile:PROFILE,action:'confirm_resend',dealId:'deal',confirmationId:prepared.confirmationId,confirmed:true};
 await Promise.all([f.handlers.handle(cmd,context),f.handlers.handle(cmd,context)]);assert.equal(f.sends,2);
});
test('body cannot override actor, PDF, recipient, sender or select automatic initial mode',async()=>{
 for(const extra of [{actor:{kind:'worker'}},{recipient:'foreign@example.com'},{pdf:'foreign'},{sender:'foreign@example.com'}]){
  const f=fixture();await assert.rejects(f.handlers.handle({profile:PROFILE,action:'view',dealId:'deal',...extra},{actor:f.owner}));assert.equal(f.reads,0);
 }
 const f=fixture();await assert.rejects(f.handlers.handle({profile:PROFILE,action:'initial',dealId:'deal'},{actor:f.owner}));
 await assert.rejects(f.handlers.handle({profile:PROFILE,action:'view',dealId:'deal'},{actor:{kind:'forged'}}));assert.equal(f.sends,0);
});
test('terminal adapter returns only safe states, without private report/recipient data',async()=>{
 const f=fixture();let renders=0;const reconcile=async()=>{renders++;return f.pair;};Object.defineProperty(reconcile,'attemptTimeoutMs',{value:120000});
 const hook=attachTerminalReportDelivery(reconcile,f.handlers);assert.equal(hook.attemptTimeoutMs,120000);
 assert.deepEqual(await hook(f.scope),{status:f.pair.status,deliveryStatus:'provider_accepted'});assert.equal(renders,1);assert.equal(f.sends,1);
});


test('corrected pair or recipient never inherits previous PDF acceptance or repeats initial send',async()=>{
 for(const change of [f=>{f.snapshot.report.generationKey=sha('corrected pair');f.snapshot.report.manifestSha256=sha('corrected manifest');
    f.snapshot.report.summary.generationKey=sha('corrected summary');f.pair.generationKey=f.snapshot.report.generationKey;f.pair.manifestSha256=f.snapshot.report.manifestSha256;},
  f=>{f.snapshot.recipient.verificationDigest=sha('corrected recipient');}]){
  const f=fixture();assert.equal((await f.handlers.afterPair(f.scope,f.pair)).status,'provider_accepted');change(f);
  assert.equal((await f.handlers.afterPair(f.scope,f.pair)).status,'held');assert.equal(f.sends,1);
 }
});


test('private view link expiring during reattestation is never returned',async()=>{
 let at=1800000000000,views=0;
 const summary={documentSha256:sha('summary')},result={summary,manifestSha256:sha('manifest')};
 const control={initial:async()=>{},prepareResend:async()=>{},confirmResend:async()=>{},async view(){
  if(++views===2)at+=2000;return result;}};
 const handlers=createReportDeliveryHandlers({control,readDealForScope:async()=>{},readSnapshot:async()=>{},systemActor:{},now:()=>at,
  readPrivateView:async()=>({url:'https://workdrive.zoho.com/file/synthetic',access:'authenticated_private',qualificationDigest:sha('qualified'),
    expiresAt:at+1000,manifestSha256:result.manifestSha256,documentSha256:summary.documentSha256})});
 await assert.rejects(handlers.handle({profile:PROFILE,action:'view',dealId:'deal'},{actor:{}}),{code:'REPORT_DELIVERY_HELD'});
});
test('private view resolver deadline cancels pending work without another byte read',async()=>{
 let views=0,release;const result={summary:{documentSha256:sha('PDF')},manifestSha256:sha('manifest')};
 const handlers=createReportDeliveryHandlers({control:{initial:async()=>{},prepareResend:async()=>{},confirmResend:async()=>{},async view(){views++;return result;}},
  readDealForScope:async()=>{},readSnapshot:async()=>{},systemActor:{},timeoutMs:10,
  readPrivateView:()=>new Promise(resolve=>{release=()=>resolve({url:'https://workdrive.zoho.com/file/synthetic',access:'authenticated_private',qualificationDigest:sha('qualified'),expiresAt:Date.now()+60000,...result,documentSha256:result.summary.documentSha256});})});
 await assert.rejects(handlers.handle({profile:PROFILE,action:'view',dealId:'deal'},{actor:{}}));release();await new Promise(resolve=>setTimeout(resolve,15));assert.equal(views,1);
});


test('terminal rejected initial send returns truthful failure and projects its exact operation once',async()=>{
 const projected=[];const f=fixture({reject:true,projectReport:async request=>{projected.push(request);return {status:'verified'};}});
 const result=await f.handlers.afterPair(f.scope,f.pair);assert.equal(result.status,'provider_rejected');assert.equal(f.sends,1);
 assert.equal(projected.length,2);assert.equal(projected[0].deliveryOperationKey,undefined);assert.match(projected[1].deliveryOperationKey,/^[a-f0-9]{64}$/);assert.equal(result.crmProjectionStatus,'verified');
 assert.equal([...f.rows.values()][0].state.phase,'provider_rejected');
});
