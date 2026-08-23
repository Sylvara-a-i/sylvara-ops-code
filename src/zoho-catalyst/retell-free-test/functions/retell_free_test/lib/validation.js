'use strict';

const {
  CONTRACT,
  COVERAGE_MODES,
  CRM_TEST_STATUSES,
  CRM_APPROVAL_STATUSES,
  STOP_REASON_TO_CRM,
  OUTCOMES,
  RETELL_EVENTS,
} = require('./contracts');
const { FreeTestError, invariant } = require('./errors');

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_PATTERN = /^[0-9]{5}(?:-[0-9]{4})?$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function object(value, name) {
  invariant(isPlainObject(value), 'INVALID_SCHEMA', `${name} must be a plain object.`);
  return value;
}

function exactKeys(value, allowed, name) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  invariant(unexpected.length === 0, 'INVALID_SCHEMA', `${name} contains unsupported fields.`);
}

function string(value, name, options = {}) {
  invariant(typeof value === 'string', 'INVALID_SCHEMA', `${name} must be a string.`);
  const normalized = options.trim === false ? value : value.trim();
  const minimum = options.minimum === undefined ? 1 : options.minimum;
  const maximum = options.maximum || 500;
  invariant(normalized.length >= minimum && normalized.length <= maximum, 'INVALID_SCHEMA', `${name} has an invalid length.`);
  return normalized;
}

function optionalString(value, name, options = {}) {
  if (value === null || value === undefined || value === '') return null;
  return string(value, name, options);
}

function identifier(value, name) {
  const result = string(value, name, { maximum: 128, trim: false });
  invariant(IDENTIFIER_PATTERN.test(result), 'INVALID_SCHEMA', `${name} is not a valid identifier.`);
  return result;
}

function integer(value, name, minimum, maximum) {
  invariant(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'INVALID_SCHEMA', `${name} must be an integer in range.`);
  return value;
}

function boolean(value, name) {
  invariant(typeof value === 'boolean', 'INVALID_SCHEMA', `${name} must be a boolean.`);
  return value;
}

function timestamp(value, name, options = {}) {
  if (options.nullable && (value === null || value === undefined)) return null;
  const raw = string(value, name, { maximum: 35, trim: false });
  const millis = Date.parse(raw);
  invariant(Number.isFinite(millis) && new Date(millis).toISOString() === raw, 'INVALID_SCHEMA', `${name} must be canonical ISO-8601 UTC.`);
  return raw;
}

function unixMillis(value, name) {
  invariant(Number.isSafeInteger(value) && value >= 0, 'INVALID_SCHEMA', `${name} must be a Unix timestamp in milliseconds.`);
  return value;
}

function e164(value, name) {
  const result = string(value, name, { maximum: 16, trim: false });
  invariant(E164_PATTERN.test(result), 'INVALID_SCHEMA', `${name} must be E.164.`);
  return result;
}

function stringArray(value, name, options = {}) {
  invariant(Array.isArray(value), 'INVALID_SCHEMA', `${name} must be an array.`);
  const minimum = options.minimum || 0;
  const maximum = options.maximum || 25;
  invariant(value.length >= minimum && value.length <= maximum, 'INVALID_SCHEMA', `${name} has an invalid item count.`);
  const normalized = value.map((item, index) => string(item, `${name}[${index}]`, { maximum: options.itemMaximum || 120 }));
  invariant(new Set(normalized).size === normalized.length, 'INVALID_SCHEMA', `${name} must not contain duplicates.`);
  return normalized;
}

function enumValue(value, values, name) {
  const result = string(value, name, { maximum: 80, trim: false });
  invariant(values.has(result), 'INVALID_SCHEMA', `${name} contains an unsupported value.`);
  return result;
}

