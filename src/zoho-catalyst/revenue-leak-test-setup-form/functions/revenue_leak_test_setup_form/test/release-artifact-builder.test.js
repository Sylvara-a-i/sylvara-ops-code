"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const functionRoot = path.resolve(__dirname, "..");
const controllerRoot = path.resolve(functionRoot, "../..");
const repositoryRoot = path.resolve(controllerRoot, "../../..");
const componentSubpath = "src/zoho-catalyst/revenue-leak-test-setup-form";
const target = "revenue_leak_test_setup_form";
const sourceSentinel = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";
const destinationSentinel = "__SYLVARA_UNSTAMPED_FORM_DESTINATION_SHA256__";
const approvedDestination = "c".repeat(64);
const innerVerification = process.env.SYLVARA_ARTIFACT_INNER_VERIFY === "1" ||
  process.env.SYLVARA_OFFLINE_QUICK_VERIFY === "1";
const artifactTest = innerVerification ? test.skip : test;

function copyTree(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (candidate) => path.basename(candidate) !== "node_modules",
  });
}

function runGit(repository, arguments_) {
  const result = spawnSync("git", [
    "-c", "commit.gpgsign=false",
    "-C", repository,
    ...arguments_,
  ], { encoding: "utf8", shell: false, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function processEnvironment(additions = {}) {
  const environment = {};
  for (const name of ["PATH", "Path", "ComSpec", "PATHEXT", "SystemRoot", "WINDIR"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return {
    ...environment,
    ARTIFACT_OUTPUT_CANARY: "synthetic-secret-canary-must-not-appear",
    ...additions,
  };
}

function createFixture(testContext) {
  const fixtureRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    "sylvara-setup-release-builder-test-",
  ));
  testContext.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
  const repository = path.join(fixtureRoot, "repository");
  const copiedController = path.join(repository, ...componentSubpath.split("/"));
  const artifactParent = path.join(fixtureRoot, "artifacts");
  fs.mkdirSync(path.dirname(copiedController), { recursive: true });
  fs.mkdirSync(artifactParent);
  copyTree(controllerRoot, copiedController);

  const sharedBuilder = path.join(repository, "tools/build-catalyst-function-artifact.js");
  fs.mkdirSync(path.dirname(sharedBuilder), { recursive: true });
  fs.copyFileSync(
    path.join(repositoryRoot, "tools/build-catalyst-function-artifact.js"),
    sharedBuilder,
  );
  const workflow = path.join(repository, ".github/workflows/repo-checks.yml");
  fs.mkdirSync(path.dirname(workflow), { recursive: true });
  fs.copyFileSync(path.join(repositoryRoot, ".github/workflows/repo-checks.yml"), workflow);
  fs.copyFileSync(
    path.join(repositoryRoot, "catalyst-pipelines.yaml"),
    path.join(repository, "catalyst-pipelines.yaml"),
  );
  const formsManifest = path.join(
    repository,
    "src/zoho-forms/free-revenue-leak-test/forms-manifest.json",
  );
  fs.mkdirSync(path.dirname(formsManifest), { recursive: true });
  fs.copyFileSync(
    path.join(repositoryRoot, "src/zoho-forms/free-revenue-leak-test/forms-manifest.json"),
    formsManifest,
  );
  for (const relativePath of [
    "src/zoho-crm/free-revenue-leak-test/config/caller-manifest.json",
    "src/zoho-crm/free-revenue-leak-test/functions/issue_revenue_leak_test_setup.deluge",
  ]) {
    const destination = path.join(repository, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, ...relativePath.split("/")), destination);
  }

  runGit(repository, ["init", "-q", "--object-format=sha1", "--template="]);
  runGit(repository, ["config", "user.name", "Synthetic Artifact Test"]);
  runGit(repository, ["config", "user.email", "artifact@example.invalid"]);
  runGit(repository, ["config", "core.symlinks", "false"]);
  runGit(repository, ["add", "--all"]);
  runGit(repository, ["commit", "-q", "--no-gpg-sign", "--no-verify", "-m", "fixture"]);
  const revision = runGit(repository, ["rev-parse", "HEAD"]);
  assert.match(revision, /^[a-f0-9]{40}$/);
  return {
    artifactParent,
    copiedController,
    output: path.join(artifactParent, "setup-release"),
    repository,
    revision,
    tool: path.join(copiedController, "tools/build-release-artifact.js"),
  };
}

function runBuilder(fixture, {
  arguments_ = [
    "--approved-revision", fixture.revision,
    "--output", fixture.output,
  ],
  environment = processEnvironment({
    APPROVED_FORM2_DESTINATION_SHA256: approvedDestination,
  }),
} = {}) {
  return spawnSync(process.execPath, [fixture.tool, ...arguments_], {
    cwd: fixture.repository,
    encoding: "utf8",
    env: environment,
    shell: false,
    timeout: 300_000,
    windowsHide: true,
  });
}

function verifyManifest(projectRoot, manifest) {
  const paths = manifest.files.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort());
  const canonical = [];
  for (const entry of manifest.files) {
    const content = fs.readFileSync(path.join(projectRoot, ...entry.path.split("/")));
    assert.equal(content.length, entry.bytes);
    assert.equal(crypto.createHash("sha256").update(content).digest("hex"), entry.sha256);
    canonical.push(`${JSON.stringify(entry.path)}\t${entry.bytes}\t${entry.sha256}\n`);
  }
  assert.equal(
    crypto.createHash("sha256").update(canonical.join("")).digest("hex"),
    manifest.aggregateSha256,
  );
}

function assertCleanArtifact(root) {
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory)) {
      const candidate = path.join(directory, name);
      const metadata = fs.lstatSync(candidate);
      assert.equal(metadata.isSymbolicLink(), false);
      const lower = name.toLowerCase();
      assert.equal(lower === ".git" || lower === ".catalystrc"
        || lower === ".env" || lower.startsWith(".env."), false);
      assert.equal(new Set(["test", "tests", "__tests__", "logs"]).has(lower), false);
      assert.equal(lower.endsWith(".log"), false);
      if (metadata.isDirectory()) pending.push(candidate);
      else assert.equal(metadata.isFile(), true);
    }
  }
}

