'use strict';

const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

// Defense in depth for this finite, in-process demo. It is not a sandbox for
// arbitrary code: only reviewed repository modules and injected adapters run.
function installOfflineGuard() {
  const restores = [];
  const blocked = [];
  const deny = (boundary) => function forbiddenBoundary() {
    blocked.push(boundary);
    const error = new Error(`OFFLINE_ONLY: ${boundary}`);
    error.code = 'OFFLINE_ONLY';
    throw error;
  };
  const replace = (target, key, value) => {
    const original = target[key];
    target[key] = value;
    restores.push(() => { target[key] = original; });
  };
  for (const [moduleName, names] of [
    ['node:http', ['request', 'get']], ['node:https', ['request', 'get']],
    ['node:http2', ['connect']], ['node:net', ['connect', 'createConnection']],
    ['node:tls', ['connect']], ['node:dgram', ['createSocket']],
    ['node:dns', ['lookup', 'resolve', 'resolve4', 'resolve6']],
    ['node:child_process', ['exec', 'execFile', 'spawn', 'fork', 'execSync', 'execFileSync', 'spawnSync']],
    ['node:worker_threads', ['Worker']],
  ]) {
    const selected = require(moduleName);
    for (const name of names) replace(selected, name, deny(`${moduleName}.${name}`));
  }
  replace(require('node:net').Socket.prototype, 'connect', deny('socket.connect'));
  for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
    replace(require('node:dns').promises, name, deny(`dns.promises.${name}`));
  }
  replace(globalThis, 'fetch', deny('fetch'));
  if (globalThis.WebSocket) replace(globalThis, 'WebSocket', deny('WebSocket'));
  const load = Module._load;
  replace(Module, '_load', function guardedLoad(request, parent, isMain) {
    // Worker/control functions intentionally depend on this workspace package.
    // Resolve reviewed source rather than a stale copied node_modules artifact.
    if (request === 'revenue_desk_call_gateway' || request.startsWith('revenue_desk_call_gateway/')) {
      const suffix = request.slice('revenue_desk_call_gateway'.length);
      const canonical = path.resolve(__dirname,
        '../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway');
      return load.call(this, `${canonical}${suffix}`, parent, isMain);
    }
    if (!Module.isBuiltin(request) && !request.startsWith('.') && !path.isAbsolute(request)) {
      return deny('external SDK or package load')();
    }
    return load.call(this, request, parent, isMain);
  });
  const sensitivePath = (value) => {
    const name = String(value).replaceAll('\\', '/');
    const canonicalGatewayRoot = path.resolve(__dirname,
      '../../../revenue-desk-call-runtime/functions');
    const approvedExamples = ['revenue_desk_call_gateway', 'revenue_desk_route_control',
      'revenue_desk_call_worker'].map((functionName) =>
      path.resolve(canonicalGatewayRoot, functionName, '.env.example'));
    // Explicit public source example for the report-only adapter boundary test;
    // populated env files and every other credential path remain denied.
    approvedExamples.push(path.resolve(__dirname,
      '../../../crm-billing-orchestrator/functions/crm_billing_orchestrator/.env.example'));
    if (approvedExamples.includes(path.resolve(String(value)))) return false;
    return /(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials?|secrets?|tokens?|\.ssh|\.aws|\.azure|\.catalyst|\.codex)(?:\/|$)/i.test(name);
  };
  for (const [selected, names] of [[fs, ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream']],
    [fs.promises, ['readFile', 'open']]]) {
    for (const name of names) {
      const original = selected[name];
      replace(selected, name, function guardedRead(file, ...args) {
        if (sensitivePath(file)) return deny('credential file read')();
        return original.call(this, file, ...args);
      });
    }
  }
  return {
    blocked,
    restore() { while (restores.length) restores.pop()(); },
  };
}

module.exports = { installOfflineGuard };
