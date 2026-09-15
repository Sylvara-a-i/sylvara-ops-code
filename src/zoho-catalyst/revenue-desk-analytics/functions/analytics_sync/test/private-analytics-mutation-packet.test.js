"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  AMBIGUITY_STATES,
  EXPECTED_CONTRACT_DIGESTS,
  FORBIDDEN_ACTIONS,
  FREE_TEST_TABLES_FORBIDDEN_ACTIONS,
  PHASES,
  REPOSITORY_ROOT,
  assertPrivatePacketPath,
  canonicalDefinitions,
  currentContractState,
  currentRepositoryState,
  digestMutationPacket,
  digestOperationAuthorization,
  digestOperationSet,
  expectedPhaseOperations,
  expectedRuleDigests,
  gitSubprocessEnvironment,
  validateMutationPacket,
  validateRepositoryState,
} = require("../../../tools/validate-private-analytics-mutation-packet");

const NOW_MS = Date.parse("2026-08-28T18:05:00.000Z");
const SOURCE_REVISION = "a".repeat(40);
const TARGET = Object.freeze({ organizationId: "101", workspaceId: "202" });
const REPOSITORY_STATE = Object.freeze({
  headRevision: SOURCE_REVISION,
  packageClean: true,
});
const DEFINITIONS = canonicalDefinitions();

test("Git subprocess environment rejects repository override poisoning", () => {
  const environment = gitSubprocessEnvironment({
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "PRIVATE-HOOKS",
    GIT_DIR: "PRIVATE-GIT-DIR",
    GIT_INDEX_FILE: "PRIVATE-GIT-INDEX",
    GIT_OBJECT_DIRECTORY: "PRIVATE-GIT-OBJECTS",
    GIT_OPTIONAL_LOCKS: "1",
    GIT_WORK_TREE: "PRIVATE-GIT-WORKTREE",
    PATH: "synthetic-path",
  });
  assert.deepEqual(environment, {
    GIT_OPTIONAL_LOCKS: "0",
    PATH: "synthetic-path",
  });
});

function evidence(label) {
  return crypto.createHash("sha256").update(label, "utf8").digest("hex");
}

function existingEntry(definition, assetId, label) {
  return {
    assetId: String(assetId),
    assetKey: definition.assetKey,
    assetName: definition.assetName,
    assetType: definition.assetType,
    readbackSha256: evidence(label),
    state: "existing",
  };
}

function missingEntry(definition) {
  return {
    assetId: null,
    assetKey: definition.assetKey,
    assetName: definition.assetName,
    assetType: definition.assetType,
    readbackSha256: null,
    state: "missing",
  };
}

function bindingEntry(definition, assetId, label) {
  return {
    assetId: String(assetId),
    assetKey: definition.assetKey,
    assetName: definition.assetName,
    assetType: definition.assetType,
    readbackSha256: evidence(label),
  };
}

function assetCreationInventory(existingKeys = []) {
  const existing = new Set(existingKeys);
  return {
    assets: DEFINITIONS.creation.map((definition, index) => existing.has(definition.assetKey)
      ? existingEntry(definition, 1000 + index, `asset-${definition.assetKey}`)
      : missingEntry(definition)),
    inventoryKind: "fresh_existing_missing_inventory",
  };
}

function freeTestTablesInventory(existingKeys = []) {
  const existing = new Set(existingKeys);
  return {
    assets: DEFINITIONS.tables.map((definition, index) => existing.has(definition.assetKey)
      ? existingEntry(definition, 1000 + index, `table-${definition.assetKey}`)
      : missingEntry(definition)),
    inventoryKind: "fresh_free_test_tables_inventory",
  };
}

function folderBindings() {
  return DEFINITIONS.folders.map((definition, index) =>
    bindingEntry(definition, 2000 + index, `folder-${definition.assetKey}`));
}

function dashboardAssemblyInventory(existingDashboardKeys = []) {
  const existing = new Set(existingDashboardKeys);
  return {
    dashboards: DEFINITIONS.dashboards.map((definition, index) =>
      existing.has(definition.assetKey)
        ? existingEntry(definition, 3000 + index, `dashboard-${definition.assetKey}`)
        : missingEntry(definition)),
    folders: folderBindings(),
    inventoryKind: "fresh_post_asset_creation_inventory",
    reports: DEFINITIONS.reports.map((definition, index) =>
      bindingEntry(definition, 4000 + index, `report-${definition.assetKey}`)),
  };
}

function folderPlacementInventory(placedKeys = []) {
  const placed = new Set(placedKeys);
  const folders = folderBindings();
  const folderIds = new Map(folders.map((entry) => [entry.assetKey, entry.assetId]));
  return {
    folders,
    inventoryKind: "fresh_post_dashboard_assembly_inventory",
    views: DEFINITIONS.placements.map((definition, index) => {
      const targetFolderId = folderIds.get(definition.folderKey);
      return {
        assetId: String(5000 + index),
        assetKey: definition.assetKey,
        assetName: definition.assetName,
        assetType: definition.assetType,
        currentFolderId: placed.has(definition.assetKey) ? targetFolderId : "9001",
        readbackSha256: evidence(`view-${definition.assetKey}`),
        targetFolderId,
      };
    }),
  };
}

function phaseCounts(phase, inventory) {
  if ([PHASES.assetCreation, PHASES.freeTestTables].includes(phase)) {
    const existing = inventory.assets.filter(({ state }) => state === "existing");
    const existingFolderCount = existing.filter(({ assetType }) => assetType === "folder").length;
    return {
      canonicalFolderCount: existingFolderCount,
      canonicalViewCount: existing.length - existingFolderCount,
      targetFolderCount: 6 + existingFolderCount,
      targetRootFolderCount: 6 + existingFolderCount,
      targetViewCount: 30 + existing.length - existingFolderCount,
    };
  }
  if (phase === PHASES.dashboardAssembly) {
    const dashboardCount = inventory.dashboards.filter(({ state }) => state === "existing").length;
    return {
      canonicalFolderCount: 3,
      canonicalViewCount: 29 + dashboardCount,
      targetFolderCount: 9,
      targetRootFolderCount: 9,
      targetViewCount: 59 + dashboardCount,
    };
  }
  return {
    canonicalFolderCount: 3,
    canonicalViewCount: 31,
    targetFolderCount: 9,
    targetRootFolderCount: 9,
    targetViewCount: 61,
  };
}

