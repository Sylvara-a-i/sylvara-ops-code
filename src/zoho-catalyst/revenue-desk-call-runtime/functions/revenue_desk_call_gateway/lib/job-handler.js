'use strict';

const { loadJobConfig } = require('./config');
const { invariant } = require('./errors');
const { createCatalystStore } = require('./catalyst-store');
const { CatalystMailAdapter } = require('./catalyst-mail');
const { createCrmReportDispatcher } = require('./crm-report-dispatch');
const { createRuntimeService } = require('./runtime-service');

const JOB_MODES = Object.freeze({
  process_event: Object.freeze(['event_key', 'mode']),
  retry_scan: Object.freeze(['mode']),
  rebuild_report: Object.freeze(['deployment_id', 'mode']),
  reconcile_deployment: Object.freeze(['deployment_id', 'mode']),
});

function assertDevelopmentJob(jobRequest, environment, config) {
  const environmentName = environment && environment.X_ZOHO_CATALYST_ENVIRONMENT;
  invariant(config.environment === 'development' && environmentName === 'Development',
    'PRODUCTION_BLOCKED', 'Revenue Desk worker is Development-only.', { httpStatus: 503 });
  invariant(jobRequest && typeof jobRequest.getProjectDetails === 'function',
    'PRODUCTION_BLOCKED', 'Catalyst Job project identity is unavailable.', { httpStatus: 503 });
  const project = jobRequest.getProjectDetails();
  invariant(project && String(project.id) === config.projectId,
    'PRODUCTION_BLOCKED', 'Catalyst Job is not running in the approved Development project.',
    { httpStatus: 503 });
  const getJobPoolDetails = typeof jobRequest.getJobPoolDetails === 'function'
    ? jobRequest.getJobPoolDetails.bind(jobRequest)
    : typeof jobRequest.getJobpoolDetails === 'function'
      ? jobRequest.getJobpoolDetails.bind(jobRequest)
      : null;
  invariant(getJobPoolDetails,
    'PRODUCTION_BLOCKED', 'Catalyst Job pool identity is unavailable.', { httpStatus: 503 });
  const pool = getJobPoolDetails();
  invariant(pool && String(pool.id) === config.workerJobPoolId
    && pool.type === 'Function'
    && (pool.name === undefined || pool.name === config.workerJobPoolName),
  'PRODUCTION_BLOCKED', 'Catalyst Job is not running in the approved Function Job pool.',
  { httpStatus: 503 });
}

function readJobParams(jobRequest) {
  invariant(jobRequest && typeof jobRequest.getAllJobParams === 'function',
    'INVALID_JOB_PARAMETER', 'Catalyst Job parameters are unavailable.', { httpStatus: 400 });
  const params = jobRequest.getAllJobParams();
  invariant(params && typeof params === 'object' && !Array.isArray(params)
    && Object.getPrototypeOf(params) === Object.prototype,
  'INVALID_JOB_PARAMETER', 'Catalyst Job parameters must be a plain object.',
  { httpStatus: 400 });
  invariant(Object.values(params).every((value) => typeof value === 'string'),
    'INVALID_JOB_PARAMETER', 'Catalyst Job parameters must contain string values only.',
    { httpStatus: 400 });
  const allowed = JOB_MODES[params.mode];
  invariant(allowed, 'INVALID_JOB_PARAMETER', 'Catalyst Job mode is unsupported.',
    { httpStatus: 400 });
  const keys = Object.keys(params).sort();
  invariant(keys.length === allowed.length
    && keys.every((key, index) => key === allowed[index]),
  'INVALID_JOB_PARAMETER', 'Catalyst Job parameters do not match the selected mode.',
  { httpStatus: 400 });
  if (params.mode === 'process_event') {
    invariant(/^evt_[a-f0-9]{64}$/.test(params.event_key),
      'INVALID_JOB_PARAMETER', 'process_event requires one valid event_key.',
      { httpStatus: 400 });
  }
  if (params.mode === 'rebuild_report' || params.mode === 'reconcile_deployment') {
    invariant(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(params.deployment_id),
      'INVALID_JOB_PARAMETER', 'Deployment identifier is invalid.', { httpStatus: 400 });
  }
  return Object.freeze({ ...params });
}

function resultFailed(mode, result) {
  return mode === 'retry_scan'
    && [...result.events.results, ...result.notifications.results, ...result.deployments.results,
      ...result.reportSummaries.results]
      .some((item) => item.status === 'Failed');
}

function createWorkerJobHandler(options = {}) {
  const {
    catalystSdk = null,
    environment = process.env,
    now = Date.now,
    logger = { info() {}, warn() {}, error() {} },
    storeFactory = createCatalystStore,
    serviceFactory = createRuntimeService,
    mailFactory = (app, config) => new CatalystMailAdapter({ app, config }),
    dispatcherFactory = (_app, config) => createCrmReportDispatcher(config),
    artifactSourceRevision,
  } = options;
  return async function revenueDeskCallWorker(jobRequest, context) {
    let mode = 'unvalidated';
    try {
      const config = loadJobConfig(environment, { artifactSourceRevision });
      invariant(config.deploymentMode === 'active' && config.environment === 'development',
        'PRODUCTION_DARK', 'Revenue Desk Production worker is dark.', { httpStatus: 503 });
      assertDevelopmentJob(jobRequest, environment, config);
      const params = readJobParams(jobRequest);
      mode = params.mode;
      const runtimeCatalystSdk = catalystSdk || require('zcatalyst-sdk-node');
      invariant(typeof runtimeCatalystSdk.initialize === 'function',
        'INVALID_RUNTIME_CONFIGURATION', 'Catalyst SDK is unavailable.', { httpStatus: 503 });
      const app = runtimeCatalystSdk.initialize(context);
      const store = storeFactory(app, config);
      const service = serviceFactory({
        store,
        mailAdapter: mailFactory(app, config),
        crmSummaryDispatcher: dispatcherFactory(app, config, store),
        config,
        now,
        logger,
      });
      let result;
      if (mode === 'process_event') {
        result = await service.processEventReceipt(params.event_key);
      } else if (mode === 'retry_scan') {
        result = await service.runRetryJob(25);
      } else if (mode === 'rebuild_report') {
        result = await service.rebuildReport(params.deployment_id);
      } else {
        result = await service.reconcileDeployment(params.deployment_id);
      }
      invariant(!resultFailed(mode, result),
        'WORKER_MODE_FAILED', 'Worker mode contains an uncontained durable-state failure.',
        { httpStatus: 503 });
      logger.info({ event: 'revenue_desk_worker_completed', mode, state: result.status || 'Completed' });
      if (context && typeof context.closeWithSuccess === 'function') context.closeWithSuccess();
      return result;
    } catch (error) {
      logger.error({
        event: 'revenue_desk_worker_failed',
        mode,
        errorCode: typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR',
      });
      if (context && typeof context.closeWithFailure === 'function') {
        context.closeWithFailure();
        return Object.freeze({
          status: 'Failed',
          errorCode: typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR',
        });
      }
      throw error;
    }
  };
}

module.exports = {
  JOB_MODES,
  createWorkerJobHandler,
  assertDevelopmentJob,
  readJobParams,
};
