"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { projectCrmServiceAreaResponse: project } = require("../crm-service-area-response");
const { produceServiceAreaRequest } = require("../service-area-request-producer");
const { prepareOfflineRequestBinding } = require("../offline-identity-contract");
const { evidence } = require("./fixtures/two-company-identity");

function native(module, company = "a") {
  return { data: [module === "Contacts" ? {
    id: `synthetic-crm-contact-${company}`,
    Account_Name: { id: `synthetic-crm-company-${company}`, name: "Synthetic display name" },
    Email: "synthetic-private-email", Owner: { id: "synthetic-owner", name: "Synthetic owner" },
    Modified_Time: "synthetic-modified-time", environment: "production",
    organizationId: "synthetic-untrusted-organization", observedAt: "synthetic-untrusted-time",
  } : {
    id: `synthetic-crm-company-${company}`,
    Primary_Service_Area: company === "a" ? "  North\r\nCounty  " : "  South\r\nCounty  ",
    Account_Name: "Synthetic company display name", Billing_Address: "synthetic-private-address",
    Owner: { id: "synthetic-owner" }, $has_more: { synthetic_subform: false },
  }] };
}

test("native Contact and Account projections retain only the required exact record facts", () => {
  for (const company of ["a", "b"]) {
    const contact = native("Contacts", company);
    const account = native("Accounts", company);
    const before = structuredClone({ contact, account });
    const c = project("Contacts", `synthetic-crm-contact-${company}`, contact);
    const a = project("Accounts", `synthetic-crm-company-${company}`, account);
    assert.deepEqual(c, { data: [{ id: `synthetic-crm-contact-${company}`, Account_Name: { id: `synthetic-crm-company-${company}` } }] });
    assert.deepEqual(a, { data: [{ id: `synthetic-crm-company-${company}`, Primary_Service_Area: account.data[0].Primary_Service_Area }] });
    assert.deepEqual({ contact, account }, before);
    for (const value of [c, c.data, c.data[0], c.data[0].Account_Name, a, a.data, a.data[0]]) assert.ok(Object.isFrozen(value));
    assert.ok(!JSON.stringify({ c, a }).includes("synthetic-private"));
    assert.ok(!Object.hasOwn(c, "environment"));
    contact.data[0].Account_Name.id = "synthetic-other-account";
    account.data[0].Primary_Service_Area = "Changed after projection";
    assert.equal(c.data[0].Account_Name.id, `synthetic-crm-company-${company}`);
    assert.equal(a.data[0].Primary_Service_Area, before.account.data[0].Primary_Service_Area);
  }
});

test("projected native responses compose with the published producer for both companies", async () => {
  for (const company of ["a", "b"]) {
    const e = evidence();
    if (company === "b") e.principal = { id: "synthetic-other-principal", auditActorId: "synthetic-other-human" };
    const input = { Account: `synthetic-company-${company}`, Requested_Service_Area: "  East\r\nCounty  " };
    const time = "2026-10-11T12:00:00.000Z";
    const issuance = { requestId: "synthetic-native-response-request", issuedAt: time };
    const trusted = { environment: "development", organizationId: "synthetic-organization", observedAt: time,
      principal: e.principal, complete: e.complete, grants: e.grants, accountLinks: e.accountLinks, contactLinks: e.contactLinks };
    const policy = { expectedEnvironment: "development", expectedOrganizationId: "synthetic-organization", asOf: time, maxAgeMs: 60000 };
    const descriptors = [];
    const get = async (request) => {
      descriptors.push(request);
      return { state: "available", environment: "development", organizationId: "synthetic-organization",
        observedAt: time, module: request.module, recordId: request.recordId, complete: true,
        response: project(request.module, request.recordId, native(request.module, company)) };
    };
    assert.deepEqual(await produceServiceAreaRequest(input, trusted, issuance, policy, get),
      prepareOfflineRequestBinding(input, e, issuance));
    assert.deepEqual(descriptors.map((d) => [d.module, d.recordId]), [
      ["Contacts", `synthetic-crm-contact-${company}`], ["Accounts", `synthetic-crm-company-${company}`],
    ]);
    // The strict published producer still rejects unprojected native metadata.
    await assert.rejects(() => produceServiceAreaRequest(input, trusted, issuance, policy, async (request) => ({
      state: "available", environment: "development", organizationId: "synthetic-organization", observedAt: time,
      module: request.module, recordId: request.recordId, complete: true, response: native(request.module, company),
    })), TypeError);
  }
});

test("projection cannot bypass the producer's cross-company or server-provenance checks", async () => {
  const e = evidence();
  const input = { Account: "synthetic-company-a", Requested_Service_Area: "East" };
  const time = "2026-10-11T12:00:00.000Z";
  const trusted = { environment: "development", organizationId: "synthetic-organization", observedAt: time,
    principal: e.principal, complete: true, grants: e.grants, accountLinks: e.accountLinks, contactLinks: e.contactLinks };
  const issuance = { requestId: "synthetic-cross-company-response", issuedAt: time };
  const policy = { expectedEnvironment: "development", expectedOrganizationId: "synthetic-organization", asOf: time, maxAgeMs: 60000 };
  for (const defect of ["cross-company", "wrong-organization", "stale"]) {
    let calls = 0;
    await assert.rejects(() => produceServiceAreaRequest(input, trusted, issuance, policy, async (request) => {
      calls++;
      const body = native(request.module);
      if (defect === "cross-company") body.data[0].Account_Name.id = "synthetic-crm-company-b";
      return { state: "available", environment: "development",
        organizationId: defect === "wrong-organization" ? "synthetic-other-organization" : "synthetic-organization",
        observedAt: defect === "stale" ? "2026-10-11T11:58:00.000Z" : time,
        module: request.module, recordId: request.recordId, complete: true,
        response: project(request.module, request.recordId, body) };
    }), TypeError);
    assert.equal(calls, 1);
  }
});

