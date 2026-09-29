'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { createWorkDriveClient, MAX_WORKDRIVE_DOCUMENT_BYTES } = require('../lib/workdrive-client');
const { createReportAttemptBudget, REPORT_ATTEMPT_MAXIMUMS } = require('../lib/report-attempt-budget');

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });
const API = 'https://www.zohoapis.com';
const DOWNLOAD = 'https://download.zoho.com';
const ROOT = 'synthetic_parent';
const FILE = 'synthetic_file';
const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value),
  { status, headers: { 'content-type': 'application/vnd.api+json', ...headers } });
const row = (id = FILE, attributes = {}) => ({ id, type: 'files', attributes: {
  name: 'synthetic-report.html', parent_id: ROOT, org_id: 'synthetic_organization',
  library_id: 'synthetic_team_folder', is_folder: false,
  storage_info: { size_in_bytes: 24 }, ...attributes,
}, relationships: { private: 'never exposed' } });
const version = (attributes = {}) => ({ id: 'synthetic_version_record', type: 'versions', attributes: {
  resource_id: FILE, version_id: 'synthetic_version_1', version_number: 1,
  file_size: 24, size_in_bytes: '24 bytes', ...attributes,
} });
const page = (rows, next = null) => ({ data: rows,
  links: { cursor: { has_next: next !== null, next } } });

function fixture(t, { respond = () => jsonResponse({ data: row() }), authorize,
  timeoutMs = 1000, now = Date.now, limits = REPORT_ATTEMPT_MAXIMUMS } = {}) {
  const calls = [];
  let authorizationCalls = 0;
  const budget = createReportAttemptBudget({ timeoutMs: 120_000, limits: { ...limits } });
  t.after(() => budget.close());
  const client = createWorkDriveClient({ apiOrigin: API, downloadOrigin: DOWNLOAD, timeoutMs, now,
    authorizationProvider: async (...args) => {
      authorizationCalls += 1;
      return authorize ? authorize(...args) : 'Zoho-oauthtoken synthetic-only';
    }, fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return respond(url, options, calls.length);
    },
  });
  return { client, budget, options: { budget }, calls, authorizations: () => authorizationCalls };
}

test('metadata is allowlisted and exact resource ownership is never inferred', async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.client.getMetadata(FILE, f.options), { id: FILE,
    name: 'synthetic-report.html', parentId: ROOT, organizationId: 'synthetic_organization',
    teamFolderId: 'synthetic_team_folder', isFolder: false, sizeBytes: 24 });
  assert.equal(f.calls[0].url, `${API}/workdrive/api/v1/files/${FILE}`);
  assert.equal(f.calls[0].options.method, 'GET');
  assert.equal(f.calls[0].options.redirect, 'error');
  assert.equal(f.calls[0].options.headers['Accept-Encoding'], 'identity');
  assert.equal(f.budget.snapshot().workdrive_read, 1);
});

test('unapproved origin, identifier, options or unbranded budget fails before authorization', async (t) => {
  for (const [apiOrigin, downloadOrigin] of [[`${API}/`, DOWNLOAD], [API, `${DOWNLOAD}/path`],
    ['https://www.zohoapis.com.evil.invalid', DOWNLOAD], [API, 'https://download-accl.zoho.com']]) {
    assert.throws(() => createWorkDriveClient({ apiOrigin, downloadOrigin, timeoutMs: 1000,
      authorizationProvider() {}, fetchImpl() {} }), { code: 'WORKDRIVE_CONFIGURATION_INVALID' });
  }
  const f = fixture(t);
  for (const id of ['../synthetic', 'synthetic?secret=value', '', 7]) {
    await assert.rejects(f.client.getMetadata(id, f.options), { code: 'WORKDRIVE_INPUT_INVALID' });
  }
  for (const options of [{}, { budget: { consume() {} } }, { ...f.options, signal: {} },
    { ...f.options, arbitrary: true }]) {
    await assert.rejects(f.client.getMetadata(FILE, options), { code: 'WORKDRIVE_OPTIONS_INVALID' });
  }
  assert.equal(f.authorizations(), 0); assert.equal(f.calls.length, 0);
});

