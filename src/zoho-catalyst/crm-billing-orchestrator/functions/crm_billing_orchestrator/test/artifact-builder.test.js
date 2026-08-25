"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const builderPath = path.resolve(__dirname, "../../../scripts/build-development-artifact.js");
const {
  FUNCTION_TARGET,
  catalystDeployArguments,
  stampArtifact,
  validateArtifactTree,
  validateLockfile,
} = require(builderPath);

const SOURCE_TEMPLATE = `"use strict";\n\nconst ARTIFACT_SOURCE_REVISION = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";\nconst ARTIFACT_DEVELOPMENT_ZAID_HMAC_SHA256 =\n  "__SYLVARA_UNSTAMPED_DEVELOPMENT_ZAID_HMAC_SHA256__";\n\nmodule.exports = { ARTIFACT_DEVELOPMENT_ZAID_HMAC_SHA256, ARTIFACT_SOURCE_REVISION };\n`;
const SYNTHETIC_ZAID = "synthetic-z";
const SYNTHETIC_PROOF = "synthetic-runtime-proof-with-at-least-thirty-two-bytes";
const DEPLOY_FIXTURE_VALUE = "synthetic-catalyst-credential";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true,
    ...options,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function syntheticRepository(testContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crm-billing-artifact-test-"));
  testContext.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const artifactParent = path.join(root, "artifacts");
  const component = path.join(repository, "src/zoho-catalyst/crm-billing-orchestrator");
  const functionRoot = path.join(component, "functions", FUNCTION_TARGET);
  fs.mkdirSync(path.join(component, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(functionRoot, "lib"), { recursive: true });
  fs.mkdirSync(artifactParent);
  fs.copyFileSync(builderPath, path.join(component, "scripts", path.basename(builderPath)));
  writeJson(path.join(component, "catalyst.json"), {
    functions: {
      source: "functions",
      targets: [FUNCTION_TARGET],
      ignore: ["test/**", ".env*"],
    },
  });
  writeJson(path.join(functionRoot, "package.json"), {
    name: FUNCTION_TARGET,
    version: "1.0.0",
    private: true,
    main: "index.js",
    dependencies: {},
  });
  writeJson(path.join(functionRoot, "package-lock.json"), {
    name: FUNCTION_TARGET,
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: FUNCTION_TARGET, version: "1.0.0", dependencies: {} },
    },
  });
  fs.writeFileSync(path.join(functionRoot, "index.js"), "module.exports = () => undefined;\n", "utf8");
  fs.writeFileSync(path.join(functionRoot, "lib", "source-revision.js"), SOURCE_TEMPLATE, "utf8");
  fs.writeFileSync(path.join(component, "README.md"), "# Synthetic fixture\n", "utf8");

  run("git", ["init", "-q", repository]);
  run("git", ["-C", repository, "config", "user.name", "Synthetic Artifact Test"]);
  run("git", ["-C", repository, "config", "user.email", "artifact-test@example.invalid"]);
  run("git", ["-C", repository, "add", "--all"]);
  run("git", ["-C", repository, "commit", "-q", "--no-gpg-sign", "--no-verify", "-m", "fixture"]);
  const revision = run("git", ["-C", repository, "rev-parse", "HEAD"]);
  assert.match(revision, /^[a-f0-9]{40}$/);
  return {
    artifactParent,
    component,
    repository,
    revision,
    script: path.join(component, "scripts", path.basename(builderPath)),
  };
}

function builderEnvironment(fixture) {
  return {
    ...process.env,
    APPROVED_SOURCE_REVISION: fixture.revision,
    CATALYST_DEVELOPMENT_ZAID: SYNTHETIC_ZAID,
    DEVELOPMENT_RUNTIME_PROOF: SYNTHETIC_PROOF,
    TEMP: fixture.artifactParent,
    TMP: fixture.artifactParent,
    TMPDIR: fixture.artifactParent,
  };
}

test("builder accepts an 11-character ZAID, exports clean Git state, and never deploys by default", (testContext) => {
  assert.equal(SYNTHETIC_ZAID.length, 11);
  const fixture = syntheticRepository(testContext);
  const result = spawnSync(process.execPath, [fixture.script], {
    cwd: fixture.repository,
    encoding: "utf8",
    env: builderEnvironment(fixture),
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    timeout: 120_000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.sourceRevision, fixture.revision);
  assert.equal(output.functionTarget, FUNCTION_TARGET);
  assert.equal(output.deployed, false);
  assert.ok(fs.realpathSync(output.artifactRoot).startsWith(fs.realpathSync(fixture.artifactParent)));
  assert.ok(fs.statSync(output.manifestPath).isFile());

  const checkoutStamp = fs.readFileSync(
    path.join(fixture.component, "functions", FUNCTION_TARGET, "lib", "source-revision.js"),
    "utf8",
  );
  const artifactStamp = fs.readFileSync(
    path.join(output.projectRoot, "functions", FUNCTION_TARGET, "lib", "source-revision.js"),
    "utf8",
  );
  const digest = crypto.createHmac("sha256", SYNTHETIC_PROOF).update(SYNTHETIC_ZAID).digest("hex");
  assert.match(checkoutStamp, /__SYLVARA_UNSTAMPED_SOURCE_REVISION__/);
  assert.match(checkoutStamp, /__SYLVARA_UNSTAMPED_DEVELOPMENT_ZAID_HMAC_SHA256__/);
  assert.match(artifactStamp, new RegExp(fixture.revision));
  assert.match(artifactStamp, new RegExp(digest));
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(SYNTHETIC_ZAID));
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(SYNTHETIC_PROOF));
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(digest));
  assert.equal(run("git", ["-C", fixture.repository, "status", "--porcelain=v1", "--untracked-files=all"]), "");

  const rootsBeforeDirtyFailure = fs.readdirSync(fixture.artifactParent).sort();
  fs.writeFileSync(path.join(fixture.component, "README.md"), "dirty fixture\n", "utf8");
  const dirty = spawnSync(process.execPath, [fixture.script], {
    cwd: fixture.repository,
    encoding: "utf8",
    env: builderEnvironment(fixture),
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /repository checkout is not clean/);
  assert.deepEqual(fs.readdirSync(fixture.artifactParent).sort(), rootsBeforeDirtyFailure);
  assert.doesNotMatch(`${dirty.stdout}${dirty.stderr}`, new RegExp(SYNTHETIC_ZAID));
  assert.doesNotMatch(`${dirty.stdout}${dirty.stderr}`, new RegExp(SYNTHETIC_PROOF));
});

