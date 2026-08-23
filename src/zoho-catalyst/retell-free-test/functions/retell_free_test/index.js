'use strict';

const http = require('node:http');

/**
 * Deliberate deployment barrier. The pure lifecycle is tested, but Catalyst's
 * conditional-write and nullable-unique behavior has not been read back in
 * Development. Returning a fixed 503 prevents repository source from being
 * mistaken for an approved live ingress boundary.
 */
module.exports = http.createServer((_request, response) => {
  response.statusCode = 503;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify({
    ok: false,
    code: 'development_runtime_not_enabled',
  }));
});
