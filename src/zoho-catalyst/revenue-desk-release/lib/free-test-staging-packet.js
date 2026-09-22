'use strict';

const crypto = require('node:crypto');
const {
  canonicalApprovalIntent,
  configurationSnapshotFingerprint,
  routeFingerprint,
  routeFromRows,
} = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/approval-control');
const { RECONCILIATION_PROFILE, RECONCILIATION_SIGNATURE_DOMAIN, canonicalReconciliationIntent,
  successorConfigurationRow, successorDeployment, COMPLETION_PROFILE, COMPLETION_SIGNATURE_DOMAIN,
  canonicalCompletionIntent, completionConfigurationRow, completionDeployment }
  = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/configuration-reconciliation');
const {
  REQUIRED_CONFIGURATION_FIELDS,
  validateConfigurationVersionRow,
} = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/configuration-version');
const { invariant }
  = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/errors');
const { keyedDigest, numberLookupKey }
  = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/security');
const { prepareFreeTestConfiguration, MAX_READBACK_AGE_MS } = require('./free-test-preparation');

const PROFILE = 'free-test-configuration-staging-v1';
const SIGNATURE_DOMAIN = 'revenue-desk-configuration-staging-intent-v1\0';
const MAX_STAGING_PACKET_BYTES = 16_384;
const MIN_SECRET_CODE_UNITS = 32;
const MAX_SECRET_CODE_UNITS = 4096;
const MAX_SECRET_UTF8_BYTES = MAX_SECRET_CODE_UNITS * 3;
const BINDINGS_PROFILE = 'free-test-staging-bindings-v1';
// JSON escaping can use six bytes per secret code unit. Keep the protected
// three-key envelope bounded without excluding runtime-supported key bytes.
const MAX_BINDING_SECRET_BYTES = 65_536;
const BINDING_INPUT_FIELDS = Object.freeze([
  'schemaVersion', 'environment', 'crmOrganizationId', 'operatorIdentity',
  'testPhoneNumber', 'clientId', 'deploymentId',
]);
const BINDING_SECRET_FIELDS = Object.freeze([
  'numberSecret', 'eventChainSecret', 'analyticsPartitionSecret',
]);
const MAX_INTENT_AGE_MS = 5 * 60 * 1000;
const ENVELOPE_FIELDS = Object.freeze([
  'schemaVersion', 'preparation', 'preservedCoreApproval', 'request',
]);
const REQUEST_FIELDS = Object.freeze([
  'profile', 'dealId', 'journeyId', 'form2ConfigurationVersion', 'review',
  'configurationRow', 'deployment', 'intent',
]);
const ROW_FIELDS = Object.freeze([
  ...REQUIRED_CONFIGURATION_FIELDS,
  'CONFIGURATION_VERSION_ID', 'DEPLOYMENT_ID', 'CONFIGURATION_JSON',
  'STATUS', 'APPROVAL_STATUS', 'SOURCE_ENVIRONMENT',
]);
const DEPLOYMENT_FIELDS = Object.freeze([
  'CLIENT_ID', 'DEPLOYMENT_ID', 'ACTIVE_CONFIGURATION_VERSION_ID',
  'NUMBER_LOOKUP_HASH', 'BINDING_ID', 'BINDING_VERSION', 'MONITOR_AGENT_ID',
  'MONITOR_AGENT_VERSION', 'COVERAGE_MODE', 'CALL_LIMIT', 'COUNT_VERSION',
  'HANDLED_COUNT', 'SOURCE_REVISION', 'SOURCE_ENVIRONMENT',
]);
const REVIEW_FIELDS = Object.freeze([
  'callbackExpectation', 'clientId', 'configurationVersionId', 'countryCode',
  'deploymentId', 'dstPolicy', 'hoursExceptions', 'hoursSourceText',
  'notificationHandoff', 'notificationRecipientId', 'rollbackInstructions',
  'rollbackInstructionsVersion', 'serviceArea', 'serviceAreaSourceText', 'timeZone',
  'unsupportedServices', 'urgentConditions', 'urgentHandlingSourceText', 'weeklyHours',
]);
const REPORT_REVIEW_FIELDS = Object.freeze([
  'reportBaseline', 'analyticsClientKey', 'analyticsDeploymentKey',
]);
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const OPERATOR_PATTERN = /^operator_[a-f0-9]{64}$/;
const CRM_ID_PATTERN = /^[1-9][0-9]{7,29}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactObject(value, fields, code) {
  invariant(isPlainObject(value), code, 'Staging packet shape is invalid.');
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  invariant(actual.length === expected.length
    && actual.every((field, index) => field === expected[index]),
  code, 'Staging packet fields are invalid.');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateStagingBindingInput(input) {
  const code = 'INVALID_STAGING_BINDING_INPUT';
  exactObject(input, BINDING_INPUT_FIELDS, code);
  invariant(input.schemaVersion === 1 && input.environment === 'development'
    && typeof input.crmOrganizationId === 'string' && /^[1-9][0-9]{0,29}$/.test(input.crmOrganizationId)
    && typeof input.operatorIdentity === 'string' && input.operatorIdentity.length >= 3
    && input.operatorIdentity.length <= 256 && !/^<.*>$/.test(input.operatorIdentity)
    && typeof input.testPhoneNumber === 'string' && /^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/.test(input.testPhoneNumber)
    && typeof input.clientId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.clientId)
    && typeof input.deploymentId === 'string' && /^cfgdeploy_[a-f0-9]{64}$/.test(input.deploymentId),
  code, 'Staging binding context is invalid.');
  // Bind every derived value to the exact reviewed nonsecret inputs. No source
  // record, credential, authenticated readback or approval is created here.
  const boundInput = Object.fromEntries(BINDING_INPUT_FIELDS.map((key) => [key, input[key]]));
  return deepFreeze({ input: boundInput,
    inputSha256: crypto.createHash('sha256').update(JSON.stringify(boundInput), 'utf8').digest('hex') });
}

