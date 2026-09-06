"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { deriveAllowlist, run } = require("../../../scripts/prepare-proof-allowlist");
const { proofDestinationDigest } = require("../lib/security");

// These fixtures are deliberately synthetic. No test reads environment secrets,
// CRM records, provider configuration, clipboard contents, or private files.
const PROOF_KEY = "p".repeat(32);
const QA_EMAIL = "SyntheticOwner@example.invalid";
const DERIVED_ARRAY = /^\["[a-f0-9]{64}"\]$/m;

class FakeInput extends EventEmitter {
  constructor({ isTTY = true, isRaw = false } = {}) {
    super();
    this.isTTY = isTTY;
    this.isRaw = isRaw;
    this.rawHistory = [];
    this.resumeCalls = 0;
    this.pauseCalls = 0;
  }

  setRawMode(value) {
    this.rawHistory.push(value);
    this.isRaw = value;
    return this;
  }

  setEncoding(value) {
    this.encoding = value;
    return this;
  }

  resume() {
    this.resumeCalls += 1;
    return this;
  }

  pause() {
    this.pauseCalls += 1;
    return this;
  }
}

function terminal(answers = [], options = {}) {
  const input = new FakeInput(options);
  const output = Object.assign(new EventEmitter(), {
    isTTY: options.outputTTY ?? true,
    text: "",
    prompts: 0,
    write(value) {
      const chunk = String(value);
      this.text += chunk;
      if (!chunk.endsWith(": ")) return true;
      const answer = answers[this.prompts++];
      // Deliver only after the hidden-input listener is installed, as actual
      // terminal input would arrive after the owner sees a prompt.
      setImmediate(() => {
        if (answer === undefined) return;
        if (typeof answer === "string") {
          input.emit("data", answer);
        } else if (answer.event) {
          (answer.target === "output" ? output : input).emit(answer.event, answer.error);
        } else {
          for (const part of answer.chunks) input.emit("data", part);
        }
      });
      return true;
    },
  });
  return { input, output };
}

function successfulAnswers({ key = PROOF_KEY, email = QA_EMAIL, newline = "\r" } = {}) {
  return [key, key, email, email].map((value) => `${value}${newline}`);
}

async function execute(answers, options = {}, runOptions = {}) {
  const streams = terminal(answers, options);
  const code = await run({
    ...streams,
    args: [],
    nodeVersion: "24.19.0",
    timeoutMs: 1000,
    ...runOptions,
  });
  return { ...streams, code };
}

function assertNoInputs(output, values = [PROOF_KEY, QA_EMAIL]) {
  for (const value of values) {
    assert.equal(output.text.includes(value), false, "Protected input must not be echoed");
  }
}

function assertRestored(input, initiallyRaw = false) {
  assert.equal(input.isRaw, initiallyRaw);
  assert.equal(input.rawHistory.at(-1), initiallyRaw);
  assert.ok(input.pauseCalls > 0);
  for (const event of ["data", "end", "close", "error"]) {
    assert.equal(input.listenerCount(event), 0, `No ${event} listener may remain`);
  }
}

function assertFailedSafely(result, values) {
  assert.equal(result.code, 1);
  assert.equal(DERIVED_ARRAY.test(result.output.text), false);
  assertNoInputs(result.output, values);
  assertRestored(result.input);
}

test("derivation returns one canonical domain-separated destination digest", () => {
  const value = deriveAllowlist(QA_EMAIL, PROOF_KEY);
  assert.match(value, DERIVED_ARRAY);
  assert.deepEqual(JSON.parse(value), [proofDestinationDigest(QA_EMAIL, PROOF_KEY)]);
  assert.equal(value.includes(QA_EMAIL), false);
  assert.equal(value.includes(PROOF_KEY), false);
});

