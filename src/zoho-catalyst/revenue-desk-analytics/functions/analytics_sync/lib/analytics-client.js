'use strict';

const { AnalyticsSyncError, invariant } = require('./errors');
const { withTimeout } = require('./connection-boundary');

const JOB_ID_PATTERN = /^\d{3,30}$/;
const READBACK_COLUMNS = Object.freeze([
  'RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT',
  'PAYLOAD_HASH', 'SOURCE_MODIFIED_AT',
]);

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
  } = options;
  invariant(config?.provider && typeof fetchImpl === 'function'
    && typeof readAuthorizationProvider === 'function'
    && typeof writeAuthorizationProvider === 'function', 'ANALYTICS_CONFIGURATION_INVALID',
  'Zoho Analytics client dependencies are unavailable.');
  const provider = config.provider;

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

  return Object.freeze({ submitBatch, pollImport, startReadback, pollReadback });
}

module.exports = {
  createAnalyticsClient, normalizeReadback, parseJobCode, quoteSqlIdentifier, quoteSqlValue,
  validateTargetBinding,
};
