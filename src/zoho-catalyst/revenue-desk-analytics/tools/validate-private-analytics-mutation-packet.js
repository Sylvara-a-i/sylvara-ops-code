"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  readContract,
  readDashboardContract,
  renderContract,
} = require("./render-analytics-model-contract");

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../..");
const ANALYTICS_PACKAGE_PATH = "src/zoho-catalyst/revenue-desk-analytics";
const MAX_START_WINDOW_MS = 15 * 60 * 1000;
const MAX_PRIVATE_FILE_BYTES = 1024 * 1024;
const PACKET_DIGEST_DOMAIN = "sylvara.analytics.mutation-packet.v3";
const OPERATION_PAYLOAD_DIGEST_DOMAIN = "sylvara.analytics.operation-payload.v3";
const OPERATION_SET_DIGEST_DOMAIN = "sylvara.analytics.operation-set.v3";
const OPERATION_AUTHORIZATION_DIGEST_DOMAIN =
  "sylvara.analytics.operation-authorization.v1";
const RETURNED_ID_RULES_DIGEST_DOMAIN = "sylvara.analytics.returned-id-rules.v3";
const READBACK_RULES_DIGEST_DOMAIN = "sylvara.analytics.readback-rules.v3";
const CONTAINMENT_RULES_DIGEST_DOMAIN = "sylvara.analytics.containment-rules.v3";

const EXPECTED_CONTRACT_DIGESTS = Object.freeze({
  analyticsModel: "4987603d86ee9b3c6b441fecf734709a283e73ce7f06f3334a37a6008fa93e47",
  dashboard: "3b98fd48f203dc86f8e4bab5a546878ed5f544c28cbdc7004444e52c12941a2c",
  rendered: "b2b48c8cac2ac96b982316c826f06191761a06c07b493dd3f0db53f1e7548dad",
});

const PHASES = Object.freeze({
  assetCreation: "asset_creation",
  dashboardAssembly: "dashboard_assembly",
  folderPlacement: "folder_placement",
});
const AMBIGUITY_STATES = Object.freeze({
  none: "no_prior_ambiguous_operation_attested",
  creationAbsent: "resolved_absent_after_ambiguous_creation",
  creationExisting: "resolved_existing_exact_after_ambiguous_creation",
  placementAtPrior: "resolved_at_prior_after_ambiguous_placement",
  placementAtTarget: "resolved_at_target_after_ambiguous_placement",
});
const OPERATOR_ATTESTATION_BINDING = "approval_bound_operator_attestation";
const PRIOR_OUTCOME_ATTESTATIONS = Object.freeze({
  none: "operator_attests_no_prior_ambiguous_operation",
  resolved: "operator_attests_authoritative_prior_outcome_resolution",
});
const FOLDER_KEYS = Object.freeze(["data_model", "operations", "customer_results"]);
const TABLE_KEYS = Object.freeze([
  "deployment", "call", "daily_metric", "final_test_result", "conversion_status",
]);
const QUERY_KEYS = Object.freeze([
  "deployment_remaining", "value_evidence", "optional_evidence", "freshness",
]);
const REPORT_KEYS = Object.freeze([
  "operations_active_free_tests",
  "operations_connected_calls",
  "operations_qualified_opportunities",
  "operations_calls_remaining",
  "operations_tests_ending_soon",
  "operations_daily_call_outcomes",
  "operations_exception_mix",
  "operations_final_test_results",
  "operations_conversion_readiness",
  "operations_data_freshness",
  "customer_test_period",
  "customer_connected_calls",
  "customer_qualified_opportunities",
  "customer_urgent_requests",
  "customer_daily_results",
  "customer_call_mix",
  "customer_bookable_evidence",
  "customer_office_follow_up",
  "customer_value_evidence",
  "customer_data_freshness",
]);
const DASHBOARD_KEYS = Object.freeze(["operations", "customer"]);
const FORBIDDEN_ACTIONS = Object.freeze([
  "Production",
  "Retell",
  "data imports",
  "sharing",
  "publication",
  "deletion",
  "rename",
  "legacy asset movement",
]);

const TOOLS = Object.freeze({
  createFolder: "mcp__codex_apps__sylvara_analytics_changes_zohoanalytics_createfolder",
  createQueryTable: "mcp__codex_apps__sylvara_analytics_changes_zohoanalytics_createquerytable",
  createReport: "mcp__codex_apps__sylvara_analytics_changes_zohoanalytics_createreport",
  createTable: "mcp__codex_apps__sylvara_analytics_changes_zohoanalytics_createtable",
  dashboardAssembly: "native_analytics_console_dashboard_assembly",
  moveViewsToFolder: "mcp__codex_apps__sylvara_analytics_changes_zohoanalytics_moveviewstofolder",
});

const RETURNED_ID_RULES = Object.freeze({
  schemaVersion: 3,
  rules: Object.freeze([
    "Never trust a create response as the sole identity source.",
    "After every create, perform fresh exact-name Audit inventory and require exactly one target-workspace match of the expected type.",
    "Bind every returned folder or view identifier privately and losslessly; never print, log, or commit it.",
    "After an ambiguous create, do not reclassify the asset as missing until authoritative reconciliation proves the prior outcome; unresolved ambiguity remains blocked.",
    "A fresh post-ambiguity packet binds the prior packet and exact prior operation to the same authoritative evidence as its current prestate.",
    "Dashboard assembly is a separate packet and requires concrete folder and report dependency identifiers before approval.",
    "Folder placement is a separate packet and requires concrete destination, view, dashboard, and immediately prior folder identifiers before approval.",
    "A missing, duplicate, changed, malformed, cross-workspace, or cross-organization identifier stops the packet without retry.",
  ]),
});

