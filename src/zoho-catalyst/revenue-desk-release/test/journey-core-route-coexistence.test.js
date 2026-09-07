"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const {
  CONTRACT: CANONICAL, ROUTE_CONTRACT_SHA256, buildRouteRequests,
  digestRoutePacket, digestRuntimePathBindings, validateCanonicalRouteIdentityBindings,
  validateRoutePacket,
} = require("../scripts/validate-private-route-packet");
const {
  CONTRACT, CONTRACT_SHA256, expectedCoexistenceRoutes, validateJourneyCoreRouteReadback,
} = require("../scripts/verify-journey-core-route-readback");

const NOW = Date.parse("2026-01-01T12:00:00.000Z");

function fixture() {
  const ids = new Map([...new Set(CANONICAL.routes.map((route) => route.function))]
    .map((name, index) => [name, String(900 + index)]));
  const bindings = CANONICAL.routes.map((route) => ({ function: route.function,
    pathReference: route.path_reference, routeId: route.id,
    runtimePath: `/synthetic/${route.id.toLowerCase().replaceAll("_", "-")}` }));
  const canonicalBindings = {
    schemaVersion: 1, kind: "canonical-route-readonly-bindings-v1",
    routeProfile: "canonical-all", environment: "Development",
    organizationId: 606, projectId: "707",
    routeContractSha256: ROUTE_CONTRACT_SHA256,
    routes: CANONICAL.routes.map((route, index) => ({ id: route.id,
      sourceEndpoint: `/synthetic/${String(index).padStart(2, "0")}${"x".repeat(30)}`,
      targetId: ids.get(route.function) })),
    runtimePathBindings: bindings, runtimePathBindingsSha256: digestRuntimePathBindings(bindings),
  };
  const packet = { schemaVersion: 1, profile: "free-test-journey-core-v1",
    sourceRevision: "c".repeat(40), contractSha256: CONTRACT_SHA256, canonicalBindings,
    compatibilitySourceEndpoints: CONTRACT.compatibility_routes.map((alias) => ({
      routeId: alias.id, sourceEndpoint: alias.source_endpoint_binding === "runtime_path"
        ? bindings.find((binding) => binding.routeId === alias.canonical_route_id).runtimePath
        : `/synthetic/${"f".repeat(32)}`,
    })) };
  const routes = structuredClone(expectedCoexistenceRoutes(packet));
  const readback = { schemaVersion: 1, profile: packet.profile,
    bindingPacketSha256: digestRoutePacket(packet), environment: "Development",
    organizationId: 606, projectId: "707", observedAt: "2026-01-01T11:59:00.000Z",
    providerInventoryComplete: true, gatewayEnabled: true, retellRouteMode: "disabled", routes,
    consumerBindings: CONTRACT.compatibility_routes.filter((alias) => alias.acceptance_required)
      .map((alias) => ({ consumer: alias.required_consumer, routeId: alias.id,
        sourceEndpoint: routes.find((route) => route.name === alias.id).source_endpoint })) };
  return { packet, readback };
}

test("exact 24-route coexistence verifies with three consumers and grants no action", () => {
  const { packet, readback } = fixture();
  const result = validateJourneyCoreRouteReadback(packet, readback, NOW);
  assert.equal(result.routeCount, 24);
  assert.equal(result.requiredCompatibilityConsumerCount, 3);
  assert.equal(result.requestRouteCount, 0);
  for (const key of ["routeMutationAuthorized", "gatewayActivationAuthorized",
    "runtimeReopeningAuthorized", "sessionOrEmailTestAuthorized", "retellProviderAccessAuthorized"]) {
    assert.equal(result[key], false);
  }
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(CONTRACT.compatibility_routes[0]), true);
  assert.equal(Object.hasOwn(packet.canonicalBindings, "approvedSourceRevision"), false);
  assert.equal(Object.hasOwn(packet.canonicalBindings, "gatewayPrestate"), false);
});

