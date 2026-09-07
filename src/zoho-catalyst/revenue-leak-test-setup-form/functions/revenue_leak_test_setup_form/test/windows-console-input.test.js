"use strict";

const assert = require("node:assert/strict");
const { isAbsolute, basename } = require("node:path");
const test = require("node:test");
const { createWindowsConsoleMode } = require("../../../scripts/windows-console-input");

// No native executable, clipboard, console, provider, or private input is used.
// The injected runner exchanges synthetic numeric mode metadata only.
const FAILURE = "Windows console mode operation failed";

function adapterWithResults(results) {
  const calls = [];
  const adapter = createWindowsConsoleMode({
    runner(executable, args, options) {
      calls.push({ executable, args, options });
      const result = results.shift();
      if (result instanceof Error) throw result;
      return result;
    },
  });
  return { adapter, calls };
}

test("native adapter passes only fixed operations and numeric modes through a bounded subprocess", () => {
  const { adapter, calls } = adapterWithResults([
    { status: 0, stdout: "503\r\n" },
    { status: 0, stdout: "497\r\n" },
    { status: 0, stdout: "503\r\n" },
  ]);
  const original = adapter.capture();
  assert.equal(original, 503);
  assert.equal(adapter.enablePaste(), undefined);
  assert.equal(adapter.restore(original), undefined);
  assert.deepEqual(calls.map(({ args }) => args), [["get"], ["enable"], ["restore", "503"]]);
  for (const { executable, options } of calls) {
    assert.equal(isAbsolute(executable), true);
    assert.equal(basename(executable), "windows-console-mode.exe");
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 2000);
    assert.equal(options.maxBuffer, 64);
    assert.equal(options.encoding, "utf8");
    assert.deepEqual(options.stdio, ["inherit", "pipe", "ignore"]);
    assert.equal(Object.hasOwn(options, "input"), false);
  }
});

test("capture accepts the full unsigned mode range and only decimal numeric metadata", () => {
  for (const [stdout, expected] of [["0", 0], ["1\n", 1], ["4294967295\r\n", 0xffffffff]]) {
    const { adapter } = adapterWithResults([{ status: 0, stdout }]);
    assert.equal(adapter.capture(), expected);
  }
});

for (const [name, result] of [
  ["nonzero exit", { status: 3, stdout: "1\n" }],
  ["terminated helper", { status: 0, signal: "SIGTERM", stdout: "1\n" }],
  ["spawn failure", { status: 0, error: new Error("synthetic-private-provider-message"), stdout: "1\n" }],
  ["thrown failure", new Error("synthetic-private-provider-message")],
  ["missing result", undefined],
  ["null result", null],
  ["numeric output", { status: 0, stdout: 1 }],
  ["empty output", { status: 0, stdout: "" }],
  ["negative output", { status: 0, stdout: "-1\n" }],
  ["positive prefix", { status: 0, stdout: "+1\n" }],
  ["leading whitespace", { status: 0, stdout: " 1\n" }],
  ["trailing whitespace", { status: 0, stdout: "1 \n" }],
  ["fractional output", { status: 0, stdout: "1.5\n" }],
  ["exponent output", { status: 0, stdout: "1e3\n" }],
  ["overflow", { status: 0, stdout: "4294967296\n" }],
  ["oversized decimal", { status: 0, stdout: "0".repeat(11) }],
  ["additional line", { status: 0, stdout: "1\n1\n" }],
  ["additional blank line", { status: 0, stdout: "1\n\n" }],
  ["NUL suffix", { status: 0, stdout: "1\u0000" }],
  ["diagnostic payload", { status: 0, stdout: "synthetic-private-provider-message" }],
]) {
  test(`capture rejects ${name} with one fixed error and no response contents`, () => {
    const { adapter, calls } = adapterWithResults([result]);
    assert.throws(() => adapter.capture(), { name: "Error", message: FAILURE });
    assert.equal(calls.length, 1);
  });
}

test("paste enable requires processed input and refuses echo, line, or VT input", () => {
  for (const mode of [0, 2, 4, 0x200, 1 | 2, 1 | 4, 1 | 0x200, 0x207]) {
    const { adapter } = adapterWithResults([{ status: 0, stdout: `${mode}\n` }]);
    assert.throws(() => adapter.enablePaste(), { name: "Error", message: FAILURE });
  }
  for (const mode of [1, 0x81, 0x1f9]) {
    const { adapter } = adapterWithResults([{ status: 0, stdout: `${mode}\n` }]);
    assert.equal(adapter.enablePaste(), undefined);
  }
});

test("restore accepts exact captured unsigned modes including unrelated original bits", () => {
  for (const mode of [0, 503, 0xffffffff]) {
    const { adapter, calls } = adapterWithResults([{ status: 0, stdout: `${mode}\n` }]);
    assert.equal(adapter.restore(mode), undefined);
    assert.deepEqual(calls[0].args, ["restore", String(mode)]);
  }
});

test("restore rejects invalid arguments before invoking any child process", () => {
  for (const mode of [undefined, null, "503", NaN, Infinity, -1, 1.5, 0x100000000, {}]) {
    const { adapter, calls } = adapterWithResults([]);
    assert.throws(() => adapter.restore(mode), { name: "Error", message: FAILURE });
    assert.equal(calls.length, 0);
  }
});

test("restore rejects a mismatched readback instead of claiming terminal restoration", () => {
  const { adapter, calls } = adapterWithResults([{ status: 0, stdout: "1\n" }]);
  assert.throws(() => adapter.restore(503), { name: "Error", message: FAILURE });
  assert.equal(calls.length, 1);
});