function prestate(phase, inventory) {
  return {
    ...phaseCounts(phase, inventory),
    capturedAt: "2026-08-28T17:55:00.000Z",
    defaultFolderCount: 1,
    duplicateFolderNameCount: 0,
    duplicateViewNameCount: 0,
    expiresAt: "2026-08-28T18:10:00.000Z",
    legacyRowCounts: { Dim_Client: 2, Fact_Calls: 13, Fact_Client_Daily: 10 },
    organizationCount: 1,
    ownedWorkspaceCount: 2,
    paginationComplete: true,
    privateEvidenceSha256: evidence(`prestate-${phase}`),
    sharedWorkspaceCount: 0,
    targetBindingMethod:
      "single-development-labelled-owned-workspace-and-row-bearing-legacy-signature",
    targetSubfolderCount: 0,
  };
}

function packet(phase = PHASES.assetCreation, inventory = assetCreationInventory()) {
  const value = {
    ambiguityResolution: {
      authoritativeEvidenceSha256: null,
      bindingKind: "approval_bound_operator_attestation",
      priorOperation: null,
      priorOperationAuthorizationId: null,
      priorPacketSha256: null,
      state: AMBIGUITY_STATES.none,
    },
    approvedSourceRevision: SOURCE_REVISION,
    contractDigests: { ...currentContractState().digests },
    environment: "Development",
    forbiddenActions: [...(phase === PHASES.freeTestTables
      ? FREE_TEST_TABLES_FORBIDDEN_ACTIONS : FORBIDDEN_ACTIONS)],
    inventory,
    operationAuthorizationId: "123e4567-e89b-42d3-a456-426614174000",
    operations: [],
    phase,
    phaseLineage: null,
    prestate: prestate(phase, inventory),
    productionAuthorized: false,
    retryAuthorized: false,
    ruleDigests: { ...expectedRuleDigests() },
    schemaVersion: 3,
    target: { ...TARGET },
  };
  if (![PHASES.assetCreation, PHASES.freeTestTables].includes(phase)) {
    value.phaseLineage = {
      authoritativeEvidenceSha256: value.prestate.privateEvidenceSha256,
      bindingKind: "approval_bound_operator_attestation",
      sourceOperationAuthorizationId: "323e4567-e89b-42d3-a456-426614174000",
      sourcePacketSha256: evidence(`source-packet-${phase}`),
      sourcePhase: phase === PHASES.dashboardAssembly
        ? PHASES.assetCreation
        : PHASES.dashboardAssembly,
    };
  }
  value.operations = structuredClone(expectedPhaseOperations(phase, value.target, inventory));
  return value;
}

function approval(value, overrides = {}) {
  return {
    approvedSourceRevision: value.approvedSourceRevision,
    authorizedOperationCount: value.operations.length,
    browserFallbackAuthorized: value.phase === PHASES.dashboardAssembly,
    capturedAt: "2026-08-28T18:00:00.000Z",
    consumptionSha256: digestOperationAuthorization(value),
    declarativeSingleUse: true,
    durableConsumptionRequired: true,
    expiresAt: "2026-08-28T18:10:00.000Z",
    mutationAuthorized: true,
    operationAuthorizationId: value.operationAuthorizationId,
    operationSetSha256: digestOperationSet(value.operations),
    packetSha256: digestMutationPacket(value),
    phase: value.phase,
    prestateEvidenceSha256: value.prestate.privateEvidenceSha256,
    priorOutcomeAttestation:
      value.ambiguityResolution.state === AMBIGUITY_STATES.none
        ? "operator_attests_no_prior_ambiguous_operation"
        : "operator_attests_authoritative_prior_outcome_resolution",
    retryAuthorized: false,
    schemaVersion: 3,
    targetOrganizationId: value.target.organizationId,
    targetWorkspaceId: value.target.workspaceId,
    ...overrides,
  };
}

function validate(value, envelope = approval(value), repositoryState = REPOSITORY_STATE) {
  return validateMutationPacket(value, envelope, NOW_MS, repositoryState);
}

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
      // Ignore prunable entries that cannot contain an existing fixture.
    }
  }
  return roots;
}

test("validates the three exact Development Analytics phases independently", () => {
  const asset = packet();
  const dashboard = packet(PHASES.dashboardAssembly, dashboardAssemblyInventory());
  const placement = packet(PHASES.folderPlacement, folderPlacementInventory());

  const assetResult = validate(asset);
  assert.deepEqual(
    { phase: assetResult.phase, operations: assetResult.operationCount, browser: assetResult.browserOperationCount },
    { phase: PHASES.assetCreation, operations: 32, browser: 0 },
  );
  const dashboardResult = validate(dashboard);
  assert.deepEqual(
    {
      phase: dashboardResult.phase,
      operations: dashboardResult.operationCount,
      browser: dashboardResult.browserOperationCount,
    },
    { phase: PHASES.dashboardAssembly, operations: 2, browser: 2 },
  );
  const placementResult = validate(placement);
  assert.deepEqual(
    {
      phase: placementResult.phase,
      operations: placementResult.operationCount,
      browser: placementResult.browserOperationCount,
    },
    { phase: PHASES.folderPlacement, operations: 31, browser: 0 },
  );
  assert.deepEqual(asset.operations.map(({ ordinal }) => ordinal),
    Array.from({ length: 32 }, (_, index) => index + 1));
  assert.ok(asset.operations.every(({ action }) => action.startsWith("create_")));
  assert.ok(placement.operations.every(({ action }) => action === "move_view_to_folder"));
});

