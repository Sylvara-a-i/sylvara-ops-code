"use strict";

const fs = require("node:fs");
const path = require("node:path");

const functionRoot = path.resolve(__dirname, "../functions/form1_assisted_controller");
const outputPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
const sourceRevision = process.argv[3] ?? "";

if (!outputPath || !/^[a-f0-9]{40}$/.test(sourceRevision)) {
  throw new Error("usage: node build-single-file.js <output-path> <40-char-source-revision>");
}

const moduleIds = [
  "index.js",
  ...fs
    .readdirSync(path.join(functionRoot, "lib"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => `lib/${entry.name}`)
    .sort(),
];

function sourceFor(moduleId) {
  const absolute = path.join(functionRoot, moduleId);
  let source = fs.readFileSync(absolute, "utf8");
  if (moduleId === "lib/source-revision.js") {
    const sentinel = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";
    if (!source.includes(sentinel)) throw new Error("source revision sentinel is missing");
    source = source.replace(sentinel, sourceRevision);
  }
  if (source.includes("__SYLVARA_UNSTAMPED_SOURCE_REVISION__")) {
    throw new Error(`unstamped revision remains in ${moduleId}`);
  }
  return source;
}

const wrappers = moduleIds
  .map((moduleId) => {
    const source = sourceFor(moduleId);
    return `${JSON.stringify(moduleId)}: function(module, exports, require) {\n${source}\n}`;
  })
  .join(",\n");

const bundle = `"use strict";

// Deterministically generated from reviewed modular source at ${sourceRevision}.
// External Node built-ins and the Catalyst SDK remain native runtime imports.
const __nativeRequire = require;
const __bundleModules = Object.freeze({
${wrappers}
});
const __bundleCache = Object.create(null);

function __resolveBundleModule(fromId, request) {
  if (typeof request !== "string" || !request.startsWith(".")) return null;
  const segments = fromId.split("/");
  segments.pop();
  for (const segment of request.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new Error("bundle module escaped its root");
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  let resolved = segments.join("/");
  if (!resolved.endsWith(".js")) resolved += ".js";
  if (!Object.prototype.hasOwnProperty.call(__bundleModules, resolved)) {
    throw new Error("bundle module was not found: " + resolved);
  }
  return resolved;
}

function __loadBundleModule(moduleId) {
  if (Object.prototype.hasOwnProperty.call(__bundleCache, moduleId)) {
    return __bundleCache[moduleId].exports;
  }
  const factory = __bundleModules[moduleId];
  if (typeof factory !== "function") throw new Error("invalid bundle module: " + moduleId);
  const loaded = { exports: {} };
  __bundleCache[moduleId] = loaded;
  const localRequire = (request) => {
    const bundled = __resolveBundleModule(moduleId, request);
    return bundled ? __loadBundleModule(bundled) : __nativeRequire(request);
  };
  factory(loaded, loaded.exports, localRequire);
  return loaded.exports;
}

module.exports = __loadBundleModule("index.js");
`;

fs.writeFileSync(outputPath, bundle, { encoding: "utf8", mode: 0o644 });
process.stdout.write(`${outputPath}\n`);
