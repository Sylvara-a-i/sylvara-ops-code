'use strict';

const {
  verifySignedApprovalIntent, configurationSnapshotFingerprint,
  routeFromRows, routeFingerprint,
} = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/approval-control');
const {
  validateConfigurationVersionRow, REQUIRED_CONFIGURATION_FIELDS,
} = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/configuration-version');
const { invariant } = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/errors');
const { prepareFreeTestConfiguration, MAX_READBACK_AGE_MS } = require('./free-test-preparation');

const REQUEST_FIELDS = ['input', 'configurationRow', 'deployment', 'intent', 'signature'];
const DRAFT_ROW_FIELDS = [...REQUIRED_CONFIGURATION_FIELDS, 'CONFIGURATION_VERSION_ID',
  'DEPLOYMENT_ID', 'CONFIGURATION_JSON', 'STATUS', 'APPROVAL_STATUS', 'SOURCE_ENVIRONMENT'];

/**
 * Source-only content-review rule for the one configured owner (Gabriel).
 * The host must supply the existing route-control server configuration, never
 * request-supplied reviewer names, identities or verification keys. This module
 * reads no credentials, issues no signatures, and has no persistence adapter.
 * A valid signature proves possession of the configured operator key, not the
 * authenticity of an exported CRM receipt or current provider configuration.
 */