test('metadata rejects missing organization, wrong resource, invalid size and incomplete envelopes', async (t) => {
  for (const payload of [{ data: row('other_file') }, { data: row(FILE, { org_id: null }) },
    { data: row(FILE, { storage_info: { size_in_bytes: '24 bytes' } }) },
    { data: row(FILE, { storage_info: { size_in_bytes: -1 } }) },
    { data: row(FILE, { is_folder: 'false' }) }, { data: [row()] },
    { data: row(), more_records: true }, { errors: [{ title: 'private provider error' }] }]) {
    const f = fixture(t, { respond: () => jsonResponse(payload) });
    await assert.rejects(f.client.getMetadata(FILE, f.options), (error) => {
      assert.equal(error.code, 'WORKDRIVE_RESPONSE_INVALID');
      assert.equal(error.cause, undefined); assert.doesNotMatch(error.message, /private provider/);
      return true;
    });
  }
});

test('folder cursor enumeration reconstructs the fixed scoped URL and allows missing listing organization only', async (t) => {
  const child = row('synthetic_child_1'); delete child.attributes.org_id;
  const f = fixture(t, { respond: (_url, _options, count) => count === 1
    ? jsonResponse(page([child], `${API}/workdrive/api/v1/files/${ROOT}/files?page[next]=synthetic_cursor`))
    : jsonResponse(page([row('synthetic_child_2')])) });
  const children = await f.client.listChildren(ROOT, f.options);
  assert.equal(children.length, 2); assert.equal(children[0].organizationId, null);
  assert.equal(children[1].organizationId, 'synthetic_organization');
  assert.equal(Object.isFrozen(children), true);
  for (const [index, request] of f.calls.entries()) {
    const url = new URL(request.url);
    assert.equal(url.pathname, `/workdrive/api/v1/files/${ROOT}/files`);
    assert.equal(url.searchParams.get('page[limit]'), '50');
    assert.equal(url.searchParams.get('page[next]'), index ? 'synthetic_cursor' : '0');
    assert.equal(url.searchParams.size, 2);
  }
  assert.equal(f.budget.snapshot().workdrive_read, 2);
});

test('empty complete folder is distinct from omitted or contradictory cursor evidence', async (t) => {
  const f = fixture(t, { respond: () => jsonResponse(page([])) });
  assert.deepEqual(await f.client.listChildren(ROOT, f.options), []);
  for (const payload of [{ data: [] }, { data: [], links: {} },
    { data: [], links: { cursor: { has_next: false, next: 'contradiction' } } },
    page([], `${API}/workdrive/api/v1/files/${ROOT}/files?page[next]=later`)]) {
    const bad = fixture(t, { respond: () => jsonResponse(payload) });
    await assert.rejects(bad.client.listChildren(ROOT, bad.options), { code: 'WORKDRIVE_RESPONSE_INVALID' });
  }
});

test('cursor redirects, cross-folder paths, injected queries, repeated cursors and duplicate IDs fail closed', async (t) => {
  for (const next of ['https://foreign.invalid/files',
    `${API}/workdrive/api/v1/files/other_parent/files?page[next]=next`,
    `${API}/workdrive/api/v1/files/${ROOT}/files?page[next]=next&secret=private`,
    `${API}/workdrive/api/v1/files/${ROOT}/files?page[next]=a&page[next]=b`,
    `${API}/workdrive/api/v1/files/${ROOT}/files?page[next]=a&page[limit]=1000`,
    `${API}/workdrive/api/v1/files/${ROOT}/files?page[next]=0`]) {
    const f = fixture(t, { respond: () => jsonResponse(page([row()], next)) });
    await assert.rejects(f.client.listChildren(ROOT, f.options), { code: 'WORKDRIVE_RESPONSE_INVALID' });
    assert.equal(f.calls.length, 1);
  }
  const duplicate = fixture(t, { respond: (_url, _options, count) => jsonResponse(page([row()], count === 1
    ? `${API}/workdrive/api/v1/files/${ROOT}/files?page[next]=second` : null)) });
  await assert.rejects(duplicate.client.listChildren(ROOT, duplicate.options), { code: 'WORKDRIVE_RESPONSE_INVALID' });
  const wrongParent = fixture(t, { respond: () => jsonResponse(page([row(FILE, { parent_id: 'other' })])) });
  await assert.rejects(wrongParent.client.listChildren(ROOT, wrongParent.options), { code: 'WORKDRIVE_RESPONSE_INVALID' });
});

