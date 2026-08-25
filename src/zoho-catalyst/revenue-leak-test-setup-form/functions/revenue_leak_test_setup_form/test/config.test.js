"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { brotliCompressSync } = require("node:zlib");
const {
  ConfigurationError,
  FORM2_PREFILL_TABLE_NAME,
  FORM2_PROOF_TABLE_NAME,
  FORM2_SESSION_TABLE_NAME,
  FORM2_SUBMISSION_TABLE_NAME,
  NUMERIC_LIMITS,
  PRIVATE_CHOICE_LIMITS,
  loadConfig,
} = require("../lib/config");
const { destinationDigest } = require("../lib/destinations");

const FORM2_PUBLIC_URL =
  "https://forms.zohopublic.com/synthetic/form/perma/synthetic";
const FORM2_DESTINATION_SHA256 = destinationDigest(FORM2_PUBLIC_URL);

function providerChoices(count) {
  return Array.from(
    { length: count },
    (_, index) => `Synthetic Provider ${String(index + 1).padStart(3, "0")}`,
  );
}

function compressedChoices(choices) {
  return `br:${brotliCompressSync(Buffer.from(JSON.stringify(choices), "utf8"))
    .toString("base64url")}`;
}

function baseEnvironment(overrides = {}) {
  return {
    DEPLOYMENT_ENVIRONMENT: "development",
    DEPLOYMENT_MODE: "active",
    SESSION_TABLE_NAME: FORM2_SESSION_TABLE_NAME,
    PREFILL_TABLE_NAME: FORM2_PREFILL_TABLE_NAME,
    SUBMISSION_TABLE_NAME: FORM2_SUBMISSION_TABLE_NAME,
    FORM2_PROOF_TABLE_NAME: FORM2_PROOF_TABLE_NAME,
    ISSUE_PATH: "/form2/session/issue",
    FORM2_ACCESS_PATH: "/form2/session/access",
    FORM2_OTP_REQUEST_PATH: "/form2/session/otp/request",
    FORM2_OTP_VERIFY_PATH: "/form2/session/otp/verify",
    PREFILL_PATH: "/form2/session/prefill",
    SUBMISSION_PATH: "/form2/session/submit",
    ISSUE_HEADER_NAME: "x-sylvara-issue-key",
    ISSUE_HEADER_SECRET: "I".repeat(43),
    FORMS_HEADER_NAME: "x-sylvara-forms-key",
    PREFILL_HEADER_SECRET: "F".repeat(43),
    SUBMISSION_HEADER_SECRET: "S".repeat(43),
    TOKEN_PEPPER: "P".repeat(43),
    WORKFLOW_HMAC_SECRET: "W".repeat(43),
    FORM2_PROOF_HMAC_SECRET: "V".repeat(43),
    FORM2_ACCESS_PUBLIC_URL: "https://synthetic.development.catalystserverless.com/form2/session/access",
    FORM2_PUBLIC_URL,
    FORM2_PROOF_MODE: "stub",
    FORM2_MAIL_FROM: "synthetic@example.invalid",
    FORM2_PROOF_ALLOWED_RECIPIENT_DIGESTS: "[]",
    FORM2_PROOF_TEMPLATE_VERSION: "email-otp-v1",
    FORM2_TOKEN_FIELD_ALIAS: "access_token",
    FORM2_FORM_VERSION: "form2-v1",
    FORM2_ENTRY_OFFER_VALUE: "Synthetic Free Test",
    FORM2_PHONE_SYSTEM_PROVIDERS: '["Synthetic PBX","Different Synthetic PBX"]',
    FORM2_FIELD_TEAM_SIZE_BANDS: '["Synthetic Approved Band","Different Private Band"]',
    FORM2_ACCESS_STATUS_INITIAL_VALUE: "Synthetic Initial",
    FORM2_ACCESS_STATUS_ISSUED_VALUE: "Synthetic Issued",
    FORM2_ACCESS_STATUS_VERIFIED_VALUE: "Synthetic Verified",
    FORM2_ACCESS_STATUS_SUBMITTED_VALUE: "Synthetic Submitted",
    FORM2_ACCESS_STATUS_EXPIRED_VALUE: "Synthetic Expired",
    CRM_API_BASE_URL: "https://www.zohoapis.com/crm/v8",
    CRM_READ_CONNECTION_LINK_NAME: "SyntheticCrmRead",
    CRM_WRITE_CONNECTION_LINK_NAME: "SyntheticCrmWrite",
    SOURCE_REVISION: "a".repeat(40),
    ...overrides,
  };
}

