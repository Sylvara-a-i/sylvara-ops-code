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
  assertPrivatePacketPath,
  buildRouteRequests,
  digestRouteContract,
  digestRoutePacket,
  digestRuntimePathBindings,
  validateRouteApproval,
  validateRoutePacket,
} = require("../scripts/validate-private-route-packet");

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

function packet(phase = "definition") {
  const functionIds = {
    crm_billing_orchestrator: "902",
    revenue_desk_call_gateway: "903",
    revenue_leak_test_request_form: "905",
    revenue_leak_test_setup_form: "906",
  };
  const runtimePathBindings = CONTRACT.routes.map((route) => ({
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
    routeContractSha256: ROUTE_CONTRACT_SHA256,
    routes: CONTRACT.routes.map((route, index) => {
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
  return {
    approvedSourceRevision: value.approvedSourceRevision,
    capturedAt: "2026-08-26T18:00:00.000Z",
    expiresAt: "2026-08-26T18:15:00.000Z",
    packetSha256: digestRoutePacket(value),
    prestateEvidenceSha256: value.prestateEvidenceSha256,
    routeContractSha256: value.routeContractSha256,
    routeCreationAuthorized: true,
    schemaVersion: 1,
    singleUse: true,
    ...overrides,
  };
}

test("validates one exact 12-route definition without authorizing activation", () => {
  const value = packet();
  const result = validateRoutePacket(value);
  assert.equal(result.phase, "definition");
  assert.equal(result.routeCount, 12);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.equal(digestRoutePacket(Object.fromEntries(Object.entries(value).reverse())), result.digest);
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
  assert.equal(requests.length, 12);
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
    ["FORM2_ISSUE", "FORM2_PREFILL", "FORM2_SUBMISSION", "CRM_BILLING"],
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
  assert.equal(buildRouteRequests(value, approval(value), NOW_MS).length, 12);
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
  const form1RouteIds = new Set(["FORM1_ISSUE", "FORM1_PREFILL"]);
  ambiguous.routes
    .filter(({ id }) => form1RouteIds.has(id))
    .forEach((route) => {
      route.targetId = "902";
    });
  assert.throws(() => validateRoutePacket(ambiguous), /share a target ID/);
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
