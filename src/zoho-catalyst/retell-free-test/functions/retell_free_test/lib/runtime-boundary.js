'use strict';

const crypto = require('node:crypto');
const { loadConfig } = require('./config');
const { FreeTestError, invariant } = require('./errors');
const { readRawBody, parseJson, json } = require('./http');
const { verifyRetellSignature } = require('./security');
const { createCatalystStore } = require('./catalyst-store');
const { CatalystMailAdapter } = require('./catalyst-mail');
const { createRuntimeService } = require('./runtime-service');

const RETELL_SIGNATURE_HEADER = 'x-retell-signature';

function headerValues(request, name) {
  const normalized = name.toLowerCase();
  const distinct = Object.entries(request?.headersDistinct || {})
    .filter(([candidate]) => candidate.toLowerCase() === normalized);
  if (distinct.length > 0) {
    invariant(distinct.length === 1 && Array.isArray(distinct[0][1]),
      'INVALID_REQUEST_HEADER', 'Required request header is unavailable.', { httpStatus: 400 });
    return distinct[0][1];
  }
  if (Array.isArray(request?.rawHeaders)) {
    invariant(request.rawHeaders.length % 2 === 0,
      'INVALID_REQUEST_HEADER', 'Required request header is unavailable.', { httpStatus: 400 });
    const raw = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (typeof request.rawHeaders[index] === 'string'
        && request.rawHeaders[index].toLowerCase() === normalized) raw.push(request.rawHeaders[index + 1]);
    }
    if (raw.length > 0) return raw;
  }
  return Object.entries(request?.headers || {})
    .filter(([candidate]) => candidate.toLowerCase() === normalized)
    .map(([, value]) => value);
}

function scalarHeader(request, name) {
  const values = headerValues(request, name);
  invariant(values.length === 1 && typeof values[0] === 'string',
    'INVALID_REQUEST_HEADER', 'Required request header is unavailable.', { httpStatus: 400 });
  return values[0];
}

function optionalScalarHeader(request, name) {
  const values = headerValues(request, name);
  invariant(values.length <= 1 && (values.length === 0 || typeof values[0] === 'string'),
    'INVALID_REQUEST_HEADER', 'Request header is ambiguous.', { httpStatus: 400 });
  return values.length === 0 ? null : values[0];
}

function assertDevelopmentHost(request, config) {
  const host = scalarHeader(request, 'host').trim().toLowerCase();
  invariant(host === config.developmentHost && host.includes('.development.')
    && config.environment === 'development',
  'PRODUCTION_BLOCKED', 'Catalyst runtime environment is not Development.', { httpStatus: 503 });
}

function assertPlatformDevelopment(request, app, config) {
  assertDevelopmentHost(request, config);
  const platformEnvironmentHeader = optionalScalarHeader(request, 'x-zc-environment');
  const platformEnvironment = platformEnvironmentHeader === null
    ? null : platformEnvironmentHeader.trim().toLowerCase();
  const platformProjectId = scalarHeader(request, 'x-zc-projectid').trim();
  const platformProjectKey = scalarHeader(request, 'x-zc-project-key');
  const sdkEnvironment = typeof app?.config?.environment === 'string'
    ? app.config.environment.trim().toLowerCase() : '';
  const sdkProjectId = app?.config?.projectId;
  const sdkProjectKey = typeof app?.config?.projectKey === 'string'
    ? app.config.projectKey : '';
  // Catalyst's live Advanced I/O proxy omits x-zc-environment. In that case the
  // SDK reports its Production default even on a Development function, so the
  // exact Development host plus the independently read request/SDK project
  // bindings are authoritative. If Catalyst supplies an environment header, it
  // and the SDK must both corroborate Development.
  const environmentBinding = platformEnvironment === null
    ? new Set(['', 'development', 'production']).has(sdkEnvironment)
    : platformEnvironment === 'development' && sdkEnvironment === 'development';
  invariant(environmentBinding
    && platformProjectId === config.developmentProjectId
    && String(sdkProjectId || '') === config.developmentProjectId
    && /^[A-Za-z0-9_-]{8,253}$/.test(platformProjectKey)
    && sdkProjectKey === platformProjectKey,
  'PRODUCTION_BLOCKED', 'Catalyst runtime environment is not the approved Development project.',
  { httpStatus: 503 });
}

function bearerToken(request) {
  const value = scalarHeader(request, 'authorization');
  invariant(value.startsWith('Bearer '), 'READINESS_UNAUTHORIZED',
    'Private route authorization is required.', { httpStatus: 401 });
  return value.slice(7);
}

