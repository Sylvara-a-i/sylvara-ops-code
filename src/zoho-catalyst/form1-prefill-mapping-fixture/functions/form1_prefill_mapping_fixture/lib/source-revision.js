"use strict";

// Deployment tooling replaces this sentinel only in an immutable artifact.
// Unstamped source cannot satisfy active-mode configuration.
const ARTIFACT_SOURCE_REVISION = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";

module.exports = { ARTIFACT_SOURCE_REVISION };
