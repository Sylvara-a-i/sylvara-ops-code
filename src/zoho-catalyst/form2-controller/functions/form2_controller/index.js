"use strict";

const http = require("node:http");
const { createRequestListener } = require("./lib/catalyst-adapter");

// Catalyst's blank Advanced I/O contract loads an exported native HTTP server.
module.exports = http.createServer(createRequestListener());