test("builder rejects empty, control-character, and oversized ZAIDs", (testContext) => {
  const fixture = syntheticRepository(testContext);
  const rootsBefore = fs.readdirSync(fixture.artifactParent).sort();
  const invalidZaids = ["", "synthetic\tzaid", "z".repeat(4097)];

  for (const zaid of invalidZaids) {
    const result = spawnSync(process.execPath, [fixture.script], {
      cwd: fixture.repository,
      encoding: "utf8",
      env: { ...builderEnvironment(fixture), CATALYST_DEVELOPMENT_ZAID: zaid },
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
      timeout: 30_000,
      windowsHide: true,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CATALYST_DEVELOPMENT_ZAID is missing or invalid/);
    assert.equal(result.stdout, "");
    assert.deepEqual(fs.readdirSync(fixture.artifactParent).sort(), rootsBefore);
    if (zaid) assert.doesNotMatch(result.stderr, new RegExp(zaid.replace(/\t/g, "\\t")));
  }
});

test("deploy arguments are hard-scoped to the one Development function", () => {
  const args = catalystDeployArguments({
    CATALYST_PROJECT_ID: "100000000000001",
    CATALYST_ORG_ID: "100000000000002",
    CATALYST_TOKEN: DEPLOY_FIXTURE_VALUE,
    CONFIRM_CATALYST_DEVELOPMENT_DEPLOY: FUNCTION_TARGET,
  });
  assert.deepEqual(args, [
    "deploy",
    "--only", `functions:${FUNCTION_TARGET}`,
    "--ignore-scripts",
    "--project", "100000000000001",
    "--org", "100000000000002",
    "--dc", "us",
  ]);
  assert.equal(args.includes(DEPLOY_FIXTURE_VALUE), false);
  assert.doesNotMatch(JSON.stringify(args), /credential/i);
  assert.throws(() => catalystDeployArguments({
    CATALYST_PROJECT_ID: "100000000000001",
    CATALYST_ORG_ID: "100000000000002",
    CATALYST_TOKEN: DEPLOY_FIXTURE_VALUE,
  }), /confirmation is missing/);
});

test("lockfile validation rejects local, linked, and escaping dependency sources", (testContext) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crm-billing-lock-test-"));
  testContext.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJson(path.join(root, "package.json"), {
    name: FUNCTION_TARGET,
    version: "1.0.0",
    dependencies: { unsafe: "file:../../outside" },
  });
  writeJson(path.join(root, "package-lock.json"), {
    name: FUNCTION_TARGET,
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": { name: FUNCTION_TARGET, version: "1.0.0", dependencies: { unsafe: "file:../../outside" } },
      "../outside": { link: true, resolved: "file:../../outside" },
    },
  });
  assert.throws(() => validateLockfile(root), /dependency declaration|escaping or linked/);
});

test("the committed component lockfile stays inside the approved registry boundary", () => {
  validateLockfile(path.resolve(__dirname, ".."));
});

test("artifact validation rejects a symbolic-link escape", (testContext) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crm-billing-symlink-test-"));
  testContext.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifact = path.join(root, "artifact");
  const outside = path.join(root, "outside");
  fs.mkdirSync(artifact);
  fs.mkdirSync(outside);
  try {
    fs.symlinkSync(outside, path.join(artifact, "escape"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    testContext.skip(`symbolic links unavailable: ${error.code}`);
    return;
  }
  assert.throws(() => validateArtifactTree(artifact), /symbolic link escapes/);
});

test("stamping rejects an already stamped or incomplete template", (testContext) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crm-billing-stamp-test-"));
  testContext.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stamp = path.join(root, "functions", FUNCTION_TARGET, "lib", "source-revision.js");
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, SOURCE_TEMPLATE.replace(
    "__SYLVARA_UNSTAMPED_SOURCE_REVISION__",
    "a".repeat(40),
  ), "utf8");
  assert.throws(() => stampArtifact(root, "b".repeat(40), SYNTHETIC_ZAID, SYNTHETIC_PROOF), /unstamped form/);
});
