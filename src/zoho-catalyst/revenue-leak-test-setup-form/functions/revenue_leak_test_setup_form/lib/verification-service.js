"use strict";

const crypto = require("node:crypto");
const { verifyRecordRelationships } = require("./form-contract");
const {
  constantTimeEqual,
  generateEmailOtp,
  hashAccessToken,
  normalizeVerificationId,
  normalizeProofEmail,
  prefillBindingDigest,
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

  async function buildContext(session) {
    const current = nowMs();
    if (
      !session ||
      !new Set(["issued", "verified"]).has(session.status) ||
      session.attemptCount >= session.maxAttempts ||
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
    let currentJourneyBindingDigest;
    try {
      currentJourneyBindingDigest = prefillBindingDigest({
        crmOrganizationHash: config.crmOrganizationHash,
        crmContactId: contact.id,
        crmAccountId: account.id,
        crmDealId: deal.id,
        journeyId: deal.Intake_Submission_ID,
        formIdentityHash: config.formIdentityHash,
        expectedStage: "form2",
        formVersion: config.form2FormVersion,
        configurationRevision: config.sourceRevision,
      }, config.workflowKeyMaterial);
    } catch {
      fail("Setup access is unavailable", { publicCode: "setup_not_found", status: 404 });
    }
    if (!constantTimeEqual(session.journeyBindingDigest, currentJourneyBindingDigest)) {
      fail("Setup access is unavailable", { publicCode: "setup_not_found", status: 404 });
    }
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
      tokenHash: session.tokenHash,
      crmContactId: session.crmContactId,
      crmAccountId: session.crmAccountId,
      crmDealId: session.crmDealId,
      journeyBindingDigest: session.journeyBindingDigest,
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

  async function readContext(setupToken) {
    let tokenHash;
    try {
      tokenHash = hashAccessToken(setupToken, config.tokenPepper);
    } catch {
      fail("Setup access is unavailable", { publicCode: "setup_not_found", status: 404 });
    }
    const session = await sessionStore.readByTokenHash(tokenHash);
    if (!session || session.tokenHash !== tokenHash || session.status !== "issued" ||
        session.lastOutcome !== "issued") {
      fail("Setup access is unavailable", { publicCode: "setup_not_found", status: 404 });
    }
    return buildContext(session);
  }

  async function readContextByVerificationId(verificationId) {
    let selected;
    try {
      selected = normalizeVerificationId(verificationId);
    } catch {
      fail("Setup access is unavailable", { publicCode: "setup_not_found", status: 404 });
    }
    const proof = await proofStore.readByProofKey(selected);
    if (!proof) fail("Setup access is unavailable", { publicCode: "setup_not_found", status: 404 });
    const session = await sessionStore.readByRowId(proof.sessionRowId);
    const context = await buildContext(session);
    if (!constantTimeEqual(selected, context.proofKey)) {
      fail("Setup access is unavailable", { publicCode: "setup_not_found", status: 404 });
    }
    assertProofOwnership(proof, context);
    return context;
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
    // A delivery request carries only pre-authentication capabilities. Observing
    // somebody else's completed proof must never elevate that caller.
    if (new Set(["verified", "consumed"]).has(proof?.status)) {
      fail("Verified setup requires its recovery capability");
    }
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

  async function requestEmailOtpForContext(context) {
    let proof = await proofStore.readByProofKey(context.proofKey);
    assertProofOwnership(proof, context);
    if (proof?.status === "sending") {
      proof = await proofStore.resolveStaleSend(proof);
      assertProofOwnership(proof, context);
    }
    const existingState = evidencedDeliveryState(proof);
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

  function withPublicIdentity(result, context) {
    return Object.freeze({
      ...result,
      verificationId: context.proofKey,
      binding: context.binding,
    });
  }

  async function exchangeSetupToken(setupToken) {
    const context = await readContext(setupToken);
    await sessionStore.exchangeSetupToken(context.session.tokenHash, randomOwner("exchange"));
    return withPublicIdentity(await requestEmailOtpForContext(context), context);
  }

  function recoveryTokenFor(proof) {
    if (!new Set(["verified", "consumed"]).has(proof?.status) ||
        !Number.isFinite(Date.parse(proof.verifiedAt))) {
      fail("Verification proof is unavailable");
    }
    // This capability is disclosed only to the successful OTP verifier. It is
    // distinct from the setup link and pre-OTP ID, and survives proof consumption
    // without storing another bearer or adding schema. The binding digest covers
    // the exact session, issue generation, token, CRM records and destination.
    return crypto.createHmac("sha256", config.proofHmacSecret)
      .update("sylvara.form2.verified-recovery.v1\0", "utf8")
      .update(JSON.stringify([
        proof.proofKey, proof.sessionRowId, proof.bindingDigest, proof.destinationDigest,
        proof.otpGeneration, proof.otpDigest, proof.verifiedAt,
      ]), "utf8")
      .digest("hex");
  }

  async function requestEmailOtp(verificationId, recoveryToken) {
    const context = await readContextByVerificationId(verificationId);
    if (recoveryToken !== undefined) {
      const proof = await proofStore.readByProofKey(context.proofKey);
      assertProofOwnership(proof, context);
      if (!/^[a-f0-9]{64}$/.test(recoveryToken ?? "") ||
          !constantTimeEqual(recoveryToken, recoveryTokenFor(proof))) {
        fail("Verified setup requires its recovery capability");
      }
      return withPublicIdentity({ state: "already_verified" }, context);
    }
    return withPublicIdentity(await requestEmailOtpForContext(context), context);
  }

  async function verifyEmailOtp(verificationId, otp) {
    if (typeof otp !== "string" || !/^[0-9]{8}$/.test(otp)) {
      fail("Verification code is invalid");
    }
    const context = await readContextByVerificationId(verificationId);
    let proof = await proofStore.readByProofKey(context.proofKey);
    assertProofOwnership(proof, context);
    if (!proof) fail("Verification proof is unavailable");
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
    return Object.freeze({
      verified: true, binding: context.binding, recoveryToken: recoveryTokenFor(proof),
    });
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
    exchangeSetupToken,
    requestEmailOtp,
    verifyEmailOtp,
  });
}

module.exports = {
  VerificationServiceError,
  createVerificationService,
};
