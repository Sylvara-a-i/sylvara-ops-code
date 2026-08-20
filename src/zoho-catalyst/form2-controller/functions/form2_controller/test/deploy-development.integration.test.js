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
const supportedRunner = process.platform === "linux" && process.arch === "x64";
const syntheticToken = "0123456789abcdef0123456789abcdef";

function findExecutable(name) {
  for (const entry of (process.env.PATH || "").split(path.delimiter)) {
    if (!entry) {
      continue;
    }
    const candidate = path.resolve(entry, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Keep searching the approved runner PATH.
    }
  }
  throw new Error(`${name} is unavailable`);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function writeExecutable(filePath, lines) {
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

function writeStartupProbe(filePath, realExecutable, evidencePath, label) {
  writeExecutable(filePath, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "[[ -z \"${CATALYST_TOKEN+x}\" ]]",
    "[[ -z \"${NODE_OPTIONS+x}\" ]]",
    "while IFS= read -r inherited_name; do",
    "  case \"$inherited_name\" in",
    "    GIT_*|npm_config_*|NPM_CONFIG_*) exit 71 ;;",
    "  esac",
    "done < <(compgen -v)",
    "printf '%s\\n' " + shellQuote(`startup-clean=${label}`) + " >> " + shellQuote(evidencePath),
    "exec " + shellQuote(realExecutable) + " \"$@\"",
  ]);
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30_000,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
  );
  return result;
}

function gitEnvironment(home) {
  const environment = { ...process.env, HOME: home };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) {
      delete environment[name];
    }
  }
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  delete environment.XDG_CONFIG_HOME;
  return environment;
}

function snapshotTree(root) {
  const entries = [];
  function visit(directory, relativeDirectory = "") {
    for (const name of fs.readdirSync(directory).sort()) {
      const relativePath = path.posix.join(
        relativeDirectory.split(path.sep).join(path.posix.sep),
        name,
      );
      if (relativePath === ".git" || relativePath.startsWith(".git/")) {
        continue;
      }
      const absolutePath = path.join(directory, name);
      const metadata = fs.lstatSync(absolutePath);
      const mode = metadata.mode & 0o7777;
      if (metadata.isDirectory()) {
        entries.push([relativePath, "directory", mode]);
        visit(absolutePath, relativePath);
      } else if (metadata.isSymbolicLink()) {
        entries.push([relativePath, "symlink", mode, fs.readlinkSync(absolutePath)]);
      } else if (metadata.isFile()) {
        const digest = crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
        entries.push([relativePath, "file", mode, metadata.size, digest]);
      } else {
        entries.push([relativePath, "special", mode]);
      }
    }
  }
  visit(root);
  return entries;
}

