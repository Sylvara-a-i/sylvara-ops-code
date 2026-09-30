'use strict';

const { analyticsHost, parseTargets } = require('../functions/analytics_sync/lib/config');
const { createCatalystStore } = require('../functions/analytics_sync/lib/catalyst-store');
const { createConnectionAuthorizationProvider } = require('../functions/analytics_sync/lib/connection-boundary');
const { createAnalyticsClient } = require('../functions/analytics_sync/lib/analytics-client');
const { createWorkDriveClient } = require('../functions/analytics_sync/lib/workdrive-client');
const { createReportRunStore } = require('../functions/analytics_sync/lib/report-run-store');
const { createReportCheckpointReattestor } = require('./reattest-report-checkpoints');
const { createDurableReportComposition } = require('./create-durable-report-composition');
const { attachTerminalReportDelivery } = require('../functions/analytics_sync/lib/report-delivery-handlers');
const { createManagedPdfRenderer, validatePdfRendererBinding } = require('../functions/analytics_sync/lib/native-pdf-renderer');

function fail() { throw Object.assign(new Error('REPORTING_BINDING_REQUIRED'), { code: 'REPORTING_BINDING_REQUIRED' }); }
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);

/** Construct the existing worker's trusted hook from an approved private binding.
 * No Job parameter/environment toggle calls this factory. index.js remains null.
 * Installation must supply the actual accepted config and protected Connection
 * references; this module neither invents references nor provisions credentials.
 * Only the Analytics reader is reachable: its import authorization always fails.
 */
