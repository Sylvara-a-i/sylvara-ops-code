'use strict';

const crypto = require('node:crypto');
const { FreeTestError, invariant } = require('./errors');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function developmentOnly(environment) {
  invariant(environment === 'development', 'PRODUCTION_BLOCKED', 'Adapters may run only in Development.', { httpStatus: 503 });
}

class SyntheticNotificationAdapter {
  constructor({ environment = 'development', behavior = () => 'success' } = {}) {
    developmentOnly(environment);
    this.behavior = behavior;
    this.deliveries = new Map();
  }

  async send({ idempotencyKey, recipientId, payload }) {
    const binding = fingerprint({ recipientId, payload });
    if (this.deliveries.has(idempotencyKey)) {
      const existing = this.deliveries.get(idempotencyKey);
      invariant(existing.binding === binding, 'NOTIFICATION_IDEMPOTENCY_CONFLICT', 'Notification idempotency key is bound to different content.');
      return existing.result;
    }
    const behavior = await this.behavior({ idempotencyKey, recipientId, payload });
    if (behavior === 'retryable_failure') {
      throw new FreeTestError('NOTIFICATION_PROVIDER_FAILURE', 'Synthetic provider failed.', { retryable: true, httpStatus: 503 });
    }
    if (behavior === 'ambiguous') {
      throw new FreeTestError('NOTIFICATION_PROVIDER_AMBIGUOUS', 'Synthetic provider result is ambiguous.', {
        retryable: true,
        ambiguous: true,
        httpStatus: 503,
      });
    }
    if (behavior === 'terminal_failure') {
      throw new FreeTestError('NOTIFICATION_PROVIDER_TERMINAL', 'Synthetic provider rejected the message.', { httpStatus: 422 });
    }
    const result = Object.freeze({
      status: 'Succeeded',
      providerReference: `synthetic_${crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 20)}`,
      responseCode: 'SYNTHETIC_ACCEPTED',
    });
    this.deliveries.set(idempotencyKey, { binding, result });
    return result;
  }

  async readback(idempotencyKey) {
    const binding = this.deliveries.get(idempotencyKey);
    return binding ? { found: true, result: binding.result } : { found: false };
  }
}

class SyntheticAnalyticsAdapter {
  constructor({ environment = 'development', behavior = () => 'success' } = {}) {
    developmentOnly(environment);
    this.behavior = behavior;
    this.rows = new Map();
    this.projections = new Map();
  }

  async upsert({ idempotencyKey, projectionKey, projection }) {
    const binding = fingerprint(projection);
    const existing = this.rows.get(idempotencyKey);
    if (existing) {
      invariant(existing.binding === binding, 'ANALYTICS_IDEMPOTENCY_CONFLICT', 'Analytics idempotency key is bound to a different projection.');
      return existing.result;
    }
    const behavior = await this.behavior({ idempotencyKey, projectionKey, projection });
    if (behavior === 'retryable_failure') {
      throw new FreeTestError('ANALYTICS_PROVIDER_FAILURE', 'Synthetic Analytics provider failed.', {
        retryable: true, httpStatus: 503,
      });
    }
    if (behavior === 'ambiguous') {
      throw new FreeTestError('ANALYTICS_PROVIDER_AMBIGUOUS', 'Synthetic Analytics provider result is ambiguous.', {
        retryable: true, ambiguous: true, httpStatus: 503,
      });
    }
    if (behavior === 'terminal_failure') {
      throw new FreeTestError('ANALYTICS_PROVIDER_TERMINAL', 'Synthetic Analytics provider rejected the fact.', {
        httpStatus: 422,
      });
    }
    const result = Object.freeze({ status: 'Succeeded', responseCode: 'SYNTHETIC_UPSERTED' });
    this.rows.set(idempotencyKey, Object.freeze({ binding, projection: structuredClone(projection), result }));
    this.projections.set(projectionKey, structuredClone(projection));
    return result;
  }

  async readback(idempotencyKey) {
    const binding = this.rows.get(idempotencyKey);
    return binding ? { found: true, result: binding.result } : { found: false };
  }
}

/**
 * Deterministic stand-in for a future Retell-authoritative admission lookup.
 * Only the explicit no_call_created result authorizes a capacity release.
 */
class SyntheticAdmissionReconciliationAdapter {
  constructor({ environment = 'development', behavior = () => 'ambiguous' } = {}) {
    developmentOnly(environment);
    this.behavior = behavior;
    this.observations = [];
  }

  async inspect(request) {
    const behavior = await this.behavior(request);
    if (behavior === 'retryable_failure') {
      throw new FreeTestError('ADMISSION_PROVIDER_FAILURE', 'Synthetic admission lookup failed.', {
        retryable: true,
        httpStatus: 503,
      });
    }
    if (behavior === 'ambiguous_failure') {
      throw new FreeTestError('ADMISSION_PROVIDER_AMBIGUOUS', 'Synthetic admission lookup was ambiguous.', {
        retryable: true,
        ambiguous: true,
        httpStatus: 503,
      });
    }
    const definitions = {
      no_call_created: {
        decision: 'NoCallCreated', authoritative: true, final: true,
        providerResponseCode: 'SYNTHETIC_NO_CALL_FINAL',
      },
      call_observed: {
        decision: 'CallObserved', authoritative: true, final: false,
        providerResponseCode: 'SYNTHETIC_CALL_OBSERVED',
      },
      ambiguous: {
        decision: 'Ambiguous', authoritative: false, final: false,
        providerResponseCode: 'SYNTHETIC_AMBIGUOUS',
      },
    };
    const definition = definitions[behavior];
    invariant(definition, 'INVALID_ADMISSION_RECONCILIATION_EVIDENCE', 'Synthetic admission behavior is invalid.');
    const evidence = Object.freeze({
      ...definition,
      evidenceKey: `synthetic_${crypto.createHash('sha256')
        .update(`${request.idempotencyKey}\0${request.bindingFingerprint}\0${definition.decision}`)
        .digest('hex').slice(0, 24)}`,
      bindingFingerprint: request.bindingFingerprint,
      observedAt: request.observedAt,
    });
    this.observations.push(Object.freeze({
      idempotencyKey: request.idempotencyKey,
      admissionId: request.admissionId,
      evidence,
    }));
    return evidence;
  }
}

class DisabledCrmSummaryAdapter {
  constructor({ environment = 'development', mode = 'disabled' } = {}) {
    developmentOnly(environment);
    invariant(mode === 'disabled', 'PRODUCTION_BLOCKED', 'CRM summary writes are disabled.', { httpStatus: 503 });
  }

  async write() {
    return Object.freeze({ status: 'SkippedDisabled' });
  }
}

module.exports = {
  SyntheticNotificationAdapter,
  SyntheticAnalyticsAdapter,
  SyntheticAdmissionReconciliationAdapter,
  DisabledCrmSummaryAdapter,
};