function load(environment = baseEnvironment()) {
  return loadConfig(
    environment,
    environment.SOURCE_REVISION,
    FORM2_DESTINATION_SHA256,
  );
}

test("loads an immutable active Development configuration with bounded defaults", () => {
  const config = load();
  assert.equal(config.deploymentEnvironment, "development");
  assert.equal(config.deploymentMode, "active");
  assert.equal(config.darkMode, false);
  assert.equal(config.tokenPepper, "P".repeat(43));
  assert.equal(config.workflowKeyMaterial, "W".repeat(43));
  assert.equal(config.sessionTableName, FORM2_SESSION_TABLE_NAME);
  assert.equal(config.prefillTableName, FORM2_PREFILL_TABLE_NAME);
  assert.equal(config.submissionTableName, FORM2_SUBMISSION_TABLE_NAME);
  assert.equal(config.proofTableName, FORM2_PROOF_TABLE_NAME);
  assert.equal(config.sessionTtlSeconds, 3600);
  assert.equal(config.verifiedSessionTtlSeconds, 1800);
  assert.equal(config.maxVerificationAttempts, 3);
  assert.equal(config.form2ProofTtlSeconds, 600);
  assert.equal(config.form2ProofMaxAttempts, 5);
  assert.equal(config.form2ProofMaxSends, 3);
  assert.deepEqual(config.form2ProofAllowedRecipientDigests, []);
  assert.ok(Object.isFrozen(config.form2ProofAllowedRecipientDigests));
  assert.equal(config.form2ProofResendCooldownSeconds, 60);
  assert.equal(config.form2ProofSendLeaseSeconds, 30);
  assert.equal(config.maxSubmissionAttempts, 3);
  assert.equal(config.maxBodyBytes, 32768);
  assert.equal(config.outboundMaxBytes, 131072);
  assert.deepEqual(config.form2PhoneSystemProviders, [
    "Synthetic PBX",
    "Different Synthetic PBX",
  ]);
  assert.ok(Object.isFrozen(config.form2PhoneSystemProviders));
  assert.deepEqual(config.form2FieldTeamSizeBands, [
    "Synthetic Approved Band",
    "Different Private Band",
  ]);
  assert.ok(Object.isFrozen(config.form2FieldTeamSizeBands));
  assert.deepEqual(config.form2AccessStatuses, {
    initial: "Synthetic Initial",
    issued: "Synthetic Issued",
    verified: "Synthetic Verified",
    submitted: "Synthetic Submitted",
    expired: "Synthetic Expired",
  });
  assert.ok(Object.isFrozen(config.form2AccessStatuses));
  assert.ok(Object.isFrozen(config));
});

test("Development proof delivery requires a bounded private recipient digest allowlist", () => {
  const approvedDigest = "a".repeat(64);
  const config = load(baseEnvironment({
    FORM2_PROOF_MODE: "send_development",
    FORM2_PROOF_ALLOWED_RECIPIENT_DIGESTS: JSON.stringify([approvedDigest]),
  }));
  assert.deepEqual(config.form2ProofAllowedRecipientDigests, [approvedDigest]);
  for (const value of [
    "[]",
    '["not-a-digest"]',
    JSON.stringify([approvedDigest, approvedDigest]),
    JSON.stringify(Array.from({ length: 17 }, (_, index) =>
      index.toString(16).padStart(64, "0"))),
  ]) {
    assert.throws(() => load(baseEnvironment({
      FORM2_PROOF_MODE: "send_development",
      FORM2_PROOF_ALLOWED_RECIPIENT_DIGESTS: value,
    })), ConfigurationError);
  }
});

