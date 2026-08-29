"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CAPABILITY_AUTHORITY_PATH,
  PHASES,
  REPOSITORY_ROOT,
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
  validateCatalogPacket: validateCatalogPacketAgainstCommittedAuthority,
  validateSyntheticCatalogPacketStructure,
} = require("../../../tools/validate-private-catalog-packet");

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

function syntheticContractDigest(label) {
  return crypto.createHash("sha256").update(`synthetic:${label}`, "utf8").digest("hex");
}

function capabilityContractRegistry(phase) {
  const capability = PHASES[phase];
  const operations = {};
  for (const operation of [
    capability.writeOperation,
    capability.readbackOperation,
    capability.rollbackOperation,
  ]) {
    operations[operation] = {
      requestContractSha256: syntheticContractDigest(`${operation}:request`),
      responseContractSha256: syntheticContractDigest(`${operation}:response`),
    };
  }
  return {
    authorityScope: "synthetic_test_only",
    connector: "Synthetic Billing Changes",
    environment: "SYNTHETIC_TEST",
    operations,
    phase,
    schemaVersion: 1,
    source: "synthetic_test_fixture",
  };
}

function capabilityAttestation(phase, registry, organizationId = "101") {
  const capability = PHASES[phase];
  return {
    authorityScope: "synthetic_test_only",
    capturedAt: "2026-08-26T17:59:00.000Z",
    environment: "TEST",
    organizationId,
    phase,
    privateEvidenceSha256: "d".repeat(64),
    readback: {
      advertised: true,
      effectiveTenantAccessProven: true,
      operation: capability.readbackOperation,
      requiredFields: [...capability.requiredReadbackFields],
      requestContractSha256:
        registry.operations[capability.readbackOperation].requestContractSha256,
      responseContractSha256:
        registry.operations[capability.readbackOperation].responseContractSha256,
    },
    rollback: {
      advertised: true,
      effectiveTenantAccessProven: true,
      operation: capability.rollbackOperation,
      requestContractSha256:
        registry.operations[capability.rollbackOperation].requestContractSha256,
      responseContractSha256:
        registry.operations[capability.rollbackOperation].responseContractSha256,
    },
    schemaVersion: 1,
    source: "synthetic_test_fixture",
    write: {
      advertised: true,
      effectiveTenantAccessProven: true,
      operation: capability.writeOperation,
      requestContractSha256:
        registry.operations[capability.writeOperation].requestContractSha256,
      responseContractSha256:
        registry.operations[capability.writeOperation].responseContractSha256,
    },
  };
}

function usageBillingAttestation() {
  return {
    capturedAt: "2026-08-26T17:59:00.000Z",
    enterpriseEntitlementProven: true,
    environment: "TEST",
    feature: "usage_billing",
    organizationId: "101",
    privateEvidenceSha256: "c".repeat(64),
    schemaVersion: 1,
    source: "authenticated_billing_settings_ui",
    usageBillingEnabled: true,
    usageTrackingAddonControlAvailable: true,
  };
}

function completePage() {
  return { completePaginatedReadback: true, hasMore: false, pageCount: 1 };
}

function activeProductSnapshot(value) {
  return {
    description: value.product.description,
    name: value.product.name,
    notificationEmails: [...value.product.notificationEmails],
    organizationId: value.testOrganization.id,
    productId: value.product.testProductId,
    redirectUrl: value.product.redirectUrl,
    status: "active",
  };
}

function activePlanSnapshot(value, tier, planId) {
  return {
    ...structuredClone(value.plans[tier]),
    organizationId: value.testOrganization.id,
    planId,
    productId: value.product.testProductId,
    status: "active",
  };
}

function activeUsageAddonSnapshot(value) {
  return {
    addonId: "601",
    associatedPlanCodes: Object.keys(value.plans).map((tier) => value.plans[tier].code),
    code: value.usageAddon.code,
    currency: value.usageAddon.currency,
    interval: value.usageAddon.interval,
    intervalUnit: value.usageAddon.intervalUnit,
    isUsageSupported: value.usageAddon.isUsageSupported,
    name: value.usageAddon.name,
    organizationId: value.testOrganization.id,
    priceBrackets: structuredClone(value.usageAddon.priceBrackets),
    pricingScheme: value.usageAddon.pricingScheme,
    productId: value.product.testProductId,
    revenueAccountId: value.usageAddon.revenueAccountId,
    status: "active",
    taxId: value.usageAddon.taxId,
    type: value.usageAddon.type,
    unit: value.usageAddon.unit,
    usageTrackingMode: value.usageAddon.usageTrackingMode,
  };
}

function planInventory(value, presentTiers) {
  const planIds = { Launch: "501", Growth: "502", Scale: "503" };
  return Object.keys(value.plans).map((tier) => {
    if (!presentTiers.includes(tier)) {
      return {
        exactCodeMatchCount: 0,
        exactNameMatchCount: 0,
        matches: [],
        state: "missing",
        tier,
      };
    }
    return {
      exactCodeMatchCount: 1,
      exactNameMatchCount: 1,
      matches: [activePlanSnapshot(value, tier, planIds[tier])],
      state: "present_exact",
      tier,
    };
  });
}

function initialAmbiguityResolution() {
  return {
    privateEvidenceSha256: null,
    priorPacketSha256: null,
    resolvedAt: null,
    state: "none",
  };
}

