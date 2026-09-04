"use strict";

// These are fixed reserved/synthetic values used only to expose the response
// keys to Zoho Forms' mapping editor. The binding values cannot authorize a
// real assisted submission because this fixture creates no server-side session.
const FORM1_PREFILL_MAPPING_SAMPLE = Object.freeze({
  firstName: "ZZZ",
  lastName: "SYNTHETIC",
  company: "ZZZ SYNTHETIC Mapping Fixture",
  decisionMakerRole: "Owner / Founder",
  jobTitle: "ZZZ SYNTHETIC QA",
  email: "zzz.synthetic.mapping@example.com",
  mobilePhone: "+1 202-555-0100",
  companyPhone: "+1 202-555-0101",
  currentCallHandling: "Voicemail",
  preferredTestRoute: "After-Hours",
  phoneSystemProvider: "Not Sure",
  primaryServiceArea: "ZZZ SYNTHETIC SERVICE AREA",
  fieldTeamSizeBand: "3–4",
  additionalNotes: "ZZZ SYNTHETIC mapping fixture only.",
  leadSource: "Website",
  sourcePage: "ZZZ_SYNTHETIC_CRM_ASSISTED_MAPPING",
  utmSource: "ZZZ_SYNTHETIC",
  utmMedium: "ZZZ_SYNTHETIC",
  utmCampaign: "ZZZ_SYNTHETIC",
  utmTerm: "ZZZ_SYNTHETIC",
  utmContent: "ZZZ_SYNTHETIC",
  prefillId: "00000000-0000-4000-8000-000000000001",
  configurationRevision: "0000000000000000000000000000000000000000"
});

module.exports = { FORM1_PREFILL_MAPPING_SAMPLE };
