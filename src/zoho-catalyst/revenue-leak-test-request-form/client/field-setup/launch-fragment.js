(function exposeLaunchFragmentContract(root, factory) {
  const contract = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = contract;
  }

  if (root && root.location && root.history) {
    contract.captureAndRemove(root.location, root.history);
    root.FieldSetupLaunch = contract;
  }
})(typeof globalThis === "object" ? globalThis : undefined, function createLaunchFragmentContract() {
  "use strict";

  const LAUNCH_FRAGMENT_PATTERN = /^#launch=([A-Za-z0-9_-]{43,128})$/;
  let transientLaunchNonce = null;

  function safeReplacementPath(locationLike) {
    const pathname = typeof locationLike.pathname === "string" ? locationLike.pathname : "/field-setup/";
    const search = typeof locationLike.search === "string" ? locationLike.search : "";
    return `${pathname}${search}`;
  }

  function captureAndRemove(locationLike, historyLike) {
    const fragment = typeof locationLike.hash === "string" ? locationLike.hash : "";
    const match = LAUNCH_FRAGMENT_PATTERN.exec(fragment);

    if (fragment && historyLike && typeof historyLike.replaceState === "function") {
      historyLike.replaceState(null, "", safeReplacementPath(locationLike));
    }

    transientLaunchNonce = match ? match[1] : null;
    return transientLaunchNonce !== null;
  }

  function consumeLaunchNonce() {
    const nonce = transientLaunchNonce;
    transientLaunchNonce = null;
    return nonce;
  }

  return Object.freeze({
    captureAndRemove,
    consumeLaunchNonce
  });
});
