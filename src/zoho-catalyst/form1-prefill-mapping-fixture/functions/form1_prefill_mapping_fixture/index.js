"use strict";

const { createRequestListener } = require("./lib/handler");

// This dependency-free Advanced I/O entrypoint intentionally never initializes
// the Catalyst SDK: the fixture has no platform, CRM, datastore, or outbound I/O.
module.exports = createRequestListener();
