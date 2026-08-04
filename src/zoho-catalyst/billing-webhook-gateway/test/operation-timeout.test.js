"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OperationTimeoutError,
  withOperationTimeout,
} = require("../lib/operation-timeout");

test("returns a platform operation that completes within its deadline", async () => {
  let calls = 0;
  const result = await withOperationTimeout(async () => {
    calls += 1;
    return "completed";
  }, 100);

  assert.equal(result, "completed");
  assert.equal(calls, 1);
});

test("preserves an operation failure that occurs before the deadline", async () => {
  const expected = new Error("synthetic operation failure");

  await assert.rejects(
    withOperationTimeout(async () => { throw expected; }, 100),
    (error) => error === expected,
  );
});

test("fails a stalled operation with the bounded timeout error", async () => {
  await assert.rejects(
    withOperationTimeout(() => new Promise(() => {}), 10),
    (error) => error instanceof OperationTimeoutError &&
      error.publicCode === "dependency_timeout" &&
      error.ambiguous === false,
  );
});

test("preserves ambiguity at a side-effecting timeout boundary", async () => {
  await assert.rejects(
    withOperationTimeout(() => new Promise(() => {}), 10, { ambiguous: true }),
    (error) => error instanceof OperationTimeoutError &&
      error.publicCode === "dependency_timeout" &&
      error.ambiguous === true,
  );
});
