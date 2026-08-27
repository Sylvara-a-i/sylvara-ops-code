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
const CONTINUATION_PACKET_SCHEMA_VERSION = 2;

const BASE_PACKET_FIELDS = [
  "approvedSourceRevision", "environment", "gatewayActivationAuthorized", "gatewayPrestate",
  "organizationId", "phase", "prestateEvidenceSha256", "projectId", "rollback", "routes",
  "routeContractSha256", "runtimePathBindings", "runtimePathBindingsSha256", "schemaVersion",
];

const CONTINUATION_PACKET_FIELDS = [
  ...BASE_PACKET_FIELDS,
  "existingRoutePrefix", "existingRoutePrefixSha256", "initialBoundPacketSha256",
  "initialPrestateEvidenceSha256", "remainingRoutes",
];

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

function digestExistingRoutePrefix(routes) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(routes)), "utf8").digest("hex");
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

function routeRequestBody(packet, index) {
  const route = CONTRACT.routes[index];
  const runtimeBinding = packet.runtimePathBindings[index];
  return {
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
  };
}

function expectedRouteReadback(packet, index) {
  const request = routeRequestBody(packet, index);
  const duration = { days: 0, hours: 0, minutes: 1, seconds: 0 };
  return {
    authentication: request.authentication,
    method: request.method,
    name: request.name,
    source_endpoint: request.source_endpoint,
    target: "advancedio",
    target_endpoint: request.target_endpoint,
    target_id: request.target_id,
    throttling: {
      ip: { duration: { ...duration }, limit: request.throttling.ip.limit },
      overall: { duration: { ...duration }, limit: request.throttling.overall.limit },
    },
  };
}

function validateGatewayPrestate(packet, expectedRouteCount) {
  exactKeys(packet.gatewayPrestate, ["enabled", "routeCount"], "gatewayPrestate");
  if (
    packet.gatewayPrestate.enabled !== false ||
    packet.gatewayPrestate.routeCount !== expectedRouteCount
  ) {
    fail(`gateway prestate must be disabled with exactly ${expectedRouteCount} routes`);
  }
}

function validateRollback(packet) {
  exactKeys(packet.rollback, [
    "preserveLegacyResources", "restoreCallersBeforeRoutes", "restoreGlobalGatewayState",
  ], "rollback");
  if (
    packet.rollback.restoreCallersBeforeRoutes !== true ||
    packet.rollback.restoreGlobalGatewayState !== "disabled" ||
    packet.rollback.preserveLegacyResources !== true
  ) fail("rollback contract drifted");
}

function validateRouteBindings(packet, requireBoundTargets) {
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
    if (!requireBoundTargets) {
      if (route.targetId !== null) fail("definition phase cannot preclaim function IDs");
      return;
    }
    numericId(route.targetId, `routes[${index}].targetId`);
    const prior = targetIdsByFunction.get(expected.function);
    if (prior && prior !== route.targetId) fail(`function ${expected.function} has conflicting target IDs`);
    targetIdsByFunction.set(expected.function, route.targetId);
  });
  if (requireBoundTargets) {
    const ids = [...targetIdsByFunction.values()];
    if (new Set(ids).size !== targetIdsByFunction.size) fail("different functions share a target ID");
  }
}

function validateExistingRouteReadback(route, index) {
  exactKeys(route, [
    "authentication", "method", "name", "source_endpoint", "target", "target_endpoint",
    "target_id", "throttling",
  ], `existingRoutePrefix[${index}]`);
  if (!Array.isArray(route.authentication)) {
    fail(`existingRoutePrefix[${index}].authentication must be an array`);
  }
  exactKeys(route.throttling, ["ip", "overall"], `existingRoutePrefix[${index}].throttling`);
  for (const scope of ["ip", "overall"]) {
    exactKeys(
      route.throttling[scope],
      ["duration", "limit"],
      `existingRoutePrefix[${index}].throttling.${scope}`,
    );
    exactKeys(
      route.throttling[scope].duration,
      ["days", "hours", "minutes", "seconds"],
      `existingRoutePrefix[${index}].throttling.${scope}.duration`,
    );
  }
}

