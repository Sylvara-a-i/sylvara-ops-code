'use strict';

const {
  COVERAGE_MODES,
  OUTCOMES,
  RETELL_EVENTS,
} = require('./contracts');
const { FreeTestError, invariant } = require('./errors');

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_PATTERN = /^[0-9]{5}(?:-[0-9]{4})?$/;
const CALL_STATUSES = new Set(['registered', 'not_connected', 'ongoing', 'ended', 'error']);
const MAX_RETELL_CALL_DURATION_MS = 86_400_000;

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
  const callStatus = enumValue(call.call_status, CALL_STATUSES, 'event webhook.call.call_status');
  const disconnectionReason = optionalString(call.disconnection_reason,
    'event webhook.call.disconnection_reason', { maximum: 64, trim: false });
  invariant(disconnectionReason === null || /^[a-z][a-z0-9_]{0,63}$/.test(disconnectionReason),
    'INVALID_SCHEMA', 'Event disconnection reason is invalid.');
  const startTimestamp = unixMillis(call.start_timestamp, 'event webhook.call.start_timestamp');
  const endTimestamp = call.end_timestamp === undefined || call.end_timestamp === null
    ? null : unixMillis(call.end_timestamp, 'event webhook.call.end_timestamp');
  invariant(!endTimestamp || endTimestamp >= startTimestamp, 'INVALID_SCHEMA', 'Call timestamps are inconsistent.');
  const durationMs = integer(call.duration_ms, 'event webhook.call.duration_ms',
    0, MAX_RETELL_CALL_DURATION_MS);
  return Object.freeze({ event, call, callId, agentId, agentVersion, callStatus,
    disconnectionReason, startTimestamp, endTimestamp, durationMs });
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
  validateConfiguration,
  validateInboundPayload,
  validateEventEnvelope,
  validateOutcome,
  validateSourceRevision,
  E164_PATTERN,
  MAX_RETELL_CALL_DURATION_MS,
  FreeTestError,
};
