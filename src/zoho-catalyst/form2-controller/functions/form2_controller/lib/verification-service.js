"use strict";

const crypto = require("node:crypto");
const { verifyRecordRelationships } = require("./form-contract");
const {
  constantTimeEqual,
  generateEmailOtp,
  hashAccessToken,
  normalizeProofEmail,
  proofBindingDigest,
  proofDestinationDigest,
  proofKey,
  proofOtpDigest,
} = require("./security");

class VerificationServiceError extends Error {
  constructor(
    message,
    { publicCode = "verification_required", status = 403, ambiguous = false } = {},
  ) {
    super(message);
    this.name = "VerificationServiceError";
    this.publicCode = publicCode;
    this.status = status;
    this.ambiguous = ambiguous;
  }
}

function fail(message, options) {
  throw new VerificationServiceError(message, options);
}

function validRecordId(value) {
  return typeof value === "string" && /^[1-9][0-9]{9,29}$/.test(value);
}

function createVerificationService({
  config,
  crmClient,
  mailAdapter,
  proofStore,
  sessionStore,
  now = Date.now,
  randomInt,
  randomBytes = crypto.randomBytes,
}) {
  if (
    !config ||
    config.deploymentEnvironment !== "development" ||
    !crmClient ||
    typeof mailAdapter?.sendOtp !== "function" ||
    !proofStore ||
    !sessionStore ||
    typeof now !== "function"
  ) {
    fail("Verification service configuration is invalid", {
      publicCode: "configuration_invalid",
      status: 503,
    });
  }

  function nowMs() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) {
      fail("Verification clock is invalid", { publicCode: "configuration_invalid", status: 503 });
    }
    return value;
  }

  async function readContext(setupToken) {
    let tokenHash;
    try {
      tokenHash = hashAccessToken(setupToken, config.tokenPepper);
    } catch {
      fail("Setup access is unavailable", { publicCode: "setup_not_found", status: 404 });
    }
    const session = await sessionStore.readByTokenHash(tokenHash);
    const current = nowMs();
    if (
      !session ||
      !new Set(["issued", "verified"]).has(session.status) ||
      !Number.isFinite(Date.parse(session.expiresAt)) ||
      Date.parse(session.expiresAt) <= current ||
      !validRecordId(session.crmContactId) ||
      !validRecordId(session.crmAccountId) ||
      !validRecordId(session.crmDealId) ||
      !/^[a-f0-9]{64}$/.test(session.issueRequestKey ?? "") ||
      !/^[a-f0-9]{64}$/.test(session.tokenHash ?? "")
    ) {
      fail("Setup access is unavailable", { publicCode: "setup_not_found", status: 404 });
    }
    const [contact, account, deal] = await Promise.all([
      crmClient.getRecord("Contacts", session.crmContactId),
      crmClient.getRecord("Accounts", session.crmAccountId),
      crmClient.getRecord("Deals", session.crmDealId),
    ]);
    if (
      contact?.id !== session.crmContactId ||
      account?.id !== session.crmAccountId ||
      deal?.id !== session.crmDealId
    ) {
      fail("Setup relationship does not match", { publicCode: "identity_mismatch", status: 409 });
    }
    verifyRecordRelationships({ contact, account, deal });
    const destination = normalizeProofEmail(contact.Email);
    const selectedProofKey = proofKey(session.rowId, config.proofHmacSecret);
    const destinationDigest = proofDestinationDigest(destination, config.proofHmacSecret);
    if (
      config.proofMode === "send_development" &&
      !config.form2ProofAllowedRecipientDigests?.some((approvedDigest) =>
        constantTimeEqual(approvedDigest, destinationDigest))
    ) {
      fail("Verification destination is not approved for Development delivery", {
        publicCode: "verification_required",
        status: 403,
      });
    }
    const binding = Object.freeze({
      sessionRowId: session.rowId,
      issueRequestKey: session.issueRequestKey,
      tokenHash,
      crmContactId: session.crmContactId,
      crmAccountId: session.crmAccountId,
      crmDealId: session.crmDealId,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
    });
    const bindingDigest = proofBindingDigest(
      binding,
      destinationDigest,
      config.proofHmacSecret,
    );
    return Object.freeze({
      binding,
      bindingDigest,
      destination,
      destinationDigest,
      proofKey: selectedProofKey,
      session,
    });
  }

  function assertProofOwnership(proof, context) {
    if (
      proof &&
      (
        proof.proofKey !== context.proofKey ||
        proof.sessionRowId !== String(context.session.rowId) ||
        proof.bindingDigest !== context.bindingDigest ||
        proof.destinationDigest !== context.destinationDigest
      )
    ) {
      fail("Verification proof ownership conflicts", {
        publicCode: "reconciliation_required",
        status: 503,
        ambiguous: true,
      });
    }
  }

  function randomOwner(prefix) {
    const source = randomBytes(32);
    if (!Buffer.isBuffer(source) || source.length !== 32) {
      fail("Verification claim source is invalid", {
        publicCode: "configuration_invalid",
        status: 503,
      });
    }
    return `${prefix}_${source.toString("hex")}`;
  }

  function evidencedDeliveryState(proof) {
    if (new Set(["verified", "consumed"]).has(proof?.status)) return "already_verified";
    if (proof?.status === "sending") return "in_flight";
    if (
      new Set(["issued", "verifying"]).has(proof?.status) &&
      proof.providerState === "accepted" &&
      /^mail_[a-f0-9]{64}$/.test(proof.providerResultReference ?? "")
    ) return "sent_confirmed";
    if (
      new Set(["issued", "verifying"]).has(proof?.status) &&
      proof.providerState === "stubbed" &&
      /^stub_[a-f0-9]{64}$/.test(proof.providerResultReference ?? "")
    ) return "delivery_disabled";
    if (proof?.status === "retry_required") return "retryable_failure";
    if (new Set(["failed", "expired", "terminal_failure"]).has(proof?.status)) {
      return "terminal_failure";
    }
    return null;
  }

  async function requestEmailOtp(setupToken) {
    const context = await readContext(setupToken);
    let proof = await proofStore.readByProofKey(context.proofKey);
    assertProofOwnership(proof, context);
    if (proof?.status === "sending") {
      proof = await proofStore.resolveStaleSend(proof);
      assertProofOwnership(proof, context);
    }
    const existingState = evidencedDeliveryState(proof);
    if (existingState === "already_verified") {
      return Object.freeze({ state: existingState });
    }
    if (proof && new Set(["ambiguous", "reconciliation_required"]).has(proof.status)) {
      fail("OTP delivery outcome is ambiguous", {
        publicCode: "reconciliation_required",
        status: 503,
        ambiguous: true,
      });
    }
    if (new Set([
      "in_flight",
      "terminal_failure",
      "delivery_disabled",
    ]).has(existingState)) {
      return Object.freeze({ state: existingState });
    }

    const otp = generateEmailOtp(randomInt);
    let preparedOtpDigest;
    if (!proof) {
      preparedOtpDigest = proofOtpDigest({
        selectedProofKey: context.proofKey,
        generation: 1,
        otp,
      }, config.proofHmacSecret);
      proof = await proofStore.reserve({
        proofKey: context.proofKey,
        sessionRowId: context.session.rowId,
        bindingDigest: context.bindingDigest,
        destinationDigest: context.destinationDigest,
        generation: 1,
        otpDigest: preparedOtpDigest,
        sessionExpiresAt: context.session.expiresAt,
      });
    } else {
      const nextGeneration = proof.otpGeneration + 1;
      preparedOtpDigest = proofOtpDigest({
        selectedProofKey: context.proofKey,
        generation: nextGeneration,
        otp,
      }, config.proofHmacSecret);
      proof = await proofStore.prepareResend(
        proof,
        preparedOtpDigest,
        context.session.expiresAt,
      );
    }
    assertProofOwnership(proof, context);
    if (
      !new Set(["pending_send", "retry_required"]).has(proof.status) ||
      proof.otpDigest !== preparedOtpDigest
    ) {
      const state = evidencedDeliveryState(proof);
      if (!state) {
        fail("Verification delivery state did not converge", {
          publicCode: "reconciliation_required",
          status: 503,
          ambiguous: true,
        });
      }
      return Object.freeze({ state });
    }
    const claimKey = randomOwner("claim");
    const claimed = await proofStore.claimSend(proof, claimKey);
    if (
      claimed.status !== "sending" ||
      claimed.providerState !== "claimed" ||
      claimed.otpDigest !== proof.otpDigest ||
      claimed.otpGeneration !== proof.otpGeneration ||
      claimed.providerResultReference !== claimKey
    ) {
      return Object.freeze({ state: "in_flight" });
    }
    const invoking = await proofStore.markSendInvoking(claimed, claimKey);
    if (
      invoking.status !== "sending" ||
      invoking.providerState !== "invoking" ||
      invoking.otpDigest !== claimed.otpDigest ||
      invoking.otpGeneration !== claimed.otpGeneration ||
      invoking.providerResultReference !== claimKey
    ) {
      fail("Verification provider invocation did not converge", {
        publicCode: "reconciliation_required",
        status: 503,
        ambiguous: true,
      });
    }
    const providerResult = await mailAdapter.sendOtp({
      destination: context.destination,
      otp,
      proofKey: context.proofKey,
      expiresAt: invoking.expiresAt,
    });
    const completed = await proofStore.completeSend(invoking, providerResult, claimKey);
    if (new Set(["ambiguous", "sending", "reconciliation_required"]).has(completed.status)) {
      fail("OTP delivery outcome is ambiguous", {
        publicCode: "reconciliation_required",
        status: 503,
        ambiguous: true,
      });
    }
    const completedState = evidencedDeliveryState(completed);
    if (!completedState) {
      fail("OTP delivery is unavailable", { publicCode: "verification_required", status: 403 });
    }
    return Object.freeze({ state: completedState });
  }

  async function verifyEmailOtp(setupToken, otp) {
    if (typeof otp !== "string" || !/^[0-9]{8}$/.test(otp)) {
      fail("Verification code is invalid");
    }
    const context = await readContext(setupToken);
    let proof = await proofStore.readByProofKey(context.proofKey);
    assertProofOwnership(proof, context);
    if (!proof) fail("Verification proof is unavailable");
    if (proof.status === "consumed") {
      return Object.freeze({ verified: true, binding: context.binding });
    }
    if (proof.status === "verified") {
      if (Date.parse(proof.expiresAt) <= nowMs()) fail("Verification proof is unavailable");
      return Object.freeze({ verified: true, binding: context.binding });
    }
    if (
      !new Set(["issued", "verifying"]).has(proof.status) ||
      Date.parse(proof.expiresAt) <= nowMs()
    ) {
      fail("Verification proof is unavailable");
    }
    const verificationOwner = randomOwner("verify");
    proof = await proofStore.claimVerificationAttempt(proof, verificationOwner);
    if (
      proof.status !== "verifying" ||
      proof.verificationOwner !== verificationOwner
    ) {
      fail("Another verification attempt is in progress", {
        publicCode: "verification_in_progress",
        status: 409,
      });
    }
    const candidate = proofOtpDigest({
      selectedProofKey: context.proofKey,
      generation: proof.otpGeneration,
      otp,
    }, config.proofHmacSecret);
    if (!constantTimeEqual(candidate, proof.otpDigest)) {
      const priorAttempts = proof.attemptCount;
      proof = await proofStore.recordFailedCode(proof, verificationOwner);
      if (
        proof.attemptCount !== priorAttempts + 1 ||
        !new Set(["issued", "failed"]).has(proof.status)
      ) {
        fail("Verification attempt did not converge", {
          publicCode: "reconciliation_required",
          status: 503,
          ambiguous: true,
        });
      }
      fail(proof.status === "failed"
        ? "Verification attempts are exhausted"
        : "Verification code is invalid");
    }
    proof = await proofStore.markVerified(proof, verificationOwner);
    if (proof.status !== "verified") {
      fail("Verification proof did not converge", {
        publicCode: "reconciliation_required",
        status: 503,
        ambiguous: true,
      });
    }
    return Object.freeze({ verified: true, binding: context.binding });
  }

  async function consumeVerifiedProof(binding, destinationEmail, selectedNowMs) {
    if (!Number.isSafeInteger(selectedNowMs) || selectedNowMs < 0) {
      fail("Verification clocks do not match", {
        publicCode: "configuration_invalid",
        status: 503,
      });
    }
    const destinationDigest = proofDestinationDigest(destinationEmail, config.proofHmacSecret);
    const selectedProofKey = proofKey(binding.sessionRowId, config.proofHmacSecret);
    const bindingDigest = proofBindingDigest(binding, destinationDigest, config.proofHmacSecret);
    let proof = await proofStore.readByProofKey(selectedProofKey);
    if (
      !proof ||
      proof.sessionRowId !== String(binding.sessionRowId) ||
      proof.bindingDigest !== bindingDigest ||
      proof.destinationDigest !== destinationDigest
    ) {
      fail("Verification proof binding does not match");
    }
    proof = await proofStore.consume(proof, bindingDigest, destinationDigest);
    return Object.freeze({
      status: proof.status,
      proofKey: proof.proofKey,
      sessionRowId: proof.sessionRowId,
      bindingDigest: proof.bindingDigest,
      destinationDigest: proof.destinationDigest,
      verifiedAt: proof.verifiedAt,
      expiresAt: proof.expiresAt,
    });
  }

  return Object.freeze({
    consumeVerifiedProof,
    requestEmailOtp,
    verifyEmailOtp,
  });
}

module.exports = {
  VerificationServiceError,
  createVerificationService,
};
