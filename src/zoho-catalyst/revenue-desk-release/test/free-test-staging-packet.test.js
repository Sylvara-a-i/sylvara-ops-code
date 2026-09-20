'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { installOfflineGuard } = require('./helpers/offline-guard');
const guard = installOfflineGuard();
const { createStagingFixture }
  = require('../../revenue-desk-call-runtime/functions/revenue_desk_route_control/test/helpers/configuration-staging-fixture');
const { syntheticPreparationInputs } = require('./fixtures/free-test-preparation');
const { canonicalApprovalIntent, routeFingerprint, routeFromRows }
  = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/approval-control');
const { PROFILE, SIGNATURE_DOMAIN, MAX_STAGING_PACKET_BYTES, MAX_SECRET_UTF8_BYTES,
  validateUnsignedStagingEnvelope, signFreeTestStagingPacket }
  = require('../lib/free-test-staging-packet');

// Only synthetic fixtures and fake keys enter this suite. A signed packet is
// exercised against the existing controller with in-memory adapters, never I/O.
function fixture(index = 0) {
  const liveShape = createStagingFixture(index);
  const preparation = syntheticPreparationInputs()[index];
  preparation.classification = 'private-preparation';
  preparation.review = structuredClone(liveShape.request.review);
  const request = structuredClone(liveShape.request);
  delete request.signature;
  return { liveShape, envelope: { schemaVersion: 1, preparation, preservedCoreApproval: null, request },
    options: { expectedRevision: liveShape.config.sourceRevision,
      expectedOperatorHash: liveShape.config.operatorIdHash, now: liveShape.now(), maxBodyBytes: 16384 } };
}

function sign(f) {
  const secret = Buffer.from(f.liveShape.config.operatorVerificationSecret, 'ascii');
  try { return signFreeTestStagingPacket(f.envelope, { ...f.options, secret }); }
  finally { secret.fill(0); }
}

function assertNoSyntheticPrivateValues(error, f) {
  const exposed = `${error?.message || ''}\n${error?.stack || ''}`;
  for (const value of [f.liveShape.config.operatorVerificationSecret,
    f.envelope.preparation.crm.deal.Alert_Recipient_Email,
    f.envelope.preparation.crm.account.Account_Name,
    f.envelope.request.intent.operator_id_hash]) {
    assert.equal(exposed.includes(value), false);
  }
}

test('owner packet signs the exact existing staging domain and stages inactive through fake adapters', async () => {
  const f = fixture(); const before = structuredClone(f.envelope);
  const result = sign(f);
  assert.equal(PROFILE, f.envelope.request.profile);
  assert.equal(SIGNATURE_DOMAIN, 'revenue-desk-configuration-staging-intent-v1\0');
  assert.equal(MAX_STAGING_PACKET_BYTES, 16384);
  assert.equal(result.serialized, `${JSON.stringify(result.packet)}\n`);
  assert.equal(result.byteLength, Buffer.byteLength(result.serialized, 'utf8'));
  assert.equal(result.sha256, crypto.createHash('sha256').update(result.serialized).digest('hex'));
  assert.equal(result.packet.signature, f.liveShape.request.signature);
  assert.deepEqual(f.envelope, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.packet), true);
  const outcome = await f.liveShape.service.stage(result.packet);
  assert.equal(outcome.state, 'StagedInactive');
  assert.equal(outcome.active, false); assert.equal(outcome.approved, false);
  const deployment = f.liveShape.store.rowsFor(f.liveShape.config.tables.DEPLOYMENT_TABLE)[0];
  assert.equal(deployment.ACTUAL_START_AT, null); assert.equal(deployment.EXPIRES_AT, null);
  const writes = f.liveShape.store.writes.length;
  assert.equal((await f.liveShape.service.stage(result.packet)).replayed, true);
  assert.equal(f.liveShape.store.writes.length, writes);
});

test('unsigned validation never adds a signature or mutates the reviewed envelope', () => {
  const f = fixture(); const before = structuredClone(f.envelope);
  const result = validateUnsignedStagingEnvelope(f.envelope, f.options);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.hasOwn(result.packet, 'signature'), false);
  assert.equal(result.canonicalIntent, canonicalApprovalIntent(f.envelope.request.intent));
  assert.deepEqual(f.envelope, before);
});