function mutationPrestate(value) {
  const productPresent = value.phase !== "product";
  const presentTiers = value.phase === "usage_addon" ? Object.keys(value.plans) : [];
  return {
    ambiguityResolution: initialAmbiguityResolution(),
    capturedAt: "2026-08-26T17:59:00.000Z",
    catalogPages: {
      plans: value.phase === "product" ? null : completePage(),
      products: completePage(),
      usageAddons: value.phase === "usage_addon" ? completePage() : null,
    },
    environment: "TEST",
    organizationId: value.testOrganization.id,
    phase: value.phase,
    planInventory: value.phase === "product" ? [] : planInventory(value, presentTiers),
    privateEvidenceSha256: "9".repeat(64),
    productInventory: {
      exactNameMatchCount: productPresent ? 1 : 0,
      matches: productPresent ? [activeProductSnapshot(value)] : [],
      targetName: value.product.name,
    },
    retryAuthorized: false,
    schemaVersion: 2,
    usageAddonInventory: value.phase === "usage_addon" ? {
      exactCodeMatchCount: 0,
      exactNameMatchCount: 0,
      matches: [],
      targetCode: value.usageAddon.code,
      targetName: value.usageAddon.name,
    } : null,
  };
}

function packet(overrides = {}) {
  const phase = overrides.phase ?? "product";
  const targetPlanTier = phase === "plans" ? (overrides.targetPlanTier ?? "Launch") : null;
  const registry = capabilityContractRegistry(phase);
  const plans = {
    Launch: {
      billingCycles: -1, canChargeSetupFeeImmediately: false, code: "synthetic_launch",
      currency: "USD", interval: 1, intervalUnit: "months", name: "Launch — Monthly",
      recurringPriceMinor: 10101, revenueAccountId: null, setupFeeAccountId: null,
      setupFeeMinor: 40404, taxId: null, trialPeriod: 0, unit: null,
    },
    Growth: {
      billingCycles: -1, canChargeSetupFeeImmediately: false, code: "synthetic_growth",
      currency: "USD", interval: 1, intervalUnit: "months", name: "Growth — Monthly",
      recurringPriceMinor: 20202, revenueAccountId: null, setupFeeAccountId: null,
      setupFeeMinor: 50505, taxId: null, trialPeriod: 0, unit: null,
    },
    Scale: {
      billingCycles: -1, canChargeSetupFeeImmediately: false, code: "synthetic_scale",
      currency: "USD", interval: 1, intervalUnit: "months", name: "Scale — Monthly",
      recurringPriceMinor: 30303, revenueAccountId: null, setupFeeAccountId: null,
      setupFeeMinor: 60606, taxId: null, trialPeriod: 0, unit: null,
    },
  };
  const value = {
    approvedSourceRevision: "a".repeat(40),
    capabilityAttestation: capabilityAttestation(phase, registry),
    capabilityContractRegistrySha256: digestCapabilityContractRegistry(registry),
    environment: "Development",
    liveOrganization: {
      currency: "USD", id: "202", mode: "live", orgType: "live", subscriptionsOnly: false,
    },
    mutationPrestate: null,
    operationAuthorizationId: "11111111-1111-4111-8111-111111111111",
    phase,
    plans,
    product: {
      description: null,
      liveProductId: "303",
      name: "Revenue Desk",
      notificationEmails: [],
      redirectUrl: null,
      testProductId: phase === "product" ? null : "404",
    },
    readbackEvidenceSha256: "b".repeat(64),
    schemaVersion: 4,
    targetPlanTier,
    testOrganization: {
      currency: "USD", id: "101", mode: "test", orgType: "test", subscriptionsOnly: true,
    },
    usageAddon: {
      associatedPlanTiers: ["Launch", "Growth", "Scale"],
      code: "synthetic_usage",
      currency: "USD",
      description: null,
      interval: 1,
      intervalUnit: "months",
      isUsageSupported: true,
      liveProductId: "303",
      name: "Connected AI Minutes — Usage",
      priceBrackets: [{ priceMinor: 707, startQuantity: 1 }],
      pricingScheme: "unit",
      revenueAccountId: null,
      taxId: null,
      testProductId: phase === "product" ? null : "404",
      type: "recurring",
      unit: "minute",
      usageTrackingMode: "usage_billing",
    },
    usageBillingAttestation: phase === "usage_addon" ? usageBillingAttestation() : null,
  };
  value.mutationPrestate = mutationPrestate(value);
  return { ...value, ...overrides };
}

function approval(value, overrides = {}) {
  return {
    approvedSourceRevision: value.approvedSourceRevision,
    authorizedOperations: [...PHASES[value.phase].authorizedOperations],
    capturedAt: "2026-08-26T18:00:00.000Z",
    catalogMutationAuthorized: true,
    catalogPacketSha256: digestCatalogPacket(value),
    capabilityAttestationSha256: digestCapabilityAttestation(value.capabilityAttestation),
    capabilityContractRegistrySha256: value.capabilityContractRegistrySha256,
    commercialTermsSha256: digestCommercialTerms(value),
    executionConsumptionRequired: true,
    expiresAt: "2026-08-26T18:15:00.000Z",
    operationAuthorizationSha256: digestOperationAuthorization(value),
    readbackEvidenceSha256: value.readbackEvidenceSha256,
    schemaVersion: 4,
    singleUse: true,
    targetOrganizationId: value.testOrganization.id,
    usageBillingAttestationSha256: value.usageBillingAttestation === null
      ? null
      : digestUsageBillingAttestation(value.usageBillingAttestation),
    ...overrides,
  };
}

function validateCatalogPacket(value, envelope, nowMs = NOW_MS, registry) {
  const selectedRegistry = registry ?? (
    Object.hasOwn(PHASES, value.phase)
      ? capabilityContractRegistry(value.phase)
      : capabilityContractRegistry("product")
  );
  return validateSyntheticCatalogPacketStructure(value, envelope, nowMs, selectedRegistry);
}

