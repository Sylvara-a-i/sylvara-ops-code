'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
// Only this explicit test harness can launch the reviewed local CLI. The child
// is preloaded with the same SDK/network/process-denial guard as the demo.
const { spawnSync } = require('node:child_process');
const { installOfflineGuard } = require('./helpers/offline-guard');
const guard = installOfflineGuard();
const { createStagingFixture }
  = require('../../revenue-desk-call-runtime/functions/revenue_desk_route_control/test/helpers/configuration-staging-fixture');
const { syntheticPreparationInputs, SYNTHETIC_NOW } = require('./fixtures/free-test-preparation');
const SCRIPT = path.resolve(__dirname, '../scripts/sign-free-test-staging-packet.js');
const GUARD = path.resolve(__dirname, 'helpers/offline-guard.js');
const WINDOWS_HELPER = path.resolve(__dirname, '../scripts/sign-free-test-staging-packet-private.ps1');
const POWERSHELL = path.resolve(path.dirname(process.execPath), '../../native/powershell/pwsh.exe');
const { MAX_SECRET_UTF8_BYTES, MAX_BINDING_SECRET_BYTES, deriveStagingBindings,
  signFreeTestStagingPacket, RECONCILIATION_PROFILE, signFreeTestReconciliationPacket }
  = require('../lib/free-test-staging-packet');

function protectSyntheticDirectory(directory, { publicRead = false } = {}) {
  if (process.platform !== 'win32') { fs.chmodSync(directory, publicRead ? 0o755 : 0o700); return; }
  assert.ok(path.basename(directory).startsWith('sylvara-synthetic-owner-packet-'));
  const fixture = path.join(directory, 'synthetic-acl-fixture.ps1');
  fs.writeFileSync(fixture, `param([string]$LiteralPath, [switch]$PublicRead)
$ErrorActionPreference = 'Stop'
if ([IO.Path]::GetFileName($LiteralPath) -notlike 'sylvara-synthetic-owner-packet-*') { throw 'Synthetic target required' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$allow = [Security.AccessControl.AccessControlType]::Allow
$none = [Security.AccessControl.PropagationFlags]::None
foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', $inherit, $none, $allow))
}
if ($PublicRead) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'), 'ReadAndExecute', $inherit, $none, $allow)) }
Set-Acl -LiteralPath $LiteralPath -AclObject $acl
`, { flag: 'w' });
  const result = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fixture,
    '-LiteralPath', directory, ...(publicRead ? ['-PublicRead'] : [])], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { SystemRoot: process.env.SystemRoot || '' }, input: '',
  });
  assert.equal(result.status, 0, 'Synthetic fixture ACL preparation must succeed without an execution-policy override.');
}

function childGuard(value) {
  // The only exception is the fixed read-only sibling ACL helper. It receives
  // no key or business contents; every other child/SDK/network remains denied.
  return `const cp = require('node:child_process'); const originalSpawn = cp.spawnSync;
require(${JSON.stringify(GUARD)}).installOfflineGuard();
cp.spawnSync = function(executable, args, options) {
  const exact = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', ${JSON.stringify(WINDOWS_HELPER)},
    '-CheckPrivatePaths', '-InputPath', ${JSON.stringify(value.input)}, '-OutputPath', ${JSON.stringify(value.output)}];
  if (executable !== ${JSON.stringify(POWERSHELL)} || !Array.isArray(args)
      || (args.length !== exact.length && args.length !== exact.length + 1)
      || !exact.every((entry, i) => entry === args[i])
      || (args.length > exact.length && args[exact.length] !== '-OutputExists')
      || options.input !== '' || Object.keys(options.env).join(',') !== 'SystemRoot'
      || options.timeout !== 15000 || options.maxBuffer !== 4096 || options.windowsHide !== true) {
    throw new Error('UNEXPECTED_SUBPROCESS_BOUNDARY');
  }
  return originalSpawn.call(this, executable, args, options);
};
`;
}

function freshen(value, delta) {
  if (Array.isArray(value)) return value.map((item) => freshen(item, delta));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freshen(item, delta)]));
  }
  if (typeof value === 'string' && /^2026-09-09T\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) {
    return new Date(Date.parse(value) + delta).toISOString();
  }
  return value;
}

