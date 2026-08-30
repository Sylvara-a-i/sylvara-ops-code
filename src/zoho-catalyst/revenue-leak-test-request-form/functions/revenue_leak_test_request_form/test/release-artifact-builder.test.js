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
const componentSubpath = "src/zoho-catalyst/revenue-leak-test-request-form";
const target = "revenue_leak_test_request_form";
const sentinel = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";
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
  for (const name of ["PATH", "Path", "ComSpec", "PATHEXT", "SystemRoot", "WINDIR"] ) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return {
    ...environment,
    ARTIFACT_OUTPUT_CANARY: "synthetic-secret-canary-must-not-appear",
    ...additions,
  };
}

function createFixture(testContext, mutateBeforeCommit) {
  const fixtureRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    "sylvara-request-release-builder-test-",
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
  const formsManifest = path.join(
    repository,
    "src/zoho-forms/free-revenue-leak-test/forms-manifest.json",
  );
  fs.mkdirSync(path.dirname(formsManifest), { recursive: true });
  fs.copyFileSync(
    path.join(repositoryRoot, "src/zoho-forms/free-revenue-leak-test/forms-manifest.json"),
    formsManifest,
  );
  const releaseContract = path.join(
    repository,
    "docs/product/free-revenue-leak-test-release-contract.json",
  );
  fs.mkdirSync(path.dirname(releaseContract), { recursive: true });
  fs.copyFileSync(
    path.join(repositoryRoot, "docs/product/free-revenue-leak-test-release-contract.json"),
    releaseContract,
  );
  mutateBeforeCommit?.({ copiedController, repository });

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
    output: path.join(artifactParent, "request-release"),
    repository,
    revision,
    tool: path.join(copiedController, "tools/build-release-artifact.js"),
  };
}

function runBuilder(fixture, {
  output = fixture.output,
  revision = fixture.revision,
  environment = processEnvironment(),
} = {}) {
  return spawnSync(process.execPath, [
    fixture.tool,
    "--approved-revision", revision,
    "--output", output,
  ], {
    cwd: fixture.repository,
    encoding: "utf8",
    env: environment,
    shell: false,
    timeout: 300_000,
    windowsHide: true,
  });
}

function canonicalEntries(files) {
  return files.map((entry) => `${JSON.stringify(entry.path)}\t${entry.bytes}\t${entry.sha256}\n`)
    .join("");
}

function verifyManifest(projectRoot, manifest) {
  const paths = manifest.files.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort());
  for (const entry of manifest.files) {
    const content = fs.readFileSync(path.join(projectRoot, ...entry.path.split("/")));
    assert.equal(content.length, entry.bytes);
    assert.equal(crypto.createHash("sha256").update(content).digest("hex"), entry.sha256);
  }
  assert.equal(
    crypto.createHash("sha256").update(canonicalEntries(manifest.files)).digest("hex"),
    manifest.aggregateSha256,
  );
}

function allRelativePaths(root) {
  const results = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory)) {
      const candidate = path.join(directory, name);
      const relative = path.relative(root, candidate).split(path.sep).join("/");
      const metadata = fs.lstatSync(candidate);
      assert.equal(metadata.isSymbolicLink(), false);
      if (metadata.isDirectory()) pending.push(candidate);
      else {
        assert.equal(metadata.isFile(), true);
        results.push(relative);
      }
    }
  }
  return results;
}

