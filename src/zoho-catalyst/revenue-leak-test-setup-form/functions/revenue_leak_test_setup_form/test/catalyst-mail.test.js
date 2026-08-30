"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createCatalystMailAdapter,
  otpMessage,
} = require("../lib/catalyst-mail");
const { proofDestinationDigest } = require("../lib/security");

function config(overrides = {}) {
  return {
    deploymentEnvironment: "development",
    proofMode: "stub",
    form2MailFrom: "verified@example.invalid",
    form2MailTimeoutMs: 250,
    form2ProofTemplateVersion: "email-otp-v1",
    proofHmacSecret: "V".repeat(43),
    form2ProofAllowedRecipientDigests: [],
    ...overrides,
  };
}

function payload() {
  return {
    destination: "authorized@example.invalid",
    otp: "12345678",
    proofKey: "1".repeat(64),
    expiresAt: "2026-08-14T18:10:00.000Z",
  };
}

test("stub mode records provider evidence without accessing Catalyst Mail", async () => {
  let accesses = 0;
  const adapter = createCatalystMailAdapter({ email() { accesses += 1; } }, config());
  const result = await adapter.sendOtp(payload());
  assert.equal(result.outcome, "stubbed");
  assert.match(result.providerResultReference, /^stub_[a-f0-9]{64}$/);
  assert.equal(accesses, 0);
});

test("Development send accepts only a verifiable provider response", async () => {
  let message;
  const approvedRecipient = proofDestinationDigest(
    payload().destination,
    config().proofHmacSecret,
  );
  const adapter = createCatalystMailAdapter({
    email() {
      return {
        async sendMail(candidate) {
          message = candidate;
          return {
            isAsync: true,
            from_email: candidate.from_email,
            to_email: candidate.to_email,
            project_details: { id: "synthetic-project" },
          };
        },
      };
    },
  }, config({
    proofMode: "send_development",
    form2ProofAllowedRecipientDigests: [approvedRecipient],
  }));
  const result = await adapter.sendOtp(payload());
  assert.equal(result.outcome, "accepted");
  assert.match(result.providerResultReference, /^mail_[a-f0-9]{64}$/);
  assert.deepEqual(message.to_email, [payload().destination]);
  assert.equal(message.content.includes(payload().otp), true);
  assert.equal(message.content.includes("SMS"), true);

  const unverifiable = createCatalystMailAdapter({
    email() {
      return {
        async sendMail(candidate) {
          return {
            from_email: candidate.from_email,
            to_email: candidate.to_email,
            project_details: { id: "synthetic-project" },
          };
        },
      };
    },
  }, config({
    proofMode: "send_development",
    form2ProofAllowedRecipientDigests: [approvedRecipient],
  }));
  assert.deepEqual(await unverifiable.sendOtp(payload()), {
    outcome: "ambiguous",
    providerResultReference: "",
  });
});

test("post-invocation timeout is ambiguous and never represented as retryable", async () => {
  const approvedRecipient = proofDestinationDigest(
    payload().destination,
    config().proofHmacSecret,
  );
  const adapter = createCatalystMailAdapter({
    email() { return { sendMail() { return new Promise(() => {}); } }; },
  }, config({
    proofMode: "send_development",
    form2ProofAllowedRecipientDigests: [approvedRecipient],
  }));
  const result = await adapter.sendOtp(payload());
  assert.deepEqual(result, { outcome: "ambiguous", providerResultReference: "" });
});

test("Development send rejects an unapproved recipient before Mail access", async () => {
  let accesses = 0;
  const adapter = createCatalystMailAdapter({
    email() { accesses += 1; },
  }, config({
    proofMode: "send_development",
    form2ProofAllowedRecipientDigests: [proofDestinationDigest(
      "different@example.invalid",
      config().proofHmacSecret,
    )],
  }));
  await assert.rejects(() => adapter.sendOtp(payload()), /not approved/);
  assert.equal(accesses, 0);
});

test("mail HTML escapes all dynamic content", () => {
  const html = otpMessage({ otp: "<123456>", expiresAt: "<script>alert(1)</script>" });
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("&lt;script&gt;"), true);
});

test("Production and unsupported modes are rejected before provider access", () => {
  for (const overrides of [
    { deploymentEnvironment: "production" },
    { proofMode: "send" },
  ]) {
    assert.throws(() => createCatalystMailAdapter({}, config(overrides)));
  }
});
