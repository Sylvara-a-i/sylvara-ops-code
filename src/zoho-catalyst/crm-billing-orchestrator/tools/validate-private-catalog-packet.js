"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../..");
const TIERS = Object.freeze({
  Launch: Object.freeze({ name: "Launch — Monthly" }),
  Growth: Object.freeze({ name: "Growth — Monthly" }),
  Scale: Object.freeze({ name: "Scale — Monthly" }),
});
const MAX_APPROVAL_WINDOW_MS = 15 * 60 * 1000;
const MAX_METERED_ATTESTATION_AGE_MS = 15 * 60 * 1000;
const METERED_ATTESTATION_DIGEST_DOMAIN = "sylvara.billing.metered-attestation.v1";

class CatalogPacketValidationError extends Error {
  constructor(message) {
    super(`Billing catalog packet rejected: ${message}`);
    this.name = "CatalogPacketValidationError";
  }
}

function fail(message) {
  throw new CatalogPacketValidationError(message);
}

function safeCliErrorMessage(error) {
  return error instanceof CatalogPacketValidationError
    ? error.message
    : "Billing catalog packet rejected: unexpected validation failure";
}

function readPrivateJson(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    fail(`${label} could not be read`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    // JSON parser diagnostics can quote private packet excerpts. Emit only a fixed label.
    fail(`${label} is not valid JSON`);
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!plainObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} fields are not exact`);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,29}$/.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function code(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{3,100}$/.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function positiveMinorUnits(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} is invalid`);
  return value;
}

function exactOrganization(value, expected, label) {
  exactKeys(value, ["currency", "id", "mode", "orgType", "subscriptionsOnly"], label);
  identifier(value.id, `${label}.id`);
  if (value.mode !== expected.mode || value.orgType !== expected.orgType) {
    fail(`${label} environment is not exact`);
  }
  if (value.currency !== "USD" || value.subscriptionsOnly !== expected.subscriptionsOnly) {
    fail(`${label} ownership is not exact`);
  }
}

function validatePlan(value, tier) {
  const expected = TIERS[tier];
  exactKeys(value, [
    "code", "currency", "interval", "intervalUnit", "name", "recurringPriceMinor",
    "setupFeeMinor", "trialPeriod",
  ], `plans.${tier}`);
  code(value.code, `plans.${tier}.code`);
  if (
    value.name !== expected.name ||
    value.currency !== "USD" ||
    value.interval !== 1 ||
    value.intervalUnit !== "months" ||
    value.trialPeriod !== 0
  ) fail(`plans.${tier} commercial terms drifted`);
  positiveMinorUnits(value.recurringPriceMinor, `plans.${tier}.recurringPriceMinor`);
  positiveMinorUnits(value.setupFeeMinor, `plans.${tier}.setupFeeMinor`);
}

function validateUsageAddon(value, phase, product) {
  exactKeys(value, [
    "associatedPlanTiers", "code", "currency", "interval", "intervalUnit", "liveProductId",
    "isUsageSupported", "name", "priceBrackets", "pricingScheme", "testProductId", "type", "unit",
  ], "usageAddon");
  code(value.code, "usageAddon.code");
  if (
    value.name !== "Connected AI Minutes — Usage" ||
    value.type !== "recurring" ||
    value.isUsageSupported !== true ||
    value.pricingScheme !== "unit" ||
    value.unit !== "minute" ||
    value.currency !== "USD" ||
    value.interval !== 1 ||
    value.intervalUnit !== "months"
  ) fail("usageAddon contract drifted");
  if (JSON.stringify(value.associatedPlanTiers) !== JSON.stringify(Object.keys(TIERS))) {
    fail("usageAddon must be associated with all three tiers in canonical order");
  }
  if (
    !Array.isArray(value.priceBrackets) ||
    value.priceBrackets.length !== 1 ||
    !plainObject(value.priceBrackets[0])
  ) fail("usageAddon must contain one price bracket");
  exactKeys(value.priceBrackets[0], ["priceMinor", "startQuantity"], "usageAddon.priceBrackets[0]");
  if (value.priceBrackets[0].startQuantity !== 1) {
    fail("usageAddon price bracket drifted");
  }
  positiveMinorUnits(value.priceBrackets[0].priceMinor, "usageAddon.priceBrackets[0].priceMinor");
  if (identifier(value.liveProductId, "usageAddon.liveProductId") !== product.liveProductId) {
    fail("usageAddon live product binding differs");
  }
  if (phase === "definition") {
    if (value.testProductId !== null) fail("definition phase cannot preclaim a TEST product ID");
  } else if (
    identifier(value.testProductId, "usageAddon.testProductId") !== product.testProductId
  ) fail("usageAddon TEST product binding differs");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function digestCatalogPacket(packet) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(packet)), "utf8").digest("hex");
}

