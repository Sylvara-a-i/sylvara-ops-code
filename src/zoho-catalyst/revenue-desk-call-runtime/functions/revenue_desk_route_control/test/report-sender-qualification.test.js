'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createProtectedSenderQualification}=require('../lib/report-sender-qualification');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 let at=1800000000000;const reads=[],calls=[];
 const binding={schemaVersion:1,enabled:true,environment:'development',sourceRevision:'a'.repeat(40),projectId:'123456789',controlHost:'synthetic.invalid',connectionReference:'synthetic_crm_sender',fromAddress:'reports@example.invalid',fromName:'Synthetic',verifiedAt:at-1,expiresAt:at+60000,timeoutMs:1000,costQualificationDigest:'b'.repeat(64)};
 const config={environment:'development',sourceRevision:binding.sourceRevision,controlHost:binding.controlHost,expectedProjectIdSha256:sha(binding.projectId),operatorIdHash:'operator_'+sha('synthetic')};
 const app={config:{environment:'Development',projectId:binding.projectId},connections:()=>({async getConnectionCredentials(link){reads.push(link);return {parameters:{},headers:{Authorization:'Zoho-oauthtoken '+'s'.repeat(24)}};}})};
 let data={from_addresses:[{email:'unrelated@example.invalid',user_name:'Do not return',type:'primary'},{email:binding.fromAddress,user_name:binding.fromName,type:'org_email',id:'123456780'}]};
 const options={now:()=>at,fetchImpl:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});}};
 const make=()=>{const raw=JSON.stringify(binding);return createProtectedSenderQualification({...options,environment:{DEPLOYMENT_ENVIRONMENT:'development',SOURCE_REVISION:binding.sourceRevision,REPORT_SENDER_QUALIFICATION_JSON:raw,REPORT_SENDER_QUALIFICATION_SHA256:sha(raw)}})(app,config);};
 const command={profile:'report_sender_qualification_v1',action:'qualify_sender'},actor={kind:'internal_controller',identity:config.operatorIdHash};
 return {binding,config,app,options,make,command,actor,reads,calls,get data(){return data;},set data(x){data=x;},advance:n=>at+=n};
}
test('fixed read uses managed link once, sanitizes selected organization sender and grants no delivery authority',async()=>{
 const f=fixture(),result=await f.make().handle(f.command,{actor:f.actor});assert.deepEqual(f.reads,['synthetic_crm_sender']);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].url,'https://www.zohoapis.com/crm/v8/settings/emails/actions/from_addresses');assert.equal(f.calls[0].init.method,'GET');assert.equal(f.calls[0].init.redirect,'error');assert.equal(f.calls[0].init.body,undefined);
 assert.deepEqual(result.sender,{address:'reports@example.invalid',displayName:'Synthetic',type:'org_email'});assert.equal(result.deliveryAuthority,false);assert.match(result.qualificationDigest,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(result).includes('unrelated'));assert.ok(!JSON.stringify(result).includes('Zoho-oauthtoken'));assert.ok(!JSON.stringify(result).includes('123456780'));
});
test('disabled/missing/partial or mismatched identity/cost binding never accesses credentials or network',()=>{
 const f=fixture();assert.throws(()=>createProtectedSenderQualification({environment:{}})(f.app,f.config));
 for(const mutate of [f=>f.binding.enabled=false,f=>delete f.binding.costQualificationDigest,f=>f.binding.costQualificationDigest='unknown',f=>f.binding.projectId='987654321',f=>f.app.config.environment='Production',f=>f.binding.controlHost='other.invalid',f=>f.binding.sourceRevision='c'.repeat(40),f=>f.binding.expiresAt=f.binding.verifiedAt+900001]){
  const x=fixture();mutate(x);assert.throws(()=>x.make());assert.equal(x.reads.length,0);assert.equal(x.calls.length,0);}
});
test('only exact command and authenticated controller actor admit the read',async()=>{
 for(const extra of [{url:'https://other.invalid'},{recordId:'1234'},{sender:'other@example.invalid'},{actor:{kind:'internal_controller'}}]){
  const f=fixture();await assert.rejects(f.make().handle({...f.command,...extra},{actor:f.actor}));assert.equal(f.reads.length,0);}
 const f=fixture();for(const actor of [null,{kind:'terminal_worker',identity:f.actor.identity},{kind:'internal_controller',identity:'other'}])await assert.rejects(f.make().handle(f.command,{actor}));assert.equal(f.reads.length,0);
});
test('wrong/missing/duplicate sender, malformed or excessive response fails generically without retry',async()=>{
 for(const mode of ['missing','duplicate','primary','name','id','oversize','error']){
  const f=fixture();if(mode==='missing')f.data.from_addresses=[];if(mode==='duplicate')f.data.from_addresses.push(f.data.from_addresses[1]);
  if(mode==='primary')f.data.from_addresses[1].type='primary';if(mode==='name')f.data.from_addresses[1].user_name='Other';if(mode==='id')f.data.from_addresses[1].id=null;
  if(mode==='oversize')f.data.extra='x'.repeat(65537);if(mode==='error')f.options.fetchImpl=async()=>{f.calls.push({});throw Error('private response contains secret');};
  await assert.rejects(f.make().handle(f.command,{actor:f.actor}),e=>e.message==='REPORT_SENDER_QUALIFICATION_HELD'&&!e.cause);assert.equal(f.calls.length,1);}
});
test('deadline aborts the GET; late credentials cannot cause a later request',async()=>{
 for(const phase of ['credentials','get']){
  const f=fixture();f.binding.timeoutMs=20;let release,signal;
  if(phase==='credentials')f.app.connections=()=>({getConnectionCredentials:()=>new Promise(resolve=>{release=resolve;})});
  else f.options.fetchImpl=async(url,init)=>{signal=init.signal;f.calls.push({url,init});return new Promise(()=>{});};
  await assert.rejects(f.make().handle(f.command,{actor:f.actor}));
  if(phase==='credentials'){release({parameters:{},headers:{Authorization:'Zoho-oauthtoken '+'s'.repeat(24)}});await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.calls.length,0);}
  else{assert.equal(signal.aborted,true);assert.equal(f.calls.length,1);}
 }
});
test('aborted input, warm expiry and elapsed clock hold before or after dispatch',async()=>{
 const f=fixture(),handler=f.make(),controller=new AbortController();controller.abort();await assert.rejects(handler.handle(f.command,{actor:f.actor,signal:controller.signal}));assert.equal(f.reads.length,0);
 f.advance(60000);await assert.rejects(handler.handle(f.command,{actor:f.actor}));assert.equal(f.reads.length,0);
 const late=fixture();late.options.fetchImpl=async()=>{late.calls.push({});late.advance(1000);return new Response('{}');};await assert.rejects(late.make().handle(late.command,{actor:late.actor}));assert.equal(late.calls.length,1);
});
