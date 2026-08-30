"use strict";

const crypto = require("node:crypto");

const ACCESS_TOKEN_BYTES = 32;
const ACCESS_TOKEN_LENGTH = 43;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HMAC_DOMAINS = Object.freeze({
  linkDerivation: "sylvara.form2.access-token.v1",
  linkDigest: "sylvara.form2.access-token-hash.v1",
  proofKey: "sylvara.form2.email-proof-key.v1",
  proofDestination: "sylvara.form2.email-proof-destination.v1",
  proofBinding: "sylvara.form2.email-proof-binding.v1",
  proofOtp: "sylvara.form2.email-proof-otp.v1",
  prefillHandle: "sylvara.form2.prefill-handle-hash.v1",
  prefillBinding: "sylvara.form2.prefill-binding.v1",
});
const ISSUE_REQUEST_DOMAIN = "sylvara.form2.issue-request-key.v1";

class SecurityError extends Error {
  constructor(message, publicCode = "security_configuration_invalid") {
    super(message);
    this.name = "SecurityError";
    this.publicCode = publicCode;
  }
}

function assertPepper(pepper) {
  const bytes = typeof pepper === "string" ? Buffer.byteLength(pepper, "utf8") : 0;
  if (bytes < 32 || bytes > 256 || !/^[\x21-\x7e]+$/.test(pepper ?? "")) {
    throw new SecurityError("TOKEN_PEPPER must be 32-256 printable ASCII bytes");
  }
}

function isValidAccessToken(token) {
  if (
    typeof token !== "string" ||
    token.length !== ACCESS_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  ) {
    return false;
  }
  const decoded = Buffer.from(token, "base64url");
  return decoded.length === ACCESS_TOKEN_BYTES && decoded.toString("base64url") === token;
}

function generateAccessToken(randomBytes = crypto.randomBytes) {
  if (typeof randomBytes !== "function") {
    throw new SecurityError("A cryptographic random-byte provider is required");
  }
  const generated = randomBytes(ACCESS_TOKEN_BYTES);
  if (!Buffer.isBuffer(generated) || generated.length !== ACCESS_TOKEN_BYTES) {
    throw new SecurityError("The random-byte provider returned an invalid token source");
  }
  const token = generated.toString("base64url");
  if (!isValidAccessToken(token)) {
    throw new SecurityError("The random-byte provider did not produce a canonical token");
  }
  return token;
}

function domainSeparatedHmac(value, pepper, domain) {
  assertPepper(pepper);
  return crypto
    .createHmac("sha256", pepper)
    .update(domain, "utf8")
    .update(Buffer.from([0]))
    .update(value, "utf8")
    .digest();
}

function assertIssueRequestId(issueRequestId) {
  if (typeof issueRequestId !== "string" || !UUID_V4_PATTERN.test(issueRequestId)) {
    throw new SecurityError(
      "issue_request_id must be a canonical lowercase UUID v4",
      "issue_request_id_invalid",
    );
  }
}

function deriveAccessToken(issueRequestId, pepper) {
  assertIssueRequestId(issueRequestId);
  const token = domainSeparatedHmac(issueRequestId, pepper, HMAC_DOMAINS.linkDerivation)
    .toString("base64url");
  if (!isValidAccessToken(token)) {
    throw new SecurityError("Derived access token is invalid");
  }
  return token;
}

function deriveIssueRequestKey(issueRequestId) {
  assertIssueRequestId(issueRequestId);
  return crypto
    .createHash("sha256")
    .update(ISSUE_REQUEST_DOMAIN, "utf8")
    .update(Buffer.from([0]))
    .update(issueRequestId, "utf8")
    .digest("hex");
}

function hashAccessToken(token, pepper) {
  if (!isValidAccessToken(token)) {
    throw new SecurityError("Access token is invalid", "access_token_invalid");
  }
  return domainSeparatedHmac(token, pepper, HMAC_DOMAINS.linkDigest).toString("hex");
}

function generatePrefillHandle(randomBytes = crypto.randomBytes) {
  return generateAccessToken(randomBytes);
}

function hashPrefillHandle(handle, secret) {
  if (!isValidAccessToken(handle)) {
    throw new SecurityError("Prefill handle is invalid", "prefill_handle_invalid");
  }
  return domainSeparatedHmac(handle, secret, HMAC_DOMAINS.prefillHandle).toString("hex");
}

function normalizeVerificationId(value) {
  if (typeof value !== "string" || !TOKEN_HASH_PATTERN.test(value)) {
    throw new SecurityError("Verification identifier is invalid", "setup_not_found");
  }
  return value;
}

