#!/usr/bin/env node
"use strict";

// Owner-run only: this module never loads Catalyst configuration or the SDK.
const {
  constantTimeEqual,
  normalizeProofEmail,
  proofDestinationDigest,
} = require("../functions/revenue_leak_test_setup_form/lib/security");

const FAILURE = "No allowlist generated. Input was invalid, cancelled, or the private terminal was unavailable.";

/** Derive one recipient entry with exactly the deployed protocol's normalization. */
function deriveAllowlist(email, secret) {
  try {
    return JSON.stringify([proofDestinationDigest(email, secret)]);
  } catch {
    // Do not propagate messages, causes or input from a dependency to the terminal.
    throw new Error(FAILURE);
  }
}

/** Read one bounded hidden line; reject extra answers delivered in the same chunk. */
function readHiddenLine(input, output, prompt, maxLength, timeoutMs) {
  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    let timer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.removeListener("data", onData);
      input.removeListener("error", onFailure);
      input.removeListener("end", onFailure);
      input.removeListener("close", onFailure);
      output.removeListener("error", onFailure);
      const answer = value;
      value = "";
      if (error) reject(new Error(FAILURE));
      else resolve(answer);
    };
    const onFailure = () => finish(true);
    const onData = (chunk) => {
      if (settled) return;
      const text = String(chunk);
      if (text.length > maxLength + 2) return finish(true);
      const newline = text.search(/[\r\n]/);
      // A CRLF is one Enter. Anything after it is a multi-line paste, not consent
      // to answer another prompt. Escape/control sequences are rejected as well.
      if (newline !== -1 && !/^(?:\r\n?|\n)$/.test(text.slice(newline))) {
        return finish(true);
      }
      const characters = newline === -1 ? text : text.slice(0, newline);
      for (const character of characters) {
        if (character === "\b" || character === "\x7f") value = value.slice(0, -1);
        else if (/[\x00-\x1f]/.test(character)) return finish(true);
        else value += character;
        if (value.length > maxLength) return finish(true);
      }
      if (newline !== -1) finish(false);
    };
    input.on("data", onData);
    input.on("error", onFailure);
    input.on("end", onFailure);
    input.on("close", onFailure);
    output.on("error", onFailure);
    timer = setTimeout(onFailure, timeoutMs);
    try {
      output.write(prompt);
      input.resume();
    } catch {
      finish(true);
    }
  });
}

/**
 * Calculate, but never install, one Development recipient digest in an owner's
 * private terminal. TTY checks prevent accidental capture by pipes/CI; they do
 * not detect terminal recording, agent supervision or an untrusted computer.
 */
async function run({
  input = process.stdin,
  output = process.stdout,
  args = process.argv.slice(2),
  nodeVersion = process.versions.node,
  timeoutMs = 120000,
} = {}) {
  let rawChanged = false;
  const priorRaw = input?.isRaw === true;
  let secret = "";
  let secretConfirmation = "";
  let email = "";
  let emailConfirmation = "";
  let result = "";
  const reportFailure = () => {
    try { output.write(`${FAILURE}\n`); } catch { /* Closed terminal: no fallback log. */ }
  };
  try {
    if (
      !Array.isArray(args) || args.length !== 0 ||
      input?.isTTY !== true || output?.isTTY !== true ||
      typeof input.setRawMode !== "function" ||
      !/^24\./.test(nodeVersion) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000
    ) {
      reportFailure();
      return 1;
    }
    output.write(
      "OWNER-ONLY OFFLINE FORM 2 ALLOWLIST PREPARATION\n" +
      "Use a private terminal outside Codex, recording, logging and screen sharing.\n" +
      "Enter the EXISTING saved Development proof secret, not a new key.\n" +
      "Enter only the already-approved CRM-bound QA recipient. This tool cannot verify that approval.\n" +
      "Input is hidden. Paste one field at a time without a newline, then press Enter. Ctrl+C cancels.\n",
    );
    input.setEncoding("utf8");
    // Node raw mode suppresses terminal echo, including while a prompt changes.
    input.setRawMode(true);
    rawChanged = true;
    if (input.isRaw !== true) throw new Error(FAILURE);
    secret = await readHiddenLine(input, output, "Saved proof secret (hidden): ", 256, timeoutMs);
    output.write("\n");
    secretConfirmation = await readHiddenLine(input, output, "Repeat proof secret (hidden): ", 256, timeoutMs);
    output.write("\n");
    if (!constantTimeEqual(secret, secretConfirmation)) throw new Error(FAILURE);
    email = await readHiddenLine(input, output, "Approved QA email (hidden): ", 254, timeoutMs);
    output.write("\n");
    emailConfirmation = await readHiddenLine(input, output, "Repeat QA email (hidden): ", 254, timeoutMs);
    output.write("\n");
    if (!constantTimeEqual(normalizeProofEmail(email), normalizeProofEmail(emailConfirmation))) {
      throw new Error(FAILURE);
    }
    result = deriveAllowlist(email, secret);
    output.write(
      "Private derived value for FORM2_PROOF_ALLOWED_RECIPIENT_DIGESTS:\n" +
      `${result}\n` +
      "Owner: replace that Development variable in revenue_leak_test_setup_form only.\n" +
      "Keep SOURCE_REVISION and both workflow-secret fields unchanged. Do not send this output to chat.\n" +
      "No configuration was read or changed. No session, OTP, approval or live test was performed.\n",
    );
    return 0;
  } catch {
    reportFailure();
    return 1;
  } finally {
    // Release references; JavaScript/OS memory erasure cannot be guaranteed.
    secret = secretConfirmation = email = emailConfirmation = result = "";
    if (rawChanged) {
      try { input.pause(); } catch { /* Do not expose cleanup errors. */ }
      try { input.setRawMode(priorRaw); } catch { /* Owner may need to close the terminal. */ }
    }
  }
}

if (require.main === module) {
  run().then((code) => { process.exitCode = code; });
}

module.exports = { deriveAllowlist, run };
