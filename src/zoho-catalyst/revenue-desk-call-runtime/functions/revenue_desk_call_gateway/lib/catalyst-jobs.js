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

function assertJobReadback(result, expected) {
  invariant(result && (typeof result.job_id === 'string' || typeof result.job_id === 'number')
    && String(result.job_id).length > 0,
  'CATALYST_JOB_READBACK_FAILED', 'Catalyst Function Job did not return a job ID.',
  { httpStatus: 503, retryable: true, ambiguous: true });
  invariant(typeof result.job_status === 'string' && result.job_status.length > 0,
    'CATALYST_JOB_READBACK_FAILED', 'Catalyst Function Job did not return a status.',
    { httpStatus: 503, retryable: true, ambiguous: true });
  const meta = result.job_meta_details;
  if (meta !== null && meta !== undefined) {
    invariant(meta.target_type === expected.target_type
      && meta.target_name === expected.target_name
      && String(meta.jobpool_name || expected.jobpool_name) === expected.jobpool_name
      && meta.params?.mode === expected.params.mode
      && meta.params?.event_key === expected.params.event_key,
    'CATALYST_JOB_READBACK_FAILED', 'Catalyst Function Job readback conflicts with the request.',
    { httpStatus: 503, retryable: true, ambiguous: true });
  }
  return Object.freeze({
    jobId: String(result.job_id),
    status: result.job_status,
  });
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
