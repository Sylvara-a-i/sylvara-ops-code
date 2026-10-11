"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evidence } = require("./fixtures/two-company-identity");
const { prepareOfflineRequestBinding } = require("../offline-identity-contract");
const { produceServiceAreaRequest: produce } = require("../service-area-request-producer");

const observedAt = "2026-10-11T12:00:00.000Z";
const asOf = "2026-10-11T12:00:30.000Z";

function fixture(company = "a") {
  const e = evidence();
  if (company === "b") e.principal = { id: "synthetic-other-principal", auditActorId: "synthetic-other-human" };
  return {
    input: { Account: `synthetic-company-${company}`, Requested_Service_Area: "  East\r\nCounty  " },
    trusted: {
      environment: "development", organizationId: "synthetic-organization", observedAt,
      complete: true, principal: e.principal, grants: e.grants,
      accountLinks: e.accountLinks, contactLinks: e.contactLinks,
    },
    issuance: { requestId: "synthetic-producer-request", issuedAt: asOf },
    policy: { expectedEnvironment: "development", expectedOrganizationId: "synthetic-organization", asOf, maxAgeMs: 60000 },
    e,
  };
}

function receipt(f, module) {
  const grant = f.e.grants.find((row) => row.principalId === f.e.principal.id && row.creatorAccountId === f.input.Account);
  const accountLink = f.e.accountLinks.find((row) => row.creatorAccountId === f.input.Account);
  const contactLink = f.e.contactLinks.find((row) => row.creatorContactId === grant.creatorContactId);
  const contact = f.e.crmContacts.find((row) => row.id === contactLink.crmContactId);
  const account = f.e.crmAccounts.find((row) => row.id === accountLink.crmAccountId);
  const record = module === "Contacts"
    ? { id: contact.id, Account_Name: { id: contact.accountId, name: "Synthetic display name is not identity" } }
    : { id: account.id, Primary_Service_Area: account.previousServiceArea };
  return {
    state: "available", environment: f.trusted.environment, organizationId: f.trusted.organizationId,
    observedAt, module, recordId: record.id, complete: true, response: { data: [record] },
  };
}

function reader(f, transform = () => {}) {
  const calls = [];
  const replies = { Contacts: receipt(f, "Contacts"), Accounts: receipt(f, "Accounts") };
  return {
    calls,
    replies,
    async get(descriptor) {
      calls.push(descriptor);
      const response = structuredClone(replies[descriptor.module]);
      transform(response, descriptor);
      return response;
    },
  };
}

function run(f, get) {
  return produce(f.input, f.trusted, f.issuance, f.policy, get);
}

test("producer reads exact mapped records for each independent company and preserves the existing envelope", async () => {
  for (const company of ["a", "b"]) {
    const f = fixture(company);
    const before = structuredClone(f);
    const transport = reader(f);
    const prepared = await run(f, transport.get);
    assert.deepEqual(prepared, prepareOfflineRequestBinding(f.input, f.e, f.issuance));
    assert.deepEqual(transport.calls, [
      { method: "GET", module: "Contacts", recordId: `synthetic-crm-contact-${company}`, fields: ["id", "Account_Name"], environment: "development", organizationId: "synthetic-organization" },
      { method: "GET", module: "Accounts", recordId: `synthetic-crm-company-${company}`, fields: ["id", "Primary_Service_Area"], environment: "development", organizationId: "synthetic-organization" },
    ]);
    for (const descriptor of transport.calls) {
      assert.ok(Object.isFrozen(descriptor));
      assert.ok(Object.isFrozen(descriptor.fields));
    }
    assert.equal(prepared.request.Previous_Service_Area, company === "a" ? "  North\r\nCounty  " : "  South\r\nCounty  ");
    assert.equal(prepared.request.Requested_Service_Area, "East\nCounty");
    assert.deepEqual(f, before);
    for (const value of [prepared, prepared.request, prepared.attribution, prepared.binding]) assert.ok(Object.isFrozen(value));
  }
});

test("untrusted input cannot override protected values and forged company selectors cause zero GETs", async () => {
  const mutations = [
    (f) => { f.input.Account = "synthetic-company-b"; },
    (f) => { delete f.input.Account; },
    (f) => { delete f.input.Requested_Service_Area; },
    (f) => { f.input.Requested_Service_Area = " \r\n\t "; },
    ...["principal", "grants", "accountLinks", "crmAccountId", "Previous_Service_Area", "Status", "auditActorId", "requestId", "issuedAt"].map((key) => (f) => { f.input[key] = "synthetic-override"; }),
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    let calls = 0;
    await assert.rejects(() => run(f, async () => { calls++; throw new Error("unexpected GET"); }), TypeError);
    assert.equal(calls, 0);
  }
});

