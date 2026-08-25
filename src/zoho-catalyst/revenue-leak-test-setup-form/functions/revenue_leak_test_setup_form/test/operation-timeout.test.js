"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { OperationTimeoutError, withOperationTimeout } = require("../lib/operation-timeout");

test("returns a bounded operation result", async () => {
  assert.equal(await withOperationTimeout(async () => "ok", 100), "ok");
});

test("classifies a side-effect timeout as ambiguous", async () => {
  await assert.rejects(
    withOperationTimeout(() => new Promise(() => {}), 5, { ambiguous: true }),
    (error) => error instanceof OperationTimeoutError && error.ambiguous,
  );
});
