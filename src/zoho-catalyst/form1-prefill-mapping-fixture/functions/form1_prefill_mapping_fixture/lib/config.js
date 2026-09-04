"use strict";

const MAX_ACTIVE_WINDOW_MS = 4 * 60 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;

class FixtureConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FixtureConfigurationError";
    this.status = 503;
    this.publicCode = "configuration_invalid";
  }
}

function required(environment, name) {
  const value = environment?.[name];
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new FixtureConfigurationError(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function exactPath(value) {
  if (!/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/.test(value) ||
      value.includes("//") || value.endsWith("/")) {
    throw new FixtureConfigurationError("FIXTURE_PATH must be one exact non-root path");
  }
  return value;
}

function headerName(value) {
  if (!/^x-[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value)) {
    throw new FixtureConfigurationError("FIXTURE_HEADER_NAME is invalid");
  }
  return value;
}

function secret(value) {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 32 || bytes > 256 || !/^[\x21-\x7e]+$/.test(value)) {
    throw new FixtureConfigurationError("FIXTURE_HEADER_SECRET is invalid");
  }
  return value;
}

function expiration(value, nowMs) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new FixtureConfigurationError("FIXTURE_EXPIRES_AT must be a canonical UTC timestamp");
  }
  const expiresAtMs = Date.parse(value);
  if (!Number.isSafeInteger(expiresAtMs) || new Date(expiresAtMs).toISOString() !== value) {
    throw new FixtureConfigurationError("FIXTURE_EXPIRES_AT is invalid");
  }
  if (expiresAtMs - nowMs > MAX_ACTIVE_WINDOW_MS) {
    throw new FixtureConfigurationError("FIXTURE_EXPIRES_AT exceeds the four-hour safety window");
  }
  return expiresAtMs;
}

function loadConfig(environment = process.env, artifactRevision, nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new FixtureConfigurationError("Fixture clock is invalid");
  }
  const mode = environment?.FORM1_PREFILL_MAPPING_FIXTURE_MODE ?? "disabled";
  if (mode === "disabled") return Object.freeze({ active: false });
  if (mode !== "active") {
    throw new FixtureConfigurationError("FORM1_PREFILL_MAPPING_FIXTURE_MODE is invalid");
  }
  if (required(environment, "DEPLOYMENT_ENVIRONMENT") !== "development") {
    throw new FixtureConfigurationError("The mapping fixture is Development-only");
  }
  const sourceRevision = required(environment, "SOURCE_REVISION");
  if (!REVISION_PATTERN.test(sourceRevision) || sourceRevision !== artifactRevision) {
    throw new FixtureConfigurationError("SOURCE_REVISION does not match the immutable artifact");
  }
  const expectedProjectHash = required(environment, "EXPECTED_CATALYST_PROJECT_ID_SHA256");
  if (!SHA256_PATTERN.test(expectedProjectHash)) {
    throw new FixtureConfigurationError("EXPECTED_CATALYST_PROJECT_ID_SHA256 is invalid");
  }
  const expiresAt = required(environment, "FIXTURE_EXPIRES_AT");
  return Object.freeze({
    active: true,
    deploymentEnvironment: "development",
    expectedProjectHash,
    expiresAt,
    expiresAtMs: expiration(expiresAt, nowMs),
    fixtureHeaderName: headerName(required(environment, "FIXTURE_HEADER_NAME")),
    fixtureHeaderSecret: secret(required(environment, "FIXTURE_HEADER_SECRET")),
    fixturePath: exactPath(required(environment, "FIXTURE_PATH")),
    sourceRevision
  });
}

module.exports = {
  FixtureConfigurationError,
  MAX_ACTIVE_WINDOW_MS,
  loadConfig
};
