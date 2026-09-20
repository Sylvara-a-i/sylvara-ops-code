'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
    '--expected-revision', value.f.config.sourceRevision,
    '--expected-operator-hash', value.f.config.operatorIdHash,
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
  for (const sensitive of [value.f.config.operatorVerificationSecret,
    value.envelope.request.intent.operator_id_hash,
    value.envelope.preparation.crm.deal.Alert_Recipient_Email,
    value.envelope.preparation.crm.account.Account_Name,
    value.input, value.output]) {
    assert.equal(output.includes(sensitive), false);
  }
  assert.equal(output.includes('v1='), false);
}

test('CLI consumes fake stdin only and writes one signed private file without outbound access', (t) => {
  const value = files(t); const result = run(value);
  assert.equal(result.status, 0, result.stderr);
  assertSafeOutput(result, value);
  const bytes = fs.readFileSync(value.output);
  assert.ok(bytes.byteLength <= 16384);
  const packet = JSON.parse(bytes.toString('utf8'));
  assert.match(packet.signature, /^v1=[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(packet, 'preparation'), false);
  assert.equal(Object.hasOwn(packet, 'operatorVerificationSecret'), false);
  assert.deepEqual(guard.blocked, []);
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
      + "if (size === 4097) sensitiveBuffers.push(value); return value; };\n"
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
  assert.match(source, /StandardInput\.BaseStream\.Write\(\$taskBytes, 0, \$taskBytes\.Length\)/);
  assert.match(source, /Environment\.Clear\(\)/);
  assert.match(source, /ZeroFreeBSTR\(\$taskSecretPointer\)/);
  assert.match(source, /\[Array\]::Clear\(\$taskBytes/);
  assert.doesNotMatch(source, /(?:Get|Set)-Clipboard|Get-Credential|Read-Host|ExecutionPolicy|ConvertFrom-SecureString/);
  assert.doesNotMatch(source, /ArgumentList\.Add\(\$task(?:Bytes|Secure|SecretPointer)\)/);
  assert.doesNotMatch(source, /Environment\[[^\]]+\]\s*=\s*\$task(?:Bytes|Secure|SecretPointer)/);
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
    { input: Buffer.from('A'.repeat(32) + '\n') },
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