test("validates one exact product packet and canonicalizes its digest", () => {
  const value = packet();
  const result = validateCatalogPacket(value, approval(value), NOW_MS);
  assert.equal(result.phase, "product");
  assert.equal(result.authorizedPlanTier, null);
  assert.equal(result.commercialPlanDefinitionCount, 3);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.equal(result.approvalDigest, digestApprovalEnvelope(approval(value)));
  assert.equal(result.consumptionDigest, digestOperationAuthorization(value));
  assert.equal(result.syntheticStructuralValidation, true);
  assert.equal(result.mutationAuthorization, false);
  const reordered = Object.fromEntries(Object.entries(value).reverse());
  assert.equal(digestCatalogPacket(reordered), result.digest);
});

test("product, plans, and usage-addon phases have independent exact bindings", () => {
  const productValue = packet();
  productValue.product.testProductId = "404";
  productValue.usageAddon.testProductId = "404";
  assert.throws(
    () => validateCatalogPacket(productValue, approval(productValue), NOW_MS),
    /absent product prestate cannot preclaim/,
  );

  const plansValue = packet({ phase: "plans" });
  const plansResult = validateCatalogPacket(plansValue, approval(plansValue), NOW_MS);
  assert.equal(plansResult.phase, "plans");
  assert.equal(plansResult.authorizedPlanTier, "Launch");
  plansValue.usageAddon.testProductId = "405";
  assert.throws(
    () => validateCatalogPacket(plansValue, approval(plansValue), NOW_MS),
    /TEST product binding differs/,
  );

  const usageValue = packet({ phase: "usage_addon" });
  assert.equal(validateCatalogPacket(usageValue, approval(usageValue), NOW_MS).phase, "usage_addon");
  const invalidPhase = packet();
  invalidPhase.phase = "bound";
  assert.throws(() => validateCatalogPacket(invalidPhase, {}, NOW_MS), /phase is invalid/);
});

test("product and usage-add-on creation require fresh complete target absence", () => {
  const incompleteProductRead = packet();
  incompleteProductRead.mutationPrestate.catalogPages.products.hasMore = true;
  assert.throws(
    () => validateCatalogPacket(incompleteProductRead, approval(incompleteProductRead), NOW_MS),
    /complete paginated readback/,
  );

  const existingProduct = packet();
  existingProduct.product.testProductId = "404";
  existingProduct.usageAddon.testProductId = "404";
  existingProduct.mutationPrestate.productInventory = {
    exactNameMatchCount: 1,
    matches: [activeProductSnapshot(existingProduct)],
    targetName: existingProduct.product.name,
  };
  existingProduct.mutationPrestate.ambiguityResolution = {
    privateEvidenceSha256: "9".repeat(64),
    priorPacketSha256: "7".repeat(64),
    resolvedAt: "2026-08-26T17:59:00.000Z",
    state: "resolved_existing_exact_after_ambiguous",
  };
  assert.throws(
    () => validateCatalogPacket(existingProduct, approval(existingProduct), NOW_MS),
    /target already exists/,
  );

  const incompleteAddonRead = packet({ phase: "usage_addon" });
  incompleteAddonRead.mutationPrestate.catalogPages.usageAddons.hasMore = true;
  assert.throws(
    () => validateCatalogPacket(incompleteAddonRead, approval(incompleteAddonRead), NOW_MS),
    /complete paginated readback/,
  );

  const existingAddon = packet({ phase: "usage_addon" });
  existingAddon.mutationPrestate.usageAddonInventory = {
    exactCodeMatchCount: 1,
    exactNameMatchCount: 1,
    matches: [activeUsageAddonSnapshot(existingAddon)],
    targetCode: existingAddon.usageAddon.code,
    targetName: existingAddon.usageAddon.name,
  };
  existingAddon.mutationPrestate.ambiguityResolution = {
    privateEvidenceSha256: "9".repeat(64),
    priorPacketSha256: "7".repeat(64),
    resolvedAt: "2026-08-26T17:59:00.000Z",
    state: "resolved_existing_exact_after_ambiguous",
  };
  assert.throws(
    () => validateCatalogPacket(existingAddon, approval(existingAddon), NOW_MS),
    /target already exists/,
  );
});

test("usage add-on requires three concrete exact unique active plan dependencies", () => {
  const missingPlan = packet({ phase: "usage_addon" });
  missingPlan.mutationPrestate.planInventory[2] = {
    exactCodeMatchCount: 0,
    exactNameMatchCount: 0,
    matches: [],
    state: "missing",
    tier: "Scale",
  };
  assert.throws(
    () => validateCatalogPacket(missingPlan, approval(missingPlan), NOW_MS),
    /requires all three exact active TEST plans/,
  );

  const driftedPlan = packet({ phase: "usage_addon" });
  driftedPlan.mutationPrestate.planInventory[0].matches[0].recurringPriceMinor += 1;
  assert.throws(
    () => validateCatalogPacket(driftedPlan, approval(driftedPlan), NOW_MS),
    /does not match the exact Launch definition/,
  );

  const duplicatePlanId = packet({ phase: "usage_addon" });
  duplicatePlanId.mutationPrestate.planInventory[1].matches[0].planId =
    duplicatePlanId.mutationPrestate.planInventory[0].matches[0].planId;
  assert.throws(
    () => validateCatalogPacket(duplicatePlanId, approval(duplicatePlanId), NOW_MS),
    /plan IDs must be unique/,
  );
});