function normalizeRouteListReadback(route, authentication, index = 0) {
  if (!plainObject(route)) fail(`routeListReadback[${index}] must be an object`);
  if (!Array.isArray(authentication)) {
    fail(`routeListReadback[${index}].authentication must come from an independent UI readback`);
  }

  // The enhanced route-detail response substitutes a function display name for
  // target_id. Only the API-route list preserves the canonical numeric binding.
  // Rebuild the public allowlist explicitly so actor data and provider metadata
  // can never enter the continuation packet or its digest.
  const normalized = {
    authentication: [...authentication],
    method: route.method,
    name: route.name,
    source_endpoint: route.source_endpoint,
    target: route.target,
    target_endpoint: route.target_endpoint,
    target_id: route.target_id,
    throttling: {
      ip: {
        duration: {
          days: route.throttling?.ip?.duration?.days,
          hours: route.throttling?.ip?.duration?.hours,
          minutes: route.throttling?.ip?.duration?.minutes,
          seconds: route.throttling?.ip?.duration?.seconds,
        },
        limit: route.throttling?.ip?.limit,
      },
      overall: {
        duration: {
          days: route.throttling?.overall?.duration?.days,
          hours: route.throttling?.overall?.duration?.hours,
          minutes: route.throttling?.overall?.duration?.minutes,
          seconds: route.throttling?.overall?.duration?.seconds,
        },
        limit: route.throttling?.overall?.limit,
      },
    },
  };
  validateExistingRouteReadback(normalized, index);
  numericId(normalized.target_id, `routeListReadback[${index}].target_id`);
  return normalized;
}

function initialBoundPacketFromContinuation(packet) {
  return {
    approvedSourceRevision: packet.approvedSourceRevision,
    environment: packet.environment,
    gatewayActivationAuthorized: packet.gatewayActivationAuthorized,
    gatewayPrestate: { enabled: false, routeCount: 0 },
    organizationId: packet.organizationId,
    phase: "bound",
    prestateEvidenceSha256: packet.initialPrestateEvidenceSha256,
    projectId: packet.projectId,
    rollback: packet.rollback,
    routes: packet.routes,
    routeContractSha256: packet.routeContractSha256,
    runtimePathBindings: packet.runtimePathBindings,
    runtimePathBindingsSha256: packet.runtimePathBindingsSha256,
    schemaVersion: CONTRACT.schema_version,
  };
}

