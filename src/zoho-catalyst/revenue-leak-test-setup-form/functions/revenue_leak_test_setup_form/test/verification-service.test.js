"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  deriveAccessToken,
  hashAccessToken,
  prefillBindingDigest,
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
    crmOrganizationHash: "c".repeat(64),
    workflowKeyMaterial: "W".repeat(43),
    formIdentityHash: "e".repeat(64),
    form2FormVersion: "form2-v1",
    sourceRevision: "a".repeat(40),
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
      Intake_Submission_ID: "journey_synthetic_001",
    },
  };
  const session = {
    rowId: "7000000000001",
    issueRequestKey: "1".repeat(64),
    tokenHash: hashAccessToken(setupToken, config.tokenPepper),
    crmContactId: IDS.contact,
    crmAccountId: IDS.account,
    crmDealId: IDS.deal,
    journeyBindingDigest: prefillBindingDigest({
      crmOrganizationHash: config.crmOrganizationHash,
      crmContactId: IDS.contact,
      crmAccountId: IDS.account,
      crmDealId: IDS.deal,
      journeyId: records.Deals.Intake_Submission_ID,
      formIdentityHash: config.formIdentityHash,
      expectedStage: "form2",
      formVersion: config.form2FormVersion,
      configurationRevision: config.sourceRevision,
    }, config.workflowKeyMaterial),
    status: "issued",
    lastOutcome: "issued",
    attemptCount: 0,
    maxAttempts: 3,
    issuedAt: "2026-08-14T18:00:00.000Z",
    expiresAt: "2026-08-14T19:00:00.000Z",
  };
  let proof = null;
  const sends = [];
  const proofStore = {
    async readByProofKey(key) { return proof?.proofKey === key ? { ...proof } : null; },
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
    sessionStore: {
      async exchangeSetupToken(tokenHash, owner) {
        assert.equal(tokenHash, session.tokenHash);
        if (session.lastOutcome !== "issued") throw new Error("synthetic exchange conflict");
        session.lastOutcome = owner;
        return { ...session };
      },
      async readByTokenHash() { return { ...session }; },
      async readByRowId(rowId) {
        return String(rowId) === session.rowId ? { ...session } : null;
      },
    },
    now: () => NOW,
    randomInt: () => 12345678,
    randomBytes: () => Buffer.alloc(32, 0x03),
  });
  return { records, sends, service, session, setupToken, proofStore, get proof() { return proof; } };
}

async function exchange(selected) {
  const result = await selected.service.exchangeSetupToken(selected.setupToken);
  assert.match(result.verificationId, /^[a-f0-9]{64}$/);
  return result;
}

test("requests OTP only for the CRM-bound Contact email and never accepts a destination", async () => {
  const selected = fixture();
  const result = await exchange(selected);
  assert.equal(result.state, "sent_confirmed");
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
    () => blocked.service.exchangeSetupToken(blocked.setupToken),
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
  await approved.service.exchangeSetupToken(approved.setupToken);
  assert.equal(approved.sends.length, 1);
});

test("wrong OTP is counted and the correct OTP creates a durable verified proof", async () => {
  const selected = fixture();
  const verificationId = (await exchange(selected)).verificationId;
  await assert.rejects(
    selected.service.verifyEmailOtp(verificationId, "87654321"),
    (error) => error.publicCode === "verification_required",
  );
  assert.equal(selected.proof.attemptCount, 1);
  const result = await selected.service.verifyEmailOtp(verificationId, "12345678");
  assert.equal(result.verified, true);
  assert.equal(selected.proof.status, "verified");
  assert.equal((await selected.service.requestEmailOtp(verificationId, result.recoveryToken)).state,
    "already_verified");
  assert.equal(selected.sends.length, 1);
  selected.proof.expiresAt = "2026-08-14T18:00:00.000Z";
  await assert.rejects(
    selected.service.verifyEmailOtp(verificationId, "12345678"),
    (error) => error.publicCode === "verification_required",
  );
});

test("copied setup token and pre-OTP ID cannot inherit verified or consumed proof", async () => {
  for (const consumed of [false, true]) {
    const selected = fixture();
    const verificationId = (await exchange(selected)).verificationId;
    const verified = await selected.service.verifyEmailOtp(verificationId, "12345678");
    assert.match(verified.recoveryToken, /^[a-f0-9]{64}$/);
    assert.notEqual(verified.recoveryToken, verificationId);
    if (consumed) {
      await selected.service.consumeVerifiedProof(verified.binding, "authorized@example.invalid", NOW);
      // Recovery is bounded by the session, even after the OTP entry deadline.
      selected.proof.expiresAt = new Date(NOW).toISOString();
    }
    await assert.rejects(selected.service.exchangeSetupToken(selected.setupToken));
    await assert.rejects(selected.service.requestEmailOtp(verificationId));
    await assert.rejects(selected.service.requestEmailOtp(verificationId, "0".repeat(64)));
    for (const code of ["00000000", "12345678"]) {
      await assert.rejects(selected.service.verifyEmailOtp(verificationId, code));
    }
    const recovered = await selected.service.requestEmailOtp(verificationId, verified.recoveryToken);
    assert.equal(recovered.state, "already_verified");
    assert.deepEqual(recovered.binding, verified.binding);
    assert.equal(selected.sends.length, 1);
  }
});