test("plans phase authorizes one fresh missing tier and never a bulk or retry operation", () => {
  const launch = packet({ phase: "plans", targetPlanTier: "Launch" });
  const launchResult = validateCatalogPacket(launch, approval(launch), NOW_MS);
  assert.equal(launchResult.authorizedPlanTier, "Launch");
  assert.deepEqual(PHASES.plans.authorizedOperations, ["create_test_plan"]);

  for (const mutate of [
    (value) => { value.mutationPrestate.planInventory[0].exactCodeMatchCount = 1; },
    (value) => { value.mutationPrestate.planInventory[0].exactNameMatchCount = 1; },
    (value) => { value.mutationPrestate.retryAuthorized = true; },
    (value) => { value.mutationPrestate.catalogPages.plans.hasMore = true; },
    (value) => { value.mutationPrestate.capturedAt = "2026-08-26T17:49:59.999Z"; },
  ]) {
    const invalid = packet({ phase: "plans", targetPlanTier: "Launch" });
    mutate(invalid);
    assert.throws(
      () => validateCatalogPacket(invalid, approval(invalid), NOW_MS),
      /mutationPrestate|stale|collision|paginated/,
    );
  }

  const afterLaunch = packet({ phase: "plans", targetPlanTier: "Growth" });
  afterLaunch.mutationPrestate.planInventory = planInventory(afterLaunch, ["Launch"]);
  assert.equal(
    validateCatalogPacket(afterLaunch, approval(afterLaunch), NOW_MS).authorizedPlanTier,
    "Growth",
  );

  const repeatLaunch = packet({ phase: "plans", targetPlanTier: "Launch" });
  repeatLaunch.mutationPrestate.planInventory = planInventory(repeatLaunch, ["Launch"]);
  assert.throws(
    () => validateCatalogPacket(repeatLaunch, approval(repeatLaunch), NOW_MS),
    /target already exists/,
  );

  assert.throws(
    () => validateCatalogPacket(afterLaunch, approval(launch), NOW_MS),
    /private catalog approval/,
  );
});

test("a fresh operation can follow only an authoritatively resolved ambiguous outcome", () => {
  const resolvedAbsent = packet({ phase: "plans", targetPlanTier: "Launch" });
  resolvedAbsent.operationAuthorizationId = "22222222-2222-4222-8222-222222222222";
  resolvedAbsent.mutationPrestate.ambiguityResolution = {
    privateEvidenceSha256: "9".repeat(64),
    priorPacketSha256: "7".repeat(64),
    resolvedAt: "2026-08-26T17:59:00.000Z",
    state: "resolved_absent_after_ambiguous",
  };
  const result = validateCatalogPacket(resolvedAbsent, approval(resolvedAbsent), NOW_MS);
  assert.equal(result.authorizedPlanTier, "Launch");

  const unresolvedMismatch = structuredClone(resolvedAbsent);
  unresolvedMismatch.mutationPrestate.ambiguityResolution.state =
    "resolved_existing_exact_after_ambiguous";
  assert.throws(
    () => validateCatalogPacket(unresolvedMismatch, approval(unresolvedMismatch), NOW_MS),
    /conflicts with authoritative current inventory/,
  );

  const mismatchedResolutionEvidence = structuredClone(resolvedAbsent);
  mismatchedResolutionEvidence.mutationPrestate.ambiguityResolution.privateEvidenceSha256 =
    "8".repeat(64);
  assert.throws(
    () => validateCatalogPacket(
      mismatchedResolutionEvidence,
      approval(mismatchedResolutionEvidence),
      NOW_MS,
    ),
    /same authoritative current inventory readback/,
  );

  const staleResolution = structuredClone(resolvedAbsent);
  staleResolution.mutationPrestate.ambiguityResolution.resolvedAt =
    "2026-08-26T17:49:59.999Z";
  assert.throws(
    () => validateCatalogPacket(staleResolution, approval(staleResolution), NOW_MS),
    /ambiguityResolution is stale/,
  );

  const retryFlag = structuredClone(resolvedAbsent);
  retryFlag.mutationPrestate.retryAuthorized = true;
  assert.throws(
    () => validateCatalogPacket(retryFlag, approval(retryFlag), NOW_MS),
    /mutationPrestate is not exact/,
  );
});

test("requires schema v4 and the recurring Usage Billing provider contract", () => {
  const oldSchema = packet();
  oldSchema.schemaVersion = 2;
  assert.throws(
    () => validateCatalogPacket(oldSchema, approval(oldSchema), NOW_MS),
    /schemaVersion must be 4/,
  );
  const currentSchema = packet();
  assert.throws(
    () => validateCatalogPacket(currentSchema, approval(currentSchema, { schemaVersion: 3 }), NOW_MS),
    /approval\.schemaVersion must be 4/,
  );

  const usageProofAbsent = packet({ phase: "usage_addon" });
  delete usageProofAbsent.usageAddon.isUsageSupported;
  assert.throws(
    () => validateCatalogPacket(usageProofAbsent, approval(usageProofAbsent), NOW_MS),
    /usageAddon fields are not exact/,
  );

  for (const usageOverride of [
    { type: "one_time" },
    { isUsageSupported: false },
    { usageTrackingMode: "metered_billing" },
    { interval: 2 },
    { intervalUnit: "years" },
    { pricingScheme: "volume" },
  ]) {
    const value = packet({ phase: "usage_addon" });
    Object.assign(value.usageAddon, usageOverride);
    assert.throws(
      () => validateCatalogPacket(value, approval(value), NOW_MS),
      /usageAddon contract drifted/,
    );
  }
});

