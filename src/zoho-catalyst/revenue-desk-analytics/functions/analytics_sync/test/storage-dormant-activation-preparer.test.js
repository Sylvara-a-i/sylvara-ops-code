'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const preparer = require('../../../tools/storage-dormant-activation');
const codec = require('../lib/report-storage-binding');
const shared = require('../lib/report-storage-activation');
const NOW = 1800000000000;
const ROLES = ['ownerAuthorization', 'ownership', 'access'];
function fixture() {
  const facts = { ownerAuthorization: { standingApprovalSha256: 'a'.repeat(64), scope: 'synthetic_storage_only' },
    ownership: { projectId: '101000001', sourceRevision: 'b'.repeat(40) }, access: { schema: 'synthetic', permissions: ['SELECT', 'INSERT'] } };
  const receipts = Object.fromEntries(ROLES.map(role => [role, { schemaVersion: 1, role,
    method: 'independent_current_read', reference: 'synthetic-read:' + role, observedAt: NOW - 1000,
    observationKind: { ownerAuthorization: 'owner_readiness_continuity', ownership: 'ownership_readback', access: 'access_readback' }[role],
    normalizedFacts: facts[role] }]));
  const table = (id, name, key) => ({ id, name, schemaSha256: 'c'.repeat(64), uniquenessSha256: 'd'.repeat(64), uniqueField: key, projectionSha256: 'e'.repeat(64) });
  const binding = { schemaVersion: 6, enabled: false, environment: 'development', sourceRevision: 'b'.repeat(40),
    projectId: '101000001', controlHost: 'synthetic.development.catalystserverless.com', tableId: '101000003', nonce: 'f'.repeat(32),
    capability: { region: 'US', origin: 'https://api.catalyst.zoho.com', controllerFunctionId: '101000002', deploymentId: 'synthetic_deployment',
      sdkVersion: '3.4.0', authMode: 'user', authType: 'admin', creatorPolicy: 'observed_consistent_v1',
      tables: { reportRuns: table('101000003', 'ReportRuns', 'IdempotencyKey'), eventReceipts: table('101000004', 'RevenueDeskEventReceipts', 'EVENT_KEY') },
      evidence: Object.fromEntries(ROLES.map(role => [role, { digest: preparer.evidenceDigest(facts[role]), verifiedAt: 0, expiresAt: 0 }])) },
    verifiedAt: 0, expiresAt: 0, timeoutMs: 25000, singleAdmittedInvocation: true };
  const stage = preparer.stageDormant({ binding });
  return { binding, receipts, stage, input: { binding, bindingSha256: stage.bindingSha256, expiresAt: NOW + 120000, receipts,
    readiness: { stagedAndReadBack: true, sourceAndTargetUnchanged: true, scopeAndCostAuthorized: true, durableConsumptionReady: true } } };
}
const prepare = input => preparer.prepareActivation(input, { now: NOW });
test('staging preserves caller-supplied identity and exact disabled bytes without a clock', () => {
  const { binding, stage } = fixture();
  assert.equal(stage.raw, JSON.stringify(binding));
  assert.equal(stage.bindingSha256, crypto.createHash('sha256').update(stage.raw).digest('hex'));
  assert.equal(codec.decodeStorageBinding({ ...stage.transport.parts, REPORT_STORAGE_QUALIFICATION_JSON: stage.transport.marker }), stage.raw);
  assert.equal(stage.operationDigest, shared.dormantOperationDigest(stage.bindingSha256));
  assert.equal(JSON.parse(stage.raw).nonce, 'f'.repeat(32));
  assert.deepEqual(preparer.stageDormant({ binding }), stage);
  assert.equal(stage.providerActions, 0); assert.equal(stage.grantsExecutionAuthority, false);
  assert.ok(Object.isFrozen(stage.transport.parts));
});
test('fresh receipts generate exact authenticated command data and shared-valid activation', () => {
  const { input, binding } = fixture(), before = JSON.stringify(input), result = prepare(input);
  assert.deepEqual(JSON.parse(result.body), result.command);
  assert.deepEqual(Object.keys(result.command).sort(), ['action', 'activation', 'profile']);
  const checked = shared.activateDormantBinding(binding, input.bindingSha256, result.command.activation, NOW);
  assert.equal(result.activationDigest, checked.activationDigest);
  assert.equal(checked.binding.enabled, true);
  assert.equal(result.guardTimes.latestDispatchAt, input.expiresAt - 27000);
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(result.command.activation.evidence.access));
  assert.equal(result.grantsExecutionAuthority, false);
});
test('different fresh receipts cannot change stable durable replay key or dormant packet', () => {
  const { input, stage } = fixture(), first = prepare(input);
  for (const role of ROLES) { input.receipts[role].observedAt++; input.receipts[role].reference += ':later'; }
  const second = prepare(input);
  assert.equal(first.operationDigest, second.operationDigest);
  assert.equal(first.bindingSha256, second.bindingSha256);
  assert.notEqual(first.activationDigest, second.activationDigest);
  assert.notEqual(first.command.activation.evidence.access.digest, second.command.activation.evidence.access.digest);
  assert.equal(preparer.stageDormant({ binding: input.binding }).raw, stage.raw);
});
test('facts hashes sort nested keys but preserve array order and typed values', () => {
  assert.equal(preparer.evidenceDigest({ b: { y: 2, x: 1 }, a: true }), preparer.evidenceDigest({ a: true, b: { x: 1, y: 2 } }));
  assert.notEqual(preparer.evidenceDigest({ a: [1, 2] }), preparer.evidenceDigest({ a: [2, 1] }));
  assert.notEqual(preparer.evidenceDigest({ a: 1 }), preparer.evidenceDigest({ a: '1' }));
});
test('all three receipts retain actual observation times and full receipt digests', () => {
  const { input } = fixture(), result = prepare(input);
  for (const role of ROLES) {
    const e = result.command.activation.evidence[role];
    assert.equal(e.verifiedAt, input.receipts[role].observedAt);
    assert.equal(e.stateSha256, input.binding.capability.evidence[role].digest);
    assert.equal(e.digest, preparer.evidenceDigest(input.receipts[role]));
  }
});
for (const change of ['enabled', 'bindingTime', 'evidenceTime', 'schema', 'environment', 'timeout', 'nonce']) {
  test('invalid dormant staging rejects ' + change, () => {
    const { binding } = fixture();
    if (change === 'enabled') binding.enabled = true;
    if (change === 'bindingTime') binding.verifiedAt = NOW;
    if (change === 'evidenceTime') binding.capability.evidence.access.expiresAt = NOW;
    if (change === 'schema') binding.schemaVersion = 4;
    if (change === 'environment') binding.environment = 'production';
    if (change === 'timeout') binding.timeoutMs = 30000;
    if (change === 'nonce') binding.nonce = '<allocate-later>';
    assert.throws(() => preparer.stageDormant({ binding }));
  });
}
for (const role of ROLES) {
  for (const change of ['missing', 'role', 'kind', 'method', 'reference', 'future', 'expired', 'facts', 'extra']) {
    test(role + ' receipt rejects ' + change, () => {
      const { input } = fixture(), r = input.receipts[role];
      if (change === 'missing') delete input.receipts[role];
      if (change === 'role') r.role = 'other';
      if (change === 'kind') r.observationKind = 'new_approval';
      if (change === 'method') r.method = 'timestamp_rewrite';
      if (change === 'reference') r.reference = 'https://unapproved.invalid/private';
      if (change === 'future') r.observedAt = NOW + 1;
      if (change === 'expired') r.observedAt = input.expiresAt - 3600001;
      if (change === 'facts') r.normalizedFacts.changed = true;
      if (change === 'extra') r.unreviewed = true;
      assert.throws(() => prepare(input));
    });
  }
}
test('continuity cannot invent or omit the standing approval reference', () => {
  const { input } = fixture();
  delete input.receipts.ownerAuthorization.normalizedFacts.standingApprovalSha256;
  input.binding.capability.evidence.ownerAuthorization.digest = preparer.evidenceDigest(input.receipts.ownerAuthorization.normalizedFacts);
  input.bindingSha256 = preparer.stageDormant({ binding: input.binding }).bindingSha256;
  assert.throws(() => prepare(input));
});
test('receipt references and standing approval hashes reject trailing newlines', () => {
  const { input } = fixture();
  input.receipts.access.reference += '\n';
  assert.throws(() => prepare(input));
  const second = fixture().input;
  second.receipts.ownerAuthorization.normalizedFacts.standingApprovalSha256 += '\n';
  second.binding.capability.evidence.ownerAuthorization.digest = preparer.evidenceDigest(second.receipts.ownerAuthorization.normalizedFacts);
  second.bindingSha256 = preparer.stageDormant({ binding: second.binding }).bindingSha256;
  assert.throws(() => prepare(second));
});
test('standing approval must be an own string; inherited values and getters cannot supply it', () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, 'standingApprovalSha256');
  const { input } = fixture();
  delete input.receipts.ownerAuthorization.normalizedFacts.standingApprovalSha256;
  input.binding.capability.evidence.ownerAuthorization.digest = preparer.evidenceDigest(input.receipts.ownerAuthorization.normalizedFacts);
  input.bindingSha256 = preparer.stageDormant({ binding: input.binding }).bindingSha256;
  let getters = 0;
  try {
    Object.defineProperty(Object.prototype, 'standingApprovalSha256', { configurable: true, value: 'a'.repeat(64) });
    assert.throws(() => prepare(input));
    Object.defineProperty(Object.prototype, 'standingApprovalSha256', { configurable: true, get() { getters++; return 'a'.repeat(64); } });
    assert.throws(() => prepare(input)); assert.equal(getters, 0);
  } finally {
    if (original) Object.defineProperty(Object.prototype, 'standingApprovalSha256', original);
    else delete Object.prototype.standingApprovalSha256;
  }
});
for (const key of ['stagedAndReadBack', 'sourceAndTargetUnchanged', 'scopeAndCostAuthorized', 'durableConsumptionReady']) {
  test('missing or nonboolean readiness holds: ' + key, () => {
    for (const value of [false, 1, 'true', undefined]) {
      const { input } = fixture(); input.readiness[key] = value;
      assert.throws(() => prepare(input));
    }
  });
}
test('exact 27-second headroom passes; shorter, over-hour and wrong explicit clock hold', () => {
  const { input } = fixture(); input.expiresAt = NOW + 27000;
  assert.equal(prepare(input).guardTimes.latestDispatchAt, NOW);
  for (const expiresAt of [NOW + 26999, NOW + 3600001, NaN, 'later']) assert.throws(() => prepare({ ...input, expiresAt }));
  assert.throws(() => preparer.prepareActivation(input, {}));
  assert.throws(() => preparer.prepareActivation(input, { now: '1800000000000' }));
});
test('wrong exact wire pin and unknown input fields hold', () => {
  const { input } = fixture();
  assert.throws(() => prepare({ ...input, bindingSha256: '0'.repeat(64) }));
  assert.throws(() => prepare({ ...input, execute: true }));
  assert.throws(() => prepare({ ...input, readiness: { ...input.readiness, override: true } }));
});
test('hostile facts and receipt accessors are not invoked', () => {
  let accesses = 0;
  const { input } = fixture();
  Object.defineProperty(input.receipts.access, 'observedAt', { enumerable: true, get() { accesses++; throw Error('SECRET'); } });
  assert.throws(() => prepare(input), /^Error: DORMANT_ACTIVATION_PREPARATION_HELD$/);
  const facts = {}; Object.defineProperty(facts, 'secret', { enumerable: true, get() { accesses++; throw Error('SECRET'); } });
  assert.throws(() => preparer.evidenceDigest(facts)); assert.equal(accesses, 0);
  assert.throws(() => preparer.evidenceDigest(new Proxy({}, { ownKeys() { accesses++; throw Error('SECRET'); } })));
  assert.equal(accesses, 0);
});
test('unsupported facts never silently disappear or coerce into reviewed evidence', () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [{ x: undefined }, { x: NaN }, { x: BigInt(1) }, { x: -0 }, cyclic, { x: new Date() }, { x: [, 1] }]) {
    assert.throws(() => preparer.evidenceDigest(value));
  }
});
test('scope is explicit metadata and cannot be widened by preparation input', () => {
  assert.deepEqual(preparer.LIMITS, { maximumDataStoreAttempts: 13, maximumInsertAttempts: 5,
    maximumActiveRequests: 2, maximumNewSyntheticRows: 5, operationTimeoutMs: 25000,
    requestTimeoutMs: 3000, drainTimeoutMs: 1000 });
  assert.ok(Object.isFrozen(preparer.LIMITS));
  const { input } = fixture(); assert.throws(() => prepare({ ...input, limits: { maximumDataStoreAttempts: 99 } }));
});
test('preparation uses supplied time and nonce without consulting the clock or entropy', () => {
  const { input } = fixture(), saved = { now: Date.now, randomBytes: crypto.randomBytes, randomUUID: crypto.randomUUID };
  const forbidden = () => { throw Error('unexpected clock or nonce generation'); };
  try {
    Date.now = forbidden; crypto.randomBytes = forbidden; crypto.randomUUID = forbidden;
    assert.equal(prepare(input).command.activation.verifiedAt, NOW);
    assert.equal(JSON.parse(preparer.stageDormant({ binding: input.binding }).raw).nonce, 'f'.repeat(32));
  } finally { Date.now = saved.now; crypto.randomBytes = saved.randomBytes; crypto.randomUUID = saved.randomUUID; }
});
function callerFixture() {
  // Synthetic, reviewed-shape Deluge only: no private endpoint or Connection.
  const templateText = 'string automation.synthetic()\n{\n'
    + '\turl = "https://synthetic.invalid/approve";\n'
    + '\tif("__OPERATION_DIGEST__".matches("^[a-f0-9]{64}$") && __TIMEOUT_MS__ == 25000 && dispatch_at >= __VERIFIED_AT__ && dispatch_at + 1000 + __TIMEOUT_MS__ + 1000 <= __EXPIRES_AT__)\n\t{\n'
    + '\t\tbody = __ACTIVATION_COMMAND_JSON__.toMap();\n'
    + '\t\tresponse = invokeurl\n\t\t[\n\t\t\turl:url\n\t\t\ttype:POST\n\t\t\tbody:body.toString()\n\t\t\tconnection:"synthetic_managed"\n\t\t];\n'
    + '\t\tif(result.get("operationDigest") == "__OPERATION_DIGEST__" && observed_at >= __VERIFIED_AT__ && observed_at < __EXPIRES_AT__ && received_at >= __VERIFIED_AT__ && received_at + 1000 <= __EXPIRES_AT__)\n'
    + '\t\t{\n\t\t\treturn "synthetic-only";\n\t\t}\n\t}\n\treturn "held";\n}\n';
  const templateSha256 = crypto.createHash('sha256').update(templateText).digest('hex');
  return { templateText, templateSha256, preparedActivation: prepare(fixture().input) };
}
function repinCaller(input, text) {
  return { ...input, templateText: text, templateSha256: crypto.createHash('sha256').update(text).digest('hex') };
}
test('renderer inserts one escaped constant command and preserves all other reviewed bytes', () => {
  const input = callerFixture(), rendered = preparer.renderActivationCaller(input);
  const quotedBody = /\bbody = ("[^\n]*")\.toMap\(\);/.exec(rendered.text)[1];
  assert.equal(JSON.parse(quotedBody), input.preparedActivation.body);
  assert.deepEqual(JSON.parse(JSON.parse(quotedBody)), input.preparedActivation.command);
  const expected = input.templateText.replaceAll('__ACTIVATION_COMMAND_JSON__', JSON.stringify(input.preparedActivation.body))
    .replaceAll('__OPERATION_DIGEST__', input.preparedActivation.operationDigest)
    .replaceAll('__VERIFIED_AT__', String(NOW)).replaceAll('__EXPIRES_AT__', String(NOW + 120000)).replaceAll('__TIMEOUT_MS__', '25000');
  assert.equal(rendered.text, expected);
  assert.equal((rendered.text.match(/\binvokeurl\b/g) || []).length, 1);
  assert.equal(rendered.sha256, crypto.createHash('sha256').update(rendered.text).digest('hex'));
  assert.equal(rendered.bytes, Buffer.byteLength(rendered.text));
  assert.equal(rendered.grantsExecutionAuthority, false); assert.equal(rendered.providerActions, 0);
  assert.ok(Object.isFrozen(rendered));
});
test('renderer accepts reviewed literal timeout form without changing its bytes', () => {
  const input = callerFixture(), literal = repinCaller(input, input.templateText.replaceAll('__TIMEOUT_MS__', '25000'));
  assert.equal(preparer.renderActivationCaller(literal).text, preparer.renderActivationCaller(input).text);
});
test('renderer refuses unissued or modified prepared objects, including serialized imitations', () => {
  const input = callerFixture();
  for (const preparedActivation of [{}, JSON.parse(JSON.stringify(input.preparedActivation)), { ...input.preparedActivation, body: '{}; injected' }]) {
    assert.throws(() => preparer.renderActivationCaller({ ...input, preparedActivation }));
  }
});
for (const change of ['hash', 'crlf', 'bom', 'finalLF', 'unknownToken', 'digestCount', 'timeCount', 'timeoutCount', 'commandCount', 'commandContext', 'callCount']) {
  test('renderer rejects changed reviewed format: ' + change, () => {
    const input = callerFixture(); let text = input.templateText;
    if (change === 'hash') { assert.throws(() => preparer.renderActivationCaller({ ...input, templateText: text + '\n' })); return; }
    if (change === 'crlf') text = text.replaceAll('\n', '\r\n');
    if (change === 'bom') text = '\uFEFF' + text;
    if (change === 'finalLF') text = text.slice(0, -1);
    if (change === 'unknownToken') text += '// __OTHER_TOKEN__\n';
    if (change === 'digestCount') text = text.replace('__OPERATION_DIGEST__', 'a'.repeat(64));
    if (change === 'timeCount') text = text.replace('__VERIFIED_AT__', String(NOW));
    if (change === 'timeoutCount') text = text.replace('__TIMEOUT_MS__', '25000');
    if (change === 'commandCount') text += '// __ACTIVATION_COMMAND_JSON__\n';
    if (change === 'commandContext') text = text.replace('body = __ACTIVATION_COMMAND_JSON__.toMap();', 'body = "__ACTIVATION_COMMAND_JSON__";');
    if (change === 'callCount') text += '// invokeurl\n';
    assert.throws(() => preparer.renderActivationCaller(repinCaller(input, text)));
  });
}
