"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  deriveAccessToken,
  hashAccessToken,
  proofDestinationDigest,
} = require("../lib/security");
const { createVerificationService } = require("../lib/verification-service");

const NOW = Date.parse("2026-08-14T18:00:00.000Z");
const IDS = {
  contact: `${"9".repeat(17)}1`,
  account: `${"9".repeat(17)}2`,
  deal: `${"9".repeat(17)}3`,
};
const ISSUE_ID = "10000000-0000-4000-8000-000000000001";

function fixture({
  mailOutcome = "accepted",
  proofMode = "stub",
  approvedRecipientDigests = [],
} = {}) {
  const config = {
    deploymentEnvironment: "development",
    tokenPepper: "P".repeat(43),
    proofHmacSecret: "V".repeat(43),
    proofMode,
    form2ProofAllowedRecipientDigests: approvedRecipientDigests,
  };
  const setupToken = deriveAccessToken(ISSUE_ID, config.tokenPepper);
  const records = {
    Contacts: {
      id: IDS.contact,
      Modified_Time: "2026-08-14T17:59:00.000Z",
      Account_Name: { id: IDS.account },
      Email: "authorized@example.invalid",
    },
    Accounts: {
      id: IDS.account,
      Modified_Time: "2026-08-14T17:59:00.000Z",
      Primary_Contact: { id: IDS.contact },
    },
    Deals: {
      id: IDS.deal,
      Modified_Time: "2026-08-14T17:59:00.000Z",
      Contact_Name: { id: IDS.contact },
      Account_Name: { id: IDS.account },
    },
  };
  const session = {
    rowId: "7000000000001",
    issueRequestKey: "1".repeat(64),
    tokenHash: hashAccessToken(setupToken, config.tokenPepper),
    crmContactId: IDS.contact,
    crmAccountId: IDS.account,
    crmDealId: IDS.deal,
    status: "issued",
    issuedAt: "2026-08-14T18:00:00.000Z",
    expiresAt: "2026-08-14T19:00:00.000Z",
  };
  let proof = null;
  const sends = [];
  const proofStore = {
    async readByProofKey() { return proof ? { ...proof } : null; },
    async reserve(input) {
      proof = {
        rowId: "7100000000001",
        proofKey: input.proofKey,
        sessionRowId: input.sessionRowId,
        bindingDigest: input.bindingDigest,
        destinationDigest: input.destinationDigest,
        otpDigest: input.otpDigest,
        otpGeneration: 1,
        status: "pending_send",
        sendCount: 0,
        maxSends: 3,
        attemptCount: 0,
        maxAttempts: 5,
        issuedAt: "2026-08-14T18:00:00.000Z",
        expiresAt: "2026-08-14T18:10:00.000Z",
        providerState: "not_invoked",
        providerAttemptCount: 0,
        providerResultReference: "",
        verificationOwner: "",
        verificationLeaseExpiresAt: "",
      };
      return { ...proof };
    },
    async prepareResend() {
      if (Date.parse(proof.expiresAt) <= NOW && proof.sendCount >= proof.maxSends) {
        proof = { ...proof, status: "terminal_failure", providerState: "terminal_failure" };
      }
      return { ...proof };
    },
    async claimSend(current, claimKey) {
      proof = {
        ...current,
        status: "sending",
        providerState: "claimed",
        providerAttemptCount: current.providerAttemptCount + 1,
        providerResultReference: claimKey,
      };
      return { ...proof };
    },
    async markSendInvoking(current, claimKey) {
      assert.equal(current.providerResultReference, claimKey);
      proof = {
        ...current,
        providerState: "invoking",
        sendCount: current.sendCount + 1,
      };
      return { ...proof };
    },
    async resolveStaleSend() { return { ...proof }; },
    async completeSend(current, result) {
      proof = {
        ...current,
        status: new Set(["accepted", "stubbed"]).has(result.outcome)
          ? "issued"
          : result.outcome,
        providerState: result.outcome === "accepted" ? "accepted" : result.outcome,
        providerResultReference: result.providerResultReference,
      };
      return { ...proof };
    },
    async claimVerificationAttempt(current, owner) {
      if (current.status === "issued") {
        proof = {
          ...current,
          status: "verifying",
          verificationOwner: owner,
          verificationLeaseExpiresAt: "2026-08-14T18:00:15.000Z",
        };
      }
      return { ...proof };
    },
    async recordFailedCode(current, owner) {
      proof = {
        ...current,
        status: "issued",
        attemptCount: current.attemptCount + 1,
        verificationOwner: "",
        verificationLeaseExpiresAt: "",
      };
      return { ...proof };
    },
    async markVerified(current, owner) {
      assert.equal(current.verificationOwner, owner);
      proof = {
        ...current,
        status: "verified",
        verificationOwner: "",
        verificationLeaseExpiresAt: "",
        verifiedAt: new Date(NOW).toISOString(),
      };
      return { ...proof };
    },
    async consume(current) {
      proof = { ...current, status: "consumed", consumedAt: new Date(NOW).toISOString() };
      return { ...proof };
    },
  };
  const service = createVerificationService({
    config,
    crmClient: { async getRecord(module) { return { ...records[module] }; } },
    mailAdapter: {
      async sendOtp(message) {
        sends.push({ ...message });
        return {
          outcome: mailOutcome,
          providerResultReference: new Set(["accepted", "stubbed"]).has(mailOutcome)
            ? `${mailOutcome === "accepted" ? "mail" : "stub"}_${"2".repeat(64)}`
            : "",
        };
      },
    },
    proofStore,
    sessionStore: { async readByTokenHash() { return { ...session }; } },
    now: () => NOW,
    randomInt: () => 12345678,
    randomBytes: () => Buffer.alloc(32, 0x03),
  });
  return { records, sends, service, session, setupToken, get proof() { return proof; } };
}

