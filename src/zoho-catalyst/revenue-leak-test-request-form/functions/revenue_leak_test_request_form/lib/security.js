"use strict";

const crypto = require("node:crypto");

class SecurityError extends Error {
  constructor(message, publicCode = "security_input_invalid") {
    super(message);
    this.name = "SecurityError";
    this.status = 422;
    this.publicCode = publicCode;
  }
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

module.exports = {
  SecurityError,
  constantTimeEqual,
  verifySharedSecret,
};
