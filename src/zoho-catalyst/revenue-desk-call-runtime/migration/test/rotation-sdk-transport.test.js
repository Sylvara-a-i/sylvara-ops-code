'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const gateway = path.resolve(__dirname, '../../functions/revenue_desk_call_gateway');
const sdk = path.dirname(require.resolve('zcatalyst-sdk-node/package.json', { paths: [gateway] }));
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Characterize the locked dependency, not provider durability or live rotation.
// Load its actual source; substitute only IO/diagnostics and deny unknown imports.
function fixture(retryOverride) {
  assert.equal(json(path.join(gateway, 'package-lock.json')).packages['node_modules/zcatalyst-sdk-node'].version, '3.4.0');
  assert.equal(json(path.join(sdk, 'package.json')).version, '3.4.0');
  const allowed = new Set([
    'lib/utils/api-request.js', 'lib/utils/constants.js', 'lib/utils/helper.js',
    'lib/utils/request-agent.js', 'lib/utils/error.js', 'lib/utils/validator.js',
    'lib/datastore/table.js', 'lib/datastore/bulk-job.js', 'package.json',
  ].map((file) => path.join(sdk, file)));
  for (const file of ['catalyst-store.js', 'errors.js']) allowed.add(path.join(gateway, 'lib', file));
  const attempts = [];
  const waiters = new Map();
  const timers = new Map();
  const cache = new Map();
  let transportError;
  const forbidden = () => { throw new Error('Unexpected hermetic IO.'); };
  class Agent {}
  const transport = {
    Agent, get: forbidden,
    request(options, callback) {
      assert.equal(options.hostname, 'synthetic.invalid');
      const request = new EventEmitter();
      Object.assign(request, { aborted: false, method: options.method,
        protocol: 'https:', host: options.hostname, path: options.path });
      const chunks = [];
      request.write = (chunk) => chunks.push(chunk);
      request.end = () => {
        const attempt = {
          method: options.method, body: chunks.join(''),
          fail() { request.emit('error', transportError('Synthetic lost response.')); },
          succeed() {
            const response = new EventEmitter();
            Object.assign(response, { statusCode: 200, headers: {}, destroyed: false });
            callback(response);
            response.emit('data', Buffer.from(JSON.stringify({ data: [{ ROWID: '1' }] })));
            response.emit('end');
          },
        };
        attempts.push(attempt);
        waiters.get(attempts.length)?.(attempt);
        waiters.delete(attempts.length);
      };
      return request;
    },
  };
  const modules = new Map([
    ['http', transport], ['https', transport],
    ['url', require('node:url')], ['util', require('node:util')],
    ['querystring', require('node:querystring')],
    [path.join(sdk, 'lib/apminsight.js'), { startTracker: forbidden }],
    [path.join(sdk, 'lib/utils/logger.js'), { LOGGER: { debug() {}, fine() {}, warn() {} } }],
  ]);
  const environment = { X_ZOHO_CATALYST_CONSOLE_URL: 'https://synthetic.invalid' };
  if (retryOverride !== undefined) environment.X_ZOHO_CATALYST_REQ_RETRY = retryOverride;
  const context = vm.createContext({
    Buffer, process: Object.freeze({ env: Object.freeze(environment) }),
    setTimeout(callback, delay) {
      const token = Object.freeze({});
      timers.set(token, { callback, delay });
      return token;
    },
    clearTimeout(token) { timers.delete(token); },
  });
  // A native transport error shares the SDK's realm; preserve its instanceof path.
  transportError = new vm.Script('(message) => new Error(message)').runInContext(context);
  function load(file) {
    assert.ok(allowed.has(file), 'Only allowlisted source may be evaluated.');
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    if (file.endsWith('.json')) module.exports = json(file);
    else {
      const isolatedRequire = (name) => {
        if (modules.has(name)) return modules.get(name);
        if (!name.startsWith('.')) return forbidden();
        let target = path.resolve(path.dirname(file), name);
        if (!path.extname(target)) target += '.js';
        return modules.has(target) ? modules.get(target) : load(target);
      };
      const execute = new vm.Script(`(function(require, module, exports) {\n${fs.readFileSync(file, 'utf8')}\n})`,
        { filename: file }).runInContext(context);
      execute(isolatedRequire, module, module.exports);
    }
    return module.exports;
  }
  const { HttpClient } = load(path.join(sdk, 'lib/utils/api-request.js'));
  const { Table } = load(path.join(sdk, 'lib/datastore/table.js'));
  const table = new Table({ requester: new HttpClient() }, { table_name: 'SyntheticJournal' });
  const { createCatalystStore } = load(path.join(gateway, 'lib/catalyst-store.js'));
  let pendingInsert;
  const store = createCatalystStore({
    datastore: () => ({ table: () => ({
      insertRow(row) {
        pendingInsert = table.insertRow(row);
        return pendingInsert;
      },
    }) }),
    zcql: forbidden,
  }, {
    environment: 'development', platformTimeoutMs: 25,
    tables: Object.fromEntries(['SyntheticJournal', 'SyntheticA', 'SyntheticB',
      'SyntheticC', 'SyntheticD', 'SyntheticE', 'SyntheticF'].map((name) => [name, name])),
  });
  const row = { REVISION: 1, CHECKPOINT: 'synthetic-checkpoint' };
  return {
    attempts,
    insert: () => table.insertRow(row),
    boundedInsert: () => store.insert('SyntheticJournal', row),
    pendingInsert: () => pendingInsert,
    nextAttempt(count) {
      return attempts[count - 1] || new Promise((resolve) => waiters.set(count, resolve));
    },
    expireDeadline() {
      assert.equal(timers.size, 1);
      const [token, timer] = timers.entries().next().value;
      assert.equal(timer.delay, 25);
      timers.delete(token);
      timer.callback();
    },
    assertNoTimers() { assert.equal(timers.size, 0); },
  };
}

