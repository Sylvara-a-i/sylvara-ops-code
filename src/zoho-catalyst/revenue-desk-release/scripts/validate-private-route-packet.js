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
const ADDITIVE_RECONCILIATION_PACKET_SCHEMA_VERSION = 3;
const READBACK_MAX_AGE_MS = 15 * 60 * 1000;
const MAX_PRIVATE_FILE_BYTES = 1024 * 1024;
const CLAIM_NAMESPACE = "catalyst-route-additive-reconciliation-v3";
const ADDITIVE_CONSUMPTION_DIGEST_DOMAIN =
  "sylvara.catalyst-route-additive-reconciliation-consumption.v1";

const BASE_PACKET_FIELDS = [
  "approvedSourceRevision", "environment", "gatewayActivationAuthorized", "gatewayPrestate",
  "organizationId", "phase", "prestateEvidenceSha256", "projectId", "rollback", "routeProfile", "routes",
  "routeContractSha256", "runtimePathBindings", "runtimePathBindingsSha256", "schemaVersion",
];

const CONTINUATION_PACKET_FIELDS = [
  ...BASE_PACKET_FIELDS,
  "existingRoutePrefix", "existingRoutePrefixSha256", "initialBoundPacketSha256",
  "initialPrestateEvidenceSha256", "remainingRoutes",
];

const ADDITIVE_RECONCILIATION_PACKET_FIELDS = [
  ...BASE_PACKET_FIELDS,
  "billingMutationAuthorized", "existingRouteInventory", "existingRouteInventorySha256",
  "existingRouteMutationAuthorized", "missingRoutes", "missingRoutesSha256",
  "operationAuthorizationId", "prestateObservedAt", "preservedDeferredRouteIds",
  "providerInventoryComplete", "retryAuthorized",
];

const ADDITIVE_FINAL_READBACK_FIELDS = [
  "environment", "gatewayEnabled", "observedAt", "organizationId", "packetSha256",
  "projectId", "providerInventoryComplete", "routes", "schemaVersion",
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

function digestRouteInventory(routes) {
  return digestExistingRoutePrefix(routes);
}

function digestMissingRoutes(routes) {
  return digestExistingRoutePrefix(routes);
}

function digestOperationAuthorization(packet) {
  return crypto.createHash("sha256")
    .update(`${ADDITIVE_CONSUMPTION_DIGEST_DOMAIN}\0`, "utf8")
    .update(JSON.stringify(stableValue({
      operationAuthorizationId: packet.operationAuthorizationId,
      packetSha256: digestRoutePacket(packet),
    })), "utf8")
    .digest("hex");
}

function digestMatches(actual, expected) {
  return typeof actual === "string" && /^[a-f0-9]{64}$/.test(actual)
    && crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function operationAuthorizationId(value, label) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ) fail(`${label} must be a lowercase UUIDv4`);
  return value;
}

