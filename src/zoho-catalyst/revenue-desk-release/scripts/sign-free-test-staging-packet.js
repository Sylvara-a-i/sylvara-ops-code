'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  PROFILE,
  BINDINGS_PROFILE,
  MAX_BINDING_SECRET_BYTES,
  validateStagingBindingInput,
  deriveStagingBindings,
  validateUnsignedStagingEnvelope,
  signFreeTestStagingPacket,
  RECONCILIATION_PROFILE,
  validateUnsignedReconciliationEnvelope,
  signFreeTestReconciliationPacket,
  COMPLETION_PROFILE,
  validateUnsignedCompletionEnvelope,
  signFreeTestCompletionPacket,
  TRANSITION_PROFILE,
  validateUnsignedTransitionEnvelope,
  signFreeTestTransitionPacket,
} = require('../lib/free-test-staging-packet');

const MAX_INPUT_BYTES = 1024 * 1024;
// A valid 4,096-code-unit JavaScript string can require at most 12,288 UTF-8
// bytes (three bytes per BMP code unit). The library enforces code-unit length.
const MAX_SECRET_BYTES = 12_288;
const BASE_ARGUMENTS = Object.freeze([
  '--input', '--output', '--expected-revision', '--expected-operator-hash', '--max-body-bytes',
]);
const WINDOWS_PRIVATE_PATH_HELPER = path.resolve(__dirname,
  'sign-free-test-staging-packet-private.ps1');
const TRUSTED_POWERSHELL_SHA256
  = '362a356ce7f0940ec74f73a8fc2c990a2cc24a38a11c90bbd8eca947110ad139';

