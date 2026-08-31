'use strict';

const crypto = require('node:crypto');
const { invariant } = require('revenue_desk_call_gateway/lib/errors');
const { keyedDigest } = require('revenue_desk_call_gateway/lib/security');
const { ARTIFACT_SOURCE_REVISION, assertArtifactSourceRevision }
  = require('revenue_desk_call_gateway/lib/source-revision');

const TABLES = Object.freeze({
  DEPLOYMENT_TABLE: 'RevenueDeskDeployments',
  CONFIGURATION_VERSION_TABLE: 'RevenueDeskConfigurationVersions',
  EVENT_RECEIPT_TABLE: 'RevenueDeskEventReceipts',
  CANONICAL_CALL_TABLE: 'RevenueDeskCalls',
  NOTIFICATION_TABLE: 'RevenueDeskNotifications',
  ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox',
  OPERATION_TABLE: 'CRMBillingOperations',
});

function required(env, name, minimum = 1, maximum = 2048, trim = true) {
  const raw = env[name];
  invariant(typeof raw === 'string', 'INVALID_RUNTIME_CONFIGURATION', `${name} is required.`,
    { httpStatus: 503 });
  const value = trim ? raw.trim() : raw;
  invariant(value.length >= minimum && value.length <= maximum && !/^<.*>$/.test(value),
    'INVALID_RUNTIME_CONFIGURATION', `${name} is invalid.`, { httpStatus: 503 });
  return value;
}

function exactUrl(env, name, predicate) {
  let value;
  try { value = new URL(required(env, name, 12, 2048)); } catch (_) { value = null; }
  invariant(value && value.protocol === 'https:' && !value.username && !value.password
    && !value.port && !value.search && !value.hash && predicate(value),
  'INVALID_RUNTIME_CONFIGURATION', `${name} is invalid.`, { httpStatus: 503 });
  return value.toString().replace(/\/$/, '');
}

function integer(env, name, minimum, maximum) {
  const value = Number(required(env, name, 1, 10));
  invariant(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'INVALID_RUNTIME_CONFIGURATION', `${name} is invalid.`, { httpStatus: 503 });
  return value;
}

