"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../..");
const PACKAGE_RELATIVE_PATH = "src/zoho-catalyst/crm-billing-orchestrator";
const CAPABILITY_CONTRACT_REGISTRY_ENV = "BILLING_CATALOG_CAPABILITY_CONTRACTS_JSON";
const CAPABILITY_AUTHORITY_PATH = path.resolve(
  __dirname,
  "../config/billing-catalog-capability-authority.json",
);
const MAX_PRIVATE_FILE_BYTES = 1024 * 1024;

function gitChildEnvironment(environment = process.env) {
  const sanitized = {};
  for (const [name, value] of Object.entries(environment)) {
    if (!name.toUpperCase().startsWith("GIT_")) sanitized[name] = value;
  }
  // Git repository, index, object, and config selection must come from the
  // reviewed -C path, never from caller-controlled environment overrides.
  sanitized.GIT_OPTIONAL_LOCKS = "0";
  return sanitized;
}
const TIERS = Object.freeze({
  Launch: Object.freeze({ name: "Launch — Monthly" }),
  Growth: Object.freeze({ name: "Growth — Monthly" }),
  Scale: Object.freeze({ name: "Scale — Monthly" }),
});
const PHASES = Object.freeze({
  product: Object.freeze({
    authorizedOperations: Object.freeze(["create_test_product"]),
    readbackOperation: "read_test_product",
    requiredReadbackFields: Object.freeze([
      "description", "name", "notificationEmails", "organizationId", "productId",
      "redirectUrl", "status",
    ]),
    rollbackOperation: "mark_test_product_inactive",
    writeOperation: "create_test_product",
  }),
  plans: Object.freeze({
    authorizedOperations: Object.freeze(["create_test_plan"]),
    readbackOperation: "read_test_plan",
    requiredReadbackFields: Object.freeze([
      "billingCycles", "canChargeSetupFeeImmediately", "code", "currency", "interval",
      "intervalUnit", "name", "organizationId", "planId", "productId",
      "recurringPriceMinor", "revenueAccountId", "setupFeeAccountId", "setupFeeMinor",
      "status", "taxId", "trialPeriod", "unit",
    ]),
    rollbackOperation: "mark_test_plan_inactive",
    writeOperation: "create_test_plan",
  }),
  usage_addon: Object.freeze({
    authorizedOperations: Object.freeze(["create_test_usage_addon"]),
    readbackOperation: "read_test_usage_addon",
    requiredReadbackFields: Object.freeze([
      "addonId", "associatedPlanCodes", "code", "currency", "interval", "intervalUnit",
      "isUsageSupported", "name", "organizationId", "priceBrackets", "pricingScheme",
      "productId", "revenueAccountId", "status", "taxId", "type", "unit",
      "usageTrackingMode",
    ]),
    rollbackOperation: "mark_test_usage_addon_inactive",
    writeOperation: "create_test_usage_addon",
  }),
});
const MAX_APPROVAL_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTESTATION_AGE_MS = 15 * 60 * 1000;
const USAGE_BILLING_ATTESTATION_DIGEST_DOMAIN =
  "sylvara.billing.usage-billing-attestation.v1";
const CAPABILITY_ATTESTATION_DIGEST_DOMAIN =
  "sylvara.billing.catalog-capability-attestation.v1";
const CAPABILITY_CONTRACT_REGISTRY_DIGEST_DOMAIN =
  "sylvara.billing.catalog-capability-contract-registry.v1";
const APPROVAL_ENVELOPE_DIGEST_DOMAIN =
  "sylvara.billing.catalog-approval-envelope.v1";
const OPERATION_AUTHORIZATION_DIGEST_DOMAIN =
  "sylvara.billing.catalog-operation-authorization.v1";

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
  if (skipJsonWhitespace(raw, end) !== raw.length) {
    throw new SyntaxError("trailing JSON bytes");
  }
}

function parseJsonWithUniqueObjectKeys(raw, label, malformedMessage) {
  try {
    // JSON.parse silently applies last-key-wins semantics. Scan first so an
    // approved authority value cannot be replaced by a later duplicate key.
    rejectDuplicateJsonObjectKeys(raw);
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof DuplicateJsonObjectKeyError) {
      fail(`${label} contains duplicate object keys`);
    }
    fail(malformedMessage);
  }
}

function readPrivateJson(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    fail(`${label} could not be read`);
  }
  // Parser diagnostics can quote private packet excerpts. Emit only fixed labels.
  return parseJsonWithUniqueObjectKeys(raw, label, `${label} is not valid JSON`);
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
    "billingCycles", "canChargeSetupFeeImmediately", "code", "currency", "interval",
    "intervalUnit", "name", "recurringPriceMinor", "revenueAccountId", "setupFeeAccountId",
    "setupFeeMinor", "taxId", "trialPeriod", "unit",
  ], `plans.${tier}`);
  code(value.code, `plans.${tier}.code`);
  if (
    value.name !== expected.name ||
    value.currency !== "USD" ||
    value.interval !== 1 ||
    value.intervalUnit !== "months" ||
    value.trialPeriod !== 0 ||
    value.billingCycles !== -1 ||
    value.canChargeSetupFeeImmediately !== false ||
    value.unit !== null ||
    value.taxId !== null ||
    value.revenueAccountId !== null ||
    value.setupFeeAccountId !== null
  ) fail(`plans.${tier} commercial terms drifted`);
  positiveMinorUnits(value.recurringPriceMinor, `plans.${tier}.recurringPriceMinor`);
  positiveMinorUnits(value.setupFeeMinor, `plans.${tier}.setupFeeMinor`);
}

