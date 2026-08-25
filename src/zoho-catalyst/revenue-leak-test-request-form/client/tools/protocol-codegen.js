"use strict";

const fs = require("node:fs");
const path = require("node:path");

const canonicalPath = path.resolve(
  __dirname,
  "../../functions/revenue_leak_test_request_form/lib/field-setup-protocol.js",
);
const outputPath = path.resolve(__dirname, "../field-setup/protocol.generated.js");

function render(protocol) {
  const payload = JSON.stringify(protocol, null, 2)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return `/* Generated from the canonical server protocol. Do not edit by hand. */
(function exposeFieldSetupProtocol(root, factory) {
  const protocol = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = protocol;
  }

  if (root) {
    root.FieldSetupProtocol = protocol;
  }
})(typeof globalThis === "object" ? globalThis : undefined, function createFieldSetupProtocol() {
  "use strict";

  const protocol =
${payload};

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    return Object.freeze(value);
  }

  return deepFreeze(protocol);
});
`;
}

function main(argv) {
  delete require.cache[require.resolve(canonicalPath)];
  const protocol = require(canonicalPath);
  const expected = render(protocol);
  if (argv.includes("--write")) {
    fs.writeFileSync(outputPath, expected, "utf8");
    return;
  }
  if (argv.includes("--check")) {
    const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
    if (actual !== expected) {
      throw new Error("Generated field-setup protocol is stale; run protocol-codegen.js --write");
    }
    return;
  }
  throw new Error("Use --write or --check");
}

main(process.argv.slice(2));