function createFixture(testContext, scenario) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sylvara-deploy-integration-"));
  testContext.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));

  const repo = path.join(fixtureRoot, "repo");
  const stubBin = path.join(fixtureRoot, "stub-bin");
  const fakeNodeTree = path.join(fixtureRoot, "fake-node-tree");
  const fakeNodeRoot = path.join(fakeNodeTree, "node-v24.19.0-linux-x64");
  const fakeNodeBin = path.join(fakeNodeRoot, "bin");
  const runtimeTmp = path.join(fixtureRoot, "runtime-tmp");
  const evidence = path.join(fixtureRoot, "events.log");
  const outsideTarget = path.join(fixtureRoot, "outside-target");
  const gitHome = path.join(fixtureRoot, "git-home");
  for (const directory of [repo, stubBin, fakeNodeBin, runtimeTmp, gitHome]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(evidence, "", "utf8");
  fs.writeFileSync(outsideTarget, "synthetic outside target\n", "utf8");

  const copiedController = path.join(repo, "src/zoho-catalyst/form2-controller");
  fs.mkdirSync(path.dirname(copiedController), { recursive: true });
  fs.cpSync(controllerRoot, copiedController, {
    recursive: true,
    filter: (source) => path.basename(source) !== "node_modules",
  });
  const copiedDeployScript = path.join(copiedController, "scripts/deploy-development.sh");
  fs.chmodSync(copiedDeployScript, 0o755);
  fs.copyFileSync(
    path.join(repositoryRoot, "catalyst-pipelines.yaml"),
    path.join(repo, "catalyst-pipelines.yaml"),
  );
  const safetyScript = path.join(repo, "tools/safety/pre-commit-safety-check.py");
  fs.mkdirSync(path.dirname(safetyScript), { recursive: true });
  fs.writeFileSync(safetyScript, "raise SystemExit(0)\n", "utf8");
  const canaryRelative = "src/zoho-catalyst/form2-controller/functions/form2_controller/IGNORED_CHECKOUT_CANARY";
  fs.writeFileSync(path.join(repo, ".gitignore"), `/${canaryRelative}\n`, "utf8");
  const canaryPath = path.join(repo, canaryRelative);
  fs.writeFileSync(canaryPath, "ignored checkout canary\n", "utf8");

  const realGit = findExecutable("git");
  const realDirname = findExecutable("dirname");
  const realEnv = findExecutable("env");
  const realTar = findExecutable("tar");
  const realSha256sum = findExecutable("sha256sum");
  const realUname = findExecutable("uname");
  const gitEnv = gitEnvironment(gitHome);
  runChecked(realGit, ["init", "-q", "--object-format=sha1", "--template=", repo], { env: gitEnv });
  runChecked(realGit, ["-C", repo, "config", "user.name", "Synthetic Deploy Test"], { env: gitEnv });
  runChecked(realGit, ["-C", repo, "config", "user.email", "deploy-test@example.invalid"], { env: gitEnv });
  runChecked(realGit, ["-C", repo, "add", "--all"], { env: gitEnv });
  runChecked(realGit, ["-C", repo, "commit", "-q", "--no-gpg-sign", "--no-verify", "-m", "fixture"], {
    env: gitEnv,
  });
  const head = runChecked(realGit, ["-C", repo, "rev-parse", "HEAD"], { env: gitEnv }).stdout.trim();
  assert.match(head, /^[a-f0-9]{40}$/);

  const replacementCanaryRelative =
    "src/zoho-catalyst/form2-controller/functions/form2_controller/REPLACEMENT_EXPORT_CANARY";
  if (scenario === "replacement-ref") {
    const replacementIndex = path.join(fixtureRoot, "replacement-index");
    const replacementEnv = { ...gitEnv, GIT_INDEX_FILE: replacementIndex };
    runChecked(realGit, ["-C", repo, "read-tree", head], { env: replacementEnv });
    const replacementBlob = runChecked(realGit, ["-C", repo, "hash-object", "-w", "--stdin"], {
      env: gitEnv,
      input: "replacement export canary\n",
    }).stdout.trim();
    assert.match(replacementBlob, /^[a-f0-9]{40}$/);
    runChecked(realGit, [
      "-C",
      repo,
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${replacementBlob},${replacementCanaryRelative}`,
    ], { env: replacementEnv });
    const replacementTree = runChecked(realGit, ["-C", repo, "write-tree"], {
      env: replacementEnv,
    }).stdout.trim();
    const replacementCommit = runChecked(realGit, [
      "-C",
      repo,
      "commit-tree",
      replacementTree,
      "-p",
      head,
    ], { env: gitEnv, input: "synthetic replacement commit\n" }).stdout.trim();
    runChecked(realGit, ["-C", repo, "replace", head, replacementCommit], { env: gitEnv });

    const replacementAwareEnv = { ...gitEnv };
    delete replacementAwareEnv.GIT_NO_REPLACE_OBJECTS;
    const replacedPaths = runChecked(realGit, [
      "-C",
      repo,
      "ls-tree",
      "-r",
      "--name-only",
      head,
    ], { env: replacementAwareEnv }).stdout.split(/\r?\n/);
    assert.ok(replacedPaths.includes(replacementCanaryRelative));
  }

  const realNode = process.execPath;
  writeExecutable(path.join(fakeNodeBin, "node"), [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "if [[ $# -eq 1 && $1 == --version ]]; then",
    "  printf '%s\\n' 'v24.19.0'",
    "  exit 0",
    "fi",
    "exec " + shellQuote(realNode) + " \"$@\"",
  ]);

  writeExecutable(path.join(fakeNodeBin, "npm"), [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "scenario=" + shellQuote(scenario),
    "evidence_path=" + shellQuote(evidence),
    "escape_target=" + shellQuote(outsideTarget),
    "[[ -z \"${CATALYST_TOKEN+x}\" ]]",
    "[[ -z \"${NODE_OPTIONS+x}\" ]]",
    "[[ -z \"${npm_config_registry+x}\" ]]",
    "[[ -z \"${NPM_CONFIG_USERCONFIG+x}\" ]]",
    "prefix=''",
    "declare -a positional=()",
    "while (($# > 0)); do",
    "  case \"$1\" in",
    "    --prefix)",
    "      [[ $# -ge 2 ]]",
    "      prefix=\"$2\"",
    "      shift 2",
    "      ;;",
    "    --prefix=*)",
    "      prefix=\"${1#*=}\"",
    "      shift",
    "      ;;",
    "    --ignore-scripts|--omit=dev|--no-audit|--no-fund|--all)",
    "      shift",
    "      ;;",
    "    *)",
    "      positional+=(\"$1\")",
    "      shift",
    "      ;;",
    "  esac",
    "done",
    "set -- \"${positional[@]}\"",
    "[[ -n \"$prefix\" ]]",
    "case \"${1:-}\" in",
    "  ci)",
    "    rm -rf -- \"$prefix/node_modules\"",
    "    mkdir -p -- \"$prefix/node_modules/fixture\"",
    "    printf '%s\\n' 'module.exports = 1;' > \"$prefix/node_modules/fixture/index.js\"",
    "    [[ ! -e \"$prefix/REPLACEMENT_EXPORT_CANARY\" ]]",
    "    if [[ \"$scenario\" == escape-symlink && \"$prefix\" == */test-export/* ]]; then",
    "      ln -s -- \"$escape_target\" \"$prefix/node_modules/escape\"",
    "    fi",
    "    if [[ \"$scenario\" == deploy-source-mutation && \"$prefix\" == */deploy-export/* ]]; then",
    "      printf '%s\\n' '// deploy npm mutation' >> \"$prefix/index.js\"",
    "    fi",
    "    if [[ \"$scenario\" == nested-node-modules && \"$prefix\" == */deploy-export/* ]]; then",
    "      mkdir -p -- \"$prefix/lib/node_modules/zcatalyst-sdk-node\"",
    "      printf '%s\\n' 'module.exports = { injected: true };' > \"$prefix/lib/node_modules/zcatalyst-sdk-node/index.js\"",
    "    fi",
    "    ;;",
    "  run)",
    "    [[ \"${2:-}\" == ci ]]",
    "    if [[ \"$prefix\" == */test-export/* ]]; then",
    "      printf '%s\\n' 'module.exports = true;' > \"$prefix/lib/TEST_EXPORT_MUTATION.js\"",
    "      printf '%s\\n' 'test-mutation-created' >> \"$evidence_path\"",
    "    fi",
    "    ;;",
    "  ls)",
    "    ;;",
    "  *)",
    "    printf '%s\\n' \"unexpected npm command: ${1:-missing}\" >&2",
    "    exit 64",
    "    ;;",
    "esac",
  ]);

  const nodeArchive = path.join(fixtureRoot, "fake-node.tar.xz");
  runChecked(realTar, [
    "--create",
    "--xz",
    "--file",
    nodeArchive,
    "--directory",
    fakeNodeTree,
    "node-v24.19.0-linux-x64",
  ]);

  writeExecutable(path.join(stubBin, "curl"), [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "archive=" + shellQuote(nodeArchive),
    "output=''",
    "while (($# > 0)); do",
    "  if [[ \"$1\" == --output ]]; then",
    "    [[ $# -ge 2 ]]",
    "    output=\"$2\"",
    "    shift 2",
    "  else",
    "    shift",
    "  fi",
    "done",
    "[[ -n \"$output\" ]]",
    "cp -- \"$archive\" \"$output\"",
  ]);
  writeExecutable(path.join(stubBin, "sha256sum"), [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "for argument in \"$@\"; do",
    "  if [[ \"$argument\" == --check ]]; then",
    "    cat >/dev/null",
    "    exit 0",
    "  fi",
    "done",
    "exec " + shellQuote(realSha256sum) + " \"$@\"",
  ]);
  writeExecutable(path.join(stubBin, "catalyst"), [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "real_node=" + shellQuote(realNode),
    "repo_root=" + shellQuote(repo),
    "expected_head=" + shellQuote(head),
    "evidence_path=" + shellQuote(evidence),
    "expected_token=" + shellQuote(syntheticToken),
    "scenario=" + shellQuote(scenario),
    "if [[ \"${1:-}\" == -v ]]; then",
    "  printf '%s\\n' 'Catalyst CLI 1.26.1'",
    "  exit 0",
    "fi",
    "[[ \"${1:-}\" == deploy ]]",
    "[[ -z \"${CATALYST_TOKEN+x}\" ]]",
    "function_root=\"$PWD/functions/form2_controller\"",
    "[[ \"$PWD\" == */deploy-export/src/zoho-catalyst/form2-controller ]]",
    "[[ ! -e \"$function_root/IGNORED_CHECKOUT_CANARY\" ]]",
    "[[ ! -e \"$function_root/REPLACEMENT_EXPORT_CANARY\" ]]",
    "[[ ! -e \"$function_root/lib/TEST_EXPORT_MUTATION.js\" ]]",
    "token=''",
    "while (($# > 0)); do",
    "  if [[ \"$1\" == --token ]]; then",
    "    [[ $# -ge 2 ]]",
    "    token=\"$2\"",
    "    shift 2",
    "  else",
    "    shift",
    "  fi",
    "done",
    "[[ \"$token\" == \"$expected_token\" ]]",
    "artifact=\"$(\"$real_node\" -e 'process.stdout.write(require(process.argv[1]).ARTIFACT_SOURCE_REVISION)' \"$function_root/lib/source-revision.js\")\"",
    "checkout=\"$(\"$real_node\" -e 'process.stdout.write(require(process.argv[1]).ARTIFACT_SOURCE_REVISION)' \"$repo_root/src/zoho-catalyst/form2-controller/functions/form2_controller/lib/source-revision.js\")\"",
    "[[ \"$artifact\" == \"$expected_head\" ]]",
    "[[ \"$checkout\" == __SYLVARA_UNSTAMPED_SOURCE_REVISION__ ]]",
    "printf 'deploy-called\\nartifact=%s\\n' \"$artifact\" >> \"$evidence_path\"",
    "if [[ \"$scenario\" == deploy-ambiguous ]]; then",
    "  printf '%s\\n' 'deployment-accepted' >> \"$evidence_path\"",
    "  exit 75",
    "fi",
  ]);

  writeStartupProbe(path.join(stubBin, "dirname"), realDirname, evidence, "dirname");
  writeStartupProbe(path.join(stubBin, "uname"), realUname, evidence, "uname");

  const hostileStartupFile = path.join(fixtureRoot, "hostile-startup.sh");
  fs.writeFileSync(hostileStartupFile, [
    `printf '%s\\n' 'startup-file-executed' >> ${shellQuote(evidence)}`,
    "printf '%s\\n' \"${CATALYST_TOKEN:-startup-token-missing}\" >&2",
    "exit 72",
    "",
  ].join("\n"), "utf8");

  const before = snapshotTree(repo);
  const inheritedEnvironment = {
    ...process.env,
    CATALYST_TOKEN: syntheticToken,
    BASH_ENV: hostileStartupFile,
    ENV: hostileStartupFile,
    PS4: syntheticToken,
    SHELLOPTS: "braceexpand:hashall:interactive-comments:xtrace",
  };
  delete inheritedEnvironment.GIT_NO_REPLACE_OBJECTS;
  const isolatedArguments = [
    "-i",
    `PATH=${stubBin}${path.delimiter}${process.env.PATH || ""}`,
    "PROJECT_ID=1",
    "CATALYST_ORG=2",
    `CATALYST_TOKEN=${syntheticToken}`,
    `APPROVED_SOURCE_REVISION=${head}`,
    `TMPDIR=${runtimeTmp}`,
    "NODE_OPTIONS=--synthetic-option-that-must-not-survive",
    "npm_config_registry=https://synthetic.invalid",
    `NPM_CONFIG_USERCONFIG=${path.join(fixtureRoot, "must-not-be-used-npmrc")}`,
    `GIT_ALTERNATE_OBJECT_DIRECTORIES=${path.join(fixtureRoot, "must-not-be-used-alternates")}`,
    "GIT_CONFIG_COUNT=1",
    "GIT_CONFIG_KEY_0=core.fsmonitor",
    `GIT_CONFIG_VALUE_0=${path.join(fixtureRoot, "must-not-be-run-fsmonitor")}`,
    `GIT_DIR=${path.join(fixtureRoot, "must-not-be-used.git")}`,
    `GIT_OBJECT_DIRECTORY=${path.join(fixtureRoot, "must-not-be-used-objects")}`,
    `GIT_WORK_TREE=${path.join(fixtureRoot, "must-not-be-used-worktree")}`,
    "SHELLOPTS=braceexpand:hashall:interactive-comments:xtrace",
    "bash",
    "--noprofile",
    "--norc",
    copiedDeployScript,
  ];
  const result = spawnSync(realEnv, isolatedArguments, {
    cwd: repo,
    encoding: "utf8",
    env: inheritedEnvironment,
    timeout: 30_000,
  });
  const after = snapshotTree(repo);
  const status = runChecked(realGit, [
    "-C",
    repo,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ], { env: gitEnv }).stdout;

  return {
    after,
    before,
    canaryPath,
    copiedController,
    evidence: fs.readFileSync(evidence, "utf8"),
    head,
    result,
    runtimeTmp,
    status,
  };
}

function assertCheckoutUnchanged(fixture) {
  assert.deepEqual(fixture.after, fixture.before);
  assert.equal(fixture.status, "");
  assert.equal(fs.readFileSync(fixture.canaryPath, "utf8"), "ignored checkout canary\n");
  const revisionSource = fs.readFileSync(
    path.join(fixture.copiedController, "functions/form2_controller/lib/source-revision.js"),
    "utf8",
  );
  assert.match(revisionSource, /__SYLVARA_UNSTAMPED_SOURCE_REVISION__/);
  assert.equal(
    fs.readdirSync(fixture.runtimeTmp).some((name) => name.startsWith("sylvara-form2-deploy.")),
    false,
  );
  assert.doesNotMatch(`${fixture.result.stdout}${fixture.result.stderr}`, new RegExp(syntheticToken));
  assert.match(fixture.evidence, /^startup-clean=dirname$/m);
  assert.match(fixture.evidence, /^startup-clean=uname$/m);
  assert.doesNotMatch(fixture.evidence, /^startup-file-executed$/m);
}

test("the isolated Development deploy succeeds without mutating the checkout", {
  skip: !supportedRunner,
}, (testContext) => {
  const fixture = createFixture(testContext, "happy");
  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  assert.match(fixture.evidence, /^test-mutation-created$/m);
  assert.match(fixture.evidence, /^deploy-called$/m);
  assert.match(fixture.evidence, new RegExp(`^artifact=${fixture.head}$`, "m"));
  assertCheckoutUnchanged(fixture);
});

test("the isolated Development deploy ignores a replacement ref for the approved commit", {
  skip: !supportedRunner,
}, (testContext) => {
  const fixture = createFixture(testContext, "replacement-ref");
  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  assert.match(fixture.evidence, /^test-mutation-created$/m);
  assert.match(fixture.evidence, /^deploy-called$/m);
  assert.match(fixture.evidence, new RegExp(`^artifact=${fixture.head}$`, "m"));
  assertCheckoutUnchanged(fixture);
});

test("the isolated Development deploy rejects source mutation in the deploy export", {
  skip: !supportedRunner,
}, (testContext) => {
  const fixture = createFixture(testContext, "deploy-source-mutation");
  assert.notEqual(fixture.result.status, 0);
  assert.match(fixture.result.stderr, /deployable controller differs from the approved Git export/);
  assert.match(fixture.evidence, /^test-mutation-created$/m);
  assert.doesNotMatch(fixture.evidence, /^deploy-called$/m);
  assertCheckoutUnchanged(fixture);
});

test("the isolated Development deploy rejects nested dependency injection outside the dependency root", {
  skip: !supportedRunner,
}, (testContext) => {
  const fixture = createFixture(testContext, "nested-node-modules");
  assert.notEqual(fixture.result.status, 0);
  assert.match(fixture.result.stderr, /deployable controller differs from the approved Git export/);
  assert.match(fixture.evidence, /^test-mutation-created$/m);
  assert.doesNotMatch(fixture.evidence, /^deploy-called$/m);
  assertCheckoutUnchanged(fixture);
});

test("the isolated Development deploy rejects an escaping dependency symlink", {
  skip: !supportedRunner,
}, (testContext) => {
  const fixture = createFixture(testContext, "escape-symlink");
  assert.notEqual(fixture.result.status, 0);
  assert.match(fixture.result.stderr, /artifact symlink escapes its tree/);
  assert.doesNotMatch(fixture.evidence, /^deploy-called$/m);
  assertCheckoutUnchanged(fixture);
});

test("an ambiguous Catalyst failure requires readback and is never retried", {
  skip: !supportedRunner,
}, (testContext) => {
  const fixture = createFixture(testContext, "deploy-ambiguous");
  assert.notEqual(fixture.result.status, 0);
  assert.match(
    fixture.result.stderr,
    /deployment may have completed.*independently read back.*before any retry/i,
  );
  assert.match(fixture.evidence, /^deployment-accepted$/m);
  assert.equal((fixture.evidence.match(/^deploy-called$/gm) ?? []).length, 1);
  assertCheckoutUnchanged(fixture);
});
