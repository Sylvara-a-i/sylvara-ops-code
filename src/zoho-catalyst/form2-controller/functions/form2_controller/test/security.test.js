"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  ACCESS_TOKEN_BYTES,
  ACCESS_TOKEN_LENGTH,
  HMAC_DOMAINS,
  SecurityError,
  constantTimeEqual,
  deriveAccessToken,
  generateAccessToken,
  hashAccessToken,
  isValidAccessToken,
  verifyAccessTokenHash,
  verifyCustomHeader,
} = require("../lib/security");

const PEPPER = "synthetic-token-pepper-000000000000000000";
const ISSUE_REQUEST_ID = "5a1098d4-6358-4c72-9522-634344f12131";

test("generates one canonical 256-bit base64url access token", () => {
  let requestedBytes = 0;
  const token = generateAccessToken((size) => {
    requestedBytes = size;
    return Buffer.from(Array.from({ length: size }, (_, index) => index));
  });
  assert.equal(requestedBytes, ACCESS_TOKEN_BYTES);
  assert.equal(token.length, ACCESS_TOKEN_LENGTH);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.equal(isValidAccessToken(token), true);
});

test("fails closed when the injected random-byte provider is not exactly 256 bits", () => {
  for (const provider of [
    null,
    () => Buffer.alloc(31),
    () => Buffer.alloc(33),
    () => new Uint8Array(32),
  ]) {
    assert.throws(() => generateAccessToken(provider), SecurityError);
  }
});

test("rejects malformed and non-canonical access tokens", () => {
  const valid = Buffer.alloc(32).toString("base64url");
  assert.equal(isValidAccessToken(valid), true);
  for (const token of [
    null,
    "A".repeat(42),
    "A".repeat(44),
    `${"A".repeat(42)}+`,
    `${"A".repeat(42)}=`,
    `${"A".repeat(42)}B`,
  ]) {
    assert.equal(isValidAccessToken(token), false);
  }
});

test("hashes access tokens with HMAC-SHA256 and the configured pepper", () => {
  const token = Buffer.alloc(32, 7).toString("base64url");
  const expected = crypto
    .createHmac("sha256", PEPPER)
    .update(HMAC_DOMAINS.linkDigest)
    .update(Buffer.from([0]))
    .update(token)
    .digest("hex");
  const actual = hashAccessToken(token, PEPPER);
  assert.equal(actual, expected);
  assert.match(actual, /^[a-f0-9]{64}$/);
  assert.equal(verifyAccessTokenHash(token, actual, PEPPER), true);
  assert.equal(
    verifyAccessTokenHash(token, actual, "different-synthetic-pepper-0000000000000"),
    false,
  );
});

test("derives one retry-stable token identity from each immutable issue request", () => {
  const token = deriveAccessToken(ISSUE_REQUEST_ID, PEPPER);
  const tokenHash = hashAccessToken(token, PEPPER);
  assert.equal(token, deriveAccessToken(ISSUE_REQUEST_ID, PEPPER));
  assert.equal(tokenHash, hashAccessToken(deriveAccessToken(ISSUE_REQUEST_ID, PEPPER), PEPPER));
  assert.equal(token.length, 43);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.match(tokenHash, /^[a-f0-9]{64}$/);

  const otherRequest = "8bad1e54-498b-4684-897a-1e063760191c";
  assert.notEqual(deriveAccessToken(otherRequest, PEPPER), token);
  assert.notEqual(
    hashAccessToken(deriveAccessToken(otherRequest, PEPPER), PEPPER),
    tokenHash,
  );
});

test("accepts only canonical lowercase UUID v4 issue request IDs", () => {
  for (const issueRequestId of [
    ISSUE_REQUEST_ID.toUpperCase(),
    "5a1098d4-6358-3c72-9522-634344f12131",
    "5a1098d4-6358-4c72-7522-634344f12131",
    "5a1098d463584c729522634344f12131",
    "not-a-uuid",
    null,
  ]) {
    assert.throws(() => deriveAccessToken(issueRequestId, PEPPER), SecurityError);
  }
});

test("token verification fails closed for malformed hashes and invalid tokens", () => {
  const token = Buffer.alloc(32, 8).toString("base64url");
  for (const hash of ["", "f".repeat(63), "G".repeat(64)]) {
    assert.equal(verifyAccessTokenHash(token, hash, PEPPER), false);
  }
  assert.equal(verifyAccessTokenHash("not-a-token", "f".repeat(64), PEPPER), false);
  assert.throws(() => hashAccessToken(token, "short"), SecurityError);
});

test("compares secrets through fixed-length digests", () => {
  assert.equal(constantTimeEqual("same", "same"), true);
  assert.equal(constantTimeEqual("short", "a much longer different value"), false);
  assert.equal(constantTimeEqual(null, "same"), false);
});

test("verifies exactly one case-insensitive custom header without normalization", () => {
  const secret = "synthetic-route-secret-000000000000000000";
  assert.equal(
    verifyCustomHeader({ "X-Sylvara-Forms-Key": secret }, "x-sylvara-forms-key", secret),
    true,
  );
  assert.equal(
    verifyCustomHeader({ "x-sylvara-forms-key": `${secret} ` }, "x-sylvara-forms-key", secret),
    false,
  );
  assert.equal(
    verifyCustomHeader(
      {
        "x-sylvara-forms-key": secret,
        "X-Sylvara-Forms-Key": secret,
      },
      "x-sylvara-forms-key",
      secret,
    ),
    false,
  );
  assert.equal(
    verifyCustomHeader({ "x-sylvara-forms-key": [secret] }, "x-sylvara-forms-key", secret),
    false,
  );
  assert.equal(verifyCustomHeader({}, "x-sylvara-forms-key", secret), false);
});

test("rejects unsafe custom-header configuration", () => {
  const secret = "synthetic-route-secret-000000000000000000";
  assert.throws(() => verifyCustomHeader({}, "Authorization", secret), SecurityError);
  assert.throws(
    () => verifyCustomHeader({}, "x-sylvara-forms-key", "short"),
    SecurityError,
  );
});
