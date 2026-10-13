"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evidence } = require("./fixtures/two-company-identity");
const { prepareOfflineRequestBinding } = require("../offline-identity-contract");
const { produceTimedServiceAreaRequest: produce } = require("../service-area-request-producer");

function fixture(company = "a") {
  const e = evidence();
  if (company === "b") e.principal = { id: "synthetic-other-principal", auditActorId: "synthetic-other-human" };
  const start = Date.parse("2026-10-11T12:00:00.000Z");
  const f = {
    e, start, time: start, reads: [], authorizations: 0,
    input: { Account: `synthetic-company-${company}`, Requested_Service_Area: " East\r\nCounty " },
    policy: { protocol: "timed-read-v2", expectedEnvironment: "development",
      expectedOrganizationId: "synthetic-organization", maxAgeMs: 1000, maxDurationMs: 10000 },
  };
  f.services = {
    now: () => new Date(f.time).toISOString(),
    async readAuthorization() {
      f.authorizations++;
      f.time += 10;
      f.onAuthorization?.();
      return { environment: "development", organizationId: "synthetic-organization",
        observedAt: f.services.now(), complete: true, principal: structuredClone(e.principal),
        grants: structuredClone(e.grants), accountLinks: structuredClone(e.accountLinks),
        contactLinks: structuredClone(e.contactLinks) };
    },
    async get(d) {
      f.reads.push(d);
      f.time += 100;
      const row = d.module === "Contacts"
        ? { id: `synthetic-crm-contact-${company}`, Account_Name: { id: `synthetic-crm-company-${company}` } }
        : { id: `synthetic-crm-company-${company}`, Primary_Service_Area: e.crmAccounts[company === "a" ? 0 : 1].previousServiceArea };
      const receipt = { state: "available", environment: "development", organizationId: "synthetic-organization",
        observedAt: f.services.now(), module: d.module, recordId: d.recordId, complete: true, response: { data: [row] } };
      f.onRead?.(receipt, d);
      return receipt;
    },
  };
  f.run = () => produce(f.input, "synthetic-timed-request", f.policy, f.services);
  return f;
}

test("v2 accepts genuine later completion times for both companies and preserves v1 binding serialization", async () => {
  for (const company of ["a", "b"]) {
    const f = fixture(company);
    const prepared = await f.run();
    assert.deepEqual(prepared, prepareOfflineRequestBinding(f.input, f.e,
      { requestId: "synthetic-timed-request", issuedAt: new Date(f.start).toISOString() }));
    assert.equal(f.authorizations, 3);
    assert.deepEqual(f.reads.map(d => d.module), ["Contacts", "Accounts"]);
    assert.equal(prepared.request.Previous_Service_Area, f.e.crmAccounts[company === "a" ? 0 : 1].previousServiceArea);
    for (const d of f.reads) {
      assert.ok(Object.isFrozen(d));
      assert.equal(d.protocol, "timed-read-v2");
      assert.equal(d.requestStartedAt, prepared.issuedAt);
      assert.equal(d.deadlineAt, new Date(f.start + f.policy.maxDurationMs).toISOString());
    }
  }
});

test("revocation after Contact or Account prevents later read or prepared response", async () => {
  for (const module of ["Contacts", "Accounts"]) {
    const f = fixture();
    f.onRead = (_, d) => { if (d.module === module) f.e.grants[0].active = false; };
    await assert.rejects(f.run, /Invalid service-area read evidence/);
    assert.equal(f.reads.length, module === "Contacts" ? 1 : 2);
  }
});

test("final authorization denies changed principal actor tenant mappings and grant/link revisions", async () => {
  for (const mutate of [
    f => { f.e.principal.id = "synthetic-other-principal"; },
    f => { f.e.principal.auditActorId = "synthetic-other-human"; },
    f => { f.e.accountLinks[0].crmAccountId = "synthetic-other-company"; },
    f => { f.e.contactLinks[0].crmContactId = "synthetic-other-contact"; },
    f => { f.e.grants[0].revision = "grant-v2-a"; },
    f => { f.e.accountLinks[0].revision = "link-v2-a"; },
    f => { f.e.contactLinks[0].revision = "link-v2-a"; },
  ]) {
    const f = fixture();
    f.onAuthorization = () => { if (f.authorizations === 3) mutate(f); };
    await assert.rejects(f.run, TypeError);
  }
});

