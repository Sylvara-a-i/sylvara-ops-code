'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const packageRoot = path.resolve(__dirname, '..');
const recordId = '10000000001';
const errorMessage = 'Free-Test Setup could not be opened. No automatic retry was attempted.';

const scripts = [
  {
    name: 'Lead assisted Form 1 launcher',
    source: 'open_free_test_setup_leads.js',
    module: 'Leads',
    functionName: 'open_free_test_setup',
    prefix: '{{FORM1_ACCESS_PUBLIC_URL}}#journeyToken=',
    parameters: [
      ['record_id', recordId],
      ['crm_module', 'Leads'],
    ],
  },
  {
    name: 'Deal Form 2 launcher',
    source: 'open_free_test_setup_deals.js',
    module: 'Deals',
    functionName: 'issue_revenue_leak_test_setup',
    prefix: '{{FORM2_ACCESS_PUBLIC_URL}}#setupToken=',
    parameters: [['deal_id', recordId]],
  },
];

function validResponse(config, accessUrl = `${config.prefix}${'A'.repeat(43)}`) {
  return {
    code: 'success',
    details: {
      output_type: 'string',
      output: JSON.stringify({
        schemaVersion: 'crm-launch-v1',
        ok: true,
        accessUrl,
      }),
    },
  };
}

function runClientScript(config, overrides = {}) {
  const events = [];
  const calls = {
    execute: [],
    loader: [],
    messages: [],
    open: [],
  };
  const response = Object.prototype.hasOwnProperty.call(overrides, 'response')
    ? overrides.response
    : validResponse(config);
  const source = fs.readFileSync(
    path.join(packageRoot, 'client-scripts', config.source),
    'utf8',
  );
  const sandbox = {
    $Page: {
      module: Object.prototype.hasOwnProperty.call(overrides, 'module')
        ? overrides.module
        : config.module,
      record_id: Object.prototype.hasOwnProperty.call(overrides, 'recordId')
        ? overrides.recordId
        : recordId,
    },
    ZDK: {
      Client: {
        showLoader(options) {
          events.push('showLoader');
          calls.loader.push(['show', options]);
          if (overrides.showLoaderError) {
            throw new Error('synthetic_show_loader_error');
          }
        },
        hideLoader() {
          events.push('hideLoader');
          calls.loader.push(['hide']);
          if (overrides.hideLoaderError) {
            throw new Error('synthetic_hide_loader_error');
          }
        },
        showMessage(message, options) {
          events.push('showMessage');
          calls.messages.push([message, JSON.parse(JSON.stringify(options))]);
        },
      },
      Apps: {
        CRM: {
          Functions: {
            execute(functionName, parameters) {
              events.push('execute');
              calls.execute.push({
                functionName,
                parameters: JSON.parse(JSON.stringify(Array.from(parameters.entries()))),
              });
              if (overrides.executeError) {
                throw new Error('synthetic_execute_error');
              }
              return response;
            },
          },
        },
      },
    },
    $Client: {
      openURL(accessUrl) {
        events.push('openURL');
        calls.open.push(accessUrl);
        if (overrides.openError) {
          throw new Error('synthetic_open_error');
        }
      },
    },
  };

  let unhandledError = null;
  try {
    vm.runInNewContext(source, sandbox, {
      filename: config.source,
      timeout: 1_000,
    });
  } catch (error) {
    unhandledError = error;
  }

  return { calls, events, unhandledError };
}

function assertOneSafeError(result) {
  assert.equal(result.unhandledError, null);
  assert.deepEqual(result.calls.open, []);
  assert.deepEqual(result.calls.messages, [[errorMessage, { type: 'error' }]]);
}

