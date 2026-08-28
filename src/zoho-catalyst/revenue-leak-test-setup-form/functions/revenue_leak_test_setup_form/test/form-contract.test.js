"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { PRIVATE_CHOICE_LIMITS } = require("../lib/config");
const {
  CLIENT_KEYS,
  FormContractError,
  buildPrefillPayload,
  validateForm2Payload,
  verifyRecordRelationships,
} = require("../lib/form-contract");

function providerChoices(count) {
  return Array.from(
    { length: count },
    (_, index) => `Synthetic Provider ${String(index + 1).padStart(3, "0")}`,
  );
}

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
    alertRecipientEmail: "alerts@example.invalid",
    authorizedRepresentativeConfirmed: true,
    testScopeAccepted: true,
  };
}

test("rejects respondent-owned test-number assignment", () => {
  assert.throws(
    () => validateForm2Payload(
      { ...validPayload(), testPhoneNumber: "555-010-2200" },
      { existing: existingRecords(), ...SERVER_OPTIONS },
    ),
    (error) => error.message === "Unknown form field is prohibited",
  );
});

const SERVER_OPTIONS = Object.freeze({
  trustedNow: "2026-08-14T18:00:00.000Z",
  setupFormVersion: "form2-v1",
  submissionId: "synthetic-submission-0001",
  setupAccessSubmittedStatus: "Synthetic Submitted",
  allowedPhoneSystemProviders: Object.freeze([
    "Synthetic PBX",
    "Different Synthetic PBX",
  ]),
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
  assert.equal(updates.dealUpdate.Authorized_Representative_Confirmed, true);
  assert.equal(updates.dealUpdate.Test_Scope_Accepted, true);
  assert.equal(updates.dealUpdate.Authority_Confirmed_At, SERVER_OPTIONS.trustedNow);
  assert.equal(updates.dealUpdate.Test_Scope_Accepted_At, SERVER_OPTIONS.trustedNow);
  for (const field of [
    "Free_Test_Authorization_Status",
    "Authorization_Signed_At",
    "Go_Live_Approval_Status",
    "Go_Live_Approved_At",
    "Test_Status",
  ]) {
    assert.equal(updates.dealUpdate[field], undefined, field);
  }
  assert.equal(updates.dealUpdate.Test_Duration_Days, undefined);
  assert.equal(updates.dealUpdate.Test_Call_Limit, undefined);
  assert.equal(updates.dealUpdate.Test_Scope_Version, undefined);
  assert.equal(Object.isFrozen(updates), true);
});

