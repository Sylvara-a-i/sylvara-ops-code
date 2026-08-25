'use strict';

const { RevenueDeskError, invariant } = require('./errors');

const RESPONSE_BYTES = 4096;
const ACTION = 'sync_report_summary';
const SCHEMA_VERSION = 'crm-billing-lifecycle-v2';

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

function createCrmReportDispatcher(config, fetchImpl = globalThis.fetch) {
  invariant(config.environment === 'development' && typeof fetchImpl === 'function',
    'INVALID_RUNTIME_CONFIGURATION', 'CRM report dispatcher is unavailable.', { httpStatus: 503 });

  async function dispatch(dealId, operationKey) {
    invariant(/^[1-9][0-9]{7,29}$/.test(String(dealId ?? '')),
      'REPORT_DATA_INVALID', 'CRM report dispatch Deal binding is invalid.');
    invariant(/^[a-f0-9]{64}$/.test(String(operationKey ?? '')),
      'REPORT_DATA_INVALID', 'CRM report dispatch operation binding is invalid.');
    const controller = new AbortController();
    let rejectTimeout;
    const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
    const timer = setTimeout(() => {
      controller.abort();
      rejectTimeout(new RevenueDeskError(
        'CRM_REPORT_DISPATCH_UNAVAILABLE', 'CRM report dispatch timed out.',
        { httpStatus: 503, retryable: true, ambiguous: true },
      ));
    }, config.crmBillingDispatchTimeoutMs);
    let response;
    let raw;
    try {
      response = await Promise.race([fetchImpl(config.crmBillingOrchestratorUrl, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ZCFKEY: config.crmBillingApiGatewayKey,
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
        { cause: error, httpStatus: 503, retryable: true, ambiguous: true },
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
