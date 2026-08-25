"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");

const CONTROLLER_SUBPATH = "src/zoho-catalyst/revenue-leak-test-request-form";
const FUNCTION_SUBPATH = `${CONTROLLER_SUBPATH}/functions/revenue_leak_test_request_form`;
const SOURCE_REVISION_SENTINEL = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";
const MAX_GIT_OUTPUT_BYTES = 24 * 1024 * 1024;
const ALLOWED_NATIVE_DEPENDENCIES = new Set(["node:crypto", "zcatalyst-sdk-node"]);

class SafeBuildError extends Error {}

function fail(message) {
  throw new SafeBuildError(message);
}

function normalizedPathForComparison(value) {
  const normalized = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithin(parent, candidate) {
  const normalizedParent = normalizedPathForComparison(parent);
  const normalizedCandidate = normalizedPathForComparison(candidate);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(
    `${normalizedParent}${path.sep}`,
  );
}

function existingLstat(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("an artifact path could not be inspected");
  }
}

function assertExistingDirectoryHasNoLinks(directory) {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    const metadata = existingLstat(current);
    if (!metadata || !metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail("the artifact directory must be an existing non-linked directory");
    }
  }
  const realDirectory = fs.realpathSync.native(absolute);
  if (normalizedPathForComparison(realDirectory) !== normalizedPathForComparison(absolute)) {
    fail("the artifact directory must not traverse a link or junction");
  }
  return realDirectory;
}

function safeGitEnvironment() {
  const environment = {
    // Git for Windows does not accept Node's `\\.\nul` spelling here.
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
  };
  for (const name of ["ComSpec", "PATHEXT", "SystemRoot", "WINDIR"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

function runGit(directory, arguments_, { binary = false, input } = {}) {
  const result = spawnSync(
    "git",
    [
      "-c", "core.fsmonitor=false",
      "-c", "core.untrackedCache=false",
      "-C", directory,
      ...arguments_,
    ],
    {
      encoding: binary ? null : "utf8",
      env: safeGitEnvironment(),
      input,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    fail("the approved Git revision could not be read safely");
  }
  return result.stdout;
}

function parseArguments(arguments_) {
  if (arguments_.length !== 4) {
    fail("usage: node build-single-file.js --approved-revision <40-char-sha> --output <absolute-path-to-index.js>");
  }
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!["--approved-revision", "--output"].includes(name) || values.has(name) || !value) {
      fail("the artifact builder arguments are invalid");
    }
    values.set(name, value);
  }
  const approvedRevision = values.get("--approved-revision");
  if (!/^[a-f0-9]{40}$/.test(approvedRevision ?? "")) {
    fail("the approved source revision must be one lowercase 40-character Git SHA");
  }
  const rawOutputPath = values.get("--output");
  if (!path.isAbsolute(rawOutputPath ?? "") || path.basename(rawOutputPath).toLowerCase() !== "index.js") {
    fail("the output must be an absolute path ending in index.js");
  }
  return { approvedRevision, rawOutputPath };
}

function findRepositoryRoot() {
  const controllerRoot = path.resolve(__dirname, "..");
  const repositoryRootOutput = runGit(controllerRoot, ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = fs.realpathSync.native(repositoryRootOutput.trim());
  const expectedControllerRoot = path.join(repositoryRoot, ...CONTROLLER_SUBPATH.split("/"));
  const actualControllerRoot = fs.realpathSync.native(controllerRoot);
  if (
    normalizedPathForComparison(actualControllerRoot) !==
    normalizedPathForComparison(expectedControllerRoot)
  ) {
    fail("RevenueLeakTestRequestForm is not at its approved repository path");
  }
  assertExistingDirectoryHasNoLinks(actualControllerRoot);
  return repositoryRoot;
}

function assertCleanApprovedRevision(repositoryRoot, approvedRevision) {
  const resolvedRevision = runGit(repositoryRoot, [
    "rev-parse",
    "--verify",
    `${approvedRevision}^{commit}`,
  ]).trim();
  const headRevision = runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]).trim();
  if (resolvedRevision !== approvedRevision || headRevision !== approvedRevision) {
    fail("HEAD is not the exact approved immutable revision");
  }
  const status = runGit(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ], { binary: true });
  if (status.length !== 0) {
    fail("the repository checkout is not clean");
  }
}

function validateGitPath(relativePath) {
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    fail("the approved revision contains an unsafe artifact path");
  }
  if (!relativePath.startsWith(`${FUNCTION_SUBPATH}/`)) {
    fail("the approved revision contains a path outside the Form 1 function");
  }
}