test("accepts the 207-provider catalog and rejects growth above the reviewed bound", () => {
  const providers = providerChoices(207);
  const config = load(baseEnvironment({
    FORM2_PHONE_SYSTEM_PROVIDERS: compressedChoices(providers),
  }));
  assert.deepEqual(config.form2PhoneSystemProviders, providers);
  assert.equal(PRIVATE_CHOICE_LIMITS.phoneSystemProviders, 256);
  assert.throws(
    () => load(baseEnvironment({
      FORM2_PHONE_SYSTEM_PROVIDERS: JSON.stringify(
        providerChoices(PRIVATE_CHOICE_LIMITS.phoneSystemProviders + 1),
      ),
    })),
    ConfigurationError,
  );
  assert.equal(PRIVATE_CHOICE_LIMITS.fieldTeamSizeBands, 20);
  assert.throws(
    () => load(baseEnvironment({
      FORM2_FIELD_TEAM_SIZE_BANDS: JSON.stringify(
        Array.from({ length: 21 }, (_, index) => `Synthetic Band ${index + 1}`),
      ),
    })),
    ConfigurationError,
  );
});

test("bounds and validates compressed private-choice configuration", () => {
  for (const value of [
    "br:",
    "br:not+base64url",
    `br:${"A".repeat(4097)}`,
    `br:${Buffer.from("not-brotli", "utf8").toString("base64url")}`,
    `${compressedChoices(["Synthetic PBX"])}=`,
    compressedChoices("not-an-array"),
    `br:${brotliCompressSync(Buffer.alloc(32769, 0x41)).toString("base64url")}`,
    `br:${brotliCompressSync(Buffer.from([0xff])).toString("base64url")}`,
    compressedChoices(["Duplicate", "Duplicate"]),
    compressedChoices(providerChoices(PRIVATE_CHOICE_LIMITS.phoneSystemProviders + 1)),
    compressedChoices(["P".repeat(121)]),
  ]) {
    assert.throws(
      () => load(baseEnvironment({ FORM2_PHONE_SYSTEM_PROVIDERS: value })),
      ConfigurationError,
    );
  }
  assert.throws(
    () => load(baseEnvironment({
      FORM2_FIELD_TEAM_SIZE_BANDS: compressedChoices(["Synthetic Approved Band"]),
    })),
    ConfigurationError,
  );
});

test("allows only active Development or dependency-free dark Production", () => {
  const darkEnvironment = baseEnvironment({
    DEPLOYMENT_ENVIRONMENT: "production",
    DEPLOYMENT_MODE: "dark",
  });
  const dark = load(darkEnvironment);
  assert.deepEqual(dark, {
    darkMode: true,
    deploymentEnvironment: "production",
    deploymentMode: "dark",
    sourceRevision: darkEnvironment.SOURCE_REVISION,
  });

  for (const [deploymentEnvironment, deploymentMode] of [
    ["production", "active"],
    ["Production", "dark"],
    ["development ", "active"],
    ["development", "dark"],
    ["test", "dark"],
    ["", "active"],
  ]) {
    assert.throws(
      () => load(baseEnvironment({ DEPLOYMENT_ENVIRONMENT: deploymentEnvironment, DEPLOYMENT_MODE: deploymentMode })),
      ConfigurationError,
    );
  }
});

test("requires separate safe Data Store table identifiers", () => {
  for (const overrides of [
    { FORM2_ACCESS_PUBLIC_URL: "https://controller.example.invalid/form2/session/access" },
    { FORM2_ACCESS_PUBLIC_URL: "https://synthetic.catalystserverless.com/form2/session/access" },
    { FORM2_ACCESS_PUBLIC_URL: "https://synthetic.development.catalystserverless.com/form2/session/other" },
    { SESSION_TABLE_NAME: "unsafe-name" },
    { SESSION_TABLE_NAME: "Form2_Sessions" },
    { SESSION_TABLE_NAME: "Form2SessionsV3" },
    { PREFILL_TABLE_NAME: "AlternatePrefillsV3" },
    { SUBMISSION_TABLE_NAME: FORM2_PREFILL_TABLE_NAME },
    { FORM2_PROOF_TABLE_NAME: "AlternateProofsV3" },
    { PREFILL_TABLE_NAME: "" },
  ]) {
    assert.throws(() => load(baseEnvironment(overrides)), ConfigurationError);
  }
});

