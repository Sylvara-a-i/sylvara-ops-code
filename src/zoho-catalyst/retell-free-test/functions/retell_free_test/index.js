'use strict';

const http = require('node:http');
const { createRequestListener } = require('./lib/runtime-boundary');
const { createSafeConsoleLogger } = require('./lib/logging');

// Keep SDK loading behind the request-time Development boundary. This lets the
// repository's offline Quick verifier inspect the entrypoint without installing
// deployment dependencies and avoids SDK initialization for rejected hosts.
const catalyst = {
  initialize(context) {
    return require('zcatalyst-sdk-node').initialize(context);
  },
};

// Catalyst Advanced I/O loads an exported native Node HTTP server.
module.exports = http.createServer(createRequestListener({
  catalystSdk: catalyst,
  logger: createSafeConsoleLogger(console),
}));
