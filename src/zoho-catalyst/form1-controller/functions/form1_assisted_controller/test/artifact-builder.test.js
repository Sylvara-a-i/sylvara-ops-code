"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const controllerRoot = path.resolve(__dirname, "../../..");
const repositoryControllerPath = "src/zoho-catalyst/form1-controller";
const sentinel = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";

function runGit(repository, arguments_, input) {
  const result = spawnSync(
    "git",
    ["-c", "commit.gpgsign=false", "-C", repository, ...arguments_],
    {
      encoding: "utf8",
      input,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function copyController(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (candidate) => path.basename(candidate) !== "node_modules",
  });
}

function createFixture(testContext, mutateBeforeCommit) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylvara-form1-builder-test-"));
  testContext.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
  const repository = path.join(fixtureRoot, "repository");
  const copiedController = path.join(repository, ...repositoryControllerPath.split("/"));
  const outputA = path.join(fixtureRoot, "output-a");
  const outputB = path.join(fixtureRoot, "output-b");
  const runtimeTemp = path.join(fixtureRoot, "runtime-temp");
  for (const directory of [repository, outputA, outputB, runtimeTemp]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  copyController(controllerRoot, copiedController);
  mutateBeforeCommit?.({ copiedController, repository });

  runGit(repository, ["init", "-q", "--object-format=sha1", "--template="]);
  runGit(repository, ["config", "user.name", "Synthetic Artifact Test"]);
  runGit(repository, ["config", "user.email", "artifact@example.invalid"]);
  runGit(repository, ["config", "core.symlinks", "false"]);
  runGit(repository, ["add", "--all"]);
  runGit(repository, ["commit", "-q", "--no-gpg-sign", "--no-verify", "-m", "fixture"]);
  const revision = runGit(repository, ["rev-parse", "HEAD"]);
  assert.match(revision, /^[a-f0-9]{40}$/);

  const tool = path.join(copiedController, "tools/build-single-file.js");
  const sourceRevision = path.join(
    copiedController,
    "functions/form1_assisted_controller/lib/source-revision.js",
  );
  const environment = {
    ...process.env,
    ARTIFACT_OUTPUT_CANARY: "synthetic-output-canary-must-not-appear",
    TEMP: runtimeTemp,
    TMP: runtimeTemp,
    TMPDIR: runtimeTemp,
  };
  return {
    copiedController,
    environment,
    fixtureRoot,
    outputA: path.join(outputA, "index.js"),
    outputB: path.join(outputB, "index.js"),
    repository,
    revision,
    runtimeTemp,
    sourceRevision,
    tool,
  };
}

function runBuilder(fixture, { output = fixture.outputA, revision = fixture.revision } = {}) {
  return spawnSync(
    process.execPath,
    [
      fixture.tool,
      "--approved-revision",
      revision,
      "--output",
      output,
    ],
    {
      cwd: fixture.repository,
      encoding: "utf8",
      env: fixture.environment,
      windowsHide: true,
    },
  );
}

function assertFailedWithoutOutput(result, output, pattern) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
  assert.equal(fs.existsSync(output), false);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /synthetic-output-canary-must-not-appear/);
}

test("builds the same stamped single-file artifact twice without mutating the checkout", (testContext) => {
  const fixture = createFixture(testContext);
  const initialRevisionTemplate = fs.readFileSync(fixture.sourceRevision, "utf8");

  const first = runBuilder(fixture);
  const second = runBuilder(fixture, { output: fixture.outputB });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, "Form 1 artifact built and verified.\n");
  assert.equal(second.stdout, first.stdout);
  const firstArtifact = fs.readFileSync(fixture.outputA, "utf8");
  const secondArtifact = fs.readFileSync(fixture.outputB, "utf8");
  assert.equal(firstArtifact, secondArtifact);
  assert.match(firstArtifact, new RegExp(fixture.revision));
  assert.doesNotMatch(firstArtifact, new RegExp(sentinel));
  assert.equal(fs.readFileSync(fixture.sourceRevision, "utf8"), initialRevisionTemplate);
  assert.match(initialRevisionTemplate, new RegExp(sentinel));
  assert.equal(runGit(fixture.repository, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
  assert.deepEqual(fs.readdirSync(fixture.runtimeTemp), []);
  assert.doesNotMatch(
    `${first.stdout}${first.stderr}`,
    /synthetic-output-canary-must-not-appear/,
  );
});

test("rejects a dirty checkout before creating an artifact", (testContext) => {
  const fixture = createFixture(testContext);
  fs.appendFileSync(path.join(fixture.copiedController, "README.md"), "\nsynthetic dirty change\n");
  const result = runBuilder(fixture);
  assertFailedWithoutOutput(result, fixture.outputA, /repository checkout is not clean/);
});

test("rejects a revision other than the checked-out approved commit", (testContext) => {
  const fixture = createFixture(testContext);
  const previousRevision = fixture.revision;
  fs.appendFileSync(path.join(fixture.copiedController, "README.md"), "\nsecond fixture commit\n");
  runGit(fixture.repository, ["add", "--all"]);
  runGit(fixture.repository, ["commit", "-q", "--no-gpg-sign", "--no-verify", "-m", "second"]);
  const result = runBuilder(fixture, { revision: previousRevision });
  assertFailedWithoutOutput(result, fixture.outputA, /HEAD is not the exact approved immutable revision/);
});

test("rejects a linked Git tree entry", (testContext) => {
  const fixture = createFixture(testContext, ({ copiedController }) => {
    fs.writeFileSync(
      path.join(copiedController, "functions/form1_assisted_controller/lib/escape.js"),
      "../../outside",
      "utf8",
    );
  });
  const linkRelative = `${repositoryControllerPath}/functions/form1_assisted_controller/lib/escape.js`;
  const linkPath = path.join(fixture.repository, ...linkRelative.split("/"));
  const blob = runGit(fixture.repository, ["hash-object", "-w", linkPath]);
  runGit(fixture.repository, ["update-index", "--cacheinfo", `120000,${blob},${linkRelative}`]);
  runGit(fixture.repository, ["commit", "-q", "--amend", "--no-gpg-sign", "--no-verify", "--no-edit"]);
  fixture.revision = runGit(fixture.repository, ["rev-parse", "HEAD"]);
  const result = runBuilder(fixture);
  assertFailedWithoutOutput(result, fixture.outputA, /linked or special files are not allowed/);
});

test("rejects a relative dependency that escapes the bundled function", (testContext) => {
  const fixture = createFixture(testContext, ({ copiedController }) => {
    fs.appendFileSync(
      path.join(copiedController, "functions/form1_assisted_controller/index.js"),
      "\nrequire('../outside');\n",
    );
  });
  const result = runBuilder(fixture);
  assertFailedWithoutOutput(result, fixture.outputA, /dependency escapes or is absent/);
});

test("rejects output inside the repository and refuses to overwrite an artifact", (testContext) => {
  const fixture = createFixture(testContext);
  const repositoryOutput = path.join(fixture.copiedController, "tools", "index.js");
  const insideResult = runBuilder(fixture, { output: repositoryOutput });
  assertFailedWithoutOutput(insideResult, repositoryOutput, /output must be outside the repository/);

  fs.writeFileSync(fixture.outputA, "existing artifact\n", "utf8");
  const overwriteResult = runBuilder(fixture);
  assert.notEqual(overwriteResult.status, 0);
  assert.match(overwriteResult.stderr, /artifact output already exists/);
  assert.equal(fs.readFileSync(fixture.outputA, "utf8"), "existing artifact\n");
});
