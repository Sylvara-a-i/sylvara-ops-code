"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "../lib");

// An isolated same-context loader replaces only the reviewed predecessor
// registry with synthetic evidence. Runtime registry/source files are untouched.
function loadWithSyntheticRegistry(registry) {
  const cache = new Map();
  function load(filename) {
    if (filename === path.join(root, "recovery-phone-policy-revisions.js")) return registry;
    if (cache.has(filename)) return cache.get(filename).exports;
    const selected = new Module(filename, module);
    selected.filename = filename;
    selected.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, selected);
    const nativeRequire = Module.createRequire(filename);
    selected.require = (request) => {
      if (!request.startsWith(".")) return nativeRequire(request);
      const target = path.resolve(path.dirname(filename), request + (path.extname(request) ? "" : ".js"));
      if (!target.startsWith(root + path.sep)) throw new Error("Synthetic loader dependency escaped");
      return load(target);
    };
    selected._compile(fs.readFileSync(filename, "utf8"), filename);
    return selected.exports;
  }
  return {
    loadConfig: load(path.join(root, "config.js")).loadConfig,
    recover: load(path.join(root, "submission-recovery.js")).recoverAssistedSubmission,
    handleRequest: load(path.join(root, "handler.js")).handleRequest,
  };
}
module.exports = { loadWithSyntheticRegistry };