function createReportingFactory({ analyticsConfig, workdriveBinding, acceptance,
  readDestinationBinding, readOpportunityReview = null, now = Date.now,
  fetchImpl = globalThis.fetch, synthetic = false, pdfRenderer, pdfBinding, deliveryFactory = null } = {}) {
  if (deliveryFactory !== null && typeof deliveryFactory !== 'function') fail();
  if ((pdfRenderer && pdfBinding) || (!pdfRenderer && !pdfBinding)) fail();
  const nativeBinding = pdfBinding ? validatePdfRendererBinding(pdfBinding) : null;
  const rendererMetadata = pdfRenderer || nativeBinding;
  if (!analyticsConfig || !workdriveBinding || !acceptance
    || typeof readDestinationBinding !== 'function' || typeof now !== 'function'
    || typeof fetchImpl !== 'function' || typeof synthetic !== 'boolean'
    || (!nativeBinding && typeof rendererMetadata.render !== 'function')
    || typeof rendererMetadata.version !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(rendererMetadata.version)
    || !digest(rendererMetadata.qualificationDigest)
    || (readOpportunityReview !== null && typeof readOpportunityReview !== 'function')) fail();
  const config = structuredClone(analyticsConfig);
  const storage = structuredClone(workdriveBinding);
  const approved = structuredClone(acceptance);
  const renderer = nativeBinding || Object.freeze({ render: pdfRenderer.render, version: pdfRenderer.version,
    qualificationDigest: pdfRenderer.qualificationDigest });
  if (nativeBinding && (nativeBinding.projectId !== config.expectedProjectId
    || nativeBinding.environment !== config.catalystEnvironment)) fail();
  if (approved.pdfRendererDigest !== renderer.qualificationDigest) fail();
  const assertAccepted = () => {
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0 || approved.verifiedAt < 0
      || approved.verifiedAt > at || approved.expiresAt <= at) fail();
    return at;
  };
  const reference = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(value);
  if (config.environment !== 'development' || config.catalystEnvironment !== 'Development'
    || !/^[a-f0-9]{40}$/.test(config.sourceRevision) || !/^[0-9]{3,30}$/.test(config.expectedProjectId)
    || config.tables?.outbox !== 'AnalyticsSyncOutbox' || config.tables?.checkpoint !== 'AnalyticsSyncCheckpoints'
    || !reference(config.provider?.readConnection) || !reference(storage.connectionReference)
    || !digest(config.provider?.migrationEvidenceDigest)
    || !['schemaDigest', 'analyticsContractDigest', 'workdriveContractDigest', 'releaseCompositionDigest'].every(k => digest(approved[k]))
    || approved.sourceRevision !== config.sourceRevision || approved.environment !== 'development'
    || !Number.isSafeInteger(approved.verifiedAt) || !Number.isSafeInteger(approved.expiresAt)
    || approved.expiresAt <= approved.verifiedAt
    || !Number.isSafeInteger(config.analyticsTimeoutMs) || config.analyticsTimeoutMs < 1000 || config.analyticsTimeoutMs > 60000
    || !Number.isSafeInteger(config.responseMaxBytes) || config.responseMaxBytes < 1024 || config.responseMaxBytes > 5242880
    || !/^[0-9]{3,30}$/.test(config.provider.organizationId) || !/^[0-9]{3,30}$/.test(config.provider.workspaceId)
    || !Number.isSafeInteger(storage.timeoutMs) || storage.timeoutMs < 1000 || storage.timeoutMs > 60000
    || !Number.isSafeInteger(config.platformTimeoutMs) || config.platformTimeoutMs < 1000 || config.platformTimeoutMs > 30000
    || !Number.isSafeInteger(config.staleAfterMs) || config.staleAfterMs < 300000 || config.staleAfterMs > 86400000) fail();
  assertAccepted();
  try {
    // Reuse the regional-origin and exact table map rules from loadConfig.
    // Protected configuration is still validated before any credential read.
    config.provider.apiBaseUrl = analyticsHost(config.provider.apiBaseUrl);
    const targets = Object.fromEntries(Object.entries(config.provider.targets || {}).map(([type, target]) => {
      if (!target || Object.keys(target).sort().join(',') !== 'table,viewId'
        || typeof target.viewId !== 'string') fail();
      return [type, { table: target.table, view_id: target.viewId }];
    }));
    config.provider.targets = parseTargets(JSON.stringify(targets));
  } catch { fail(); }
  return function terminalDraftReconcilerFactory(app, runtimeConfig, runtimeStore) {
    if (runtimeConfig?.environment !== 'development' || runtimeConfig.sourceRevision !== config.sourceRevision
      || runtimeConfig.projectId !== config.expectedProjectId) fail();
    assertAccepted();
    const runtimeRenderer = nativeBinding
      ? createManagedPdfRenderer({ app, binding: nativeBinding, fetchImpl, now: assertAccepted }) : renderer;
    const analyticsStore = createCatalystStore(app, config);
    const readAuthorizationProvider = createConnectionAuthorizationProvider(app,
      config.provider.readConnection, config.platformTimeoutMs);
    const adapter = createAnalyticsClient({ config, readAuthorizationProvider,
      writeAuthorizationProvider: async () => fail(), fetchImpl, now: assertAccepted });
    const workdrive = createWorkDriveClient({ authorizationProvider: createConnectionAuthorizationProvider(app,
      storage.connectionReference, config.platformTimeoutMs), apiOrigin: storage.apiOrigin,
    downloadOrigin: storage.downloadOrigin, timeoutMs: storage.timeoutMs, fetchImpl, now: assertAccepted });
    const reportRunStore = createReportRunStore({ app, environment: config.environment,
      timeoutMs: config.platformTimeoutMs });
    const reattestCheckpoints = createReportCheckpointReattestor({ analyticsStore, now: assertAccepted, freshnessMs: config.staleAfterMs });
    const reconcile = createDurableReportComposition({ runtimeStore, runtimeConfig, analyticsStore,
      readCompleteScope: adapter.readCompleteScope, readOpportunityReview, reportRunStore, workdrive,
      async readDestinationBinding(...args) {
        assertAccepted();
        const destination = await readDestinationBinding(...args);
        assertAccepted();
        if (destination?.contractQualificationDigest !== approved.workdriveContractDigest) fail();
        return destination;
      },
      // The shared budget checks this clock before every reservation, so expiry
      // also blocks immediate promise chains before the timer gets its turn.
      reattestCheckpoints, now: assertAccepted, synthetic, pdfRenderer: runtimeRenderer, reportBundle: true });
    async function approvedAttempt(scope, options = {}) {
      const at = assertAccepted();
      if (!options || typeof options !== 'object' || Array.isArray(options)
        || Object.keys(options).some(key => key !== 'signal')
        || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) fail();
      const controller = new AbortController();
      let timer;
      let rejectCancellation;
      const cancelled = new Promise((resolve, reject) => { rejectCancellation = reject; });
      const cancel = () => {
        controller.abort();
        rejectCancellation(Object.assign(new Error('REPORTING_BINDING_REQUIRED'), { code: 'REPORTING_BINDING_REQUIRED' }));
      };
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) cancel();
      // Expiry during a pending bounded read aborts the same whole-attempt
      // budget; the late result cannot dispatch a later read or write.
      if (approved.expiresAt - at <= reconcile.attemptTimeoutMs) {
        timer = setTimeout(cancel, approved.expiresAt - at);
      }
      try {
        return await Promise.race([cancelled, reconcile(scope, { signal: controller.signal })]);
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
        controller.abort();
      }
    }
    Object.defineProperty(approvedAttempt, 'attemptTimeoutMs', { value: reconcile.attemptTimeoutMs });
    return deliveryFactory === null ? Object.freeze(approvedAttempt)
      : attachTerminalReportDelivery(approvedAttempt, deliveryFactory(app, runtimeConfig, runtimeStore));
  };
}

module.exports = { createReportingFactory };
