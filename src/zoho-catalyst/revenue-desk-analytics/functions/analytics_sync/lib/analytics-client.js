'use strict';

const { AnalyticsSyncError, invariant } = require('./errors');
const { withTimeout } = require('./connection-boundary');

const JOB_ID_PATTERN = /^\d{3,30}$/;
const READBACK_COLUMNS = Object.freeze([
  'RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT',
  'PAYLOAD_HASH', 'SOURCE_MODIFIED_AT',
]);
const REPORT_SCOPE_KEYS = Object.freeze([
  'CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION', 'ENGAGEMENT_TYPE',
  'ENVIRONMENT', 'SOURCE_REVISION',
]);

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function completePartitionRows(payload, scope) {
  // Reject pagination/truncation envelopes instead of silently discarding their
  // markers. These are the same row shapes accepted by the existing readback.
  const rows = Array.isArray(payload) ? payload
    : exactKeys(payload, ['data']) && Array.isArray(payload.data) ? payload.data
      : exactKeys(payload, ['data']) && exactKeys(payload.data, ['rows'])
        && Array.isArray(payload.data.rows) ? payload.data.rows : null;
  invariant(rows && rows.length < 100, 'ANALYTICS_RESPONSE_INVALID',
    'Analytics complete partition is missing or exceeds the report bound.');
  const normalized = normalizeReadback(rows);
  const keys = new Set();
  for (const row of normalized) {
    invariant(['CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT'].every((key) => row[key] === scope[key])
      && /^[a-f0-9]{64}$/.test(row.RECORD_KEY) && /^[a-f0-9]{64}$/.test(row.PAYLOAD_HASH)
      && Number.isFinite(Date.parse(row.SOURCE_MODIFIED_AT))
      && new Date(row.SOURCE_MODIFIED_AT).toISOString() === row.SOURCE_MODIFIED_AT
      && !keys.has(row.RECORD_KEY), 'ANALYTICS_RESPONSE_INVALID',
    'Analytics complete partition contains invalid or conflicting rows.');
    keys.add(row.RECORD_KEY);
  }
  return Object.freeze(normalized);
}

function safeInteger(value, field) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  invariant(Number.isSafeInteger(parsed) && parsed >= 0, 'ANALYTICS_RESPONSE_INVALID',
    `Zoho Analytics ${field} is invalid.`, { ambiguous: true });
  return parsed;
}

function responseData(payload) {
  invariant(payload && typeof payload === 'object' && !Array.isArray(payload)
    && payload.status === 'success' && payload.data && typeof payload.data === 'object',
  'ANALYTICS_RESPONSE_INVALID', 'Zoho Analytics response is incomplete.', { ambiguous: true });
  return payload.data;
}

function parseJobId(payload) {
  const value = String(responseData(payload).jobId || '');
  invariant(JOB_ID_PATTERN.test(value), 'ANALYTICS_RESPONSE_INVALID',
    'Zoho Analytics response lacks a valid Job ID.', { ambiguous: true });
  return value;
}

function parseJobCode(payload) {
  const data = responseData(payload);
  const code = String(data.jobCode || '');
  invariant(new Set(['1001', '1002', '1003', '1004', '1005']).has(code),
    'ANALYTICS_RESPONSE_INVALID', 'Zoho Analytics returned an unknown Job code.', { ambiguous: true });
  return { data, code };
}

function quoteSqlIdentifier(value) {
  invariant(/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value), 'ANALYTICS_TARGET_INVALID',
    'Analytics table or column identifier is invalid.');
  return `"${value}"`;
}

