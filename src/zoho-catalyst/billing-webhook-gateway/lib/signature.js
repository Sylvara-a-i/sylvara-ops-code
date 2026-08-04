"use strict";

const crypto = require("node:crypto");

class SignatureError extends Error {
  constructor(message) {
    super(message);
    this.name = "SignatureError";
    this.publicCode = "authentication_failed";
  }
}

function decodeSignature(received, encoding) {
  const candidate = String(received ?? "").trim();
  if (encoding === "hex") {
    if (!/^[0-9a-fA-F]{64}$/.test(candidate)) throw new SignatureError("Invalid signature");
    return Buffer.from(candidate, "hex");
  }
  if (encoding === "base64") {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(candidate) || candidate.length % 4 !== 0) {
      throw new SignatureError("Invalid signature");
    }
    const decoded = Buffer.from(candidate, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== candidate) {
      throw new SignatureError("Invalid signature");
    }
    return decoded;
  }
  throw new SignatureError("Unsupported signature encoding");
}

function verifyBillingSignature(rawBody, received, secrets, encoding) {
  const actual = decodeSignature(received, encoding);
  let verified = false;
  for (const signingKey of secrets) {
    const expected = crypto.createHmac("sha256", signingKey).update(rawBody).digest();
    verified = crypto.timingSafeEqual(expected, actual) || verified;
  }
  if (!verified) throw new SignatureError("Signature mismatch");
  return true;
}

function verifySharedHeader(received, expected) {
  const actualBuffer = Buffer.from(String(received ?? ""), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new SignatureError("Shared header mismatch");
  }
}

module.exports = { SignatureError, verifyBillingSignature, verifySharedHeader };
