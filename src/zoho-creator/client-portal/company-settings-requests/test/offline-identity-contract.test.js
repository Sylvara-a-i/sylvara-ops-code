"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveExplicitCompanyIdentity: resolve,
  prepareOfflineRequestBinding: prepare,
  assertSameReplayBinding: sameReplay,
} = require("../offline-identity-contract");

function evidence() {
  return {
    principal: { id: "synthetic-principal", auditActorId: "synthetic-human" },
    complete: true,
    grants: [{ principalId: "synthetic-principal", creatorAccountId: "synthetic-company", creatorContactId: "synthetic-secondary-contact", scope: "service-area-request", active: true, revision: "grant-v1" }],
    accountLinks: [{ creatorAccountId: "synthetic-company", crmAccountId: "synthetic-crm-company", revision: "account-link-v1" }],
    contactLinks: [{ creatorContactId: "synthetic-secondary-contact", creatorAccountId: "synthetic-company", crmContactId: "synthetic-crm-contact", revision: "contact-link-v1" }],
    crmContacts: [{ id: "synthetic-crm-contact", accountId: "synthetic-crm-company" }],
    crmAccounts: [{ id: "synthetic-crm-company", previousServiceArea: "  Exact\r\nbaseline  " }],
  };
}
const submitted = () => ({ Account: "synthetic-company", Requested_Service_Area: "North\r\nSouth" });
const issuance = () => ({ requestId: "synthetic-request", issuedAt: "2026-10-05T00:00:00.000Z" });
const plan = (e = evidence(), i = submitted(), issued = issuance()) => prepare(i, e, issued);

test("explicit canonical links resolve secondary contact without Billing or role requirements", () => {
  const e = evidence();
  const before = structuredClone(e);
  const identity = resolve("synthetic-company", e);
  assert.equal(identity.crmAccountId, "synthetic-crm-company");
  assert.equal(identity.crmContactId, "synthetic-crm-contact");
  assert.equal(identity.creatorContactId, "synthetic-secondary-contact");
  assert.equal(identity.auditActorId, "synthetic-human");
  assert.equal(identity.previousServiceArea, e.crmAccounts[0].previousServiceArea);
  assert.deepEqual(e, before);
});

test("absent, duplicate and reverse-ambiguous links fail closed at every join", () => {
  for (const key of ["grants", "accountLinks", "contactLinks", "crmContacts", "crmAccounts"]) {
    for (const duplicate of [false, true]) {
      const e = evidence();
      e[key] = duplicate ? [e[key][0], { ...e[key][0] }] : [];
      assert.throws(() => plan(e), TypeError, `${key}: ${duplicate}`);
    }
  }
  const accountAmbiguity = evidence();
  accountAmbiguity.accountLinks.push({ ...accountAmbiguity.accountLinks[0], creatorAccountId: "synthetic-other-company" });
  assert.throws(() => plan(accountAmbiguity), TypeError);
  const contactAmbiguity = evidence();
  contactAmbiguity.contactLinks.push({ ...contactAmbiguity.contactLinks[0], creatorContactId: "synthetic-other-contact" });
  assert.throws(() => plan(contactAmbiguity), TypeError);
});

test("wrong actor, inactive grant, unsupported scope and cross-company joins fail closed", () => {
  for (const mutate of [
    (e) => { e.principal.id = "synthetic-other-principal"; },
    (e) => { e.grants[0].active = false; },
    (e) => { e.grants[0].active = "true"; },
    (e) => { e.grants[0].scope = "Administrator"; },
    (e) => { e.contactLinks[0].creatorAccountId = "synthetic-other-company"; },
    (e) => { e.crmContacts[0].accountId = "synthetic-other-company"; },
    (e) => { e.accountLinks[0].crmAccountId = "synthetic-other-company"; },
    (e) => { e.grants[0].creatorContactId = "synthetic-other-contact"; },
    (e) => { e.complete = false; },
  ]) {
    const e = evidence();
    mutate(e);
    assert.throws(() => plan(e), TypeError);
  }
});