test("missing ambiguous inactive revoked or cross-company protected joins deny before any GET", async () => {
  const mutations = [
    (f) => { f.trusted.complete = false; },
    (f) => { f.trusted.principal.id = "synthetic-ungranted-principal"; },
    (f) => { f.trusted.grants[0].active = false; },
    (f) => { f.trusted.grants[0].scope = "Administrator"; },
    (f) => { f.trusted.contactLinks[0].creatorAccountId = "synthetic-company-b"; },
    (f) => { f.trusted.accountLinks.push({ ...f.trusted.accountLinks[0], creatorAccountId: "synthetic-third-company" }); },
    (f) => { f.trusted.contactLinks.push({ ...f.trusted.contactLinks[0], creatorContactId: "synthetic-third-contact" }); },
    ...["grants", "accountLinks", "contactLinks"].flatMap((key) => [
      (f) => { f.trusted[key] = f.trusted[key].slice(1); },
      (f) => { f.trusted[key].push({ ...f.trusted[key][0] }); },
    ]),
    (f) => { f.trusted.grants.push({ ...f.trusted.grants[0], active: false }); },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    let calls = 0;
    await assert.rejects(() => run(f, async () => { calls++; throw new Error("unexpected GET"); }), TypeError);
    assert.equal(calls, 0);
  }
});

test("wrong tenant unknown target stale future or malformed protected evidence denies before GET", async () => {
  for (const mutate of [
    (f) => { f.trusted.environment = "Production"; },
    (f) => { f.trusted.organizationId = "synthetic-other-organization"; },
    (f) => { delete f.trusted.organizationId; },
    (f) => { f.trusted.observedAt = "2026-10-11T11:59:29.999Z"; },
    (f) => { f.trusted.observedAt = "2026-10-11T12:00:30.001Z"; },
    (f) => { f.trusted.observedAt = "invalid-timestamp"; },
    (f) => { f.policy.asOf = "invalid-timestamp"; },
    (f) => { f.policy.maxAgeMs = -1; },
    (f) => { f.policy.maxAgeMs = Infinity; },
    (f) => { f.policy.maxAgeMs = "60000"; },
    (f) => { f.issuance.requestId = ""; },
    (f) => { f.issuance.issuedAt = "invalid-timestamp"; },
  ]) {
    const f = fixture();
    mutate(f);
    let calls = 0;
    await assert.rejects(() => run(f, async () => { calls++; throw new Error("unexpected GET"); }), TypeError);
    assert.equal(calls, 0);
  }
});

test("GET receipts must bind the expected target module exact record freshness and completeness", async () => {
  for (const module of ["Contacts", "Accounts"]) {
    for (const mutate of [
      (r) => { r.state = "unavailable"; },
      (r) => { r.environment = "Production"; },
      (r) => { r.organizationId = "synthetic-other-organization"; },
      (r) => { r.module = "Deals"; },
      (r) => { r.recordId = "synthetic-other-record"; },
      (r) => { r.complete = false; },
      (r) => { delete r.complete; },
      (r) => { r.observedAt = "2026-10-11T11:59:29.999Z"; },
      (r) => { r.observedAt = "2026-10-11T12:00:30.001Z"; },
      (r) => { r.observedAt = "invalid-timestamp"; },
      (r) => { r.response = null; },
    ]) {
      const f = fixture();
      const transport = reader(f, (r, descriptor) => { if (descriptor.module === module) mutate(r); });
      await assert.rejects(() => run(f, transport.get), TypeError);
      assert.equal(transport.calls.length, module === "Contacts" ? 1 : 2);
    }
  }
});

test("raw exact-ID responses reject missing ambiguous paginated or non-data record arrays", async () => {
  for (const module of ["Contacts", "Accounts"]) {
    for (const mutate of [
      (r) => { delete r.response.data; },
      (r) => { r.response.data = []; },
      (r) => { r.response.data.push({ ...r.response.data[0] }); },
      (r) => { r.response.data = r.response.data[0]; },
      (r) => { r.response.info = { more_records: false }; },
      (r) => { r.response.info = { more_records: true, next_page_token: "synthetic-next-page" }; },
      (r) => { r.response.data = [ , r.response.data[0]]; },
      (r) => { r.response.data.extra = "unexpected"; },
      (r) => { Object.setPrototypeOf(r.response.data, null); },
      (r) => { r.response.data[0].id = "synthetic-other-record"; },
      (r) => { r.response.data[0].id = Number.MAX_SAFE_INTEGER + 1; },
    ]) {
      const f = fixture();
      const transport = reader(f, (r, descriptor) => { if (descriptor.module === module) mutate(r); });
      await assert.rejects(() => run(f, transport.get), TypeError);
      assert.equal(transport.calls.length, module === "Contacts" ? 1 : 2);
    }
  }
});

