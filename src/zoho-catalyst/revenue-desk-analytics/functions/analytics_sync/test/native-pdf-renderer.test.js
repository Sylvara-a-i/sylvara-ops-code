'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { createNativePdfRenderer, createManagedPdfRenderer, preparePdfPayload, VERSION,
  MAX_HTML_BYTES, MAX_PDF_BYTES } = require('../lib/native-pdf-renderer');
const { FONT_MANIFEST, LICENSE, fontBytes } = require('../lib/pdf-fonts');
const { prepareFreeTestDocument } = require('../../../tools/prepare-free-test-draft');
const { privateCallLedgerFixture } = require('./helpers/private-call-ledger-fixture');
const { createReconciledReportFixture } = require('./helpers/reconciled-report-fixture');
const { createWorkDriveDraftFixture } = require('./helpers/workdrive-draft-fixture');
const { createDurableReportComposition } = require('../../../tools/create-durable-report-composition');
test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });
const fakeAuthorization = 'Zoho-oauthtoken synthetic_offline_only_000000000000';
const binding = { apiOrigin: 'https://api.catalyst.zoho.com', projectId: '123456',
  organizationId: '987654', environment: 'Development', connectionReference: 'syntheticPdfRenderer',
  timeoutMs: 1000, version: VERSION, qualificationDigest: 'a'.repeat(64) };