artifactTest("builds a stamped immutable Setup CLI project without disclosing the destination digest", (
  testContext,
) => {
  const fixture = createFixture(testContext);
  const result = runBuilder(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(approvedDestination));
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /synthetic-secret-canary-must-not-appear/);
  const output = JSON.parse(result.stdout);
  assert.equal(output.projectRoot, fixture.output);
  assert.equal(output.manifestPath, path.join(fixture.output, "artifact-manifest.json"));
  assert.equal(output.sourceRevision, fixture.revision);
  assert.equal(output.functionTarget, target);
  assert.match(output.aggregateSha256, /^[a-f0-9]{64}$/);
  assert.equal(output.deployed, false);

  const artifactFunction = path.join(fixture.output, "functions", target);
  assert.equal(fs.existsSync(path.join(artifactFunction, "node_modules/zcatalyst-sdk-node")), true);
  const artifactRevision = fs.readFileSync(path.join(
    artifactFunction,
    "lib/source-revision.js",
  ), "utf8");
  const artifactDestination = fs.readFileSync(path.join(
    artifactFunction,
    "lib/form-destination.js",
  ), "utf8");
  assert.match(artifactRevision, new RegExp(fixture.revision));
  assert.doesNotMatch(artifactRevision, new RegExp(sourceSentinel));
  assert.match(artifactDestination, new RegExp(approvedDestination));
  assert.doesNotMatch(artifactDestination, new RegExp(destinationSentinel));
  assert.match(fs.readFileSync(path.join(fixture.copiedController, "functions", target,
    "lib/source-revision.js"), "utf8"), new RegExp(sourceSentinel));
  assert.match(fs.readFileSync(path.join(fixture.copiedController, "functions", target,
    "lib/form-destination.js"), "utf8"), new RegExp(destinationSentinel));

  const packageJson = JSON.parse(fs.readFileSync(path.join(artifactFunction, "package.json"), "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(path.join(artifactFunction,
    "package-lock.json"), "utf8"));
  const catalystConfig = JSON.parse(fs.readFileSync(path.join(artifactFunction,
    "catalyst-config.json"), "utf8"));
  assert.deepEqual(
    [path.basename(artifactFunction), packageJson.name, packageLock.name,
      packageLock.packages[""].name, catalystConfig.deployment.name],
    Array(5).fill(target),
  );
  assertCleanArtifact(fixture.output);
  const manifest = JSON.parse(fs.readFileSync(output.manifestPath, "utf8"));
  assert.equal(manifest.sourceRevision, fixture.revision);
  assert.equal(manifest.functionTarget, target);
  assert.equal(manifest.deployed, false);
  assert.doesNotMatch(JSON.stringify(manifest), new RegExp(approvedDestination));
  verifyManifest(fixture.output, manifest);
  assert.equal(runGit(fixture.repository,
    ["status", "--porcelain=v1", "--untracked-files=all"]), "");

  const builderSources = `${fs.readFileSync(fixture.tool, "utf8")}\n${
    fs.readFileSync(path.join(fixture.repository,
      "tools/build-catalyst-function-artifact.js"), "utf8")}`;
  assert.doesNotMatch(builderSources, /catalyst\s+deploy|spawnSync\(["']catalyst["']/i);
});

artifactTest("requires the destination digest only through its environment and leaves no output on failure", (
  testContext,
) => {
  const fixture = createFixture(testContext);
  let result = runBuilder(fixture, { environment: processEnvironment() });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APPROVED_FORM2_DESTINATION_SHA256 is missing or invalid/);
  assert.equal(fs.existsSync(fixture.output), false);

  const invalidDigest = "private-invalid-digest-canary";
  result = runBuilder(fixture, {
    environment: processEnvironment({ APPROVED_FORM2_DESTINATION_SHA256: invalidDigest }),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APPROVED_FORM2_DESTINATION_SHA256 is missing or invalid/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(invalidDigest));
  assert.equal(fs.existsSync(fixture.output), false);

  result = runBuilder(fixture, {
    arguments_: [
      "--approved-revision", fixture.revision,
      "--output", fixture.output,
      "--approved-form2-destination-sha256", approvedDestination,
    ],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected --approved-revision/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(approvedDestination));
  assert.equal(fs.existsSync(fixture.output), false);
});