test("Billing-only and optional portal-user/role shortcuts cannot supply identity", () => {
  for (const shortcut of [
    { Customer_ID: "synthetic-billing-customer" },
    { Portal_User_ID: "synthetic-portal-user", Role: "Admin" },
    { CRM_Account_ID: "synthetic-crm-company", CRM_Contact_ID: "synthetic-crm-contact" },
  ]) {
    const e = evidence();
    e.accountLinks = [shortcut];
    assert.throws(() => plan(e), TypeError);
    assert.throws(() => prepare(submitted(), shortcut, issuance()), TypeError);
  }
});

test("evidence must be complete plain data with no accessors, symbols or custom arrays", () => {
  for (const mutate of [
    (e) => { delete e.complete; },
    (e) => { e[Symbol("hidden")] = true; },
    (e) => { e.grants = [ , e.grants[0]]; },
    (e) => { e.grants.extra = "unexpected"; },
    (e) => { e.grants[Symbol.iterator] = function* () {}; },
    (e) => { e.contactLinks[0] = Object.create(e.contactLinks[0]); },
    (e) => { e.principal.auditActorId = null; },
    (e) => { e.crmAccounts[0].previousServiceArea = null; },
  ]) {
    const e = evidence();
    mutate(e);
    assert.throws(() => plan(e), TypeError);
  }
  let calls = 0;
  const e = evidence();
  Object.defineProperty(e.grants, "0", { get() { calls++; return {}; } });
  assert.throws(() => plan(e), TypeError);
  const input = submitted();
  Object.defineProperty(input, "Account", { get() { calls++; return "selector"; } });
  assert.throws(() => prepare(input, evidence(), issuance()), TypeError);
  assert.equal(calls, 0);
});

test("attribution and four-field request are copied and frozen, separate from the form", () => {
  const e = evidence();
  const i = submitted();
  const issued = issuance();
  const before = structuredClone({ e, i, issued });
  const prepared = prepare(i, e, issued);
  assert.deepEqual(Object.keys(prepared.request), ["Account", "Previous_Service_Area", "Requested_Service_Area", "Status"]);
  assert.equal(prepared.attribution.principalId, e.principal.id);
  assert.equal(prepared.attribution.auditActorId, e.principal.auditActorId);
  assert.deepEqual({ e, i, issued }, before);
  e.principal.auditActorId = "synthetic-replacement";
  e.crmAccounts[0].previousServiceArea = "replacement";
  assert.equal(prepared.attribution.auditActorId, before.e.principal.auditActorId);
  assert.equal(prepared.request.Previous_Service_Area, before.e.crmAccounts[0].previousServiceArea);
  for (const value of [prepared, prepared.request, prepared.attribution, prepared.binding]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { prepared.request.Status = "Approved"; }, TypeError);
  assert.throws(() => { prepared.attribution.auditActorId = "spoof"; }, TypeError);
  assert.throws(() => { prepared.binding.bindingDigest = "spoof"; }, TypeError);
});

test("exact normalized replay and property reordering keep deterministic binding", () => {
  const first = plan();
  const reordered = { ...evidence(), principal: { auditActorId: "synthetic-human", id: "synthetic-principal" } };
  const next = plan(reordered, { Requested_Service_Area: "  North\nSouth ", Account: "synthetic-company" });
  assert.deepEqual(next.binding, first.binding);
  assert.doesNotThrow(() => sameReplay(first.binding, next.binding));
  assert.match(first.binding.claimKey, /^[a-f0-9]{64}$/);
  assert.match(first.binding.bindingDigest, /^[a-f0-9]{64}$/);
});