function deriveStagingBindings(input, { protectedInput } = {}) {
  const validated = validateStagingBindingInput(input);
  const code = 'INVALID_STAGING_BINDING_SECRETS';
  invariant(Buffer.isBuffer(protectedInput) && protectedInput.length > 0
    && protectedInput.length <= MAX_BINDING_SECRET_BYTES, code, 'Protected binding input is invalid.');
  let secrets;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(protectedInput);
    secrets = JSON.parse(text);
    // The accepted object has exactly three string values: six JSON string
    // tokens total (keys plus values). Any duplicate member necessarily adds
    // another key token, including an overwritten nonstring value. This keeps
    // PowerShell's valid escaping while refusing last-key-wins ambiguity.
    invariant((text.match(/"(?:[^"\\]|\\.)*"/gs) || []).length === 6,
      code, 'Protected binding input is invalid.');
  } catch (_) {
    invariant(false, code, 'Protected binding input is invalid.');
  }
  exactObject(secrets, BINDING_SECRET_FIELDS, code);
  for (const key of ['numberSecret', 'eventChainSecret']) {
    invariant(typeof secrets[key] === 'string' && secrets[key].length >= MIN_SECRET_CODE_UNITS
      && secrets[key].length <= MAX_SECRET_CODE_UNITS && !/^<.*>$/.test(secrets[key]),
    code, 'Protected binding input is invalid.');
  }
  invariant(typeof secrets.analyticsPartitionSecret === 'string'
    && /^\S{32,256}$/.test(secrets.analyticsPartitionSecret)
    && !/^<.*>$/.test(secrets.analyticsPartitionSecret)
    && new Set(BINDING_SECRET_FIELDS.map((key) => secrets[key])).size === BINDING_SECRET_FIELDS.length,
  code, 'Protected binding input is invalid.');
  const context = validated.input;
  // These domains/part ordering are the installed gateway, route-control and
  // analytics-outbox contracts. This is preparation, never a signing intent.
  const bindings = deepFreeze({ schemaVersion: 1, profile: BINDINGS_PROFILE,
    input: context, inputSha256: validated.inputSha256,
    NUMBER_LOOKUP_HASH: numberLookupKey(secrets.numberSecret, context.testPhoneNumber),
    expectedOperatorHash: `operator_${keyedDigest(secrets.eventChainSecret,
      'revenue-desk-route-control-operator-v1', [context.crmOrganizationId, context.operatorIdentity])}`,
    analyticsClientKey: keyedDigest(secrets.analyticsPartitionSecret,
      'revenue-desk-analytics-client-v1', [context.clientId]),
    analyticsDeploymentKey: keyedDigest(secrets.analyticsPartitionSecret,
      'revenue-desk-analytics-deployment-v1', [context.deploymentId]),
  });
  const serialized = `${JSON.stringify(bindings)}\n`;
  return deepFreeze({ bindings, serialized, byteLength: Buffer.byteLength(serialized, 'utf8'),
    sha256: crypto.createHash('sha256').update(serialized, 'utf8').digest('hex'), profile: BINDINGS_PROFILE });
}