for (const config of scripts) {
  test(`${config.name} opens only the exact validated provider response`, () => {
    const result = runClientScript(config);
    assert.equal(result.unhandledError, null);
    assert.deepEqual(result.calls.execute, [{
      functionName: config.functionName,
      parameters: config.parameters,
    }]);
    assert.deepEqual(result.calls.open, [`${config.prefix}${'A'.repeat(43)}`]);
    assert.deepEqual(result.calls.messages, []);
    assert.deepEqual(result.calls.loader.map(([operation]) => operation), ['show', 'hide']);
    assert.ok(result.events.indexOf('hideLoader') < result.events.indexOf('openURL'));
  });

  test(`${config.name} rejects invalid record and module context before execution`, () => {
    for (const overrides of [
      { module: 'Contacts' },
      { module: null },
      { recordId: '0' },
      { recordId: 10000000001 },
      { recordId: '10000000001?x=1' },
    ]) {
      const result = runClientScript(config, overrides);
      assertOneSafeError(result);
      assert.deepEqual(result.calls.execute, []);
      assert.deepEqual(result.calls.loader, []);
    }
  });

  test(`${config.name} contains provider execution and UI API failures`, () => {
    const executeFailure = runClientScript(config, { executeError: true });
    assertOneSafeError(executeFailure);
    assert.deepEqual(
      executeFailure.calls.loader.map(([operation]) => operation),
      ['show', 'hide'],
    );

    const showLoaderFailure = runClientScript(config, { showLoaderError: true });
    assertOneSafeError(showLoaderFailure);
    assert.deepEqual(showLoaderFailure.calls.execute, []);

    const hideLoaderFailure = runClientScript(config, { hideLoaderError: true });
    assertOneSafeError(hideLoaderFailure);
    assert.equal(hideLoaderFailure.calls.execute.length, 1);

    const openFailure = runClientScript(config, { openError: true });
    assert.equal(openFailure.unhandledError, null);
    assert.deepEqual(openFailure.calls.open, [`${config.prefix}${'A'.repeat(43)}`]);
    assert.deepEqual(openFailure.calls.messages, [[errorMessage, { type: 'error' }]]);
  });

  test(`${config.name} rejects malformed or unsafe function responses`, () => {
    const unsafeUrlCases = [
      `${config.prefix}${'A'.repeat(42)}`,
      `${config.prefix}${'A'.repeat(42)}+`,
      `${config.prefix}${'A'.repeat(42)}?`,
      `${config.prefix}${'A'.repeat(42)}&`,
      `${config.prefix}${'A'.repeat(42)} `,
      `${config.prefix}${recordId}${'A'.repeat(32)}`,
      `{{WRONG_PUBLIC_URL}}#token=${'A'.repeat(43)}`,
    ];
    const malformedResponses = [
      null,
      'success',
      {},
      { code: 'error', details: { output: '{}' } },
      { code: 'success', details: null },
      { code: 'success', details: { output_type: 'map', output: '{}' } },
      { code: 'success', details: { output: '' } },
      { code: 'success', details: { output: 'x'.repeat(4_097) } },
      { code: 'success', details: { output: '{' } },
      { code: 'success', details: { output: 'null' } },
      { code: 'success', details: { output: '[]' } },
      { code: 'success', details: { output: JSON.stringify({
        schemaVersion: 'crm-launch-v1', ok: true, accessUrl: `${config.prefix}${'A'.repeat(43)}`,
        extra: true,
      }) } },
      { code: 'success', details: { output: JSON.stringify({
        schemaVersion: 'crm-launch-v2', ok: true, accessUrl: `${config.prefix}${'A'.repeat(43)}`,
      }) } },
      { code: 'success', details: { output: JSON.stringify({
        schemaVersion: 'crm-launch-v1', ok: false, accessUrl: `${config.prefix}${'A'.repeat(43)}`,
      }) } },
      ...unsafeUrlCases.map((accessUrl) => validResponse(config, accessUrl)),
    ];

    for (const responseCase of malformedResponses) {
      const result = runClientScript(config, { response: responseCase });
      assertOneSafeError(result);
      assert.equal(result.calls.execute.length, 1);
      assert.deepEqual(result.calls.loader.map(([operation]) => operation), ['show', 'hide']);
    }
  });
}
