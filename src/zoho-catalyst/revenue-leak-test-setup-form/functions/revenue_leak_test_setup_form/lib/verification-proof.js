"use strict";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RECORD_ID_PATTERN = /^[1-9][0-9]{9,29}$/;
const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const PROOF_KEYS = new Set([
  "status",
  "proofKey",
  "sessionRowId",
  "bindingDigest",
  "destinationDigest",
  "verifiedAt",
  "expiresAt",
]);

class VerificationProofError extends Error {
  constructor(message = "Verified email access is required") {
    super(message);
    this.name = "VerificationProofError";
    this.publicCode = "verification_required";
    this.status = 403;
  }
}

function exactPlainObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.size && actual.every(
    (key) => typeof key === "string" && keys.has(key),
  );
}

function parseInstant(value) {
  if (typeof value !== "string") return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : NaN;
}

function validBinding(binding, nowMs) {
  return exactPlainObject(binding, new Set([
    "sessionRowId",
    "issueRequestKey",
    "tokenHash",
    "crmContactId",
    "crmAccountId",
    "crmDealId",
    "journeyBindingDigest",
    "issuedAt",
    "expiresAt",
  ])) &&
    ROW_ID_PATTERN.test(String(binding.sessionRowId ?? "")) &&
    HASH_PATTERN.test(binding.issueRequestKey ?? "") &&
    HASH_PATTERN.test(binding.tokenHash ?? "") &&
    RECORD_ID_PATTERN.test(binding.crmContactId ?? "") &&
    RECORD_ID_PATTERN.test(binding.crmAccountId ?? "") &&
    RECORD_ID_PATTERN.test(binding.crmDealId ?? "") &&
    HASH_PATTERN.test(binding.journeyBindingDigest ?? "") &&
    Number.isSafeInteger(nowMs) &&
    nowMs >= 0 &&
    Number.isFinite(parseInstant(binding.issuedAt)) &&
    parseInstant(binding.expiresAt) > nowMs;
}

function validProof(proof, binding, nowMs) {
  if (!exactPlainObject(proof, PROOF_KEYS)) return false;
  const verifiedAtMs = parseInstant(proof.verifiedAt);
  const expiresAtMs = parseInstant(proof.expiresAt);
  return proof.status === "consumed" &&
    String(proof.sessionRowId) === String(binding.sessionRowId) &&
    HASH_PATTERN.test(proof.proofKey ?? "") &&
    HASH_PATTERN.test(proof.bindingDigest ?? "") &&
    HASH_PATTERN.test(proof.destinationDigest ?? "") &&
    Number.isFinite(verifiedAtMs) &&
    verifiedAtMs >= parseInstant(binding.issuedAt) &&
    verifiedAtMs <= nowMs &&
    Number.isFinite(expiresAtMs) &&
    verifiedAtMs <= expiresAtMs &&
    expiresAtMs <= parseInstant(binding.expiresAt);
}

async function requireEmailOtpVerified(service, binding, destinationEmail, nowMs) {
  if (
    typeof service?.consumeVerifiedProof !== "function" ||
    !validBinding(binding, nowMs) ||
    typeof destinationEmail !== "string"
  ) {
    throw new VerificationProofError();
  }
  const proof = await service.consumeVerifiedProof(
    Object.freeze({ ...binding }),
    destinationEmail,
    nowMs,
  );
  if (!validProof(proof, binding, nowMs)) throw new VerificationProofError();
  return Object.freeze({ ...proof });
}

module.exports = {
  VerificationProofError,
  requireEmailOtpVerified,
};
