'use strict';

const crypto = require('node:crypto');
const { invariant } = require('./errors');

const RECONCILIATION_PROFILE = 'free-test-configuration-reconciliation-v1';
const RECONCILIATION_SIGNATURE_DOMAIN = 'revenue-desk-configuration-reconciliation-intent-v1\0';
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

module.exports = Object.freeze({
  RECONCILIATION_PROFILE, RECONCILIATION_SIGNATURE_DOMAIN, canonicalReconciliationIntent,
  successorConfigurationVersionId, successorConfigurationRow, successorDeployment,
});