const READBACK_RULES = Object.freeze({
  schemaVersion: 3,
  rules: Object.freeze([
    "Every phase requires a complete fresh post/prestate inventory with a validity window no longer than 15 minutes.",
    "Folders require exact name, description, root placement, non-default status, and uniqueness.",
    "Tables require exact name, Table type, organization/workspace binding, ordered columns and types, zero unexpected columns, and zero rows before import.",
    "Query tables require exact SQL, output columns, involved source views, organization/workspace binding, and uniqueness.",
    "Reports require exact connector identity and base dependency plus native-console verification of type, axes, filters, user filters, chart design, and description.",
    "Dashboards require exact title, ten exact concrete report dependencies, locked controls, administrator-only access, and no public link, embed, scheduled export, or direct customer access.",
    "Folder placement uses one canonical view per mutation, binds its exact prior folder, and proves that no legacy view moved.",
    "Any incomplete, truncated, pagination-ambiguous, differently shaped, or conflicting readback stops the packet.",
    "Dashboard and placement phases record an approval-bound operator attestation to the prior phase packet and bind it to their current authoritative evidence instead of accepting a free-standing evidence hash.",
  ]),
});

const CONTAINMENT_RULES = Object.freeze({
  schemaVersion: 3,
  rules: Object.freeze([
    "Keep analytics_sync and its Cron disabled and perform no import during any phase.",
    "Keep every newly created asset unshared, unpublished, and unavailable to non-administrators.",
    "Execute mutations serially in canonical order and independently read back each result before continuing.",
    "The approval is only a single-use declaration; the executor must use the stable operation-authorization ID as a UNIQUE ledger key and store the validator-returned exact-packet consumption digest before the first mutation.",
    "The consumed packet cannot authorize a retry, resume, or any operation omitted from its exact remaining-operation set.",
    "On a partial, interrupted, or mismatched result, stop and obtain a new packet from fresh exact inventory; an ambiguous outcome must first be authoritatively resolved.",
    "Reverse only a folder move whose exact prior folder identifier was captured immediately before the move.",
    "Do not delete, rename, overwrite, repurpose, or move any legacy asset.",
    "New empty assets without an authorized connector rollback remain contained in place pending separate cleanup authority.",
  ]),
});

class AnalyticsMutationPacketValidationError extends Error {
  constructor(message) {
    super(`Analytics mutation packet rejected: ${message}`);
    this.name = "AnalyticsMutationPacketValidationError";
  }
}

function fail(message) {
  throw new AnalyticsMutationPacketValidationError(message);
}

