"use strict";

const { HttpBoundaryError, requestJson } = require("./http");

const RECORD_ID = /^[1-9][0-9]{7,29}$/;
const INTEGRATION_FIELDS = new Set([
  "Billing_Customer_ID",
  "Billing_Evaluation_Subscription_ID",
  "Billing_Evaluation_Status",
  "Billing_Subscription_ID",
  "Subscription_Status",
  "Billing_Automation_Status",
  "Billing_Last_Sync_At",
  "Billing_Automation_Error",
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
  if (!sideEffecting || [400, 401, 403, 404, 409, 422].includes(status)) {
    return { publicCode: "crm_rejected", status: 502 };
  }
  return { ambiguous: true, publicCode: "reconciliation_required", status: 503 };
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
    "Pipeline",
    "Stage",
    "Entry_Offer",
    "Type",
    "Account_Name",
    "Go_Live_Approval_Status",
    "Go_Live_Approved_At",
    "Test_Status",
    "Test_Duration_Days",
    "Test_Call_Limit",
    "Test_Scope_Version",
    "Test_Start_At",
    "Test_End_At",
    "Test_End_Reason",
    "Plan",
    "Billing_Frequency",
    "Subscription_Start_Date",
    "Subscription_Acceptance_Status",
    "Billing_Customer_ID",
    "Billing_Evaluation_Subscription_ID",
    "Billing_Evaluation_Status",
    "Billing_Subscription_ID",
    "Subscription_Status",
    "Billing_Automation_Status",
    "Billing_Last_Sync_At",
    "Billing_Automation_Error",
  ]);
  const accountFields = Object.freeze(["Modified_Time", "Account_Name"]);

  async function authorizedRequest(url, options, { write, sideEffecting }) {
    let token;
    try {
      token = authorization(await (write ? writeAuthorizationProvider() : readAuthorizationProvider()));
    } catch (error) {
      if (error instanceof CrmClientError) throw error;
      fail("CRM Connection is unavailable", { publicCode: "connection_unavailable" });
    }
    try {
      return await requestJson(url, {
        ...options,
        headers: { ...options.headers, Authorization: token },
      }, {
        timeoutMs: config.outboundTimeoutMs,
        maximumBytes: config.outboundMaxBytes,
        sideEffecting,
      }, fetchImpl);
    } catch (error) {
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
    if (response.status !== 200) fail("CRM rejected the Deal update", classifyStatus(response.status, true));
    parseUpdate(response.json, deal.id);
    const readback = await getDeal(deal.id);
    for (const [field, expected] of entries) {
      const matches = expected === null ? readback[field] == null : readback[field] === expected;
      if (!matches) fail("CRM Deal readback does not match", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
    return readback;
  }

  return Object.freeze({ getAccount, getContext, getDeal, updateDealIntegration });
}

module.exports = { CrmClientError, INTEGRATION_FIELDS, createCrmClient };
