"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CONTRACT,
  REPOSITORY_ROOT,
  ROUTE_CONTRACT_SHA256,
  advancedIoFormBinding,
  assertPrivatePacketPath,
  buildAdvancedIoTargetRemediation,
  buildRouteRequests,
  CLAIM_NAMESPACE,
  digestExistingRoutePrefix,
  digestMissingRoutes,
  digestOperationAuthorization,
  digestRouteInventory,
  digestRouteContract,
  digestRoutePacket,
  digestRuntimePathBindings,
  normalizeRouteListReadback,
  run,
  validateAdditiveFinalReadback,
  validateRouteApproval,
  validateRoutePacket,
} = require("../scripts/validate-private-route-packet");
const {
  run: runAdditiveReadbackVerifier,
} = require("../scripts/verify-private-route-additive-readback");

const NOW_MS = Date.parse("2026-08-26T18:05:00.000Z");

function attachedWorktreeRoots() {
  const output = execFileSync(
    "git",
    ["-C", REPOSITORY_ROOT, "worktree", "list", "--porcelain", "-z"],
    { encoding: "utf8", windowsHide: true },
  );
  const roots = [];
  for (const field of output.split("\0")) {
    if (!field.startsWith("worktree ")) continue;
    try {
      roots.push(fs.realpathSync(field.slice("worktree ".length)));
    } catch {
      // Ignore prunable entries that cannot contain an existing test fixture.
    }
  }
  return roots;
}

function packet(phase = "definition", routeProfile = "canonical-all") {
  const functionIds = {
    crm_billing_orchestrator: "902",
    revenue_desk_call_gateway: "903",
    revenue_desk_route_control: "904",
    revenue_leak_test_request_form: "905",
    revenue_leak_test_setup_form: "906",
  };
  const profile = CONTRACT.route_profiles[routeProfile];
  const routesById = new Map(CONTRACT.routes.map((route) => [route.id, route]));
  const profileRoutes = profile.route_ids.map((id) => routesById.get(id));
  const runtimePathBindings = profileRoutes.map((route) => ({
    function: route.function,
    pathReference: route.path_reference,
    routeId: route.id,
    runtimePath: `/synthetic/${route.id.toLowerCase().replaceAll("_", "-")}`,
  }));
  return {
    approvedSourceRevision: "a".repeat(40),
    environment: "Development",
    gatewayActivationAuthorized: false,
    gatewayPrestate: { enabled: false, routeCount: 0 },
    organizationId: 606,
    phase,
    prestateEvidenceSha256: "b".repeat(64),
    projectId: "707",
    rollback: {
      preserveLegacyResources: true,
      restoreCallersBeforeRoutes: true,
      restoreGlobalGatewayState: "disabled",
    },
    routeProfile,
    routeContractSha256: ROUTE_CONTRACT_SHA256,
    routes: profileRoutes.map((route, index) => {
      const endpoint = `/${route.id.toLowerCase().replaceAll("_", "-")}/${String(index).padStart(2, "0")}${"x".repeat(30)}`;
      return {
        id: route.id,
        sourceEndpoint: endpoint,
        targetId: phase === "bound" ? functionIds[route.function] : null,
      };
    }),
    runtimePathBindings,
    runtimePathBindingsSha256: digestRuntimePathBindings(runtimePathBindings),
    schemaVersion: 1,
  };
}

function approval(value, overrides = {}) {
  const envelope = {
    approvedSourceRevision: value.approvedSourceRevision,
    capturedAt: "2026-08-26T18:00:00.000Z",
    expiresAt: "2026-08-26T18:15:00.000Z",
    packetSha256: digestRoutePacket(value),
    prestateEvidenceSha256: value.prestateEvidenceSha256,
    routeContractSha256: value.routeContractSha256,
    routeCreationAuthorized: true,
    schemaVersion: value.schemaVersion,
    singleUse: true,
  };
  if (value.schemaVersion === 2) {
    Object.assign(envelope, {
      continuationAuthorized: true,
      existingRoutePrefixSha256: value.existingRoutePrefixSha256,
      initialBoundPacketSha256: value.initialBoundPacketSha256,
    });
  } else if (value.schemaVersion === 3) {
    Object.assign(envelope, {
      additiveReconciliationAuthorized: true,
      billingMutationAuthorized: false,
      consumptionSha256: digestOperationAuthorization(value),
      durableConsumptionRequired: true,
      existingRouteInventorySha256: value.existingRouteInventorySha256,
      existingRouteMutationAuthorized: false,
      missingRoutesSha256: value.missingRoutesSha256,
      operationAuthorizationId: value.operationAuthorizationId,
      prestateObservedAt: value.prestateObservedAt,
      preservedDeferredRouteIds: structuredClone(value.preservedDeferredRouteIds),
      providerInventoryComplete: true,
      retryAuthorized: false,
    });
  }
  return { ...envelope, ...overrides };
}

function continuationPacket(existingCount = 1, routeProfile = "canonical-all") {
  const initial = packet("bound", routeProfile);
  const initialRequests = buildRouteRequests(initial, approval(initial), NOW_MS);
  const existingRoutePrefix = initialRequests.slice(0, existingCount).map(({ body }) => ({
    ...structuredClone(body),
    target: "advancedio",
    throttling: {
      ip: {
        duration: { days: 0, hours: 0, minutes: 1, seconds: 0 },
        limit: body.throttling.ip.limit,
      },
      overall: {
        duration: { days: 0, hours: 0, minutes: 1, seconds: 0 },
        limit: body.throttling.overall.limit,
      },
    },
  }));
  return {
    ...structuredClone(initial),
    existingRoutePrefix,
    existingRoutePrefixSha256: digestExistingRoutePrefix(existingRoutePrefix),
    gatewayPrestate: { enabled: false, routeCount: existingCount },
    initialBoundPacketSha256: digestRoutePacket(initial),
    initialPrestateEvidenceSha256: initial.prestateEvidenceSha256,
    phase: "continuation",
    prestateEvidenceSha256: "c".repeat(64),
    remainingRoutes: structuredClone(initial.routes.slice(existingCount)),
    schemaVersion: 2,
  };
}

