"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const RELEASE_ROOT = path.resolve(__dirname, "..");
const REPOSITORY_ROOT = path.resolve(RELEASE_ROOT, "../../..");
const CONTRACT = deepFreeze(JSON.parse(
  fs.readFileSync(path.join(RELEASE_ROOT, "private-route-packet-contract.json"), "utf8"),
));
const MAX_APPROVAL_WINDOW_MS = 15 * 60 * 1000;

function fail(message) {
  throw new Error(`Catalyst route packet rejected: ${message}`);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value, expected, label) {
  if (!plainObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} fields are not exact`);
}

function numericId(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,29}$/.test(value)) fail(`${label} is invalid`);
  return value;
}

function numericHeaderId(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} is invalid`);
  return value;
}

function privateEndpoint(value, label) {
  if (
    typeof value !== "string" ||
    !/^\/[a-z][a-z0-9-]{2,31}\/[A-Za-z0-9_-]{32,64}$/.test(value) ||
    value.includes("//") || value.includes("..") || value.includes("*")
  ) fail(`${label} is not a bounded private route`);
  return value;
}

function runtimePath(value, label) {
  if (
    typeof value !== "string" ||
    !/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/.test(value) ||
    value.includes("//") || value.includes("..") || value.includes("*") || value.endsWith("/")
  ) fail(`${label} is not a bounded runtime path`);
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function digestRoutePacket(packet) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(packet)), "utf8").digest("hex");
}

function digestRouteContract(contract = CONTRACT) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(contract)), "utf8").digest("hex");
}

const ROUTE_CONTRACT_SHA256 = digestRouteContract();

function digestRuntimePathBindings(bindings) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(bindings)), "utf8").digest("hex");
}

function digestMatches(actual, expected) {
  return typeof actual === "string" && /^[a-f0-9]{64}$/.test(actual)
    && crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function canonicalUtcTimestampMs(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) fail(`${label} must be a canonical UTC timestamp`);
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs) || new Date(timestampMs).toISOString() !== value) {
    fail(`${label} must be a real canonical UTC timestamp`);
  }
  return timestampMs;
}

function validateApprovalWindow(approval, nowMs = Date.now()) {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) fail("approval validation time is invalid");
  if (approval.singleUse !== true) fail("approval must be explicitly single-use");
  const capturedAtMs = canonicalUtcTimestampMs(approval.capturedAt, "approval.capturedAt");
  const expiresAtMs = canonicalUtcTimestampMs(approval.expiresAt, "approval.expiresAt");
  if (
    expiresAtMs <= capturedAtMs ||
    expiresAtMs - capturedAtMs > MAX_APPROVAL_WINDOW_MS
  ) fail("approval validity window must be positive and no longer than 15 minutes");
  if (capturedAtMs > nowMs) fail("approval is not yet valid");
  if (nowMs >= expiresAtMs) fail("approval has expired");
}

function validateRuntimePathBindings(packet) {
  if (!Array.isArray(packet.runtimePathBindings) || packet.runtimePathBindings.length !== CONTRACT.routes.length) {
    fail("runtime path binding count is not exact");
  }

  const pathsByFunction = new Map();
  packet.runtimePathBindings.forEach((binding, index) => {
    const expected = CONTRACT.routes[index];
    exactKeys(
      binding,
      ["function", "pathReference", "routeId", "runtimePath"],
      `runtimePathBindings[${index}]`,
    );
    if (
      binding.routeId !== expected.id ||
      binding.function !== expected.function ||
      binding.pathReference !== expected.path_reference
    ) fail(`runtimePathBindings[${index}] identity, function, or path reference drifted`);
    runtimePath(binding.runtimePath, `runtimePathBindings[${index}].runtimePath`);

    const usedPaths = pathsByFunction.get(binding.function) || new Set();
    if (usedPaths.has(binding.runtimePath)) fail(`function ${binding.function} reuses a runtime path`);
    usedPaths.add(binding.runtimePath);
    pathsByFunction.set(binding.function, usedPaths);
  });

  const digest = digestRuntimePathBindings(packet.runtimePathBindings);
  if (!/^[a-f0-9]{64}$/.test(packet.runtimePathBindingsSha256)) {
    fail("runtimePathBindingsSha256 is invalid");
  }
  if (packet.runtimePathBindingsSha256 !== digest) {
    fail("runtime path bindings do not match the approved digest");
  }
  return digest;
}

