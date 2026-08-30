'use strict';

const {
  CAPABILITY_PROFILES, CRM_APPROVAL_STATUSES, CRM_TEST_STATUSES, ENGAGEMENT_TYPES,
} = require('./contracts');
const { invariant } = require('./errors');

const REQUIRED_CONFIGURATION_FIELDS = Object.freeze([
  'ENGAGEMENT_TYPE',
  'CAPABILITY_PROFILE',
  'PLAN_TIER',
  'CONFIGURATION_VERSION',
  'DEPLOYMENT_STATUS',
  'GO_LIVE_APPROVAL_STATUS',
  'LIMIT_POLICY',
  'BILLING_MODE',
  'NUMBER_OWNERSHIP',
  'ENVIRONMENT',
  'SOURCE_REVISION',
]);
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const CONFIGURATION_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const SAFE_ENUM_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const PLAN_TIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const LIMIT_POLICY_PATTERN = /^[a-z][a-z0-9_]{0,99}$/;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/;
const ENVIRONMENTS = new Set(['development', 'production']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateConfigurationVersionRow(row, {
  code = 'CONFIGURATION_UNAVAILABLE',
  expectedDeploymentId,
  expectedEnvironment,
  expectedSourceRevision,
} = {}) {
  invariant(isPlainObject(row), code, 'Configuration-version row is unavailable.');
  invariant(REQUIRED_CONFIGURATION_FIELDS.every((field) => (
    Object.hasOwn(row, field) && typeof row[field] === 'string' && row[field].length > 0
  )), code, 'Configuration-version immutable fields are incomplete.');
  invariant(OPAQUE_ID_PATTERN.test(row.CONFIGURATION_VERSION_ID || '')
    && DEPLOYMENT_ID_PATTERN.test(row.DEPLOYMENT_ID || '')
    && CONFIGURATION_VERSION_PATTERN.test(row.CONFIGURATION_VERSION)
    && typeof row.CONFIGURATION_JSON === 'string'
    && Buffer.byteLength(row.CONFIGURATION_JSON, 'utf8') <= 10_000,
  code, 'Configuration-version identity or payload is invalid.');
  invariant(ENGAGEMENT_TYPES.has(row.ENGAGEMENT_TYPE)
    && OPAQUE_ID_PATTERN.test(row.CAPABILITY_PROFILE)
    && PLAN_TIER_PATTERN.test(row.PLAN_TIER)
    && CRM_TEST_STATUSES.has(row.DEPLOYMENT_STATUS)
    && CRM_APPROVAL_STATUSES.has(row.GO_LIVE_APPROVAL_STATUS)
    && LIMIT_POLICY_PATTERN.test(row.LIMIT_POLICY)
    && SAFE_ENUM_PATTERN.test(row.BILLING_MODE)
    && SAFE_ENUM_PATTERN.test(row.NUMBER_OWNERSHIP)
    && ENVIRONMENTS.has(row.ENVIRONMENT)
    && SOURCE_REVISION_PATTERN.test(row.SOURCE_REVISION),
  code, 'Configuration-version immutable values are invalid.');
  invariant(row.SOURCE_ENVIRONMENT === row.ENVIRONMENT,
    code, 'Configuration-version environment aliases conflict.');

  const profile = CAPABILITY_PROFILES.get(row.CAPABILITY_PROFILE);
  invariant(profile
    && profile.engagement_type === row.ENGAGEMENT_TYPE
    && profile.plan_tier === row.PLAN_TIER
    && profile.limit_policy === row.LIMIT_POLICY
    && profile.billing_mode === row.BILLING_MODE,
  code, 'Configuration-version capability snapshot conflicts with its versioned profile.');
  if (expectedDeploymentId !== undefined) {
    invariant(row.DEPLOYMENT_ID === expectedDeploymentId,
      code, 'Configuration-version deployment binding is invalid.');
  }
  if (expectedEnvironment !== undefined) {
    invariant(row.ENVIRONMENT === expectedEnvironment,
      code, 'Configuration-version environment binding is invalid.');
  }
  if (expectedSourceRevision !== undefined) {
    invariant(row.SOURCE_REVISION === expectedSourceRevision,
      code, 'Configuration-version source revision is invalid.');
  }
  return Object.freeze({
    configurationVersionId: row.CONFIGURATION_VERSION_ID,
    deploymentId: row.DEPLOYMENT_ID,
    configurationVersion: row.CONFIGURATION_VERSION,
    configurationJson: row.CONFIGURATION_JSON,
    engagementType: row.ENGAGEMENT_TYPE,
    capabilityProfile: row.CAPABILITY_PROFILE,
    planTier: row.PLAN_TIER,
    deploymentStatus: row.DEPLOYMENT_STATUS,
    goLiveApprovalStatus: row.GO_LIVE_APPROVAL_STATUS,
    limitPolicy: row.LIMIT_POLICY,
    billingMode: row.BILLING_MODE,
    numberOwnership: row.NUMBER_OWNERSHIP,
    environment: row.ENVIRONMENT,
    sourceRevision: row.SOURCE_REVISION,
    profile,
  });
}

module.exports = Object.freeze({
  REQUIRED_CONFIGURATION_FIELDS,
  CONFIGURATION_VERSION_PATTERN,
  validateConfigurationVersionRow,
});