function requestReadback(body) {
  return {
    ...structuredClone(body),
    target: "advancedio",
    throttling: {
      ip: {
        duration: { days: 0, hours: 0, minutes: 1, seconds: 0 },
        limit: body.throttling.ip.limit,
      },
      overall: {
        duration: { days: 0, hours: 0, minutes: 1, seconds: 0 },
        limit: body.throttling.overall.limit,
      },
    },
  };
}

const HISTORICAL_SHARED_PROJECT_ROUTE_IDS = [
  "RETELL_INBOUND", "RETELL_EVENTS", "RETELL_READINESS", "FORM1_ISSUE", "FORM1_PREFILL",
  "FORM2_ISSUE", "FORM2_ACCESS", "FORM2_OTP_REQUEST", "FORM2_OTP_VERIFY", "FORM2_PREFILL",
  "FORM2_SUBMISSION", "CRM_BILLING",
];

function additivePacket(existingRouteIds = HISTORICAL_SHARED_PROJECT_ROUTE_IDS) {
  const value = packet("bound", "setup-journey");
  const setupReadbacks = buildRouteRequests(value, approval(value), NOW_MS)
    .map(({ body }) => requestReadback(body));
  const canonicalAll = packet("bound", "canonical-all");
  const billingReadback = requestReadback(
    buildRouteRequests(canonicalAll, approval(canonicalAll), NOW_MS)
      .find(({ body }) => body.name === "CRM_BILLING").body,
  );
  const readbackByName = new Map(
    [...setupReadbacks, billingReadback].map((route) => [route.name, route]),
  );
  const existingRouteInventory = existingRouteIds.map((id) => structuredClone(readbackByName.get(id)));
  const existingRouteIdsSet = new Set(existingRouteIds);
  const missingRoutes = value.routes
    .filter((route) => !existingRouteIdsSet.has(route.id))
    .map((route) => structuredClone(route));
  return {
    ...structuredClone(value),
    billingMutationAuthorized: false,
    existingRouteInventory,
    existingRouteInventorySha256: digestRouteInventory(existingRouteInventory),
    existingRouteMutationAuthorized: false,
    gatewayPrestate: { enabled: false, routeCount: existingRouteInventory.length },
    missingRoutes,
    missingRoutesSha256: digestMissingRoutes(missingRoutes),
    operationAuthorizationId: "123e4567-e89b-42d3-a456-426614174000",
    phase: "additive_reconciliation",
    prestateEvidenceSha256: "c".repeat(64),
    prestateObservedAt: "2026-08-26T17:59:00.000Z",
    preservedDeferredRouteIds: existingRouteIds.includes("CRM_BILLING") ? ["CRM_BILLING"] : [],
    providerInventoryComplete: true,
    retryAuthorized: false,
    schemaVersion: 3,
  };
}

function additiveFinalReadback(value) {
  const created = buildRouteRequests(value, approval(value), NOW_MS)
    .map(({ body }) => requestReadback(body));
  return {
    environment: value.environment,
    gatewayEnabled: false,
    observedAt: "2026-08-26T18:04:00.000Z",
    organizationId: value.organizationId,
    packetSha256: digestRoutePacket(value),
    projectId: value.projectId,
    providerInventoryComplete: true,
    routes: [...structuredClone(value.existingRouteInventory), ...created],
    schemaVersion: 3,
  };
}

test("validates one exact 18-route definition without authorizing activation", () => {
  const value = packet();
  const result = validateRoutePacket(value);
  assert.equal(result.phase, "definition");
  assert.equal(result.routeCount, 18);
  assert.equal(result.routeProfile, "canonical-all");
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.equal(digestRoutePacket(Object.fromEntries(Object.entries(value).reverse())), result.digest);
});

test("validates the closed 17-route setup profile and keeps CRM Billing absent", () => {
  const definition = packet("definition", "setup-journey");
  const definitionResult = validateRoutePacket(definition);
  assert.equal(definitionResult.routeProfile, "setup-journey");
  assert.equal(definitionResult.routeCount, 17);
  assert.equal(definition.routes.some(({ id }) => id === "CRM_BILLING"), false);

  const bound = packet("bound", "setup-journey");
  const requests = buildRouteRequests(bound, approval(bound), NOW_MS);
  assert.equal(requests.length, 17);
  assert.equal(requests.some(({ body }) => body.name === "CRM_BILLING"), false);
  assert.equal(
    CONTRACT.route_profiles["setup-journey"].development_api_gateway_availability_authorized,
    true,
  );
  assert.equal(
    CONTRACT.route_profiles["setup-journey"].retell_provider_activation_authorized,
    false,
  );
  assert.equal(
    CONTRACT.route_profiles["setup-journey"].production_gateway_activation_authorized,
    false,
  );

  const original = packet("bound", "setup-journey");
  const continuation = continuationPacket(16, "setup-journey");
  const continuationResult = validateRoutePacket(continuation, original);
  assert.equal(continuationResult.routeProfile, "setup-journey");
  assert.equal(continuationResult.requestRouteCount, 1);
  assert.deepEqual(
    buildRouteRequests(continuation, approval(continuation), NOW_MS, original)
      .map(({ body }) => body.name),
    ["FORM2_SUBMISSION"],
  );

  const missingRoute = packet("definition", "setup-journey");
  missingRoute.routes.pop();
  missingRoute.runtimePathBindings.pop();
  missingRoute.runtimePathBindingsSha256 = digestRuntimePathBindings(
    missingRoute.runtimePathBindings,
  );
  assert.throws(() => validateRoutePacket(missingRoute), /binding count|route count/);
  const reordered = packet("definition", "setup-journey");
  [reordered.routes[0], reordered.routes[1]] = [reordered.routes[1], reordered.routes[0]];
  assert.throws(() => validateRoutePacket(reordered), /identity or ordering drifted/);

  delete definition.routeProfile;
  assert.throws(() => validateRoutePacket(definition), /fields are not exact|routeProfile is required/);
  const unknown = packet();
  unknown.routeProfile = "caller-selected";
  assert.throws(() => validateRoutePacket(unknown), /not a closed route profile/);
});

