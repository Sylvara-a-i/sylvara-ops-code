'use strict';

const { RevenueDeskError, invariant } = require('./errors');

function withTimeout(operation, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new RevenueDeskError(
        'CATALYST_JOB_SUBMIT_TIMEOUT',
        'Catalyst Function Job submission timed out.',
        { httpStatus: 503, retryable: true, ambiguous: true },
      )), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

const ACCEPTED_SUBMISSION_STATUSES = new Set([
  'SUBMITTED', 'PENDING', 'RUNNING', 'SUCCESS', 'SUCCESSFUL',
]);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactPlainObject(value, expected) {
  if (!plainObject(value) || !plainObject(expected)) return false;
  const expectedKeys = Object.keys(expected);
  return Object.keys(value).length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(value, key) && value[key] === expected[key]);
}

function assertJobReadback(result, expected) {
  // The pinned SDK returns the provider payload unchanged. Require the nested
  // identity shape and a decimal string ID so partial or lossy evidence can
  // never be persisted as a verified dispatch.
  invariant(result && typeof result.job_id === 'string'
    && /^[1-9][0-9]{0,127}$/.test(result.job_id),
  'CATALYST_JOB_READBACK_FAILED', 'Catalyst Function Job did not return a job ID.',
  { httpStatus: 503, retryable: true, ambiguous: true });
  invariant(typeof result.job_status === 'string'
    && result.job_status === result.job_status.trim()
    && ACCEPTED_SUBMISSION_STATUSES.has(result.job_status.toUpperCase()),
  'CATALYST_JOB_READBACK_FAILED', 'Catalyst Function Job did not return an accepted status.',
  { httpStatus: 503, retryable: true, ambiguous: true });
  const meta = result.job_meta_details;
  const target = meta?.target_details;
  const pool = meta?.jobpool_details;
  const params = meta?.params;
  const jobConfig = meta?.job_config;
  invariant(plainObject(meta)
    && meta.job_name === expected.job_name
    && meta.source_type === 'API'
    && meta.target_type === expected.target_type
    && (meta.target_name === undefined || meta.target_name === expected.target_name)
    && typeof meta.jobpool_id === 'string' && meta.jobpool_id.length > 0
    && (meta.jobpool_name === undefined || meta.jobpool_name === expected.jobpool_name)
    && plainObject(target)
    && typeof target.id === 'string' && target.id.length > 0
    && target.target_name === expected.target_name
    && plainObject(pool)
    && pool.id === meta.jobpool_id
    && pool.name === expected.jobpool_name
    && pool.type === 'Function'
    && exactPlainObject(params, expected.params)
    && exactPlainObject(expected.job_config, { number_of_retries: 0, retry_interval: 0 })
    && exactPlainObject(jobConfig, expected.job_config),
  'CATALYST_JOB_READBACK_FAILED', 'Catalyst Function Job readback conflicts with the request.',
  { httpStatus: 503, retryable: true, ambiguous: true });
  return Object.freeze({ jobId: result.job_id, status: result.job_status });
}

class CatalystJobAdapter {
  constructor({ app, config }) {
    invariant(app && typeof app.jobScheduling === 'function',
      'INVALID_RUNTIME_CONFIGURATION', 'Catalyst Job Scheduling SDK is unavailable.',
      { httpStatus: 503 });
    this.config = config;
    this.jobs = app.jobScheduling();
    invariant(this.jobs && this.jobs.JOB && typeof this.jobs.JOB.submitJob === 'function',
      'INVALID_RUNTIME_CONFIGURATION',
      'Pinned Catalyst SDK does not expose the reviewed Job submission surface.',
      { httpStatus: 503 });
  }

  async enqueueProcessEvent(eventKey) {
    invariant(/^evt_[a-f0-9]{64}$/.test(eventKey),
      'INVALID_JOB_PARAMETER', 'Event receipt key is invalid.', { httpStatus: 503 });
    const request = {
      job_name: `RevenueDeskEvent_${eventKey.slice(-24)}`,
      jobpool_name: this.config.workerJobPoolName,
      target_type: 'Function',
      target_name: this.config.workerTargetName,
      params: Object.freeze({ mode: 'process_event', event_key: eventKey }),
      job_config: Object.freeze({ number_of_retries: 0, retry_interval: 0 }),
    };
    let result;
    try {
      result = await withTimeout(
        () => this.jobs.JOB.submitJob(request),
        this.config.platformTimeoutMs,
      );
    } catch (error) {
      if (error instanceof RevenueDeskError) throw error;
      throw new RevenueDeskError(
        'CATALYST_JOB_SUBMIT_FAILED',
        'Catalyst Function Job submission failed.',
        { cause: error, httpStatus: 503, retryable: true, ambiguous: true },
      );
    }
    return assertJobReadback(result, request);
  }
}

module.exports = { CatalystJobAdapter, assertJobReadback };
