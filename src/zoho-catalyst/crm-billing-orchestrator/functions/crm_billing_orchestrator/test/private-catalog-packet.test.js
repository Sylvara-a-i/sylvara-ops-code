"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REPOSITORY_ROOT,
  assertPrivatePacketPath,
  digestCatalogPacket,
  digestCommercialTerms,
  validateCatalogPacket,
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

function packet(overrides = {}) {
  const plans = {
    Launch: {
      code: "synthetic_launch", currency: "USD", interval: 1, intervalUnit: "months",
      name: "Launch — Monthly", recurringPriceMinor: 10101, setupFeeMinor: 40404, trialPeriod: 0,
    },
    Growth: {
      code: "synthetic_growth", currency: "USD", interval: 1, intervalUnit: "months",
      name: "Growth — Monthly", recurringPriceMinor: 20202, setupFeeMinor: 50505, trialPeriod: 0,
    },
    Scale: {
      code: "synthetic_scale", currency: "USD", interval: 1, intervalUnit: "months",
      name: "Scale — Monthly", recurringPriceMinor: 30303, setupFeeMinor: 60606, trialPeriod: 0,
    },
  };
  return {
    approvedSourceRevision: "a".repeat(40),
    environment: "Development",
    liveOrganization: {
      currency: "USD", id: "202", mode: "live", orgType: "live", subscriptionsOnly: true,
    },
    phase: "definition",
    plans,
    product: { liveProductId: "303", name: "Revenue Desk", testProductId: null },
    readbackEvidenceSha256: "b".repeat(64),
    schemaVersion: 1,
    testOrganization: {
      currency: "USD", id: "101", mode: "test", orgType: "test", subscriptionsOnly: true,
    },
    usageAddon: {
      associatedPlanTiers: ["Launch", "Growth", "Scale"],
      code: "synthetic_usage",
      currency: "USD",
      interval: 1,
      intervalUnit: "months",
      liveProductId: "303",
      name: "Connected AI Minutes — Usage",
      priceBrackets: [{ priceMinor: 707, startQuantity: 1 }],
      pricingScheme: "unit",
      testProductId: null,
      type: "usage",
      unit: "minute",
    },
    ...overrides,
  };
}

function approval(value, overrides = {}) {
  return {
    approvedSourceRevision: value.approvedSourceRevision,
    authorizedOperations: value.phase === "definition"
      ? ["create_test_product"]
      : ["create_test_plans", "create_test_usage_addon"],
    capturedAt: "2026-08-26T18:00:00.000Z",
    catalogMutationAuthorized: true,
    catalogPacketSha256: digestCatalogPacket(value),
    commercialTermsSha256: digestCommercialTerms(value),
    expiresAt: "2026-08-26T18:15:00.000Z",
    readbackEvidenceSha256: value.readbackEvidenceSha256,
    schemaVersion: 1,
    singleUse: true,
    targetOrganizationId: value.testOrganization.id,
    ...overrides,
  };
}

test("validates one exact definition packet and canonicalizes its digest", () => {
  const value = packet();
  const result = validateCatalogPacket(value, approval(value), NOW_MS);
  assert.equal(result.phase, "definition");
  assert.equal(result.planCount, 3);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  const reordered = Object.fromEntries(Object.entries(value).reverse());
  assert.equal(digestCatalogPacket(reordered), result.digest);
});

test("bound phase requires one exact TEST product binding", () => {
  const value = packet({ phase: "bound" });
  assert.throws(() => validateCatalogPacket(value, approval(value), NOW_MS), /product\.testProductId/);
  value.product.testProductId = "404";
  value.usageAddon.testProductId = "404";
  assert.equal(validateCatalogPacket(value, approval(value), NOW_MS).phase, "bound");
  value.usageAddon.testProductId = "405";
  assert.throws(() => validateCatalogPacket(value, approval(value), NOW_MS), /TEST product binding differs/);
});

test("rejects commercial drift, code collisions, unknown fields, and Production", () => {
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
  const approved = packet({ phase: "bound" });
  approved.product.testProductId = "404";
  approved.usageAddon.testProductId = "404";
  const envelope = approval(approved);

  const redirectedOrganization = structuredClone(approved);
  redirectedOrganization.testOrganization.id = "909";
  assert.throws(
    () => validateCatalogPacket(redirectedOrganization, envelope, NOW_MS),
    /private catalog approval/,
  );

  const redirectedProduct = structuredClone(approved);
  redirectedProduct.product.testProductId = "505";
  redirectedProduct.usageAddon.testProductId = "505";
  assert.throws(
    () => validateCatalogPacket(redirectedProduct, envelope, NOW_MS),
    /private catalog approval/,
  );

  const changedCode = structuredClone(approved);
  changedCode.plans.Launch.code = "synthetic_launch_changed";
  assert.throws(() => validateCatalogPacket(changedCode, envelope, NOW_MS), /private catalog approval/);
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
    authorizedOperations: ["create_test_product", "create_test_plans"],
  }, NOW_MS), /TEST-only operation/);
  assert.throws(() => validateCatalogPacket(value, {
    ...envelope,
    catalogMutationAuthorized: false,
  }, NOW_MS), /TEST-only operation/);
});

test("catalog approval is single-use and valid only inside a maximum 15-minute window", () => {
  const value = packet();
  assert.equal(validateCatalogPacket(value, approval(value), NOW_MS).phase, "definition");
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
    /single-use/,
  );
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
