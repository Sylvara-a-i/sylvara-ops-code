"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const COMPONENT_SUBPATH = "src/zoho-catalyst/crm-billing-orchestrator";
const FUNCTION_TARGET = "crm_billing_orchestrator";
const SOURCE_SENTINEL = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";
const ZAID_SENTINEL = "__SYLVARA_UNSTAMPED_DEVELOPMENT_ZAID_HMAC_SHA256__";
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;

class ArtifactBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactBuildError";
  }
}

function fail(message) {
  throw new ArtifactBuildError(message);
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeEnvironment(root, additions = {}) {
  const selected = {};
  for (const name of ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC"]) {
    if (process.env[name]) selected[name] = process.env[name];
  }
  const home = path.join(root, "home");
  const temporary = path.join(root, "tmp");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(temporary, { recursive: true });
  return {
    ...selected,
    CI: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
    ...additions,
  };
}

function run(command, args, { cwd, environment, timeout = 120_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: null,
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    timeout,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail(`${command} did not complete successfully`);
  return result.stdout ?? Buffer.alloc(0);
}

function textOutput(command, args, options) {
  return run(command, args, options).toString("utf8").trim();
}

function requiredPrivate(environment, name, minimum = 16, maximum = 4096) {
  const value = String(environment[name] ?? "");
  const size = Buffer.byteLength(value, "utf8");
  if (size < minimum || size > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${name} is missing or invalid`);
  }
  return value;
}

function parseArguments(argv) {
  const allowed = new Set(["--deploy", "--help"]);
  if (argv.some((argument) => !allowed.has(argument)) || new Set(argv).size !== argv.length) {
    fail("supported arguments are --help and --deploy only");
  }
  return Object.freeze({ deploy: argv.includes("--deploy"), help: argv.includes("--help") });
}

function parseGitTree(buffer) {
  const entries = [];
  for (const raw of buffer.toString("utf8").split("\0")) {
    if (!raw) continue;
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(raw);
    if (!match) fail("approved Git tree contains an unsupported entry");
    const relative = match[3];
    const normalized = path.posix.normalize(relative);
    if (
      relative !== normalized || relative.startsWith("/") || relative.includes("\\") ||
      relative.split("/").some((part) => !part || part === "." || part === "..") ||
      /[\u0000-\u001f\u007f]/.test(relative) ||
      !(relative === COMPONENT_SUBPATH || relative.startsWith(`${COMPONENT_SUBPATH}/`))
    ) fail("approved Git tree contains an unsafe path");
    entries.push(Object.freeze({ mode: match[1], objectId: match[2], path: relative }));
  }
  if (!entries.length) fail("approved Git tree does not contain the Catalyst component");
  return Object.freeze(entries);
}

function gitBlobDigest(content) {
  return crypto.createHash("sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex");
}

function walk(root) {
  const result = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory)) {
      const candidate = path.join(directory, name);
      const metadata = fs.lstatSync(candidate);
      result.push(Object.freeze({ path: candidate, metadata }));
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) pending.push(candidate);
    }
  }
  return result;
}

function verifyGitExport(exportRoot, entries) {
  const expected = new Map(entries.map((entry) => [
    entry.path.slice(`${COMPONENT_SUBPATH}/`.length),
    entry,
  ]));
  const projectRoot = path.join(exportRoot, ...COMPONENT_SUBPATH.split("/"));
  if (!fs.statSync(projectRoot, { throwIfNoEntry: false })?.isDirectory()) {
    fail("approved Catalyst project export is missing");
  }
  const actual = new Set();
  for (const item of walk(projectRoot)) {
    const relative = path.relative(projectRoot, item.path).split(path.sep).join("/");
    if (item.metadata.isSymbolicLink()) fail("approved Git export contains a symbolic link");
    if (item.metadata.isDirectory()) continue;
    if (!item.metadata.isFile()) fail("approved Git export contains an unsupported file type");
    const expectedEntry = expected.get(relative);
    if (!expectedEntry) fail("approved Git export contains an unexpected file");
    const content = fs.readFileSync(item.path);
    if (gitBlobDigest(content) !== expectedEntry.objectId) {
      fail("approved Git export content differs from the approved commit");
    }
    actual.add(relative);
  }
  if (actual.size !== expected.size || [...expected.keys()].some((name) => !actual.has(name))) {
    fail("approved Git export is incomplete");
  }
  return projectRoot;
}

function validateCatalystProject(projectRoot) {
  let catalyst;
  try {
    catalyst = JSON.parse(fs.readFileSync(path.join(projectRoot, "catalyst.json"), "utf8"));
  } catch {
    fail("Catalyst project configuration is invalid");
  }
  if (
    catalyst?.functions?.source !== "functions" ||
    JSON.stringify(catalyst?.functions?.targets) !== JSON.stringify([FUNCTION_TARGET]) ||
    !Array.isArray(catalyst?.functions?.ignore) ||
    !catalyst.functions.ignore.includes("test/**") ||
    !catalyst.functions.ignore.includes(".env*")
  ) fail("Catalyst project is not scoped to the approved function target");
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail(`${label} is invalid`);
  }
}

function validateLockfile(functionRoot) {
  const packageJson = readJson(path.join(functionRoot, "package.json"), "package.json");
  const lockfile = readJson(path.join(functionRoot, "package-lock.json"), "package-lock.json");
  const root = lockfile?.packages?.[""];
  if (
    packageJson?.name !== FUNCTION_TARGET || lockfile?.name !== FUNCTION_TARGET ||
    lockfile.lockfileVersion !== 3 || !root || root.name !== FUNCTION_TARGET ||
    JSON.stringify(packageJson.dependencies ?? {}) !== JSON.stringify(root.dependencies ?? {})
  ) fail("package lock does not exactly bind the deployable package");
  for (const [name, version] of Object.entries(packageJson.dependencies ?? {})) {
    if (!/^(?:@?[A-Za-z0-9][A-Za-z0-9._/-]*|[A-Za-z0-9][A-Za-z0-9._-]*)$/.test(name) ||
        typeof version !== "string" || /^(?:file:|link:|git\+|https?:)/i.test(version)) {
      fail("package dependency declaration is outside the registry boundary");
    }
  }
  for (const [packagePath, entry] of Object.entries(lockfile.packages)) {
    if (packagePath === "") continue;
    const normalized = packagePath.split("\\").join("/");
    if (
      packagePath !== normalized || !normalized.startsWith("node_modules/") ||
      normalized.split("/").some((part) => !part || part === "." || part === "..") ||
      entry?.link === true
    ) fail("package lock contains an escaping or linked dependency");
    if (entry.resolved !== undefined) {
      let resolved;
      try {
        resolved = new URL(entry.resolved);
      } catch {
        fail("package lock contains an invalid dependency source");
      }
      if (
        resolved.protocol !== "https:" || resolved.hostname !== "registry.npmjs.org" ||
        resolved.username || resolved.password || !resolved.pathname.startsWith("/") ||
        typeof entry.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)
      ) fail("package lock contains a dependency outside the approved registry boundary");
    }
  }
  return Object.freeze({ packageJson, lockfile });
}

function stampArtifact(projectRoot, sourceRevision, developmentZaid, runtimeProof) {
  const stampPath = path.join(projectRoot, "functions", FUNCTION_TARGET, "lib", "source-revision.js");
  const source = fs.readFileSync(stampPath, "utf8");
  if (count(source, SOURCE_SENTINEL) !== 1 || count(source, ZAID_SENTINEL) !== 1) {
    fail("artifact stamp template is not the exact unstamped form");
  }
  const digest = crypto.createHmac("sha256", runtimeProof)
    .update(developmentZaid, "utf8")
    .digest("hex");
  if (!DIGEST.test(digest)) fail("Development binding digest is invalid");
  const stamped = source.replace(SOURCE_SENTINEL, sourceRevision).replace(ZAID_SENTINEL, digest);
  fs.writeFileSync(stampPath, stamped, { encoding: "utf8", flag: "w" });
  const readback = fs.readFileSync(stampPath, "utf8");
  if (
    count(readback, sourceRevision) !== 1 || count(readback, digest) !== 1 ||
    readback.includes(SOURCE_SENTINEL) || readback.includes(ZAID_SENTINEL)
  ) fail("artifact stamp readback failed");
  return stampPath;
}

function validateArtifactTree(projectRoot) {
  const resolvedRoot = fs.realpathSync(projectRoot);
  for (const item of walk(projectRoot)) {
    if (item.metadata.isSymbolicLink()) {
      let resolved;
      try {
        resolved = fs.realpathSync(item.path);
      } catch {
        fail("artifact contains a dangling symbolic link");
      }
      if (!isInside(resolvedRoot, resolved)) fail("artifact symbolic link escapes its isolated tree");
      continue;
    }
    if (!item.metadata.isDirectory() && !item.metadata.isFile()) {
      fail("artifact contains an unsupported file type");
    }
    if (!isInside(resolvedRoot, fs.realpathSync(item.path))) {
      fail("artifact dependency path escapes its isolated tree");
    }
  }
}

function windowsCliModule(command, relativeModulePath, toolRoot) {
  const environment = safeEnvironment(toolRoot);
  const candidates = textOutput("where.exe", [`${command}.cmd`], { environment })
    .split(/\r?\n/)
    .filter(Boolean);
  for (const executable of candidates) {
    const modulePath = path.join(path.dirname(executable), ...relativeModulePath.split("/"));
    if (fs.statSync(modulePath, { throwIfNoEntry: false })?.isFile()) return modulePath;
  }
  fail(`${command} JavaScript entry point is unavailable`);
}

function installDependencies(functionRoot, toolRoot) {
  const npmRoot = path.join(toolRoot, "npm");
  fs.mkdirSync(npmRoot, { recursive: true });
  const userConfig = path.join(npmRoot, "user.npmrc");
  const globalConfig = path.join(npmRoot, "global.npmrc");
  fs.writeFileSync(userConfig, "", { encoding: "utf8", flag: "wx" });
  fs.writeFileSync(globalConfig, "", { encoding: "utf8", flag: "wx" });
  const environment = safeEnvironment(toolRoot, {
    npm_config_audit: "false",
    npm_config_cache: path.join(npmRoot, "cache"),
    npm_config_fund: "false",
    npm_config_globalconfig: globalConfig,
    npm_config_ignore_scripts: "true",
    npm_config_userconfig: userConfig,
  });
  const npmCommand = process.platform === "win32" ? process.execPath : "npm";
  const npmPrefix = process.platform === "win32"
    ? [windowsCliModule("npm", "node_modules/npm/bin/npm-cli.js", toolRoot)]
    : [];
  run(npmCommand, [...npmPrefix, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: functionRoot,
    environment,
    timeout: 300_000,
  });
  run(npmCommand, [...npmPrefix, "ls", "--all", "--omit=dev", "--ignore-scripts", "--json"], {
    cwd: functionRoot,
    environment,
    timeout: 120_000,
  });
}

function fileManifest(projectRoot) {
  const entries = [];
  for (const item of walk(projectRoot)) {
    const relative = path.relative(projectRoot, item.path).split(path.sep).join("/");
    if (item.metadata.isDirectory()) continue;
    if (item.metadata.isSymbolicLink()) {
      entries.push({ path: relative, type: "symlink", target: path.relative(
        projectRoot,
        fs.realpathSync(item.path),
      ).split(path.sep).join("/") });
      continue;
    }
    const content = fs.readFileSync(item.path);
    entries.push({
      path: relative,
      type: "file",
      bytes: content.length,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
    });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function catalystDeployArguments(environment) {
  const projectId = String(environment.CATALYST_PROJECT_ID ?? "");
  const organizationId = String(environment.CATALYST_ORG_ID ?? "");
  requiredPrivate(environment, "CATALYST_TOKEN", 16, 4096);
  if (!/^[1-9][0-9]{0,29}$/.test(projectId) || !/^[1-9][0-9]{0,29}$/.test(organizationId)) {
    fail("Catalyst Development project binding is missing or invalid");
  }
  if (environment.CONFIRM_CATALYST_DEVELOPMENT_DEPLOY !== FUNCTION_TARGET) {
    fail("explicit Catalyst Development deploy confirmation is missing");
  }
  return [
    "deploy",
    "--only", `functions:${FUNCTION_TARGET}`,
    "--ignore-scripts",
    "--project", projectId,
    "--org", organizationId,
    "--dc", "us",
  ];
}

function deployDevelopment(projectRoot, toolRoot, environment) {
  const token = requiredPrivate(environment, "CATALYST_TOKEN", 16, 4096);
  const args = catalystDeployArguments(environment);
  // The official Catalyst CLI accepts CATALYST_TOKEN from its environment.
  // Keeping it out of argv avoids disclosure through process listings and
  // process-creation telemetry; command output is discarded below as well.
  const childEnvironment = safeEnvironment(toolRoot, { CATALYST_TOKEN: token });
  delete environment.CATALYST_TOKEN;
  const catalystCommand = process.platform === "win32" ? process.execPath : "catalyst";
  const catalystPrefix = process.platform === "win32"
    ? [windowsCliModule("catalyst", "node_modules/zcatalyst-cli/lib/bin/catalyst.js", toolRoot)]
    : [];
  const result = spawnSync(catalystCommand, [...catalystPrefix, ...args], {
    cwd: projectRoot,
    encoding: null,
    env: childEnvironment,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    timeout: 300_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    fail("Catalyst Development deployment may have completed; independently read back the exact function before retrying");
  }
}

function safeCleanup(createdRoot, temporaryParent) {
  if (
    typeof createdRoot !== "string" || !createdRoot ||
    !path.basename(createdRoot).startsWith("sylvara-crm-billing-artifact-") ||
    !isInside(temporaryParent, createdRoot) || createdRoot === temporaryParent
  ) return;
  fs.rmSync(createdRoot, { recursive: true, force: true });
}

function build({ deploy = false, environment = process.env, scriptPath = __filename } = {}) {
  const approvedRevision = String(environment.APPROVED_SOURCE_REVISION ?? "");
  if (!SHA.test(approvedRevision)) fail("APPROVED_SOURCE_REVISION is missing or invalid");
  const developmentZaid = requiredPrivate(environment, "CATALYST_DEVELOPMENT_ZAID", 1);
  const runtimeProof = requiredPrivate(environment, "DEVELOPMENT_RUNTIME_PROOF", 32, 256);

  // Remove private inputs before any child process is started. Child environments are
  // allowlisted as a second boundary, and no output includes either value or its HMAC.
  delete environment.CATALYST_DEVELOPMENT_ZAID;
  delete environment.DEVELOPMENT_RUNTIME_PROOF;

  const temporaryParent = fs.realpathSync(environment.TMPDIR || environment.TEMP || os.tmpdir());
  const toolRoot = fs.mkdtempSync(path.join(temporaryParent, "sylvara-crm-billing-artifact-"));
  try {
    const toolingEnvironment = safeEnvironment(toolRoot);
    const componentRoot = fs.realpathSync(path.resolve(path.dirname(scriptPath), ".."));
    const repositoryRoot = fs.realpathSync(textOutput("git", ["-C", componentRoot, "rev-parse", "--show-toplevel"], {
      cwd: componentRoot,
      environment: toolingEnvironment,
    }));
    if (componentRoot !== path.join(repositoryRoot, ...COMPONENT_SUBPATH.split("/"))) {
      fail("artifact builder is outside the approved component path");
    }
    const head = textOutput("git", ["-C", repositoryRoot, "rev-parse", "--verify", "HEAD"], {
      cwd: repositoryRoot,
      environment: toolingEnvironment,
    });
    if (head !== approvedRevision) fail("checked-out Git revision is not the approved revision");
    const status = textOutput("git", [
      "-C", repositoryRoot, "status", "--porcelain=v1", "--untracked-files=all",
    ], { cwd: repositoryRoot, environment: toolingEnvironment });
    if (status) fail("repository checkout is not clean");

    const tree = parseGitTree(run("git", [
      "-C", repositoryRoot, "ls-tree", "-r", "-z", "--full-tree", approvedRevision,
      "--", COMPONENT_SUBPATH,
    ], { cwd: repositoryRoot, environment: toolingEnvironment }));
    const archive = path.join(toolRoot, "approved-source.tar");
    const exportRoot = path.join(toolRoot, "export");
    fs.mkdirSync(exportRoot);
    run("git", [
      "-C", repositoryRoot, "archive", "--format=tar", `--output=${archive}`,
      approvedRevision, "--", COMPONENT_SUBPATH,
    ], { cwd: repositoryRoot, environment: toolingEnvironment });
    run("tar", ["-xf", archive, "-C", exportRoot], {
      cwd: repositoryRoot,
      environment: toolingEnvironment,
    });
    fs.rmSync(archive);

    const projectRoot = verifyGitExport(exportRoot, tree);
    validateCatalystProject(projectRoot);
    const functionRoot = path.join(projectRoot, "functions", FUNCTION_TARGET);
    validateLockfile(functionRoot);
    stampArtifact(projectRoot, approvedRevision, developmentZaid, runtimeProof);
    installDependencies(functionRoot, toolRoot);
    validateArtifactTree(projectRoot);

    const manifestPath = path.join(toolRoot, "artifact-manifest.json");
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      schemaVersion: "crm-billing-development-artifact-v1",
      sourceRevision: approvedRevision,
      functionTarget: FUNCTION_TARGET,
      files: fileManifest(projectRoot),
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    if (deploy) deployDevelopment(projectRoot, toolRoot, environment);
    return Object.freeze({
      artifactRoot: toolRoot,
      manifestPath,
      projectRoot,
      sourceRevision: approvedRevision,
      functionTarget: FUNCTION_TARGET,
      deployed: deploy,
    });
  } catch (error) {
    safeCleanup(toolRoot, temporaryParent);
    throw error;
  }
}

function help() {
  return [
    "Build and verify the isolated crm_billing_orchestrator Development artifact.",
    "Required private environment: CATALYST_DEVELOPMENT_ZAID, DEVELOPMENT_RUNTIME_PROOF.",
    "Required approval environment: APPROVED_SOURCE_REVISION (must equal clean HEAD).",
    "Default: build and verify only. Add --deploy only with Catalyst Development bindings",
    `and CONFIRM_CATALYST_DEVELOPMENT_DEPLOY=${FUNCTION_TARGET}.`,
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  const result = build({ deploy: options.deploy });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`CRM Billing artifact build stopped: ${error instanceof ArtifactBuildError ? error.message : "unexpected failure"}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ArtifactBuildError,
  COMPONENT_SUBPATH,
  FUNCTION_TARGET,
  build,
  catalystDeployArguments,
  parseArguments,
  parseGitTree,
  safeCleanup,
  stampArtifact,
  validateArtifactTree,
  validateLockfile,
};
