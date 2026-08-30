'use strict';

const crypto = require('node:crypto');
const { createCatalystStore }
  = require('revenue_desk_call_gateway/lib/catalyst-store');
const { RevenueDeskError, invariant } = require('revenue_desk_call_gateway/lib/errors');
const { createRouteControlService }
  = require('revenue_desk_call_gateway/lib/route-control-service');
const { createAuthorizationProvider } = require('./connection');
const { loadConfig } = require('./config');
const { createCrmControlClient } = require('./crm-client');
const { createRetellRouteProvider } = require('./retell-route-provider');

function headerValues(request, target) {
  const name = target.toLowerCase();
  if (request?.headersDistinct && typeof request.headersDistinct === 'object') {
    const entries = Object.entries(request.headersDistinct)
      .filter(([key]) => key.toLowerCase() === name);
    if (entries.length) return entries.length === 1 && Array.isArray(entries[0][1])
      ? entries[0][1] : [];
  }
  if (Array.isArray(request?.rawHeaders)) {
    const values = [];
    for (let index = 0; index + 1 < request.rawHeaders.length; index += 2) {
      if (String(request.rawHeaders[index]).toLowerCase() === name) {
        values.push(request.rawHeaders[index + 1]);
      }
    }
    if (values.length) return values;
  }
  return Object.entries(request?.headers || {})
    .filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
}

