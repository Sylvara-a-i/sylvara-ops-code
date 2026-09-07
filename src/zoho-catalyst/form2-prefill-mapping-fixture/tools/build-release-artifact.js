#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { runCli } = require(path.resolve(
  __dirname,
  "../../../../tools/build-catalyst-function-artifact.js"
));

runCli({
  label: "Form2PrefillMappingFixture",
  componentSubpath: "src/zoho-catalyst/form2-prefill-mapping-fixture",
  target: "form2_prefill_mapping_fixture",
  schemaVersion: "form2-prefill-mapping-fixture-release-v1"
}, { scriptPath: __filename });