function validateUsageAddon(value, phase, product) {
  exactKeys(value, [
    "associatedPlanTiers", "code", "currency", "interval", "intervalUnit", "liveProductId",
    "description", "isUsageSupported", "name", "priceBrackets", "pricingScheme",
    "revenueAccountId", "taxId", "testProductId", "type", "unit", "usageTrackingMode",
  ], "usageAddon");
  code(value.code, "usageAddon.code");
  if (
    value.name !== "Connected AI Minutes — Usage" ||
    value.type !== "recurring" ||
    value.isUsageSupported !== true ||
    value.usageTrackingMode !== "usage_billing" ||
    value.pricingScheme !== "unit" ||
    value.unit !== "minute" ||
    value.currency !== "USD" ||
    value.interval !== 1 ||
    value.intervalUnit !== "months" ||
    value.description !== null ||
    value.taxId !== null ||
    value.revenueAccountId !== null
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
  if (phase === "product") {
    if (product.testProductId === null) {
      if (value.testProductId !== null) fail("product phase TEST product binding differs");
    } else if (
      identifier(value.testProductId, "usageAddon.testProductId") !== product.testProductId
    ) fail("usageAddon TEST product binding differs");
  } else if (
    identifier(value.testProductId, "usageAddon.testProductId") !== product.testProductId
  ) fail("usageAddon TEST product binding differs");
}

function validateProduct(value, phase) {
  exactKeys(value, [
    "description", "liveProductId", "name", "notificationEmails", "redirectUrl",
    "testProductId",
  ], "product");
  if (
    value.name !== "Revenue Desk" ||
    value.description !== null ||
    !Array.isArray(value.notificationEmails) ||
    value.notificationEmails.length !== 0 ||
    value.redirectUrl !== null
  ) fail("product definition drifted");
  identifier(value.liveProductId, "product.liveProductId");
  if (phase === "product") {
    if (value.testProductId !== null) identifier(value.testProductId, "product.testProductId");
  } else {
    identifier(value.testProductId, "product.testProductId");
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function digestCatalogPacket(packet) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(packet)), "utf8").digest("hex");
}

function digestUsageBillingAttestation(attestation) {
  return crypto.createHash("sha256")
    .update(`${USAGE_BILLING_ATTESTATION_DIGEST_DOMAIN}\0`, "utf8")
    .update(JSON.stringify(stableValue(attestation)), "utf8")
    .digest("hex");
}

function digestCapabilityAttestation(attestation) {
  return crypto.createHash("sha256")
    .update(`${CAPABILITY_ATTESTATION_DIGEST_DOMAIN}\0`, "utf8")
    .update(JSON.stringify(stableValue(attestation)), "utf8")
    .digest("hex");
}

function digestCapabilityContractRegistry(registry) {
  return crypto.createHash("sha256")
    .update(`${CAPABILITY_CONTRACT_REGISTRY_DIGEST_DOMAIN}\0`, "utf8")
    .update(JSON.stringify(stableValue(registry)), "utf8")
    .digest("hex");
}

function digestApprovalEnvelope(approval) {
  return crypto.createHash("sha256")
    .update(`${APPROVAL_ENVELOPE_DIGEST_DOMAIN}\0`, "utf8")
    .update(JSON.stringify(stableValue(approval)), "utf8")
    .digest("hex");
}

function digestOperationAuthorization(packet) {
  // Approval timestamps are intentionally excluded. The executor uses the UUID as
  // its UNIQUE authority key and stores this one digest; changed packet bytes under
  // the same UUID therefore produce a detectable conflict without a second digest.
  return crypto.createHash("sha256")
    .update(`${OPERATION_AUTHORIZATION_DIGEST_DOMAIN}\0`, "utf8")
    .update(JSON.stringify(stableValue({
      operationAuthorizationId: packet.operationAuthorizationId,
      packetSha256: digestCatalogPacket(packet),
    })), "utf8")
    .digest("hex");
}

function digestMatches(actual, expected, label) {
  if (
    !/^[a-f0-9]{64}$/.test(actual) ||
    !/^[a-f0-9]{64}$/.test(expected) ||
    !crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  ) fail(`${label} does not match the reviewed contract`);
}