const pdf = Buffer.from('%PDF-1.7\n% synthetic envelope only\n%%EOF\n');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const deferred = () => { let resolve; let reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
let input;
test.before(async () => {
  const f = await privateCallLedgerFixture([{}, {}, {}]);
  input = { html: prepareFreeTestDocument(f.input, { now: f.now, synthetic: true,
    callDetails: f.snapshot }).document, revisionAt: Date.parse(f.input.finalResult.SOURCE_MODIFIED_AT) };
});
function response(bytes = pdf, headers = {}) {
  return new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf',
    'content-length': String(bytes.length), ...headers } });
}
function harness(options = {}) {
  const calls = [];
  let authReads = 0;
  const renderer = createNativePdfRenderer({ binding: { ...binding, ...options.binding },
    async authorizationProvider(context) { authReads++; return options.auth ? options.auth(context) : fakeAuthorization; },
    fetchImpl: async (...args) => { calls.push(args); return options.fetch ? options.fetch(...args) : response(); },
    ...(options.now ? {now: options.now} : {}) });
  return {renderer,calls,get authReads() { return authReads; }};
}
test('single native POST fixes US project/org/Development, disables redirects/scripts and preserves exact PDF bytes', async () => {
  const h = harness();
  assert.deepEqual(await h.renderer.render(input), pdf);
  assert.equal(h.calls.length,1);
  assert.equal(h.authReads,1);
  const [url, request] = h.calls[0];
  assert.equal(url, 'https://api.catalyst.zoho.com/browser360/v1/project/123456/convert');
  assert.equal(request.method,'POST'); assert.equal(request.redirect,'error');
  assert.equal(request.headers.Environment,'Development'); assert.equal(request.headers['CATALYST-ORG'],'987654');
  assert.equal(request.headers.Authorization,fakeAuthorization);
  const payload=JSON.parse(request.body);
  assert.equal(payload.page_options.javascript_enabled,false);
  assert.equal(payload.output_options.output_type,'pdf');
  assert.equal(payload.output_options.prefer_css_pageSize,true);
  assert.equal(Object.hasOwn(payload,'url'),false);
  assert.match(payload.html,/font-src data:/);
  assert.match(payload.html,/@font-face/);
  assert.doesNotMatch(payload.html,/-apple-system|BlinkMacSystemFont/);
  assert.match(payload.html,/font-feature-settings: "calt" 0, "liga" 0/);
});
test('packaged static Inter font signatures/hashes/license are exact and modules need no third-party renderer', () => {
  assert.match(LICENSE,/SIL OPEN FONT LICENSE Version 1.1/);
  for (const entry of FONT_MANIFEST) {
    const bytes=fontBytes(entry.weight);
    assert.equal(bytes.subarray(0,4).toString(),'wOF2');
    assert.equal(bytes.length,entry.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  }
  assert.equal(FONT_MANIFEST.length,2);
  const text=fs.readFileSync(path.join(__dirname,'../lib/native-pdf-renderer.js'),'utf8');
  assert.doesNotMatch(text,/require\(['"](?:pdf-lib|puppeteer|playwright)/);
});
test('native payload preflight counts complete inline-font HTML and JSON, preserving every source call', () => {
  const payload=JSON.parse(preparePdfPayload(input.html));
  assert.ok(Buffer.byteLength(payload.html)<=MAX_HTML_BYTES);
  assert.equal((payload.html.match(/<section class="call-detail">/g) || []).length, 3);
  assert.match(payload.html,/font-weight: 400/); assert.match(payload.html,/font-weight: 700/);
});
test('binding rejects foreign DC, Production, extra fields or wrong revision before authorization', () => {
  for(const patch of [{apiOrigin:'https://api.catalyst.zoho.eu'}, {environment:'Production'},
    {extra:true}, {version:'unqualified'}, {qualificationDigest:'0'.repeat(64)}, {timeoutMs:30001}]) {
    assert.throws(()=>harness({binding:patch}),{code:'PDF_RENDER_CONFIGURATION_INVALID'});
  }
});
test('invalid UTF8, remote resources, scripts, duplicate CSP and oversized post-font payload never read auth', async () => {
  const variants=[Buffer.from([0xff]),Buffer.alloc(MAX_HTML_BYTES+1),
    Buffer.from(input.html.toString().replace('</head>','<script>alert(1)</script></head>')),
    Buffer.from(input.html.toString().replace('</head>','<link href="https://invalid.test/font"></head>')),
    Buffer.from(input.html.toString().replace('</style>','body{background:url(https://invalid.test/a)}</style>')),
    Buffer.from(input.html.toString().replace('</head>',`</head>${'x'.repeat(MAX_HTML_BYTES-1000)}`))];
  for(const html of variants) {
    const h=harness(); await assert.rejects(h.renderer.render({...input,html}),{code:'PDF_RENDER_INPUT_INVALID'});
    assert.equal(h.authReads,0); assert.equal(h.calls.length,0);
  }
});
test('already aborted request makes zero credential reads and zero dispatches',async()=>{
  const c=new AbortController();c.abort(); const h=harness();
  await assert.rejects(h.renderer.render({...input,signal:c.signal}),{code:'PDF_RENDER_ABORTED',ambiguous:false,retryable:false});
  assert.equal(h.authReads,0);assert.equal(h.calls.length,0);
});
test('deadline covers stalled auth; late resolution cannot dispatch',async()=>{
  const d=deferred(); const h=harness({binding:{timeoutMs:15},auth:()=>d.promise});
  await assert.rejects(h.renderer.render(input),{code:'PDF_RENDER_TIMEOUT',ambiguous:false,retryable:false});
  d.resolve(fakeAuthorization);await wait(10);assert.equal(h.calls.length,0);
});
test('external abort during auth rejects promptly and blocks late auth',async()=>{
  const d=deferred(),entered=deferred(), c=new AbortController();
  const h=harness({auth:()=>{entered.resolve();return d.promise;}});
  const result=h.renderer.render({...input,signal:c.signal});await entered.promise;c.abort();
  await assert.rejects(result,{code:'PDF_RENDER_ABORTED',ambiguous:false});
  d.resolve(fakeAuthorization);await wait(5);assert.equal(h.calls.length,0);
});
test('native network error cannot retry or expose provider/header diagnostics',async()=>{
  const h=harness({fetch:()=>{throw new Error(`private provider ${fakeAuthorization}`);}});
  await assert.rejects(h.renderer.render(input), e=>{
    assert.equal(e.code,'PDF_RENDER_OUTCOME_UNKNOWN');assert.equal(e.ambiguous,true);assert.equal(e.retryable,false);
    assert.equal(e.cause,undefined);assert.doesNotMatch(e.stack,/synthetic_offline_only|private provider/);return true;
  });assert.equal(h.calls.length,1);
});
test('deadline aborts the actual native signal while headers stall; late response cannot succeed',async()=>{
  const d=deferred();const h=harness({binding:{timeoutMs:15},fetch:()=>d.promise});
  await assert.rejects(h.renderer.render(input),{code:'PDF_RENDER_TIMEOUT',ambiguous:true});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].signal.aborted,true);
  d.resolve(response());await wait(5);assert.equal(h.calls.length,1);
});
test('external abort while body read stalls cancels stream and retains unknown dispatch',async()=>{
  const d=deferred(),entered=deferred(),c=new AbortController();let cancelled=0;
  const h=harness({fetch:()=>({status:200,headers:new Headers({'content-type':'application/pdf'}),
    body:{getReader:()=>({read(){entered.resolve();return d.promise;},cancel(){cancelled++;}})}})});
  const result=h.renderer.render({...input,signal:c.signal});await entered.promise;c.abort();
  await assert.rejects(result,{code:'PDF_RENDER_ABORTED',ambiguous:true});
  assert.ok(cancelled>0);assert.equal(h.calls[0][1].signal.aborted,true);
  d.resolve({done:false,value:pdf});await wait(5);assert.equal(h.calls.length,1);
});
test('deadline covers stalled PDF response body even when fake reader ignores abort',async()=>{
  const h=harness({binding:{timeoutMs:15},fetch:()=>({status:200,headers:new Headers({'content-type':'application/pdf'}),
    body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel(){}})}})});
  await assert.rejects(h.renderer.render(input),{code:'PDF_RENDER_TIMEOUT',ambiguous:true});assert.equal(h.calls.length,1);
});
test('body bounds count actual chunks without trusting Content-Length',async()=>{
  for(const headers of [{},{'content-length':'8'}]){
    const h=harness({fetch:()=>response(Buffer.alloc(MAX_PDF_BYTES+1),headers)});
    await assert.rejects(h.renderer.render(input),{code:'PDF_RENDER_OUTPUT_INVALID',ambiguous:true});assert.equal(h.calls.length,1);
  }
});
test('empty or excessive tiny chunks cannot evade bounded response memory',async()=>{
  for(const size of [0,1]){
    let reads=0;
    const h=harness({fetch:()=>({status:200,headers:new Headers({'content-type':'application/pdf'}),
      body:{getReader:()=>({read:async()=>{reads++;return{done:false,value:new Uint8Array(size)};},cancel(){}})}})});
    await assert.rejects(h.renderer.render(input),{code:'PDF_RENDER_OUTPUT_INVALID',ambiguous:true});
    assert.ok(reads<=4097);assert.equal(h.calls.length,1);
  }
});
test('ordinary escaped call text containing resource-like words is retained without enabling resources',()=>{
  const source=input.html.toString().replace('</body>', '<p>Caller said url(example) and href=example in the issue summary.</p></body>');
  const payload=JSON.parse(preparePdfPayload(Buffer.from(source)));
  assert.ok(payload.html.includes('Caller said url(example) and href=example'));
});
test('truncated body, bad type, encoding, HTML response and missing reader remain unknown with no retry',async()=>{
  for(const fetch of [()=>response(pdf,{'content-length':'999'}),()=>response(pdf,{'content-type':'text/html'}),
    ()=>response(pdf,{'content-encoding':'gzip'}),()=>response(Buffer.from('<html>not a PDF</html>')),
    ()=>({status:200,headers:new Headers({'content-type':'application/pdf'}),body:null})]){
    const h=harness({fetch});await assert.rejects(h.renderer.render(input),{code:'PDF_RENDER_OUTPUT_INVALID',ambiguous:true});assert.equal(h.calls.length,1);
  }
});
test('HTTP rejection and redirect are not acceptance and cannot retry',async()=>{
  for(const status of [302,401,429,500]){
    const h=harness({fetch:()=>new Response('private response',{status})});
    await assert.rejects(h.renderer.render(input),{code:'PDF_RENDER_HTTP_REJECTED',ambiguous:true});assert.equal(h.calls.length,1);
  }
});
test('managed runtime construction reads metadata only; fake header requested only during render',async()=>{
  let reads=0;
  const app={config:{projectId:binding.projectId,environment:'Development'},connections(){return{
    async getConnectionCredentials(link){reads++;assert.equal(link,binding.connectionReference);
      return{headers:{Authorization:fakeAuthorization},parameters:{}};}};}};
  const renderer=createManagedPdfRenderer({app,binding,fetchImpl:async()=>response()});assert.equal(reads,0);
  assert.deepEqual(await renderer.render(input),pdf);assert.equal(reads,1);
  for(const config of [{projectId:'999',environment:'Development'},{projectId:binding.projectId,environment:'Production'}]){
    assert.throws(()=>createManagedPdfRenderer({app:{...app,config},binding}),{code:'PDF_RENDER_CONFIGURATION_INVALID'});
  }
});
test('managed boundary rejects extra/query/header credentials without logging or dispatch',async()=>{
  for(const credentials of [{headers:{Authorization:fakeAuthorization,extra:'private'}},
    {headers:{Authorization:fakeAuthorization},parameters:{token:'private'}},
    {headers:{Authorization:'invalid private value'}},null]){
    let calls=0;const app={config:{projectId:binding.projectId,environment:'Development'},
      connections:()=>({getConnectionCredentials:async()=>credentials})};
    const renderer=createManagedPdfRenderer({app,binding,fetchImpl:async()=>{calls++;return response();}});
    await assert.rejects(renderer.render(input),{code:'PDF_RENDER_AUTH_UNAVAILABLE',ambiguous:false});assert.equal(calls,0);
  }
});
test('clock deadline bounds immediate promise chains and never dispatches after expiry',async()=>{
  let at=0;const h=harness({now:()=>at,auth:()=>{at=1001;return fakeAuthorization;}});
  await assert.rejects(h.renderer.render(input),{code:'PDF_RENDER_TIMEOUT',ambiguous:false});assert.equal(h.calls.length,0);
});
test('25-call native transport executes only after durable claim and verified repeats make zero additional POSTs', async()=>{
  const f=await createReconciledReportFixture({analyses:Array.from({length:25},()=>({}))});
  const prepared=await f.readInput(f.identity);
  const source=prepareFreeTestDocument(prepared.input,{now:f.now(),synthetic:true,callDetails:prepared.callDetails});
  const storage=createWorkDriveDraftFixture(source,{now:f.now()});
  const h=harness({fetch:async(url,request)=>{
    assert.equal([...storage.rows.values()].filter(row=>row.state.kind==='pdf_generation_v1'
      && row.state.phase==='render_started').length,1);
    const payload=JSON.parse(request.body);
    assert.equal((payload.html.match(/<section class="call-detail">/g)||[]).length,25);
    assert.ok(Buffer.byteLength(payload.html)<=MAX_HTML_BYTES);
    return response();
  }});
  const options={...f.readerOptions,reportRunStore:storage.runs,workdrive:storage.workdrive,
    readDestinationBinding:storage.readDestinationBinding,now:f.now,synthetic:true,pdfRenderer:h.renderer};
  const first=await createDurableReportComposition(options)(f.identity);
  f.runtime.clock.value=[...storage.rows.values()].find(row=>row.state.kind==='report_attempt_v1').state.nextAttemptAt;
  const repeated=await createDurableReportComposition(options)(f.identity);
  assert.equal(repeated.status,'existing_draft_verified_not_for_delivery');
  assert.equal(repeated.documentSha256,first.documentSha256);
  assert.equal(h.calls.length,1);assert.equal(h.authReads,1);assert.equal(storage.uploads.length,1);
  assert.deepEqual([...storage.resources.values()][0].bytes,pdf);
});