function timingSafeToken(actual, expected) {
  const actualDigest = crypto.createHash('sha256').update(actual, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function safeError(error) {
  const allowed = new Set([
    'INVALID_JSON', 'INVALID_REQUEST_HEADER', 'INVALID_SIGNATURE', 'MISSING_SIGNATURE',
    'STALE_SIGNATURE', 'REQUEST_ABORTED', 'REQUEST_BODY_TIMEOUT', 'REQUEST_STREAM_ERROR',
    'REQUEST_TOO_LARGE', 'READINESS_UNAUTHORIZED', 'PRODUCTION_BLOCKED',
    'INVALID_RUNTIME_CONFIGURATION', 'INVALID_SCHEMA', 'INVALID_EVENT',
    'EVENT_TIMESTAMP_MISMATCH', 'CALL_OWNERSHIP_UNRESOLVED', 'INVALID_ANALYSIS',
    'CATALYST_OPERATION_TIMEOUT', 'CATALYST_QUERY_FAILED', 'CATALYST_INSERT_FAILED',
    'CATALYST_UPDATE_FAILED', 'CATALYST_CONCURRENCY_CONFLICT', 'DURABLE_IDEMPOTENCY_CONFLICT',
    'CATALYST_READINESS_FAILED',
    'METHOD_NOT_ALLOWED', 'ROUTE_NOT_FOUND', 'CONTENT_TYPE_NOT_ALLOWED',
  ]);
  const code = allowed.has(error?.code) ? error.code : 'INTERNAL_ERROR';
  const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : 500;
  return { code, status };
}

function createRequestListener(options = {}) {
  const {
    catalystSdk,
    environment = process.env,
    now = Date.now,
    logger = { info() {}, warn() {}, error() {} },
    serviceFactory = createRuntimeService,
    storeFactory = createCatalystStore,
    mailFactory = (app, config) => new CatalystMailAdapter({ app, config }),
  } = options;
  invariant(catalystSdk && typeof catalystSdk.initialize === 'function',
    'INVALID_RUNTIME_CONFIGURATION', 'Catalyst SDK is unavailable.', { httpStatus: 503 });
  return async function requestListener(request, response) {
    let route = 'unknown';
    try {
      const config = loadConfig(environment);
      const url = new URL(request.url || '/', 'http://catalyst.invalid');
      const routePath = url.pathname;
      route = routePath === config.inboundPath ? 'inbound'
        : routePath === config.eventsPath ? 'events'
          : routePath === config.readinessPath ? 'readiness' : 'unknown';
      invariant(url.search === '' && url.hash === '', 'ROUTE_NOT_FOUND',
        'Route not found.', { httpStatus: 404 });
      assertDevelopmentHost(request, config);
      const app = catalystSdk.initialize(request);
      assertPlatformDevelopment(request, app, config);

      if (routePath === config.readinessPath) {
        invariant(request.method === 'GET', 'METHOD_NOT_ALLOWED', 'Readiness requires GET.', { httpStatus: 405 });
        invariant(timingSafeToken(bearerToken(request), config.readinessToken),
          'READINESS_UNAUTHORIZED', 'Readiness authorization failed.', { httpStatus: 401 });
        const store = storeFactory(app, config);
        const service = serviceFactory({ store, mailAdapter: mailFactory(app, config), config, now, logger });
        const result = await service.readiness();
        json(response, 200, { ok: true, environment: 'development', source_revision: config.sourceRevision,
          table_count: result.tableCount, source_deployment_count: result.sourceDeploymentCount,
          mail_mode: config.mailMode });
        return;
      }

      invariant(routePath === config.inboundPath || routePath === config.eventsPath,
        'ROUTE_NOT_FOUND', 'Route not found.', { httpStatus: 404 });
      invariant(request.method === 'POST', 'METHOD_NOT_ALLOWED', 'Route requires POST.', { httpStatus: 405 });
      const contentType = scalarHeader(request, 'content-type').split(';', 1)[0].trim().toLowerCase();
      invariant(contentType === 'application/json', 'CONTENT_TYPE_NOT_ALLOWED',
        'Content type must be application/json.', { httpStatus: 415 });
      const rawBody = await readRawBody(request, {
        maximumBytes: config.maxRequestBodyBytes,
        timeoutMs: config.inboundBodyTimeoutMs,
      });
      const signature = verifyRetellSignature({
        rawBody,
        signatureHeader: scalarHeader(request, RETELL_SIGNATURE_HEADER),
        verificationKey: config.retellVerificationKey,
        nowMs: now(),
        maxAgeMs: config.maxSignatureAgeMs,
      });
      request.retellSignatureTimestamp = signature.timestamp;
      const payload = parseJson(rawBody);
      const store = storeFactory(app, config);
      const service = serviceFactory({ store, mailAdapter: mailFactory(app, config), config, now, logger });
      if (routePath === config.inboundPath) {
        const result = await service.resolveInbound(payload, {
          signatureTimestamp: request.retellSignatureTimestamp,
        });
        json(response, 200, result.response);
        return;
      }
      const result = await service.processEvent(payload, rawBody);
      json(response, 200, { ok: true, status: result.status, duplicate: result.duplicate === true,
        correlation_id: result.correlationId || null });
    } catch (error) {
      const failure = safeError(error);
      logger.error({ event: 'runtime_request_failed', route, errorCode: failure.code, status: failure.status });
      json(response, failure.status, { ok: false, code: failure.code });
    }
  };
}

module.exports = {
  createRequestListener, assertDevelopmentHost, assertPlatformDevelopment, timingSafeToken,
  scalarHeader, optionalScalarHeader, RETELL_SIGNATURE_HEADER,
};