test("asset creation derives only continuation-safe missing operations from fresh inventory", () => {
  const existingKeys = DEFINITIONS.creation.slice(0, 7).map(({ assetKey }) => assetKey);
  const value = packet(PHASES.assetCreation, assetCreationInventory(existingKeys));
  assert.equal(validate(value).operationCount, 25);
  assert.deepEqual(
    value.operations.map(({ assetKey }) => assetKey),
    DEFINITIONS.creation.slice(7).map(({ assetKey }) => assetKey),
  );

  const staleRemainingSet = structuredClone(value);
  staleRemainingSet.operations.unshift(structuredClone(packet().operations[0]));
  staleRemainingSet.operations.forEach((operation, index) => { operation.ordinal = index + 1; });
  assert.throws(
    () => validate(staleRemainingSet, approval(staleRemainingSet)),
    /exactly the non-complete operations from fresh inventory|exact remaining phase operation/,
  );
});

test("free-test tables uses the exact five canonical tables without authorizing broader assets", () => {
  const value = packet(PHASES.freeTestTables, freeTestTablesInventory());
  const result = validate(value);
  assert.equal(result.phase, "free_test_tables");
  assert.equal(result.operationCount, 5);
  assert.equal(result.connectorOperationCount, 5);
  assert.equal(result.browserOperationCount, 0);
  assert.equal(value.phaseLineage, null);
  assert.deepEqual(value.operations.map(({ assetKey }) => assetKey), [
    "deployment", "call", "daily_metric", "final_test_result", "conversion_status",
  ]);
  assert.ok(value.operations.every(({ action, assetType, readbackRule }) =>
    action === "create_table" && assetType === "table" && readbackRule === "table_exact_empty"));
  assert.deepEqual(DEFINITIONS.tables,
    DEFINITIONS.creation.filter(({ assetType }) => assetType === "table"));
  const broad = packet();
  for (const entry of value.operations) {
    assert.notEqual(entry.payloadSha256,
      broad.operations.find(({ assetKey }) => assetKey === entry.assetKey).payloadSha256);
  }
  assert.equal(validate(broad).operationCount, 32);
});

test("free-test table continuation omits existing tables and refuses a complete phase", () => {
  const value = packet(PHASES.freeTestTables, freeTestTablesInventory(["deployment", "call"]));
  assert.equal(validate(value).operationCount, 3);
  assert.deepEqual(value.operations.map(({ assetKey }) => assetKey), [
    "daily_metric", "final_test_result", "conversion_status",
  ]);
  assert.equal(value.prestate.canonicalFolderCount, 0);
  assert.equal(value.prestate.targetFolderCount, 6);
  assert.equal(value.prestate.canonicalViewCount, 2);
  assert.equal(value.prestate.targetViewCount, 32);
  const complete = packet(PHASES.freeTestTables,
    freeTestTablesInventory(DEFINITIONS.tables.map(({ assetKey }) => assetKey)));
  assert.equal(complete.operations.length, 0);
  assert.throws(() => validate(complete), /exactly the non-complete operations/);
});

test("free-test table inventory rejects missing, additional, reordered and mistyped assets", () => {
  const mutations = [
    (value) => value.inventory.assets.pop(),
    (value) => value.inventory.assets.push(missingEntry(DEFINITIONS.folders[0])),
    (value) => value.inventory.assets.reverse(),
    (value) => { value.inventory.assets[0].assetType = "query_table"; },
    (value) => { value.inventory.assets[0].assetName = "Noncanonical Table"; },
    (value) => { value.inventory.folders = []; },
    (value) => { value.inventory.inventoryKind = "fresh_existing_missing_inventory"; },
  ];
  for (const mutate of mutations) {
    const value = packet(PHASES.freeTestTables, freeTestTablesInventory());
    mutate(value);
    assert.throws(() => validate(value), /canonical asset|identity is not exact|fields are not exact|inventory kind/);
  }
});

test("free-test tables rejects every out-of-scope operation even with newly bound approval", () => {
  for (const action of ["create_folder", "create_query_table", "create_report",
    "assemble_dashboard", "move_view_to_folder", "import_data", "share", "Retell"]) {
    const value = packet(PHASES.freeTestTables, freeTestTablesInventory());
    value.operations[0].action = action;
    assert.throws(() => validate(value), /exact remaining phase operation/);
  }
  const changedPayload = packet(PHASES.freeTestTables, freeTestTablesInventory());
  changedPayload.operations[0].payloadSha256 = "0".repeat(64);
  assert.throws(() => validate(changedPayload), /exact remaining phase operation/);
  const broadened = packet(PHASES.freeTestTables, freeTestTablesInventory());
  broadened.forbiddenActions = [...FORBIDDEN_ACTIONS];
  assert.throws(() => validate(broadened), /forbiddenActions is not exact/);
});

test("free-test table approval cannot cross phases or satisfy dashboard lineage", () => {
  const value = packet(PHASES.freeTestTables, freeTestTablesInventory());
  const broad = packet();
  assert.equal(value.operationAuthorizationId, broad.operationAuthorizationId);
  assert.notEqual(digestOperationAuthorization(value), digestOperationAuthorization(broad));
  assert.throws(() => validate(value, approval(broad)), /does not bind the exact/);
  assert.throws(() => validate(broad, approval(value)), /does not bind the exact/);
  const dashboard = packet(PHASES.dashboardAssembly, dashboardAssemblyInventory());
  dashboard.phaseLineage.sourcePhase = PHASES.freeTestTables;
  assert.throws(() => validate(dashboard), /source phase is not the exact prior phase/);
  value.phaseLineage = structuredClone(dashboard.phaseLineage);
  assert.throws(() => validate(value), /must not claim a prior phase lineage/);
});

