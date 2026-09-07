"use strict";

const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const HELPER = join(__dirname, ".local", "windows-console-mode.exe");

/** Only numeric console-mode metadata crosses this child-process boundary. */
function createWindowsConsoleMode({ runner = spawnSync } = {}) {
  const invoke = (args) => {
    try {
      const result = runner(HELPER, args, {
        shell: false,
        windowsHide: true,
        timeout: 2000,
        maxBuffer: 64,
        encoding: "utf8",
        // The helper never reads stdin. No private input or derived value is
        // sent to a child process, command argument, file or captured stream.
        stdio: ["inherit", "pipe", "ignore"],
      });
      if (result.error || result.signal || result.status !== 0 ||
          typeof result.stdout !== "string" || !/^\d{1,10}\r?\n?$/.test(result.stdout)) {
        throw new Error();
      }
      const mode = Number(result.stdout.trim());
      if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0xffffffff) throw new Error();
      return mode;
    } catch {
      throw new Error("Windows console mode operation failed");
    }
  };
  return {
    capture: () => invoke(["get"]),
    enablePaste() {
      const mode = invoke(["enable"]);
      if ((mode & 1) !== 1 || (mode & 0x206) !== 0) {
        throw new Error("Windows console mode operation failed");
      }
    },
    restore(mode) {
      if (!Number.isInteger(mode) || mode < 0 || mode > 0xffffffff ||
          invoke(["restore", String(mode)]) !== mode) {
        throw new Error("Windows console mode operation failed");
      }
    },
  };
}

module.exports = { createWindowsConsoleMode };
