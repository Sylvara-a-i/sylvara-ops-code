'use strict';
const vm = require('node:vm');
const assert = require('node:assert/strict');

// Offline execution of this caller's generated native control flow, not a second
// classifier or a general Deluge implementation. JavaScript strict comparisons,
// JSON parsing, conversions and the clock stub do not certify CRM compilation or
// native coercion. Every invocation has its own VM and no network/file bindings.
function compile(source) {
  assert.match(source, /^string (standalone|automation)\.[a-zA-Z_][a-zA-Z0-9_]*\(\)\n\{/);
  const calls = [...source.matchAll(/invokeurl\s*\[[^\]]+\]/g)];
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /type\s*:\s*POST/);
  assert.match(calls[0][0], /detailed\s*:\s*true/);
  assert.match(calls[0][0], /response-format\s*:\s*STRING/);
  let text = source.replace(/^string (standalone|automation)\.[a-zA-Z_][a-zA-Z0-9_]*\(\)/, '(function()');
  text = text.replace(calls[0][0], '__invoke()') + ')()';
  // Split literals/comments so no fixture bytes can become syntax or be edited.
  text = text.split(/("(?:\\.|[^"\\])*"|\/\/[^\n]*)/g).map((part, index) => index % 2 ? part : part
    .replace(/(?<![=!])==(?!=)/g, '===').replace(/(?<![=!])!=(?!=)/g, '!==')
    .replace(/\.length\(\)/g, '.__length()')).join('');
  return new vm.Script(text, { filename: 'synthetic-storage-caller.deluge-subset.js' });
}

const shims = new vm.Script(`
  function ifnull(value, fallback) { return value == null ? fallback : value; }
  const mapPrototype = Object.create(null);
  function Map() { return Object.create(mapPrototype); }
  function hydrate(value) {
    if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) hydrate(child);
      Object.setPrototypeOf(value, mapPrototype);
    }
    return value;
  }
  function method(proto, name, fn) { Object.defineProperty(proto, name, {__proto__:null, value:fn, configurable:true}); }
  method(mapPrototype, 'get', function(key) {
    __fault('get', this, key);
    return Object.hasOwn(this,key) ? this[key] : null;
  });
  method(mapPrototype, 'put', function(key, value) {
    __fault('put', this, key);
    this[key] = value;
  });
  method(mapPrototype, 'size', function() { __fault('size', this); return Object.keys(this).length; });
  method(mapPrototype, 'toString', function() { __fault('mapString', this); return JSON.stringify(this); });
  method(String.prototype, 'toMap', function() { __fault('toMap', String(this)); return hydrate(JSON.parse(String(this))); });
  method(String.prototype, 'matches', function(pattern) { return new RegExp(pattern).test(String(this)); });
  method(String.prototype, '__length', function() { return String(this).length; });
  function toLong() {
    __fault('toLong', this.valueOf());
    const text = String(this);
    if (!/^-?[0-9]+$/.test(text) || !Number.isSafeInteger(Number(text))) throw Error('conversion failed');
    return Number(text);
  }
  method(String.prototype, 'toLong', toLong);
  method(Number.prototype, 'toLong', toLong);
  method(String.prototype, 'unixEpoch', function(zone) {
    if (zone !== 'UTC') throw Error('unsupported timezone');
    return __epoch(String(this));
  });
  const zoho = {currenttime: {toString(format, zone) {
    if (format !== 'dd-MMM-yyyy HH:mm:ss' || zone !== 'UTC') throw Error('unsupported format');
    return __clock();
  }}};
`);

function execute(script, args, fault = () => {}) {
  const counts = { invocations: 0, clockSamples: 0, epochConversions: 0 };
  const context = vm.createContext({
    __fault: fault,
    __invoke: () => {
      counts.invocations++;
      fault('invoke');
      // Cross the VM through JSON, so maps use this invocation's own prototypes.
      return vm.runInContext('hydrate(JSON.parse(__responseJSON))', context);
    },
    __responseJSON: JSON.stringify(args.response),
    __clock: () => {
      counts.clockSamples++;
      fault('clock', counts.clockSamples);
      return counts.clockSamples === 1 ? 'synthetic-dispatch' : 'synthetic-receipt';
    },
    __epoch: label => {
      counts.epochConversions++;
      fault('epoch', label);
      return label === 'synthetic-dispatch' ? args.dispatchAt : args.receivedAt;
    }
  }, { codeGeneration: { strings: false, wasm: false } });
  shims.runInContext(context, { timeout: 1000 });
  const raw = script.runInContext(context, { timeout: 1000 });
  const checks = Array.from({ length: 32 }, (_, index) => ({
    checked: context['scd_clause_' + (index + 1) + '_checked'],
    passed: context['scd_clause_' + (index + 1) + '_passed']
  }));
  return { raw, output: JSON.parse(raw), counts, checks };
}
module.exports = { compile, execute };
