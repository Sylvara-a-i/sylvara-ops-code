'use strict';
require('./helpers/report-physical-network-fixture.js');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {installSocketFixture}=require('./helpers/report-physical-socket-fixture.js');
const {loadBootstrap}=require('./helpers/report-physical-bootstrap-fixture.js');
// Inherited seam/mutation regressions. Actual process must be v24.19.0 for positives.
// SDK class definitions are confined in VM mocks; the separate entrypoint suite loads the real SDK.
const root=path.resolve(__dirname,'..'),base=root;
const fromSdk=createRequire(path.join(base,'package.json'));
const sdk=path.dirname(fromSdk.resolve('zcatalyst-sdk-node/package.json'));
const sdkFixture=require('./helpers/report-physical-sdk-fixture.js');
const {CatalystApp}=sdkFixture.load('lib/catalyst-app.js');
const {CatalystCredential,RefreshTokenCredential}=sdkFixture.load('lib/utils/credential.js');
const key='a'.repeat(64),eventKey='report-storage:'+key;
const capability=Object.freeze({origin:'https://api.catalyst.zoho.com',controllerFunctionId:'123456786',tables:{eventReceipts:{id:'123456789'},reportRuns:{id:'123456788'}}});
const query={query:`SELECT * FROM ReportRuns WHERE IdempotencyKey = 'revenue-desk-report-v1:${key}' LIMIT 2`};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function app(){return new CatalystApp({projectId:'123456789',projectKey:'synthetic-project-key',environment:'Development',credential:new CatalystCredential({adminType:'token',adminToken:'synthetic-admin-token','x-zc-user-cred-type':'token','x-zc-user-cred-token':'synthetic-user-token','x-zc-user-type':'admin'})});}
function load({httpsObject=require('node:https'),onSdkImport,sourcePath=path.join(root,'lib/report-successor-physical.js'),version=process.version,initializeBootstrap=true,scope={projectId:'123456789',organizationId:'987654321',controllerFunctionId:'123456786'}}={}){
 const bootstrap=loadBootstrap(httpsObject);if(initializeBootstrap)bootstrap.initializeHttpsBootstrap();
 const mod={exports:{}};const r=id=>{
  if(id==='node:https')return httpsObject;
  if(id==='./report-https-bootstrap')return bootstrap;
  if(id==='./report-storage-capability')return {getIssuedCapabilityScope(c){assert.equal(c,capability);return scope;},validateReportInsert:()=>{}};
  const value=sdkFixture.requireSdk(id,fromSdk);if(path.isAbsolute(id)&&id.startsWith(sdk+path.sep))onSdkImport?.(id);return value;
 };
 r.resolve=fromSdk.resolve;r.cache=require.cache;
 const context=vm.createContext({require:r,module:mod,exports:mod.exports,Buffer,TextDecoder,AbortController,Promise,setTimeout,clearTimeout,
  process:{version,env:{X_ZOHO_CATALYST_ORG_ID:'987654321'}}});
 vm.runInContext(fs.readFileSync(sourcePath,'utf8'),context,{filename:'report-successor-physical.js'});
 return mod.exports.createSuccessorPhysicalTransport;
}
async function using(t,plans,opts={}){
 const f=installSocketFixture({plans});t.after(()=>f.restore());
 const a=opts.app||app();let admitted=true;
 const create=load();const io=create({app:a,capability,operationKey:key,assertActive:()=>{if(!admitted)throw Error('AUTHORITY_HELD');},timeoutMs:opts.timeoutMs||1000});
 t.after(async()=>{io.stop();for(let i=0;i<f.sockets.length;i++)f.releaseClose(i);await io.stopAndDrain();});
 return {f,io,a,hold:()=>{admitted=false;}};
}
test('real Node ClientRequest/parser returns rows only after request and response close',async t=>{
 const {f,io}=await using(t,[{statusCode:200,body:{data:[{ROWID:'123'}]},holdClose:true}]);
 let done=false;const p=io.send('/query',query,true).then(v=>{done=true;return v;});await wait(30);
 assert.equal(f.requests.length,1);assert.equal(done,false);assert.equal(io.snapshot().activePhysical,1);
 f.releaseClose(0);assert.deepEqual(JSON.parse(JSON.stringify(await p)),[{ROWID:'123'}]);assert.equal(io.snapshot().activePhysical,0);
 const facts=f.requests[0];assert.equal(facts.path,'/baas/v1/project/123456789/query');
 assert.equal(JSON.stringify(facts).includes('synthetic-user-token'),false);
});
test('two concurrent constructors overlap and retain both permits through close',async t=>{
 const {f,io}=await using(t,[{manual:true},{manual:true}]);
 const a=io.send('/query',query,true),b=io.send('/query',query,true);await wait(20);
 assert.equal(f.requests.length,2);assert.equal(io.snapshot().maxConcurrent,2);
 f.respond(1,{statusCode:200,body:{data:[]}});await b;f.respond(0,{statusCode:200,body:{data:[]}});await a;
 assert.equal(io.snapshot().quiescent,true);
});
test('third simultaneous admission is held before constructor and cancels both active requests',async t=>{
 const {f,io}=await using(t,[{manual:true},{manual:true}]);
 const a=io.send('/query',query,true),b=io.send('/query',query,true);a.catch(()=>{});b.catch(()=>{});await wait(15);
 await assert.rejects(io.send('/query',query,true));await Promise.allSettled([a,b]);
 assert.equal(f.requests.length,2);assert.equal(io.snapshot().maxConcurrent,2);assert.equal(io.snapshot().held,true);
});
test('13 total physical starts admit no fourteenth',async t=>{
 const {f,io}=await using(t,Array.from({length:13},()=>({statusCode:200,body:{data:[]}})));
 for(let i=0;i<13;i++)await io.send('/query',query,true);
 await assert.rejects(io.send('/query',query,true));assert.equal(f.requests.length,13);
});
test('five insert starts admit no sixth',async t=>{
 const {f,io}=await using(t,Array.from({length:5},()=>({statusCode:200,body:{data:[]}})));
 for(let i=0;i<5;i++)await io.send('/table/123456789/row',[{EVENT_KEY:eventKey}],false);
 await assert.rejects(io.send('/table/123456789/row',[{EVENT_KEY:eventKey}],false));assert.equal(f.requests.length,5);
});
test('fully settled exact duplicate is the only non-success that permits next read',async t=>{
 const {f,io}=await using(t,[{statusCode:409,body:{data:{error_code:'DUPLICATE_VALUE'}}},{statusCode:200,body:{data:[]}}]);const trace=[];
 await assert.rejects(io.send('/table/123456789/row',[{EVENT_KEY:eventKey}],false,{trace:e=>trace.push(e)}));
 assert.equal(io.snapshot().held,false);assert.equal(trace.find(e=>e.event==='outcome').duplicate,true);
 await io.send('/query',query,true);assert.equal(f.requests.length,2);
});
for(const [name,plan] of [
 ['redirect',{statusCode:302,headers:{Location:'https://other.invalid/'},body:{data:[]}}],
 ['500',{statusCode:500,body:{data:[]}}],
 ['409 wrong provider code',{statusCode:409,body:{data:{error_code:'OTHER'}}}],
 ['invalid JSON',{statusCode:200,body:'{'}],
 ['invalid envelope',{statusCode:200,body:{data:{}}}],
 ['oversized body',{statusCode:200,body:'x'.repeat(65537)}],
 ['connection reset',{reset:'ECONNRESET'}]
])test(name+' holds without retry or later read',async t=>{
 const {f,io}=await using(t,[plan]);await assert.rejects(io.send('/query',query,true));
 await assert.rejects(io.send('/query',query,true));assert.equal(f.requests.length,1);assert.equal(io.snapshot().held,true);
});
test('throw inside installed response callback is contained and all streams close',async t=>{
 const {f,io}=await using(t,[{statusCode:200,body:{data:[]}}]);
 await assert.rejects(io.send('/query',query,true,{trace:e=>{if(e.event==='response')throw Error('SYNTHETIC_CALLBACK');}}));
 assert.equal(io.snapshot().held,true);assert.equal(io.snapshot().quiescent,true);assert.equal(f.requests.length,1);
});
test('throw after actual constructor dispatch is contained before body admission',async t=>{
 const {f,io}=await using(t,[{manual:true}]);await assert.rejects(io.send('/query',query,true,{trace:()=>{throw Error('SYNTHETIC_TRACE');}}));
 assert.equal(io.snapshot().physicalStarts,1);assert.equal(io.snapshot().quiescent,true);assert.ok(f.requests.length<=1);
});
test('authority expires in response callback: no next dispatch',async t=>{
 const {f,io,hold}=await using(t,[{manual:true}]);const p=io.send('/query',query,true);p.catch(()=>{});await wait(10);hold();
 f.respond(0,{statusCode:200,body:{data:[]}});await assert.rejects(p);await assert.rejects(io.send('/query',query,true));assert.equal(f.requests.length,1);
});
test('timeout after possible commit destroys request and forbids readback retry',async t=>{
 const {f,io}=await using(t,[{manual:true}],{timeoutMs:30});const p=io.send('/table/123456789/row',[{EVENT_KEY:eventKey}],false);p.catch(()=>{});
 await wait(60);await assert.rejects(p);assert.equal(f.requests.length,1);assert.equal(io.snapshot().held,true);
 await assert.rejects(io.send('/query',query,true));assert.equal(f.requests.length,1);
});
test('already aborted signal performs zero constructors',async t=>{
 const {f,io}=await using(t,[]);const c=new AbortController();c.abort();await assert.rejects(io.send('/query',query,true,{signal:c.signal}));assert.equal(io.snapshot().physicalStarts,0);assert.equal(f.requests.length,0);
});
test('synchronous guard expiry before constructor performs zero physical starts',async t=>{
 const {f,io,hold}=await using(t,[]);hold();await assert.rejects(io.send('/query',query,true));assert.equal(f.requests.length,0);assert.equal(io.snapshot().physicalStarts,0);
});
test('guard work that crosses deadline cannot construct afterward',async t=>{
 const {f,io}=await using(t,[],{timeoutMs:20});
 await assert.rejects(io.send('/query',query,true,{budget:{assertActive(){const end=performance.now()+30;while(performance.now()<end){}}}}));
 assert.equal(f.requests.length,0);assert.equal(io.snapshot().physicalStarts,0);
});
test('delayed SDK existing-token promise is suppressed after timeout with no late constructor',async t=>{
 const {f,io}=await using(t,[],{timeoutMs:20});
 const original=Promise.resolve;let release;const delayed=new Promise(r=>{release=r;});
 Promise.resolve=function(value){if(value&&typeof value==='object'&&Object.hasOwn(value,'access_token'))return delayed;return original.call(Promise,value);};
 let p;try{p=io.send('/query',query,true);}finally{Promise.resolve=original;}
 p.catch(()=>{});await wait(40);await assert.rejects(p);assert.equal(io.snapshot().authPending,1);
 release({access_token:'placeholder'});await wait(10);
 assert.equal(io.snapshot().authPending,0);assert.equal(f.requests.length,0);assert.equal(io.snapshot().physicalStarts,0);
});
test('invalid UTF8 from real response parser is held',async t=>{
 const {f,io}=await using(t,[{statusCode:200,body:Buffer.from([0xc3,0x28])}]);await assert.rejects(io.send('/query',query,true));
 assert.equal(io.snapshot().held,true);assert.equal(f.requests.length,1);
});
test('partial response reset cannot authorize an exact-slot readback',async t=>{
 const {f,io}=await using(t,[{manual:true}]);const p=io.send('/table/123456789/row',[{EVENT_KEY:eventKey}],false);p.catch(()=>{});await wait(10);
 f.respond(0,{statusCode:200,body:'{"data":[]}',headersOnly:true});await wait(5);f.reset(0);
 await assert.rejects(p);await assert.rejects(io.send('/query',query,true));assert.equal(f.requests.length,1);
});
test('changed managed config cannot redirect environment/header authority after construction',async t=>{
 const {f,io,a}=await using(t,[]);a.config.environment='Production';await assert.rejects(io.send('/query',query,true));assert.equal(f.requests.length,0);
});
test('known loaded third party APM fails before authentication or request',()=>{
 const marker=path.join(root,'node_modules','apminsight','index.js');require.cache[marker]={exports:{}};
 try{assert.throws(()=>load()({app:app(),capability,operationKey:key,assertActive:()=>{}}));}finally{delete require.cache[marker];}
});
test('pre-import SDK authentication replacement is rejected by pinned method source',()=>{
 const proto=Object.getPrototypeOf(CatalystApp.prototype),original=proto.authenticateRequest;let called=false;
 proto.authenticateRequest=function(){called=true;};
 try{assert.throws(()=>load()({app:app(),capability,operationKey:key,assertActive:()=>{}}));assert.equal(called,false);}finally{proto.authenticateRequest=original;}
});
test('one failed branch holds a concurrent branch and joins both physical closures',async t=>{
 const {f,io}=await using(t,[{manual:true},{manual:true,holdClose:true}]);
 const a=io.send('/query',query,true),b=io.send('/query',query,true);a.catch(()=>{});b.catch(()=>{});await wait(10);
 f.reset(0);await assert.rejects(a);assert.equal(io.snapshot().activePhysical,1);
 await assert.rejects(io.send('/query',query,true));assert.equal(f.requests.length,2);
 f.releaseClose(1);await Promise.allSettled([a,b]);assert.equal(io.snapshot().quiescent,true);
});
test('unknown close retains permit and bounded drain reports unconfirmed',async t=>{
 const {f,io}=await using(t,[{manual:true,holdClose:true}],{timeoutMs:20});const p=io.send('/query',query,true);p.catch(()=>{});await wait(50);
 assert.equal(io.snapshot().activePhysical,1);const s=await io.stopAndDrain();assert.equal(s.quiescent,false);assert.equal(s.activePhysical,1);
 await assert.rejects(io.send('/query',query,true));f.releaseClose(0);await assert.rejects(p);assert.equal(io.snapshot().quiescent,true);
});
for(const [name,mutate] of [
 ['proxy app',a=>new Proxy(a,{})],
 ['own auth override',a=>{a.authenticateRequest=async()=>{};return a;}],
 ['credential getter',a=>{Object.defineProperty(a,'credential',{get(){throw Error('MUST_NOT_RUN');}});return a;}],
 ['wrong principal',a=>{a.credential.userType='user';return a;}],
 ['strict scope',a=>{a.credential.strictScope=true;return a;}],
 ['refresh credential',a=>{a.credential=new RefreshTokenCredential({client_id:'synthetic',client_secret:'placeholder',refresh_token:'placeholder'});return a;}],
 ['token accessor',a=>{Object.defineProperty(a.credential.userCred,'accessToken',{get(){throw Error('MUST_NOT_RUN');}});return a;}],
 ['wrong project',a=>{a.config.projectId='111111111';return a;}]
])test(name+' is denied without constructor/auth outbound',()=>{
 const create=load();assert.throws(()=>create({app:mutate(app()),capability,operationKey:key,assertActive:()=>{}}));
});
for(const [name,endpoint,body,queryFlag] of [
 ['other table','/table/999999/row',[{EVENT_KEY:eventKey}],false],
 ['third version','/query',{query:`SELECT * FROM ReportRuns WHERE IdempotencyKey = 'revenue-desk-report-v2:${key}:0000000003' LIMIT 2`},true],
 ['SQL suffix','/query',{query:query.query+'; SELECT * FROM Customers'},true],
 ['foreign key','/query',{query:query.query.replace(key,'b'.repeat(64))},true]
])test(name+' is denied before real constructor',async t=>{
 const {f,io}=await using(t,[]);await assert.rejects(io.send(endpoint,body,queryFlag));assert.equal(f.requests.length,0);
});