test('folder page and total limits reject saturation without silently returning partial children', async (t) => {
  const tooMany = fixture(t, { respond: () => jsonResponse(page(Array.from({ length: 51 },
    (_, i) => row(`synthetic_${i}`)))) });
  await assert.rejects(tooMany.client.listChildren(ROOT, tooMany.options), { code: 'WORKDRIVE_RESPONSE_INVALID' });
  const f = fixture(t, { respond: (_url, _options, count) => jsonResponse(page(
    Array.from({ length: 50 }, (_, i) => row(`synthetic_${count}_${i}`)),
    `${API}/workdrive/api/v1/files/${ROOT}/files?page[next]=page_${count}`)) });
  await assert.rejects(f.client.listChildren(ROOT, f.options), { code: 'WORKDRIVE_LIST_INCOMPLETE' });
  assert.equal(f.calls.length, 4); assert.equal(f.budget.snapshot().workdrive_read, 4);
});

test('version IDs retain numeric lexemes exactly and use numeric file_size, never formatted bytes', async (t) => {
  const syntheticVersionId = `1${'0'.repeat(17)}7`;
  const payload = JSON.stringify({ data: [version({ version_id: 'large_numeric_id' })] })
    .replace('"large_numeric_id"', syntheticVersionId);
  const f = fixture(t, { respond: () => new Response(payload,
    { headers: { 'content-type': 'application/json' } }) });
  assert.deepEqual(await f.client.listVersions(FILE, f.options), [{ resourceId: FILE,
    versionId: syntheticVersionId, versionNumber: '1', sizeBytes: 24 }]);
});

test('versions reject paging, duplicates, foreign resources, missing size and oversized arrays', async (t) => {
  const missingSize = version(); delete missingSize.attributes.file_size;
  for (const payload of [{ data: [version()], links: { cursor: { has_next: true } } },
    { data: [version(), version()] }, { data: [version({ resource_id: 'other' })] },
    { data: [missingSize] }, { data: [version({ file_size: '24 bytes' })] },
    { data: [version({ version_id: null })] },
    { data: Array.from({ length: 101 }, (_, i) => version({ version_id: `v_${i}`, version_number: i + 1 })) }]) {
    const f = fixture(t, { respond: () => jsonResponse(payload) });
    await assert.rejects(f.client.listVersions(FILE, f.options), { code: 'WORKDRIVE_RESPONSE_INVALID' });
  }
});

test('download uses the selected version number on the fixed host and returns bounded exact bytes', async (t) => {
  const bytes = Buffer.from('<html>synthetic</html>');
  const f = fixture(t, { respond: () => new Response(bytes, { headers: { 'content-type': 'text/html; charset=utf-8' } }) });
  const result = await f.client.downloadVersion(FILE,
    { versionId: 'synthetic_version_7', versionNumber: '7.0' }, f.options);
  assert.ok(Buffer.isBuffer(result)); assert.deepEqual(result, bytes);
  assert.equal(f.calls[0].url, `${DOWNLOAD}/v1/workdrive/download/${FILE}?version=7.0`);
  for (const selector of [{ versionNumber: '7' }, { versionId: 'v', versionNumber: 7 },
    { versionId: 'v', versionNumber: 'latest?secret=private' }]) {
    await assert.rejects(f.client.downloadVersion(FILE, selector, f.options), { code: 'WORKDRIVE_INPUT_INVALID' });
  }
  assert.equal(f.calls.length, 1);
});

