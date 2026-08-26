'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyReadback } = require('../lib/release-manifest');

function value(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function loadJson(name) {
  const candidate = value(name);
  if (!candidate) throw new Error(`${name} is required.`);
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), candidate), 'utf8'));
}

try {
  const contract = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'release-contract.json'), 'utf8'));
  verifyReadback(loadJson('--manifest'), loadJson('--readback'), contract);
  process.stdout.write('release-readback-ok\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Readback verification failed.'}\n`);
  process.exitCode = 1;
}
