'use strict';

const crypto = require('node:crypto');
const { invariant } = require('./errors');

const RECONCILIATION_PROFILE = 'free-test-configuration-reconciliation-v1';
const RECONCILIATION_SIGNATURE_DOMAIN = 'revenue-desk-configuration-reconciliation-intent-v1\0';
const COMPLETION_PROFILE = 'free-test-configuration-completion-v1';
const COMPLETION_SIGNATURE_DOMAIN = 'revenue-desk-configuration-completion-intent-v1\0';
const COMPLETION_INTENT_FIELDS = Object.freeze([
  'schema_version', 'action', 'original_claim_key', 'original_claim_fingerprint',
  'reconciliation_claim_key', 'reconciliation_claim_fingerprint',
  'original_source_revision', 'reconciliation_source_revision', 'target_source_revision',
  'original_configuration_fingerprint', 'reconciled_configuration_version_id',
  'reconciled_configuration_fingerprint', 'deployment_id', 'expected_deployment_fingerprint',
  'expected_deployment_version', 'expected_receipt_version', 'configuration_version_id',
  'configuration_fingerprint', 'route_fingerprint', 'operator_id_hash',
  'evidence_observed_at', 'requested_at',
]);
const INACTIVE_FIELDS = Object.freeze([
  'ROWID', 'CLIENT_ID', 'DEPLOYMENT_ID', 'DEPLOYMENT_KEY', 'ACTIVE_CONFIGURATION_VERSION_ID',
  'NUMBER_LOOKUP_HASH', 'BINDING_ID', 'BINDING_VERSION', 'MONITOR_AGENT_ID', 'MONITOR_AGENT_VERSION',
  'COVERAGE_MODE', 'CALL_LIMIT', 'COUNT_VERSION', 'HANDLED_COUNT', 'SOURCE_REVISION', 'SOURCE_ENVIRONMENT',
  'APPROVED_CONFIGURATION_VERSION_ID', 'APPROVAL_EVENT_KEY', 'APPROVED_ROUTE_FINGERPRINT',
  'GO_LIVE_APPROVED_AT', 'ACTIVATION_EVENT_KEY', 'TEST_STATUS', 'GO_LIVE_APPROVAL_STATUS',
  'APPROVED_START_AT', 'ACTUAL_START_AT', 'EXPIRES_AT', 'COUNTED_CALL_KEYS_JSON', 'STOP_REASON', 'STOPPED_AT',
  'REPORT_RECONCILIATION_STATUS', 'REPORT_RECONCILIATION_VERSION', 'UPDATED_AT',
]);
const INTENT_FIELDS = Object.freeze([
  'schema_version', 'action', 'original_claim_key', 'original_claim_fingerprint',
  'original_request_fingerprint', 'original_configuration_version_id',
  'original_configuration_fingerprint', 'original_source_revision', 'target_source_revision',
  'deployment_id', 'configuration_version_id', 'route_fingerprint', 'expected_receipt_version',
  'operator_id_hash', 'evidence_observed_at', 'requested_at',
]);
const CLAIM = /^cfgstage_[a-f0-9]{64}$/;
const CONFIGURATION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const REVISION = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;