function safeCliErrorMessage(error) {
  return error instanceof AnalyticsMutationPacketValidationError
    ? error.message
    : "Analytics mutation packet rejected: unexpected validation failure";
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!plainObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} fields are not exact`);
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    fail(`${label} is not exact`);
  }
}

function exactOrderedKeys(value, expected, label) {
  if (!plainObject(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(expected)) {
    fail(`${label} order or membership drifted`);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,29}$/.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function revision(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) fail(`${label} is invalid`);
  return value;
}

function packetId(value, label) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
  ) fail(`${label} must be a lowercase UUIDv4`);
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function digestValue(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function digestDomainValue(domain, value) {
  return crypto.createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function digestMutationPacket(packet) {
  return digestDomainValue(PACKET_DIGEST_DOMAIN, packet);
}

function digestOperationSet(operations) {
  return digestDomainValue(OPERATION_SET_DIGEST_DOMAIN, operations);
}

function digestOperationAuthorization(packet) {
  // Approval timestamps are excluded. The executor uses the UUID as its UNIQUE
  // authority key and stores this digest to detect changed packet bytes for it.
  return digestDomainValue(OPERATION_AUTHORIZATION_DIGEST_DOMAIN, {
    operationAuthorizationId: packet.operationAuthorizationId,
    packetSha256: digestMutationPacket(packet),
  });
}

function digestsEqual(left, right) {
  return /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right) &&
    crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
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

function validateStartWindow(capturedAt, expiresAt, label, nowMs) {
  const capturedAtMs = canonicalUtcTimestampMs(capturedAt, `${label}.capturedAt`);
  const expiresAtMs = canonicalUtcTimestampMs(expiresAt, `${label}.expiresAt`);
  if (expiresAtMs <= capturedAtMs || expiresAtMs - capturedAtMs > MAX_START_WINDOW_MS) {
    fail(`${label} validity window must be positive and no longer than 15 minutes`);
  }
  if (capturedAtMs > nowMs) fail(`${label} is not yet valid`);
  if (nowMs >= expiresAtMs) fail(`${label} has expired`);
  return { capturedAtMs, expiresAtMs };
}

function currentContractState() {
  let model;
  let dashboard;
  let rendered;
  try {
    model = readContract();
    dashboard = readDashboardContract();
    rendered = renderContract(model, dashboard);
  } catch {
    fail("repository Analytics contracts could not be rendered");
  }
  const digests = {
    analyticsModel: digestValue(model),
    dashboard: digestValue(dashboard),
    rendered: digestValue(rendered),
  };
  if (Object.keys(EXPECTED_CONTRACT_DIGESTS).some(
    (key) => !digestsEqual(digests[key], EXPECTED_CONTRACT_DIGESTS[key]),
  )) fail("repository Analytics contracts differ from the reviewed mutation boundary");
  return { dashboard, digests: Object.freeze(digests), model, rendered };
}

function expectedRuleDigests() {
  return Object.freeze({
    containment: digestDomainValue(CONTAINMENT_RULES_DIGEST_DOMAIN, CONTAINMENT_RULES),
    readback: digestDomainValue(READBACK_RULES_DIGEST_DOMAIN, READBACK_RULES),
    returnedIds: digestDomainValue(RETURNED_ID_RULES_DIGEST_DOMAIN, RETURNED_ID_RULES),
  });
}

function dashboardFolderKey(rendered, dashboardKey) {
  for (const folderKey of FOLDER_KEYS) {
    if (rendered.folder_placements[folderKey].viewReferences.some(
      (reference) => reference.assetKind === "dashboard" && reference.assetKey === dashboardKey,
    )) return folderKey;
  }
  fail(`dashboard ${dashboardKey} has no canonical folder`);
}

function canonicalDefinitions(contractState = currentContractState()) {
  const { dashboard, rendered } = contractState;
  exactOrderedKeys(rendered.folder_payloads, FOLDER_KEYS, "rendered folder payloads");
  exactOrderedKeys(rendered.table_payloads, TABLE_KEYS, "rendered table payloads");
  exactOrderedKeys(rendered.query_view_payloads, QUERY_KEYS, "rendered query payloads");
  exactOrderedKeys(rendered.report_payloads, REPORT_KEYS, "rendered report payloads");
  exactOrderedKeys(rendered.folder_placements, FOLDER_KEYS, "rendered folder placements");
  if (!Array.isArray(dashboard.dashboards) ||
    JSON.stringify(dashboard.dashboards.map(({ key }) => key)) !== JSON.stringify(DASHBOARD_KEYS)) {
    fail("dashboard operation order drifted");
  }

  const folders = FOLDER_KEYS.map((assetKey) => ({
    action: "create_folder",
    assetKey,
    assetName: rendered.folder_payloads[assetKey].folderName,
    assetType: "folder",
    executionSurface: "connector",
    providerPayload: rendered.folder_payloads[assetKey],
    readbackRule: "folder_exact",
    tool: TOOLS.createFolder,
  }));
  const tables = TABLE_KEYS.map((assetKey) => ({
    action: "create_table",
    assetKey,
    assetName: rendered.table_payloads[assetKey].tableDesign.TABLENAME,
    assetType: "table",
    executionSurface: "connector",
    providerPayload: rendered.table_payloads[assetKey],
    readbackRule: "table_exact_empty",
    tool: TOOLS.createTable,
  }));
  const queries = QUERY_KEYS.map((assetKey) => ({
    action: "create_query_table",
    assetKey,
    assetName: rendered.query_view_payloads[assetKey].queryTableName,
    assetType: "query_table",
    executionSurface: "connector",
    providerPayload: rendered.query_view_payloads[assetKey],
    readbackRule: "query_exact",
    tool: TOOLS.createQueryTable,
  }));
  const reports = REPORT_KEYS.map((assetKey) => ({
    action: "create_report",
    assetKey,
    assetName: rendered.report_payloads[assetKey].title,
    assetType: "report",
    executionSurface: "connector",
    providerPayload: rendered.report_payloads[assetKey],
    readbackRule: "report_connector_identity_and_browser_design",
    tool: TOOLS.createReport,
  }));
  const dashboards = DASHBOARD_KEYS.map((assetKey) => {
    const providerPayload = dashboard.dashboards.find((candidate) => candidate.key === assetKey);
    return {
      action: "assemble_dashboard",
      assetKey,
      assetName: providerPayload.title,
      assetType: "dashboard",
      executionSurface: "browser_fallback_required",
      folderKey: dashboardFolderKey(rendered, assetKey),
      providerPayload,
      readbackRule: "dashboard_browser_design_and_connector_identity",
      reportKeys: providerPayload.widgets.map(({ report_key: reportKey }) => reportKey),
      tool: TOOLS.dashboardAssembly,
    };
  });
  const placements = [];
  for (const folderKey of FOLDER_KEYS) {
    for (const reference of rendered.folder_placements[folderKey].viewReferences) {
      placements.push({
        assetKey: reference.assetKey,
        assetName: reference.viewName,
        assetType: reference.assetKind === "query_view" ? "query_table" : reference.assetKind,
        folderKey,
      });
    }
  }
  if (placements.length !== 31 || new Set(placements.map(({ assetKey }) => assetKey)).size !== 31) {
    fail("canonical placement inventory drifted");
  }
  return Object.freeze({
    creation: Object.freeze([...folders, ...tables, ...queries, ...reports]),
    dashboards: Object.freeze(dashboards),
    folders: Object.freeze(folders),
    placements: Object.freeze(placements),
    reports: Object.freeze(reports),
  });
}

function validateTarget(target) {
  exactKeys(target, ["organizationId", "workspaceId"], "target");
  identifier(target.organizationId, "target.organizationId");
  identifier(target.workspaceId, "target.workspaceId");
}

function validateContractDigests(value, expected) {
  exactKeys(value, ["analyticsModel", "dashboard", "rendered"], "contractDigests");
  for (const key of Object.keys(expected)) {
    if (!digestsEqual(sha256(value[key], `contractDigests.${key}`), expected[key])) {
      fail(`contractDigests.${key} does not match the reviewed contract`);
    }
  }
}

function validateRuleDigests(value) {
  exactKeys(value, ["containment", "readback", "returnedIds"], "ruleDigests");
  const expected = expectedRuleDigests();
  for (const key of Object.keys(expected)) {
    if (!digestsEqual(sha256(value[key], `ruleDigests.${key}`), expected[key])) {
      fail(`ruleDigests.${key} does not match the reviewed rules`);
    }
  }
}

function reserveAssetIdentifier(registry, value, label) {
  identifier(value, label);
  if (registry.has(value)) fail(`${label} contains a duplicate identifier across the phase`);
  registry.add(value);
}

function validateBindingList(value, definitions, label, assetIds = new Set()) {
  if (!Array.isArray(value) || value.length !== definitions.length) {
    fail(`${label} must contain every exact canonical binding`);
  }
  for (let index = 0; index < definitions.length; index += 1) {
    const entry = value[index];
    const definition = definitions[index];
    exactKeys(entry, ["assetId", "assetKey", "assetName", "assetType", "readbackSha256"],
      `${label}[${index}]`);
    if (
      entry.assetKey !== definition.assetKey ||
      entry.assetName !== definition.assetName ||
      entry.assetType !== definition.assetType
    ) fail(`${label}[${index}] identity is not exact`);
    reserveAssetIdentifier(assetIds, entry.assetId, `${label}[${index}].assetId`);
    sha256(entry.readbackSha256, `${label}[${index}].readbackSha256`);
  }
  return new Map(value.map((entry) => [entry.assetKey, entry]));
}

function validateExistingMissingList(value, definitions, label, assetIds = new Set()) {
  if (!Array.isArray(value) || value.length !== definitions.length) {
    fail(`${label} must contain every exact canonical asset`);
  }
  let existingCount = 0;
  for (let index = 0; index < definitions.length; index += 1) {
    const entry = value[index];
    const definition = definitions[index];
    exactKeys(entry, [
      "assetId", "assetKey", "assetName", "assetType", "readbackSha256", "state",
    ], `${label}[${index}]`);
    if (
      entry.assetKey !== definition.assetKey ||
      entry.assetName !== definition.assetName ||
      entry.assetType !== definition.assetType
    ) fail(`${label}[${index}] identity is not exact`);
    if (entry.state === "missing") {
      if (entry.assetId !== null || entry.readbackSha256 !== null) {
        fail(`${label}[${index}] missing state must have null evidence bindings`);
      }
    } else if (entry.state === "existing") {
      reserveAssetIdentifier(assetIds, entry.assetId, `${label}[${index}].assetId`);
      sha256(entry.readbackSha256, `${label}[${index}].readbackSha256`);
      existingCount += 1;
    } else {
      fail(`${label}[${index}].state is invalid`);
    }
  }
  return { existingCount, missingCount: definitions.length - existingCount };
}

function operation(ordinal, definition, phase, payload) {
  return Object.freeze({
    action: definition.action,
    assetKey: definition.assetKey,
    assetName: definition.assetName,
    assetType: definition.assetType,
    executionSurface: definition.executionSurface,
    ordinal,
    payloadSha256: digestDomainValue(OPERATION_PAYLOAD_DIGEST_DOMAIN, {
      action: definition.action,
      assetKey: definition.assetKey,
      payload,
      phase,
    }),
    readbackRule: definition.readbackRule,
    tool: definition.tool,
  });
}

function assetCreationPayload(definition, target) {
  return { providerPayload: definition.providerPayload, target };
}

function dashboardAssemblyPayload(definition, target, folders, reports) {
  return {
    dashboardContract: definition.providerPayload,
    intendedFolder: {
      assetId: folders.get(definition.folderKey).assetId,
      assetKey: definition.folderKey,
    },
    reportDependencies: definition.reportKeys.map((assetKey) => ({
      assetId: reports.get(assetKey).assetId,
      assetKey,
    })),
    target,
  };
}

function folderPlacementPayload(entry, target, priorFolderId = entry.currentFolderId) {
  return {
    priorFolderId,
    target,
    targetFolderId: entry.targetFolderId,
    viewId: entry.assetId,
  };
}

function folderPlacementDefinition(entry) {
  return {
    action: "move_view_to_folder",
    assetKey: entry.assetKey,
    assetName: entry.assetName,
    assetType: "folder_placement",
    executionSurface: "connector",
    readbackRule: "single_view_placement_exact_no_legacy",
    tool: TOOLS.moveViewsToFolder,
  };
}

function deriveAssetCreationState(target, inventory, definitions) {
  exactKeys(inventory, ["assets", "inventoryKind"], "inventory");
  if (inventory.inventoryKind !== "fresh_existing_missing_inventory") {
    fail("asset_creation inventory kind is not exact");
  }
  const counts = validateExistingMissingList(inventory.assets, definitions.creation, "inventory.assets");
  const missing = definitions.creation.filter((definition, index) =>
    inventory.assets[index].state === "missing");
  const operations = missing.map((definition, index) => operation(
    index + 1,
    definition,
    PHASES.assetCreation,
    assetCreationPayload(definition, target),
  ));
  const existingFolderCount = inventory.assets.slice(0, FOLDER_KEYS.length)
    .filter(({ state }) => state === "existing").length;
  return {
    counts: {
      canonicalFolderCount: existingFolderCount,
      canonicalViewCount: counts.existingCount - existingFolderCount,
      targetFolderCount: 6 + existingFolderCount,
      targetRootFolderCount: 6 + existingFolderCount,
      targetViewCount: 30 + counts.existingCount - existingFolderCount,
    },
    operations,
    resolutionEntries: new Map(definitions.creation.map((definition, index) => [
      definition.assetKey,
      {
        action: definition.action,
        currentState: inventory.assets[index].state,
        definition,
        payloadSha256: operation(
          1,
          definition,
          PHASES.assetCreation,
          assetCreationPayload(definition, target),
        ).payloadSha256,
      },
    ])),
  };
}

function deriveDashboardAssemblyState(target, inventory, definitions) {
  exactKeys(inventory, ["dashboards", "folders", "inventoryKind", "reports"], "inventory");
  if (inventory.inventoryKind !== "fresh_post_asset_creation_inventory") {
    fail("dashboard_assembly inventory kind is not exact");
  }
  const assetIds = new Set();
  const folders = validateBindingList(
    inventory.folders, definitions.folders, "inventory.folders", assetIds,
  );
  const reports = validateBindingList(
    inventory.reports, definitions.reports, "inventory.reports", assetIds,
  );
  const dashboardCounts = validateExistingMissingList(
    inventory.dashboards, definitions.dashboards, "inventory.dashboards", assetIds,
  );
  const missing = definitions.dashboards.filter((definition, index) =>
    inventory.dashboards[index].state === "missing");
  const operations = missing.map((definition, index) => operation(
    index + 1,
    definition,
    PHASES.dashboardAssembly,
    dashboardAssemblyPayload(definition, target, folders, reports),
  ));
  return {
    counts: {
      canonicalFolderCount: 3,
      canonicalViewCount: 29 + dashboardCounts.existingCount,
      targetFolderCount: 9,
      targetRootFolderCount: 9,
      targetViewCount: 59 + dashboardCounts.existingCount,
    },
    operations,
    resolutionEntries: new Map(definitions.dashboards.map((definition, index) => [
      definition.assetKey,
      {
        action: definition.action,
        currentState: inventory.dashboards[index].state,
        definition,
        payloadSha256: operation(
          1,
          definition,
          PHASES.dashboardAssembly,
          dashboardAssemblyPayload(definition, target, folders, reports),
        ).payloadSha256,
      },
    ])),
  };
}

function deriveFolderPlacementState(target, inventory, definitions) {
  exactKeys(inventory, ["folders", "inventoryKind", "views"], "inventory");
  if (inventory.inventoryKind !== "fresh_post_dashboard_assembly_inventory") {
    fail("folder_placement inventory kind is not exact");
  }
  const assetIds = new Set();
  const folders = validateBindingList(
    inventory.folders, definitions.folders, "inventory.folders", assetIds,
  );
  const canonicalFolderIds = new Set(inventory.folders.map(({ assetId }) => assetId));
  if (!Array.isArray(inventory.views) || inventory.views.length !== definitions.placements.length) {
    fail("inventory.views must contain all 31 canonical views");
  }
  const operations = [];
  for (let index = 0; index < definitions.placements.length; index += 1) {
    const entry = inventory.views[index];
    const definition = definitions.placements[index];
    exactKeys(entry, [
      "assetId", "assetKey", "assetName", "assetType", "currentFolderId",
      "readbackSha256", "targetFolderId",
    ], `inventory.views[${index}]`);
    if (
      entry.assetKey !== definition.assetKey ||
      entry.assetName !== definition.assetName ||
      entry.assetType !== definition.assetType
    ) fail(`inventory.views[${index}] identity is not exact`);
    reserveAssetIdentifier(assetIds, entry.assetId, `inventory.views[${index}].assetId`);
    identifier(entry.currentFolderId, `inventory.views[${index}].currentFolderId`);
    identifier(entry.targetFolderId, `inventory.views[${index}].targetFolderId`);
    sha256(entry.readbackSha256, `inventory.views[${index}].readbackSha256`);
    if (entry.targetFolderId !== folders.get(definition.folderKey).assetId) {
      fail(`inventory.views[${index}] target folder binding is not exact`);
    }
    if (entry.currentFolderId !== entry.targetFolderId) {
      operations.push(operation(
        operations.length + 1,
        folderPlacementDefinition(entry),
        PHASES.folderPlacement,
        folderPlacementPayload(entry, target),
      ));
    }
  }
  for (let index = 0; index < inventory.views.length; index += 1) {
    const { currentFolderId } = inventory.views[index];
    if (assetIds.has(currentFolderId) && !canonicalFolderIds.has(currentFolderId)) {
      fail(`inventory.views[${index}].currentFolderId collides with a phase view identifier`);
    }
  }
  return {
    counts: {
      canonicalFolderCount: 3,
      canonicalViewCount: 31,
      targetFolderCount: 9,
      targetRootFolderCount: 9,
      targetViewCount: 61,
    },
    operations,
    resolutionEntries: new Map(inventory.views.map((entry) => [entry.assetKey, {
      action: "move_view_to_folder",
      currentFolderId: entry.currentFolderId,
      entry,
      targetFolderId: entry.targetFolderId,
    }])),
  };
}

function derivePhaseState(phase, target, inventory, contractState = currentContractState()) {
  validateTarget(target);
  const definitions = canonicalDefinitions(contractState);
  if (phase === PHASES.assetCreation) {
    return deriveAssetCreationState(target, inventory, definitions);
  }
  if (phase === PHASES.dashboardAssembly) {
    return deriveDashboardAssemblyState(target, inventory, definitions);
  }
  if (phase === PHASES.folderPlacement) {
    return deriveFolderPlacementState(target, inventory, definitions);
  }
  fail("packet.phase is invalid");
}

function expectedPhaseOperations(phase, target, inventory, contractState = currentContractState()) {
  return Object.freeze(derivePhaseState(phase, target, inventory, contractState).operations);
}

function validatePrestate(prestate, phaseState, nowMs) {
  exactKeys(prestate, [
    "canonicalFolderCount", "canonicalViewCount", "capturedAt", "defaultFolderCount",
    "duplicateFolderNameCount", "duplicateViewNameCount", "expiresAt", "legacyRowCounts",
    "organizationCount", "ownedWorkspaceCount", "paginationComplete", "privateEvidenceSha256",
    "sharedWorkspaceCount", "targetBindingMethod", "targetFolderCount", "targetRootFolderCount",
    "targetSubfolderCount", "targetViewCount",
  ], "prestate");
  const window = validateStartWindow(prestate.capturedAt, prestate.expiresAt, "prestate", nowMs);
  sha256(prestate.privateEvidenceSha256, "prestate.privateEvidenceSha256");
  exactKeys(prestate.legacyRowCounts, ["Dim_Client", "Fact_Calls", "Fact_Client_Daily"],
    "prestate.legacyRowCounts");
  const expectedScalars = {
    ...phaseState.counts,
    defaultFolderCount: 1,
    duplicateFolderNameCount: 0,
    duplicateViewNameCount: 0,
    organizationCount: 1,
    ownedWorkspaceCount: 2,
    sharedWorkspaceCount: 0,
    targetSubfolderCount: 0,
  };
  for (const [key, expected] of Object.entries(expectedScalars)) {
    if (prestate[key] !== expected) fail(`prestate.${key} differs from the fresh phase inventory`);
  }
  const expectedLegacyRows = { Dim_Client: 2, Fact_Calls: 13, Fact_Client_Daily: 10 };
  if (canonicalJson(prestate.legacyRowCounts) !== canonicalJson(expectedLegacyRows)) {
    fail("prestate legacy row signature differs from the approved prestate");
  }
  if (prestate.paginationComplete !== true) fail("prestate pagination is not complete");
  if (prestate.targetBindingMethod !==
    "single-development-labelled-owned-workspace-and-row-bearing-legacy-signature") {
    fail("prestate target binding method is not exact");
  }
  return window;
}

function validatePhaseLineage(lineage, packet) {
  if (packet.phase === PHASES.assetCreation) {
    if (lineage !== null) fail("asset_creation must not claim a prior phase lineage");
    return;
  }
  exactKeys(lineage, [
    "authoritativeEvidenceSha256", "bindingKind", "sourceOperationAuthorizationId",
    "sourcePacketSha256", "sourcePhase",
  ], "phaseLineage");
  if (lineage.bindingKind !== OPERATOR_ATTESTATION_BINDING) {
    fail("phaseLineage is not an approval-bound operator attestation");
  }
  const expectedSourcePhase = packet.phase === PHASES.dashboardAssembly
    ? PHASES.assetCreation
    : PHASES.dashboardAssembly;
  if (lineage.sourcePhase !== expectedSourcePhase) {
    fail("phaseLineage source phase is not the exact prior phase");
  }
  packetId(
    lineage.sourceOperationAuthorizationId,
    "phaseLineage.sourceOperationAuthorizationId",
  );
  if (lineage.sourceOperationAuthorizationId === packet.operationAuthorizationId) {
    fail("phaseLineage must reference a prior operation authorization");
  }
  sha256(lineage.sourcePacketSha256, "phaseLineage.sourcePacketSha256");
  sha256(lineage.authoritativeEvidenceSha256, "phaseLineage.authoritativeEvidenceSha256");
  if (!digestsEqual(
    lineage.authoritativeEvidenceSha256,
    packet.prestate.privateEvidenceSha256,
  )) fail("phaseLineage is not bound to the current authoritative prestate evidence");
  if (digestsEqual(lineage.sourcePacketSha256, digestMutationPacket(packet))) {
    fail("phaseLineage cannot reference the current packet");
  }
}

function validateAmbiguityResolution(value, packet, phaseState) {
  exactKeys(value, [
    "authoritativeEvidenceSha256", "bindingKind", "priorOperation",
    "priorOperationAuthorizationId", "priorPacketSha256", "state",
  ], "ambiguityResolution");
  if (value.bindingKind !== OPERATOR_ATTESTATION_BINDING) {
    fail("ambiguityResolution is not an approval-bound operator attestation");
  }
  if (value.state === AMBIGUITY_STATES.none) {
    if (
      value.authoritativeEvidenceSha256 !== null ||
      value.priorOperation !== null ||
      value.priorOperationAuthorizationId !== null ||
      value.priorPacketSha256 !== null
    ) fail("no-prior-ambiguity attestation must not carry prior outcome bindings");
    return;
  }
  if (!Object.values(AMBIGUITY_STATES).includes(value.state)) {
    fail("ambiguityResolution state is invalid");
  }
  sha256(value.authoritativeEvidenceSha256,
    "ambiguityResolution.authoritativeEvidenceSha256");
  packetId(
    value.priorOperationAuthorizationId,
    "ambiguityResolution.priorOperationAuthorizationId",
  );
  if (value.priorOperationAuthorizationId === packet.operationAuthorizationId) {
    fail("ambiguityResolution requires a new operation authorization");
  }
  sha256(value.priorPacketSha256, "ambiguityResolution.priorPacketSha256");
  if (!digestsEqual(
    value.authoritativeEvidenceSha256,
    packet.prestate.privateEvidenceSha256,
  )) fail("ambiguityResolution is not bound to the current authoritative prestate evidence");
  if (digestsEqual(value.priorPacketSha256, digestMutationPacket(packet))) {
    fail("ambiguityResolution must reference a different prior packet");
  }
  exactKeys(value.priorOperation, [
    "action", "assetKey", "payloadSha256", "priorFolderId",
  ], "ambiguityResolution.priorOperation");
  sha256(value.priorOperation.payloadSha256,
    "ambiguityResolution.priorOperation.payloadSha256");
  const entry = phaseState.resolutionEntries.get(value.priorOperation.assetKey);
  if (!entry || value.priorOperation.action !== entry.action) {
    fail("ambiguityResolution prior operation is not part of this exact phase");
  }

  if (packet.phase === PHASES.folderPlacement) {
    if (![AMBIGUITY_STATES.placementAtPrior, AMBIGUITY_STATES.placementAtTarget]
      .includes(value.state)) {
      fail("folder_placement ambiguityResolution state is invalid");
    }
    identifier(value.priorOperation.priorFolderId,
      "ambiguityResolution.priorOperation.priorFolderId");
    if (value.priorOperation.priorFolderId === entry.targetFolderId) {
      fail("ambiguous placement prior folder must differ from its target folder");
    }
    const expectedPayloadSha256 = operation(
      1,
      folderPlacementDefinition(entry.entry),
      PHASES.folderPlacement,
      folderPlacementPayload(entry.entry, packet.target, value.priorOperation.priorFolderId),
    ).payloadSha256;
    if (!digestsEqual(value.priorOperation.payloadSha256, expectedPayloadSha256)) {
      fail("ambiguityResolution does not bind the exact prior placement operation");
    }
    if (
      value.state === AMBIGUITY_STATES.placementAtPrior &&
      entry.currentFolderId !== value.priorOperation.priorFolderId
    ) fail("authoritative placement readback does not prove the view remains at its prior folder");
    if (
      value.state === AMBIGUITY_STATES.placementAtTarget &&
      entry.currentFolderId !== entry.targetFolderId
    ) fail("authoritative placement readback does not prove the view reached its target folder");
    return;
  }

  if (![PHASES.assetCreation, PHASES.dashboardAssembly].includes(packet.phase)) {
    fail("creation ambiguityResolution phase is invalid");
  }
  if (![AMBIGUITY_STATES.creationAbsent, AMBIGUITY_STATES.creationExisting]
    .includes(value.state)) {
    fail("creation ambiguityResolution state is invalid");
  }
  if (value.priorOperation.priorFolderId !== null) {
    fail("creation ambiguityResolution must not carry a prior folder");
  }
  if (!digestsEqual(value.priorOperation.payloadSha256, entry.payloadSha256)) {
    fail("ambiguityResolution does not bind the exact prior creation operation");
  }
  const expectedState = value.state === AMBIGUITY_STATES.creationAbsent
    ? "missing"
    : "existing";
  if (entry.currentState !== expectedState) {
    fail("authoritative creation readback does not match the declared resolution");
  }
}

function validateOperations(value, expected) {
  if (!Array.isArray(value) || value.length === 0 || value.length !== expected.length) {
    fail("operations must contain exactly the non-complete operations from fresh inventory");
  }
  const keys = [
    "action", "assetKey", "assetName", "assetType", "executionSurface", "ordinal",
    "payloadSha256", "readbackRule", "tool",
  ];
  for (let index = 0; index < expected.length; index += 1) {
    exactKeys(value[index], keys, `operations[${index}]`);
    sha256(value[index].payloadSha256, `operations[${index}].payloadSha256`);
    if (canonicalJson(value[index]) !== canonicalJson(expected[index])) {
      fail(`operations[${index}] differs from the exact remaining phase operation`);
    }
  }
}

function validateRepositoryState(packet, repositoryState) {
  exactKeys(repositoryState, ["headRevision", "packageClean"], "repositoryState");
  revision(repositoryState.headRevision, "repositoryState.headRevision");
  if (repositoryState.packageClean !== true) fail("Analytics package is not clean");
  if (packet.approvedSourceRevision !== repositoryState.headRevision) {
    fail("approved source revision is not the current committed revision");
  }
}

function validateApproval(approval, packet, prestateWindow, nowMs) {
  exactKeys(approval, [
    "approvedSourceRevision", "authorizedOperationCount", "browserFallbackAuthorized",
    "capturedAt", "consumptionSha256", "declarativeSingleUse",
    "durableConsumptionRequired", "expiresAt", "mutationAuthorized",
    "operationAuthorizationId", "operationSetSha256", "packetSha256", "phase",
    "prestateEvidenceSha256", "priorOutcomeAttestation", "retryAuthorized", "schemaVersion",
    "targetOrganizationId", "targetWorkspaceId",
  ], "approval");
  if (approval.schemaVersion !== 3) fail("approval.schemaVersion must be 3");
  const approvalWindow = validateStartWindow(
    approval.capturedAt, approval.expiresAt, "approval", nowMs,
  );
  if (
    approvalWindow.capturedAtMs < prestateWindow.capturedAtMs ||
    approvalWindow.expiresAtMs > prestateWindow.expiresAtMs
  ) fail("approval window is outside the fresh prestate window");
  const browserExpected = packet.phase === PHASES.dashboardAssembly;
  const priorOutcomeAttestationExpected =
    packet.ambiguityResolution.state === AMBIGUITY_STATES.none
      ? PRIOR_OUTCOME_ATTESTATIONS.none
      : PRIOR_OUTCOME_ATTESTATIONS.resolved;
  if (
    approval.mutationAuthorized !== true ||
    approval.declarativeSingleUse !== true ||
    approval.durableConsumptionRequired !== true ||
    approval.retryAuthorized !== false ||
    approval.browserFallbackAuthorized !== browserExpected ||
    approval.authorizedOperationCount !== packet.operations.length ||
    approval.operationAuthorizationId !== packet.operationAuthorizationId ||
    approval.phase !== packet.phase ||
    approval.targetOrganizationId !== packet.target.organizationId ||
    approval.targetWorkspaceId !== packet.target.workspaceId ||
    approval.approvedSourceRevision !== packet.approvedSourceRevision ||
    approval.prestateEvidenceSha256 !== packet.prestate.privateEvidenceSha256 ||
    approval.priorOutcomeAttestation !== priorOutcomeAttestationExpected ||
    !digestsEqual(
      sha256(approval.operationSetSha256, "approval.operationSetSha256"),
      digestOperationSet(packet.operations),
    ) ||
    !digestsEqual(
      sha256(approval.packetSha256, "approval.packetSha256"),
      digestMutationPacket(packet),
    ) ||
    !digestsEqual(
      sha256(approval.consumptionSha256, "approval.consumptionSha256"),
      digestOperationAuthorization(packet),
    )
  ) fail("approval does not bind the exact private Development Analytics phase packet");
}

function validateMutationPacket(packet, approval, nowMs = Date.now(), repositoryState = null) {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) fail("validation time is invalid");
  exactKeys(packet, [
    "ambiguityResolution", "approvedSourceRevision", "contractDigests", "environment",
    "forbiddenActions", "inventory", "operationAuthorizationId", "operations", "phase",
    "phaseLineage", "prestate", "productionAuthorized", "retryAuthorized", "ruleDigests",
    "schemaVersion", "target",
  ], "packet");
  if (packet.schemaVersion !== 3) fail("packet.schemaVersion must be 3");
  if (packet.environment !== "Development" || packet.productionAuthorized !== false) {
    fail("packet is not confined to Development");
  }
  if (packet.retryAuthorized !== false) fail("packet must not authorize retry or resume");
  packetId(packet.operationAuthorizationId, "packet.operationAuthorizationId");
  revision(packet.approvedSourceRevision, "packet.approvedSourceRevision");
  exactArray(packet.forbiddenActions, FORBIDDEN_ACTIONS, "forbiddenActions");
  validateTarget(packet.target);
  const contractState = currentContractState();
  validateContractDigests(packet.contractDigests, contractState.digests);
  validateRuleDigests(packet.ruleDigests);
  const phaseState = derivePhaseState(packet.phase, packet.target, packet.inventory, contractState);
  const prestateWindow = validatePrestate(packet.prestate, phaseState, nowMs);
  validatePhaseLineage(packet.phaseLineage, packet);
  validateAmbiguityResolution(packet.ambiguityResolution, packet, phaseState);
  validateOperations(packet.operations, phaseState.operations);
  validateRepositoryState(packet, repositoryState || currentRepositoryState());
  validateApproval(approval, packet, prestateWindow, nowMs);
  const browserOperationCount = packet.phase === PHASES.dashboardAssembly
    ? packet.operations.length
    : 0;
  return Object.freeze({
    browserOperationCount,
    connectorOperationCount: packet.operations.length - browserOperationCount,
    consumptionDigest: digestOperationAuthorization(packet),
    digest: digestMutationPacket(packet),
    operationAuthorizationId: packet.operationAuthorizationId,
    operationCount: packet.operations.length,
    operationSetDigest: digestOperationSet(packet.operations),
    phase: packet.phase,
    schemaVersion: packet.schemaVersion,
  });
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

function currentRepositoryState(repositoryRoot = REPOSITORY_ROOT) {
  let headRevision;
  let indexFlags;
  let status;
  let resolvedRepositoryRoot;
  try {
    if (typeof repositoryRoot !== "string" || !path.isAbsolute(repositoryRoot)) {
      throw new TypeError("repository root must be absolute");
    }
    resolvedRepositoryRoot = fs.realpathSync(repositoryRoot);
    const gitOptions = {
      encoding: "utf8",
      env: gitSubprocessEnvironment(),
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    };
    headRevision = execFileSync(
      "git",
      [
        "-c", `safe.directory=${resolvedRepositoryRoot}`,
        "--no-optional-locks", "-C", resolvedRepositoryRoot,
        "rev-parse", "--verify", "HEAD",
      ],
      gitOptions,
    ).trim();
    status = execFileSync(
      "git",
      [
        "-c", `safe.directory=${resolvedRepositoryRoot}`,
        "--no-optional-locks", "-C", resolvedRepositoryRoot,
        "status", "--porcelain=v1", "--untracked-files=all", "--",
        ANALYTICS_PACKAGE_PATH,
      ],
      gitOptions,
    );
    indexFlags = execFileSync(
      "git",
      [
        "-c", `safe.directory=${resolvedRepositoryRoot}`,
        "--no-optional-locks", "-C", resolvedRepositoryRoot,
        "ls-files", "-v", "--", ANALYTICS_PACKAGE_PATH,
      ],
      gitOptions,
    );
  } catch {
    fail("current committed Analytics package state is unavailable");
  }
  revision(headRevision, "current repository revision");
  if (status.trim() !== "") fail("Analytics package is not clean");
  if (indexFlags.split(/\r?\n/).some((line) => /^[a-zS]\s/.test(line))) {
    fail("Analytics package contains a tracked file hidden by a Git index flag");
  }
  return Object.freeze({ headRevision, packageClean: true });
}

function repositoryWorktreeRoots() {
  let output;
  try {
    output = execFileSync(
      "git",
      [
        "-c", `safe.directory=${REPOSITORY_ROOT}`,
        "--no-optional-locks", "-C", REPOSITORY_ROOT,
        "worktree", "list", "--porcelain", "-z",
      ],
      {
        encoding: "utf8",
        env: gitSubprocessEnvironment(),
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
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
      // A prunable missing worktree cannot contain an existing private packet path.
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
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    fail("packet file metadata is unavailable");
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PRIVATE_FILE_BYTES) {
    fail("packet file size or type is invalid");
  }
  // A path outside Git can still alias bytes inside a public worktree via a hard
  // link. Requiring one physical link keeps the path check meaningful.
  if (stat.nlink !== 1) fail("packet file must not have hard-link aliases");
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
    // JSON.parse silently applies last-key-wins semantics. Scan first so a human
    // approval can never be interpreted differently from the validated packet.
    rejectDuplicateJsonObjectKeys(raw);
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof DuplicateJsonObjectKeyError) {
      fail(`${label} contains duplicate object keys`);
    }
    // Parser diagnostics can quote private bytes, so emit only the fixed label.
    fail(`${label} is not valid JSON`);
  }
}

function run(argv, nowMs = Date.now()) {
  if (!Array.isArray(argv) || argv.length !== 2) {
    fail("expected absolute private packet and approval paths");
  }
  const packetPath = assertPrivatePacketPath(argv[0]);
  const approvalPath = assertPrivatePacketPath(argv[1]);
  if (packetPath === approvalPath) fail("packet and approval files must be distinct");
  const packet = readPrivateJson(packetPath, "private Analytics mutation packet");
  const approval = readPrivateJson(approvalPath, "private Analytics mutation approval");
  const result = validateMutationPacket(packet, approval, nowMs, currentRepositoryState());
  process.stdout.write(
    `Analytics mutation packet valid: schema=${result.schemaVersion} phase=${result.phase} ` +
    `operations=${result.operationCount} connector=${result.connectorOperationCount} ` +
    `browser=${result.browserOperationCount} sha256=${result.digest} ` +
    `consumptionSha256=${result.consumptionDigest}\n`,
  );
  return result;
}

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${safeCliErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  AMBIGUITY_STATES,
  CONTAINMENT_RULES,
  EXPECTED_CONTRACT_DIGESTS,
  FORBIDDEN_ACTIONS,
  PHASES,
  READBACK_RULES,
  REPOSITORY_ROOT,
  RETURNED_ID_RULES,
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
  run,
  validateMutationPacket,
  validateRepositoryState,
};
