'use strict';

const crypto = require('node:crypto');
const { invariant } = require('revenue_desk_call_gateway/lib/errors');
const { keyedDigest, numberLookupKey } = require('revenue_desk_call_gateway/lib/security');
const { canonicalApprovalIntent, configurationSnapshotFingerprint, routeFromRows, routeFingerprint }
  = require('revenue_desk_call_gateway/lib/approval-control');
const { validateConfigurationVersionRow, REQUIRED_CONFIGURATION_FIELDS }
  = require('revenue_desk_call_gateway/lib/configuration-version');
const { prepareFreeTestConfiguration } = require('revenue_desk_call_gateway/lib/free-test-preparation');
const { deterministicIdempotencyKey, validateCommand } = require('./journey-core-service');

const PROFILE = 'free-test-configuration-staging-v1';
const SIGNATURE_DOMAIN = 'revenue-desk-configuration-staging-intent-v1\0';
const RECEIPT_KIND = 'configuration_staging';
const ROW_FIELDS = [...REQUIRED_CONFIGURATION_FIELDS, 'CONFIGURATION_VERSION_ID',
  'DEPLOYMENT_ID', 'CONFIGURATION_JSON', 'STATUS', 'APPROVAL_STATUS', 'SOURCE_ENVIRONMENT'];
const DEPLOYMENT_FIELDS = ['CLIENT_ID', 'DEPLOYMENT_ID', 'ACTIVE_CONFIGURATION_VERSION_ID',
  'NUMBER_LOOKUP_HASH', 'BINDING_ID', 'BINDING_VERSION', 'MONITOR_AGENT_ID', 'MONITOR_AGENT_VERSION',
  'COVERAGE_MODE', 'CALL_LIMIT', 'COUNT_VERSION', 'HANDLED_COUNT', 'SOURCE_REVISION', 'SOURCE_ENVIRONMENT'];
const BASELINE_FIELDS = ['Current_Call_Handling', 'Monthly_Inbound_Calls', 'Monthly_Inbound_Call_Band',
  'After_Hours_Call_Band', 'After_Hours_Call_Share', 'Estimated_Unanswered_Call_Rate',
  'Average_Job_Value', 'Average_Job_Value_Band', 'Current_Monthly_Answering_Cost'];
const MUTABLE_DEAL_FIELDS = new Set(['Modified_Time', 'Stage', 'Test_Status', 'Deployment_Record_ID',
  'Go_Live_Approval_Status', 'Go_Live_Approved_At', 'Approved_Configuration_Version',
  'Approved_Deployment_Record_ID', 'Test_Start_At', 'Test_End_At', 'Test_End_Reason',
  'Rollback_Completed_At', 'Reason_For_Loss__s']);

