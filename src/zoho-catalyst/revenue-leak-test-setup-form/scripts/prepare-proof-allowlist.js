#!/usr/bin/env node
"use strict";

// Owner-run only: this module never loads Catalyst configuration or the SDK.
const {
  constantTimeEqual,
  normalizeProofEmail,
  proofDestinationDigest,
} = require("../functions/revenue_leak_test_setup_form/lib/security");
const { createWindowsConsoleMode } = require("./windows-console-input");

const FAILURE = "No allowlist generated. Input was invalid, cancelled, or the private terminal was unavailable.";
const INPUT_MESSAGES = Object.freeze({
  EMPTY_INPUT: "Nothing was entered. Type or paste one value before pressing Enter.",
  INVALID_PROOF_FORMAT: "Use the existing saved 32-256 character printable ASCII proof secret, without spaces.",
  INVALID_EMAIL: "Use the exact approved email address, without spaces or surrounding whitespace.",
  SECRET_MISMATCH: "The two proof-secret entries did not match.",
  EMAIL_MISMATCH: "The two email entries did not match.",
  CANCELLED: "Entry was cancelled. No value was generated.",
  TIMED_OUT: "The two-minute input deadline expired. Restart when the private inputs are ready.",
  UNSUPPORTED_INPUT: "An unsupported control or paste sequence arrived. Use the terminal Paste action for one value, then press Enter separately.",
  MULTILINE_INPUT: "More than one line arrived. Paste one value without line breaks.",
  INPUT_TOO_LONG: "The input exceeded the field limit.",
  TERMINAL_UNAVAILABLE: "Use the pinned Node 24 runtime in a private interactive terminal with no arguments or redirection.",
  WINDOWS_CONSOLE_UNAVAILABLE: "The local Windows console adapter is unavailable or could not restore the input mode. Close this window; do not enter a secret.",
});
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

class InputError extends Error {
  constructor(reason) {
    super(FAILURE);
    this.reason = Object.hasOwn(INPUT_MESSAGES, reason) ? reason : "TERMINAL_UNAVAILABLE";
  }
}

/** Derive one recipient entry with exactly the deployed protocol's normalization. */
function deriveAllowlist(email, secret) {
  try {
    return JSON.stringify([proofDestinationDigest(email, secret)]);
  } catch {
    // Do not propagate messages, causes or input from a dependency to the terminal.
    throw new Error(FAILURE);
  }
}

