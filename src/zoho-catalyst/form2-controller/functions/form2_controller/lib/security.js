"use strict";

const crypto = require("node:crypto");

const ACCESS_TOKEN_BYTES = 32;
const ACCESS_TOKEN_LENGTH = 43;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HMAC_DOMAINS = Object.freeze({
  linkDerivation: "sylvara.form2.access-token.v1",
  linkDigest: "sylvara.form2.access-token-hash.v1",
  issueDigest: "sylvara.form2.issue-key.v1",
});

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

function hashIssueRequestId(issueRequestId, pepper) {
  assertIssueRequestId(issueRequestId);
  return domainSeparatedHmac(issueRequestId, pepper, HMAC_DOMAINS.issueDigest).toString("hex");
}

function hashAccessToken(token, pepper) {
  if (!isValidAccessToken(token)) {
    throw new SecurityError("Access token is invalid", "access_token_invalid");
  }
  return domainSeparatedHmac(token, pepper, HMAC_DOMAINS.linkDigest).toString("hex");
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
  generateAccessToken,
  hashAccessToken,
  hashIssueRequestId,
  isValidAccessToken,
  verifyAccessTokenHash,
  verifyCustomHeader,
};