test("requires six unique exact routes and isolated custom-header names", () => {
  for (const overrides of [
    { ISSUE_PATH: "/form2/session/prefill" },
    { PREFILL_PATH: "form2/session/prefill" },
    { SUBMISSION_PATH: "/form2//session/submit" },
    { ISSUE_HEADER_NAME: "X-Sylvara-Issue-Key" },
    { ISSUE_HEADER_NAME: "x-sylvara-forms-key" },
    { FORMS_HEADER_NAME: "authorization" },
  ]) {
    assert.throws(() => load(baseEnvironment(overrides)), ConfigurationError);
  }
});

test("requires independently generated printable route and key-derivation secrets", () => {
  const syntheticValueWithNewline = `${"F".repeat(32)}\n`;
  for (const overrides of [
    { TOKEN_PEPPER: "short" },
    { WORKFLOW_HMAC_SECRET: "short" },
    { WORKFLOW_HMAC_SECRET: "P".repeat(43) },
    { ISSUE_HEADER_SECRET: "I".repeat(31) },
    { PREFILL_HEADER_SECRET: syntheticValueWithNewline },
    { SUBMISSION_HEADER_SECRET: "P".repeat(43) },
    { PREFILL_HEADER_SECRET: "S".repeat(43) },
  ]) {
    assert.throws(() => load(baseEnvironment(overrides)), ConfigurationError);
  }
});

test("accepts only exact HTTPS form and regional Zoho CRM API URLs", () => {
  for (const overrides of [
    { FORM2_PUBLIC_URL: "http://forms.zohopublic.com/synthetic/form" },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.com/" },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.com/synthetic/form?token=value" },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.com/synthetic/form/perma/synthetic?" },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.com/synthetic/form/perma/synthetic#" },
    { FORM2_PUBLIC_URL: "https://FORMS.ZOHOPUBLIC.COM/synthetic/form/perma/synthetic" },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.com:443/synthetic/form/perma/synthetic" },
    {
      FORM2_PUBLIC_URL: [
        "https://synthetic-user",
        "forms.zohopublic.com/synthetic/form/perma/synthetic",
      ].join("@"),
    },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.com/synthetic/form/other/../perma/synthetic" },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.com/synthetic/form/perma/%73ynthetic" },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.evil.com/synthetic/form" },
    { FORM2_PUBLIC_URL: "https://forms.example.invalid/synthetic/form" },
    { FORM2_PUBLIC_URL: "https://forms.zohopublic.com/other/form/perma/synthetic" },
    { CRM_API_BASE_URL: "https://example.invalid/crm/v8" },
    { CRM_API_BASE_URL: "https://zohoapis.evil.com/crm/v8" },
    { CRM_API_BASE_URL: "https://www.zohoapis.evil.com/crm/v8" },
    { CRM_API_BASE_URL: "https://www.zohoapis.eu/crm/v8" },
    { CRM_API_BASE_URL: "https://www.zohoapis.com/crm/v8/Leads" },
    { CRM_API_BASE_URL: "https://www.zohoapis.com:444/crm/v8" },
    { CRM_API_BASE_URL: "https://WWW.ZOHOAPIS.COM/crm/v8" },
    { CRM_API_BASE_URL: "https://www.zohoapis.com:443/crm/v8" },
    { CRM_API_BASE_URL: "https://www.zohoapis.com/crm/v8?" },
    { CRM_API_BASE_URL: "https://www.zohoapis.com/crm/v8#" },
  ]) {
    assert.throws(() => load(baseEnvironment(overrides)), ConfigurationError);
  }
});

test("requires the exact form destination stamped into the artifact", () => {
  const environment = baseEnvironment();
  assert.throws(
    () => loadConfig(environment, environment.SOURCE_REVISION),
    ConfigurationError,
  );
  assert.throws(
    () => loadConfig(
      environment,
      environment.SOURCE_REVISION,
      "0".repeat(64),
    ),
    ConfigurationError,
  );
});

