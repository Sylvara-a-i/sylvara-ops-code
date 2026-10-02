'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { createProtectedRuntimeContext, PROFILE } = require('../lib/report-runtime-context');
const { createReportRunTransport } = require('../../../../revenue-desk-analytics/functions/analytics_sync/lib/report-run-transport');
const { fixture } = require('../../../../revenue-desk-analytics/functions/analytics_sync/test/helpers/report-run-sdk-fixture');
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
function setup(f, changes = {}) {
  const at = 1800000000000;
  const binding = { schemaVersion: 2, enabled: true, environment: 'development', sourceRevision: 'a'.repeat(40),
    projectId: '123456789', controlHost: 'synthetic.invalid',
    principalSha256: sha(JSON.stringify({ projectId: '123456789', roleId: '987654320', userId: '987654321' })),
    verifiedAt: at - 1, expiresAt: at + 10000, timeoutMs: 1000, nonce: 'c'.repeat(32), ...changes };
  const raw = JSON.stringify(binding);
  const environment = { DEPLOYMENT_ENVIRONMENT: 'development', SOURCE_REVISION: 'a'.repeat(40),
    REPORT_RUNTIME_CONTEXT_JSON: raw, REPORT_RUNTIME_CONTEXT_SHA256: sha(raw) };
  const config = { environment: 'development', sourceRevision: 'a'.repeat(40), controlHost: 'synthetic.invalid',
    operatorIdHash: 'operator_synthetic', expectedProjectIdSha256: sha('123456789') };
  return { at, environment, config, binding, args: { runtime: { initialize: () => f.app }, config,
    body: { profile: PROFILE, action: 'inspect_context' } } };
}
test('actual SDK read-only success, privacy, local replay and no writes', async () => {
  const f = fixture(); try {
    const s = setup(f), run = createProtectedRuntimeContext({ environment: s.environment, now: () => s.at,
      transportFactory: createReportRunTransport });
    const result = await run({}, s.args);
    assert.equal(result.stage, 'complete'); assert.equal(result.authentication_status, 'succeeded');
    assert.equal(result.principal_identity_matches, true); assert.equal(result.principal_role_matches, true);
    assert.equal(result.principal_request_status, '2xx'); assert.equal(result.qualification_authority, false);
    assert.equal(f.clientCalls, 1); assert.equal(f.requests[0].payload, null);
    assert.equal(f.rows.size + f.receipts.size, 0);
    assert.doesNotMatch(JSON.stringify(result), /987654321|987654320|private-unused|synthetic-managed|123456789/);
    assert.equal((await run({}, s.args)).binding_valid, false); assert.equal(f.clientCalls, 1);
  } finally { f.restore(); }
});
test('early-failure variants return coarse distinct observations with zero writes', async () => {
  const results = {};
  for (const scenario of ['sdk_initialize_exception', 'bad_binding_pin', 'expired_binding', 'missing_user_authentication',
    'sdk_uninitialized_user_credential', 'principal_socket_failure', 'principal_identity_mismatch', 'principal_role_name_mismatch', 'principal_inactive']) {
    const f = fixture(); try {
      const s = setup(f, scenario === 'expired_binding' ? { expiresAt: 1800000000000 } : {});
      if (scenario === 'bad_binding_pin') s.environment.REPORT_RUNTIME_CONTEXT_SHA256 = '0'.repeat(64);
      if (scenario === 'sdk_initialize_exception') s.args.runtime.initialize = () => { throw new Error('private synthetic exception'); };
      if (scenario === 'missing_user_authentication') f.app.authenticateRequest = async () => { throw Error('private synthetic token'); };
      if (scenario === 'sdk_uninitialized_user_credential') {
        const path = require('node:path'), root = path.dirname(require.resolve('zcatalyst-sdk-node/package.json'));
        const { CatalystCredential } = require(path.join(root, 'lib/utils/credential'));
        const { CatalystApp } = require(path.join(root, 'lib/catalyst-app'));
        const { CREDENTIAL_HEADER } = require(path.join(root, 'lib/utils/constants')).default;
        const credential = new CatalystCredential({ adminType: 'token', adminToken: 'invented-admin-only',
          [CREDENTIAL_HEADER.user_token]: 'invented-user-only', [CREDENTIAL_HEADER.user_cred_type]: 'unsupported', [CREDENTIAL_HEADER.user]: 'admin' });
        const app = new CatalystApp({ project_id: '123456789', project_key: 'invented-key', environment: 'Development', credential });
        f.app.authenticateRequest = app.authenticateRequest.bind(app);
      }
      if (scenario === 'principal_socket_failure') f.mode = 'network_error';
      const factory = options => {
        const io = createReportRunTransport(options);
        return ['principal_identity_mismatch', 'principal_role_name_mismatch', 'principal_inactive'].includes(scenario)
          ? { currentPrincipal: async o => ({ ...await io.currentPrincipal(o),
            ...(scenario === 'principal_identity_mismatch' ? { userId: '111111111' }
              : scenario === 'principal_inactive' ? { status: 'INACTIVE' } : { roleName: 'AppAdministrator' }) }) } : io;
      };
      const run = createProtectedRuntimeContext({ environment: s.environment, now: () => s.at, transportFactory: factory });
      results[scenario] = await run({}, s.args);
      assert.equal(f.rows.size + f.receipts.size, 0); assert.ok(f.clientCalls <= 1);
      assert.doesNotMatch(JSON.stringify(results[scenario]), /private synthetic|invented-|987654321|AppAdministrator/);
    } finally { f.restore(); }
  }
  assert.equal(results.sdk_initialize_exception.stage, 'SDKinit');
  assert.equal(results.bad_binding_pin.stage, 'binding'); assert.equal(results.expired_binding.binding_valid, false);
  assert.equal(results.missing_user_authentication.authentication_status, 'held');
  assert.equal(results.sdk_uninitialized_user_credential.principal_request_status, 'not_dispatched');
  assert.equal(results.principal_socket_failure.principal_request_status, 'unknown');
  assert.equal(results.principal_identity_mismatch.principal_identity_matches, false);
  assert.equal(results.principal_role_name_mismatch.principal_role_matches, false);
  assert.equal(results.principal_inactive.principal_status_active, false);
  for (const scenario of ['principal_identity_mismatch', 'principal_role_name_mismatch', 'principal_inactive'])
    assert.equal(results[scenario].stage, 'principal_match');
});
test('timeout cancels actual SDK request; delayed auth cannot dispatch after deadline', async () => {
  for (const delayedAuth of [false, true]) {
    const f = fixture(); try {
      const s = setup(f, { timeoutMs: 20 }); let release;
      if (delayedAuth) f.authDelay = new Promise(resolve => { release = resolve; }); else f.mode = 'stall';
      const run = createProtectedRuntimeContext({ environment: s.environment, now: () => s.at, transportFactory: createReportRunTransport });
      const result = await run({}, s.args);
      assert.equal(result.principal_request_status, delayedAuth ? 'not_dispatched' : 'timeout');
      assert.notEqual(result.stage, 'principal_stream');
      if (release) release(); await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.clientCalls, delayedAuth ? 0 : 1); assert.equal(f.rows.size + f.receipts.size, 0);
      for (const request of f.created) assert.equal(request.destroyed, true);
    } finally { f.restore(); }
  }
});
test('disabled, legacy schema, malformed, wrong host/source/project, stale and unsupported SDK never dispatch', async () => {
  const f = fixture(); try {
    for (const change of [{ enabled: false }, { schemaVersion: 1 }, { schemaVersion: 1, operatorIdHash: 'operator_synthetic' },
      { operatorIdHash: 'operator_synthetic' }, { controlHost: 'wrong.invalid' }, { sourceRevision: 'b'.repeat(40) },
      { projectId: '111111111' }, { extra: 'private-value' }, { timeoutMs: 3001 }]) {
      const s = setup(f, change);
      const run = createProtectedRuntimeContext({ environment: s.environment, now: () => s.at, transportFactory: () => assert.fail('transport') });
      assert.equal((await run({}, s.args)).binding_valid, false);
    }
    const s = setup(f), run = createProtectedRuntimeContext({ environment: s.environment, now: () => s.at,
      sdkVersion: () => 'wrong', transportFactory: () => assert.fail('transport') });
    assert.equal((await run({}, s.args)).sdk_version_matches, false); assert.equal(f.clientCalls, 0);
    await assert.rejects(run({}, { ...s.args, body: { profile: PROFILE, action: 'inspect_context', actor: 'caller' } }));
  } finally { f.restore(); }
});