test("native response projection denies unsupported targets errors partial and paginated bodies", () => {
  for (const module of ["Contacts", "Accounts"]) {
    const id = module === "Contacts" ? "synthetic-crm-contact-a" : "synthetic-crm-company-a";
    for (const mutate of [
      (r) => { delete r.data; }, (r) => { r.data = []; }, (r) => { r.data.push({ ...r.data[0] }); },
      (r) => { r.data = [ , r.data[0]]; }, (r) => { r.data.extra = true; },
      (r) => { r.info = { more_records: false }; }, (r) => { r.info = { more_records: true }; },
      (r) => { r.code = "synthetic-provider-error"; }, (r) => { r.data[0].id = "synthetic-other-record"; },
      (r) => { r.data[0].id = Number.MAX_SAFE_INTEGER + 1; },
      (r) => { delete r.data[0][module === "Contacts" ? "Account_Name" : "Primary_Service_Area"]; },
      (r) => { Object.setPrototypeOf(r.data[0], {}); }, (r) => { r.data[0][Symbol("extra")] = true; },
    ]) {
      const body = native(module); mutate(body);
      assert.throws(() => project(module, id, body), TypeError);
    }
  }
  for (const module of ["Deals", "contacts", null, {}]) assert.throws(() => project(module, "synthetic-record", native("Contacts")), TypeError);
  for (const id of [null, "", " padded ", Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => project("Contacts", id, native("Contacts")), TypeError);
});

test("native lookup and baseline validation preserve the existing text contract", () => {
  for (const lookup of [null, {}, { name: "synthetic-display-name" }, { id: 42 }, { id: "synthetic-account", name: null }, { id: "synthetic-account", other: true }]) {
    const body = native("Contacts"); body.data[0].Account_Name = lookup;
    assert.throws(() => project("Contacts", "synthetic-crm-contact-a", body), TypeError);
  }
  for (const baseline of [null, "", " \r\n\t", "bad\u0000area", "x".repeat(2001), 42]) {
    const body = native("Accounts"); body.data[0].Primary_Service_Area = baseline;
    assert.throws(() => project("Accounts", "synthetic-crm-company-a", body), TypeError);
  }
  const body = native("Accounts"); body.data[0].Primary_Service_Area = " \tNorth\r\nSouth\rEast\t ";
  assert.equal(project("Accounts", "synthetic-crm-company-a", body).data[0].Primary_Service_Area, body.data[0].Primary_Service_Area);
});

test("native string IDs preserve synthetic nineteen-digit precision without numeric coercion", () => {
  const id = "9".repeat(18) + "1";
  const accountId = "9".repeat(18) + "3";
  const body = native("Contacts"); body.data[0].id = id; body.data[0].Account_Name.id = accountId;
  assert.equal(project("Contacts", id, body).data[0].Account_Name.id, accountId);
  body.data[0].id = Number(id);
  assert.throws(() => project("Contacts", id, body), TypeError);
});

test("native data descriptors reject getters and iterators without execution, including unused fields", () => {
  for (const target of ["body", "array", "id", "lookup", "unused", "iterator"]) {
    const body = native("Contacts"); let calls = 0;
    const getter = { enumerable: true, get() { calls++; throw new Error("synthetic-private-getter"); } };
    if (target === "body") Object.defineProperty(body, "data", getter);
    if (target === "array") Object.defineProperty(body.data, "0", getter);
    if (target === "id") Object.defineProperty(body.data[0], "id", getter);
    if (target === "lookup") Object.defineProperty(body.data[0].Account_Name, "id", getter);
    if (target === "unused") Object.defineProperty(body.data[0], "Email", getter);
    if (target === "iterator") Object.defineProperty(body.data, Symbol.iterator, getter);
    assert.throws(() => project("Contacts", "synthetic-crm-contact-a", body),
      (error) => error instanceof TypeError && !String(error.stack).includes("synthetic-private") && !Object.hasOwn(error, "cause"));
    assert.equal(calls, 0);
  }
  const body = native("Accounts");
  Object.defineProperty(body.data[0], "Primary_Service_Area", { value: body.data[0].Primary_Service_Area, enumerable: false });
  assert.equal(project("Accounts", "synthetic-crm-company-a", body).data[0].Primary_Service_Area, "  North\r\nCounty  ");
});

test("projection executes with no transport writer logging environment or implicit clock capability", () => {
  const fs = require("node:fs"); const path = require("node:path"); const vm = require("node:vm");
  let calls = 0;
  const forbidden = () => { calls++; throw new Error("forbidden capability"); };
  const context = vm.createContext({ module: { exports: {} }, fetch: forbidden, console: { log: forbidden, error: forbidden },
    require(name) { if (name === "./service-area-request-contract") return require("../service-area-request-contract"); return forbidden(); } });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../crm-service-area-response.js"), "utf8"), context);
  vm.runInContext("Date.now = () => { throw new Error('clock forbidden'); };", context);
  const result = vm.runInContext(`module.exports.projectCrmServiceAreaResponse("Contacts", "synthetic-crm-contact-a", ${JSON.stringify(native("Contacts"))})`, context);
  assert.equal(result.data[0].Account_Name.id, "synthetic-crm-company-a");
  assert.equal(calls, 0);
});
