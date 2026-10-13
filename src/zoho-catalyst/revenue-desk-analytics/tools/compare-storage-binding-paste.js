'use strict';
// Local comparison only. No network, configuration writes, or authority creation.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const { decodeStorageBinding } = require('../functions/analytics_sync/lib/report-storage-binding');
const MARKER = 'REPORT_STORAGE_QUALIFICATION_JSON';
const HASH = 'REPORT_STORAGE_QUALIFICATION_SHA256';
const PARTS = Object.freeze([0, 1, 2].map(i => 'REPORT_STORAGE_QUALIFICATION_PART_' + i));
const KEYS = Object.freeze([...PARTS, MARKER, HASH]);
const LIMIT = 16384;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('LOCAL_COMPARE_REJECTED'); };
const sameKeys = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
  && Object.keys(object).sort().join('\0') === [...keys].sort().join('\0');
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);

// Only a JSON object of strings is accepted; duplicate decoded keys never last-win.
function parsePasted(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > LIMIT) fail();
  let offset = 0;
  const skip = () => { while (/[\x20\t\r\n]/.test(text[offset] || '\0')) offset++; };
  const take = character => { skip(); if (text[offset++] !== character) fail(); };
  const string = () => {
    skip();
    const match = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(text.slice(offset));
    if (!match) fail();
    offset += match[0].length;
    return JSON.parse(match[0]);
  };
  const values = Object.create(null);
  take('{'); skip();
  if (text[offset] !== '}') for (;;) {
    const key = string();
    if (!KEYS.includes(key) || Object.hasOwn(values, key)) fail();
    take(':'); values[key] = string(); skip();
    if (text[offset] !== ',') break;
    offset++;
  }
  take('}'); skip();
  if (offset !== text.length || !sameKeys(values, KEYS)) fail();
  return values;
}

function readArtifact(path) {
  const before = fs.lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1n || before.size > BigInt(LIMIT)) fail();
  const fd = fs.openSync(path, 'r');
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const same = stat => stat.isFile() && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(k => stat[k] === before[k]);
    if (!same(opened)) fail();
    // A fixed-size read cannot grow without bound if the file changes concurrently.
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0, n;
    while (count < bytes.length && (n = fs.readSync(fd, bytes, count, bytes.length - count, null))) count += n;
    if (count !== Number(before.size) || !same(fs.fstatSync(fd, { bigint: true }))
      || !same(fs.lstatSync(path, { bigint: true }))) fail();
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}

function loadExpected({ transportPath, transportSha256, bindingSha256 }) {
  if (typeof transportPath !== 'string' || !transportPath.length
    || !/^[a-f0-9]{64}$/.test(transportSha256 || '') || !/^[a-f0-9]{64}$/.test(bindingSha256 || '')) fail();
  const bytes = readArtifact(transportPath);
  if (sha(bytes) !== transportSha256) fail();
  const transport = JSON.parse(utf8(bytes));
  if (!sameKeys(transport, ['parts', 'marker']) || !sameKeys(transport.parts, PARTS)
    || typeof transport.marker !== 'string' || !/^tuple-v1:400:3:/.test(transport.marker)
    || PARTS.some(key => typeof transport.parts[key] !== 'string')) fail();
  const expected = { ...transport.parts, [MARKER]: transport.marker, [HASH]: bindingSha256 };
  const raw = decodeStorageBinding(expected);
  if (sha(Buffer.from(raw, 'utf8')) !== bindingSha256) fail();
  return Object.freeze(expected);
}

function comparePasted(expected, text) {
  const pasted = parsePasted(text);
  const fields = KEYS.map(key => Object.freeze({ key,
    expectedCodeUnits: expected[key].length, observedCodeUnits: pasted[key].length,
    expectedUtf8Bytes: Buffer.byteLength(expected[key]), observedUtf8Bytes: Buffer.byteLength(pasted[key]),
    match: pasted[key] === expected[key] }));
  return Object.freeze({ status: 'LOCAL_COMPARISON_ONLY', allMatch: fields.every(field => field.match), fields });
}

