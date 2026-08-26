"use strict";

const crypto = require("node:crypto");
const {
  COORDINATED_BROWSER_ACTIONS,
  FIELD_SETUP_PROTOCOL,
  FIELD_SETUP_STATES,
  FieldSetupContractError,
  assertBrowserAction,
  normalizeAuthenticatedOperator,
  resolveTransition,
} = require("./field-setup-contract");
const {
  HttpBoundaryError,
  getHeader,
  parseJsonObject,
  parseRequestPath,
  readRawBody,
  validateJsonPost,
} = require("./http");

const SESSION_COOKIE_NAME = "__Host-sylvara_field_setup";
const SESSION_COOKIE_PATTERN = new RegExp(
  `^${SESSION_COOKIE_NAME}=([A-Za-z0-9_-]{43}); Path=/; Max-Age=([1-9][0-9]{1,3}); Secure; HttpOnly; SameSite=Strict$`,
);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PATH_PATTERN = /^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/;
const HEADER_PATTERN = /^x-[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const PROTOCOL_ID_HEADER = "x-sylvara-field-setup-protocol-id";
const PROTOCOL_VERSION_HEADER = "x-sylvara-field-setup-protocol-version";
const ROUTE_KEYS = Object.freeze([
  "launchPath",
  "exchangePath",
  "statusPath",
  "decisionPath",
  "conversionPreviewPath",
  "conversionConfirmPath",
]);
const CONFIG_KEYS = Object.freeze([
  "bodyTimeoutMs",
  "csrfHeaderName",
  "csrfPepper",
  "deploymentAuthorized",
  "environment",
  "maxBodyBytes",
  "routes",
  "runtimeAuthority",
  "status",
  "webClientOrigin",
]);

class FieldSetupDispatchError extends Error {
  constructor(message, { status = 503, publicCode = "service_unavailable" } = {}) {
    super(message);
    this.name = "FieldSetupDispatchError";
    this.status = status;
    this.publicCode = publicCode;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value,
  expected,
  label,
  { status = 422, publicCode = "request_invalid" } = {},
) {
  if (!isPlainObject(value)) {
    throw new FieldSetupDispatchError(`${label} must be a plain object`, {
      status,
      publicCode,
    });
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => (
      typeof key !== "string" ||
      ["__proto__", "constructor", "prototype"].includes(key) ||
      !expected.includes(key)
    )) ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new FieldSetupDispatchError(`${label} does not match the approved contract`, {
      status,
      publicCode,
    });
  }
  return value;
}

function normalizeConfig(value) {
  exactKeys(value, CONFIG_KEYS, "Field-setup dispatcher configuration", {
    status: 503,
    publicCode: "configuration_invalid",
  });
  if (
    value.status !== "NOT_READY" ||
    value.runtimeAuthority !== false ||
    value.deploymentAuthorized !== false ||
    value.environment !== "development" ||
    !Number.isSafeInteger(value.maxBodyBytes) ||
    value.maxBodyBytes < 512 ||
    value.maxBodyBytes > 32768 ||
    !Number.isSafeInteger(value.bodyTimeoutMs) ||
    value.bodyTimeoutMs < 250 ||
    value.bodyTimeoutMs > 15000 ||
    typeof value.csrfHeaderName !== "string" ||
    !HEADER_PATTERN.test(value.csrfHeaderName) ||
    typeof value.csrfPepper !== "string" ||
    Buffer.byteLength(value.csrfPepper, "utf8") < 32 ||
    Buffer.byteLength(value.csrfPepper, "utf8") > 256 ||
    !/^[\x21-\x7e]+$/.test(value.csrfPepper)
  ) {
    throw new FieldSetupDispatchError("Field-setup dispatcher configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }

  exactKeys(value.routes, ROUTE_KEYS, "Field-setup route configuration", {
    status: 503,
    publicCode: "configuration_invalid",
  });
  const routeValues = ROUTE_KEYS.map((key) => value.routes[key]);
  if (
    routeValues.some((path) => (
      typeof path !== "string" ||
      !PATH_PATTERN.test(path) ||
      path.includes("//") ||
      path.endsWith("/")
    )) ||
    new Set(routeValues).size !== routeValues.length
  ) {
    throw new FieldSetupDispatchError("Field-setup route configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }

  let webClientOrigin;
  try {
    webClientOrigin = new URL(value.webClientOrigin);
  } catch {
    throw new FieldSetupDispatchError("Field-setup web origin is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  if (
    webClientOrigin.protocol !== "https:" ||
    webClientOrigin.username ||
    webClientOrigin.password ||
    webClientOrigin.port ||
    webClientOrigin.pathname !== "/" ||
    webClientOrigin.search ||
    webClientOrigin.hash
  ) {
    throw new FieldSetupDispatchError("Field-setup web origin is invalid", {
      publicCode: "configuration_invalid",
    });
  }

  return Object.freeze({
    ...value,
    routes: Object.freeze({ ...value.routes }),
    webClientOrigin: webClientOrigin.origin,
  });
}

function candidatePath(request) {
  try {
    return new URL(
      String(request?.url ?? request?.originalUrl ?? ""),
      "https://field-setup-dispatch.invalid",
    ).pathname;
  } catch {
    return null;
  }
}

function assertSameOrigin(request, expectedOrigin, { allowMissingOrigin = false } = {}) {
  const origin = getHeader(request, "origin");
  const fetchSite = getHeader(request, "sec-fetch-site");
  if (
    fetchSite !== "same-origin" ||
    (origin !== expectedOrigin && !(allowMissingOrigin && origin === undefined))
  ) {
    throw new FieldSetupDispatchError("Field-setup browser origin is not authorized", {
      status: 403,
      publicCode: "authentication_failed",
    });
  }
}

function csrfToken(sessionToken, pepper) {
  return crypto
    .createHmac("sha256", pepper)
    .update(`sylvara.field-setup.csrf.v1\0${sessionToken}`, "utf8")
    .digest("base64url");
}

function assertProtocolHeaders(request) {
  if (
    getHeader(request, PROTOCOL_ID_HEADER) !== FIELD_SETUP_PROTOCOL.protocolId ||
    getHeader(request, PROTOCOL_VERSION_HEADER) !== String(FIELD_SETUP_PROTOCOL.schemaVersion)
  ) {
    throw new FieldSetupDispatchError("Field-setup protocol is incompatible", {
      status: 409,
      publicCode: "context_conflict",
    });
  }
}

function protocolResponse(body) {
  return Object.freeze({
    ...body,
    protocolId: FIELD_SETUP_PROTOCOL.protocolId,
    schemaVersion: FIELD_SETUP_PROTOCOL.schemaVersion,
  });
}

function readSessionCookie(request) {
  const rawCookie = getHeader(request, "cookie");
  if (
    typeof rawCookie !== "string" ||
    rawCookie.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(rawCookie)
  ) {
    throw new FieldSetupDispatchError("Field-setup session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  const matches = rawCookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (matches.length !== 1) {
    throw new FieldSetupDispatchError("Field-setup session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  const token = matches[0].slice(SESSION_COOKIE_NAME.length + 1);
  if (!TOKEN_PATTERN.test(token)) {
    throw new FieldSetupDispatchError("Field-setup session was not found", {
      status: 404,
      publicCode: "session_not_found",
    });
  }
  return token;
}

function verifyCsrf(request, sessionToken, config) {
  const supplied = getHeader(request, config.csrfHeaderName);
  const expected = csrfToken(sessionToken, config.csrfPepper);
  if (
    typeof supplied !== "string" ||
    !CSRF_TOKEN_PATTERN.test(supplied) ||
    !crypto.timingSafeEqual(Buffer.from(supplied, "utf8"), Buffer.from(expected, "utf8"))
  ) {
    throw new FieldSetupDispatchError("Field-setup CSRF validation failed", {
      status: 403,
      publicCode: "authentication_failed",
    });
  }
}

function sessionTokenFromSetCookie(value) {
  const match = typeof value === "string" ? value.match(SESSION_COOKIE_PATTERN) : null;
  if (!match || Number(match[2]) < 60 || Number(match[2]) > 3600) {
    throw new FieldSetupDispatchError("Field-setup session cookie is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  return match[1];
}

function canonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function sanitizedJourney(journey) {
  const progress = FIELD_SETUP_STATES.indexOf(journey?.state) + 1;
  if (
    progress < 1 ||
    !Number.isSafeInteger(journey?.revision) ||
    journey.revision < 1
  ) {
    throw new FieldSetupDispatchError("Field-setup journey readback is invalid", {
      publicCode: "service_unavailable",
    });
  }
  return Object.freeze({
    state: journey.state,
    progress,
    totalSteps: FIELD_SETUP_STATES.length,
    revision: journey.revision,
  });
}

function sanitizedConversionPreview(value) {
  exactKeys(
    value,
    ["account", "contact", "deal", "noEmailOrRoutingEffect"],
    "Conversion preview",
    { status: 503, publicCode: "service_unavailable" },
  );
  if (
    value.noEmailOrRoutingEffect !== true
  ) {
    throw new FieldSetupDispatchError("Conversion preview is invalid");
  }
  for (const [label, target] of [["Account", value.account], ["Contact", value.contact]]) {
    exactKeys(target, ["action", "displayName"], `${label} conversion preview`, {
      status: 503,
      publicCode: "service_unavailable",
    });
    if (
      !["associate_one_verified_match", "create_from_conversion_mapping"].includes(target.action) ||
      typeof target.displayName !== "string" ||
      target.displayName.length < 1 ||
      target.displayName.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(target.displayName)
    ) {
      throw new FieldSetupDispatchError(`${label} conversion preview is invalid`);
    }
  }
  exactKeys(
    value.deal,
    ["closingDate", "dealName", "mandatoryDealFields", "pipeline", "stage", "type"],
    "Deal conversion preview",
    { status: 503, publicCode: "service_unavailable" },
  );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value.deal.closingDate) ||
    !Array.isArray(value.deal.mandatoryDealFields) ||
    value.deal.mandatoryDealFields.length !== 6 ||
    value.deal.mandatoryDealFields.some((field) => typeof field !== "string") ||
    [value.deal.dealName, value.deal.pipeline, value.deal.stage, value.deal.type].some(
      (field) => typeof field !== "string" || field.length < 1 || field.length > 200 || /[\u0000-\u001f\u007f]/.test(field),
    )
  ) {
    throw new FieldSetupDispatchError("Deal conversion preview is invalid");
  }
  return Object.freeze({
    account: Object.freeze({ ...value.account }),
    contact: Object.freeze({ ...value.contact }),
    deal: Object.freeze({
      ...value.deal,
      mandatoryDealFields: Object.freeze([...value.deal.mandatoryDealFields]),
    }),
    noEmailOrRoutingEffect: true,
  });
}

function result(status, body, outcome, setCookie) {
  const value = {
    status,
    body: Object.freeze(body),
    stage: "field_setup",
    outcome,
  };
  if (setCookie !== undefined) value.setCookie = setCookie;
  return Object.freeze(value);
}

function normalizeError(error) {
  if (error instanceof FieldSetupDispatchError || error instanceof HttpBoundaryError) return error;
  if (error instanceof FieldSetupContractError) {
    if (error.publicCode === "reconciliation_required" || error.ambiguous === true) {
      return new FieldSetupDispatchError(
        "Conversion outcome requires controlled reconciliation",
        { status: 503, publicCode: "reconciliation_required" },
      );
    }
    if (error.publicCode === "authentication_failed") {
      return new FieldSetupDispatchError("Field-setup authentication failed", {
        status: 401,
        publicCode: "authentication_failed",
      });
    }
    if (error.publicCode === "field_setup_not_found") {
      return new FieldSetupDispatchError("Field-setup session was not found", {
        status: 404,
        publicCode: "session_not_found",
      });
    }
    if (
      error.publicCode === "stale_revision" ||
      error.publicCode === "server_outcome_required"
    ) {
      return new FieldSetupDispatchError("Field-setup state is not ready for this intent", {
        status: 409,
        publicCode: "context_conflict",
      });
    }
    if (error.publicCode === "configuration_invalid") {
      return new FieldSetupDispatchError("Field-setup composition is unavailable", {
        publicCode: "configuration_invalid",
      });
    }
    return new FieldSetupDispatchError("Field-setup request is invalid", {
      status: 422,
      publicCode: "request_invalid",
    });
  }
  if (error?.publicCode === "configuration_invalid") {
    return new FieldSetupDispatchError("Field-setup composition is unavailable", {
      publicCode: "configuration_invalid",
    });
  }
  return new FieldSetupDispatchError("Field-setup dependency is unavailable");
}

async function jsonBody(request, path, config) {
  validateJsonPost(request, new Set([path]));
  const raw = await readRawBody(request, {
    maximumBytes: config.maxBodyBytes,
    timeoutMs: config.bodyTimeoutMs,
  });
  return parseJsonObject(raw);
}

function assertBodylessGet(request, path) {
  if (String(request?.method ?? "").toUpperCase() !== "GET") {
    throw new HttpBoundaryError("Method is not approved", {
      status: 405,
      publicCode: "method_not_allowed",
    });
  }
  if (parseRequestPath(request) !== path) {
    throw new HttpBoundaryError("Route is not approved", {
      status: 404,
      publicCode: "route_not_found",
    });
  }
  const contentLength = getHeader(request, "content-length");
  if (
    (contentLength !== undefined && contentLength !== "0") ||
    (Buffer.isBuffer(request?.rawBody) && request.rawBody.length !== 0)
  ) {
    throw new HttpBoundaryError("GET body is prohibited", {
      status: 400,
      publicCode: "body_invalid",
    });
  }
}

function createFieldSetupDispatcher({
  authenticatedOperatorResolver,
  config: inputConfig,
  controlledConversionDefaults,
  conversionService,
  dealResumeBindingDigest,
  launchService,
} = {}) {
  const config = normalizeConfig(inputConfig);
  if (
    typeof authenticatedOperatorResolver !== "function" ||
    typeof launchService?.issueLaunch !== "function" ||
    typeof launchService?.exchangeLaunch !== "function" ||
    typeof launchService?.authenticateSession !== "function" ||
    typeof launchService?.transitionSession !== "function" ||
    typeof conversionService?.buildPreview !== "function" ||
    typeof conversionService?.readPreview !== "function" ||
    typeof conversionService?.confirmConversion !== "function" ||
    typeof dealResumeBindingDigest !== "function" ||
    !isPlainObject(controlledConversionDefaults)
  ) {
    throw new FieldSetupDispatchError("Field-setup injected dependencies are unavailable", {
      publicCode: "configuration_invalid",
    });
  }
  const fieldPaths = new Set(ROUTE_KEYS.map((key) => config.routes[key]));

  function claimsRequest(request) {
    return fieldPaths.has(candidatePath(request));
  }

  function assertNoRouteCollision(existingPaths) {
    if (
      !Array.isArray(existingPaths) ||
      existingPaths.some((path) => typeof path !== "string") ||
      existingPaths.some((path) => fieldPaths.has(path))
    ) {
      throw new FieldSetupDispatchError("Field-setup route collides with an existing route", {
        publicCode: "configuration_invalid",
      });
    }
  }

  async function operator(request, context, routeId) {
    let resolved;
    try {
      const identityRequest = Object.freeze({
        headers: Object.freeze({ ...(request?.headers ?? {}) }),
        method: String(request?.method ?? ""),
        url: String(request?.url ?? request?.originalUrl ?? ""),
      });
      resolved = await authenticatedOperatorResolver(Object.freeze({
        app: context?.app,
        // The injected Catalyst mapping receives request metadata, never the parsed or raw
        // body. Operator identity therefore cannot be sourced from browser-supplied JSON.
        request: identityRequest,
        routeId,
      }));
    } catch {
      throw new FieldSetupDispatchError("Field-setup operator authentication failed", {
        status: 401,
        publicCode: "authentication_failed",
      });
    }
    return normalizeAuthenticatedOperator(resolved);
  }

  async function authenticateBrowser(
    request,
    context,
    routeId,
    { allowMissingOrigin = false } = {},
  ) {
    assertSameOrigin(request, config.webClientOrigin, { allowMissingOrigin });
    const sessionToken = readSessionCookie(request);
    verifyCsrf(request, sessionToken, config);
    const authenticatedOperator = await operator(request, context, routeId);
    const journey = await launchService.authenticateSession(sessionToken, authenticatedOperator);
    return { authenticatedOperator, journey, sessionToken };
  }

  async function dispatchLaunch(request, context) {
    const body = exactKeys(
      await jsonBody(request, config.routes.launchPath, config),
      ["protocolId", "schemaVersion", "moduleApiName", "recordId"],
      "Field-setup launch body",
    );
    if (
      body.protocolId !== FIELD_SETUP_PROTOCOL.protocolId ||
      body.schemaVersion !== FIELD_SETUP_PROTOCOL.schemaVersion
    ) {
      throw new FieldSetupDispatchError("Field-setup launch schema is invalid", {
        status: 422,
        publicCode: "request_invalid",
      });
    }
    const authenticatedOperator = await operator(request, context, "FIELD_SETUP_LAUNCH");
    const issued = await launchService.issueLaunch({
      environment: authenticatedOperator.environment,
      moduleApiName: body.moduleApiName,
      operatorUserId: authenticatedOperator.operatorUserId,
      recordId: body.recordId,
    });
    let launchUrl;
    try {
      launchUrl = new URL(issued?.launchUrl);
    } catch {
      throw new FieldSetupDispatchError("Field-setup launch response is invalid");
    }
    if (
      issued?.ok !== true ||
      launchUrl.origin !== config.webClientOrigin ||
      launchUrl.pathname !== "/field-setup/" ||
      launchUrl.search ||
      !/^#launch=[A-Za-z0-9_-]{43}$/.test(launchUrl.hash) ||
      !canonicalTimestamp(issued.expiresAt)
    ) {
      throw new FieldSetupDispatchError("Field-setup launch response is invalid");
    }
    return result(201, protocolResponse({
      ok: true,
      launchUrl: launchUrl.href,
      expiresAt: issued.expiresAt,
    }), "launch_issued");
  }

  async function dispatchExchange(request, context) {
    assertSameOrigin(request, config.webClientOrigin);
    assertProtocolHeaders(request);
    const body = exactKeys(
      await jsonBody(request, config.routes.exchangePath, config),
      ["nonce"],
      "Field-setup exchange body",
    );
    const authenticatedOperator = await operator(request, context, "FIELD_SETUP_EXCHANGE");
    const exchanged = await launchService.exchangeLaunch(body, authenticatedOperator);
    const sessionToken = sessionTokenFromSetCookie(exchanged?.setCookie);
    const journey = exchanged?.publicJourney;
    const publicJourney = sanitizedJourney(journey);
    // A fresh Lead launch begins at the company summary, while a record-bound
    // Lead or Deal resume must return the journey's authoritative current step.
    if (exchanged?.ok !== true) {
      throw new FieldSetupDispatchError("Field-setup exchange response is invalid");
    }
    return result(200, protocolResponse({
      ok: true,
      csrfToken: csrfToken(sessionToken, config.csrfPepper),
      journey: publicJourney,
    }), "session_exchanged", exchanged.setCookie);
  }

  async function dispatchStatus(request, context) {
    assertBodylessGet(request, config.routes.statusPath);
    assertProtocolHeaders(request);
    const { journey } = await authenticateBrowser(
      request,
      context,
      "FIELD_SETUP_STATUS",
      { allowMissingOrigin: true },
    );
    return result(200, protocolResponse({
      ok: true,
      journey: sanitizedJourney(journey),
    }), "status_read");
  }

  async function dispatchDecision(request, context) {
    assertSameOrigin(request, config.webClientOrigin);
    assertProtocolHeaders(request);
    const body = exactKeys(
      await jsonBody(request, config.routes.decisionPath, config),
      ["action", "qualification", "revision"],
      "Field-setup decision body",
    );
    const { authenticatedOperator, journey, sessionToken } = await authenticateBrowser(
      request,
      context,
      "FIELD_SETUP_OPERATOR_DECISION",
    );
    const isCurrentRevision = body.revision === journey.revision;
    const isReplayCandidate = body.revision === journey.revision - 1;
    if (
      !Number.isSafeInteger(body.revision) ||
      body.revision < 1 ||
      (!isCurrentRevision && !isReplayCandidate)
    ) {
      throw new FieldSetupDispatchError("Field-setup decision revision is stale", {
        status: 409,
        publicCode: "context_conflict",
      });
    }
    const action = assertBrowserAction(body.action);
    if (COORDINATED_BROWSER_ACTIONS.includes(action)) {
      throw new FieldSetupDispatchError(
        "Coordinated conversion action requires its dedicated route",
        { status: 409, publicCode: "context_conflict" },
      );
    }
    const transition = isCurrentRevision
      ? resolveTransition(journey.state, action)
      : null;
    const transitioned = await launchService.transitionSession({
      actionId: action,
      expectedRevision: body.revision,
      qualification: body.qualification,
      sessionToken,
    }, authenticatedOperator);
    const publicJourney = sanitizedJourney(transitioned);
    if (
      transitioned?.authoritative !== true ||
      transitioned?.conversionAuthorized !== false ||
      publicJourney.state !== (transition?.nextState ?? journey.state) ||
      publicJourney.revision !== (isCurrentRevision
        ? journey.revision + 1
        : journey.revision)
    ) {
      throw new FieldSetupDispatchError("Field-setup transition readback is invalid");
    }
    return result(200, protocolResponse({
      ok: true,
      journey: publicJourney,
      navigationIntent: transitioned.navigationIntent ?? null,
    }), "intent_reconciled");
  }

  async function dispatchConversionPreview(request, context) {
    assertSameOrigin(request, config.webClientOrigin);
    assertProtocolHeaders(request);
    const body = exactKeys(
      await jsonBody(request, config.routes.conversionPreviewPath, config),
      ["revision"],
      "Conversion preview body",
    );
    const { authenticatedOperator, journey, sessionToken } = await authenticateBrowser(
      request,
      context,
      "FIELD_SETUP_CONVERSION_PREVIEW",
    );
    const isCurrentRevision = body.revision === journey.revision;
    const isCommittedBuildReplay =
      journey.state === "lead_conversion_confirmation" &&
      body.revision === journey.revision - 1;
    if (
      !Number.isSafeInteger(body.revision) ||
      body.revision < 1 ||
      (!isCurrentRevision && !isCommittedBuildReplay)
    ) {
      throw new FieldSetupDispatchError("Conversion preview revision is stale", {
        status: 409,
        publicCode: "context_conflict",
      });
    }
    const input = Object.freeze({
      journeyKey: journey.journeyKey,
      leadId: journey.recordId,
    });
    const preview = journey.state === "lead_conversion_preview"
      ? await conversionService.buildPreview(
        input,
        journey,
        authenticatedOperator,
        controlledConversionDefaults,
      )
      : journey.state === "lead_conversion_confirmation"
        ? await conversionService.readPreview(
          input,
          journey,
          authenticatedOperator,
          controlledConversionDefaults,
        )
        : null;
    if (preview === null) {
      throw new FieldSetupDispatchError("Conversion preview state is unavailable", {
        status: 409,
        publicCode: "context_conflict",
      });
    }
    const refreshed = await launchService.authenticateSession(
      sessionToken,
      authenticatedOperator,
    );
    if (
      refreshed.state !== "lead_conversion_confirmation" ||
      refreshed.conversionStatus !== "preview_ready" ||
      refreshed.conversionPreviewFingerprint !== preview.previewFingerprint ||
      refreshed.revision !== preview.revision ||
      !SHA256_PATTERN.test(refreshed.conversionPreviewFingerprint ?? "")
    ) {
      throw new FieldSetupDispatchError("Conversion preview journey readback is invalid");
    }
    return result(200, protocolResponse({
      ok: true,
      journey: sanitizedJourney(refreshed),
      preview: sanitizedConversionPreview(preview.sanitizedPreview),
    }), "conversion_preview_reconciled");
  }

  async function dispatchConversionConfirm(request, context) {
    assertSameOrigin(request, config.webClientOrigin);
    assertProtocolHeaders(request);
    const body = exactKeys(
      await jsonBody(request, config.routes.conversionConfirmPath, config),
      ["confirm", "revision"],
      "Conversion confirmation body",
    );
    const { authenticatedOperator, journey, sessionToken } = await authenticateBrowser(
      request,
      context,
      "FIELD_SETUP_CONVERSION_CONFIRM",
    );
    if (body.confirm !== true || !Number.isSafeInteger(body.revision) || body.revision < 1) {
      throw new FieldSetupDispatchError("Conversion confirmation is invalid", {
        status: 422,
        publicCode: "request_invalid",
      });
    }
    if (
      journey.state === "handoff_to_client_form2" &&
      journey.conversionStatus === "completed" &&
      body.revision < journey.revision &&
      [
        journey.conversionPreviewFingerprint,
        journey.conversionSideEffectFingerprint,
        journey.conversionOutcomeFingerprint,
        journey.dealResumeBindingDigest,
      ].every((value) => SHA256_PATTERN.test(value ?? ""))
    ) {
      return result(200, protocolResponse({
        ok: true,
        journey: sanitizedJourney(journey),
        replayed: true,
      }), "conversion_completion_replayed");
    }
    if (
      journey.state === "lead_conversion_confirmation" &&
      ["write_started", "reconciliation_required"].includes(journey.conversionStatus) &&
      SHA256_PATTERN.test(journey.conversionPreviewFingerprint ?? "")
    ) {
      // The browser can only retry its last acknowledged revision after an
      // ambiguous response. Preserve the durable no-retry boundary as the
      // public outcome even when the server-side write marker advanced first.
      throw new FieldSetupDispatchError(
        "Conversion outcome requires controlled reconciliation",
        { status: 503, publicCode: "reconciliation_required" },
      );
    }
    if (
      journey.state !== "lead_conversion_confirmation" ||
      body.revision !== journey.revision ||
      !SHA256_PATTERN.test(journey.conversionPreviewFingerprint ?? "")
    ) {
      throw new FieldSetupDispatchError("Conversion confirmation state is unavailable", {
        status: 409,
        publicCode: "context_conflict",
      });
    }
    const confirmed = await conversionService.confirmConversion({
      confirm: true,
      previewFingerprint: journey.conversionPreviewFingerprint,
      revision: journey.revision,
    }, journey, authenticatedOperator, controlledConversionDefaults, dealResumeBindingDigest);
    const refreshed = await launchService.authenticateSession(
      sessionToken,
      authenticatedOperator,
    );
    if (
      confirmed?.ok !== true ||
      refreshed.state !== "handoff_to_client_form2" ||
      refreshed.conversionStatus !== "completed" ||
      refreshed.revision !== confirmed.revision ||
      [
        refreshed.conversionPreviewFingerprint,
        refreshed.conversionSideEffectFingerprint,
        refreshed.conversionOutcomeFingerprint,
        refreshed.dealResumeBindingDigest,
      ].some((value) => !SHA256_PATTERN.test(value ?? ""))
    ) {
      throw new FieldSetupDispatchError("Conversion completion journey readback is invalid");
    }
    return result(200, protocolResponse({
      ok: true,
      journey: sanitizedJourney(refreshed),
      replayed: confirmed.replay === true,
    }), confirmed.replay === true
      ? "conversion_completion_replayed"
      : "conversion_completion_reconciled");
  }

  async function dispatch(request, context = {}) {
    try {
      const path = parseRequestPath(request);
      if (path === config.routes.launchPath) return await dispatchLaunch(request, context);
      if (path === config.routes.exchangePath) return await dispatchExchange(request, context);
      if (path === config.routes.statusPath) return await dispatchStatus(request, context);
      if (path === config.routes.decisionPath) return await dispatchDecision(request, context);
      if (path === config.routes.conversionPreviewPath) {
        return await dispatchConversionPreview(request, context);
      }
      if (path === config.routes.conversionConfirmPath) {
        return await dispatchConversionConfirm(request, context);
      }
      throw new HttpBoundaryError("Route is not approved", {
        status: 404,
        publicCode: "route_not_found",
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    status: "NOT_READY",
    catalystHeaderMapping: "NOT_READY_INJECTED_ONLY",
    catalystIdentityMapping: "NOT_READY_INJECTED_ONLY",
    deploymentAuthorized: false,
    runtimeAuthority: false,
    assertNoRouteCollision,
    claimsRequest,
    dispatch,
  });
}

module.exports = {
  FieldSetupDispatchError,
  SESSION_COOKIE_NAME,
  PROTOCOL_ID_HEADER,
  PROTOCOL_VERSION_HEADER,
  createFieldSetupDispatcher,
  csrfToken,
};