test("normalizes only canonical route-list fields and rejects enhanced detail target names", () => {
  const expected = continuationPacket(1).existingRoutePrefix[0];
  const routeListReadback = {
    ...structuredClone(expected),
    api_id: "808",
    created_by: { email_id: "must-not-enter-the-packet@example.invalid" },
    created_time: "2026-08-27T00:00:00.000Z",
  };
  delete routeListReadback.authentication;

  const normalized = normalizeRouteListReadback(
    routeListReadback,
    expected.authentication,
  );
  assert.deepEqual(normalized, expected);
  assert.equal(Object.hasOwn(normalized, "api_id"), false);
  assert.equal(Object.hasOwn(normalized, "created_by"), false);

  routeListReadback.target_id = "revenue_desk_call_gateway";
  assert.throws(
    () => normalizeRouteListReadback(routeListReadback, expected.authentication),
    /routeListReadback\[0\]\.target_id is invalid/,
  );
  assert.throws(
    () => normalizeRouteListReadback(routeListReadback, null),
    /authentication must come from an independent UI readback/,
  );
});

test("approval binds one deeply immutable route contract and rejects contract-file drift", () => {
  assert.equal(Object.isFrozen(CONTRACT), true);
  assert.equal(Object.isFrozen(CONTRACT.routes), true);
  assert.equal(Object.isFrozen(CONTRACT.routes[0]), true);
  assert.equal(Object.isFrozen(CONTRACT.routes[0].authentication), true);
  assert.throws(() => { CONTRACT.routes[0].method = "DELETE"; }, TypeError);

  const driftedContract = structuredClone(CONTRACT);
  driftedContract.routes[0].method = "DELETE";
  const driftedDigest = digestRouteContract(driftedContract);
  assert.notEqual(driftedDigest, ROUTE_CONTRACT_SHA256);
  const driftedPacket = packet("bound");
  driftedPacket.routeContractSha256 = driftedDigest;
  assert.throws(
    () => validateRoutePacket(driftedPacket),
    /immutable route contract/,
  );

  const approved = packet("bound");
  const envelope = approval(approved, { routeContractSha256: driftedDigest });
  assert.throws(
    () => buildRouteRequests(approved, envelope, NOW_MS),
    /private route approval/,
  );
});

test("builds exact project-bound Advanced I/O requests only after function IDs are bound", () => {
  assert.throws(() => buildRouteRequests(packet()), /bound packet/);
  const value = packet("bound");
  assert.throws(() => buildRouteRequests(value), /approval/);
  const requests = buildRouteRequests(value, approval(value), NOW_MS);
  assert.equal(requests.length, 18);
  assert.ok(requests.every((request) =>
    request.path_variables.projectId === value.projectId &&
    request.headers["Catalyst-org"] === value.organizationId &&
    request.headers.Environment === "Development"));
  assert.deepEqual(requests[0].body.authentication, []);
  assert.equal(requests[0].body.target, "Advanced IO Function");
  assert.equal(
    requests[0].body.target_endpoint,
    "/server/revenue_desk_call_gateway/synthetic/retell-inbound",
  );
  assert.ok(requests.every((request) => !request.body.target_endpoint.includes("/server/Adv/")));
  assert.deepEqual(requests[0].body.throttling, {
    ip: { duration: { minutes: 1 }, limit: 120 },
    overall: { duration: { minutes: 1 }, limit: 120 },
  });
  assert.deepEqual(
    requests.filter(({ body }) => body.authentication.includes("APIKey")).map(({ body }) => body.name),
    ["ROUTE_CONTROL_APPROVE", "ROUTE_CONTROL_ACTIVATE", "ROUTE_CONTROL_ROLLBACK",
      "FORM2_ISSUE", "FORM2_PREFILL", "FORM2_SUBMISSION", "CRM_BILLING"],
  );
});

test("maps Advanced I/O requests to the Catalyst form without a duplicate path separator", () => {
  const value = packet("bound");
  const requests = buildRouteRequests(value, approval(value), NOW_MS);

  requests.forEach(({ body }) => {
    const binding = advancedIoFormBinding(body);
    assert.equal(binding.pathInput.startsWith("/"), false);
    assert.equal(
      `/server/${binding.functionName}/${binding.pathInput}`,
      body.target_endpoint,
    );
    assert.equal(Object.isFrozen(binding), true);
  });

  const duplicateSlash = structuredClone(requests[0].body);
  duplicateSlash.target_endpoint = duplicateSlash.target_endpoint.replace("/synthetic/", "//synthetic/");
  assert.throws(
    () => advancedIoFormBinding(duplicateSlash),
    /target endpoint is invalid/,
  );
  assert.throws(
    () => advancedIoFormBinding({ ...requests[0].body, target: "Basic IO Function" }),
    /request target is invalid/,
  );
});

test("builds only the exact duplicate-separator target remediation", () => {
  const original = packet("bound");
  const value = continuationPacket(1);
  const expected = continuationPacket(2).existingRoutePrefix[1];
  const rawReadback = {
    ...structuredClone(expected),
    target_endpoint: expected.target_endpoint.replace("/synthetic/", "//synthetic/"),
    api_id: "808",
    created_by: { email_id: "must-not-enter-the-packet@example.invalid" },
  };
  delete rawReadback.authentication;

  const input = {
    authentication: expected.authentication,
    index: 1,
    originalBoundPacket: original,
    packet: value,
    packetSha256: digestRoutePacket(value),
    route: rawReadback,
  };
  const remediation = buildAdvancedIoTargetRemediation(input);
  assert.equal(remediation.canonicalIndex, 1);
  assert.deepEqual(remediation.changedFields, ["target_endpoint"]);
  assert.deepEqual(remediation.proposed, expected);
  assert.equal(remediation.formBinding.pathInput.startsWith("/"), false);
  assert.equal(remediation.packetSha256, digestRoutePacket(value));
  assert.deepEqual(remediation.target, {
    environment: value.environment,
    organizationId: value.organizationId,
    projectId: value.projectId,
  });
  assert.equal(Object.isFrozen(remediation), true);
  assert.equal(Object.hasOwn(remediation.current, "created_by"), false);

  rawReadback.method = "GET";
  assert.throws(
    () => buildAdvancedIoTargetRemediation(input),
    /must change only target_endpoint/,
  );
  rawReadback.method = expected.method;
  rawReadback.target_endpoint = expected.target_endpoint.replace("/server/", "/server//");
  assert.throws(
    () => buildAdvancedIoTargetRemediation(input),
    /not the exact duplicate-separator defect/,
  );

  rawReadback.target_endpoint = expected.target_endpoint.replace("/synthetic/", "//synthetic/");
  assert.throws(
    () => buildAdvancedIoTargetRemediation({ ...input, packetSha256: "f".repeat(64) }),
    /provenance does not match/,
  );
  assert.throws(
    () => buildAdvancedIoTargetRemediation({ ...input, index: 0 }),
    /outside the authorized canonical suffix/,
  );

  const wrongFunctionBinding = structuredClone(value);
  wrongFunctionBinding.routes[1].targetId = "999";
  wrongFunctionBinding.remainingRoutes[0].targetId = "999";
  assert.throws(
    () => buildAdvancedIoTargetRemediation({
      ...input,
      packet: wrongFunctionBinding,
      packetSha256: digestRoutePacket(wrongFunctionBinding),
    }),
    /conflicting target IDs/,
  );

  assert.throws(
    () => buildAdvancedIoTargetRemediation({
      ...input,
      authentication: ["caller-data@example.invalid"],
    }),
    /must change only target_endpoint/,
  );
});