test("Contact relationship uses its exact Account_Name.id and never the display name", async () => {
  for (const lookup of [null, {}, { name: "synthetic-crm-company-a" }, { id: "synthetic-crm-company-b" }, { id: Number.MAX_SAFE_INTEGER + 1 }]) {
    const f = fixture();
    const transport = reader(f, (r, descriptor) => { if (descriptor.module === "Contacts") r.response.data[0].Account_Name = lookup; });
    await assert.rejects(() => run(f, transport.get), TypeError);
    assert.equal(transport.calls.length, 1);
  }
  const f = fixture();
  const transport = reader(f, (r, descriptor) => { if (descriptor.module === "Contacts") delete r.response.data[0].Account_Name.name; });
  assert.equal((await run(f, transport.get)).attribution.crmAccountId, "synthetic-crm-company-a");
});

test("Accounts service area must be present valid text without fallback or normalization", async () => {
  for (const previous of [undefined, null, "", " \t\r\n ", 42, {}, "bad\u0000area", "x".repeat(2001)]) {
    const f = fixture();
    const transport = reader(f, (r, descriptor) => {
      if (descriptor.module === "Accounts") {
        if (previous === undefined) delete r.response.data[0].Primary_Service_Area;
        else r.response.data[0].Primary_Service_Area = previous;
      }
    });
    await assert.rejects(() => run(f, transport.get), TypeError);
    assert.equal(transport.calls.length, 2);
  }
  const f = fixture();
  const exact = " \tNorth\r\nSouth\rEast\t ";
  const transport = reader(f, (r, descriptor) => { if (descriptor.module === "Accounts") r.response.data[0].Primary_Service_Area = exact; });
  assert.equal((await run(f, transport.get)).request.Previous_Service_Area, exact);
});

test("numeric string CRM IDs retain exact digits beyond JavaScript numeric precision", async () => {
  // Generate synthetic precision fixtures without production-identifier-like literals.
  const large = BigInt(Number.MAX_SAFE_INTEGER);
  const nineteenDigits = "9".repeat(18);
  for (const [contactId, accountId, otherAccountId] of [
    [String(large + 2n), String(large + 4n), String(large + 3n)],
    [nineteenDigits + "1", nineteenDigits + "3", nineteenDigits + "2"],
  ]) {
    const f = fixture();
    f.e.contactLinks[0].crmContactId = f.e.crmContacts[0].id = contactId;
    f.e.accountLinks[0].crmAccountId = f.e.crmContacts[0].accountId = f.e.crmAccounts[0].id = accountId;
    const transport = reader(f);
    const prepared = await run(f, transport.get);
    assert.deepEqual(transport.calls.map((call) => call.recordId), [contactId, accountId]);
    assert.equal(prepared.attribution.crmContactId, contactId);
    assert.equal(prepared.attribution.crmAccountId, accountId);
    const wrongId = reader(f, (r, descriptor) => { if (descriptor.module === "Accounts") r.response.data[0].id = otherAccountId; });
    await assert.rejects(() => run(f, wrongId.get), TypeError);
    const roundedNumber = reader(f, (r, descriptor) => { if (descriptor.module === "Accounts") r.response.data[0].id = Number(accountId); });
    await assert.rejects(() => run(f, roundedNumber.get), TypeError);
  }
});

test("requested emoji uses the existing 2000-code-point boundary before GET", async () => {
  const f = fixture();
  f.input.Requested_Service_Area = "\u{1f333}".repeat(2000);
  const transport = reader(f);
  assert.equal((await run(f, transport.get)).request.Requested_Service_Area, f.input.Requested_Service_Area);
  assert.equal(transport.calls.length, 2);
  f.input.Requested_Service_Area += "\u{1f333}";
  let calls = 0;
  await assert.rejects(() => run(f, async () => { calls++; throw new Error("unexpected GET"); }), TypeError);
  assert.equal(calls, 0);
});

