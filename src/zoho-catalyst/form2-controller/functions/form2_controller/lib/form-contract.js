"use strict";

const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const CHOICES = Object.freeze({
  decisionMakerRole: Object.freeze([
    "Owner / Founder",
    "General Manager",
    "Operations Manager",
    "Office Manager",
    "Dispatch Manager",
    "Other",
  ]),
  decisionAuthority: Object.freeze([
    "Unknown",
    "Influencer",
    "Recommender",
    "Joint Decision-Maker",
    "Final Decision-Maker",
    "Authorized Signer",
  ]),
  servicesHandled: Object.freeze([
    "Drain Cleaning",
    "Sewer Service",
    "Leak or Pipe Repair",
    "Water Heaters",
    "Fixtures & Faucets",
    "Sump Pumps",
    "Gas Line Service",
    "Commercial Plumbing",
    "Other",
  ]),
  currentCallHandling: Object.freeze([
    "Office Staff / Dispatcher",
    "Owner / Technician Cell",
    "Voicemail",
    "Phone Menu / IVR",
    "Human Answering Service",
    "Existing AI Receptionist",
    "Mixed",
    "Unknown",
  ]),
  testRoute: Object.freeze([
    "After Hours Only",
    "No Answer / Overflow Only",
    "After Hours + Overflow",
  ]),
  noAnswerDelay: Object.freeze([
    "4 Rings",
    "5 Rings",
    "6 Rings",
    "Provider Default",
    "Not Sure",
  ]),
  fallbackDestination: Object.freeze([
    "Existing Office Line",
    "On-Call Mobile",
    "Voicemail",
    "Other",
  ]),
  urgentCallHandling: Object.freeze([
    "Attempt Approved Transfer",
    "Alert + Capture Callback",
    "Capture Callback Only",
  ]),
  existingCustomerCallHandling: Object.freeze([
    "Attempt Transfer",
    "Alert + Capture Callback",
    "Capture Callback Only",
    "Use Approved Fallback",
  ]),
});

const CLIENT_KEYS = Object.freeze([
  "firstName",
  "lastName",
  "decisionMakerRole",
  "jobTitle",
  "decisionAuthority",
  "businessEmail",
  "directMobileNumber",
  "companyName",
  "legalBusinessName",
  "mainBusinessNumber",
  "phoneSystemProvider",
  "primaryServiceArea",
  "normalBusinessHours",
  "fieldTeamSizeBand",
  "servicesHandled",
  "otherServiceDetails",
  "currentCallHandling",
  "requestedTestRoute",
  "approvedTestRoute",
  "requestedStartDate",
  "testPhoneNumber",
  "noAnswerDelay",
  "forwardingAdministratorName",
  "forwardingAdministratorMobile",
  "approvedFallbackDestination",
  "approvedFallbackNumber",
  "rollbackContactName",
  "rollbackContactMobile",
  "urgentCallHandling",
  "existingCustomerCallHandling",
  "alertRecipientName",
  "alertRecipientMobile",
  "alertRecipientEmail",
  "authorizedRepresentativeConfirmed",
  "testScopeAccepted",
]);

const CLIENT_KEY_SET = new Set(CLIENT_KEYS);
const NO_ANSWER_ROUTES = new Set([
  "No Answer / Overflow Only",
  "After Hours + Overflow",
]);
const NUMBERED_FALLBACKS = new Set([
  "Existing Office Line",
  "On-Call Mobile",
  "Other",
]);
const GENERIC_JOB_TITLES = new Set([
  "n/a",
  "na",
  "none",
  "not applicable",
  "other",
  "unknown",
]);

class FormContractError extends Error {
  constructor(message, { field = null, publicCode = "form_invalid", status = 400 } = {}) {
    super(message);
    this.name = "FormContractError";
    this.field = field;
    this.publicCode = publicCode;
    this.status = status;
  }
}

function fail(field, message, options = {}) {
  throw new FormContractError(message, { field, ...options });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoPollutionKeys(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new FormContractError("Cyclic input is prohibited");
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || POLLUTION_KEYS.has(key)) {
      throw new FormContractError("Unsafe input key is prohibited");
    }
    assertNoPollutionKeys(value[key], seen);
  }
  seen.delete(value);
}