function validateRoutePacket(packet) {
  exactKeys(packet, [
    "approvedSourceRevision", "environment", "gatewayActivationAuthorized", "gatewayPrestate",
    "organizationId", "phase", "prestateEvidenceSha256", "projectId", "rollback", "routes",
    "routeContractSha256", "runtimePathBindings", "runtimePathBindingsSha256", "schemaVersion",
  ], "packet");
  if (packet.schemaVersion !== CONTRACT.schema_version) fail("schemaVersion drifted");
  if (!new Set(["definition", "bound"]).has(packet.phase)) fail("phase is invalid");
  if (packet.environment !== "Development") fail("environment must be Development");
  if (!/^[a-f0-9]{40}$/.test(packet.approvedSourceRevision)) fail("approvedSourceRevision is invalid");
  if (!/^[a-f0-9]{64}$/.test(packet.prestateEvidenceSha256)) fail("prestateEvidenceSha256 is invalid");
  if (!digestMatches(packet.routeContractSha256, ROUTE_CONTRACT_SHA256)) {
    fail("routeContractSha256 does not match the immutable route contract");
  }
  numericHeaderId(packet.organizationId, "organizationId");
  numericId(packet.projectId, "projectId");
  if (packet.gatewayActivationAuthorized !== false) fail("gateway activation is not authorized by this packet");

  exactKeys(packet.gatewayPrestate, ["enabled", "routeCount"], "gatewayPrestate");
  if (packet.gatewayPrestate.enabled !== false || packet.gatewayPrestate.routeCount !== 0) {
    fail("gateway prestate must be disabled with zero routes");
  }
  exactKeys(packet.rollback, [
    "preserveLegacyResources", "restoreCallersBeforeRoutes", "restoreGlobalGatewayState",
  ], "rollback");
  if (
    packet.rollback.restoreCallersBeforeRoutes !== true ||
    packet.rollback.restoreGlobalGatewayState !== "disabled" ||
    packet.rollback.preserveLegacyResources !== true
  ) fail("rollback contract drifted");

  const runtimePathBindingsSha256 = validateRuntimePathBindings(packet);

  if (!Array.isArray(packet.routes) || packet.routes.length !== CONTRACT.routes.length) {
    fail("physical route count is not exact");
  }
  const endpoints = new Set();
  const targetIdsByFunction = new Map();
  packet.routes.forEach((route, index) => {
    const expected = CONTRACT.routes[index];
    exactKeys(route, ["id", "sourceEndpoint", "targetId"], `routes[${index}]`);
    if (route.id !== expected.id) fail(`routes[${index}] identity or ordering drifted`);
    privateEndpoint(route.sourceEndpoint, `routes[${index}].sourceEndpoint`);
    if (endpoints.has(route.sourceEndpoint)) fail("source endpoints must be unique");
    endpoints.add(route.sourceEndpoint);
    if (packet.phase === "definition") {
      if (route.targetId !== null) fail("definition phase cannot preclaim function IDs");
      return;
    }
    numericId(route.targetId, `routes[${index}].targetId`);
    const prior = targetIdsByFunction.get(expected.function);
    if (prior && prior !== route.targetId) fail(`function ${expected.function} has conflicting target IDs`);
    targetIdsByFunction.set(expected.function, route.targetId);
  });
  if (packet.phase === "bound") {
    const ids = [...targetIdsByFunction.values()];
    if (new Set(ids).size !== targetIdsByFunction.size) fail("different functions share a target ID");
  }

  return Object.freeze({
    digest: digestRoutePacket(packet),
    phase: packet.phase,
    routeContractSha256: ROUTE_CONTRACT_SHA256,
    routeCount: packet.routes.length,
    runtimePathBindingsSha256,
    schemaVersion: packet.schemaVersion,
  });
}

