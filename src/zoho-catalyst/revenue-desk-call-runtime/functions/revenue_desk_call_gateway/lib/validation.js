'use strict';

const {
  COVERAGE_MODES,
  COVERAGE_LABEL_TO_MODE,
  OUTCOMES,
  RETELL_EVENTS,
} = require('./contracts');
const { RevenueDeskError, invariant } = require('./errors');
const { validateReportBaseline } = require('./report-baseline');

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_PATTERN = /^[0-9]{5}(?:-[0-9]{4})?$/;
const CALL_STATUSES = new Set(['registered', 'not_connected', 'ongoing', 'ended', 'error']);
const MAX_RETELL_CALL_DURATION_MS = 86_400_000;
// Keep the configuration boundary aligned with Form 2's exact choices. A
// destination label is not free text and cannot imply an unverified number.
const NUMBERED_FALLBACKS = new Set(['Existing Office Line', 'On-Call Mobile', 'Other']);
const FALLBACK_DESTINATIONS = new Set([...NUMBERED_FALLBACKS, 'Voicemail']);
const SUBMITTED_NO_ANSWER_PREFERENCES = new Set([
  '4 Rings', '5 Rings', '6 Rings', 'Provider Default', 'Not Sure',
]);
const PROVIDER_TIMING_FIELDS = Object.freeze([
  'schemaVersion', 'evidenceClass', 'clientId', 'crmDealId', 'deploymentId',
  'configurationVersion', 'businessNumber', 'phoneSystemProvider', 'coverageMode',
  'submittedPreference', 'settingName', 'value', 'unit', 'observedAt',
  'ownerDecision', 'ownerAcceptedAt', 'evidenceReference', 'evidenceSha256',
  'documentationReference', 'documentationSha256',
]);
const MAX_TIMING_READBACK_AGE_MS = 15 * 60 * 1000;

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

function identifier(value, name, maximum = 128) {
  const result = string(value, name, { maximum, trim: false });
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

// This acknowledgment belongs to the immutable server configuration, never to
// provider analysis. Its evidence reference is not itself authentication or a
// delivery receipt; the existing configuration approval binds its exact bytes.
function validateNotificationHandoff(input, recipient) {
  const value = object(input, 'configuration.notificationHandoff');
  exactKeys(value, ['schemaVersion', 'timeZone', 'channel', 'recipientId', 'monitored',
    'acknowledgedAt', 'acknowledgmentReference'], 'configuration.notificationHandoff');
  integer(value.schemaVersion, 'configuration.notificationHandoff.schemaVersion', 1, 1);
  const timeZone = string(value.timeZone, 'configuration.notificationHandoff.timeZone',
    { maximum: 80, trim: false });
  invariant(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone),
    'INVALID_SCHEMA', 'Notification time zone must be an IANA name.');
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(0); } catch (_) {
    invariant(false, 'INVALID_SCHEMA', 'Notification time zone is unavailable.');
  }
  const channel = enumValue(value.channel, new Set(['email']),
    'configuration.notificationHandoff.channel');
  const recipientId = identifier(value.recipientId, 'configuration.notificationHandoff.recipientId');
  invariant(recipientId === recipient.recipientId && channel === recipient.channel,
    'INVALID_SCHEMA', 'Notification acknowledgment belongs to another destination.');
  return Object.freeze({ schemaVersion: 1, timeZone, channel, recipientId,
    monitored: boolean(value.monitored, 'configuration.notificationHandoff.monitored'),
    acknowledgedAt: timestamp(value.acknowledgedAt, 'configuration.notificationHandoff.acknowledgedAt'),
    acknowledgmentReference: identifier(value.acknowledgmentReference,
      'configuration.notificationHandoff.acknowledgmentReference') });
}

