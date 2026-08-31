"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createVerificationProofStore } = require("../lib/verification-proof-store");

const NOW = Date.parse("2026-08-14T18:00:00.000Z");

function fixture() {
  let selectedNow = NOW;
  let row = null;
  let updateFailures = 0;
  const updateCalls = [];
  const adapter = {
    async insertRow(_table, candidate) {
      if (row) throw new Error("unique conflict");
      row = { ...candidate, ROWID: "7000000000001" };
      return { ...row };
    },
    async updateRow(_table, candidate, expected) {
      assert.ok(
        Object.keys(expected).length <= 4,
        "proof transitions must fit ROWID plus four explicit ZCQL predicates",
      );
      updateCalls.push({ candidate: { ...candidate }, expected: { ...expected } });
      if (updateFailures > 0) {
        updateFailures -= 1;
        throw new Error("synthetic update failure");
      }
      if (!row || Object.entries(expected).some(([key, value]) => row[key] !== value)) {
        throw new Error("conditional conflict");
      }
      Object.assign(row, candidate);
      return [];
    },
    async findRowsByProofKey(_table, key) {
      return row?.PROOF_KEY === key ? [{ ...row }] : [];
    },
    async findRowsByRowId(_table, rowId) {
      return row?.ROWID === rowId ? [{ ...row }] : [];
    },
  };
  const config = {
    deploymentEnvironment: "development",
    proofTableName: "Form2ProofsV3",
    sourceRevision: "a".repeat(40),
    form2ProofTtlSeconds: 600,
    form2ProofMaxAttempts: 5,
    form2ProofMaxSends: 3,
    form2ProofResendCooldownSeconds: 60,
    form2ProofSendLeaseSeconds: 30,
  };
  return {
    get row() { return row; },
    get updateCalls() { return updateCalls; },
    failUpdates(count) { updateFailures = count; },
    setNow(value) { selectedNow = value; },
    store: createVerificationProofStore(adapter, config, { now: () => selectedNow }),
  };
}

function reservation() {
  return {
    proofKey: "1".repeat(64),
    sessionRowId: "7100000000001",
    bindingDigest: "2".repeat(64),
    destinationDigest: "3".repeat(64),
    otpDigest: "4".repeat(64),
    generation: 1,
    sessionExpiresAt: "2026-08-14T19:00:00.000Z",
  };
}

test("durably reserves, sends, verifies, consumes, and replays one exact email proof", async () => {
  const selected = fixture();
  let proof = await selected.store.reserve(reservation());
  assert.equal(proof.status, "pending_send");
  const claim = `claim_${"5".repeat(64)}`;
  proof = await selected.store.claimSend(proof, claim);
  assert.equal(proof.status, "sending");
  assert.equal(proof.providerResultReference, claim);
  proof = await selected.store.markSendInvoking(proof, claim);
  assert.equal(proof.providerState, "invoking");
  proof = await selected.store.completeSend(proof, {
    outcome: "accepted",
    providerResultReference: `mail_${"6".repeat(64)}`,
  }, claim);
  assert.equal(proof.status, "issued");
  const verificationOwner = `verify_${"f".repeat(64)}`;
  proof = await selected.store.claimVerificationAttempt(proof, verificationOwner);
  proof = await selected.store.markVerified(proof, verificationOwner);
  assert.equal(proof.status, "verified");
  proof = await selected.store.consume(
    proof,
    reservation().bindingDigest,
    reservation().destinationDigest,
  );
  assert.equal(proof.status, "consumed");
  assert.equal((await selected.store.consume(
    proof,
    reservation().bindingDigest,
    reservation().destinationDigest,
  )).status, "consumed");
  selected.setNow(Date.parse("2026-08-14T18:11:00.000Z"));
  assert.equal((await selected.store.consume(
    proof,
    reservation().bindingDigest,
    reservation().destinationDigest,
  )).status, "consumed");
  const serialized = JSON.stringify(selected.row);
  assert.equal(serialized.includes("casey@"), false);
  assert.equal(serialized.includes("12345678"), false);
});

