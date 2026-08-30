"use strict";

const {
  assertPrivatePacketPath,
  currentRepositoryRevision,
  readPrivateJson,
  validateAdditiveFinalReadback,
} = require("./validate-private-route-packet");

function fail(message) {
  throw new Error(`Catalyst route readback rejected: ${message}`);
}

function run(argv, nowMs = Date.now()) {
  if (argv.length !== 2) {
    fail(
      "usage: node verify-private-route-additive-readback.js " +
      "<absolute-private-schema-v3-packet-path> <absolute-private-final-readback-path>",
    );
  }
  const packetPath = assertPrivatePacketPath(argv[0]);
  const readbackPath = assertPrivatePacketPath(argv[1]);
  if (packetPath === readbackPath) fail("packet and final readback files must be distinct");
  const packet = readPrivateJson(packetPath, "private Catalyst route packet");
  const readback = readPrivateJson(readbackPath, "private Catalyst route final readback");
  if (packet.approvedSourceRevision !== currentRepositoryRevision()) {
    fail("packet source revision does not match current repository HEAD");
  }
  const result = validateAdditiveFinalReadback(packet, readback, nowMs);
  process.stdout.write(
    `Catalyst additive route readback valid: schema=${result.schemaVersion} ` +
    `routes=${result.routeCount} gatewayEnabled=${result.gatewayEnabled}\n`,
  );
  return result;
}

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run };