test("free-test tables preserves fresh target evidence, source, approval and containment gates", () => {
  const mutations = [
    [(value) => { value.target.workspaceId = "203"; }, /exact remaining phase operation/],
    [(value) => { value.prestate.paginationComplete = false; }, /pagination is not complete/],
    [(value) => { value.prestate.targetViewCount += 1; }, /fresh phase inventory/],
    [(value) => { value.prestate.expiresAt = "2026-08-28T18:04:00.000Z"; }, /has expired/],
    [(value) => { value.approvedSourceRevision = "b".repeat(40); }, /current committed revision/],
    [(value) => { value.retryAuthorized = true; }, /must not authorize retry/],
    [(value) => { value.ruleDigests.containment = "0".repeat(64); }, /reviewed rules/],
    [(value) => { value.productionAuthorized = true; }, /confined to Development/],
  ];
  for (const [mutate, expected] of mutations) {
    const value = packet(PHASES.freeTestTables, freeTestTablesInventory());
    mutate(value);
    assert.throws(() => validate(value), expected);
  }
  const value = packet(PHASES.freeTestTables, freeTestTablesInventory());
  for (const overrides of [
    { durableConsumptionRequired: false }, { browserFallbackAuthorized: true },
    { consumptionSha256: "0".repeat(64) }, { retryAuthorized: true },
  ]) assert.throws(() => validate(value, approval(value, overrides)), /does not bind the exact/);
  const refreshed = structuredClone(value);
  refreshed.prestate.privateEvidenceSha256 = evidence("different-current-evidence");
  assert.notEqual(digestOperationAuthorization(value), digestOperationAuthorization(refreshed));
  assert.throws(() => validate(refreshed, approval(value)), /does not bind the exact/);
});

test("free-test table ambiguity requires exact resolved outcome and new consumed authority", () => {
  const prior = packet(PHASES.freeTestTables, freeTestTablesInventory());
  const absent = packet(PHASES.freeTestTables, freeTestTablesInventory());
  absent.operationAuthorizationId = "223e4567-e89b-42d3-a456-426614174000";
  absent.ambiguityResolution = {
    authoritativeEvidenceSha256: absent.prestate.privateEvidenceSha256,
    bindingKind: "approval_bound_operator_attestation",
    priorOperation: {
      action: prior.operations[0].action,
      assetKey: prior.operations[0].assetKey,
      payloadSha256: prior.operations[0].payloadSha256,
      priorFolderId: null,
    },
    priorOperationAuthorizationId: prior.operationAuthorizationId,
    priorPacketSha256: digestMutationPacket(prior),
    state: AMBIGUITY_STATES.creationAbsent,
  };
  assert.equal(validate(absent).operationCount, 5);
  const existing = packet(PHASES.freeTestTables, freeTestTablesInventory(["deployment"]));
  existing.operationAuthorizationId = absent.operationAuthorizationId;
  existing.ambiguityResolution = {
    ...structuredClone(absent.ambiguityResolution),
    state: AMBIGUITY_STATES.creationExisting,
  };
  assert.equal(validate(existing).operationCount, 4);
  assert.ok(existing.operations.every(({ assetKey }) => assetKey !== "deployment"));
  const mutations = [
    [(value) => { value.operationAuthorizationId = prior.operationAuthorizationId; }, /new operation authorization/],
    [(value) => { value.ambiguityResolution.state = "unresolved"; }, /state is invalid/],
    [(value) => { value.ambiguityResolution.state = AMBIGUITY_STATES.creationExisting; }, /declared resolution/],
    [(value) => { value.ambiguityResolution.authoritativeEvidenceSha256 = "0".repeat(64); }, /current authoritative prestate/],
    [(value) => { value.ambiguityResolution.priorOperation.assetKey = "data_model"; }, /exact phase/],
    [(value) => {
      value.ambiguityResolution.priorOperation.payloadSha256 = packet().operations
        .find(({ assetKey }) => assetKey === "deployment").payloadSha256;
    }, /exact prior creation operation/],
  ];
  for (const [mutate, expected] of mutations) {
    const value = structuredClone(absent);
    mutate(value);
    assert.throws(() => validate(value), expected);
  }
});

test("dashboard assembly binds every concrete folder and report dependency before approval", () => {
  const value = packet(PHASES.dashboardAssembly, dashboardAssemblyInventory());
  const changedFolder = structuredClone(value);
  changedFolder.inventory.folders[1].assetId = "2999";
  assert.throws(
    () => validate(changedFolder, approval(changedFolder)),
    /exact remaining phase operation/,
  );

  const missingReportId = structuredClone(value);
  missingReportId.inventory.reports[0].assetId = null;
  assert.throws(
    () => validate(missingReportId, approval(missingReportId)),
    /inventory\.reports\[0\]\.assetId is invalid/,
  );

  const duplicateReportId = structuredClone(value);
  duplicateReportId.inventory.reports[1].assetId = duplicateReportId.inventory.reports[0].assetId;
  assert.throws(
    () => validate(duplicateReportId, approval(duplicateReportId)),
    /duplicate identifier/,
  );
});

test("dashboard continuation approves only dashboards still missing after fresh readback", () => {
  const value = packet(
    PHASES.dashboardAssembly,
    dashboardAssemblyInventory([DEFINITIONS.dashboards[0].assetKey]),
  );
  assert.equal(validate(value).operationCount, 1);
  assert.equal(value.operations[0].assetKey, DEFINITIONS.dashboards[1].assetKey);
  assert.equal(value.prestate.canonicalViewCount, 30);
  assert.equal(value.prestate.targetViewCount, 60);
});