function files(t, { publicRead = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sylvara-synthetic-owner-packet-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  protectSyntheticDirectory(directory, { publicRead });
  const f = createStagingFixture();
  const preparation = syntheticPreparationInputs()[0];
  preparation.classification = 'private-preparation';
  preparation.review = structuredClone(f.request.review);
  const request = structuredClone(f.request); delete request.signature;
  const envelope = { schemaVersion: 1, preparation, preservedCoreApproval: null, request };
  // The signed candidate contains timestamps inside its JSON string, so rebuild
  // it after freshening to preserve exact source-to-candidate content equality.
  const shifted = freshen(envelope, Date.now() - SYNTHETIC_NOW - 1000);
  const { prepareFreeTestConfiguration } = require('../lib/free-test-preparation');
  const { routeFingerprint, routeFromRows }
    = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/approval-control');
  const candidate = prepareFreeTestConfiguration(shifted.preparation, { now: Date.now() }).candidate;
  shifted.request.configurationRow.CONFIGURATION_JSON = JSON.stringify({ ...candidate, approved: true,
    notificationRecipient: { ...candidate.notificationRecipient, approved: true } });
  shifted.request.intent.route_fingerprint = routeFingerprint(routeFromRows(shifted.request.deployment,
    shifted.request.configurationRow));
  const input = path.join(directory, 'input.json');
  const output = path.join(directory, 'signed.json');
  const preload = path.join(directory, 'offline.cjs');
  fs.writeFileSync(input, JSON.stringify(shifted), { flag: 'wx', mode: 0o600 });
  const value = { directory, input, output, preload, envelope: shifted, f };
  fs.writeFileSync(preload, childGuard(value), { flag: 'wx' });
  return value;
}

function run(value, extraArgs = [], overrides = {}) {
  const args = ['--require', value.preload, SCRIPT, '--input', value.input, '--output', value.output,
    '--expected-revision', value.expectedRevision || value.f.config.sourceRevision,
    '--expected-operator-hash', value.f.config.operatorIdHash,
    ...(value.omitBodyLimit ? [] : ['--max-body-bytes', String(value.maxBodyBytes || 16384)]),
    ...(process.platform === 'win32' ? ['--powershell-path', POWERSHELL] : []), ...extraArgs];
  return spawnSync(process.execPath, args, {
    cwd: value.directory, input: Buffer.from(value.f.config.operatorVerificationSecret, 'ascii'),
    // The Windows CLI has two separately bounded 15-second local ACL checks.
    // Let those return their own failure instead of killing their parent early.
    encoding: 'utf8', timeout: process.platform === 'win32' ? 45000 : 10000, windowsHide: true,
    env: { SystemRoot: process.env.SystemRoot || '', TEMP: value.directory, TMP: value.directory },
    ...overrides,
  });
}

function assertSafeOutput(result, value) {
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const original = value.envelope.originalEnvelope || value.envelope;
  for (const sensitive of [value.f.config.operatorVerificationSecret,
    original.request.intent.operator_id_hash,
    original.preparation.crm.deal.Alert_Recipient_Email,
    original.preparation.crm.account.Account_Name,
    value.input, value.output]) {
    assert.equal(output.includes(sensitive), false);
  }
  assert.equal(output.includes('v1='), false);
}

function bindingFiles(t) {
  const value = files(t);
  value.bindingInput = { schemaVersion: 1, environment: 'development', crmOrganizationId: '900000001',
    operatorIdentity: 'synthetic_operator', testPhoneNumber: '+12025550101',
    clientId: 'synthetic_client', deploymentId: `cfgdeploy_${'a'.repeat(64)}` };
  value.bindingSecrets = { numberSecret: 'synthetic_number_'.repeat(3), eventChainSecret: 'synthetic_event_'.repeat(3),
    analyticsPartitionSecret: 'synthetic_analytics_'.repeat(3) };
  fs.writeFileSync(value.input, JSON.stringify(value.bindingInput));
  return value;
}

function runBindings(value, extraArgs = [], overrides = {}) {
  const protectedInput = Buffer.from(JSON.stringify(value.bindingSecrets), 'utf8');
  try {
    return spawnSync(process.execPath, ['--require', value.preload, SCRIPT, '--derive-bindings',
      '--input', value.input, '--output', value.output,
      ...(process.platform === 'win32' ? ['--powershell-path', POWERSHELL] : []), ...extraArgs], {
      cwd: value.directory, input: protectedInput, encoding: 'utf8',
      timeout: process.platform === 'win32' ? 45000 : 10000, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot || '', TEMP: value.directory, TMP: value.directory }, ...overrides,
    });
  } finally { protectedInput.fill(0); }
}

function forbidProtectedInput(value) {
  fs.appendFileSync(value.preload, "const before = require('node:fs').readSync; require('node:fs').readSync = function(fd, ...args) { "
    + "if (fd === 0) { process.stderr.write('UNEXPECTED_KEY_READ\\n'); throw new Error('No stdin allowed'); } return before.call(this, fd, ...args); };\n");
}

function reconciliationFiles(t) {
  const value = files(t);
  const secret = Buffer.from(value.f.config.operatorVerificationSecret, 'utf8');
  let original;
  try { original = signFreeTestStagingPacket(value.envelope, { secret,
    expectedRevision: value.f.config.sourceRevision, expectedOperatorHash: value.f.config.operatorIdHash,
    maxBodyBytes: 16384, now: Date.now() }).packet; }
  finally { secret.fill(0); }
  const { configurationSnapshotFingerprint, routeFingerprint, routeFromRows }
    = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/approval-control');
  const { successorConfigurationRow, successorDeployment }
    = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/configuration-reconciliation');
  const claimKey = `cfgstage_${'1'.repeat(64)}`;
  value.expectedRevision = 'f'.repeat(40);
  const row = successorConfigurationRow(original, claimKey, value.expectedRevision);
  const deployment = successorDeployment(original, claimKey, value.expectedRevision);
  const at = new Date().toISOString();
  const intent = { schema_version: 1, action: 'reconcile_configuration', original_claim_key: claimKey,
    original_claim_fingerprint: '2'.repeat(64), original_request_fingerprint: '3'.repeat(64),
    original_configuration_version_id: original.configurationRow.CONFIGURATION_VERSION_ID,
    original_configuration_fingerprint: configurationSnapshotFingerprint(original.configurationRow),
    original_source_revision: value.f.config.sourceRevision, target_source_revision: value.expectedRevision,
    deployment_id: original.deployment.DEPLOYMENT_ID, configuration_version_id: row.CONFIGURATION_VERSION_ID,
    route_fingerprint: routeFingerprint(routeFromRows(deployment, row)), expected_receipt_version: 0,
    operator_id_hash: value.f.config.operatorIdHash, evidence_observed_at: at, requested_at: at };
  value.envelope = { schemaVersion: 1, originalEnvelope: value.envelope,
    request: { profile: RECONCILIATION_PROFILE, originalRequest: original, intent } };
  fs.writeFileSync(value.input, JSON.stringify(value.envelope));
  return value;
}

test('reconciliation CLI validates without stdin and exclusively signs without exposing either signature', (t) => {
  const value = reconciliationFiles(t); forbidProtectedInput(value);
  const preflight = run(value, ['--validate-only'], { input: '' });
  assert.equal(preflight.status, 0, preflight.stderr); assertSafeOutput(preflight, value);
  assert.equal(JSON.parse(preflight.stdout).profile, RECONCILIATION_PROFILE);
  assert.equal(JSON.parse(preflight.stdout).signaturePresent, false);
  assert.equal(fs.existsSync(value.output), false);
  assert.doesNotMatch(preflight.stderr, /UNEXPECTED_KEY_READ/);
  fs.writeFileSync(value.preload, childGuard(value));
  const result = run(value); assert.equal(result.status, 0, result.stderr); assertSafeOutput(result, value);
  const verdict = JSON.parse(result.stdout); const bytes = fs.readFileSync(value.output);
  const secret = Buffer.from(value.f.config.operatorVerificationSecret, 'utf8');
  try { assert.equal(bytes.toString('utf8'), signFreeTestReconciliationPacket(value.envelope, { secret,
    expectedRevision: value.expectedRevision, expectedOperatorHash: value.f.config.operatorIdHash,
    maxBodyBytes: 16384, now: Date.now() }).serialized); }
  finally { secret.fill(0); }
  assert.equal(verdict.profile, RECONCILIATION_PROFILE);
  assert.equal(verdict.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(verdict.submitted, false); assert.equal(verdict.retryAllowed, false);
  assert.equal(run(value).status, 1); assert.deepEqual(fs.readFileSync(value.output), bytes);
});

test('reconciliation CLI rejects wrong profiles, stale intent and over-budget nested packets before key entry', (t) => {
  for (const mutate of [
    (value) => { value.envelope.request.profile = 'unapproved-profile'; },
    (value) => { value.envelope.request.intent.requested_at = '2020-01-01T00:00:00.000Z'; },
    (value) => { value.maxBodyBytes = Buffer.byteLength(`${JSON.stringify({
      ...value.envelope.request, signature: `v1=${'0'.repeat(64)}`,
    })}\n`) - 1; },
  ]) {
    const value = reconciliationFiles(t); mutate(value);
    fs.writeFileSync(value.input, JSON.stringify(value.envelope)); forbidProtectedInput(value);
    const result = run(value); assert.equal(result.status, 1); assertSafeOutput(result, value);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_KEY_READ/);
    assert.equal(fs.existsSync(value.output), false);
  }
});

