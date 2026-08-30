"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const COMPONENT_SUBPATH = "src/zoho-catalyst/billing-webhook-gateway";
const FUNCTION_TARGET = "sylvara_client_portal_hmac_gateway_function";
const FUNCTION_ROOT = `functions/${FUNCTION_TARGET}`;
const SOURCE_SENTINEL = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";
const DESTINATION_SENTINEL = "__SYLVARA_UNSTAMPED_CREATOR_DESTINATION_SHA256__";
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES = 24 * 1024 * 1024;
const PRIVATE_BINDING_PATH = `${FUNCTION_ROOT}/lib/creator-destination.js`;

const REQUIRED_SOURCE_FILES = Object.freeze([
  "catalyst-config.example.json",
  "index.js",
  "package-lock.json",
  "package.json",
  "lib/creator-destination.js",
  "lib/source-revision.js",
]);

class ArtifactBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactBuildError";
  }
}

function fail(message) {
  throw new ArtifactBuildError(message);
}

function normalizedPath(value) {
  const result = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? result.toLowerCase() : result;
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`)
    && relative !== ".." && !path.isAbsolute(relative));
}

function safeGitEnvironment() {
  const environment = {
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH || "",
  };
  for (const name of ["ComSpec", "PATHEXT", "SystemRoot", "WINDIR"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

function runGit(repositoryRoot, arguments_, { binary = false } = {}) {
  const result = spawnSync("git", [
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-C", repositoryRoot,
    ...arguments_,
  ], {
    encoding: binary ? null : "utf8",
    env: safeGitEnvironment(),
    maxBuffer: MAX_SOURCE_BYTES,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    fail("approved Git state could not be read safely");
  }
  return result.stdout;
}

function artifactRelativePath(repositoryPath) {
  const prefix = `${COMPONENT_SUBPATH}/`;
  if (!repositoryPath.startsWith(prefix)) return null;
  const relative = repositoryPath.slice(prefix.length);
  if (relative === "catalyst-config.example.json") {
    return `${FUNCTION_ROOT}/catalyst-config.json`;
  }
  if (["index.js", "package.json", "package-lock.json"].includes(relative)) {
    return `${FUNCTION_ROOT}/${relative}`;
  }
  if (/^lib\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(relative)) {
    return `${FUNCTION_ROOT}/${relative}`;
  }
  return null;
}

function parseReleaseTree(tree) {
  const entries = [];
  for (const raw of tree.toString("utf8").split("\0")) {
    if (!raw) continue;
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(raw);
    if (!match) fail("approved Billing gateway tree contains an unsupported entry");
    const repositoryPath = match[3];
    if (
      repositoryPath.includes("\\")
      || path.posix.normalize(repositoryPath) !== repositoryPath
      || repositoryPath.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      fail("approved Billing gateway tree contains an unsafe path");
    }
    const relativePath = artifactRelativePath(repositoryPath);
    if (!relativePath) continue;
    entries.push(Object.freeze({
      artifactPath: relativePath,
      mode: match[1],
      objectId: match[2],
      sourcePath: repositoryPath.slice(`${COMPONENT_SUBPATH}/`.length),
    }));
  }

  const sourcePaths = new Set(entries.map((entry) => entry.sourcePath));
  for (const required of REQUIRED_SOURCE_FILES) {
    if (!sourcePaths.has(required)) fail(`approved Billing gateway tree is missing ${required}`);
  }
  const artifactPaths = entries.map((entry) => entry.artifactPath);
  if (new Set(artifactPaths).size !== artifactPaths.length) {
    fail("approved Billing gateway tree maps more than one source to an artifact path");
  }
  return entries.sort((left, right) => left.artifactPath.localeCompare(right.artifactPath));
}

function gitBlobDigest(content) {
  return crypto.createHash("sha1")
    .update(Buffer.from(`blob ${content.length}\0`))
    .update(content)
    .digest("hex");
}

function safeArtifactPath(projectRoot, relative) {
  if (
    relative.includes("\\")
    || path.posix.normalize(relative) !== relative
    || relative.split("/").some((part) => !/^[A-Za-z0-9._-]+$/.test(part))
  ) {
    fail("artifact contains an unsafe path");
  }
  const destination = path.resolve(projectRoot, ...relative.split("/"));
  if (!isInside(projectRoot, destination) || samePath(projectRoot, destination)) {
    fail("artifact path escaped its isolated root");
  }
  return destination;
}

function readJson(content, label) {
  try {
    return JSON.parse(Buffer.isBuffer(content) ? content.toString("utf8") : content);
  } catch {
    fail(`${label} is invalid`);
  }
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function transformPackage(content) {
  const source = readJson(content, "package.json");
  const dependencies = source.dependencies || {};
  if (
    source.main !== "index.js"
    || source.type !== "commonjs"
    || source.engines?.node !== "24.x"
    || JSON.stringify(dependencies) !== JSON.stringify({ "zcatalyst-sdk-node": "3.4.0" })
  ) {
    fail("source package is outside the reviewed Billing gateway runtime contract");
  }
  return Buffer.from(stableJson({
    name: FUNCTION_TARGET,
    version: source.version,
    private: true,
    description: "Development-only Sylvara Billing webhook HMAC gateway for Zoho Catalyst.",
    main: "index.js",
    type: "commonjs",
    engines: { node: "24.x" },
    dependencies,
  }));
}

function validateRegistryLock(lock, packageJson) {
  const root = lock?.packages?.[""];
  if (
    lock?.name !== FUNCTION_TARGET
    || lock?.lockfileVersion !== 3
    || root?.name !== FUNCTION_TARGET
    || JSON.stringify(root?.dependencies || {}) !== JSON.stringify(packageJson.dependencies)
  ) {
    fail("package lock does not exactly bind the transformed Billing gateway package");
  }
  for (const [packagePath, entry] of Object.entries(lock.packages)) {
    if (packagePath === "") continue;
    const normalized = packagePath.split("\\").join("/");
    if (
      normalized !== packagePath
      || !normalized.startsWith("node_modules/")
      || normalized.split("/").some((part) => !part || part === "." || part === "..")
      || entry?.link === true
    ) {
      fail("package lock contains an escaping or linked dependency");
    }
    if (entry.resolved !== undefined) {
      let resolved;
      try {
        resolved = new URL(entry.resolved);
      } catch {
        fail("package lock contains an invalid dependency source");
      }
      if (
        resolved.protocol !== "https:"
        || resolved.hostname !== "registry.npmjs.org"
        || resolved.username
        || resolved.password
        || typeof entry.integrity !== "string"
        || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)
      ) {
        fail("package lock contains a dependency outside the approved registry boundary");
      }
    }
  }
}

function transformLock(content, packageJson) {
  const lock = readJson(content, "package-lock.json");
  if (!lock?.packages?.[""]) fail("package-lock.json has no root package");
  lock.name = FUNCTION_TARGET;
  lock.packages[""].name = FUNCTION_TARGET;
  validateRegistryLock(lock, packageJson);
  return Buffer.from(stableJson(lock));
}

function transformCatalystConfig(content) {
  const config = readJson(content, "catalyst-config.example.json");
  if (
    config?.deployment?.name !== FUNCTION_TARGET
    || config?.deployment?.stack !== "node24"
    || config?.deployment?.type !== "advancedio"
    || config?.execution?.main !== "index.js"
  ) {
    fail("Catalyst function configuration is outside the exact Development target contract");
  }
  return Buffer.from(stableJson(config));
}

function transformEntry(entry, content, packageJson) {
  if (entry.sourcePath === "package.json") return Buffer.from(stableJson(packageJson));
  if (entry.sourcePath === "package-lock.json") return transformLock(content, packageJson);
  if (entry.sourcePath === "catalyst-config.example.json") {
    return transformCatalystConfig(content);
  }
  return content;
}

function exportRelease(repositoryRoot, entries, projectRoot) {
  fs.mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
  const sourceContents = new Map();
  let totalBytes = 0;
  for (const entry of entries) {
    const content = runGit(repositoryRoot, ["cat-file", "blob", entry.objectId], { binary: true });
    totalBytes += content.length;
    if (totalBytes > MAX_SOURCE_BYTES || gitBlobDigest(content) !== entry.objectId) {
      fail("approved Billing gateway blob failed integrity validation");
    }
    sourceContents.set(entry.sourcePath, content);
  }
  const packageJson = readJson(transformPackage(sourceContents.get("package.json")), "package.json");
  for (const entry of entries) {
    const destination = safeArtifactPath(projectRoot, entry.artifactPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      destination,
      transformEntry(entry, sourceContents.get(entry.sourcePath), packageJson),
      { flag: "wx", mode: entry.mode === "100755" ? 0o700 : 0o600 },
    );
  }
  const catalyst = {
    functions: {
      source: "functions",
      targets: [FUNCTION_TARGET],
      ignore: ["**/node_modules/**", "**/test/**", "**/.env*"],
    },
  };
  fs.writeFileSync(path.join(projectRoot, "catalyst.json"), stableJson(catalyst), {
    flag: "wx",
    mode: 0o600,
  });
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function stampFile(file, sentinel, value, label) {
  const source = fs.readFileSync(file, "utf8");
  if (count(source, sentinel) !== 1) fail(`${label} template is not the exact unstamped form`);
  fs.writeFileSync(file, source.replace(sentinel, value), { encoding: "utf8", flag: "w" });
  const readback = fs.readFileSync(file, "utf8");
  if (count(readback, value) !== 1 || readback.includes(sentinel)) {
    fail(`${label} stamp failed exact readback`);
  }
}

function stampArtifact(projectRoot, sourceRevision, creatorDestinationSha256) {
  stampFile(
    path.join(projectRoot, ...`${FUNCTION_ROOT}/lib/source-revision.js`.split("/")),
    SOURCE_SENTINEL,
    sourceRevision,
    "source revision",
  );
  stampFile(
    path.join(projectRoot, ...PRIVATE_BINDING_PATH.split("/")),
    DESTINATION_SENTINEL,
    creatorDestinationSha256,
    "Creator destination binding",
  );
}

function walkFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory).sort().reverse()) {
      const candidate = path.join(directory, name);
      const metadata = fs.lstatSync(candidate);
      if (metadata.isSymbolicLink()) fail("artifact contains a symbolic link");
      if (metadata.isDirectory()) pending.push(candidate);
      else if (metadata.isFile()) files.push(candidate);
      else fail("artifact contains an unsupported file type");
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function validateArtifact(projectRoot, sourceRevision, creatorDestinationSha256) {
  const catalyst = readJson(fs.readFileSync(path.join(projectRoot, "catalyst.json")), "catalyst.json");
  if (
    catalyst?.functions?.source !== "functions"
    || JSON.stringify(catalyst?.functions?.targets) !== JSON.stringify([FUNCTION_TARGET])
  ) {
    fail("artifact must contain exactly the approved Billing gateway target");
  }
  const functionRoot = path.join(projectRoot, "functions", FUNCTION_TARGET);
  const functionConfig = readJson(
    fs.readFileSync(path.join(functionRoot, "catalyst-config.json")),
    "catalyst-config.json",
  );
  if (
    functionConfig?.deployment?.name !== FUNCTION_TARGET
    || functionConfig?.deployment?.type !== "advancedio"
    || functionConfig?.deployment?.stack !== "node24"
    || functionConfig?.execution?.main !== "index.js"
  ) {
    fail("artifact Catalyst target is not the exact Advanced I/O function");
  }
  const packageJson = readJson(fs.readFileSync(path.join(functionRoot, "package.json")), "package.json");
  const lock = readJson(fs.readFileSync(path.join(functionRoot, "package-lock.json")), "package-lock.json");
  if (packageJson?.name !== FUNCTION_TARGET || packageJson?.scripts !== undefined) {
    fail("artifact package metadata is not release-only");
  }
  validateRegistryLock(lock, packageJson);

  const sourceStamp = fs.readFileSync(path.join(functionRoot, "lib", "source-revision.js"), "utf8");
  const destinationStamp = fs.readFileSync(path.join(functionRoot, "lib", "creator-destination.js"), "utf8");
  if (
    count(sourceStamp, sourceRevision) !== 1
    || sourceStamp.includes(SOURCE_SENTINEL)
    || count(destinationStamp, creatorDestinationSha256) !== 1
    || destinationStamp.includes(DESTINATION_SENTINEL)
  ) {
    fail("artifact immutable binding readback failed");
  }
  for (const file of walkFiles(projectRoot)) {
    const relative = path.relative(projectRoot, file).split(path.sep).join("/");
    if (
      /(^|\/)test(\/|$)/.test(relative)
      || /(^|\/)\.env(?:\.|$)/.test(relative)
      || /\.md$/i.test(relative)
      || relative.startsWith("tools/")
      || relative.startsWith("config/")
    ) {
      fail("artifact contains a test, environment file, document, or source-only tool");
    }
  }
}

function createManifest(projectRoot, sourceRevision) {
  const files = walkFiles(projectRoot).map((file) => {
    const content = fs.readFileSync(file);
    const relative = path.relative(projectRoot, file).split(path.sep).join("/");
    if (relative === PRIVATE_BINDING_PATH) {
      return {
        path: relative,
        bytes: content.length,
        sha256_disclosure: "omitted_private_destination_binding",
      };
    }
    return {
      path: relative,
      bytes: content.length,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
    };
  });
  return {
    schema_version: 1,
    artifact_kind: "billing-webhook-gateway-development",
    source_revision: sourceRevision,
    function_target: FUNCTION_TARGET,
    function_type: "advancedio",
    function_stack: "node24",
    creator_destination_binding: {
      stamped: true,
      value_disclosed: false,
      file_digest_disclosed: false,
    },
    deployed: false,
    files,
  };
}

function parseArguments(argv) {
  let outputRoot = null;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" && !help) {
      help = true;
    } else if (argument === "--output" && outputRoot === null && argv[index + 1]) {
      outputRoot = argv[index + 1];
      index += 1;
    } else {
      fail("supported arguments are --help and one optional --output path");
    }
  }
  if (help && (outputRoot !== null || argv.length !== 1)) {
    fail("--help cannot be combined with build arguments");
  }
  return Object.freeze({ help, outputRoot });
}

function outputLocation(repositoryRoot, requestedOutput) {
  if (requestedOutput === null || requestedOutput === undefined) {
    const temporaryParent = fs.realpathSync(os.tmpdir());
    const stagingRoot = fs.mkdtempSync(path.join(
      temporaryParent,
      "sylvara-billing-gateway-development-",
    ));
    return Object.freeze({ finalRoot: stagingRoot, stagingRoot, temporaryParent, rename: false });
  }
  if (typeof requestedOutput !== "string" || !path.isAbsolute(requestedOutput)) {
    fail("--output must be an absolute path");
  }
  const resolvedRequest = path.resolve(requestedOutput);
  if (fs.existsSync(resolvedRequest)) fail("--output must not already exist");
  const basename = path.basename(resolvedRequest);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(basename)) {
    fail("--output has an unsafe final directory name");
  }
  let temporaryParent;
  try {
    temporaryParent = fs.realpathSync(path.dirname(resolvedRequest));
  } catch {
    fail("--output parent must already exist");
  }
  const finalRoot = path.join(temporaryParent, basename);
  if (isInside(repositoryRoot, finalRoot)) fail("--output must be outside the Git repository");
  if (fs.existsSync(finalRoot)) fail("--output must not already exist");
  const stagingRoot = fs.mkdtempSync(path.join(temporaryParent, `.${basename}.partial-`));
  return Object.freeze({ finalRoot, stagingRoot, temporaryParent, rename: true });
}

function safeCleanup(stagingRoot, temporaryParent) {
  if (
    typeof stagingRoot !== "string"
    || !stagingRoot
    || !isInside(temporaryParent, stagingRoot)
    || samePath(stagingRoot, temporaryParent)
    || !/^\.?[A-Za-z0-9._-]*(?:partial-|development-)[A-Za-z0-9._-]*$/.test(
      path.basename(stagingRoot),
    )
  ) return;
  fs.rmSync(stagingRoot, { recursive: true, force: true });
}

function build({
  environment = process.env,
  outputRoot = null,
  scriptPath = __filename,
} = {}) {
  const sourceRevision = String(environment.APPROVED_SOURCE_REVISION || "");
  const creatorDestinationSha256 = String(
    environment.APPROVED_CREATOR_DESTINATION_SHA256 || "",
  );
  if (!REVISION_PATTERN.test(sourceRevision)) {
    fail("APPROVED_SOURCE_REVISION is missing or invalid");
  }
  if (!DIGEST_PATTERN.test(creatorDestinationSha256)) {
    fail("APPROVED_CREATOR_DESTINATION_SHA256 is missing or invalid");
  }

  const componentRoot = fs.realpathSync(path.resolve(path.dirname(scriptPath), ".."));
  const repositoryRoot = fs.realpathSync(String(runGit(
    componentRoot,
    ["rev-parse", "--show-toplevel"],
  )).trim());
  if (!samePath(componentRoot, path.join(repositoryRoot, ...COMPONENT_SUBPATH.split("/")))) {
    fail("artifact builder is outside the approved Billing gateway component path");
  }
  const head = String(runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"])).trim();
  if (head !== sourceRevision) fail("HEAD is not the exact approved source revision");
  const resolved = String(runGit(
    repositoryRoot,
    ["rev-parse", "--verify", `${sourceRevision}^{commit}`],
  )).trim();
  if (resolved !== sourceRevision) fail("approved source revision does not resolve exactly");
  if (runGit(
    repositoryRoot,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { binary: true },
  ).length) {
    fail("repository checkout is not clean");
  }

  const entries = parseReleaseTree(runGit(repositoryRoot, [
    "ls-tree", "-r", "-z", "--full-tree", sourceRevision, "--", COMPONENT_SUBPATH,
  ], { binary: true }));
  const location = outputLocation(repositoryRoot, outputRoot);
  try {
    exportRelease(repositoryRoot, entries, location.stagingRoot);
    stampArtifact(location.stagingRoot, sourceRevision, creatorDestinationSha256);
    validateArtifact(location.stagingRoot, sourceRevision, creatorDestinationSha256);
    const manifestPath = path.join(location.stagingRoot, "release-manifest.json");
    fs.writeFileSync(manifestPath, stableJson(createManifest(location.stagingRoot, sourceRevision)), {
      flag: "wx",
      mode: 0o600,
    });
    if (runGit(
      repositoryRoot,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { binary: true },
    ).length) {
      fail("repository checkout changed during the artifact build");
    }
    if (location.rename) {
      if (fs.existsSync(location.finalRoot)) fail("--output appeared during the build");
      fs.renameSync(location.stagingRoot, location.finalRoot);
    }
    return Object.freeze({
      artifactRoot: location.finalRoot,
      manifestPath: path.join(location.finalRoot, "release-manifest.json"),
      sourceRevision,
      functionTarget: FUNCTION_TARGET,
      deployed: false,
    });
  } catch (error) {
    safeCleanup(location.stagingRoot, location.temporaryParent);
    throw error;
  }
}

function help() {
  return [
    "Build the isolated Billing webhook gateway Catalyst Development artifact.",
    "Required environment: APPROVED_SOURCE_REVISION (must equal clean HEAD).",
    "Required private build input: APPROVED_CREATOR_DESTINATION_SHA256.",
    "Optional: --output <absolute new directory outside the repository>.",
    "The builder never installs dependencies, deploys, or modifies the checkout.",
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  const result = build({ outputRoot: options.outputRoot });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Billing gateway artifact build stopped: ${
      error instanceof ArtifactBuildError ? error.message : "unexpected failure"
    }\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ArtifactBuildError,
  COMPONENT_SUBPATH,
  FUNCTION_TARGET,
  PRIVATE_BINDING_PATH,
  build,
  createManifest,
  parseArguments,
  parseReleaseTree,
  safeCleanup,
  stampArtifact,
  validateArtifact,
};