function fail(condition, code) {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

function parseArguments(argv) {
  fail(Array.isArray(argv), 'INVALID_ARGUMENTS');
  const deriveBindingsCount = argv.filter((value) => value === '--derive-bindings').length;
  const validateOnlyCount = argv.filter((value) => value === '--validate-only').length;
  fail(validateOnlyCount <= 1 && deriveBindingsCount <= 1, 'INVALID_ARGUMENTS');
  const modeArguments = deriveBindingsCount === 1 ? ['--input', '--output'] : BASE_ARGUMENTS;
  const expectedArguments = process.platform === 'win32'
    ? [...modeArguments, '--powershell-path'] : [...modeArguments];
  const pairedArguments = argv.filter((value) => !['--validate-only', '--derive-bindings'].includes(value));
  fail(pairedArguments.length === expectedArguments.length * 2, 'INVALID_ARGUMENTS');
  const values = {};
  for (let index = 0; index < pairedArguments.length; index += 2) {
    const name = pairedArguments[index];
    const value = pairedArguments[index + 1];
    fail(expectedArguments.includes(name) && !Object.hasOwn(values, name)
      && typeof value === 'string' && value.length > 0,
    'INVALID_ARGUMENTS');
    values[name] = value;
  }
  fail(expectedArguments.every((name) => Object.hasOwn(values, name)), 'INVALID_ARGUMENTS');
  fail(path.isAbsolute(values['--input']) && path.isAbsolute(values['--output']),
    'ABSOLUTE_PRIVATE_PATHS_REQUIRED');
  if (!deriveBindingsCount) fail(/^[1-9][0-9]{2,4}$/.test(values['--max-body-bytes']), 'INVALID_ARGUMENTS');
  return Object.freeze({
    input: path.resolve(values['--input']),
    output: path.resolve(values['--output']),
    expectedRevision: values['--expected-revision'],
    expectedOperatorHash: values['--expected-operator-hash'],
    maxBodyBytes: deriveBindingsCount ? undefined : Number(values['--max-body-bytes']),
    powershellPath: values['--powershell-path'] || null,
    validateOnly: validateOnlyCount === 1,
    deriveBindings: deriveBindingsCount === 1,
  });
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function hasGitAncestor(start) {
  let current = start;
  while (true) {
    try {
      fs.lstatSync(path.join(current, '.git'));
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function assertExistingPrivatePath(filePath, { file }) {
  const stat = fs.lstatSync(filePath);
  fail(!stat.isSymbolicLink() && (file ? stat.isFile() && stat.nlink === 1 : stat.isDirectory()),
    'UNSAFE_PRIVATE_PATH');
  const real = fs.realpathSync.native(filePath);
  fail(comparablePath(real) === comparablePath(filePath), 'UNSAFE_PRIVATE_PATH');
  fail(!hasGitAncestor(file ? path.dirname(filePath) : filePath), 'GIT_PATH_PROHIBITED');
  if (process.platform !== 'win32') {
    fail(typeof process.getuid === 'function' && stat.uid === process.getuid()
      && (stat.mode & 0o077) === 0, 'PRIVATE_PERMISSIONS_REQUIRED');
  }
  return stat;
}

function sha256File(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
    return hash.digest('hex');
  } finally {
    buffer.fill(0);
    fs.closeSync(descriptor);
  }
}

function assertNormalExecutable(filePath, expectedName) {
  fail(path.isAbsolute(filePath) && path.basename(filePath).toLowerCase() === expectedName,
    'INVALID_LOCAL_HELPER');
  const stat = fs.lstatSync(filePath);
  fail(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
    'INVALID_LOCAL_HELPER');
  fail(comparablePath(fs.realpathSync.native(filePath)) === comparablePath(filePath),
    'INVALID_LOCAL_HELPER');
}

function verifyWindowsPrivatePaths(args, outputExists) {
  if (process.platform !== 'win32') return;
  assertNormalExecutable(args.powershellPath, 'pwsh.exe');
  fail(sha256File(args.powershellPath) === TRUSTED_POWERSHELL_SHA256,
    'INVALID_LOCAL_HELPER');
  assertNormalExecutable(WINDOWS_PRIVATE_PATH_HELPER,
    'sign-free-test-staging-packet-private.ps1');
  const systemRoot = process.env.SystemRoot;
  fail(typeof systemRoot === 'string' && /^[A-Za-z]:\\Windows$/i.test(systemRoot)
    && fs.lstatSync(systemRoot).isDirectory(), 'INVALID_LOCAL_HELPER');
  const command = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    WINDOWS_PRIVATE_PATH_HELPER, '-CheckPrivatePaths', '-InputPath', args.input,
    '-OutputPath', args.output, ...(outputExists ? ['-OutputExists'] : [])];
  const result = spawnSync(args.powershellPath, command, {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 4096, windowsHide: true,
    env: { SystemRoot: systemRoot }, input: '',
  });
  fail(!result.error && result.status === 0 && result.signal === null
    && result.stdout.trim() === 'PRIVATE_PATHS_VERIFIED' && result.stderr === '',
  'PRIVATE_PATHS_REJECTED');
}

function readEnvelope(inputPath) {
  const stat = assertExistingPrivatePath(inputPath, { file: true });
  fail(stat.size > 0 && stat.size <= MAX_INPUT_BYTES, 'INVALID_INPUT_SIZE');
  const bytes = fs.readFileSync(inputPath);
  try {
    fail(bytes.length === stat.size, 'INPUT_CHANGED_DURING_READ');
    const text = bytes.toString('utf8');
    fail(Buffer.from(text, 'utf8').equals(bytes), 'INVALID_UTF8_INPUT');
    const parsed = JSON.parse(text);
    // A single canonical representation rejects duplicate JSON members and
    // parser-dependent encodings before any owner key is consumed.
    fail(text === JSON.stringify(parsed), 'NONCANONICAL_INPUT');
    return parsed;
  } finally {
    bytes.fill(0);
  }
}

function readSecret(maximumBytes = MAX_SECRET_BYTES, errorCode = 'INVALID_STAGING_SIGNING_SECRET') {
  fail(process.stdin.isTTY !== true, 'INTERACTIVE_STDIN_PROHIBITED');
  const bytes = Buffer.alloc(maximumBytes + 1);
  let length = 0;
  try {
    while (length < bytes.length) {
      const count = fs.readSync(0, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    fail(length <= maximumBytes, errorCode);
    return { allocation: bytes, secret: bytes.subarray(0, length) };
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

function assertNewPrivateOutput(outputPath) {
  const parent = path.dirname(outputPath);
  assertExistingPrivatePath(parent, { file: false });
  fail(comparablePath(outputPath) !== comparablePath(parent), 'UNSAFE_PRIVATE_PATH');
  try {
    fs.lstatSync(outputPath);
    fail(false, 'OUTPUT_ALREADY_EXISTS');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function writeExclusivePrivateFile(outputPath, serialized) {
  assertNewPrivateOutput(outputPath);
  let descriptor;
  try {
    descriptor = fs.openSync(outputPath, 'wx', 0o600);
    const stat = fs.fstatSync(descriptor);
    fail(stat.isFile(), 'UNSAFE_PRIVATE_PATH');
    fs.writeFileSync(descriptor, serialized, { encoding: 'utf8' });
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) { /* best-effort close before cleanup */ }
      descriptor = undefined;
    }
    // After exclusive creation, a write/fsync failure is an ambiguous local
    // outcome. Preserve the file for owner reconciliation; never delete or
    // retry it automatically. Pre-write validation failures create no output.
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const final = fs.lstatSync(outputPath);
  fail(final.isFile() && !final.isSymbolicLink()
    && final.nlink === 1 && final.size === Buffer.byteLength(serialized, 'utf8'),
  'OUTPUT_READBACK_FAILED');
  // POSIX honors this directly. The required Windows owner wrapper separately
  // verifies an owner-only NTFS ACL; this CLI never claims mode bits prove it.
  if (process.platform !== 'win32') fs.chmodSync(outputPath, 0o600);
}

function preparePrivateBindings(input, args) {
  validateStagingBindingInput(input);
  // Including POSIX, reject unsafe or existing output before any protected
  // input. Exclusive creation and the normal path checks still run afterward.
  assertNewPrivateOutput(args.output);
  if (args.validateOnly) {
    process.stdout.write(`${JSON.stringify({ status: 'VALIDATED_BINDING_INPUT_NO_SECRET',
      profile: BINDINGS_PROFILE, signaturePresent: false, submitted: false, retryAllowed: false })}\n`);
    return;
  }
  const protectedInput = readSecret(MAX_BINDING_SECRET_BYTES, 'INVALID_STAGING_BINDING_SECRETS');
  try {
    const derived = deriveStagingBindings(input, { protectedInput: protectedInput.secret });
    writeExclusivePrivateFile(args.output, derived.serialized);
    verifyWindowsPrivatePaths(args, true);
    assertExistingPrivatePath(args.output, { file: true });
    fail(sha256File(args.output) === derived.sha256, 'OUTPUT_READBACK_FAILED');
    process.stdout.write(`${JSON.stringify({ status: 'DERIVED_PRIVATE_BINDINGS_NOT_SIGNED',
      profile: BINDINGS_PROFILE, byteLength: derived.byteLength, sha256: derived.sha256,
      signaturePresent: false, submitted: false, retryAllowed: false })}\n`);
  } finally {
    protectedInput.allocation.fill(0);
  }
}

function main() {
  fail(process.versions.node === '24.19.0', 'PINNED_NODE_REQUIRED');
  const args = parseArguments(process.argv.slice(2));
  fail(args.input !== args.output, 'UNSAFE_PRIVATE_PATH');
  verifyWindowsPrivatePaths(args, false);
  const envelope = readEnvelope(args.input);
  if (args.deriveBindings) {
    preparePrivateBindings(envelope, args);
    return;
  }
  const now = Date.now();
  const profile = envelope?.request?.profile;
  fail([PROFILE, RECONCILIATION_PROFILE, COMPLETION_PROFILE, TRANSITION_PROFILE].includes(profile), 'INVALID_SIGNING_PROFILE');
  const validate = profile === PROFILE ? validateUnsignedStagingEnvelope
    : profile === RECONCILIATION_PROFILE ? validateUnsignedReconciliationEnvelope
      : profile === COMPLETION_PROFILE ? validateUnsignedCompletionEnvelope : validateUnsignedTransitionEnvelope;
  const sign = profile === PROFILE ? signFreeTestStagingPacket
    : profile === RECONCILIATION_PROFILE ? signFreeTestReconciliationPacket
      : profile === COMPLETION_PROFILE ? signFreeTestCompletionPacket : signFreeTestTransitionPacket;
  // Complete all packet/evidence validation before consuming protected stdin.
  validate(envelope, {
    expectedRevision: args.expectedRevision,
    expectedOperatorHash: args.expectedOperatorHash,
    maxBodyBytes: args.maxBodyBytes,
    now,
  });
  if (args.validateOnly) {
    // The owner wrapper must learn about stale/oversized/incomplete input
    // before opening its protected key-entry dialog. This mode never signs,
    // reads stdin, creates an output file or attempts any submission.
    process.stdout.write(`${JSON.stringify({
      status: 'VALIDATED_UNSIGNED_PACKET_NO_SIGNATURE',
      sourceRevision: args.expectedRevision,
      maxBodyBytes: args.maxBodyBytes,
      profile,
      signaturePresent: false,
      submitted: false,
    })}\n`);
    return;
  }
  const protectedInput = readSecret();
  try {
    const signed = sign(envelope, {
      secret: protectedInput.secret,
      expectedRevision: args.expectedRevision,
      expectedOperatorHash: args.expectedOperatorHash,
      maxBodyBytes: args.maxBodyBytes,
      // Owner review can remain open. Re-evaluate freshness at the actual
      // signing boundary rather than relying on the earlier no-secret check.
      now: Date.now(),
    });
    writeExclusivePrivateFile(args.output, signed.serialized);
    // On Windows, the same fixed read-only helper proves the newly created
    // file inherited the already-reviewed owner-only ACL before success.
    verifyWindowsPrivatePaths(args, true);
    process.stdout.write(`${JSON.stringify({
      status: 'SIGNED_PACKET_READY_NO_SUBMISSION',
      sourceRevision: signed.sourceRevision,
      maxBodyBytes: signed.maxBodyBytes,
      profile: signed.profile,
      byteLength: signed.byteLength,
      sha256: signed.sha256,
      signaturePresent: true,
      submitted: false,
      retryAllowed: false,
    })}\n`);
  } finally {
    protectedInput.allocation.fill(0);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (_) {
    process.stderr.write('Staging packet signing failed. No submission was attempted.\n');
    process.exitCode = 1;
  }
}