test("sparse custom-iterator and extra-property protected arrays deny without execution or GET", async () => {
  for (const key of ["grants", "accountLinks", "contactLinks"]) {
    for (const shape of ["sparse", "iterator", "extra"]) {
      const f = fixture();
      let calls = 0;
      let iteratorCalls = 0;
      if (shape === "sparse") delete f.trusted[key][0];
      if (shape === "iterator") f.trusted[key][Symbol.iterator] = function* () { iteratorCalls++; };
      if (shape === "extra") f.trusted[key].extra = "synthetic-extra";
      await assert.rejects(() => run(f, async () => { calls++; throw new Error("unexpected GET"); }), TypeError);
      assert.equal(calls, 0, `${key}: ${shape}`);
      assert.equal(iteratorCalls, 0, `${key}: ${shape}`);
    }
  }
});

test("protected data and request accessors reject without execution before any GET", async () => {
  for (const target of ["input", "trusted", "principal", "grant", "grant-array", "policy", "issuance"]) {
    const f = fixture();
    let accesses = 0;
    let gets = 0;
    const accessor = { enumerable: true, get() { accesses++; throw new Error("private accessor executed"); } };
    if (target === "input") Object.defineProperty(f.input, "Account", accessor);
    if (target === "trusted") Object.defineProperty(f.trusted, "principal", accessor);
    if (target === "principal") Object.defineProperty(f.trusted.principal, "id", accessor);
    if (target === "grant") Object.defineProperty(f.trusted.grants[0], "active", accessor);
    if (target === "grant-array") Object.defineProperty(f.trusted.grants, "0", accessor);
    if (target === "policy") Object.defineProperty(f.policy, "asOf", accessor);
    if (target === "issuance") Object.defineProperty(f.issuance, "requestId", accessor);
    await assert.rejects(() => run(f, async () => { gets++; }), TypeError);
    assert.equal(accesses, 0, target);
    assert.equal(gets, 0, target);
  }
});

test("receipt nested record and custom iterator accessors reject without execution", async () => {
  for (const target of ["receipt", "response", "array", "record", "lookup", "iterator"]) {
    const f = fixture();
    let accesses = 0;
    const transport = reader(f, (r, descriptor) => {
      if (descriptor.module !== "Contacts") return;
      const accessor = { enumerable: true, get() { accesses++; throw new Error("private response accessor executed"); } };
      if (target === "receipt") Object.defineProperty(r, "response", accessor);
      if (target === "response") Object.defineProperty(r.response, "data", accessor);
      if (target === "array") Object.defineProperty(r.response.data, "0", accessor);
      if (target === "record") Object.defineProperty(r.response.data[0], "Account_Name", accessor);
      if (target === "lookup") Object.defineProperty(r.response.data[0].Account_Name, "id", accessor);
      if (target === "iterator") Object.defineProperty(r.response.data, Symbol.iterator, accessor);
    });
    await assert.rejects(() => run(f, transport.get), TypeError);
    assert.equal(accesses, 0, target);
    assert.equal(transport.calls.length, 1, target);
  }
});

test("nonenumerable own data remains available to validated snapshots", async () => {
  const f = fixture();
  for (const [object, key] of [[f.input, "Requested_Service_Area"], [f.trusted, "principal"], [f.trusted.principal, "id"], [f.trusted.grants[0], "active"], [f.issuance, "requestId"], [f.policy, "asOf"]]) {
    Object.defineProperty(object, key, { value: object[key], enumerable: false, writable: true, configurable: true });
  }
  const expected = prepareOfflineRequestBinding(f.input, f.e, f.issuance);
  const transport = reader(f, (r) => {
    Object.defineProperty(r.response, "data", { value: r.response.data, enumerable: false });
    Object.defineProperty(r.response.data[0], "id", { value: r.response.data[0].id, enumerable: false });
  });
  assert.deepEqual(await run(f, transport.get), expected);
});

test("mutating caller-owned inputs during GET cannot splice another company or issuance into output", async () => {
  const f = fixture();
  const expected = prepareOfflineRequestBinding(f.input, f.e, f.issuance);
  const replies = { Contacts: receipt(f, "Contacts"), Accounts: receipt(f, "Accounts") };
  const calls = [];
  let releaseContact;
  let notifyContactStarted;
  const contactPending = new Promise((resolve) => { releaseContact = resolve; });
  const contactStarted = new Promise((resolve) => { notifyContactStarted = resolve; });
  const pending = run(f, async (descriptor) => {
    calls.push(descriptor);
    if (descriptor.module === "Contacts") {
      notifyContactStarted();
      return contactPending;
    }
    return replies.Accounts;
  });
  await Promise.race([contactStarted, pending]);
  assert.equal(calls.length, 1);
  f.input.Account = "synthetic-company-b";
  f.input.Requested_Service_Area = "Injected area";
  f.trusted.principal.id = "synthetic-other-principal";
  f.trusted.principal.auditActorId = "synthetic-other-human";
  f.trusted.grants[0].active = false;
  f.trusted.grants[0].revision = "grant-v2";
  f.trusted.accountLinks[0].crmAccountId = "synthetic-crm-company-b";
  f.trusted.contactLinks[0].crmContactId = "synthetic-crm-contact-b";
  f.trusted.organizationId = "synthetic-other-organization";
  f.policy.expectedOrganizationId = "synthetic-other-organization";
  f.policy.asOf = "2027-10-11T12:00:30.000Z";
  f.issuance.requestId = "synthetic-replacement-request";
  f.issuance.issuedAt = "2027-10-11T12:00:30.000Z";
  releaseContact(replies.Contacts);
  assert.deepEqual(await pending, expected);
  assert.equal(calls[1].recordId, "synthetic-crm-company-a");
  assert.equal(calls[1].organizationId, "synthetic-organization");
  // Caller-object mutation is not a fresh revocation authority; live revalidation remains external.
});

