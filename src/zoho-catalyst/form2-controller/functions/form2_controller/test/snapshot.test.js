"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SnapshotError, fingerprintSnapshot } = require("../lib/snapshot");

const PEPPER = "P".repeat(43);

test("fingerprints equivalent key ordering identically and changed values differently", () => {
  const left = { firstName: "Synthetic", services: ["One", "Two"], accepted: false };
  const reordered = { accepted: false, services: ["One", "Two"], firstName: "Synthetic" };
  const changed = { ...left, firstName: "Changed" };
  assert.equal(fingerprintSnapshot(left, PEPPER), fingerprintSnapshot(reordered, PEPPER));
  assert.notEqual(fingerprintSnapshot(left, PEPPER), fingerprintSnapshot(changed, PEPPER));
  assert.match(fingerprintSnapshot(left, PEPPER), /^[a-f0-9]{64}$/);
});

test("rejects unsafe values, cycles, oversized snapshots, and weak peppers", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => fingerprintSnapshot(cyclic, PEPPER), SnapshotError);
  assert.throws(() => fingerprintSnapshot({ unsafe: undefined }, PEPPER), SnapshotError);
  assert.throws(() => fingerprintSnapshot({ value: "x".repeat(33000) }, PEPPER), SnapshotError);
  assert.throws(() => fingerprintSnapshot({ value: "synthetic" }, "short"), SnapshotError);
});
