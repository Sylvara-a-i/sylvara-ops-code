"use strict";

const { isApprovedCrmApiHostname } = require("./destinations");
const { HttpBoundaryError, requestJson } = require("./http");
const { verifyRecordRelationships } = require("./form-contract");

const MODULES = Object.freeze(["Contacts", "Accounts", "Deals"]);
const MODULE_SET = new Set(MODULES);

const READ_FIELDS = Object.freeze({
  Contacts: Object.freeze([
    "Modified_Time",
    "Account_Name",
    "First_Name",
    "Last_Name",
    "Decision_Maker_Role",
    "Title",
    "Decision_Authority",
    "Email",
    "Mobile",
  ]),
  Accounts: Object.freeze([
    "Modified_Time",
    "Primary_Contact",
    "Account_Name",
    "Legal_Business_Name",
    "Phone",
    "Phone_System_Provider",
    "Primary_Service_Area",
    "Normal_Business_Hours",
    "Field_Team_Size_Band",
    "Services_Handled",
    "Other_Service_Details",
  ]),
  Deals: Object.freeze([
    "Modified_Time",
    "Account_Name",
    "Contact_Name",
    "Current_Call_Handling",
    "Requested_Test_Route",
    "Approved_Test_Route",
    "Target_Start_Date",
    "Test_Phone_Number",
    "No_Answer_Delay",
    "Forwarding_Administrator_Name",
    "Forwarding_Administrator_Mobile",
    "Approved_Fallback_Destination",
    "Approved_Fallback_Number",
    "Rollback_Contact_Name",
    "Rollback_Contact_Mobile",
    "Urgent_Call_Handling",
    "Existing_Customer_Call_Handling",
    "Alert_Recipient_Name",
    "Alert_Recipient_Mobile",
    "Alert_Recipient_Email",
    "Authorized_Representative_Confirmed",
    "Test_Scope_Accepted",
    "Authority_Confirmed_At",
    "Test_Scope_Accepted_At",
    "Setup_Form_Submission_ID",
    "Setup_Form_Version",
    "Setup_Form_Submitted_At",
    "Setup_Access_Status",
    "Setup_Access_Issued_At",
    "Setup_Access_Verified_At",
    "Free_Test_Authorization_Status",
    "Authorization_Signed_At",
    "Go_Live_Approval_Status",
    "Go_Live_Approved_At",
    "Test_Status",
    "Test_Duration_Days",
    "Test_Call_Limit",
    "Test_Scope_Version",
    "Entry_Offer",
    "Submission_Channel",
    "Free_Test_Request_Submitted_At",
    "Intake_Submission_ID",
    "Free_Test_Request_Notes",
  ]),
});

const UPDATE_FIELDS = Object.freeze({
  Contacts: new Set([
    "First_Name",
    "Last_Name",
    "Decision_Maker_Role",
    "Title",
    "Decision_Authority",
  ]),
  Accounts: new Set([
    "Account_Name",
    "Legal_Business_Name",
    "Phone",
    "Phone_System_Provider",
    "Primary_Service_Area",
    "Normal_Business_Hours",
    "Field_Team_Size_Band",
    "Services_Handled",
    "Other_Service_Details",
  ]),
  Deals: new Set([
    "Target_Start_Date",
    "No_Answer_Delay",
    "Forwarding_Administrator_Name",
    "Forwarding_Administrator_Mobile",
    "Approved_Fallback_Destination",
    "Approved_Fallback_Number",
    "Rollback_Contact_Name",
    "Rollback_Contact_Mobile",
    "Urgent_Call_Handling",
    "Existing_Customer_Call_Handling",
    "Alert_Recipient_Name",
    "Alert_Recipient_Email",
    "Authorized_Representative_Confirmed",
    "Test_Scope_Accepted",
    "Authority_Confirmed_At",
    "Test_Scope_Accepted_At",
    "Setup_Form_Submission_ID",
    "Setup_Form_Version",
    "Setup_Form_Submitted_At",
    "Setup_Access_Status",
    "Setup_Access_Issued_At",
    "Setup_Access_Verified_At",
  ]),
});

