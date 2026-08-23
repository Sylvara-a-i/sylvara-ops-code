"use strict";

const { createRequestListener } = require("./lib/catalyst-adapter");

// Zoho Catalyst invokes this exported Advanced I/O listener.
module.exports = createRequestListener();