// Admission/approval only. Historical settlement and rollback must still parse
// immutable configurations that predate this explicit human-monitoring gate.
function assertNotificationHandoffReady(configuration, { now = Date.now() } = {}) {
  const recipient = configuration?.notificationRecipient;
  const handoff = configuration?.notificationHandoff;
  invariant(recipient?.approved === true && recipient.channel === 'email'
    && typeof recipient.name === 'string' && recipient.name.trim().length > 0
    && handoff && Number.isFinite(now), 'NOTIFICATION_HANDOFF_UNAPPROVED',
  'A named owner and acknowledged monitored email destination are required.');
  const validated = validateNotificationHandoff(handoff, recipient);
  invariant(validated.monitored === true && Date.parse(validated.acknowledgedAt) <= now,
    'NOTIFICATION_HANDOFF_UNAPPROVED', 'Notification monitoring acknowledgment is not current evidence.');
  return validated;
}

/**
 * An exact owner-reviewed snapshot, not an API capability or carrier proof.
 * The normal staging signature binds these bytes through CONFIGURATION_JSON;
 * local validation never authenticates an export or authorizes activation.
 * Provider-native setting/value/unit stay verbatim: no ring conversion or
 * universal carrier range is inferred. Freshness applies to new preparation,
 * not immutable historical settlement or a completed read-only staging replay.
 */
function validateProviderTimingBinding(input, configuration, { now, capturedAt } = {}) {
  const code = 'PROVIDER_TIMING_UNVERIFIED';
  const valid = (condition) => invariant(condition, code,
    'Provider timing requires an exact owner-reviewed source binding.', { httpStatus: 409 });
  valid(isPlainObject(configuration) && isPlainObject(input) && Object.keys(input).sort().join(',')
    === [...PROVIDER_TIMING_FIELDS].sort().join(','));
  const boundedText = (value, maximum) => typeof value === 'string'
    && value.length > 0 && value.length <= maximum && value === value.trim()
    && !/[\x00-\x1f\x7f]/.test(value);
  const knownText = (value, maximum) => boundedText(value, maximum)
    && !/^(?:unknown|not sure|provider default|default|n\/a|none|unavailable|unverified|pending|-+)$/i.test(value);
  const canonicalTime = (value) => boundedText(value, 32) && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
  valid(input.schemaVersion === 1 && input.evidenceClass === 'owner_attested_provider_readback'
    && input.ownerDecision === 'accept_exact_provider_setting'
    && ['clientId', 'crmDealId', 'deploymentId', 'configurationVersion',
      'phoneSystemProvider', 'coverageMode'].every((field) => input[field] === configuration[field])
    && ['clientId', 'deploymentId', 'configurationVersion'].every((field) =>
      typeof input[field] === 'string' && IDENTIFIER_PATTERN.test(input[field]))
    && typeof input.crmDealId === 'string' && /^[1-9][0-9]{7,29}$/.test(input.crmDealId)
    && ['NoAnswerOverflowOnly', 'AfterHoursAndOverflow'].includes(input.coverageMode)
    && E164_PATTERN.test(input.businessNumber || '')
    && knownText(input.phoneSystemProvider, 120)
    && SUBMITTED_NO_ANSWER_PREFERENCES.has(input.submittedPreference)
    && knownText(input.settingName, 120) && knownText(input.value, 120)
    && knownText(input.unit, 80)
    && canonicalTime(input.observedAt) && canonicalTime(input.ownerAcceptedAt)
    && Date.parse(input.observedAt) <= Date.parse(input.ownerAcceptedAt)
    && ['evidenceReference', 'documentationReference'].every((field) =>
      typeof input[field] === 'string' && IDENTIFIER_PATTERN.test(input[field]))
    && ['evidenceSha256', 'documentationSha256'].every((field) =>
      typeof input[field] === 'string' && /^[a-f0-9]{64}$/.test(input[field])));
  if (now !== undefined || capturedAt !== undefined) {
    valid(Number.isSafeInteger(now) && canonicalTime(capturedAt));
    const captured = Date.parse(capturedAt); const observed = Date.parse(input.observedAt);
    valid(observed <= captured && Date.parse(input.ownerAcceptedAt) <= captured
      && captured <= now && now - observed <= MAX_TIMING_READBACK_AGE_MS);
  }
  return Object.freeze(Object.fromEntries(PROVIDER_TIMING_FIELDS.map((field) => [field, input[field]])));
}

