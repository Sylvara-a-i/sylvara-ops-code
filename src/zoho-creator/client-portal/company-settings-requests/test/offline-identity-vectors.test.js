"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  prepareOfflineRequestBinding: prepare,
  assertSameReplayBinding: sameReplay,
} = require("../offline-identity-contract");
const { evidence } = require("./fixtures/two-company-identity");

// Fixed v1 outputs, independently checked with Python hashlib over compact UTF-8
// JSON tuples. Never derive expected hashes from the implementation under test.
// Changing these vectors requires the version/migration decision in OFFLINE-IDENTITY.md.
const claimKey = "44d1b2cdcb55732c55ed6ee5c6e070d04d067bbfffd960ea2c7a61d40963c856";
const vectors = [
  {
    name: "exact before-image and CRLF requested text",
    company: "a",
    previous: "  North\r\nCounty  ",
    requested: "North\r\nSouth",
    normalized: "North\nSouth",
    bindingDigest: "3cebe0681245b29897364093980719082544bc9e4d4664d29897a060f1bce4fb",
  },
  {
    name: "normalization-equivalent requested text",
    company: "a",
    previous: "  North\r\nCounty  ",
    requested: " \tNorth\nSouth\r\n ",
    normalized: "North\nSouth",
    bindingDigest: "3cebe0681245b29897364093980719082544bc9e4d4664d29897a060f1bce4fb",
  },
  {
    name: "trimmed before-image changes binding",
    company: "a",
    previous: "North\r\nCounty",
    requested: "North\r\nSouth",
    normalized: "North\nSouth",
    bindingDigest: "d44f913ad70ceb99802bcab578fd789dd4cf2d663d485b78f9bb1c704af1e9b4",
  },
  {
    name: "LF before-image changes binding",
    company: "a",
    previous: "  North\nCounty  ",
    requested: "North\r\nSouth",
    normalized: "North\nSouth",
    bindingDigest: "efeacd892dcdc3843e48914285a7acd1bbf2626bcdba6d096831244fe0dba5c7",
  },
  {
    name: "independent authorized company changes binding but retains claim key",
    company: "b",
    previous: "  South\r\nCounty  ",
    requested: "North\r\nSouth",
    normalized: "North\nSouth",
    bindingDigest: "99ac6c5965c395ee4cf06edb0cffbeba9e4a7c263fcf359865e48b261a27a348",
  },
  {
    name: "non-ASCII requested text uses UTF-8 JSON serialization",
    company: "a",
    previous: "  North\r\nCounty  ",
    requested: "  Caf\u00e9 \u{1f333}  ",
    normalized: "Caf\u00e9 \u{1f333}",
    bindingDigest: "b40eb9baf4de13c6a9a931d2f7e73c46cdcea4d19e98d63d0fcf091049137d7b",
  },
];

function prepareVector(vector) {
  const e = evidence();
  // Explicitly authorize this same principal for both independent companies.
  // Reusing its request ID across those valid selections must still conflict.
  e.grants[1].principalId = e.principal.id;
  const account = `synthetic-company-${vector.company}`;
  e.crmAccounts.find((row) => row.id === `synthetic-crm-company-${vector.company}`)
    .previousServiceArea = vector.previous;
  return prepare({ Account: account, Requested_Service_Area: vector.requested }, e, {
    requestId: "synthetic-request", issuedAt: "2026-10-05T00:00:00.000Z",
  });
}

for (const vector of vectors) {
  test(`v1 serialization golden vector: ${vector.name}`, () => {
    const prepared = prepareVector(vector);
    assert.deepEqual(prepared.binding, { claimKey, bindingDigest: vector.bindingDigest });
    assert.deepEqual(prepared.request, {
      Account: `synthetic-company-${vector.company}`,
      Previous_Service_Area: vector.previous,
      Requested_Service_Area: vector.normalized,
      Status: "Pending review",
    });
  });
}

test("golden replay accepts normalized text and rejects whitespace, company and text changes", () => {
  const first = prepareVector(vectors[0]).binding;
  assert.doesNotThrow(() => sameReplay(first, prepareVector(vectors[1]).binding));
  for (const vector of vectors.slice(2)) {
    const next = prepareVector(vector).binding;
    assert.equal(next.claimKey, first.claimKey);
    assert.throws(() => sameReplay(first, next), TypeError, vector.name);
  }
});
