"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const registry = require("../functions/revenue_leak_test_request_form/lib/recovery-phone-policy-revisions");
const PREFIX = "src/zoho-catalyst/revenue-leak-test-request-form/functions/revenue_leak_test_request_form/lib/";
const POLICY = "us-national-e164-v1";

function safeGitEnvironment() {
  const environment = {
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_CONFIG_NOSYSTEM: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0",
    LANG: "C", LC_ALL: "C",
  };
  const pathName = Object.keys(process.env).find(name => name.toLowerCase() === "path");
  environment.PATH = pathName ? process.env[pathName] : "";
  for (const name of ["ComSpec", "PATHEXT", "SystemRoot", "WINDIR"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}
function gitRead(repoRoot, arguments_, encoding) {
  return execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
    "-C", repoRoot, ...arguments_], { encoding, env: safeGitEnvironment(),
    maxBuffer: 1024 * 1024, timeout: 10000, shell: false });
}
function gitBlob(repoRoot, revision, filename) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Exact original revision required");
  const resolved = gitRead(repoRoot, ["rev-parse", "--verify", revision + "^{commit}"], "utf8").trim();
  if (resolved !== revision) throw new Error("Original artifact revision mismatch");
  return gitRead(repoRoot, ["show", revision + ":" + PREFIX + filename], null);
}
function inspectOriginalPolicy(repoRoot, revision, readBlob = gitBlob) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Exact original revision required");
  const policy = readBlob(repoRoot, revision, "phone-contract.js");
  const handler = readBlob(repoRoot, revision, "handler.js");
  const normalizer = readBlob(repoRoot, revision, "us-phone-policy.js");
  const text = policy.toString("utf8");
  if (!text.includes('id: "' + POLICY + '", countryCode: "US"') ||
      !handler.toString("utf8").includes('require("./phone-contract")') ||
      !handler.toString("utf8").includes("normalizeFormData(canonicalFormData)")) {
    throw new Error("Original artifact does not declare the reviewed canonical profile");
  }
  const sha = value => crypto.createHash("sha256").update(value).digest("hex");
  // Recovery executes the current adapter/core. Pin compatibility as well as
  // provenance; intentional drift needs a new profile or retained implementation.
  const local = name => fs.readFileSync(path.resolve(__dirname,
    "../functions/revenue_leak_test_request_form/lib", name));
  if (sha(policy) !== sha(local("phone-contract.js")) ||
      sha(normalizer) !== sha(local("us-phone-policy.js"))) {
    throw new Error("Original phone policy is incompatible with this recovery artifact");
  }
  return Object.freeze({ sourceRevision: revision, phonePolicy: POLICY,
    policyModuleSha256: sha(policy), handlerModuleSha256: sha(handler),
    normalizerModuleSha256: sha(normalizer) });
}
function verifyRegistry(repoRoot, entries, readBlob = gitBlob) {
  if (!Array.isArray(entries) || entries.length > 100 ||
      new Set(entries.map(entry => entry?.sourceRevision)).size !== entries.length) {
    throw new Error("Recovery policy registry is invalid");
  }
  for (const entry of entries) {
    if (!entry || Object.keys(entry).sort().join(",") !==
        "handlerModuleSha256,normalizerModuleSha256,phonePolicy,policyModuleSha256,sourceRevision") {
      throw new Error("Recovery policy registry shape is invalid");
    }
    const expected = inspectOriginalPolicy(repoRoot, entry.sourceRevision, readBlob);
    if (Object.entries(expected).some(([key, value]) => entry[key] !== value)) {
      throw new Error("Recovery policy registry does not match immutable original source");
    }
  }
  return entries.length;
}
if (require.main === module) {
  const repoRoot = path.resolve(__dirname, "../../../..");
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "--check")) {
    process.stdout.write("Verified canonical recovery predecessors: " +
      verifyRegistry(repoRoot, registry) + "\n");
  } else if (args.length === 2 && args[0] === "--prepare") {
    // Source provenance only, never a private recovery manifest or authorization.
    process.stdout.write(JSON.stringify({ reviewRequired: true,
      candidate: inspectOriginalPolicy(repoRoot, args[1]) }, null, 2) + "\n");
  } else {
    throw new Error("Use --check or --prepare with one exact original artifact revision");
  }
}
module.exports = { inspectOriginalPolicy, verifyRegistry, safeGitEnvironment };
