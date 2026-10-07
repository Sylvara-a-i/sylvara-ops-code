"use strict";
const constants = Object.freeze({
  entryOffer: "Synthetic Offer", intakeFormVersion: "form1-synthetic-v1",
  leadStatus: "Synthetic Requested", sourcePage: "synthetic-form1",
  submissionChannel: "Synthetic Assisted",
});
const receipt = Object.freeze({
  journeyId: "journey_synthetic_phone", submittedAt: "2026-10-07T12:00:00.123Z",
});
function form1(overrides = {}) {
  return { firstName: "Synthetic", lastName: "Tester", company: "ZZZ SYNTHETIC",
    decisionMakerRole: "Other", jobTitle: "", email: "synthetic@example.invalid",
    mobilePhone: "(202) 555-0109", companyPhone: "202-555-0110",
    currentCallHandling: "Unknown", preferredTestRoute: "After-Hours",
    phoneSystemProvider: "", primaryServiceArea: "", fieldTeamSizeBand: "",
    additionalNotes: "QA-only simulated consent; do not contact.",
    leadSource: "Other", sourcePage: "", utmSource: "", utmMedium: "",
    utmCampaign: "", utmTerm: "", utmContent: "", contactConsent: true, ...overrides };
}
function form2(overrides = {}) {
  return { firstName: "Casey", lastName: "Tester", decisionMakerRole: "Owner / Founder",
    jobTitle: "Owner", decisionAuthority: "Authorized Signer",
    businessEmail: "casey@example.invalid", directMobileNumber: "(202) 555-0109",
    companyName: "ZZZ SYNTHETIC", legalBusinessName: "ZZZ SYNTHETIC LLC",
    mainBusinessNumber: "202-555-0110", phoneSystemProvider: "Synthetic PBX",
    primaryServiceArea: "Synthetic County", normalBusinessHours: "Monday-Friday 08:00-17:00",
    fieldTeamSizeBand: "", servicesHandled: ["Drain Cleaning"], otherServiceDetails: null,
    currentCallHandling: "Office Staff / Dispatcher",
    requestedTestRoute: "No Answer / Overflow Only", approvedTestRoute: "No Answer / Overflow Only",
    requestedStartDate: null, noAnswerDelay: "5 Rings",
    forwardingAdministratorName: "Synthetic Admin", forwardingAdministratorMobile: "202.555.0111",
    approvedFallbackDestination: "On-Call Mobile", approvedFallbackNumber: "+1 202 555 0112",
    rollbackContactName: "Synthetic Rollback", rollbackContactMobile: "1 (202) 555-0113",
    urgentCallHandling: "Alert + Capture Callback", existingCustomerCallHandling: "Capture Callback Only",
    alertRecipientName: "Synthetic Alert", alertRecipientEmail: "alerts@example.invalid",
    authorizedRepresentativeConfirmed: true, testScopeAccepted: true, ...overrides };
}
function records() {
  const id = { contact: `9${"0".repeat(16)}1`, account: `9${"0".repeat(16)}2`,
    deal: `9${"0".repeat(16)}3` };
  const common = { Modified_Time: "2026-10-07T11:00:00-05:00" };
  return {
    contact: { ...common, id: id.contact, Account_Name: { id: id.account },
      Email: "casey@example.invalid", Mobile: "2025550109" },
    account: { ...common, id: id.account, Primary_Contact: { id: id.contact },
      Phone: "2025550110", Phone_System_Provider: "Synthetic PBX",
      Services_Handled: ["Drain Cleaning"] },
    deal: { ...common, id: id.deal, Account_Name: { id: id.account },
      Contact_Name: { id: id.contact }, Current_Call_Handling: "Office Staff / Dispatcher",
      Requested_Test_Route: "No Answer / Overflow Only", Approved_Test_Route: "No Answer / Overflow Only",
      Configuration_Version: null },
  };
}
function form2Options() {
  return { existing: records(), countryCode: "US", trustedNow: "2026-10-07T12:00:00.000Z",
    setupFormVersion: "form2-synthetic-v1", submissionId: "synthetic-phone-001",
    setupAccessSubmittedStatus: "Synthetic Submitted",
    configurationVersion: `form2cfgv1:7200000000001:${"a".repeat(40)}`,
    allowedPhoneSystemProviders: ["Synthetic PBX"] };
}
module.exports = { constants, receipt, form1, form2, records, form2Options };
