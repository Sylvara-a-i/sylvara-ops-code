#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

// Build before owner entry; no protected prompts, runtime configuration or input.
function build() {
  if (process.platform !== "win32" || process.argv.length !== 2) return 1;
  const framework = join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET");
  const compiler = ["Framework64", "Framework"].map((name) =>
    join(framework, name, "v4.0.30319", "csc.exe")).find(existsSync);
  if (!compiler) return 1;
  const directory = join(__dirname, ".local");
  mkdirSync(directory, { recursive: true });
  const target = join(directory, "windows-console-mode.exe");
  const result = spawnSync(compiler, ["/nologo", "/target:exe", "/platform:anycpu",
    `/out:${target}`, join(__dirname, "windows-console-mode.cs")], {
    shell: false, windowsHide: true, timeout: 30000, stdio: "ignore",
  });
  return !result.error && result.status === 0 && existsSync(target) ? 0 : 1;
}

try {
  process.exitCode = build();
} catch {
  process.exitCode = 1;
}
console.log(process.exitCode === 0 ? "Local Windows console adapter built." :
  "Windows console adapter build failed. No protected input was requested.");