function createFreeTestConfigurationReview({
  operatorIdHash, operatorVerificationSecret, sourceRevision, environment,
  now = Date.now,
}) {
  invariant(environment === 'development' && /^[a-f0-9]{40}$/.test(sourceRevision || '')
    && /^operator_[a-f0-9]{64}$/.test(operatorIdHash || '')
    && typeof operatorVerificationSecret === 'string'
    && operatorVerificationSecret.length >= 32 && operatorVerificationSecret.length <= 4096
    && typeof now === 'function',
  'INVALID_CONFIGURATION_REVIEW_CONTEXT', 'Configuration review server context is invalid.');

  return function review(request) {
    invariant(request && Object.getPrototypeOf(request) === Object.prototype
      && Object.keys(request).sort().join(',') === [...REQUEST_FIELDS].sort().join(','),
    'INVALID_CONFIGURATION_REVIEW', 'Configuration review fields are invalid.');
    const nowMs = now();
    const { input, configurationRow, deployment } = request;
    // Reuse the existing signed intent and freshness contract. No parallel
    // token, human-name assertion or locally supplied "verified" flag exists.
    const intent = verifySignedApprovalIntent({ intent: request.intent,
      signature: request.signature, secret: operatorVerificationSecret, nowMs });
    invariant(intent.action === 'approve' && intent.operator_id_hash === operatorIdHash
      && intent.evidence_revision === sourceRevision,
    'CONFIGURATION_REVIEW_OWNER_MISMATCH', 'Configuration review owner or revision does not match.');
    const evidenceAt = Date.parse(intent.evidence_observed_at);
    const requestedAt = Date.parse(intent.requested_at);
    invariant(evidenceAt <= requestedAt && requestedAt <= nowMs
      && nowMs - evidenceAt <= MAX_READBACK_AGE_MS
      && input?.evidence?.capturedAt === intent.evidence_observed_at,
    'CONFIGURATION_REVIEW_EVIDENCE_STALE', 'Configuration review evidence is not current.');

    const prepared = prepareFreeTestConfiguration(input, { now: nowMs });
    invariant(prepared.status === 'prepared_local_only' && prepared.unresolved.length === 0,
      'CONFIGURATION_REVIEW_PREPARATION_BLOCKED', 'Configuration preparation has unresolved requirements.');
    const candidate = prepared.candidate;
    invariant(configurationRow && Object.getPrototypeOf(configurationRow) === Object.prototype
      && Object.keys(configurationRow).sort().join(',') === [...DRAFT_ROW_FIELDS].sort().join(','),
    'CONFIGURATION_REVIEW_CONTENT_MISMATCH', 'Configuration review draft fields are invalid.');
    validateConfigurationVersionRow(configurationRow, {
      code: 'CONFIGURATION_REVIEW_TARGET_MISMATCH',
      expectedDeploymentId: candidate.deploymentId,
      expectedEnvironment: environment, expectedSourceRevision: sourceRevision,
    });
    // Review only the exact unapproved preparation. Neither this rule nor a
    // successful verdict can turn an existing immutable row into approved data.
    invariant(configurationRow.CONFIGURATION_JSON === JSON.stringify(candidate)
      && candidate.approved === false && candidate.notificationRecipient.approved === false
      && configurationRow.CONFIGURATION_VERSION === candidate.configurationVersion
      && configurationRow.CONFIGURATION_VERSION_ID === input.review.configurationVersionId
      && configurationRow.STATUS === 'Draft' && configurationRow.APPROVAL_STATUS === 'Pending'
      && configurationRow.DEPLOYMENT_STATUS === 'Setup Pending'
      && configurationRow.GO_LIVE_APPROVAL_STATUS === 'Not Ready'
      && configurationRow.ENGAGEMENT_TYPE === 'free_test'
      && configurationRow.CAPABILITY_PROFILE === 'call_gap_monitor_v1'
      && configurationRow.NUMBER_OWNERSHIP === 'dedicated_deployment'
      && !Object.hasOwn(configurationRow, 'ROWID') && !configurationRow.ACTIVATED_AT,
    'CONFIGURATION_REVIEW_CONTENT_MISMATCH', 'Configuration review must match the exact unapproved candidate.');
    invariant(deployment && deployment.CLIENT_ID === candidate.clientId
      && deployment.DEPLOYMENT_ID === candidate.deploymentId
      && deployment.ACTIVE_CONFIGURATION_VERSION_ID === configurationRow.CONFIGURATION_VERSION_ID
      && deployment.SOURCE_REVISION === sourceRevision && deployment.SOURCE_ENVIRONMENT === environment
      && deployment.COVERAGE_MODE === candidate.coverageMode && deployment.CALL_LIMIT === 25
      && deployment.HANDLED_COUNT === 0 && Number.isSafeInteger(deployment.COUNT_VERSION)
      && deployment.COUNT_VERSION >= 0 && deployment.COUNT_VERSION === intent.expected_deployment_version
      && deployment.TEST_STATUS === 'Setup Pending' && deployment.GO_LIVE_APPROVAL_STATUS === 'Not Ready'
      && !deployment.APPROVED_CONFIGURATION_VERSION_ID && !deployment.APPROVAL_EVENT_KEY
      && !deployment.ACTIVATION_EVENT_KEY && !deployment.ACTUAL_START_AT && !deployment.EXPIRES_AT
      && intent.deployment_id === candidate.deploymentId
      && intent.configuration_version_id === configurationRow.CONFIGURATION_VERSION_ID,
    'CONFIGURATION_REVIEW_TARGET_MISMATCH', 'Configuration review target is not the prepared unstarted deployment.');
    const expectedRoute = routeFingerprint(routeFromRows(deployment, configurationRow));
    invariant(intent.route_fingerprint === expectedRoute,
      'CONFIGURATION_REVIEW_CONTENT_MISMATCH', 'Configuration review signature does not bind these exact contents.');

    // This deliberately is not a durable approval receipt. Replays are pure
    // comparisons, not reused creation/activation allocations. The future sole
    // controller writer must authenticate fresh source evidence, claim its
    // approved operation, create/read back an immutable row and re-check state.
    return Object.freeze({
      status: 'signed_content_review_verified_local_only',
      configurationFingerprint: configurationSnapshotFingerprint(configurationRow),
      routeFingerprint: expectedRoute, evidenceRevision: sourceRevision,
      sourceEvidenceStatus: prepared.evidenceStatus,
      creationAuthorized: false, promotionAuthorized: false,
      deploymentAuthorized: false, providerVerified: false,
      unresolved: Object.freeze(['AUTHENTICATED_CONFIGURATION_CREATION_PROMOTION_REQUIRED']),
    });
  };
}

module.exports = Object.freeze({ createFreeTestConfigurationReview });