function captureHidden(input, output, signals = process) {
  return new Promise((resolve, reject) => {
    // A normal, unshared TTY is required. There is no redirected-stdin fallback.
    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function' || input.isRaw
      || input.readableEncoding || input.readableLength || input.listenerCount('data')
      || input.listenerCount('readable')) { reject(new Error('LOCAL_COMPARE_REJECTED')); return; }
    const wasFlowing = input.readableFlowing === true;
    const chunks = []; let count = 0, done = false, entered = false;
    const stop = () => finish();
    const finish = value => {
      if (done) return;
      done = true;
      input.removeListener('data', data);
      for (const event of ['error', 'end', 'close']) input.removeListener(event, stop);
      for (const event of ['SIGINT', 'SIGTERM', 'SIGHUP']) signals.removeListener(event, stop);
      let restored = true;
      try { if (entered) input.setRawMode(false); } catch { restored = false; }
      try { if (wasFlowing) input.resume(); else input.pause(); } catch { restored = false; }
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
      try { output.write('\n'); } catch { restored = false; }
      if (typeof value === 'string' && restored) resolve(value); else reject(new Error('LOCAL_COMPARE_REJECTED'));
    };
    const data = chunk => {
      try {
        if (!Buffer.isBuffer(chunk) || count + chunk.length > LIMIT + 1) { finish(); return; }
        if (chunk.includes(3)) { finish(); return; }
        const end = chunk.indexOf(4);
        if (end !== -1 && end !== chunk.length - 1) { finish(); return; }
        const part = end === -1 ? chunk : chunk.subarray(0, end);
        count += part.length;
        if (count > LIMIT) { finish(); return; }
        chunks.push(Buffer.from(part));
        if (end !== -1) {
          const joined = Buffer.concat(chunks);
          let text;
          try { text = utf8(joined); } finally { joined.fill(0); }
          finish(text);
        }
      } catch { finish(); }
    };
    try {
      // Set raw mode before any prompt. Input bytes are never written to output.
      entered = true; input.setRawMode(true);
      input.on('data', data);
      for (const event of ['error', 'end', 'close']) input.on(event, stop);
      for (const event of ['SIGINT', 'SIGTERM', 'SIGHUP']) signals.on(event, stop);
      output.write('Paste only the five controlled keys as one JSON string map. Input is hidden. Ctrl+D finishes; Ctrl+C cancels.\n');
      input.resume();
    } catch { finish(); }
  });
}

function options(argv) {
  const names = ['--transport', '--transport-sha256', '--binding-sha256'];
  if (argv.length !== 6) fail();
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!names.includes(argv[i]) || Object.hasOwn(parsed, argv[i])) fail();
    parsed[argv[i]] = argv[i + 1];
  }
  return { transportPath: parsed[names[0]], transportSha256: parsed[names[1]], bindingSha256: parsed[names[2]] };
}

async function run(argv, input = process.stdin, output = process.stdout, errors = process.stderr, signals = process) {
  try {
    // Non-TTY invocations fail before reading anything or emitting a prompt.
    if (!input.isTTY || !output.isTTY) fail();
    const pins = options(argv), expected = loadExpected(pins);
    const pasted = await captureHidden(input, output, signals);
    // Detect artifact drift while the owner was pasting, before reporting matches.
    loadExpected(pins);
    const result = comparePasted(expected, pasted);
    output.write(JSON.stringify(result) + '\n');
    return result.allMatch ? 0 : 1;
  } catch {
    try { errors.write('LOCAL_COMPARE_REJECTED\n'); } catch { /* Never print exception content. */ }
    return 2;
  }
}
if (require.main === module) run(process.argv.slice(2)).then(code => { process.exitCode = code; });
module.exports = { KEYS, LIMIT, parsePasted, loadExpected, comparePasted, captureHidden, run };