test("parses all numeric controls as strict bounded base-10 integers", () => {
  for (const [name, limits] of Object.entries(NUMERIC_LIMITS)) {
    const propertyByName = {
      SESSION_TTL_SECONDS: "sessionTtlSeconds",
      VERIFIED_SESSION_TTL_SECONDS: "verifiedSessionTtlSeconds",
      MAX_VERIFICATION_ATTEMPTS: "maxVerificationAttempts",
      FORM2_PROOF_TTL_SECONDS: "form2ProofTtlSeconds",
      FORM2_PROOF_MAX_ATTEMPTS: "form2ProofMaxAttempts",
      FORM2_PROOF_MAX_SENDS: "form2ProofMaxSends",
      FORM2_PROOF_RESEND_COOLDOWN_SECONDS: "form2ProofResendCooldownSeconds",
      FORM2_PROOF_SEND_LEASE_SECONDS: "form2ProofSendLeaseSeconds",
      FORM2_MAIL_TIMEOUT_MS: "form2MailTimeoutMs",
      MAX_SUBMISSION_ATTEMPTS: "maxSubmissionAttempts",
      MAX_BODY_BYTES: "maxBodyBytes",
      INBOUND_BODY_TIMEOUT_MS: "inboundBodyTimeoutMs",
      OUTBOUND_TIMEOUT_MS: "outboundTimeoutMs",
      OUTBOUND_MAX_BYTES: "outboundMaxBytes",
      PLATFORM_OPERATION_TIMEOUT_MS: "platformOperationTimeoutMs",
    };
    assert.equal(
      load(baseEnvironment({ [name]: String(limits.minimum) }))[propertyByName[name]],
      limits.minimum,
    );
    for (const value of ["0", "01", "1.5", "-1", "NaN", String(limits.maximum + 1)]) {
      assert.throws(
        () => load(baseEnvironment({ [name]: value })),
        ConfigurationError,
      );
    }
  }
  assert.throws(
    () => load(baseEnvironment({ MAX_VERIFICATION_ATTEMPTS: "1" })),
    ConfigurationError,
  );
  for (const value of ["1799", "1801"]) {
    assert.throws(
      () => load(baseEnvironment({ VERIFIED_SESSION_TTL_SECONDS: value })),
      ConfigurationError,
    );
  }
});

test("rejects malformed aliases, versions, revisions, and Connection link names", () => {
  for (const overrides of [
    { FORM2_TOKEN_FIELD_ALIAS: "access-token" },
    { FORM2_FORM_VERSION: "version with spaces" },
    { SOURCE_REVISION: "short" },
    { SOURCE_REVISION: "A".repeat(40) },
    { SOURCE_REVISION: "a".repeat(39) },
    { SOURCE_REVISION: "a".repeat(41) },
    { CRM_READ_CONNECTION_LINK_NAME: "unsafe-link" },
    { CRM_WRITE_CONNECTION_LINK_NAME: "SyntheticCrmRead" },
    { FORM2_ENTRY_OFFER_VALUE: "Unsafe\nValue" },
    { FORM2_PHONE_SYSTEM_PROVIDERS: "not-json" },
    { FORM2_PHONE_SYSTEM_PROVIDERS: "[]" },
    { FORM2_PHONE_SYSTEM_PROVIDERS: '["Duplicate","Duplicate"]' },
    { FORM2_PHONE_SYSTEM_PROVIDERS: JSON.stringify(["P".repeat(121)]) },
    { FORM2_FIELD_TEAM_SIZE_BANDS: "not-json" },
    { FORM2_FIELD_TEAM_SIZE_BANDS: "[]" },
    { FORM2_FIELD_TEAM_SIZE_BANDS: '["Duplicate","Duplicate"]' },
    { FORM2_ACCESS_STATUS_INITIAL_VALUE: "Synthetic Issued" },
    { FORM2_ACCESS_STATUS_EXPIRED_VALUE: "Synthetic Submitted" },
  ]) {
    assert.throws(() => load(baseEnvironment(overrides)), ConfigurationError);
  }
});

test("binds the runtime source revision to the stamped deployed artifact", () => {
  const environment = baseEnvironment();
  assert.throws(() => loadConfig(environment), ConfigurationError);
  assert.throws(
    () => loadConfig(environment, "b".repeat(40)),
    ConfigurationError,
  );
  assert.equal(
    loadConfig(
      environment,
      environment.SOURCE_REVISION,
      FORM2_DESTINATION_SHA256,
    ).sourceRevision,
    "a".repeat(40),
  );
});
