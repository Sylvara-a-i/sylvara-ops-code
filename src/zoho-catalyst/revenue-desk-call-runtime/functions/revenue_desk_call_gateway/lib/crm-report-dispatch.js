'use strict';

const { RevenueDeskError, invariant } = require('./errors');

const RESPONSE_BYTES = 4096;
const ACTION = 'sync_report_summary';
const SCHEMA_VERSION = 'crm-billing-lifecycle-v2';

async function oauthAuthorization(app, connectionLinkName) {
  let credentials;
  try {
    credentials = await app.connections().getConnectionCredentials(connectionLinkName);
  } catch (_) {
    // SDK errors can carry request credentials. Do not retain the provider cause.
    throw new RevenueDeskError('CRM_REPORT_DISPATCH_UNAVAILABLE',
      'CRM report Connection is unavailable.', { httpStatus: 503, retryable: true });
  }
  const headers = credentials?.headers;
  const parameters = credentials?.parameters;
  invariant(headers && typeof headers === 'object' && !Array.isArray(headers)
    && parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    && Object.keys(parameters).length === 0 && Object.keys(headers).length === 1,
  'INVALID_RUNTIME_CONFIGURATION', 'CRM report Connection shape is invalid.', { httpStatus: 503 });
  const [[name, value]] = Object.entries(headers);
  invariant(name.toLowerCase() === 'authorization' && typeof value === 'string'
    && /^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/.test(value),
  'INVALID_RUNTIME_CONFIGURATION', 'CRM report OAuth authorization is invalid.', { httpStatus: 503 });
  return value;
}

async function readBoundedBody(response) {
  const contentType = String(response.headers?.get?.('content-type') ?? '')
    .split(';', 1)[0].trim().toLowerCase();
  invariant(contentType === 'application/json' && response.body
    && typeof response.body.getReader === 'function',
  'CRM_REPORT_DISPATCH_INVALID', 'CRM report dispatch response type is invalid.',
  { httpStatus: 503, ambiguous: true });
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RESPONSE_BYTES) {
        await reader.cancel();
        throw new RevenueDeskError(
          'CRM_REPORT_DISPATCH_INVALID', 'CRM report dispatch response is oversized.',
          { httpStatus: 503, ambiguous: true },
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes).toString('utf8');
}

function createCrmReportDispatcher(config, fetchImpl = globalThis.fetch, app = null) {
  invariant(config.environment === 'development' && typeof fetchImpl === 'function',
    'INVALID_RUNTIME_CONFIGURATION', 'CRM report dispatcher is unavailable.', { httpStatus: 503 });
  const authMode = config.crmBillingAuthMode ?? 'api_key';
  invariant(authMode === 'api_key' || authMode === 'oauth',
    'INVALID_RUNTIME_CONFIGURATION', 'CRM report authentication mode is invalid.', { httpStatus: 503 });
  if (authMode === 'oauth') {
    invariant(app && typeof app.connections === 'function'
      && typeof config.crmBillingConnectionLinkName === 'string'
      && /^[a-z][a-z0-9_]{0,49}$/.test(config.crmBillingConnectionLinkName)
      && config.crmBillingApiGatewayKey == null,
    'INVALID_RUNTIME_CONFIGURATION', 'CRM report OAuth binding is unavailable.', { httpStatus: 503 });
  }

  async function dispatch(dealId, operationKey) {
    invariant(/^[1-9][0-9]{7,29}$/.test(String(dealId ?? '')),
      'REPORT_DATA_INVALID', 'CRM report dispatch Deal binding is invalid.');
    invariant(/^[a-f0-9]{64}$/.test(String(operationKey ?? '')),
      'REPORT_DATA_INVALID', 'CRM report dispatch operation binding is invalid.');
    const controller = new AbortController();
    let requestStarted = false;
    let rejectTimeout;
    const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
    const timer = setTimeout(() => {
      controller.abort();
      rejectTimeout(new RevenueDeskError(
        'CRM_REPORT_DISPATCH_UNAVAILABLE', 'CRM report dispatch timed out.',
        { httpStatus: 503, retryable: true, ambiguous: requestStarted },
      ));
    }, config.crmBillingDispatchTimeoutMs);
    let response;
    let raw;
    try {
      // The same finite deadline covers managed credential acquisition and the
      // report request. A late credential response cannot start a timed-out POST.
      const authentication = authMode === 'oauth'
        ? { Authorization: await Promise.race([
          oauthAuthorization(app, config.crmBillingConnectionLinkName), timeout,
        ]), 'ZC-OAUTH-USER': 'ADMIN' }
        : { ZCFKEY: config.crmBillingApiGatewayKey };
      requestStarted = true;
      response = await Promise.race([fetchImpl(config.crmBillingOrchestratorUrl, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...authentication,
          [config.crmBillingSharedHeaderName]: config.crmBillingSharedHeaderValue,
        },
        body: JSON.stringify({
          schemaVersion: SCHEMA_VERSION, action: ACTION, dealId, operationKey,
        }),
      }), timeout]);
      const declared = Number(response.headers?.get?.('content-length'));
      invariant(!Number.isFinite(declared) || declared <= RESPONSE_BYTES,
        'CRM_REPORT_DISPATCH_INVALID', 'CRM report dispatch response is oversized.',
        { httpStatus: 503, ambiguous: true });
      raw = await Promise.race([readBoundedBody(response), timeout]);
    } catch (error) {
      if (error instanceof RevenueDeskError) throw error;
      throw new RevenueDeskError(
        'CRM_REPORT_DISPATCH_UNAVAILABLE', 'CRM report dispatch outcome is unavailable.',
        { httpStatus: 503, retryable: true, ambiguous: requestStarted },
      );
    } finally {
      clearTimeout(timer);
    }
    let body;
    try { body = JSON.parse(raw); } catch (_) { body = null; }
    invariant(response.status === 200 && body?.ok === true && body.action === ACTION
      && body.outcome === 'report_summary_readback_confirmed'
      && typeof body.duplicate === 'boolean',
    'CRM_REPORT_DISPATCH_INVALID', 'CRM report dispatch lacks authoritative readback.',
    { httpStatus: 503, ambiguous: true });
    return Object.freeze({ status: 'Dispatched', duplicate: body.duplicate });
  }

  return Object.freeze({ dispatch });
}

module.exports = { ACTION, SCHEMA_VERSION, createCrmReportDispatcher, readBoundedBody };
