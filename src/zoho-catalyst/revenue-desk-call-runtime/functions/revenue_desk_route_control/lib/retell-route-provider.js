'use strict';

const crypto = require('node:crypto');
const { RevenueDeskError, invariant } = require('revenue_desk_call_gateway/lib/errors');
const { numberLookupKey } = require('revenue_desk_call_gateway/lib/security');
const { assignedTestPhoneNumber } = require('revenue_desk_call_gateway/lib/test-number-assignment');

const AGENT_FIELDS = Object.freeze([
  'inbound_agents', 'outbound_agents', 'inbound_sms_agents', 'outbound_sms_agents',
]);
const DESTINATION_FIELDS = Object.freeze([
  'inbound_webhook_url', 'inbound_sms_webhook_url', 'fallback_number',
]);

function hasRouteShape(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && AGENT_FIELDS.every((field) => Object.hasOwn(value, field) && Array.isArray(value[field]))
    && DESTINATION_FIELDS.every((field) => Object.hasOwn(value, field));
}

function routeIsInactive(value) {
  return hasRouteShape(value)
    && AGENT_FIELDS.every((field) => value[field].length === 0)
    && DESTINATION_FIELDS.every((field) => value[field] === null);
}

function assertRollbackOwnership(config, live, {
  deployment, configurationVersion, routeFingerprint,
}) {
  const expectedNumberHash = numberLookupKey(config.numberSecret, config.retellPhoneNumber);
  invariant(live?.phone_number === config.retellPhoneNumber
    && typeof live.nickname === 'string' && live.nickname.startsWith('ZZZ SYNTHETIC')
    && Number.isSafeInteger(live.last_modification_timestamp)
    && deployment?.NUMBER_LOOKUP_HASH === expectedNumberHash
    && deployment?.MONITOR_AGENT_ID === config.sharedAgentId
    && Number(deployment?.MONITOR_AGENT_VERSION) === config.sharedAgentVersion
    && deployment?.DEPLOYMENT_ID === configurationVersion?.DEPLOYMENT_ID
    && deployment?.ACTIVE_CONFIGURATION_VERSION_ID
      === configurationVersion?.CONFIGURATION_VERSION_ID
    && deployment?.APPROVED_ROUTE_FINGERPRINT === routeFingerprint
    && /^route_[a-f0-9]{64}$/.test(routeFingerprint || ''),
  'ROUTE_ROLLBACK_OWNERSHIP_UNPROVEN',
  'Retell number ownership is not proven for this exact synthetic deployment.',
  { httpStatus: 409 });
}

function canonicalReadback(config, value) {
  invariant(hasRouteShape(value)
    && value.phone_number === config.retellPhoneNumber
    && new Set(['retell-twilio', 'retell-telnyx', 'custom']).has(value.phone_number_type)
    && Number.isSafeInteger(value.last_modification_timestamp)
    && typeof value.nickname === 'string' && value.nickname.startsWith('ZZZ SYNTHETIC')
    && value.inbound_agents.length === 1
    && value.inbound_agents[0]?.agent_id === config.sharedAgentId
    && Number(value.inbound_agents[0]?.agent_version) === config.sharedAgentVersion
    && Number(value.inbound_agents[0]?.weight) === 1
    && value.outbound_agents.length === 0
    && value.inbound_sms_agents.length === 0
    && value.outbound_sms_agents.length === 0
    && value.inbound_webhook_url === config.inboundWebhookUrl
    && value.inbound_sms_webhook_url === null
    && value.fallback_number === null,
  'ROUTE_VERIFICATION_FAILED', 'Retell number is not an isolated Development route.',
  { httpStatus: 409 });
  return Object.freeze({
    numberLookupHash: numberLookupKey(config.numberSecret, config.retellPhoneNumber),
    phoneNumberType: value.phone_number_type,
    lastModificationTimestamp: value.last_modification_timestamp,
    nickname: value.nickname,
    inboundAgentId: value.inbound_agents[0].agent_id,
    inboundAgentVersion: Number(value.inbound_agents[0].agent_version),
    inboundWeight: Number(value.inbound_agents[0].weight),
    inboundWebhookUrl: value.inbound_webhook_url,
    outboundCount: 0, inboundSmsCount: 0, outboundSmsCount: 0,
    fallbackNumberPresent: false,
  });
}

