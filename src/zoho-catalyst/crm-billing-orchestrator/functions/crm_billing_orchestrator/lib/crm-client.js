"use strict";

const { HttpBoundaryError, requestJson } = require("./http");

const RECORD_ID = /^[1-9][0-9]{7,29}$/;
// CRM returns the picklist's immutable API value, not its current UI label.
// Keep this translation explicit so a metadata change fails closed instead of selecting a price.
const CANONICAL_PLAN_BY_CRM_API_VALUE = Object.freeze({
  "Option 1": "Launch",
  "Option 2": "Growth",
  Pro: "Scale",
});
const INTEGRATION_FIELDS = new Set([
  "Billing_Customer_ID",
  "Billing_Subscription_ID",
  "Subscription_Status",
  "Billing_Automation_Status",
  "Billing_Last_Sync_At",
  "Billing_Automation_Error",
]);
const REPORT_SUMMARY_FIELDS = new Set([
  "Test_Status", "Test_Start_At", "Test_End_At", "Test_End_Reason",
  "Call_Totals_Reconciled", "Test_Calls_Reaching_Route",
  "Test_Qualified_Opportunities", "Test_Existing_Customer_Calls",
  "Test_Actual_Avg_Call_Duration_Seconds",
  "Test_Out_Of_Area_Or_Wrong_Fit_Calls", "Test_Urgent_Requests",
  "Test_Bookable_Opportunities", "Test_Office_Follow_Up_Calls",
  "Test_Observed_Workflow_Failures", "Recommended_Paid_Coverage",
  "Expected_Monthly_Connected_Minutes_Min", "Expected_Monthly_Connected_Minutes_Max",
  "Test_Data_Confidence_Notes",
]);

