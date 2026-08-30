#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { runCli } = require(path.resolve(
  __dirname,
  "../../../../tools/build-catalyst-function-artifact.js",
));

runCli({
  label: "RevenueLeakTestRequestForm",
  componentSubpath: "src/zoho-catalyst/revenue-leak-test-request-form",
  target: "revenue_leak_test_request_form",
  schemaVersion: "revenue-leak-test-request-form-release-v1",
}, { scriptPath: __filename });
