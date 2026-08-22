"use strict";

const { isApprovedCrmApiHostname } = require("./destinations");
const { HttpBoundaryError, requestJson } = require("./http");
const { normalizeIntakeSubmissionId, normalizeLeadId } = require("./security");

// This is the complete server-side read allowlist for the assisted Form 1
// prefill. Contact Title and Assisted By intentionally have no CRM dependency.
const READ_FIELDS = Object.freeze([
  "Modified_Time",
  "First_Name",
  "Last_Name",
  "Company",
  "Decision_Maker_Role",
  "Designation",
  "Email",
  "Mobile",
  "Lead_Source",
  "Main_Business_Phone",
  "Current_Call_Handling",
  "Requested_Test_Route",
  "Phone_System_Provider",
  "Primary_Service_Area",
  "Field_Team_Size_Band",
  "Intake_Submission_ID",
]);

class CrmClientError extends Error {
  constructor(
    message,
    { status = 503, publicCode = "crm_dependency_failed", ambiguous = false } = {},
  ) {
    super(message);
    this.name = "CrmClientError";
    this.status = status;
    this.publicCode = publicCode;
    this.ambiguous = ambiguous;
  }
}

function fail(message, options) {
  throw new CrmClientError(message, options);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("CRM API base URL is invalid", { publicCode: "configuration_invalid" });
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== "/crm/v8" ||
    !isApprovedCrmApiHostname(url.hostname)
  ) {
    fail("CRM API base URL is outside the approved boundary", {
      publicCode: "configuration_invalid",
    });
  }
  return `${url.origin}${url.pathname}`;
}

function validateClientConfig(config) {
  const timeoutMs = config?.outboundTimeoutMs;
  const maximumBytes = config?.outboundMaxBytes;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 250 ||
    timeoutMs > 15000 ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 4096 ||
    maximumBytes > 524288
  ) {
    fail("CRM client bounds are invalid", { publicCode: "configuration_invalid" });
  }
  return Object.freeze({
    apiBaseUrl: validateBaseUrl(config.crmApiBaseUrl),
    maximumBytes,
    timeoutMs,
  });
}

function validateAuthorization(value) {
  if (typeof value !== "string" || !/^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/.test(value)) {
    fail("CRM Connection authorization is unavailable", {
      publicCode: "connection_unavailable",
    });
  }
  return value;
}

function validateModifiedTime(value) {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail("CRM record version is invalid", { status: 409, publicCode: "context_invalid" });
  }
  return value;
}

function leadRecordUrl(boundary, leadId) {
  const url = new URL(`${boundary.apiBaseUrl}/Leads/${normalizeLeadId(leadId)}`);
  url.searchParams.set("fields", READ_FIELDS.join(","));
  return url.toString();
}

function parseLeadResponse(json, expectedId) {
  if (!isPlainObject(json) || !Array.isArray(json.data) || json.data.length !== 1) {
    fail("CRM Lead response is incomplete");
  }
  const record = json.data[0];
  if (!isPlainObject(record) || record.id !== expectedId) {
    fail("CRM Lead response does not match the requested record");
  }
  validateModifiedTime(record.Modified_Time);
  return record;
}

function parseUpdateAcknowledgment(json, expectedId) {
  const result = json?.data;
  if (
    !Array.isArray(result) ||
    result.length !== 1 ||
    result[0]?.status !== "success" ||
    result[0]?.code !== "SUCCESS" ||
    result[0]?.details?.id !== expectedId
  ) {
    fail("CRM update acknowledgment is incomplete", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
  }
}

function wrapHttpError(error, { sideEffecting }) {
  if (!(error instanceof HttpBoundaryError)) throw error;
  throw new CrmClientError("CRM request did not return an authoritative result", {
    status: error.status,
    publicCode: sideEffecting ? "reconciliation_required" : "crm_dependency_failed",
    ambiguous: sideEffecting || error.ambiguous,
  });
}

function rejectedStatus(status, { sideEffecting }) {
  if (status === 412) {
    return { status: 409, publicCode: "record_stale", ambiguous: false };
  }
  if (!sideEffecting || [400, 401, 403, 404, 409, 422].includes(status)) {
    return { status: 502, publicCode: "crm_rejected", ambiguous: false };
  }
  return { status: 503, publicCode: "reconciliation_required", ambiguous: true };
}

function createCrmClient(
  config,
  {
    readAuthorizationProvider,
    writeAuthorizationProvider,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const boundary = validateClientConfig(config);
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
      wrapHttpError(error, { sideEffecting });
    }
  }

  async function getLead(leadId) {
    const normalizedId = normalizeLeadId(leadId);
    const result = await authorizedRequest(
      leadRecordUrl(boundary, normalizedId),
      { method: "GET", headers: { Accept: "application/json" } },
      { sideEffecting: false, write: false },
    );
    if (result.status !== 200) {
      fail("CRM rejected the Lead read", rejectedStatus(result.status, { sideEffecting: false }));
    }
    return parseLeadResponse(result.json, normalizedId);
  }

  async function reconcileWrite(leadId, intakeSubmissionId) {
    let readback;
    try {
      readback = await getLead(leadId);
    } catch {
      fail("CRM update outcome could not be reconciled", {
        status: 503,
        publicCode: "reconciliation_required",
        ambiguous: true,
      });
    }
    if (readback.Intake_Submission_ID !== intakeSubmissionId) {
      fail("CRM update outcome did not match the requested identifier", {
        status: 503,
        publicCode: "reconciliation_required",
        ambiguous: true,
      });
    }
    return readback;
  }

  async function updateIntakeSubmissionId(existingLead, intakeSubmissionId) {
    const leadId = normalizeLeadId(existingLead?.id);
    const modifiedTime = validateModifiedTime(existingLead?.Modified_Time);
    const normalizedIntakeId = normalizeIntakeSubmissionId(intakeSubmissionId);
    let result;
    try {
      result = await authorizedRequest(
        `${boundary.apiBaseUrl}/Leads/${leadId}`,
        {
          method: "PUT",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "If-Unmodified-Since": modifiedTime,
          },
          body: JSON.stringify({
            data: [{ id: leadId, Intake_Submission_ID: normalizedIntakeId }],
            // Issuing the assisted link is not the completed Form 1 event. The
            // existing Form 1 integration remains responsible for automation.
            trigger: [],
          }),
        },
        { sideEffecting: true, write: true },
      );
    } catch (error) {
      if (error?.ambiguous === true) return reconcileWrite(leadId, normalizedIntakeId);
      throw error;
    }

    if (result.status !== 200) {
      const classification = rejectedStatus(result.status, { sideEffecting: true });
      if (classification.ambiguous) return reconcileWrite(leadId, normalizedIntakeId);
      fail("CRM rejected the assisted-intake identifier update", classification);
    }
    try {
      parseUpdateAcknowledgment(result.json, leadId);
    } catch (error) {
      if (error?.ambiguous === true) return reconcileWrite(leadId, normalizedIntakeId);
      throw error;
    }
    return reconcileWrite(leadId, normalizedIntakeId);
  }

  return Object.freeze({ getLead, updateIntakeSubmissionId });
}

module.exports = { CrmClientError, READ_FIELDS, createCrmClient };
