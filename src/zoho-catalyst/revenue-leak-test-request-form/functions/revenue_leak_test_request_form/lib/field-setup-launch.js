"use strict";

const crypto = require("node:crypto");
const {
  FieldSetupContractError,
  normalizeAuthenticatedOperator,
  normalizeTrustedLaunchContext,
  validateStoredJourney,
} = require("./field-setup-contract");

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const JOURNEY_TABLE = "RevenueLeakTestFieldSetupJourneys";

function requireStore(store) {
  for (const method of ["issueLaunch", "consumeLaunch", "readBySessionDigest"]) {
    if (typeof store?.[method] !== "function") {
      throw new FieldSetupContractError(`Field-setup store is missing ${method}`, "configuration_invalid");
    }
  }
  return store;
}

function normalizeConfig(config) {
  if (
    !config ||
    config.environment !== "development" ||
    config.tableName !== JOURNEY_TABLE ||
    typeof config.digestPepper !== "string" ||
    Buffer.byteLength(config.digestPepper, "utf8") < 32 ||
    Buffer.byteLength(config.digestPepper, "utf8") > 256 ||
    !Number.isSafeInteger(config.launchTtlSeconds) ||
    config.launchTtlSeconds < 15 ||
    config.launchTtlSeconds > 60 ||
    !Number.isSafeInteger(config.sessionAbsoluteTtlSeconds) ||
    config.sessionAbsoluteTtlSeconds < 300 ||
    config.sessionAbsoluteTtlSeconds > 3600 ||
    !Number.isSafeInteger(config.sessionIdleTtlSeconds) ||
    config.sessionIdleTtlSeconds < 60 ||
    config.sessionIdleTtlSeconds > config.sessionAbsoluteTtlSeconds
  ) {
    throw new FieldSetupContractError("Field-setup launch configuration is invalid", "configuration_invalid");
  }
  let origin;
  try {
    origin = new URL(config.webClientOrigin);
  } catch {
    throw new FieldSetupContractError("Web-client origin is invalid", "configuration_invalid");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new FieldSetupContractError("Web-client origin is invalid", "configuration_invalid");
  }
  return Object.freeze({ ...config, webClientOrigin: origin.origin });
}

function milliseconds(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FieldSetupContractError("Field-setup clock is invalid", "configuration_invalid");
  }
  return value;
}

function canonicalTimestampMilliseconds(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return null;
  return parsed;
}

function makeToken(randomBytes) {
  const bytes = randomBytes(32);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
    throw new FieldSetupContractError("Field-setup entropy source is invalid", "configuration_invalid");
  }
  const token = bytes.toString("base64url");
  if (!TOKEN_PATTERN.test(token)) {
    throw new FieldSetupContractError("Field-setup token encoding failed", "configuration_invalid");
  }
  return token;
}

function digestToken(token, pepper) {
  if (!TOKEN_PATTERN.test(token ?? "")) {
    throw new FieldSetupContractError("Field-setup token was not found", "field_setup_not_found");
  }
  return crypto.createHmac("sha256", pepper).update(token, "utf8").digest("hex");
}

function makeJourneyKey(randomUUID) {
  const key = randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
    throw new FieldSetupContractError("Journey identity source is invalid", "configuration_invalid");
  }
  return key;
}

function launchUrl(origin, nonce) {
  const url = new URL("/field-setup/", origin);
  url.hash = `launch=${nonce}`;
  if (url.search || !url.href.endsWith(`#launch=${nonce}`)) {
    throw new FieldSetupContractError("Launch URL could not be bounded", "configuration_invalid");
  }
  return url.href;
}

function sessionCookie(token, maxAge) {
  if (!TOKEN_PATTERN.test(token) || !Number.isSafeInteger(maxAge) || maxAge < 60 || maxAge > 3600) {
    throw new FieldSetupContractError("Session cookie could not be issued", "configuration_invalid");
  }
  return `__Host-sylvara_field_setup=${token}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`;
}

