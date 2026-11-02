'use strict';

// Curated, dependency-free subset of the existing node:test suites. Each file
// installs the repository's offline guard before importing runtime modules.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const gateway = 'src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway';
const control = 'src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_route_control';
const billing = 'src/zoho-catalyst/crm-billing-orchestrator/functions/crm_billing_orchestrator';

if (process.versions.node !== '24.19.0') {
  console.error('Expected Node.js 24.19.0. Run tools/setup-node.ps1 first.');
  process.exit(1);
}
// Do not forward ambient credentials or runtime settings to the test processes.
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']
  .filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1',
  `${gateway}/test/webhook-replay.test.js`,
  `${control}/test/configuration-completion-service.test.js`,
  `${billing}/test/lifecycle-handler.test.js`,
], { cwd: root, env, stdio: 'inherit', timeout: 120_000 });
if (result.error) console.error('Offline regression runner failed:', result.error.code);
process.exit(result.status ?? 1);
