"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  VerificationProofError,
  requireEmailOtpVerified,
} = require("../lib/verification-proof");

const NOW_MS = Date.parse("2026-08-14T18:10:00.000Z");
const binding = Object.freeze({
  sessionRowId: "7000000000001",
  issueRequestKey: "f".repeat(64),
  tokenHash: "a".repeat(64),
  crmContactId: `${"9".repeat(17)}1`,
  crmAccountId: `${"9".repeat(17)}2`,
  crmDealId: `${"9".repeat(17)}3`,
  issuedAt: "2026-08-14T18:00:00.000Z",
  expiresAt: "2026-08-14T19:00:00.000Z",
});

function proof(overrides = {}) {
  return {
    status: "consumed",
    proofKey: "b".repeat(64),
    sessionRowId: binding.sessionRowId,
    bindingDigest: "c".repeat(64),
    destinationDigest: "d".repeat(64),
    verifiedAt: "2026-08-14T18:07:00.000Z",
    expiresAt: "2026-08-14T18:30:00.000Z",
    ...overrides,
  };
}

test("accepts one consumed email proof bound to the exact live session", async () => {
  let receivedEmail;
  const selected = await requireEmailOtpVerified({
    async consumeVerifiedProof(receivedBinding, email) {
      assert.deepEqual(receivedBinding, binding);
      receivedEmail = email;
      return proof();
    },
  }, binding, "casey@example.invalid", NOW_MS);
  assert.equal(selected.status, "consumed");
  assert.equal(receivedEmail, "casey@example.invalid");
  assert.equal(Object.hasOwn(selected, "captchaVerifiedAt"), false);
});

test("a consumed proof remains replay evidence after its OTP-entry deadline", async () => {
  const selectedNow = Date.parse("2026-08-14T18:40:00.000Z");
  const selected = await requireEmailOtpVerified({
    async consumeVerifiedProof() {
      return proof({ expiresAt: "2026-08-14T18:30:00.000Z" });
    },
  }, binding, "casey@example.invalid", selectedNow);
  assert.equal(selected.status, "consumed");
});

test("token possession without a durable consumed email proof fails closed", async () => {
  await assert.rejects(
    requireEmailOtpVerified({}, binding, "casey@example.invalid", NOW_MS),
    (error) => error instanceof VerificationProofError &&
      error.publicCode === "verification_required" &&
      error.status === 403,
  );
});

test("rejects missing, impossible, partial, or differently bound proof", async () => {
  for (const invalidProof of [
    null,
    proof({ sessionRowId: "7000000000002" }),
    proof({ proofKey: "" }),
    proof({ verifiedAt: "2026-08-14T18:31:00.000Z", expiresAt: "2026-08-14T18:30:00.000Z" }),
    proof({ captchaVerifiedAt: "2026-08-14T18:07:00.000Z" }),
  ]) {
    await assert.rejects(
      requireEmailOtpVerified({
        async consumeVerifiedProof() { return invalidProof; },
      }, binding, "casey@example.invalid", NOW_MS),
      (error) => error instanceof VerificationProofError,
    );
  }
});