test("derivation lowercases the domain without changing the local part", () => {
  assert.equal(
    deriveAllowlist("SyntheticOwner@EXAMPLE.INVALID", PROOF_KEY),
    deriveAllowlist(QA_EMAIL, PROOF_KEY),
  );
  assert.notEqual(
    deriveAllowlist("syntheticowner@example.invalid", PROOF_KEY),
    deriveAllowlist(QA_EMAIL, PROOF_KEY),
  );
});

test("derivation accepts the configured 32- and 256-character secret bounds", () => {
  for (const length of [32, 256]) {
    const key = "k".repeat(length);
    assert.deepEqual(JSON.parse(deriveAllowlist(QA_EMAIL, key)), [
      proofDestinationDigest(QA_EMAIL, key),
    ]);
  }
});

test("derivation accepts the canonical email length boundary", () => {
  const email = `qa@${"d".repeat(247)}.com`;
  assert.equal(email.length, 254);
  assert.deepEqual(JSON.parse(deriveAllowlist(email, PROOF_KEY)), [
    proofDestinationDigest(email, PROOF_KEY),
  ]);
});

test("invalid key and destination values expose only one generic error", () => {
  const invalidKeys = [undefined, null, 7, "", "k".repeat(31), "k".repeat(257),
    ` ${PROOF_KEY}`, `${PROOF_KEY}\t`, `${PROOF_KEY}\n`, `${PROOF_KEY}\u007f`,
    `${PROOF_KEY}\u00e9`, `${PROOF_KEY} x`];
  const invalidEmails = [undefined, null, 7, "", "missing-at", "qa@example",
    "qa@@example.invalid", ` ${QA_EMAIL}`, `${QA_EMAIL} `, `${QA_EMAIL}\n`,
    "qa owner@example.invalid", `qa@${"d".repeat(248)}.com`];
  const messages = new Set();
  for (const [email, key] of [
    ...invalidKeys.map((key) => [QA_EMAIL, key]),
    ...invalidEmails.map((email) => [email, PROOF_KEY]),
  ]) {
    assert.throws(() => deriveAllowlist(email, key), (error) => {
      assert.ok(error instanceof Error);
      for (const value of [email, key]) {
        if (typeof value === "string" && value.length > 8) {
          assert.equal(error.message.includes(value), false);
        }
      }
      messages.add(error.message);
      return true;
    });
  }
  assert.equal(messages.size, 1);
});

for (const newline of ["\r", "\n", "\r\n"]) {
  test(`hidden interactive derivation succeeds with ${JSON.stringify(newline)} line endings`, async () => {
    const result = await execute(successfulAnswers({ newline }));
    assert.equal(result.code, 0);
    assert.equal(result.output.prompts, 4);
    assert.equal(result.output.text.split(/\r?\n/).filter((line) => DERIVED_ARRAY.test(line)).length, 1);
    assert.ok(result.output.text.includes(deriveAllowlist(QA_EMAIL, PROOF_KEY)));
    assertNoInputs(result.output);
    assertRestored(result.input);
  });
}

test("successful input restores an already-raw terminal to its original state", async () => {
  const result = await execute(successfulAnswers(), { isRaw: true });
  assert.equal(result.code, 0);
  assertNoInputs(result.output);
  assertRestored(result.input, true);
});

test("backspace and delete edit hidden input without echoing discarded text", async () => {
  const answers = successfulAnswers();
  answers[0] = `${PROOF_KEY}x\b\r`;
  answers[2] = `${QA_EMAIL}z\u007f\r`;
  const result = await execute(answers);
  assert.equal(result.code, 0);
  assert.ok(result.output.text.includes(deriveAllowlist(QA_EMAIL, PROOF_KEY)));
  assertNoInputs(result.output, [PROOF_KEY, QA_EMAIL, `${PROOF_KEY}x`, `${QA_EMAIL}z`]);
  assertRestored(result.input);
});

test("email confirmation permits domain case normalization only", async () => {
  const answers = successfulAnswers();
  answers[3] = "SyntheticOwner@EXAMPLE.INVALID\r";
  const result = await execute(answers);
  assert.equal(result.code, 0);
  assert.ok(result.output.text.includes(deriveAllowlist(QA_EMAIL, PROOF_KEY)));
  assertNoInputs(result.output, [PROOF_KEY, QA_EMAIL, "SyntheticOwner@EXAMPLE.INVALID"]);
  assertRestored(result.input);
});