test("binds each computed target to the canonical function and approved private runtime-path digest", () => {
  const value = packet("bound");
  const requests = buildRouteRequests(value, approval(value), NOW_MS);
  requests.forEach((request, index) => {
    const expected = CONTRACT.routes[index];
    const binding = value.runtimePathBindings[index];
    assert.equal(binding.routeId, expected.id);
    assert.equal(binding.function, expected.function);
    assert.equal(binding.pathReference, expected.path_reference);
    assert.equal(
      request.body.target_endpoint,
      `/server/${expected.function}${binding.runtimePath}`,
    );
  });

  const changedPath = packet("bound");
  changedPath.runtimePathBindings[0].runtimePath = "/synthetic/different-inbound";
  assert.throws(() => validateRoutePacket(changedPath), /approved digest/);

  const wrongReference = packet("bound");
  wrongReference.runtimePathBindings[0].pathReference = "RETELL_EVENTS_PATH";
  wrongReference.runtimePathBindingsSha256 = digestRuntimePathBindings(wrongReference.runtimePathBindings);
  assert.throws(() => validateRoutePacket(wrongReference), /path reference drifted/);

  const duplicateRuntimePath = packet("bound");
  duplicateRuntimePath.runtimePathBindings[1].runtimePath = duplicateRuntimePath.runtimePathBindings[0].runtimePath;
  duplicateRuntimePath.runtimePathBindingsSha256 = digestRuntimePathBindings(
    duplicateRuntimePath.runtimePathBindings,
  );
  assert.throws(() => validateRoutePacket(duplicateRuntimePath), /reuses a runtime path/);
});

test("separate approval binds organization, project, routes, targets, and runtime paths", () => {
  const approved = packet("bound");
  const envelope = approval(approved);
  assert.equal(
    validateRouteApproval(envelope, approved, undefined, NOW_MS).routeCreationAuthorized,
    true,
  );

  const redirectedProject = structuredClone(approved);
  redirectedProject.projectId = "808";
  assert.throws(
    () => buildRouteRequests(redirectedProject, envelope, NOW_MS),
    /private route approval/,
  );

  const redirectedTarget = structuredClone(approved);
  redirectedTarget.routes.forEach((route, index) => {
    if (CONTRACT.routes[index].function === "revenue_desk_call_gateway") {
      route.targetId = "999";
    }
  });
  assert.throws(() => buildRouteRequests(redirectedTarget, envelope, NOW_MS), /private route approval/);

  const changedRuntimePath = structuredClone(approved);
  changedRuntimePath.runtimePathBindings[0].runtimePath = "/synthetic/changed-inbound";
  changedRuntimePath.runtimePathBindingsSha256 = digestRuntimePathBindings(
    changedRuntimePath.runtimePathBindings,
  );
  assert.throws(() => buildRouteRequests(changedRuntimePath, envelope, NOW_MS), /private route approval/);
});

test("route approval is single-use and valid only inside a maximum 15-minute window", () => {
  const value = packet("bound");
  assert.equal(buildRouteRequests(value, approval(value), NOW_MS).length, 18);
  assert.throws(
    () => buildRouteRequests(value, approval(value, {
      expiresAt: "2026-08-26T18:05:00.000Z",
    }), NOW_MS),
    /expired/,
  );
  assert.throws(
    () => buildRouteRequests(value, approval(value, {
      capturedAt: "2026-08-26T18:05:00.001Z",
    }), NOW_MS),
    /not yet valid/,
  );
  assert.throws(
    () => buildRouteRequests(value, approval(value, {
      expiresAt: "2026-08-26T18:15:00.001Z",
    }), NOW_MS),
    /no longer than 15 minutes/,
  );
  assert.throws(
    () => buildRouteRequests(value, approval(value, { singleUse: false }), NOW_MS),
    /single-use/,
  );
});

test("rejects Production, activation, route drift, endpoint reuse, and target ambiguity", () => {
  const production = packet();
  production.environment = "Production";
  assert.throws(() => validateRoutePacket(production), /Development/);

  const activation = packet();
  activation.gatewayActivationAuthorized = true;
  assert.throws(() => validateRoutePacket(activation), /activation/);

  const reordered = packet();
  [reordered.routes[0], reordered.routes[1]] = [reordered.routes[1], reordered.routes[0]];
  assert.throws(() => validateRoutePacket(reordered), /ordering/);

  const duplicate = packet();
  duplicate.routes[1].sourceEndpoint = duplicate.routes[0].sourceEndpoint;
  assert.throws(() => validateRoutePacket(duplicate), /unique/);

  const ambiguous = packet("bound");
  const form1RouteIds = new Set([
    "FORM1_ISSUE", "FORM1_ACCESS", "FORM1_EXCHANGE", "FORM1_PREFILL",
    "FORM1_SUBMISSION",
  ]);
  ambiguous.routes
    .filter(({ id }) => form1RouteIds.has(id))
    .forEach((route) => {
      route.targetId = "902";
    });
  assert.throws(() => validateRoutePacket(ambiguous), /share a target ID/);
});