test('ordinary approval and activation signatures cannot authorize the staged packet', async () => {
  for (const domain of ['revenue-desk-approval-intent-v1\0', 'revenue-desk-activation-intent-v1\0']) {
    const f = fixture(); const request = structuredClone(sign(f).packet);
    request.signature = `v1=${crypto.createHmac('sha256', f.liveShape.config.operatorVerificationSecret)
      .update(domain).update(canonicalApprovalIntent(request.intent)).digest('hex')}`;
    await assert.rejects(f.liveShape.service.stage(request), { code: 'INVALID_APPROVAL_SIGNATURE' });
    assert.equal(f.liveShape.store.writes.length, 0);
  }
});

test('post-sign edits to content, intent, target and recipient reject without a write', async () => {
  for (const mutate of [
    (r) => { r.configurationRow.CONFIGURATION_JSON += ' '; },
    (r) => { r.intent.event_id = `approval_${'a'.repeat(64)}`; },
    (r) => { r.intent.operator_id_hash = `operator_${'b'.repeat(64)}`; },
    (r) => { r.deployment.MONITOR_AGENT_ID = 'synthetic_wrong_agent'; },
    (r) => { r.dealId = '400000009'; },
    (r) => { r.review.notificationRecipientId = 'synthetic_wrong_recipient'; },
  ]) {
    const f = fixture(); const request = structuredClone(sign(f).packet); mutate(request);
    await assert.rejects(f.liveShape.service.stage(request));
    assert.equal(f.liveShape.store.writes.length, 0);
  }
});

test('different businesses cannot exchange preparation, request or owner context', () => {
  const a = fixture(0); const b = fixture(1);
  assert.notEqual(sign(a).sha256, sign(b).sha256);
  for (const key of ['preparation', 'request']) {
    const f = fixture(0); f.envelope[key] = b.envelope[key];
    assert.throws(() => sign(f));
  }
  assert.throws(() => validateUnsignedStagingEnvelope(a.envelope,
    { ...a.options, expectedOperatorHash: `operator_${'9'.repeat(64)}` }));
  assert.throws(() => validateUnsignedStagingEnvelope(a.envelope,
    { ...a.options, expectedRevision: 'f'.repeat(40) }));
});

test('rejects stale, future, noncanonical and mismatched timestamp evidence', () => {
  const changes = [
    (f) => { f.options.now += 300001; },
    (f) => { f.envelope.request.intent.requested_at = new Date(f.options.now + 1).toISOString(); },
    (f) => { f.envelope.request.intent.evidence_observed_at = new Date(f.options.now + 1).toISOString(); },
    (f) => { f.envelope.request.intent.evidence_observed_at = new Date(f.options.now - 900001).toISOString();
      f.envelope.preparation.evidence.capturedAt = f.envelope.request.intent.evidence_observed_at; },
    (f) => { f.envelope.request.intent.evidence_observed_at = new Date(f.options.now - 1).toISOString(); },
    (f) => { f.envelope.request.intent.requested_at = '2026-09-09T12:00:00Z'; },
    (f) => { f.options.now = Number.NaN; },
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => sign(f)); }
});

test('freshness boundary is inclusive only for a matching reviewed snapshot', () => {
  const f = fixture(); f.options.now += 300000;
  assert.match(sign(f).packet.signature, /^v1=[a-f0-9]{64}$/);
  f.options.now += 1; assert.throws(() => sign(f));
});

test('missing monitoring acknowledgment, invalid phone and unresolved timing block signing', () => {
  for (const change of [
    (f) => { delete f.envelope.preparation.review.notificationHandoff; },
    (f) => { f.envelope.preparation.review.notificationHandoff.monitored = false; },
    (f) => { f.envelope.preparation.crm.account.Phone = '(913) 555-0101'; },
    (f) => { f.envelope.preparation.crm.deal.Approved_Test_Route = 'Both';
      f.envelope.preparation.crm.deal.No_Answer_Delay = 'Four Rings'; },
    (f) => { f.envelope.preparation.evidence.proof.STATUS = 'verified'; },
  ]) {
    const f = fixture(); change(f); f.envelope.request.review = structuredClone(f.envelope.preparation.review);
    assert.throws(() => sign(f));
  }
});

