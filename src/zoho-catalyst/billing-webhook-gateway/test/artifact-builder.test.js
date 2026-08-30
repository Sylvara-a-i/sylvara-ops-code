"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const artifactTest = process.env.SYLVARA_OFFLINE_QUICK_VERIFY === "1" ? test.skip : test;
const { spawnSync } = require("node:child_process");

const {
  FUNCTION_TARGET,
  PRIVATE_BINDING_PATH,
  parseArguments,
} = require("../tools/build-development-artifact");

const packageRoot = path.resolve(__dirname, "..");
const componentPath = path.join("src", "zoho-catalyst", "billing-webhook-gateway");
const reviewedDestinationDigest = crypto.createHash("sha256")
  .update("synthetic reviewed Creator destination binding", "utf8")
  .digest("hex");

function run(command, args, cwd, environment = process.env) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    shell: false,
    windowsHide: true,
  });
}

function runOk(command, args, cwd, environment) {
  const result = run(command, args, cwd, environment);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function buildEnvironment(revision, digest = reviewedDestinationDigest) {
  const environment = { ...process.env };
  environment[["APPROVED", "SOURCE", "REVISION"].join("_")] = revision;
  environment[["APPROVED", "CREATOR", "DESTINATION", "SHA256"].join("_")] = digest;
  return environment;
}

function createFixture(parent) {
  const repository = path.join(parent, "repository");
  const component = path.join(repository, componentPath);
  fs.mkdirSync(path.dirname(component), { recursive: true });
  fs.cpSync(packageRoot, component, {
    recursive: true,
    filter(source) {
      const relative = path.relative(packageRoot, source);
      return !relative.split(path.sep).includes("node_modules");
    },
  });
  runOk("git", ["init"], repository);
  runOk("git", ["config", "user.name", "Billing Gateway Artifact Test"], repository);
  runOk("git", ["config", "user.email", "artifact-test@example.invalid"], repository);
  runOk("git", ["add", "--all"], repository);
  runOk("git", ["commit", "-m", "synthetic fixture"], repository);
  return {
    builder: path.join(component, "tools", "build-development-artifact.js"),
    component,
    repository,
    revision: runOk("git", ["rev-parse", "HEAD"], repository),
  };
}

function runBuilder(fixture, output, { digest, revision } = {}) {
  return run(
    process.execPath,
    [fixture.builder, "--output", output],
    fixture.component,
    buildEnvironment(revision || fixture.revision, digest || reviewedDestinationDigest),
  );
}

function fileMap(root) {
  const result = new Map();
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory)) {
      const candidate = path.join(directory, name);
      const metadata = fs.lstatSync(candidate);
      assert.equal(metadata.isSymbolicLink(), false);
      if (metadata.isDirectory()) pending.push(candidate);
      else if (metadata.isFile()) {
        result.set(path.relative(root, candidate).split(path.sep).join("/"),
          fs.readFileSync(candidate));
      }
    }
  }
  return result;
}