function parseTree(treeOutput) {
  const entries = [];
  for (const rawEntry of treeOutput.toString("utf8").split("\0")) {
    if (!rawEntry) continue;
    const tabIndex = rawEntry.indexOf("\t");
    if (tabIndex <= 0) fail("the approved Git tree is malformed");
    const [mode, type, objectId] = rawEntry.slice(0, tabIndex).split(" ");
    const relativePath = rawEntry.slice(tabIndex + 1);
    validateGitPath(relativePath);
    if (type !== "blob" || !["100644", "100755"].includes(mode)) {
      fail("linked or special files are not allowed in the function artifact");
    }
    if (!/^[a-f0-9]{40}$/.test(objectId ?? "")) {
      fail("the approved Git tree contains an invalid object");
    }
    entries.push({ mode, objectId, relativePath });
  }
  if (!entries.length) fail("the approved Form 1 function tree is empty");
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function gitBlobDigest(content) {
  return crypto
    .createHash("sha1")
    .update(Buffer.from(`blob ${content.length}\0`, "utf8"))
    .update(content)
    .digest("hex");
}

function readGitBlobs(repositoryRoot, entries) {
  const requestedObjects = Buffer.from(
    `${entries.map((entry) => entry.objectId).join("\n")}\n`,
    "ascii",
  );
  const batch = runGit(repositoryRoot, ["cat-file", "--batch"], {
    binary: true,
    input: requestedObjects,
  });
  const contents = new Map();
  let offset = 0;
  for (const entry of entries) {
    const newline = batch.indexOf(0x0a, offset);
    if (newline < 0) fail("a batched Git object header is malformed");
    const [objectId, type, rawSize] = batch.slice(offset, newline).toString("ascii").split(" ");
    const size = Number(rawSize);
    if (
      objectId !== entry.objectId ||
      type !== "blob" ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > MAX_GIT_OUTPUT_BYTES
    ) {
      fail("a batched Git object header failed validation");
    }
    const contentStart = newline + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= batch.length || batch[contentEnd] !== 0x0a) {
      fail("a batched Git object body is malformed");
    }
    const content = batch.subarray(contentStart, contentEnd);
    if (gitBlobDigest(content) !== entry.objectId) {
      fail("an exported Git object failed integrity validation");
    }
    contents.set(entry.objectId, content);
    offset = contentEnd + 1;
  }
  if (offset !== batch.length) fail("the batched Git object response contains trailing data");
  return contents;
}

function exportApprovedFunction(repositoryRoot, approvedRevision, exportRoot) {
  const treeOutput = runGit(repositoryRoot, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    approvedRevision,
    "--",
    FUNCTION_SUBPATH,
  ], { binary: true });
  const entries = parseTree(treeOutput);
  const contents = readGitBlobs(repositoryRoot, entries);
  const functionRoot = path.join(exportRoot, "revenue_leak_test_request_form");
  fs.mkdirSync(functionRoot, { mode: 0o700 });
  let totalBytes = 0;

  for (const entry of entries) {
    const relativeFunctionPath = entry.relativePath.slice(FUNCTION_SUBPATH.length + 1);
    const destination = path.join(functionRoot, ...relativeFunctionPath.split("/"));
    if (!isWithin(functionRoot, destination)) {
      fail("an exported function path escaped its isolated directory");
    }
    fs.mkdirSync(path.dirname(destination), { mode: 0o700, recursive: true });
    const content = contents.get(entry.objectId);
    totalBytes += content.length;
    if (totalBytes > MAX_GIT_OUTPUT_BYTES) {
      fail("an exported Git object failed integrity validation");
    }
    fs.writeFileSync(destination, content, { flag: "wx", mode: 0o600 });
  }

  return { entries, functionRoot };
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function resolveBundledDependency(moduleId, request, moduleIds) {
  if (request.includes("\\")) fail("a bundled dependency uses an unsafe path separator");
  if (!request.startsWith(".")) {
    if (!ALLOWED_NATIVE_DEPENDENCIES.has(request)) {
      fail("the function uses a native dependency outside the reviewed allowlist");
    }
    return;
  }
  let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(moduleId), request));
  if (!resolved.endsWith(".js")) resolved += ".js";
  if (resolved.startsWith("../") || path.posix.isAbsolute(resolved) || !moduleIds.has(resolved)) {
    fail("a relative function dependency escapes or is absent from the bundle");
  }
}

