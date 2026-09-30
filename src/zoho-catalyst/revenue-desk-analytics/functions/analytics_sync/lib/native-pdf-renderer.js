'use strict';

const { AnalyticsSyncError } = require('./errors');
const { inlinePdfFonts } = require('./pdf-fonts');

const VERSION = 'smartbrowz-native-inter41-v1';
const API_ORIGIN = 'https://api.catalyst.zoho.com';
const MAX_HTML_BYTES = 600 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_PDF_BYTES = 2 * 1024 * 1024;
const POLICY = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const AUTH = /^Zoho-oauthtoken [A-Za-z0-9._-]{20,4096}$/;
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function error(code, ambiguous = false) {
  return new AnalyticsSyncError(code, 'PDF renderer did not produce accepted output.', { ambiguous });
}
function requireValid(condition, code = 'PDF_RENDER_CONFIGURATION_INVALID') {
  if (!condition) throw error(code);
}

/** Private construction-time metadata only. No caller-selected origin, project,
 * grant, rendering options or Connection is accepted by render(). US-only until
 * another DC is independently qualified; never default to Production.
 */
function validatePdfRendererBinding(value) {
  requireValid(exact(value, ['apiOrigin', 'projectId', 'organizationId', 'environment',
    'connectionReference', 'timeoutMs', 'version', 'qualificationDigest'])
    && value.apiOrigin === API_ORIGIN && value.environment === 'Development'
    && typeof value.projectId === 'string' && /^[0-9]{3,30}$/.test(value.projectId)
    && typeof value.organizationId === 'string' && /^[0-9]{3,30}$/.test(value.organizationId)
    && typeof value.connectionReference === 'string'
    && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(value.connectionReference)
    && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs >= 1 && value.timeoutMs <= 30000
    && value.version === VERSION && typeof value.qualificationDigest === 'string'
    && /^[a-f0-9]{64}$/.test(value.qualificationDigest) && !/^0+$/.test(value.qualificationDigest));
  return Object.freeze({ ...value });
}

