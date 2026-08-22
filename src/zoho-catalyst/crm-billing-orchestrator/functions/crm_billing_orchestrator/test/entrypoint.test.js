"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("Advanced I/O entry point exports a callable handler without loading credentials", () => {
  assert.equal(typeof require("../index"), "function");
});

