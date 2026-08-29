'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyReadback } = require('../lib/release-manifest');

function value(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function values(name) {
  return process.argv.slice(2).reduce((found, item, index, all) => (
    item === name ? [...found, all[index + 1]] : found
  ), []);
}

function loadJson(name) {
  const candidate = value(name);
  if (!candidate) throw new Error(`${name} is required.`);
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), candidate), 'utf8'));
}

const profileContracts = Object.freeze({
  'canonical-six': 'release-contract.json',
  'setup-journey': 'setup-journey-release-contract.json',
});

try {
  const selectedProfiles = values('--profile');
  if (selectedProfiles.length > 1) throw new Error('--profile must not be repeated.');
  const profile = selectedProfiles[0] || 'canonical-six';
  const contractFile = profileContracts[profile];
  if (!contractFile) throw new Error('--profile must be canonical-six or setup-journey.');
  const contract = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', contractFile), 'utf8'));
  verifyReadback(loadJson('--manifest'), loadJson('--readback'), contract);
  process.stdout.write('release-readback-ok\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Readback verification failed.'}\n`);
  process.exitCode = 1;
}
