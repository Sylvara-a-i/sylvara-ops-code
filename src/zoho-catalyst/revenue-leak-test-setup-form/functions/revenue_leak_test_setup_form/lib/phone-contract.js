"use strict";

// Current-revision handlers use national prefill and canonical write adapters.
// The original raw receipt hash protocol is unchanged; historical receipt,
// source, snapshot and raw payload evidence are immutable.
const { FormContractError, validateForm2Payload, validateForm2PayloadTypes,
  buildPrefillPayload } = require("./form-contract");
const { PhonePolicyError, normalizeUsPhone, toUsNationalInput } = require("./us-phone-policy");
const PHONE_POLICY = Object.freeze({ id: "us-national-e164-v1", countryCode: "US" });
const PHONE_FIELDS = Object.freeze(["directMobileNumber", "mainBusinessNumber",
  "forwardingAdministratorMobile", "approvedFallbackNumber", "rollbackContactMobile"]);

function phone(value, key, countryCode, required) {
  try { return normalizeUsPhone(value, { countryCode, required }); }
  catch (error) {
    if (!(error instanceof PhonePolicyError)) throw error;
    throw new FormContractError("Phone input does not match the selected policy",
      { field: key, publicCode: "form_data_invalid", status: 422 });
  }
}
function canonicalize(payload, { countryCode, prefill = false } = {}) {
  const result = { ...payload };
  for (const key of PHONE_FIELDS) {
    const required = key === "directMobileNumber" ||
      (!prefill && key !== "approvedFallbackNumber");
    // Preserve existing Form 2 trim/blank semantics before strict phone parsing.
    const value = typeof payload[key] === "string" ? payload[key].trim() : payload[key];
    result[key] = phone(value, key, countryCode, required);
  }
  return Object.freeze(result);
}
function validateCanonicalForm2Payload(payload, options = {}) {
  validateForm2PayloadTypes(payload);
  // Preserve the existing semantic validation, choice and conditional gates.
  validateForm2Payload(payload, options);
  const canonicalPayload = canonicalize(payload, options);
  const currentMobile = phone(options.existing.contact.Mobile,
    "directMobileNumber", options.countryCode, true);
  if (canonicalPayload.directMobileNumber !== currentMobile) {
    throw new FormContractError("Mobile change requires reverification",
      { field: "directMobileNumber", publicCode: "mobile_reverification_required", status: 409 });
  }
  // Contacts.Mobile stays outside the write allowlist; preserve historical bytes.
  // No fingerprint helper accepts canonicalPayload: the handler must hash its
  // original raw formPayload exactly as before, including provider checkbox text.
  return validateForm2Payload(canonicalPayload, options);
}
function buildNationalForm2Prefill(existing, options = {}) {
  const canonical = canonicalize(buildPrefillPayload(existing, options), { ...options, prefill: true });
  const result = { ...canonical };
  // All five approved native controls require national input, including the
  // existing exactly-ten-digit Main Business Number text field. The provider's
  // phone controls own visual masking; this projection never writes CRM.
  for (const key of PHONE_FIELDS) result[key] = toUsNationalInput(canonical[key], options);
  return Object.freeze(result);
}
module.exports = { PHONE_POLICY, PHONE_FIELDS, validateCanonicalForm2Payload, buildNationalForm2Prefill };