function readbackFingerprint(value) {
  return `readback_${crypto.createHash('sha256')
    .update('revenue-desk-retell-route-readback-v1\0', 'utf8')
    .update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function createRetellRouteProvider(config, {
  authorization, fetchImpl = globalThis.fetch, now = Date.now,
} = {}) {
  if (config.retellRouteMode === 'disabled') {
    return Object.freeze({
      async verifyActiveRoute() {
        throw new RevenueDeskError('ISOLATED_RETELL_TEST_NUMBER_REQUIRED',
          'An isolated Retell Development test number is required.', { httpStatus: 409 });
      },
      async disableRoute() {
        return Object.freeze({ status: 'manual_rollback_required',
          instructions: config.rollbackInstructions,
          failureCode: 'ISOLATED_RETELL_TEST_NUMBER_REQUIRED' });
      },
    });
  }
  invariant(config.retellRouteMode === 'isolated_test'
    && typeof authorization === 'function' && typeof fetchImpl === 'function',
    'INVALID_RUNTIME_CONFIGURATION', 'Retell provider dependencies are unavailable.',
    { httpStatus: 503 });
  const numberConfig = deployment => ({ ...config, retellPhoneNumber: assignedTestPhoneNumber(config, deployment) });

  // Local policy bound, not a claim about provider payload limits.
  const maxResponseBytes = 262144;
  async function request(method, path, body) {
    const controller = new AbortController();
    const deadlineAt = performance.now() + config.platformTimeoutMs;
    let reader, dispatched = false, rejectDeadline;
    const failed = cause => new RevenueDeskError('RETELL_ROUTE_REQUEST_FAILED',
      'Retell route operation failed.', { cause, httpStatus: 503,
        retryable: method === 'GET', ambiguous: method !== 'GET' && dispatched });
    const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
    const cancel = () => {
      controller.abort();
      try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch (_) {}
      rejectDeadline(failed());
    };
    const timer = setTimeout(cancel, config.platformTimeoutMs);
    const active = () => {
      if (controller.signal.aborted || performance.now() >= deadlineAt) {
        controller.abort(); throw failed();
      }
    };
    async function run() {
      active(); const token = await authorization(); active();
      dispatched = true;
      const response = await fetchImpl(`${config.retellApiBaseUrl}${path}`, {
        method, redirect: 'error',
        headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', Authorization: token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
      });
      if (controller.signal.aborted || performance.now() >= deadlineAt) {
        try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch (_) {}
      }
      active();
      if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599
        || !/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type') || '')
        || (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity')
        || !response.body?.getReader) throw failed();
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes)) throw failed();
      reader = response.body.getReader(); const chunks = []; let bytes = 0, count = 0;
      while (true) {
        active(); const part = await reader.read(); active(); if (part.done) break;
        if (!(part.value instanceof Uint8Array) || ++count > 512
          || (bytes += part.value.byteLength) > maxResponseBytes) throw failed();
        chunks.push(Buffer.from(part.value));
      }
      let json;
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch (error) { throw failed(error); }
      active();
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw failed();
      invariant(response.status >= 200 && response.status < 300,
      'RETELL_ROUTE_REJECTED', 'Retell rejected the route operation.',
      { httpStatus: response.status === 401 || response.status === 403 ? 503 : 409,
        retryable: method === 'GET', ambiguous: method !== 'GET' && response.status >= 500 });
      return json;
    }
    try { return await Promise.race([run(), deadline]); }
    catch (error) { throw error instanceof RevenueDeskError ? error : failed(error); }
    finally {
      clearTimeout(timer); controller.abort();
      try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch (_) {}
    }
  }

  async function getPhoneNumber(selected) {
    return request('GET', `/get-phone-number/${encodeURIComponent(selected.retellPhoneNumber)}`);
  }

  async function verifyActiveRoute({ deployment, configurationVersion, routeFingerprint }) {
    const selected = numberConfig(deployment);
    const live = canonicalReadback(selected, await getPhoneNumber(selected));
    invariant(live.numberLookupHash === deployment.NUMBER_LOOKUP_HASH
      && deployment.MONITOR_AGENT_ID === config.sharedAgentId
      && Number(deployment.MONITOR_AGENT_VERSION) === config.sharedAgentVersion
      && deployment.DEPLOYMENT_ID === configurationVersion.DEPLOYMENT_ID,
    'ROUTE_VERIFICATION_FAILED', 'Retell route does not match the deployment binding.',
    { httpStatus: 409 });
    return Object.freeze({
      status: 'route_active', deploymentId: deployment.DEPLOYMENT_ID,
      configurationVersionId: configurationVersion.CONFIGURATION_VERSION_ID,
      routeFingerprint, readbackFingerprint: readbackFingerprint(live),
      observedAt: new Date(now()).toISOString(),
    });
  }

  async function disableRoute(binding) {
    try {
      const selected = numberConfig(binding?.deployment);
      const before = await getPhoneNumber(selected);
      assertRollbackOwnership(selected, before, binding || {});
      const alreadyInactive = routeIsInactive(before);
      if (!alreadyInactive) {
        // A mismatched or repurposed active route must never be cleared. This
        // exact active readback is the final ownership gate before mutation.
        const active = canonicalReadback(selected, before);
        invariant(active.numberLookupHash === binding.deployment.NUMBER_LOOKUP_HASH,
          'ROUTE_ROLLBACK_OWNERSHIP_UNPROVEN',
          'Retell route does not belong to the selected deployment.', { httpStatus: 409 });
      }
      if (!alreadyInactive) await request('PATCH', `/update-phone-number/${encodeURIComponent(selected.retellPhoneNumber)}`, {
        inbound_agents: [], outbound_agents: [], inbound_sms_agents: [],
        outbound_sms_agents: [], inbound_webhook_url: null, inbound_sms_webhook_url: null,
      });
      const after = await getPhoneNumber(selected);
      assertRollbackOwnership(selected, after, binding || {});
      invariant(routeIsInactive(after),
        'ROUTE_ROLLBACK_FAILED', 'Retell route rollback did not read back inactive.',
        { httpStatus: 503, ambiguous: true });
      const safe = {
        numberLookupHash: numberLookupKey(config.numberSecret, selected.retellPhoneNumber),
        lastModificationTimestamp: after.last_modification_timestamp,
        inboundAgentCount: 0, outboundAgentCount: 0,
        inboundSmsAgentCount: 0, outboundSmsAgentCount: 0,
        inboundWebhookPresent: false, inboundSmsWebhookPresent: false,
      };
      return Object.freeze({ status: 'route_inactive',
        readbackFingerprint: readbackFingerprint(safe), observedAt: new Date(now()).toISOString(),
        instructions: config.rollbackInstructions });
    } catch (error) {
      return Object.freeze({ status: 'manual_rollback_required',
        instructions: config.rollbackInstructions,
        failureCode: error instanceof RevenueDeskError ? error.code : 'ROUTE_ROLLBACK_FAILED' });
    }
  }

  return Object.freeze({ verifyActiveRoute, disableRoute });
}

module.exports = Object.freeze({ canonicalReadback, createRetellRouteProvider,
  readbackFingerprint, routeIsInactive, assertRollbackOwnership });