test("requests OTP only for the CRM-bound Contact email and never accepts a destination", async () => {
  const selected = fixture();
  const result = await selected.service.requestEmailOtp(selected.setupToken);
  assert.deepEqual(result, { state: "sent_confirmed" });
  assert.equal(selected.sends.length, 1);
  assert.equal(selected.sends[0].destination, "authorized@example.invalid");
  assert.equal(selected.sends[0].otp, "12345678");
  const durable = JSON.stringify(selected.proof);
  assert.equal(durable.includes("authorized@example.invalid"), false);
  assert.equal(durable.includes("12345678"), false);
});

test("Development delivery requires the CRM-bound Contact in the private recipient allowlist", async () => {
  const blocked = fixture({ proofMode: "send_development" });
  await assert.rejects(
    () => blocked.service.requestEmailOtp(blocked.setupToken),
    /not approved for Development delivery/,
  );
  assert.equal(blocked.sends.length, 0);

  const approved = fixture({
    proofMode: "send_development",
    approvedRecipientDigests: [proofDestinationDigest(
      "authorized@example.invalid",
      "V".repeat(43),
    )],
  });
  await approved.service.requestEmailOtp(approved.setupToken);
  assert.equal(approved.sends.length, 1);
});

test("wrong OTP is counted and the correct OTP creates a durable verified proof", async () => {
  const selected = fixture();
  await selected.service.requestEmailOtp(selected.setupToken);
  await assert.rejects(
    selected.service.verifyEmailOtp(selected.setupToken, "87654321"),
    (error) => error.publicCode === "verification_required",
  );
  assert.equal(selected.proof.attemptCount, 1);
  const result = await selected.service.verifyEmailOtp(selected.setupToken, "12345678");
  assert.equal(result.verified, true);
  assert.equal(selected.proof.status, "verified");
  assert.deepEqual(await selected.service.requestEmailOtp(selected.setupToken), {
    state: "already_verified",
  });
  assert.equal(selected.sends.length, 1);
  selected.proof.expiresAt = "2026-08-14T18:00:00.000Z";
  await assert.rejects(
    selected.service.verifyEmailOtp(selected.setupToken, "12345678"),
    (error) => error.publicCode === "verification_required",
  );
});

test("destination changes and cross-binding consumption fail closed", async () => {
  const selected = fixture();
  await selected.service.requestEmailOtp(selected.setupToken);
  selected.records.Contacts.Email = "changed@example.invalid";
  await assert.rejects(
    selected.service.verifyEmailOtp(selected.setupToken, "12345678"),
    (error) => error.publicCode === "reconciliation_required",
  );
  selected.records.Contacts.Email = "authorized@example.invalid";
  await selected.service.verifyEmailOtp(selected.setupToken, "12345678");
  const binding = {
    sessionRowId: selected.session.rowId,
    issueRequestKey: selected.session.issueRequestKey,
    tokenHash: selected.session.tokenHash,
    crmContactId: selected.session.crmContactId,
    crmAccountId: selected.session.crmAccountId,
    crmDealId: selected.session.crmDealId,
    issuedAt: selected.session.issuedAt,
    expiresAt: selected.session.expiresAt,
  };
  const consumed = await selected.service.consumeVerifiedProof(
    binding,
    "authorized@example.invalid",
    NOW,
  );
  assert.equal(consumed.status, "consumed");
  await assert.rejects(
    selected.service.consumeVerifiedProof(
      { ...binding, crmDealId: `${"8".repeat(17)}3` },
      "authorized@example.invalid",
      NOW,
    ),
  );
});

test("reports only provider-evidenced delivery as sent", async () => {
  const stubbed = fixture({ mailOutcome: "stubbed" });
  assert.deepEqual(
    await stubbed.service.requestEmailOtp(stubbed.setupToken),
    { state: "delivery_disabled" },
  );
  const retryable = fixture({ mailOutcome: "retry_required" });
  assert.deepEqual(await retryable.service.requestEmailOtp(retryable.setupToken), {
    state: "retryable_failure",
  });
  const ambiguous = fixture({ mailOutcome: "ambiguous" });
  await assert.rejects(
    ambiguous.service.requestEmailOtp(ambiguous.setupToken),
    (error) => error.publicCode === "reconciliation_required" && error.ambiguous === true,
  );
});

test("an expired provider-confirmed code at the send ceiling is terminal", async () => {
  const selected = fixture();
  assert.deepEqual(await selected.service.requestEmailOtp(selected.setupToken), {
    state: "sent_confirmed",
  });
  selected.proof.expiresAt = new Date(NOW).toISOString();
  selected.proof.sendCount = selected.proof.maxSends;
  assert.deepEqual(await selected.service.requestEmailOtp(selected.setupToken), {
    state: "terminal_failure",
  });
  assert.equal(selected.sends.length, 1);
});
