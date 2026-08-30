"use strict";

const crypto = require("node:crypto");

const TOKEN_BYTES = 32;
const TOKEN_LENGTH = 43;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const CRM_RECORD_ID_PATTERN = /^[1-9][0-9]{9,29}$/;
const JOURNEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OPERATOR_HASH_PATTERN = /^operator_[a-f0-9]{64}$/;
const TOKEN_HASH_DOMAIN = "sylvara.form1.assisted-token-hash.v2";
const SUBMISSION_HASH_DOMAIN = "sylvara.form1.assisted-submission-hash.v1";

class SecurityError extends Error {
  constructor(message, publicCode = "security_input_invalid") {
    super(message);
    this.name = "SecurityError";
    this.status = 422;
    this.publicCode = publicCode;
  }
}

function validateSecret(value, name = "secret") {
  const bytes = typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
  if (bytes < 32 || bytes > 256 || !/^[\x21-\x7e]+$/.test(value ?? "")) {
    throw new SecurityError(`${name} is invalid`, "configuration_invalid");
  }
  return value;
}

function isValidToken(token) {
  if (typeof token !== "string" || token.length !== TOKEN_LENGTH ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const decoded = Buffer.from(token, "base64url");
  return decoded.length === TOKEN_BYTES && decoded.toString("base64url") === token;
}

function generateToken(randomBytes = crypto.randomBytes) {
  if (typeof randomBytes !== "function") throw new SecurityError("Random provider unavailable");
  const source = randomBytes(TOKEN_BYTES);
  if (!Buffer.isBuffer(source) || source.length !== TOKEN_BYTES) {
    throw new SecurityError("Random provider returned invalid token material");
  }
  const token = source.toString("base64url");
  if (!isValidToken(token)) throw new SecurityError("Generated token was not canonical");
  return token;
}

function domainHash(domain, value, secret) {
  validateSecret(secret, "HMAC secret");
  return crypto.createHmac("sha256", secret)
    .update(domain, "utf8").update(Buffer.from([0])).update(value, "utf8").digest("hex");
}

function hashToken(token, pepper) {
  if (!isValidToken(token)) throw new SecurityError("Token is invalid", "token_invalid");
  return domainHash(TOKEN_HASH_DOMAIN, token, pepper);
}

function isValidTokenHash(value) {
  return typeof value === "string" && TOKEN_HASH_PATTERN.test(value);
}

function normalizeCrmRecordId(value) {
  if (typeof value !== "string" || !CRM_RECORD_ID_PATTERN.test(value)) {
    throw new SecurityError("CRM record identifier is invalid", "request_invalid");
  }
  return value;
}

function normalizeCrmModule(value) {
  if (value !== "Leads" && value !== "Deals") {
    throw new SecurityError("CRM module is invalid", "request_invalid");
  }
  return value;
}

function normalizeJourneyId(value) {
  if (typeof value !== "string" || !JOURNEY_ID_PATTERN.test(value)) {
    throw new SecurityError("Journey identifier is invalid", "request_invalid");
  }
  return value;
}

function normalizeSubmissionId(value) {
  if (typeof value !== "string" || !SUBMISSION_ID_PATTERN.test(value)) {
    throw new SecurityError("Submission identifier is invalid", "request_invalid");
  }
  return value;
}

function submissionFingerprint(submissionId, tokenHash, normalizedFormData, secret) {
  const normalized = normalizeSubmissionId(submissionId);
  if (!isValidTokenHash(tokenHash)) {
    throw new SecurityError("Token hash is invalid", "request_invalid");
  }
  if (!normalizedFormData || typeof normalizedFormData !== "object" ||
      Array.isArray(normalizedFormData)) {
    throw new SecurityError("Submission data is invalid", "request_invalid");
  }
  return domainHash(
    SUBMISSION_HASH_DOMAIN,
    `${normalized}\0${tokenHash}\0${JSON.stringify(normalizedFormData)}`,
    secret,
  );
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftDigest = crypto.createHash("sha256").update(left, "utf8").digest();
  const rightDigest = crypto.createHash("sha256").update(right, "utf8").digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function readSingleHeader(headers, expectedName) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;
  const matches = Object.entries(headers).filter(
    ([name]) => typeof name === "string" && name.toLowerCase() === expectedName,
  );
  if (matches.length !== 1 || typeof matches[0][1] !== "string") return null;
  return matches[0][1];
}

function verifySharedSecret(headers, headerName, expectedSecret) {
  if (!/^x-[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(headerName ?? "")) {
    throw new SecurityError("Header configuration is invalid", "configuration_invalid");
  }
  validateSecret(expectedSecret, "Route secret");
  const actual = readSingleHeader(headers, headerName);
  return actual !== null && constantTimeEqual(actual, expectedSecret);
}

function validateOperatorHash(value) {
  if (typeof value !== "string" || !OPERATOR_HASH_PATTERN.test(value)) {
    throw new SecurityError("Issuing actor hash is invalid", "configuration_invalid");
  }
  return value;
}

module.exports = {
  CRM_RECORD_ID_PATTERN,
  JOURNEY_ID_PATTERN,
  OPERATOR_HASH_PATTERN,
  SecurityError,
  TOKEN_BYTES,
  TOKEN_LENGTH,
  constantTimeEqual,
  generateToken,
  hashToken,
  isValidToken,
  isValidTokenHash,
  normalizeCrmModule,
  normalizeCrmRecordId,
  normalizeJourneyId,
  normalizeSubmissionId,
  submissionFingerprint,
  validateOperatorHash,
  validateSecret,
  verifySharedSecret,
};