function quoteSqlValue(value) {
  invariant(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value),
    'ANALYTICS_TARGET_INVALID', 'Analytics readback key is invalid.');
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeReadback(payload) {
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.data?.rows) ? payload.data.rows : null;
  invariant(rows && rows.length <= 100, 'ANALYTICS_RESPONSE_INVALID',
    'Zoho Analytics readback rows are invalid.', { ambiguous: true });
  return rows.map((row) => {
    invariant(row && typeof row === 'object' && !Array.isArray(row)
      && Object.keys(row).every((key) => READBACK_COLUMNS.includes(key)),
    'ANALYTICS_RESPONSE_INVALID', 'Zoho Analytics readback contains unapproved columns.',
    { ambiguous: true });
    const normalized = {};
    for (const column of READBACK_COLUMNS) {
      invariant(typeof row[column] === 'string', 'ANALYTICS_RESPONSE_INVALID',
        'Zoho Analytics readback row is incomplete.', { ambiguous: true });
      normalized[column] = row[column];
    }
    return Object.freeze(normalized);
  });
}

function validateTargetBinding(payload, provider, target) {
  const view = responseData(payload).views;
  invariant(view && typeof view === 'object' && !Array.isArray(view)
    && typeof view.viewId === 'string'
    && typeof view.viewName === 'string'
    && typeof view.viewType === 'string'
    && typeof view.workspaceId === 'string'
    && typeof view.orgId === 'string',
  'ANALYTICS_TARGET_BINDING_INVALID',
  'Zoho Analytics target metadata is incomplete.');
  invariant(view.viewId === target.viewId
    && view.viewName === target.table
    && view.viewType === 'Table'
    && view.workspaceId === provider.workspaceId
    && view.orgId === provider.organizationId,
  'ANALYTICS_TARGET_BINDING_MISMATCH',
  'Zoho Analytics target metadata does not match the fixed import binding.');
  return Object.freeze({
    viewId: view.viewId,
    viewName: view.viewName,
    viewType: view.viewType,
    workspaceId: view.workspaceId,
    orgId: view.orgId,
  });
}