test('reconciliation CLI rejects an unverified original signature without creating output', (t) => {
  const value = reconciliationFiles(t);
  value.envelope = structuredClone(value.envelope);
  value.envelope.request.originalRequest.signature = `v1=${'0'.repeat(64)}`;
  fs.writeFileSync(value.input, JSON.stringify(value.envelope));
  const result = run(value); assert.equal(result.status, 1); assertSafeOutput(result, value);
  assert.equal(fs.existsSync(value.output), false);
});

test('binding CLI exclusively writes runtime-compatible private bindings, never a signed packet', (t) => {
  const value = bindingFiles(t); const result = runBindings(value);
  assert.equal(result.status, 0, result.stderr); assertSafeOutput(result, value);
  const verdict = JSON.parse(result.stdout); const bytes = fs.readFileSync(value.output);
  const input = Buffer.from(JSON.stringify(value.bindingSecrets), 'utf8');
  try { assert.equal(bytes.toString('utf8'), deriveStagingBindings(value.bindingInput, { protectedInput: input }).serialized); }
  finally { input.fill(0); }
  assert.equal(verdict.status, 'DERIVED_PRIVATE_BINDINGS_NOT_SIGNED');
  assert.equal(verdict.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(verdict.byteLength, bytes.length); assert.equal(verdict.signaturePresent, false);
  assert.equal(verdict.submitted, false); assert.equal(verdict.retryAllowed, false);
  for (const secret of Object.values(value.bindingSecrets)) {
    assert.equal(`${result.stdout}${result.stderr}${bytes.toString('utf8')}`.includes(secret), false);
  }
  const again = runBindings(value);
  assert.equal(again.status, 1); assertSafeOutput(again, value);
  assert.deepEqual(fs.readFileSync(value.output), bytes);
});

test('binding validate-only performs nonsecret preflight without stdin or output', (t) => {
  const value = bindingFiles(t); forbidProtectedInput(value);
  const result = runBindings(value, ['--validate-only'], { input: '' });
  assert.equal(result.status, 0); assertSafeOutput(result, value);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.status, 'VALIDATED_BINDING_INPUT_NO_SECRET');
  assert.equal(verdict.signaturePresent, false); assert.equal(verdict.submitted, false);
  assert.equal(verdict.retryAllowed, false); assert.equal(fs.existsSync(value.output), false);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_KEY_READ/);
});

test('binding mode rejects invalid input and signing-only arguments before protected entry', (t) => {
  for (const mode of ['wrong_environment', 'extra_field', 'duplicate_key', 'existing_output', 'signing_args', 'duplicate_mode']) {
    const value = bindingFiles(t); forbidProtectedInput(value);
    let args = [];
    if (mode === 'wrong_environment') value.bindingInput.environment = 'production';
    if (mode === 'extra_field') value.bindingInput.expectedRevision = 'a'.repeat(40);
    fs.writeFileSync(value.input, JSON.stringify(value.bindingInput));
    if (mode === 'duplicate_key') fs.writeFileSync(value.input,
      JSON.stringify(value.bindingInput).replace('"schemaVersion":1', '"schemaVersion":2,"schemaVersion":1'));
    if (mode === 'existing_output') fs.writeFileSync(value.output, 'SYNTHETIC EXISTING EVIDENCE');
    if (mode === 'signing_args') args = ['--max-body-bytes', '16384'];
    if (mode === 'duplicate_mode') args = ['--derive-bindings'];
    const result = runBindings(value, args);
    assert.equal(result.status, 1); assertSafeOutput(result, value);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_KEY_READ/);
    assert.equal(fs.existsSync(value.output), mode === 'existing_output');
  }
});

test('binding CLI rejects malformed or oversized protected JSON without exposing it or writing output', (t) => {
  const value = bindingFiles(t); const valid = JSON.stringify(value.bindingSecrets);
  for (const input of [Buffer.from('SYNTHETIC_PRIVATE_SENTINEL'), Buffer.from(valid + ' extra'),
    Buffer.from(valid.replace('"numberSecret":', '"numberSecret":0,"numberSecret":')),
    Buffer.alloc(MAX_BINDING_SECRET_BYTES + 1, 65), Buffer.from([0xff])]) {
    try {
      const result = runBindings(value, [], { input });
      assert.equal(result.status, 1); assertSafeOutput(result, value);
      assert.equal(fs.existsSync(value.output), false);
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /SYNTHETIC_PRIVATE_SENTINEL|numberSecret/);
    } finally { input.fill(0); }
  }
});

test('binding CLI verifies exact output bytes and preserves a mismatched local result for reconciliation', (t) => {
  const value = bindingFiles(t);
  fs.appendFileSync(value.preload, "const io = require('node:fs'); const write = io.writeFileSync;\n"
    + "io.writeFileSync = function(target, data, options) { return write.call(this, target, "
    + "typeof target === 'number' ? String(data).replace('synthetic_operator', 'synthetic_operatoX') : data, options); };\n");
  const result = runBindings(value);
  assert.equal(result.status, 1); assertSafeOutput(result, value);
  assert.ok(fs.existsSync(value.output)); assert.doesNotMatch(result.stdout, /DERIVED_PRIVATE_BINDINGS/);
  assert.match(fs.readFileSync(value.output, 'utf8'), /synthetic_operatoX/);
});