function exact(value, fields) {
  return value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonical(value[key])]));
  return value === undefined ? null : value;
}
function same(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
function requireState(condition, code = 'CONFIGURATION_STAGING_CONFLICT') {
  invariant(condition, code, 'Configuration staging requires exact authenticated state.', { httpStatus: 409 });
}
function sourceFingerprint(config, records, lineage, conversion) {
  const deal = Object.fromEntries(Object.entries(records.deal)
    .filter(([field]) => !MUTABLE_DEAL_FIELDS.has(field)));
  return keyedDigest(config.eventChainSecret, 'revenue-desk-configuration-source-v1',
    [JSON.stringify(canonical({ account: records.account, contact: records.contact, deal, lineage,
      conversion: Object.fromEntries(Object.entries(conversion).filter(([field]) => field !== 'observedAt')) }))]);
}
function coreCommand(request) {
  return { dealId: request.dealId, journeyId: request.journeyId,
    configurationVersionId: request.form2ConfigurationVersion,
    idempotencyKey: deterministicIdempotencyKey('approve', request.dealId,
      request.journeyId, request.form2ConfigurationVersion) };
}
function configurationDeploymentId(dealId, journeyId) {
  // DEPLOYMENT_ID is not provider-unique. Derive it from the same durable
  // workflow identity so concurrent journeys cannot share a caller-selected ID.
  return `cfgdeploy_${crypto.createHash('sha256')
    .update(JSON.stringify(['development', dealId, journeyId])).digest('hex')}`;
}
function configurationClaimKey(config, request) {
  return `cfgstage_${keyedDigest(config.eventChainSecret, PROFILE,
    [config.environment, request.dealId, request.journeyId])}`;
}
function assertStagedInactive(deployment) {
  requireState(deployment.TEST_STATUS === 'Ready for Approval'
    && deployment.GO_LIVE_APPROVAL_STATUS === 'Pending Internal Approval'
    && Number(deployment.COUNT_VERSION) === 0 && Number(deployment.HANDLED_COUNT) === 0
    && !deployment.APPROVAL_EVENT_KEY && !deployment.APPROVED_CONFIGURATION_VERSION_ID
    && !deployment.ACTIVATION_EVENT_KEY && !deployment.ACTUAL_START_AT && !deployment.EXPIRES_AT
    && !deployment.STOPPED_AT && !deployment.STOP_REASON,
  'CONFIGURATION_STAGING_STATE_ADVANCED');
}

/**
 * Sole-controller staging, never a provider or mail operation. Exact final
 * contents require an externally supplied owner signature in a distinct domain.
 * The old unapproved local review and normal go-live signatures cannot authorize
 * this operation. New rows are immutable; an interrupted claim requires visible
 * reconciliation, not another insertion or a newly generated action key.
 */
function createConfigurationStagingService({ config, store, crm, core, sourceReader, conversionReader,
  metadataReader, now = Date.now }) {
  requireState(config?.environment === 'development' && config.deploymentMode === 'active'
    && /^[a-f0-9]{40}$/.test(config.sourceRevision || '')
    && /^operator_[a-f0-9]{64}$/.test(config.operatorIdHash || '')
    && typeof config.operatorVerificationSecret === 'string' && config.operatorVerificationSecret.length >= 32
    && typeof crm?.getPreparationRecords === 'function'
    && typeof crm.getPublicOriginalLead === 'function'
    && typeof crm.recordConfigurationStaging === 'function'
    && typeof core?.readStagingSource === 'function'
    && typeof sourceReader?.findAssistedLineage === 'function'
    && typeof conversionReader?.readConversion === 'function', 'CONFIGURATION_STAGING_UNAVAILABLE');
  const tables = config.tables;
  const claimKey = (request) => configurationClaimKey(config, request);
  const deploymentKey = (request) => `cfgdeployment_${keyedDigest(config.eventChainSecret,
    'revenue-desk-configuration-deployment-v1', [config.environment, request.dealId, request.journeyId])}`;
  const digest = (data) => keyedDigest(config.eventChainSecret, 'revenue-desk-configuration-receipt-v1',
    [JSON.stringify(canonical(data))]);

  async function readLineage(journeyId) {
    // Only an authoritative absence may cross from the assisted path into the
    // public/native lookup. Invalid, ambiguous, or unavailable assisted state
    // rejects in the reader and can never be downgraded into a public match.
    const assisted = await sourceReader.findAssistedLineage(journeyId);
    return assisted === null ? crm.getPublicOriginalLead(journeyId) : assisted;
  }

  function lineageEvidenceAt(lineage) {
    const value = lineage?.submittedAt || lineage?.consumedAt;
    requireState(typeof value === 'string' && Number.isFinite(Date.parse(value)),
      'CONFIGURATION_SOURCE_LINEAGE_INVALID');
    if (lineage?.lineageType === 'public_native') {
      requireState(typeof lineage.consentAt === 'string' && Number.isFinite(Date.parse(lineage.consentAt))
        && Date.parse(lineage.consentAt) <= Date.parse(value) && Date.parse(value) <= now(),
      'CONFIGURATION_SOURCE_LINEAGE_INVALID');
    }
    return value;
  }

  function validateRequest(request) {
    requireState(exact(request, ['profile', 'dealId', 'journeyId', 'form2ConfigurationVersion',
      'review', 'configurationRow', 'deployment', 'intent', 'signature']) && request.profile === PROFILE,
    'INVALID_CONFIGURATION_STAGING_REQUEST');
    validateCommand('approve', coreCommand(request));
    const serialized = canonicalApprovalIntent(request.intent);
    const intent = request.intent;
    const at = now(); const requested = Date.parse(intent.requested_at);
    const observed = Date.parse(intent.evidence_observed_at);
    requireState(intent.action === 'approve' && intent.operator_id_hash === config.operatorIdHash
      && intent.evidence_revision === config.sourceRevision && intent.expected_deployment_version === 0
      && Number.isSafeInteger(at) && observed <= requested && requested <= at,
    'CONFIGURATION_STAGING_REVIEW_INVALID');
    requireState(/^v1=[a-f0-9]{64}$/.test(request.signature || ''), 'INVALID_APPROVAL_SIGNATURE');
    const expected = crypto.createHmac('sha256', config.operatorVerificationSecret)
      .update(SIGNATURE_DOMAIN).update(serialized).digest();
    requireState(crypto.timingSafeEqual(expected, Buffer.from(request.signature.slice(3), 'hex')),
      'INVALID_APPROVAL_SIGNATURE');
    const row = request.configurationRow; const deployment = request.deployment;
    requireState(exact(row, ROW_FIELDS) && exact(deployment, DEPLOYMENT_FIELDS));
    validateConfigurationVersionRow(row, { expectedEnvironment: config.environment,
      expectedSourceRevision: config.sourceRevision, expectedDeploymentId: intent.deployment_id });
    requireState(row.STATUS === 'Active' && row.APPROVAL_STATUS === 'Approved'
      && row.DEPLOYMENT_STATUS === 'Live' && row.GO_LIVE_APPROVAL_STATUS === 'Approved'
      && row.ENGAGEMENT_TYPE === 'free_test' && row.NUMBER_OWNERSHIP === 'dedicated_deployment'
      && row.CONFIGURATION_VERSION_ID === intent.configuration_version_id
      && intent.deployment_id === configurationDeploymentId(request.dealId, request.journeyId)
      && deployment.DEPLOYMENT_ID === intent.deployment_id
      && deployment.ACTIVE_CONFIGURATION_VERSION_ID === intent.configuration_version_id
      && deployment.SOURCE_REVISION === config.sourceRevision
      && deployment.SOURCE_ENVIRONMENT === config.environment
      && deployment.CALL_LIMIT === 25 && deployment.COUNT_VERSION === 0 && deployment.HANDLED_COUNT === 0
      && deployment.MONITOR_AGENT_ID === config.sharedAgentId
      && deployment.MONITOR_AGENT_VERSION === config.stagingAgentVersion
      && /^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/.test(config.retellPhoneNumber || '')
      && deployment.NUMBER_LOOKUP_HASH === numberLookupKey(config.numberSecret, config.retellPhoneNumber)
      && routeFingerprint(routeFromRows(deployment, row)) === intent.route_fingerprint);
    return digest({ request });
  }

  function parseClaim(row) {
    requireState(row && row.RECEIPT_KIND === RECEIPT_KIND && row.EVENT_TYPE === 'configuration_stage'
      && row.SOURCE_REVISION === config.sourceRevision && row.SOURCE_ENVIRONMENT === config.environment);
    let data; try { data = JSON.parse(row.EVENT_DATA_JSON); } catch (_) { requireState(false); }
    requireState(data?.profile === PROFILE && JSON.stringify(data) === row.EVENT_DATA_JSON
      && row.EVENT_KEY === claimKey(data)
      && row.PAYLOAD_FINGERPRINT === digest(data)
      && row.CONFIGURATION_VERSION_ID === data.configurationVersionId
      && row.DEPLOYMENT_ID === data.deploymentId && row.ROUTE_FINGERPRINT === data.routeFingerprint
      && row.RELATED_EVENT_KEY === (data.priorApproval?.eventKey || null)
      && row.RECEIVED_AT === data.createdAt && Number(row.ATTEMPT_COUNT) === 1
      && row.LAST_ERROR_CODE === null
      && (row.STATUS === 'Completed' ? Number(row.RECEIPT_VERSION) === 1 && row.PROCESSED_AT === data.createdAt
        : row.STATUS === 'Processing' && Number(row.RECEIPT_VERSION) === 0 && row.PROCESSED_AT === null));
    return data;
  }

  async function readSources(request, expectedDeploymentId) {
    const readAt = new Date(now()).toISOString();
    const [source, records, lineage] = await Promise.all([
      core.readStagingSource(coreCommand(request), { expectedDeploymentId }),
      crm.getPreparationRecords(request.dealId), readLineage(request.journeyId),
    ]);
    const evidenceAt = lineageEvidenceAt(lineage);
    requireState(source.deal.Modified_Time === records.deal.Modified_Time
      && records.deal.Intake_Submission_ID === lineage.journeyId
      && Date.parse(evidenceAt) <= Date.parse(source.bundle.session.VERIFIED_AT));
    const conversion = await readConversion(records, lineage);
    requireState(Date.parse(conversion.convertedAt) <= Date.parse(source.bundle.session.VERIFIED_AT),
      'CONFIGURATION_NATIVE_CONVERSION_UNVERIFIED');
    return { source, records, lineage, conversion, readAt };
  }

  async function readConversion(records, lineage) {
    const conversion = await conversionReader.readConversion(lineage.originalLeadId);
    requireState(conversion.originalLeadId === lineage.originalLeadId
      && conversion.journeyId === lineage.journeyId && conversion.accountId === records.account.id
      && conversion.contactId === records.contact.id && conversion.dealId === records.deal.id
      && Date.parse(conversion.convertedAt) >= Date.parse(lineageEvidenceAt(lineage))
      && Date.parse(conversion.observedAt) <= now() && now() - Date.parse(conversion.observedAt) <= 900_000,
    'CONFIGURATION_NATIVE_CONVERSION_UNVERIFIED');
    return conversion;
  }

  async function preparedInput(request, sources) {
    const { source, records, lineage } = sources;
    const capturedAt = request.intent.evidence_observed_at;
    // These relationships require either the consumed assisted writer or the
    // exact public/native Lead readback, followed by an independent native
    // conversion read and authenticated Form 2 evidence. Never fabricate links.
    const relationships = { leadId: lineage.originalLeadId, accountId: records.account.id,
      contactId: records.contact.id, dealId: records.deal.id, intakeSubmissionId: lineage.journeyId };
    const input = { classification: 'private-preparation', crm: records, review: request.review,
      evidence: { capturedAt, nativeConversion: relationships,
        recordVersions: Object.fromEntries(Object.entries(records).map(([key, row]) => [key, row.Modified_Time])),
        submission: source.bundle.submission, session: source.bundle.session, proof: source.bundle.proof } };
    if (request.review.reportBaseline !== undefined) {
      requireState(typeof metadataReader?.readMetadata === 'function', 'CRM_BASELINE_METADATA_UNVERIFIED');
      const spec = request.review.reportBaseline;
      requireState(exact(spec, ['sourcePeriod', 'currency', 'evidenceClass'])
        && spec.evidenceClass === 'customer_supplied_estimate', 'CRM_BASELINE_INVALID');
      const deal = Object.fromEntries(['id', 'Account_Name', 'Contact_Name', 'Modified_Time',
        'Configuration_Version', 'Intake_Submission_ID', 'Approved_Test_Route', ...BASELINE_FIELDS]
        .map((field) => [field, ['Account_Name', 'Contact_Name'].includes(field)
          ? { id: records.deal[field].id } : records.deal[field]]));
      const context = { clientKey: request.review.analyticsClientKey,
        deploymentKey: request.review.analyticsDeploymentKey,
        configurationVersionId: request.configurationRow.CONFIGURATION_VERSION_ID,
        configurationVersion: request.form2ConfigurationVersion, environment: config.environment,
        relationships, crmModifiedAt: deal.Modified_Time, approvedTestRoute: deal.Approved_Test_Route,
        ...spec };
      input.reportBaseline = { deal, context, metadata: await metadataReader.readMetadata(),
        evidence: { source: 'crm_selected_field_readback', clientKey: context.clientKey,
          deploymentKey: context.deploymentKey, configurationVersionId: context.configurationVersionId,
          configurationVersion: context.configurationVersion, environment: context.environment,
          relationships, crmModifiedAt: deal.Modified_Time, readAt: sources.readAt, capturedAt,
          sourcePeriod: spec.sourcePeriod, evidenceClass: spec.evidenceClass } };
    }
    return input;
  }

  async function readRows(data) {
    const [configurationRow, deployment] = await Promise.all([
      store.unique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID', data.configurationVersionId),
      store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_KEY', data.deploymentKey),
    ]);
    requireState(configurationSnapshotFingerprint(configurationRow) === data.configurationFingerprint
      && deployment?.DEPLOYMENT_ID === data.deploymentId
      && routeFingerprint(routeFromRows(deployment, configurationRow)) === data.routeFingerprint);
    return { configurationRow, deployment };
  }

  async function assertApprovalSource(command, state) {
    const receipt = await store.unique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', claimKey(command));
    // Only staging-owned rows require this new chain. Existing accepted rows
    // retain their previous approval contract and are not silently migrated.
    if (!receipt && !String(state.deployment?.DEPLOYMENT_KEY || '').startsWith('cfgdeployment_')
      && !String(state.deployment?.DEPLOYMENT_ID || '').startsWith('cfgdeploy_')) return null;
    const data = parseClaim(receipt);
    requireState(receipt.STATUS === 'Completed' && Number(receipt.RECEIPT_VERSION) === 1
      && data.deploymentId === command.deploymentId && data.configurationVersionId === command.configurationVersionId);
    await readRows(data);
    const [records, lineage] = await Promise.all([
      crm.getPreparationRecords(command.dealId), readLineage(command.journeyId),
    ]);
    const conversion = await readConversion(records, lineage);
    requireState(sourceFingerprint(config, records, lineage, conversion) === data.sourceFingerprint
      && records.deal.Modified_Time === state.deal.Modified_Time);
    // Before the CRM approval pointer has moved, revalidate the full historical
    // HMAC chain and its non-revoked core receipt, including interrupted replay.
    if (!records.deal.Approved_Deployment_Record_ID) {
      const current = await core.readStagingSource(coreCommand(data), { expectedDeploymentId: data.deploymentId });
      requireState(current.evidenceFingerprint === data.form2EvidenceFingerprint
        && same(current.priorApproval, data.priorApproval));
    }
    return Object.freeze({ configurationStaged: true,
      priorCoreApproval: data.priorApproval ? Object.freeze({
        configurationVersionId: data.priorApproval.configurationVersionId,
        approvedAt: data.priorApproval.approvedAt }) : null });
  }

  async function stage(request) {
    const requestFingerprint = validateRequest(request);
    const key = claimKey(request);
    const existing = await store.unique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', key);
    if (existing) {
      const data = parseClaim(existing);
      requireState(data.requestFingerprint === requestFingerprint);
      requireState(existing.STATUS === 'Completed', 'CONFIGURATION_STAGING_RECONCILIATION_REQUIRED');
      const state = await readRows(data);
      assertStagedInactive(state.deployment);
      state.deal = await crm.getDeal(data.dealId);
      await assertApprovalSource({ ...data, configurationVersionId: data.configurationVersionId }, state);
      return Object.freeze({ state: 'StagedInactive', replayed: true, approved: false, active: false,
        configurationVersionId: data.configurationVersionId, deploymentId: data.deploymentId });
    }
    // Expiry limits new authorization, not recovery of an exact completed
    // response. That read-only replay above still verifies the owner signature,
    // immutable receipt/request, current source and inactive deployment. A
    // partial claim never resumes here, and a fresh signature is a different
    // request rather than a way to replace the durable original authorization.
    const at = now(); const requested = Date.parse(request.intent.requested_at);
    const observed = Date.parse(request.intent.evidence_observed_at);
    requireState(Number.isSafeInteger(at) && requested <= at
      && at - requested <= 300_000 && at - observed <= 900_000,
    'CONFIGURATION_STAGING_REVIEW_INVALID');
    const sources = await readSources(request);
    const input = await preparedInput(request, sources);
    const prepared = prepareFreeTestConfiguration(input, { now: now(),
      preservedCoreApproval: sources.source.priorApproval });
    requireState(prepared.status === 'prepared_local_only' && prepared.unresolved.length === 0,
      prepared.unresolved[0] || 'CONFIGURATION_STAGING_PREPARATION_BLOCKED');
    const approvedCandidate = { ...prepared.candidate, approved: true,
      notificationRecipient: { ...prepared.candidate.notificationRecipient, approved: true } };
    requireState(request.configurationRow.CONFIGURATION_JSON === JSON.stringify(approvedCandidate)
      && request.configurationRow.CONFIGURATION_VERSION === request.form2ConfigurationVersion
      && request.review.configurationVersionId === request.configurationRow.CONFIGURATION_VERSION_ID
      && request.deployment.CLIENT_ID === approvedCandidate.clientId
      && request.deployment.DEPLOYMENT_ID === approvedCandidate.deploymentId
      && request.deployment.COVERAGE_MODE === approvedCandidate.coverageMode);
    const createdAt = new Date(now()).toISOString();
    const data = { profile: PROFILE, dealId: request.dealId, journeyId: request.journeyId,
      form2ConfigurationVersion: request.form2ConfigurationVersion,
      deploymentId: request.deployment.DEPLOYMENT_ID, deploymentKey: deploymentKey(request),
      configurationVersionId: request.configurationRow.CONFIGURATION_VERSION_ID,
      configurationFingerprint: configurationSnapshotFingerprint(request.configurationRow),
      routeFingerprint: request.intent.route_fingerprint, requestFingerprint, createdAt,
      sourceFingerprint: sourceFingerprint(config, sources.records, sources.lineage, sources.conversion),
      form2EvidenceFingerprint: sources.source.evidenceFingerprint, priorApproval: sources.source.priorApproval };
    requireState(!(await store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_KEY', data.deploymentKey))
      && !(await store.unique(tables.DEPLOYMENT_TABLE, 'NUMBER_LOOKUP_HASH', request.deployment.NUMBER_LOOKUP_HASH))
      && !(await store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', data.deploymentId))
      && !(await store.unique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID', data.configurationVersionId)));
    const row = { EVENT_KEY: key, RECEIPT_KIND, EVENT_TYPE: 'configuration_stage',
      EVENT_DATA_JSON: JSON.stringify(data), PAYLOAD_FINGERPRINT: digest(data),
      DEPLOYMENT_ID: data.deploymentId, CONFIGURATION_VERSION_ID: data.configurationVersionId,
      ROUTE_FINGERPRINT: data.routeFingerprint, RELATED_EVENT_KEY: data.priorApproval?.eventKey || null,
      STATUS: 'Processing', RECEIPT_VERSION: 0, ATTEMPT_COUNT: 1, LAST_ERROR_CODE: null,
      RECEIVED_AT: createdAt, PROCESSED_AT: null, SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: config.environment };
    const claimed = await store.insertUnique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', row,
      Object.keys(row).filter((field) => !['STATUS', 'RECEIPT_VERSION', 'PROCESSED_AT', 'LAST_ERROR_CODE'].includes(field)));
    parseClaim(claimed.row);
    requireState(claimed.inserted === true, 'CONFIGURATION_STAGING_RECONCILIATION_REQUIRED');
    // No multi-table transaction is promised. A crash leaves a durable blocked
    // claim and inactive rows. Readback never interprets a partial write as Live.
    await store.insertUnique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID',
      { ...request.configurationRow, CREATED_AT: createdAt, ACTIVATED_AT: null }, [...ROW_FIELDS, 'CREATED_AT', 'ACTIVATED_AT']);
    const deployment = { ...request.deployment, DEPLOYMENT_KEY: data.deploymentKey,
      APPROVED_CONFIGURATION_VERSION_ID: null, APPROVAL_EVENT_KEY: null,
      APPROVED_ROUTE_FINGERPRINT: null, GO_LIVE_APPROVED_AT: null, ACTIVATION_EVENT_KEY: null,
      TEST_STATUS: 'Ready for Approval', GO_LIVE_APPROVAL_STATUS: 'Pending Internal Approval',
      APPROVED_START_AT: null, ACTUAL_START_AT: null, EXPIRES_AT: null,
      COUNTED_CALL_KEYS_JSON: '[]', STOP_REASON: null, STOPPED_AT: null,
      REPORT_RECONCILIATION_STATUS: 'NotRequired', REPORT_RECONCILIATION_VERSION: 0, UPDATED_AT: createdAt };
    await store.insertUnique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_KEY', deployment, Object.keys(deployment));
    const fresh = await readSources(request);
    requireState(sourceFingerprint(config, fresh.records, fresh.lineage, fresh.conversion) === data.sourceFingerprint
      && fresh.source.evidenceFingerprint === data.form2EvidenceFingerprint
      && same(fresh.source.priorApproval, data.priorApproval));
    assertStagedInactive((await readRows(data)).deployment);
    await crm.recordConfigurationStaging(data.dealId, { deploymentId: data.deploymentId,
      expectedDeal: fresh.records.deal, priorApproval: data.priorApproval });
    const staged = await readSources(request, data.deploymentId);
    requireState(sourceFingerprint(config, staged.records, staged.lineage, staged.conversion) === data.sourceFingerprint
      && staged.source.evidenceFingerprint === data.form2EvidenceFingerprint);
    const patch = { STATUS: 'Completed', RECEIPT_VERSION: 1, PROCESSED_AT: createdAt, LAST_ERROR_CODE: null };
    const completed = await store.conditionalUpdate(tables.EVENT_RECEIPT_TABLE, claimed.row.ROWID, patch,
      { STATUS: 'Processing', RECEIPT_VERSION: 0, PAYLOAD_FINGERPRINT: row.PAYLOAD_FINGERPRINT });
    requireState(same(parseClaim(completed), data) && Object.entries(patch).every(([field, value]) =>
      typeof value === 'number' ? Number(completed[field]) === value : completed[field] === value),
    'CONFIGURATION_STAGING_RECONCILIATION_REQUIRED');
    return Object.freeze({ state: 'StagedInactive', replayed: false, approved: false, active: false,
      configurationVersionId: data.configurationVersionId, deploymentId: data.deploymentId });
  }
  return Object.freeze({ stage, assertApprovalSource });
}

module.exports = Object.freeze({ PROFILE, SIGNATURE_DOMAIN, RECEIPT_KIND,
  configurationClaimKey, configurationDeploymentId, createConfigurationStagingService });