function routeProfileRoutes(packet) {
  if (typeof packet.routeProfile !== "string") fail("routeProfile is required");
  const profile = CONTRACT.route_profiles?.[packet.routeProfile];
  if (!plainObject(profile) || !Array.isArray(profile.route_ids) || profile.route_ids.length === 0) {
    fail("routeProfile is not a closed route profile");
  }
  const routesById = new Map(CONTRACT.routes.map((route) => [route.id, route]));
  if (new Set(profile.route_ids).size !== profile.route_ids.length) {
    fail("routeProfile contains duplicate route identities");
  }
  const routes = profile.route_ids.map((id) => routesById.get(id));
  if (routes.some((route) => !route)) fail("routeProfile references an unknown route");
  return routes;
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
  const profileRoutes = routeProfileRoutes(packet);
  if (!Array.isArray(packet.runtimePathBindings) || packet.runtimePathBindings.length !== profileRoutes.length) {
    fail("runtime path binding count is not exact");
  }

  const pathsByFunction = new Map();
  packet.runtimePathBindings.forEach((binding, index) => {
    const expected = profileRoutes[index];
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
  const route = routeProfileRoutes(packet)[index];
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

function advancedIoFormBinding(request) {
  if (!plainObject(request)) fail("Advanced I/O form request must be an object");
  if (request.target !== "Advanced IO Function") {
    fail("Advanced I/O form request target is invalid");
  }
  numericId(request.target_id, "Advanced I/O form request target_id");
  if (typeof request.target_endpoint !== "string") {
    fail("Advanced I/O form target endpoint is invalid");
  }
  const match = request.target_endpoint.match(
    /^\/server\/([a-z][a-z0-9_]{2,63})(\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-])$/,
  );
  if (!match) fail("Advanced I/O form target endpoint is invalid");
  runtimePath(match[2], "Advanced I/O form runtime path");

  // Catalyst renders the separator after the selected function. Supplying the
  // runtime path's leading slash in the suffix field creates a noncanonical
  // double slash in the persisted target endpoint.
  return Object.freeze({
    functionName: match[1],
    pathInput: match[2].slice(1),
  });
}

function expectedRouteReadbackFromRequest(request) {
  const duration = { days: 0, hours: 0, minutes: 1, seconds: 0 };
  return {
    authentication: Array.isArray(request.authentication) ? [...request.authentication] : request.authentication,
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

function expectedRouteReadback(packet, index) {
  return expectedRouteReadbackFromRequest(routeRequestBody(packet, index));
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
  const profileRoutes = routeProfileRoutes(packet);
  if (!Array.isArray(packet.routes) || packet.routes.length !== profileRoutes.length) {
    fail("physical route count is not exact");
  }
  const endpoints = new Set();
  const targetIdsByFunction = new Map();
  packet.routes.forEach((route, index) => {
    const expected = profileRoutes[index];
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

function validateExistingRouteReadback(route, index, collection = "existingRoutePrefix") {
  exactKeys(route, [
    "authentication", "method", "name", "source_endpoint", "target", "target_endpoint",
    "target_id", "throttling",
  ], `${collection}[${index}]`);
  if (!Array.isArray(route.authentication)) {
    fail(`${collection}[${index}].authentication must be an array`);
  }
  exactKeys(route.throttling, ["ip", "overall"], `${collection}[${index}].throttling`);
  for (const scope of ["ip", "overall"]) {
    exactKeys(
      route.throttling[scope],
      ["duration", "limit"],
      `${collection}[${index}].throttling.${scope}`,
    );
    exactKeys(
      route.throttling[scope].duration,
      ["days", "hours", "minutes", "seconds"],
      `${collection}[${index}].throttling.${scope}.duration`,
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

function validatePreservedDeferredRouteReadback(route, index, collection) {
  validateExistingRouteReadback(route, index, collection);
  const allowed = CONTRACT.additive_reconciliation?.allowed_preserved_deferred_route_ids;
  if (!Array.isArray(allowed) || !allowed.includes(route.name)) {
    fail(`${collection}[${index}] is not an allowed preserved deferred route`);
  }
  const canonical = CONTRACT.routes.find((candidate) => candidate.id === route.name);
  if (!canonical) fail(`${collection}[${index}] references an unknown deferred route`);
  privateEndpoint(route.source_endpoint, `${collection}[${index}].source_endpoint`);
  numericId(route.target_id, `${collection}[${index}].target_id`);
  const binding = advancedIoFormBinding({
    target: "Advanced IO Function",
    target_endpoint: route.target_endpoint,
    target_id: route.target_id,
  });
  if (binding.functionName !== canonical.function) {
    fail(`${collection}[${index}] deferred target function drifted`);
  }
  const expected = expectedRouteReadbackFromRequest({
    authentication: canonical.authentication,
    method: canonical.method,
    name: canonical.id,
    source_endpoint: route.source_endpoint,
    target: "Advanced IO Function",
    target_endpoint: route.target_endpoint,
    target_id: route.target_id,
    throttling: {
      ip: { duration: { minutes: 1 }, limit: canonical.per_ip_per_minute },
      overall: { duration: { minutes: 1 }, limit: canonical.overall_per_minute },
    },
  });
  if (JSON.stringify(stableValue(route)) !== JSON.stringify(stableValue(expected))) {
    fail(`${collection}[${index}] deferred route attributes drifted`);
  }
}

function validateAdditiveReconciliationState(packet) {
  const policy = CONTRACT.additive_reconciliation;
  if (
    !plainObject(policy) ||
    policy.packet_schema_version !== ADDITIVE_RECONCILIATION_PACKET_SCHEMA_VERSION ||
    policy.route_profile !== "setup-journey" ||
    policy.operation_authorization_id_required !== true ||
    policy.durable_consumption_required !== true ||
    policy.retry_authorized !== false ||
    policy.claim_namespace !== CLAIM_NAMESPACE ||
    policy.consumption_digest_domain !== ADDITIVE_CONSUMPTION_DIGEST_DOMAIN
  ) fail("additive reconciliation policy is unavailable or drifted");
  if (packet.routeProfile !== policy.route_profile) {
    fail("additive reconciliation is restricted to the setup-journey route profile");
  }
  if (packet.providerInventoryComplete !== true) {
    fail("additive reconciliation requires an explicitly complete provider route inventory");
  }
  operationAuthorizationId(
    packet.operationAuthorizationId,
    "operationAuthorizationId",
  );
  if (packet.retryAuthorized !== false) {
    fail("additive reconciliation does not authorize retry or replay");
  }
  if (
    packet.existingRouteMutationAuthorized !== policy.existing_route_mutation_authorized ||
    packet.existingRouteMutationAuthorized !== false
  ) fail("existing route mutation is not authorized");
  if (
    packet.billingMutationAuthorized !== policy.billing_mutation_authorized ||
    packet.billingMutationAuthorized !== false
  ) fail("CRM Billing mutation is not authorized");
  canonicalUtcTimestampMs(packet.prestateObservedAt, "prestateObservedAt");

  if (!Number.isInteger(packet.gatewayPrestate?.routeCount)) {
    fail("additive reconciliation gateway route count must be an integer");
  }
  const existingCount = packet.gatewayPrestate.routeCount;
  if (existingCount <= 0) {
    fail("additive reconciliation requires a non-empty provider route inventory");
  }
  validateGatewayPrestate(packet, existingCount);
  if (
    !Array.isArray(packet.existingRouteInventory) ||
    packet.existingRouteInventory.length !== existingCount
  ) fail("provider route inventory count must equal the disabled gateway prestate route count");

  const profileRoutes = routeProfileRoutes(packet);
  const profileIndexById = new Map(profileRoutes.map((route, index) => [route.id, index]));
  const routeNames = new Set();
  const sourceEndpoints = new Set();
  const targetEndpoints = new Set();
  const presentSetupRouteIds = new Set();
  const preservedDeferredRouteIds = [];

  packet.existingRouteInventory.forEach((route, index) => {
    validateExistingRouteReadback(route, index, "existingRouteInventory");
    if (routeNames.has(route.name)) {
      fail(`existingRouteInventory[${index}] duplicates canonical route identity ${route.name}`);
    }
    routeNames.add(route.name);
    if (sourceEndpoints.has(route.source_endpoint)) {
      fail(`existingRouteInventory[${index}] reuses a provider source endpoint`);
    }
    sourceEndpoints.add(route.source_endpoint);
    if (targetEndpoints.has(route.target_endpoint)) {
      fail(`existingRouteInventory[${index}] reuses a provider target endpoint`);
    }
    targetEndpoints.add(route.target_endpoint);

    const profileIndex = profileIndexById.get(route.name);
    if (profileIndex !== undefined) {
      if (
        JSON.stringify(stableValue(route)) !==
        JSON.stringify(stableValue(expectedRouteReadback(packet, profileIndex)))
      ) fail(`existingRouteInventory[${index}] setup-journey route attributes drifted`);
      presentSetupRouteIds.add(route.name);
      return;
    }

    validatePreservedDeferredRouteReadback(route, index, "existingRouteInventory");
    preservedDeferredRouteIds.push(route.name);
  });

  const allowedDeferredRouteIds = policy.allowed_preserved_deferred_route_ids;
  if (
    !Array.isArray(packet.preservedDeferredRouteIds) ||
    JSON.stringify(packet.preservedDeferredRouteIds) !== JSON.stringify(preservedDeferredRouteIds) ||
    preservedDeferredRouteIds.some((id) => !allowedDeferredRouteIds.includes(id))
  ) fail("preserved deferred route inventory is not exact");

  const setupSourceEndpoints = new Set(packet.routes.map((route) => route.sourceEndpoint));
  const setupTargetIds = new Set(packet.routes.map((route) => route.targetId));
  packet.existingRouteInventory.forEach((route, index) => {
    if (!preservedDeferredRouteIds.includes(route.name)) return;
    if (setupSourceEndpoints.has(route.source_endpoint)) {
      fail(`existingRouteInventory[${index}] deferred route reuses a setup source endpoint`);
    }
    if (setupTargetIds.has(route.target_id)) {
      fail(`existingRouteInventory[${index}] deferred route reuses a setup function target ID`);
    }
  });

  if (presentSetupRouteIds.size === profileRoutes.length) {
    fail("additive reconciliation cannot authorize an already-complete setup-journey inventory");
  }
  const missingIndexes = profileRoutes
    .map((route, index) => ({ id: route.id, index }))
    .filter(({ id }) => !presentSetupRouteIds.has(id))
    .map(({ index }) => index);
  const expectedMissingRoutes = missingIndexes.map((index) => packet.routes[index]);
  if (
    !Array.isArray(packet.missingRoutes) ||
    packet.missingRoutes.length === 0 ||
    JSON.stringify(stableValue(packet.missingRoutes)) !==
      JSON.stringify(stableValue(expectedMissingRoutes))
  ) fail("missingRoutes is not the exact canonical set of absent setup-journey routes");

  const existingRouteInventorySha256 = digestRouteInventory(packet.existingRouteInventory);
  if (!digestMatches(packet.existingRouteInventorySha256, existingRouteInventorySha256)) {
    fail("provider route inventory does not match its allowlisted readback digest");
  }
  const missingRoutesSha256 = digestMissingRoutes(packet.missingRoutes);
  if (!digestMatches(packet.missingRoutesSha256, missingRoutesSha256)) {
    fail("missing setup route set does not match its canonical digest");
  }

  return Object.freeze({
    existingCount,
    existingRouteInventorySha256,
    missingCount: missingIndexes.length,
    missingIndexes: Object.freeze(missingIndexes),
    missingRoutesSha256,
    preservedDeferredRouteIds: Object.freeze([...preservedDeferredRouteIds]),
  });
}

function buildAdvancedIoTargetRemediation(input) {
  exactKeys(input, [
    "authentication", "index", "originalBoundPacket", "packet", "packetSha256", "route",
  ], "Advanced I/O remediation input");
  const {
    authentication, index, originalBoundPacket, packet, packetSha256, route,
  } = input;
  const packetResult = validateRoutePacket(packet, originalBoundPacket);
  if (!new Set(["bound", "continuation"]).has(packetResult.phase)) {
    fail("Advanced I/O remediation requires a bound or continuation packet");
  }
  if (!digestMatches(packetSha256, packetResult.digest)) {
    fail("Advanced I/O remediation packet provenance does not match the canonical packet");
  }
  if (
    !Number.isInteger(index) ||
    index < packetResult.existingRouteCount ||
    index >= packetResult.routeCount
  ) {
    fail("Advanced I/O remediation index is outside the authorized canonical suffix");
  }

  const current = normalizeRouteListReadback(route, authentication, index);
  const request = routeRequestBody(packet, index);
  const proposed = expectedRouteReadback(packet, index);
  const binding = advancedIoFormBinding(request);
  const changedFields = Object.keys(proposed).filter(
    (key) => JSON.stringify(stableValue(current[key])) !== JSON.stringify(stableValue(proposed[key])),
  );
  if (JSON.stringify(changedFields) !== JSON.stringify(["target_endpoint"])) {
    fail("Advanced I/O remediation must change only target_endpoint");
  }
  const exactDoubleSlash = `/server/${binding.functionName}//${binding.pathInput}`;
  if (current.target_endpoint !== exactDoubleSlash) {
    fail("Advanced I/O remediation prestate is not the exact duplicate-separator defect");
  }
  if (proposed.target_endpoint !== `/server/${binding.functionName}/${binding.pathInput}`) {
    fail("Advanced I/O remediation proposal is not the canonical single-separator target");
  }
  return deepFreeze({
    canonicalIndex: index,
    changedFields,
    current,
    formBinding: binding,
    packetSha256: packetResult.digest,
    proposed,
    target: {
      environment: packet.environment,
      organizationId: packet.organizationId,
      projectId: packet.projectId,
    },
  });
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
    routeProfile: packet.routeProfile,
    routes: packet.routes,
    routeContractSha256: packet.routeContractSha256,
    runtimePathBindings: packet.runtimePathBindings,
    runtimePathBindingsSha256: packet.runtimePathBindingsSha256,
    schemaVersion: CONTRACT.schema_version,
  };
}

function validateContinuationState(packet, originalBoundPacket) {
  const profileRoutes = routeProfileRoutes(packet);
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
  if (existingCount <= 0 || existingCount >= profileRoutes.length) {
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

  const remainingCount = profileRoutes.length - existingCount;
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
  } else if (packet.schemaVersion === ADDITIVE_RECONCILIATION_PACKET_SCHEMA_VERSION) {
    exactKeys(packet, ADDITIVE_RECONCILIATION_PACKET_FIELDS, "packet");
    if (packet.phase !== "additive_reconciliation") {
      fail("schema-v3 phase must be additive_reconciliation");
    }
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
  const profileRoutes = routeProfileRoutes(packet);

  validateRollback(packet);

  const runtimePathBindingsSha256 = validateRuntimePathBindings(packet);
  validateRouteBindings(packet, packet.phase !== "definition");

  let existingRouteCount = 0;
  let requestRouteCount = profileRoutes.length;
  let existingRoutePrefixSha256 = null;
  let existingRouteInventorySha256 = null;
  let missingRoutesSha256 = null;
  let preservedDeferredRouteIds = Object.freeze([]);
  let requestRouteIndexes = Object.freeze(profileRoutes.map((_, index) => index));
  let operationAuthorizationIdValue = null;
  let consumptionDigest = null;
  if (packet.schemaVersion === CONTRACT.schema_version) {
    validateGatewayPrestate(packet, 0);
  } else if (packet.schemaVersion === CONTINUATION_PACKET_SCHEMA_VERSION) {
    const continuation = validateContinuationState(packet, originalBoundPacket);
    existingRouteCount = continuation.existingCount;
    requestRouteCount = continuation.remainingCount;
    existingRoutePrefixSha256 = continuation.existingRoutePrefixSha256;
    requestRouteIndexes = Object.freeze(
      profileRoutes.slice(existingRouteCount).map((_, offset) => existingRouteCount + offset),
    );
  } else {
    const reconciliation = validateAdditiveReconciliationState(packet);
    existingRouteCount = reconciliation.existingCount;
    existingRouteInventorySha256 = reconciliation.existingRouteInventorySha256;
    missingRoutesSha256 = reconciliation.missingRoutesSha256;
    preservedDeferredRouteIds = reconciliation.preservedDeferredRouteIds;
    requestRouteCount = reconciliation.missingCount;
    requestRouteIndexes = reconciliation.missingIndexes;
    operationAuthorizationIdValue = packet.operationAuthorizationId;
    consumptionDigest = digestOperationAuthorization(packet);
  }

  return Object.freeze({
    digest: digestRoutePacket(packet),
    existingRouteCount,
    existingRouteInventorySha256,
    existingRoutePrefixSha256,
    missingRoutesSha256,
    consumptionDigest,
    operationAuthorizationId: operationAuthorizationIdValue,
    phase: packet.phase,
    preservedDeferredRouteIds,
    requestRouteCount,
    requestRouteIndexes,
    routeProfile: packet.routeProfile,
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
  const additiveReconciliationApprovalFields = [
    "additiveReconciliationAuthorized", "billingMutationAuthorized",
    "consumptionSha256", "durableConsumptionRequired", "existingRouteInventorySha256",
    "existingRouteMutationAuthorized", "missingRoutesSha256", "operationAuthorizationId",
    "prestateObservedAt", "preservedDeferredRouteIds", "providerInventoryComplete",
    "retryAuthorized",
  ];
  exactKeys(approval, [
    "approvedSourceRevision", "capturedAt", "expiresAt", "packetSha256",
    "prestateEvidenceSha256", "routeContractSha256", "routeCreationAuthorized", "schemaVersion",
    "singleUse",
    ...(packet.schemaVersion === CONTINUATION_PACKET_SCHEMA_VERSION ? continuationApprovalFields : []),
    ...(packet.schemaVersion === ADDITIVE_RECONCILIATION_PACKET_SCHEMA_VERSION
      ? additiveReconciliationApprovalFields : []),
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
  } else if (packet.schemaVersion === ADDITIVE_RECONCILIATION_PACKET_SCHEMA_VERSION) {
    if (approval.additiveReconciliationAuthorized !== true) {
      fail("additive reconciliation is not explicitly authorized");
    }
    if (
      approval.providerInventoryComplete !== true ||
      approval.providerInventoryComplete !== packet.providerInventoryComplete
    ) fail("additive reconciliation approval requires the complete provider inventory");
    if (
      approval.existingRouteMutationAuthorized !== false ||
      approval.existingRouteMutationAuthorized !== packet.existingRouteMutationAuthorized
    ) fail("additive reconciliation approval cannot authorize existing route mutation");
    if (
      approval.billingMutationAuthorized !== false ||
      approval.billingMutationAuthorized !== packet.billingMutationAuthorized
    ) fail("additive reconciliation approval cannot authorize CRM Billing mutation");
    if (
      approval.durableConsumptionRequired !== true ||
      approval.retryAuthorized !== false ||
      approval.retryAuthorized !== packet.retryAuthorized ||
      approval.operationAuthorizationId !== packet.operationAuthorizationId ||
      !digestMatches(approval.consumptionSha256, digestOperationAuthorization(packet))
    ) fail("additive reconciliation approval does not bind durable single-use consumption");
    if (
      approval.existingRouteInventorySha256 !== packet.existingRouteInventorySha256 ||
      approval.missingRoutesSha256 !== packet.missingRoutesSha256 ||
      approval.prestateObservedAt !== packet.prestateObservedAt ||
      JSON.stringify(approval.preservedDeferredRouteIds) !==
        JSON.stringify(packet.preservedDeferredRouteIds)
    ) fail("additive reconciliation approval does not match the exact inventory and missing routes");
  } else if (packet.schemaVersion !== CONTRACT.schema_version) {
    fail("approval packet schemaVersion is unsupported");
  }
  validateApprovalWindow(approval, nowMs);
  if (packet.schemaVersion === ADDITIVE_RECONCILIATION_PACKET_SCHEMA_VERSION) {
    const prestateObservedAtMs = canonicalUtcTimestampMs(
      packet.prestateObservedAt,
      "prestateObservedAt",
    );
    const capturedAtMs = canonicalUtcTimestampMs(approval.capturedAt, "approval.capturedAt");
    if (prestateObservedAtMs > capturedAtMs) {
      fail("disabled Gateway prestate must be observed no later than approval capture");
    }
    if (nowMs - prestateObservedAtMs > READBACK_MAX_AGE_MS) {
      fail("disabled Gateway prestate is older than 15 minutes");
    }
  }
  if (
    approval.approvedSourceRevision !== packet.approvedSourceRevision ||
    approval.prestateEvidenceSha256 !== packet.prestateEvidenceSha256 ||
    approval.routeContractSha256 !== packet.routeContractSha256 ||
    !digestMatches(approval.routeContractSha256, ROUTE_CONTRACT_SHA256) ||
    !digestMatches(approval.packetSha256, packetDigest)
  ) fail("private route approval does not match this exact packet and target binding");
  return approval;
}

function validateAdditiveFinalReadback(packet, readback, nowMs = Date.now()) {
  const packetResult = validateRoutePacket(packet);
  if (
    packetResult.schemaVersion !== ADDITIVE_RECONCILIATION_PACKET_SCHEMA_VERSION ||
    packetResult.phase !== "additive_reconciliation"
  ) fail("final additive readback requires a valid schema-v3 reconciliation packet");
  exactKeys(readback, ADDITIVE_FINAL_READBACK_FIELDS, "finalReadback");
  if (readback.schemaVersion !== ADDITIVE_RECONCILIATION_PACKET_SCHEMA_VERSION) {
    fail("final readback schemaVersion drifted");
  }
  if (
    readback.environment !== packet.environment ||
    readback.organizationId !== packet.organizationId ||
    readback.projectId !== packet.projectId
  ) fail("final readback target does not match the reconciliation packet");
  if (!digestMatches(readback.packetSha256, packetResult.digest)) {
    fail("final readback does not bind the exact reconciliation packet");
  }
  if (readback.providerInventoryComplete !== true) {
    fail("final readback must be an explicitly complete provider route inventory");
  }
  if (readback.gatewayEnabled !== false) {
    fail("final readback must keep the Development Gateway disabled");
  }
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    fail("final readback validation time is invalid");
  }
  const observedAtMs = canonicalUtcTimestampMs(readback.observedAt, "finalReadback.observedAt");
  const prestateObservedAtMs = canonicalUtcTimestampMs(packet.prestateObservedAt, "prestateObservedAt");
  if (observedAtMs < prestateObservedAtMs) {
    fail("final readback predates the additive reconciliation prestate");
  }
  if (observedAtMs > nowMs) fail("final readback is not yet valid");
  if (nowMs - observedAtMs > READBACK_MAX_AGE_MS) {
    fail("final readback is older than 15 minutes");
  }

  const expectedCount = packet.routes.length + packetResult.preservedDeferredRouteIds.length;
  if (!Array.isArray(readback.routes) || readback.routes.length !== expectedCount) {
    fail(`final readback must contain exactly ${expectedCount} preserved and setup routes`);
  }
  const profileRoutes = routeProfileRoutes(packet);
  const profileIndexById = new Map(profileRoutes.map((route, index) => [route.id, index]));
  const prestateByName = new Map(
    packet.existingRouteInventory.map((route) => [route.name, route]),
  );
  const names = new Set();
  const sourceEndpoints = new Set();
  const targetEndpoints = new Set();
  readback.routes.forEach((route, index) => {
    validateExistingRouteReadback(route, index, "finalReadback.routes");
    if (names.has(route.name)) {
      fail(`finalReadback.routes[${index}] duplicates canonical route identity ${route.name}`);
    }
    names.add(route.name);
    if (sourceEndpoints.has(route.source_endpoint)) {
      fail(`finalReadback.routes[${index}] reuses a provider source endpoint`);
    }
    sourceEndpoints.add(route.source_endpoint);
    if (targetEndpoints.has(route.target_endpoint)) {
      fail(`finalReadback.routes[${index}] reuses a provider target endpoint`);
    }
    targetEndpoints.add(route.target_endpoint);

    const profileIndex = profileIndexById.get(route.name);
    if (profileIndex !== undefined) {
      if (
        JSON.stringify(stableValue(route)) !==
        JSON.stringify(stableValue(expectedRouteReadback(packet, profileIndex)))
      ) fail(`finalReadback.routes[${index}] setup-journey route attributes drifted`);
    } else {
      validatePreservedDeferredRouteReadback(route, index, "finalReadback.routes");
      if (!packetResult.preservedDeferredRouteIds.includes(route.name)) {
        fail(`finalReadback.routes[${index}] was not present in the preserved deferred prestate`);
      }
    }

    const prestateRoute = prestateByName.get(route.name);
    if (
      prestateRoute &&
      JSON.stringify(stableValue(route)) !== JSON.stringify(stableValue(prestateRoute))
    ) fail(`finalReadback.routes[${index}] changed an existing route`);
  });

  const expectedNames = new Set([
    ...profileRoutes.map((route) => route.id),
    ...packetResult.preservedDeferredRouteIds,
  ]);
  if (
    names.size !== expectedNames.size ||
    [...expectedNames].some((name) => !names.has(name))
  ) fail("final readback is not the exact complete setup-journey inventory");

  return deepFreeze({
    gatewayEnabled: false,
    packetSha256: packetResult.digest,
    preservedDeferredRouteCount: packetResult.preservedDeferredRouteIds.length,
    routeCount: readback.routes.length,
    routeInventorySha256: digestRouteInventory(readback.routes),
    schemaVersion: readback.schemaVersion,
  });
}

function buildRouteRequests(packet, approval, nowMs = Date.now(), originalBoundPacket) {
  const result = validateRoutePacket(packet, originalBoundPacket);
  if (!new Set(["bound", "continuation", "additive_reconciliation"]).has(result.phase)) {
    fail("route requests require a bound packet, schema-v2 continuation packet, or schema-v3 additive-reconciliation packet");
  }
  validateRouteApproval(approval, packet, result.digest, nowMs);
  return result.requestRouteIndexes.map((index) => {
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

function gitSubprocessEnvironment(source = process.env) {
  const environment = {};
  for (const [name, value] of Object.entries(source)) {
    if (!name.toUpperCase().startsWith("GIT_") && value !== undefined) {
      environment[name] = value;
    }
  }
  environment.GIT_OPTIONAL_LOCKS = "0";
  return environment;
}

function currentRepositoryRevision() {
  let output;
  try {
    output = execFileSync(
      "git",
      [
        "-c", `safe.directory=${REPOSITORY_ROOT}`, "--no-optional-locks",
        "-C", REPOSITORY_ROOT, "rev-parse", "--verify", "HEAD",
      ],
      {
        encoding: "utf8",
        env: gitSubprocessEnvironment(),
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    ).trim();
  } catch {
    fail("current repository source revision is unavailable");
  }
  if (!/^[a-f0-9]{40}$/.test(output)) {
    fail("current repository source revision is invalid");
  }
  return output;
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
  let metadata;
  try {
    metadata = fs.statSync(resolved);
  } catch {
    fail("packet file metadata is unavailable");
  }
  if (
    !metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_PRIVATE_FILE_BYTES ||
    metadata.nlink !== 1
  ) fail("packet file size, type, or link count is invalid");
  return resolved;
}

class DuplicateJsonObjectKeyError extends Error {}

function skipJsonWhitespace(raw, start) {
  let index = start;
  while (index < raw.length && /[\u0020\t\r\n]/.test(raw[index])) index += 1;
  return index;
}

function scanJsonString(raw, start) {
  if (raw[start] !== '"') throw new SyntaxError("invalid JSON string");
  let index = start + 1;
  while (index < raw.length) {
    const codePoint = raw.charCodeAt(index);
    if (codePoint === 0x22) {
      const token = raw.slice(start, index + 1);
      return { next: index + 1, value: JSON.parse(token) };
    }
    if (codePoint === 0x5c) {
      index += 1;
      if (index >= raw.length) throw new SyntaxError("invalid JSON escape");
      if (raw[index] === "u") {
        if (!/^[a-fA-F0-9]{4}$/.test(raw.slice(index + 1, index + 5))) {
          throw new SyntaxError("invalid JSON unicode escape");
        }
        index += 5;
        continue;
      }
      if (!'"\\/bfnrt'.includes(raw[index])) throw new SyntaxError("invalid JSON escape");
      index += 1;
      continue;
    }
    if (codePoint <= 0x1f) throw new SyntaxError("invalid JSON control character");
    index += 1;
  }
  throw new SyntaxError("unterminated JSON string");
}

function scanJsonObject(raw, start) {
  const keys = new Set();
  let index = skipJsonWhitespace(raw, start + 1);
  if (raw[index] === "}") return index + 1;
  while (index < raw.length) {
    const key = scanJsonString(raw, index);
    if (keys.has(key.value)) throw new DuplicateJsonObjectKeyError();
    keys.add(key.value);
    index = skipJsonWhitespace(raw, key.next);
    if (raw[index] !== ":") throw new SyntaxError("invalid JSON object separator");
    index = scanJsonValue(raw, index + 1);
    index = skipJsonWhitespace(raw, index);
    if (raw[index] === "}") return index + 1;
    if (raw[index] !== ",") throw new SyntaxError("invalid JSON object delimiter");
    index = skipJsonWhitespace(raw, index + 1);
  }
  throw new SyntaxError("unterminated JSON object");
}

function scanJsonArray(raw, start) {
  let index = skipJsonWhitespace(raw, start + 1);
  if (raw[index] === "]") return index + 1;
  while (index < raw.length) {
    index = scanJsonValue(raw, index);
    index = skipJsonWhitespace(raw, index);
    if (raw[index] === "]") return index + 1;
    if (raw[index] !== ",") throw new SyntaxError("invalid JSON array delimiter");
    index = skipJsonWhitespace(raw, index + 1);
  }
  throw new SyntaxError("unterminated JSON array");
}

function scanJsonValue(raw, start) {
  const index = skipJsonWhitespace(raw, start);
  if (index >= raw.length) throw new SyntaxError("missing JSON value");
  if (raw[index] === "{") return scanJsonObject(raw, index);
  if (raw[index] === "[") return scanJsonArray(raw, index);
  if (raw[index] === '"') return scanJsonString(raw, index).next;
  let end = index;
  while (end < raw.length && !/[\u0020\t\r\n,\[\]{}:]/.test(raw[end])) end += 1;
  if (end === index) throw new SyntaxError("invalid JSON value");
  return end;
}

function rejectDuplicateJsonObjectKeys(raw) {
  const end = scanJsonValue(raw, 0);
  if (skipJsonWhitespace(raw, end) !== raw.length) throw new SyntaxError("trailing JSON bytes");
}

function readPrivateJson(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    fail(`${label} could not be read`);
  }
  try {
    rejectDuplicateJsonObjectKeys(raw);
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof DuplicateJsonObjectKeyError) {
      fail(`${label} contains duplicate object keys`);
    }
    fail(`${label} is not valid JSON`);
  }
}

function run(argv, nowMs = Date.now()) {
  if (argv.length < 1 || argv.length > 3) {
    fail(
      "usage: node validate-private-route-packet.js <absolute-private-packet-path> " +
      "[absolute-private-approval-path] [absolute-private-original-bound-packet-path]",
    );
  }
  const packetPath = assertPrivatePacketPath(argv[0]);
  const packet = readPrivateJson(packetPath, "private Catalyst route packet");
  if (packet.approvedSourceRevision !== currentRepositoryRevision()) {
    fail("approvedSourceRevision does not match current repository HEAD");
  }
  let originalBoundPacket;
  if (packet.schemaVersion === CONTINUATION_PACKET_SCHEMA_VERSION) {
    if (argv.length !== 3) {
      fail("a continuation packet requires its approval and the preserved original bound packet");
    }
    const originalPacketPath = assertPrivatePacketPath(argv[2]);
    if (originalPacketPath === packetPath) fail("private route packet files must be distinct");
    originalBoundPacket = readPrivateJson(
      originalPacketPath,
      "private original Catalyst route packet",
    );
  } else if (argv.length > 2) {
    fail("only a continuation packet accepts an original bound packet");
  }
  const result = validateRoutePacket(packet, originalBoundPacket);
  if (new Set(["bound", "continuation", "additive_reconciliation"]).has(result.phase)) {
    const expectedArgumentCount = result.phase === "continuation" ? 3 : 2;
    if (argv.length !== expectedArgumentCount) {
      fail("a bound, continuation, or additive-reconciliation packet requires a separate private approval envelope");
    }
    const approvalPath = assertPrivatePacketPath(argv[1]);
    if (approvalPath === packetPath) fail("private route packet files must be distinct");
    const approval = readPrivateJson(approvalPath, "private Catalyst route approval");
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

module.exports = {
  CONTRACT,
  CLAIM_NAMESPACE,
  REPOSITORY_ROOT,
  advancedIoFormBinding,
  assertPrivatePacketPath,
  buildAdvancedIoTargetRemediation,
  buildRouteRequests,
  currentRepositoryRevision,
  digestExistingRoutePrefix,
  digestMissingRoutes,
  digestOperationAuthorization,
  digestRouteInventory,
  digestRouteContract,
  digestRoutePacket,
  digestRuntimePathBindings,
  normalizeRouteListReadback,
  readPrivateJson,
  ROUTE_CONTRACT_SHA256,
  run,
  validateAdditiveFinalReadback,
  validateRouteApproval,
  validateRoutePacket,
};
