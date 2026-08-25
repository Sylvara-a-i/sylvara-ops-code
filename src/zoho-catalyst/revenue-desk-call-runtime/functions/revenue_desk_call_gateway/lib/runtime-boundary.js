'use strict';

const crypto = require('node:crypto');
const { loadConfig } = require('./config');
const { invariant } = require('./errors');
const { readRawBody, parseJson, json } = require('./http');
const { verifyRetellSignature, payloadFingerprint } = require('./security');
const { createCatalystStore } = require('./catalyst-store');
const { CatalystJobAdapter } = require('./catalyst-jobs');
const { createRuntimeService } = require('./runtime-service');

const RETELL_SIGNATURE_HEADER = 'x-retell-signature';
const READINESS_TOKEN_HEADER = 'x-revenue-desk-readiness-token';

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
        && request.rawHeaders[index].toLowerCase() === normalized) {
        raw.push(request.rawHeaders[index + 1]);
      }
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

function assertRuntimeHost(request, config) {
  const authority = scalarHeader(request, 'host').trim().toLowerCase();
  const host = authority.endsWith(':443') ? authority.slice(0, -4) : authority;
  invariant(host === config.runtimeHost,
    'CATALYST_HOST_MISMATCH', 'Catalyst runtime host does not match configured identity.',
    { httpStatus: 503 });
}

