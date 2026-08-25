"use strict";

const FIELD_SETUP_STATES = Object.freeze([
  "loading_session_validation",
  "company_progress_summary",
  "handoff_to_client_form1",
  "form1_open_or_resume",
  "form1_completion_confirmation",
  "return_to_operator_after_form1",
  "operator_qualification_review",
  "lead_conversion_preview",
  "lead_conversion_confirmation",
  "handoff_to_client_form2",
  "form2_email_verification",
  "form2_open_or_resume",
  "form2_completion_confirmation",
  "return_to_operator_after_form2",
  "number_reservation_status",
  "forwarding_instructions",
  "rollback_instructions",
  "route_verification_status",
  "ready_for_approval",
  "live_status",
  "stop_rollback_status",
  "recoverable_blocked",
]);

const QUALIFICATION_FACTORS = Object.freeze([
  "companyHasMeaningfulCallVolume",
  "canAcceptAdditionalProfitableWork",
  "hasRepeatableIntakeProcess",
  "willAuthorizeControlledForwardingPath",
  "hasAccountableCallbackOrHandoffOwner",
  "decisionMakerIsPresent",
]);

const QUALIFICATION_DECISIONS = Object.freeze([
  "qualified_continue_setup",
  "not_ready_save_and_follow_up",
  "disqualified",
]);

const BROWSER_ACTIONS = Object.freeze([
  "acknowledge_company_summary",
  "handoff_to_client",
  "open_form1",
  "confirm_form1_return",
  "handoff_to_operator",
  "open_form2_email_verification",
  "open_form2",
  "confirm_form2_return",
  "view_forwarding_instructions",
  "view_rollback_instructions",
  "refresh_status",
  "stop_setup",
]);

const PROHIBITED_BROWSER_ACTIONS = Object.freeze([
  "qualify",
  "convert_lead",
  "reserve_number",
  "open_verification_window",
  "approve",
  "activate",
  "start_test",
  "stop_live_route",
  "rollback_live_route",
]);

const CRM_MODULES = new Set(["Leads", "Deals"]);
const RECORD_ID_PATTERN = /^[0-9]{1,30}$/;
const USER_ID_PATTERN = /^[0-9]{1,30}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class FieldSetupContractError extends Error {
  constructor(message, publicCode = "field_setup_invalid") {
    super(message);
    this.name = "FieldSetupContractError";
    this.status = publicCode === "field_setup_not_found" ? 404 : 422;
    this.publicCode = publicCode;
  }
}

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FieldSetupContractError(`${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new FieldSetupContractError(`${label} does not match the approved contract`);
  }
}

function normalizeBoundedIdentifier(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new FieldSetupContractError(`${label} is invalid`);
  }
  return value;
}

function normalizeTrustedLaunchContext(value) {
  requireExactKeys(
    value,
    ["environment", "moduleApiName", "operatorUserId", "recordId"],
    "Launch context",
  );
  if (value.environment !== "development" || !CRM_MODULES.has(value.moduleApiName)) {
    throw new FieldSetupContractError("Launch context is outside the Development allowlist");
  }
  return Object.freeze({
    environment: value.environment,
    moduleApiName: value.moduleApiName,
    operatorUserId: normalizeBoundedIdentifier(value.operatorUserId, USER_ID_PATTERN, "Operator"),
    recordId: normalizeBoundedIdentifier(value.recordId, RECORD_ID_PATTERN, "Record"),
  });
}

function normalizeAuthenticatedOperator(value) {
  requireExactKeys(value, ["authenticated", "environment", "operatorUserId", "role"], "Operator");
  if (
    value.authenticated !== true ||
    value.environment !== "development" ||
    value.role !== "field_setup_operator"
  ) {
    throw new FieldSetupContractError("Authenticated field-setup operator is required", "authentication_failed");
  }
  return Object.freeze({
    authenticated: true,
    environment: value.environment,
    operatorUserId: normalizeBoundedIdentifier(value.operatorUserId, USER_ID_PATTERN, "Operator"),
    role: value.role,
  });
}

function normalizeQualificationBody(value) {
  requireExactKeys(value, [...QUALIFICATION_FACTORS, "decision"], "Qualification decision");
  for (const key of QUALIFICATION_FACTORS) {
    if (typeof value[key] !== "boolean") {
      throw new FieldSetupContractError(`Qualification factor ${key} must be boolean`);
    }
  }
  if (!QUALIFICATION_DECISIONS.includes(value.decision)) {
    throw new FieldSetupContractError("Qualification decision is invalid");
  }
  if (value.decision === "qualified_continue_setup" && QUALIFICATION_FACTORS.some((key) => !value[key])) {
    throw new FieldSetupContractError("A qualified decision requires every approved factor");
  }
  return Object.freeze(Object.fromEntries(Object.entries(value)));
}

function assertOperatorBound(journey, operator) {
  const normalized = normalizeAuthenticatedOperator(operator);
  if (
    journey?.environment !== normalized.environment ||
    journey?.operatorUserId !== normalized.operatorUserId
  ) {
    throw new FieldSetupContractError("Operator is not bound to this journey", "authentication_failed");
  }
  return normalized;
}

function authorizeQualification(journey, body, operator) {
  assertOperatorBound(journey, operator);
  const decision = normalizeQualificationBody(body);
  return Object.freeze({
    decision: decision.decision,
    factors: Object.freeze(
      Object.fromEntries(QUALIFICATION_FACTORS.map((key) => [key, decision[key]])),
    ),
    nextState: decision.decision === "qualified_continue_setup"
      ? "lead_conversion_preview"
      : "recoverable_blocked",
    conversionAuthorized: false,
  });
}

function assertBrowserAction(action) {
  if (PROHIBITED_BROWSER_ACTIONS.includes(action)) {
    throw new FieldSetupContractError("The browser cannot perform this operator action", "authentication_failed");
  }
  if (!BROWSER_ACTIONS.includes(action)) {
    throw new FieldSetupContractError("Browser action is invalid");
  }
  return action;
}

function validateStoredJourney(value) {
  if (
    !value ||
    !UUID_PATTERN.test(value.journeyKey ?? "") ||
    !SHA256_PATTERN.test(value.launchDigest ?? "") ||
    (value.sessionDigest && !SHA256_PATTERN.test(value.sessionDigest)) ||
    !FIELD_SETUP_STATES.includes(value.state) ||
    !CRM_MODULES.has(value.moduleApiName) ||
    !RECORD_ID_PATTERN.test(value.recordId ?? "") ||
    !USER_ID_PATTERN.test(value.operatorUserId ?? "") ||
    value.environment !== "development"
  ) {
    throw new FieldSetupContractError("Stored journey is invalid", "field_setup_not_found");
  }
  return value;
}

module.exports = {
  BROWSER_ACTIONS,
  FIELD_SETUP_STATES,
  FieldSetupContractError,
  PROHIBITED_BROWSER_ACTIONS,
  QUALIFICATION_DECISIONS,
  QUALIFICATION_FACTORS,
  assertBrowserAction,
  assertOperatorBound,
  authorizeQualification,
  normalizeAuthenticatedOperator,
  normalizeTrustedLaunchContext,
  validateStoredJourney,
};
