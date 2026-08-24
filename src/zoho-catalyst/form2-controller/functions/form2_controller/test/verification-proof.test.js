"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  VerificationProofError,
  createDenyAllVerificationProofStore,
  requireAllFactorsVerified,
} = require("../lib/verification-proof");

const NOW_MS = Date.parse("2026-08-14T18:10:00.000Z");
const binding = Object.freeze({
  sessionRowId: "7000000000001",
  tokenHash: "a".repeat(64),
  crmContactId: `${"9".repeat(17)}1`,
  crmAccountId: `${"9".repeat(17)}2`,
  crmDealId: `${"9".repeat(17)}3`,
  issuedAt: "2026-08-14T18:00:00.000Z",
  expiresAt: "2026-08-14T19:00:00.000Z",
});

function proof(overrides = {}) {
  return {
    status: "all_factors_verified",
    sessionRowId: binding.sessionRowId,
    tokenHash: binding.tokenHash,
    crmContactId: binding.crmContactId,
    crmAccountId: binding.crmAccountId,
    crmDealId: binding.crmDealId,
    emailOtpVerifiedAt: "2026-08-14T18:05:00.000Z",
    captchaVerifiedAt: "2026-08-14T18:07:00.000Z",
    verifiedAt: "2026-08-14T18:07:00.000Z",
    expiresAt: "2026-08-14T18:30:00.000Z",
    ...overrides,
  };
}

test("accepts only unexpired email OTP and CAPTCHA proof bound to one session", async () => {
  const selected = await requireAllFactorsVerified(
    { async readAllFactorsVerifiedProof() { return proof(); } },
    binding,
    NOW_MS,
  );
  assert.equal(selected.status, "all_factors_verified");
  assert.equal(selected.tokenHash, binding.tokenHash);
});

test("the runtime placeholder denies until a durable verification store exists", async () => {
  await assert.rejects(
    requireAllFactorsVerified(createDenyAllVerificationProofStore(), binding, NOW_MS),
    (error) => error instanceof VerificationProofError &&
      error.publicCode === "verification_required" &&
      error.status === 403,
  );
});

test("rejects missing, stale, partial, or differently bound factor proof", async () => {
  for (const invalidProof of [
    null,
    proof({ tokenHash: "b".repeat(64) }),
    proof({ emailOtpVerifiedAt: "" }),
    proof({ mobileSmsVerifiedAt: "2026-08-14T18:06:00.000Z" }),
    proof({ expiresAt: "2026-08-14T18:09:59.000Z" }),
    proof({ captchaVerifiedAt: "2026-08-14T17:59:59.000Z" }),
  ]) {
    await assert.rejects(
      requireAllFactorsVerified(
        { async readAllFactorsVerifiedProof() { return invalidProof; } },
        binding,
        NOW_MS,
      ),
      (error) => error instanceof VerificationProofError,
    );
  }
});
