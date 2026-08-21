"use strict";

const { createRequestListener } = require("./lib/catalyst-adapter");

// Catalyst invokes the exported Advanced I/O handler directly.
module.exports = createRequestListener();