test('locked SDK limits default JSON insert transport failures to three total attempts', async () => {
  const transport = fixture();
  const rejected = assert.rejects(transport.insert(), (error) => error.code === 'api/request_failure');
  for (let count = 1; count <= 3; count += 1) {
    const attempt = await transport.nextAttempt(count);
    assert.equal(attempt.method, 'POST');
    assert.deepEqual(JSON.parse(attempt.body), [{ REVISION: 1, CHECKPOINT: 'synthetic-checkpoint' }]);
    attempt.fail();
  }
  await rejected;
  assert.equal(transport.attempts.length, 3);
  assert.equal(new Set(transport.attempts.map((attempt) => attempt.body)).size, 1);
  transport.assertNoTimers();
});

test('outer ambiguous timeout does not cancel an SDK insert retry or its late completion', async () => {
  const transport = fixture();
  const operation = transport.boundedInsert();
  const rejected = assert.rejects(operation,
    (error) => error.code === 'CATALYST_OPERATION_TIMEOUT' && error.ambiguous === true);
  const first = await transport.nextAttempt(1);
  const underlying = transport.pendingInsert();
  transport.expireDeadline();
  await rejected;
  transport.assertNoTimers();
  assert.equal(transport.attempts.length, 1);

  // The timeout settled the caller, but the original SDK operation still retries.
  first.fail();
  const retry = await transport.nextAttempt(2);
  assert.equal(retry.body, first.body);
  retry.succeed();
  assert.equal((await underlying).ROWID, '1');
  assert.equal(transport.attempts.length, 2);
  await assert.rejects(operation, (error) => error.code === 'CATALYST_OPERATION_TIMEOUT');
  transport.assertNoTimers();
});

test('locked SDK string zero retry override permits retries beyond the default attempt limit', async () => {
  const transport = fixture('0');
  const operation = transport.insert();
  // Prevent a changed dependency's earlier rejection becoming an unhandled rejection.
  operation.catch(() => {});
  for (let count = 1; count <= 3; count += 1) {
    const attempt = await transport.nextAttempt(count);
    attempt.fail();
    assert.equal(transport.attempts.length, count + 1);
  }
  // Stop this bounded characterization with success; never run an infinite fault loop.
  transport.attempts[3].succeed();
  assert.equal((await operation).ROWID, '1');
  assert.equal(transport.attempts.length, 4);
  transport.assertNoTimers();
});