test('binding protected stdin allocation is cleared on success and on derivation failure', (t) => {
  for (const failing of [false, true]) {
    const value = bindingFiles(t);
    fs.appendFileSync(value.preload, "const savedAlloc = Buffer.alloc; const sensitiveBuffers = [];\n"
      + "Buffer.alloc = function(size, ...args) { const value = savedAlloc.call(this, size, ...args); "
      + `if (size === ${MAX_BINDING_SECRET_BYTES + 1}) sensitiveBuffers.push(value); return value; };\n`
      + "process.on('exit', () => { if (sensitiveBuffers.length !== 1 || !sensitiveBuffers.every(value => value.every(byte => byte === 0))) { "
      + "process.stderr.write('SYNTHETIC_BUFFER_NOT_CLEARED\\n'); process.exitCode = 91; } "
      + "else process.stdout.write('SYNTHETIC_BUFFER_CLEARED\\n'); });\n");
    const result = runBindings(value, [], failing ? { input: '{}' } : {});
    assert.equal(result.status, failing ? 1 : 0); assertSafeOutput(result, value);
    assert.match(result.stdout, /SYNTHETIC_BUFFER_CLEARED/);
    assert.doesNotMatch(result.stderr, /SYNTHETIC_BUFFER_NOT_CLEARED/);
  }
});

test('CLI consumes fake stdin only and writes one signed private file without outbound access', (t) => {
  const value = files(t); const result = run(value);
  assert.equal(result.status, 0, result.stderr);
  assertSafeOutput(result, value);
  const bytes = fs.readFileSync(value.output);
  assert.ok(bytes.byteLength <= 16384);
  const packet = JSON.parse(bytes.toString('utf8'));
  assert.equal(JSON.parse(result.stdout).maxBodyBytes, 16384);
  assert.match(packet.signature, /^v1=[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(packet, 'preparation'), false);
  assert.equal(Object.hasOwn(packet, 'operatorVerificationSecret'), false);
  assert.deepEqual(guard.blocked, []);
});

test('CLI preserves runtime-compatible Unicode and whitespace key bytes without trimming', (t) => {
  const value = files(t); const text = ' 漢😀 '.repeat(8);
  const input = Buffer.from(text, 'utf8');
  try {
    const result = run(value, [], { input });
    assert.equal(result.status, 0); assertSafeOutput(result, value);
    const packet = JSON.parse(fs.readFileSync(value.output, 'utf8'));
    const { canonicalApprovalIntent }
      = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/approval-control');
    const expected = `v1=${crypto.createHmac('sha256', text)
      .update('revenue-desk-configuration-staging-intent-v1\0')
      .update(canonicalApprovalIntent(packet.intent)).digest('hex')}`;
    assert.equal(packet.signature, expected);
    assert.equal(`${result.stdout}${result.stderr}`.includes(text), false);
  } finally { input.fill(0); }
});

test('validate-only mode checks a complete unsigned packet without reading a key or creating output', (t) => {
  const value = files(t);
  fs.appendFileSync(value.preload, "const before = require('node:fs').readSync; require('node:fs').readSync = function(fd, ...args) { "
    + "if (fd === 0) { process.stderr.write('UNEXPECTED_KEY_READ\\n'); throw new Error('No stdin allowed'); } return before.call(this, fd, ...args); };\n");
  const result = run(value, ['--validate-only'], { input: '' });
  assert.equal(result.status, 0); assertSafeOutput(result, value);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.status, 'VALIDATED_UNSIGNED_PACKET_NO_SIGNATURE');
  assert.equal(verdict.maxBodyBytes, 16384); assert.equal(verdict.sourceRevision, value.f.config.sourceRevision);
  assert.equal(verdict.signaturePresent, false); assert.equal(verdict.submitted, false);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_KEY_READ/); assert.equal(fs.existsSync(value.output), false);
});

test('validate-only mode rejects a packet above the observed 4096-byte route limit before protected entry', (t) => {
  const value = files(t); value.maxBodyBytes = 4096;
  assert.ok(Buffer.byteLength(JSON.stringify(value.envelope.request), 'utf8') > 4096);
  fs.appendFileSync(value.preload, "const before = require('node:fs').readSync; require('node:fs').readSync = function(fd, ...args) { "
    + "if (fd === 0) { process.stderr.write('UNEXPECTED_KEY_READ\\n'); throw new Error('No stdin allowed'); } return before.call(this, fd, ...args); };\n");
  const result = run(value, ['--validate-only'], { input: '' });
  assert.equal(result.status, 1); assertSafeOutput(result, value);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_KEY_READ/); assert.equal(fs.existsSync(value.output), false);
  assert.doesNotMatch(result.stdout, /VALIDATED_UNSIGNED_PACKET/);
});

test('validate-only parsing rejects duplicate flags or missing limits and omission still requires a signing key', (t) => {
  for (const mode of ['duplicate', 'missing_limit', 'omitted']) {
    const value = files(t); value.omitBodyLimit = mode === 'missing_limit';
    const args = mode === 'duplicate' ? ['--validate-only', '--validate-only']
      : mode === 'missing_limit' ? ['--validate-only'] : [];
    const result = run(value, args, { input: '' });
    assert.equal(result.status, 1); assertSafeOutput(result, value);
    assert.equal(fs.existsSync(value.output), false);
    assert.doesNotMatch(result.stdout, /VALIDATED_UNSIGNED_PACKET|SIGNED_PACKET_READY/);
  }
});

test('CLI refuses existing output and leaves the original evidence unchanged', (t) => {
  const value = files(t); const original = 'SYNTHETIC EXISTING EVIDENCE';
  fs.writeFileSync(value.output, original, { flag: 'wx' });
  const result = run(value);
  assert.notEqual(result.status, 0); assertSafeOutput(result, value);
  assert.equal(fs.readFileSync(value.output, 'utf8'), original);
});