function validateDeployment(input) {
  const value = object(input, 'deployment');
  exactKeys(value, [
    'clientId', 'deploymentId', 'configurationVersion', 'environment', 'engagementType',
    'capabilityProfile', 'coverageMode', 'testStatus', 'goLiveApprovalStatus',
    'approvedStartAt', 'actualStartAt', 'expiresAt', 'admissionLimit', 'admittedCallCount',
    'handledCallCount', 'stopReason', 'monitorAgentId', 'monitorAgentVersion',
  ], 'deployment');
  const actualStartAt = timestamp(value.actualStartAt, 'deployment.actualStartAt', { nullable: true });
  const expiresAt = timestamp(value.expiresAt, 'deployment.expiresAt', { nullable: true });
  invariant(Boolean(actualStartAt) === Boolean(expiresAt), 'INVALID_SCHEMA', 'Start and expiration must both be set or both be absent.');
  if (actualStartAt && expiresAt) {
    invariant(Date.parse(expiresAt) - Date.parse(actualStartAt) === CONTRACT.test_duration_days * 86_400_000,
      'INVALID_CONFIGURATION_VERSION', 'Expiration must be exactly seven days after actual start.');
  }
  const admittedCallCount = integer(value.admittedCallCount, 'deployment.admittedCallCount', 0, CONTRACT.admission_limit);
  const handledCallCount = integer(value.handledCallCount, 'deployment.handledCallCount', 0, CONTRACT.admission_limit);
  invariant(handledCallCount <= admittedCallCount, 'INVALID_SCHEMA', 'Handled calls cannot exceed admitted calls.');
  const stopReason = optionalString(value.stopReason, 'deployment.stopReason', { maximum: 50 });
  invariant(stopReason === null || STOP_REASON_TO_CRM.has(stopReason), 'INVALID_SCHEMA', 'deployment.stopReason is unsupported.');
  const testStatus = enumValue(value.testStatus, CRM_TEST_STATUSES, 'deployment.testStatus');
  const goLiveApprovalStatus = enumValue(value.goLiveApprovalStatus, CRM_APPROVAL_STATUSES, 'deployment.goLiveApprovalStatus');
  const approvedStartAt = timestamp(value.approvedStartAt, 'deployment.approvedStartAt');
  if (testStatus === CONTRACT.active_test_status) {
    invariant(actualStartAt && expiresAt
      && Date.parse(actualStartAt) >= Date.parse(approvedStartAt)
      && goLiveApprovalStatus === CONTRACT.approved_go_live_status
      && stopReason === null,
    'INVALID_SCHEMA', 'Live deployment activation state is inconsistent.');
  }
  return Object.freeze({
    clientId: identifier(value.clientId, 'deployment.clientId'),
    deploymentId: identifier(value.deploymentId, 'deployment.deploymentId'),
    configurationVersion: identifier(value.configurationVersion, 'deployment.configurationVersion'),
    environment: enumValue(value.environment, new Set(['development']), 'deployment.environment'),
    engagementType: enumValue(value.engagementType, new Set([CONTRACT.engagement_type]), 'deployment.engagementType'),
    capabilityProfile: enumValue(value.capabilityProfile, new Set([CONTRACT.capability_profile]), 'deployment.capabilityProfile'),
    coverageMode: enumValue(value.coverageMode, COVERAGE_MODES, 'deployment.coverageMode'),
    testStatus,
    goLiveApprovalStatus,
    approvedStartAt,
    actualStartAt,
    expiresAt,
    admissionLimit: integer(value.admissionLimit, 'deployment.admissionLimit', CONTRACT.admission_limit, CONTRACT.admission_limit),
    admittedCallCount,
    handledCallCount,
    stopReason,
    monitorAgentId: identifier(value.monitorAgentId, 'deployment.monitorAgentId'),
    monitorAgentVersion: integer(value.monitorAgentVersion, 'deployment.monitorAgentVersion', 0, 1_000_000),
  });
}