test("read observations must lie within their actual read interval, not merely request bounds", async () => {
  for (const module of ["Contacts", "Accounts"]) {
    for (const offset of [-101, 1]) {
      const f = fixture();
      f.onRead = (r, d) => { if (d.module === module) r.observedAt = new Date(f.time + offset).toISOString(); };
      await assert.rejects(f.run, TypeError);
      assert.equal(f.reads.length, module === "Contacts" ? 1 : 2);
    }
  }
});

test("final server time rejects stale earlier reads and deadline expiry including exact boundary", async () => {
  for (const stage of ["Contacts", "Accounts", "finalAuthorization"]) {
    const f = fixture();
    f.onRead = (_, d) => { if (d.module === stage) f.time = f.start + f.policy.maxDurationMs; };
    f.onAuthorization = () => { if (stage === "finalAuthorization" && f.authorizations === 3) f.time = f.start + f.policy.maxDurationMs; };
    await assert.rejects(f.run, TypeError);
  }
  const f = fixture();
  f.onAuthorization = () => { if (f.authorizations === 3) f.time += f.policy.maxAgeMs; };
  await assert.rejects(f.run, TypeError);
});

test("clock regression during either read or final recheck fails closed", async () => {
  for (const stage of ["Contacts", "Accounts", "finalAuthorization"]) {
    const f = fixture();
    f.onRead = (_, d) => { if (d.module === stage) f.time -= 101; };
    f.onAuthorization = () => { if (stage === "finalAuthorization" && f.authorizations === 3) f.time -= 11; };
    await assert.rejects(f.run, TypeError);
  }
});

test("fresh authorization cannot use old cached or future observation timestamps", async () => {
  for (const offset of [-11, 1]) {
    const f = fixture();
    const authorize = f.services.readAuthorization;
    f.services.readAuthorization = async () => {
      const r = await authorize();
      r.observedAt = new Date(f.time + offset).toISOString();
      return r;
    };
    await assert.rejects(f.run, TypeError);
    assert.equal(f.reads.length, 0);
  }
});

test("uncooperative authorization and transport waits are bounded and late results cannot resume reads", async () => {
  for (const blocked of ["readAuthorization", "get"]) {
    const f = fixture();
    f.policy.maxDurationMs = 30;
    // Keep trusted wall time fixed; real elapsed deadline still bounds a hung dependency.
    f.services.now = () => new Date(f.start).toISOString();
    let release;
    const original = f.services[blocked];
    f.services[blocked] = (...args) => new Promise(resolve => { release = async () => resolve(await original(...args)); });
    await assert.rejects(f.run, TypeError);
    const before = f.reads.length;
    await release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.reads.length, before + (blocked === "get" ? 1 : 0));
    assert.ok(!f.reads.some(d => d.module === "Accounts"));
  }
});

test("caller timestamps protocol confusion forged selectors and extra fields fail before GET", async () => {
  for (const mutate of [
    f => { f.input.observedAt = "2026-10-11T12:00:00.000Z"; },
    f => { f.input.issuedAt = "2026-10-11T12:00:00.000Z"; },
    f => { f.policy.asOf = "2026-10-11T12:00:00.000Z"; },
    f => { f.policy.protocol = "timed-read-v1"; },
    f => { f.policy.maxDurationMs = Infinity; },
    f => { f.input.Account = "synthetic-company-b"; },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.run, TypeError);
    assert.equal(f.reads.length, 0);
  }
});

test("exported producer rechecks queued deadline clock regression and stale evidence after the race await", async () => {
  for (const mutate of [
    f => { f.time = f.start + f.policy.maxDurationMs; },
    f => { f.time--; },
    f => { f.time += f.policy.maxAgeMs; },
  ]) {
    const f = fixture();
    let clockCalls = 0;
    const now = f.services.now;
    // Receipt builders also call now; detect the synchronous preparation check
    // using completed authorization count, then queue after its sampled value.
    f.services.now = () => {
      const value = now();
      if (f.authorizations === 3 && ++clockCalls === 3) queueMicrotask(() => mutate(f));
      return value;
    };
    await assert.rejects(f.run, TypeError);
    assert.equal(f.reads.length, 2);
  }
});

test("elapsed deadline includes microtask work between internal preparation and exported return", async () => {
  const f = fixture();
  f.policy.maxDurationMs = 100;
  let finalClockCalls = 0;
  f.services.now = () => {
    if (f.authorizations === 3 && ++finalClockCalls === 3) {
      queueMicrotask(() => {
        const until = performance.now() + 150;
        while (performance.now() < until) { /* Synthetic blocked event-loop window. */ }
      });
    }
    return new Date(f.start).toISOString();
  };
  await assert.rejects(f.run, TypeError);
  assert.equal(f.reads.length, 2);
});