test("only one concurrent provider claim owns the send", async () => {
  const selected = fixture();
  const pending = await selected.store.reserve(reservation());
  const [first, second] = await Promise.all([
    selected.store.claimSend(pending, `claim_${"7".repeat(64)}`),
    selected.store.claimSend(pending, `claim_${"8".repeat(64)}`),
  ]);
  const owners = [first, second].filter(
    (proof, index) => proof.providerResultReference === `claim_${(index === 0 ? "7" : "8").repeat(64)}`,
  );
  assert.equal(owners.length, 1);
  assert.equal(selected.row.STATUS, "sending");
});

test("keeps proof transition fences within the provider limit without weakening ownership", async () => {
  const selected = fixture();
  let proof = await selected.store.reserve(reservation());
  const claim = `claim_${"a".repeat(64)}`;

  proof = await selected.store.claimSend(proof, claim);
  assert.deepEqual(selected.updateCalls.at(-1).expected, {
    STATUS: "pending_send",
    OTP_GENERATION: 1,
    UPDATED_AT: "2026-08-14T18:00:00.000Z",
  });

  proof = await selected.store.markSendInvoking(proof, claim);
  assert.deepEqual(selected.updateCalls.at(-1).expected, {
    STATUS: "sending",
    OTP_GENERATION: 1,
    PROVIDER_STATE: "claimed",
    PROVIDER_RESULT_REFERENCE: claim,
  });

  proof = await selected.store.completeSend(proof, {
    outcome: "accepted",
    providerResultReference: `mail_${"b".repeat(64)}`,
  }, claim);
  const owner = `verify_${"c".repeat(64)}`;
  proof = await selected.store.claimVerificationAttempt(proof, owner);
  assert.deepEqual(selected.updateCalls.at(-1).expected, {
    STATUS: "issued",
    OTP_GENERATION: 1,
    VERIFICATION_OWNER: "",
    VERIFICATION_LEASE_EXPIRES_AT: "",
  });
  assert.equal(proof.verificationOwner, owner);
});

test("wrong codes are bounded and provider ambiguity is terminally quarantined", async () => {
  const selected = fixture();
  let proof = await selected.store.reserve(reservation());
  proof = await selected.store.claimSend(proof, `claim_${"9".repeat(64)}`);
  proof = await selected.store.markSendInvoking(proof, `claim_${"9".repeat(64)}`);
  proof = await selected.store.completeSend(proof, {
    outcome: "stubbed",
    providerResultReference: `stub_${"a".repeat(64)}`,
  }, `claim_${"9".repeat(64)}`);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const owner = `verify_${String(attempt).repeat(64)}`;
    proof = await selected.store.claimVerificationAttempt(proof, owner);
    proof = await selected.store.recordFailedCode(proof, owner);
    assert.equal(proof.attemptCount, attempt);
  }
  assert.equal(proof.status, "failed");

  const other = fixture();
  let ambiguous = await other.store.reserve(reservation());
  ambiguous = await other.store.claimSend(ambiguous, `claim_${"b".repeat(64)}`);
  ambiguous = await other.store.markSendInvoking(ambiguous, `claim_${"b".repeat(64)}`);
  ambiguous = await other.store.completeSend(
    ambiguous,
    { outcome: "ambiguous", providerResultReference: "" },
    `claim_${"b".repeat(64)}`,
  );
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal((await other.store.claimSend(
    ambiguous,
    `claim_${"c".repeat(64)}`,
  )).status, "ambiguous");

  const lostCommit = fixture();
  let uncertain = await lostCommit.store.reserve(reservation());
  uncertain = await lostCommit.store.claimSend(uncertain, `claim_${"d".repeat(64)}`);
  uncertain = await lostCommit.store.markSendInvoking(
    uncertain,
    `claim_${"d".repeat(64)}`,
  );
  lostCommit.failUpdates(1);
  uncertain = await lostCommit.store.completeSend(
    uncertain,
    { outcome: "accepted", providerResultReference: `mail_${"e".repeat(64)}` },
    `claim_${"d".repeat(64)}`,
  );
  assert.equal(uncertain.status, "ambiguous");
  assert.equal(uncertain.lastOutcome, "provider_commit_unknown");
});

