"use strict";

const { normalizeIntakeSubmissionId, normalizeLeadId } = require("./security");

const FIELD_CONTRACT = Object.freeze([
  Object.freeze({ crm: "First_Name", output: "first_name", maximum: 100 }),
  Object.freeze({ crm: "Last_Name", output: "last_name", maximum: 100 }),
  Object.freeze({ crm: "Company", output: "company", maximum: 200 }),
  Object.freeze({ crm: "Decision_Maker_Role", output: "title", maximum: 120 }),
  Object.freeze({ crm: "Designation", output: "exact_job_title", maximum: 100 }),
  Object.freeze({ crm: "Email", output: "email", maximum: 100 }),
  Object.freeze({ crm: "Mobile", output: "mobile_phone", maximum: 30 }),
  // Preserve the prospect's acquisition attribution. Assisted intake is
  // recorded separately through Submission Channel and Source Page.
  Object.freeze({ crm: "Lead_Source", output: "lead_source", maximum: 100 }),
  Object.freeze({ crm: "Main_Business_Phone", output: "company_phone", maximum: 30 }),
  Object.freeze({ crm: "Current_Call_Handling", output: "current_call_handling", maximum: 120 }),
  Object.freeze({ crm: "Requested_Test_Route", output: "preferred_test_route", maximum: 120 }),
  Object.freeze({ crm: "Phone_System_Provider", output: "phone_system_provider", maximum: 150 }),
  Object.freeze({ crm: "Primary_Service_Area", output: "primary_service_area", maximum: 2000 }),
  Object.freeze({ crm: "Field_Team_Size_Band", output: "approximate_field_team_size", maximum: 120 }),
]);

const PREFILL_OUTPUT_KEYS = Object.freeze([
  ...FIELD_CONTRACT.map((field) => field.output),
  "entry_offer",
  "submission_channel",
  "lead_status",
  "intake_submission_id",
  "source_page",
  "intake_form_version",
  "assisted_by",
]);

class FormContractError extends Error {
  constructor(message, { status = 409, publicCode = "context_invalid" } = {}) {
    super(message);
    this.name = "FormContractError";
    this.status = status;
    this.publicCode = publicCode;
  }
}

function normalizeCrmText(value, maximum, fieldName) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") {
    throw new FormContractError(`${fieldName} has an unsupported CRM type`);
  }
  if ([...value].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new FormContractError(`${fieldName} is outside the prefill boundary`);
  }
  return value;
}

function buildPrefillPayload(lead, session, constants) {
  const leadId = normalizeLeadId(lead?.id);
  if (leadId !== normalizeLeadId(session?.leadId)) {
    throw new FormContractError("Lead context does not match the assisted session");
  }
  const intakeSubmissionId = normalizeIntakeSubmissionId(session?.intakeSubmissionId);
  if (lead?.Intake_Submission_ID !== intakeSubmissionId) {
    throw new FormContractError("Lead intake identity no longer matches the assisted session");
  }
  const requiredConstants = [
    "assistedBy",
    "entryOffer",
    "intakeFormVersion",
    "leadStatus",
    "sourcePage",
    "submissionChannel",
  ];
  if (
    !constants ||
    typeof constants !== "object" ||
    requiredConstants.some((key) => typeof constants[key] !== "string" || !constants[key])
  ) {
    throw new FormContractError("Assisted-mode constants are invalid", {
      status: 503,
      publicCode: "configuration_invalid",
    });
  }

  const payload = Object.create(null);
  for (const field of FIELD_CONTRACT) {
    payload[field.output] = normalizeCrmText(lead[field.crm], field.maximum, field.crm);
  }
  Object.assign(payload, {
    assisted_by: constants.assistedBy,
    entry_offer: constants.entryOffer,
    intake_form_version: constants.intakeFormVersion,
    intake_submission_id: intakeSubmissionId,
    lead_status: constants.leadStatus,
    source_page: constants.sourcePage,
    submission_channel: constants.submissionChannel,
  });
  if (
    Object.keys(payload).length !== PREFILL_OUTPUT_KEYS.length ||
    PREFILL_OUTPUT_KEYS.some((key) => !Object.hasOwn(payload, key))
  ) {
    throw new FormContractError("Prefill payload did not match the approved field allowlist", {
      status: 503,
      publicCode: "configuration_invalid",
    });
  }
  return Object.freeze(payload);
}

module.exports = {
  FIELD_CONTRACT,
  FormContractError,
  PREFILL_OUTPUT_KEYS,
  buildPrefillPayload,
};