function requireValid(condition) {
  invariant(condition, 'CONFIGURATION_STAGING_REVIEW_INVALID',
    'Configuration reconciliation evidence is invalid.', { httpStatus: 409 });
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function timestamp(value) {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/** A recovery has one identity across attempts and releases, not a new staging claim. */
function successorConfigurationVersionId(originalClaimKey, originalConfigurationVersionId) {
  requireValid(typeof originalClaimKey === 'string' && CLAIM.test(originalClaimKey)
    && typeof originalConfigurationVersionId === 'string' && CONFIGURATION_ID.test(originalConfigurationVersionId));
  return `cfgreconciled_${crypto.createHash('sha256').update(JSON.stringify([
    RECONCILIATION_PROFILE, originalClaimKey, originalConfigurationVersionId,
  ])).digest('hex')}`;
}

/** Canonical owner intent is domain-separated from staging, approval and activation. */
function canonicalReconciliationIntent(intent) {
  requireValid(plain(intent) && Object.keys(intent).sort().join(',') === [...INTENT_FIELDS].sort().join(','));
  requireValid(INTENT_FIELDS.filter((field) => !['schema_version', 'expected_receipt_version'].includes(field))
    .every((field) => typeof intent[field] === 'string')
    && intent.schema_version === 1 && intent.action === 'reconcile_configuration'
    && CLAIM.test(intent.original_claim_key || '')
    && HASH.test(intent.original_claim_fingerprint || '')
    && HASH.test(intent.original_request_fingerprint || '')
    && CONFIGURATION_ID.test(intent.original_configuration_version_id || '')
    && /^config_[a-f0-9]{64}$/.test(intent.original_configuration_fingerprint || '')
    && REVISION.test(intent.original_source_revision || '')
    && REVISION.test(intent.target_source_revision || '')
    && /^cfgdeploy_[a-f0-9]{64}$/.test(intent.deployment_id || '')
    && intent.configuration_version_id === successorConfigurationVersionId(
      intent.original_claim_key, intent.original_configuration_version_id)
    && /^route_[a-f0-9]{64}$/.test(intent.route_fingerprint || '')
    && intent.expected_receipt_version === 0
    && /^operator_[a-f0-9]{64}$/.test(intent.operator_id_hash || '')
    && timestamp(intent.evidence_observed_at) && timestamp(intent.requested_at)
    && Date.parse(intent.evidence_observed_at) <= Date.parse(intent.requested_at));
  return JSON.stringify(Object.fromEntries(INTENT_FIELDS.map((field) => [field, intent[field]])));
}

/**
 * Append a current-release snapshot; never relabel or edit the original row.
 * Business values and historical baseline provenance are preserved. Only the
 * baseline's physical-version reference follows the new immutable row, so the
 * unchanged reporting validator still enforces exact configuration ownership.
 * This pure projection is not authentication or permission to persist a row.
 */
function successorConfigurationRow(originalRequest, originalClaimKey, targetRevision) {
  const row = originalRequest?.configurationRow;
  requireValid(plain(row) && REVISION.test(targetRevision || '') && REVISION.test(row.SOURCE_REVISION || '')
    && typeof row.CONFIGURATION_JSON === 'string'
    && Buffer.byteLength(row.CONFIGURATION_JSON, 'utf8') <= 10_000);
  const id = successorConfigurationVersionId(originalClaimKey, row.CONFIGURATION_VERSION_ID);
  let candidate;
  try { candidate = JSON.parse(row.CONFIGURATION_JSON); } catch (_) { requireValid(false); }
  requireValid(plain(candidate) && JSON.stringify(candidate) === row.CONFIGURATION_JSON);
  if (Object.hasOwn(candidate, 'reportBaseline')) {
    requireValid(plain(candidate.reportBaseline)
      && candidate.reportBaseline.configurationVersionId === row.CONFIGURATION_VERSION_ID);
    candidate.reportBaseline.configurationVersionId = id;
  }
  const configurationJson = JSON.stringify(candidate);
  requireValid(Buffer.byteLength(configurationJson, 'utf8') <= 10_000);
  return Object.freeze({ ...row, CONFIGURATION_VERSION_ID: id,
    CONFIGURATION_JSON: configurationJson, SOURCE_REVISION: targetRevision });
}

function successorDeployment(originalRequest, originalClaimKey, targetRevision) {
  const row = successorConfigurationRow(originalRequest, originalClaimKey, targetRevision);
  const deployment = originalRequest?.deployment;
  requireValid(plain(deployment) && deployment.SOURCE_REVISION === originalRequest.configurationRow.SOURCE_REVISION
    && deployment.ACTIVE_CONFIGURATION_VERSION_ID === originalRequest.configurationRow.CONFIGURATION_VERSION_ID
    && deployment.DEPLOYMENT_ID === row.DEPLOYMENT_ID);
  return Object.freeze({ ...deployment, ACTIVE_CONFIGURATION_VERSION_ID: row.CONFIGURATION_VERSION_ID,
    SOURCE_REVISION: targetRevision });
}

/** One completion slot belongs to the existing interrupted recovery, not a release or retry. */
function completionConfigurationVersionId(reconciliationClaimKey, reconciledConfigurationVersionId) {
  requireValid(/^cfgreconcile_[a-f0-9]{64}$/.test(reconciliationClaimKey || '')
    && /^cfgreconciled_[a-f0-9]{64}$/.test(reconciledConfigurationVersionId || ''));
  return `cfgcompleted_${crypto.createHash('sha256').update(JSON.stringify([
    COMPLETION_PROFILE, reconciliationClaimKey, reconciledConfigurationVersionId,
  ])).digest('hex')}`;
}

function canonicalCompletionIntent(intent) {
  requireValid(plain(intent) && Object.keys(intent).sort().join(',') === [...COMPLETION_INTENT_FIELDS].sort().join(','));
  requireValid(COMPLETION_INTENT_FIELDS.filter((field) => !['schema_version', 'expected_receipt_version',
    'expected_deployment_version'].includes(field)).every((field) => typeof intent[field] === 'string')
    && intent.schema_version === 1 && intent.action === 'complete_configuration'
    && CLAIM.test(intent.original_claim_key) && HASH.test(intent.original_claim_fingerprint)
    && /^cfgreconcile_[a-f0-9]{64}$/.test(intent.reconciliation_claim_key)
    && HASH.test(intent.reconciliation_claim_fingerprint)
    && ['original_source_revision', 'reconciliation_source_revision', 'target_source_revision']
      .every((field) => REVISION.test(intent[field]))
    && intent.target_source_revision !== intent.reconciliation_source_revision
    && ['original_configuration_fingerprint', 'reconciled_configuration_fingerprint', 'configuration_fingerprint']
      .every((field) => /^config_[a-f0-9]{64}$/.test(intent[field]))
    && intent.configuration_version_id === completionConfigurationVersionId(
      intent.reconciliation_claim_key, intent.reconciled_configuration_version_id)
    && /^cfgdeploy_[a-f0-9]{64}$/.test(intent.deployment_id)
    && /^deployment_[a-f0-9]{64}$/.test(intent.expected_deployment_fingerprint)
    && intent.expected_deployment_version === 0 && intent.expected_receipt_version === 0
    && /^route_[a-f0-9]{64}$/.test(intent.route_fingerprint)
    && /^operator_[a-f0-9]{64}$/.test(intent.operator_id_hash)
    && timestamp(intent.evidence_observed_at) && timestamp(intent.requested_at)
    && Date.parse(intent.evidence_observed_at) <= Date.parse(intent.requested_at));
  return JSON.stringify(Object.fromEntries(COMPLETION_INTENT_FIELDS.map((field) => [field, intent[field]])));
}

function completionConfigurationRow(reconciliationRequest, reconciliationClaimKey, targetRevision) {
  canonicalReconciliationIntent(reconciliationRequest?.intent);
  requireValid(reconciliationRequest.profile === RECONCILIATION_PROFILE && REVISION.test(targetRevision || ''));
  const historical = successorConfigurationRow(reconciliationRequest.originalRequest,
    reconciliationRequest.intent.original_claim_key, reconciliationRequest.intent.target_source_revision);
  const id = completionConfigurationVersionId(reconciliationClaimKey, historical.CONFIGURATION_VERSION_ID);
  const candidate = JSON.parse(historical.CONFIGURATION_JSON);
  if (Object.hasOwn(candidate, 'reportBaseline')) candidate.reportBaseline.configurationVersionId = id;
  const serialized = JSON.stringify(candidate);
  requireValid(Buffer.byteLength(serialized, 'utf8') <= 10_000);
  return Object.freeze({ ...historical, CONFIGURATION_VERSION_ID: id,
    CONFIGURATION_JSON: serialized, SOURCE_REVISION: targetRevision });
}

function completionDeployment(reconciliationRequest, reconciliationClaimKey, targetRevision) {
  const row = completionConfigurationRow(reconciliationRequest, reconciliationClaimKey, targetRevision);
  return Object.freeze({ ...successorDeployment(reconciliationRequest.originalRequest,
    reconciliationRequest.intent.original_claim_key, reconciliationRequest.intent.target_source_revision),
  ACTIVE_CONFIGURATION_VERSION_ID: row.CONFIGURATION_VERSION_ID, SOURCE_REVISION: targetRevision });
}

/** Bind every governed prestate field, normalizing only actual Catalyst integer storage. */
function inactiveDeploymentFingerprint(deployment) {
  requireValid(plain(deployment));
  const integers = new Set(['BINDING_VERSION', 'MONITOR_AGENT_VERSION', 'CALL_LIMIT', 'COUNT_VERSION',
    'HANDLED_COUNT', 'REPORT_RECONCILIATION_VERSION']);
  const values = INACTIVE_FIELDS.map((field) => {
    let value = deployment[field];
    if (integers.has(field)) {
      if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) value = Number(value);
      requireValid(Number.isSafeInteger(value) && value >= 0);
    } else requireValid(value === null || typeof value === 'string');
    return [field, value];
  });
  return `deployment_${crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(values))).digest('hex')}`;
}

module.exports = Object.freeze({
  RECONCILIATION_PROFILE, RECONCILIATION_SIGNATURE_DOMAIN, canonicalReconciliationIntent,
  successorConfigurationVersionId, successorConfigurationRow, successorDeployment,
  COMPLETION_PROFILE, COMPLETION_SIGNATURE_DOMAIN, canonicalCompletionIntent,
  completionConfigurationVersionId, completionConfigurationRow, completionDeployment, inactiveDeploymentFingerprint,
});
