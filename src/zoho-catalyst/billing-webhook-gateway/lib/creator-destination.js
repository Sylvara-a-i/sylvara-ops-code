"use strict";

// The deployment artifact must replace this sentinel only after an operator has
// reviewed the exact Creator Custom API URL and calculated its SHA-256 digest.
// Runtime configuration alone can never authorize a credential destination.
const ARTIFACT_CREATOR_DESTINATION_SHA256 =
  "__SYLVARA_UNSTAMPED_CREATOR_DESTINATION_SHA256__";

module.exports = { ARTIFACT_CREATOR_DESTINATION_SHA256 };
