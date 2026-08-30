#!/usr/bin/env node
"use strict";

const { reconcileV2 } = require("../functions/revenue_leak_test_setup_form/lib/v2-reconciliation");

function main({ input = process.stdin, output = process.stdout } = {}) {
  let raw = "";
  input.setEncoding("utf8");
  input.on("data", (chunk) => { raw += chunk; });
  input.on("end", () => {
    if (process.argv.slice(2).length !== 0) {
      throw new Error("This reconciliation command is read-only and accepts no arguments");
    }
    const result = reconcileV2(JSON.parse(raw));
    output.write(`${JSON.stringify(result)}\n`);
  });
}

if (require.main === module) main();

module.exports = { main };