class CrmClientError extends Error {
  constructor(message, { ambiguous = false, publicCode = "crm_dependency_failed", status = 503 } = {}) {
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

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function recordId(value, name = "CRM record identifier") {
  if (typeof value !== "string" || !RECORD_ID.test(value)) {
    fail(`${name} is invalid`, { publicCode: "crm_state_invalid", status: 409 });
  }
  return value;
}

function modifiedTime(value) {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) fail("CRM Modified_Time is invalid", { publicCode: "crm_state_invalid", status: 409 });
  return value;
}

function authorization(value) {
  if (typeof value !== "string" || !/^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/.test(value)) {
    fail("CRM Connection authorization is invalid", { publicCode: "connection_unavailable" });
  }
  return value;
}

function parseRecord(json, expectedId) {
  if (!plainObject(json) || !Array.isArray(json.data) || json.data.length !== 1) {
    fail("CRM record response is incomplete");
  }
  const record = json.data[0];
  if (!plainObject(record) || record.id !== expectedId) fail("CRM record response does not match");
  modifiedTime(record.Modified_Time);
  return record;
}

function parseUpdate(json, expectedId) {
  const row = Array.isArray(json?.data) && json.data.length === 1 ? json.data[0] : null;
  if (
    row?.status !== "success" ||
    row?.code !== "SUCCESS" ||
    row?.details?.id !== expectedId
  ) fail("CRM update acknowledgment is incomplete", {
    ambiguous: true,
    publicCode: "reconciliation_required",
  });
}

function classifyStatus(status, sideEffecting) {
  if (status === 412) return { publicCode: "record_stale", status: 409 };
  if (!sideEffecting && retryableReadStatus(status)) {
    return { publicCode: "crm_dependency_failed", status: 503 };
  }
  if (!sideEffecting || [400, 401, 403, 404, 409, 422].includes(status)) {
    return { publicCode: "crm_rejected", status: 502 };
  }
  return { ambiguous: true, publicCode: "reconciliation_required", status: 503 };
}

function retryableReadStatus(status) {
  return new Set([408, 425, 429, 500, 502, 503, 504]).has(status);
}

function createCrmClient(config, {
  readAuthorizationProvider,
  writeAuthorizationProvider,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof readAuthorizationProvider !== "function" || typeof writeAuthorizationProvider !== "function") {
    fail("CRM authorization providers are unavailable", { publicCode: "configuration_invalid" });
  }
  const dealFields = Object.freeze([
    "Modified_Time",
    "Deal_Name",
    "Pipeline",
    "Stage",
    "Entry_Offer",
    "Type",
    "Account_Name",
    "Test_Status",
    "Plan",
    "Billing_Frequency",
    "Monthly_Recurring_Revenue",
    "Setup_Fee",
    "Subscription_Start_Date",
    "Subscription_Acceptance_Status",
    "Subscription_Accepted_At",
    "Subscription_Acceptance_Version",
    "Results_Review_At",
    "Test_Start_At",
    "Test_End_At",
    "Test_End_Reason",
    "Call_Totals_Reconciled",
    "Test_Calls_Reaching_Route",
    "Test_Qualified_Opportunities",
    "Test_Existing_Customer_Calls",
    "Test_Actual_Avg_Call_Duration_Seconds",
    "Test_Out_Of_Area_Or_Wrong_Fit_Calls",
    "Test_Urgent_Requests",
    "Test_Bookable_Opportunities",
    "Test_Office_Follow_Up_Calls",
    "Test_Observed_Workflow_Failures",
    "Recommended_Paid_Coverage",
    "Expected_Monthly_Connected_Minutes_Min",
    "Expected_Monthly_Connected_Minutes_Max",
    "Test_Data_Confidence_Notes",
    "Deployment_Record_ID",
    "Configuration_Version",
    "Approved_Deployment_Record_ID",
    "Approved_Configuration_Version",
    "Billing_Customer_ID",
    "Billing_Subscription_ID",
    "Subscription_Status",
    "Billing_Automation_Status",
    "Billing_Last_Sync_At",
    "Billing_Automation_Error",
  ]);
  const accountFields = Object.freeze(["Modified_Time", "Account_Name"]);

  async function authorizedRequest(url, options, { write, sideEffecting }) {
    const maximumAttempts = sideEffecting ? 1 : 2;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      let token;
      try {
        token = authorization(await (write ? writeAuthorizationProvider() : readAuthorizationProvider()));
      } catch (error) {
        if (attempt < maximumAttempts) continue;
        if (error instanceof CrmClientError) throw error;
        fail("CRM Connection is unavailable", { publicCode: "connection_unavailable" });
      }
      try {
        const response = await requestJson(url, {
          ...options,
          headers: { ...options.headers, Authorization: token },
        }, {
          timeoutMs: config.outboundTimeoutMs,
          maximumBytes: config.outboundMaxBytes,
          sideEffecting,
        }, fetchImpl);
        if (attempt < maximumAttempts && retryableReadStatus(response.status)) continue;
        return response;
      } catch (error) {
        if (attempt < maximumAttempts && error instanceof HttpBoundaryError) continue;
        if (error instanceof HttpBoundaryError) {
          fail("CRM request did not return an authoritative result", {
            ambiguous: error.ambiguous,
            publicCode: error.publicCode === "dependency_failed" ? "crm_dependency_failed" : error.publicCode,
            status: error.status,
          });
        }
        throw error;
      }
    }
    fail("CRM read retry boundary was exhausted", { publicCode: "crm_dependency_failed" });
  }