function digestCommercialTerms(packet) {
  const terms = {
    plans: Object.fromEntries(Object.keys(TIERS).map((tier) => [tier, {
      currency: packet.plans?.[tier]?.currency,
      billingCycles: packet.plans?.[tier]?.billingCycles,
      canChargeSetupFeeImmediately: packet.plans?.[tier]?.canChargeSetupFeeImmediately,
      interval: packet.plans?.[tier]?.interval,
      intervalUnit: packet.plans?.[tier]?.intervalUnit,
      name: packet.plans?.[tier]?.name,
      recurringPriceMinor: packet.plans?.[tier]?.recurringPriceMinor,
      revenueAccountId: packet.plans?.[tier]?.revenueAccountId,
      setupFeeAccountId: packet.plans?.[tier]?.setupFeeAccountId,
      setupFeeMinor: packet.plans?.[tier]?.setupFeeMinor,
      taxId: packet.plans?.[tier]?.taxId,
      trialPeriod: packet.plans?.[tier]?.trialPeriod,
      unit: packet.plans?.[tier]?.unit,
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
      revenueAccountId: packet.usageAddon?.revenueAccountId,
      taxId: packet.usageAddon?.taxId,
      type: packet.usageAddon?.type,
      unit: packet.usageAddon?.unit,
      usageTrackingMode: packet.usageAddon?.usageTrackingMode,
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
  if (approval.singleUse !== true) fail("approval must declare single-use intent");
  if (approval.executionConsumptionRequired !== true) {
    fail("approval must require durable executor consumption before mutation");
  }
  const capturedAtMs = canonicalUtcTimestampMs(approval.capturedAt, "approval.capturedAt");
  const expiresAtMs = canonicalUtcTimestampMs(approval.expiresAt, "approval.expiresAt");
  if (
    expiresAtMs <= capturedAtMs ||
    expiresAtMs - capturedAtMs > MAX_APPROVAL_WINDOW_MS
  ) fail("approval validity window must be positive and no longer than 15 minutes");
  if (capturedAtMs > nowMs) fail("approval is not yet valid");
  if (nowMs >= expiresAtMs) fail("approval has expired");
}

function validateFreshAttestation(attestation, label, approval, nowMs) {
  if (!/^[a-f0-9]{64}$/.test(attestation.privateEvidenceSha256)) {
    fail(`${label}.privateEvidenceSha256 is invalid`);
  }
  const capturedAtMs = canonicalUtcTimestampMs(attestation.capturedAt, `${label}.capturedAt`);
  const approvalCapturedAtMs = canonicalUtcTimestampMs(approval.capturedAt, "approval.capturedAt");
  if (capturedAtMs > approvalCapturedAtMs) fail(`${label} was captured after approval`);
  if (capturedAtMs > nowMs || nowMs - capturedAtMs > MAX_ATTESTATION_AGE_MS) {
    fail(`${label} is stale`);
  }
}

function validatePagination(value, label, required) {
  if (!required) {
    if (value !== null) fail(`${label} must be null for this phase`);
    return;
  }
  exactKeys(value, ["completePaginatedReadback", "hasMore", "pageCount"], label);
  if (
    value.completePaginatedReadback !== true ||
    value.hasMore !== false ||
    !Number.isSafeInteger(value.pageCount) ||
    value.pageCount < 1
  ) fail(`${label} does not prove a complete paginated readback`);
}

function validateProductSnapshot(value, packet, label) {
  exactKeys(value, [
    "description", "name", "notificationEmails", "organizationId", "productId",
    "redirectUrl", "status",
  ], label);
  if (
    value.description !== packet.product.description ||
    value.name !== packet.product.name ||
    JSON.stringify(value.notificationEmails) !== JSON.stringify(packet.product.notificationEmails) ||
    value.redirectUrl !== packet.product.redirectUrl ||
    value.status !== "active" ||
    identifier(value.organizationId, `${label}.organizationId`) !== packet.testOrganization.id ||
    identifier(value.productId, `${label}.productId`) !== packet.product.testProductId
  ) fail(`${label} is not the exact active TEST product dependency`);
  return value.productId;
}

function validateProductInventory(value, packet) {
  exactKeys(value, ["exactNameMatchCount", "matches", "targetName"], "mutationPrestate.productInventory");
  if (value.targetName !== packet.product.name || !Array.isArray(value.matches)) {
    fail("mutationPrestate product target is not exact");
  }
  if (value.exactNameMatchCount === 0 && value.matches.length === 0) return "absent";
  if (value.exactNameMatchCount === 1 && value.matches.length === 1) {
    validateProductSnapshot(value.matches[0], packet, "mutationPrestate.productInventory.matches[0]");
    return "present_exact";
  }
  fail("mutationPrestate product inventory is ambiguous or duplicated");
}

function validatePlanSnapshot(value, definition, packet, tier, label) {
  exactKeys(value, PHASES.plans.requiredReadbackFields, label);
  if (
    value.billingCycles !== definition.billingCycles ||
    value.canChargeSetupFeeImmediately !== definition.canChargeSetupFeeImmediately ||
    value.code !== definition.code ||
    value.currency !== definition.currency ||
    value.interval !== definition.interval ||
    value.intervalUnit !== definition.intervalUnit ||
    value.name !== definition.name ||
    value.recurringPriceMinor !== definition.recurringPriceMinor ||
    value.revenueAccountId !== definition.revenueAccountId ||
    value.setupFeeAccountId !== definition.setupFeeAccountId ||
    value.setupFeeMinor !== definition.setupFeeMinor ||
    value.status !== "active" ||
    value.taxId !== definition.taxId ||
    value.trialPeriod !== definition.trialPeriod ||
    value.unit !== definition.unit ||
    identifier(value.organizationId, `${label}.organizationId`) !== packet.testOrganization.id ||
    identifier(value.productId, `${label}.productId`) !== packet.product.testProductId
  ) fail(`${label} does not match the exact ${tier} definition`);
  return identifier(value.planId, `${label}.planId`);
}

function validatePlanInventory(value, packet) {
  if (!Array.isArray(value)) fail("mutationPrestate.planInventory must be an array");
  if (packet.phase === "product") {
    if (value.length !== 0) fail("product phase cannot claim plan inventory");
    return null;
  }
  const tiers = Object.keys(TIERS);
  if (value.length !== tiers.length) {
    fail("mutationPrestate.planInventory must contain every canonical tier exactly once");
  }
  const planIds = new Set();
  let targetState = null;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const entry = value[index];
    exactKeys(entry, [
      "exactCodeMatchCount", "exactNameMatchCount", "matches", "state", "tier",
    ], `mutationPrestate.planInventory[${index}]`);
    if (
      entry.tier !== tier ||
      !Array.isArray(entry.matches) ||
      !new Set(["missing", "present_exact"]).has(entry.state)
    ) fail("mutationPrestate plan inventory ordering or state is invalid");
    if (entry.state === "missing") {
      if (
        entry.exactCodeMatchCount !== 0 ||
        entry.exactNameMatchCount !== 0 ||
        entry.matches.length !== 0
      ) fail(`mutationPrestate ${tier} missing state has a collision`);
    } else {
      if (
        entry.exactCodeMatchCount !== 1 ||
        entry.exactNameMatchCount !== 1 ||
        entry.matches.length !== 1
      ) fail(`mutationPrestate ${tier} present state is not unique`);
      const planId = validatePlanSnapshot(
        entry.matches[0],
        packet.plans[tier],
        packet,
        tier,
        `mutationPrestate.planInventory[${index}].matches[0]`,
      );
      if (planIds.has(planId)) fail("mutationPrestate plan IDs must be unique");
      planIds.add(planId);
    }
    if (packet.phase === "plans" && tier === packet.targetPlanTier) {
      targetState = entry.state === "missing" ? "absent" : "present_exact";
    }
    if (packet.phase === "usage_addon" && entry.state !== "present_exact") {
      fail("usage_addon requires all three exact active TEST plans");
    }
  }
  return targetState;
}

function validateUsageAddonSnapshot(value, packet, label) {
  exactKeys(value, PHASES.usage_addon.requiredReadbackFields, label);
  const expectedPlanCodes = Object.keys(TIERS).map((tier) => packet.plans[tier].code);
  if (
    JSON.stringify(value.associatedPlanCodes) !== JSON.stringify(expectedPlanCodes) ||
    value.code !== packet.usageAddon.code ||
    value.currency !== packet.usageAddon.currency ||
    value.interval !== packet.usageAddon.interval ||
    value.intervalUnit !== packet.usageAddon.intervalUnit ||
    value.isUsageSupported !== packet.usageAddon.isUsageSupported ||
    value.name !== packet.usageAddon.name ||
    JSON.stringify(value.priceBrackets) !== JSON.stringify(packet.usageAddon.priceBrackets) ||
    value.pricingScheme !== packet.usageAddon.pricingScheme ||
    value.revenueAccountId !== packet.usageAddon.revenueAccountId ||
    value.status !== "active" ||
    value.taxId !== packet.usageAddon.taxId ||
    value.type !== packet.usageAddon.type ||
    value.unit !== packet.usageAddon.unit ||
    value.usageTrackingMode !== packet.usageAddon.usageTrackingMode ||
    identifier(value.organizationId, `${label}.organizationId`) !== packet.testOrganization.id ||
    identifier(value.productId, `${label}.productId`) !== packet.product.testProductId
  ) fail(`${label} is not the exact active TEST usage add-on`);
  return identifier(value.addonId, `${label}.addonId`);
}

function validateUsageAddonInventory(value, packet) {
  if (packet.phase !== "usage_addon") {
    if (value !== null) fail("usage add-on inventory is permitted only for its phase");
    return null;
  }
  exactKeys(value, [
    "exactCodeMatchCount", "exactNameMatchCount", "matches", "targetCode", "targetName",
  ], "mutationPrestate.usageAddonInventory");
  if (
    value.targetCode !== packet.usageAddon.code ||
    value.targetName !== packet.usageAddon.name ||
    !Array.isArray(value.matches)
  ) fail("mutationPrestate usage add-on target is not exact");
  if (
    value.exactCodeMatchCount === 0 &&
    value.exactNameMatchCount === 0 &&
    value.matches.length === 0
  ) return "absent";
  if (
    value.exactCodeMatchCount === 1 &&
    value.exactNameMatchCount === 1 &&
    value.matches.length === 1
  ) {
    validateUsageAddonSnapshot(
      value.matches[0],
      packet,
      "mutationPrestate.usageAddonInventory.matches[0]",
    );
    return "present_exact";
  }
  fail("mutationPrestate usage add-on inventory is ambiguous or duplicated");
}

function validateAmbiguityResolution(value, packet, targetState, approval, nowMs, prestate) {
  exactKeys(value, [
    "privateEvidenceSha256", "priorPacketSha256", "resolvedAt", "state",
  ], "mutationPrestate.ambiguityResolution");
  if (value.state === "none") {
    if (
      value.privateEvidenceSha256 !== null ||
      value.priorPacketSha256 !== null ||
      value.resolvedAt !== null
    ) fail("initial mutation prestate cannot claim prior ambiguity evidence");
  } else if (new Set([
    "resolved_absent_after_ambiguous",
    "resolved_existing_exact_after_ambiguous",
  ]).has(value.state)) {
    if (!/^[a-f0-9]{64}$/.test(value.priorPacketSha256)) {
      fail("ambiguity resolution must bind the prior packet digest");
    }
    validateFreshAttestation({
      capturedAt: value.resolvedAt,
      privateEvidenceSha256: value.privateEvidenceSha256,
    }, "mutationPrestate.ambiguityResolution", approval, nowMs);
    if (
      value.resolvedAt !== prestate.capturedAt ||
      value.privateEvidenceSha256 !== prestate.privateEvidenceSha256
    ) fail("ambiguity resolution must be the same authoritative current inventory readback");
    if (value.priorPacketSha256 === digestCatalogPacket(packet)) {
      fail("ambiguity resolution cannot identify the current packet as its predecessor");
    }
    const expectedState = value.state === "resolved_absent_after_ambiguous"
      ? "absent"
      : "present_exact";
    if (targetState !== expectedState) {
      fail("ambiguity resolution conflicts with authoritative current inventory");
    }
  } else {
    fail("mutationPrestate ambiguity resolution state is invalid");
  }
  if (targetState === "present_exact") {
    fail("authoritative readback proves the target already exists; creation is not authorized");
  }
}

function validateMutationPrestate(packet, approval, nowMs) {
  if (packet.phase === "plans" && !Object.hasOwn(TIERS, packet.targetPlanTier)) {
    fail("targetPlanTier must identify one canonical tier");
  }
  if (packet.phase !== "plans" && packet.targetPlanTier !== null) {
    fail("targetPlanTier is permitted only for the plans phase");
  }
  const prestate = packet.mutationPrestate;
  exactKeys(prestate, [
    "ambiguityResolution", "capturedAt", "catalogPages", "environment", "organizationId",
    "phase", "planInventory", "privateEvidenceSha256", "productInventory",
    "retryAuthorized", "schemaVersion", "usageAddonInventory",
  ], "mutationPrestate");
  exactKeys(prestate.catalogPages, [
    "plans", "products", "usageAddons",
  ], "mutationPrestate.catalogPages");
  if (
    prestate.schemaVersion !== 2 ||
    prestate.environment !== "TEST" ||
    prestate.phase !== packet.phase ||
    prestate.retryAuthorized !== false ||
    identifier(prestate.organizationId, "mutationPrestate.organizationId") !==
      packet.testOrganization.id
  ) fail("mutationPrestate is not exact for this TEST catalog phase");
  validatePagination(prestate.catalogPages.products, "mutationPrestate.catalogPages.products", true);
  validatePagination(
    prestate.catalogPages.plans,
    "mutationPrestate.catalogPages.plans",
    packet.phase !== "product",
  );
  validatePagination(
    prestate.catalogPages.usageAddons,
    "mutationPrestate.catalogPages.usageAddons",
    packet.phase === "usage_addon",
  );
  validateFreshAttestation(prestate, "mutationPrestate", approval, nowMs);

  const productState = validateProductInventory(prestate.productInventory, packet);
  if (
    packet.phase === "product" &&
    productState === "absent" &&
    packet.product.testProductId !== null
  ) fail("absent product prestate cannot preclaim a TEST product ID");
  if (packet.phase !== "product" && productState !== "present_exact") {
    fail("bound catalog phases require the exact active TEST product");
  }
  const planTargetState = validatePlanInventory(prestate.planInventory, packet);
  const usageAddonState = validateUsageAddonInventory(prestate.usageAddonInventory, packet);
  const targetState = packet.phase === "product"
    ? productState
    : packet.phase === "plans"
      ? planTargetState
      : usageAddonState;
  validateAmbiguityResolution(
    prestate.ambiguityResolution,
    packet,
    targetState,
    approval,
    nowMs,
    prestate,
  );
  if (targetState !== "absent") fail("catalog creation target is not proven absent");
}

function validateUsageBillingAttestation(attestation, packet, approval, nowMs) {
  if (packet.phase !== "usage_addon") {
    if (attestation !== null || approval.usageBillingAttestationSha256 !== null) {
      fail("Usage Billing attestation is permitted only for the usage_addon phase");
    }
    return;
  }
  exactKeys(attestation, [
    "capturedAt", "enterpriseEntitlementProven", "environment", "feature",
    "organizationId", "privateEvidenceSha256", "schemaVersion", "source",
    "usageBillingEnabled", "usageTrackingAddonControlAvailable",
  ], "usageBillingAttestation");
  if (attestation.schemaVersion !== 1) fail("usageBillingAttestation.schemaVersion must be 1");
  if (
    attestation.environment !== "TEST" ||
    attestation.source !== "authenticated_billing_settings_ui" ||
    attestation.feature !== "usage_billing" ||
    attestation.usageBillingEnabled !== true ||
    attestation.usageTrackingAddonControlAvailable !== true ||
    attestation.enterpriseEntitlementProven !== true
  ) fail("Usage Billing UI attestation does not prove the enabled entitled TEST feature");
  if (
    identifier(attestation.organizationId, "usageBillingAttestation.organizationId") !==
    packet.testOrganization.id
  ) fail("Usage Billing UI attestation target differs from the TEST organization");
  validateFreshAttestation(attestation, "Usage Billing UI attestation", approval, nowMs);
  if (
    !/^[a-f0-9]{64}$/.test(approval.usageBillingAttestationSha256) ||
    !crypto.timingSafeEqual(
      Buffer.from(approval.usageBillingAttestationSha256, "hex"),
      Buffer.from(digestUsageBillingAttestation(attestation), "hex"),
    )
  ) fail("approval does not bind the exact Usage Billing UI attestation");
}

function validateCapabilityAuthority(authority, registry, synthetic) {
  exactKeys(authority, [
    "executable", "registrySha256", "schemaVersion", "status",
  ], "capabilityAuthority");
  const expectedStatus = synthetic
    ? "synthetic_test_only"
    : "reviewed_registry_anchored";
  if (
    authority.schemaVersion !== 1 ||
    authority.executable !== true ||
    authority.status !== expectedStatus ||
    !/^[a-f0-9]{64}$/.test(authority.registrySha256)
  ) {
    fail(synthetic
      ? "synthetic capability authority is invalid"
      : "committed capability authority blocks catalog mutation");
  }
  if (!plainObject(registry)) {
    fail("reviewed catalog capability contract registry is not configured");
  }
  const registryDigest = digestCapabilityContractRegistry(registry);
  digestMatches(
    registryDigest,
    authority.registrySha256,
    "capability registry committed authority digest",
  );
  return registryDigest;
}

function validateCapabilityContractRegistry(registry, packet, registryDigest, synthetic) {
  if (!plainObject(registry)) {
    fail("reviewed catalog capability contract registry is not configured");
  }
  exactKeys(registry, [
    "authorityScope", "connector", "environment", "operations", "phase", "schemaVersion",
    "source",
  ], "capabilityContractRegistry");
  const expected = synthetic
    ? {
        authorityScope: "synthetic_test_only",
        connector: "Synthetic Billing Changes",
        environment: "SYNTHETIC_TEST",
        source: "synthetic_test_fixture",
      }
    : {
        authorityScope: "committed_reviewed_registry",
        connector: "Sylvara Billing Changes",
        environment: "TEST",
        source: "reviewed_installed_connector_operation_contracts",
      };
  if (
    registry.schemaVersion !== 1 ||
    registry.authorityScope !== expected.authorityScope ||
    registry.connector !== expected.connector ||
    registry.environment !== expected.environment ||
    registry.phase !== packet.phase ||
    registry.source !== expected.source
  ) fail("capabilityContractRegistry is not exact for this TEST catalog phase");
  const phase = PHASES[packet.phase];
  const operationNames = [
    phase.writeOperation,
    phase.readbackOperation,
    phase.rollbackOperation,
  ];
  exactKeys(registry.operations, operationNames, "capabilityContractRegistry.operations");
  for (const operation of operationNames) {
    const contract = registry.operations[operation];
    exactKeys(contract, [
      "requestContractSha256", "responseContractSha256",
    ], `capabilityContractRegistry.operations.${operation}`);
    if (
      !/^[a-f0-9]{64}$/.test(contract.requestContractSha256) ||
      !/^[a-f0-9]{64}$/.test(contract.responseContractSha256)
    ) fail(`capabilityContractRegistry operation ${operation} has an invalid digest`);
  }
  digestMatches(
    packet.capabilityContractRegistrySha256,
    registryDigest,
    "packet capability contract registry digest",
  );
  return registryDigest;
}

function validateCapabilityEdge(
  value,
  expectedOperation,
  requiredFields,
  trustedContract,
  label,
) {
  const expectedKeys = [
    "advertised", "effectiveTenantAccessProven", "operation", "requestContractSha256",
    "responseContractSha256",
    ...(requiredFields ? ["requiredFields"] : []),
  ];
  exactKeys(value, expectedKeys, label);
  if (
    value.advertised !== true ||
    value.effectiveTenantAccessProven !== true ||
    value.operation !== expectedOperation
  ) fail(`${label} is not an exact effective typed connector capability`);
  digestMatches(
    value.requestContractSha256,
    trustedContract.requestContractSha256,
    `${label}.requestContractSha256`,
  );
  digestMatches(
    value.responseContractSha256,
    trustedContract.responseContractSha256,
    `${label}.responseContractSha256`,
  );
  if (requiredFields) {
    if (JSON.stringify(value.requiredFields) !== JSON.stringify(requiredFields)) {
      fail(`${label}.requiredFields do not prove the complete normalized response`);
    }
  }
}

function validateCapabilityAttestation(attestation, packet, approval, nowMs, registry, synthetic) {
  const phase = PHASES[packet.phase];
  exactKeys(attestation, [
    "authorityScope", "capturedAt", "environment", "organizationId", "phase",
    "privateEvidenceSha256", "readback", "rollback", "schemaVersion", "source", "write",
  ], "capabilityAttestation");
  const expectedAuthorityScope = synthetic
    ? "synthetic_test_only"
    : "committed_reviewed_registry";
  const expectedSource = synthetic
    ? "synthetic_test_fixture"
    : "reviewed_typed_connector_contracts";
  if (
    attestation.schemaVersion !== 1 ||
    attestation.authorityScope !== expectedAuthorityScope ||
    attestation.environment !== "TEST" ||
    attestation.phase !== packet.phase ||
    attestation.source !== expectedSource
  ) fail("capabilityAttestation is not exact for this TEST catalog phase");
  if (
    identifier(attestation.organizationId, "capabilityAttestation.organizationId") !==
    packet.testOrganization.id
  ) fail("capabilityAttestation target differs from the TEST organization");
  validateCapabilityEdge(
    attestation.write,
    phase.writeOperation,
    null,
    registry.operations[phase.writeOperation],
    "capabilityAttestation.write",
  );
  validateCapabilityEdge(
    attestation.readback,
    phase.readbackOperation,
    phase.requiredReadbackFields,
    registry.operations[phase.readbackOperation],
    "capabilityAttestation.readback",
  );
  validateCapabilityEdge(
    attestation.rollback,
    phase.rollbackOperation,
    null,
    registry.operations[phase.rollbackOperation],
    "capabilityAttestation.rollback",
  );
  validateFreshAttestation(attestation, "capabilityAttestation", approval, nowMs);
  if (
    !/^[a-f0-9]{64}$/.test(approval.capabilityAttestationSha256) ||
    !crypto.timingSafeEqual(
      Buffer.from(approval.capabilityAttestationSha256, "hex"),
      Buffer.from(digestCapabilityAttestation(attestation), "hex"),
    )
  ) fail("approval does not bind the exact catalog capability attestation");
}

function validateApprovalEnvelope(
  approval,
  packet,
  nowMs,
  registry,
  registryDigest,
  synthetic,
) {
  exactKeys(approval, [
    "approvedSourceRevision", "authorizedOperations", "capturedAt", "catalogMutationAuthorized",
    "catalogPacketSha256", "capabilityAttestationSha256",
    "capabilityContractRegistrySha256", "commercialTermsSha256", "executionConsumptionRequired",
    "expiresAt", "operationAuthorizationSha256", "readbackEvidenceSha256", "schemaVersion", "singleUse",
    "targetOrganizationId", "usageBillingAttestationSha256",
  ], "approval");
  if (approval.schemaVersion !== 4) fail("approval.schemaVersion must be 4");
  validateApprovalWindow(approval, nowMs);
  digestMatches(
    approval.capabilityContractRegistrySha256,
    registryDigest,
    "approval capability contract registry digest",
  );
  validateMutationPrestate(packet, approval, nowMs);
  validateCapabilityAttestation(
    packet.capabilityAttestation,
    packet,
    approval,
    nowMs,
    registry,
    synthetic,
  );
  validateUsageBillingAttestation(packet.usageBillingAttestation, packet, approval, nowMs);
  const expectedOperations = PHASES[packet.phase].authorizedOperations;
  if (
    approval.catalogMutationAuthorized !== true ||
    approval.targetOrganizationId !== packet.testOrganization.id ||
    approval.targetOrganizationId === packet.liveOrganization.id ||
    JSON.stringify(approval.authorizedOperations) !== JSON.stringify(expectedOperations) ||
    approval.approvedSourceRevision !== packet.approvedSourceRevision ||
    approval.readbackEvidenceSha256 !== packet.readbackEvidenceSha256 ||
    !/^[a-f0-9]{64}$/.test(approval.catalogPacketSha256) ||
    !/^[a-f0-9]{64}$/.test(approval.commercialTermsSha256) ||
    !/^[a-f0-9]{64}$/.test(approval.operationAuthorizationSha256) ||
    !crypto.timingSafeEqual(
      Buffer.from(approval.catalogPacketSha256, "hex"),
      Buffer.from(digestCatalogPacket(packet), "hex"),
    ) ||
    !crypto.timingSafeEqual(
      Buffer.from(approval.commercialTermsSha256, "hex"),
      Buffer.from(digestCommercialTerms(packet), "hex"),
    ) ||
    !crypto.timingSafeEqual(
      Buffer.from(approval.operationAuthorizationSha256, "hex"),
      Buffer.from(digestOperationAuthorization(packet), "hex"),
    )
  ) fail("private catalog approval does not match this exact TEST-only operation packet and target binding");
}

function validateCatalogPacketAgainstAuthority(
  packet,
  approval,
  nowMs,
  capabilityContractRegistry,
  capabilityAuthority,
  synthetic,
) {
  exactKeys(packet, [
    "approvedSourceRevision", "capabilityAttestation", "capabilityContractRegistrySha256",
    "environment", "liveOrganization", "mutationPrestate", "operationAuthorizationId", "phase",
    "plans", "product", "readbackEvidenceSha256", "schemaVersion", "targetPlanTier",
    "testOrganization", "usageAddon", "usageBillingAttestation",
  ], "packet");
  if (packet.schemaVersion !== 4) fail("schemaVersion must be 4");
  if (!Object.hasOwn(PHASES, packet.phase)) fail("phase is invalid");
  if (packet.environment !== "Development") fail("environment must be Development");
  if (!/^[a-f0-9]{40}$/.test(packet.approvedSourceRevision)) fail("approvedSourceRevision is invalid");
  if (!/^[a-f0-9]{64}$/.test(packet.readbackEvidenceSha256)) fail("readbackEvidenceSha256 is invalid");
  if (
    typeof packet.operationAuthorizationId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      packet.operationAuthorizationId,
    )
  ) fail("operationAuthorizationId must be a lowercase UUID v4");

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

  validateProduct(packet.product, packet.phase);

  exactKeys(packet.plans, Object.keys(TIERS), "plans");
  for (const tier of Object.keys(TIERS)) validatePlan(packet.plans[tier], tier);
  const codes = Object.values(packet.plans).map(({ code: planCode }) => planCode);
  if (new Set(codes).size !== codes.length) fail("plan codes must be unique");
  validateUsageAddon(packet.usageAddon, packet.phase, packet.product);
  if (codes.includes(packet.usageAddon.code)) fail("usage add-on code collides with a plan code");
  const trustedRegistryDigest = validateCapabilityAuthority(
    capabilityAuthority,
    capabilityContractRegistry,
    synthetic,
  );
  const registryDigest = validateCapabilityContractRegistry(
    capabilityContractRegistry,
    packet,
    trustedRegistryDigest,
    synthetic,
  );
  validateApprovalEnvelope(
    approval,
    packet,
    nowMs,
    capabilityContractRegistry,
    registryDigest,
    synthetic,
  );

  return Object.freeze({
    approvalDigest: digestApprovalEnvelope(approval),
    authorizedPlanTier: packet.targetPlanTier,
    commercialPlanDefinitionCount: codes.length,
    consumptionDigest: digestOperationAuthorization(packet),
    digest: digestCatalogPacket(packet),
    operationAuthorizationId: packet.operationAuthorizationId,
    phase: packet.phase,
    schemaVersion: packet.schemaVersion,
    syntheticStructuralValidation: synthetic,
  });
}

function validateCatalogPacket(packet, approval, nowMs = Date.now(), options = {}) {
  return validateCatalogPacketAgainstAuthority(
    packet,
    approval,
    nowMs,
    options.capabilityContractRegistry,
    readCommittedCapabilityAuthority(),
    false,
  );
}

function validateSyntheticCatalogPacketStructure(
  packet,
  approval,
  nowMs,
  capabilityContractRegistry,
) {
  // Synthetic contracts exercise packet structure only. Production validation
  // always loads the non-overridable committed authority instead of this path.
  const capabilityAuthority = {
    executable: true,
    registrySha256: digestCapabilityContractRegistry(capabilityContractRegistry),
    schemaVersion: 1,
    status: "synthetic_test_only",
  };
  const result = validateCatalogPacketAgainstAuthority(
    packet,
    approval,
    nowMs,
    capabilityContractRegistry,
    capabilityAuthority,
    true,
  );
  return Object.freeze({
    ...result,
    mutationAuthorization: false,
  });
}

function repositoryWorktreeRoots() {
  let output;
  try {
    output = execFileSync(
      "git",
      [
        "-c", `safe.directory=${REPOSITORY_ROOT}`,
        "-C", REPOSITORY_ROOT,
        "worktree", "list", "--porcelain", "-z",
      ],
      {
        encoding: "utf8",
        env: gitChildEnvironment(),
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
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    fail("packet file metadata is unavailable");
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PRIVATE_FILE_BYTES) {
    fail("packet file size or type is invalid");
  }
  // A path outside Git can still alias private bytes through a hard link. One
  // physical link makes the resolved path check authoritative for this claim.
  if (stat.nlink !== 1) fail("packet file must not have hard-link aliases");
  return resolved;
}

function readCapabilityContractRegistry(environment = process.env) {
  const raw = environment?.[CAPABILITY_CONTRACT_REGISTRY_ENV];
  if (typeof raw !== "string" || raw.trim() === "") {
    fail("reviewed catalog capability contract registry is not configured");
  }
  return parseJsonWithUniqueObjectKeys(
    raw,
    "reviewed catalog capability contract registry",
    "reviewed catalog capability contract registry is not valid JSON",
  );
}

function readCommittedCapabilityAuthority() {
  let raw;
  try {
    raw = fs.readFileSync(CAPABILITY_AUTHORITY_PATH, "utf8");
  } catch {
    fail("committed catalog capability authority is unavailable");
  }
  const value = parseJsonWithUniqueObjectKeys(
    raw,
    "committed catalog capability authority",
    "committed catalog capability authority is unavailable",
  );
  exactKeys(value, [
    "executable", "registrySha256", "schemaVersion", "status",
  ], "capabilityAuthority");
  return value;
}

function runGit(args, gitRunner) {
  try {
    return String(gitRunner(
      "git",
      ["-c", `safe.directory=${REPOSITORY_ROOT}`, "-C", REPOSITORY_ROOT, ...args],
      {
        encoding: "utf8",
        env: gitChildEnvironment(),
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    ));
  } catch {
    fail("current repository state could not be verified");
  }
}

function assertCliRepositoryState(packet, gitRunner = execFileSync) {
  const committedRevision = runGit(["rev-parse", "HEAD"], gitRunner).trim();
  if (!/^[a-f0-9]{40}$/.test(committedRevision)) {
    fail("current committed source revision is invalid");
  }
  if (packet.approvedSourceRevision !== committedRevision) {
    fail("packet source revision does not match current committed source");
  }
  const packageStatus = runGit([
    "status", "--porcelain=v1", "--untracked-files=all", "--", PACKAGE_RELATIVE_PATH,
  ], gitRunner);
  if (packageStatus.trim() !== "") {
    fail("CRM/Billing package must be clean before catalog validation");
  }
  const trackedFiles = runGit([
    "ls-files", "-v", "--", PACKAGE_RELATIVE_PATH,
  ], gitRunner);
  for (const line of trackedFiles.split(/\r?\n/u)) {
    if (line === "") continue;
    // Lowercase tags are assume-unchanged; S is skip-worktree. Either can hide
    // working-copy changes from ordinary status output and invalidate source binding.
    if (/^(?:[a-z]|S) /u.test(line)) {
      fail("CRM/Billing package contains hidden tracked-file state");
    }
  }
  return committedRevision;
}

function run(
  argv,
  nowMs = Date.now(),
  environment = process.env,
  gitRunner = execFileSync,
) {
  if (argv.length !== 2) {
    fail("usage: node validate-private-catalog-packet.js <absolute-private-catalog-path> <absolute-private-approval-path>");
  }
  const packetPath = assertPrivatePacketPath(argv[0]);
  const approvalPath = assertPrivatePacketPath(argv[1]);
  if (packetPath === approvalPath) fail("packet and approval files must be distinct");
  const packet = readPrivateJson(packetPath, "private catalog packet");
  const approval = readPrivateJson(approvalPath, "private catalog approval");
  const capabilityContractRegistry = readCapabilityContractRegistry(environment);
  const result = validateCatalogPacket(packet, approval, nowMs, {
    capabilityContractRegistry,
  });
  assertCliRepositoryState(packet, gitRunner);
  process.stdout.write(
    `Billing catalog packet valid: schema=${result.schemaVersion} phase=${result.phase} ` +
      `target=${result.authorizedPlanTier ?? "none"} definitions=${result.commercialPlanDefinitionCount} ` +
      `packetSha256=${result.digest} approvalSha256=${result.approvalDigest} ` +
      `consumptionSha256=${result.consumptionDigest}\n`,
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
  CAPABILITY_AUTHORITY_PATH,
  CAPABILITY_CONTRACT_REGISTRY_ENV,
  PHASES,
  REPOSITORY_ROOT,
  TIERS,
  assertCliRepositoryState,
  assertPrivatePacketPath,
  digestApprovalEnvelope,
  digestCapabilityAttestation,
  digestCapabilityContractRegistry,
  digestCatalogPacket,
  digestCommercialTerms,
  digestOperationAuthorization,
  digestUsageBillingAttestation,
  gitChildEnvironment,
  readCapabilityContractRegistry,
  readCommittedCapabilityAuthority,
  run,
  validateCatalogPacket,
  validateSyntheticCatalogPacketStructure,
};