test("fresh creation continuation requires an authoritative prior-packet ambiguity resolution", () => {
  const prior = packet();
  const absent = packet();
  absent.operationAuthorizationId = "223e4567-e89b-42d3-a456-426614174000";
  absent.ambiguityResolution = {
    authoritativeEvidenceSha256: absent.prestate.privateEvidenceSha256,
    bindingKind: "approval_bound_operator_attestation",
    priorOperation: {
      action: prior.operations[0].action,
      assetKey: prior.operations[0].assetKey,
      payloadSha256: prior.operations[0].payloadSha256,
      priorFolderId: null,
    },
    priorOperationAuthorizationId: prior.operationAuthorizationId,
    priorPacketSha256: digestMutationPacket(prior),
    state: AMBIGUITY_STATES.creationAbsent,
  };
  assert.doesNotThrow(() => validate(absent, approval(absent)));

  const reusedAuthority = structuredClone(absent);
  reusedAuthority.operationAuthorizationId = prior.operationAuthorizationId;
  assert.throws(
    () => validate(reusedAuthority, approval(reusedAuthority)),
    /requires a new operation authorization/,
  );

  const existingKey = DEFINITIONS.creation[0].assetKey;
  const existing = packet(PHASES.assetCreation, assetCreationInventory([existingKey]));
  existing.operationAuthorizationId = "223e4567-e89b-42d3-a456-426614174000";
  existing.ambiguityResolution = {
    ...structuredClone(absent.ambiguityResolution),
    authoritativeEvidenceSha256: existing.prestate.privateEvidenceSha256,
    state: AMBIGUITY_STATES.creationExisting,
  };
  assert.doesNotThrow(() => validate(existing, approval(existing)));
  assert.ok(existing.operations.every(({ assetKey }) => assetKey !== existingKey));

  const unresolved = structuredClone(absent);
  unresolved.ambiguityResolution.authoritativeEvidenceSha256 = "0".repeat(64);
  assert.throws(
    () => validate(unresolved, approval(unresolved)),
    /current authoritative prestate evidence/,
  );

  const falseExisting = structuredClone(absent);
  falseExisting.ambiguityResolution.state = AMBIGUITY_STATES.creationExisting;
  assert.throws(
    () => validate(falseExisting, approval(falseExisting)),
    /does not match the declared resolution/,
  );
});

test("phase-global provider asset identifiers are disjoint across dependency lists", () => {
  const folderReportCollision = packet(
    PHASES.dashboardAssembly,
    dashboardAssemblyInventory(),
  );
  folderReportCollision.inventory.folders[0].assetId =
    folderReportCollision.inventory.reports[0].assetId;
  assert.throws(
    () => validate(folderReportCollision, approval(folderReportCollision)),
    /duplicate identifier across the phase/,
  );

  const reportDashboardCollision = packet(
    PHASES.dashboardAssembly,
    dashboardAssemblyInventory([DEFINITIONS.dashboards[0].assetKey]),
  );
  reportDashboardCollision.inventory.dashboards[0].assetId =
    reportDashboardCollision.inventory.reports[0].assetId;
  assert.throws(
    () => validate(reportDashboardCollision, approval(reportDashboardCollision)),
    /duplicate identifier across the phase/,
  );

  const folderViewCollision = packet(PHASES.folderPlacement, folderPlacementInventory());
  folderViewCollision.inventory.views[0].assetId =
    folderViewCollision.inventory.folders[0].assetId;
  assert.throws(
    () => validate(folderViewCollision, approval(folderViewCollision)),
    /duplicate identifier across the phase/,
  );

  const priorFolderViewCollision = packet(PHASES.folderPlacement, folderPlacementInventory());
  priorFolderViewCollision.inventory.views[0].currentFolderId =
    priorFolderViewCollision.inventory.views[1].assetId;
  assert.throws(
    () => validate(priorFolderViewCollision, approval(priorFolderViewCollision)),
    /currentFolderId collides with a phase view identifier/,
  );
});

test("folder placement binds all views, dashboards, destinations, and prior folders one at a time", () => {
  const placedKeys = DEFINITIONS.placements.slice(0, 9).map(({ assetKey }) => assetKey);
  const value = packet(PHASES.folderPlacement, folderPlacementInventory(placedKeys));
  assert.equal(validate(value).operationCount, 22);
  assert.deepEqual(
    value.operations.map(({ assetKey }) => assetKey),
    DEFINITIONS.placements.slice(9).map(({ assetKey }) => assetKey),
  );

  const absentPriorFolder = structuredClone(value);
  absentPriorFolder.inventory.views[9].currentFolderId = null;
  assert.throws(
    () => validate(absentPriorFolder, approval(absentPriorFolder)),
    /currentFolderId is invalid/,
  );

  const changedPriorFolder = structuredClone(value);
  changedPriorFolder.inventory.views[9].currentFolderId = "9002";
  assert.throws(
    () => validate(changedPriorFolder, approval(changedPriorFolder)),
    /exact remaining phase operation/,
  );

  const wrongDestination = structuredClone(value);
  wrongDestination.inventory.views[9].targetFolderId = wrongDestination.inventory.folders[0].assetId;
  assert.throws(
    () => validate(wrongDestination, approval(wrongDestination)),
    /target folder binding is not exact/,
  );
});

test("ambiguous placement must resolve to the exact prior or target folder before continuation", () => {
  const prior = packet(PHASES.folderPlacement, folderPlacementInventory());
  const atPrior = packet(PHASES.folderPlacement, folderPlacementInventory());
  atPrior.operationAuthorizationId = "223e4567-e89b-42d3-a456-426614174000";
  atPrior.ambiguityResolution = {
    authoritativeEvidenceSha256: atPrior.prestate.privateEvidenceSha256,
    bindingKind: "approval_bound_operator_attestation",
    priorOperation: {
      action: prior.operations[0].action,
      assetKey: prior.operations[0].assetKey,
      payloadSha256: prior.operations[0].payloadSha256,
      priorFolderId: prior.inventory.views[0].currentFolderId,
    },
    priorOperationAuthorizationId: prior.operationAuthorizationId,
    priorPacketSha256: digestMutationPacket(prior),
    state: AMBIGUITY_STATES.placementAtPrior,
  };
  assert.doesNotThrow(() => validate(atPrior, approval(atPrior)));

  const firstKey = DEFINITIONS.placements[0].assetKey;
  const atTarget = packet(
    PHASES.folderPlacement,
    folderPlacementInventory([firstKey]),
  );
  atTarget.operationAuthorizationId = "223e4567-e89b-42d3-a456-426614174000";
  atTarget.ambiguityResolution = {
    ...structuredClone(atPrior.ambiguityResolution),
    authoritativeEvidenceSha256: atTarget.prestate.privateEvidenceSha256,
    state: AMBIGUITY_STATES.placementAtTarget,
  };
  assert.doesNotThrow(() => validate(atTarget, approval(atTarget)));
  assert.ok(atTarget.operations.every(({ assetKey }) => assetKey !== firstKey));

  const falseTarget = structuredClone(atPrior);
  falseTarget.ambiguityResolution.state = AMBIGUITY_STATES.placementAtTarget;
  assert.throws(
    () => validate(falseTarget, approval(falseTarget)),
    /does not prove the view reached its target folder/,
  );
});

