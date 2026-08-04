"use strict";

const http = require("node:http");
const { createRequestListener } = require("./lib/catalyst-adapter");

// Catalyst's blank Advanced I/O template loads an exported native HTTP server.
module.exports = http.createServer(createRequestListener());
