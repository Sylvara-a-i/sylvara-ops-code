'use strict';

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

// Catalyst invokes the exported Advanced I/O handler with native request and
// response objects. Exporting an http.Server fails in the hosted runtime even
// though it behaves correctly when exercised as a local Node server.
module.exports = createRequestListener({
  catalystSdk: catalyst,
  logger: createSafeConsoleLogger(console),
});