function assertPlatformRuntime(request, app, config) {
  assertRuntimeHost(request, config);
  const sdkEnvironment = typeof app?.config?.environment === 'string'
    ? app.config.environment.trim().toLowerCase() : '';
  const sdkProjectId = app?.config?.projectId;
  const sdkProjectKey = typeof app?.config?.projectKey === 'string'
    ? app.config.projectKey : '';
  invariant(sdkEnvironment === config.environment,
    'CATALYST_ENVIRONMENT_MISMATCH',
    'Catalyst runtime environment does not match configured identity.',
    { httpStatus: 503 });
  invariant(String(sdkProjectId || '') === config.projectId
    && /^[A-Za-z0-9_-]{8,253}$/.test(sdkProjectKey),
  'CATALYST_PROJECT_MISMATCH', 'Catalyst runtime project identity is not approved.',
  { httpStatus: 503 });
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
    'REQUEST_TOO_LARGE', 'READINESS_UNAUTHORIZED', 'PRODUCTION_BLOCKED', 'PRODUCTION_DARK',
    'CATALYST_HOST_MISMATCH', 'INVALID_RUNTIME_CONFIGURATION', 'INVALID_SCHEMA',
    'INVALID_EVENT', 'CATALYST_ENVIRONMENT_MISMATCH', 'CATALYST_PROJECT_MISMATCH',
    'EVENT_TIMESTAMP_MISMATCH', 'CALL_OWNERSHIP_UNRESOLVED', 'INVALID_ANALYSIS',
    'CATALYST_OPERATION_TIMEOUT', 'CATALYST_QUERY_FAILED', 'CATALYST_INSERT_FAILED',
    'CATALYST_UPDATE_FAILED', 'CATALYST_CONCURRENCY_CONFLICT',
    'DURABLE_IDEMPOTENCY_CONFLICT', 'CATALYST_READINESS_FAILED',
    'CATALYST_JOB_SUBMIT_TIMEOUT', 'CATALYST_JOB_SUBMIT_FAILED',
    'CATALYST_JOB_READBACK_FAILED', 'EVENT_ENQUEUE_PENDING',
    'UNSTAMPED_ARTIFACT', 'SOURCE_REVISION_MISMATCH',
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
    jobFactory = (app, config) => new CatalystJobAdapter({ app, config }),
    artifactSourceRevision,
  } = options;
  invariant(catalystSdk && typeof catalystSdk.initialize === 'function',
    'INVALID_RUNTIME_CONFIGURATION', 'Catalyst SDK is unavailable.', { httpStatus: 503 });
  return async function requestListener(request, response) {
    let route = 'unknown';
    try {
      const config = loadConfig(environment, { artifactSourceRevision });
      invariant(config.deploymentMode === 'active' && config.environment === 'development',
        'PRODUCTION_DARK', 'Revenue Desk Production runtime is dark.', { httpStatus: 503 });
      const url = new URL(request.url || '/', 'http://catalyst.invalid');
      const routePath = url.pathname;
      route = routePath === config.inboundPath ? 'inbound'
        : routePath === config.eventsPath ? 'events'
          : routePath === config.readinessPath ? 'readiness' : 'unknown';
      invariant(url.search === '' && url.hash === '', 'ROUTE_NOT_FOUND',
        'Route not found.', { httpStatus: 404 });
      invariant(route !== 'unknown', 'ROUTE_NOT_FOUND',
        'Route not found.', { httpStatus: 404 });
      assertRuntimeHost(request, config);
      const app = catalystSdk.initialize(request);
      assertPlatformRuntime(request, app, config);

      if (route === 'readiness') {
        invariant(request.method === 'GET', 'METHOD_NOT_ALLOWED',
          'Readiness requires GET.', { httpStatus: 405 });
        invariant(timingSafeToken(
          scalarHeader(request, READINESS_TOKEN_HEADER),
          config.readinessToken,
        ), 'READINESS_UNAUTHORIZED', 'Readiness authorization failed.', { httpStatus: 401 });
        const store = storeFactory(app, config);
        const service = serviceFactory({ store, mailAdapter: null, config, now, logger });
        const result = await service.readiness();
        json(response, 200, {
          ok: true,
          environment: config.environment,
          source_revision: config.sourceRevision,
          table_count: result.tableCount,
          source_deployment_count: result.sourceDeploymentCount,
          active_authorized_deployment_count: result.activeDeploymentCount,
          terminal_reconciliation_pending_count: result.terminalReconciliationPendingCount,
          readiness_scan_capped: result.readinessScanCapped,
          mail_mode: config.mailMode,
          traffic_enabled: config.environment === 'development'
            && result.activeDeploymentCount > 0
            && result.readinessScanCapped === false
            && result.terminalReconciliationPendingCount === 0,
          production_activation_authorized: false,
        });
        return;
      }

      invariant(route === 'inbound' || route === 'events',
        'ROUTE_NOT_FOUND', 'Route not found.', { httpStatus: 404 });
      invariant(request.method === 'POST', 'METHOD_NOT_ALLOWED',
        'Route requires POST.', { httpStatus: 405 });
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
      const payload = parseJson(rawBody);
      const store = storeFactory(app, config);
      if (route === 'inbound') {
        const service = serviceFactory({
          store,
          mailAdapter: null,
          config,
          now,
          logger,
        });
        const result = await service.resolveInbound(payload, {
          signatureTimestamp: signature.timestamp,
          requestFingerprint: payloadFingerprint(config.eventSecret, rawBody),
        });
        json(response, 200, result.response);
        return;
      }
      const service = serviceFactory({
        store,
        mailAdapter: null,
        jobAdapter: jobFactory(app, config),
        config,
        now,
        logger,
      });
      const result = await service.acceptEvent(payload, rawBody);
      json(response, 200, {
        ok: true,
        status: result.status,
        duplicate: result.duplicate === true,
        correlation_id: result.correlationId || null,
      });
    } catch (error) {
      const failure = safeError(error);
      logger.error({
        event: 'revenue_desk_gateway_request_failed',
        route,
        errorCode: failure.code,
        status: failure.status,
      });
      json(response, failure.status, { ok: false, code: failure.code });
    }
  };
}

module.exports = {
  createRequestListener,
  assertRuntimeHost,
  assertPlatformRuntime,
  timingSafeToken,
  scalarHeader,
  RETELL_SIGNATURE_HEADER,
  READINESS_TOKEN_HEADER,
};
