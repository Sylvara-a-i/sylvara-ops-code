"use strict";

const crypto = require("node:crypto");
const { requestJson, HttpBoundaryError } = require("./http");
const { normalizeCrmModule, normalizeCrmRecordId, normalizeJourneyId } = require("./security");

const READ_FIELDS = Object.freeze([
  "Modified_Time", "Intake_Submission_ID",
  "First_Name", "Last_Name", "Company", "Decision_Maker_Role", "Designation", "Email", "Mobile",
  "Main_Business_Phone", "Current_Call_Handling", "Requested_Test_Route",
  "Phone_System_Provider", "Primary_Service_Area", "Field_Team_Size_Band",
  "Free_Test_Request_Notes", "Lead_Source", "Source_Page", "UTM_Source", "UTM_Medium",
  "UTM_Campaign", "UTM_Term", "UTM_Content", "Entry_Offer", "Submission_Channel",
  "Free_Test_Contact_Consent", "Free_Test_Contact_Consent_Version",
  "Free_Test_Contact_Consent_At", "Free_Test_Request_Submitted_At", "Intake_Form_Version",
  "Lead_Status",
]);

class CrmClientError extends Error {
  constructor(message, { status = 503, publicCode = "crm_dependency_failed",
    ambiguous = false } = {}) {
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

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function modifiedTime(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail("CRM record version is invalid", { status: 409, publicCode: "context_conflict" });
  }
  return value;
}

function authorization(value) {
  if (typeof value !== "string" || !/^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/.test(value)) {
    fail("CRM Connection authorization is unavailable", { publicCode: "connection_unavailable" });
  }
  return value;
}

function same(actual, expected) {
  if (typeof expected === "boolean") return actual === expected ||
    String(actual).toLowerCase() === String(expected);
  return actual === expected;
}

function journeyFromRecord(record) {
  const value = record?.Intake_Submission_ID;
  if (value === null || value === undefined || value === "") return null;
  try {
    return normalizeJourneyId(value);
  } catch {
    fail("CRM journey binding is invalid", {
      status: 409,
      publicCode: "context_conflict",
    });
  }
}

function createCrmClient(config, { readAuthorizationProvider, writeAuthorizationProvider,
  fetchImpl = globalThis.fetch } = {}) {
  if (config?.crmApiBaseUrl !== "https://www.zohoapis.com/crm/v8" ||
      !/^[a-f0-9]{64}$/.test(config?.crmOrganizationHash ?? "") ||
      !Number.isSafeInteger(config?.outboundTimeoutMs) ||
      !Number.isSafeInteger(config?.outboundMaxBytes) ||
      typeof readAuthorizationProvider !== "function" ||
      typeof writeAuthorizationProvider !== "function") {
    fail("CRM client configuration is invalid", { publicCode: "configuration_invalid" });
  }
  let readOrganizationVerified = false;
  let writeOrganizationVerified = false;

  async function request(url, options, { write = false, sideEffecting = false } = {}) {
    let credential;
    try {
      credential = authorization(await (write
        ? writeAuthorizationProvider()
        : readAuthorizationProvider()));
    } catch (error) {
      if (error instanceof CrmClientError) throw error;
      fail("CRM Connection authorization is unavailable", { publicCode: "connection_unavailable" });
    }
    try {
      return await requestJson(url, {
        ...options,
        headers: { ...options.headers, Authorization: credential },
      }, {
        timeoutMs: config.outboundTimeoutMs,
        maximumBytes: config.outboundMaxBytes,
        sideEffecting,
      }, fetchImpl);
    } catch (error) {
      if (error instanceof HttpBoundaryError) {
        fail("CRM request did not return an authoritative result", {
          publicCode: sideEffecting ? "reconciliation_required" : "crm_dependency_failed",
          ambiguous: sideEffecting || error.ambiguous,
        });
      }
      throw error;
    }
  }

  async function assertOrganization(write = false) {
    if ((write && writeOrganizationVerified) || (!write && readOrganizationVerified)) return;
    const result = await request(`${config.crmApiBaseUrl}/org`, {
      method: "GET",
      headers: { Accept: "application/json" },
    }, { write });
    const organizations = result.json?.org;
    const zgid = Array.isArray(organizations) && organizations.length === 1
      ? organizations[0]?.zgid : null;
    const observed = typeof zgid === "string" && /^[1-9][0-9]{0,29}$/.test(zgid)
      ? crypto.createHash("sha256").update(zgid, "utf8").digest("hex") : null;
    const expected = config.crmOrganizationHash;
    const matches = observed && Buffer.byteLength(observed) === Buffer.byteLength(expected)
      && crypto.timingSafeEqual(Buffer.from(observed), Buffer.from(expected));
    if (result.status !== 200 || !matches) {
      fail("CRM Connection organization does not match", {
        status: 503,
        publicCode: "connection_organization_mismatch",
      });
    }
    if (write) writeOrganizationVerified = true;
    else readOrganizationVerified = true;
  }

  async function getRecord(module, recordId) {
    await assertOrganization(false);
    const selectedModule = normalizeCrmModule(module);
    const selectedId = normalizeCrmRecordId(recordId);
    const url = new URL(`${config.crmApiBaseUrl}/${selectedModule}/${selectedId}`);
    url.searchParams.set("fields", READ_FIELDS.join(","));
    const result = await request(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (result.status !== 200 || !plain(result.json) ||
        !Array.isArray(result.json.data) || result.json.data.length !== 1 ||
        !plain(result.json.data[0]) || result.json.data[0].id !== selectedId) {
      fail("CRM record readback is invalid", {
        status: result.status === 404 ? 404 : 502,
        publicCode: result.status === 404 ? "context_not_found" : "crm_rejected",
      });
    }
    modifiedTime(result.json.data[0].Modified_Time);
    return Object.freeze({ ...result.json.data[0] });
  }

  async function getOrInitializeJourney(module, recordId) {
    const selectedModule = normalizeCrmModule(module);
    const selectedId = normalizeCrmRecordId(recordId);
    let record = await getRecord(selectedModule, selectedId);
    let journeyId = journeyFromRecord(record);
    if (journeyId) return Object.freeze({ record, journeyId, initialized: false });

    // The CRM record is the canonical journey owner. Initialize only against
    // the exact version that was read so a concurrent public intake, operator,
    // or retry can win without ever being overwritten by this launcher.
    const candidate = `f1a_${crypto.createHash("sha256")
      .update("sylvara.form1.assisted-journey.v2", "utf8")
      .update(Buffer.from([0]))
      .update(config.crmOrganizationHash, "utf8")
      .update(Buffer.from([0]))
      .update(selectedModule, "utf8")
      .update(Buffer.from([0]))
      .update(selectedId, "utf8")
      .digest("hex").slice(0, 40)}`;
    const selectedVersion = recordVersion(record);
    await assertOrganization(true);
    let result;
    try {
      result = await request(`${config.crmApiBaseUrl}/${selectedModule}/${selectedId}`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "If-Unmodified-Since": selectedVersion,
        },
        body: JSON.stringify({
          data: [{ id: selectedId, Intake_Submission_ID: candidate }],
          trigger: [],
        }),
      }, { write: true, sideEffecting: true });
    } catch (error) {
      if (error?.ambiguous !== true) throw error;
      record = await getRecord(selectedModule, selectedId);
      journeyId = journeyFromRecord(record);
      if (!journeyId) throw error;
      return Object.freeze({ record, journeyId, initialized: journeyId === candidate });
    }

    record = await getRecord(selectedModule, selectedId);
    journeyId = journeyFromRecord(record);
    if (result.status === 412) {
      if (!journeyId) {
        fail("CRM journey changed without an authoritative binding", {
          status: 409,
          publicCode: "record_stale",
        });
      }
      return Object.freeze({ record, journeyId, initialized: false });
    }
    const ack = result.json?.data?.[0];
    const acknowledged = result.status === 200 && ack?.status === "success" &&
      ack?.code === "SUCCESS" && ack?.details?.id === selectedId;
    if (!acknowledged || !journeyId) {
      if (!journeyId) {
        fail("CRM journey initialization could not be reconciled", {
          publicCode: "reconciliation_required",
          ambiguous: true,
        });
      }
      // A valid canonical winner is sufficient even when the response was not
      // authoritative; no second write is attempted.
      return Object.freeze({ record, journeyId, initialized: journeyId === candidate });
    }
    return Object.freeze({ record, journeyId, initialized: journeyId === candidate });
  }

