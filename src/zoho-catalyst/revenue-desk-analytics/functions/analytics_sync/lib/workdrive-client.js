'use strict';

const { AnalyticsSyncError, invariant } = require('./errors');
const { isReportAttemptBudget } = require('./report-attempt-budget');

const API_ORIGIN = 'https://www.zohoapis.com';
const DOWNLOAD_ORIGIN = 'https://download.zoho.com';
const PAGE_SIZE = 50;
const MAX_CHILDREN = 200;
const MAX_VERSIONS = 100;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const JSON_TYPE = /^application\/(?:json|vnd\.api\+json)(?:\s*;|$)/i;
const DOWNLOAD_TYPE = /^(?:application\/(?:octet-stream|pdf)|text\/html)(?:\s*;|$)/i;
const plain = (value) => value && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const requireResponse = (condition) => invariant(condition, 'WORKDRIVE_RESPONSE_INVALID',
  'WorkDrive response requires reconciliation.');
const validId = (value) => typeof value === 'string' && ID.test(value);
const validName = (value) => typeof value === 'string' && value.length > 0 && value.length <= 255
  && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);

function metadata(row, { expectedId, parentId, listing = false } = {}) {
  const a = row?.attributes;
  requireResponse(plain(row) && row.type === 'files' && validId(row.id)
    && (!expectedId || row.id === expectedId) && plain(a) && validName(a.name)
    && validId(a.parent_id) && (!parentId || a.parent_id === parentId)
    && validId(a.library_id) && typeof a.is_folder === 'boolean'
    && Number.isSafeInteger(a.storage_info?.size_in_bytes) && a.storage_info.size_in_bytes >= 0
    && (validId(a.org_id) || (listing && !Object.hasOwn(a, 'org_id'))));
  // The documented children example omits org_id. Never infer it from a parent;
  // the writer must getMetadata for the exact candidate before checking ownership.
  return Object.freeze({ id: row.id, name: a.name, parentId: a.parent_id,
    organizationId: a.org_id ?? null, teamFolderId: a.library_id,
    isFolder: a.is_folder, sizeBytes: a.storage_info.size_in_bytes });
}

function version(row, resourceId) {
  const a = row?.attributes;
  requireResponse(plain(row) && row.type === 'versions' && plain(a)
    && a.resource_id === resourceId && validId(a.version_id)
    && typeof a.version_number === 'string' && VERSION.test(a.version_number)
    && Number.isSafeInteger(a.file_size) && a.file_size >= 0);
  // size_in_bytes is human-formatted in this endpoint's example, not a byte count.
  return Object.freeze({ resourceId, versionId: a.version_id,
    versionNumber: a.version_number, sizeBytes: a.file_size });
}

function parseJson(bytes) {
  // Node 24 supplies the original number lexeme. WorkDrive's numeric version IDs
  // can exceed MAX_SAFE_INTEGER; do not round them through a JavaScript Number.
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes), (key, value, context) => {
    if (['version_id', 'version_number'].includes(key) && typeof value === 'number') {
      requireResponse(typeof context?.source === 'string'
        && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(context.source));
      return context.source;
    }
    return value;
  });
}

/** Bounded transport only; construction does not install a writer or approve a
 * destination. The documented US origin pair must be explicitly selected after
 * private DC qualification; other regions fail closed pending their own binding.
 * All methods require the caller's single branded reporting-attempt budget.
 *
 * Contracts reviewed 2026-09-29:
 * https://www.zoho.com/workdrive/developer/docs/api/v1/list-files-folders-inside-a-folder.html
 * https://www.zoho.com/workdrive/developer/docs/api/v1/get-file-folder-info.html
 * https://www.zoho.com/workdrive/developer/docs/api/v1/get-file-versions.html
 * https://www.zoho.com/workdrive/developer/docs/api/v1/download-file.html
 * https://www.zoho.com/workdrive/developer/docs/api/v1/upload-file.html
 */