test("mutating the already-read Contact receipt during Accounts GET cannot change captured identity", async () => {
  const f = fixture();
  const expected = prepareOfflineRequestBinding(f.input, f.e, f.issuance);
  const contact = receipt(f, "Contacts");
  const account = receipt(f, "Accounts");
  const prepared = await run(f, async (descriptor) => {
    if (descriptor.module === "Contacts") return contact;
    contact.response.data[0].id = "synthetic-crm-contact-b";
    contact.response.data[0].Account_Name.id = "synthetic-crm-company-b";
    contact.organizationId = "synthetic-other-organization";
    return account;
  });
  assert.deepEqual(prepared, expected);
  account.response.data[0].Primary_Service_Area = "Changed after return";
  assert.equal(prepared.request.Previous_Service_Area, "  North\r\nCounty  ");
});

test("transport failures and timeouts reject without retries or private error disclosure", async () => {
  for (const module of ["Contacts", "Accounts"]) {
    for (const cause of [new Error("synthetic-private-token-and-payload"), Object.assign(new Error("synthetic-private-timeout"), { code: "ETIMEDOUT" })]) {
      const f = fixture();
      const contact = receipt(f, "Contacts");
      const calls = [];
      await assert.rejects(() => run(f, async (descriptor) => {
        calls.push(descriptor);
        if (descriptor.module === module) throw cause;
        return contact;
      }), (error) => error instanceof TypeError && !String(error.stack).includes("synthetic-private") && !Object.hasOwn(error, "cause"));
      assert.equal(calls.length, module === "Contacts" ? 1 : 2);
      assert.ok(calls.every((call) => call.method === "GET"));
    }
  }
});

test("producer has no ambient transport writer persistence logging or clock side effects", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const f = fixture();
  const replies = { Contacts: receipt(f, "Contacts"), Accounts: receipt(f, "Accounts") };
  let forbiddenCalls = 0;
  const forbidden = () => { forbiddenCalls++; throw new Error("forbidden side effect"); };
  const modules = {};
  const sandbox = vm.createContext({
    module: { exports: {} }, fetch: forbidden,
    console: { log: forbidden, warn: forbidden, error: forbidden },
    require(name) {
      if (name === "node:crypto") return require("node:crypto");
      if (Object.hasOwn(modules, name)) return modules[name];
      return forbidden();
    },
  });
  for (const name of ["service-area-request-contract", "offline-identity-contract", "service-area-request-producer"]) {
    sandbox.module = { exports: {} };
    vm.runInContext(`(function () { ${fs.readFileSync(path.resolve(__dirname, `../${name}.js`), "utf8")} })()`, sandbox);
    modules[`./${name}`] = sandbox.module.exports;
  }
  vm.runInContext("Date.now = () => { throw new Error('clock forbidden'); };", sandbox);
  const output = await vm.runInContext(`
    const calls = [];
    const replies = ${JSON.stringify(replies)};
    module.exports.produceServiceAreaRequest(
      ${JSON.stringify(f.input)}, ${JSON.stringify(f.trusted)},
      ${JSON.stringify(f.issuance)}, ${JSON.stringify(f.policy)},
      async (descriptor) => {
        calls.push(descriptor);
        if (descriptor.method !== "GET" || !Object.hasOwn(replies, descriptor.module)) throw new Error("unexpected capability");
        return replies[descriptor.module];
      });
  `, sandbox);
  assert.equal(output.request.Previous_Service_Area, "  North\r\nCounty  ");
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(calls.map((call) => [call.method, call.module]))", sandbox)), [["GET", "Contacts"], ["GET", "Accounts"]]);
  assert.equal(forbiddenCalls, 0);
});