const heldError=e=>e?.code==='REPORT_RUN_RECONCILIATION_REQUIRED'
 &&e.message==='REPORT_RUN_RECONCILIATION_REQUIRED'&&e.ambiguous===true;
const nativeHttps=require('node:https'),nativeRequest=nativeHttps.request;
const sourceHash=fn=>require('node:crypto').createHash('sha256').update(Function.prototype.toString.call(fn).replace(/\r\n/g,'\n')).digest('hex');
test('positive regression runtime is actual supported Node24.19',()=>assert.equal(process.version,'v24.19.0'));

test('replacement introduced during SDK import prevents physical module loading before admission or dispatch',async t=>{
 const fixture=installSocketFixture();t.after(()=>fixture.restore());
 let imports=0,replacementCalls=0;const object={request:nativeRequest};
 assert.throws(()=>load({httpsObject:object,onSdkImport(){imports++;object.request=function replacement(){replacementCalls++;throw Error('MUST_NOT_RUN');};}}),heldError);
 assert.ok(imports>0);
 assert.equal(replacementCalls,0);assert.equal(fixture.requests.length,0);
});
for(const mode of ['accessor','missing','nonfunction','proxy','ordinary_replacement'])test('post-capture '+mode+' request rejects with zero physical starts and no getters or calls',async t=>{
 const fixture=installSocketFixture();t.after(()=>fixture.restore());let invoked=0;
 const object={request:nativeRequest},io=load({httpsObject:object})({app:app(),capability,operationKey:key,assertActive:()=>{}});
 if(mode==='accessor')Object.defineProperty(object,'request',{get(){invoked++;throw Error('PRIVATE_GETTER');}});
 if(mode==='missing')delete object.request;
 if(mode==='nonfunction')object.request=null;
 if(mode==='proxy')object.request=new Proxy(function(){invoked++;},{apply(){invoked++;throw Error('PRIVATE_PROXY');}});
 if(mode==='ordinary_replacement')object.request=function replacement(){invoked++;};
 await assert.rejects(io.send('/query',query,true),heldError);assert.equal(invoked,0);
 assert.equal(io.snapshot().physicalStarts,0);assert.equal(fixture.requests.length,0);await io.stopAndDrain();
});
test('fixed destination, TLS verification, servername and fresh agent reject caller option injection',async t=>{
 const fixture=installSocketFixture({plans:[{body:{data:[]}}]});t.after(()=>fixture.restore());
 let optionsSeen,privateGetterCalls=0;
 const capture=function capture(options,callback){optionsSeen=options;return nativeRequest(options,callback);};
 const injected={},createOptions={app:app(),capability,operationKey:key,assertActive:()=>{}};
 for(const name of ['hostname','host','port','path','protocol','method','headers','agent','servername','rejectUnauthorized','createConnection','lookup','checkServerIdentity','ca','cert','key','auth'])
  for(const object of [injected,createOptions])Object.defineProperty(object,name,{enumerable:true,get(){privateGetterCalls++;throw Error('CALLER_OPTION_MUST_NOT_BE_READ');}});
 const io=load({httpsObject:{request:capture}})(createOptions);
 try{
  await io.send('/query',query,true,injected);
  assert.equal(optionsSeen.protocol,'https:');assert.equal(optionsSeen.hostname,'api.catalyst.zoho.com');assert.equal(optionsSeen.port,443);
  assert.equal(optionsSeen.method,'POST');assert.equal(optionsSeen.path,'/baas/v1/project/123456789/query');
  assert.equal(optionsSeen.agent,false);assert.equal(optionsSeen.rejectUnauthorized,true);assert.equal(optionsSeen.servername,'api.catalyst.zoho.com');
  for(const name of ['createConnection','lookup','checkServerIdentity','ca','cert','key','auth'])assert.equal(Object.hasOwn(optionsSeen,name),false);
  assert.equal(fixture.requests[0].options.rejectUnauthorized,true);assert.equal(fixture.requests[0].options.servername,'api.catalyst.zoho.com');
  assert.equal(privateGetterCalls,0);assert.equal(fixture.requests.length,1);
 }finally{await io.stopAndDrain();}
});
test('explicit lost coverage: ordinary wrapper installed before capture is admitted under trusted-bootstrap assumption',async t=>{
 const fixture=installSocketFixture({plans:[{body:{data:[]}}]});t.after(()=>fixture.restore());let calls=0;
 const wrapper=function beforeCaptureWrapper(...args){calls++;return nativeRequest(...args);};
 assert.notEqual(sourceHash(wrapper),sourceHash(nativeRequest));
 const io=load({httpsObject:{request:wrapper}})({app:app(),capability,operationKey:key,assertActive:()=>{}});
 try{await io.send('/query',query,true);assert.equal(calls,1);assert.equal(fixture.requests.length,1);}
 finally{await io.stopAndDrain();}
});
test('retained SDK fixture never reads credential files or constructs an HTTP refresh client',()=>{
 assert.deepEqual(sdkFixture.snapshot(),{credentialFileReads:0,httpClientConstructions:0,unexpectedImports:0});
});

