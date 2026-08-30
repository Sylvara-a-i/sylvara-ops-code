'use strict';

const { loadConfig } = require('./config');
const { AnalyticsSyncError, invariant } = require('./errors');
const { createCatalystStore } = require('./catalyst-store');
const { createConnectionAuthorizationProvider } = require('./connection-boundary');
const { createAnalyticsClient } = require('./analytics-client');
const { createAnalyticsSyncService } = require('./service');

function jobPoolDetails(jobRequest) {
  const getter = typeof jobRequest?.getJobPoolDetails === 'function'
    ? jobRequest.getJobPoolDetails.bind(jobRequest)
    : typeof jobRequest?.getJobpoolDetails === 'function'
      ? jobRequest.getJobpoolDetails.bind(jobRequest) : null;
  invariant(getter, 'JOB_IDENTITY_INVALID', 'Catalyst Job pool identity is unavailable.');
  return getter();
}

function assertJobIdentity(jobRequest, environment, config) {
  invariant(environment.X_ZOHO_CATALYST_ENVIRONMENT === config.catalystEnvironment,
    'JOB_IDENTITY_INVALID', 'Catalyst Job environment identity conflicts with configuration.');
  invariant(jobRequest && typeof jobRequest.getProjectDetails === 'function'
    && typeof jobRequest.getAllJobParams === 'function', 'JOB_IDENTITY_INVALID',
  'Catalyst Job identity or parameter contract is unavailable.');
  const project = jobRequest.getProjectDetails();
  invariant(project && String(project.id) === config.expectedProjectId,
    'JOB_IDENTITY_INVALID', 'Catalyst Job project identity is not approved.');
  const pool = jobPoolDetails(jobRequest);
  invariant(pool && String(pool.id) === config.jobPoolId
    && pool.name === 'RevenueDeskAnalyticsJobs' && pool.type === 'Function',
  'JOB_IDENTITY_INVALID', 'Catalyst Job pool identity is not approved.');
  const params = jobRequest.getAllJobParams();
  invariant(params && typeof params === 'object' && !Array.isArray(params)
    && Object.keys(params).length === 0, 'JOB_PARAMS_INVALID',
  'analytics_sync accepts no caller-selected Job parameters.');
}

function close(context, success) {
  const method = success ? 'closeWithSuccess' : 'closeWithFailure';
  if (context && typeof context[method] === 'function') context[method]();
}

function createAnalyticsSyncJobHandler(options = {}) {
  const {
    environment = process.env,
    artifactSourceRevision,
    catalystSdk = null,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    randomBytes,
    logger = { info() {}, warn() {}, error() {} },
    storeFactory = createCatalystStore,
    clientFactory = createAnalyticsClient,
    serviceFactory = createAnalyticsSyncService,
  } = options;
  return async function analyticsSyncJob(jobRequest, context) {
    let config;
    try {
      config = loadConfig(environment, artifactSourceRevision);
      assertJobIdentity(jobRequest, environment, config);
      if (config.environment === 'production') {
        const result = Object.freeze({
          state: 'DarkNoOp', mode: config.mode, environment: 'production',
          externalReads: 0, externalWrites: 0, sourceRevision: config.sourceRevision,
        });
        logger.info({ event: 'analytics_sync_dark_noop', state: result.state,
          mode: result.mode, environment: result.environment,
          sourceRevision: result.sourceRevision });
        close(context, true);
        return result;
      }
      if (config.mode === 'disabled') {
        const result = Object.freeze({
          state: 'DisabledNoOp', mode: config.mode, environment: config.environment,
          externalReads: 0, externalWrites: 0, sourceRevision: config.sourceRevision,
        });
        logger.info({ event: 'analytics_sync_disabled', state: result.state,
          mode: result.mode, environment: result.environment,
          sourceRevision: result.sourceRevision });
        close(context, true);
        return result;
      }
      const runtimeSdk = catalystSdk || require('zcatalyst-sdk-node');
      invariant(typeof runtimeSdk.initialize === 'function', 'SDK_UNAVAILABLE',
        'Catalyst SDK is unavailable.');
      const app = runtimeSdk.initialize(context);
      const store = storeFactory(app, config);
      if (config.mode === 'readiness') {
        const readiness = await store.readiness();
        const result = Object.freeze({
          state: 'Readiness', mode: config.mode, environment: config.environment,
          sourceRevision: config.sourceRevision,
          tableCount: readiness.tableCount, rowSchemaVersion: readiness.rowSchemaVersion,
          analyticsWritesEnabled: false,
        });
        logger.info({ event: 'analytics_sync_readiness', state: result.state,
          mode: result.mode, environment: result.environment,
          sourceRevision: result.sourceRevision });
        close(context, true);
        return result;
      }
      const readAuthorizationProvider = createConnectionAuthorizationProvider(
        app, config.provider.readConnection, config.platformTimeoutMs,
      );
      const writeAuthorizationProvider = createConnectionAuthorizationProvider(
        app, config.provider.writeConnection, config.platformTimeoutMs,
      );
      const adapter = clientFactory({
        config, readAuthorizationProvider, writeAuthorizationProvider, fetchImpl,
      });
      const service = serviceFactory({
        store, adapter, config, now, randomBytes, logger,
      });
      const result = await service.run();
      const contained = result.state !== 'ReconciliationRequired'
        && result.state !== 'TerminalFailure';
      close(context, contained);
      return result;
    } catch (error) {
      const code = error instanceof AnalyticsSyncError ? error.code : 'ANALYTICS_SYNC_UNKNOWN';
      logger.error({ event: 'analytics_sync_failed', state: 'Failed',
        environment: config?.environment || 'unknown',
        sourceRevision: config?.sourceRevision || 'unknown', failed: 1 });
      close(context, false);
      if (!context || typeof context.closeWithFailure !== 'function') throw error;
      return Object.freeze({ state: 'Failed', code });
    }
  };
}

module.exports = { assertJobIdentity, createAnalyticsSyncJobHandler, jobPoolDetails };
