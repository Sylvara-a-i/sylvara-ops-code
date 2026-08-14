"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CrmClientError, createCrmClient } = require("../lib/crm-client");

const IDS = Object.freeze({
  contact: `${"9".repeat(17)}1`,
  account: `${"9".repeat(17)}2`,
  deal: `${"9".repeat(17)}3`,
});
const OLD_TIME = "2026-08-14T12:00:00-05:00";
const NEW_TIME = "2026-08-14T12:01:00-05:00";
const READ_AUTHORIZATION = "Zoho-oauthtoken SyntheticReadToken123456789";
const WRITE_AUTHORIZATION = "Zoho-oauthtoken SyntheticWriteToken12345678";

function config(overrides = {}) {
  return {
    crmApiBaseUrl: "https://www.zohoapis.com/crm/v8",
    outboundTimeoutMs: 5000,
    outboundMaxBytes: 131072,
    ...overrides,
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function existingRecords() {
  return {
    contact: {
      id: IDS.contact,
      Modified_Time: OLD_TIME,
      Account_Name: { id: IDS.account },
      First_Name: "Casey",
      Last_Name: "Tester",
      Decision_Maker_Role: "Owner / Founder",
      Title: "Owner",
      Decision_Authority: "Authorized Signer",
      Email: "casey@example.invalid",
      Mobile: "555-010-2000",
    },
    account: {
      id: IDS.account,
      Modified_Time: OLD_TIME,
      Primary_Contact: { id: IDS.contact },
      Account_Name: "Synthetic Plumbing",
      Legal_Business_Name: "Synthetic Plumbing LLC",
      Phone: "555-010-2100",
      Phone_System_Provider: "Synthetic PBX",
      Primary_Service_Area: "Synthetic County",
      Normal_Business_Hours: "Monday-Friday 08:00-17:00",
      Field_Team_Size_Band: "Synthetic Approved Band",
      Services_Handled: ["Drain Cleaning"],
      Other_Service_Details: null,
    },
    deal: {
      id: IDS.deal,
      Modified_Time: OLD_TIME,
      Account_Name: { id: IDS.account },
      Contact_Name: { id: IDS.contact },
      Current_Call_Handling: "Office Staff / Dispatcher",
      Requested_Test_Route: "No Answer / Overflow Only",
      Approved_Test_Route: "No Answer / Overflow Only",
      Setup_Access_Issued_At: "2026-08-14T17:55:00.000Z",
      Setup_Access_Verified_At: "2026-08-14T17:58:00.000Z",
      Test_Duration_Days: 7,
      Test_Call_Limit: 25,
      Test_Scope_Version: "scope-v1",
      Entry_Offer: "Free Test",
      Submission_Channel: "Website",
      Free_Test_Request_Submitted_At: "2026-08-14T11:00:00-05:00",
      Intake_Submission_ID: "synthetic-intake-0001",
      Free_Test_Request_Notes: "Synthetic request",
    },
  };
}

function updates() {
  return {
    contactUpdate: {
      First_Name: "Casey",
      Last_Name: "Tester",
      Decision_Maker_Role: "Owner / Founder",
      Title: "Owner",
      Decision_Authority: "Authorized Signer",
    },
    accountUpdate: {
      Account_Name: "Synthetic Plumbing",
      Legal_Business_Name: "Synthetic Plumbing LLC",
      Phone: "555-010-2100",
      Phone_System_Provider: "Synthetic PBX",
      Primary_Service_Area: "Synthetic County",
      Normal_Business_Hours: "Monday-Friday 08:00-17:00",
      Field_Team_Size_Band: "Synthetic Approved Band",
      Services_Handled: ["Drain Cleaning"],
      Other_Service_Details: null,
    },
    dealUpdate: {
      Target_Start_Date: "2026-08-20",
      Test_Phone_Number: "555-010-2200",
      No_Answer_Delay: "5 Rings",
      Forwarding_Administrator_Name: "Synthetic Administrator",
      Forwarding_Administrator_Mobile: "555-010-2300",
      Approved_Fallback_Destination: "On-Call Mobile",
      Approved_Fallback_Number: "555-010-2400",
      Rollback_Contact_Name: "Synthetic Rollback Contact",
      Rollback_Contact_Mobile: "555-010-2500",
      Urgent_Call_Handling: "Alert + Capture Callback",
      Existing_Customer_Call_Handling: "Capture Callback Only",
      Alert_Recipient_Name: "Synthetic Alert Recipient",
      Alert_Recipient_Mobile: "555-010-2600",
      Alert_Recipient_Email: null,
      Authorized_Representative_Confirmed: true,
      Test_Scope_Accepted: true,
      Authority_Confirmed_At: "2026-08-14T18:00:00.000Z",
      Test_Scope_Accepted_At: "2026-08-14T18:00:00.000Z",
      Setup_Form_Submission_ID: "synthetic-submission-0001",
      Setup_Form_Version: "form2-v1",
      Setup_Form_Submitted_At: "2026-08-14T18:00:00.000Z",
      Setup_Access_Status: "Submitted",
    },
  };
}

function acknowledgment(recordId) {
  return {
    data: [{
      code: "SUCCESS",
      details: { id: recordId, Modified_Time: NEW_TIME },
      message: "record updated",
      status: "success",
    }],
  };
}

function compositeAcknowledgment() {
  return {
    __composite_requests: [IDS.contact, IDS.account, IDS.deal].map((recordId) => ({
      code: "SUCCESS",
      details: { response: { status_code: 200, body: acknowledgment(recordId) } },
      message: "composite sub request executed successfully",
      status: "success",
    })),
  };
}

function afterRecords() {
  const existing = existingRecords();
  const selectedUpdates = updates();
  return {
    contact: { ...existing.contact, ...selectedUpdates.contactUpdate, Modified_Time: NEW_TIME },
    account: { ...existing.account, ...selectedUpdates.accountUpdate, Modified_Time: NEW_TIME },
    deal: { ...existing.deal, ...selectedUpdates.dealUpdate, Modified_Time: NEW_TIME },
  };
}

function clientWithFetch(fetchImpl) {
  return createCrmClient(config(), {
    readAuthorizationProvider: async () => READ_AUTHORIZATION,
    writeAuthorizationProvider: async () => WRITE_AUTHORIZATION,
    fetchImpl,
  });
}

test("GET is restricted to one approved record endpoint and a fixed field projection", async () => {
  let captured;
  const record = existingRecords().contact;
  const client = clientWithFetch(async (url, options) => {
    captured = { url: new URL(url), options };
    return jsonResponse({ data: [record] });
  });

  assert.deepEqual(await client.getRecord("Contacts", IDS.contact), record);
  assert.equal(captured.url.pathname, `/crm/v8/Contacts/${IDS.contact}`);
  assert.equal(captured.url.searchParams.has("fields"), true);
  assert.equal(captured.url.searchParams.get("fields").includes("Email"), true);
  assert.equal(captured.options.method, "GET");
  assert.equal(captured.options.headers.Authorization, READ_AUTHORIZATION);
  assert.equal(captured.options.redirect, "error");
});

test("uses one ordered rollback composite and verifies all three records by independent GET", async () => {
  const calls = [];
  const readbacks = afterRecords();
  const client = clientWithFetch(async (url, options) => {
    const parsed = new URL(url);
    calls.push({ parsed, options });
    if (parsed.pathname.endsWith("/__composite_requests")) {
      return jsonResponse(compositeAcknowledgment());
    }
    if (parsed.pathname.includes("/Contacts/")) return jsonResponse({ data: [readbacks.contact] });
    if (parsed.pathname.includes("/Accounts/")) return jsonResponse({ data: [readbacks.account] });
    if (parsed.pathname.includes("/Deals/")) return jsonResponse({ data: [readbacks.deal] });
    throw new Error("unexpected synthetic route");
  });

  const result = await client.updateForm2Composite(existingRecords(), updates());
  assert.equal(result.deal.Setup_Form_Version, "form2-v1");
  assert.equal(calls.length, 4);
  const composite = calls[0];
  const body = JSON.parse(composite.options.body);
  assert.equal(composite.parsed.pathname, "/crm/v8/__composite_requests");
  assert.equal(composite.options.method, "POST");
  assert.equal(composite.options.headers.Authorization, WRITE_AUTHORIZATION);
  assert.equal(body.rollback_on_fail, true);
  assert.equal(body.parallel_execution, false);
  assert.deepEqual(
    body.__composite_requests.map((entry) => entry.uri),
    [
      `/crm/v8/Contacts/${IDS.contact}`,
      `/crm/v8/Accounts/${IDS.account}`,
      `/crm/v8/Deals/${IDS.deal}`,
    ],
  );
  assert.deepEqual(body.__composite_requests.map((entry) => entry.method), ["PUT", "PUT", "PUT"]);
  assert.deepEqual(
    body.__composite_requests.map((entry) => entry.headers["If-Unmodified-Since"]),
    [OLD_TIME, OLD_TIME, OLD_TIME],
  );
  assert.deepEqual(
    body.__composite_requests.map((entry) => entry.body.trigger),
    [["workflow"], ["workflow"], ["workflow"]],
  );
  assert.equal(JSON.stringify(body).includes("casey@example.invalid"), false);
});

test("malformed composite success and readback mismatch are ambiguous", async () => {
  const malformed = clientWithFetch(async () => jsonResponse({ __composite_requests: [] }));
  await assert.rejects(
    malformed.updateForm2Composite(existingRecords(), updates()),
    (error) => error instanceof CrmClientError && error.ambiguous === true,
  );

  let first = true;
  const readbacks = afterRecords();
  readbacks.deal.Setup_Form_Version = "wrong-version";
  const mismatched = clientWithFetch(async (url) => {
    const path = new URL(url).pathname;
    if (first) {
      first = false;
      return jsonResponse(compositeAcknowledgment());
    }
    if (path.includes("/Contacts/")) return jsonResponse({ data: [readbacks.contact] });
    if (path.includes("/Accounts/")) return jsonResponse({ data: [readbacks.account] });
    return jsonResponse({ data: [readbacks.deal] });
  });
  await assert.rejects(
    mismatched.updateForm2Composite(existingRecords(), updates()),
    (error) => error instanceof CrmClientError && error.ambiguous === true,
  );
});

test("post-composite readback rejects workflow changes to locked Contact identity", async () => {
  for (const [field, value] of [
    ["Email", "changed@example.invalid"],
    ["Mobile", "555-010-2999"],
  ]) {
    let first = true;
    const readbacks = afterRecords();
    readbacks.contact[field] = value;
    const client = clientWithFetch(async (url) => {
      const path = new URL(url).pathname;
      if (first) {
        first = false;
        return jsonResponse(compositeAcknowledgment());
      }
      if (path.includes("/Contacts/")) return jsonResponse({ data: [readbacks.contact] });
      if (path.includes("/Accounts/")) return jsonResponse({ data: [readbacks.account] });
      return jsonResponse({ data: [readbacks.deal] });
    });
    await assert.rejects(
      client.updateForm2Composite(existingRecords(), updates()),
      (error) =>
        error instanceof CrmClientError &&
        error.ambiguous === true &&
        error.publicCode === "reconciliation_required",
    );
  }
});

test("post-composite readback rejects workflow changes to setup access timestamps", async () => {
  for (const [field, value] of [
    ["Setup_Access_Issued_At", null],
    ["Setup_Access_Verified_At", "2026-08-14T18:00:30.000Z"],
  ]) {
    let first = true;
    const readbacks = afterRecords();
    readbacks.deal[field] = value;
    const client = clientWithFetch(async (url) => {
      const path = new URL(url).pathname;
      if (first) {
        first = false;
        return jsonResponse(compositeAcknowledgment());
      }
      if (path.includes("/Contacts/")) return jsonResponse({ data: [readbacks.contact] });
      if (path.includes("/Accounts/")) return jsonResponse({ data: [readbacks.account] });
      return jsonResponse({ data: [readbacks.deal] });
    });
    await assert.rejects(
      client.updateForm2Composite(existingRecords(), updates()),
      (error) =>
        error instanceof CrmClientError &&
        error.ambiguous === true &&
        error.publicCode === "reconciliation_required",
    );
  }
});

test("single-record update requires a precondition and authoritative readback", async () => {
  let call = 0;
  const readback = { ...existingRecords().contact, First_Name: "Changed", Modified_Time: NEW_TIME };
  const client = clientWithFetch(async () => {
    call += 1;
    return call === 1
      ? jsonResponse(acknowledgment(IDS.contact))
      : jsonResponse({ data: [readback] });
  });
  const result = await client.updateRecord(
    "Contacts",
    IDS.contact,
    { First_Name: "Changed" },
    { ifUnmodifiedSince: OLD_TIME },
  );
  assert.equal(result.First_Name, "Changed");
});

test("stale writes are rejected without being classified as ambiguous", async () => {
  const client = clientWithFetch(async () => jsonResponse({ code: "ALREADY_MODIFIED" }, 412));
  await assert.rejects(
    client.updateRecord(
      "Contacts",
      IDS.contact,
      { First_Name: "Changed" },
      { ifUnmodifiedSince: OLD_TIME },
    ),
    (error) =>
      error instanceof CrmClientError &&
      error.ambiguous === false &&
      error.publicCode === "record_stale",
  );
});

test("authorization failure occurs before fetch and never exposes authorization material", async () => {
  let fetchCalls = 0;
  const client = createCrmClient(config(), {
    readAuthorizationProvider: async () => { throw new Error("synthetic secret failure"); },
    writeAuthorizationProvider: async () => WRITE_AUTHORIZATION,
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({});
    },
  });
  await assert.rejects(
    client.getRecord("Contacts", IDS.contact),
    (error) =>
      error instanceof CrmClientError &&
      !error.message.includes("secret") &&
      !error.message.includes("oauthtoken"),
  );
  assert.equal(fetchCalls, 0);
});

test("rejects non-V8 bases, unapproved modules, and non-allowlisted update fields", async () => {
  for (const crmApiBaseUrl of [
    "https://example.invalid/crm/v8",
    "https://zohoapis.evil.com/crm/v8",
    "https://www.zohoapis.evil.com/crm/v8",
    "https://www.zohoapis.eu/crm/v8",
  ]) {
    let authorizationCalls = 0;
    let fetchCalls = 0;
    assert.throws(
      () => createCrmClient(config({ crmApiBaseUrl }), {
        authorizationProvider: async () => {
          authorizationCalls += 1;
          return READ_AUTHORIZATION;
        },
        fetchImpl: async () => {
          fetchCalls += 1;
          return jsonResponse({});
        },
      }),
      CrmClientError,
    );
    assert.equal(authorizationCalls, 0);
    assert.equal(fetchCalls, 0);
  }
  const client = clientWithFetch(async () => jsonResponse({}));
  await assert.rejects(client.getRecord("Leads", IDS.contact), CrmClientError);
  await assert.rejects(
    client.updateRecord(
      "Contacts",
      IDS.contact,
      { Email: "changed@example.invalid" },
      { ifUnmodifiedSince: OLD_TIME },
    ),
    CrmClientError,
  );
});
