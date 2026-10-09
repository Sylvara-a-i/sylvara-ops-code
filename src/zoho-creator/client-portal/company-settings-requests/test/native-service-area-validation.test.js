"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { validateRequestedServiceArea: validate } = require("../service-area-request-contract");
const { cases, readTransformation, makeNativeProbe, checkLocalParity } = require("../native/build-native-fixtures");

test("native requested-text fixture intentions match the existing source oracle", () => {
  assert.deepEqual(checkLocalParity(), { fixtureCount: 170, bmpCodeUnitsChecked: 65536 });
  assert.equal(new Set(cases.map((fixture) => fixture.id)).size, 170);
});

test("generated pure Tryout program reproduces the exact successful native evidence", () => {
  const probe = makeNativeProbe();
  assert.equal(crypto.createHash("sha256").update(probe).digest("hex"),
    "7d25ea4c343d219f9d9d14bc9f177c716d06630cb17a0bf5e19482b313e30367");
  assert.equal(probe.includes("input."), false);
  assert.equal((probe.match(/fixtures\.add\(/g) || []).length, 170);
});

test("strict end anchor preserves final NEL and prevents control and size bypasses", () => {
  const { normalize } = readTransformation();
  assert.ok(normalize.includes('ws + "+" + bs + "z"'));
  assert.ok(!normalize.includes('+$'));
  assert.equal(validate("x \u0085"), "x \u0085");
  assert.throws(() => validate("x\v\u0085"), TypeError);
  assert.throws(() => validate("x".repeat(1999) + " \u0085"), TypeError);
  assert.deepEqual(cases.filter((fixture) => fixture.id.includes("final_nel")).map((fixture) => fixture.valid), [true, false, false]);
});

test("native wrapper remains requested-text-only and assigns only after validation", () => {
  const { source } = readTransformation();
  const body = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.deepEqual([...new Set(body.match(/input\.[A-Za-z_]+/g))], ["input.Requested_Service_Area"]);
  assert.equal((body.match(/input\.Requested_Service_Area\s*=/g) || []).length, 2); // null comparison plus one assignment
  assert.equal((body.match(/input\.Requested_Service_Area = normalized;/g) || []).length, 1);
  assert.ok(body.indexOf("input.Requested_Service_Area = normalized;") > body.indexOf("if(!valid)"));
  assert.equal((body.match(/cancel submit;/g) || []).length, 2);
  assert.doesNotMatch(body, /\b(?:invokeurl|sendmail|insert|delete|update|fetch|info)\b/i);
  assert.doesNotMatch(body, /\.trim\(|isText\(|toText\(|toString\(|subString\(|substring\(/);
});

test("numeric text, normalization order and code-point boundaries stay unchanged", () => {
  assert.equal(validate("123"), "123");
  assert.equal(validate("\v North\r\nSouth\rEast\tWest \f"), "North\nSouth\nEast\tWest");
  assert.equal(validate("😀".repeat(2000)), "😀".repeat(2000));
  assert.throws(() => validate("😀".repeat(2001)), TypeError);
  assert.throws(() => validate("👩‍💻".repeat(667)), TypeError);
});