test("schema-v2 continuation emits only the untouched canonical suffix", () => {
  const value = continuationPacket(1);
  const original = packet("bound");
  assert.throws(
    () => validateRoutePacket(value),
    /separately preserved original schema-v1 bound packet/,
  );
  const result = validateRoutePacket(value, original);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.phase, "continuation");
  assert.equal(result.routeCount, 18);
  assert.equal(result.existingRouteCount, 1);
  assert.equal(result.requestRouteCount, 17);
  assert.equal(result.existingRoutePrefixSha256, value.existingRoutePrefixSha256);

  const requests = buildRouteRequests(value, approval(value), NOW_MS, original);
  assert.equal(requests.length, 17);
  assert.equal(requests[0].body.name, "RETELL_EVENTS");
  assert.equal(requests.at(-1).body.name, "CRM_BILLING");
  assert.equal(requests.some(({ body }) => body.name === "RETELL_INBOUND"), false);
});

test("schema-v2 continuation preserves the exact initially approved full binding", () => {
  const original = packet("bound");
  const changedTargets = continuationPacket(1);
  const callRouteIndexes = [0, 1, 2];
  callRouteIndexes.forEach((index) => {
    changedTargets.routes[index].targetId = "999";
    if (index === 0) changedTargets.existingRoutePrefix[0].target_id = "999";
    else changedTargets.remainingRoutes[index - 1].targetId = "999";
  });
  changedTargets.existingRoutePrefixSha256 = digestExistingRoutePrefix(
    changedTargets.existingRoutePrefix,
  );
  assert.throws(
    () => validateRoutePacket(changedTargets, original),
    /exact initially approved bound packet/,
  );

  const changedInitialEvidence = continuationPacket(1);
  changedInitialEvidence.initialPrestateEvidenceSha256 = "d".repeat(64);
  assert.throws(
    () => validateRoutePacket(changedInitialEvidence, original),
    /exact initially approved bound packet/,
  );

  const changedInitialDigest = continuationPacket(1);
  changedInitialDigest.initialBoundPacketSha256 = "e".repeat(64);
  assert.throws(
    () => validateRoutePacket(changedInitialDigest, original),
    /externally supplied original bound packet/,
  );

  const reusedPrestateEvidence = continuationPacket(1);
  reusedPrestateEvidence.prestateEvidenceSha256 = reusedPrestateEvidence.initialPrestateEvidenceSha256;
  assert.throws(
    () => validateRoutePacket(reusedPrestateEvidence, original),
    /fresh current disabled-prestate evidence/,
  );
});

test("schema-v2 continuation cannot replace remaining targets or bindings by recomputing self-digests", () => {
  const original = packet("bound");
  const changed = continuationPacket(1);
  const forgedOriginal = structuredClone(original);
  const form1Indexes = [6, 7, 8, 9, 10];
  form1Indexes.forEach((index) => {
    changed.routes[index].targetId = "999";
    changed.remainingRoutes[index - 1].targetId = "999";
    changed.runtimePathBindings[index].runtimePath += "-changed";
    forgedOriginal.routes[index].targetId = "999";
    forgedOriginal.runtimePathBindings[index].runtimePath += "-changed";
  });
  changed.runtimePathBindingsSha256 = digestRuntimePathBindings(changed.runtimePathBindings);
  changed.existingRoutePrefixSha256 = digestExistingRoutePrefix(changed.existingRoutePrefix);
  forgedOriginal.runtimePathBindingsSha256 = digestRuntimePathBindings(
    forgedOriginal.runtimePathBindings,
  );
  changed.initialBoundPacketSha256 = digestRoutePacket(forgedOriginal);
  const freshApprovalForChangedPacket = approval(changed);

  assert.throws(
    () => buildRouteRequests(
      changed,
      freshApprovalForChangedPacket,
      NOW_MS,
      original,
    ),
    /externally supplied original bound packet/,
  );
});

test("schema-v2 continuation rejects gaps, reordered prefixes, and non-suffix remaining routes", () => {
  const original = packet("bound");
  const gap = continuationPacket(1);
  gap.existingRoutePrefix[0] = structuredClone(continuationPacket(2).existingRoutePrefix[1]);
  gap.existingRoutePrefixSha256 = digestExistingRoutePrefix(gap.existingRoutePrefix);
  assert.throws(() => validateRoutePacket(gap, original), /canonical prefix/);

  const reorderedPrefix = continuationPacket(2);
  [reorderedPrefix.existingRoutePrefix[0], reorderedPrefix.existingRoutePrefix[1]] = [
    reorderedPrefix.existingRoutePrefix[1],
    reorderedPrefix.existingRoutePrefix[0],
  ];
  reorderedPrefix.existingRoutePrefixSha256 = digestExistingRoutePrefix(
    reorderedPrefix.existingRoutePrefix,
  );
  assert.throws(() => validateRoutePacket(reorderedPrefix, original), /canonical prefix/);

  const countDrift = continuationPacket(1);
  countDrift.gatewayPrestate.routeCount = 2;
  assert.throws(() => validateRoutePacket(countDrift, original), /readback count/);

  const reorderedSuffix = continuationPacket(1);
  [reorderedSuffix.remainingRoutes[0], reorderedSuffix.remainingRoutes[1]] = [
    reorderedSuffix.remainingRoutes[1],
    reorderedSuffix.remainingRoutes[0],
  ];
  assert.throws(() => validateRoutePacket(reorderedSuffix, original), /exact canonical suffix/);

  const recreateExisting = continuationPacket(1);
  recreateExisting.remainingRoutes[0] = structuredClone(recreateExisting.routes[0]);
  assert.throws(() => validateRoutePacket(recreateExisting, original), /exact canonical suffix/);

  assert.throws(() => validateRoutePacket(continuationPacket(0), original), /non-empty incomplete/);
  assert.throws(() => validateRoutePacket(continuationPacket(18), original), /non-empty incomplete/);
});