test('physical import without entrypoint bootstrap is held and never lazily captures',()=>{
 let imports=0;assert.throws(()=>load({initializeBootstrap:false,onSdkImport(){imports++;}}),heldError);assert.equal(imports,0);
});
for(const version of ['v24.12.0','v24.18.0','v24.19.1','v24.20.0','v25.0.0','v24.19.0\n'])test('unsupported exact runtime '+JSON.stringify(version)+' rejects before dispatch',async t=>{
 const fixture=installSocketFixture();t.after(()=>fixture.restore());
 assert.throws(()=>load({version})({app:app(),capability,operationKey:key,assertActive:()=>{}}),heldError);assert.equal(fixture.requests.length,0);
});
test('request identity changed during asynchronous SDK token authentication is held before constructor',async t=>{
 const fixture=installSocketFixture();t.after(()=>fixture.restore());let replacementCalls=0;
 const object={request:nativeRequest},io=load({httpsObject:object})({app:app(),capability,operationKey:key,assertActive:()=>{}});
 const original=Promise.resolve;
 Promise.resolve=function(value){if(value&&typeof value==='object'&&Object.hasOwn(value,'access_token'))object.request=function replacement(){replacementCalls++;};return original.call(Promise,value);};
 let result;try{result=io.send('/query',query,true);}finally{Promise.resolve=original;}
 await assert.rejects(result,heldError);assert.equal(replacementCalls,0);assert.equal(fixture.requests.length,0);assert.equal(io.snapshot().physicalStarts,0);await io.stopAndDrain();
});
test('request replacement inside final admission budget callback is rejected before counters or constructor',async t=>{
 const fixture=installSocketFixture();t.after(()=>fixture.restore());let budgetCalls=0,replacementCalls=0;
 const object={request:nativeRequest},io=load({httpsObject:object})({app:app(),capability,operationKey:key,assertActive:()=>{}});
 await assert.rejects(io.send('/query',query,true,{budget:{assertActive(){if(++budgetCalls===3)object.request=function replacement(){replacementCalls++;};}}}),heldError);
 assert.equal(budgetCalls,3);assert.equal(replacementCalls,0);assert.equal(io.snapshot().physicalStarts,0);assert.equal(fixture.requests.length,0);await io.stopAndDrain();
});