function validateConfiguration(input) {
  const value = object(input, 'configuration');
  exactKeys(value, [
    'clientId', 'deploymentId', 'configurationVersion', 'approved', 'companyName',
    'companyDescription', 'businessHours', 'coverageMode', 'servicesHandled',
    'unsupportedServices', 'serviceArea', 'urgentConditions', 'callbackExpectation',
    'notificationRecipient',
  ], 'configuration');
  const serviceArea = object(value.serviceArea, 'configuration.serviceArea');
  exactKeys(serviceArea, ['cities', 'zips'], 'configuration.serviceArea');
  const cities = stringArray(serviceArea.cities, 'configuration.serviceArea.cities', { maximum: 30, itemMaximum: 80 });
  const zips = stringArray(serviceArea.zips, 'configuration.serviceArea.zips', { maximum: 50, itemMaximum: 10 });
  invariant(cities.length + zips.length > 0, 'INVALID_SCHEMA', 'At least one service-area signal is required.');
  for (const zip of zips) invariant(ZIP_PATTERN.test(zip), 'INVALID_SCHEMA', 'A service-area ZIP is invalid.');
  const recipient = object(value.notificationRecipient, 'configuration.notificationRecipient');
  exactKeys(recipient, ['recipientId', 'approved', 'name', 'channel', 'email', 'mobile'], 'configuration.notificationRecipient');
  const channel = enumValue(recipient.channel, new Set(['email', 'mobile']), 'configuration.notificationRecipient.channel');
  const email = optionalString(recipient.email, 'configuration.notificationRecipient.email', { maximum: 254 });
  const mobile = recipient.mobile === null || recipient.mobile === undefined || recipient.mobile === ''
    ? null : e164(recipient.mobile, 'configuration.notificationRecipient.mobile');
  invariant(channel !== 'email' || (email && EMAIL_PATTERN.test(email)), 'INVALID_SCHEMA', 'Approved email destination is missing or invalid.');
  invariant(channel !== 'mobile' || mobile, 'INVALID_SCHEMA', 'Approved mobile destination is missing.');
  return Object.freeze({
    clientId: identifier(value.clientId, 'configuration.clientId'),
    deploymentId: identifier(value.deploymentId, 'configuration.deploymentId'),
    configurationVersion: identifier(value.configurationVersion, 'configuration.configurationVersion'),
    approved: boolean(value.approved, 'configuration.approved'),
    companyName: string(value.companyName, 'configuration.companyName', { maximum: 120 }),
    companyDescription: optionalString(value.companyDescription, 'configuration.companyDescription', { maximum: 500 }),
    businessHours: string(value.businessHours, 'configuration.businessHours', { maximum: 500 }),
    coverageMode: enumValue(value.coverageMode, COVERAGE_MODES, 'configuration.coverageMode'),
    servicesHandled: stringArray(value.servicesHandled, 'configuration.servicesHandled', { minimum: 1, maximum: 30 }),
    unsupportedServices: stringArray(value.unsupportedServices, 'configuration.unsupportedServices', { maximum: 30 }),
    serviceArea: Object.freeze({ cities, zips }),
    urgentConditions: stringArray(value.urgentConditions, 'configuration.urgentConditions', { minimum: 1, maximum: 25 }),
    callbackExpectation: string(value.callbackExpectation, 'configuration.callbackExpectation', { maximum: 300 }),
    notificationRecipient: Object.freeze({
      recipientId: identifier(recipient.recipientId, 'configuration.notificationRecipient.recipientId'),
      approved: boolean(recipient.approved, 'configuration.notificationRecipient.approved'),
      name: string(recipient.name, 'configuration.notificationRecipient.name', { maximum: 120 }),
      channel,
      email,
      mobile,
    }),
  });
}

function validateNumberAssignment(input) {
  const value = object(input, 'numberAssignment');
  exactKeys(value, [
    'assignmentId', 'assignmentVersion', 'toNumber', 'clientId', 'deploymentId',
    'configurationVersion', 'agentId', 'status', 'effectiveFrom', 'effectiveTo',
  ], 'numberAssignment');
  const effectiveFrom = timestamp(value.effectiveFrom, 'numberAssignment.effectiveFrom');
  const effectiveTo = timestamp(value.effectiveTo, 'numberAssignment.effectiveTo', { nullable: true });
  invariant(!effectiveTo || Date.parse(effectiveTo) > Date.parse(effectiveFrom), 'INVALID_SCHEMA', 'Number assignment interval is invalid.');
  invariant((value.status === 'Active' && effectiveTo === null)
    || (value.status === 'Retired' && effectiveTo !== null),
  'INVALID_SCHEMA', 'Number assignment status and effective end are inconsistent.');
  return Object.freeze({
    assignmentId: identifier(value.assignmentId, 'numberAssignment.assignmentId'),
    assignmentVersion: integer(value.assignmentVersion, 'numberAssignment.assignmentVersion', 1, 1_000_000),
    toNumber: e164(value.toNumber, 'numberAssignment.toNumber'),
    clientId: identifier(value.clientId, 'numberAssignment.clientId'),
    deploymentId: identifier(value.deploymentId, 'numberAssignment.deploymentId'),
    configurationVersion: identifier(value.configurationVersion, 'numberAssignment.configurationVersion'),
    agentId: identifier(value.agentId, 'numberAssignment.agentId'),
    status: enumValue(value.status, new Set(['Active', 'Retired']), 'numberAssignment.status'),
    effectiveFrom,
    effectiveTo,
  });
}