  function assertJourney(record, journeyId) {
    const selected = normalizeJourneyId(journeyId);
    if (record?.Intake_Submission_ID !== selected) {
      fail("CRM journey binding does not match", {
        status: 409,
        publicCode: "context_conflict",
      });
    }
    return selected;
  }

  function recordMatches(record, patch) {
    return plain(record) && Object.entries(patch).every(([field, value]) =>
      same(record[field], value));
  }

  function recordVersion(record) {
    return modifiedTime(record?.Modified_Time);
  }

  async function completeAssistedSubmission(module, record, patch, expectedRecordVersion) {
    const selectedModule = normalizeCrmModule(module);
    const selectedId = normalizeCrmRecordId(record?.id);
    if (!plain(patch) || !Object.keys(patch).length || patch.id !== undefined) {
      fail("CRM update patch is invalid", { publicCode: "configuration_invalid" });
    }
    assertJourney(record, patch.Intake_Submission_ID);
    const selectedVersion = modifiedTime(expectedRecordVersion);
    if (recordVersion(record) !== selectedVersion) {
      fail("CRM record changed after submission ownership was claimed", {
        status: 409,
        publicCode: "record_stale",
      });
    }
    if (recordMatches(record, patch)) return Object.freeze({ record, replayed: true });
    await assertOrganization(true);
    let result;
    try {
      result = await request(`${config.crmApiBaseUrl}/${selectedModule}/${selectedId}`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "If-Unmodified-Since": selectedVersion,
        },
        body: JSON.stringify({
          data: [{ id: selectedId, ...patch }],
          trigger: ["workflow"],
        }),
      }, { write: true, sideEffecting: true });
    } catch (error) {
      if (error?.ambiguous !== true) throw error;
      const readback = await getRecord(selectedModule, selectedId);
      if (!recordMatches(readback, patch)) throw error;
      return Object.freeze({ record: readback, replayed: true });
    }
    if (result.status === 412) {
      fail("CRM record changed during assisted submission", {
        status: 409,
        publicCode: "record_stale",
      });
    }
    const ack = result.json?.data?.[0];
    if (result.status !== 200 || ack?.status !== "success" || ack?.code !== "SUCCESS" ||
        ack?.details?.id !== selectedId) {
      const readback = await getRecord(selectedModule, selectedId);
      if (!recordMatches(readback, patch)) {
        fail("CRM update outcome could not be reconciled", {
          publicCode: "reconciliation_required",
          ambiguous: true,
        });
      }
      return Object.freeze({ record: readback, replayed: true });
    }
    const readback = await getRecord(selectedModule, selectedId);
    if (!recordMatches(readback, patch)) {
      fail("CRM assisted submission readback did not match", {
        publicCode: "reconciliation_required",
        ambiguous: true,
      });
    }
    return Object.freeze({ record: readback, replayed: false });
  }

  return Object.freeze({
    assertJourney,
    completeAssistedSubmission,
    getRecord,
    getOrInitializeJourney,
    recordVersion,
    recordMatches,
  });
}

module.exports = { CrmClientError, READ_FIELDS, createCrmClient };