test("requires a fresh entitled Usage Billing UI attestation only for the add-on phase", () => {
  const nonAddon = packet();
  nonAddon.usageBillingAttestation = usageBillingAttestation();
  assert.throws(
    () => validateCatalogPacket(nonAddon, approval(nonAddon), NOW_MS),
    /permitted only for the usage_addon phase/,
  );

  for (const attestationOverride of [
    { environment: "LIVE" },
    { source: "organization_connector" },
    { feature: "metered_billing" },
    { usageBillingEnabled: false },
    { usageTrackingAddonControlAvailable: false },
    { enterpriseEntitlementProven: false },
    { organizationId: "202" },
    { privateEvidenceSha256: "not-a-digest" },
    { capturedAt: "2026-08-26T17:49:59.999Z" },
  ]) {
    const value = packet({ phase: "usage_addon" });
    Object.assign(value.usageBillingAttestation, attestationOverride);
    assert.throws(
      () => validateCatalogPacket(value, approval(value), NOW_MS),
      /attestation|Attestation|Usage Billing/,
    );
  }

  const legacyShape = packet({ phase: "usage_addon" });
  delete legacyShape.usageBillingAttestation.feature;
  legacyShape.usageBillingAttestation.meteredBillingEnabled = true;
  assert.throws(
    () => validateCatalogPacket(legacyShape, approval(legacyShape), NOW_MS),
    /fields are not exact/,
  );

  const afterApproval = packet({ phase: "usage_addon" });
  afterApproval.usageBillingAttestation.capturedAt = "2026-08-26T18:00:00.001Z";
  assert.throws(
    () => validateCatalogPacket(afterApproval, approval(afterApproval), NOW_MS),
    /captured after approval/,
  );

  const unbound = packet({ phase: "usage_addon" });
  assert.throws(() => validateCatalogPacket(unbound, approval(unbound, {
    usageBillingAttestationSha256: "0".repeat(64),
  }), NOW_MS), /does not bind the exact Usage Billing UI attestation/);
});

test("digests bind defaults, usage support, and Usage Billing evidence", () => {
  const baseline = packet({ phase: "usage_addon" });
  const defaultDrift = structuredClone(baseline);
  defaultDrift.plans.Growth.canChargeSetupFeeImmediately = true;
  assert.notEqual(digestCommercialTerms(defaultDrift), digestCommercialTerms(baseline));
  assert.notEqual(digestCatalogPacket(defaultDrift), digestCatalogPacket(baseline));

  const usageDrift = structuredClone(baseline);
  usageDrift.usageAddon.isUsageSupported = false;
  assert.notEqual(digestCommercialTerms(usageDrift), digestCommercialTerms(baseline));
  assert.notEqual(digestCatalogPacket(usageDrift), digestCatalogPacket(baseline));

  const evidenceDrift = structuredClone(baseline);
  evidenceDrift.usageBillingAttestation.privateEvidenceSha256 = "4".repeat(64);
  assert.equal(digestCommercialTerms(evidenceDrift), digestCommercialTerms(baseline));
  assert.notEqual(digestCatalogPacket(evidenceDrift), digestCatalogPacket(baseline));
  assert.notEqual(
    digestUsageBillingAttestation(evidenceDrift.usageBillingAttestation),
    digestUsageBillingAttestation(baseline.usageBillingAttestation),
  );
});

test("committed capability authority rejects absent and caller-substituted registries", () => {
  const value = packet();
  const committedAuthority = readCommittedCapabilityAuthority();
  assert.equal(committedAuthority.executable, false);
  assert.equal(committedAuthority.registrySha256, null);
  assert.throws(
    () => validateCatalogPacketAgainstCommittedAuthority(value, approval(value), NOW_MS, {
      capabilityContractRegistry: capabilityContractRegistry("product"),
    }),
    /committed capability authority blocks catalog mutation/,
  );

  const substitutedRegistry = capabilityContractRegistry("product");
  substitutedRegistry.operations.create_test_product.requestContractSha256 = "7".repeat(64);
  value.capabilityContractRegistrySha256 = digestCapabilityContractRegistry(substitutedRegistry);
  value.capabilityAttestation.write.requestContractSha256 = "7".repeat(64);
  assert.throws(
    () => validateCatalogPacketAgainstCommittedAuthority(value, approval(value), NOW_MS, {
      capabilityContractRegistry: substitutedRegistry,
    }),
    /committed capability authority blocks catalog mutation/,
  );
  assert.throws(
    () => readCapabilityContractRegistry({}),
    /capability contract registry is not configured/,
  );
  assert.throws(
    () => readCapabilityContractRegistry({
      BILLING_CATALOG_CAPABILITY_CONTRACTS_JSON: "{",
    }),
    /not valid JSON/,
  );
});

test("every JSON trust boundary rejects duplicate authorization keys at any depth", (t) => {
  assert.throws(
    () => readCapabilityContractRegistry({
      BILLING_CATALOG_CAPABILITY_CONTRACTS_JSON:
        '{"phase":"product","phase":"plans"}',
    }),
    /capability contract registry contains duplicate object keys/,
  );
  assert.throws(
    () => readCapabilityContractRegistry({
      BILLING_CATALOG_CAPABILITY_CONTRACTS_JSON:
        '{"operations":{"create_test_product":{' +
        '"requestContractSha256":"first","requestContractSha256":"second"}}}',
    }),
    /capability contract registry contains duplicate object keys/,
  );

  const originalReadFileSync = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (filePath, ...args) => {
    if (filePath === CAPABILITY_AUTHORITY_PATH) {
      return '{"executable":false,"registrySha256":null,' +
        '"registrySha256":"caller-replacement","schemaVersion":1,"status":"blocked"}';
    }
    return originalReadFileSync(filePath, ...args);
  });
  assert.throws(
    () => readCommittedCapabilityAuthority(),
    /committed catalog capability authority contains duplicate object keys/,
  );
});

