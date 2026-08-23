'use strict';

const http = require('node:http');
const catalyst = require('zcatalyst-sdk-node');
const { createRequestListener } = require('./lib/runtime-boundary');
const { createSafeConsoleLogger } = require('./lib/logging');

// Catalyst Advanced I/O loads an exported native Node HTTP server.
module.exports = http.createServer(createRequestListener({
  catalystSdk: catalyst,
  logger: createSafeConsoleLogger(console),
}));
