#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { EXPECTED, SENTINEL } = require("./stamp-form-destination");
const { runCli } = require(path.resolve(
  __dirname,
  "../../../../tools/build-catalyst-function-artifact.js",
));

runCli({
  label: "RevenueLeakTestSetupForm",
  componentSubpath: "src/zoho-catalyst/revenue-leak-test-setup-form",
  target: "revenue_leak_test_setup_form",
  schemaVersion: "revenue-leak-test-setup-form-release-v1",
  extraStamp: {
    environmentName: "APPROVED_FORM2_DESTINATION_SHA256",
    relativePath: "functions/revenue_leak_test_setup_form/lib/form-destination.js",
    sentinel: SENTINEL,
    constantName: "ARTIFACT_FORM_DESTINATION_SHA256",
    expectedSource: EXPECTED,
  },
}, { scriptPath: __filename });