test('upload sends one copied multipart body and returns no provider identifier or idempotency claim', async (t) => {
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  const f = fixture(t, { authorize: async () => { await ready; return 'Zoho-oauthtoken synthetic-only'; },
    respond: () => jsonResponse({ unknown_rest_shape: { private_resource_id: 'untrusted', renamed: true } }) });
  const bytes = Buffer.from('synthetic original bytes');
  const result = f.client.upload({ parentId: ROOT, filename: 'synthetic report.html', bytes }, f.options);
  bytes.fill(0); release();
  assert.deepEqual(await result, { status: 'upload_response_received_reconciliation_required' });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, `${API}/workdrive/api/v1/upload`);
  const { body, method, headers } = f.calls[0].options;
  assert.equal(method, 'POST'); assert.ok(body instanceof FormData);
  assert.deepEqual([...body.keys()].sort(), ['content', 'filename', 'override-name-exist', 'parent_id']);
  assert.equal(body.get('parent_id'), ROOT); assert.equal(body.get('filename'), 'synthetic%20report.html');
  assert.equal(body.get('override-name-exist'), 'false');
  assert.equal(await body.get('content').text(), 'synthetic original bytes');
  assert.equal(headers['Content-Type'], undefined, 'FormData owns the multipart boundary');
  assert.equal(f.budget.snapshot().workdrive_write, 1);
});

test('upload network and provider failures remain ambiguous with no automatic retry', async (t) => {
  for (const respond of [() => { throw new Error('private credential and upload payload'); },
    () => jsonResponse({ private: 'untrusted response' }, 409), () => jsonResponse({}, 500)]) {
    const f = fixture(t, { respond });
    await assert.rejects(f.client.upload({ parentId: ROOT, filename: 'synthetic.html', bytes: Buffer.from('x') },
      f.options), (error) => {
      assert.equal(error.ambiguous, true); assert.equal(error.retryable, false);
      assert.equal(error.cause, undefined); assert.doesNotMatch(error.message, /credential|payload|untrusted/);
      return true;
    });
    assert.equal(f.calls.length, 1);
  }
});

test('invalid or oversized upload cannot spend a provider request', async (t) => {
  const f = fixture(t);
  for (const input of [{ parentId: ROOT, filename: '../file.html', bytes: Buffer.from('x') },
    { parentId: ROOT, filename: 'file\r\n.html', bytes: Buffer.from('x') },
    { parentId: ROOT, filename: 'file.html', bytes: Buffer.alloc(0) },
    { parentId: ROOT, filename: 'file.html', bytes: Buffer.alloc(MAX_WORKDRIVE_DOCUMENT_BYTES + 1) },
    { parentId: ROOT, filename: 'file.html', bytes: 'private text' }]) {
    await assert.rejects(f.client.upload(input, f.options), { code: 'WORKDRIVE_INPUT_INVALID' });
  }
  assert.equal(f.authorizations(), 0); assert.equal(f.calls.length, 0);
});

test('HTTP status, content type, content length, ranges and body bounds are enforced', async (t) => {
  for (const respond of [() => jsonResponse({}, 206),
    () => jsonResponse({ data: row() }, 200, { 'content-type': 'text/html' }),
    () => jsonResponse({ data: row() }, 200, { 'content-range': 'bytes 0-1/3' }),
    () => jsonResponse({ data: row() }, 200, { 'content-length': '999999999' }),
    () => jsonResponse({ data: row() }, 200, { 'content-length': '1' }),
    () => jsonResponse({ data: row() }, 200, { 'content-encoding': 'gzip' }),
    () => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
    () => new Response(Buffer.from([0xff]), { headers: { 'content-type': 'application/json' } })]) {
    const f = fixture(t, { respond });
    await assert.rejects(f.client.getMetadata(FILE, f.options)); assert.equal(f.calls.length, 1);
  }
  const download = fixture(t, { respond: () => jsonResponse({ errors: [] }) });
  await assert.rejects(download.client.downloadVersion(FILE,
    { versionId: 'v1', versionNumber: '1' }, download.options), { code: 'WORKDRIVE_RESPONSE_INVALID' });
});

