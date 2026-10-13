"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { evidence } = require("./fixtures/two-company-identity");
const { resolveProtectedCompanyLinks } = require("../offline-identity-contract");
const { produceTimedServiceAreaRequest } = require("../service-area-request-producer");
const { projectCreatorAuthorization: project } = require("../creator-authorization-projection");

function fixture(company = "a") {
  const e = evidence();
  const observedAt = "2026-10-12T12:00:00.000Z";
  const metadata = { environment: "development", organizationId: "synthetic-organization", observedAt, complete: true };
  const binding = (suffix, principalId, auditActorId) => ({ principalId, auditActorId,
    nativeSubjectId: `synthetic-native-${suffix}`, incarnationId: `synthetic-incarnation-${suffix}`,
    emailLookup: `${suffix}@example.invalid`, username: `Synthetic ${suffix}`, active: true, revision: `binding-v1-${suffix}` });
  const bindings = [binding("a", "synthetic-principal", "synthetic-human"),
    binding("b", "synthetic-other-principal", "synthetic-other-human")];
  const selected = bindings[company === "a" ? 0 : 1];
  const f = {
    e, selector: `synthetic-company-${company}`,
    session: { ...metadata, callerContextQualified: true, nativeSubjectId: selected.nativeSubjectId,
      incarnationId: selected.incarnationId, emailAddresses: [selected.emailLookup],
      username: selected.username, permission: "Synthetic portal client" },
    registry: { ...metadata, bindings, grants: e.grants, accountLinks: e.accountLinks, contactLinks: e.contactLinks },
    policy: { expectedEnvironment: metadata.environment, expectedOrganizationId: metadata.organizationId,
      asOf: observedAt, maxAgeMs: 1000, allowedPermissions: ["Synthetic portal client"] },
  };
  f.run = () => project(f.selector, f.session, f.registry, f.policy);
  return f;
}

test("native projection supplies existing resolver for two independent companies without email attribution", () => {
  for (const company of ["a", "b"]) {
    const f = fixture(company), snapshot = f.run();
    const { principal, complete, grants, accountLinks, contactLinks } = snapshot;
    const identity = resolveProtectedCompanyLinks(f.selector, { principal, complete, grants, accountLinks, contactLinks });
    assert.equal(identity.crmAccountId, `synthetic-crm-company-${company}`);
    assert.equal(snapshot.principal.id, company === "a" ? "synthetic-principal" : "synthetic-other-principal");
    assert.ok(!JSON.stringify(snapshot).includes("example.invalid"));
    assert.ok(Object.isFrozen(snapshot.grants[0]));
    f.registry.grants[0].active = false;
    assert.equal(snapshot.grants[0].active, true);
  }
});

test("unavailable unqualified ambiguous and malformed native context denies", () => {
  for (const change of [
    f => { f.session.callerContextQualified = false; },
    f => { f.session.complete = false; },
    f => { f.session.emailAddresses = []; },
    f => { f.session.emailAddresses.push("b@example.invalid"); },
    f => { f.session.emailAddresses = "a@example.invalid"; },
    f => { f.session.nativeSubjectId = null; },
    f => { f.session.incarnationId = ""; },
    f => { f.session.permission = "Synthetic admin"; },
    f => { f.session.username = "Synthetic owner"; },
    f => { f.session.clientPrincipal = "synthetic-principal"; },
    f => { f.registry.complete = false; },
    f => { f.registry.environment = "production"; },
    f => { f.session.organizationId = "synthetic-other-organization"; },
    f => { f.session.observedAt = "2026-10-12T11:59:58.999Z"; },
    f => { f.registry.observedAt = "2026-10-12T12:00:00.001Z"; },
  ]) { const f = fixture(); change(f); assert.throws(f.run, /Invalid Creator authorization evidence/); }
});

test("email change reuse and recreated accounts never inherit a prior principal", () => {
  for (const change of [
    f => { f.session.emailAddresses = ["b@example.invalid"]; },
    f => { f.session.emailAddresses = ["new@example.invalid"]; },
    f => { f.session.nativeSubjectId = "synthetic-recreated-native"; },
    f => { f.session.incarnationId = "synthetic-recreated-incarnation"; },
    f => { f.registry.bindings[0].active = false; },
    f => { f.registry.bindings.push({ ...f.registry.bindings[0], active: false }); },
    f => { f.registry.bindings.push({ ...f.registry.bindings[0], emailLookup: "new@example.invalid" }); },
    f => { f.registry.bindings[1].principalId = f.registry.bindings[0].principalId; },
    f => { f.registry.bindings[1].auditActorId = f.registry.bindings[0].auditActorId; },
  ]) { const f = fixture(); change(f); assert.throws(f.run, TypeError); }
});