function optional(env, name) {
  const value = env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function loadConfig(env = process.env, artifactSourceRevision = ARTIFACT_SOURCE_REVISION) {
  const environment = required(env, 'DEPLOYMENT_ENVIRONMENT', 1, 20);
  const deploymentMode = required(env, 'DEPLOYMENT_MODE', 1, 20);
  invariant(environment === 'development' && deploymentMode === 'active',
    'PRODUCTION_DARK', 'Route control is Development-only.', { httpStatus: 503 });
  const sourceRevision = assertArtifactSourceRevision(
    required(env, 'SOURCE_REVISION', 40, 40), artifactSourceRevision,
  );
  invariant(required(env, 'ZOHO_CATALYST_ZCQL_PARSER', 2, 2) === 'V2',
    'INVALID_RUNTIME_CONFIGURATION', 'Catalyst ZCQL V2 is required.', { httpStatus: 503 });
  const tables = {};
  for (const [name, expected] of Object.entries(TABLES)) {
    const value = required(env, name, 1, 64);
    invariant(value === expected, 'INVALID_RUNTIME_CONFIGURATION',
      `${name} must use the canonical table.`, { httpStatus: 503 });
    tables[name] = value;
  }
  const operatorVerificationSecret = required(
    env, 'ROUTE_CONTROL_OPERATOR_HMAC_SECRET', 32, 4096, false,
  );
  const eventChainSecret = required(
    env, 'ROUTE_CONTROL_EVENT_HMAC_SECRET', 32, 4096, false,
  );
  const form2WorkflowHmacMaterial = required(
    env, 'FORM2_WORKFLOW_HMAC_SECRET', 32, 4096, false,
  );
  const numberSecret = required(env, 'NUMBER_LOOKUP_HMAC_SECRET', 32, 4096, false);
  const sharedHeaderValue = required(
    env, 'ROUTE_CONTROL_SHARED_HEADER_VALUE', 32, 4096, false,
  );
  invariant(new Set([
    operatorVerificationSecret, eventChainSecret, form2WorkflowHmacMaterial,
    numberSecret, sharedHeaderValue,
  ]).size === 5, 'INVALID_RUNTIME_CONFIGURATION',
  'Route-control secrets must be distinct.', { httpStatus: 503 });
  const operatorIdentity = required(env, 'ROUTE_CONTROL_OPERATOR_IDENTITY', 3, 256, false);
  const sharedHeaderName = required(env, 'ROUTE_CONTROL_SHARED_HEADER_NAME', 3, 80)
    .toLowerCase();
  invariant(/^x-[a-z0-9-]{1,77}$/.test(sharedHeaderName)
    && !new Set(['x-zcfkey', 'x-api-key']).has(sharedHeaderName),
  'INVALID_RUNTIME_CONFIGURATION', 'Route-control shared header name is invalid.',
  { httpStatus: 503 });
  const controlHost = required(env, 'ROUTE_CONTROL_HOST', 4, 253).toLowerCase();
  invariant(/(?:^|\.)development\.(?:catalystserverless|zohocatalyst)\.(?:com|in|eu|ca|com\.au)$/.test(controlHost),
    'INVALID_RUNTIME_CONFIGURATION', 'Route-control host must be Development.',
    { httpStatus: 503 });
  const expectedProjectIdSha256 = required(
    env, 'EXPECTED_CATALYST_PROJECT_ID_SHA256', 64, 64,
  );
  invariant(/^[a-f0-9]{64}$/.test(expectedProjectIdSha256),
    'INVALID_RUNTIME_CONFIGURATION', 'Catalyst project digest is invalid.',
    { httpStatus: 503 });
  const crmOrganizationId = required(env, 'CRM_ORGANIZATION_ID', 1, 30);
  invariant(/^[1-9][0-9]{0,29}$/.test(crmOrganizationId),
    'INVALID_RUNTIME_CONFIGURATION', 'CRM organization identity is invalid.',
    { httpStatus: 503 });
  const form2DestinationSha256 = required(env, 'FORM2_DESTINATION_SHA256', 64, 64);
  invariant(/^[a-f0-9]{64}$/.test(form2DestinationSha256),
    'INVALID_RUNTIME_CONFIGURATION', 'Form 2 destination identity is invalid.',
    { httpStatus: 503 });
  const form2FormVersion = required(env, 'FORM2_FORM_VERSION', 1, 32);
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(form2FormVersion),
    'INVALID_RUNTIME_CONFIGURATION', 'Form 2 version is invalid.', { httpStatus: 503 });
  const retellRouteMode = required(env, 'RETELL_ROUTE_MODE', 1, 20);
  invariant(new Set(['disabled', 'isolated_test']).has(retellRouteMode),
    'INVALID_RUNTIME_CONFIGURATION', 'Retell route mode is invalid.', { httpStatus: 503 });
  const retellPhoneNumber = optional(env, 'RETELL_TEST_PHONE_NUMBER');
  const sharedAgentId = optional(env, 'RETELL_SHARED_AGENT_ID');
  const sharedAgentVersionRaw = optional(env, 'RETELL_SHARED_AGENT_VERSION');
  const inboundWebhookUrlRaw = optional(env, 'RETELL_INBOUND_WEBHOOK_URL');
  const retellConnectionLinkName = optional(env, 'RETELL_CONNECTION_LINK_NAME');
  let inboundWebhookUrl = null;
  let sharedAgentVersion = null;
  if (retellRouteMode === 'isolated_test') {
    invariant(/^\+[1-9][0-9]{7,14}$/.test(retellPhoneNumber || '')
      && /^[A-Za-z0-9_-]{8,128}$/.test(sharedAgentId || '')
      && retellConnectionLinkName,
    'INVALID_RUNTIME_CONFIGURATION', 'Isolated Retell route identity is incomplete.',
    { httpStatus: 503 });
    const temporary = { ...env, RETELL_INBOUND_WEBHOOK_URL: inboundWebhookUrlRaw,
      RETELL_SHARED_AGENT_VERSION: sharedAgentVersionRaw };
    inboundWebhookUrl = exactUrl(temporary, 'RETELL_INBOUND_WEBHOOK_URL', (url) => (
      /(?:^|\.)development\.(?:catalystserverless|zohocatalyst)\.(?:com|in|eu|ca|com\.au)$/.test(url.hostname)
        && url.pathname === '/retell/inbound'
    ));
    sharedAgentVersion = integer(temporary, 'RETELL_SHARED_AGENT_VERSION', 0, 100_000);
  }
  return Object.freeze({
    environment, deploymentMode, sourceRevision, tables: Object.freeze(tables),
    operatorVerificationSecret, eventChainSecret, form2WorkflowHmacMaterial, numberSecret,
    operatorIdHash: `operator_${keyedDigest(eventChainSecret,
      'revenue-desk-route-control-operator-v1', [crmOrganizationId, operatorIdentity])}`,
    sharedHeaderName, sharedHeaderValue, controlHost, expectedProjectIdSha256,
    platformTimeoutMs: integer(env, 'PLATFORM_OPERATION_TIMEOUT_MS', 250, 5000),
    maxBodyBytes: integer(env, 'ROUTE_CONTROL_MAX_BODY_BYTES', 512, 16_384),
    paths: Object.freeze({
      approve: '/internal/revenue-desk/approve-configuration',
      activate: '/internal/revenue-desk/activate-free-test',
      rollback: '/internal/revenue-desk/rollback-free-test',
    }),
    crmOrganizationId,
    crmOrganizationSha256: crypto.createHash('sha256')
      .update(crmOrganizationId, 'utf8').digest('hex'),
    form2DestinationSha256, form2FormVersion,
    crmApiBaseUrl: exactUrl(env, 'CRM_API_BASE_URL', (url) => (
      new Set(['www.zohoapis.com', 'www.zohoapis.eu', 'www.zohoapis.in',
        'www.zohoapis.com.au', 'www.zohoapis.ca']).has(url.hostname)
        && url.pathname === '/crm/v8'
    )),
    crmReadConnectionLinkName: required(env, 'CRM_READ_CONNECTION_LINK_NAME', 1, 100),
    crmWriteConnectionLinkName: required(env, 'CRM_WRITE_CONNECTION_LINK_NAME', 1, 100),
    retellApiBaseUrl: exactUrl(env, 'RETELL_API_BASE_URL', (url) => (
      url.hostname === 'api.retellai.com' && url.pathname === '/'
    )),
    retellRouteMode, retellConnectionLinkName,
    retellPhoneNumber, inboundWebhookUrl, sharedAgentId, sharedAgentVersion,
    rollbackInstructions: required(env, 'RETELL_ROLLBACK_INSTRUCTIONS', 10, 1000, false),
    configurationDigest: crypto.createHash('sha256')
      .update(`${sourceRevision}\0${crmOrganizationId}\0${controlHost}`, 'utf8').digest('hex'),
  });
}

module.exports = Object.freeze({ TABLES, loadConfig });
