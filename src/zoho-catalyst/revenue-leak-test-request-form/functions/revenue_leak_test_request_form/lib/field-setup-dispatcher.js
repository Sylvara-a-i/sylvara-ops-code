"use strict";

const crypto = require("node:crypto");
const {
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
const PATH_PATTERN = /^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/;
const HEADER_PATTERN = /^x-[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const ROUTE_KEYS = Object.freeze([
  "launchPath",
  "exchangePath",
  "statusPath",
  "decisionPath",
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

function assertSameOrigin(request, expectedOrigin) {
  const origin = getHeader(request, "origin");
  const fetchSite = getHeader(request, "sec-fetch-site");
  if (origin !== expectedOrigin || fetchSite !== "same-origin") {
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
  launchService,
} = {}) {
  const config = normalizeConfig(inputConfig);
  if (
    typeof authenticatedOperatorResolver !== "function" ||
    typeof launchService?.issueLaunch !== "function" ||
    typeof launchService?.exchangeLaunch !== "function" ||
    typeof launchService?.authenticateSession !== "function"
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

  async function authenticateBrowser(request, context, routeId) {
    assertSameOrigin(request, config.webClientOrigin);
    const sessionToken = readSessionCookie(request);
    verifyCsrf(request, sessionToken, config);
    const authenticatedOperator = await operator(request, context, routeId);
    const journey = await launchService.authenticateSession(sessionToken, authenticatedOperator);
    return { authenticatedOperator, journey, sessionToken };
  }

  async function dispatchLaunch(request, context) {
    const body = exactKeys(
      await jsonBody(request, config.routes.launchPath, config),
      ["schemaVersion", "moduleApiName", "recordId"],
      "Field-setup launch body",
    );
    if (body.schemaVersion !== 1) {
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
    return result(201, {
      ok: true,
      launchUrl: launchUrl.href,
      expiresAt: issued.expiresAt,
    }, "launch_issued");
  }

  async function dispatchExchange(request, context) {
    assertSameOrigin(request, config.webClientOrigin);
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
    if (
      exchanged?.ok !== true ||
      publicJourney.state !== "company_progress_summary"
    ) {
      throw new FieldSetupDispatchError("Field-setup exchange response is invalid");
    }
    return result(200, {
      ok: true,
      csrfToken: csrfToken(sessionToken, config.csrfPepper),
      journey: publicJourney,
    }, "session_exchanged", exchanged.setCookie);
  }

  async function dispatchStatus(request, context) {
    assertBodylessGet(request, config.routes.statusPath);
    const { journey } = await authenticateBrowser(
      request,
      context,
      "FIELD_SETUP_STATUS",
    );
    return result(200, {
      ok: true,
      journey: sanitizedJourney(journey),
    }, "status_read");
  }

  async function dispatchDecision(request, context) {
    assertSameOrigin(request, config.webClientOrigin);
    const body = exactKeys(
      await jsonBody(request, config.routes.decisionPath, config),
      ["action", "revision"],
      "Field-setup decision body",
    );
    const { journey } = await authenticateBrowser(
      request,
      context,
      "FIELD_SETUP_OPERATOR_DECISION",
    );
    if (!Number.isSafeInteger(body.revision) || body.revision < 1 || body.revision !== journey.revision) {
      throw new FieldSetupDispatchError("Field-setup decision revision is stale", {
        status: 409,
        publicCode: "context_conflict",
      });
    }
    const action = assertBrowserAction(body.action);
    const transition = resolveTransition(journey.state, action);
    // Until a separately reviewed state-transition adapter exists, the only decision-route
    // operation is a protocol-defined self-looping refresh. No browser input can qualify,
    // convert, reserve, verify, approve, activate, stop, or roll back an external system.
    if (!action.startsWith("refresh_") || transition.nextState !== journey.state) {
      throw new FieldSetupDispatchError("Field-setup action is not ready", {
        status: 404,
        publicCode: "route_not_found",
      });
    }
    return result(200, {
      ok: true,
      journey: sanitizedJourney(journey),
    }, "status_refreshed");
  }

  async function dispatch(request, context = {}) {
    try {
      const path = parseRequestPath(request);
      if (path === config.routes.launchPath) return await dispatchLaunch(request, context);
      if (path === config.routes.exchangePath) return await dispatchExchange(request, context);
      if (path === config.routes.statusPath) return await dispatchStatus(request, context);
      if (path === config.routes.decisionPath) return await dispatchDecision(request, context);
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
  createFieldSetupDispatcher,
  csrfToken,
};