function validateContinuationState(packet, originalBoundPacket) {
  if (!/^[a-f0-9]{64}$/.test(packet.initialPrestateEvidenceSha256)) {
    fail("initialPrestateEvidenceSha256 is invalid");
  }
  if (packet.prestateEvidenceSha256 === packet.initialPrestateEvidenceSha256) {
    fail("continuation requires fresh current disabled-prestate evidence");
  }
  if (!/^[a-f0-9]{64}$/.test(packet.initialBoundPacketSha256)) {
    fail("initialBoundPacketSha256 is invalid");
  }
  if (!plainObject(originalBoundPacket)) {
    fail("continuation requires the separately preserved original schema-v1 bound packet");
  }
  const originalResult = validateRoutePacket(originalBoundPacket);
  if (
    originalResult.schemaVersion !== CONTRACT.schema_version ||
    originalResult.phase !== "bound"
  ) {
    fail("continuation original packet must be a valid schema-v1 bound packet");
  }
  if (!digestMatches(packet.initialBoundPacketSha256, originalResult.digest)) {
    fail("continuation does not reference the externally supplied original bound packet");
  }
  const reconstructedInitialPacket = initialBoundPacketFromContinuation(packet);
  if (
    JSON.stringify(stableValue(reconstructedInitialPacket)) !==
    JSON.stringify(stableValue(originalBoundPacket))
  ) {
    fail("continuation does not preserve the exact initially approved bound packet");
  }

  if (!Number.isInteger(packet.gatewayPrestate.routeCount)) {
    fail("continuation gateway route count must be an integer");
  }
  const existingCount = packet.gatewayPrestate.routeCount;
  if (existingCount <= 0 || existingCount >= CONTRACT.routes.length) {
    fail("continuation requires a non-empty incomplete canonical route prefix");
  }
  validateGatewayPrestate(packet, existingCount);

  if (!Array.isArray(packet.existingRoutePrefix) || packet.existingRoutePrefix.length !== existingCount) {
    fail("existing route readback count must equal the disabled gateway prestate route count");
  }
  packet.existingRoutePrefix.forEach((route, index) => {
    validateExistingRouteReadback(route, index);
    if (JSON.stringify(stableValue(route)) !== JSON.stringify(stableValue(expectedRouteReadback(packet, index)))) {
      fail(`existingRoutePrefix[${index}] attributes drifted from the canonical prefix`);
    }
  });
  const existingRoutePrefixSha256 = digestExistingRoutePrefix(packet.existingRoutePrefix);
  if (!digestMatches(packet.existingRoutePrefixSha256, existingRoutePrefixSha256)) {
    fail("existing route prefix does not match its allowlisted readback digest");
  }

  const remainingCount = CONTRACT.routes.length - existingCount;
  if (!Array.isArray(packet.remainingRoutes) || packet.remainingRoutes.length !== remainingCount) {
    fail("remaining route count is not the exact canonical suffix");
  }
  packet.remainingRoutes.forEach((route, offset) => {
    const index = existingCount + offset;
    exactKeys(route, ["id", "sourceEndpoint", "targetId"], `remainingRoutes[${offset}]`);
    if (JSON.stringify(stableValue(route)) !== JSON.stringify(stableValue(packet.routes[index]))) {
      fail(`remainingRoutes[${offset}] is not the exact canonical suffix`);
    }
  });

  return Object.freeze({ existingCount, existingRoutePrefixSha256, remainingCount });
}

