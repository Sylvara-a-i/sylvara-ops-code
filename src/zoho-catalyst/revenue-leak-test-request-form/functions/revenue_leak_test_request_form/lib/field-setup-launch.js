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
  isFormNavigationAction,
  normalizeAuthenticatedOperator,
  normalizeFormNavigationDestinations,
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
    "issueOrResumeLaunch",
    "readByLaunchDigest",
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
  return Object.freeze({
    ...config,
    formNavigationDestinations: normalizeFormNavigationDestinations(
      config.formNavigationDestinations,
    ),
    webClientOrigin: origin.origin,
  });
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

function resumeBindingDigest({ environment, moduleApiName, recordId }, pepper) {
  if (
    environment !== "development" ||
    !new Set(["Leads", "Deals"]).has(moduleApiName) ||
    typeof recordId !== "string" ||
    !/^[0-9]{1,30}$/.test(recordId)
  ) {
    throw new FieldSetupContractError("Resume binding is invalid", "configuration_invalid");
  }
  return crypto
    .createHmac("sha256", pepper)
    .update(
      `sylvara.field-setup.resume-binding.v1\0${environment}\0${moduleApiName}\0${recordId}`,
      "utf8",
    )
    .digest("hex");
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
  if (context.moduleApiName !== "Leads") {
    throw new FieldSetupContractError(
      "A new field-setup journey must begin from a Lead",
      "field_setup_not_found",
    );
  }
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
    leadResumeBindingDigest: resumeBindingDigest(context, config.digestPepper),
    dealResumeBindingDigest: null,
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
        navigationIntent: null,
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
    const validated = validateServerPrerequisiteReceipt(
      receipt,
      binding,
      prerequisite,
      config.formNavigationDestinations,
    );
    for (const [field, fingerprint] of Object.entries(validated.fingerprintPatch)) {
      if (journey[field] !== null && journey[field] !== fingerprint) {
        throw new FieldSetupContractError(
          "Server prerequisite conflicts with immutable journey evidence",
        );
      }
    }
    return validated;
  }

  function staleReplay() {
    throw new FieldSetupContractError("Session revision is stale", "stale_revision");
  }

  function resolveReplayTransition(journey, actionId) {
    const localSources = FIELD_SETUP_PROTOCOL.states.flatMap((state) => (
      [state.primaryAction, ...state.secondaryActions]
        .filter((action) => action.id === actionId && action.nextState === journey.state)
        .map((action) => Object.freeze({ priorState: state.id, transition: action }))
    ));
    const globalSources = FIELD_SETUP_PROTOCOL.globalActions
      .filter((action) => action.id === actionId && action.nextState === journey.state)
      .map((action) => Object.freeze({
        // A global action is state-independent. The action-bound outcome and exact
        // one-revision advance prove its transition; current state is sufficient to
        // validate its durable non-navigation prerequisite evidence without inventing history.
        priorState: journey.state,
        transition: action,
      }));
    const sources = [...localSources, ...globalSources];
    if (sources.length !== 1) staleReplay();
    return sources[0];
  }

  async function replayCommittedTransition(journey, input, operator) {
    if (journey.revision !== input.expectedRevision + 1) staleReplay();

    const { priorState, transition } = resolveReplayTransition(journey, input.actionId);
    if (transition.nextState !== journey.state) staleReplay();

    const replayJourney = Object.freeze({
      ...journey,
      revision: input.expectedRevision,
      state: priorState,
    });
    let qualificationStatus = journey.qualificationStatus;
    if (transition.qualificationDecision) {
      const qualification = normalizeQualificationForAction(input.actionId, input.qualification);
      const authorized = authorizeQualification(replayJourney, qualification, operator);
      if (
        authorized.nextState !== transition.nextState ||
        authorized.storedStatus !== journey.qualificationStatus
      ) {
        staleReplay();
      }
      qualificationStatus = authorized.storedStatus;
    } else if (input.qualification !== null) {
      throw new FieldSetupContractError("Qualification payload is not permitted for this transition");
    }

    const prerequisite = getServerPrerequisite(priorState, input.actionId);
    const expectedLastOutcome = prerequisite === null
      ? `transition:${input.actionId}`
      : `server_outcome:${prerequisite.receiptType}:${input.actionId}`;
    if (journey.lastOutcome !== expectedLastOutcome) staleReplay();

    const statusPatch = prerequisite?.statusPatch ?? Object.freeze({});
    const requiredFingerprintFields = prerequisite?.requiredFingerprintFields ?? Object.freeze([]);
    if (
      Object.hasOwn(statusPatch, "qualificationStatus") &&
      statusPatch.qualificationStatus !== qualificationStatus
    ) {
      staleReplay();
    }
    for (const [field, expectedValue] of Object.entries(statusPatch)) {
      if (journey[field] !== expectedValue) staleReplay();
    }
    for (const field of requiredFingerprintFields) {
      // validateStoredJourney has already enforced the exact SHA-256 representation;
      // replay additionally proves that every fingerprint required by this action is present.
      if (journey[field] === null) staleReplay();
    }

    let navigationIntent = null;
    if (isFormNavigationAction(input.actionId)) {
      // Navigation capability is intentionally not persisted in the journey row. Re-read
      // the authoritative receipt to reconstruct it, then bind its persisted evidence back
      // to the committed row. Other guarded actions replay from the durable row so an
      // external read that rotated after commit cannot invalidate an already-saved decision.
      const serverPrerequisite = await resolveServerPrerequisite(replayJourney, input.actionId);
      if (serverPrerequisite.navigationIntent === null) staleReplay();
      for (const [field, expectedValue] of Object.entries({
        ...serverPrerequisite.statusPatch,
        ...serverPrerequisite.fingerprintPatch,
      })) {
        if (journey[field] !== expectedValue) staleReplay();
      }
      navigationIntent = serverPrerequisite.navigationIntent;
    }
    return Object.freeze({
      authoritative: true,
      conversionAuthorized: false,
      navigationIntent,
      qualificationStatus,
      revision: journey.revision,
      state: journey.state,
    });
  }

  async function issueLaunch(input) {
    const context = normalizeTrustedLaunchContext(input);
    const issuedAtMs = milliseconds(now);
    const nonce = makeToken(randomBytes);
    const launchDigest = digestToken(nonce, config.digestPepper);
    const bindingDigest = resumeBindingDigest(context, config.digestPepper);
    const issuedAt = new Date(issuedAtMs).toISOString();
    const launchExpiresAt = new Date(issuedAtMs + config.launchTtlSeconds * 1000).toISOString();
    const absoluteExpiresAt = new Date(
      issuedAtMs + config.sessionAbsoluteTtlSeconds * 1000,
    ).toISOString();
    const createRow = context.moduleApiName === "Leads"
      ? schemaCompleteLaunchRow(
        context,
        launchDigest,
        makeJourneyKey(randomUUID),
        issuedAtMs,
        config,
      )
      : null;
    const result = await store.issueOrResumeLaunch({
      absoluteExpiresAt,
      bindingDigest,
      createRow,
      environment: context.environment,
      issuedAt,
      launchDigest,
      launchExpiresAt,
      moduleApiName: context.moduleApiName,
      operatorUserId: context.operatorUserId,
      updatedAt: issuedAt,
    });
    requireExactInput(result, ["after", "before", "created"], "Launch issuance result");
    const stored = validateStoredJourney(result.after);
    if (result.created === true) {
      if (result.before !== null || createRow === null) {
        throw new FieldSetupContractError("Launch creation readback was inconsistent", "service_unavailable");
      }
      assertExactRowReadback(createRow, stored, "Launch creation readback was inconsistent");
    } else if (result.created === false) {
      const before = validateStoredJourney(result.before);
      const requestedBinding = context.moduleApiName === "Leads"
        ? before.leadResumeBindingDigest
        : before.dealResumeBindingDigest;
      if (
        requestedBinding !== bindingDigest ||
        before.environment !== context.environment ||
        before.operatorUserId !== context.operatorUserId ||
        stored.revision !== before.revision + 1
      ) {
        throw new FieldSetupContractError("Launch resume binding was inconsistent", "service_unavailable");
      }
      const expected = validateStoredJourney({
        ...before,
        absoluteExpiresAt,
        idleExpiresAt: null,
        issuedAt,
        launchConsumedAt: null,
        launchDigest,
        launchExpiresAt,
        lastOutcome: "launch_reissued",
        revision: before.revision + 1,
        sessionDigest: null,
        updatedAt: issuedAt,
      });
      assertExactRowReadback(expected, stored, "Launch resume readback was inconsistent");
    } else {
      throw new FieldSetupContractError("Launch issuance result was inconsistent", "service_unavailable");
    }
    return Object.freeze({
      ok: true,
      launchUrl: launchUrl(config.webClientOrigin, nonce),
      expiresAt: stored.launchExpiresAt,
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
    const pending = validateStoredJourney(await store.readByLaunchDigest(launchDigest));
    const absoluteExpiresAtMs = canonicalTimestampMilliseconds(pending.absoluteExpiresAt);
    if (
      pending.launchDigest !== launchDigest ||
      pending.operatorUserId !== operator.operatorUserId ||
      pending.environment !== operator.environment ||
      pending.sessionDigest !== null ||
      pending.launchConsumedAt !== null ||
      absoluteExpiresAtMs === null ||
      absoluteExpiresAtMs <= exchangedAtMs ||
      canonicalTimestampMilliseconds(pending.launchExpiresAt) <= exchangedAtMs
    ) {
      throw new FieldSetupContractError("Field-setup token was not found", "field_setup_not_found");
    }
    const idleExpiresAt = new Date(Math.min(
      exchangedAtMs + config.sessionIdleTtlSeconds * 1000,
      absoluteExpiresAtMs,
    )).toISOString();
    const remainingAbsoluteLifetimeSeconds = Math.floor(
      (absoluteExpiresAtMs - exchangedAtMs) / 1000,
    );
    const exchange = FIELD_SETUP_PROTOCOL.persistence.launchExchange;
    const nextState = pending.state === exchange.expectedState
      ? exchange.nextState
      : pending.state;
    const nextRevision = pending.revision + 1;
    const consumed = validateStoredJourney(await store.consumeLaunch({
      environment: operator.environment,
      expectedLaunchConsumedAt: null,
      expectedRevision: pending.revision,
      expectedSessionDigest: null,
      expectedState: pending.state,
      idleExpiresAt,
      launchConsumedAt: exchangedAt,
      launchDigest,
      lastOutcome: "launch_exchanged",
      nextRevision,
      nextState,
      operatorUserId: operator.operatorUserId,
      sessionDigest,
      updatedAt: exchangedAt,
    }));
    if (
      consumed.launchDigest !== launchDigest ||
      consumed.sessionDigest !== sessionDigest ||
      consumed.operatorUserId !== operator.operatorUserId ||
      consumed.environment !== operator.environment ||
      consumed.state !== nextState ||
      consumed.revision !== nextRevision ||
      consumed.launchConsumedAt !== exchangedAt ||
      consumed.idleExpiresAt !== idleExpiresAt ||
      consumed.updatedAt !== exchangedAt ||
      consumed.lastOutcome !== "launch_exchanged"
    ) {
      throw new FieldSetupContractError("Launch exchange readback was inconsistent", "service_unavailable");
    }
    const expectedConsumed = validateStoredJourney({
      ...pending,
      idleExpiresAt,
      launchConsumedAt: exchangedAt,
      lastOutcome: "launch_exchanged",
      revision: nextRevision,
      sessionDigest,
      state: nextState,
      updatedAt: exchangedAt,
    });
    assertExactRowReadback(expectedConsumed, consumed, "Launch exchange readback was inconsistent");
    return Object.freeze({
      ok: true,
      setCookie: sessionCookie(sessionToken, remainingAbsoluteLifetimeSeconds),
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
      return replayCommittedTransition(journey, input, operator);
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
      : `server_outcome:${serverPrerequisite.receiptType}:${input.actionId}`;
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
      navigationIntent: serverPrerequisite.navigationIntent,
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
  resumeBindingDigest,
  schemaCompleteLaunchRow,
  sessionCookie,
};
