"use strict";

// Authoritative source: src/zoho-forms/free-revenue-leak-test/phone-policy.
// Function-local copies are byte-identical packaging inputs, checked by the
// policy tests. Do not add cross-function runtime imports.
// Policy reused from revenue_desk_call_gateway/lib/free-test-preparation.js:
// explicit US context, NANP syntax, no extension stripping or country guessing.
class PhonePolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = "PhonePolicyError";
    this.code = code;
  }
}
function fail(code) { throw new PhonePolicyError(code); }

function normalizeUsPhone(value, { countryCode, required = false } = {}) {
  if (countryCode !== "US") fail("PHONE_COUNTRY_UNRESOLVED");
  if (value === null || value === undefined || value === "") {
    if (required) fail("PHONE_REQUIRED");
    return null;
  }
  if (typeof value !== "string" || value.length > 30 ||
      !/^[+0-9(). -]+$/.test(value)) fail("PHONE_FORMAT_INVALID");
  let digits = value.replace(/[(). -]/g, "");
  if (/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits)) digits = `+1${digits}`;
  else if (/^1[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits)) digits = `+${digits}`;
  if (!/^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits)) fail("PHONE_FORMAT_INVALID");
  return digits;
}

function requireCanonical(canonical, options) {
  if (canonical === null) {
    normalizeUsPhone(null, options);
    return null;
  }
  const normalized = normalizeUsPhone(canonical, { ...options, required: true });
  if (normalized !== canonical) fail("PHONE_CANONICAL_REQUIRED");
  return normalized;
}

function toUsNationalInput(canonical, options) {
  const checked = requireCanonical(canonical, options);
  return checked === null ? null : checked.slice(2);
}

function formatUsPhoneDisplay(canonical, options) {
  const checked = requireCanonical(canonical, options);
  return checked === null ? null :
    `(${checked.slice(2, 5)}) ${checked.slice(5, 8)}-${checked.slice(8)}`;
}

// NANP syntax and +1 do not prove US geographical allocation, ownership,
// reachability, consent, or permission to call/message.
module.exports = { PhonePolicyError, normalizeUsPhone, toUsNationalInput, formatUsPhoneDisplay };
