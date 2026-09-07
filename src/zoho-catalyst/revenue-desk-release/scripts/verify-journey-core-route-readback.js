"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  CONTRACT: CANONICAL_CONTRACT, assertPrivatePacketPath, currentRepositoryRevision,
  digestRouteContract, digestRouteInventory, digestRoutePacket, expectedRouteReadback,
  readPrivateJson, validateCanonicalRouteIdentityBindings, validateExistingRouteReadback,
} = require("./validate-private-route-packet");

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const CONTRACT = freeze(JSON.parse(fs.readFileSync(path.join(
  __dirname, "../journey-core-route-coexistence-contract.json",
), "utf8")));
const CONTRACT_SHA256 = digestRouteContract({ canonical: CANONICAL_CONTRACT, coexistence: CONTRACT });
const MAX_AGE_MS = CONTRACT.security_policy.maximum_readback_age_minutes * 60 * 1000;

function fail(message) {
  throw new Error(`Journey-core route readback rejected: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    fail(`${label} fields are not exact`);
  }
}

function sourceEndpoint(value) {
  if (typeof value !== "string"
      || !/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/.test(value)
      || value.includes("//")) fail("compatibility source path is invalid");
}

/** Derive fixed expectations; this read-only packet is never a creation packet. */
function expectedCoexistenceRoutes(packet) {
  exactKeys(packet, ["schemaVersion", "profile", "sourceRevision", "contractSha256", "canonicalBindings",
    "compatibilitySourceEndpoints"], "binding packet");
  if (packet.schemaVersion !== 1 || packet.profile !== CONTRACT.profile
      || !/^[a-f0-9]{40}$/.test(packet.sourceRevision || "")
      || packet.contractSha256 !== CONTRACT_SHA256) fail("binding contract drifted");
  const canonical = packet.canonicalBindings;
  validateCanonicalRouteIdentityBindings(canonical);
  const expected = canonical.routes.map((_, index) => expectedRouteReadback(canonical, index));
  if (expected.length !== CONTRACT.canonical_route_count) fail("canonical count drifted");
  const aliases = packet.compatibilitySourceEndpoints;
  if (!Array.isArray(aliases) || aliases.length !== CONTRACT.compatibility_routes.length) {
    fail("compatibility binding count is not exact");
  }
  const usedSources = new Set(expected.map((route) => route.source_endpoint));
  for (const [index, definition] of CONTRACT.compatibility_routes.entries()) {
    const alias = aliases[index];
    exactKeys(alias, ["routeId", "sourceEndpoint"], "compatibility binding");
    if (alias.routeId !== definition.id) fail("compatibility identity or ordering drifted");
    sourceEndpoint(alias.sourceEndpoint);
    if (usedSources.has(alias.sourceEndpoint)) fail("source endpoints must be unique");
    usedSources.add(alias.sourceEndpoint);
    const canonicalIndex = canonical.routes.findIndex((route) =>
      route.id === definition.canonical_route_id);
    if (canonicalIndex < 0) fail("compatibility target is not canonical");
    const runtimePath = canonical.runtimePathBindings[canonicalIndex].runtimePath;
    if (definition.source_endpoint_binding === "runtime_path"
        && alias.sourceEndpoint !== runtimePath) fail("runtime compatibility source drifted");
    // Only explicitly paired aliases share a target. Inherit every security
    // attribute instead of treating a familiar route name as a waiver.
    const aliasRoute = { ...structuredClone(expected[canonicalIndex]),
      name: definition.id, source_endpoint: alias.sourceEndpoint };
    if (definition.throttle_override) {
      // Preserve the one reviewed stricter legacy limit, not an arbitrary
      // caller-supplied "stricter is safe" exception or a provider mutation.
      aliasRoute.throttling.overall.limit = definition.throttle_override.overall_per_minute;
      aliasRoute.throttling.ip.limit = definition.throttle_override.per_ip_per_minute;
    }
    expected.push(aliasRoute);
  }
  if (expected.length !== CONTRACT.physical_route_count) fail("coexistence count drifted");
  return freeze(expected);
}

function validateJourneyCoreRouteReadback(packet, readback, nowMs = Date.now()) {
  const expected = expectedCoexistenceRoutes(packet);
  exactKeys(readback, ["schemaVersion", "profile", "bindingPacketSha256", "environment",
    "organizationId", "projectId", "observedAt", "providerInventoryComplete",
    "gatewayEnabled", "retellRouteMode", "routes", "consumerBindings"], "readback");
  if (readback.schemaVersion !== 1 || readback.profile !== CONTRACT.profile
      || readback.bindingPacketSha256 !== digestRoutePacket(packet)) fail("readback binding drifted");
  if (readback.environment !== CONTRACT.environment
      || readback.organizationId !== packet.canonicalBindings.organizationId
      || readback.projectId !== packet.canonicalBindings.projectId) fail("readback target drifted");
  if (readback.providerInventoryComplete !== true
      || typeof readback.gatewayEnabled !== "boolean"
      || readback.retellRouteMode !== CONTRACT.required_retell_route_mode) {
    fail("complete Development containment readback is required");
  }
  const observed = Date.parse(readback.observedAt);
  if (typeof readback.observedAt !== "string" || !Number.isFinite(observed)
      || new Date(observed).toISOString() !== readback.observedAt
      || !Number.isSafeInteger(nowMs) || observed > nowMs || nowMs - observed > MAX_AGE_MS) {
    fail("readback must be canonical UTC and no older than 15 minutes");
  }
  if (!Array.isArray(readback.routes) || readback.routes.length !== expected.length) {
    fail("readback must contain exactly 24 routes");
  }
  const byName = new Map(expected.map((route) => [route.name, route]));
  const names = new Set();
  for (const [index, route] of readback.routes.entries()) {
    validateExistingRouteReadback(route, index, "coexistenceReadback.routes");
    if (!byName.has(route.name) || names.has(route.name)) fail("unknown or duplicate route");
    names.add(route.name);
    if (digestRouteInventory(route) !== digestRouteInventory(byName.get(route.name))) {
      fail("route target, source, method, authentication or throttling drifted");
    }
  }
  const requiredConsumers = CONTRACT.compatibility_routes.filter((route) => route.acceptance_required);
  if (!Array.isArray(readback.consumerBindings)
      || readback.consumerBindings.length !== requiredConsumers.length) {
    fail("all three required compatibility consumers need fresh readback");
  }
  const consumers = new Set();
  for (const consumer of readback.consumerBindings) {
    exactKeys(consumer, ["consumer", "routeId", "sourceEndpoint"], "consumer binding");
    const definition = requiredConsumers.find((route) => route.required_consumer === consumer.consumer);
    if (!definition || consumers.has(consumer.consumer) || consumer.routeId !== definition.id
        || consumer.sourceEndpoint !== byName.get(definition.id).source_endpoint) {
      fail("required compatibility consumer binding drifted");
    }
    consumers.add(consumer.consumer);
  }
  return freeze({ routeCount: expected.length, requiredCompatibilityConsumerCount: consumers.size,
    routeInventorySha256: digestRouteInventory(readback.routes), contractSha256: CONTRACT_SHA256,
    gatewayEnabled: readback.gatewayEnabled, requestRouteCount: 0,
    routeMutationAuthorized: false, gatewayActivationAuthorized: false,
    runtimeReopeningAuthorized: false, sessionOrEmailTestAuthorized: false,
    retellProviderAccessAuthorized: false });
}

function run(argv, nowMs = Date.now()) {
  if (argv.length !== 2) fail("provide distinct private binding and readback files");
  const packetPath = assertPrivatePacketPath(argv[0]);
  const readbackPath = assertPrivatePacketPath(argv[1]);
  if (packetPath === readbackPath) fail("private files must be distinct");
  const packet = readPrivateJson(packetPath, "Journey-core route bindings");
  const readback = readPrivateJson(readbackPath, "Journey-core route readback");
  if (packet.sourceRevision !== currentRepositoryRevision()) {
    fail("binding source revision does not match current HEAD");
  }
  const result = validateJourneyCoreRouteReadback(packet, readback, nowMs);
  process.stdout.write("Journey-core route inventory verified: routes=24 requests=0; no action authorized.\n");
  return result;
}

if (require.main === module) {
  try { run(process.argv.slice(2)); } catch (_) {
    // Never emit a private JSON parser error, path, endpoint, identifier or body.
    process.stderr.write("Journey-core route readback rejected; no action authorized.\n");
    process.exitCode = 1;
  }
}

module.exports = { CONTRACT, CONTRACT_SHA256, expectedCoexistenceRoutes,
  run, validateJourneyCoreRouteReadback };
