"use strict";

// Immutable Development packaging replaces this sentinel only after proving
// that Git HEAD equals the separately approved source revision.
const ARTIFACT_SOURCE_REVISION = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";
const ARTIFACT_DEVELOPMENT_ZAID_HMAC_SHA256 =
  "__SYLVARA_UNSTAMPED_DEVELOPMENT_ZAID_HMAC_SHA256__";

module.exports = {
  ARTIFACT_DEVELOPMENT_ZAID_HMAC_SHA256,
  ARTIFACT_SOURCE_REVISION,
};