function canonicalTimestamp(value, code) {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  invariant(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value,
    code, 'Staging packet timestamp is invalid.');
  return milliseconds;
}

function configurationDeploymentId(dealId, journeyId) {
  return `cfgdeploy_${crypto.createHash('sha256')
    .update(JSON.stringify(['development', dealId, journeyId])).digest('hex')}`;
}

function validatePreservedCoreApproval(value) {
  if (value === null) return null;
  exactObject(value, ['configurationVersionId', 'approvedAt'],
    'INVALID_STAGING_PREPARATION');
  invariant(typeof value.configurationVersionId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.configurationVersionId),
  'INVALID_STAGING_PREPARATION', 'Preserved approval identity is invalid.');
  canonicalTimestamp(value.approvedAt, 'INVALID_STAGING_PREPARATION');
  return Object.freeze({ ...value });
}

function validateContext({ expectedRevision, expectedOperatorHash, maxBodyBytes, now }) {
  invariant(typeof expectedRevision === 'string' && SHA_PATTERN.test(expectedRevision)
    && typeof expectedOperatorHash === 'string' && OPERATOR_PATTERN.test(expectedOperatorHash)
    && Number.isSafeInteger(now) && now >= 0
    && Number.isSafeInteger(maxBodyBytes) && maxBodyBytes >= 512
    && maxBodyBytes <= MAX_STAGING_PACKET_BYTES,
  'INVALID_STAGING_SIGNING_CONTEXT', 'Staging signing context is invalid.');
}

/**
 * Validate one complete, externally governed unsigned request. This helper is
 * deliberately not an evidence reader: the live controller must independently
 * re-read and authenticate every source before it creates any durable state.
 */