function assertPayloadShape(payload) {
  if (!isPlainObject(payload)) throw new FormContractError("Form payload must be a plain object");
  assertNoPollutionKeys(payload);
  for (const key of Object.keys(payload)) {
    if (!CLIENT_KEY_SET.has(key)) {
      throw new FormContractError("Unknown form field is prohibited", {
        field: key,
        publicCode: "unknown_field",
      });
    }
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeText(object, key, { required = false, maximum, multiline = false } = {}) {
  if (!hasOwn(object, key) || object[key] === null || object[key] === undefined) {
    if (required) fail(key, "Required field is missing");
    return null;
  }
  if (typeof object[key] !== "string") fail(key, "Field must be text");
  const value = object[key].replace(/\r\n?/g, "\n").trim();
  if (!value) {
    if (required) fail(key, "Required field is blank");
    return null;
  }
  const prohibited = multiline
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  if (prohibited.test(value)) fail(key, "Field contains prohibited control characters");
  if ([...value].length > maximum) fail(key, "Field exceeds its maximum length");
  return value;
}

function normalizeEmail(object, key, { required = false } = {}) {
  const value = normalizeText(object, key, { required, maximum: 100 });
  if (value === null) return null;
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
    value.startsWith(".") ||
    value.endsWith(".")
  ) {
    fail(key, "Email address is invalid");
  }
  return value;
}

function normalizePhone(object, key, { required = false } = {}) {
  const value = normalizeText(object, key, { required, maximum: 30 });
  if (value === null) return null;
  if (!/^[0-9+().\-\s#xX]+$/.test(value)) fail(key, "Phone number format is invalid");
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 18) fail(key, "Phone number length is invalid");
  return value;
}

function normalizeChoice(object, key, choices, { required = false } = {}) {
  const value = normalizeText(object, key, { required, maximum: 120 });
  if (value === null) return null;
  if (!choices.includes(value)) fail(key, "Choice is not approved");
  return value;
}

function normalizeChoices(object, key, choices, { required = false } = {}) {
  if (!hasOwn(object, key) || object[key] === null || object[key] === undefined) {
    if (required) fail(key, "Required field is missing");
    return [];
  }
  if (!Array.isArray(object[key]) || object[key].length > choices.length) {
    fail(key, "Field must be a bounded choice array");
  }
  const values = object[key].map((entry) => {
    if (typeof entry !== "string" || !choices.includes(entry)) {
      fail(key, "Choice is not approved");
    }
    return entry;
  });
  if (required && values.length === 0) fail(key, "At least one choice is required");
  if (new Set(values).size !== values.length) fail(key, "Duplicate choices are prohibited");
  return values;
}

function normalizeIsoDate(object, key) {
  const value = normalizeText(object, key, { required: true, maximum: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(key, "Date must use YYYY-MM-DD");
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    fail(key, "Date is invalid");
  }
  return value;
}

function requireAffirmation(object, key) {
  if (object[key] !== true) fail(key, "Affirmative confirmation is required");
  return true;
}

function normalizeRecordId(value, field) {
  if (typeof value !== "string" || !/^[1-9][0-9]{7,29}$/.test(value)) {
    fail(field, "CRM record identifier is invalid", {
      publicCode: "context_invalid",
      status: 409,
    });
  }
  return value;
}

function normalizeModifiedTime(value, field) {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail(field, "CRM record version is unavailable", {
      publicCode: "context_invalid",
      status: 409,
    });
  }
  return value;
}

function lookupId(record, key, field, { optional = false } = {}) {
  const lookup = record[key];
  if (optional && (lookup === null || lookup === undefined)) return null;
  if (!isPlainObject(lookup)) {
    fail(field, "CRM relationship is unavailable", {
      publicCode: "relationship_mismatch",
      status: 409,
    });
  }
  return normalizeRecordId(lookup.id, field);
}

function verifyRecordRelationships(existing) {
  if (!isPlainObject(existing)) {
    fail("existing", "CRM context is unavailable", { publicCode: "context_invalid", status: 409 });
  }
  const records = {};
  for (const name of ["contact", "account", "deal"]) {
    if (!isPlainObject(existing[name])) {
      fail(name, "CRM record context is unavailable", {
        publicCode: "context_invalid",
        status: 409,
      });
    }
    records[name] = existing[name];
    normalizeRecordId(existing[name].id, `${name}.id`);
    normalizeModifiedTime(existing[name].Modified_Time, `${name}.Modified_Time`);
  }

  const contactId = records.contact.id;
  const accountId = records.account.id;
  const dealId = records.deal.id;
  const relationships = [
    [lookupId(records.contact, "Account_Name", "contact.Account_Name"), accountId],
    [lookupId(records.deal, "Account_Name", "deal.Account_Name"), accountId],
    [lookupId(records.deal, "Contact_Name", "deal.Contact_Name"), contactId],
  ];
  const accountPrimaryContact = lookupId(
    records.account,
    "Primary_Contact",
    "account.Primary_Contact",
    { optional: true },
  );
  if (accountPrimaryContact !== null) relationships.push([accountPrimaryContact, contactId]);
  if (relationships.some(([actual, expected]) => actual !== expected)) {
    fail("existing", "CRM records are not related to the same customer context", {
      publicCode: "relationship_mismatch",
      status: 409,
    });
  }
  return Object.freeze({ accountId, contactId, dealId });
}

function normalizeTrustedTimestamp(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) {
    throw new FormContractError("Trusted submission time is invalid", {
      publicCode: "configuration_invalid",
      status: 503,
    });
  }
  return date.toISOString();
}

function normalizeServerText(value, name, maximum) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new FormContractError(`${name} is invalid`, {
      publicCode: "configuration_invalid",
      status: 503,
    });
  }
  if ([...value].length > maximum || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new FormContractError(`${name} is invalid`, {
      publicCode: "configuration_invalid",
      status: 503,
    });
  }
  return value;
}