test('an ambiguous fsync failure preserves its created evidence and a later invocation cannot overwrite it', (t) => {
  const value = files(t);
  fs.appendFileSync(value.preload, "require('node:fs').fsyncSync = () => { throw new Error('SYNTHETIC_FSYNC_FAILURE'); };\n");
  const result = run(value);
  assert.notEqual(result.status, 0); assertSafeOutput(result, value);
  const preserved = fs.readFileSync(value.output);
  assert.ok(preserved.byteLength > 0);
  fs.writeFileSync(value.preload, childGuard(value));
  const second = run(value);
  assert.notEqual(second.status, 0); assertSafeOutput(second, value);
  assert.deepEqual(fs.readFileSync(value.output), preserved);
});

test('partial local write is preserved for reconciliation, never silently removed or retried', (t) => {
  const value = files(t);
  fs.appendFileSync(value.preload, "const io = require('node:fs'); const write = io.writeFileSync;\n"
    + "io.writeFileSync = function(target, data, options) { if (typeof target !== 'number') return write.call(this, target, data, options); "
    + "io.writeSync(target, Buffer.from(String(data)).subarray(0, 20)); throw new Error('SYNTHETIC_PARTIAL_WRITE'); };\n");
  const result = run(value);
  assert.notEqual(result.status, 0); assertSafeOutput(result, value);
  assert.equal(fs.statSync(value.output).size, 20);
});

test('protected stdin allocation is cleared after success and after an output error', (t) => {
  for (const failing of [false, true]) {
    const value = files(t);
    fs.appendFileSync(value.preload, "const savedAlloc = Buffer.alloc; const sensitiveBuffers = [];\n"
      + "Buffer.alloc = function(size, ...args) { const value = savedAlloc.call(this, size, ...args); "
      + `if (size === ${MAX_SECRET_UTF8_BYTES + 1}) sensitiveBuffers.push(value); return value; };\n`
      + "process.on('exit', () => { if (sensitiveBuffers.length !== 1 || !sensitiveBuffers.every(value => value.every(byte => byte === 0))) { "
      + "process.stderr.write('SYNTHETIC_BUFFER_NOT_CLEARED\\n'); process.exitCode = 91; } "
      + "else process.stdout.write('SYNTHETIC_BUFFER_CLEARED\\n'); });\n"
      + (failing ? "require('node:fs').fsyncSync = () => { throw new Error('SYNTHETIC_FSYNC_FAILURE'); };\n" : ''));
    const result = run(value);
    assert.equal(result.status, failing ? 1 : 0); assertSafeOutput(result, value);
    assert.match(result.stdout, /SYNTHETIC_BUFFER_CLEARED/);
    assert.doesNotMatch(result.stderr, /SYNTHETIC_BUFFER_NOT_CLEARED/);
  }
});

test('waiting for protected input cannot extend an expired intent signing window', (t) => {
  const value = files(t);
  fs.appendFileSync(value.preload, "const io = require('node:fs'); const read = io.readSync; const now = Date.now; let elapsed = 0;\n"
    + "Date.now = () => now() + elapsed; io.readSync = function(fd, ...args) { if (fd === 0) elapsed = 300001; "
    + "return read.call(this, fd, ...args); };\n");
  const result = run(value);
  assert.notEqual(result.status, 0); assertSafeOutput(result, value);
  assert.equal(fs.existsSync(value.output), false);
  assert.doesNotMatch(result.stdout, /SIGNED_PACKET_READY/);
});

test('CLI rejects input or output under a Git-marked directory without reading credentials', (t) => {
  for (const affected of ['input', 'output']) {
    const value = files(t); const repository = path.join(value.directory, 'synthetic-repository');
    fs.mkdirSync(repository); fs.mkdirSync(path.join(repository, '.git'));
    if (affected === 'input') {
      const blocked = path.join(repository, 'input.json'); fs.copyFileSync(value.input, blocked); value.input = blocked;
    } else value.output = path.join(repository, 'signed.json');
    fs.writeFileSync(value.preload, childGuard(value));
    const result = run(value);
    assert.notEqual(result.status, 0); assertSafeOutput(result, value);
    assert.equal(fs.existsSync(value.output), false);
  }
});

test('CLI refuses a symbolic path alias before signing or creating output', (t) => {
  const value = files(t); const alias = path.join(value.directory, 'alias');
  const actual = path.join(value.directory, 'actual'); fs.mkdirSync(actual);
  fs.symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  value.output = path.join(alias, 'signed.json');
  fs.writeFileSync(value.preload, childGuard(value));
  const result = run(value);
  assert.notEqual(result.status, 0); assertSafeOutput(result, value);
  assert.equal(fs.existsSync(path.join(actual, 'signed.json')), false);
});

test('CLI refuses input hard links and never creates a signed output', (t) => {
  const value = files(t);
  fs.linkSync(value.input, path.join(value.directory, 'hard-linked-input.json'));
  const result = run(value);
  assert.notEqual(result.status, 0); assertSafeOutput(result, value);
  assert.equal(fs.existsSync(value.output), false);
});

test('CLI rejects malformed and oversized inputs without echoing payload excerpts', (t) => {
  for (const contents of ['{"private":"demo-a@example.invalid', 'x'.repeat(1024 * 1024),
    Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])]) {
    const value = files(t); fs.writeFileSync(value.input, contents);
    const result = run(value);
    assert.notEqual(result.status, 0); assertSafeOutput(result, value);
    assert.equal(fs.existsSync(value.output), false);
  }
});

test('Windows CLI rejects a readable-by-Everyone fixture directory before consuming private input',
  { skip: process.platform !== 'win32' }, (t) => {
    // Build the intentionally permissive fixture in one ACL operation. A
    // second full descriptor replacement can require SeSecurityPrivilege on
    // Windows even though this test needs only a synthetic inherited-read ACE.
    const value = files(t, { publicRead: true });
    fs.appendFileSync(value.preload, "const read = require('node:fs').readSync; require('node:fs').readSync = function(fd, ...args) { "
      + "if (fd === 0) { process.stderr.write('UNSAFE_STDIN_READ\\n'); throw new Error('No key allowed'); } return read.call(this, fd, ...args); };\n");
    const result = run(value);
    assert.notEqual(result.status, 0); assertSafeOutput(result, value);
    assert.doesNotMatch(result.stderr, /UNSAFE_STDIN_READ/);
    assert.equal(fs.existsSync(value.output), false);
  });