test("later phases require an approval-bound prior-phase attestation and current evidence", () => {
  const dashboard = packet(PHASES.dashboardAssembly, dashboardAssemblyInventory());
  const wrongSource = structuredClone(dashboard);
  wrongSource.phaseLineage.sourcePhase = PHASES.folderPlacement;
  assert.throws(
    () => validate(wrongSource, approval(wrongSource)),
    /source phase is not the exact prior phase/,
  );

  const wrongEvidence = structuredClone(dashboard);
  wrongEvidence.phaseLineage.authoritativeEvidenceSha256 = "0".repeat(64);
  assert.throws(
    () => validate(wrongEvidence, approval(wrongEvidence)),
    /current authoritative prestate evidence/,
  );

  const reusedSourceAuthority = structuredClone(dashboard);
  reusedSourceAuthority.phaseLineage.sourceOperationAuthorizationId =
    reusedSourceAuthority.operationAuthorizationId;
  assert.throws(
    () => validate(reusedSourceAuthority, approval(reusedSourceAuthority)),
    /must reference a prior operation authorization/,
  );

  const asset = packet();
  asset.phaseLineage = {
    authoritativeEvidenceSha256: asset.prestate.privateEvidenceSha256,
    bindingKind: "approval_bound_operator_attestation",
    sourceOperationAuthorizationId: "323e4567-e89b-42d3-a456-426614174000",
    sourcePacketSha256: evidence("invented-lineage"),
    sourcePhase: PHASES.assetCreation,
  };
  assert.throws(
    () => validate(asset, approval(asset)),
    /must not claim a prior phase lineage/,
  );
});

test("a fully complete phase produces no reusable mutation authorization", () => {
  const allAssets = DEFINITIONS.creation.map(({ assetKey }) => assetKey);
  const value = packet(PHASES.assetCreation, assetCreationInventory(allAssets));
  assert.equal(value.operations.length, 0);
  assert.throws(
    () => validate(value),
    /operations must contain exactly the non-complete operations/,
  );
});

test("pins the reviewed model, dashboard, rendered contract, and phase rule digests", () => {
  assert.deepEqual(currentContractState().digests, EXPECTED_CONTRACT_DIGESTS);
  for (const key of Object.keys(EXPECTED_CONTRACT_DIGESTS)) {
    const changed = packet();
    changed.contractDigests[key] = "0".repeat(64);
    assert.throws(
      () => validate(changed, approval(changed)),
      /does not match the reviewed contract/,
    );
  }
  for (const key of ["returnedIds", "readback", "containment"]) {
    const changed = packet();
    changed.ruleDigests[key] = "0".repeat(64);
    assert.throws(
      () => validate(changed, approval(changed)),
      /does not match the reviewed rules/,
    );
  }
});

test("pre-reporting contract digests cannot carry old or freshly reissued approval across the schema change", () => {
  const priorDigests = {
    analyticsModel: "4987603d86ee9b3c6b441fecf734709a283e73ce7f06f3334a37a6008fa93e47",
    rendered: "b2b48c8cac2ac96b982316c826f06191761a06c07b493dd3f0db53f1e7548dad",
  };
  for (const field of Object.keys(priorDigests)) {
    const stale = packet();
    stale.contractDigests[field] = priorDigests[field];
    const freshlyBoundApproval = approval(stale);
    assert.equal(freshlyBoundApproval.packetSha256, digestMutationPacket(stale));
    assert.equal(freshlyBoundApproval.consumptionSha256, digestOperationAuthorization(stale));
    assert.throws(() => validate(stale, freshlyBoundApproval),
      /does not match the reviewed contract/);
  }
  const current = packet();
  const previous = structuredClone(current);
  Object.assign(previous.contractDigests, priorDigests);
  const priorApproval = approval(previous);
  assert.equal(previous.operationAuthorizationId, current.operationAuthorizationId);
  assert.notEqual(digestMutationPacket(previous), digestMutationPacket(current));
  assert.notEqual(digestOperationAuthorization(previous), digestOperationAuthorization(current));
  assert.throws(() => validate(current, priorApproval),
    /does not bind the exact private Development Analytics phase packet/);
});

test("prestate and approval are fresh canonical UTC windows no longer than 15 minutes", () => {
  const stale = packet();
  stale.prestate.capturedAt = "2026-08-28T17:49:59.999Z";
  stale.prestate.expiresAt = "2026-08-28T18:04:59.999Z";
  assert.throws(() => validate(stale, approval(stale)), /prestate has expired/);

  const tooLong = packet();
  tooLong.prestate.expiresAt = "2026-08-28T18:10:00.001Z";
  assert.throws(() => validate(tooLong, approval(tooLong)), /no longer than 15 minutes/);

  const value = packet();
  assert.throws(
    () => validate(value, approval(value, { capturedAt: "2026-08-28T18:05:00.001Z" })),
    /approval is not yet valid/,
  );
  assert.throws(
    () => validate(value, approval(value, { expiresAt: "2026-08-28T18:10:00.001Z" })),
    /outside the fresh prestate window|no longer than 15 minutes/,
  );
});

