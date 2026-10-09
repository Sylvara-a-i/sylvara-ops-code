"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  FormContractError, buildCrmPatch, buildPrefillPayload, normalizeFormData,
} = require("../lib/form-contract");
const { loadConfig } = require("../lib/config");
const { REVISION, environment } = require("./helpers");

const constants = loadConfig(environment(), REVISION).assistedConstants;
const receipt = {
  journeyId: "journey_synthetic_001", submittedAt: "2026-08-29T12:00:00.000Z",
};
function formData(overrides = {}) {
  return {
    firstName: "ZZZ", lastName: "Synthetic", company: "ZZZ SYNTHETIC Plumbing",
    decisionMakerRole: "Owner", jobTitle: "", email: "synthetic@example.invalid",
    mobilePhone: "+15555550101", companyPhone: "+15555550102",
    currentCallHandling: "Voicemail", preferredTestRoute: "After Hours",
    phoneSystemProvider: "", primaryServiceArea: "ZZZ SYNTHETIC",
    fieldTeamSizeBand: "1-5", additionalNotes: "", contactConsent: true,
    leadSource: "Other", sourcePage: "", utmSource: "synthetic", utmMedium: "",
    utmCampaign: "", utmTerm: "", utmContent: "", ...overrides,
  };
}

// Independent limits from the 2026-10-06 Leads metadata audit. Synthetic
// provider strings test length only, not membership in any live picklist.
const limits = [
  ["firstName", "First_Name", 40, true],
  ["lastName", "Last_Name", 80, true],
  ["email", "Email", 100, true],
  ["additionalNotes", "Free_Test_Request_Notes", 2000, false],
  ["phoneSystemProvider", "Phone_System_Provider", 120, false],
];
function boundaryValue(key, maximum, character = "a") {
  if (key === "email") {
    return `${character.repeat(44)}@${"b".repeat(maximum - 53)}.invalid`;
  }
  return character.repeat(maximum);
}
function invalid(error) {
  return error instanceof FormContractError && error.status === 422 &&
    error.publicCode === "form_data_invalid";
}

for (const [key, crm, maximum, required] of limits) {
  test(`${key} preserves the exact CRM length and rejects one extra code point`, () => {
    // Keep the existing code-point counting policy, including supplementary
    // characters. These offline cases do not establish provider Unicode parity.
    for (const character of ["a", "\u00e9", "\u{1f600}"]) {
      const value = boundaryValue(key, maximum, character);
      assert.equal([...value].length, maximum);
      const data = formData({ [key]: value });
      const before = structuredClone(data);
      assert.equal(normalizeFormData(data)[crm], value);
      assert.equal(buildCrmPatch(data, constants, receipt)[crm], value);
      assert.equal(buildPrefillPayload({ [crm]: value }, constants)[key], value);
      assert.deepEqual(data, before);
      const oversized = `${value}a`;
      assert.throws(() => normalizeFormData(formData({ [key]: oversized })), invalid);
      assert.throws(() => buildCrmPatch(formData({ [key]: oversized }), constants, receipt), invalid);
      assert.throws(() => buildPrefillPayload({ [crm]: oversized }, constants), invalid);
    }
  });

  test(`${key} retains blank, whitespace and control-character behavior`, () => {
    for (const blank of ["", null, undefined]) {
      const data = formData({ [key]: blank });
      if (required) {
        assert.throws(() => normalizeFormData(data), invalid);
      } else {
        assert.equal(normalizeFormData(data)[crm], null);
        assert.equal(Object.hasOwn(buildCrmPatch(data, constants, receipt), crm), false);
      }
      assert.equal(Object.hasOwn(buildPrefillPayload({ [crm]: blank }, constants), key), false);
    }
    const valid = boundaryValue(key, maximum);
    for (const value of [" ", ` ${valid}`, `${valid} `, `\u00a0${valid}`, `${valid}\n`, 7, false]) {
      assert.throws(() => normalizeFormData(formData({ [key]: value })), invalid);
    }
  });
}

test("combining sequences remain separate code points and are never normalized", () => {
  for (const [key, crm, maximum] of limits.filter(([key]) => key !== "email")) {
    const value = "e\u0301".repeat(maximum / 2);
    assert.equal(normalizeFormData(formData({ [key]: value }))[crm], value);
    assert.throws(() => normalizeFormData(formData({ [key]: `${value}\u0301` })), invalid);
  }
});

test("valid contract keeps consent, source authority, optional omission and exact input", () => {
  const data = formData({ firstName: "Zo\u00eb", lastName: "O'Example", additionalNotes: "A  B" });
  const patch = buildCrmPatch(data, constants, receipt);
  assert.equal(patch.First_Name, data.firstName);
  assert.equal(patch.Last_Name, data.lastName);
  assert.equal(patch.Free_Test_Request_Notes, "A  B");
  assert.equal(patch.Free_Test_Contact_Consent, true);
  assert.equal(patch.Source_Page, constants.sourcePage);
  assert.equal(Object.hasOwn(patch, "Lead_Source"), false);
  assert.equal(Object.hasOwn(patch, "Phone_System_Provider"), false);
  assert.equal(Object.hasOwn(buildPrefillPayload(patch, constants), "contactConsent"), false);
  for (const override of [{ contactConsent: false }, { email: "invalid" }, { unknown: "extra" }]) {
    assert.throws(() => normalizeFormData(formData(override)), invalid);
  }
});
