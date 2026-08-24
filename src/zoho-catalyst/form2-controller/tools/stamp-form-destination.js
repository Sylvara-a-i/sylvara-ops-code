#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SENTINEL = "__SYLVARA_UNSTAMPED_FORM_DESTINATION_SHA256__";
const EXPECTED = `"use strict";\n\n// The reviewed Development deploy script replaces this sentinel only in its\n// isolated temporary artifact. A checkout or manually packaged function stays\n// unstamped and therefore fails closed before reaching CRM or Data Store.\nconst ARTIFACT_FORM_DESTINATION_SHA256 =\n  "${SENTINEL}";\n\nmodule.exports = { ARTIFACT_FORM_DESTINATION_SHA256 };\n`;

function fail(message) {
  throw new Error(message);
}

function hasRepositoryParent(selectedPath) {
  let current = selectedPath;
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function stampFormDestination({
  artifactRoot,
  digest = process.env.APPROVED_FORM2_DESTINATION_SHA256,
} = {}) {
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
    fail("Approved Form 2 destination digest is invalid");
  }
  if (typeof artifactRoot !== "string" || !path.isAbsolute(artifactRoot)) {
    fail("Artifact root must be an absolute temporary directory");
  }
  const root = fs.realpathSync(artifactRoot);
  if (!fs.statSync(root).isDirectory() || hasRepositoryParent(root)) {
    fail("Artifact root must not be a repository checkout");
  }
  const systemTemporaryRoot = fs.realpathSync(os.tmpdir());
  const relative = path.relative(systemTemporaryRoot, root);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    fail("Artifact root must be inside the system temporary directory");
  }
  const destinationPath = path.join(
    root,
    "functions",
    "form2_controller",
    "lib",
    "form-destination.js",
  );
  const resolvedDestination = fs.realpathSync(destinationPath);
  const expectedParent = fs.realpathSync(path.dirname(destinationPath));
  if (path.dirname(resolvedDestination) !== expectedParent) {
    fail("Form destination path may not traverse a link");
  }
  const source = fs.readFileSync(resolvedDestination, "utf8");
  if (source !== EXPECTED || source.split(SENTINEL).length !== 2) {
    fail("Form destination artifact is not the exact unstamped template");
  }
  const stamped = source.replace(SENTINEL, digest);
  const temporaryPath = `${resolvedDestination}.stamping`;
  fs.writeFileSync(temporaryPath, stamped, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temporaryPath, resolvedDestination);
}

if (require.main === module) {
  if (process.argv.length !== 3) fail("Expected exactly one artifact-root argument");
  stampFormDestination({ artifactRoot: process.argv[2] });
}

module.exports = { EXPECTED, SENTINEL, stampFormDestination };