artifactTest("builds one immutable Catalyst project from the tested lock state", (testContext) => {
  const fixture = createFixture(testContext);
  const result = runBuilder(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /synthetic-secret-canary-must-not-appear/);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output, {
    projectRoot: fixture.output,
    manifestPath: path.join(fixture.output, "artifact-manifest.json"),
    sourceRevision: fixture.revision,
    functionTarget: target,
    aggregateSha256: output.aggregateSha256,
    deployed: false,
  });
  assert.match(output.aggregateSha256, /^[a-f0-9]{64}$/);

  const artifactFunction = path.join(fixture.output, "functions", target);
  assert.equal(fs.existsSync(path.join(artifactFunction, "node_modules")), true);
  assert.equal(
    fs.existsSync(path.join(artifactFunction, "node_modules", "zcatalyst-sdk-node")),
    true,
  );
  assert.match(
    fs.readFileSync(path.join(artifactFunction, "lib/source-revision.js"), "utf8"),
    new RegExp(fixture.revision),
  );
  assert.match(
    fs.readFileSync(path.join(fixture.copiedController, "functions", target,
      "lib/source-revision.js"), "utf8"),
    new RegExp(sentinel),
  );
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
  assert.deepEqual(packageJson.dependencies, { "zcatalyst-sdk-node": "3.4.0" });
  assert.equal(packageLock.packages[""].dependencies["zcatalyst-sdk-node"], "3.4.0");
  assert.equal(Object.keys(packageLock.packages).length > 1, true);

  const relativePaths = allRelativePaths(fixture.output);
  assert.equal(relativePaths.some((entry) => /(^|\/)\.git(\/|$)/.test(entry)), false);
  assert.equal(relativePaths.some((entry) => /(^|\/)\.catalystrc$/.test(entry)), false);
  assert.equal(relativePaths.some((entry) => /(^|\/)\.env(?:\.|$)/.test(entry)), false);
  assert.equal(relativePaths.some((entry) => /(^|\/)(?:test|tests|__tests__)(\/|$)/.test(entry)), false);
  assert.equal(relativePaths.some((entry) => /\.log$/i.test(entry)), false);
  const manifest = JSON.parse(fs.readFileSync(output.manifestPath, "utf8"));
  assert.equal(manifest.sourceRevision, fixture.revision);
  assert.equal(manifest.functionTarget, target);
  assert.equal(manifest.deployed, false);
  verifyManifest(fixture.output, manifest);
  assert.equal(runGit(fixture.repository,
    ["status", "--porcelain=v1", "--untracked-files=all"]), "");

  const builderSources = `${fs.readFileSync(fixture.tool, "utf8")}\n${
    fs.readFileSync(path.join(fixture.repository,
      "tools/build-catalyst-function-artifact.js"), "utf8")}`;
  assert.doesNotMatch(builderSources, /catalyst\s+deploy|spawnSync\(["']catalyst["']/i);
});

artifactTest("fails closed for dirty, wrong-revision, unsafe-output, and dependency drift", (testContext) => {
  const dirty = createFixture(testContext);
  fs.appendFileSync(path.join(dirty.copiedController, "README.md"), "\nsynthetic dirty state\n");
  let result = runBuilder(dirty);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout is not clean/);
  assert.equal(fs.existsSync(dirty.output), false);

  const wrongRevision = createFixture(testContext);
  const oldRevision = wrongRevision.revision;
  fs.appendFileSync(path.join(wrongRevision.copiedController, "README.md"), "\nnext revision\n");
  runGit(wrongRevision.repository, ["add", "--all"]);
  runGit(wrongRevision.repository,
    ["commit", "-q", "--no-gpg-sign", "--no-verify", "-m", "next"]);
  result = runBuilder(wrongRevision, { revision: oldRevision });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HEAD is not the exact approved immutable revision/);
  assert.equal(fs.existsSync(wrongRevision.output), false);

  const unsafeOutput = createFixture(testContext);
  result = runBuilder(unsafeOutput, {
    output: path.join(unsafeOutput.copiedController, "release-output"),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /output must be outside the repository/);

  const drift = createFixture(testContext, ({ copiedController }) => {
    const lockPath = path.join(copiedController, "functions", target, "package-lock.json");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.packages[""].name = "wrong-package";
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  });
  result = runBuilder(drift);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package and lock files do not bind/);
  assert.equal(fs.existsSync(drift.output), false);

  for (const hiddenFlag of ["--skip-worktree", "--assume-unchanged"]) {
    const hidden = createFixture(testContext);
    const sharedBuilder = "tools/build-catalyst-function-artifact.js";
    runGit(hidden.repository, ["update-index", hiddenFlag, sharedBuilder]);
    fs.appendFileSync(
      path.join(hidden.repository, ...sharedBuilder.split("/")),
      "\n// synthetic hidden working-tree change\n",
    );
    result = runBuilder(hidden);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /repository index contains hidden tracked state/);
    assert.equal(fs.existsSync(hidden.output), false);
  }

  const sourceTestMutation = createFixture(testContext, ({ copiedController }) => {
    const mutationTest = path.join(
      copiedController,
      "functions",
      target,
      "test",
      "synthetic-release-mutation.test.js",
    );
    fs.writeFileSync(mutationTest, `
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
test("cannot precreate the sibling release workspace", () => {
  const release = path.resolve(process.cwd(), "../../../../../..", "release");
  fs.mkdirSync(release, { recursive: true });
  fs.writeFileSync(path.join(release, "synthetic-backdoor.js"), "synthetic");
});
`, "utf8");
  });
  result = runBuilder(sourceTestMutation);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /release workspace appeared during isolated source tests/);
  assert.equal(fs.existsSync(sourceTestMutation.output), false);
});
