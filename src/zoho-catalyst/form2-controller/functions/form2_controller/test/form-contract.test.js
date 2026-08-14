"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CLIENT_KEYS,
  FormContractError,
  buildPrefillPayload,
  validateForm2Payload,
  verifyRecordRelationships,
} = require("../lib/form-contract");

const IDS = Object.freeze({
  contact: `${"9".repeat(17)}1`,
  account: `${"9".repeat(17)}2`,
  deal: `${"9".repeat(17)}3`,
});
const MODIFIED_TIME = "2026-08-14T12:00:00-05:00";

function existingRecords() {
  return {
    contact: {
      id: IDS.contact,
      Modified_Time: MODIFIED_TIME,
      Account_Name: { id: IDS.account, name: "Synthetic Plumbing" },
      First_Name: "Casey",
      Last_Name: "Tester",
      Decision_Maker_Role: "Owner / Founder",
      Title: "Owner",
      Decision_Authority: "Authorized Signer",
      Email: "casey@example.invalid",
      Mobile: "+1 (555) 010-2000",
    },
    account: {
      id: IDS.account,
      Modified_Time: MODIFIED_TIME,
      Primary_Contact: { id: IDS.contact, name: "Casey Tester" },
      Account_Name: "Synthetic Plumbing",
      Legal_Business_Name: "Synthetic Plumbing LLC",
      Phone: "+1 (555) 010-2100",
      Phone_System_Provider: "Synthetic PBX",
      Primary_Service_Area: "Synthetic County",
      Normal_Business_Hours: "Monday-Friday 08:00-17:00",
      Field_Team_Size_Band: "Synthetic Approved Band",
      Services_Handled: ["Drain Cleaning"],
      Other_Service_Details: null,
    },
    deal: {
      id: IDS.deal,
      Modified_Time: MODIFIED_TIME,
      Account_Name: { id: IDS.account, name: "Synthetic Plumbing" },
      Contact_Name: { id: IDS.contact, name: "Casey Tester" },
      Current_Call_Handling: "Office Staff / Dispatcher",
      Requested_Test_Route: "No Answer / Overflow Only",
      Approved_Test_Route: "No Answer / Overflow Only",
      Target_Start_Date: null,
      Test_Phone_Number: null,
      No_Answer_Delay: null,
      Forwarding_Administrator_Name: null,
      Forwarding_Administrator_Mobile: null,
      Approved_Fallback_Destination: null,
      Approved_Fallback_Number: null,
      Rollback_Contact_Name: null,
      Rollback_Contact_Mobile: null,
      Urgent_Call_Handling: null,
      Existing_Customer_Call_Handling: null,
      Alert_Recipient_Name: null,
      Alert_Recipient_Mobile: null,
      Alert_Recipient_Email: null,
    },
  };
}

function validPayload() {
  return {
    firstName: "Casey",
    lastName: "Tester",
    decisionMakerRole: "Owner / Founder",
    jobTitle: "Owner",
    decisionAuthority: "Authorized Signer",
    businessEmail: "CASEY@example.invalid",
    directMobileNumber: "555-010-2000",
    companyName: "Synthetic Plumbing",
    legalBusinessName: "Synthetic Plumbing LLC",
    mainBusinessNumber: "555-010-2100",
    phoneSystemProvider: "Synthetic PBX",
    primaryServiceArea: "Synthetic County",
    normalBusinessHours: "Monday-Friday 08:00-17:00",
    fieldTeamSizeBand: "Synthetic Approved Band",
    servicesHandled: ["Drain Cleaning"],
    otherServiceDetails: null,
    currentCallHandling: "Office Staff / Dispatcher",
    requestedTestRoute: "No Answer / Overflow Only",
    approvedTestRoute: "No Answer / Overflow Only",
    requestedStartDate: "2026-08-20",
    testPhoneNumber: "555-010-2200",
    noAnswerDelay: "5 Rings",
    forwardingAdministratorName: "Synthetic Administrator",
    forwardingAdministratorMobile: "555-010-2300",
    approvedFallbackDestination: "On-Call Mobile",
    approvedFallbackNumber: "555-010-2400",
    rollbackContactName: "Synthetic Rollback Contact",
    rollbackContactMobile: "555-010-2500",
    urgentCallHandling: "Alert + Capture Callback",
    existingCustomerCallHandling: "Capture Callback Only",
    alertRecipientName: "Synthetic Alert Recipient",
    alertRecipientMobile: "555-010-2600",
    alertRecipientEmail: null,
    authorizedRepresentativeConfirmed: true,
    testScopeAccepted: true,
  };
}

const SERVER_OPTIONS = Object.freeze({
  trustedNow: "2026-08-14T18:00:00.000Z",
  setupFormVersion: "form2-v1",
  submissionId: "synthetic-submission-0001",
  setupAccessSubmittedStatus: "Synthetic Submitted",
});