function validateUnsignedStagingEnvelope(envelope, {
  expectedRevision, expectedOperatorHash, maxBodyBytes, now = Date.now(),
}) {
  validateContext({ expectedRevision, expectedOperatorHash, maxBodyBytes, now });
  exactObject(envelope, ENVELOPE_FIELDS, 'INVALID_UNSIGNED_STAGING_ENVELOPE');
  invariant(envelope.schemaVersion === 1, 'INVALID_UNSIGNED_STAGING_ENVELOPE',
    'Unsigned staging envelope version is invalid.');
  const preparation = envelope.preparation;
  exactObject(preparation, Object.hasOwn(preparation || {}, 'reportBaseline')
    ? ['classification', 'crm', 'evidence', 'review', 'reportBaseline']
    : ['classification', 'crm', 'evidence', 'review'], 'INVALID_STAGING_PREPARATION');
  invariant(preparation.classification === 'private-preparation',
    'INVALID_STAGING_PREPARATION', 'Only governed private preparation is signable.');
  const preservedCoreApproval = validatePreservedCoreApproval(envelope.preservedCoreApproval);

  const request = envelope.request;
  exactObject(request, REQUEST_FIELDS, 'INVALID_UNSIGNED_STAGING_REQUEST');
  invariant(request.profile === PROFILE && !Object.hasOwn(request, 'signature'),
    'INVALID_UNSIGNED_STAGING_REQUEST', 'Unsigned staging request is invalid.');
  exactObject(request.review, [
    ...REVIEW_FIELDS,
    ...(Object.hasOwn(request.review || {}, 'providerTiming') ? ['providerTiming'] : []),
    ...(REPORT_REVIEW_FIELDS.some((field) => Object.hasOwn(request.review || {}, field))
      ? REPORT_REVIEW_FIELDS : []),
  ], 'INVALID_UNSIGNED_STAGING_REQUEST');
  invariant(CRM_ID_PATTERN.test(request.dealId || '')
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(request.journeyId || '')
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(request.form2ConfigurationVersion || ''),
  'INVALID_UNSIGNED_STAGING_REQUEST', 'Unsigned staging target is invalid.');
  invariant(same(request.review, preparation.review),
    'STAGING_PREPARATION_MISMATCH', 'Staging review does not match its preparation.');

  const prepared = prepareFreeTestConfiguration(preparation, {
    now, preservedCoreApproval: preservedCoreApproval || undefined,
  });
  invariant(prepared.status === 'prepared_local_only' && prepared.unresolved.length === 0
    && prepared.deploymentAuthorized === false && prepared.providerVerified === false
    && prepared.candidate?.approved === false
    && prepared.candidate.notificationRecipient?.approved === false,
  'STAGING_PREPARATION_BLOCKED', 'Staging preparation has unresolved requirements.');
  const candidate = prepared.candidate;
  const deal = preparation.crm?.deal;
  invariant(deal?.id === request.dealId && deal.Intake_Submission_ID === request.journeyId
    && deal.Configuration_Version === request.form2ConfigurationVersion
    && candidate.crmDealId === request.dealId
    && candidate.configurationVersion === request.form2ConfigurationVersion
    && candidate.deploymentId === configurationDeploymentId(request.dealId, request.journeyId),
  'STAGING_TARGET_MISMATCH', 'Staging target does not match the prepared source.');

  const row = request.configurationRow;
  const deployment = request.deployment;
  exactObject(row, ROW_FIELDS, 'INVALID_UNSIGNED_STAGING_REQUEST');
  exactObject(deployment, DEPLOYMENT_FIELDS, 'INVALID_UNSIGNED_STAGING_REQUEST');
  validateConfigurationVersionRow(row, {
    code: 'STAGING_TARGET_MISMATCH',
    expectedDeploymentId: candidate.deploymentId,
    expectedEnvironment: 'development',
    expectedSourceRevision: expectedRevision,
  });
  const approvedCandidate = {
    ...candidate,
    approved: true,
    notificationRecipient: { ...candidate.notificationRecipient, approved: true },
  };
  invariant(row.CONFIGURATION_JSON === JSON.stringify(approvedCandidate)
    && row.CONFIGURATION_VERSION_ID === request.review.configurationVersionId
    && row.CONFIGURATION_VERSION === request.form2ConfigurationVersion
    && row.STATUS === 'Active' && row.APPROVAL_STATUS === 'Approved'
    && row.DEPLOYMENT_STATUS === 'Live' && row.GO_LIVE_APPROVAL_STATUS === 'Approved'
    && row.ENGAGEMENT_TYPE === 'free_test' && row.CAPABILITY_PROFILE === 'call_gap_monitor_v1'
    && row.PLAN_TIER === 'none'
    && row.LIMIT_POLICY === 'seven_calendar_days_or_25_connected_calls_v1'
    && row.BILLING_MODE === 'none' && row.NUMBER_OWNERSHIP === 'dedicated_deployment'
    && row.ENVIRONMENT === 'development' && row.SOURCE_ENVIRONMENT === 'development'
    && !Object.hasOwn(row, 'ROWID') && !Object.hasOwn(row, 'CREATED_AT')
    && !Object.hasOwn(row, 'ACTIVATED_AT'),
  'STAGING_CONTENT_MISMATCH', 'Staging content is not the exact approved candidate.');

  invariant(deployment.CLIENT_ID === candidate.clientId
    && deployment.DEPLOYMENT_ID === candidate.deploymentId
    && deployment.ACTIVE_CONFIGURATION_VERSION_ID === row.CONFIGURATION_VERSION_ID
    && /^num_[a-f0-9]{64}$/.test(deployment.NUMBER_LOOKUP_HASH || '')
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(deployment.BINDING_ID || '')
    && Number.isSafeInteger(deployment.BINDING_VERSION) && deployment.BINDING_VERSION >= 1
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(deployment.MONITOR_AGENT_ID || '')
    && Number.isSafeInteger(deployment.MONITOR_AGENT_VERSION)
    && deployment.MONITOR_AGENT_VERSION >= 1
    && deployment.COVERAGE_MODE === candidate.coverageMode
    && deployment.CALL_LIMIT === 25 && deployment.COUNT_VERSION === 0
    && deployment.HANDLED_COUNT === 0 && deployment.SOURCE_REVISION === expectedRevision
    && deployment.SOURCE_ENVIRONMENT === 'development',
  'STAGING_TARGET_MISMATCH', 'Staging deployment is not the exact inactive target.');

  const canonicalIntent = canonicalApprovalIntent(request.intent);
  const intent = request.intent;
  const observedAt = canonicalTimestamp(intent.evidence_observed_at,
    'INVALID_STAGING_INTENT');
  const requestedAt = canonicalTimestamp(intent.requested_at, 'INVALID_STAGING_INTENT');
  invariant(intent.action === 'approve' && intent.operator_id_hash === expectedOperatorHash
    && intent.evidence_revision === expectedRevision && intent.expected_deployment_version === 0
    && intent.deployment_id === deployment.DEPLOYMENT_ID
    && intent.configuration_version_id === row.CONFIGURATION_VERSION_ID
    && intent.evidence_observed_at === preparation.evidence?.capturedAt
    && observedAt <= requestedAt && requestedAt <= now
    && now - requestedAt <= MAX_INTENT_AGE_MS && now - observedAt <= MAX_READBACK_AGE_MS,
  'INVALID_STAGING_INTENT', 'Staging intent is stale or does not match its target.');
  const expectedRouteFingerprint = routeFingerprint(routeFromRows(deployment, row));
  invariant(intent.route_fingerprint === expectedRouteFingerprint,
    'STAGING_CONTENT_MISMATCH', 'Staging intent does not bind the exact route.');

  // The runtime accepts a configurable limit below its hard ceiling. Project
  // the exact signature width before owner key entry; never assume the maximum
  // supported setting is the value installed in Development.
  const projectedBytes = Buffer.byteLength(`${JSON.stringify({
    ...request, signature: `v1=${'0'.repeat(64)}`,
  })}\n`, 'utf8');
  invariant(projectedBytes <= maxBodyBytes, 'STAGING_PACKET_TOO_LARGE',
    'Signed staging packet exceeds the verified route body limit.');

  return deepFreeze({
    packet: structuredClone(request),
    canonicalIntent,
    sourceRevision: expectedRevision,
    maxBodyBytes,
    profile: PROFILE,
  });
}