test("provider ordering is retained, and disabled Gateway readback grants no enablement", () => {
  const { packet, readback } = fixture();
  readback.routes.reverse();
  readback.consumerBindings.reverse();
  readback.gatewayEnabled = false;
  const before = JSON.stringify(readback);
  const result = validateJourneyCoreRouteReadback(packet, readback, NOW);
  assert.equal(result.gatewayEnabled, false);
  assert.equal(result.gatewayActivationAuthorized, false);
  assert.equal(JSON.stringify(readback), before);
});

for (const [label, mutate] of [
  ["missing route", (r) => r.routes.pop()],
  ["extra route", (r) => r.routes.push(structuredClone(r.routes[0]))],
  ["duplicate name", (r) => { r.routes[23] = structuredClone(r.routes[22]); }],
  ["unknown alias", (r) => { r.routes[23].name = "UNREVIEWED_RUNTIME"; }],
  ["temporary Form2 fixture", (r) => { r.routes[23].name = "FORM2_PREFILL_MAPPING_FIXTURE_TEMP"; }],
  ["wrong method", (r) => { r.routes[21].method = "GET"; }],
  ["wrong target kind", (r) => { r.routes[21].target = "url"; }],
  ["wrong numeric function", (r) => { r.routes[21].target_id = "999"; }],
  ["wrong target function", (r) => { r.routes[21].target_endpoint = "/server/wrong/synthetic/path"; }],
  ["wrong target path", (r) => { r.routes[21].target_endpoint += "-changed"; }],
  ["shared target outside named pair", (r) => { r.routes[21].target_endpoint = r.routes[18].target_endpoint; }],
  ["double target separator", (r) => { r.routes[21].target_endpoint = r.routes[21].target_endpoint.replace("/synthetic/", "//synthetic/"); }],
  ["wrong source", (r) => { r.routes[21].source_endpoint += "-changed"; }],
  ["duplicate source", (r) => { r.routes[21].source_endpoint = r.routes[0].source_endpoint; }],
  ["missing authentication", (r) => { delete r.routes[20].authentication; }],
  ["unknown authentication", (r) => { r.routes[20].authentication = null; }],
  ["removed APIKey", (r) => { r.routes[23].authentication = []; }],
  ["unexpected OTP authentication", (r) => { r.routes[20].authentication = ["APIKey"]; }],
  ["duplicate authentication", (r) => { r.routes[23].authentication = ["APIKey", "APIKey"]; }],
  ["wrong overall throttle", (r) => { r.routes[20].throttling.overall.limit += 1; }],
  ["wrong IP throttle", (r) => { r.routes[20].throttling.ip.limit += 1; }],
  ["wrong throttle duration", (r) => { r.routes[20].throttling.ip.duration.seconds = 1; }],
  ["unknown throttle", (r) => { delete r.routes[20].throttling.ip.limit; }],
  ["extra provider metadata", (r) => { r.routes[20].privateData = "synthetic"; }],
  ["wrong environment", (r) => { r.environment = "Production"; }],
  ["wrong organization", (r) => { r.organizationId = 607; }],
  ["wrong project", (r) => { r.projectId = "708"; }],
  ["partial inventory", (r) => { r.providerInventoryComplete = false; }],
  ["missing Gateway state", (r) => { delete r.gatewayEnabled; }],
  ["Retell mode changed", (r) => { r.retellRouteMode = "isolated_test"; }],
  ["stale readback", (r) => { r.observedAt = "2026-01-01T11:44:59.999Z"; }],
  ["future readback", (r) => { r.observedAt = "2026-01-01T12:00:00.001Z"; }],
  ["noncanonical timestamp", (r) => { r.observedAt = "2026-01-01T11:59:00Z"; }],
  ["wrong binding digest", (r) => { r.bindingPacketSha256 = "d".repeat(64); }],
  ["missing consumer", (r) => { r.consumerBindings.pop(); }],
  ["extra consumer", (r) => { r.consumerBindings.push(structuredClone(r.consumerBindings[0])); }],
  ["duplicate consumer", (r) => { r.consumerBindings[2] = structuredClone(r.consumerBindings[0]); }],
  ["wrong caller source", (r) => { r.consumerBindings[0].sourceEndpoint += "-changed"; }],
  ["wrong caller route", (r) => { r.consumerBindings[0].routeId = "FORM2_OTP_REQUEST"; }],
]) {
  test(`rejects ${label}`, () => {
    const { packet, readback } = fixture();
    mutate(readback);
    assert.throws(() => validateJourneyCoreRouteReadback(packet, readback, NOW));
  });
}