test('Windows fixed helper validates only synthetic private paths and has no secret-entry step',
  { skip: process.platform !== 'win32' }, (t) => {
    const value = files(t);
    const result = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', WINDOWS_HELPER,
      '-CheckPrivatePaths', '-InputPath', value.input, '-OutputPath', value.output], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
      env: { SystemRoot: process.env.SystemRoot || '' }, input: '',
    });
    assert.equal(result.status, 0); assert.equal(result.stdout.trim(), 'PRIVATE_PATHS_VERIFIED');
    assert.equal(result.stderr, ''); assert.equal(fs.existsSync(value.output), false);
  });

test('Windows fixed helper rejects relative paths, alternate streams, reserved and aliasing names',
  { skip: process.platform !== 'win32' }, (t) => {
    const value = files(t);
    for (const output of ['relative.json', `${value.output}:stream`, `${value.output} `,
      path.join(value.directory, 'NUL.json'), `${value.directory}\\..\\signed.json`]) {
      const result = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', WINDOWS_HELPER,
        '-CheckPrivatePaths', '-InputPath', value.input, '-OutputPath', output], {
        encoding: 'utf8', windowsHide: true, timeout: 15000,
        env: { SystemRoot: process.env.SystemRoot || '' }, input: '',
      });
      assert.notEqual(result.status, 0); assert.equal(result.stdout.trim(), 'PRIVATE_PATHS_REJECTED');
      assert.equal(result.stderr, '');
    }
  });

test('Windows fixed helper rejects synthetic Git worktree pointer ancestors',
  { skip: process.platform !== 'win32' }, (t) => {
    const value = files(t); fs.writeFileSync(path.join(value.directory, '.git'), 'gitdir: synthetic-not-real');
    const result = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', WINDOWS_HELPER,
      '-CheckPrivatePaths', '-InputPath', value.input, '-OutputPath', value.output], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
      env: { SystemRoot: process.env.SystemRoot || '' }, input: '',
    });
    assert.notEqual(result.status, 0); assert.equal(result.stdout.trim(), 'PRIVATE_PATHS_REJECTED');
    assert.equal(result.stderr, '');
  });

test('private owner wrapper pins source on both sides of review and sends protected bytes only through stdin', () => {
  const source = fs.readFileSync(WINDOWS_HELPER, 'utf8');
  const dialog = source.indexOf('$taskWindow.ShowDialog()');
  assert.ok(dialog > 0);
  assert.match(source.slice(0, dialog), /'rev-parse', 'HEAD'/);
  assert.match(source.slice(dialog), /'rev-parse', 'HEAD'/);
  assert.match(source.slice(0, dialog), /Read-LocalCheck \$taskGit \$taskStatusArgs/);
  assert.match(source.slice(dialog), /Read-LocalCheck \$taskGit \$taskStatusArgs/);
  assert.ok(source.indexOf('$taskTrustedNode = Open-TrustedNode $NodePath')
    < source.indexOf("Read-LocalCheck $taskNode @('--version')"));
  assert.ok(source.indexOf('$taskTrustedNode = Open-TrustedNode $NodePath') < dialog);
  assert.ok(source.indexOf('$taskNodeRecheck = Open-TrustedNode $NodePath') > dialog);
  assert.ok(source.indexOf('$taskNodeRecheck = Open-TrustedNode $NodePath')
    < source.indexOf('$taskSecure = $taskBox.SecurePassword'));
  assert.ok(source.indexOf('$taskPreflight = (Read-LocalCheck') > source.indexOf('$taskInputLock = [IO.File]::Open'));
  assert.ok(source.indexOf('$taskPreflight = (Read-LocalCheck') < source.indexOf('Add-Type -AssemblyName PresentationFramework'));
  assert.ok(source.indexOf('$taskPreflight = (Read-LocalCheck') < dialog);
  assert.match(source, /\$taskSignerArguments \+ @\('--validate-only'\)\) 20000/);
  assert.match(source, /StandardInput\.BaseStream\.Write\(\$taskBytes, 0, \$taskBytes\.Length\)/);
  assert.match(source, /Environment\.Clear\(\)/);
  assert.match(source, /ZeroFreeBSTR\(\$taskSecretPointer\)/);
  assert.match(source, /\[Array\]::Clear\(\$taskBytes/);
  assert.doesNotMatch(source, /(?:Get|Set)-Clipboard|Get-Credential|Read-Host|ExecutionPolicy|ConvertFrom-SecureString/);
  assert.doesNotMatch(source, /ArgumentList\.Add\(\$task(?:Bytes|Secure|SecretPointer)\)/);
  assert.doesNotMatch(source, /Environment\[[^\]]+\]\s*=\s*\$task(?:Bytes|Secure|SecretPointer)/);
});

test('private wrapper selects one Git application when PATH contains multiple installations',
  { skip: process.platform !== 'win32' }, (t) => {
    const value = files(t);
    const first = path.join(value.directory, 'first');
    const second = path.join(value.directory, 'second');
    fs.mkdirSync(first); fs.mkdirSync(second);
    // Synthetic local executables exercise command resolution, not Git access.
    fs.copyFileSync(process.execPath, path.join(first, 'git.exe'));
    fs.copyFileSync(process.execPath, path.join(second, 'git.exe'));
    const driver = path.join(value.directory, 'check-git-resolution.ps1');
    fs.writeFileSync(driver, `param([string]$Wrapper, [string]$First, [string]$Second)
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile($Wrapper, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Wrapper parse failed' }
$assignment = $tree.Find({ param($item) $item -is [Management.Automation.Language.AssignmentStatementAst] -and $item.Left.Extent.Text -eq '$taskGit' }, $true)
if ($null -eq $assignment) { throw 'Git selection unavailable' }
$resolve = [scriptblock]::Create($assignment.Extent.Text)
$env:PATHEXT = '.EXE'
foreach ($order in @(@($First, $Second), @($Second, $First))) {
  $env:PATH = $order -join [IO.Path]::PathSeparator
  if (@(Get-Command git -CommandType Application).Count -ne 2) { throw 'Multiple applications not reproduced' }
  . $resolve
  if ($taskGit -isnot [string] -or $taskGit -cne (Join-Path $order[0] 'git.exe')) { throw 'One application in PATH order required' }
  if ((& $taskGit --version) -cne 'v24.19.0' -or $LASTEXITCODE -ne 0) { throw 'Selected application did not execute' }
}
$env:PATH = ''
$rejected = $false
try { . $resolve } catch { $rejected = $true }
if (-not $rejected) { throw 'Missing Git must fail before owner input' }
[Console]::Out.WriteLine('SINGLE_GIT_APPLICATION_VERIFIED')
`, { flag: 'wx' });
    const checked = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', driver,
      '-Wrapper', WINDOWS_HELPER, '-First', first, '-Second', second], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot || '' }, input: '',
    });
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(checked.stdout.trim(), 'SINGLE_GIT_APPLICATION_VERIFIED');
    assert.equal(checked.stderr, '');
  });