function decodeSigningSecret(secret) {
  invariant(Buffer.isBuffer(secret) && secret.length <= MAX_SECRET_UTF8_BYTES,
    'INVALID_STAGING_SIGNING_SECRET', 'Owner signing key is invalid.');
  let secretText;
  try {
    // Preserve a leading U+FEFF as secret content and reject malformed UTF-8;
    // Node's runtime HMAC encodes the resulting JavaScript string as UTF-8.
    secretText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(secret);
  } catch (_) {
    invariant(false, 'INVALID_STAGING_SIGNING_SECRET', 'Owner signing key is invalid.');
  }
  invariant(secretText.length >= MIN_SECRET_CODE_UNITS
    && secretText.length <= MAX_SECRET_CODE_UNITS
    && !/^<.*>$/.test(secretText),
  'INVALID_STAGING_SIGNING_SECRET', 'Owner signing key is invalid.');
  return secretText;
}

/**
 * Validate preserved historical staging separately from fresh recovery intent.
 * Claim/request HMAC fingerprints are only shape-checked here: the sole live
 * controller must authenticate the durable receipt and exact reconciled state.
 */
function validateUnsignedReconciliationEnvelope(envelope, {
  expectedRevision, expectedOperatorHash, maxBodyBytes, now = Date.now(),
}) {
  validateContext({ expectedRevision, expectedOperatorHash, maxBodyBytes, now });
  exactObject(envelope, ['schemaVersion', 'originalEnvelope', 'request'],
    'INVALID_UNSIGNED_RECONCILIATION_ENVELOPE');
  invariant(envelope.schemaVersion === 1, 'INVALID_UNSIGNED_RECONCILIATION_ENVELOPE',
    'Unsigned reconciliation envelope version is invalid.');
  const request = envelope.request;
  exactObject(request, ['profile', 'originalRequest', 'intent'], 'INVALID_UNSIGNED_RECONCILIATION_REQUEST');
  invariant(request.profile === RECONCILIATION_PROFILE, 'INVALID_UNSIGNED_RECONCILIATION_REQUEST',
    'Unsigned reconciliation request is invalid.');
  const original = request.originalRequest;
  exactObject(original, [...REQUEST_FIELDS, 'signature'], 'INVALID_UNSIGNED_RECONCILIATION_REQUEST');
  invariant(typeof original.signature === 'string' && /^v1=[a-f0-9]{64}$/.test(original.signature),
    'INVALID_APPROVAL_SIGNATURE', 'Original staging signature is invalid.');
  const historicalAt = canonicalTimestamp(original.intent?.requested_at, 'INVALID_STAGING_INTENT');
  const originalRevision = original.intent?.evidence_revision;
  const historical = validateUnsignedStagingEnvelope(envelope.originalEnvelope, {
    expectedRevision: originalRevision, expectedOperatorHash, maxBodyBytes, now: historicalAt,
  });
  const unsignedOriginal = Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'signature'));
  invariant(same(unsignedOriginal, historical.packet), 'STAGING_PREPARATION_MISMATCH',
    'Original request does not match its historical preparation.');
  const intent = request.intent;
  const canonicalIntent = canonicalReconciliationIntent(intent);
  const requestedAt = canonicalTimestamp(intent.requested_at, 'INVALID_STAGING_INTENT');
  const observedAt = canonicalTimestamp(intent.evidence_observed_at, 'INVALID_STAGING_INTENT');
  const row = successorConfigurationRow(original, intent.original_claim_key, expectedRevision);
  const deployment = successorDeployment(original, intent.original_claim_key, expectedRevision);
  invariant(intent.operator_id_hash === expectedOperatorHash
    && intent.target_source_revision === expectedRevision && intent.original_source_revision === originalRevision
    && intent.original_configuration_version_id === original.configurationRow.CONFIGURATION_VERSION_ID
    && intent.original_configuration_fingerprint === configurationSnapshotFingerprint(original.configurationRow)
    && intent.deployment_id === original.deployment.DEPLOYMENT_ID
    && intent.configuration_version_id === row.CONFIGURATION_VERSION_ID
    && intent.route_fingerprint === routeFingerprint(routeFromRows(deployment, row))
    && historicalAt <= observedAt && observedAt <= requestedAt && requestedAt <= now
    && now - requestedAt <= MAX_INTENT_AGE_MS && now - observedAt <= MAX_READBACK_AGE_MS,
  'INVALID_STAGING_INTENT', 'Reconciliation intent is stale or does not match its target.');
  const projectedBytes = Buffer.byteLength(`${JSON.stringify({
    ...request, signature: `v1=${'0'.repeat(64)}`,
  })}\n`, 'utf8');
  invariant(projectedBytes <= maxBodyBytes, 'STAGING_PACKET_TOO_LARGE',
    'Signed reconciliation packet exceeds the verified route body limit.');
  return deepFreeze({ packet: structuredClone(request), canonicalIntent,
    originalCanonicalIntent: historical.canonicalIntent, sourceRevision: expectedRevision,
    maxBodyBytes, profile: RECONCILIATION_PROFILE, durableEvidenceAuthenticated: false });
}