function createFieldSetupLaunchService({
  config: inputConfig,
  store: inputStore,
  now = Date.now,
  randomBytes = crypto.randomBytes,
  randomUUID = crypto.randomUUID,
} = {}) {
  const config = normalizeConfig(inputConfig);
  const store = requireStore(inputStore);

  async function issueLaunch(input) {
    const context = normalizeTrustedLaunchContext(input);
    const issuedAtMs = milliseconds(now);
    const nonce = makeToken(randomBytes);
    const row = {
      journeyKey: makeJourneyKey(randomUUID),
      launchDigest: digestToken(nonce, config.digestPepper),
      sessionDigest: "",
      moduleApiName: context.moduleApiName,
      recordId: context.recordId,
      operatorUserId: context.operatorUserId,
      environment: context.environment,
      state: "loading_session_validation",
      issuedAt: new Date(issuedAtMs).toISOString(),
      launchExpiresAt: new Date(issuedAtMs + config.launchTtlSeconds * 1000).toISOString(),
      absoluteExpiresAt: new Date(issuedAtMs + config.sessionAbsoluteTtlSeconds * 1000).toISOString(),
      idleExpiresAt: "",
      launchConsumedAt: "",
      revision: 1,
      lastOutcome: "launch_issued",
    };
    const stored = validateStoredJourney(await store.issueLaunch(Object.freeze(row)));
    if (stored.launchDigest !== row.launchDigest || stored.journeyKey !== row.journeyKey) {
      throw new FieldSetupContractError("Launch issuance readback was inconsistent", "service_unavailable");
    }
    return Object.freeze({
      ok: true,
      launchUrl: launchUrl(config.webClientOrigin, nonce),
      expiresAt: row.launchExpiresAt,
    });
  }

  async function exchangeLaunch({ nonce }, operatorInput) {
    const operator = normalizeAuthenticatedOperator(operatorInput);
    const exchangedAtMs = milliseconds(now);
    const sessionToken = makeToken(randomBytes);
    const launchDigest = digestToken(nonce, config.digestPepper);
    const sessionDigest = digestToken(sessionToken, config.digestPepper);
    const idleExpiresAt = new Date(
      exchangedAtMs + config.sessionIdleTtlSeconds * 1000,
    ).toISOString();
    const consumed = validateStoredJourney(await store.consumeLaunch({
      environment: operator.environment,
      exchangedAt: new Date(exchangedAtMs).toISOString(),
      idleExpiresAt,
      launchDigest,
      operatorUserId: operator.operatorUserId,
      sessionDigest,
    }));
    if (
      consumed.launchDigest !== launchDigest ||
      consumed.sessionDigest !== sessionDigest ||
      consumed.operatorUserId !== operator.operatorUserId ||
      consumed.environment !== operator.environment
    ) {
      throw new FieldSetupContractError("Launch exchange readback was inconsistent", "service_unavailable");
    }
    return Object.freeze({
      ok: true,
      setCookie: sessionCookie(sessionToken, config.sessionAbsoluteTtlSeconds),
      publicJourney: Object.freeze({
        state: consumed.state,
        progress: 1,
        totalSteps: 22,
      }),
    });
  }

  async function authenticateSession(sessionToken, operatorInput) {
    const operator = normalizeAuthenticatedOperator(operatorInput);
    const nowMs = milliseconds(now);
    const digest = digestToken(sessionToken, config.digestPepper);
    const journey = validateStoredJourney(await store.readBySessionDigest(digest));
    const absoluteExpiresAtMs = canonicalTimestampMilliseconds(journey.absoluteExpiresAt);
    const idleExpiresAtMs = canonicalTimestampMilliseconds(journey.idleExpiresAt);
    if (
      journey.sessionDigest !== digest ||
      journey.operatorUserId !== operator.operatorUserId ||
      journey.environment !== operator.environment ||
      absoluteExpiresAtMs === null ||
      idleExpiresAtMs === null ||
      idleExpiresAtMs > absoluteExpiresAtMs ||
      absoluteExpiresAtMs <= nowMs ||
      idleExpiresAtMs <= nowMs
    ) {
      throw new FieldSetupContractError("Field-setup session was not found", "field_setup_not_found");
    }
    return journey;
  }

  return Object.freeze({ authenticateSession, exchangeLaunch, issueLaunch });
}

module.exports = {
  JOURNEY_TABLE,
  TOKEN_PATTERN,
  createFieldSetupLaunchService,
  digestToken,
  launchUrl,
  sessionCookie,
};