function prefillBindingDigest(binding, secret) {
  const values = [
    binding?.crmOrganizationHash,
    binding?.crmContactId,
    binding?.crmAccountId,
    binding?.crmDealId,
    binding?.journeyId,
    binding?.formIdentityHash,
    binding?.expectedStage,
    binding?.formVersion,
    binding?.configurationRevision,
  ].map((value) => String(value ?? ""));
  if (!TOKEN_HASH_PATTERN.test(values[0]) ||
      !values.slice(1, 4).every((value) => /^[1-9][0-9]{9,29}$/.test(value)) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(values[4]) ||
      !TOKEN_HASH_PATTERN.test(values[5]) || values[6] !== "form2" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(values[7]) ||
      !/^[a-f0-9]{40}$/.test(values[8])) {
    throw new SecurityError("Prefill binding is invalid", "identity_mismatch");
  }
  return domainSeparatedHmac(
    values.join("\0"),
    secret,
    HMAC_DOMAINS.prefillBinding,
  ).toString("hex");
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  // Digest both inputs first so timingSafeEqual always receives equal-length
  // buffers and the comparison does not disclose the expected secret length.
  const leftDigest = crypto.createHash("sha256").update(left, "utf8").digest();
  const rightDigest = crypto.createHash("sha256").update(right, "utf8").digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function verifyAccessTokenHash(token, expectedHash, pepper) {
  assertPepper(pepper);
  if (!isValidAccessToken(token) || !TOKEN_HASH_PATTERN.test(expectedHash ?? "")) {
    return false;
  }
  const actualHash = hashAccessToken(token, pepper);
  return crypto.timingSafeEqual(
    Buffer.from(actualHash, "hex"),
    Buffer.from(expectedHash, "hex"),
  );
}

function generateEmailOtp(randomInt = crypto.randomInt) {
  if (typeof randomInt !== "function") {
    throw new SecurityError("A cryptographic random-integer provider is required");
  }
  const value = randomInt(0, 100000000);
  if (!Number.isSafeInteger(value) || value < 0 || value >= 100000000) {
    throw new SecurityError("The random-integer provider returned an invalid OTP source");
  }
  return String(value).padStart(8, "0");
}

function normalizeProofEmail(value) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length > 254 ||
    /[\u0000-\u001f\u007f\s]/.test(value) ||
    !/^[^@]+@[^@]+\.[^@]+$/.test(value)
  ) {
    throw new SecurityError("CRM-bound proof destination is invalid", "identity_mismatch");
  }
  const separator = value.lastIndexOf("@");
  // Domain names are case-insensitive; the local part is not universally so.
  // Preserve the CRM-authorized local part instead of silently changing where
  // the verification message may be delivered.
  return `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
}

function proofKey(sessionRowId, secret) {
  const normalized = String(sessionRowId ?? "");
  if (!/^[0-9]{1,30}$/.test(normalized)) {
    throw new SecurityError("Proof session identity is invalid");
  }
  return domainSeparatedHmac(normalized, secret, HMAC_DOMAINS.proofKey).toString("hex");
}

function proofDestinationDigest(email, secret) {
  return domainSeparatedHmac(
    normalizeProofEmail(email),
    secret,
    HMAC_DOMAINS.proofDestination,
  ).toString("hex");
}

function proofBindingDigest(binding, destinationDigest, secret) {
  const values = [
    binding?.sessionRowId,
    binding?.issueRequestKey,
    binding?.tokenHash,
    binding?.crmContactId,
    binding?.crmAccountId,
    binding?.crmDealId,
    binding?.journeyBindingDigest,
    destinationDigest,
  ].map((value) => String(value ?? ""));
  if (
    !/^[0-9]{1,30}$/.test(values[0]) ||
    !values.slice(1, 3).every((value) => TOKEN_HASH_PATTERN.test(value)) ||
    !values.slice(3, 6).every((value) => /^[1-9][0-9]{9,29}$/.test(value)) ||
    !TOKEN_HASH_PATTERN.test(values[6]) ||
    !TOKEN_HASH_PATTERN.test(values[7])
  ) {
    throw new SecurityError("Proof binding is invalid");
  }
  return domainSeparatedHmac(
    values.join("\0"),
    secret,
    HMAC_DOMAINS.proofBinding,
  ).toString("hex");
}

function proofOtpDigest({ selectedProofKey, generation, otp }, secret) {
  if (
    !TOKEN_HASH_PATTERN.test(selectedProofKey ?? "") ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !/^[0-9]{8}$/.test(otp ?? "")
  ) {
    throw new SecurityError("OTP proof input is invalid");
  }
  return domainSeparatedHmac(
    `${selectedProofKey}\0${generation}\0${otp}`,
    secret,
    HMAC_DOMAINS.proofOtp,
  ).toString("hex");
}

function readSingleHeader(headers, expectedName) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;
  const matches = Object.entries(headers).filter(
    ([name]) => typeof name === "string" && name.toLowerCase() === expectedName,
  );
  if (matches.length !== 1 || typeof matches[0][1] !== "string") return null;
  return matches[0][1];
}

function verifyCustomHeader(headers, headerName, expectedSecret) {
  if (!/^x-[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(headerName ?? "")) {
    throw new SecurityError("Configured custom header name is invalid");
  }
  const expectedBytes = typeof expectedSecret === "string"
    ? Buffer.byteLength(expectedSecret, "utf8")
    : 0;
  if (
    expectedBytes < 32 ||
    expectedBytes > 256 ||
    !/^[\x21-\x7e]+$/.test(expectedSecret ?? "")
  ) {
    throw new SecurityError("Configured custom header secret is invalid");
  }
  const actual = readSingleHeader(headers, headerName);
  return actual === null ? false : constantTimeEqual(actual, expectedSecret);
}

module.exports = {
  ACCESS_TOKEN_BYTES,
  ACCESS_TOKEN_LENGTH,
  HMAC_DOMAINS,
  SecurityError,
  constantTimeEqual,
  deriveAccessToken,
  deriveIssueRequestKey,
  generateAccessToken,
  generateEmailOtp,
  generatePrefillHandle,
  hashAccessToken,
  hashPrefillHandle,
  isValidAccessToken,
  normalizeVerificationId,
  normalizeProofEmail,
  prefillBindingDigest,
  proofBindingDigest,
  proofDestinationDigest,
  proofKey,
  proofOtpDigest,
  verifyAccessTokenHash,
  verifyCustomHeader,
};