for(const [name,scope]of [
 ['missing project',{organizationId:'987654321',controllerFunctionId:'123456786'}],
 ['missing organization',{projectId:'123456789',controllerFunctionId:'123456786'}],
 ['missing function',{projectId:'123456789',organizationId:'987654321'}],
 ['wrong project',{projectId:'111111111',organizationId:'987654321',controllerFunctionId:'123456786'}],
 ['wrong organization',{projectId:'123456789',organizationId:'111111111',controllerFunctionId:'123456786'}],
 ['wrong function',{projectId:'123456789',organizationId:'987654321',controllerFunctionId:'111111111'}]
])test('issued scope '+name+' rejects before credential inspection or constructor',async t=>{
 const f=installSocketFixture();t.after(()=>f.restore());const a=app();let credentialReads=0;
 Object.defineProperty(a,'credential',{get(){credentialReads++;throw Error('SYNTHETIC_CREDENTIAL_TRIPWIRE');}});
 assert.throws(()=>load({scope})({app:a,capability,operationKey:key,assertActive:()=>{}}),heldError);
 assert.equal(credentialReads,0);assert.equal(f.requests.length,0);
});
test('physical SQL guard accepts only the exact asterisk successor head query',async t=>{
 const good="SELECT * FROM ReportRuns WHERE IdempotencyKey LIKE 'revenue-desk-report-v2:"+key+":*' ORDER BY RD_REPORT_VERSION DESC LIMIT 2";
 for(const bad of [good.replace(':*',':%'),good.replace(':*',':?'),good.replace('LIMIT 2','LIMIT 5'),good+' OR 1=1']){
  const {f,io}=await using(t,[]);await assert.rejects(io.send('/query',{query:bad},true),heldError);assert.equal(f.requests.length,0);await f.restore();
 }
 const {f,io}=await using(t,[{statusCode:200,body:{data:[]}}]);await io.send('/query',{query:good},true);assert.equal(f.requests.length,1);
});