test('a preserved core approval must match the previously approved source and is not recreated', async () => {
  const f = fixture();
  await f.liveShape.core.approve(f.liveShape.coreApprovalCommand);
  f.envelope.preparation.crm = structuredClone(f.liveShape.records);
  f.envelope.preservedCoreApproval = {
    configurationVersionId: f.liveShape.records.deal.Approved_Configuration_Version,
    approvedAt: f.liveShape.records.deal.Go_Live_Approved_At,
  };
  const result = sign(f);
  assert.equal((await f.liveShape.service.stage(result.packet)).state, 'StagedInactive');
  assert.equal(f.liveShape.records.deal.Go_Live_Approved_At, f.envelope.preservedCoreApproval.approvedAt);
  for (const replacement of [null, {}, { ...f.envelope.preservedCoreApproval, extra: true },
    { ...f.envelope.preservedCoreApproval, configurationVersionId: 'wrong_synthetic_version' },
    { ...f.envelope.preservedCoreApproval, approvedAt: '2026-09-09T11:59:59.000Z' }]) {
    const changed = { ...f.envelope, preservedCoreApproval: replacement };
    assert.throws(() => validateUnsignedStagingEnvelope(changed, f.options));
  }
});

test('extra unsigned request, row, deployment and intent fields are rejected', () => {
  for (const target of [[], ['request'], ['request', 'configurationRow'], ['request', 'deployment'], ['request', 'intent']]) {
    const f = fixture(); let selected = f.envelope;
    for (const key of target) selected = selected[key];
    selected.unsafeExtra = 'SYNTHETIC_PRIVATE_SENTINEL';
    assert.throws(() => sign(f));
  }
  for (const change of [
    (f) => { f.envelope.request.signature = ''; },
    (f) => { f.envelope.request.operatorVerificationSecret = f.liveShape.config.operatorVerificationSecret; },
    (f) => { f.envelope.preparation.classification = 'synthetic-demonstration'; },
    (f) => { f.envelope.schemaVersion = 2; },
  ]) { const f = fixture(); change(f); assert.throws(() => sign(f)); }
});

test('review rejects unsigned operational extras and partial reporting bindings even on both copies', () => {
  for (const patch of [{ liveEmailEnabled: true }, { operatorVerificationSecret: 'synthetic-key' },
    { analyticsClientKey: 'a'.repeat(64) }, { analyticsDeploymentKey: 'b'.repeat(64) },
    { reportBaseline: { sourcePeriod: {}, currency: 'USD', evidenceClass: 'customer_supplied_estimate' } }]) {
    const f = fixture(); Object.assign(f.envelope.preparation.review, patch);
    f.envelope.request.review = structuredClone(f.envelope.preparation.review);
    assert.throws(() => sign(f));
  }
});

test('source target, owner, counters and approved candidate bytes must match exactly', () => {
  const changes = [
    (f) => { f.envelope.request.profile = 'caller_selected'; },
    (f) => { f.envelope.request.intent.action = 'revoke'; },
    (f) => { f.envelope.request.intent.expected_deployment_version = 1; },
    (f) => { f.envelope.request.deployment.HANDLED_COUNT = 1; },
    (f) => { f.envelope.request.deployment.CALL_LIMIT = 26; },
    (f) => { f.envelope.request.deployment.SOURCE_ENVIRONMENT = 'production'; },
    (f) => { f.envelope.request.configurationRow.STATUS = 'Draft'; },
    (f) => { f.envelope.request.configurationRow.CONFIGURATION_JSON += ' '; },
    (f) => { f.envelope.request.intent.route_fingerprint = `route_${'0'.repeat(64)}`; },
    (f) => { f.envelope.request.form2ConfigurationVersion = 'synthetic_wrong_version'; },
    (f) => { f.envelope.request.deployment.DEPLOYMENT_ID = 'caller_selected_deployment'; },
    (f) => { f.envelope.request.review.callbackExpectation = 'Edited callback promise'; },
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => sign(f)); }
});

test('internally recomputed route cannot bypass preparation-to-content comparison', () => {
  const f = fixture();
  const content = JSON.parse(f.envelope.request.configurationRow.CONFIGURATION_JSON);
  content.notificationRecipient.email = 'edited@example.invalid';
  f.envelope.request.configurationRow.CONFIGURATION_JSON = JSON.stringify(content);
  f.envelope.request.intent.route_fingerprint = routeFingerprint(routeFromRows(
    f.envelope.request.deployment, f.envelope.request.configurationRow));
  assert.throws(() => sign(f));
});

