"use strict";

// Fixed reserved examples expose mapping keys and their JSON types only. There
// is no session or durable prefill row behind either synthetic binding value.
// In particular, mapping installation must never pre-attest authorization.
const FORM2_PREFILL_MAPPING_SAMPLE = Object.freeze({
  firstName: "ZZZ",
  lastName: "SYNTHETIC",
  decisionMakerRole: "Owner / Founder",
  jobTitle: "ZZZ SYNTHETIC QA",
  decisionAuthority: "Unknown",
  businessEmail: "zzz.synthetic.mapping@example.invalid",
  directMobileNumber: "+1 202-555-0100",
  companyName: "ZZZ SYNTHETIC Mapping Fixture",
  legalBusinessName: "ZZZ SYNTHETIC Mapping Fixture LLC",
  mainBusinessNumber: "+1 202-555-0101",
  phoneSystemProvider: "ZZZ SYNTHETIC PBX",
  primaryServiceArea: "ZZZ SYNTHETIC SERVICE AREA",
  normalBusinessHours: "ZZZ SYNTHETIC Monday-Friday 08:00-17:00",
  fieldTeamSizeBand: "ZZZ SYNTHETIC BAND",
  servicesHandled: Object.freeze(["Other"]),
  otherServiceDetails: "ZZZ SYNTHETIC mapping only",
  currentCallHandling: "Voicemail",
  requestedTestRoute: "No Answer / Overflow Only",
  approvedTestRoute: "No Answer / Overflow Only",
  requestedStartDate: "2000-01-01",
  noAnswerDelay: "Provider Default",
  forwardingAdministratorName: "ZZZ SYNTHETIC Forwarding Administrator",
  forwardingAdministratorMobile: "+1 202-555-0102",
  approvedFallbackDestination: "Existing Office Line",
  approvedFallbackNumber: "+1 202-555-0103",
  rollbackContactName: "ZZZ SYNTHETIC Rollback Contact",
  rollbackContactMobile: "+1 202-555-0104",
  urgentCallHandling: "Capture Callback Only",
  existingCustomerCallHandling: "Capture Callback Only",
  alertRecipientName: "ZZZ SYNTHETIC Alert Recipient",
  alertRecipientEmail: "zzz.synthetic.alert@example.invalid",
  authorizedRepresentativeConfirmed: false,
  testScopeAccepted: false,
  prefillId: "00000000-0000-4000-8000-000000000002",
  configurationRevision: "0000000000000000000000000000000000000000"
});

module.exports = { FORM2_PREFILL_MAPPING_SAMPLE };