test("schema-v2 continuation rejects existing-route attribute and evidence drift", async (t) => {
  const original = packet("bound");
  const drifts = [
    ["method", (route) => { route.method = "DELETE"; }],
    ["source endpoint", (route) => { route.source_endpoint = `/changed/${"z".repeat(32)}`; }],
    ["target type", (route) => { route.target = "basicio"; }],
    ["target endpoint", (route) => { route.target_endpoint += "-changed"; }],
    ["target id", (route) => { route.target_id = "999"; }],
    ["authentication", (route) => { route.authentication = ["APIKey"]; }],
    ["overall throttle", (route) => { route.throttling.overall.limit += 1; }],
    ["IP duration", (route) => { route.throttling.ip.duration.seconds = 1; }],
  ];
  for (const [label, mutate] of drifts) {
    await t.test(label, () => {
      const value = continuationPacket(1);
      mutate(value.existingRoutePrefix[0]);
      value.existingRoutePrefixSha256 = digestExistingRoutePrefix(value.existingRoutePrefix);
      assert.throws(() => validateRoutePacket(value, original), /attributes drifted/);
    });
  }

  const unsafeProviderMetadata = continuationPacket(1);
  unsafeProviderMetadata.existingRoutePrefix[0].actor_id = "synthetic-actor";
  unsafeProviderMetadata.existingRoutePrefixSha256 = digestExistingRoutePrefix(
    unsafeProviderMetadata.existingRoutePrefix,
  );
  assert.throws(() => validateRoutePacket(unsafeProviderMetadata, original), /fields are not exact/);

  const staleDigest = continuationPacket(1);
  staleDigest.existingRoutePrefixSha256 = "f".repeat(64);
  assert.throws(() => validateRoutePacket(staleDigest, original), /allowlisted readback digest/);
});

test("schema-v2 continuation requires fresh exact single-use continuation approval", () => {
  const value = continuationPacket(1);
  const original = packet("bound");
  assert.equal(buildRouteRequests(value, approval(value), NOW_MS, original).length, 17);
  assert.throws(
    () => buildRouteRequests(
      value,
      approval(value, { continuationAuthorized: false }),
      NOW_MS,
      original,
    ),
    /not explicitly authorized/,
  );
  assert.throws(
    () => buildRouteRequests(value, approval(value, { schemaVersion: 1 }), NOW_MS, original),
    /must match the packet schemaVersion/,
  );
  assert.throws(
    () => buildRouteRequests(value, approval(value, {
      expiresAt: "2026-08-26T18:05:00.000Z",
    }), NOW_MS, original),
    /expired/,
  );
  assert.throws(
    () => buildRouteRequests(value, approval(value, {
      expiresAt: "2026-08-26T18:15:00.001Z",
    }), NOW_MS, original),
    /no longer than 15 minutes/,
  );
  assert.throws(
    () => buildRouteRequests(value, approval(value, { singleUse: false }), NOW_MS, original),
    /single-use/,
  );

  const changedEvidence = structuredClone(value);
  changedEvidence.prestateEvidenceSha256 = "d".repeat(64);
  assert.throws(
    () => buildRouteRequests(changedEvidence, approval(value), NOW_MS, original),
    /private route approval/,
  );
});

test("schema-v2 continuation still rejects Production and gateway activation", () => {
  const original = packet("bound");
  const production = continuationPacket(1);
  production.environment = "Production";
  assert.throws(() => validateRoutePacket(production, original), /Development/);

  const activation = continuationPacket(1);
  activation.gatewayActivationAuthorized = true;
  assert.throws(() => validateRoutePacket(activation, original), /activation/);
});

test("schema-v3 reconciles an unordered complete shared-project inventory additively", () => {
  assert.deepEqual(CONTRACT.additive_reconciliation, {
    allowed_preserved_deferred_route_ids: ["CRM_BILLING"],
    billing_mutation_authorized: false,
    claim_namespace: "catalyst-route-additive-reconciliation-v3",
    consumption_digest_domain: "sylvara.catalyst-route-additive-reconciliation-consumption.v1",
    durable_consumption_required: true,
    existing_route_mutation_authorized: false,
    final_complete_readback_required: true,
    gateway_activation_authorized: false,
    gateway_prestate: "disabled-with-fresh-complete-nonzero-route-inventory",
    operation_authorization_id_required: true,
    packet_schema_version: 3,
    retry_authorized: false,
    route_profile: "setup-journey",
  });
  assert.equal(CLAIM_NAMESPACE, CONTRACT.additive_reconciliation.claim_namespace);
  const value = additivePacket();
  const result = validateRoutePacket(value);
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.phase, "additive_reconciliation");
  assert.equal(result.existingRouteCount, 12);
  assert.equal(result.requestRouteCount, 6);
  assert.deepEqual(result.preservedDeferredRouteIds, ["CRM_BILLING"]);
  assert.equal(result.existingRouteInventorySha256, value.existingRouteInventorySha256);
  assert.equal(result.missingRoutesSha256, value.missingRoutesSha256);
  assert.deepEqual(
    buildRouteRequests(value, approval(value), NOW_MS).map(({ body }) => body.name),
    [
      "ROUTE_CONTROL_APPROVE", "ROUTE_CONTROL_ACTIVATE", "ROUTE_CONTROL_ROLLBACK",
      "FORM1_ACCESS", "FORM1_EXCHANGE", "FORM1_SUBMISSION",
    ],
  );

  const reordered = additivePacket([...HISTORICAL_SHARED_PROJECT_ROUTE_IDS].reverse());
  assert.deepEqual(
    buildRouteRequests(reordered, approval(reordered), NOW_MS).map(({ body }) => body.name),
    [
      "ROUTE_CONTROL_APPROVE", "ROUTE_CONTROL_ACTIVATE", "ROUTE_CONTROL_ROLLBACK",
      "FORM1_ACCESS", "FORM1_EXCHANGE", "FORM1_SUBMISSION",
    ],
  );
  assert.equal(
    buildRouteRequests(reordered, approval(reordered), NOW_MS)
      .some(({ body }) => body.name === "CRM_BILLING"),
    false,
  );

  const withoutBilling = additivePacket(
    HISTORICAL_SHARED_PROJECT_ROUTE_IDS.filter((id) => id !== "CRM_BILLING"),
  );
  assert.deepEqual(validateRoutePacket(withoutBilling).preservedDeferredRouteIds, []);
  assert.equal(
    validateAdditiveFinalReadback(withoutBilling, additiveFinalReadback(withoutBilling), NOW_MS)
      .routeCount,
    17,
  );
});