artifactTest("builder exports one deterministic Advanced I/O target and keeps private binding out of its manifest", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "billing-gateway-artifact-test-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const fixture = createFixture(parent);
  const firstOutput = path.join(parent, "artifact-one");
  const secondOutput = path.join(parent, "artifact-two");
  const checkoutRevisionPath = path.join(fixture.component, "lib", "source-revision.js");
  const checkoutDestinationPath = path.join(fixture.component, "lib", "creator-destination.js");
  const revisionBefore = fs.readFileSync(checkoutRevisionPath, "utf8");
  const destinationBefore = fs.readFileSync(checkoutDestinationPath, "utf8");

  const first = runBuilder(fixture, firstOutput);
  assert.equal(first.status, 0, first.stderr);
  const reported = JSON.parse(first.stdout);
  assert.equal(reported.functionTarget, FUNCTION_TARGET);
  assert.equal(reported.sourceRevision, fixture.revision);
  assert.equal(reported.deployed, false);
  assert.equal(path.resolve(reported.artifactRoot), path.resolve(firstOutput));

  assert.equal(fs.readFileSync(checkoutRevisionPath, "utf8"), revisionBefore);
  assert.equal(fs.readFileSync(checkoutDestinationPath, "utf8"), destinationBefore);
  assert.match(revisionBefore, /__SYLVARA_UNSTAMPED_SOURCE_REVISION__/);
  assert.match(destinationBefore, /__SYLVARA_UNSTAMPED_CREATOR_DESTINATION_SHA256__/);

  const catalyst = JSON.parse(fs.readFileSync(path.join(firstOutput, "catalyst.json"), "utf8"));
  assert.deepEqual(catalyst.functions.targets, [FUNCTION_TARGET]);
  const functionRoot = path.join(firstOutput, "functions", FUNCTION_TARGET);
  const functionConfig = JSON.parse(fs.readFileSync(
    path.join(functionRoot, "catalyst-config.json"),
    "utf8",
  ));
  assert.deepEqual(functionConfig.deployment, {
    name: FUNCTION_TARGET,
    stack: "node24",
    type: "advancedio",
  });

  const packageJson = JSON.parse(fs.readFileSync(path.join(functionRoot, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(functionRoot, "package-lock.json"), "utf8"));
  assert.equal(packageJson.name, FUNCTION_TARGET);
  assert.equal(packageJson.scripts, undefined);
  assert.deepEqual(packageJson.dependencies, { "zcatalyst-sdk-node": "3.4.0" });
  assert.equal(lock.name, FUNCTION_TARGET);
  assert.equal(lock.packages[""].name, FUNCTION_TARGET);

  const stampedRevision = fs.readFileSync(path.join(functionRoot, "lib", "source-revision.js"), "utf8");
  const stampedDestination = fs.readFileSync(
    path.join(functionRoot, "lib", "creator-destination.js"),
    "utf8",
  );
  assert.match(stampedRevision, new RegExp(fixture.revision));
  assert.match(stampedDestination, new RegExp(reviewedDestinationDigest));
  assert.doesNotMatch(stampedRevision, /__SYLVARA_UNSTAMPED_SOURCE_REVISION__/);
  assert.doesNotMatch(stampedDestination, /__SYLVARA_UNSTAMPED_CREATOR_DESTINATION_SHA256__/);

  const manifestText = fs.readFileSync(path.join(firstOutput, "release-manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.source_revision, fixture.revision);
  assert.equal(manifest.function_target, FUNCTION_TARGET);
  assert.equal(manifest.creator_destination_binding.value_disclosed, false);
  assert.equal(manifestText.includes(reviewedDestinationDigest), false);
  const privateEntry = manifest.files.find((entry) => entry.path === PRIVATE_BINDING_PATH);
  assert.deepEqual(privateEntry, {
    path: PRIVATE_BINDING_PATH,
    bytes: Buffer.byteLength(stampedDestination),
    sha256_disclosure: "omitted_private_destination_binding",
  });
  assert.equal(Object.hasOwn(privateEntry, "sha256"), false);
  for (const entry of manifest.files) {
    assert.doesNotMatch(entry.path, /(^|\/)test(\/|$)|(^|\/)\.env(?:\.|$)|\.md$|^tools\//i);
  }
  assert.equal(fs.existsSync(path.join(firstOutput, "README.md")), false);
  assert.equal(fs.existsSync(path.join(firstOutput, "config")), false);
  assert.equal(fs.existsSync(path.join(functionRoot, "node_modules")), false);
  assert.equal(runOk("git", ["status", "--porcelain=v1", "--untracked-files=all"],
    fixture.repository), "");

  const second = runBuilder(fixture, secondOutput);
  assert.equal(second.status, 0, second.stderr);
  const firstFiles = fileMap(firstOutput);
  const secondFiles = fileMap(secondOutput);
  assert.deepEqual([...secondFiles.keys()].sort(), [...firstFiles.keys()].sort());
  for (const [relative, content] of firstFiles) {
    assert.deepEqual(secondFiles.get(relative), content, relative);
  }
});

artifactTest("builder refuses wrong or dirty Git state and unsafe output or private inputs", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "billing-gateway-refusal-test-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const fixture = createFixture(parent);
  const output = path.join(parent, "artifact");
  assert.equal(runBuilder(fixture, output).status, 0);

  const existing = runBuilder(fixture, output);
  assert.notEqual(existing.status, 0);
  assert.match(existing.stderr, /must not already exist/);

  const inRepository = runBuilder(fixture, path.join(fixture.repository, "artifact"));
  assert.notEqual(inRepository.status, 0);
  assert.match(inRepository.stderr, /outside the Git repository/);

  const wrongRevision = `${fixture.revision[0] === "0" ? "1" : "0"}${fixture.revision.slice(1)}`;
  const wrong = runBuilder(fixture, path.join(parent, "wrong"), { revision: wrongRevision });
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /HEAD is not the exact approved source revision/);

  const invalidPrivateInput = runBuilder(fixture, path.join(parent, "invalid"), {
    digest: "invalid-digest",
  });
  assert.notEqual(invalidPrivateInput.status, 0);
  assert.match(invalidPrivateInput.stderr, /APPROVED_CREATOR_DESTINATION_SHA256 is missing or invalid/);
  assert.equal(invalidPrivateInput.stderr.includes(reviewedDestinationDigest), false);

  // The release gate covers the whole checkout, including changes outside this component.
  fs.writeFileSync(path.join(fixture.repository, "unrelated-dirty-file.txt"),
    "synthetic dirty state\n", "utf8");
  const dirty = runBuilder(fixture, path.join(parent, "dirty"));
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /repository checkout is not clean/);
});