test("approval is declarative and requires durable pre-mutation consumption with no retry", () => {
  const value = packet(PHASES.dashboardAssembly, dashboardAssemblyInventory());
  for (const overrides of [
    { packetSha256: "0".repeat(64) },
    { operationSetSha256: "0".repeat(64) },
    { prestateEvidenceSha256: "0".repeat(64) },
    { approvedSourceRevision: "c".repeat(40) },
    { authorizedOperationCount: 1 },
    { browserFallbackAuthorized: false },
    { mutationAuthorized: false },
    { declarativeSingleUse: false },
    { durableConsumptionRequired: false },
    { retryAuthorized: true },
    { phase: PHASES.assetCreation },
    { operationAuthorizationId: "223e4567-e89b-42d3-a456-426614174000" },
    { priorOutcomeAttestation: "operator_attests_authoritative_prior_outcome_resolution" },
  ]) {
    assert.throws(
      () => validate(value, approval(value, overrides)),
      /does not bind the exact private Development Analytics phase packet/,
    );
  }

  const retryPacket = packet();
  retryPacket.retryAuthorized = true;
  assert.throws(
    () => validate(retryPacket, approval(retryPacket)),
    /must not authorize retry or resume/,
  );
});

test("consumption digest is approval-stable and exposes same-ID packet conflicts", () => {
  const value = packet();
  const first = validate(value, approval(value));
  const reissuedApproval = approval(value, {
    capturedAt: "2026-08-28T18:01:00.000Z",
    expiresAt: "2026-08-28T18:09:00.000Z",
  });
  const reissued = validate(value, reissuedApproval);
  assert.equal(first.operationAuthorizationId, value.operationAuthorizationId);
  assert.equal(first.consumptionDigest, digestOperationAuthorization(value));
  assert.equal(reissued.consumptionDigest, first.consumptionDigest);

  const conflict = structuredClone(value);
  conflict.prestate.privateEvidenceSha256 = evidence("changed-authoritative-prestate");
  const conflictResult = validate(conflict, approval(conflict));
  assert.equal(conflictResult.operationAuthorizationId, first.operationAuthorizationId);
  assert.notEqual(conflictResult.digest, first.digest);
  assert.notEqual(conflictResult.consumptionDigest, first.consumptionDigest);

  const newAuthority = structuredClone(value);
  newAuthority.operationAuthorizationId = "223e4567-e89b-42d3-a456-426614174000";
  const newAuthorityResult = validate(newAuthority, approval(newAuthority));
  assert.notEqual(newAuthorityResult.operationAuthorizationId, first.operationAuthorizationId);
  assert.notEqual(newAuthorityResult.consumptionDigest, first.consumptionDigest);

  assert.throws(
    () => validate(value, approval(value, { consumptionSha256: "0".repeat(64) })),
    /does not bind the exact private Development Analytics phase packet/,
  );
});

test("CLI validation requires the current committed revision and a clean Analytics package", () => {
  const value = packet();
  assert.doesNotThrow(() => validateRepositoryState(value, REPOSITORY_STATE));
  assert.throws(
    () => validate(value, approval(value), { ...REPOSITORY_STATE, packageClean: false }),
    /Analytics package is not clean/,
  );
  assert.throws(
    () => validate(value, approval(value), {
      headRevision: "b".repeat(40),
      packageClean: true,
    }),
    /approved source revision is not the current committed revision/,
  );
});

test("currentRepositoryState rejects visible drift and hidden Git index flags", (t) => {
  const temporaryRepository = fs.mkdtempSync(
    path.join(os.tmpdir(), "sylvara-analytics-repository-state-"),
  );
  t.after(() => fs.rmSync(temporaryRepository, { force: true, recursive: true }));
  const packageRoot = path.join(
    temporaryRepository, "src", "zoho-catalyst", "revenue-desk-analytics",
  );
  fs.mkdirSync(packageRoot, { recursive: true });
  const trackedPath = path.join(packageRoot, "tracked.txt");
  const trackedRelativePath = "src/zoho-catalyst/revenue-desk-analytics/tracked.txt";
  const trackedBytes = "clean Analytics package fixture\n";
  fs.writeFileSync(trackedPath, trackedBytes, "utf8");

  const git = (...args) => execFileSync(
    "git", ["-C", temporaryRepository, ...args],
    { encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true },
  ).trim();
  git("init", "--quiet");
  git("config", "user.name", "Sylvara Test");
  git("config", "user.email", "sylvara-test@example.invalid");
  git("config", "core.autocrlf", "false");
  git("add", "--", ".");
  git("commit", "--quiet", "--no-gpg-sign", "-m", "analytics repository-state fixture");

  const headRevision = git("rev-parse", "--verify", "HEAD");
  assert.deepEqual(
    currentRepositoryState(temporaryRepository),
    { headRevision, packageClean: true },
  );

  fs.writeFileSync(trackedPath, "dirty Analytics package fixture\n", "utf8");
  assert.throws(
    () => currentRepositoryState(temporaryRepository),
    /Analytics package is not clean/,
  );

  fs.writeFileSync(trackedPath, trackedBytes, "utf8");
  assert.deepEqual(
    currentRepositoryState(temporaryRepository),
    { headRevision, packageClean: true },
  );

  const untrackedPath = path.join(packageRoot, "untracked.txt");
  fs.writeFileSync(untrackedPath, "untracked\n", "utf8");
  assert.throws(
    () => currentRepositoryState(temporaryRepository),
    /Analytics package is not clean/,
  );
  fs.rmSync(untrackedPath);

  git("update-index", "--assume-unchanged", "--", trackedRelativePath);
  fs.writeFileSync(trackedPath, "hidden assume-unchanged drift\n", "utf8");
  assert.throws(
    () => currentRepositoryState(temporaryRepository),
    /hidden by a Git index flag/,
  );
  fs.writeFileSync(trackedPath, trackedBytes, "utf8");
  git("update-index", "--no-assume-unchanged", "--", trackedRelativePath);

  git("update-index", "--skip-worktree", "--", trackedRelativePath);
  fs.writeFileSync(trackedPath, "hidden skip-worktree drift\n", "utf8");
  assert.throws(
    () => currentRepositoryState(temporaryRepository),
    /hidden by a Git index flag/,
  );
  fs.writeFileSync(trackedPath, trackedBytes, "utf8");
  git("update-index", "--no-skip-worktree", "--", trackedRelativePath);
});

