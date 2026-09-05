"use strict";

const FIELD_SPECS = Object.freeze([
  ["firstName", "First_Name", 100, true],
  ["lastName", "Last_Name", 100, true],
  ["company", "Company", 200, true],
  ["decisionMakerRole", "Decision_Maker_Role", 120, true],
  ["jobTitle", "Designation", 100, false],
  ["email", "Email", 254, true],
  ["mobilePhone", "Mobile", 30, true],
  ["companyPhone", "Main_Business_Phone", 30, true],
  ["currentCallHandling", "Current_Call_Handling", 120, true],
  ["preferredTestRoute", "Requested_Test_Route", 120, true],
  ["phoneSystemProvider", "Phone_System_Provider", 150, false],
  ["primaryServiceArea", "Primary_Service_Area", 2000, false],
  ["fieldTeamSizeBand", "Field_Team_Size_Band", 120, false],
  ["additionalNotes", "Free_Test_Request_Notes", 4000, false],
  ["leadSource", "Lead_Source", 100, false],
  ["sourcePage", "Source_Page", 200, false],
  ["utmSource", "UTM_Source", 255, false],
  ["utmMedium", "UTM_Medium", 255, false],
  ["utmCampaign", "UTM_Campaign", 255, false],
  ["utmTerm", "UTM_Term", 255, false],
  ["utmContent", "UTM_Content", 255, false],
]);
const FORM_KEYS = new Set([...FIELD_SPECS.map(([key]) => key), "contactConsent"]);

class FormContractError extends Error {
  constructor(message, { status = 422, publicCode = "form_data_invalid" } = {}) {
    super(message);
    this.name = "FormContractError";
    this.status = status;
    this.publicCode = publicCode;
  }
}

function exactObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === FORM_KEYS.size && keys.every((key) =>
    typeof key === "string" && FORM_KEYS.has(key) &&
    !["__proto__", "constructor", "prototype"].includes(key));
}

function text(value, key, maximum, required) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new FormContractError(`${key} is required`);
    return null;
  }
  if (typeof value !== "string" || value !== value.trim() ||
      [...value].length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new FormContractError(`${key} is invalid`);
  }
  if (key === "email" && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) || value.length > 254)) {
    throw new FormContractError("email is invalid");
  }
  return value;
}

function normalizeFormData(value) {
  if (!exactObject(value)) {
    throw new FormContractError("Form data does not match the assisted allowlist");
  }
  if (value.contactConsent !== true) {
    throw new FormContractError("Contact consent must be explicitly true");
  }
  const normalized = {};
  for (const [key, crm, maximum, required] of FIELD_SPECS) {
    normalized[crm] = text(value[key], key, maximum, required);
  }
  return Object.freeze(normalized);
}

function buildPrefillPayload(record, constants) {
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      !constants || typeof constants.sourcePage !== "string" || !constants.sourcePage) {
    throw new FormContractError("Prefill context is invalid", {
      status: 503,
      publicCode: "configuration_invalid",
    });
  }
  const payload = {};
  for (const [key, crm, maximum] of FIELD_SPECS) {
    const fallback = key === "sourcePage" && !record[crm] ? constants.sourcePage : record[crm];
    const selected = text(fallback, key, maximum, false);
    if (selected !== null) payload[key] = selected;
  }
  // Consent is deliberately never prefilled; the respondent must provide it.
  return Object.freeze(payload);
}

/** Parse only CRM's whole-second datetime format, rejecting calendar rollover. */
function parseCrmReceiptTime(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value) ||
      Number(value.slice(0, 4)) < 1 || Number(value.slice(20, 22)) > 23 ||
      Number(value.slice(23, 25)) > 59) return null;
  const localIso = `${value.slice(0, 19)}.000Z`;
  const localTime = Date.parse(localIso);
  if (!Number.isFinite(localTime) || new Date(localTime).toISOString() !== localIso) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

function serializeCrmReceiptTime(submittedAt) {
  const instant = typeof submittedAt === "string" ? Date.parse(submittedAt) : NaN;
  if (typeof submittedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(submittedAt) ||
      !Number.isFinite(instant) || new Date(instant).toISOString() !== submittedAt ||
      Number(submittedAt.slice(0, 4)) < 1) {
    throw new FormContractError("Submission time is invalid", {
      status: 503,
      publicCode: "configuration_invalid",
    });
  }
  // The durable claim keeps its original milliseconds. Only the CRM receipt
  // uses the provider's whole-second format; floor rather than move it forward.
  return `${submittedAt.slice(0, 19)}+00:00`;
}

function buildCrmPatch(formData, constants, { journeyId, submittedAt }) {
  const normalized = normalizeFormData(formData);
  if (!constants || typeof constants !== "object" ||
      Object.values(constants).some((value) => typeof value !== "string" || !value)) {
    throw new FormContractError("Assisted constants are invalid", {
      status: 503,
      publicCode: "configuration_invalid",
    });
  }
  if (typeof journeyId !== "string" || !journeyId) {
    throw new FormContractError("Journey binding is invalid", {
      status: 503,
      publicCode: "configuration_invalid",
    });
  }
  const receiptTime = serializeCrmReceiptTime(submittedAt);
  // Acquisition source belongs to CRM, while route provenance belongs to the
  // server configuration. Keep both submitted fields in the fixed Forms
  // transport/fingerprint contract, but never grant them write authority.
  const {
    Lead_Source: _respondentLeadSource,
    Source_Page: _respondentSourcePage,
    ...respondentFields
  } = normalized;
  const patch = {
    ...respondentFields,
    Entry_Offer: constants.entryOffer,
    Submission_Channel: constants.submissionChannel,
    Intake_Submission_ID: journeyId,
    Free_Test_Contact_Consent: true,
    Free_Test_Contact_Consent_Version: "form1-contact-consent-v1",
    Free_Test_Contact_Consent_At: receiptTime,
    Free_Test_Request_Submitted_At: receiptTime,
    Intake_Form_Version: constants.intakeFormVersion,
    Lead_Status: constants.leadStatus,
    Source_Page: constants.sourcePage,
  };
  return Object.freeze(Object.fromEntries(
    Object.entries(patch).filter(([, selected]) => selected !== null),
  ));
}

module.exports = {
  FIELD_SPECS,
  FORM_KEYS,
  FormContractError,
  buildPrefillPayload,
  buildCrmPatch,
  normalizeFormData,
  parseCrmReceiptTime,
};