test('internally consistent route cannot sign a journey identifier rejected by the controller', () => {
  const f = fixture(); const journey = 'synthetic invalid journey';
  const deploymentId = `cfgdeploy_${crypto.createHash('sha256')
    .update(JSON.stringify(['development', f.envelope.request.dealId, journey])).digest('hex')}`;
  f.envelope.request.journeyId = journey;
  f.envelope.preparation.crm.deal.Intake_Submission_ID = journey;
  f.envelope.preparation.evidence.nativeConversion.intakeSubmissionId = journey;
  f.envelope.preparation.review.deploymentId = deploymentId;
  f.envelope.request.review = structuredClone(f.envelope.preparation.review);
  const { prepareFreeTestConfiguration } = require('../lib/free-test-preparation');
  const candidate = prepareFreeTestConfiguration(f.envelope.preparation, { now: f.options.now }).candidate;
  assert.ok(candidate);
  f.envelope.request.configurationRow.DEPLOYMENT_ID = deploymentId;
  f.envelope.request.configurationRow.CONFIGURATION_JSON = JSON.stringify({ ...candidate, approved: true,
    notificationRecipient: { ...candidate.notificationRecipient, approved: true } });
  f.envelope.request.deployment.DEPLOYMENT_ID = deploymentId;
  f.envelope.request.intent.deployment_id = deploymentId;
  f.envelope.request.intent.route_fingerprint = routeFingerprint(routeFromRows(
    f.envelope.request.deployment, f.envelope.request.configurationRow));
  assert.throws(() => sign(f));
});

test('secret requires a bounded valid UTF-8 buffer and never enters returned packet or error text', () => {
  const f = fixture();
  for (const secret of [null, 'synthetic-text-is-not-a-buffer', Buffer.alloc(31, 65),
    Buffer.alloc(4097, 65), Buffer.alloc(MAX_SECRET_UTF8_BYTES + 1, 65),
    Buffer.from([0xed, 0xa0, 0x80]), Buffer.alloc(32, 128), Buffer.alloc(32, 0xe1)]) {
    try {
      assert.throws(() => signFreeTestStagingPacket(f.envelope, { ...f.options, secret }),
        (error) => { assertNoSyntheticPrivateValues(error, f); return true; });
    } finally { if (Buffer.isBuffer(secret)) secret.fill(0); }
  }
  for (const length of [32, 4096]) {
    const secret = Buffer.alloc(length, 65);
    try {
      const result = signFreeTestStagingPacket(f.envelope, { ...f.options, secret });
      assert.equal(result.serialized.includes('A'.repeat(32)), false);
      assert.equal(result.serialized.includes(f.liveShape.config.operatorVerificationSecret), false);
    } finally { secret.fill(0); }
  }
});

test('runtime-supported whitespace, BMP and supplementary secrets produce the exact runtime HMAC', async () => {
  for (const text of [' ' + 'x'.repeat(30) + ' ', 'x'.repeat(16) + '\t' + 'y'.repeat(16),
    'x'.repeat(31) + '\n', 'é'.repeat(32), '漢'.repeat(4096), '😀'.repeat(16), '😀'.repeat(2048)]) {
    const f = fixture(); const secret = Buffer.from(text, 'utf8');
    const runtimeSignature = `v1=${crypto.createHmac('sha256', text)
      .update(SIGNATURE_DOMAIN).update(canonicalApprovalIntent(f.envelope.request.intent)).digest('hex')}`;
    try {
      const result = signFreeTestStagingPacket(f.envelope, { ...f.options, secret });
      assert.equal(result.packet.signature, runtimeSignature);
      assert.equal(result.serialized.includes(text), false);
      f.liveShape.config.operatorVerificationSecret = text;
      assert.equal((await f.liveShape.service.stage(result.packet)).state, 'StagedInactive');
    } finally { secret.fill(0); }
  }
  for (const text of ['😀'.repeat(15), '漢'.repeat(4097), '😀'.repeat(2049)]) {
    const f = fixture(); const secret = Buffer.from(text, 'utf8');
    try { assert.throws(() => signFreeTestStagingPacket(f.envelope, { ...f.options, secret })); }
    finally { secret.fill(0); }
  }
});

test('invalid JSON contents and private values are not interpolated in thrown diagnostics', () => {
  const f = fixture();
  f.envelope.request.configurationRow.CONFIGURATION_JSON
    = `{"private":"${f.envelope.preparation.crm.deal.Alert_Recipient_Email}`;
  assert.throws(() => sign(f), (error) => { assertNoSyntheticPrivateValues(error, f); return true; });
});

test('packet byte ceiling is enforced without truncating a private field', () => {
  const f = fixture();
  f.envelope.preparation.review.rollbackInstructions = 'é'.repeat(MAX_STAGING_PACKET_BYTES);
  f.envelope.request.review = structuredClone(f.envelope.preparation.review);
  assert.throws(() => sign(f));
  assert.equal(f.envelope.request.review.rollbackInstructions.length, MAX_STAGING_PACKET_BYTES);
});

