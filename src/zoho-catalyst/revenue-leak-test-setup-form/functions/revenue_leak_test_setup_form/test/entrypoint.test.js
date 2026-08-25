"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("the Advanced I/O entry point exports a callable handler", () => {
  const entrypoint = require("../index");

  assert.equal(typeof entrypoint, "function");
});