test("normalizes the approved Form 2 payload into three bounded CRM updates", () => {
  const updates = validateForm2Payload(validPayload(), {
    existing: existingRecords(),
    ...SERVER_OPTIONS,
  });

  assert.deepEqual(updates.contactUpdate, {
    First_Name: "Casey",
    Last_Name: "Tester",
    Decision_Maker_Role: "Owner / Founder",
    Title: "Owner",
    Decision_Authority: "Authorized Signer",
  });
  assert.equal(updates.contactUpdate.Email, undefined);
  assert.equal(updates.contactUpdate.Mobile, undefined);
  assert.equal(updates.dealUpdate.Setup_Form_Version, "form2-v1");
  assert.equal(updates.dealUpdate.Setup_Form_Submitted_At, SERVER_OPTIONS.trustedNow);
  assert.equal(updates.dealUpdate.Setup_Access_Status, "Synthetic Submitted");
  assert.equal(updates.dealUpdate.Authority_Confirmed_At, SERVER_OPTIONS.trustedNow);
  assert.equal(updates.dealUpdate.Test_Scope_Accepted_At, SERVER_OPTIONS.trustedNow);
  assert.equal(updates.dealUpdate.Test_Duration_Days, undefined);
  assert.equal(updates.dealUpdate.Test_Call_Limit, undefined);
  assert.equal(updates.dealUpdate.Test_Scope_Version, undefined);
  assert.equal(Object.isFrozen(updates), true);
});

test("locks verified email and requires separate reverification for a mobile change", () => {
  const changedEmail = validPayload();
  changedEmail.businessEmail = "different@example.invalid";
  assert.throws(
    () => validateForm2Payload(changedEmail, { existing: existingRecords(), ...SERVER_OPTIONS }),
    (error) => error instanceof FormContractError && error.publicCode === "identity_mismatch",
  );

  const changedMobile = validPayload();
  changedMobile.directMobileNumber = "555-010-2999";
  assert.throws(
    () => validateForm2Payload(changedMobile, { existing: existingRecords(), ...SERVER_OPTIONS }),
    (error) =>
      error instanceof FormContractError &&
      error.publicCode === "mobile_reverification_required",
  );
});

test("rejects client-owned IDs, server-owned fields, unknown keys, and pollution keys", () => {
  for (const key of [
    "contactId",
    "testDurationDays",
    "testCallLimit",
    "testScopeVersion",
    "setupFormVersion",
    "setupFormSubmittedAt",
  ]) {
    const payload = { ...validPayload(), [key]: "synthetic" };
    assert.throws(
      () => validateForm2Payload(payload, { existing: existingRecords(), ...SERVER_OPTIONS }),
      (error) => error instanceof FormContractError && error.publicCode === "unknown_field",
    );
  }

  const polluted = JSON.parse('{"__proto__":{"isAdmin":true}}');
  assert.throws(
    () => validateForm2Payload(polluted, { existing: existingRecords(), ...SERVER_OPTIONS }),
    FormContractError,
  );
});

test("enforces conditional fields and both affirmative confirmations", () => {
  const cases = [
    ["other service details", { servicesHandled: ["Other"], otherServiceDetails: null }],
    ["no-answer delay", { noAnswerDelay: null }],
    ["fallback number", { approvedFallbackNumber: null }],
    ["alert channel", { alertRecipientMobile: null, alertRecipientEmail: null }],
    ["authority", { authorizedRepresentativeConfirmed: false }],
    ["scope", { testScopeAccepted: false }],
  ];
  for (const [name, changes] of cases) {
    assert.throws(
      () => validateForm2Payload(
        { ...validPayload(), ...changes },
        { existing: existingRecords(), ...SERVER_OPTIONS },
      ),
      FormContractError,
      name,
    );
  }
});

test("private field-team choices fail closed unless unchanged or privately allowlisted", () => {
  const changed = { ...validPayload(), fieldTeamSizeBand: "Different Private Band" };
  assert.throws(
    () => validateForm2Payload(changed, { existing: existingRecords(), ...SERVER_OPTIONS }),
    FormContractError,
  );
  const updates = validateForm2Payload(changed, {
    existing: existingRecords(),
    ...SERVER_OPTIONS,
    allowedFieldTeamSizeBands: ["Synthetic Approved Band", "Different Private Band"],
  });
  assert.equal(updates.accountUpdate.Field_Team_Size_Band, "Different Private Band");
});

test("requires Contact, Account, and Deal to resolve to one relationship context", () => {
  const records = existingRecords();
  records.deal.Contact_Name.id = `${"9".repeat(16)}99`;
  assert.throws(
    () => verifyRecordRelationships(records),
    (error) => error instanceof FormContractError && error.publicCode === "relationship_mismatch",
  );
});

test("builds a flat prefill allowlist without record IDs or server-controlled values", () => {
  const prefill = buildPrefillPayload(existingRecords());
  assert.deepEqual(Object.keys(prefill), CLIENT_KEYS);
  assert.equal(prefill.businessEmail, "casey@example.invalid");
  assert.equal(prefill.approvedTestRoute, "No Answer / Overflow Only");
  assert.equal(prefill.authorizedRepresentativeConfirmed, false);
  assert.equal(prefill.testScopeAccepted, false);
  assert.equal(JSON.stringify(prefill).includes(IDS.contact), false);
  assert.equal(JSON.stringify(prefill).includes("Modified_Time"), false);
  assert.equal(Object.isFrozen(prefill.servicesHandled), true);
});