const CRM_DATETIME_FIELDS = Object.freeze({
  Contacts: new Set(),
  Accounts: new Set(),
  Deals: new Set([
    "Authority_Confirmed_At",
    "Test_Scope_Accepted_At",
    "Setup_Form_Submitted_At",
    "Setup_Access_Issued_At",
    "Setup_Access_Verified_At",
  ]),
});

const PRESERVED_DEAL_FIELDS = Object.freeze([
  "Current_Call_Handling",
  "Requested_Test_Route",
  "Approved_Test_Route",
  "Setup_Access_Issued_At",
  "Setup_Access_Verified_At",
  "Free_Test_Authorization_Status",
  "Authorization_Signed_At",
  "Go_Live_Approval_Status",
  "Go_Live_Approved_At",
  "Test_Status",
  "Test_Duration_Days",
  "Test_Call_Limit",
  "Test_Scope_Version",
  "Entry_Offer",
  "Submission_Channel",
  "Free_Test_Request_Submitted_At",
  "Intake_Submission_ID",
  "Free_Test_Request_Notes",
  "Alert_Recipient_Mobile",
  // Number assignment is Setup/QA-owned and cannot be overwritten by Form 2.
  "Test_Phone_Number",
]);
const PRESERVED_CONTACT_FIELDS = Object.freeze(["Email", "Mobile"]);

class CrmClientError extends Error {
  constructor(
    message,
    { ambiguous = false, publicCode = "crm_dependency_failed", status = 503 } = {},
  ) {
    super(message);
    this.name = "CrmClientError";
    this.ambiguous = ambiguous;
    this.publicCode = publicCode;
    this.status = status;
  }
}

function fail(message, options) {
  throw new CrmClientError(message, options);
}

function validateBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("CRM API base URL is invalid", { publicCode: "configuration_invalid" });
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/crm/v8" ||
    !isApprovedCrmApiHostname(parsed.hostname)
  ) {
    fail("CRM API base URL is not an approved Zoho CRM V8 base", {
      publicCode: "configuration_invalid",
    });
  }
  return parsed.origin + parsed.pathname;
}

function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    fail("CRM client configuration is unavailable", { publicCode: "configuration_invalid" });
  }
  const timeoutMs = config.outboundTimeoutMs;
  const maximumBytes = config.outboundMaxBytes;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 15000) {
    fail("CRM outbound timeout is invalid", { publicCode: "configuration_invalid" });
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1024 || maximumBytes > 524288) {
    fail("CRM response limit is invalid", { publicCode: "configuration_invalid" });
  }
  return Object.freeze({
    apiBaseUrl: validateBaseUrl(config.crmApiBaseUrl),
    timeoutMs,
    maximumBytes,
  });
}

function validateModule(module) {
  if (!MODULE_SET.has(module)) {
    fail("CRM module is not approved", { publicCode: "configuration_invalid" });
  }
  return module;
}

function validateRecordId(recordId) {
  if (typeof recordId !== "string" || !/^[1-9][0-9]{7,29}$/.test(recordId)) {
    fail("CRM record identifier is invalid", { publicCode: "context_invalid", status: 409 });
  }
  return recordId;
}

function validateModifiedTime(value) {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail("CRM record version is invalid", { publicCode: "context_invalid", status: 409 });
  }
  return value;
}