function normalizeServerBusinessValue(value, name, maximum) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    [...value].length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new FormContractError(`${name} is invalid`, {
      publicCode: "configuration_invalid",
      status: 503,
    });
  }
  return value;
}

function canonicalEmail(value) {
  return value.trim().toLowerCase();
}

function canonicalPhone(value) {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

function assertLockedIdentity(submitted, existing, key, { email = false } = {}) {
  const current = existing === null || existing === undefined ? "" : String(existing);
  const equal = email
    ? canonicalEmail(submitted) === canonicalEmail(current)
    : canonicalPhone(submitted) === canonicalPhone(current);
  if (!equal) {
    fail(key, email ? "Verified email cannot be changed" : "Mobile change requires reverification", {
      publicCode: email ? "identity_mismatch" : "mobile_reverification_required",
      status: 409,
    });
  }
}

function assertReadOnlyMatch(submitted, current, field) {
  if (submitted === null) return;
  const normalizedCurrent = current === null || current === undefined ? null : String(current).trim();
  if (submitted !== normalizedCurrent) {
    fail(field, "Read-only CRM context does not match", {
      publicCode: "context_mismatch",
      status: 409,
    });
  }
}

function validatePrivateBand(value, existingValue, allowedValues) {
  if (value === null) return null;
  const permitted = Array.isArray(allowedValues)
    ? allowedValues
    : [existingValue].filter((entry) => typeof entry === "string" && entry.length > 0);
  if (
    permitted.some((entry) => typeof entry !== "string" || !entry.trim()) ||
    !permitted.includes(value)
  ) {
    fail("fieldTeamSizeBand", "Field-team choice is not in the private approved set");
  }
  return value;
}

function freezeUpdates(updates) {
  for (const update of Object.values(updates)) {
    for (const value of Object.values(update)) {
      if (Array.isArray(value)) Object.freeze(value);
    }
    Object.freeze(update);
  }
  return Object.freeze(updates);
}

function validateForm2Payload(payload, options = {}) {
  assertPayloadShape(payload);
  const { existing } = options;
  verifyRecordRelationships(existing);

  const firstName = normalizeText(payload, "firstName", { required: true, maximum: 40 });
  const lastName = normalizeText(payload, "lastName", { required: true, maximum: 80 });
  const decisionMakerRole = normalizeChoice(
    payload,
    "decisionMakerRole",
    CHOICES.decisionMakerRole,
    { required: true },
  );
  const submittedJobTitle = normalizeText(payload, "jobTitle", { maximum: 100 });
  let contactTitle = decisionMakerRole;
  if (decisionMakerRole === "Other") {
    if (
      submittedJobTitle === null ||
      GENERIC_JOB_TITLES.has(submittedJobTitle.toLowerCase())
    ) {
      fail("jobTitle", "Exact job title is required when the selected role is Other");
    }
    contactTitle = submittedJobTitle;
  }
  const decisionAuthority = normalizeChoice(
    payload,
    "decisionAuthority",
    CHOICES.decisionAuthority,
    { required: true },
  );
  const businessEmail = normalizeEmail(payload, "businessEmail", { required: true });
  const directMobileNumber = normalizePhone(payload, "directMobileNumber", { required: true });
  assertLockedIdentity(businessEmail, existing.contact.Email, "businessEmail", { email: true });
  assertLockedIdentity(directMobileNumber, existing.contact.Mobile, "directMobileNumber");

  const companyName = normalizeText(payload, "companyName", { required: true, maximum: 200 });
  const legalBusinessName = normalizeText(payload, "legalBusinessName", {
    required: true,
    maximum: 255,
  });
  const mainBusinessNumber = normalizePhone(payload, "mainBusinessNumber", { required: true });
  const phoneSystemProvider = normalizeText(payload, "phoneSystemProvider", {
    required: true,
    maximum: 150,
  });
  const primaryServiceArea = normalizeText(payload, "primaryServiceArea", {
    required: true,
    maximum: 2000,
    multiline: true,
  });
  const normalBusinessHours = normalizeText(payload, "normalBusinessHours", {
    required: true,
    maximum: 2000,
    multiline: true,
  });
  const fieldTeamSizeBand = validatePrivateBand(
    normalizeText(payload, "fieldTeamSizeBand", { maximum: 120 }),
    existing.account.Field_Team_Size_Band,
    options.allowedFieldTeamSizeBands,
  );
  const servicesHandled = normalizeChoices(
    payload,
    "servicesHandled",
    CHOICES.servicesHandled,
    { required: true },
  );
  const otherServiceDetails = normalizeText(payload, "otherServiceDetails", {
    maximum: 2000,
    multiline: true,
  });
  if (servicesHandled.includes("Other") && otherServiceDetails === null) {
    fail("otherServiceDetails", "Other service details are required");
  }
  if (!servicesHandled.includes("Other") && otherServiceDetails !== null) {
    fail("otherServiceDetails", "Other service details are not applicable");
  }

  const currentCallHandling = normalizeChoice(
    payload,
    "currentCallHandling",
    CHOICES.currentCallHandling,
  );
  const requestedTestRoute = normalizeChoice(
    payload,
    "requestedTestRoute",
    CHOICES.testRoute,
  );
  const approvedTestRoute = normalizeChoice(
    payload,
    "approvedTestRoute",
    CHOICES.testRoute,
    { required: true },
  );
  assertReadOnlyMatch(currentCallHandling, existing.deal.Current_Call_Handling, "currentCallHandling");
  assertReadOnlyMatch(requestedTestRoute, existing.deal.Requested_Test_Route, "requestedTestRoute");
  assertReadOnlyMatch(approvedTestRoute, existing.deal.Approved_Test_Route, "approvedTestRoute");

  const requestedStartDate = normalizeIsoDate(payload, "requestedStartDate");
  const testPhoneNumber = normalizePhone(payload, "testPhoneNumber", { required: true });
  const noAnswerDelay = normalizeChoice(payload, "noAnswerDelay", CHOICES.noAnswerDelay);
  if (NO_ANSWER_ROUTES.has(approvedTestRoute) && noAnswerDelay === null) {
    fail("noAnswerDelay", "No-answer delay is required for the approved route");
  }
  if (!NO_ANSWER_ROUTES.has(approvedTestRoute) && noAnswerDelay !== null) {
    fail("noAnswerDelay", "No-answer delay is not applicable to the approved route");
  }

  const forwardingAdministratorName = normalizeText(payload, "forwardingAdministratorName", {
    required: true,
    maximum: 255,
  });
  const forwardingAdministratorMobile = normalizePhone(
    payload,
    "forwardingAdministratorMobile",
    { required: true },
  );
  const approvedFallbackDestination = normalizeChoice(
    payload,
    "approvedFallbackDestination",
    CHOICES.fallbackDestination,
    { required: true },
  );
  const approvedFallbackNumber = normalizePhone(payload, "approvedFallbackNumber");
  if (NUMBERED_FALLBACKS.has(approvedFallbackDestination) && approvedFallbackNumber === null) {
    fail("approvedFallbackNumber", "Fallback number is required for the selected destination");
  }
  if (!NUMBERED_FALLBACKS.has(approvedFallbackDestination) && approvedFallbackNumber !== null) {
    fail("approvedFallbackNumber", "Fallback number is not applicable to the selected destination");
  }

  const rollbackContactName = normalizeText(payload, "rollbackContactName", {
    required: true,
    maximum: 255,
  });
  const rollbackContactMobile = normalizePhone(payload, "rollbackContactMobile", {
    required: true,
  });
  const urgentCallHandling = normalizeChoice(
    payload,
    "urgentCallHandling",
    CHOICES.urgentCallHandling,
    { required: true },
  );
  const existingCustomerCallHandling = normalizeChoice(
    payload,
    "existingCustomerCallHandling",
    CHOICES.existingCustomerCallHandling,
    { required: true },
  );
  const alertRecipientName = normalizeText(payload, "alertRecipientName", {
    required: true,
    maximum: 255,
  });
  const alertRecipientMobile = normalizePhone(payload, "alertRecipientMobile");
  const alertRecipientEmail = normalizeEmail(payload, "alertRecipientEmail");
  if (alertRecipientMobile === null && alertRecipientEmail === null) {
    fail("alertRecipientMobile", "At least one alert channel is required");
  }

  const authorizedRepresentativeConfirmed = requireAffirmation(
    payload,
    "authorizedRepresentativeConfirmed",
  );
  const testScopeAccepted = requireAffirmation(payload, "testScopeAccepted");
  const submittedAt = normalizeTrustedTimestamp(options.trustedNow);
  const setupFormVersion = normalizeServerText(options.setupFormVersion, "Setup form version", 100);
  const submissionId = normalizeServerText(options.submissionId, "Setup submission identifier", 100);
  const setupAccessSubmittedStatus = normalizeServerBusinessValue(
    options.setupAccessSubmittedStatus,
    "Submitted setup-access status",
    120,
  );

  return freezeUpdates({
    contactUpdate: {
      First_Name: firstName,
      Last_Name: lastName,
      Decision_Maker_Role: decisionMakerRole,
      Title: contactTitle,
      Decision_Authority: decisionAuthority,
    },
    accountUpdate: {
      Account_Name: companyName,
      Legal_Business_Name: legalBusinessName,
      Phone: mainBusinessNumber,
      Phone_System_Provider: phoneSystemProvider,
      Primary_Service_Area: primaryServiceArea,
      Normal_Business_Hours: normalBusinessHours,
      Field_Team_Size_Band: fieldTeamSizeBand,
      Services_Handled: [...servicesHandled],
      Other_Service_Details: otherServiceDetails,
    },
    dealUpdate: {
      Target_Start_Date: requestedStartDate,
      Test_Phone_Number: testPhoneNumber,
      No_Answer_Delay: noAnswerDelay,
      Forwarding_Administrator_Name: forwardingAdministratorName,
      Forwarding_Administrator_Mobile: forwardingAdministratorMobile,
      Approved_Fallback_Destination: approvedFallbackDestination,
      Approved_Fallback_Number: approvedFallbackNumber,
      Rollback_Contact_Name: rollbackContactName,
      Rollback_Contact_Mobile: rollbackContactMobile,
      Urgent_Call_Handling: urgentCallHandling,
      Existing_Customer_Call_Handling: existingCustomerCallHandling,
      Alert_Recipient_Name: alertRecipientName,
      Alert_Recipient_Mobile: alertRecipientMobile,
      Alert_Recipient_Email: alertRecipientEmail,
      Authorized_Representative_Confirmed: authorizedRepresentativeConfirmed,
      Test_Scope_Accepted: testScopeAccepted,
      Authority_Confirmed_At: submittedAt,
      Test_Scope_Accepted_At: submittedAt,
      Setup_Form_Submission_ID: submissionId,
      Setup_Form_Version: setupFormVersion,
      Setup_Form_Submitted_At: submittedAt,
      Setup_Access_Status: setupAccessSubmittedStatus,
    },
  });
}

function prefillText(record, key, maximum) {
  const value = record[key];
  if (value === null || value === undefined || value === "") return null;
  return normalizeText({ value }, "value", { maximum, multiline: maximum > 255 });
}

function prefillChoice(record, key, choices) {
  const value = record[key];
  if (value === null || value === undefined || value === "") return null;
  return normalizeChoice({ value }, "value", choices);
}

function prefillPhone(record, key, { required = false } = {}) {
  const value = record[key];
  return normalizePhone({ value }, "value", { required });
}

function prefillEmail(record, key, { required = false } = {}) {
  const value = record[key];
  return normalizeEmail({ value }, "value", { required });
}

function prefillDate(record, key) {
  const value = record[key];
  if (value === null || value === undefined || value === "") return null;
  return normalizeIsoDate({ value }, "value");
}

function buildPrefillPayloadUnchecked({ contact, account, deal }) {
  verifyRecordRelationships({ contact, account, deal });
  const servicesHandled = account.Services_Handled ?? [];
  if (!Array.isArray(servicesHandled)) {
    fail("servicesHandled", "CRM services field is invalid", {
      publicCode: "context_invalid",
      status: 409,
    });
  }
  const copiedServices = normalizeChoices(
    { servicesHandled },
    "servicesHandled",
    CHOICES.servicesHandled,
  );
  const approvedTestRoute = prefillChoice(deal, "Approved_Test_Route", CHOICES.testRoute);
  if (approvedTestRoute === null) {
    fail("approvedTestRoute", "Approved route is unavailable", {
      publicCode: "context_invalid",
      status: 409,
    });
  }
  const decisionMakerRole = prefillChoice(
    contact,
    "Decision_Maker_Role",
    CHOICES.decisionMakerRole,
  );
  const storedContactTitle = prefillText(contact, "Title", 100);
  const canonicalJobTitle = decisionMakerRole === null || decisionMakerRole === "Other"
    ? storedContactTitle
    : decisionMakerRole;

  const result = {
    firstName: prefillText(contact, "First_Name", 40),
    lastName: prefillText(contact, "Last_Name", 80),
    decisionMakerRole,
    jobTitle: canonicalJobTitle,
    decisionAuthority: prefillChoice(contact, "Decision_Authority", CHOICES.decisionAuthority),
    businessEmail: prefillEmail(contact, "Email", { required: true }),
    directMobileNumber: prefillPhone(contact, "Mobile", { required: true }),
    companyName: prefillText(account, "Account_Name", 200),
    legalBusinessName: prefillText(account, "Legal_Business_Name", 255),
    mainBusinessNumber: prefillPhone(account, "Phone"),
    phoneSystemProvider: prefillText(account, "Phone_System_Provider", 150),
    primaryServiceArea: prefillText(account, "Primary_Service_Area", 2000),
    normalBusinessHours: prefillText(account, "Normal_Business_Hours", 2000),
    fieldTeamSizeBand: prefillText(account, "Field_Team_Size_Band", 120),
    servicesHandled: [...copiedServices],
    otherServiceDetails: prefillText(account, "Other_Service_Details", 2000),
    currentCallHandling: prefillChoice(deal, "Current_Call_Handling", CHOICES.currentCallHandling),
    requestedTestRoute: prefillChoice(deal, "Requested_Test_Route", CHOICES.testRoute),
    approvedTestRoute,
    requestedStartDate: prefillDate(deal, "Target_Start_Date"),
    testPhoneNumber: prefillPhone(deal, "Test_Phone_Number"),
    noAnswerDelay: prefillChoice(deal, "No_Answer_Delay", CHOICES.noAnswerDelay),
    forwardingAdministratorName: prefillText(deal, "Forwarding_Administrator_Name", 255),
    forwardingAdministratorMobile: prefillPhone(deal, "Forwarding_Administrator_Mobile"),
    approvedFallbackDestination: prefillChoice(
      deal,
      "Approved_Fallback_Destination",
      CHOICES.fallbackDestination,
    ),
    approvedFallbackNumber: prefillPhone(deal, "Approved_Fallback_Number"),
    rollbackContactName: prefillText(deal, "Rollback_Contact_Name", 255),
    rollbackContactMobile: prefillPhone(deal, "Rollback_Contact_Mobile"),
    urgentCallHandling: prefillChoice(deal, "Urgent_Call_Handling", CHOICES.urgentCallHandling),
    existingCustomerCallHandling: prefillChoice(
      deal,
      "Existing_Customer_Call_Handling",
      CHOICES.existingCustomerCallHandling,
    ),
    alertRecipientName: prefillText(deal, "Alert_Recipient_Name", 255),
    alertRecipientMobile: prefillPhone(deal, "Alert_Recipient_Mobile"),
    alertRecipientEmail: prefillEmail(deal, "Alert_Recipient_Email"),
    authorizedRepresentativeConfirmed: false,
    testScopeAccepted: false,
  };
  Object.freeze(result.servicesHandled);
  return Object.freeze(result);
}

function buildPrefillPayload(existing) {
  try {
    return buildPrefillPayloadUnchecked(existing);
  } catch (error) {
    if (
      error instanceof FormContractError &&
      !new Set([
        "configuration_invalid",
        "context_invalid",
        "relationship_mismatch",
      ]).has(error.publicCode)
    ) {
      throw new FormContractError("CRM prefill context is invalid", {
        field: error.field,
        publicCode: "context_invalid",
        status: 409,
      });
    }
    throw error;
  }
}

module.exports = {
  CHOICES,
  CLIENT_KEYS,
  FormContractError,
  buildPrefillPayload,
  validateForm2Payload,
  verifyRecordRelationships,
};