function signFreeTestReconciliationPacket(envelope, {
  secret, expectedRevision, expectedOperatorHash, maxBodyBytes, now = Date.now(),
}) {
  const secretText = decodeSigningSecret(secret);
  const validated = validateUnsignedReconciliationEnvelope(envelope, {
    expectedRevision, expectedOperatorHash, maxBodyBytes, now,
  });
  const expectedOriginal = crypto.createHmac('sha256', secretText).update(SIGNATURE_DOMAIN, 'utf8')
    .update(validated.originalCanonicalIntent, 'utf8').digest();
  invariant(crypto.timingSafeEqual(expectedOriginal,
    Buffer.from(validated.packet.originalRequest.signature.slice(3), 'hex')),
  'INVALID_APPROVAL_SIGNATURE', 'Original staging signature could not be verified.');
  const signature = `v1=${crypto.createHmac('sha256', secretText)
    .update(RECONCILIATION_SIGNATURE_DOMAIN, 'utf8').update(validated.canonicalIntent, 'utf8').digest('hex')}`;
  const packet = deepFreeze({ ...validated.packet, signature });
  const serialized = `${JSON.stringify(packet)}\n`;
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  invariant(byteLength <= maxBodyBytes, 'STAGING_PACKET_TOO_LARGE',
    'Signed reconciliation packet exceeds the verified route body limit.');
  return deepFreeze({ packet, serialized, byteLength,
    sha256: crypto.createHash('sha256').update(serialized, 'utf8').digest('hex'),
    sourceRevision: expectedRevision, maxBodyBytes, profile: RECONCILIATION_PROFILE });
}

/**
 * Preserve the two signed historical requests while binding one completion to
 * the freshly observed inactive deployment. Durable receipt/deployment hashes
 * remain unverified until the sole controller independently reads those rows.
 */