test("schema-v3 rejects incomplete, unknown, duplicate, drifted, zero, and complete inventories", async (t) => {
  const mutateAndRedigest = (value, mutate) => {
    mutate(value);
    value.existingRouteInventorySha256 = digestRouteInventory(value.existingRouteInventory);
    return value;
  };
  const cases = [
    ["incomplete count", () => mutateAndRedigest(additivePacket(), (value) => {
      value.existingRouteInventory.pop();
    }), /inventory count/],
    ["not complete", () => {
      const value = additivePacket();
      value.providerInventoryComplete = false;
      return value;
    }, /explicitly complete/],
    ["unknown route", () => mutateAndRedigest(additivePacket(), (value) => {
      value.existingRouteInventory.at(-1).name = "OTHER_DEFERRED";
    }), /not an allowed preserved deferred route/],
    ["duplicate route", () => mutateAndRedigest(additivePacket(), (value) => {
      value.existingRouteInventory[1] = structuredClone(value.existingRouteInventory[0]);
    }), /duplicates canonical route identity/],
    ["drifted route", () => mutateAndRedigest(additivePacket(), (value) => {
      value.existingRouteInventory[0].method = "DELETE";
    }), /route attributes drifted/],
    ["missing-route drift", () => {
      const value = additivePacket();
      value.missingRoutes.shift();
      value.missingRoutesSha256 = digestMissingRoutes(value.missingRoutes);
      return value;
    }, /exact canonical set/],
    ["enabled Gateway", () => {
      const value = additivePacket();
      value.gatewayPrestate.enabled = true;
      return value;
    }, /gateway prestate must be disabled/],
    ["Gateway activation", () => {
      const value = additivePacket();
      value.gatewayActivationAuthorized = true;
      return value;
    }, /activation/],
    ["existing mutation", () => {
      const value = additivePacket();
      value.existingRouteMutationAuthorized = true;
      return value;
    }, /existing route mutation is not authorized/],
    ["Billing mutation", () => {
      const value = additivePacket();
      value.billingMutationAuthorized = true;
      return value;
    }, /CRM Billing mutation is not authorized/],
    ["Production", () => {
      const value = additivePacket();
      value.environment = "Production";
      return value;
    }, /Development/],
    ["zero", () => additivePacket([]), /non-empty provider route inventory/],
    ["already complete", () => additivePacket([
      ...CONTRACT.route_profiles["setup-journey"].route_ids,
      "CRM_BILLING",
    ]), /already-complete/],
  ];

  for (const [label, fixture, expected] of cases) {
    await t.test(label, () => assert.throws(() => validateRoutePacket(fixture()), expected));
  }
});

test("schema-v3 requires a fresh exact durable-consumption-bound additive approval", () => {
  const value = additivePacket();
  const envelope = approval(value);
  const result = validateRoutePacket(value);
  assert.equal(buildRouteRequests(value, envelope, NOW_MS).length, 6);
  assert.equal(result.operationAuthorizationId, value.operationAuthorizationId);
  assert.equal(result.consumptionDigest, digestOperationAuthorization(value));
  assert.equal(envelope.consumptionSha256, result.consumptionDigest);
  assert.throws(
    () => buildRouteRequests(
      value,
      approval(value, { additiveReconciliationAuthorized: false }),
      NOW_MS,
    ),
    /not explicitly authorized/,
  );
  assert.throws(
    () => buildRouteRequests(
      value,
      approval(value, { existingRouteInventorySha256: "f".repeat(64) }),
      NOW_MS,
    ),
    /does not match the exact inventory/,
  );
  assert.throws(
    () => buildRouteRequests(
      value,
      approval(value, { existingRouteMutationAuthorized: true }),
      NOW_MS,
    ),
    /cannot authorize existing route mutation/,
  );
  assert.throws(
    () => buildRouteRequests(value, approval(value, { singleUse: false }), NOW_MS),
    /single-use/,
  );
  assert.throws(
    () => buildRouteRequests(
      value,
      approval(value, { durableConsumptionRequired: false }),
      NOW_MS,
    ),
    /durable single-use consumption/,
  );
  assert.throws(
    () => buildRouteRequests(
      value,
      approval(value, { consumptionSha256: "f".repeat(64) }),
      NOW_MS,
    ),
    /durable single-use consumption/,
  );
  assert.throws(
    () => buildRouteRequests(
      value,
      approval(value, { retryAuthorized: true }),
      NOW_MS,
    ),
    /durable single-use consumption/,
  );

  const reissued = approval(value, {
    capturedAt: "2026-08-26T18:00:30.000Z",
    expiresAt: "2026-08-26T18:10:30.000Z",
  });
  assert.equal(reissued.operationAuthorizationId, envelope.operationAuthorizationId);
  assert.equal(reissued.consumptionSha256, envelope.consumptionSha256);
  assert.throws(
    () => buildRouteRequests(value, approval(value), Date.parse("2026-08-26T18:15:00.001Z")),
    /expired|older than 15 minutes/,
  );

  const futurePrestate = additivePacket();
  futurePrestate.prestateObservedAt = "2026-08-26T18:01:00.000Z";
  assert.throws(
    () => buildRouteRequests(futurePrestate, approval(futurePrestate), NOW_MS),
    /no later than approval capture/,
  );
});