test('schema 2 diagnostic is independent of operational HMAC actor continuity', async () => {
  const f = fixture(); try {
    const s = setup(f); s.config.operatorIdHash = 'operator_unrelated';
    const run = createProtectedRuntimeContext({ environment: s.environment, now: () => s.at, transportFactory: createReportRunTransport });
    const result = await run({}, s.args);
    assert.equal(result.stage, 'complete'); assert.equal(result.principal_status_active, true);
    assert.equal(result.qualification_authority, false); assert.equal(f.clientCalls, 1);
    assert.equal(f.rows.size + f.receipts.size, 0);
  } finally { f.restore(); }
});

test('actual SDK principal response failures emit only closed classes and never write', async () => {
  const principal = {user_id:'987654321', role_details:{role_id:'987654320', role_name:'App Administrator'}, status:'ACTIVE'};
  for (const [options, stage] of [
    [{principalStreamFailure:true}, 'principal_stream'],
    [{principalBody:'private synthetic body '.repeat(4000)}, 'principal_size'],
    [{principalBody:Buffer.from([0xc3,0x28])}, 'principal_utf8'],
    [{principalBody:'{private synthetic body'}, 'principal_json'],
    [{principalData:[principal]}, 'principal_envelope'],
    [{principalData:null}, 'principal_envelope'],
  ]) {
    const f = fixture(options); try {
      const s = setup(f), run = createProtectedRuntimeContext({ environment:s.environment, now:()=>s.at, transportFactory:createReportRunTransport });
      const result = await run({}, s.args);
      assert.equal(result.stage, stage); assert.equal(result.principal_request_status, '2xx');
      assert.equal(result.authentication_status, 'succeeded');
      assert.equal(result.principal_identity_matches, 'Unknown');
      assert.equal(result.principal_status_active, 'Unknown'); assert.equal(result.principal_role_matches, 'Unknown');
      assert.equal(result.qualification_authority, false); assert.equal(Object.keys(result).length, 20);
      assert.equal(f.clientCalls, 1); assert.equal(f.rows.size + f.receipts.size, 0);
      assert.doesNotMatch(JSON.stringify(result), /private synthetic|987654321|987654320|private-unused|synthetic-managed|Content-Type|Authorization/);
      await new Promise(resolve=>setImmediate(resolve)); // Late teardown cannot mutate frozen output or emit private errors.
      assert.equal(result.stage, stage); assert.equal((await run({}, s.args)).binding_valid, false);
      assert.equal(f.clientCalls, 1);
    } finally { f.restore(); }
  }
});