test("Form1 mapping alias has only its exact reviewed stricter two-per-minute limits", () => {
  const { packet, readback } = fixture();
  const alias = readback.routes.find((route) => route.name === "FORM1_PREFILL_MAPPING_FIXTURE");
  assert.equal(alias.throttling.overall.limit, 2);
  assert.equal(alias.throttling.ip.limit, 2);
  for (const limit of [1, 3, 30, 120]) {
    alias.throttling.overall.limit = limit;
    assert.throws(() => validateJourneyCoreRouteReadback(packet, readback, NOW));
  }
});

for (const [label, mutate] of [
  ["wrong contract digest", (p) => { p.contractSha256 = "d".repeat(64); }],
  ["unknown profile", (p) => { p.profile = "unreviewed"; }],
  ["missing alias binding", (p) => { p.compatibilitySourceEndpoints.pop(); }],
  ["extra alias binding", (p) => { p.compatibilitySourceEndpoints.push(p.compatibilitySourceEndpoints[0]); }],
  ["reordered alias binding", (p) => { p.compatibilitySourceEndpoints.reverse(); }],
  ["duplicate alias source", (p) => { p.compatibilitySourceEndpoints[0].sourceEndpoint = p.canonicalBindings.routes[0].sourceEndpoint; }],
  ["wrong runtime alias source", (p) => { p.compatibilitySourceEndpoints[1].sourceEndpoint = "/synthetic/wrong"; }],
  ["query in alias source", (p) => { p.compatibilitySourceEndpoints[0].sourceEndpoint += "?secret=synthetic"; }],
  ["wildcard alias source", (p) => { p.compatibilitySourceEndpoints[0].sourceEndpoint = "/synthetic/*"; }],
  ["traversal alias source", (p) => { p.compatibilitySourceEndpoints[0].sourceEndpoint = "/synthetic/../other"; }],
  ["new mutation flag", (p) => { p.routeCreationAuthorized = true; }],
  ["unbound canonical identities", (p) => { p.canonicalBindings.routes[0].targetId = null; }],
]) {
  test(`rejects binding packet with ${label}`, () => {
    const { packet } = fixture();
    mutate(packet);
    assert.throws(() => expectedCoexistenceRoutes(packet));
  });
}

test("read-only canonical identities validate without a historical creation packet or prestate", () => {
  const { packet } = fixture();
  const before = JSON.stringify(packet.canonicalBindings);
  const result = validateCanonicalRouteIdentityBindings(packet.canonicalBindings);
  assert.equal(result.routeCount, 18);
  assert.equal(result.requestRouteCount, 0);
  assert.equal(result.runtimePathBindingsSha256, packet.canonicalBindings.runtimePathBindingsSha256);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(packet.canonicalBindings), before);
});

for (const field of ["phase", "approvedSourceRevision", "gatewayPrestate", "prestateEvidenceSha256",
  "rollback", "approval", "gatewayActivationAuthorized", "operationAuthorizationId"]) {
  test(`read-only canonical identities reject creation-only field ${field}`, () => {
    const { packet } = fixture();
    packet.canonicalBindings[field] = "synthetic-creation-metadata";
    assert.throws(() => validateCanonicalRouteIdentityBindings(packet.canonicalBindings));
    assert.throws(() => expectedCoexistenceRoutes(packet));
  });
}

