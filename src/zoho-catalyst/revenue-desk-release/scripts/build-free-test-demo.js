'use strict';

// Install the process-wide deny boundary before importing the synthetic harness.
const { installOfflineGuard } = require('../test/helpers/offline-guard');
installOfflineGuard();
const fs = require('node:fs');
const path = require('node:path');
const { renderFreeTestDemo } = require('../lib/free-test-demo-view');
const { runFreeTestDemo } = require('../test/helpers/free-test-demo');

async function main() {
  if (process.versions.node !== '24.19.0' || process.argv.length !== 2) {
    throw new Error('PINNED_NODE_AND_NO_INPUT_FILES_REQUIRED');
  }
  const output = path.resolve(__dirname, '../../../..', '.codex-tmp', 'free-test-demo');
  const demo = await runFreeTestDemo();
  const html = renderFreeTestDemo(demo);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(output, 'synthetic-report.json'), `${JSON.stringify(demo, null, 2)}\n`, 'utf8');
  console.log('Synthetic demo built locally. No live provider or communication was invoked.');
  console.log(path.join(output, 'index.html'));
}

main().catch(() => { console.error('Synthetic demo build failed; no live fallback is permitted.'); process.exitCode = 1; });