// Structural validation also serves historical settlement and rollback. A
// parseable numeric delay is not evidence that a provider timing rule is known.
function validateConfiguration(input) {
  const value = object(input, 'configuration');
  exactKeys(value, [
    'clientId', 'crmDealId', 'deploymentId', 'configurationVersion', 'approved', 'companyName',
    'companyDescription', 'businessHours', 'coverageMode', 'servicesHandled',
    'unsupportedServices', 'serviceArea', 'urgentConditions', 'callbackExpectation',
    'notificationRecipient', 'phoneSystemProvider', 'approvedTestRoute', 'noAnswerDelay',
    'forwardingAdministratorName', 'forwardingAdministratorMobile',
    'approvedFallbackDestination', 'approvedFallbackNumber', 'rollbackContactName',
    'rollbackContactMobile', 'rollbackInstructions', 'rollbackInstructionsVersion',
    'authorizedRepresentativeConfirmed', 'testScopeAccepted', 'authorityConfirmedAt',
    'setupFormSubmissionId', 'setupFormVersion', 'reportBaseline', 'notificationHandoff', 'providerTiming',
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
  const crmDealId = string(value.crmDealId, 'configuration.crmDealId', {
    maximum: 30, trim: false,
  });
  invariant(/^[1-9][0-9]{7,29}$/.test(crmDealId),
    'INVALID_SCHEMA', 'configuration.crmDealId must be a CRM record identifier.');
  const coverageMode = enumValue(value.coverageMode, COVERAGE_MODES,
    'configuration.coverageMode');
  const approvedTestRoute = enumValue(value.approvedTestRoute,
    COVERAGE_LABEL_TO_MODE,
    'configuration.approvedTestRoute');
  invariant(COVERAGE_LABEL_TO_MODE.get(approvedTestRoute) === coverageMode,
  'INVALID_SCHEMA', 'Approved test route does not match coverage mode.');
  const noAnswerDelay = value.noAnswerDelay === null || value.noAnswerDelay === undefined
    ? null : integer(value.noAnswerDelay, 'configuration.noAnswerDelay', 1, 120);
  const hasProviderTiming = value.providerTiming !== undefined;
  invariant(coverageMode === 'AfterHoursOnly' ? noAnswerDelay === null && !hasProviderTiming
    : hasProviderTiming ? noAnswerDelay === null : noAnswerDelay !== null,
    'INVALID_SCHEMA', 'No-answer delay does not match the approved route.');
  const fallbackNumber = value.approvedFallbackNumber === null
    || value.approvedFallbackNumber === undefined || value.approvedFallbackNumber === ''
    ? null : e164(value.approvedFallbackNumber, 'configuration.approvedFallbackNumber');
  const fallbackDestination = enumValue(value.approvedFallbackDestination,
    FALLBACK_DESTINATIONS, 'configuration.approvedFallbackDestination');
  invariant(NUMBERED_FALLBACKS.has(fallbackDestination)
    ? fallbackNumber !== null : fallbackNumber === null,
  'INVALID_SCHEMA', 'Fallback number does not match the approved destination.');
  const authorityConfirmedAt = string(value.authorityConfirmedAt,
    'configuration.authorityConfirmedAt', { maximum: 32, trim: false });
  invariant(Number.isFinite(Date.parse(authorityConfirmedAt)),
    'INVALID_SCHEMA', 'Authority confirmation timestamp is invalid.');
  const configuration = {
    clientId: identifier(value.clientId, 'configuration.clientId'),
    crmDealId,
    // These values are copied to verified CRM text fields capped at 100 characters.
    deploymentId: identifier(value.deploymentId, 'configuration.deploymentId', 100),
    configurationVersion: identifier(
      value.configurationVersion, 'configuration.configurationVersion', 100,
    ),
    approved: boolean(value.approved, 'configuration.approved'),
    companyName: string(value.companyName, 'configuration.companyName', { maximum: 120 }),
    companyDescription: optionalString(value.companyDescription, 'configuration.companyDescription', { maximum: 500 }),
    businessHours: string(value.businessHours, 'configuration.businessHours', { maximum: 500 }),
    coverageMode,
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
    ...(value.notificationHandoff === undefined ? {} : {
      notificationHandoff: validateNotificationHandoff(value.notificationHandoff, recipient),
    }),
    phoneSystemProvider: string(value.phoneSystemProvider,
      'configuration.phoneSystemProvider', { maximum: 120 }),
    approvedTestRoute,
    noAnswerDelay,
    forwardingAdministratorName: string(value.forwardingAdministratorName,
      'configuration.forwardingAdministratorName', { maximum: 120 }),
    forwardingAdministratorMobile: e164(value.forwardingAdministratorMobile,
      'configuration.forwardingAdministratorMobile'),
    approvedFallbackDestination: fallbackDestination,
    approvedFallbackNumber: fallbackNumber,
    rollbackContactName: string(value.rollbackContactName,
      'configuration.rollbackContactName', { maximum: 120 }),
    rollbackContactMobile: e164(value.rollbackContactMobile,
      'configuration.rollbackContactMobile'),
    rollbackInstructions: string(value.rollbackInstructions,
      'configuration.rollbackInstructions', { maximum: 1000 }),
    rollbackInstructionsVersion: identifier(value.rollbackInstructionsVersion,
      'configuration.rollbackInstructionsVersion'),
    authorizedRepresentativeConfirmed: boolean(value.authorizedRepresentativeConfirmed,
      'configuration.authorizedRepresentativeConfirmed'),
    testScopeAccepted: boolean(value.testScopeAccepted, 'configuration.testScopeAccepted'),
    authorityConfirmedAt,
    setupFormSubmissionId: identifier(value.setupFormSubmissionId,
      'configuration.setupFormSubmissionId'),
    setupFormVersion: identifier(value.setupFormVersion, 'configuration.setupFormVersion'),
    ...(Object.hasOwn(value, 'reportBaseline') ? { reportBaseline: validateReportBaseline(
      value.reportBaseline, { configurationVersion: value.configurationVersion, coverageMode },
    ) } : {}),
  };
  return Object.freeze({ ...configuration, ...(hasProviderTiming ? {
    providerTiming: validateProviderTimingBinding(value.providerTiming, configuration),
  } : {}) });
}

function assertExecutionTimingSupported(configuration) {
  // Only after-hours coverage has no no-answer timing dependency. Keep the
  // other modes parseable for history and owner-attested staging, but that
  // attestation alone never substitutes for actual originating-provider
  // configuration/activation evidence. New call execution remains contained.
  invariant(configuration?.coverageMode === 'AfterHoursOnly'
    && configuration.noAnswerDelay === null,
  'PROVIDER_TIMING_UNVERIFIED', 'Provider timing is not verified for this coverage mode.',
  { httpStatus: 409 });
}

function validateInboundPayload(input) {
  const value = object(input, 'inbound webhook');
  exactKeys(value, ['event', 'event_timestamp', 'call_inbound'], 'inbound webhook');
  invariant(value.event === 'call_inbound', 'INVALID_EVENT', 'Unsupported inbound event.');
  const inbound = object(value.call_inbound, 'inbound webhook.call_inbound');
  exactKeys(inbound, ['call_id', 'agent_id', 'agent_version', 'from_number', 'to_number', 'custom_sip_headers'], 'inbound webhook.call_inbound');
  // Retell may supply a preallocated call ID before the call exists. Validate
  // and discard it here: it is not admission, call completion, or ownership
  // evidence, and does not replace the existing signed receipt/metadata path.
  if (inbound.call_id !== undefined) identifier(inbound.call_id, 'inbound webhook.call_inbound.call_id');
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
    eventTimestamp: value.event_timestamp === undefined
      ? null : unixMillis(value.event_timestamp, 'inbound webhook.event_timestamp'),
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
  validateProviderTimingBinding,
  assertNotificationHandoffReady,
  assertExecutionTimingSupported,
  validateInboundPayload,
  validateEventEnvelope,
  validateOutcome,
  validateSourceRevision,
  E164_PATTERN,
  MAX_RETELL_CALL_DURATION_MS,
  RevenueDeskError,
};