/** Read one masked line without exposing text or accessing the clipboard. */
function readHiddenLine(input, output, prompt, maxLength, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let value = "";
    let escapeSequence = "";
    let inPaste = false;
    let pasteHintShown = false;
    let settled = false;
    let timer;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.removeListener("data", onData);
      input.removeListener("error", onFailure);
      input.removeListener("end", onFailure);
      input.removeListener("close", onFailure);
      output.removeListener("error", onFailure);
      signal.removeEventListener("abort", onAbort);
      const answer = value;
      value = "";
      escapeSequence = "";
      if (reason) reject(new InputError(reason));
      else if (!answer) reject(new InputError("EMPTY_INPUT"));
      else resolve(answer);
    };
    const onFailure = () => finish("TERMINAL_UNAVAILABLE");
    const onAbort = () => finish("CANCELLED");
    const onData = (chunk) => {
      if (settled) return;
      try {
        const text = String(chunk);
        if (text.length > maxLength + PASTE_START.length + PASTE_END.length + 2) {
          return finish("INPUT_TOO_LONG");
        }
        const characters = Array.from(text);
        for (let index = 0; index < characters.length; index += 1) {
          const character = characters[index];
          if (character === "\x03" || character === "\x04") return finish("CANCELLED");
          if (escapeSequence || character === "\x1b") {
            // Accept only the exact six-byte bracketed-paste markers, even when
            // split across reads. Never strip arbitrary terminal escapes.
            escapeSequence += character;
            const expected = inPaste ? PASTE_END : PASTE_START;
            if (!expected.startsWith(escapeSequence)) return finish("UNSUPPORTED_INPUT");
            if (escapeSequence === expected) {
              escapeSequence = "";
              inPaste = !inPaste;
              // Pasted text cannot submit its own confirmation or next answer.
              if (!inPaste && index !== characters.length - 1) return finish("UNSUPPORTED_INPUT");
            }
            continue;
          }
          if (character === "\r" || character === "\n") {
            if (inPaste) return finish("MULTILINE_INPUT");
            const remainder = characters.slice(index).join("");
            if (!/^(?:\r\n?|\n)$/.test(remainder)) return finish("MULTILINE_INPUT");
            return finish();
          }
          if (!inPaste && character === "\x16") {
            // Some Windows hosts deliver Ctrl+V as a key instead of clipboard
            // text. Retain the entry/deadline and let the owner use host Paste.
            if (!pasteHintShown) {
              pasteHintShown = true;
              output.write(
                "\nPASTE_SHORTCUT: The terminal sent a shortcut, not pasted text.\n" +
                "Use Shift+Insert or the terminal's Paste action for one value.\n" +
                "Your current entry is unchanged; the clipboard was not read.\n" +
                "Continue the current entry -> " + "*".repeat(Array.from(value).length),
              );
            }
            continue;
          }
          if (!inPaste && (character === "\b" || character === "\x7f")) {
            if (value) {
              value = Array.from(value).slice(0, -1).join("");
              output.write("\b \b");
            }
            continue;
          }
          if (/[\x00-\x1f\x7f]/.test(character)) return finish("UNSUPPORTED_INPUT");
          if (value.length + character.length > maxLength) return finish("INPUT_TOO_LONG");
          value += character;
          output.write("*");
        }
      } catch {
        finish("TERMINAL_UNAVAILABLE");
      }
    };
    input.on("data", onData);
    input.on("error", onFailure);
    input.on("end", onFailure);
    input.on("close", onFailure);
    output.on("error", onFailure);
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => finish("TIMED_OUT"), timeoutMs);
    if (signal.aborted) return finish("CANCELLED");
    try {
      output.write(prompt);
      input.resume();
    } catch {
      finish("TERMINAL_UNAVAILABLE");
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
  consoleMode = process.platform === "win32" ? createWindowsConsoleMode() : null,
  interruptSource = process,
} = {}) {
  let rawChanged = false;
  const priorRaw = input?.isRaw === true;
  let secret = "";
  let secretConfirmation = "";
  let email = "";
  let emailConfirmation = "";
  let result = "";
  let stage = "START";
  let originalConsoleMode;
  let cleanupAttempted = false;
  let cleanupSucceeded = false;
  const cancellation = new AbortController();
  const onInterrupt = () => cancellation.abort();
  // Native processed-input mode delivers Ctrl+C as SIGINT, not a data byte.
  const restoreTerminal = () => {
    if (cleanupAttempted) return cleanupSucceeded;
    cleanupAttempted = true;
    let success = true;
    if (rawChanged) {
      try { input.pause(); } catch { success = false; }
      try { input.setRawMode(priorRaw); } catch { success = false; }
    }
    if (originalConsoleMode !== undefined) {
      try { consoleMode.restore(originalConsoleMode); } catch { success = false; }
    }
    cleanupSucceeded = success;
    return success;
  };
  const reportFailure = (error) => {
    const reason = error instanceof InputError ? error.reason : "TERMINAL_UNAVAILABLE";
    try {
      output.write(`\nNo allowlist generated. ${stage} / ${reason}: ${INPUT_MESSAGES[reason]}\n`);
    } catch { /* Closed terminal: no fallback log. */ }
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
    interruptSource.on("SIGINT", onInterrupt);
    if (consoleMode) {
      try { originalConsoleMode = consoleMode.capture(); }
      catch { throw new InputError("WINDOWS_CONSOLE_UNAVAILABLE"); }
    }
    output.write(
      "OWNER-ONLY OFFLINE FORM 2 ALLOWLIST PREPARATION\n" +
      "Use a private terminal outside Codex, recording, logging and screen sharing.\n" +
      "Enter the EXISTING saved Development proof secret, not a new key.\n" +
      "Enter only the already-approved CRM-bound QA recipient. This tool cannot verify that approval.\n" +
      "Input characters appear as *. Paste one value without a newline, then press Enter.\n" +
      "Windows: paste with Ctrl+V or Shift+Insert. Ctrl+C cancels.\n",
    );
    input.setEncoding("utf8");
    // Node raw mode suppresses terminal echo, including while a prompt changes.
    // An OS call can fail after changing state; cleanup must still be attempted.
    rawChanged = true;
    input.setRawMode(true);
    if (input.isRaw !== true) throw new Error(FAILURE);
    if (consoleMode) {
      try { consoleMode.enablePaste(); }
      catch { throw new InputError("WINDOWS_CONSOLE_UNAVAILABLE"); }
    }
    stage = "PROOF_SECRET";
    secret = await readHiddenLine(input, output, "Saved proof secret (masked): ", 256, timeoutMs, cancellation.signal);
    // This is only an early operator-input check. Final derivation still uses
    // the controller's canonical validator, normalization and HMAC helper.
    if (!/^[\x21-\x7e]{32,256}$/.test(secret)) throw new InputError("INVALID_PROOF_FORMAT");
    output.write("\n");
    stage = "PROOF_CONFIRMATION";
    secretConfirmation = await readHiddenLine(input, output, "Repeat proof secret (masked): ", 256, timeoutMs, cancellation.signal);
    output.write("\n");
    if (!constantTimeEqual(secret, secretConfirmation)) throw new InputError("SECRET_MISMATCH");
    stage = "QA_EMAIL";
    email = await readHiddenLine(input, output, "Approved QA email (masked): ", 254, timeoutMs, cancellation.signal);
    try { normalizeProofEmail(email); } catch { throw new InputError("INVALID_EMAIL"); }
    output.write("\n");
    stage = "QA_CONFIRMATION";
    emailConfirmation = await readHiddenLine(input, output, "Repeat QA email (masked): ", 254, timeoutMs, cancellation.signal);
    try { normalizeProofEmail(emailConfirmation); } catch { throw new InputError("INVALID_EMAIL"); }
    output.write("\n");
    if (!constantTimeEqual(normalizeProofEmail(email), normalizeProofEmail(emailConfirmation))) {
      throw new InputError("EMAIL_MISMATCH");
    }
    stage = "DERIVATION";
    result = deriveAllowlist(email, secret);
    if (cancellation.signal.aborted) throw new InputError("CANCELLED");
    // Do not publish success if the owner's exact console state cannot be restored.
    if (!restoreTerminal()) throw new InputError("WINDOWS_CONSOLE_UNAVAILABLE");
    output.write(
      "Private derived value for FORM2_PROOF_ALLOWED_RECIPIENT_DIGESTS:\n" +
      `${result}\n` +
      "Owner: replace that Development variable in revenue_leak_test_setup_form only.\n" +
      "Keep SOURCE_REVISION and both workflow-secret fields unchanged. Do not send this output to chat.\n" +
      "No configuration was read or changed. No session, OTP, approval or live test was performed.\n",
    );
    return 0;
  } catch (error) {
    reportFailure(error);
    return 1;
  } finally {
    // Release references; JavaScript/OS memory erasure cannot be guaranteed.
    secret = secretConfirmation = email = emailConfirmation = result = "";
    if (!restoreTerminal()) reportFailure(new InputError("WINDOWS_CONSOLE_UNAVAILABLE"));
    interruptSource.removeListener("SIGINT", onInterrupt);
  }
}

if (require.main === module) {
  run().then((code) => { process.exitCode = code; });
}

module.exports = { deriveAllowlist, run };