test("email confirmation rejects a changed local-part case", async () => {
  const answers = successfulAnswers();
  answers[3] = "syntheticowner@example.invalid\r";
  const result = await execute(answers);
  assertFailedSafely(result, [PROOF_KEY, QA_EMAIL, "syntheticowner@example.invalid"]);
});

test("hidden input accepts separately delivered ordinary character chunks", async () => {
  const answers = successfulAnswers();
  answers[0] = { chunks: [PROOF_KEY.slice(0, 12), PROOF_KEY.slice(12), "\r"] };
  const result = await execute(answers);
  assert.equal(result.code, 0);
  assertNoInputs(result.output);
  assertRestored(result.input);
});

for (const [name, position, replacement] of [
  ["secret mismatch", 1, `${"q".repeat(32)}\r`],
  ["email mismatch", 3, "AnotherSyntheticOwner@example.invalid\r"],
  ["invalid secret", 0, "too-short\r"],
  ["invalid email", 2, "not-an-email\r"],
]) {
  test(`interactive ${name} fails without derived output`, async () => {
    const answers = successfulAnswers();
    answers[position] = replacement;
    const result = await execute(answers);
    assertFailedSafely(result, [PROOF_KEY, QA_EMAIL, replacement.replace(/\r$/, "")]);
  });
}

for (const [name, options, runOptions] of [
  ["piped input", { isTTY: false }, {}],
  ["redirected output", { outputTTY: false }, {}],
  ["CLI arguments", {}, { args: ["--recipient=synthetic@example.invalid"] }],
  ["unsupported Node", {}, { nodeVersion: "22.0.0" }],
]) {
  test(`${name} is refused before any secret prompt or input read`, async () => {
    const result = await execute([], options, runOptions);
    assert.equal(result.code, 1);
    assert.equal(result.output.prompts, 0);
    assert.equal(result.input.resumeCalls, 0);
    assert.deepEqual(result.input.rawHistory, []);
    assertNoInputs(result.output, [PROOF_KEY, QA_EMAIL, "synthetic@example.invalid"]);
    assert.equal(DERIVED_ARRAY.test(result.output.text), false);
  });
}

for (const [name, answer] of [
  ["Ctrl-C", "\u0003"],
  ["Ctrl-D", "\u0004"],
  ["end of input", { event: "end" }],
  ["closed input", { event: "close" }],
  ["input error", { event: "error", error: new Error(`synthetic-private-${PROOF_KEY}`) }],
  ["output error", { target: "output", event: "error", error: new Error(`synthetic-private-${PROOF_KEY}`) }],
  ["timeout", undefined],
]) {
  test(`${name} fails closed and restores terminal state`, async () => {
    const result = await execute([answer], {}, name === "timeout" ? { timeoutMs: 10 } : {});
    assertFailedSafely(result);
    assert.equal(result.output.text.includes("synthetic-private-"), false);
    assert.equal(result.output.listenerCount("error"), 0);
  });
}

test("multiline paste cannot silently answer more than one protected prompt", async () => {
  const result = await execute([`${PROOF_KEY}\r\n${PROOF_KEY}\r\n`]);
  assertFailedSafely(result);
  assert.equal(result.output.prompts, 1);
});

test("oversized hidden input fails before the next prompt", async () => {
  const oversized = "k".repeat(4097);
  const result = await execute([oversized]);
  assertFailedSafely(result, [oversized, PROOF_KEY, QA_EMAIL]);
  assert.equal(result.output.prompts, 1);
});

test("escape/control input cannot manipulate the terminal or be echoed", async () => {
  const control = "\u001b[2J";
  const result = await execute([control]);
  assertFailedSafely(result);
  assert.equal(result.output.text.includes(control), false);
});
