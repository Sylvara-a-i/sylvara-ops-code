'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const legacy = require('../../../tools/storage-dormant-activation');
const prep = require('../../../tools/storage-untimed-activation');
const shared = require('../lib/report-storage-activation');
const codec = require('../lib/report-storage-binding');
const native = require('./helpers/storage-caller-fixture');
const { compile, execute } = require('./helpers/storage-caller-deluge-subset');
const roles = ['ownerAuthorization', 'ownership', 'access'];
const kinds = ['owner_readiness_continuity', 'ownership_readback', 'access_readback'];
function fixture() {
  const facts = { ownerAuthorization: { standingApprovalSha256: 'a'.repeat(64), scope: 'synthetic_storage_only' },
    ownership: { sourceRevision: 'b'.repeat(40), environment: 'development' }, access: { permissions: ['SELECT', 'INSERT'] } };
  const table = (id, name, key) => ({ id, name, schemaSha256: 'c'.repeat(64), uniquenessSha256: 'd'.repeat(64), uniqueField: key, projectionSha256: 'e'.repeat(64) });
  const binding = { schemaVersion: 7, enabled: false, environment: 'development', sourceRevision: 'b'.repeat(40),
    projectId: '101000001', controlHost: 'synthetic.invalid', tableId: '101000003', nonce: 'f'.repeat(32),
    capability: { region: 'US', origin: 'https://api.catalyst.zoho.com', controllerFunctionId: '101000002', deploymentId: 'synthetic_deployment',
      sdkVersion: '3.4.0', authMode: 'user', authType: 'admin', creatorPolicy: 'observed_consistent_v1',
      tables: { reportRuns: table('101000003', 'ReportRuns', 'IdempotencyKey'), eventReceipts: table('101000004', 'RevenueDeskEventReceipts', 'EVENT_KEY') },
      evidence: Object.fromEntries(roles.map(role => [role, { digest: legacy.evidenceDigest(facts[role]), verifiedAt: 0, expiresAt: 0 }])) },
    verifiedAt: 0, expiresAt: 0, timeoutMs: 25000, singleAdmittedInvocation: true };
  const receipts = Object.fromEntries(roles.map((role, i) => [role, { schemaVersion: 1, role, method: 'independent_current_read',
    reference: 'synthetic:' + role, observedAt: native.NOW, observationKind: kinds[i], normalizedFacts: facts[role] }]));
  const stage = prep.stageUntimed({ binding });
  return { binding, stage, input: { binding, bindingSha256: stage.bindingSha256, receipts,
    readiness: { stagedAndReadBack: true, sourceAndTargetUnchanged: true, scopeAndCostAuthorized: true, durableConsumptionReady: true } } };
}
function rendered(f = fixture()) {
  const prepared = prep.prepareUntimedActivation(f.input);
  return { ...f, prepared, caller: prep.renderUntimedActivationCaller({ templateText: native.templateText,
    templateSha256: native.sha(native.templateText), preparedActivation: prepared }) };
}
test('schema7 staging and command contain no pre-execution expiry or implicit clock', () => {
  const saved = { now: Date.now, randomBytes: crypto.randomBytes, randomUUID: crypto.randomUUID };
  const forbid = () => { throw Error('clock or entropy consulted'); };
  try {
    Date.now = forbid; crypto.randomBytes = forbid; crypto.randomUUID = forbid;
    const f = rendered();
    assert.equal(codec.decodeStorageBinding({ ...f.stage.transport.parts, REPORT_STORAGE_QUALIFICATION_JSON: f.stage.transport.marker }), f.stage.raw);
    assert.deepEqual(Object.keys(f.prepared.command.activation), ['schemaVersion', 'bindingSha256', 'operationDigest', 'evidence']);
    assert.equal(f.prepared.command.activation.schemaVersion, 2);
    assert.equal(Object.hasOwn(f.prepared, 'guardTimes'), false);
    assert.equal(f.prepared.providerActions, 0); assert.equal(f.prepared.grantsExecutionAuthority, false);
    assert.deepEqual(f.prepared.limits, legacy.LIMITS);
    assert.equal(f.caller.diagnosticSchemaVersion, 2);
    assert.equal((f.caller.text.match(/\binvokeurl\b/g) || []).length, 1);
    assert.equal((f.caller.text.match(/zoho\.currenttime/g) || []).length, 2);
    assert.ok(!f.caller.text.includes('27000')); assert.ok(!f.caller.text.includes('expiresAt'));
  } finally { Object.assign(Date, { now: saved.now }); crypto.randomBytes = saved.randomBytes; crypto.randomUUID = saved.randomUUID; }
});
for (const delay of [0, 3600001, 365 * 86400000, 100 * 365 * 86400000]) {
  test('unchanged published caller and exact activation survive setup delay ' + delay, () => {
    const f = rendered(), before = JSON.stringify(f.prepared), at = native.NOW + delay;
    const checked = shared.activateDormantBinding(f.binding, f.stage.bindingSha256, f.prepared.command.activation, at);
    assert.equal(checked.activationDigest, f.prepared.activationDigest);
    const args = native.responseFixture(at + 2000);
    args.dispatchAt = at; args.receivedAt = at + 2000;
    const envelope = JSON.parse(args.response.responseText);
    envelope.result.operationDigest = f.stage.operationDigest;
    args.response.responseText = JSON.stringify(envelope);
    const result = execute(compile(f.caller.text), args);
    assert.equal(result.output.status, 'storage_unique_successor_observed');
    assert.equal(result.counts.invocations, 1);
    assert.equal(JSON.stringify(f.prepared), before);
  });
}
test('receipt timestamps stay audit facts; changing them never changes the replay identity', () => {
  const f = fixture(), first = prep.prepareUntimedActivation(f.input);
  for (const role of roles) f.input.receipts[role].observedAt += 100 * 365 * 86400000;
  const second = prep.prepareUntimedActivation(f.input);
  assert.equal(first.operationDigest, second.operationDigest);
  assert.notEqual(first.activationDigest, second.activationDigest);
  for (const role of roles) assert.equal(second.command.activation.evidence[role].observedAt, f.input.receipts[role].observedAt);
});
test('untimed interface rejects legacy activation fields, missing readiness, facts drift and schema substitution', () => {
  const f = fixture();
  for (const input of [{ ...f.input, expiresAt: native.EXPIRES }, { ...f.input, now: native.NOW },
    { ...f.input, readiness: { ...f.input.readiness, durableConsumptionReady: false } }]) assert.throws(() => prep.prepareUntimedActivation(input));
  f.input.receipts.access.normalizedFacts.permissions.push('DELETE');
  assert.throws(() => prep.prepareUntimedActivation(f.input));
  const old = fixture(); old.binding.schemaVersion = 6;
  assert.throws(() => prep.stageUntimed({ binding: old.binding }));
});
test('legacy preparer does not silently opt old schema6 into untimed activation', () => {
  const f = fixture();
  assert.throws(() => legacy.prepareActivation({ ...f.input, expiresAt: native.EXPIRES }, { now: native.NOW }));
});
test('renderer refuses imitated activations and changed native semantics', () => {
  const f = rendered();
  assert.throws(() => prep.renderUntimedActivationCaller({ templateText: native.templateText,
    templateSha256: native.sha(native.templateText), preparedActivation: JSON.parse(JSON.stringify(f.prepared)) }));
  for (const text of [native.templateText.replace('result.size() == 18', 'result.size() == 17'),
    native.templateText.replace('received_at + 1000 - dispatch_at <= 40000', 'true'), native.templateText + '// invokeurl\n']) {
    assert.throws(() => prep.renderUntimedActivationCaller({ templateText: text, templateSha256: native.sha(text), preparedActivation: f.prepared }));
  }
});
test('request elapsed-time bound and future response observation remain enforced after arbitrary setup delay', () => {
  const f = rendered(), at = native.NOW + 365 * 86400000;
  for (const [receivedAt, observedAt, stage] of [[at + 40000, at + 40000, 'acceptance_predicate'],
    [at + 2000, at + 2001, 'receipt_second_guard_only']]) {
    const args = native.responseFixture(observedAt); args.dispatchAt = at; args.receivedAt = receivedAt;
    const envelope = JSON.parse(args.response.responseText); envelope.result.operationDigest = f.stage.operationDigest;
    args.response.responseText = JSON.stringify(envelope);
    const result = execute(compile(f.caller.text), args);
    assert.equal(result.output.status, 'unknown_no_retry'); assert.equal(result.counts.invocations, 1);
    assert.equal(result.output.diagnostic.schemaVersion, 2); assert.equal(result.output.diagnostic.rejectionStage, stage);
  }
});