  async function getRecord(module, id, fields) {
    recordId(id);
    const url = new URL(`${config.crmApiBaseUrl}/${module}/${id}`);
    url.searchParams.set("fields", fields.join(","));
    const response = await authorizedRequest(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    }, { write: false, sideEffecting: false });
    if (response.status !== 200) fail("CRM rejected the record read", classifyStatus(response.status, false));
    return parseRecord(response.json, id);
  }

  // Report synchronization legitimately runs before a paid Plan is selected. Preserve raw Deal
  // state here; the paid-action validator owns exact Plan API-value normalization.
  const getDeal = (id) => getRecord("Deals", id, dealFields);
  const getAccount = (id) => getRecord("Accounts", id, accountFields);

  async function getContext(dealId) {
    const deal = await getDeal(dealId);
    const lookup = deal.Account_Name;
    if (!plainObject(lookup) || typeof lookup.id !== "string") {
      fail("Deal Account relationship is unavailable", { publicCode: "crm_state_invalid", status: 409 });
    }
    const account = await getAccount(recordId(lookup.id, "CRM Account identifier"));
    return Object.freeze({ deal, account });
  }

  async function updateDealIntegration(deal, patch) {
    if (!plainObject(deal) || !plainObject(patch)) {
      fail("CRM integration update is malformed", { publicCode: "configuration_invalid" });
    }
    recordId(deal.id);
    modifiedTime(deal.Modified_Time);
    const entries = Object.entries(patch);
    if (
      entries.length < 1 ||
      entries.some(([field, value]) => {
        if (!INTEGRATION_FIELDS.has(field)) return true;
        if (field === "Billing_Automation_Error" && value === null) return false;
        return (
          typeof value !== "string" ||
          !value || value.length > 160 ||
          /[\u0000-\u001f\u007f]/.test(value)
        );
      })
    ) fail("CRM integration update is outside the allowlist", { publicCode: "configuration_invalid" });

    try {
      const response = await authorizedRequest(`${config.crmApiBaseUrl}/Deals/${deal.id}`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "If-Unmodified-Since": deal.Modified_Time,
        },
        body: JSON.stringify({
          data: [{ id: deal.id, ...patch }],
          trigger: [],
          skip_feature_execution: [{ name: "cadences" }],
        }),
      }, { write: true, sideEffecting: true });
      if (response.status === 200) parseUpdate(response.json, deal.id);
    } catch {
      // Once the write may have reached CRM, only readback can establish its outcome.
    }
    let readback;
    try {
      readback = await getDeal(deal.id);
    } catch {
      fail("CRM Deal update outcome requires reconciliation", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
    for (const [field, expected] of entries) {
      const matches = expected === null
        ? Object.hasOwn(readback, field) && readback[field] === null
        : readback[field] === expected;
      if (!matches) fail("CRM Deal readback does not match", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
    return readback;
  }

  async function updateDealReportSummary(deal, patch) {
    if (!plainObject(deal) || !plainObject(patch)) {
      fail("CRM report-summary update is malformed", { publicCode: "configuration_invalid" });
    }
    recordId(deal.id);
    modifiedTime(deal.Modified_Time);
    const entries = Object.entries(patch);
    if (entries.length !== REPORT_SUMMARY_FIELDS.size
      || entries.some(([field, candidate]) => {
        if (!REPORT_SUMMARY_FIELDS.has(field)) return true;
        if (candidate === null) return false;
        if (field === "Call_Totals_Reconciled") return candidate !== true;
        if (typeof candidate === "number") return !Number.isSafeInteger(candidate)
          || candidate < 0 || candidate > 999999999;
        return typeof candidate !== "string" || !candidate || candidate.length > 2000
          || Buffer.byteLength(candidate, "utf8") > 2000
          || /[\u0000-\u001f\u007f]/.test(candidate);
      })) fail("CRM report-summary update is outside the allowlist", {
      publicCode: "configuration_invalid",
    });

    try {
      const response = await authorizedRequest(`${config.crmApiBaseUrl}/Deals/${deal.id}`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "If-Unmodified-Since": deal.Modified_Time,
        },
        body: JSON.stringify({
          data: [{ id: deal.id, ...patch }],
          trigger: [],
          skip_feature_execution: [{ name: "cadences" }],
        }),
      }, { write: true, sideEffecting: true });
      if (response.status === 200) parseUpdate(response.json, deal.id);
    } catch {
      // A write timeout is ambiguous. The exact Deal readback below is the only
      // authority and prevents a retry from fabricating a second state transition.
    }
    let readback;
    try {
      readback = await getDeal(deal.id);
    } catch {
      fail("CRM report-summary update outcome requires reconciliation", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
    for (const [field, expected] of entries) {
      const matches = expected === null
        ? Object.hasOwn(readback, field) && readback[field] === null
        : new Set(["Test_Start_At", "Test_End_At"]).has(field)
          ? Number.isFinite(Date.parse(readback[field]))
            && Date.parse(readback[field]) === Date.parse(expected)
          : readback[field] === expected;
      if (!matches) fail("CRM report-summary readback does not match", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
    return readback;
  }

  return Object.freeze({
    getAccount, getContext, getDeal, updateDealIntegration, updateDealReportSummary,
  });
}

module.exports = {
  CANONICAL_PLAN_BY_CRM_API_VALUE,
  CrmClientError,
  INTEGRATION_FIELDS,
  REPORT_SUMMARY_FIELDS,
  createCrmClient,
};