function validateUnsignedCompletionEnvelope(envelope, {
  expectedRevision, expectedOperatorHash, maxBodyBytes, now = Date.now(),
}) {
  validateContext({ expectedRevision, expectedOperatorHash, maxBodyBytes, now });
  exactObject(envelope, ['schemaVersion', 'reconciliationEnvelope', 'request'],
    'INVALID_UNSIGNED_COMPLETION_ENVELOPE');
  invariant(envelope.schemaVersion === 1, 'INVALID_UNSIGNED_COMPLETION_ENVELOPE',
    'Unsigned completion envelope version is invalid.');
  const request = envelope.request;
  exactObject(request, ['profile', 'reconciliationRequest', 'intent'], 'INVALID_UNSIGNED_COMPLETION_REQUEST');
  invariant(request.profile === COMPLETION_PROFILE, 'INVALID_UNSIGNED_COMPLETION_REQUEST',
    'Unsigned completion request is invalid.');
  const reconciliation = request.reconciliationRequest;
  exactObject(reconciliation, ['profile', 'originalRequest', 'intent', 'signature'],
    'INVALID_UNSIGNED_COMPLETION_REQUEST');
  invariant(typeof reconciliation.signature === 'string' && /^v1=[a-f0-9]{64}$/.test(reconciliation.signature),
    'INVALID_APPROVAL_SIGNATURE', 'Preserved reconciliation signature is invalid.');
  const historicalAt = canonicalTimestamp(reconciliation.intent?.requested_at, 'INVALID_STAGING_INTENT');
  const reconciliationRevision = reconciliation.intent?.target_source_revision;
  const historical = validateUnsignedReconciliationEnvelope(envelope.reconciliationEnvelope, {
    expectedRevision: reconciliationRevision, expectedOperatorHash, maxBodyBytes, now: historicalAt,
  });
  const unsignedReconciliation = Object.fromEntries(Object.entries(reconciliation)
    .filter(([key]) => key !== 'signature'));
  invariant(same(unsignedReconciliation, historical.packet), 'STAGING_PREPARATION_MISMATCH',
    'Preserved reconciliation does not match its historical preparation.');
  const intent = request.intent;
  const canonicalIntent = canonicalCompletionIntent(intent);
  const requestedAt = canonicalTimestamp(intent.requested_at, 'INVALID_STAGING_INTENT');
  const observedAt = canonicalTimestamp(intent.evidence_observed_at, 'INVALID_STAGING_INTENT');
  const reconciledRow = successorConfigurationRow(reconciliation.originalRequest,
    reconciliation.intent.original_claim_key, reconciliationRevision);
  const row = completionConfigurationRow(reconciliation, intent.reconciliation_claim_key, expectedRevision);
  const deployment = completionDeployment(reconciliation, intent.reconciliation_claim_key, expectedRevision);
  invariant(intent.operator_id_hash === expectedOperatorHash
    && intent.target_source_revision === expectedRevision
    && intent.original_claim_key === reconciliation.intent.original_claim_key
    && intent.original_claim_fingerprint === reconciliation.intent.original_claim_fingerprint
    && intent.original_source_revision === reconciliation.intent.original_source_revision
    && intent.original_configuration_fingerprint === reconciliation.intent.original_configuration_fingerprint
    && intent.reconciliation_source_revision === reconciliationRevision
    && intent.reconciled_configuration_version_id === reconciledRow.CONFIGURATION_VERSION_ID
    && intent.reconciled_configuration_fingerprint === configurationSnapshotFingerprint(reconciledRow)
    && intent.deployment_id === deployment.DEPLOYMENT_ID
    && intent.configuration_version_id === row.CONFIGURATION_VERSION_ID
    && intent.configuration_fingerprint === configurationSnapshotFingerprint(row)
    && intent.route_fingerprint === routeFingerprint(routeFromRows(deployment, row))
    && historicalAt <= observedAt && observedAt <= requestedAt && requestedAt <= now
    && now - requestedAt <= MAX_INTENT_AGE_MS && now - observedAt <= MAX_READBACK_AGE_MS,
  'INVALID_STAGING_INTENT', 'Completion intent is stale or does not match its target.');
  const projectedBytes = Buffer.byteLength(`${JSON.stringify({
    ...request, signature: `v1=${'0'.repeat(64)}`,
  })}\n`, 'utf8');
  invariant(projectedBytes <= maxBodyBytes, 'STAGING_PACKET_TOO_LARGE',
    'Signed completion packet exceeds the verified route body limit.');
  return deepFreeze({ packet: structuredClone(request), canonicalIntent,
    originalCanonicalIntent: historical.originalCanonicalIntent,
    reconciliationCanonicalIntent: historical.canonicalIntent, sourceRevision: expectedRevision,
    maxBodyBytes, profile: COMPLETION_PROFILE, durableEvidenceAuthenticated: false });
}

