'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSafeConsoleLogger, safeFields } = require('../lib/logging');

test('safe logging strips identifiers, payloads, endpoints, tokens, and error messages', () => {
  assert.deepEqual(safeFields({
    event: 'analytics_sync_run', state: 'Succeeded', examined: 1,
    sourceRevision: 'a'.repeat(40), clientId: 'private', callKey: 'private',
    payload: { private: true }, token: 'private', endpoint: 'private', error: 'private',
  }), {
    event: 'analytics_sync_run', state: 'Succeeded', examined: 1,
    sourceRevision: 'a'.repeat(40),
  });
  const lines = [];
  const logger = createSafeConsoleLogger({ info: (line) => lines.push(line) });
  logger.info({ event: 'analytics_sync_run', state: 'Succeeded', token: 'private' });
  assert.deepEqual(JSON.parse(lines[0]), { event: 'analytics_sync_run', state: 'Succeeded' });
});