function digestMeteredBillingAttestation(attestation) {
  return crypto.createHash("sha256")
    .update(`${METERED_ATTESTATION_DIGEST_DOMAIN}\0`, "utf8")
    .update(JSON.stringify(stableValue(attestation)), "utf8")
    .digest("hex");
}

function digestCommercialTerms(packet) {
  const terms = {
    plans: Object.fromEntries(Object.keys(TIERS).map((tier) => [tier, {
      currency: packet.plans?.[tier]?.currency,
      interval: packet.plans?.[tier]?.interval,
      intervalUnit: packet.plans?.[tier]?.intervalUnit,
      name: packet.plans?.[tier]?.name,
      recurringPriceMinor: packet.plans?.[tier]?.recurringPriceMinor,
      setupFeeMinor: packet.plans?.[tier]?.setupFeeMinor,
      trialPeriod: packet.plans?.[tier]?.trialPeriod,
    }])),
    usageAddon: {
      associatedPlanTiers: packet.usageAddon?.associatedPlanTiers,
      currency: packet.usageAddon?.currency,
      interval: packet.usageAddon?.interval,
      intervalUnit: packet.usageAddon?.intervalUnit,
      isUsageSupported: packet.usageAddon?.isUsageSupported,
      name: packet.usageAddon?.name,
      priceBrackets: packet.usageAddon?.priceBrackets,
      pricingScheme: packet.usageAddon?.pricingScheme,
      type: packet.usageAddon?.type,
      unit: packet.usageAddon?.unit,
    },
  };
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(terms)), "utf8").digest("hex");
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

function validateMeteredBillingAttestation(attestation, testOrganization, approval, nowMs) {
  exactKeys(attestation, [
    "capturedAt", "environment", "meteredBillingEnabled", "organizationId",
    "privateEvidenceSha256", "schemaVersion", "source",
  ], "meteredBillingAttestation");
  if (attestation.schemaVersion !== 1) {
    fail("meteredBillingAttestation.schemaVersion must be 1");
  }
  if (
    attestation.environment !== "TEST" ||
    attestation.source !== "authenticated_billing_settings_ui" ||
    attestation.meteredBillingEnabled !== true
  ) fail("Metered Billing UI attestation is not an enabled TEST-settings readback");
  if (
    identifier(attestation.organizationId, "meteredBillingAttestation.organizationId") !==
    testOrganization.id
  ) fail("Metered Billing UI attestation target differs from the TEST organization");
  if (!/^[a-f0-9]{64}$/.test(attestation.privateEvidenceSha256)) {
    fail("meteredBillingAttestation.privateEvidenceSha256 is invalid");
  }
  const capturedAtMs = canonicalUtcTimestampMs(
    attestation.capturedAt,
    "meteredBillingAttestation.capturedAt",
  );
  const approvalCapturedAtMs = canonicalUtcTimestampMs(approval.capturedAt, "approval.capturedAt");
  if (capturedAtMs > approvalCapturedAtMs) {
    fail("Metered Billing UI attestation was captured after approval");
  }
  if (capturedAtMs > nowMs || nowMs - capturedAtMs > MAX_METERED_ATTESTATION_AGE_MS) {
    fail("Metered Billing UI attestation is stale");
  }
  if (
    !/^[a-f0-9]{64}$/.test(approval.meteredBillingAttestationSha256) ||
    !crypto.timingSafeEqual(
      Buffer.from(approval.meteredBillingAttestationSha256, "hex"),
      Buffer.from(digestMeteredBillingAttestation(attestation), "hex"),
    )
  ) fail("approval does not bind the exact Metered Billing UI attestation");
}