test("matches each typed operation to configured request and response contract digests", () => {
  for (const phase of Object.keys(PHASES)) {
    const value = packet({ phase });
    assert.equal(validateCatalogPacket(value, approval(value), NOW_MS).phase, phase);
    for (const edge of ["write", "readback", "rollback"]) {
      const absent = structuredClone(value);
      absent.capabilityAttestation[edge].advertised = false;
      assert.throws(
        () => validateCatalogPacket(absent, approval(absent), NOW_MS),
        /exact effective typed connector capability/,
      );
      const inaccessible = structuredClone(value);
      inaccessible.capabilityAttestation[edge].effectiveTenantAccessProven = false;
      assert.throws(
        () => validateCatalogPacket(inaccessible, approval(inaccessible), NOW_MS),
        /exact effective typed connector capability/,
      );
    }
    const incompleteReadback = structuredClone(value);
    incompleteReadback.capabilityAttestation.readback.requiredFields.pop();
    assert.throws(
      () => validateCatalogPacket(incompleteReadback, approval(incompleteReadback), NOW_MS),
      /complete normalized response/,
    );
    const wrongRollback = structuredClone(value);
    wrongRollback.capabilityAttestation.rollback.operation = "delete_test_catalog";
    assert.throws(
      () => validateCatalogPacket(wrongRollback, approval(wrongRollback), NOW_MS),
      /exact effective typed connector capability/,
    );

    const arbitraryPacketHash = structuredClone(value);
    arbitraryPacketHash.capabilityAttestation.write.requestContractSha256 = "0".repeat(64);
    assert.throws(
      () => validateCatalogPacket(
        arbitraryPacketHash,
        approval(arbitraryPacketHash),
        NOW_MS,
      ),
      /does not match the reviewed contract/,
    );

    const arbitraryRegistryDigest = structuredClone(value);
    arbitraryRegistryDigest.capabilityContractRegistrySha256 = "0".repeat(64);
    assert.throws(
      () => validateCatalogPacket(
        arbitraryRegistryDigest,
        approval(arbitraryRegistryDigest),
        NOW_MS,
      ),
      /registry digest does not match the reviewed contract/,
    );
  }
});

test("rejects commercial drift, code collisions, unknown fields, and Production", () => {
  const productSideEffect = packet();
  productSideEffect.product.notificationEmails = ["synthetic@example.com"];
  assert.throws(
    () => validateCatalogPacket(productSideEffect, approval(productSideEffect), NOW_MS),
    /product definition drifted/,
  );

  const planDefaultDrift = packet({ phase: "plans" });
  planDefaultDrift.plans.Launch.billingCycles = 12;
  assert.throws(
    () => validateCatalogPacket(planDefaultDrift, approval(planDefaultDrift), NOW_MS),
    /commercial terms drifted/,
  );

  const priceDrift = packet();
  const approvedTerms = approval(priceDrift);
  priceDrift.plans.Growth.recurringPriceMinor = 1;
  assert.throws(() => validateCatalogPacket(priceDrift, approvedTerms, NOW_MS), /private catalog approval/);

  const collision = packet();
  collision.usageAddon.code = collision.plans.Launch.code;
  assert.throws(() => validateCatalogPacket(collision, approval(collision), NOW_MS), /collides/);

  const unexpected = { ...packet(), unexpected: true };
  assert.throws(() => validateCatalogPacket(unexpected, approval(unexpected), NOW_MS), /fields are not exact/);
  const production = packet({ environment: "Production" });
  assert.throws(() => validateCatalogPacket(production, approval(production), NOW_MS), /Development/);
  const value = packet();
  assert.throws(() => validateCatalogPacket(value, approval(value, {
    commercialTermsSha256: "0".repeat(64),
  }), NOW_MS), /private catalog approval/);
});

test("approval binds organizations, product IDs, codes, phase, and all commercial terms", () => {
  const approved = packet({ phase: "plans" });
  const envelope = approval(approved);

  const redirectedOrganization = structuredClone(approved);
  redirectedOrganization.testOrganization.id = "909";
  redirectedOrganization.capabilityAttestation.organizationId = "909";
  redirectedOrganization.mutationPrestate.organizationId = "909";
  redirectedOrganization.mutationPrestate.productInventory.matches[0].organizationId = "909";
  assert.throws(
    () => validateCatalogPacket(redirectedOrganization, envelope, NOW_MS),
    /does not bind the exact catalog capability attestation/,
  );

  const redirectedProduct = structuredClone(approved);
  redirectedProduct.product.testProductId = "505";
  redirectedProduct.mutationPrestate.productInventory.matches[0].productId = "505";
  redirectedProduct.usageAddon.testProductId = "505";
  assert.throws(
    () => validateCatalogPacket(redirectedProduct, envelope, NOW_MS),
    /private catalog approval/,
  );

  const changedCode = structuredClone(approved);
  changedCode.plans.Launch.code = "synthetic_launch_changed";
  assert.throws(() => validateCatalogPacket(changedCode, envelope, NOW_MS), /private catalog approval/);
});

test("requires a Billing-only TEST target and the Books-integrated live catalog reference", () => {
  const value = packet();
  assert.equal(validateCatalogPacket(value, approval(value), NOW_MS).phase, "product");

  const joinedTest = structuredClone(value);
  joinedTest.testOrganization.subscriptionsOnly = false;
  assert.throws(
    () => validateCatalogPacket(joinedTest, approval(joinedTest), NOW_MS),
    /testOrganization ownership is not exact/,
  );

  const falselyIsolatedLive = structuredClone(value);
  falselyIsolatedLive.liveOrganization.subscriptionsOnly = true;
  assert.throws(
    () => validateCatalogPacket(falselyIsolatedLive, approval(falselyIsolatedLive), NOW_MS),
    /liveOrganization ownership is not exact/,
  );
});