test("existing grant and CRM link rules reject forged company duplicate grants and wrong contact joins", () => {
  for (const change of [
    f => { f.selector = "synthetic-company-b"; },
    f => { f.registry.grants[0].active = false; },
    f => { f.registry.grants.push({ ...f.registry.grants[0] }); },
    f => { f.registry.contactLinks[0].creatorAccountId = "synthetic-company-b"; },
    f => { f.registry.accountLinks.push({ ...f.registry.accountLinks[0] }); },
    f => { f.registry.contactLinks[1].crmContactId = f.registry.contactLinks[0].crmContactId; },
  ]) { const f = fixture(); change(f); assert.throws(f.run, TypeError); }
});

test("projection never invokes accessors or leaks provider error details", () => {
  const f = fixture();
  let invoked = false;
  Object.defineProperty(f.session, "permission", { get() { invoked = true; throw Error("private-provider-detail"); } });
  assert.throws(f.run, { message: "Invalid Creator authorization evidence" });
  assert.equal(invoked, false);
});

test("oldest receipt time prevents registry from refreshing cached native permission", () => {
  const f = fixture();
  f.session.observedAt = "2026-10-12T11:59:59.500Z";
  assert.equal(f.run().observedAt, f.session.observedAt);
});

test("timed producer composes current native mapping and denies revocation between exact CRM reads", async () => {
  for (const revoke of [null, "binding", "permission", "incarnation", "grant", "revision"]) {
    const f = fixture();
    let tick = Date.parse(f.policy.asOf), reads = 0;
    const now = () => new Date(tick).toISOString();
    const result = produceTimedServiceAreaRequest({ Account: f.selector, Requested_Service_Area: "East County" },
      "synthetic-native-request", { protocol: "timed-read-v2", expectedEnvironment: "development",
        expectedOrganizationId: "synthetic-organization", maxAgeMs: 1000, maxDurationMs: 10000 }, {
        now,
        async readAuthorization() {
          tick += 1;
          f.session.observedAt = f.registry.observedAt = f.policy.asOf = now();
          return f.run();
        },
        async get(d) {
          reads++;
          tick += 1;
          if (d.module === "Contacts") {
            if (revoke === "binding") f.registry.bindings[0].active = false;
            if (revoke === "permission") f.session.permission = "Synthetic denied";
            if (revoke === "incarnation") f.session.incarnationId = "synthetic-recreated";
            if (revoke === "grant") f.registry.grants[0].active = false;
            if (revoke === "revision") f.registry.grants[0].revision = "grant-v2-a";
          }
          return { state: "available", environment: "development", organizationId: "synthetic-organization",
            observedAt: now(), module: d.module, recordId: d.recordId, complete: true,
            response: { data: [d.module === "Contacts"
              ? { id: d.recordId, Account_Name: { id: "synthetic-crm-company-a" } }
              : { id: d.recordId, Primary_Service_Area: "North County" }] } };
        },
      });
    if (revoke) { await assert.rejects(result, /Invalid service-area read evidence/); assert.equal(reads, 1); }
    else { const prepared = await result; assert.equal(prepared.attribution.principalId, "synthetic-principal"); assert.equal(reads, 2); }
  }
});

test("native diagnostic source reads zero-argument context and cannot authorize or provision", () => {
  const source = fs.readFileSync(path.join(__dirname, "../native/portal-caller-context-probe.deluge"), "utf8");
  for (const task of ["loginUserEmailid", "loginUserName", "loginUserProfile"]) assert.ok(source.includes(`thisapp.portal.${task}()`));
  assert.ok(source.includes('result.put("callerContextQualified",false)'));
  assert.doesNotMatch(source, /\b(info|invokeurl|sendmail|insert\s+into|delete\s+from)\b/);
  assert.doesNotMatch(source, /Portal_Test_ResolveCompany\s*\(/);
});