test("same request key conflicts when attribution, identities, revisions, baseline or text change", () => {
  const first = plan();
  for (const mutate of [
    (e) => { e.principal.auditActorId = "synthetic-other-human"; },
    (e) => { e.grants[0].revision = "grant-v2"; },
    (e) => { e.accountLinks[0].revision = "account-link-v2"; },
    (e) => { e.contactLinks[0].revision = "contact-link-v2"; },
    (e) => { e.crmAccounts[0].previousServiceArea = "changed baseline"; },
    (e) => { e.contactLinks[0].crmContactId = e.crmContacts[0].id = "synthetic-other-crm-contact"; },
    (e) => { e.accountLinks[0].crmAccountId = e.crmContacts[0].accountId = e.crmAccounts[0].id = "synthetic-other-crm-company"; },
    (e) => { e.grants[0].creatorContactId = e.contactLinks[0].creatorContactId = "synthetic-other-creator-contact"; },
  ]) {
    const e = evidence();
    mutate(e);
    const next = plan(e);
    assert.equal(next.binding.claimKey, first.binding.claimKey);
    assert.notEqual(next.binding.bindingDigest, first.binding.bindingDigest);
    assert.throws(() => sameReplay(first.binding, next.binding), TypeError);
  }
  const changedText = plan(evidence(), { ...submitted(), Requested_Service_Area: "West" });
  assert.equal(changedText.binding.claimKey, first.binding.claimKey);
  assert.throws(() => sameReplay(first.binding, changedText.binding), TypeError);
  const changedTime = plan(evidence(), submitted(), { ...issuance(), issuedAt: "2026-10-05T00:00:01.000Z" });
  assert.throws(() => sameReplay(first.binding, changedTime.binding), TypeError);
});

test("changed company cannot reuse a principal request key; distinct request or principal has a distinct key", () => {
  const first = plan();
  const e = evidence();
  e.grants[0].creatorAccountId = e.accountLinks[0].creatorAccountId = e.contactLinks[0].creatorAccountId = "synthetic-other-company";
  const next = plan(e, { ...submitted(), Account: "synthetic-other-company" });
  assert.equal(next.binding.claimKey, first.binding.claimKey);
  assert.throws(() => sameReplay(first.binding, next.binding), TypeError);
  assert.notEqual(plan(evidence(), submitted(), { ...issuance(), requestId: "synthetic-second-request" }).binding.claimKey, first.binding.claimKey);
  const otherPrincipal = evidence();
  otherPrincipal.principal.id = otherPrincipal.grants[0].principalId = "synthetic-other-principal";
  assert.notEqual(plan(otherPrincipal).binding.claimKey, first.binding.claimKey);
});

test("malformed trusted issuance and binding readbacks fail without leaking private values", () => {
  for (const issued of [null, { ...issuance(), requestId: "" }, { ...issuance(), issuedAt: "2026-02-30T00:00:00.000Z" }, { ...issuance(), issuedAt: "now" }, { ...issuance(), actor: "override" }]) {
    assert.throws(() => prepare(submitted(), evidence(), issued), TypeError);
  }
  for (const binding of [null, {}, { claimKey: "synthetic-private", bindingDigest: "bad" }, { ...plan().binding, status: "done" }]) {
    assert.throws(() => sameReplay(binding, plan().binding), (error) => error instanceof TypeError && !error.message.includes("synthetic-private"));
  }
});

test("offline composition has only crypto/planner dependencies and zero transport or clock calls", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  let calls = 0;
  const forbidden = () => { calls++; throw new Error("forbidden side effect"); };
  const sandbox = vm.createContext({ module: { exports: {} }, fetch: forbidden, console: { log: forbidden } });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../service-area-request-contract.js"), "utf8"), sandbox);
  const planner = sandbox.module.exports;
  sandbox.module = { exports: {} };
  sandbox.require = (name) => {
    if (name === "node:crypto") return require("node:crypto");
    if (name === "./service-area-request-contract") return planner;
    return forbidden();
  };
  vm.runInContext("Date.now = () => { throw new Error('clock forbidden'); };", sandbox);
  // Separate lexical scope from the planner's module declarations.
  vm.runInContext(`(function () { ${fs.readFileSync(path.resolve(__dirname, "../offline-identity-contract.js"), "utf8")} })()`, sandbox);
  vm.runInContext(`module.exports.prepareOfflineRequestBinding(${JSON.stringify(submitted())}, ${JSON.stringify(evidence())}, ${JSON.stringify(issuance())})`, sandbox);
  assert.equal(calls, 0);
});