function createWorkDriveClient({ authorizationProvider, fetchImpl = globalThis.fetch,
  apiOrigin, downloadOrigin, timeoutMs, now = Date.now } = {}) {
  invariant(typeof authorizationProvider === 'function' && typeof fetchImpl === 'function'
    && apiOrigin === API_ORIGIN && downloadOrigin === DOWNLOAD_ORIGIN
    && Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 120_000
    && typeof now === 'function', 'WORKDRIVE_CONFIGURATION_INVALID',
  'WorkDrive transport binding is invalid.');

  async function operation(options, upload, work) {
    invariant(plain(options) && Object.keys(options).every((key) => ['signal', 'budget'].includes(key))
      && (options.signal === undefined || options.signal instanceof AbortSignal)
      && isReportAttemptBudget(options.budget), 'WORKDRIVE_OPTIONS_INVALID',
    'WorkDrive requires the trusted reporting attempt.');
    const budget = options.budget;
    const startedAt = now();
    invariant(Number.isSafeInteger(startedAt) && startedAt >= 0,
      'WORKDRIVE_CLOCK_INVALID', 'WorkDrive operation time is invalid.');
    const controller = new AbortController();
    let dispatched = false;
    let abortCode = null;
    let rejectCancellation;
    const cancelled = new Promise((resolve, reject) => { rejectCancellation = reject; });
    const abort = (code) => {
      if (abortCode) return;
      abortCode = code;
      controller.abort();
      rejectCancellation(new AnalyticsSyncError(code, 'WorkDrive operation did not complete.'));
    };
    const parentAbort = () => abort('WORKDRIVE_ABORTED');
    const budgetAbort = () => {
      // Budget exhaustion aborts synchronously before consume throws. Preserve
      // that bounded reason when cancellation wins the surrounding promise race.
      let code = 'REPORT_ATTEMPT_ABORTED';
      try { budget.assertActive(); } catch (error) {
        if (error instanceof AnalyticsSyncError && /^REPORT_/.test(error.code)) code = error.code;
      }
      abort(code);
    };
    const parents = [[budget.signal, budgetAbort]];
    if (options.signal && options.signal !== budget.signal) parents.push([options.signal, parentAbort]);
    for (const [signal, listener] of parents) {
      signal.addEventListener('abort', listener, { once: true });
      if (signal.aborted) listener();
    }
    const timer = setTimeout(() => abort('WORKDRIVE_TIMEOUT'), timeoutMs);
    function assertActive() {
      budget.assertActive();
      const at = now();
      if (!Number.isSafeInteger(at) || at < startedAt || at - startedAt >= timeoutMs) {
        abort('WORKDRIVE_TIMEOUT');
      }
      if (controller.signal.aborted) throw new AnalyticsSyncError(
        abortCode || 'WORKDRIVE_ABORTED', 'WorkDrive operation did not complete.');
    }

    async function request(url, { method = 'GET', body, binary = false } = {}) {
      assertActive();
      const authorization = await authorizationProvider(Object.freeze({ signal: controller.signal }));
      assertActive();
      invariant(typeof authorization === 'string'
        && /^Zoho-oauthtoken [\x21-\x7e]{1,2048}$/.test(authorization),
      'WORKDRIVE_AUTHORIZATION_INVALID', 'WorkDrive authorization is unavailable.');
      budget.consume(method === 'POST' ? 'workdrive_write' : 'workdrive_read');
      assertActive();
      dispatched = true;
      const response = await fetchImpl(url, { method, redirect: 'error', signal: controller.signal,
        headers: { Authorization: authorization, Accept: binary ? 'application/octet-stream' : 'application/vnd.api+json',
          'Accept-Encoding': 'identity' }, ...(body ? { body } : {}) });
      assertActive();
      invariant(response?.status === 200, 'WORKDRIVE_HTTP_ERROR',
        'WorkDrive request did not return the required response.');
      const maximum = binary ? MAX_DOCUMENT_BYTES : MAX_JSON_BYTES;
      const headers = response.headers;
      requireResponse((binary ? DOWNLOAD_TYPE : JSON_TYPE).test(headers?.get('content-type') || '')
        && !headers?.get('content-range')
        && (!headers?.get('content-encoding') || headers.get('content-encoding') === 'identity')
        && typeof response.body?.getReader === 'function');
      const length = headers.get('content-length');
      requireResponse(length === null || (/^(0|[1-9][0-9]*)$/.test(length)
        && Number.isSafeInteger(Number(length)) && Number(length) <= maximum));
      const reader = response.body.getReader();
      const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} };
      controller.signal.addEventListener('abort', cancel, { once: true });
      let complete = false;
      let size = 0;
      const chunks = [];
      try {
        while (true) {
          assertActive();
          const chunk = await reader.read();
          assertActive();
          if (chunk.done) break;
          // Byte and fragment ceilings both bound memory; empty fragments are invalid.
          requireResponse(chunk.value instanceof Uint8Array && chunk.value.byteLength > 0 && chunks.length < 128);
          size += chunk.value.byteLength;
          requireResponse(size <= maximum);
          chunks.push(Buffer.from(chunk.value));
        }
        requireResponse(size > 0 && (length === null || size === Number(length)));
        const bytes = Buffer.concat(chunks, size);
        const value = binary ? bytes : parseJson(bytes);
        assertActive();
        complete = true;
        return value;
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        if (!complete) cancel();
      }
    }

    try {
      return await Promise.race([cancelled, Promise.resolve().then(() => work({ request, assertActive }))]);
    } catch (error) {
      const code = error instanceof AnalyticsSyncError && /^(?:WORKDRIVE_|REPORT_)/.test(error.code)
        ? error.code : 'WORKDRIVE_REQUEST_FAILED';
      // A timeout/abort after dispatch cannot undo an upload. Never expose the
      // provider body, resource ID, content, token, path or original cause.
      throw new AnalyticsSyncError(code, 'WorkDrive operation requires reconciliation.',
        { ambiguous: upload && dispatched, retryable: !upload });
    } finally {
      clearTimeout(timer);
      for (const [signal, listener] of parents) signal.removeEventListener('abort', listener);
      controller.abort();
    }
  }

  function resource(value) {
    invariant(validId(value), 'WORKDRIVE_INPUT_INVALID', 'WorkDrive resource input is invalid.');
    return value;
  }
  const apiPath = (id, suffix = '') => `${apiOrigin}/workdrive/api/v1/files/${resource(id)}${suffix}`;

  async function getMetadata(resourceId, options = {}) {
    const url = apiPath(resourceId);
    return operation(options, false, async ({ request }) => {
      const payload = await request(url);
      requireResponse(exact(payload, ['data']));
      return metadata(payload.data, { expectedId: resourceId });
    });
  }

  async function listChildren(parentId, options = {}) {
    const base = apiPath(parentId, '/files');
    return operation(options, false, async ({ request, assertActive }) => {
      const result = [];
      const ids = new Set();
      const cursors = new Set();
      let cursor = '0';
      for (let page = 0; page < MAX_CHILDREN / PAGE_SIZE; page += 1) {
        assertActive();
        requireResponse(!cursors.has(cursor));
        cursors.add(cursor);
        const url = new URL(base);
        url.searchParams.set('page[limit]', String(PAGE_SIZE));
        url.searchParams.set('page[next]', cursor);
        const payload = await request(url.href);
        requireResponse(exact(payload, ['data', 'links']) && Array.isArray(payload.data)
          && payload.data.length <= PAGE_SIZE && exact(payload.links, ['cursor'])
          && plain(payload.links.cursor)
          && Object.keys(payload.links.cursor).every((key) => ['has_next', 'next'].includes(key))
          && typeof payload.links.cursor.has_next === 'boolean');
        for (const row of payload.data) {
          const item = metadata(row, { parentId, listing: true });
          requireResponse(!ids.has(item.id));
          ids.add(item.id); result.push(item);
        }
        const next = payload.links.cursor;
        if (!next.has_next) {
          requireResponse(next.next === undefined || next.next === null || next.next === '');
          return Object.freeze(result);
        }
        requireResponse(payload.data.length > 0 && typeof next.next === 'string' && next.next.length <= 2048);
        const nextUrl = new URL(next.next);
        requireResponse(nextUrl.origin === apiOrigin && nextUrl.pathname === new URL(base).pathname
          && !nextUrl.username && !nextUrl.password && !nextUrl.hash
          && [...nextUrl.searchParams.keys()].every((key) => ['page[next]', 'page[limit]'].includes(key))
          && nextUrl.searchParams.getAll('page[next]').length === 1
          && nextUrl.searchParams.getAll('page[limit]').length <= 1
          && (!nextUrl.searchParams.has('page[limit]') || nextUrl.searchParams.get('page[limit]') === String(PAGE_SIZE)));
        cursor = nextUrl.searchParams.get('page[next]');
        requireResponse(typeof cursor === 'string' && /^[A-Za-z0-9_-]{1,1024}$/.test(cursor));
      }
      invariant(false, 'WORKDRIVE_LIST_INCOMPLETE', 'WorkDrive folder exceeds the complete-read bound.');
    });
  }

  async function listVersions(resourceId, options = {}) {
    const url = apiPath(resourceId, '/versions');
    return operation(options, false, async ({ request }) => {
      // This endpoint documents all versions and no paging parameter. An unknown
      // envelope/continuation fails; do not silently treat one page as complete.
      const payload = await request(url);
      requireResponse(exact(payload, ['data']) && Array.isArray(payload.data)
        && payload.data.length <= MAX_VERSIONS);
      const values = payload.data.map((row) => version(row, resourceId));
      requireResponse(new Set(values.map((v) => v.versionId)).size === values.length
        && new Set(values.map((v) => v.versionNumber)).size === values.length);
      return Object.freeze(values);
    });
  }

  async function downloadVersion(resourceId, selector, options = {}) {
    resource(resourceId);
    invariant(exact(selector, ['versionId', 'versionNumber']) && validId(selector.versionId)
      && typeof selector.versionNumber === 'string' && VERSION.test(selector.versionNumber),
    'WORKDRIVE_INPUT_INVALID', 'WorkDrive version selector is invalid.');
    const url = new URL(`${downloadOrigin}/v1/workdrive/download/${resourceId}`);
    // The official parameter is a version NUMBER. Its link to versionId must be
    // rechecked by the durable writer; live version semantics remain unqualified.
    url.searchParams.set('version', selector.versionNumber);
    return operation(options, false, ({ request }) => request(url.href, { binary: true }));
  }

  async function upload(input, options = {}) {
    invariant(exact(input, ['parentId', 'filename', 'bytes']) && validId(input.parentId)
      && validName(input.filename) && !/[\\/]/.test(input.filename)
      && !['.', '..'].includes(input.filename) && Buffer.isBuffer(input.bytes)
      && input.bytes.length > 0 && input.bytes.length <= MAX_DOCUMENT_BYTES,
    'WORKDRIVE_INPUT_INVALID', 'WorkDrive upload input is invalid.');
    const bytes = Buffer.from(input.bytes);
    const body = new FormData();
    body.append('parent_id', input.parentId);
    body.append('filename', encodeURIComponent(input.filename));
    body.append('override-name-exist', 'false');
    body.append('content', new Blob([bytes], { type: 'application/octet-stream' }), input.filename);
    return operation(options, true, async ({ request }) => {
      await request(`${apiOrigin}/workdrive/api/v1/upload`, { method: 'POST', body });
      // No qualified REST result shape or atomic filename guarantee exists here.
      // Even HTTP 200 demands an independent complete listing/metadata/byte join.
      return Object.freeze({ status: 'upload_response_received_reconciliation_required' });
    });
  }

  return Object.freeze({ getMetadata, listChildren, listVersions, downloadVersion, upload });
}

module.exports = { createWorkDriveClient, MAX_WORKDRIVE_CHILDREN: MAX_CHILDREN,
  MAX_WORKDRIVE_VERSIONS: MAX_VERSIONS, MAX_WORKDRIVE_DOCUMENT_BYTES: MAX_DOCUMENT_BYTES };
