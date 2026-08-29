"use strict";

const crypto = require("node:crypto");

const REVISION = "1".repeat(40);
const SYNTHETIC_CATALYST_PROJECT_ID = "100000000000001";
const SYNTHETIC_CATALYST_PROJECT_ID_SHA256 = crypto
  .createHash("sha256")
  .update(SYNTHETIC_CATALYST_PROJECT_ID, "utf8")
  .digest("hex");

function environment(overrides = {}) {
  return {
    DEPLOYMENT_ENVIRONMENT: "development",
    DEPLOYMENT_MODE: "contained",
    EXPECTED_CATALYST_PROJECT_ID_SHA256: SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
    SOURCE_REVISION: REVISION,
    ISSUE_PATH: "/form1/issue-test",
    PREFILL_PATH: "/form1/prefill-test",
    ISSUE_HEADER_NAME: "x-sylvara-issue-test",
    PREFILL_HEADER_NAME: "x-sylvara-prefill-test",
    ISSUE_HEADER_SECRET: "i".repeat(43),
    PREFILL_HEADER_SECRET: "p".repeat(43),
    ...overrides,
  };
}

module.exports = {
  REVISION,
  SYNTHETIC_CATALYST_PROJECT_ID,
  SYNTHETIC_CATALYST_PROJECT_ID_SHA256,
  environment,
};