function validateInboundPayload(input) {
  const value = object(input, 'inbound webhook');
  exactKeys(value, ['event', 'event_timestamp', 'call_inbound'], 'inbound webhook');
  invariant(value.event === 'call_inbound', 'INVALID_EVENT', 'Unsupported inbound event.');
  const inbound = object(value.call_inbound, 'inbound webhook.call_inbound');
  exactKeys(inbound, ['agent_id', 'agent_version', 'from_number', 'to_number', 'custom_sip_headers'], 'inbound webhook.call_inbound');
  if (inbound.custom_sip_headers !== undefined) {
    const headers = object(inbound.custom_sip_headers, 'inbound webhook.call_inbound.custom_sip_headers');
    invariant(Object.keys(headers).length <= 32, 'INVALID_SCHEMA', 'Too many custom SIP headers.');
    for (const [name, headerValue] of Object.entries(headers)) {
      invariant(/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name), 'INVALID_SCHEMA', 'A custom SIP header name is invalid.');
      string(headerValue, `custom SIP header ${name}`, { minimum: 0, maximum: 512, trim: false });
    }
  }
  return Object.freeze({
    event: 'call_inbound',
    eventTimestamp: unixMillis(value.event_timestamp, 'inbound webhook.event_timestamp'),
    agentId: value.call_inbound.agent_id === undefined ? null : identifier(value.call_inbound.agent_id, 'inbound webhook.call_inbound.agent_id'),
    agentVersion: value.call_inbound.agent_version === undefined ? null : integer(value.call_inbound.agent_version, 'inbound webhook.call_inbound.agent_version', 0, 1_000_000),
    fromNumber: e164(value.call_inbound.from_number, 'inbound webhook.call_inbound.from_number'),
    toNumber: e164(value.call_inbound.to_number, 'inbound webhook.call_inbound.to_number'),
  });
}

function validateEventEnvelope(input) {
  const value = object(input, 'event webhook');
  exactKeys(value, ['event', 'call'], 'event webhook');
  const event = enumValue(value.event, RETELL_EVENTS, 'event webhook.event');
  const call = object(value.call, 'event webhook.call');
  const callId = identifier(call.call_id, 'event webhook.call.call_id');
  const agentId = identifier(call.agent_id, 'event webhook.call.agent_id');
  const agentVersion = integer(call.agent_version, 'event webhook.call.agent_version', 0, 1_000_000);
  const startTimestamp = unixMillis(call.start_timestamp, 'event webhook.call.start_timestamp');
  const endTimestamp = call.end_timestamp === undefined || call.end_timestamp === null
    ? null : unixMillis(call.end_timestamp, 'event webhook.call.end_timestamp');
  invariant(!endTimestamp || endTimestamp >= startTimestamp, 'INVALID_SCHEMA', 'Call timestamps are inconsistent.');
  return Object.freeze({ event, call, callId, agentId, agentVersion, startTimestamp, endTimestamp });
}

function validateOutcome(value) {
  return enumValue(value, OUTCOMES, 'call outcome');
}

function validateSourceRevision(value) {
  const result = string(value, 'SOURCE_REVISION', { maximum: 40 });
  invariant(SHA_PATTERN.test(result), 'INVALID_RUNTIME_CONFIGURATION', 'SOURCE_REVISION must be a 40-character lowercase Git SHA.');
  return result;
}

module.exports = {
  isPlainObject,
  object,
  exactKeys,
  string,
  optionalString,
  identifier,
  integer,
  boolean,
  timestamp,
  unixMillis,
  e164,
  stringArray,
  enumValue,
  validateDeployment,
  validateConfiguration,
  validateNumberAssignment,
  validateInboundPayload,
  validateEventEnvelope,
  validateOutcome,
  validateSourceRevision,
  E164_PATTERN,
  FreeTestError,
};
