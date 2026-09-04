"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const { buildCrmPatch, FORM_KEYS } = require("../lib/form-contract");
const { handleRequest } = require("../lib/handler");
const { REVISION, environment } = require("./helpers");

const NOW = "2026-08-29T12:00:00.000Z";

function formData(overrides = {}) {
  return {
    firstName: "ZZZ",
    lastName: "Synthetic",
    company: "ZZZ SYNTHETIC Plumbing",
    decisionMakerRole: "Owner / Founder",
    jobTitle: "Owner",
    email: "synthetic@example.invalid",
    mobilePhone: "+15555550101",
    companyPhone: "+15555550102",
    currentCallHandling: "Voicemail",
    preferredTestRoute: "After Hours Only",
    phoneSystemProvider: "Synthetic Provider",
    primaryServiceArea: "ZZZ SYNTHETIC",
    fieldTeamSizeBand: "1-5",
    additionalNotes: "",
    leadSource: "Respondent Controlled Source",
    sourcePage: "Respondent Controlled Page",
    utmSource: "synthetic",
    utmMedium: "synthetic",
    utmCampaign: "synthetic",
    utmTerm: "synthetic",
    utmContent: "synthetic",
    contactConsent: true,
    ...overrides,
  };
}

test("assisted patch preserves CRM acquisition source and pins route provenance", () => {
  const constants = {
    entryOffer: "7-Day Revenue Leak Test",
    intakeFormVersion: "revenue-leak-test-request-v1",
    leadStatus: "Free Test Requested",
    sourcePage: "CRM Assisted Free-Test Setup",
    submissionChannel: "CRM Assisted",
  };
  const patch = buildCrmPatch(formData(), constants, {
    journeyId: "journey_synthetic_authority_001",
    submittedAt: NOW,
  });

  assert.equal(Object.hasOwn(patch, "Lead_Source"), false);
  assert.equal(patch.Source_Page, constants.sourcePage);
  assert.equal(patch.Entry_Offer, constants.entryOffer);
  assert.equal(patch.Submission_Channel, constants.submissionChannel);
  assert.equal(patch.Lead_Status, constants.leadStatus);
  assert.equal(patch.Intake_Submission_ID, "journey_synthetic_authority_001");
  assert.equal(patch.Free_Test_Contact_Consent_At, NOW);

  const changed = buildCrmPatch(formData({
    leadSource: "Different Respondent Source",
    sourcePage: "Different Respondent Page",
  }), constants, {
    journeyId: "journey_synthetic_authority_001",
    submittedAt: NOW,
  });
  assert.deepEqual(changed, patch);
});

test("public flat 25-key transport remains a non-writing acknowledgment", async () => {
  const config = loadConfig(environment(), REVISION);
  const submitted = formData();
  const body = {
    prefillId: "",
    configurationRevision: "",
    submissionId: "provider_public_authority_001",
    ...submitted,
  };
  assert.equal(Object.keys(body).length, 25);
  assert.deepEqual(new Set(Object.keys(submitted)), FORM_KEYS);

  let crmAccessed = false;
  let sessionAccessed = false;
  const crmClient = new Proxy({}, {
    get() { crmAccessed = true; throw new Error("CRM must not be accessed"); },
  });
  const sessionStore = new Proxy({}, {
    get() { sessionAccessed = true; throw new Error("session store must not be accessed"); },
  });
  const result = await handleRequest({
    method: "POST",
    url: config.submissionPath,
    headers: {
      "content-type": "application/json",
      [config.submissionHeaderName]: config.submissionHeaderSecret,
    },
    rawBody: Buffer.from(JSON.stringify(body)),
  }, {
    config,
    crmClient,
    sessionStore,
    randomBytes: () => { throw new Error("entropy must not be consumed"); },
    randomUUID: () => { throw new Error("entropy must not be consumed"); },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, binding: "public_unbound" });
  assert.equal(result.stage, "submission");
  assert.equal(result.outcome, "public_unbound");
  assert.equal(crmAccessed, false);
  assert.equal(sessionAccessed, false);
});
