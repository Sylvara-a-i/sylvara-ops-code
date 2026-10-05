"use strict";

// Keep the offline identity prototype covered by the existing canonical/CI entrypoint.
require("./offline-identity-contract.test");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  validateRequestedServiceArea: validate,
  preparePendingServiceAreaRequest: prepare,
} = require("../service-area-request-contract");

function context() {
  return {
    principalId: "synthetic-principal",
    contact: { id: "synthetic-secondary-contact", accountId: "synthetic-crm-account" },
    companyMappings: [{ creatorAccountId: "synthetic-creator-account", crmAccountId: "synthetic-crm-account", active: true }],
    previousServiceArea: "  Before\r\narea\t ",
    auditActorId: "synthetic-human-actor",
  };
}
function input() {
  return { Account: "synthetic-creator-account", Requested_Service_Area: "  North\r\nSouth\rEast\tWest  " };
}

test("exact four fields, fixed pending status, secondary contact, exact baseline and no mutation", () => {
  const before = context();
  const submitted = input();
  const snapshots = structuredClone({ before, submitted });
  const result = prepare(submitted, before);
  assert.deepEqual(result, {
    Account: submitted.Account,
    Previous_Service_Area: before.previousServiceArea,
    Requested_Service_Area: "North\nSouth\nEast\tWest",
    Status: "Pending review",
  });
  assert.deepEqual(Object.keys(result), ["Account", "Previous_Service_Area", "Requested_Service_Area", "Status"]);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual({ before, submitted }, snapshots);
  assert.ok(!Object.isFrozen(before));
});

test("deny missing, ambiguous, inactive and cross-company mappings", () => {
  for (const mutate of [
    (c) => { c.companyMappings = []; },
    (c) => { c.companyMappings.push({ ...c.companyMappings[0] }); },
    (c) => { c.companyMappings[0].active = false; },
    (c) => { c.companyMappings[0].active = "true"; },
    (c) => { c.companyMappings[0].crmAccountId = "synthetic-other-company"; },
    (c) => { c.companyMappings[0].creatorAccountId = "synthetic-other-selector"; },
    (c) => { c.contact.accountId = "synthetic-other-company"; },
    (c) => { c.companyMappings = [null]; },
  ]) {
    const c = context();
    mutate(c);
    assert.throws(() => prepare(input(), c), TypeError);
  }
  assert.throws(() => prepare({ ...input(), Account: "synthetic-other-company" }, context()), TypeError);
});

test("deny unavailable baseline and missing attribution or principal", () => {
  for (const value of [undefined, null, "", " \t\r\n ", 42, {}, "bad\0area", "x".repeat(2001)]) {
    assert.throws(() => prepare(input(), { ...context(), previousServiceArea: value }), TypeError);
  }
  for (const key of ["principalId", "auditActorId", "contact", "companyMappings", "previousServiceArea"]) {
    const c = context();
    delete c[key];
    assert.throws(() => prepare(input(), c), TypeError);
  }
});

test("deny unsupported types, missing fields and all client overrides", () => {
  for (const value of [null, undefined, [], 1, true, "text", new Date()]) {
    assert.throws(() => prepare(value, context()), TypeError);
    assert.throws(() => prepare(input(), value), TypeError);
    if (typeof value !== "string") assert.throws(() => validate(value), TypeError);
  }
  for (const key of ["Previous_Service_Area", "Status", "actor", "auditActorId", "unknown", "constructor", "prototype", "__proto__"]) {
    const submitted = input();
    Object.defineProperty(submitted, key, { value: "override", enumerable: true });
    assert.throws(() => prepare(submitted, context()), TypeError);
  }
  for (const key of Object.keys(input())) {
    const submitted = input();
    delete submitted[key];
    assert.throws(() => prepare(submitted, context()), TypeError);
    for (const value of [null, undefined, 1, true, [], {}]) {
      assert.throws(() => prepare({ ...input(), [key]: value }, context()), TypeError);
    }
  }
});

test("deny inherited, symbol and accessor keys without executing getters", () => {
  assert.throws(() => prepare(Object.create(input()), context()), TypeError);
  assert.throws(() => prepare({ ...input(), [Symbol("hidden")]: true }, context()), TypeError);
  let calls = 0;
  const submitted = input();
  Object.defineProperty(submitted, "Account", { get() { calls++; return "selector"; } });
  assert.throws(() => prepare(submitted, context()), TypeError);
  const c = context();
  Object.defineProperty(c.contact, "accountId", { get() { calls++; return "account"; } });
  assert.throws(() => prepare(input(), c), TypeError);
  assert.equal(calls, 0);
  assert.doesNotThrow(() => prepare(Object.assign(Object.create(null), input()), context()));
});

test("2000/2001 code points for ASCII, emoji and mixed text; never truncate", () => {
  for (const unit of ["x", "😀"]) {
    assert.equal(validate(unit.repeat(2000)), unit.repeat(2000));
    assert.throws(() => validate(unit.repeat(2001)), TypeError);
  }
  const mixed = "x".repeat(1000) + "😀".repeat(1000);
  assert.equal(validate(mixed), mixed);
  assert.throws(() => validate(mixed + "x"), TypeError);
});

test("Form2 normalizeText source parity, including trim before control validation", () => {
  const sourcePath = path.resolve(__dirname, "../../../../zoho-catalyst/revenue-leak-test-setup-form/functions/revenue_leak_test_setup_form/lib/form-contract.js");
  const source = fs.readFileSync(sourcePath, "utf8");
  const start = source.indexOf("function normalizeText(");
  const end = source.indexOf("\nfunction normalizeEmail(", start);
  assert.ok(start >= 0 && end > start);
  const normalizeText = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
    hasOwn: (o, k) => Object.hasOwn(o, k),
    fail: () => { throw new TypeError("invalid"); },
  });
  const values = [null, undefined, 1, [], {}, "", " \t\r\n ", " a\r\nb\rc\td ", "\v trimmed \f", "x".repeat(2000), "x".repeat(2001), "😀".repeat(2000), "😀".repeat(2001)];
  for (let code = 0; code <= 31; code++) values.push(`a${String.fromCharCode(code)}b`);
  values.push("a\u007fb");
  for (const value of values) {
    let expected;
    try { expected = normalizeText({ value }, "value", { required: true, maximum: 2000, multiline: true }); }
    catch { assert.throws(() => validate(value), TypeError); continue; }
    assert.equal(validate(value), expected);
  }
});

test("module import and preparation have zero transport or writer capabilities", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../service-area-request-contract.js"), "utf8");
  let calls = 0;
  const forbidden = () => { calls++; throw new Error("side effect"); };
  const sandbox = { module: { exports: {} }, require: forbidden, fetch: forbidden, console: { log: forbidden }, XMLHttpRequest: forbidden };
  vm.runInNewContext(source, sandbox);
  // Create inputs in the same realm so the plain-object guard applies normally.
  vm.runInNewContext(`module.exports.preparePendingServiceAreaRequest(${JSON.stringify(input())}, ${JSON.stringify(context())})`, sandbox);
  assert.equal(calls, 0);
});
