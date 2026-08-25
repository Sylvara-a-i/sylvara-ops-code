"use strict";

const crypto = require("node:crypto");
const {
  FIELD_SETUP_PROTOCOL,
  FIELD_SETUP_STATES,
  FieldSetupContractError,
  assertBrowserAction,
  assertOperatorBound,
  authorizeQualification,
  getServerPrerequisite,
  normalizeAuthenticatedOperator,
  normalizeQualificationForAction,
  normalizeTrustedLaunchContext,
  resolveTransition,
  validateServerPrerequisiteReceipt,
  validateStoredJourney,
} = require("./field-setup-contract");

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const JOURNEY_TABLE = "RevenueLeakTestFieldSetupJourneys";

function requireStore(store) {
  for (const method of [
    "issueLaunch",
    "consumeLaunch",
    "readBySessionDigest",
    "compareAndSetJourney",
  ]) {
    if (typeof store?.[method] !== "function") {
      throw new FieldSetupContractError(`Field-setup store is missing ${method}`, "configuration_invalid");
    }
  }
  return store;
}

function normalizeServerPrerequisiteResolver(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "function") {
    throw new FieldSetupContractError(
      "Server prerequisite resolver is invalid",
      "configuration_invalid",
    );
  }
  return value;
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

function requireExactInput(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FieldSetupContractError(`${label} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new FieldSetupContractError(`${label} is invalid`);
  }
  return value;
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

function schemaCompleteLaunchRow(context, launchDigest, journeyKey, issuedAtMs, config) {
  const issuedAt = new Date(issuedAtMs).toISOString();
  const row = Object.fromEntries(
    FIELD_SETUP_PROTOCOL.persistence.rowFields.map((field) => [field, null]),
  );
  Object.assign(row, FIELD_SETUP_PROTOCOL.persistence.initialValues, {
    absoluteExpiresAt: new Date(
      issuedAtMs + config.sessionAbsoluteTtlSeconds * 1000,
    ).toISOString(),
    environment: context.environment,
    issuedAt,
    journeyKey,
    launchDigest,
    launchExpiresAt: new Date(issuedAtMs + config.launchTtlSeconds * 1000).toISOString(),
    moduleApiName: context.moduleApiName,
    operatorUserId: context.operatorUserId,
    recordId: context.recordId,
    updatedAt: issuedAt,
  });
  return Object.freeze(validateStoredJourney(row));
}

function assertExactRowReadback(expected, actual, message) {
  for (const field of FIELD_SETUP_PROTOCOL.persistence.rowFields) {
    if (actual[field] !== expected[field]) {
      throw new FieldSetupContractError(message, "service_unavailable");
    }
  }
}

function createFieldSetupLaunchService({
  config: inputConfig,
  store: inputStore,
  now = Date.now,
  randomBytes = crypto.randomBytes,
  randomUUID = crypto.randomUUID,
  serverPrerequisiteResolver: inputServerPrerequisiteResolver,
} = {}) {
  const config = normalizeConfig(inputConfig);
  const store = requireStore(inputStore);
  const serverPrerequisiteResolver = normalizeServerPrerequisiteResolver(
    inputServerPrerequisiteResolver,
  );

  async function resolveServerPrerequisite(journey, actionId) {
    const prerequisite = getServerPrerequisite(journey.state, actionId);
    if (prerequisite === null) {
      return Object.freeze({
        fingerprintPatch: Object.freeze({}),
        receiptType: null,
        statusPatch: Object.freeze({}),
      });
    }
    if (serverPrerequisiteResolver === null) {
      throw new FieldSetupContractError(
        "A server-authoritative prerequisite is required for this transition",
        "server_outcome_required",
      );
    }
    const binding = Object.freeze({
      actionId,
      environment: journey.environment,
      journeyKey: journey.journeyKey,
      moduleApiName: journey.moduleApiName,
      operatorUserId: journey.operatorUserId,
      recordId: journey.recordId,
      revision: journey.revision,
      sessionDigest: journey.sessionDigest,
      state: journey.state,
    });
    let receipt;
    try {
      // This injected boundary may read already-authoritative server evidence only. It is not a
      // conversion, reservation, verification, activation, or rollback execution hook.
      receipt = await serverPrerequisiteResolver(Object.freeze({
        binding,
        prerequisite,
      }));
    } catch {
      throw new FieldSetupContractError(
        "Server-authoritative prerequisite evidence is unavailable",
        "server_outcome_required",
      );
    }
    const validated = validateServerPrerequisiteReceipt(receipt, binding, prerequisite);
    for (const [field, fingerprint] of Object.entries(validated.fingerprintPatch)) {
      if (journey[field] !== null && journey[field] !== fingerprint) {
        throw new FieldSetupContractError(
          "Server prerequisite conflicts with immutable journey evidence",
        );
      }
    }
    return validated;
  }

  async function issueLaunch(input) {
    const context = normalizeTrustedLaunchContext(input);
    const issuedAtMs = milliseconds(now);
    const nonce = makeToken(randomBytes);
    const row = schemaCompleteLaunchRow(
      context,
      digestToken(nonce, config.digestPepper),
      makeJourneyKey(randomUUID),
      issuedAtMs,
      config,
    );
    const stored = validateStoredJourney(await store.issueLaunch(row));
    assertExactRowReadback(row, stored, "Launch issuance readback was inconsistent");
    return Object.freeze({
      ok: true,
      launchUrl: launchUrl(config.webClientOrigin, nonce),
      expiresAt: row.launchExpiresAt,
    });
  }

  async function exchangeLaunch(input, operatorInput) {
    requireExactInput(input, ["nonce"], "Launch exchange");
    const operator = normalizeAuthenticatedOperator(operatorInput);
    const exchangedAtMs = milliseconds(now);
    const exchangedAt = new Date(exchangedAtMs).toISOString();
    const sessionToken = makeToken(randomBytes);
    const launchDigest = digestToken(input.nonce, config.digestPepper);
    const sessionDigest = digestToken(sessionToken, config.digestPepper);
    const idleExpiresAt = new Date(
      exchangedAtMs + config.sessionIdleTtlSeconds * 1000,
    ).toISOString();
    const exchange = FIELD_SETUP_PROTOCOL.persistence.launchExchange;
    const consumed = validateStoredJourney(await store.consumeLaunch({
      environment: operator.environment,
      expectedLaunchConsumedAt: null,
      expectedRevision: exchange.expectedRevision,
      expectedSessionDigest: null,
      expectedState: exchange.expectedState,
      idleExpiresAt,
      launchConsumedAt: exchangedAt,
      launchDigest,
      lastOutcome: "launch_exchanged",
      nextRevision: exchange.nextRevision,
      nextState: exchange.nextState,
      operatorUserId: operator.operatorUserId,
      sessionDigest,
      updatedAt: exchangedAt,
    }));
    if (
      consumed.launchDigest !== launchDigest ||
      consumed.sessionDigest !== sessionDigest ||
      consumed.operatorUserId !== operator.operatorUserId ||
      consumed.environment !== operator.environment ||
      consumed.state !== exchange.nextState ||
      consumed.revision !== exchange.nextRevision ||
      consumed.launchConsumedAt !== exchangedAt ||
      consumed.idleExpiresAt !== idleExpiresAt ||
      consumed.updatedAt !== exchangedAt ||
      consumed.lastOutcome !== "launch_exchanged"
    ) {
      throw new FieldSetupContractError("Launch exchange readback was inconsistent", "service_unavailable");
    }
    for (const [field, initial] of Object.entries(FIELD_SETUP_PROTOCOL.persistence.initialValues)) {
      if (!["state", "revision", "lastOutcome"].includes(field) && consumed[field] !== initial) {
        throw new FieldSetupContractError("Launch exchange readback was inconsistent", "service_unavailable");
      }
    }
    return Object.freeze({
      ok: true,
      setCookie: sessionCookie(sessionToken, config.sessionAbsoluteTtlSeconds),
      publicJourney: Object.freeze({
        state: consumed.state,
        revision: consumed.revision,
        progress: FIELD_SETUP_STATES.indexOf(consumed.state) + 1,
        totalSteps: FIELD_SETUP_STATES.length,
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

  async function transitionSession(input, operatorInput) {
    requireExactInput(
      input,
      ["actionId", "expectedRevision", "qualification", "sessionToken"],
      "Session transition",
    );
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 2) {
      throw new FieldSetupContractError("Session revision is invalid", "stale_revision");
    }
    assertBrowserAction(input.actionId);
    const operator = normalizeAuthenticatedOperator(operatorInput);
    const journey = await authenticateSession(input.sessionToken, operator);
    assertOperatorBound(journey, operator);
    if (journey.revision !== input.expectedRevision) {
      throw new FieldSetupContractError("Session revision is stale", "stale_revision");
    }
    const transition = resolveTransition(journey.state, input.actionId);
    let qualificationStatus = journey.qualificationStatus;
    if (transition.qualificationDecision) {
      const qualification = normalizeQualificationForAction(input.actionId, input.qualification);
      const authorized = authorizeQualification(journey, qualification, operator);
      if (authorized.nextState !== transition.nextState) {
        throw new FieldSetupContractError("Qualification transition is inconsistent");
      }
      qualificationStatus = authorized.storedStatus;
    } else if (input.qualification !== null) {
      throw new FieldSetupContractError("Qualification payload is not permitted for this transition");
    }
    const serverPrerequisite = await resolveServerPrerequisite(journey, input.actionId);
    if (
      Object.hasOwn(serverPrerequisite.statusPatch, "qualificationStatus") &&
      serverPrerequisite.statusPatch.qualificationStatus !== qualificationStatus
    ) {
      throw new FieldSetupContractError("Qualification receipt conflicts with the operator decision");
    }

    const updatedAtMs = milliseconds(now);
    const updatedAt = new Date(updatedAtMs).toISOString();
    const absoluteExpiresAtMs = canonicalTimestampMilliseconds(journey.absoluteExpiresAt);
    const idleExpiresAt = new Date(Math.min(
      updatedAtMs + config.sessionIdleTtlSeconds * 1000,
      absoluteExpiresAtMs,
    )).toISOString();
    const nextRevision = journey.revision + 1;
    const lastOutcome = serverPrerequisite.receiptType === null
      ? `transition:${input.actionId}`
      : `server_outcome:${serverPrerequisite.receiptType}`;
    const expected = validateStoredJourney({
      ...journey,
      ...serverPrerequisite.statusPatch,
      ...serverPrerequisite.fingerprintPatch,
      idleExpiresAt,
      lastOutcome,
      qualificationStatus,
      revision: nextRevision,
      state: transition.nextState,
      updatedAt,
    });
    const stored = validateStoredJourney(await store.compareAndSetJourney({
      actionId: input.actionId,
      environment: operator.environment,
      expectedRevision: journey.revision,
      expectedState: journey.state,
      fingerprintPatch: serverPrerequisite.fingerprintPatch,
      idleExpiresAt,
      lastOutcome: expected.lastOutcome,
      nextRevision,
      nextState: transition.nextState,
      operatorUserId: operator.operatorUserId,
      qualificationStatus,
      sessionDigest: journey.sessionDigest,
      statusPatch: serverPrerequisite.statusPatch,
      updatedAt,
    }));
    assertExactRowReadback(expected, stored, "Session transition readback was inconsistent");
    return Object.freeze({
      authoritative: true,
      conversionAuthorized: false,
      qualificationStatus: stored.qualificationStatus,
      revision: stored.revision,
      state: stored.state,
    });
  }

  return Object.freeze({
    authenticateSession,
    exchangeLaunch,
    issueLaunch,
    transitionSession,
  });
}

module.exports = {
  JOURNEY_TABLE,
  TOKEN_PATTERN,
  createFieldSetupLaunchService,
  digestToken,
  launchUrl,
  schemaCompleteLaunchRow,
  sessionCookie,
};
