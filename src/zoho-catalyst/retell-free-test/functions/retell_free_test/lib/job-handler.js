'use strict';

const catalyst = require('zcatalyst-sdk-node');
const { loadJobConfig } = require('./config');
const { invariant } = require('./errors');
const { createCatalystStore } = require('./catalyst-store');
const { CatalystMailAdapter } = require('./catalyst-mail');
const { createRuntimeService } = require('./runtime-service');

function assertDevelopmentJob(jobRequest, environment, config) {
  // Catalyst's local/runtime container contract injects this environment value;
  // an undocumented Job Context header is not used as deployment authority.
  const environmentName = environment && environment.X_ZOHO_CATALYST_ENVIRONMENT;
  invariant(environmentName === 'Development',
    'PRODUCTION_BLOCKED', 'Catalyst Job environment identity is not Development.', { httpStatus: 503 });
  invariant(jobRequest && typeof jobRequest.getProjectDetails === 'function',
    'PRODUCTION_BLOCKED', 'Catalyst Job project identity is unavailable.', { httpStatus: 503 });
  const project = jobRequest.getProjectDetails();
  invariant(project && String(project.id) === config.developmentProjectId,
    'PRODUCTION_BLOCKED', 'Catalyst Job is not running in the approved Development project.',
    { httpStatus: 503 });
  // Catalyst's current documentation is inconsistent about the capital P in
  // getJobPoolDetails/getJobpoolDetails. Both documented spellings return the
  // platform-owned pool record; arbitrary job parameters are never consulted.
  const getJobPoolDetails = typeof jobRequest.getJobPoolDetails === 'function'
    ? jobRequest.getJobPoolDetails.bind(jobRequest)
    : typeof jobRequest.getJobpoolDetails === 'function'
      ? jobRequest.getJobpoolDetails.bind(jobRequest)
      : null;
  invariant(getJobPoolDetails,
    'PRODUCTION_BLOCKED', 'Catalyst Job pool identity is unavailable.', { httpStatus: 503 });
  const pool = getJobPoolDetails();
  invariant(pool && String(pool.id) === config.retryJobPoolId && pool.type === 'Function',
  'PRODUCTION_BLOCKED', 'Catalyst Job is not running in the approved Development Function Job pool.',
  { httpStatus: 503 });
}

/**
 * Callable Catalyst Function Job handler. A Development Job target can export
 * this function directly; it scans durable state instead of trusting job params.
 */
function createRetryJobHandler(options = {}) {
  const {
    catalystSdk = catalyst,
    environment = process.env,
    now = Date.now,
    logger = { info() {}, warn() {}, error() {} },
    storeFactory = createCatalystStore,
    serviceFactory = createRuntimeService,
    mailFactory = (app, config) => new CatalystMailAdapter({ app, config }),
  } = options;
  return async function processRetellEventsJob(jobRequest, context) {
    const config = loadJobConfig(environment);
    invariant(config.environment === 'development', 'PRODUCTION_BLOCKED',
      'Retry job is Development-only.', { httpStatus: 503 });
    // Job functions have no request Host boundary. Validate Catalyst-provided project
    // identity before SDK initialization, Data Store access, or Catalyst Mail access.
    assertDevelopmentJob(jobRequest, environment, config);
    const app = catalystSdk.initialize(context);
    const store = storeFactory(app, config);
    const service = serviceFactory({ store, mailAdapter: mailFactory(app, config), config, now, logger });
    const result = await service.runRetryJob(25);
    logger.info({ event: 'retell_retry_job_completed', eventCount: result.events.examined,
      notificationCount: result.notifications.examined,
      reconciliationRequired: result.notifications.reconciliationRequired });
    if (context && typeof context.closeWithSuccess === 'function') {
      context.closeWithSuccess();
    }
    return result;
  };
}

module.exports = { createRetryJobHandler, assertDevelopmentJob };