artifactTest("builder fails closed when committed target metadata or stamp templates drift", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "billing-gateway-contract-test-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const fixture = createFixture(parent);
  const configPath = path.join(fixture.component, "catalyst-config.example.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.deployment.name = "unexpected_target";
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  runOk("git", ["add", "--all"], fixture.repository);
  runOk("git", ["commit", "-m", "synthetic target drift"], fixture.repository);
  fixture.revision = runOk("git", ["rev-parse", "HEAD"], fixture.repository);
  const targetDrift = runBuilder(fixture, path.join(parent, "target-drift"));
  assert.notEqual(targetDrift.status, 0);
  assert.match(targetDrift.stderr, /outside the exact Development target contract/);

  config.deployment.name = FUNCTION_TARGET;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const stampPath = path.join(fixture.component, "lib", "source-revision.js");
  fs.writeFileSync(stampPath, fs.readFileSync(stampPath, "utf8")
    .replace("__SYLVARA_UNSTAMPED_SOURCE_REVISION__", "already-stamped"), "utf8");
  runOk("git", ["add", "--all"], fixture.repository);
  runOk("git", ["commit", "-m", "synthetic stamp drift"], fixture.repository);
  fixture.revision = runOk("git", ["rev-parse", "HEAD"], fixture.repository);
  const stampDrift = runBuilder(fixture, path.join(parent, "stamp-drift"));
  assert.notEqual(stampDrift.status, 0);
  assert.match(stampDrift.stderr, /source revision template is not the exact unstamped form/);
});

artifactTest("builder CLI rejects deploy flags and ambiguous output arguments", () => {
  assert.deepEqual(parseArguments([]), { help: false, outputRoot: null });
  assert.deepEqual(parseArguments(["--output", "C:\\artifact"]), {
    help: false,
    outputRoot: "C:\\artifact",
  });
  assert.throws(() => parseArguments(["--deploy"]), /supported arguments/);
  assert.throws(() => parseArguments(["--output"]), /supported arguments/);
  assert.throws(() => parseArguments(["--help", "--output", "C:\\artifact"]),
    /cannot be combined/);
});