test("forbids Production, Retell, imports, publication, cleanup, and legacy movement", () => {
  const production = packet();
  production.environment = "Production";
  assert.throws(() => validate(production, approval(production)), /confined to Development/);

  const productionAuthorized = packet();
  productionAuthorized.productionAuthorized = true;
  assert.throws(
    () => validate(productionAuthorized, approval(productionAuthorized)),
    /confined to Development/,
  );

  const missingRetell = packet();
  missingRetell.forbiddenActions = missingRetell.forbiddenActions
    .filter((value) => value !== "Retell");
  assert.throws(
    () => validate(missingRetell, approval(missingRetell)),
    /forbiddenActions is not exact/,
  );
});

test("requires exact target, phase operation order, counts, and payload digests", () => {
  const invalidTarget = packet();
  invalidTarget.target.workspaceId = "workspace-development";
  assert.throws(
    () => validate(invalidTarget, approval(invalidTarget)),
    /target\.workspaceId is invalid/,
  );

  const reordered = packet();
  [reordered.operations[0], reordered.operations[1]] =
    [reordered.operations[1], reordered.operations[0]];
  assert.throws(
    () => validate(reordered, approval(reordered)),
    /exact remaining phase operation/,
  );

  const payloadDrift = packet();
  payloadDrift.operations[0].payloadSha256 = "0".repeat(64);
  assert.throws(
    () => validate(payloadDrift, approval(payloadDrift)),
    /exact remaining phase operation/,
  );
});

test("rejects unknown packet, inventory, operation, prestate, and approval fields", () => {
  const extraPacket = { ...packet(), unexpected: true };
  assert.throws(
    () => validate(extraPacket, approval(extraPacket)),
    /packet fields are not exact/,
  );

  const extraInventory = packet();
  extraInventory.inventory.unverified = true;
  assert.throws(
    () => validate(extraInventory, approval(extraInventory)),
    /inventory fields are not exact/,
  );

  const extraOperation = packet();
  extraOperation.operations[0].unexpected = true;
  assert.throws(
    () => validate(extraOperation, approval(extraOperation)),
    /operations\[0\] fields are not exact/,
  );

  const extraPrestate = packet();
  extraPrestate.prestate.unverified = true;
  assert.throws(
    () => validate(extraPrestate, approval(extraPrestate)),
    /prestate fields are not exact/,
  );

  const value = packet();
  assert.throws(
    () => validate(value, { ...approval(value), unexpected: true }),
    /approval fields are not exact/,
  );
});

test("private packet paths remain outside worktrees and have no hard-link aliases", (t) => {
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

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylvara-analytics-private-path-"));
  t.after(() => fs.rmSync(temporaryRoot, { force: true, recursive: true }));
  const outside = path.join(temporaryRoot, "packet.json");
  fs.writeFileSync(outside, "{}", "utf8");
  assert.equal(assertPrivatePacketPath(outside), fs.realpathSync(outside));

  const hardLinkAlias = path.join(temporaryRoot, "packet-hard-link.json");
  fs.linkSync(outside, hardLinkAlias);
  assert.throws(
    () => assertPrivatePacketPath(outside),
    /must not have hard-link aliases/,
  );
  assert.throws(
    () => assertPrivatePacketPath(hardLinkAlias),
    /must not have hard-link aliases/,
  );
});

test("CLI does not echo malformed private bytes or private paths", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylvara-analytics-cli-"));
  t.after(() => fs.rmSync(temporaryRoot, { force: true, recursive: true }));
  const marker = "PRIVATE_ANALYTICS_MARKER_DO_NOT_ECHO";
  const packetPath = path.join(temporaryRoot, "private-packet.json");
  const approvalPath = path.join(temporaryRoot, "private-approval.json");
  fs.writeFileSync(packetPath, `{"secret":"${marker}"`, "utf8");
  fs.writeFileSync(approvalPath, "{}", "utf8");
  const script = path.resolve(__dirname, "../../../tools/validate-private-analytics-mutation-packet.js");
  const result = spawnSync(process.execPath, [script, packetPath, approvalPath], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private Analytics mutation packet is not valid JSON/);
  assert.doesNotMatch(result.stderr, new RegExp(marker));
  assert.doesNotMatch(result.stderr, new RegExp(packetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(result.stdout, "");
});

test("CLI rejects duplicate packet and approval keys without echoing private bytes", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylvara-analytics-duplicate-json-"));
  t.after(() => fs.rmSync(temporaryRoot, { force: true, recursive: true }));
  const marker = "PRIVATE_DUPLICATE_JSON_MARKER_DO_NOT_ECHO";
  const packetPath = path.join(temporaryRoot, "private-packet.json");
  const approvalPath = path.join(temporaryRoot, "private-approval.json");
  const script = path.resolve(__dirname, "../../../tools/validate-private-analytics-mutation-packet.js");

  fs.writeFileSync(
    packetPath,
    `{"target":{"workspaceId":"${marker}","workspaceId":"303"}}`,
    "utf8",
  );
  fs.writeFileSync(approvalPath, "{}", "utf8");
  const duplicatePacket = spawnSync(process.execPath, [script, packetPath, approvalPath], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.notEqual(duplicatePacket.status, 0);
  assert.match(
    duplicatePacket.stderr,
    /private Analytics mutation packet contains duplicate object keys/,
  );
  assert.doesNotMatch(duplicatePacket.stderr, new RegExp(marker));
  assert.doesNotMatch(
    duplicatePacket.stderr,
    new RegExp(packetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(duplicatePacket.stdout, "");

  fs.writeFileSync(packetPath, "{}", "utf8");
  fs.writeFileSync(
    approvalPath,
    `{"mutationAuthorized":"${marker}","mutationAuthorized":false}`,
    "utf8",
  );
  const duplicateApproval = spawnSync(process.execPath, [script, packetPath, approvalPath], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.notEqual(duplicateApproval.status, 0);
  assert.match(
    duplicateApproval.stderr,
    /private Analytics mutation approval contains duplicate object keys/,
  );
  assert.doesNotMatch(duplicateApproval.stderr, new RegExp(marker));
  assert.doesNotMatch(
    duplicateApproval.stderr,
    new RegExp(approvalPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(duplicateApproval.stdout, "");
});