test('authorization and total multi-page deadline are bounded without late requests', async (t) => {
  let release;
  const f = fixture(t, { timeoutMs: 15, authorize: () => new Promise((resolve) => { release = resolve; }) });
  await assert.rejects(f.client.getMetadata(FILE, f.options), { code: 'WORKDRIVE_TIMEOUT' });
  release('Zoho-oauthtoken synthetic-late');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 0); assert.equal(f.budget.snapshot().workdrive_read, 0);

  let now = 1000;
  const pages = fixture(t, { timeoutMs: 50, now: () => now, respond: () => {
    now += 51;
    return jsonResponse(page([row()], `${API}/workdrive/api/v1/files/${ROOT}/files?page[next]=next`));
  } });
  await assert.rejects(pages.client.listChildren(ROOT, pages.options), { code: 'WORKDRIVE_TIMEOUT' });
  assert.equal(pages.calls.length, 1);
});

test('abort while authorization or a cursor response is pending cannot start another request', async (t) => {
  for (const phase of ['authorization', 'response']) {
    const controller = new AbortController();
    let release;
    let announce;
    const started = new Promise((resolve) => { announce = resolve; });
    const pending = () => { announce(); return new Promise((resolve) => { release = resolve; }); };
    const f = fixture(t, { ...(phase === 'authorization' ? { authorize: pending } : { respond: pending }) });
    const result = f.client.listChildren(ROOT, { ...f.options, signal: controller.signal });
    await started; controller.abort();
    await assert.rejects(result, { code: 'WORKDRIVE_ABORTED' });
    release(phase === 'authorization' ? 'Zoho-oauthtoken synthetic-late'
      : jsonResponse(page([row()], `${API}/workdrive/api/v1/files/${ROOT}/files?page[next]=next`)));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.calls.length, phase === 'authorization' ? 0 : 1);
  }
});

test('body cancellation and upload timeout signal ambiguous remote completion', async (t) => {
  let cancelled = 0;
  const f = fixture(t, { timeoutMs: 15, respond: () => new Response(new ReadableStream({
    cancel() { cancelled += 1; },
  }), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(f.client.upload({ parentId: ROOT, filename: 'synthetic.html', bytes: Buffer.from('x') },
    f.options), (error) => error.code === 'WORKDRIVE_TIMEOUT' && error.ambiguous === true);
  assert.equal(cancelled, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.signal.aborted, true);
});

test('the shared budget prevents another actual upload and cancels pending provider work', async (t) => {
  const f = fixture(t, { respond: () => jsonResponse({ documented_shape_unqualified: true }) });
  const input = { parentId: ROOT, filename: 'synthetic.html', bytes: Buffer.from('x') };
  await f.client.upload(input, f.options);
  await assert.rejects(f.client.upload(input, f.options), { code: 'REPORT_ATTEMPT_LIMIT_EXCEEDED' });
  assert.equal(f.calls.length, 1); assert.equal(f.budget.snapshot().workdrive_write, 1);

  let started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const pending = fixture(t, { respond: () => { started(); return new Promise(() => {}); } });
  const result = pending.client.getMetadata(FILE, pending.options);
  await waiting; pending.budget.close();
  await assert.rejects(result, { code: 'REPORT_ATTEMPT_ABORTED' });
  assert.equal(pending.calls[0].options.signal.aborted, true);
});
