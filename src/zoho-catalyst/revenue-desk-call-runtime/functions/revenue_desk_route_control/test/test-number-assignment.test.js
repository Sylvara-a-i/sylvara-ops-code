'use strict';
// Synthetic fixtures only; provider I/O is injected and never reaches a network.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { loadTestNumberAssignments, assignedTestPhoneNumber } = require('revenue_desk_call_gateway/lib/test-number-assignment');
const { createStagingFixture, SyntheticStore } = require('./helpers/configuration-staging-fixture');
const { createRetellRouteProvider } = require('../lib/retell-route-provider');
const { createConfigurationSuccessorService } = require('../lib/configuration-successor-service');
const { loadConfig } = require('../lib/config');
const QA = '+19135550999';
const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');
function inventory(fixtures, mutation = () => {}) {
  const f = fixtures[0];
  const document = { schemaVersion: 1, environment: 'development', sourceRevision: f.config.sourceRevision,
    operatorIdHash: f.config.operatorIdHash, approvalSha256: '9'.repeat(64), assignments: fixtures.map(v => ({
      dealId: v.request.dealId, journeyId: v.request.journeyId, clientId: v.request.deployment.CLIENT_ID,
      deploymentId: v.request.deployment.DEPLOYMENT_ID, phoneNumber: v.config.retellPhoneNumber })) };
  mutation(document); const raw = JSON.stringify(document);
  return { env: { RETELL_NUMBER_ASSIGNMENT_MODE: 'approved_inventory', RETELL_NUMBER_INVENTORY_JSON: raw,
    RETELL_NUMBER_INVENTORY_SHA256: sha(raw) }, options: { sourceRevision: f.config.sourceRevision,
      operatorIdHash: f.config.operatorIdHash, numberSecret: f.config.numberSecret, qaPhoneNumber: QA }, document };
}
function bind(fixtures) {
  const { env, options } = inventory(fixtures); const binding = loadTestNumberAssignments(env, options);
  for (const f of fixtures) Object.assign(f.config, binding, { retellPhoneNumber: QA });
  return binding;
}
test('protected inventory rejects duplicate, stale, malformed and QA-reserved assignments', () => {
  const a = createStagingFixture(), b = createStagingFixture(1);
  for (const mutate of [d => { d.assignments[1].phoneNumber = d.assignments[0].phoneNumber; },
    d => { d.assignments[1].deploymentId = d.assignments[0].deploymentId; },
    d => { d.assignments[1].dealId = d.assignments[0].dealId; d.assignments[1].journeyId = d.assignments[0].journeyId; },
    d => { d.assignments[0].phoneNumber = QA; }, d => { d.assignments[0].clientId = 123; },
    d => { d.environment = 'production'; }, d => { d.sourceRevision = 'f'.repeat(40); },
    d => { d.operatorIdHash = 'operator_' + '0'.repeat(64); }, d => { d.assignments[0].extra = true; }]) {
    const { env, options } = inventory([a,b], mutate);
    assert.throws(() => loadTestNumberAssignments(env, options), { code: 'INVALID_TEST_NUMBER_INVENTORY' });
  }
  const { env, options } = inventory([a,b]);
  assert.throws(() => loadTestNumberAssignments({ ...env, RETELL_NUMBER_INVENTORY_SHA256: '0'.repeat(64) }, options));
  assert.throws(() => loadTestNumberAssignments({ ...env, RETELL_NUMBER_ASSIGNMENT_MODE: 'qa_only' }, options));
  assert.deepEqual(loadTestNumberAssignments({}, options), { numberAssignmentMode: 'qa_only', approvedTestNumbers: null });
  const binding = loadTestNumberAssignments(env, options);
  assert.ok(Object.isFrozen(binding.approvedTestNumbers[0]));
});
test('two exact protected assignments stage concurrently and replay without changing ownership', async () => {
  const store = new SyntheticStore(), a = createStagingFixture(0,{store}), b = createStagingFixture(1,{store});
  bind([a,b]);
  const results = await Promise.all([a.service.stage(a.request), b.service.stage(b.request)]);
  assert.ok(results.every(v => v.state === 'StagedInactive' && v.active === false));
  const rows = store.rowsFor(a.config.tables.DEPLOYMENT_TABLE);
  assert.equal(rows.length,2); assert.notEqual(rows[0].NUMBER_LOOKUP_HASH, rows[1].NUMBER_LOOKUP_HASH);
  const prior = structuredClone(rows), writes = store.writes.length;
  await Promise.all([a.service.stage(a.request), b.service.stage(b.request)]);
  assert.equal(store.writes.length,writes); assert.deepEqual(rows, prior);
});
test('signed caller number hash and mismatched client/Deal/Journey cannot override inventory', async () => {
  for (const mutate of [f => { f.request.deployment.NUMBER_LOOKUP_HASH = 'num_' + '0'.repeat(64); },
    f => { f.request.deployment.CLIENT_ID = 'other_client'; }, f => { f.request.dealId = '900000001'; },
    f => { f.request.journeyId = 'other_journey'; }]) {
    const f = createStagingFixture(); bind([f]); mutate(f); f.sign();
    await assert.rejects(f.service.stage(f.request), { code: 'TEST_NUMBER_ASSIGNMENT_UNAVAILABLE' });
    assert.equal(f.store.writes.length,0); assert.equal(f.stagingWrites,0);
  }
});
test('retained stopped owner prevents inventory edits from recycling its number', async () => {
  const store = new SyntheticStore(), a = createStagingFixture(0,{store}), b = createStagingFixture(1,{store});
  bind([a]); await a.service.stage(a.request);
  const [owner] = store.rowsFor(a.config.tables.DEPLOYMENT_TABLE); owner.TEST_STATUS = 'Stopped';
  b.config.retellPhoneNumber = '+19135550901'; b.request.deployment.NUMBER_LOOKUP_HASH = owner.NUMBER_LOOKUP_HASH;
  bind([b]); b.sign(); const original = structuredClone(owner);
  await assert.rejects(b.service.stage(b.request)); assert.deepEqual(owner, original);
  assert.equal(store.rowsFor(a.config.tables.DEPLOYMENT_TABLE).length,1); assert.equal(b.stagingWrites,0);
});
function providerFixture() {
  const a = createStagingFixture(), b = createStagingFixture(1); bind([a,b]);
  const config = { ...a.config, retellRouteMode: 'isolated_test', sharedAgentVersion: 1,
    platformTimeoutMs: 250, retellApiBaseUrl: 'https://provider.example.invalid', inboundWebhookUrl: 'https://resolver.example.invalid/retell/inbound' };
  const requests = [], inactive = new Set();
  const provider = createRetellRouteProvider(config, { authorization: async () => 'Bearer synthetic', fetchImpl: async (url, options) => {
    requests.push(url); const phone = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if(options.method === 'PATCH') inactive.add(phone);
    return { status:200, json:async () => ({phone_number:phone,phone_number_type:'retell-twilio',
      last_modification_timestamp:1,nickname:'ZZZ SYNTHETIC inventory',inbound_agents:inactive.has(phone)?[]:[{agent_id:config.sharedAgentId,agent_version:1,weight:1}],
      outbound_agents:[],inbound_sms_agents:[],outbound_sms_agents:[],inbound_webhook_url:inactive.has(phone)?null:config.inboundWebhookUrl,
      inbound_sms_webhook_url:null,fallback_number:null}) };
  }});
  b.request.deployment.MONITOR_AGENT_ID = config.sharedAgentId;
  return {a,b,config,provider,requests};
}
test('isolated provider selects each protected destination with shared agent and holds unmapped owner before dispatch', async () => {
  const {a,b,provider,requests} = providerFixture();
  for(const f of [a,b]) await provider.verifyActiveRoute({ deployment:f.request.deployment,
    configurationVersion:f.request.configurationRow, routeFingerprint:f.request.intent.route_fingerprint });
  assert.deepEqual(requests.map(u => decodeURIComponent(new URL(u).pathname.split('/').pop())), ['+19135550901','+13035550902']);
  const before = requests.length;
  await assert.rejects(provider.verifyActiveRoute({deployment:{...a.request.deployment,CLIENT_ID:'other'}}), {code:'TEST_NUMBER_ASSIGNMENT_UNAVAILABLE'});
  assert.equal(requests.length,before);
  const held = await provider.disableRoute({deployment:{...a.request.deployment,NUMBER_LOOKUP_HASH:'num_'+'0'.repeat(64)}});
  assert.equal(held.status,'manual_rollback_required'); assert.equal(requests.length,before);
});
test('inventory mode cannot invoke historical number-changing successor', async () => {
  const service = createConfigurationSuccessorService({ config: { environment:'development',deploymentMode:'active',numberAssignmentMode:'approved_inventory'},
    store:{},crm:{recordConfigurationSuccessor(){}},sourceReader:{},conversionReader:{},evidenceStore:{} });
  await assert.rejects(service.succeed({}), {code:'TEST_NUMBER_REASSIGNMENT_HELD'});
});


test('inventory rollback clears and independently reads back only its exact isolated assigned number', async () => {
  const {a,b,provider,requests}=providerFixture();
  a.request.deployment.APPROVED_ROUTE_FINGERPRINT=a.request.intent.route_fingerprint;
  const result=await provider.disableRoute({deployment:a.request.deployment,configurationVersion:a.request.configurationRow,
    routeFingerprint:a.request.intent.route_fingerprint});
  assert.equal(result.status,'route_inactive');assert.equal(requests.length,3);
  assert.ok(requests.every(url=>decodeURIComponent(new URL(url).pathname.split('/').pop())==='+19135550901'));
  const other=await provider.verifyActiveRoute({deployment:b.request.deployment,configurationVersion:b.request.configurationRow,
    routeFingerprint:b.request.intent.route_fingerprint});assert.equal(other.status,'route_active');
});
