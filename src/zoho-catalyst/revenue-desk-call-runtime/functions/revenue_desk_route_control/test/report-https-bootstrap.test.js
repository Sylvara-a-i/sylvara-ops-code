'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const analyticsLib = path.resolve(__dirname,
  '../../../../revenue-desk-analytics/functions/analytics_sync/lib');
const bootstrapPath = path.join(analyticsLib, 'report-https-bootstrap.js');
const entrypointPath = path.resolve(__dirname, '../index.js');
const bootstrapImport = './reporting/revenue-desk-analytics/functions/analytics_sync/lib/report-https-bootstrap';
const held = { code: 'REPORT_RUN_RECONCILIATION_REQUIRED', ambiguous: true };

// Each instance has its own CommonJS state and synthetic HTTPS object. These
// tests never replace process-wide core functions or acquire SDK credentials.
function loadSource(filename, requireImpl) {
  const module = { exports: {} };
  const execute = vm.runInNewContext(
    `(function(require, module, exports) {\n${fs.readFileSync(filename, 'utf8')}\n})`,
    {}, { filename });
  execute(requireImpl, module, module.exports);
  return module.exports;
}

function bootstrapFor(https) {
  return loadSource(bootstrapPath, (name) => {
    if (name === 'node:https') return https;
    if (name === 'node:util') return require('node:util');
    assert.fail(`Unexpected bootstrap dependency: ${name}`);
  });
}

test('bootstrap requires explicit initialization and captures one callable identity without dispatch', () => {
  let calls = 0;
  const request = () => { calls += 1; assert.fail('Bootstrap must not dispatch'); };
  const https = { request };
  const bootstrap = bootstrapFor(https);
  assert.equal(Object.isFrozen(bootstrap), true);
  assert.throws(() => bootstrap.assertHttpsBootstrap(), held);
  bootstrap.initializeHttpsBootstrap();
  assert.strictEqual(bootstrap.assertHttpsBootstrap(), request);
  assert.strictEqual(bootstrap.assertHttpsBootstrap(), request);
  assert.throws(() => bootstrap.initializeHttpsBootstrap(), held);
  assert.equal(calls, 0);
});

test('bootstrap rejects accessor capture without invoking the getter and cannot recover by reinitializing', () => {
  let getters = 0;
  const https = {};
  Object.defineProperty(https, 'request', {
    configurable: true,
    get() { getters += 1; throw Error('Getter must not execute'); },
  });
  const bootstrap = bootstrapFor(https);
  assert.throws(() => bootstrap.initializeHttpsBootstrap(), held);
  assert.equal(getters, 0);
  Object.defineProperty(https, 'request', { value() {}, configurable: true });
  assert.throws(() => bootstrap.initializeHttpsBootstrap(), held);
  assert.throws(() => bootstrap.assertHttpsBootstrap(), held);
  assert.equal(getters, 0);
});

test('missing and noncallable HTTPS request properties fail terminal first initialization', () => {
  for (const https of [{}, { request: undefined }, { request: null }, { request: 1 }, { request: {} }]) {
    const bootstrap = bootstrapFor(https);
    assert.throws(() => bootstrap.initializeHttpsBootstrap(), held);
    https.request = () => {};
    assert.throws(() => bootstrap.initializeHttpsBootstrap(), held);
    assert.throws(() => bootstrap.assertHttpsBootstrap(), held);
  }
});

test('proxy HTTPS objects and callable proxies are rejected without proxy traps or calls', () => {
  let traps = 0;
  const unexpected = () => { traps += 1; throw Error('Proxy must not execute'); };
  const request = () => assert.fail('Request must not execute');
  const variants = [
    new Proxy({ request }, { get: unexpected, getOwnPropertyDescriptor: unexpected }),
    { request: new Proxy(request, { get: unexpected, apply: unexpected }) },
  ];
  for (const https of variants) {
    const bootstrap = bootstrapFor(https);
    assert.throws(() => bootstrap.initializeHttpsBootstrap(), held);
    assert.throws(() => bootstrap.assertHttpsBootstrap(), held);
  }
  assert.equal(traps, 0);
});

