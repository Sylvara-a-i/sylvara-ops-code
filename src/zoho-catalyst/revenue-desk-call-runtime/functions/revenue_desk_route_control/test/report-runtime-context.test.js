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
