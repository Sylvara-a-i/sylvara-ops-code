"use strict";

const crypto = require("node:crypto");

const TOKEN_BYTES = 32;
const TOKEN_LENGTH = 43;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const CRM_RECORD_ID_PATTERN = /^[1-9][0-9]{7,29}$/;
const INTAKE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN_HASH_DOMAIN = "sylvara.form1.assisted-token-hash.v1";

class SecurityError extends Error {
  constructor(message, publicCode = "security_input_invalid") {
    super(message);
    this.name = "SecurityError";
    this.status = 422;
    this.publicCode = publicCode;
  }
}

function isValidToken(token) {
  if (typeof token !== "string" || token.length !== TOKEN_LENGTH || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return false;
  }
  const bytes = Buffer.from(token, "base64url");
  return bytes.length === TOKEN_BYTES && bytes.toString("base64url") === token;
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

function validatePepper(pepper) {
  const bytes = typeof pepper === "string" ? Buffer.byteLength(pepper, "utf8") : 0;
  if (bytes < 32 || bytes > 256 || !/^[\x21-\x7e]+$/.test(pepper ?? "")) {
    throw new SecurityError("Token pepper is invalid", "configuration_invalid");
  }
  return pepper;
}

function hashToken(token, pepper) {
  if (!isValidToken(token)) throw new SecurityError("Token is invalid", "token_invalid");
  return crypto
    .createHmac("sha256", validatePepper(pepper))
    .update(TOKEN_HASH_DOMAIN, "utf8")
    .update(Buffer.from([0]))
    .update(token, "utf8")
    .digest("hex");
}

function isValidTokenHash(value) {
  return typeof value === "string" && TOKEN_HASH_PATTERN.test(value);
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
  const bytes = typeof expectedSecret === "string"
    ? Buffer.byteLength(expectedSecret, "utf8")
    : 0;
  if (bytes < 32 || bytes > 256 || !/^[\x21-\x7e]+$/.test(expectedSecret ?? "")) {
    throw new SecurityError("Secret configuration is invalid", "configuration_invalid");
  }
  const actual = readSingleHeader(headers, headerName);
  return actual !== null && constantTimeEqual(actual, expectedSecret);
}

function normalizeLeadId(value) {
  if (typeof value !== "string" || !CRM_RECORD_ID_PATTERN.test(value)) {
    throw new SecurityError("Lead identifier is invalid", "request_invalid");
  }
  return value;
}

function normalizeIntakeSubmissionId(value) {
  if (typeof value !== "string" || !INTAKE_ID_PATTERN.test(value)) {
    throw new SecurityError("Intake submission identifier is invalid", "context_invalid");
  }
  return value;
}

function generateIntakeSubmissionId(randomUUID = crypto.randomUUID) {
  if (typeof randomUUID !== "function") throw new SecurityError("UUID provider unavailable");
  const uuid = randomUUID();
  if (typeof uuid !== "string" || !UUID_V4_PATTERN.test(uuid)) {
    throw new SecurityError("UUID provider returned an invalid identifier");
  }
  return normalizeIntakeSubmissionId(`f1a_${uuid}`);
}

module.exports = {
  CRM_RECORD_ID_PATTERN,
  INTAKE_ID_PATTERN,
  SecurityError,
  TOKEN_BYTES,
  TOKEN_LENGTH,
  constantTimeEqual,
  generateIntakeSubmissionId,
  generateToken,
  hashToken,
  isValidToken,
  isValidTokenHash,
  normalizeIntakeSubmissionId,
  normalizeLeadId,
  verifySharedSecret,
};