function validateRoutePacket(packet, originalBoundPacket) {
  if (!plainObject(packet)) fail("packet must be an object");
  if (packet.schemaVersion === CONTRACT.schema_version) {
    exactKeys(packet, BASE_PACKET_FIELDS, "packet");
    if (!new Set(["definition", "bound"]).has(packet.phase)) fail("phase is invalid");
  } else if (packet.schemaVersion === CONTINUATION_PACKET_SCHEMA_VERSION) {
    exactKeys(packet, CONTINUATION_PACKET_FIELDS, "packet");
    if (packet.phase !== "continuation") fail("schema-v2 phase must be continuation");
  } else {
    fail("schemaVersion drifted");
  }
  if (packet.environment !== "Development") fail("environment must be Development");
  if (!/^[a-f0-9]{40}$/.test(packet.approvedSourceRevision)) fail("approvedSourceRevision is invalid");
  if (!/^[a-f0-9]{64}$/.test(packet.prestateEvidenceSha256)) fail("prestateEvidenceSha256 is invalid");
  if (!digestMatches(packet.routeContractSha256, ROUTE_CONTRACT_SHA256)) {
    fail("routeContractSha256 does not match the immutable route contract");
  }
  numericHeaderId(packet.organizationId, "organizationId");
  numericId(packet.projectId, "projectId");
  if (packet.gatewayActivationAuthorized !== false) fail("gateway activation is not authorized by this packet");

  validateRollback(packet);

  const runtimePathBindingsSha256 = validateRuntimePathBindings(packet);
  validateRouteBindings(packet, packet.phase !== "definition");

  let existingRouteCount = 0;
  let requestRouteCount = CONTRACT.routes.length;
  let existingRoutePrefixSha256 = null;
  if (packet.schemaVersion === CONTRACT.schema_version) {
    validateGatewayPrestate(packet, 0);
  } else {
    const continuation = validateContinuationState(packet, originalBoundPacket);
    existingRouteCount = continuation.existingCount;
    requestRouteCount = continuation.remainingCount;
    existingRoutePrefixSha256 = continuation.existingRoutePrefixSha256;
  }

  return Object.freeze({
    digest: digestRoutePacket(packet),
    existingRouteCount,
    existingRoutePrefixSha256,
    phase: packet.phase,
    requestRouteCount,
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
  const continuationApprovalFields = [
    "continuationAuthorized", "existingRoutePrefixSha256", "initialBoundPacketSha256",
  ];
  exactKeys(approval, [
    "approvedSourceRevision", "capturedAt", "expiresAt", "packetSha256",
    "prestateEvidenceSha256", "routeContractSha256", "routeCreationAuthorized", "schemaVersion",
    "singleUse",
    ...(packet.schemaVersion === CONTINUATION_PACKET_SCHEMA_VERSION ? continuationApprovalFields : []),
  ], "approval");
  if (approval.schemaVersion !== packet.schemaVersion) {
    fail("approval.schemaVersion must match the packet schemaVersion");
  }
  if (approval.routeCreationAuthorized !== true) fail("route creation is not authorized");
  if (packet.schemaVersion === CONTINUATION_PACKET_SCHEMA_VERSION) {
    if (approval.continuationAuthorized !== true) fail("continuation is not explicitly authorized");
    if (
      approval.existingRoutePrefixSha256 !== packet.existingRoutePrefixSha256 ||
      approval.initialBoundPacketSha256 !== packet.initialBoundPacketSha256
    ) fail("continuation approval does not match the initial packet and existing-route evidence");
  } else if (packet.schemaVersion !== CONTRACT.schema_version) {
    fail("approval packet schemaVersion is unsupported");
  }
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

function buildRouteRequests(packet, approval, nowMs = Date.now(), originalBoundPacket) {
  const result = validateRoutePacket(packet, originalBoundPacket);
  if (!new Set(["bound", "continuation"]).has(result.phase)) {
    fail("route requests require a bound packet or schema-v2 continuation packet");
  }
  validateRouteApproval(approval, packet, result.digest, nowMs);
  return CONTRACT.routes.slice(result.existingRouteCount).map((_, offset) => {
    const index = result.existingRouteCount + offset;
    return {
      body: routeRequestBody(packet, index),
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
  if (argv.length < 1 || argv.length > 3) {
    fail(
      "usage: node validate-private-route-packet.js <absolute-private-packet-path> " +
      "[absolute-private-approval-path] [absolute-private-original-bound-packet-path]",
    );
  }
  const packetPath = assertPrivatePacketPath(argv[0]);
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  let originalBoundPacket;
  if (packet.schemaVersion === CONTINUATION_PACKET_SCHEMA_VERSION) {
    if (argv.length !== 3) {
      fail("a continuation packet requires its approval and the preserved original bound packet");
    }
    const originalPacketPath = assertPrivatePacketPath(argv[2]);
    originalBoundPacket = JSON.parse(fs.readFileSync(originalPacketPath, "utf8"));
  } else if (argv.length > 2) {
    fail("only a continuation packet accepts an original bound packet");
  }
  const result = validateRoutePacket(packet, originalBoundPacket);
  if (new Set(["bound", "continuation"]).has(result.phase)) {
    const expectedArgumentCount = result.phase === "continuation" ? 3 : 2;
    if (argv.length !== expectedArgumentCount) {
      fail("a bound or continuation packet requires a separate private approval envelope");
    }
    const approvalPath = assertPrivatePacketPath(argv[1]);
    const approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
    validateRouteApproval(approval, packet, result.digest, nowMs);
  } else if (argv.length !== 1) {
    fail("a definition packet does not accept a route-creation approval envelope");
  }
  process.stdout.write(
    `Catalyst route packet valid: schema=${result.schemaVersion} phase=${result.phase} ` +
    `routes=${result.routeCount} requests=${result.requestRouteCount} ` +
    `routeContractSha256=${result.routeContractSha256} ` +
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
  digestExistingRoutePrefix,
  digestRouteContract,
  digestRoutePacket,
  digestRuntimePathBindings,
  normalizeRouteListReadback,
  ROUTE_CONTRACT_SHA256,
  validateRouteApproval,
  validateRoutePacket,
};