test('private wrapper rejects a changed executable that still reports the approved Node version before owner UI',
  { skip: process.platform !== 'win32' }, (t) => {
    const value = files(t); const alternate = path.join(value.directory, 'node.exe');
    // Appending inert bytes preserves the reviewed Node PE's --version behavior,
    // but creates a different executable identity. No private key is supplied.
    fs.copyFileSync(process.execPath, alternate);
    fs.appendFileSync(alternate, '\nSYNTHETIC_CHANGED_EXECUTABLE_NOT_AUTHORIZED\n');
    const version = spawnSync(alternate, ['--version'], { encoding: 'utf8', timeout: 15000,
      windowsHide: true, env: { SystemRoot: process.env.SystemRoot || '' }, input: '' });
    assert.equal(version.status, 0); assert.equal(version.stdout.trim(), 'v24.19.0');
    const checked = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', WINDOWS_HELPER,
      '-InputPath', value.input, '-OutputPath', value.output, '-NodePath', alternate,
      '-UtilityRevision', 'a'.repeat(40), '-ExpectedRevision', value.f.config.sourceRevision,
      '-ExpectedOperatorHash', value.f.config.operatorIdHash, '-MaxBodyBytes', '16384'], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot || '' }, input: '',
    });
    assert.equal(checked.status, 1);
    assert.match(checked.stdout, /OFFLINE SIGNING STOPPED/);
    assert.equal(checked.stderr, ''); assert.equal(fs.existsSync(value.output), false);
  });

test('trusted Node verifier accepts pinned bytes, rejects changed bytes and holds checked executable read-only',
  { skip: process.platform !== 'win32' }, (t) => {
    const value = files(t); const alternate = path.join(value.directory, 'node.exe');
    fs.copyFileSync(process.execPath, alternate);
    const driver = path.join(value.directory, 'check-runtime-pin.ps1');
    fs.writeFileSync(driver, `param([string]$Wrapper, [string]$Runtime)
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile($Wrapper, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Wrapper parse failed' }
foreach ($name in @('Assert-LocalPathName', 'Open-TrustedNode')) {
  $function = $tree.Find({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq $name }, $true)
  . ([scriptblock]::Create($function.Extent.Text))
}
$checked = Open-TrustedNode $Runtime
try {
  $denied = $false
  try { $writer = [IO.File]::Open($Runtime, 'Open', 'Write', 'ReadWrite'); $writer.Dispose() }
  catch [IO.IOException] { $denied = $true }
  if (-not $denied) { throw 'Runtime bytes are mutable during review' }
} finally { $checked.Stream.Dispose() }
[IO.File]::AppendAllText($Runtime, 'SYNTHETIC_CHANGED_BYTES')
$rejected = $false
try { $wrong = Open-TrustedNode $Runtime; $wrong.Stream.Dispose() } catch { $rejected = $true }
if (-not $rejected) { throw 'Changed executable was accepted' }
[Console]::Out.WriteLine('PINNED_NODE_AND_LOCK_VERIFIED')
`, { flag: 'wx' });
    const checked = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', driver,
      '-Wrapper', WINDOWS_HELPER, '-Runtime', alternate], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot || '' }, input: '',
    });
    assert.equal(checked.status, 0); assert.equal(checked.stdout.trim(), 'PINNED_NODE_AND_LOCK_VERIFIED');
    assert.equal(checked.stderr, '');
  });

test('private wrapper UTF-8 encoding exactly matches Node including unpaired UTF-16 replacement',
  { skip: process.platform !== 'win32' }, (t) => {
    const value = files(t); const driver = path.join(value.directory, 'check-synthetic-encoding.ps1');
    const texts = [' ' + 'x'.repeat(30) + ' ', '漢'.repeat(32), '😀'.repeat(16), 'x'.repeat(31) + '\n',
      '\ud800' + 'x'.repeat(31), 'x'.repeat(31) + '\udc00', '\ud800\ud800' + 'x'.repeat(30),
      '\udc00\udc00' + 'x'.repeat(30), '\ud800😀' + 'x'.repeat(29)];
    const vectors = texts.map((text) => ({ codeUnits: Array.from({ length: text.length }, (_, i) => text.charCodeAt(i)),
      expectedHex: Buffer.from(text, 'utf8').toString('hex').toUpperCase() }));
    fs.writeFileSync(driver, `param([string]$Wrapper)
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText($Wrapper)
$signing = $source.IndexOf('$taskSecure = $taskBox.SecurePassword')
$start = $source.IndexOf('$taskSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)', $signing)
$end = $source.IndexOf('$taskBox.Clear()', $start)
if ($start -lt 0 -or $end -lt $start) { throw 'Encoding block unavailable' }
$conversion = [scriptblock]::Create($source.Substring($start, $end - $start))
$vectors = '${JSON.stringify(vectors)}' | ConvertFrom-Json
foreach ($vector in $vectors) {
  $taskSecure = [Security.SecureString]::new()
  foreach ($unit in $vector.codeUnits) { $taskSecure.AppendChar([char]$unit) }
  $taskSecretPointer = [IntPtr]::Zero; $taskChars = $null; $taskBytes = $null
  try {
    . $conversion
    if ([Convert]::ToHexString($taskBytes) -cne $vector.expectedHex) { throw 'Key bytes differ from Node runtime' }
    if ($null -ne $taskChars) { throw 'Intermediate character buffer retained' }
  } finally {
    if ($taskBytes) { [Array]::Clear($taskBytes, 0, $taskBytes.Length) }
    if ($taskSecretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskSecretPointer) }
    $taskSecure.Dispose()
  }
}
[Console]::Out.WriteLine('SYNTHETIC_UTF8_ENCODING_VERIFIED')
`, { flag: 'wx' });
    const checked = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', driver,
      '-Wrapper', WINDOWS_HELPER], { encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot || '' }, input: '' });
    assert.equal(checked.status, 0); assert.equal(checked.stdout.trim(), 'SYNTHETIC_UTF8_ENCODING_VERIFIED');
    assert.equal(checked.stderr, '');
  });