test("an exchanged token cannot be reused before OTP or after proof reservation fails", async () => {
  const selected = fixture();
  const verificationId = (await exchange(selected)).verificationId;
  await assert.rejects(selected.service.exchangeSetupToken(selected.setupToken));
  assert.equal((await selected.service.requestEmailOtp(verificationId)).state, "sent_confirmed");
  assert.equal(selected.sends.length, 1);
  const failed = fixture();
  failed.proofStore.reserve = async () => { throw new Error("synthetic reservation unavailable"); };
  await assert.rejects(failed.service.exchangeSetupToken(failed.setupToken));
  await assert.rejects(failed.service.exchangeSetupToken(failed.setupToken));
  assert.equal(failed.sends.length, 0);
  assert.match(failed.session.lastOutcome, /^exchange_/);
});

test("recovery is exact to the proof generation, destination and live session budget", async () => {
  for (const changed of ["generation", "verifiedAt", "destination", "session", "expired", "attempts", "terminal"]) {
    const selected = fixture();
    const verificationId = (await exchange(selected)).verificationId;
    const verified = await selected.service.verifyEmailOtp(verificationId, "12345678");
    if (changed === "generation") selected.proof.otpGeneration += 1;
    if (changed === "verifiedAt") selected.proof.verifiedAt = "2026-08-14T18:00:01.000Z";
    if (changed === "destination") selected.records.Contacts.Email = "changed@example.invalid";
    if (changed === "session") selected.session.issueRequestKey = "9".repeat(64);
    if (changed === "expired") selected.session.expiresAt = new Date(NOW).toISOString();
    if (changed === "attempts") selected.session.attemptCount = selected.session.maxAttempts;
    if (changed === "terminal") selected.session.status = "submitted";
    await assert.rejects(selected.service.requestEmailOtp(verificationId, verified.recoveryToken), changed);
    assert.equal(selected.sends.length, 1);
  }
});

test("a delivery request already in flight cannot acquire recovery when another caller verifies", async () => {
  const selected = fixture();
  const verificationId = (await exchange(selected)).verificationId;
  const [pending, verified] = await Promise.allSettled([
    selected.service.requestEmailOtp(verificationId),
    selected.service.verifyEmailOtp(verificationId, "12345678"),
  ]);
  assert.equal(verified.status, "fulfilled");
  if (pending.status === "fulfilled") {
    assert.notEqual(pending.value.state, "already_verified");
    assert.equal(Object.hasOwn(pending.value, "recoveryToken"), false);
  }
  await assert.rejects(selected.service.requestEmailOtp(verificationId));
});

test("destination changes and cross-binding consumption fail closed", async () => {
  const selected = fixture();
  const verificationId = (await exchange(selected)).verificationId;
  selected.records.Contacts.Email = "changed@example.invalid";
  await assert.rejects(
    selected.service.verifyEmailOtp(verificationId, "12345678"),
    (error) => error.publicCode === "reconciliation_required",
  );
  selected.records.Contacts.Email = "authorized@example.invalid";
  await selected.service.verifyEmailOtp(verificationId, "12345678");
  const binding = {
    sessionRowId: selected.session.rowId,
    issueRequestKey: selected.session.issueRequestKey,
    tokenHash: selected.session.tokenHash,
    crmContactId: selected.session.crmContactId,
    crmAccountId: selected.session.crmAccountId,
    crmDealId: selected.session.crmDealId,
    journeyBindingDigest: selected.session.journeyBindingDigest,
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
    (await stubbed.service.exchangeSetupToken(stubbed.setupToken)).state,
    "delivery_disabled",
  );
  const retryable = fixture({ mailOutcome: "retry_required" });
  assert.equal((await retryable.service.exchangeSetupToken(retryable.setupToken)).state,
    "retryable_failure");
  const ambiguous = fixture({ mailOutcome: "ambiguous" });
  await assert.rejects(
    ambiguous.service.exchangeSetupToken(ambiguous.setupToken),
    (error) => error.publicCode === "reconciliation_required" && error.ambiguous === true,
  );
});

test("an expired provider-confirmed code at the send ceiling is terminal", async () => {
  const selected = fixture();
  const verificationId = (await exchange(selected)).verificationId;
  selected.proof.expiresAt = new Date(NOW).toISOString();
  selected.proof.sendCount = selected.proof.maxSends;
  assert.equal((await selected.service.requestEmailOtp(verificationId)).state,
    "terminal_failure");
  assert.equal(selected.sends.length, 1);
});