function validateApprovalEnvelope(approval, packet, nowMs = Date.now()) {
  exactKeys(approval, [
    "approvedSourceRevision", "authorizedOperations", "capturedAt", "catalogMutationAuthorized",
    "catalogPacketSha256", "commercialTermsSha256", "expiresAt",
    "meteredBillingAttestationSha256", "readbackEvidenceSha256", "schemaVersion", "singleUse",
    "targetOrganizationId",
  ], "approval");
  if (approval.schemaVersion !== 2) fail("approval.schemaVersion must be 2");
  validateApprovalWindow(approval, nowMs);
  validateMeteredBillingAttestation(
    packet.meteredBillingAttestation,
    packet.testOrganization,
    approval,
    nowMs,
  );
  const expectedOperations = packet.phase === "definition"
    ? ["create_test_product"]
    : ["create_test_plans", "create_test_usage_addon"];
  if (
    approval.catalogMutationAuthorized !== true ||
    approval.targetOrganizationId !== packet.testOrganization.id ||
    approval.targetOrganizationId === packet.liveOrganization.id ||
    JSON.stringify(approval.authorizedOperations) !== JSON.stringify(expectedOperations) ||
    approval.approvedSourceRevision !== packet.approvedSourceRevision ||
    approval.readbackEvidenceSha256 !== packet.readbackEvidenceSha256 ||
    !/^[a-f0-9]{64}$/.test(approval.catalogPacketSha256) ||
    !/^[a-f0-9]{64}$/.test(approval.commercialTermsSha256) ||
    !crypto.timingSafeEqual(
      Buffer.from(approval.catalogPacketSha256, "hex"),
      Buffer.from(digestCatalogPacket(packet), "hex"),
    ) ||
    !crypto.timingSafeEqual(
      Buffer.from(approval.commercialTermsSha256, "hex"),
      Buffer.from(digestCommercialTerms(packet), "hex"),
    )
  ) fail("private catalog approval does not match this exact TEST-only operation packet and target binding");
}

function validateCatalogPacket(packet, approval, nowMs = Date.now()) {
  exactKeys(packet, [
    "approvedSourceRevision", "environment", "liveOrganization", "meteredBillingAttestation",
    "phase", "plans", "product", "readbackEvidenceSha256", "schemaVersion", "testOrganization",
    "usageAddon",
  ], "packet");
  if (packet.schemaVersion !== 2) fail("schemaVersion must be 2");
  if (!new Set(["definition", "bound"]).has(packet.phase)) fail("phase is invalid");
  if (packet.environment !== "Development") fail("environment must be Development");
  if (!/^[a-f0-9]{40}$/.test(packet.approvedSourceRevision)) fail("approvedSourceRevision is invalid");
  if (!/^[a-f0-9]{64}$/.test(packet.readbackEvidenceSha256)) fail("readbackEvidenceSha256 is invalid");

  exactOrganization(packet.testOrganization, {
    mode: "test", orgType: "test", subscriptionsOnly: true,
  }, "testOrganization");
  // The live organization is a read-only catalog reference. Its provider shape is
  // Books-integrated, so claiming it is subscriptions-only would falsify prestate.
  exactOrganization(packet.liveOrganization, {
    mode: "live", orgType: "live", subscriptionsOnly: false,
  }, "liveOrganization");
  if (packet.testOrganization.id === packet.liveOrganization.id) {
    fail("TEST and live organizations must be distinct");
  }

  exactKeys(packet.product, ["liveProductId", "name", "testProductId"], "product");
  if (packet.product.name !== "Revenue Desk") fail("product name drifted");
  identifier(packet.product.liveProductId, "product.liveProductId");
  if (packet.phase === "definition") {
    if (packet.product.testProductId !== null) fail("definition phase cannot preclaim a TEST product ID");
  } else {
    identifier(packet.product.testProductId, "product.testProductId");
  }

  exactKeys(packet.plans, Object.keys(TIERS), "plans");
  for (const tier of Object.keys(TIERS)) validatePlan(packet.plans[tier], tier);
  const codes = Object.values(packet.plans).map(({ code: planCode }) => planCode);
  if (new Set(codes).size !== codes.length) fail("plan codes must be unique");
  validateUsageAddon(packet.usageAddon, packet.phase, packet.product);
  if (codes.includes(packet.usageAddon.code)) fail("usage add-on code collides with a plan code");
  validateApprovalEnvelope(approval, packet, nowMs);

  return Object.freeze({
    digest: digestCatalogPacket(packet),
    phase: packet.phase,
    planCount: codes.length,
    schemaVersion: packet.schemaVersion,
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
  if (argv.length !== 2) {
    fail("usage: node validate-private-catalog-packet.js <absolute-private-catalog-path> <absolute-private-approval-path>");
  }
  const packetPath = assertPrivatePacketPath(argv[0]);
  const approvalPath = assertPrivatePacketPath(argv[1]);
  const packet = readPrivateJson(packetPath, "private catalog packet");
  const approval = readPrivateJson(approvalPath, "private catalog approval");
  const result = validateCatalogPacket(packet, approval, nowMs);
  process.stdout.write(
    `Billing catalog packet valid: schema=${result.schemaVersion} phase=${result.phase} ` +
    `plans=${result.planCount} sha256=${result.digest}\n`,
  );
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
  REPOSITORY_ROOT,
  TIERS,
  assertPrivatePacketPath,
  digestCatalogPacket,
  digestCommercialTerms,
  digestMeteredBillingAttestation,
  run,
  validateCatalogPacket,
};
