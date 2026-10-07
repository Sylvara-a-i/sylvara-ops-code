"use strict";

// The ordinary handler selects this immutable source-owned profile after its
// exact revision gate and before fingerprinting. Historical recovery stays on
// its schema1 legacy functions; schema2 requires explicit predecessor provenance.
const { FormContractError, normalizeFormData, buildCrmPatch,
  buildPrefillPayload } = require("./form-contract");
const { PhonePolicyError, normalizeUsPhone, toUsNationalInput } = require("./us-phone-policy");

const PHONE_POLICY = Object.freeze({ id: "us-national-e164-v1", countryCode: "US" });
const PHONE_FIELDS = Object.freeze(["mobilePhone", "companyPhone"]);
function phone(value, countryCode, required) {
  try { return normalizeUsPhone(value, { countryCode, required }); }
  catch (error) {
    if (!(error instanceof PhonePolicyError)) throw error;
    throw new FormContractError("Phone input does not match the selected policy");
  }
}
function canonicalizeForm1Submission(formData, { countryCode } = {}) {
  // Preserve exact keys, original trim policy, consent and field validation.
  normalizeFormData(formData);
  const result = { ...formData };
  for (const key of PHONE_FIELDS) result[key] = phone(formData[key], countryCode, true);
  return Object.freeze(result);
}
function prepareCanonicalForm1Submission(formData, constants, receipt, options) {
  const canonicalFormData = canonicalizeForm1Submission(formData, options);
  return Object.freeze({
    canonicalFormData,
    fingerprintValues: normalizeFormData(canonicalFormData),
    crmPatch: buildCrmPatch(canonicalFormData, constants, receipt),
  });
}
function buildNationalForm1Prefill(record, constants, { countryCode } = {}) {
  const payload = { ...buildPrefillPayload(record, constants) };
  for (const key of PHONE_FIELDS) {
    if (Object.hasOwn(payload, key)) {
      payload[key] = toUsNationalInput(phone(payload[key], countryCode, false), { countryCode });
    }
  }
  return Object.freeze(payload);
}
module.exports = { PHONE_POLICY, PHONE_FIELDS, canonicalizeForm1Submission,
  prepareCanonicalForm1Submission, buildNationalForm1Prefill };