test('continuity rejects replacement, deletion and accessor mutation without evaluating accessors', () => {
  let getters = 0;
  for (const mutate of [
    https => { https.request = () => {}; },
    https => { delete https.request; },
    https => { https.request = null; },
    https => { https.request = new Proxy(() => {}, {}); },
    https => Object.defineProperty(https, 'request', {
      get() { getters += 1; throw Error('Getter must not execute'); },
    }),
  ]) {
    const https = { request() {} };
    const bootstrap = bootstrapFor(https);
    bootstrap.initializeHttpsBootstrap();
    mutate(https);
    assert.throws(() => bootstrap.assertHttpsBootstrap(), held);
    assert.throws(() => bootstrap.initializeHttpsBootstrap(), held);
  }
  assert.equal(getters, 0);
});

function controllerFixture({ mutateImport, mutateFactory, mutateListener } = {}) {
  const https = { request() { assert.fail('Controller startup must not dispatch'); } };
  const bootstrap = bootstrapFor(https);
  const imports = [], factories = [];
  let listenerCalls = 0;
  const listener = () => {};
  const definitions = new Map([
    ['./lib/report-runtime-context', ['createProtectedRuntimeContext', 'runtimeContext']],
    ['./lib/report-storage-qualification', ['createProtectedStorageQualification', 'storageQualification']],
    ['./lib/report-sender-qualification', ['createProtectedSenderQualification', 'senderQualification']],
    ['./lib/report-bootstrap', ['createProtectedReportController', 'reportDelivery']],
  ]);
  const tokens = Object.fromEntries([...definitions.values()].map(([, name]) => [name, () => {}]));
  return {
    bootstrap, imports, factories,
    get listenerCalls() { return listenerCalls; },
    listener,
    load() {
      return loadSource(entrypointPath, (name) => {
        imports.push(name);
        if (name === bootstrapImport) return bootstrap;
        // This fails if any application import precedes explicit initialization.
        bootstrap.assertHttpsBootstrap();
        if (name === mutateImport) https.request = () => {};
        if (name === './lib/http-boundary') return {
          createRequestListener(options) {
            listenerCalls += 1;
            assert.equal(typeof options.catalystSdk.initialize, 'function');
            for (const [factoryName, token] of Object.entries(tokens)) {
              assert.strictEqual(options.factories[factoryName], token);
            }
            if (mutateListener) https.request = () => {};
            return listener;
          },
        };
        const definition = definitions.get(name);
        assert.ok(definition, `Unexpected Controller dependency: ${name}`);
        const [exportName, factoryName] = definition;
        return { [exportName]() {
          factories.push(factoryName);
          if (factoryName === mutateFactory) https.request = () => {};
          return tokens[factoryName];
        } };
      });
    },
  };
}

test('actual Controller entrypoint initializes before imports and constructs the protected factories once', () => {
  const fixture = controllerFixture();
  assert.strictEqual(fixture.load(), fixture.listener);
  assert.equal(fixture.imports[0], bootstrapImport);
  assert.equal(fixture.imports.filter(name => name === bootstrapImport).length, 1);
  assert.deepEqual([...fixture.factories].sort(),
    ['reportDelivery', 'runtimeContext', 'senderQualification', 'storageQualification']);
  assert.equal(fixture.listenerCalls, 1);
  assert.throws(() => fixture.bootstrap.initializeHttpsBootstrap(), held);
});

test('actual Controller rejects HTTPS mutation in the last application import before constructing factories', () => {
  const fixture = controllerFixture({ mutateImport: './lib/report-bootstrap' });
  assert.throws(() => fixture.load(), held);
  assert.deepEqual(fixture.factories, []);
  assert.equal(fixture.listenerCalls, 0);
});

test('actual Controller rejects HTTPS mutation during every protected factory and listener construction', () => {
  for (const mutateFactory of ['runtimeContext', 'reportDelivery', 'storageQualification', 'senderQualification']) {
    const fixture = controllerFixture({ mutateFactory });
    assert.throws(() => fixture.load(), held);
    assert.throws(() => fixture.bootstrap.assertHttpsBootstrap(), held);
  }
  const fixture = controllerFixture({ mutateListener: true });
  assert.throws(() => fixture.load(), held);
  assert.equal(fixture.listenerCalls, 1);
});
