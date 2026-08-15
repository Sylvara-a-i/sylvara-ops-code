"use strict";

// The Development deploy script replaces this sentinel only after proving that
// Git HEAD equals APPROVED_SOURCE_REVISION. Unstamped or manually packaged
// source therefore fails configuration before it can access CRM or Data Store.
const ARTIFACT_SOURCE_REVISION = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";

module.exports = { ARTIFACT_SOURCE_REVISION };