test("keeps requested start date optional while validating any supplied value", () => {
  for (const optionalValue of [null, "", undefined]) {
    const payload = { ...validPayload(), requestedStartDate: optionalValue };
    const updates = validateForm2Payload(payload, {
      existing: existingRecords(),
      ...SERVER_OPTIONS,
    });
    assert.equal(updates.dealUpdate.Target_Start_Date, null);
  }

  const missing = validPayload();
  delete missing.requestedStartDate;
  assert.equal(
    validateForm2Payload(missing, {
      existing: existingRecords(),
      ...SERVER_OPTIONS,
    }).dealUpdate.Target_Start_Date,
    null,
  );

  for (const invalidValue of ["08/20/2026", "2026-02-30"]) {
    assert.throws(
      () => validateForm2Payload(
        { ...validPayload(), requestedStartDate: invalidValue },
        { existing: existingRecords(), ...SERVER_OPTIONS },
      ),
      (error) => error instanceof FormContractError && error.field === "requestedStartDate",
    );
  }
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
    "freeTestAuthorizationStatus",
    "authorizationSignedAt",
    "goLiveApprovalStatus",
    "goLiveApprovedAt",
    "testStatus",
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
    ["alert email", { alertRecipientEmail: null }],
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

test("preserves the approved conditional setup matrix despite stricter live Blueprint inputs", () => {
  const afterHoursRecords = existingRecords();
  afterHoursRecords.deal.Requested_Test_Route = "After Hours Only";
  afterHoursRecords.deal.Approved_Test_Route = "After Hours Only";
  const afterHours = {
    ...validPayload(),
    requestedTestRoute: "After Hours Only",
    approvedTestRoute: "After Hours Only",
    noAnswerDelay: null,
  };
  assert.doesNotThrow(() => validateForm2Payload(afterHours, {
    existing: afterHoursRecords,
    ...SERVER_OPTIONS,
  }));
  assert.throws(
    () => validateForm2Payload(
      { ...afterHours, noAnswerDelay: "5 Rings" },
      { existing: afterHoursRecords, ...SERVER_OPTIONS },
    ),
    FormContractError,
  );

  const voicemail = {
    ...validPayload(),
    approvedFallbackDestination: "Voicemail",
    approvedFallbackNumber: null,
  };
  assert.doesNotThrow(() => validateForm2Payload(voicemail, {
    existing: existingRecords(),
    ...SERVER_OPTIONS,
  }));
  assert.throws(
    () => validateForm2Payload(
      { ...voicemail, approvedFallbackNumber: "555-010-2400" },
      { existing: existingRecords(), ...SERVER_OPTIONS },
    ),
    FormContractError,
  );

  assert.doesNotThrow(() => validateForm2Payload(
    { ...validPayload(), alertRecipientEmail: "alerts@example.invalid" },
    { existing: existingRecords(), ...SERVER_OPTIONS },
  ));
  assert.throws(() => validateForm2Payload(
    { ...validPayload(), alertRecipientMobile: "555-010-2600" },
    { existing: existingRecords(), ...SERVER_OPTIONS },
  ), (error) => error instanceof FormContractError && error.publicCode === "unknown_field");
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

test("phone-system providers require the private allowlist and 120-character ceiling", () => {
  for (const phoneSystemProvider of ["Unapproved Synthetic PBX", "P".repeat(121)]) {
    assert.throws(
      () => validateForm2Payload(
        { ...validPayload(), phoneSystemProvider },
        { existing: existingRecords(), ...SERVER_OPTIONS },
      ),
      (error) => error instanceof FormContractError && error.publicCode === "form_invalid",
    );
  }

  const updates = validateForm2Payload(
    { ...validPayload(), phoneSystemProvider: "Different Synthetic PBX" },
    { existing: existingRecords(), ...SERVER_OPTIONS },
  );
  assert.equal(updates.accountUpdate.Phone_System_Provider, "Different Synthetic PBX");
});

test("phone-system contract accepts 208 providers and rejects a list above its bound", () => {
  const providers = providerChoices(208);
  const selectedProvider = providers.at(-1);
  const records = existingRecords();
  records.account.Phone_System_Provider = selectedProvider;
  const payload = { ...validPayload(), phoneSystemProvider: selectedProvider };
  const updates = validateForm2Payload(payload, {
    existing: records,
    ...SERVER_OPTIONS,
    allowedPhoneSystemProviders: providers,
  });
  assert.equal(updates.accountUpdate.Phone_System_Provider, selectedProvider);
  const prefill = buildPrefillPayload(records, {
    allowedPhoneSystemProviders: providers,
  });
  assert.equal(prefill.phoneSystemProvider, selectedProvider);

  assert.throws(
    () => validateForm2Payload(validPayload(), {
      existing: existingRecords(),
      ...SERVER_OPTIONS,
      allowedPhoneSystemProviders: providerChoices(
        PRIVATE_CHOICE_LIMITS.phoneSystemProviders + 1,
      ),
    }),
    (error) =>
      error instanceof FormContractError && error.publicCode === "configuration_invalid",
  );
});

test("prefill rejects CRM phone-system providers outside the private runtime contract", () => {
  for (const provider of ["Unapproved Synthetic PBX", "P".repeat(121)]) {
    const records = existingRecords();
    records.account.Phone_System_Provider = provider;
    assert.throws(
      () => buildPrefillPayload(records, {
        allowedPhoneSystemProviders: SERVER_OPTIONS.allowedPhoneSystemProviders,
      }),
      (error) => error instanceof FormContractError && error.publicCode === "context_invalid",
    );
  }
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
  const prefill = buildPrefillPayload(existingRecords(), {
    allowedPhoneSystemProviders: SERVER_OPTIONS.allowedPhoneSystemProviders,
  });
  assert.deepEqual(Object.keys(prefill), CLIENT_KEYS);
  assert.equal(prefill.businessEmail, "casey@example.invalid");
  assert.equal(prefill.approvedTestRoute, "No Answer / Overflow Only");
  assert.equal(prefill.authorizedRepresentativeConfirmed, false);
  assert.equal(prefill.testScopeAccepted, false);
  assert.equal(JSON.stringify(prefill).includes(IDS.contact), false);
  assert.equal(JSON.stringify(prefill).includes("Modified_Time"), false);
  assert.equal(Object.isFrozen(prefill.servicesHandled), true);
});