test('documented numeric principal shape remains strict; unknown trace classes cannot echo private text', async () => {
  for(const malicious of [false, true]) {
    const f = fixture({principalData:{user_id:987654321, role_details:{role_id:987654320,role_name:'App Administrator'},status:'ACTIVE'}});
    try {
      const s = setup(f);
      const factory = options => {const io=createReportRunTransport(options);return malicious ? {currentPrincipal:async o=>{
        o.trace({event:'principal_failure',failureClass:'private synthetic response'});
        return io.currentPrincipal(o);
      }} : io;};
      const result = await createProtectedRuntimeContext({environment:s.environment,now:()=>s.at,transportFactory:factory})({},s.args);
      assert.equal(result.stage,'complete');assert.equal(result.principal_identity_matches,true);
      assert.equal(f.clientCalls,1);assert.equal(f.rows.size+f.receipts.size,0);
      assert.doesNotMatch(JSON.stringify(result),/private synthetic|987654321|987654320/);
    }finally{f.restore();}
  }
});

test('actual SDK credential boundary distinguishes console admin null from registered app user', async()=>{
 const principal={user_id:'987654321',status:'ACTIVE',role_details:{role_id:'987654320',role_name:'App Administrator'}};
 for(const credentialType of ['admin','user']){
  const f=fixture({credentialType,principalBody:JSON.stringify({status:'success',data:credentialType==='admin'?null:principal})});
  try{const s=setup(f),run=createProtectedRuntimeContext({environment:s.environment,now:()=>s.at,transportFactory:createReportRunTransport});
   const out=await run({},s.args);
   assert.equal(out.credential_user_mode,'user');assert.equal(out.credential_user_type,credentialType);
   assert.equal(out.stage,credentialType==='admin'?'principal_envelope':'complete');
   assert.equal(out.response_structure.data_type,credentialType==='admin'?'null':'object');
   assert.equal(out.response_structure.root_status,'success');
   assert.equal(out.principal_get_exact,true);assert.equal(out.principal_path_exact,true);
   assert.equal(out.principal_raw_stream_same,true);assert.equal(out.principal_body_complete,true);
   assert.equal(f.requests[0].method,'GET');assert.equal(f.clientCalls,1);assert.equal(f.rows.size+f.receipts.size,0);
   assert.equal(out.qualification_authority,false);assert.equal(Object.isFrozen(out.response_structure),true);
   assert.doesNotMatch(JSON.stringify(out),/synthetic-user-token|synthetic-admin-token|987654321|987654320|Authorization/);
   assert.equal((await run({},s.args)).binding_valid,false);assert.equal(f.clientCalls,1);
  }finally{f.restore();}
 }
});
test('comprehensive fixed structural classes cover roots, data, arrays and one bounded string parse without acceptance',async()=>{
 const principal={user_id:'private-user',role_details:{role_id:'private-role',role_name:'private-name'},status:'PRIVATE'};
 const cases=[
  [null,{root_type:'null',data_type:'absent'}],
  [false,{root_type:'boolean'}], [17,{root_type:'number'}],
  [{status:'success'},{root_status:'success',data_type:'absent'}],
  [{status:'error',data:null},{root_status:'error',data_type:'null'}],
  [{status:'private-status',data:false},{root_status:'other',data_type:'boolean'}],
  [{data:17},{data_type:'number'}],
  [{data:[]},{array_location:'data',array_bucket:'zero',singleton_type:'absent'}],
  [{data:[principal]},{array_bucket:'one',singleton_type:'object',singleton_has_user_id:true}],
  [{data:[principal,principal]},{array_bucket:'multiple',singleton_type:'absent'}],
  [[principal],{root_type:'array',array_location:'root',array_bucket:'one',singleton_has_user_id:true}],
  [principal,{root_type:'object',root_has_user_id:true,data_type:'absent'}],
  [{data:JSON.stringify(principal)},{decoded_location:'data',decoded_parse:'parsed',decoded_root_type:'object',decoded_root_has_user_id:true}],
  [JSON.stringify({data:principal}),{root_type:'string',decoded_location:'root',decoded_parse:'parsed',decoded_data_type:'object',decoded_data_has_user_id:true}],
  [{data:[JSON.stringify(principal)]},{decoded_location:'singleton',decoded_parse:'parsed',decoded_root_has_user_id:true}],
  [{data:'private non-JSON string'},{data_type:'string',decoded_parse:'invalid'}],
  [{data:JSON.stringify('private double-encoded')},{decoded_parse:'parsed',decoded_root_type:'string'}],
 ];
 for(const [body,expected]of cases){const f=fixture({principalBody:JSON.stringify(body)});
  try{const s=setup(f),out=await createProtectedRuntimeContext({environment:s.environment,now:()=>s.at,transportFactory:createReportRunTransport})({},s.args);
   assert.equal(out.stage,'principal_envelope');assert.equal(out.principal_identity_matches,'Unknown');
   for(const [key,value]of Object.entries(expected))assert.equal(out.response_structure[key],value,key);
   assert.equal(out.qualification_authority,false);assert.equal(f.clientCalls,1);assert.equal(f.rows.size+f.receipts.size,0);
   assert.doesNotMatch(JSON.stringify(out),/private-user|private-role|private-name|PRIVATE|private-status|private non-JSON|private double-encoded/);
   assert.ok(Buffer.byteLength(JSON.stringify(out))<4096);
  }finally{f.restore();}
 }
});
test('chunked UTF8, premature close, limits and timeout remain bounded and truthful',async()=>{
 const bytes=Buffer.from(JSON.stringify({data:{user_id:'987654321',status:'ACTIVE',role_details:{role_id:'987654320',role_name:'App Administrator'},unused:'🪠'}}));
 const split=bytes.indexOf(Buffer.from('🪠'))+1;
 for(const [options,expected,complete]of[
  [{principalChunks:[bytes.subarray(0,split),bytes.subarray(split,split+1),bytes.subarray(split+1)]},'complete',true],
  [{principalPrematureClose:true},'principal_stream',false],
  [{principalChunks:Array.from({length:129},()=>Buffer.from(' '))},'principal_size',true],
  [{principalBody:'x'.repeat(65537)},'principal_size',true],
  [{principalBody:Buffer.from([0xc3,0x28])},'principal_utf8',true],
 ]){const f=fixture(options);try{const s=setup(f),out=await createProtectedRuntimeContext({environment:s.environment,now:()=>s.at,transportFactory:createReportRunTransport})({},s.args);
  assert.equal(out.stage,expected);if(complete&&expected!=='principal_size')assert.equal(out.principal_body_complete,true);
  if(!complete)assert.equal(out.principal_body_complete,false);assert.equal(out.qualification_authority,false);
  assert.equal(f.clientCalls,1);assert.equal(f.rows.size+f.receipts.size,0);
  if(expected!=='complete')assert.equal(out.response_structure,null);
  assert.doesNotMatch(JSON.stringify(out),/987654321|🪠|private synthetic/);
 }finally{f.restore();}}
 const f=fixture();try{f.mode='stall';const s=setup(f,{timeoutMs:20});
  const out=await createProtectedRuntimeContext({environment:s.environment,now:()=>s.at,transportFactory:createReportRunTransport})({},s.args);
  assert.equal(out.principal_request_status,'timeout');assert.equal(out.principal_body_complete,false);assert.equal(out.response_structure,null);
  assert.equal(f.clientCalls,1);for(const r of f.created)assert.equal(r.destroyed,true);
 }finally{f.restore();}
});
test('untrusted structural trace and unknown credential methods cannot expose private values',async()=>{
 const f=fixture();try{f.app.credential.getCurrentUserType=()=> 'private credential value';const s=setup(f);
  const factory=options=>{const io=createReportRunTransport(options);return {currentPrincipal:async opts=>{
   opts.trace({event:'principal_structure',structure:{private:'private response text'}});
   opts.trace({event:'principal_raw',same:'private response text'});
   return io.currentPrincipal(opts);
  }};};
  const out=await createProtectedRuntimeContext({environment:s.environment,now:()=>s.at,transportFactory:factory})({},s.args);
  assert.equal(out.credential_user_type,'unknown');assert.equal(out.stage,'principal_response');assert.equal(out.response_structure,null);
  assert.doesNotMatch(JSON.stringify(out),/private credential|private response/);assert.equal(f.clientCalls,1);
 }finally{f.restore();}
});