function oneHeader(request, name) {
  const values = headerValues(request, name);
  invariant(values.length === 1 && typeof values[0] === 'string',
    'CONTROL_AUTHENTICATION_FAILED', 'Control authentication failed.', { httpStatus: 401 });
  return values[0];
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authenticate(request, config) {
  invariant(oneHeader(request, 'host').toLowerCase() === config.controlHost
    && oneHeader(request, 'x-zc-environment').toLowerCase() === 'development'
    && safeEqual(oneHeader(request, config.sharedHeaderName), config.sharedHeaderValue),
  'CONTROL_AUTHENTICATION_FAILED', 'Control authentication failed.', { httpStatus: 401 });
  const projectId = oneHeader(request, 'x-zc-projectid');
  invariant(/^[1-9][0-9]{0,29}$/.test(projectId)
    && safeEqual(crypto.createHash('sha256').update(projectId).digest('hex'),
      config.expectedProjectIdSha256),
  'CONTROL_AUTHENTICATION_FAILED', 'Control authentication failed.', { httpStatus: 401 });
  return projectId;
}

async function readBody(request, maximum) {
  const contentType = oneHeader(request, 'content-type').toLowerCase();
  invariant(contentType === 'application/json', 'INVALID_CONTROL_REQUEST',
    'Control request must use application/json.', { httpStatus: 415 });
  const lengthValues = headerValues(request, 'content-length');
  if (lengthValues.length) {
    invariant(lengthValues.length === 1 && /^[0-9]{1,10}$/.test(String(lengthValues[0]))
      && Number(lengthValues[0]) <= maximum,
    'INVALID_CONTROL_REQUEST', 'Control request length is invalid.', { httpStatus: 413 });
  }
  let buffer;
  if (Buffer.isBuffer(request.rawBody)) buffer = request.rawBody;
  else if (typeof request.body === 'string') buffer = Buffer.from(request.body, 'utf8');
  else if (Buffer.isBuffer(request.body)) buffer = request.body;
  else {
    const chunks = [];
    let total = 0;
    for await (const chunk of request) {
      const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += next.length;
      invariant(total <= maximum, 'INVALID_CONTROL_REQUEST',
        'Control request is too large.', { httpStatus: 413 });
      chunks.push(next);
    }
    buffer = Buffer.concat(chunks);
  }
  invariant(buffer.length > 0 && buffer.length <= maximum,
    'INVALID_CONTROL_REQUEST', 'Control request body is invalid.', { httpStatus: 400 });
  let parsed;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch (_) { parsed = null; }
  invariant(parsed && typeof parsed === 'object' && !Array.isArray(parsed),
    'INVALID_CONTROL_REQUEST', 'Control request JSON is invalid.', { httpStatus: 400 });
  return parsed;
}

function send(response, status, body) {
  const serialized = JSON.stringify(body);
  response.statusCode = status;
  if (typeof response.status === 'function') response.status(status);
  if (typeof response.setHeader === 'function') {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store, max-age=0');
    response.setHeader('pragma', 'no-cache');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
  }
  if (typeof response.send === 'function') response.send(serialized);
  else response.end(serialized);
}

function requestPath(request) {
  let url;
  try { url = new URL(request.url, 'https://internal.invalid'); } catch (_) { url = null; }
  invariant(url && !url.search && !url.hash, 'INVALID_CONTROL_REQUEST',
    'Control route is invalid.', { httpStatus: 404 });
  return url.pathname;
}

function publicCode(error) {
  const allowed = new Set([
    'ACTIVATION_COMPENSATED', 'ACTIVATION_SUPERSEDED_BY_TERMINAL_STATE',
    'CONTROL_AUTHENTICATION_FAILED',
    'CONTROL_CAS_CONFLICT', 'CONTROL_IDEMPOTENCY_CONFLICT',
    'CONTROL_PRECONDITION_FAILED', 'INVALID_CONTROL_REQUEST',
    'CRM_MANUAL_CLOSE_REQUIRED',
    'ISOLATED_RETELL_TEST_NUMBER_REQUIRED', 'PRODUCTION_DARK',
    'ROLLBACK_MANUAL_REQUIRED', 'ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL',
    'ROUTE_VERIFICATION_FAILED',
  ]);
  return allowed.has(error?.code) ? error.code.toLowerCase() : 'control_failed';
}

function createRequestListener({
  catalystSdk, environment = process.env, fetchImpl = globalThis.fetch,
  now = Date.now, artifactSourceRevision,
} = {}) {
  return async function listener(request, response) {
    try {
      const config = loadConfig(environment, artifactSourceRevision);
      invariant(request.method === 'POST', 'INVALID_CONTROL_REQUEST',
        'Control route requires POST.', { httpStatus: 405 });
      const path = requestPath(request);
      const action = Object.entries(config.paths).find(([, expected]) => expected === path)?.[0];
      invariant(action, 'INVALID_CONTROL_REQUEST', 'Control route is invalid.',
        { httpStatus: 404 });
      const projectId = authenticate(request, config);
      const body = await readBody(request, config.maxBodyBytes);
      const runtime = catalystSdk || require('zcatalyst-sdk-node');
      const app = runtime.initialize(request);
      invariant(String(app?.config?.environment || '').toLowerCase() === 'development'
        && String(app?.config?.projectId || '') === projectId,
      'CONTROL_AUTHENTICATION_FAILED', 'Control runtime identity is invalid.',
      { httpStatus: 503 });
      const crm = createCrmControlClient(config, {
        readAuthorization: createAuthorizationProvider(app,
          config.crmReadConnectionLinkName, /^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/,
          config.platformTimeoutMs),
        writeAuthorization: createAuthorizationProvider(app,
          config.crmWriteConnectionLinkName, /^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/,
          config.platformTimeoutMs),
        fetchImpl,
      });
      const provider = createRetellRouteProvider(config, {
        authorization: config.retellRouteMode === 'isolated_test'
          ? createAuthorizationProvider(app, config.retellConnectionLinkName,
            /^Bearer [A-Za-z0-9._-]{16,4096}$/, config.platformTimeoutMs)
          : undefined,
        fetchImpl, now,
      });
      const service = createRouteControlService({
        config, store: createCatalystStore(app, config), crm, provider, now,
      });
      const result = await service[action](body);
      const state = result.deployment.TEST_STATUS;
      send(response, 200, {
        ok: true, action, state, replayed: result.replayed,
        approved: result.deployment.GO_LIVE_APPROVAL_STATUS === 'Approved',
        active: state === 'Live', stopped: state === 'Stopped',
        configurationVersionId: result.deployment.APPROVED_CONFIGURATION_VERSION_ID
          || result.deployment.ACTIVE_CONFIGURATION_VERSION_ID,
        rollbackStatus: result.route?.status || null,
        rollbackInstructions: result.route?.instructions || null,
      });
    } catch (error) {
      const status = error instanceof RevenueDeskError ? error.httpStatus : 500;
      const code = publicCode(error);
      let details = {};
      if (code === 'rollback_manual_required' && error?.safeDetails) {
        details = {
          contained: error.safeDetails.contained === true,
          stopped: false,
          rollbackStatus: error.safeDetails.rollbackStatus,
          rollbackInstructions: error.safeDetails.rollbackInstructions,
          failureCode: error.safeDetails.failureCode,
        };
      } else if (code === 'crm_manual_close_required' && error?.safeDetails) {
        details = {
          contained: true,
          stopped: true,
          rollbackStatus: error.safeDetails.rollbackStatus,
          transitionName: error.safeDetails.transitionName,
          requiredOperatorField: error.safeDetails.requiredOperatorField,
        };
      }
      send(response, status, { ok: false, code, ...details });
    }
  };
}

module.exports = Object.freeze({ authenticate, createRequestListener, publicCode, readBody });