test("concurrent wrong-code attempts serialize before comparison and count on retry", async () => {
  const selected = fixture();
  let proof = await selected.store.reserve(reservation());
  const sendOwner = `claim_${"1".repeat(64)}`;
  proof = await selected.store.claimSend(proof, sendOwner);
  proof = await selected.store.markSendInvoking(proof, sendOwner);
  proof = await selected.store.completeSend(proof, {
    outcome: "accepted",
    providerResultReference: `mail_${"2".repeat(64)}`,
  }, sendOwner);
  const firstOwner = `verify_${"3".repeat(64)}`;
  const secondOwner = `verify_${"4".repeat(64)}`;
  const claims = await Promise.all([
    selected.store.claimVerificationAttempt(proof, firstOwner),
    selected.store.claimVerificationAttempt(proof, secondOwner),
  ]);
  const owned = claims.filter((candidate, index) => (
    candidate.verificationOwner === (index === 0 ? firstOwner : secondOwner)
  ));
  assert.equal(owned.length, 1);
  const winner = claims.find((candidate) => candidate.verificationOwner === firstOwner)
    ? firstOwner
    : secondOwner;
  proof = await selected.store.recordFailedCode(claims[0], winner);
  assert.equal(proof.attemptCount, 1);
  assert.equal(proof.status, "issued");

  proof = await selected.store.claimVerificationAttempt(proof, secondOwner);
  assert.equal(proof.verificationOwner, secondOwner);
  proof = await selected.store.recordFailedCode(proof, secondOwner);
  assert.equal(proof.attemptCount, 2);
});

test("stale mail claims retry only before invocation and quarantine after invocation", async () => {
  const safe = fixture();
  let proof = await safe.store.reserve(reservation());
  const claim = `claim_${"5".repeat(64)}`;
  proof = await safe.store.claimSend(proof, claim);
  assert.equal(proof.providerState, "claimed");
  assert.equal(proof.sendCount, 0);
  safe.setNow(NOW + 31_000);
  proof = await safe.store.resolveStaleSend(proof);
  assert.equal(proof.status, "retry_required");
  assert.equal(proof.lastOutcome, "stale_provider_claim_released");
  assert.equal(proof.sendCount, 0);

  const uncertain = fixture();
  let invoked = await uncertain.store.reserve(reservation());
  invoked = await uncertain.store.claimSend(invoked, claim);
  invoked = await uncertain.store.markSendInvoking(invoked, claim);
  assert.equal(invoked.sendCount, 1);
  uncertain.setNow(NOW + 31_000);
  invoked = await uncertain.store.resolveStaleSend(invoked);
  assert.equal(invoked.status, "ambiguous");
  assert.equal(invoked.lastOutcome, "stale_provider_invocation_ambiguous");
  assert.equal((await uncertain.store.claimSend(
    invoked,
    `claim_${"6".repeat(64)}`,
  )).status, "ambiguous");
});

test("an expired OTP at the send ceiling becomes terminal instead of sent-confirmed", async () => {
  const selected = fixture();
  let proof = await selected.store.reserve(reservation());
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) {
      selected.setNow(NOW + (attempt - 1) * 61_000);
      proof = await selected.store.prepareResend(
        proof,
        String(attempt + 3).repeat(64),
        reservation().sessionExpiresAt,
      );
    }
    const claim = `claim_${String(attempt).repeat(64)}`;
    proof = await selected.store.claimSend(proof, claim);
    proof = await selected.store.markSendInvoking(proof, claim);
    proof = await selected.store.completeSend(proof, {
      outcome: "accepted",
      providerResultReference: `mail_${String(attempt).repeat(64)}`,
    }, claim);
  }
  assert.equal(proof.sendCount, 3);
  selected.setNow(Date.parse(proof.expiresAt) + 1);
  proof = await selected.store.prepareResend(
    proof,
    "9".repeat(64),
    reservation().sessionExpiresAt,
  );
  assert.equal(proof.status, "terminal_failure");
  assert.equal(proof.lastOutcome, "otp_send_limit_exhausted");
});