function validateDependencies(moduleId, source, moduleIds) {
  const literalPattern = /\brequire\s*\(\s*(["'])([^"']+)\1\s*\)/g;
  const allCalls = source.match(/\brequire\s*\(/g) ?? [];
  const literalCalls = [...source.matchAll(literalPattern)];
  if (literalCalls.length !== allCalls.length) {
    fail("dynamic require calls are not allowed in the deterministic artifact");
  }
  for (const match of literalCalls) {
    resolveBundledDependency(moduleId, match[2], moduleIds);
  }
}

function buildBundle(functionRoot, entries, approvedRevision) {
  const moduleIds = [
    "index.js",
    ...entries
      .map((entry) => entry.relativePath.slice(FUNCTION_SUBPATH.length + 1))
      .filter((relativePath) => relativePath.startsWith("lib/") && relativePath.endsWith(".js"))
      .sort(),
  ];
  const uniqueModuleIds = new Set(moduleIds);
  if (uniqueModuleIds.size !== moduleIds.length) fail("the bundle contains duplicate module paths");

  const sources = new Map();
  for (const moduleId of moduleIds) {
    const modulePath = path.join(functionRoot, ...moduleId.split("/"));
    const metadata = existingLstat(modulePath);
    if (!metadata?.isFile() || metadata.isSymbolicLink() || !isWithin(functionRoot, modulePath)) {
      fail("a required bundle module is unavailable");
    }
    sources.set(moduleId, fs.readFileSync(modulePath, "utf8"));
  }

  for (const [moduleId, source] of sources) {
    const sentinelCount = countOccurrences(source, SOURCE_REVISION_SENTINEL);
    if (moduleId === "lib/source-revision.js") {
      if (sentinelCount !== 1) fail("the source revision template is not exact");
    } else if (sentinelCount !== 0) {
      fail("the source revision sentinel appears outside its approved module");
    }
  }
  sources.set(
    "lib/source-revision.js",
    sources.get("lib/source-revision.js").replace(SOURCE_REVISION_SENTINEL, approvedRevision),
  );

  for (const [moduleId, source] of sources) {
    if (source.includes(SOURCE_REVISION_SENTINEL)) fail("the artifact remains unstamped");
    validateDependencies(moduleId, source, uniqueModuleIds);
  }

  const wrappers = moduleIds
    .map((moduleId) => {
      const source = sources.get(moduleId);
      return `${JSON.stringify(moduleId)}: function(module, exports, require) {\n${source}\n}`;
    })
    .join(",\n");

  const bundle = `"use strict";\n\n// Deterministically generated from reviewed modular source at ${approvedRevision}.\n// External Node built-ins and the Catalyst SDK remain native runtime imports.\nconst __nativeRequire = require;\nconst __bundleModules = Object.freeze({\n${wrappers}\n});\nconst __bundleCache = Object.create(null);\n\nfunction __resolveBundleModule(fromId, request) {\n  if (typeof request !== "string" || !request.startsWith(".")) return null;\n  const segments = fromId.split("/");\n  segments.pop();\n  for (const segment of request.split("/")) {\n    if (!segment || segment === ".") continue;\n    if (segment === "..") {\n      if (!segments.length) throw new Error("bundle module escaped its root");\n      segments.pop();\n    } else {\n      segments.push(segment);\n    }\n  }\n  let resolved = segments.join("/");\n  if (!resolved.endsWith(".js")) resolved += ".js";\n  if (!Object.prototype.hasOwnProperty.call(__bundleModules, resolved)) {\n    throw new Error("bundle module was not found: " + resolved);\n  }\n  return resolved;\n}\n\nfunction __loadBundleModule(moduleId) {\n  if (Object.prototype.hasOwnProperty.call(__bundleCache, moduleId)) {\n    return __bundleCache[moduleId].exports;\n  }\n  const factory = __bundleModules[moduleId];\n  if (typeof factory !== "function") throw new Error("invalid bundle module: " + moduleId);\n  const loaded = { exports: {} };\n  __bundleCache[moduleId] = loaded;\n  const localRequire = (request) => {\n    const bundled = __resolveBundleModule(moduleId, request);\n    return bundled ? __loadBundleModule(bundled) : __nativeRequire(request);\n  };\n  factory(loaded, loaded.exports, localRequire);\n  return loaded.exports;\n}\n\nmodule.exports = __loadBundleModule("index.js");\n`;

  try {
    new vm.Script(bundle, { filename: "index.js" });
  } catch {
    fail("the generated single-file artifact is not valid JavaScript");
  }
  return bundle;
}

function validateOutputPath(repositoryRoot, rawOutputPath) {
  const outputPath = path.resolve(rawOutputPath);
  const outputParent = assertExistingDirectoryHasNoLinks(path.dirname(outputPath));
  const normalizedOutput = path.join(outputParent, path.basename(outputPath));
  if (isWithin(repositoryRoot, normalizedOutput)) {
    fail("the artifact output must be outside the repository checkout");
  }
  if (existingLstat(normalizedOutput)) fail("the artifact output already exists");
  return normalizedOutput;
}

function writeVerifiedOutput(outputPath, bundle) {
  let created = false;
  try {
    const descriptor = fs.openSync(outputPath, "wx", 0o600);
    created = true;
    try {
      fs.writeFileSync(descriptor, bundle, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    const written = fs.readFileSync(outputPath, "utf8");
    if (written !== bundle || existingLstat(outputPath)?.isSymbolicLink()) {
      fail("the written artifact failed readback validation");
    }
    const metadata = fs.lstatSync(outputPath);
    return { device: metadata.dev, inode: metadata.ino, size: metadata.size };
  } catch (error) {
    if (created) {
      try {
        fs.unlinkSync(outputPath);
      } catch {
        // The exact file created by this invocation is the only cleanup target.
      }
    }
    if (error instanceof SafeBuildError) throw error;
    fail("the artifact output could not be written safely");
  }
}

function removeCreatedOutput(outputPath, identity) {
  const metadata = existingLstat(outputPath);
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.dev !== identity.device ||
    metadata.ino !== identity.inode ||
    metadata.size !== identity.size
  ) {
    fail("the failed-build artifact cleanup target changed unexpectedly");
  }
  fs.unlinkSync(outputPath);
}

function createIsolatedRoot() {
  const tempParent = assertExistingDirectoryHasNoLinks(fs.realpathSync.native(os.tmpdir()));
  const root = fs.mkdtempSync(path.join(tempParent, "sylvara-revenue-leak-test-request-form-artifact-"));
  fs.chmodSync(root, 0o700);
  const realRoot = fs.realpathSync.native(root);
  if (!isWithin(tempParent, realRoot) || path.basename(realRoot).startsWith("sylvara-revenue-leak-test-request-form-artifact-") === false) {
    fail("the isolated artifact directory is unsafe");
  }
  return { root: realRoot, tempParent };
}

function removeIsolatedRoot(root, tempParent) {
  if (
    !isWithin(tempParent, root) ||
    path.basename(root).startsWith("sylvara-revenue-leak-test-request-form-artifact-") === false
  ) {
    fail("the isolated artifact cleanup target is unsafe");
  }
  fs.rmSync(root, { recursive: true, force: false });
}

function main() {
  const { approvedRevision, rawOutputPath } = parseArguments(process.argv.slice(2));
  const repositoryRoot = findRepositoryRoot();
  assertCleanApprovedRevision(repositoryRoot, approvedRevision);
  const outputPath = validateOutputPath(repositoryRoot, rawOutputPath);
  const isolated = createIsolatedRoot();
  let buildError;
  let outputIdentity;
  try {
    const exportRoot = path.join(isolated.root, "export");
    fs.mkdirSync(exportRoot, { mode: 0o700 });
    const exported = exportApprovedFunction(
      repositoryRoot,
      approvedRevision,
      exportRoot,
    );
    const bundle = buildBundle(exported.functionRoot, exported.entries, approvedRevision);
    outputIdentity = writeVerifiedOutput(outputPath, bundle);
    assertCleanApprovedRevision(repositoryRoot, approvedRevision);
  } catch (error) {
    buildError = error;
  }
  try {
    removeIsolatedRoot(isolated.root, isolated.tempParent);
  } catch (cleanupError) {
    if (!buildError) buildError = cleanupError;
  }
  if (buildError && outputIdentity) {
    try {
      removeCreatedOutput(outputPath, outputIdentity);
    } catch (outputCleanupError) {
      buildError = outputCleanupError;
    }
  }
  if (buildError) throw buildError;
  process.stdout.write("Form 1 artifact built and verified.\n");
}

try {
  main();
} catch (error) {
  const message = error instanceof SafeBuildError
    ? error.message
    : "the artifact builder failed safely";
  process.stderr.write(`Form 1 artifact build stopped: ${message}\n`);
  process.exitCode = 1;
}
