"use strict";

const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const RECORD_ID_PATTERN = /^[1-9][0-9]{9,29}$/;
const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const PROOF_KEYS = new Set([
  "status",
  "sessionRowId",
  "tokenHash",
  "crmContactId",
  "crmAccountId",
  "crmDealId",
  "emailOtpVerifiedAt",
  "captchaVerifiedAt",
  "verifiedAt",
  "expiresAt",
]);

class VerificationProofError extends Error {
  constructor(message = "All verification factors are required") {
    super(message);
    this.name = "VerificationProofError";
    this.publicCode = "verification_required";
    this.status = 403;
  }
}

function deny() {
  throw new VerificationProofError();
}

function createDenyAllVerificationProofStore() {
  return Object.freeze({ readAllFactorsVerifiedProof: deny });
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
    "tokenHash",
    "crmContactId",
    "crmAccountId",
    "crmDealId",
    "issuedAt",
    "expiresAt",
  ])) &&
    ROW_ID_PATTERN.test(String(binding.sessionRowId ?? "")) &&
    TOKEN_HASH_PATTERN.test(binding.tokenHash ?? "") &&
    RECORD_ID_PATTERN.test(binding.crmContactId ?? "") &&
    RECORD_ID_PATTERN.test(binding.crmAccountId ?? "") &&
    RECORD_ID_PATTERN.test(binding.crmDealId ?? "") &&
    Number.isSafeInteger(nowMs) &&
    nowMs >= 0 &&
    Number.isFinite(parseInstant(binding.issuedAt)) &&
    parseInstant(binding.expiresAt) > nowMs;
}

function validProof(proof, binding, nowMs) {
  if (!exactPlainObject(proof, PROOF_KEYS)) return false;
  if (
    proof.status !== "all_factors_verified" ||
    String(proof.sessionRowId) !== String(binding.sessionRowId) ||
    proof.tokenHash !== binding.tokenHash ||
    proof.crmContactId !== binding.crmContactId ||
    proof.crmAccountId !== binding.crmAccountId ||
    proof.crmDealId !== binding.crmDealId
  ) {
    return false;
  }
  const issuedAtMs = parseInstant(binding.issuedAt);
  const sessionExpiresAtMs = parseInstant(binding.expiresAt);
  const factorInstants = [
    parseInstant(proof.emailOtpVerifiedAt),
    parseInstant(proof.captchaVerifiedAt),
  ];
  const verifiedAtMs = parseInstant(proof.verifiedAt);
  const expiresAtMs = parseInstant(proof.expiresAt);
  return factorInstants.every(
    (instant) => Number.isFinite(instant) && instant >= issuedAtMs && instant <= verifiedAtMs,
  ) &&
    Number.isFinite(verifiedAtMs) &&
    verifiedAtMs >= Math.max(...factorInstants) &&
    verifiedAtMs <= nowMs &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > nowMs &&
    expiresAtMs <= sessionExpiresAtMs;
}

async function requireAllFactorsVerified(store, binding, nowMs) {
  if (
    typeof store?.readAllFactorsVerifiedProof !== "function" ||
    !validBinding(binding, nowMs)
  ) {
    throw new VerificationProofError();
  }
  const proof = await store.readAllFactorsVerifiedProof(Object.freeze({ ...binding }));
  if (!validProof(proof, binding, nowMs)) throw new VerificationProofError();
  return Object.freeze({ ...proof });
}

module.exports = {
  VerificationProofError,
  createDenyAllVerificationProofStore,
  requireAllFactorsVerified,
};