test("schema-v3 final readback requires all setup routes, unchanged preserved Billing, and a disabled Gateway", async (t) => {
  const value = additivePacket();
  const readback = additiveFinalReadback(value);
  const result = validateAdditiveFinalReadback(value, readback, NOW_MS);
  assert.equal(result.routeCount, 18);
  assert.equal(result.preservedDeferredRouteCount, 1);
  assert.equal(result.gatewayEnabled, false);
  assert.match(result.routeInventorySha256, /^[a-f0-9]{64}$/);

  const cases = [
    ["missing setup route", (candidate) => { candidate.routes.pop(); }, /exactly 18/],
    ["drifted created route", (candidate) => {
      candidate.routes.find(({ name }) => name === "FORM1_ACCESS").method = "DELETE";
    }, /route attributes drifted/],
    ["changed preserved Billing", (candidate) => {
      candidate.routes.find(({ name }) => name === "CRM_BILLING").throttling.ip.limit += 1;
    }, /deferred route attributes drifted|changed an existing route/],
    ["extra route", (candidate) => {
      candidate.routes.push({ ...structuredClone(candidate.routes[0]), name: "OTHER_DEFERRED" });
    }, /exactly 18/],
    ["enabled Gateway", (candidate) => { candidate.gatewayEnabled = true; }, /Gateway disabled/],
    ["incomplete inventory", (candidate) => {
      candidate.providerInventoryComplete = false;
    }, /explicitly complete/],
    ["stale readback", (candidate) => {
      candidate.observedAt = "2026-08-26T17:49:00.000Z";
    }, /predates|older than 15 minutes/],
  ];
  for (const [label, mutate, expected] of cases) {
    await t.test(label, () => {
      const candidate = structuredClone(readback);
      mutate(candidate);
      assert.throws(() => validateAdditiveFinalReadback(value, candidate, NOW_MS), expected);
    });
  }
});

test("schema-v3 validation-only CLI binds current HEAD and rejects duplicate object keys", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sylvara-route-run-"));
  t.after(() => fs.rmSync(temporary, { force: true, recursive: true }));
  const currentRevision = execFileSync(
    "git",
    ["-C", REPOSITORY_ROOT, "rev-parse", "--verify", "HEAD"],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  const value = additivePacket();
  value.approvedSourceRevision = currentRevision;
  const envelope = approval(value);
  const packetPath = path.join(temporary, "private-route-packet.json");
  const approvalPath = path.join(temporary, "private-route-approval.json");
  const readbackPath = path.join(temporary, "private-route-readback.json");
  fs.writeFileSync(packetPath, `${JSON.stringify(value)}\n`, "utf8");
  fs.writeFileSync(approvalPath, `${JSON.stringify(envelope)}\n`, "utf8");
  fs.writeFileSync(
    readbackPath,
    `${JSON.stringify(additiveFinalReadback(value))}\n`,
    "utf8",
  );

  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    const result = run([packetPath, approvalPath], NOW_MS);
    assert.equal(result.operationAuthorizationId, value.operationAuthorizationId);
    assert.equal(result.consumptionDigest, envelope.consumptionSha256);
    const readbackResult = runAdditiveReadbackVerifier(
      [packetPath, readbackPath],
      NOW_MS,
    );
    assert.equal(readbackResult.routeCount, 18);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.throws(
    () => runAdditiveReadbackVerifier([packetPath, packetPath], NOW_MS),
    /must be distinct/,
  );

  const duplicatePath = path.join(temporary, "private-route-duplicate.json");
  const duplicateRaw = JSON.stringify(value).replace(
    '"schemaVersion":3',
    '"schemaVersion":3,"schemaVersion":3',
  );
  assert.notEqual(duplicateRaw, JSON.stringify(value));
  fs.writeFileSync(duplicatePath, `${duplicateRaw}\n`, "utf8");
  assert.throws(
    () => run([duplicatePath, approvalPath], NOW_MS),
    /duplicate object keys/,
  );

  const duplicateReadbackPath = path.join(temporary, "private-route-readback-duplicate.json");
  const duplicateReadbackRaw = JSON.stringify(additiveFinalReadback(value)).replace(
    '"schemaVersion":3',
    '"schemaVersion":3,"schemaVersion":3',
  );
  fs.writeFileSync(duplicateReadbackPath, `${duplicateReadbackRaw}\n`, "utf8");
  assert.throws(
    () => runAdditiveReadbackVerifier(
      [packetPath, duplicateReadbackPath],
      NOW_MS,
    ),
    /duplicate object keys/,
  );

  const stale = structuredClone(value);
  stale.approvedSourceRevision = "a".repeat(40);
  const staleApproval = approval(stale);
  const stalePath = path.join(temporary, "private-route-stale.json");
  const staleApprovalPath = path.join(temporary, "private-route-stale-approval.json");
  fs.writeFileSync(stalePath, `${JSON.stringify(stale)}\n`, "utf8");
  fs.writeFileSync(staleApprovalPath, `${JSON.stringify(staleApproval)}\n`, "utf8");
  assert.throws(
    () => run([stalePath, staleApprovalPath], NOW_MS),
    /does not match current repository HEAD/,
  );
});

test("private packet path cannot be placed in or resolve into the public repository", (t) => {
  const worktreeRoots = attachedWorktreeRoots();
  assert.ok(worktreeRoots.length >= 1);
  for (const worktreeRoot of worktreeRoots) {
    assert.throws(
      () => assertPrivatePacketPath(worktreeRoot),
      /outside the public repository/,
    );
  }
  assert.throws(
    () => assertPrivatePacketPath(path.join(REPOSITORY_ROOT, "README.md")),
    /outside the public repository/,
  );
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sylvara-route-path-"));
  t.after(() => fs.rmSync(temporary, { force: true, recursive: true }));
  const external = path.join(temporary, "private-route-packet.json");
  fs.writeFileSync(external, "{}\n", "utf8");
  assert.equal(assertPrivatePacketPath(external), fs.realpathSync(external));

  const hardLinked = path.join(temporary, "hard-linked-private-route-packet.json");
  try {
    fs.linkSync(external, hardLinked);
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
  }
  if (fs.existsSync(hardLinked)) {
    assert.throws(() => assertPrivatePacketPath(external), /link count/);
    assert.throws(() => assertPrivatePacketPath(hardLinked), /link count/);
  }

  const repositoryFile = path.join(REPOSITORY_ROOT, "README.md");
  const linked = path.join(temporary, "linked-private-route-packet.json");
  try {
    fs.symlinkSync(repositoryFile, linked, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return;
    throw error;
  }
  assert.throws(() => assertPrivatePacketPath(linked), /outside the public repository/);
});
