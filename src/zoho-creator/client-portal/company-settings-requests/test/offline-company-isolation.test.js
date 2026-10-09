"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evidence } = require("./fixtures/two-company-identity");
const {
  resolveExplicitCompanyIdentity: resolve,
  prepareOfflineRequestBinding: prepare,
} = require("../offline-identity-contract");

const input = (company) => ({ Account: `synthetic-company-${company}`, Requested_Service_Area: "  East\r\nCounty  " });
const issuance = () => ({ requestId: "synthetic-isolation-request", issuedAt: "2026-10-05T00:00:00.000Z" });
const principals = {
  a: { id: "synthetic-principal", auditActorId: "synthetic-human" },
  b: { id: "synthetic-other-principal", auditActorId: "synthetic-other-human" },
};

test("each company resolves its own complete identity with unrelated company rows present", () => {
  for (const company of ["a", "b"]) {
    const e = evidence();
    e.principal = { ...principals[company] };
    const before = structuredClone(e);
    const identity = resolve(input(company).Account, e);
    assert.deepEqual(identity, {
      principalId: principals[company].id,
      auditActorId: principals[company].auditActorId,
      creatorAccountId: `synthetic-company-${company}`,
      creatorContactId: `synthetic-creator-contact-${company}`,
      crmAccountId: `synthetic-crm-company-${company}`,
      crmContactId: `synthetic-crm-contact-${company}`,
      grantRevision: `grant-v1-${company}`,
      accountLinkRevision: `account-link-v1-${company}`,
      contactLinkRevision: `contact-link-v1-${company}`,
      previousServiceArea: company === "a" ? "  North\r\nCounty  " : "  South\r\nCounty  ",
    });
    const prepared = prepare(input(company), e, issuance());
    assert.deepEqual(prepared.request, {
      Account: `synthetic-company-${company}`,
      Previous_Service_Area: identity.previousServiceArea,
      Requested_Service_Area: "East\nCounty",
      Status: "Pending review",
    });
    assert.equal(prepared.attribution.crmContactId, identity.crmContactId);
    assert.equal(prepared.attribution.crmAccountId, identity.crmAccountId);
    assert.deepEqual(e, before);
  }
});

test("forged company selection fails despite complete links and another principal's active grant", () => {
  for (const [authorizedCompany, forgedCompany] of [["a", "b"], ["b", "a"]]) {
    const e = evidence();
    e.principal = { ...principals[authorizedCompany] };
    assert.doesNotThrow(() => prepare(input(authorizedCompany), e, issuance()));
    assert.throws(() => resolve(input(forgedCompany).Account, e), TypeError);
    assert.throws(() => prepare(input(forgedCompany), e, issuance()), TypeError);
    // The target is valid for its own principal; its availability cannot authorize this selector.
    e.principal = { ...principals[forgedCompany] };
    assert.doesNotThrow(() => prepare(input(forgedCompany), e, issuance()));
  }
});

test("duplicate same-contact grants fail even when only one is active, in either order", () => {
  for (const company of ["a", "b"]) {
    for (const activeStates of [[true, true], [true, false], [false, true]]) {
      const e = evidence();
      e.principal = { ...principals[company] };
      const grant = e.grants.find((row) => row.creatorAccountId === input(company).Account);
      grant.active = activeStates[0];
      e.grants.push({ ...grant, active: activeStates[1] });
      assert.throws(() => resolve(input(company).Account, e), TypeError);
      assert.throws(() => prepare(input(company), e, issuance()), TypeError);
    }
  }
});

test("grants for distinct valid contacts remain ambiguous for the same principal and company", () => {
  for (const company of ["a", "b"]) {
    for (const activeStates of [[true, true], [true, false], [false, true]]) {
      const e = evidence();
      e.principal = { ...principals[company] };
      const originalGrant = e.grants.find((row) => row.creatorAccountId === input(company).Account);
      const alternateGrant = {
        ...originalGrant,
        creatorContactId: `synthetic-alternate-creator-contact-${company}`,
        revision: `alternate-grant-v1-${company}`,
      };
      e.contactLinks.push({
        creatorContactId: alternateGrant.creatorContactId,
        creatorAccountId: originalGrant.creatorAccountId,
        crmContactId: `synthetic-alternate-crm-contact-${company}`,
        revision: `alternate-contact-link-v1-${company}`,
      });
      e.crmContacts.push({ id: `synthetic-alternate-crm-contact-${company}`, accountId: `synthetic-crm-company-${company}` });
      // Each distinct contact independently has a valid canonical relationship to this company.
      const alternateOnly = structuredClone(e);
      alternateOnly.grants = alternateOnly.grants.filter((row) => row.creatorAccountId !== input(company).Account);
      alternateOnly.grants.push(alternateGrant);
      assert.equal(resolve(input(company).Account, alternateOnly).creatorContactId, alternateGrant.creatorContactId);
      assert.equal(resolve(input(company).Account, e).creatorContactId, originalGrant.creatorContactId);

      originalGrant.active = activeStates[0];
      alternateGrant.active = activeStates[1];
      e.grants.push(alternateGrant);
      assert.throws(() => resolve(input(company).Account, e), TypeError);
      assert.throws(() => prepare(input(company), e, issuance()), TypeError);
    }
  }
});