test("approval authorizes only the exact phase-specific TEST catalog mutations", () => {
  const value = packet();
  const envelope = approval(value);
  assert.throws(() => validateCatalogPacket(value, {
    ...envelope,
    targetOrganizationId: value.liveOrganization.id,
  }, NOW_MS), /TEST-only operation/);
  assert.throws(() => validateCatalogPacket(value, {
    ...envelope,
    authorizedOperations: ["create_test_product", "create_test_plan"],
  }, NOW_MS), /TEST-only operation/);
  assert.throws(() => validateCatalogPacket(value, {
    ...envelope,
    catalogMutationAuthorized: false,
  }, NOW_MS), /TEST-only operation/);
});

test("operation authorization consumption remains stable across approval reissuance", () => {
  const value = packet();
  const envelope = approval(value);
  const first = validateCatalogPacket(value, envelope, NOW_MS);
  const second = validateCatalogPacket(value, envelope, NOW_MS);
  assert.equal(first.phase, "product");
  assert.equal(first.approvalDigest, second.approvalDigest);
  assert.equal(first.approvalDigest, digestApprovalEnvelope(envelope));
  assert.equal(first.consumptionDigest, digestOperationAuthorization(value));
  assert.equal(first.operationAuthorizationId, value.operationAuthorizationId);

  const reissuedEnvelope = approval(value, {
    capturedAt: "2026-08-26T18:01:00.000Z",
    expiresAt: "2026-08-26T18:15:00.000Z",
  });
  const reissued = validateCatalogPacket(value, reissuedEnvelope, NOW_MS);
  assert.notEqual(reissued.approvalDigest, first.approvalDigest);
  assert.equal(reissued.consumptionDigest, first.consumptionDigest);

  const conflictingPacketForSameAuthorization = structuredClone(value);
  conflictingPacketForSameAuthorization.readbackEvidenceSha256 = "6".repeat(64);
  const conflictingResult = validateCatalogPacket(
    conflictingPacketForSameAuthorization,
    approval(conflictingPacketForSameAuthorization),
    NOW_MS,
  );
  assert.notEqual(conflictingResult.digest, first.digest);
  assert.equal(
    conflictingResult.operationAuthorizationId,
    first.operationAuthorizationId,
    "the durable ledger UNIQUE key must conflict for the reused authority ID",
  );
  assert.notEqual(
    conflictingResult.consumptionDigest,
    first.consumptionDigest,
    "the conflicting ledger record must expose changed packet authorization bytes",
  );

  const freshOperation = structuredClone(value);
  freshOperation.operationAuthorizationId = "22222222-2222-4222-8222-222222222222";
  const freshResult = validateCatalogPacket(
    freshOperation,
    approval(freshOperation),
    NOW_MS,
  );
  assert.notEqual(freshResult.operationAuthorizationId, first.operationAuthorizationId);
  assert.notEqual(freshResult.consumptionDigest, first.consumptionDigest);
  assert.throws(
    () => validateCatalogPacket(value, approval(value, {
      operationAuthorizationSha256: "0".repeat(64),
    }), NOW_MS),
    /private catalog approval/,
  );
  assert.throws(
    () => validateCatalogPacket(value, approval(value, {
      expiresAt: "2026-08-26T18:05:00.000Z",
    }), NOW_MS),
    /expired/,
  );
  assert.throws(
    () => validateCatalogPacket(value, approval(value, {
      capturedAt: "2026-08-26T18:05:00.001Z",
    }), NOW_MS),
    /not yet valid/,
  );
  assert.throws(
    () => validateCatalogPacket(value, approval(value, {
      expiresAt: "2026-08-26T18:15:00.001Z",
    }), NOW_MS),
    /no longer than 15 minutes/,
  );
  assert.throws(
    () => validateCatalogPacket(value, approval(value, { singleUse: false }), NOW_MS),
    /single-use intent/,
  );
  assert.throws(
    () => validateCatalogPacket(value, approval(value, {
      executionConsumptionRequired: false,
    }), NOW_MS),
    /durable executor consumption/,
  );
});

test("CLI binds the packet to current committed source and a clean package", () => {
  const value = packet();
  const cleanGit = (_command, args) => {
    if (args.includes("rev-parse")) return `${value.approvedSourceRevision}\n`;
    if (args.includes("status")) return "";
    if (args.includes("ls-files")) {
      return "H src/zoho-catalyst/crm-billing-orchestrator/README.md\n";
    }
    throw new Error("unexpected git operation");
  };
  assert.equal(assertCliRepositoryState(value, cleanGit), value.approvedSourceRevision);

  const differentHead = (_command, args) => {
    if (args.includes("rev-parse")) return `${"b".repeat(40)}\n`;
    return "";
  };
  assert.throws(
    () => assertCliRepositoryState(value, differentHead),
    /does not match current committed source/,
  );

  const dirtyPackage = (_command, args) => {
    if (args.includes("rev-parse")) return `${value.approvedSourceRevision}\n`;
    return " M src\/zoho-catalyst\/crm-billing-orchestrator\/README.md\n";
  };
  assert.throws(
    () => assertCliRepositoryState(value, dirtyPackage),
    /package must be clean/,
  );

  for (const hiddenTag of ["h", "S"]) {
    const hiddenTrackedState = (_command, args) => {
      if (args.includes("rev-parse")) return `${value.approvedSourceRevision}\n`;
      if (args.includes("status")) return "";
      if (args.includes("ls-files")) {
        return `${hiddenTag} src/zoho-catalyst/crm-billing-orchestrator/README.md\n`;
      }
      throw new Error("unexpected git operation");
    };
    assert.throws(
      () => assertCliRepositoryState(value, hiddenTrackedState),
      /hidden tracked-file state/,
    );
  }
});

