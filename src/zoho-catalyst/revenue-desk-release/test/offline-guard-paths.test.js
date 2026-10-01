'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { installOfflineGuard } = require('./helpers/offline-guard');

test('managed checkout sources remain readable while credential paths stay denied', () => {
  const root = path.resolve(__dirname, '../../../..');
  const guard = installOfflineGuard();
  try {
    assert.ok(fs.readFileSync(__filename, 'utf8').includes('installOfflineGuard'));
    for (const candidate of [
      path.join(root, '.env'), path.join(root, '.codex', 'auth.json'),
      path.join(root, 'credentials', 'example.json'),
      path.join(path.parse(root).root, 'outside-synthetic', '.codex', 'auth.json'),
    ]) assert.throws(() => fs.readFileSync(candidate), { code: 'OFFLINE_ONLY' });
    assert.deepEqual(guard.blocked, Array(4).fill('credential file read'));
  } finally { guard.restore(); }
});