function validateRouteApproval(
  approval,
  packet,
  packetDigest = digestRoutePacket(packet),
  nowMs = Date.now(),
) {
  exactKeys(approval, [
    "approvedSourceRevision", "capturedAt", "expiresAt", "packetSha256",
    "prestateEvidenceSha256", "routeContractSha256", "routeCreationAuthorized", "schemaVersion",
    "singleUse",
  ], "approval");
  if (approval.schemaVersion !== 1) fail("approval.schemaVersion must be 1");
  if (approval.routeCreationAuthorized !== true) fail("route creation is not authorized");
  validateApprovalWindow(approval, nowMs);
  if (
    approval.approvedSourceRevision !== packet.approvedSourceRevision ||
    approval.prestateEvidenceSha256 !== packet.prestateEvidenceSha256 ||
    approval.routeContractSha256 !== packet.routeContractSha256 ||
    !digestMatches(approval.routeContractSha256, ROUTE_CONTRACT_SHA256) ||
    !digestMatches(approval.packetSha256, packetDigest)
  ) fail("private route approval does not match this exact packet and target binding");
  return approval;
}

function buildRouteRequests(packet, approval, nowMs = Date.now()) {
  const result = validateRoutePacket(packet);
  if (result.phase !== "bound") fail("route requests require a bound packet");
  validateRouteApproval(approval, packet, result.digest, nowMs);
  return CONTRACT.routes.map((route, index) => {
    const runtimeBinding = packet.runtimePathBindings[index];
    return {
      body: {
        authentication: [...route.authentication],
        method: route.method,
        name: route.id,
        source_endpoint: packet.routes[index].sourceEndpoint,
        target: "Advanced IO Function",
        // Advanced I/O targets use the deployed function name plus that function's exact runtime path.
        target_endpoint: `/server/${route.function}${runtimeBinding.runtimePath}`,
        target_id: packet.routes[index].targetId,
        throttling: {
          ip: { duration: { minutes: 1 }, limit: route.per_ip_per_minute },
          overall: { duration: { minutes: 1 }, limit: route.overall_per_minute },
        },
      },
      headers: {
        "Catalyst-org": packet.organizationId,
        Environment: packet.environment,
      },
      path_variables: { projectId: packet.projectId },
    };
  });
}

function repositoryWorktreeRoots() {
  let output;
  try {
    output = execFileSync(
      "git",
      ["-C", REPOSITORY_ROOT, "worktree", "list", "--porcelain", "-z"],
      { encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true },
    );
  } catch {
    fail("public repository worktree inventory is unavailable");
  }
  const roots = new Set();
  for (const field of output.split("\0")) {
    if (!field.startsWith("worktree ")) continue;
    try {
      roots.add(fs.realpathSync(field.slice("worktree ".length)));
    } catch {
      // A prunable missing worktree cannot contain the existing candidate path.
    }
  }
  const currentRoot = fs.realpathSync(REPOSITORY_ROOT);
  if (!roots.has(currentRoot)) fail("current public repository worktree is not inventoried");
  return Object.freeze([...roots]);
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function assertPrivatePacketPath(packetPath) {
  if (!path.isAbsolute(packetPath)) fail("packet path must be absolute");
  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(packetPath));
  } catch {
    fail("packet file must already exist and resolve physically");
  }
  if (repositoryWorktreeRoots().some((root) => isWithinRoot(root, resolved))) {
    fail("packet file must remain outside the public repository");
  }
  return resolved;
}

function run(argv, nowMs = Date.now()) {
  if (argv.length < 1 || argv.length > 2) {
    fail("usage: node validate-private-route-packet.js <absolute-private-packet-path> [absolute-private-approval-path]");
  }
  const packetPath = assertPrivatePacketPath(argv[0]);
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const result = validateRoutePacket(packet);
  if (result.phase === "bound") {
    if (argv.length !== 2) fail("a bound packet requires a separate private approval envelope");
    const approvalPath = assertPrivatePacketPath(argv[1]);
    const approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
    validateRouteApproval(approval, packet, result.digest, nowMs);
  } else if (argv.length !== 1) {
    fail("a definition packet does not accept a route-creation approval envelope");
  }
  process.stdout.write(
    `Catalyst route packet valid: schema=${result.schemaVersion} phase=${result.phase} ` +
    `routes=${result.routeCount} routeContractSha256=${result.routeContractSha256} ` +
    `runtimeBindingsSha256=${result.runtimePathBindingsSha256} ` +
    `sha256=${result.digest}\n`,
  );
}

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONTRACT,
  REPOSITORY_ROOT,
  assertPrivatePacketPath,
  buildRouteRequests,
  digestRouteContract,
  digestRoutePacket,
  digestRuntimePathBindings,
  ROUTE_CONTRACT_SHA256,
  validateRouteApproval,
  validateRoutePacket,
};
