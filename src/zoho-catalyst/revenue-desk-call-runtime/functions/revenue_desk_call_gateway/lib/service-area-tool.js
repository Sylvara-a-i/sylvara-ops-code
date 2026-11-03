'use strict';

const { invariant } = require('./errors');
const { object, exactKeys, identifier, integer, unixMillis, e164, string } = require('./validation');
const { resolveServiceArea } = require('./service-area-resolution');
const { failedIndex } = require('./offline-postal-index');
const contract = Object.freeze(require('../contracts/service-area-tool-contract.json'));

const OWNERSHIP_METADATA_FIELDS = Object.freeze([
  'resolver_status', 'client_id', 'deployment_id', 'configuration_version_id',
  'configuration_version', 'engagement_type', 'capability_profile', 'coverage_mode',
  'number_binding_id', 'number_binding_version', 'correlation_id', 'resolved_at', 'ownership_token',
]);
const CALLER_QUESTIONS = new Set(['ask_city_and_state', 'ask_five_digit_zip',
  'ask_physical_service_location', 'confirm_service_city_state_and_zip',
  'confirm_service_city_and_approved_locality']);

function unavailableServiceArea() {
  return Object.freeze({ status: 'manual_review', reason: 'service_area_unavailable',
    nextAction: 'manual_review', postalConsistency: 'unknown',
    scope: 'service_area_only', municipalBoundaryVerified: false });
}

function validateServiceAreaCall(payload) {
  const value = object(payload, 'service-area tool');
  exactKeys(value, ['name', 'call', 'args'], 'service-area tool');
  invariant(value.name === contract.name, 'INVALID_SCHEMA', 'Unsupported service-area tool.');
  const args = object(value.args, 'service-area arguments');
  exactKeys(args, ['city', 'state', 'zip', 'addressKind'], 'service-area arguments');
  const caller = {};
  for (const field of ['city', 'state', 'zip']) {
    if (args[field] !== undefined && args[field] !== null) {
      caller[field] = string(args[field], field, { minimum: 0, maximum: field === 'city' ? 100 : 80 });
    }
  }
  if (args.addressKind !== undefined) {
    invariant(['physical', 'po_box', 'unknown'].includes(args.addressKind),
      'INVALID_SCHEMA', 'Service location kind is invalid.');
    caller.addressKind = args.addressKind;
  }
  const call = object(value.call, 'service-area call');
  invariant(call.call_type === 'phone_call' && call.direction === 'inbound' && call.call_status === 'ongoing',
    'CALL_OWNERSHIP_UNRESOLVED', 'Service-area lookup requires an ongoing inbound phone call.', { httpStatus: 403 });
  const source = object(call.metadata, 'service-area ownership metadata');
  const metadata = {};
  for (const field of OWNERSHIP_METADATA_FIELDS) {
    metadata[field] = string(source[field], 'service-area ownership field', { maximum: 256, trim: false });
  }
  // The provider call can contain a transcript and URLs. Never retain or return the call object.
  return Object.freeze({ caller: Object.freeze(caller), metadata: Object.freeze(metadata),
    callId: identifier(call.call_id, 'call identifier'),
    agentId: identifier(call.agent_id, 'call agent'),
    agentVersion: integer(call.agent_version, 'call agent version', 0, 1_000_000),
    toNumber: e164(call.to_number, 'called number'),
    startTimestamp: unixMillis(call.start_timestamp, 'call start') });
}

function serviceAreaDecision(configuration, caller, snapshot, asOf) {
  const confirmed = configuration.serviceAreaResolution;
  const index = confirmed && snapshot?.sha256 === confirmed.snapshotSha256
    ? snapshot.index : failedIndex('unavailable');
  const result = resolveServiceArea({ declaration: configuration.serviceArea,
    approvedCoverage: confirmed?.approvedCoverage, policy: confirmed?.policy,
    caller, postalIndex: index, asOf });
  const question = result.clarification.find((item) => CALLER_QUESTIONS.has(item));
  const status = result.status === 'needs_clarification' && !question ? 'manual_review' : result.status;
  // Only core-produced geography and fixed decision codes may cross back to the conversation.
  return Object.freeze({ status, reason: result.reasons[0],
    nextAction: status === 'needs_clarification' ? question
      : status === 'eligible' ? 'continue_intake' : status === 'ineligible' ? 'explain_out_of_area' : 'manual_review',
    postalConsistency: result.postalConsistency.status, scope: 'service_area_only',
    municipalBoundaryVerified: false,
    evaluatedLocation: Object.freeze({ city: result.evidence.caller.city,
      zip5: result.evidence.caller.zip.zip5, addressKind: result.evidence.caller.addressKind }) });
}

module.exports = { contract, OWNERSHIP_METADATA_FIELDS, validateServiceAreaCall,
  serviceAreaDecision, unavailableServiceArea };