test("Git child environment rejects caller repository, index, object, and config overrides", () => {
  const sanitized = gitChildEnvironment({
    GIT_ALTERNATE_OBJECT_DIRECTORIES: "poison-objects",
    GIT_COMMON_DIR: "poison-common",
    GIT_CONFIG: "poison-config",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_GLOBAL: "poison-global",
    GIT_CONFIG_KEY_0: "core.worktree",
    GIT_CONFIG_SYSTEM: "poison-system",
    GIT_CONFIG_VALUE_0: "poison-worktree",
    GIT_DIR: "poison-dir",
    GIT_INDEX_FILE: "poison-index",
    GIT_OBJECT_DIRECTORY: "poison-object-directory",
    GIT_OPTIONAL_LOCKS: "1",
    GIT_WORK_TREE: "poison-worktree",
    PATH: "synthetic-path",
  });
  assert.deepEqual(sanitized, {
    GIT_OPTIONAL_LOCKS: "0",
    PATH: "synthetic-path",
  });
});

test("private packet path must remain outside and not resolve into the public repository", (t) => {
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
  const external = path.join(os.tmpdir(), `sylvara-private-catalog-${process.pid}.json`);
  fs.writeFileSync(external, "{}\n", "utf8");
  try {
    assert.equal(assertPrivatePacketPath(external), fs.realpathSync(external));
    const repositoryFile = path.join(REPOSITORY_ROOT, "README.md");
    const linked = path.join(os.tmpdir(), `sylvara-private-catalog-link-${process.pid}.json`);
    fs.rmSync(linked, { force: true });
    t.after(() => fs.rmSync(linked, { force: true }));
    try {
      fs.symlinkSync(repositoryFile, linked, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return;
      throw error;
    }
    assert.throws(() => assertPrivatePacketPath(linked), /outside the public repository/);
  } finally {
    fs.rmSync(external, { force: true });
  }
});

test("private packet and approval files are distinct, bounded, regular, and unaliased", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), `sylvara-private-catalog-boundary-${process.pid}-`),
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));

  const packetPath = path.join(directory, "packet.json");
  fs.writeFileSync(packetPath, "{}\n", "utf8");
  const sameFileAlias = `${directory}${path.sep}.${path.sep}packet.json`;
  assert.notEqual(sameFileAlias, packetPath);
  assert.throws(
    () => run([packetPath, sameFileAlias], NOW_MS, {}),
    /packet and approval files must be distinct/,
  );

  const emptyPath = path.join(directory, "empty.json");
  fs.writeFileSync(emptyPath, "", "utf8");
  assert.throws(() => assertPrivatePacketPath(emptyPath), /size or type is invalid/);
  assert.throws(() => assertPrivatePacketPath(directory), /size or type is invalid/);

  const oversizedPath = path.join(directory, "oversized.json");
  fs.writeFileSync(oversizedPath, Buffer.alloc((1024 * 1024) + 1, 0x20));
  assert.throws(() => assertPrivatePacketPath(oversizedPath), /size or type is invalid/);

  const hardLinkAlias = path.join(directory, "packet-hard-link.json");
  fs.linkSync(packetPath, hardLinkAlias);
  assert.throws(
    () => assertPrivatePacketPath(packetPath),
    /must not have hard-link aliases/,
  );
  assert.throws(
    () => assertPrivatePacketPath(hardLinkAlias),
    /must not have hard-link aliases/,
  );
});

test("CLI never echoes malformed private JSON or its path", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), `sylvara-private-catalog-json-${process.pid}-`),
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const packetPath = path.join(directory, "packet.json");
  const approvalPath = path.join(directory, "approval.json");
  const cliPath = path.resolve(
    __dirname,
    "../../../tools/validate-private-catalog-packet.js",
  );
  const canary = "PRIVATE-CATALOG-PARSE-CANARY";
  const cases = [
    {
      packet: `{\"private\":\"${canary}\",`,
      approval: "{}",
      expected: "Billing catalog packet rejected: private catalog packet is not valid JSON\n",
    },
    {
      packet: "{}",
      approval: `{\"private\":\"${canary}\",`,
      expected: "Billing catalog packet rejected: private catalog approval is not valid JSON\n",
    },
    {
      packet: `{"approvedSourceRevision":"${"a".repeat(40)}",` +
        `"approvedSourceRevision":"${canary}"}`,
      approval: "{}",
      expected:
        "Billing catalog packet rejected: private catalog packet contains duplicate object keys\n",
    },
    {
      packet: "{}",
      approval: `{"target":{"organizationId":"101",` +
        `"organization\\u0049d":"${canary}"}}`,
      expected:
        "Billing catalog packet rejected: private catalog approval contains duplicate object keys\n",
    },
  ];
  for (const value of cases) {
    fs.writeFileSync(packetPath, value.packet, "utf8");
    fs.writeFileSync(approvalPath, value.approval, "utf8");
    const result = spawnSync(process.execPath, [cliPath, packetPath, approvalPath], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, value.expected);
    assert.doesNotMatch(result.stderr, new RegExp(canary));
    assert.doesNotMatch(result.stderr, new RegExp(directory.replaceAll("\\", "\\\\")));
  }
});