function signFreeTestCompletionPacket(envelope, {
  secret, expectedRevision, expectedOperatorHash, maxBodyBytes, now = Date.now(),
}) {
  const secretText = decodeSigningSecret(secret);
  const validated = validateUnsignedCompletionEnvelope(envelope, {
    expectedRevision, expectedOperatorHash, maxBodyBytes, now,
  });
  const reconciliation = validated.packet.reconciliationRequest;
  for (const [domain, intent, signature] of [
    [SIGNATURE_DOMAIN, validated.originalCanonicalIntent, reconciliation.originalRequest.signature],
    [RECONCILIATION_SIGNATURE_DOMAIN, validated.reconciliationCanonicalIntent, reconciliation.signature],
  ]) {
    const expected = crypto.createHmac('sha256', secretText).update(domain, 'utf8').update(intent, 'utf8').digest();
    invariant(crypto.timingSafeEqual(expected, Buffer.from(signature.slice(3), 'hex')),
      'INVALID_APPROVAL_SIGNATURE', 'Preserved request signature could not be verified.');
  }
  const signature = `v1=${crypto.createHmac('sha256', secretText)
    .update(COMPLETION_SIGNATURE_DOMAIN, 'utf8').update(validated.canonicalIntent, 'utf8').digest('hex')}`;
  const packet = deepFreeze({ ...validated.packet, signature });
  const serialized = `${JSON.stringify(packet)}\n`;
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  invariant(byteLength <= maxBodyBytes, 'STAGING_PACKET_TOO_LARGE',
    'Signed completion packet exceeds the verified route body limit.');
  return deepFreeze({ packet, serialized, byteLength,
    sha256: crypto.createHash('sha256').update(serialized, 'utf8').digest('hex'),
    sourceRevision: expectedRevision, maxBodyBytes, profile: COMPLETION_PROFILE });
}

function signFreeTestStagingPacket(envelope, {
  secret, expectedRevision, expectedOperatorHash, maxBodyBytes, now = Date.now(),
}) {
  const secretText = decodeSigningSecret(secret);
  const validated = validateUnsignedStagingEnvelope(envelope, {
    expectedRevision, expectedOperatorHash, maxBodyBytes, now,
  });
  const signature = `v1=${crypto.createHmac('sha256', secretText)
    .update(SIGNATURE_DOMAIN, 'utf8').update(validated.canonicalIntent, 'utf8').digest('hex')}`;
  const packet = deepFreeze({ ...validated.packet, signature });
  const serialized = `${JSON.stringify(packet)}\n`;
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  invariant(byteLength <= validated.maxBodyBytes,
    'STAGING_PACKET_TOO_LARGE', 'Signed staging packet exceeds the verified route body limit.');
  return deepFreeze({
    packet,
    serialized,
    byteLength,
    sha256: crypto.createHash('sha256').update(serialized, 'utf8').digest('hex'),
    sourceRevision: expectedRevision,
    maxBodyBytes: validated.maxBodyBytes,
    profile: PROFILE,
  });
}

module.exports = Object.freeze({
  PROFILE,
  SIGNATURE_DOMAIN,
  MAX_STAGING_PACKET_BYTES,
  MIN_SECRET_CODE_UNITS,
  MAX_SECRET_CODE_UNITS,
  MAX_SECRET_UTF8_BYTES,
  BINDINGS_PROFILE,
  MAX_BINDING_SECRET_BYTES,
  validateStagingBindingInput,
  deriveStagingBindings,
  validateUnsignedStagingEnvelope,
  signFreeTestStagingPacket,
  RECONCILIATION_PROFILE,
  validateUnsignedReconciliationEnvelope,
  signFreeTestReconciliationPacket,
  COMPLETION_PROFILE,
  validateUnsignedCompletionEnvelope,
  signFreeTestCompletionPacket,
});
