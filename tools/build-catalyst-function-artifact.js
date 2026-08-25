"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_REVISION_SENTINEL = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024 * 1024;
const STAGING_PREFIX = ".sylvara-catalyst-release-";

class ArtifactBuildError extends Error {}

function fail(message) {
  throw new ArtifactBuildError(message);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedPath(value) {
  const resolved = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail(`${label} is invalid`);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeBaseEnvironment(additions = {}) {
  const environment = {
    CI: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    LANG: "C",
    LC_ALL: "C",
  };
  const pathName = Object.keys(process.env).find((name) => name.toLowerCase() === "path");
  environment.PATH = pathName ? process.env[pathName] : "";
  for (const name of ["ComSpec", "PATHEXT", "SystemRoot", "WINDIR"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return { ...environment, ...additions };
}

function runGit(directory, arguments_, { binary = false, input } = {}) {
  const result = spawnSync("git", [
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-C", directory,
    ...arguments_,
  ], {
    encoding: binary ? null : "utf8",
    env: safeBaseEnvironment(),
    input,
    maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
    shell: false,
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail("approved Git state could not be read safely");
  return result.stdout;
}

function parseArguments(arguments_) {
  if (arguments_.length !== 4) {
    fail("expected --approved-revision <sha> and --output <absolute-new-directory>");
  }
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!new Set(["--approved-revision", "--output"]).has(name) || values.has(name) || !value) {
      fail("artifact builder arguments are invalid");
    }
    values.set(name, value);
  }
  const revision = values.get("--approved-revision") || "";
  const output = values.get("--output") || "";
  if (!REVISION_PATTERN.test(revision)) fail("approved source revision is invalid");
  if (!path.isAbsolute(output)) fail("artifact output must be an absolute path");
  return Object.freeze({ revision, output: path.resolve(output) });
}

function validateConfig(config) {
  if (!config || !/^[a-z0-9][a-z0-9_-]*$/.test(config.target || "")) {
    fail("artifact target configuration is invalid");
  }
  if (!/^src\/zoho-catalyst\/[a-z0-9][a-z0-9-]*$/.test(config.componentSubpath || "")) {
    fail("artifact component configuration is invalid");
  }
  if (!/^[a-z0-9][a-z0-9-]*-release-v[1-9][0-9]*$/.test(config.schemaVersion || "")) {
    fail("artifact manifest configuration is invalid");
  }
  if (config.extraStamp) {
    const stamp = config.extraStamp;
    if (!/^[A-Z][A-Z0-9_]*$/.test(stamp.environmentName || "")
      || !/^functions\/[a-z0-9_-]+\/lib\/[a-z0-9-]+\.js$/.test(stamp.relativePath || "")
      || !/^__[A-Z0-9_]+__$/.test(stamp.sentinel || "")
      || !/^[A-Z][A-Z0-9_]*$/.test(stamp.constantName || "")) {
      fail("artifact stamp configuration is invalid");
    }
  }
}

function validateOutput(output, repositoryRoot) {
  if (fs.existsSync(output)) fail("artifact output already exists");
  const parentInput = path.dirname(output);
  const parentMetadata = fs.lstatSync(parentInput, { throwIfNoEntry: false });
  if (!parentMetadata?.isDirectory() || parentMetadata.isSymbolicLink()) {
    fail("artifact output parent must be an existing unlinked directory");
  }
  const parent = fs.realpathSync(parentInput);
  if (!samePath(parent, parentInput)) fail("artifact output parent may not traverse a link");
  const resolvedOutput = path.join(parent, path.basename(output));
  if (samePath(repositoryRoot, resolvedOutput) || isInside(repositoryRoot, resolvedOutput)) {
    fail("artifact output must be outside the repository");
  }
  return Object.freeze({ output: resolvedOutput, parent });
}

function parseTree(rawTree, config) {
  const entries = [];
  let totalBytes = 0;
  for (const raw of rawTree.toString("utf8").split("\0")) {
    if (!raw) continue;
    const match = /^(100644|100755) blob ([a-f0-9]{40}) +([0-9]+)\t(.+)$/.exec(raw);
    if (!match) fail("approved Git tree contains a linked or unsupported entry");
    const repositoryPath = match[4];
    if (/[^\x20-\x7e]/.test(repositoryPath) || repositoryPath.includes("\\")
      || path.posix.normalize(repositoryPath) !== repositoryPath
      || repositoryPath.split("/").some((part) => !part || part === "." || part === "..")) {
      fail("approved Git tree contains an unsafe path");
    }
    const size = Number(match[3]);
    if (!Number.isSafeInteger(size) || size < 0) fail("approved Git tree size is invalid");
    totalBytes += size;
    if (totalBytes > MAX_SOURCE_BYTES) fail("approved Git tree exceeds the isolated-build limit");
    entries.push(Object.freeze({
      mode: match[1],
      objectId: match[2],
      repositoryPath,
      size,
      releasePath: releaseRelativePath(repositoryPath, config),
    }));
  }
  if (!entries.length) fail("approved Git tree is empty");
  validateReleaseEntrySet(entries, config);
  return entries.sort((left, right) => compareText(left.repositoryPath, right.repositoryPath));
}

function releaseRelativePath(repositoryPath, config) {
  if (repositoryPath === `${config.componentSubpath}/catalyst.json`) return "catalyst.json";
  const prefix = `${config.componentSubpath}/functions/${config.target}/`;
  if (!repositoryPath.startsWith(prefix)) return null;
  const relative = repositoryPath.slice(prefix.length);
  if (relative === ".env" || relative.startsWith(".env.")) return null;
  if (relative === "test" || relative.startsWith("test/")) return null;
  if (new Set(["catalyst-config.json", "index.js", "package.json", "package-lock.json"])
    .has(relative)) {
    return `functions/${config.target}/${relative}`;
  }
  if (/^lib\/(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9-]*\.js$/.test(relative)) {
    return `functions/${config.target}/${relative}`;
  }
  fail("approved function tree contains an unclassified deployable path");
}

function validateReleaseEntrySet(entries, config) {
  const paths = new Set(entries.filter((entry) => entry.releasePath)
    .map((entry) => entry.releasePath));
  const required = [
    "catalyst.json",
    `functions/${config.target}/catalyst-config.json`,
    `functions/${config.target}/index.js`,
    `functions/${config.target}/package.json`,
    `functions/${config.target}/package-lock.json`,
    `functions/${config.target}/lib/source-revision.js`,
  ];
  if (config.extraStamp) required.push(config.extraStamp.relativePath);
  for (const expected of required) {
    if (!paths.has(expected)) fail("approved function release tree is incomplete");
  }
}

function blobDigest(content) {
  return crypto.createHash("sha1").update(Buffer.from(`blob ${content.length}\0`))
    .update(content).digest("hex");
}

function readBlobs(repositoryRoot, entries) {
  const input = Buffer.from(`${entries.map((entry) => entry.objectId).join("\n")}\n`, "ascii");
  const output = runGit(repositoryRoot, ["cat-file", "--batch"], { binary: true, input });
  const blobs = [];
  let offset = 0;
  for (const entry of entries) {
    const endHeader = output.indexOf(0x0a, offset);
    if (endHeader === -1) fail("approved Git blob response is incomplete");
    const header = output.subarray(offset, endHeader).toString("ascii");
    const match = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(header);
    if (!match || match[1] !== entry.objectId || Number(match[2]) !== entry.size) {
      fail("approved Git blob response is invalid");
    }
    const start = endHeader + 1;
    const end = start + entry.size;
    if (end >= output.length || output[end] !== 0x0a) {
      fail("approved Git blob response is truncated");
    }
    const content = output.subarray(start, end);
    if (blobDigest(content) !== entry.objectId) fail("approved Git blob failed integrity validation");
    blobs.push(content);
    offset = end + 1;
  }
  if (offset !== output.length) fail("approved Git blob response has trailing data");
  return blobs;
}

function exportEntries(entries, blobs, destinationRoot, selectPath) {
  fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  for (let index = 0; index < entries.length; index += 1) {
    const relativePath = selectPath(entries[index]);
    if (!relativePath) continue;
    const destination = path.join(destinationRoot, ...relativePath.split("/"));
    if (!isInside(destinationRoot, destination)) fail("approved export path escaped its root");
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, blobs[index], {
      flag: "wx",
      mode: entries[index].mode === "100755" ? 0o700 : 0o600,
    });
  }
}

function verifyExportedEntries(entries, blobs, destinationRoot, selectPath) {
  for (let index = 0; index < entries.length; index += 1) {
    const relativePath = selectPath(entries[index]);
    if (!relativePath) continue;
    const candidate = path.join(destinationRoot, ...relativePath.split("/"));
    const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
    if (!metadata?.isFile() || metadata.isSymbolicLink()
      || metadata.size !== blobs[index].length
      || blobDigest(fs.readFileSync(candidate)) !== entries[index].objectId) {
      fail("isolated source tests changed the approved Git export");
    }
  }
}

function validateRelease(projectRoot, config) {
  const catalyst = readJson(path.join(projectRoot, "catalyst.json"), "catalyst.json");
  if (stableJson(catalyst?.functions) !== stableJson({
    source: "functions",
    targets: [config.target],
    ignore: ["test/**", ".env*"],
  })) {
    fail("Catalyst manifest does not bind the exact function release");
  }
  const functionRoot = path.join(projectRoot, "functions", config.target);
  if (path.basename(functionRoot) !== config.target) fail("function folder does not match its target");
  const catalystConfig = readJson(path.join(functionRoot, "catalyst-config.json"),
    "catalyst-config.json");
  if (stableJson(catalystConfig?.deployment) !== stableJson({
    name: config.target,
    stack: "node24",
    type: "advancedio",
  }) || stableJson(catalystConfig?.execution) !== stableJson({ main: "index.js" })) {
    fail("Catalyst function configuration does not match its target");
  }
  const packageJson = readJson(path.join(functionRoot, "package.json"), "package.json");
  const lock = readJson(path.join(functionRoot, "package-lock.json"), "package-lock.json");
  const rootLock = lock?.packages?.[""];
  if (packageJson?.name !== config.target || lock?.name !== config.target
    || rootLock?.name !== config.target || packageJson?.version !== lock?.version
    || packageJson?.version !== rootLock?.version || lock?.lockfileVersion !== 3
    || lock?.requires !== true || packageJson?.private !== true
    || packageJson?.main !== "index.js" || packageJson?.type !== "commonjs"
    || packageJson?.engines?.node !== "24.x"
    || stableJson(packageJson.engines) !== stableJson(rootLock.engines)
    || stableJson(packageJson.dependencies || {}) !== stableJson(rootLock.dependencies || {})) {
    fail("package and lock files do not bind the exact function release");
  }
  for (const [name, requirement] of Object.entries(packageJson.dependencies || {})) {
    if (typeof requirement !== "string" || !requirement || !lock.packages[`node_modules/${name}`]) {
      fail("package lock is missing a production dependency");
    }
  }
  return functionRoot;
}

function stampFile(projectRoot, stamp, value) {
  const file = path.join(projectRoot, ...stamp.relativePath.split("/"));
  const source = fs.readFileSync(file, "utf8");
  if (stamp.expectedSource !== undefined && source !== stamp.expectedSource) {
    fail("artifact stamp module is not the exact approved template");
  }
  const assignment = new RegExp(
    `const\\s+${escapeRegExp(stamp.constantName)}\\s*=\\s*["']${escapeRegExp(stamp.sentinel)}["'];`,
  );
  if (count(source, stamp.sentinel) !== 1 || !assignment.test(source)) {
    fail("artifact stamp sentinel is not in its approved assignment");
  }
  const stamped = source.replace(stamp.sentinel, value);
  fs.writeFileSync(file, stamped, { encoding: "utf8", flag: "w", mode: 0o600 });
  const readback = fs.readFileSync(file, "utf8");
  const stampedAssignment = new RegExp(
    `const\\s+${escapeRegExp(stamp.constantName)}\\s*=\\s*["']${escapeRegExp(value)}["'];`,
  );
  if (readback.includes(stamp.sentinel) || count(readback, value) !== 1
    || !stampedAssignment.test(readback)) {
    fail("artifact stamp failed readback");
  }
}

function stampArtifact(projectRoot, config, revision, extraValue) {
  const revisionStamp = {
    relativePath: `functions/${config.target}/lib/source-revision.js`,
    sentinel: SOURCE_REVISION_SENTINEL,
    constantName: "ARTIFACT_SOURCE_REVISION",
  };
  let revisionSentinels = 0;
  let extraSentinels = 0;
  for (const entry of scanFiles(projectRoot)) {
    if (!entry.relativePath.endsWith(".js")) continue;
    const source = fs.readFileSync(entry.absolutePath, "utf8");
    revisionSentinels += count(source, SOURCE_REVISION_SENTINEL);
    if (config.extraStamp) extraSentinels += count(source, config.extraStamp.sentinel);
  }
  if (revisionSentinels !== 1 || (config.extraStamp && extraSentinels !== 1)) {
    fail("artifact stamp sentinel appears outside its approved module");
  }
  stampFile(projectRoot, revisionStamp, revision);
  if (config.extraStamp) stampFile(projectRoot, config.extraStamp, extraValue);
}

function windowsCliModule(command, relativeModulePath) {
  const result = spawnSync("where.exe", [`${command}.cmd`], {
    encoding: "utf8",
    env: safeBaseEnvironment(),
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail(`${command} is unavailable`);
  for (const executable of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const modulePath = path.join(path.dirname(executable), ...relativeModulePath.split("/"));
    if (fs.statSync(modulePath, { throwIfNoEntry: false })?.isFile()) return modulePath;
  }
  fail(`${command} JavaScript entry point is unavailable`);
}

function npmInvocation() {
  if (process.platform !== "win32") return Object.freeze({ command: "npm", prefix: [] });
  return Object.freeze({
    command: process.execPath,
    prefix: [windowsCliModule("npm", "node_modules/npm/bin/npm-cli.js")],
  });
}

function runNpm(invocation, arguments_, options) {
  const result = spawnSync(invocation.command, [...invocation.prefix, ...arguments_], {
    cwd: options.cwd,
    encoding: null,
    env: options.environment,
    maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
    shell: false,
    timeout: options.timeout,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail(options.failureMessage);
}

function npmEnvironment(toolRoot, additions = {}, temporaryOverride) {
  const npmRoot = path.join(toolRoot, "npm-runtime");
  const home = path.join(npmRoot, "home");
  const temporary = temporaryOverride || path.join(npmRoot, "tmp");
  const cache = path.join(npmRoot, "cache");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
  const userConfig = path.join(npmRoot, "user.npmrc");
  const globalConfig = path.join(npmRoot, "global.npmrc");
  if (!fs.existsSync(userConfig)) fs.writeFileSync(userConfig, "", { flag: "wx", mode: 0o600 });
  if (!fs.existsSync(globalConfig)) fs.writeFileSync(globalConfig, "", { flag: "wx", mode: 0o600 });
  return safeBaseEnvironment({
    HOME: home,
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
    npm_config_audit: "false",
    npm_config_cache: cache,
    npm_config_fund: "false",
    npm_config_globalconfig: globalConfig,
    npm_config_ignore_scripts: "true",
    npm_config_userconfig: userConfig,
    ...additions,
  });
}

function installProductionDependencies(functionRoot, toolRoot, invocation) {
  const environment = npmEnvironment(toolRoot);
  runNpm(invocation, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: functionRoot,
    environment,
    timeout: 300_000,
    failureMessage: "production dependency installation failed",
  });
  runNpm(invocation, ["ls", "--all", "--omit=dev", "--ignore-scripts", "--json"], {
    cwd: functionRoot,
    environment,
    timeout: 120_000,
    failureMessage: "production dependency tree failed lock validation",
  });
}

function runSourceTests(functionRoot, toolRoot, invocation, temporaryRoot) {
  runNpm(invocation, ["run", "ci", "--ignore-scripts"], {
    cwd: functionRoot,
    environment: npmEnvironment(
      toolRoot,
      { SYLVARA_ARTIFACT_INNER_VERIFY: "1" },
      temporaryRoot,
    ),
    timeout: 300_000,
    failureMessage: "isolated source tests failed",
  });
}

function scanFiles(root) {
  const rootReal = fs.realpathSync(root);
  const files = [];
  let totalBytes = 0;
  const pending = [rootReal];
  while (pending.length) {
    const directory = pending.pop();
    const directoryMetadata = fs.lstatSync(directory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      fail("artifact traversal encountered a linked or unsupported directory");
    }
    if (process.platform !== "win32" && (directoryMetadata.mode & 0o022)) {
      fail("artifact contains a group- or world-writable directory");
    }
    for (const name of fs.readdirSync(directory).sort(compareText).reverse()) {
      if (/[\x00-\x1f\x7f]/.test(name)) fail("artifact contains an unsafe path");
      const candidate = path.join(directory, name);
      const metadata = fs.lstatSync(candidate);
      if (metadata.isSymbolicLink()) fail("artifact contains a symbolic link");
      if (metadata.isDirectory()) {
        pending.push(candidate);
      } else if (metadata.isFile()) {
        if (process.platform !== "win32" && (metadata.mode & 0o022)) {
          fail("artifact contains a group- or world-writable file");
        }
        totalBytes += metadata.size;
        if (totalBytes > MAX_ARTIFACT_BYTES) fail("artifact exceeds the release size limit");
        files.push(Object.freeze({
          absolutePath: candidate,
          relativePath: path.relative(rootReal, candidate).split(path.sep).join("/"),
          bytes: metadata.size,
        }));
      } else {
        fail("artifact contains an unsupported file type");
      }
    }
  }
  return files.sort((left, right) => compareText(left.relativePath, right.relativePath));
}

function dependencyFingerprint(nodeModulesRoot) {
  if (!fs.lstatSync(nodeModulesRoot, { throwIfNoEntry: false })?.isDirectory()) {
    fail("production dependencies were not materialized");
  }
  const files = scanFiles(nodeModulesRoot).map((entry) => ({
    path: entry.relativePath,
    bytes: entry.bytes,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(entry.absolutePath)).digest("hex"),
  }));
  return crypto.createHash("sha256").update(canonicalFileManifest(files)).digest("hex");
}

function shouldPrune(relativePath, isDirectory) {
  const parts = relativePath.split("/");
  const name = parts.at(-1).toLowerCase();
  if (name === ".git" || name === ".catalystrc" || name === ".env" || name.startsWith(".env.")) {
    return true;
  }
  if (isDirectory && new Set(["test", "tests", "__tests__", "logs"]).has(name)) return true;
  if (!isDirectory && (name.endsWith(".log")
    || new Set(["npm-debug.log", "yarn-debug.log", "yarn-error.log", "pnpm-debug.log"]).has(name))) {
    return true;
  }
  return false;
}

function pruneRelease(root) {
  const rootReal = fs.realpathSync(root);
  function visit(directory) {
    for (const name of fs.readdirSync(directory)) {
      const candidate = path.join(directory, name);
      if (!isInside(rootReal, candidate)) fail("artifact prune path escaped its root");
      const metadata = fs.lstatSync(candidate);
      if (metadata.isSymbolicLink()) fail("artifact contains a symbolic link");
      const relative = path.relative(rootReal, candidate).split(path.sep).join("/");
      if (shouldPrune(relative, metadata.isDirectory())) {
        fs.rmSync(candidate, { force: true, recursive: metadata.isDirectory() });
      } else if (metadata.isDirectory()) {
        visit(candidate);
      } else if (!metadata.isFile()) {
        fail("artifact contains an unsupported file type");
      }
    }
  }
  visit(rootReal);
}

function assertNoForbiddenArtifactPaths(files) {
  for (const entry of files) {
    const entryPath = entry.relativePath || entry.path;
    if (typeof entryPath !== "string") fail("artifact manifest contains an invalid path");
    const parts = entryPath.split("/");
    for (const part of parts) {
      const name = part.toLowerCase();
      if (name === ".git" || name === ".catalystrc" || name === ".env"
        || name.startsWith(".env.") || new Set(["test", "tests", "__tests__", "logs"]).has(name)) {
        fail("artifact contains excluded source or runtime output");
      }
    }
    const name = parts.at(-1).toLowerCase();
    if (name.endsWith(".log")) fail("artifact contains a debug or runtime log");
  }
}

function canonicalFileManifest(files) {
  return files.map((entry) => `${JSON.stringify(entry.path)}\t${entry.bytes}\t${entry.sha256}\n`).join("");
}

function createManifest(projectRoot, config, revision) {
  const files = scanFiles(projectRoot)
    .filter((entry) => entry.relativePath !== "artifact-manifest.json")
    .map((entry) => ({
      path: entry.relativePath,
      bytes: entry.bytes,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(entry.absolutePath)).digest("hex"),
    }));
  assertNoForbiddenArtifactPaths(files);
  const aggregateSha256 = crypto.createHash("sha256")
    .update(canonicalFileManifest(files)).digest("hex");
  const manifest = {
    schemaVersion: config.schemaVersion,
    sourceRevision: revision,
    functionTarget: config.target,
    deployed: false,
    canonicalFormat: "UTF-8 JSON(path), tab, bytes, tab, lowercase SHA-256, LF; paths sorted",
    files,
    aggregateSha256,
  };
  const manifestPath = path.join(projectRoot, "artifact-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const readback = readJson(manifestPath, "artifact-manifest.json");
  if (readback.aggregateSha256 !== aggregateSha256
    || stableJson(readback.files) !== stableJson(files)) {
    fail("artifact checksum manifest failed readback");
  }
  const finalFiles = scanFiles(projectRoot);
  assertNoForbiddenArtifactPaths(finalFiles);
  return Object.freeze({ aggregateSha256, manifestPath });
}

function safeCleanup(root, parent, prefix = STAGING_PREFIX) {
  if (typeof root !== "string" || !path.basename(root).startsWith(prefix)) return;
  if (!isInside(parent, root) || samePath(parent, root)) return;
  fs.rmSync(root, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
}

function assertRepositoryState(repositoryRoot, revision) {
  const resolved = String(runGit(repositoryRoot,
    ["rev-parse", "--verify", `${revision}^{commit}`])).trim();
  const head = String(runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"])).trim();
  if (resolved !== revision || head !== revision) {
    fail("HEAD is not the exact approved immutable revision");
  }
  if (String(runGit(repositoryRoot, ["rev-parse", "--show-object-format"])).trim() !== "sha1") {
    fail("approved repository does not use the required SHA-1 object format");
  }
  const trackedState = String(runGit(
    repositoryRoot,
    ["ls-files", "-v", "-z"],
  )).split("\0");
  if (trackedState.some((entry) => entry
    && (entry[0] === "S" || /[a-z]/.test(entry[0])))) {
    // Git deliberately omits skip-worktree and assume-unchanged edits from normal status output.
    // Reject both flags so an executed build tool can never differ from the approved commit silently.
    fail("repository index contains hidden tracked state");
  }
  if (runGit(repositoryRoot,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { binary: true }).length) {
    fail("repository checkout is not clean");
  }
}

function captureExtraStamp(environment, config) {
  if (!config.extraStamp) return undefined;
  const name = config.extraStamp.environmentName;
  const value = String(environment[name] || "");
  if (environment === process.env) delete process.env[name];
  if (!DIGEST_PATTERN.test(value)) fail(`${name} is missing or invalid`);
  return value;
}

function build(config, {
  arguments_ = process.argv.slice(2),
  environment = process.env,
  scriptPath,
} = {}) {
  validateConfig(config);
  const extraStampValue = captureExtraStamp(environment, config);
  const { revision, output: requestedOutput } = parseArguments(arguments_);
  if (Number(process.versions.node.split(".")[0]) !== 24) {
    fail("Node.js 24 is required to build this function artifact");
  }
  const componentRoot = fs.realpathSync(path.resolve(path.dirname(scriptPath), ".."));
  const repositoryRoot = fs.realpathSync(String(runGit(componentRoot,
    ["rev-parse", "--show-toplevel"])).trim());
  const expectedComponent = path.join(repositoryRoot, ...config.componentSubpath.split("/"));
  if (!samePath(componentRoot, expectedComponent)) fail("builder is outside its approved component path");
  const { output, parent } = validateOutput(requestedOutput, repositoryRoot);
  assertRepositoryState(repositoryRoot, revision);
  const entries = parseTree(runGit(repositoryRoot, [
    "ls-tree", "-r", "-z", "--full-tree", "--long", revision,
  ], { binary: true }), config);
  const blobs = readBlobs(repositoryRoot, entries);
  const stagingRoot = fs.mkdtempSync(path.join(parent, STAGING_PREFIX));
  let systemTemporaryParent;
  let sourceTestTemporary;
  let published = false;
  try {
    fs.chmodSync(stagingRoot, 0o700);
    systemTemporaryParent = fs.realpathSync(os.tmpdir());
    if (samePath(repositoryRoot, systemTemporaryParent)
      || isInside(repositoryRoot, systemTemporaryParent)) {
      fail("system temporary directory must be outside the repository");
    }
    sourceTestTemporary = fs.mkdtempSync(path.join(systemTemporaryParent, "srt-"));
    fs.chmodSync(sourceTestTemporary, 0o700);
    const testRoot = path.join(stagingRoot, "test-export");
    exportEntries(entries, blobs, testRoot, (entry) => entry.repositoryPath);
    const testFunctionRoot = validateRelease(
      path.join(testRoot, ...config.componentSubpath.split("/")),
      config,
    );
    const npm = npmInvocation();
    installProductionDependencies(testFunctionRoot, stagingRoot, npm);
    const dependenciesBeforeTests = dependencyFingerprint(path.join(testFunctionRoot, "node_modules"));
    runSourceTests(testFunctionRoot, stagingRoot, npm, sourceTestTemporary);
    const testedDependencies = dependencyFingerprint(path.join(testFunctionRoot, "node_modules"));
    if (dependenciesBeforeTests !== testedDependencies) {
      fail("isolated source tests changed the installed production dependencies");
    }
    verifyExportedEntries(entries, blobs, testRoot, (entry) => entry.repositoryPath);

    // Source tests execute repository-controlled code. Materialize the release only afterward so
    // that code cannot mutate the artifact it is meant to validate.
    const releaseRoot = path.join(stagingRoot, "release");
    if (fs.existsSync(releaseRoot)) {
      fail("release workspace appeared during isolated source tests");
    }
    exportEntries(entries, blobs, releaseRoot, (entry) => entry.releasePath);
    const releaseFunctionRoot = validateRelease(releaseRoot, config);
    stampArtifact(releaseRoot, config, revision, extraStampValue);
    installProductionDependencies(releaseFunctionRoot, stagingRoot, npm);
    const releaseDependencies = dependencyFingerprint(path.join(releaseFunctionRoot, "node_modules"));
    if (testedDependencies !== releaseDependencies) {
      fail("tested and release production dependency trees differ");
    }
    pruneRelease(releaseRoot);
    validateRelease(releaseRoot, config);
    const manifest = createManifest(releaseRoot, config, revision);
    assertRepositoryState(repositoryRoot, revision);
    if (fs.existsSync(output)) fail("artifact output appeared during the isolated build");
    fs.renameSync(releaseRoot, output);
    published = true;
    safeCleanup(sourceTestTemporary, systemTemporaryParent, "srt-");
    safeCleanup(stagingRoot, parent);
    return Object.freeze({
      projectRoot: output,
      manifestPath: path.join(output, path.basename(manifest.manifestPath)),
      sourceRevision: revision,
      functionTarget: config.target,
      aggregateSha256: manifest.aggregateSha256,
      deployed: false,
    });
  } catch (error) {
    if (sourceTestTemporary && systemTemporaryParent) {
      safeCleanup(sourceTestTemporary, systemTemporaryParent, "srt-");
    }
    safeCleanup(stagingRoot, parent);
    if (published && fs.lstatSync(output, { throwIfNoEntry: false })?.isDirectory()) {
      fs.rmSync(output, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
    }
    throw error;
  }
}

function runCli(config, options = {}) {
  try {
    const result = build(config, { ...options, scriptPath: options.scriptPath || require.main?.filename });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${config.label || "Catalyst function"} artifact build stopped: ${
      error instanceof ArtifactBuildError ? error.message : "unexpected failure"}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ArtifactBuildError,
  SOURCE_REVISION_SENTINEL,
  build,
  canonicalFileManifest,
  runCli,
};
