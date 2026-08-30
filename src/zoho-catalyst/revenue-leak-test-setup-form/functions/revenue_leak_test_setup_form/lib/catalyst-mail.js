"use strict";

const crypto = require("node:crypto");
const { proofDestinationDigest } = require("./security");

function domainSeparatedHmac(value, secret, domain) {
  return crypto.createHmac("sha256", secret)
    .update(domain, "utf8")
    .update(Buffer.from([0]))
    .update(value, "utf8")
    .digest("hex");
}

class CatalystMailError extends Error {
  constructor(message, publicCode = "mail_unavailable") {
    super(message);
    this.name = "CatalystMailError";
    this.publicCode = publicCode;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function otpMessage({ otp, expiresAt }) {
  return [
    "<p>Use this one-time code to continue your Sylvara Free Revenue Leak Test setup:</p>",
    `<p style="font-size:24px;font-weight:700;letter-spacing:0.18em">${escapeHtml(otp)}</p>`,
    `<p>This code expires at ${escapeHtml(expiresAt)}.</p>`,
    "<p>If you did not request this code, you can ignore this message.</p>",
    "<p>This does not activate call routing, billing, paid service, or SMS.</p>",
  ].join("");
}

function validateConfig(config) {
  if (
    config?.deploymentEnvironment !== "development" ||
    !new Set(["stub", "send_development"]).has(config?.proofMode) ||
    typeof config?.form2MailFrom !== "string" ||
    !config.form2MailFrom.includes("@") ||
    !Number.isSafeInteger(config?.form2MailTimeoutMs) ||
    config.form2MailTimeoutMs < 250 ||
    config.form2MailTimeoutMs > 15000 ||
    typeof config?.form2ProofTemplateVersion !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(config.form2ProofTemplateVersion) ||
    typeof config?.proofHmacSecret !== "string" ||
    Buffer.byteLength(config.proofHmacSecret, "utf8") < 32 ||
    !Array.isArray(config?.form2ProofAllowedRecipientDigests) ||
    config.form2ProofAllowedRecipientDigests.length > 16 ||
    config.form2ProofAllowedRecipientDigests.some((entry) =>
      typeof entry !== "string" || !/^[a-f0-9]{64}$/.test(entry)) ||
    new Set(config.form2ProofAllowedRecipientDigests).size !==
      config.form2ProofAllowedRecipientDigests.length ||
    (config.proofMode === "send_development" &&
      config.form2ProofAllowedRecipientDigests.length === 0)
  ) {
    throw new CatalystMailError("Catalyst Mail configuration is invalid", "configuration_invalid");
  }
}

function createCatalystMailAdapter(app, config) {
  validateConfig(config);
  if (!app || typeof app !== "object") {
    throw new CatalystMailError("Catalyst application context is unavailable", "configuration_invalid");
  }

  async function sendOtp({ destination, otp, proofKey, expiresAt }) {
    if (
      typeof destination !== "string" ||
      destination.length > 254 ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destination) ||
      !/^[0-9]{8}$/.test(otp ?? "") ||
      !/^[a-f0-9]{64}$/.test(proofKey ?? "") ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt ?? "")
    ) {
      throw new CatalystMailError("OTP mail input is invalid", "verification_required");
    }
    if (config.proofMode === "stub") {
      return Object.freeze({
        // Stub mode creates deterministic local proof evidence, but it is not
        // provider-send evidence and must never be described as an email sent.
        outcome: "stubbed",
        providerResultReference: `stub_${domainSeparatedHmac(
          `${proofKey}\0${config.form2ProofTemplateVersion}`,
          config.proofHmacSecret,
          "sylvara.form2.otp-mail-stub.v1",
        ).slice(0, 64)}`,
      });
    }
    const destinationDigest = proofDestinationDigest(destination, config.proofHmacSecret);
    if (!config.form2ProofAllowedRecipientDigests.some((approvedDigest) =>
      crypto.timingSafeEqual(
        Buffer.from(approvedDigest, "hex"),
        Buffer.from(destinationDigest, "hex"),
      ))) {
      throw new CatalystMailError(
        "OTP destination is not approved for Development delivery",
        "verification_required",
      );
    }

    let timer;
    let invoked = false;
    try {
      const mail = app.email();
      if (!mail || typeof mail.sendMail !== "function") {
        throw new CatalystMailError("Catalyst Mail sender is unavailable");
      }
      const operation = Promise.resolve().then(() => {
        invoked = true;
        return mail.sendMail({
          from_email: config.form2MailFrom,
          to_email: [destination],
          subject: "Your Sylvara setup verification code",
          content: otpMessage({ otp, expiresAt }),
          html_mode: true,
        });
      });
      const providerResponse = await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new CatalystMailError("Catalyst Mail timed out")),
            config.form2MailTimeoutMs);
        }),
      ]);
      if (
        !providerResponse ||
        typeof providerResponse !== "object" ||
        Array.isArray(providerResponse) ||
        typeof providerResponse.isAsync !== "boolean" ||
        providerResponse.from_email !== config.form2MailFrom ||
        !Array.isArray(providerResponse.to_email) ||
        providerResponse.to_email.length !== 1 ||
        providerResponse.to_email[0] !== destination ||
        !providerResponse.project_details ||
        !["string", "number"].includes(typeof providerResponse.project_details.id)
      ) {
        return Object.freeze({ outcome: "ambiguous", providerResultReference: "" });
      }
      const reference = domainSeparatedHmac(
        [
          proofKey,
          providerResponse.project_details.id,
          providerResponse.isAsync,
          providerResponse.from_email,
          providerResponse.to_email[0],
        ].join("\0"),
        config.proofHmacSecret,
        "sylvara.form2.otp-mail-result.v1",
      );
      return Object.freeze({
        outcome: "accepted",
        providerResultReference: `mail_${reference.slice(0, 64)}`,
      });
    } catch (error) {
      if (!invoked) {
        return Object.freeze({ outcome: "retry_required", providerResultReference: "" });
      }
      if (error?.terminal === true) {
        return Object.freeze({ outcome: "terminal_failure", providerResultReference: "" });
      }
      return Object.freeze({ outcome: "ambiguous", providerResultReference: "" });
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ sendOtp });
}

module.exports = {
  CatalystMailError,
  createCatalystMailAdapter,
  escapeHtml,
  otpMessage,
};
