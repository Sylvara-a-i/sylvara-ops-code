"use strict";

// The reviewed Development deploy script replaces this sentinel only in its
// isolated temporary artifact. A checkout or manually packaged function stays
// unstamped and therefore fails closed before reaching CRM or Data Store.
const ARTIFACT_FORM_DESTINATION_SHA256 =
  "__SYLVARA_UNSTAMPED_FORM_DESTINATION_SHA256__";

module.exports = { ARTIFACT_FORM_DESTINATION_SHA256 };
