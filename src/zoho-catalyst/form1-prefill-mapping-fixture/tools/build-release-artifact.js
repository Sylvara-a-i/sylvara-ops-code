#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { runCli } = require(path.resolve(
  __dirname,
  "../../../../tools/build-catalyst-function-artifact.js"
));

runCli({
  label: "Form1PrefillMappingFixture",
  componentSubpath: "src/zoho-catalyst/form1-prefill-mapping-fixture",
  target: "form1_prefill_mapping_fixture",
  schemaVersion: "form1-prefill-mapping-fixture-release-v1"
}, { scriptPath: __filename });