function validateAuthorization(value) {
  if (
    typeof value !== "string" ||
    !/^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/.test(value)
  ) {
    fail("CRM Connection authorization is unavailable", {
      publicCode: "connection_unavailable",
    });
  }
  return value;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateUpdate(module, update) {
  validateModule(module);
  if (!isPlainObject(update)) {
    fail("CRM update must be a plain object", { publicCode: "configuration_invalid" });
  }
  const keys = Reflect.ownKeys(update);
  if (keys.length === 0 || keys.some((key) => typeof key !== "string")) {
    fail("CRM update is empty or malformed", { publicCode: "configuration_invalid" });
  }
  for (const key of keys) {
    if (["__proto__", "constructor", "prototype"].includes(key) || !UPDATE_FIELDS[module].has(key)) {
      fail("CRM update contains a field outside the Form 2 allowlist", {
        publicCode: "configuration_invalid",
      });
    }
    const value = update[key];
    const scalar = value === null || ["string", "boolean", "number"].includes(typeof value);
    const approvedArray =
      module === "Accounts" &&
      key === "Services_Handled" &&
      Array.isArray(value) &&
      value.every((entry) => typeof entry === "string");
    if (!scalar && !approvedArray) {
      fail("CRM update contains an unsupported value", { publicCode: "configuration_invalid" });
    }
  }
  return update;
}

function serializeUpdate(module, update) {
  validateUpdate(module, update);
  return Object.fromEntries(Object.entries(update).map(([field, value]) => {
    if (!CRM_DATETIME_FIELDS[module].has(field) || value === null) {
      return [field, value];
    }
    if (
      typeof value !== "string" ||
      !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))
    ) {
      fail("CRM DateTime update is invalid", { publicCode: "configuration_invalid" });
    }
    // Zoho CRM documents DateTime writes as second precision with a numeric
    // UTC offset (yyyy-MM-ddTHH:mm:ss+00:00), not JavaScript's millisecond-Z
    // representation. Keep millisecond precision in controller state, but
    // normalize only the outbound CRM payload.
    return [field, new Date(value).toISOString().replace(/\.\d{3}Z$/, "+00:00")];
  }));
}

function recordUrl(boundary, module, recordId) {
  const url = new URL(`${boundary.apiBaseUrl}/${validateModule(module)}/${validateRecordId(recordId)}`);
  url.searchParams.set("fields", READ_FIELDS[module].join(","));
  return url.toString();
}

function updateUrl(boundary, module, recordId) {
  return `${boundary.apiBaseUrl}/${validateModule(module)}/${validateRecordId(recordId)}`;
}

function wrapBoundaryError(error) {
  if (!(error instanceof HttpBoundaryError)) throw error;
  throw new CrmClientError("CRM request did not return an authoritative result", {
    ambiguous: error.ambiguous,
    publicCode: error.publicCode === "dependency_failed" ? "crm_dependency_failed" : error.publicCode,
    status: error.status,
  });
}

function classifyRejectedStatus(status, { sideEffecting }) {
  if (status === 412) {
    return { ambiguous: false, publicCode: "record_stale", status: 409 };
  }
  if (!sideEffecting || [400, 401, 403, 404, 409, 422].includes(status)) {
    return { ambiguous: false, publicCode: "crm_rejected", status: 502 };
  }
  return { ambiguous: true, publicCode: "reconciliation_required", status: 503 };
}

function parseRecordResponse(json, expectedId) {
  if (!isPlainObject(json) || !Array.isArray(json.data) || json.data.length !== 1) {
    fail("CRM record response is incomplete", { publicCode: "crm_dependency_failed" });
  }
  const record = json.data[0];
  if (!isPlainObject(record) || record.id !== expectedId) {
    fail("CRM record response does not match the requested record", {
      publicCode: "crm_dependency_failed",
    });
  }
  validateModifiedTime(record.Modified_Time);
  return record;
}

function parseUpdateAcknowledgment(json, expectedId, { ambiguous = true } = {}) {
  const result = json?.data;
  if (
    !Array.isArray(result) ||
    result.length !== 1 ||
    result[0]?.status !== "success" ||
    result[0]?.code !== "SUCCESS" ||
    result[0]?.details?.id !== expectedId
  ) {
    fail("CRM update acknowledgment is incomplete", {
      ambiguous,
      publicCode: ambiguous ? "reconciliation_required" : "crm_rejected",
    });
  }
}

function normalizeComparable(value) {
  if (Array.isArray(value)) return [...value].sort();
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  ) {
    return new Date(value).toISOString();
  }
  return value;
}

function equalValue(actual, expected) {
  return JSON.stringify(normalizeComparable(actual)) === JSON.stringify(normalizeComparable(expected));
}