for (const [label, mutate] of [
  ["schema", (b) => { b.schemaVersion = 2; }],
  ["kind", (b) => { b.kind = "bound"; }],
  ["environment", (b) => { b.environment = "Production"; }],
  ["canonical profile", (b) => { b.routeProfile = "setup-journey"; }],
  ["contract digest", (b) => { b.routeContractSha256 = "d".repeat(64); }],
  ["organization type", (b) => { b.organizationId = "606"; }],
  ["organization range", (b) => { b.organizationId = Number.MAX_SAFE_INTEGER + 1; }],
  ["organization zero", (b) => { b.organizationId = 0; }],
  ["project type", (b) => { b.projectId = 707; }],
  ["project leading zero", (b) => { b.projectId = "0707"; }],
  ["missing route", (b) => { b.routes.pop(); }],
  ["extra route", (b) => { b.routes.push(structuredClone(b.routes[0])); }],
  ["duplicate route", (b) => { b.routes[1] = structuredClone(b.routes[0]); }],
  ["route ordering", (b) => { b.routes.reverse(); }],
  ["route target type", (b) => { b.routes[0].targetId = 900; }],
  ["route source", (b) => { b.routes[0].sourceEndpoint += "?private=synthetic"; }],
  ["duplicate route source", (b) => { b.routes[1].sourceEndpoint = b.routes[0].sourceEndpoint; }],
  ["inconsistent function target", (b) => {
    const same = CANONICAL.routes.findIndex((route, index) => index > 0 && route.function === CANONICAL.routes[0].function);
    b.routes[same].targetId = "999";
  }],
  ["different functions sharing target", (b) => { b.routes.forEach((route) => { route.targetId = "999"; }); }],
  ["missing runtime binding", (b) => { b.runtimePathBindings.pop(); }],
  ["extra runtime binding", (b) => { b.runtimePathBindings.push(structuredClone(b.runtimePathBindings[0])); }],
  ["runtime binding ordering", (b) => { b.runtimePathBindings.reverse(); }],
  ["runtime function", (b) => { b.runtimePathBindings[0].function = "synthetic_wrong"; }],
  ["runtime reference", (b) => { b.runtimePathBindings[0].pathReference = "WRONG_PATH"; }],
  ["runtime path", (b) => { b.runtimePathBindings[0].runtimePath = "/synthetic/../other"; }],
  ["runtime digest", (b) => { b.runtimePathBindingsSha256 = "d".repeat(64); }],
  ["duplicate same-function runtime path", (b) => {
    const same = CANONICAL.routes.findIndex((route, index) => index > 0 && route.function === CANONICAL.routes[0].function);
    b.runtimePathBindings[same].runtimePath = b.runtimePathBindings[0].runtimePath;
    b.runtimePathBindingsSha256 = digestRuntimePathBindings(b.runtimePathBindings);
  }],
]) {
  test(`read-only canonical identities reject ${label}`, () => {
    const { packet } = fixture();
    mutate(packet.canonicalBindings);
    assert.throws(() => validateCanonicalRouteIdentityBindings(packet.canonicalBindings));
    assert.throws(() => expectedCoexistenceRoutes(packet));
  });
}

test("historical creation profiles and schemas never accept coexistence packets", () => {
  assert.equal(CANONICAL.physical_route_count, 18);
  assert.equal(CANONICAL.routes.length, 18);
  assert.deepEqual(Object.keys(CANONICAL.route_profiles), ["canonical-all", "setup-journey"]);
  const { packet } = fixture();
  assert.equal(validateCanonicalRouteIdentityBindings(packet.canonicalBindings).routeCount, 18);
  for (const schemaVersion of [1, 2, 3]) {
    const rejected = { ...structuredClone(packet), schemaVersion };
    assert.throws(() => validateRoutePacket(rejected));
    assert.throws(() => buildRouteRequests(rejected, {}, NOW));
    const readOnlyIdentities = { ...structuredClone(packet.canonicalBindings), schemaVersion };
    assert.throws(() => validateRoutePacket(readOnlyIdentities));
    assert.throws(() => buildRouteRequests(readOnlyIdentities, {}, NOW));
  }
});

test("CLI emits only a fixed rejection and exposes no input path", () => {
  const privateSentinel = "synthetic-private-sentinel";
  const result = spawnSync(process.execPath, [path.join(__dirname,
    "../scripts/verify-journey-core-route-readback.js"), privateSentinel], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Journey-core route readback rejected; no action authorized.\n");
  assert.equal(result.stderr.includes(privateSentinel), false);
});