function preparePdfPayload(html) {
  requireValid(Buffer.isBuffer(html) && html.length > 0 && html.length <= MAX_HTML_BYTES,
    'PDF_RENDER_INPUT_INVALID');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(html); }
  catch { throw error('PDF_RENDER_INPUT_INVALID'); }
  // Only the existing inert report projection is supported. The font resources
  // are pinned inline bytes; scripts and external subresources are prohibited.
  const csp = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`;
  requireValid(source.split(csp).length === 2 && source.split('</head>').length === 2
    && !/<(?:script|iframe|object|embed|link|base|form|img|video|audio|source)\b/i.test(source)
    && !/<[^>]*\s(?:src|href|on[a-z]+)\s*=/i.test(source)
    && [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].every(match =>
      !/\b(?:url|image-set)\s*\(/i.test(match[1]) && !/@import\b/i.test(match[1])), 'PDF_RENDER_INPUT_INVALID');
  source = source.replace(csp, csp.replace(POLICY, `${POLICY}; font-src data:; script-src 'none'; connect-src 'none'`))
    .replaceAll('-apple-system, BlinkMacSystemFont, "Inter", sans-serif', '"Inter", sans-serif')
    .replace('</head>', `<style>${inlinePdfFonts()}</style></head>`);
  requireValid(Buffer.byteLength(source) <= MAX_HTML_BYTES, 'PDF_RENDER_INPUT_INVALID');
  const body = JSON.stringify({ html: source,
    output_options: { output_type: 'pdf', format: 'Letter', print_background: true,
      prefer_css_pageSize: true, timeout: 20000 },
    page_options: { javascript_enabled: false },
    navigation_options: { timeout: 20000, wait_until: 'networkidle0' } });
  requireValid(Buffer.byteLength(body) <= MAX_REQUEST_BYTES, 'PDF_RENDER_INPUT_INVALID');
  return body;
}

/** One HTTP dispatch with native cancellation covering auth, headers and body.
 * Client abort is NOT evidence that the provider stopped rendering. Every
 * post-dispatch failure is conservatively unknown and must keep the caller's
 * durable generation claim consumed. No retry, redirect or SDK conversion path.
 */
function createNativePdfRenderer({ binding, authorizationProvider,
  fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const config = validatePdfRendererBinding(binding);
  requireValid(typeof authorizationProvider === 'function' && typeof fetchImpl === 'function'
    && typeof now === 'function');
  return Object.freeze({ version: VERSION, qualificationDigest: config.qualificationDigest,
    async render(input) {
      requireValid(plain(input) && Object.keys(input).every(k => ['html', 'revisionAt', 'signal'].includes(k))
        && Number.isSafeInteger(input.revisionAt) && input.revisionAt >= 0
        && (input.signal === undefined || input.signal instanceof AbortSignal), 'PDF_RENDER_INPUT_INVALID');
      const body = preparePdfPayload(input.html);
      const started = now();
      requireValid(Number.isSafeInteger(started) && started >= 0, 'PDF_RENDER_CLOCK_INVALID');
      const controller = new AbortController();
      let dispatched = false;
      let abortCode = null;
      let reader;
      let rejectCancellation;
      const cancelled = new Promise((resolve, reject) => { rejectCancellation = reject; });
      const cancelReader = () => {
        try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch { /* no response diagnostics */ }
      };
      const abort = code => {
        if (abortCode) return;
        abortCode = code;
        controller.abort();
        cancelReader();
        rejectCancellation(error(code, dispatched));
      };
      const parentAbort = () => abort('PDF_RENDER_ABORTED');
      input.signal?.addEventListener('abort', parentAbort, { once: true });
      if (input.signal?.aborted) parentAbort();
      const timer = setTimeout(() => abort('PDF_RENDER_TIMEOUT'), config.timeoutMs);
      function active() {
        const at = now();
        if (!Number.isSafeInteger(at) || at < started || at - started >= config.timeoutMs) {
          abort('PDF_RENDER_TIMEOUT');
        }
        if (controller.signal.aborted) throw error(abortCode || 'PDF_RENDER_ABORTED', dispatched);
      }
      async function work() {
        active();
        let authorization;
        try { authorization = await authorizationProvider({ signal: controller.signal }); }
        catch { throw error('PDF_RENDER_AUTH_UNAVAILABLE'); }
        // A late credential read must never dispatch after timeout/cancellation.
        active();
        requireValid(typeof authorization === 'string' && AUTH.test(authorization), 'PDF_RENDER_AUTH_UNAVAILABLE');
        dispatched = true;
        const response = await fetchImpl(`${config.apiOrigin}/browser360/v1/project/${config.projectId}/convert`, {
          method: 'POST', redirect: 'error', signal: controller.signal, body,
          headers: { Authorization: authorization, 'Content-Type': 'application/json',
            Accept: 'application/pdf', 'Accept-Encoding': 'identity',
            'CATALYST-ORG': config.organizationId, Environment: 'Development' },
        });
        authorization = undefined;
        active();
        if (response?.status !== 200) throw error('PDF_RENDER_HTTP_REJECTED', true);
        const type = response.headers?.get('content-type') || '';
        const encoding = response.headers?.get('content-encoding');
        const length = response.headers?.get('content-length');
        if (!/^application\/(?:pdf|octet-stream)(?:\s*;|$)/i.test(type)
          || (encoding && encoding.toLowerCase() !== 'identity')
          || (length !== null && length !== undefined && (!/^[0-9]+$/.test(length)
            || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_PDF_BYTES))
          || typeof response.body?.getReader !== 'function') throw error('PDF_RENDER_OUTPUT_INVALID', true);
        reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
          active();
          const chunk = await reader.read();
          active();
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength === 0
            || chunks.length >= 4096 || chunk.value.byteLength > MAX_PDF_BYTES - total) {
            throw error('PDF_RENDER_OUTPUT_INVALID', true);
          }
          chunks.push(Buffer.from(chunk.value));
          total += chunk.value.byteLength;
        }
        const pdf = Buffer.concat(chunks, total);
        if ((length !== null && length !== undefined && Number(length) !== total)
          || total < 12 || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))
          || !/%%EOF\s*$/.test(pdf.subarray(-1024).toString('latin1'))) throw error('PDF_RENDER_OUTPUT_INVALID', true);
        active();
        return pdf;
      }
      try { return await Promise.race([cancelled, work()]); }
      catch (failure) {
        // Never retain provider errors, headers, credentials or document bodies.
        if (failure instanceof AnalyticsSyncError && /^PDF_RENDER_/.test(failure.code)) throw error(failure.code, dispatched);
        throw error('PDF_RENDER_OUTCOME_UNKNOWN', dispatched);
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', parentAbort);
        controller.abort();
        cancelReader();
      }
    },
  });
}

/** Runtime-only documented AdminScope Connection boundary. Construction reads
 * only non-secret app project/environment metadata. Credential headers live
 * solely in this server closure and native request memory; never log/export.
 * No grant is provisioned here. Offline tests inject a fake SDK and fake header.
 */
function createManagedPdfRenderer({ app, binding, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const config = validatePdfRendererBinding(binding);
  requireValid(app && typeof app.connections === 'function'
    && app.config?.projectId === config.projectId && app.config?.environment === 'Development');
  const authorizationProvider = async ({ signal }) => {
    if (signal.aborted) throw error('PDF_RENDER_ABORTED');
    let credentials;
    try { credentials = await app.connections().getConnectionCredentials(config.connectionReference); }
    catch { throw error('PDF_RENDER_AUTH_UNAVAILABLE'); }
    if (signal.aborted) throw error('PDF_RENDER_ABORTED');
    const entries = plain(credentials?.headers) ? Object.entries(credentials.headers) : [];
    requireValid(plain(credentials) && plain(credentials.parameters || {})
      && Object.keys(credentials.parameters || {}).length === 0 && entries.length === 1
      && entries[0][0].toLowerCase() === 'authorization'
      && typeof entries[0][1] === 'string' && AUTH.test(entries[0][1]), 'PDF_RENDER_AUTH_UNAVAILABLE');
    return entries[0][1];
  };
  return createNativePdfRenderer({ binding: config, authorizationProvider, fetchImpl, now });
}

module.exports = { createNativePdfRenderer, createManagedPdfRenderer, validatePdfRendererBinding,
  preparePdfPayload, VERSION, MAX_HTML_BYTES, MAX_REQUEST_BYTES, MAX_PDF_BYTES };