test('private binding wrapper JSON encoding preserves runtime-derived values for synthetic Unicode and controls',
  { skip: process.platform !== 'win32' }, (t) => {
    const value = bindingFiles(t); const driver = path.join(value.directory, 'check-synthetic-binding-encoding.ps1');
    const texts = [' ' + 'x'.repeat(30) + ' ', '漢'.repeat(32), '😀'.repeat(16),
      'x'.repeat(31) + '\n', '"\\\t'.repeat(12), '\ud800' + 'x'.repeat(31), '\udc00' + 'x'.repeat(31)];
    const vectors = texts.map((text) => ({ codeUnits: Array.from({ length: text.length }, (_, i) => text.charCodeAt(i)) }));
    fs.writeFileSync(driver, `param([string]$Wrapper)
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText($Wrapper)
$start = $source.IndexOf('$taskBindingValues = [ordered]@{}')
$end = $source.IndexOf('    } else {', $start)
if ($start -lt 0 -or $end -lt $start) { throw 'Binding encoding block unavailable' }
$conversion = [scriptblock]::Create($source.Substring($start, $end - $start))
$vectors = '${JSON.stringify(vectors)}' | ConvertFrom-Json
$outputs = @()
foreach ($vector in $vectors) {
  $taskBindingBoxes = @()
  foreach ($units in @($vector.codeUnits, @(${Array.from(value.bindingSecrets.eventChainSecret, (c) => c.charCodeAt(0)).join(',')}), @(${Array.from(value.bindingSecrets.analyticsPartitionSecret, (c) => c.charCodeAt(0)).join(',')}))) {
    $secure = [Security.SecureString]::new()
    foreach ($unit in $units) { $secure.AppendChar([char]$unit) }
    $box = [pscustomobject]@{ SecurePassword = $secure }
    $box | Add-Member -MemberType ScriptMethod -Name Clear -Value { }
    $taskBindingBoxes += $box
  }
  $taskSecretPointer = [IntPtr]::Zero; $taskBytes = $null; $taskSecure = $null
  try {
    . $conversion
    $outputs += [Convert]::ToBase64String($taskBytes)
    if ($taskBindingValues.Count -ne 0 -or $null -ne $taskBindingJson -or $null -ne $taskSecure -or $taskSecretPointer -ne [IntPtr]::Zero) { throw 'Protected references retained' }
  } finally {
    if ($taskBytes) { [Array]::Clear($taskBytes, 0, $taskBytes.Length) }
    foreach ($box in $taskBindingBoxes) { $box.SecurePassword.Dispose() }
  }
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $outputs -Compress))
`, { flag: 'wx' });
    const checked = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', driver,
      '-Wrapper', WINDOWS_HELPER], { encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot || '' }, input: '' });
    assert.equal(checked.status, 0); assert.equal(checked.stderr, '');
    const encoded = JSON.parse(checked.stdout); assert.equal(encoded.length, texts.length);
    for (let index = 0; index < texts.length; index++) {
      const actual = Buffer.from(encoded[index], 'base64');
      const expected = Buffer.from(JSON.stringify({ ...value.bindingSecrets, numberSecret: texts[index] }), 'utf8');
      try {
        assert.deepEqual(deriveStagingBindings(value.bindingInput, { protectedInput: actual }),
          deriveStagingBindings(value.bindingInput, { protectedInput: expected }));
      } finally { actual.fill(0); expected.fill(0); }
    }
  });

test('CLI rejects ambiguous duplicate object fields rather than signing last-key-wins JSON', (t) => {
  const value = files(t);
  const raw = fs.readFileSync(value.input, 'utf8').replace('"schemaVersion":1', '"schemaVersion":2,"schemaVersion":1');
  fs.writeFileSync(value.input, raw);
  const result = run(value);
  assert.notEqual(result.status, 0); assertSafeOutput(result, value);
  assert.equal(fs.existsSync(value.output), false);
});

test('CLI rejects key arguments, invalid key bytes and evidence time overrides', (t) => {
  for (const setup of [
    { args: ['--secret', 'SYNTHETIC_SECRET_ARGUMENT'] },
    { args: ['--now', String(SYNTHETIC_NOW)] },
    { input: Buffer.from('short') },
    { input: Buffer.from([0xed, 0xa0, 0x80]) },
    { input: Buffer.alloc(MAX_SECRET_UTF8_BYTES + 1, 65) },
    { input: Buffer.alloc(4097, 65) },
  ]) {
    const value = files(t); const options = setup.input ? { input: setup.input } : {};
    const result = run(value, setup.args || [], options);
    assert.notEqual(result.status, 0); assertSafeOutput(result, value);
    assert.equal(fs.existsSync(value.output), false);
  }
});

test('CLI rejects relative input and output paths rather than resolving a caller-selected base', (t) => {
  for (const affected of ['input', 'output']) {
    const value = files(t); value[affected] = path.basename(value[affected]);
    fs.writeFileSync(value.preload, childGuard(value));
    const result = run(value);
    assert.notEqual(result.status, 0); assertSafeOutput(result, value);
    assert.equal(fs.existsSync(path.join(value.directory, 'signed.json')), false);
  }
});

test('POSIX CLI rejects permissive input permissions before signing', { skip: process.platform === 'win32' }, (t) => {
  const value = files(t); fs.chmodSync(value.input, 0o644);
  const result = run(value);
  assert.notEqual(result.status, 0); assertSafeOutput(result, value);
  assert.equal(fs.existsSync(value.output), false);
});

test('CLI source has no provider client, network, credential store or key environment access', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:)?(?:https?|net|tls|zcatalyst|retell)/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest)\s*\(/);
  assert.deepEqual(source.match(/process\.env\.[A-Za-z0-9_]+/g), ['process.env.SystemRoot']);
  assert.equal((source.match(/\bspawnSync\(/g) || []).length, 1);
  assert.match(source, /fill\(0\)/);
});