function createAnalyticsClient(options) {
  const {
    config,
    readAuthorizationProvider,
    writeAuthorizationProvider,
    fetchImpl = globalThis.fetch,
    now = Date.now,
  } = options;
  invariant(config?.provider && typeof fetchImpl === 'function'
    && typeof readAuthorizationProvider === 'function'
    && typeof writeAuthorizationProvider === 'function', 'ANALYTICS_CONFIGURATION_INVALID',
  'Zoho Analytics client dependencies are unavailable.');
  const provider = config.provider;

  // Separate from the established async batch protocol: this read must cover
  // the whole small report partition, including unknown keys and zero rows.
  // No known-key filter, LIMIT, pagination, or import is permitted here.
  async function readCompleteScope(scope, recordType, options = {}) {
    invariant(exactKeys(scope, REPORT_SCOPE_KEYS)
      && ['CLIENT_KEY', 'DEPLOYMENT_KEY'].every((key) => typeof scope[key] === 'string'
        && /^[a-f0-9]{64}$/.test(scope[key]))
      && typeof scope.CONFIGURATION_VERSION === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(scope.CONFIGURATION_VERSION)
      && scope.ENGAGEMENT_TYPE === 'free_test' && scope.ENVIRONMENT === 'development'
      && config.environment === scope.ENVIRONMENT
      && /^[a-f0-9]{40}$/.test(scope.SOURCE_REVISION)
      && scope.SOURCE_REVISION === config.sourceRevision
      && ['deployment', 'call', 'final_test_result'].includes(recordType)
      && typeof now === 'function', 'ANALYTICS_SCOPE_INVALID',
    'Analytics complete-partition scope is invalid.');
    invariant(options && typeof options === 'object' && !Array.isArray(options)
      && Object.keys(options).every((key) => key === 'signal')
      && (options.signal === undefined || options.signal instanceof AbortSignal),
    'ANALYTICS_SCOPE_INVALID', 'Analytics complete-partition cancellation is invalid.');
    const parentSignal = options.signal;
    const snapshot = Object.freeze({ ...scope });
    const target = provider.targets[recordType];
    invariant(target && Number.isSafeInteger(config.analyticsTimeoutMs) && config.analyticsTimeoutMs > 0
      && Number.isSafeInteger(config.responseMaxBytes) && config.responseMaxBytes > 0,
    'ANALYTICS_CONFIGURATION_INVALID', 'Analytics complete-partition configuration is invalid.');
    const controller = new AbortController();
    let timeout;
    const timedOut = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new AnalyticsSyncError('ANALYTICS_TIMEOUT',
          'Analytics complete-partition read timed out.', { retryable: true }));
      }, config.analyticsTimeoutMs);
    });
    let cancelParent;
    const cancelled = new Promise((resolve, reject) => {
      cancelParent = () => {
        controller.abort();
        reject(new AnalyticsSyncError('ANALYTICS_ABORTED',
          'Analytics complete-partition read was cancelled.', { retryable: true }));
      };
      parentSignal?.addEventListener('abort', cancelParent, { once: true });
      if (parentSignal?.aborted) cancelParent();
    });
    async function readJson(url) {
      controller.signal.throwIfAborted();
      const authorization = await readAuthorizationProvider();
      controller.signal.throwIfAborted();
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error',
        signal: controller.signal, headers: { Authorization: authorization,
          'ZANALYTICS-ORGID': provider.organizationId } });
      controller.signal.throwIfAborted();
      invariant(response?.status === 200, 'ANALYTICS_HTTP_ERROR',
        'Analytics complete-partition read did not return a complete response.',
        { retryable: response?.status === 408 || response?.status === 429 || response?.status >= 500 });
      invariant(/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type') || '')
        && !response.headers?.get('content-range') && response.body?.getReader,
      'ANALYTICS_RESPONSE_INVALID', 'Analytics complete-partition response is incomplete.');
      const length = response.headers.get('content-length');
      invariant(length === null || (/^\d+$/.test(length) && Number(length) <= config.responseMaxBytes),
        'ANALYTICS_RESPONSE_TOO_LARGE', 'Analytics complete-partition response exceeds the approved size.');
      const reader = response.body.getReader();
      const cancel = () => { reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      const chunks = [];
      let size = 0;
      let complete = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) break;
          size += value.byteLength;
          invariant(size <= config.responseMaxBytes, 'ANALYTICS_RESPONSE_TOO_LARGE',
            'Analytics complete-partition response exceeds the approved size.');
          chunks.push(Buffer.from(value));
        }
        const payload = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
        complete = true;
        return payload;
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        if (!complete) cancel();
      }
    }
    try {
      return await Promise.race([timedOut, cancelled, (async () => {
        validateTargetBinding(await readJson(`${provider.apiBaseUrl}/restapi/v2/views/${target.viewId}`),
          provider, target);
        const table = quoteSqlIdentifier(target.table);
        const criteria = ['ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY'].map((key) =>
          `${table}.${quoteSqlIdentifier(key)} = ${quoteSqlValue(snapshot[key])}`).join(' AND ');
        const exportConfig = { responseFormat: 'json', criteria,
          selectedColumns: [...READBACK_COLUMNS], keyValueFormat: true,
          showHiddenCols: false, showPersonalCols: false };
        const url = `${provider.apiBaseUrl}/restapi/v2/workspaces/${provider.workspaceId}`
          + `/views/${target.viewId}/data?CONFIG=${encodeURIComponent(JSON.stringify(exportConfig))}`;
        const rows = completePartitionRows(await readJson(url), snapshot);
        const observedAt = now();
        invariant(Number.isSafeInteger(observedAt) && observedAt >= 0,
          'ANALYTICS_RESPONSE_INVALID', 'Analytics observation time is invalid.');
        return Object.freeze({ scope: snapshot, recordType, rows, complete: true,
          bindingVerified: true, observedAt: new Date(observedAt).toISOString() });
      })()]);
    } catch (error) {
      if (error instanceof AnalyticsSyncError) throw error;
      throw new AnalyticsSyncError('ANALYTICS_RESPONSE_INVALID',
        'Analytics complete-partition read failed.', { retryable: true });
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', cancelParent);
      controller.abort();
    }
  }

  async function request(url, init, authorizationProvider, semantics) {
    const authorization = await authorizationProvider();
    const headers = {
      ...(init.headers || {}),
      Authorization: authorization,
      'ZANALYTICS-ORGID': provider.organizationId,
    };
    let response;
    try {
      response = await withTimeout(
        () => fetchImpl(url, { ...init, headers }), config.analyticsTimeoutMs,
        {
          code: 'ANALYTICS_TIMEOUT',
          retryable: semantics !== 'write',
          ambiguous: semantics === 'write',
        },
      );
    } catch (error) {
      if (error instanceof AnalyticsSyncError) throw error;
      throw new AnalyticsSyncError('ANALYTICS_NETWORK_ERROR',
        'Zoho Analytics request failed.', {
          cause: error,
          retryable: semantics !== 'write',
          ambiguous: semantics === 'write',
        });
    }
    invariant(response && typeof response.status === 'number', 'ANALYTICS_RESPONSE_INVALID',
      'Zoho Analytics response is unavailable.', { ambiguous: semantics === 'write' });
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new AnalyticsSyncError('ANALYTICS_HTTP_ERROR',
        'Zoho Analytics rejected the bounded request.', {
          retryable: semantics !== 'write' && retryable,
          ambiguous: semantics === 'write' && retryable,
        });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    invariant(buffer.length <= config.responseMaxBytes, 'ANALYTICS_RESPONSE_TOO_LARGE',
      'Zoho Analytics response exceeds the approved size.', { ambiguous: semantics === 'write' });
    if (semantics === 'download') {
      try {
        return JSON.parse(buffer.toString('utf8'));
      } catch {
        invariant(false, 'ANALYTICS_RESPONSE_INVALID',
          'Zoho Analytics readback is not valid JSON.', { ambiguous: true });
      }
    }
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch {
      invariant(false, 'ANALYTICS_RESPONSE_INVALID',
        'Zoho Analytics response is not valid JSON.', { ambiguous: semantics === 'write' });
    }
  }

  async function submitBatch(recordType, rows) {
    const target = provider.targets[recordType];
    invariant(target && Array.isArray(rows) && rows.length >= 1 && rows.length <= config.maxBatchSize,
      'ANALYTICS_BATCH_INVALID', 'Analytics import batch is invalid.');
    const payload = JSON.stringify(rows);
    invariant(Buffer.byteLength(payload, 'utf8') <= 1_000_000,
      'ANALYTICS_BATCH_INVALID', 'Analytics import payload exceeds the package bound.');
    // Never cache this binding. A fresh read-only metadata call immediately before
    // each POST prevents a renamed table or swapped private view ID from receiving data.
    const metadataUrl = `${provider.apiBaseUrl}/restapi/v2/views/${target.viewId}`;
    validateTargetBinding(await request(metadataUrl, { method: 'GET' },
      readAuthorizationProvider, 'read'), provider, target);
    const form = new FormData();
    form.append('FILE', new Blob([payload], { type: 'application/json' }), 'revenue-desk-facts.json');
    const importConfig = {
      importType: 'updateadd',
      fileType: 'json',
      autoIdentify: false,
      onError: 'abort',
      matchingColumns: ['RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT'],
      retainColumnNames: true,
    };
    const url = `${provider.apiBaseUrl}/restapi/v2/bulk/workspaces/${provider.workspaceId}`
      + `/views/${target.viewId}/data?CONFIG=${encodeURIComponent(JSON.stringify(importConfig))}`;
    return { jobId: parseJobId(await request(url, { method: 'POST', body: form },
      writeAuthorizationProvider, 'write')) };
  }

  async function pollImport(jobId) {
    invariant(JOB_ID_PATTERN.test(String(jobId)), 'ANALYTICS_JOB_INVALID',
      'Analytics import Job ID is invalid.');
    const url = `${provider.apiBaseUrl}/restapi/v2/bulk/workspaces/${provider.workspaceId}`
      + `/importjobs/${jobId}`;
    const { data, code } = parseJobCode(await request(url, { method: 'GET' },
      writeAuthorizationProvider, 'read'));
    if (code === '1001' || code === '1002') return Object.freeze({ state: 'pending' });
    if (code === '1005') return Object.freeze({ state: 'missing' });
    if (code === '1003') return Object.freeze({ state: 'failed' });
    const summary = data.jobInfo?.importSummary;
    invariant(summary && typeof summary === 'object', 'ANALYTICS_RESPONSE_INVALID',
      'Analytics import summary is missing.', { ambiguous: true });
    const totalRows = safeInteger(summary.totalRowCount, 'total row count');
    const acceptedRows = safeInteger(summary.successRowCount, 'success row count');
    invariant(acceptedRows <= totalRows, 'ANALYTICS_RESPONSE_INVALID',
      'Analytics import summary counts conflict.', { ambiguous: true });
    return Object.freeze({
      state: 'complete',
      totalRows,
      acceptedRows,
      rejectedRows: totalRows - acceptedRows,
    });
  }

  async function startReadback(recordType, rows) {
    const target = provider.targets[recordType];
    invariant(target && Array.isArray(rows) && rows.length >= 1 && rows.length <= config.maxBatchSize,
      'ANALYTICS_BATCH_INVALID', 'Analytics readback batch is invalid.');
    const recordKeys = rows.map((row) => quoteSqlValue(row.RECORD_KEY)).sort().join(',');
    const columns = READBACK_COLUMNS.map(quoteSqlIdentifier).join(',');
    const sqlQuery = `SELECT ${columns} FROM ${quoteSqlIdentifier(target.table)}`
      + ` WHERE ${quoteSqlIdentifier('ENVIRONMENT')} = ${quoteSqlValue(config.environment)}`
      + ` AND ${quoteSqlIdentifier('CLIENT_KEY')} = ${quoteSqlValue(rows[0].CLIENT_KEY)}`
      + ` AND ${quoteSqlIdentifier('DEPLOYMENT_KEY')} = ${quoteSqlValue(rows[0].DEPLOYMENT_KEY)}`
      + ` AND ${quoteSqlIdentifier('RECORD_KEY')} IN (${recordKeys})`;
    invariant(Buffer.byteLength(sqlQuery, 'utf8') <= 12000,
      'ANALYTICS_BATCH_INVALID', 'Analytics readback query exceeds the package bound.');
    const exportConfig = { sqlQuery, responseFormat: 'json', showPersonalCols: false };
    const url = `${provider.apiBaseUrl}/restapi/v2/bulk/workspaces/${provider.workspaceId}`
      + `/data?CONFIG=${encodeURIComponent(JSON.stringify(exportConfig))}`;
    return { jobId: parseJobId(await request(url, { method: 'GET' },
      readAuthorizationProvider, 'read')) };
  }

  async function pollReadback(jobId) {
    invariant(JOB_ID_PATTERN.test(String(jobId)), 'ANALYTICS_JOB_INVALID',
      'Analytics readback Job ID is invalid.');
    const base = `${provider.apiBaseUrl}/restapi/v2/bulk/workspaces/${provider.workspaceId}`
      + `/exportjobs/${jobId}`;
    const { code } = parseJobCode(await request(base, { method: 'GET' },
      readAuthorizationProvider, 'read'));
    if (code === '1001' || code === '1002') return Object.freeze({ state: 'pending' });
    if (code === '1005') return Object.freeze({ state: 'missing' });
    if (code === '1003') return Object.freeze({ state: 'failed' });
    const payload = await request(`${base}/data`, { method: 'GET' },
      readAuthorizationProvider, 'download');
    return Object.freeze({ state: 'complete', rows: Object.freeze(normalizeReadback(payload)) });
  }

  return Object.freeze({ submitBatch, pollImport, startReadback, pollReadback, readCompleteScope });
}

module.exports = {
  createAnalyticsClient, normalizeReadback, parseJobCode, quoteSqlIdentifier, quoteSqlValue,
  validateTargetBinding,
};