test('individually valid multibyte fields cannot exceed the complete serialized packet budget', () => {
  const f = fixture();
  const review = f.envelope.preparation.review;
  // These lists satisfy individual item/count limits and remain valid runtime
  // configuration text, but appear in both the reviewed input and final packet.
  review.unsupportedServices = Array.from({ length: 20 }, (_, i) => `synthetic_${i}_${'é'.repeat(95)}`);
  review.urgentConditions = Array.from({ length: 15 }, (_, i) => `synthetic_${i}_${'é'.repeat(95)}`);
  f.envelope.request.review = structuredClone(review);
  const { prepareFreeTestConfiguration } = require('../lib/free-test-preparation');
  const prepared = prepareFreeTestConfiguration(f.envelope.preparation, { now: f.options.now });
  assert.equal(prepared.status, 'prepared_local_only'); assert.deepEqual(prepared.unresolved, []);
  const candidate = prepared.candidate;
  f.envelope.request.configurationRow.CONFIGURATION_JSON = JSON.stringify({ ...candidate, approved: true,
    notificationRecipient: { ...candidate.notificationRecipient, approved: true } });
  f.envelope.request.intent.route_fingerprint = routeFingerprint(routeFromRows(
    f.envelope.request.deployment, f.envelope.request.configurationRow));
  const unsignedBytes = Buffer.byteLength(JSON.stringify(f.envelope.request), 'utf8');
  assert.ok(unsignedBytes > MAX_STAGING_PACKET_BYTES);
  assert.throws(() => sign(f));
});

test('module has no live client, file access, environment key loading or diagnostics', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/free-test-staging-packet.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:)?(?:fs|https?|net|tls|child_process|zcatalyst|retell)/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|setInterval)\s*\(|process\.env|console\./);
  assert.deepEqual(guard.blocked, []);
});
test('owner packet rejects the reviewed 4096-byte limit before key entry for a larger valid request', () => {
  const f = fixture();
  const projected = Buffer.byteLength(`${JSON.stringify({
    ...f.envelope.request, signature: `v1=${'0'.repeat(64)}`,
  })}\n`, 'utf8');
  assert.ok(projected > 4096);
  assert.throws(() => validateUnsignedStagingEnvelope(f.envelope, {
    ...f.options, maxBodyBytes: 4096,
  }), { code: 'STAGING_PACKET_TOO_LARGE' });
  assert.equal(f.liveShape.store.writes.length, 0);
});

test('owner packet requires an explicit valid observed body limit instead of assuming the ceiling', () => {
  const f = fixture();
  for (const maxBodyBytes of [undefined, null, 511, 16385, 6000.5, '16384']) {
    assert.throws(() => validateUnsignedStagingEnvelope(f.envelope, {
      ...f.options, maxBodyBytes,
    }), { code: 'INVALID_STAGING_SIGNING_CONTEXT' });
  }
});

test('owner packet obeys exact UTF-8 body-byte boundaries including signature and newline', () => {
  const f = fixture();
  const signed = sign(f);
  assert.equal(validateUnsignedStagingEnvelope(f.envelope, {
    ...f.options, maxBodyBytes: signed.byteLength,
  }).maxBodyBytes, signed.byteLength);
  assert.throws(() => validateUnsignedStagingEnvelope(f.envelope, {
    ...f.options, maxBodyBytes: signed.byteLength - 1,
  }), { code: 'STAGING_PACKET_TOO_LARGE' });
  const secret = Buffer.from(f.liveShape.config.operatorVerificationSecret, 'utf8');
  try {
    assert.equal(signFreeTestStagingPacket(f.envelope, {
      ...f.options, secret, maxBodyBytes: signed.byteLength,
    }).maxBodyBytes, signed.byteLength);
  } finally { secret.fill(0); }
});

test('synthetic controller HTTP boundary and signer enforce the same selected byte budget', async () => {
  const { readBody } = require('../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/http-boundary');
  const f = fixture(); const signed = sign(f);
  const request = { headers: { 'content-type': 'application/json',
    'content-length': String(signed.byteLength) }, rawBody: Buffer.from(signed.serialized) };
  await assert.rejects(readBody(request, 4096), (error) => error.httpStatus === 413);
  assert.deepEqual(await readBody(request, signed.byteLength), signed.packet);
  assert.throws(() => validateUnsignedStagingEnvelope(f.envelope, {
    ...f.options, maxBodyBytes: 4096,
  }), { code: 'STAGING_PACKET_TOO_LARGE' });
  assert.equal(f.liveShape.store.writes.length, 0);
});
