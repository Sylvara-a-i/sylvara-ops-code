'use strict';
const crypto = require('node:crypto');
const PROFILE = 'report_runtime_context_v1';
const PRINCIPAL_FAILURE_STAGES = Object.freeze({ stream: 'principal_stream', size: 'principal_size',
  utf8: 'principal_utf8', json: 'principal_json', envelope: 'principal_envelope' });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function held() { throw new Error('REPORT_RUNTIME_CONTEXT_HELD'); }
function defaultTransport(options) {
  return require('../reporting/revenue-desk-analytics/functions/analytics_sync/lib/report-run-transport')
    .createReportRunTransport(options);
}
/** Read-only inspection, disabled without a separately pinned finite binding.
 * Schema 2 pins the current Catalyst principal, not an operational HMAC actor.
 * Shared control authentication does not identify an individual CRM caller.
 * No durable one-shot claim is possible without a write: owner coordinates one invocation.
 * Local replays are consumed before initialization; no result permits storage or delivery.
 */
function createProtectedRuntimeContext({ environment = process.env, now = Date.now,
  transportFactory = defaultTransport,
  sdkVersion = () => require('zcatalyst-sdk-node/package.json').version } = {}) {
  const consumed = new Set();
  return async function inspect(request, { runtime, config, body }) {
    if (!exact(body, ['profile', 'action']) || body.profile !== PROFILE || body.action !== 'inspect_context') held();
    const out = { stage: 'binding', binding_valid: false, source_revision_matches: false,
      sdk_version_matches: 'Unknown', app_project_matches: 'Unknown',
      app_environment_is_development: 'Unknown', authenticate_request_available: 'Unknown',
      credential_user_mode: 'user', credential_user_type: 'unknown',
      authentication_status: 'not_run', principal_request_status: 'not_dispatched',
      principal_identity_matches: 'Unknown', principal_status_active: 'Unknown',
      principal_role_matches: 'Unknown', qualification_authority: false };
    const raw = environment.REPORT_RUNTIME_CONTEXT_JSON, pin = environment.REPORT_RUNTIME_CONTEXT_SHA256;
    let b;
    try {
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > 4096
        || !/^[a-f0-9]{64}$/.test(pin || '') || sha(raw) !== pin) held();
      b = JSON.parse(raw);
      if (!exact(b, ['schemaVersion', 'enabled', 'environment', 'sourceRevision', 'projectId',
        'controlHost', 'principalSha256', 'verifiedAt', 'expiresAt', 'timeoutMs', 'nonce'])
        || b.schemaVersion !== 2 || b.enabled !== true || b.environment !== 'development'
        || config.environment !== 'development' || environment.DEPLOYMENT_ENVIRONMENT !== 'development'
        || !/^[a-f0-9]{40}$/.test(b.sourceRevision || '')
        || b.sourceRevision !== config.sourceRevision || b.sourceRevision !== environment.SOURCE_REVISION
        || !/^[1-9][0-9]{2,29}$/.test(b.projectId || '') || sha(b.projectId) !== config.expectedProjectIdSha256
        || b.controlHost !== config.controlHost
        || !/^[a-f0-9]{64}$/.test(b.principalSha256 || '') || !/^[a-f0-9]{32}$/.test(b.nonce || '')
        || !Number.isSafeInteger(b.verifiedAt) || b.verifiedAt < 0 || !Number.isSafeInteger(b.expiresAt)
        || b.expiresAt <= b.verifiedAt || b.expiresAt - b.verifiedAt > 900000
        || !Number.isSafeInteger(b.timeoutMs) || b.timeoutMs < 1 || b.timeoutMs > 3000
        || now() < b.verifiedAt || now() >= b.expiresAt || consumed.has(pin)) held();
      consumed.add(pin);
      out.binding_valid = true; out.source_revision_matches = true;
    } catch { return Object.freeze(out); }
    const abort = new AbortController();
    let rejectDeadline;
    const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
    deadline.catch(() => {});
    const timer = setTimeout(() => { abort.abort(); rejectDeadline(new Error('REPORT_RUNTIME_CONTEXT_HELD')); }, b.timeoutMs);
    const active = () => { if (abort.signal.aborted || now() >= b.expiresAt) held(); };
    let app, authCalls = 0, dispatches = 0;
    try {
      out.stage = 'SDKinit'; active();
      out.sdk_version_matches = sdkVersion() === '3.4.0';
      if (!out.sdk_version_matches) held();
      app = runtime.initialize(request);
      out.app_project_matches = String(app?.config?.projectId || '') === b.projectId;
      out.app_environment_is_development = String(app?.config?.environment || '').toLowerCase() === 'development';
      out.authenticate_request_available = typeof app?.authenticateRequest === 'function';
      if (!out.app_project_matches || !out.app_environment_is_development || !out.authenticate_request_available) held();
      // Observe only completion of the normal managed auth method, never credential values.
      const guarded = new Proxy(app, { get(target, key) {
        if (key === 'authenticateRequest') return async command => {
          out.stage = 'auth'; out.authentication_status = 'held';
          active(); if (++authCalls > 1) held();
          await target.authenticateRequest(command); active(); out.authentication_status = 'succeeded';
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      const io = transportFactory({ app: guarded, timeoutMs: b.timeoutMs });
      if (typeof io?.currentPrincipal !== 'function') held();
      const principal = await Promise.race([deadline, io.currentPrincipal({ signal: abort.signal,
        budget: { assertActive: active }, trace(event) {
          if (event?.event === 'dispatch') { active(); if (++dispatches > 1) held();
            out.stage = 'principal_response'; out.principal_request_status = 'unknown'; }
          if (event?.event === 'principal_failure' && typeof event.failureClass === 'string'
            && Object.hasOwn(PRINCIPAL_FAILURE_STAGES, event.failureClass))
            out.stage = PRINCIPAL_FAILURE_STAGES[event.failureClass];
          if (event?.event === 'response' && Number.isInteger(event.status)) {
            out.principal_request_status = event.status >= 200 && event.status < 300 ? '2xx'
              : event.status >= 400 && event.status < 500 ? '4xx' : event.status >= 500 ? '5xx' : 'unknown';
          }
        } })]);
      active(); out.stage = 'principal_match';
      if (!principal || !/^[1-9][0-9]{2,29}$/.test(principal.userId || '')
        || !/^[1-9][0-9]{2,29}$/.test(principal.roleId || '')) held();
      out.principal_identity_matches = sha(JSON.stringify({ projectId: b.projectId,
        roleId: principal.roleId, userId: principal.userId })) === b.principalSha256;
      out.principal_status_active = principal.status === 'ACTIVE';
      out.principal_role_matches = principal.roleName === 'App Administrator';
      // HTTP completion alone is not an accepted principal observation.
      if (!out.principal_identity_matches || !out.principal_status_active || !out.principal_role_matches) held();
      out.stage = 'complete';
    } catch {
      if (abort.signal.aborted && dispatches) out.principal_request_status = 'timeout';
    } finally { clearTimeout(timer); abort.abort(); }
    return Object.freeze(out);
  };
}
module.exports = { createProtectedRuntimeContext, PROFILE };