function verifyFields(record, expected, { preservedFrom = null, preservedFields = [] } = {}) {
  for (const [field, value] of Object.entries(expected)) {
    if (!equalValue(record[field], value)) {
      fail("CRM readback does not match the submitted update", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
  }
  for (const field of preservedFields) {
    if (!equalValue(record[field], preservedFrom[field])) {
      fail("CRM readback changed a server-owned field", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
  }
}

function validateCompositeAcknowledgments(json, targets) {
  const responses = json?.__composite_requests;
  if (!Array.isArray(responses) || responses.length !== targets.length) {
    fail("CRM composite acknowledgment is incomplete", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
  }
  responses.forEach((entry, index) => {
    const response = entry?.details?.response;
    if (
      entry?.status !== "success" ||
      entry?.code !== "SUCCESS" ||
      response?.status_code !== 200
    ) {
      fail("CRM composite update was not fully accepted", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
    parseUpdateAcknowledgment(response.body, targets[index].recordId, { ambiguous: true });
  });
}

function isRollbackEntry(entry, failedIndex) {
  return (
    entry?.status === "error" &&
    entry?.code === "ROLLBACK_PERFORMED" &&
    entry?.details?.rollbacked_by_sub_request_index === failedIndex
  );
}

function isDuplicateUpdateBody(body) {
  if (!isPlainObject(body)) return false;
  const candidate = Array.isArray(body.data)
    ? body.data.length === 1
      ? body.data[0]
      : null
    : body;
  return (
    isPlainObject(candidate) &&
    candidate.status === "error" &&
    candidate.code === "DUPLICATE_DATA"
  );
}

function isDealDuplicateRollback(json, targetCount) {
  const responses = json?.__composite_requests;
  const dealIndex = 2;
  if (!Array.isArray(responses) || targetCount !== 3 || responses.length !== targetCount) {
    return false;
  }
  if (!responses.slice(0, dealIndex).every((entry) => isRollbackEntry(entry, dealIndex))) {
    return false;
  }
  const dealResponse = responses[dealIndex];
  return (
    dealResponse?.status === "success" &&
    dealResponse?.code === "SUCCESS" &&
    dealResponse?.details?.response?.status_code === 400 &&
    isDuplicateUpdateBody(dealResponse.details.response.body)
  );
}

function createCrmClient(
  config,
  {
    authorizationProvider,
    readAuthorizationProvider = authorizationProvider,
    writeAuthorizationProvider = authorizationProvider,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const boundary = validateConfig(config);
  if (
    typeof readAuthorizationProvider !== "function" ||
    typeof writeAuthorizationProvider !== "function"
  ) {
    fail("CRM authorization providers are unavailable", { publicCode: "configuration_invalid" });
  }

  async function authorizedRequest(url, options, { sideEffecting, write }) {
    let authorization;
    try {
      const provider = write ? writeAuthorizationProvider : readAuthorizationProvider;
      authorization = validateAuthorization(await provider());
    } catch (error) {
      if (error instanceof CrmClientError) throw error;
      fail("CRM Connection authorization is unavailable", {
        publicCode: "connection_unavailable",
      });
    }
    try {
      return await requestJson(
        url,
        {
          ...options,
          headers: { ...options.headers, Authorization: authorization },
        },
        {
          timeoutMs: boundary.timeoutMs,
          maximumBytes: boundary.maximumBytes,
          sideEffecting,
        },
        fetchImpl,
      );
    } catch (error) {
      wrapBoundaryError(error);
    }
  }

  async function getRecord(module, recordId) {
    const response = await authorizedRequest(
      recordUrl(boundary, module, recordId),
      { method: "GET", headers: { Accept: "application/json" } },
      { sideEffecting: false, write: false },
    );
    if (response.status !== 200) {
      fail("CRM rejected the record read", classifyRejectedStatus(response.status, {
        sideEffecting: false,
      }));
    }
    return parseRecordResponse(response.json, recordId);
  }

  async function updateRecord(module, recordId, update, { ifUnmodifiedSince } = {}) {
    const serializedUpdate = serializeUpdate(module, update);
    validateModifiedTime(ifUnmodifiedSince);
    const response = await authorizedRequest(
      updateUrl(boundary, module, recordId),
      {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "If-Unmodified-Since": ifUnmodifiedSince,
        },
        body: JSON.stringify({
          data: [{ id: recordId, ...serializedUpdate }],
          trigger: ["workflow"],
        }),
      },
      { sideEffecting: true, write: true },
    );
    if (response.status !== 200) {
      fail("CRM rejected the record update", classifyRejectedStatus(response.status, {
        sideEffecting: true,
      }));
    }
    parseUpdateAcknowledgment(response.json, recordId);
    const readback = await getRecord(module, recordId);
    verifyFields(readback, serializedUpdate);
    return readback;
  }

  async function updateForm2Composite(existing, updates) {
    verifyRecordRelationships(existing);
    if (!isPlainObject(updates)) {
      fail("Form 2 update bundle is invalid", { publicCode: "configuration_invalid" });
    }
    const bundleKeys = Object.keys(updates);
    if (
      bundleKeys.length !== 3 ||
      !["contactUpdate", "accountUpdate", "dealUpdate"].every((key) => bundleKeys.includes(key))
    ) {
      fail("Form 2 update bundle is incomplete", { publicCode: "configuration_invalid" });
    }
    const targets = [
      {
        requestId: "contact_update",
        module: "Contacts",
        recordId: existing.contact.id,
        modifiedTime: existing.contact.Modified_Time,
        update: serializeUpdate("Contacts", updates.contactUpdate),
      },
      {
        requestId: "account_update",
        module: "Accounts",
        recordId: existing.account.id,
        modifiedTime: existing.account.Modified_Time,
        update: serializeUpdate("Accounts", updates.accountUpdate),
      },
      {
        requestId: "deal_update",
        module: "Deals",
        recordId: existing.deal.id,
        modifiedTime: existing.deal.Modified_Time,
        update: serializeUpdate("Deals", updates.dealUpdate),
      },
    ];
    for (const target of targets) validateModifiedTime(target.modifiedTime);

    async function readbackAndVerifyForm2() {
      try {
        const [contact, account, deal] = await Promise.all([
          getRecord("Contacts", existing.contact.id),
          getRecord("Accounts", existing.account.id),
          getRecord("Deals", existing.deal.id),
        ]);
        verifyRecordRelationships({ contact, account, deal });
        verifyFields(contact, targets[0].update, {
          preservedFrom: existing.contact,
          preservedFields: PRESERVED_CONTACT_FIELDS,
        });
        verifyFields(account, targets[1].update);
        verifyFields(deal, targets[2].update, {
          preservedFrom: existing.deal,
          preservedFields: PRESERVED_DEAL_FIELDS,
        });
        return { contact, account, deal };
      } catch {
        fail("CRM composite readback could not prove the transaction outcome", {
          ambiguous: true,
          publicCode: "reconciliation_required",
          status: 503,
        });
      }
    }

    const response = await authorizedRequest(
      `${boundary.apiBaseUrl}/__composite_requests`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          rollback_on_fail: true,
          parallel_execution: false,
          __composite_requests: targets.map((target) => ({
            sub_request_id: target.requestId,
            method: "PUT",
            uri: `/crm/v8/${target.module}/${target.recordId}`,
            headers: { "If-Unmodified-Since": target.modifiedTime },
            body: {
              data: [{ id: target.recordId, ...target.update }],
              trigger: ["workflow"],
            },
          })),
        }),
      },
      { sideEffecting: true, write: true },
    );
    if (response.status !== 200) {
      if (response.status === 400 && isDealDuplicateRollback(response.json, targets.length)) {
        const readback = await readbackAndVerifyForm2();
        return Object.freeze({ ...readback, replayed: true });
      }
      if (response.status === 400) {
        fail("CRM composite rollback could not be proven safe", {
          ambiguous: true,
          publicCode: "reconciliation_required",
          status: 503,
        });
      }
      fail("CRM rejected or rolled back the composite update", classifyRejectedStatus(
        response.status,
        { sideEffecting: true },
      ));
    }
    validateCompositeAcknowledgments(response.json, targets);
    const readback = await readbackAndVerifyForm2();
    return Object.freeze({ ...readback, replayed: false });
  }

  return Object.freeze({ getRecord, updateForm2Composite, updateRecord });
}

module.exports = {
  CrmClientError,
  MODULES,
  PRESERVED_CONTACT_FIELDS,
  PRESERVED_DEAL_FIELDS,
  READ_FIELDS,
  createCrmClient,
};
