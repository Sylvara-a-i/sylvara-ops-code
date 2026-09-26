'use strict';

const { PROFILE, requireSuccessor: check, evidenceDigest, canonical, successorPlanDigest,
  successorIdentity, verifySuccessorIntent, projectInactiveSuccessor }
  = require('revenue_desk_call_gateway/lib/configuration-successor');
const { keyedDigest, numberLookupKey } = require('revenue_desk_call_gateway/lib/security');
const { configurationSnapshotFingerprint, routeFingerprint, routeFromRows }
  = require('revenue_desk_call_gateway/lib/approval-control');
const { inactiveDeploymentFingerprint } = require('revenue_desk_call_gateway/lib/configuration-reconciliation');

const RECEIPT_KIND = 'configuration_successor';
const MUTABLE_DEAL = new Set(['Modified_Time', 'Stage', 'Test_Status', 'Go_Live_Approval_Status',
  'Go_Live_Approved_At', 'Approved_Deployment_Record_ID', 'Approved_Configuration_Version']);
const HISTORY_FIELDS = ['EVENT_KEY', 'RECEIPT_KIND', 'EVENT_TYPE', 'EVENT_DATA_JSON', 'PAYLOAD_FINGERPRINT',
  'DEPLOYMENT_ID', 'CONFIGURATION_VERSION_ID', 'ROUTE_FINGERPRINT', 'RELATED_EVENT_KEY', 'STATUS',
  'RECEIPT_VERSION', 'ATTEMPT_COUNT', 'LAST_ERROR_CODE', 'RECEIVED_AT', 'PROCESSED_AT',
  'SOURCE_REVISION', 'SOURCE_ENVIRONMENT'];
const FORM2_FIELDS = ['ROWID', 'SESSION_ROW_ID', 'CRM_DEAL_ID', 'CRM_ACCOUNT_ID', 'CRM_CONTACT_ID',
  'STATUS', 'LAST_OUTCOME', 'SUCCEEDED_AT', 'SUBMITTED_AT', 'VERIFIED_AT', 'CONSUMED_AT',
  'HANDLE_CONSUMED_AT', 'REVOKED_AT', 'FAILED_AT', 'EXPIRED_AT', 'RECONCILIATION_REQUIRED_AT',
  'SOURCE_REVISION', 'SOURCE_ENVIRONMENT'];
const project = (row, fields) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));

function historyDigest(rows) {
  check(Array.isArray(rows) && rows.length > 0 && rows.length < 100
    && new Set(rows.map((row) => row.EVENT_KEY)).size === rows.length);
  return evidenceDigest(rows.map((row) => project(row, HISTORY_FIELDS))
    .sort((a, b) => a.EVENT_KEY.localeCompare(b.EVENT_KEY)));
}

/** No old secret or old signature is accepted as a new trust anchor. The explicit
 * owner pin is installed separately after private reconciliation of these records.
 * Historical HMAC fields stay in their original rows; source evidence below omits them.
 */
function sourceSnapshotDigest(records, lineage, conversion, bundle) {
  const deal = Object.fromEntries(Object.entries(records.deal).filter(([key]) => !MUTABLE_DEAL.has(key)));
  const { observedAt: _observed, ...native } = conversion;
  const { submissionFingerprint: _oldMac, ...intake } = lineage;
  return evidenceDigest({ records: { ...records, deal }, lineage: intake, conversion: native,
    form2: Object.fromEntries(['submission', 'prefill', 'session', 'proof']
      .map((key) => [key, project(bundle[key], FORM2_FIELDS)])) });
}

function createConfigurationSuccessorService({ config, store, crm, sourceReader, conversionReader,
  evidenceStore, now = Date.now }) {
  check(config?.environment === 'development' && config.deploymentMode === 'active'
    && store && crm && typeof crm.recordConfigurationSuccessor === 'function'
    && sourceReader && conversionReader && evidenceStore);
  const tables = config.tables;
  const mac = (data) => keyedDigest(config.eventChainSecret, 'revenue-desk-successor-receipt-v1',
    [JSON.stringify(canonical(data))]);

  async function sources(plan, previous) {
    const [records, lineage] = await Promise.all([crm.getPreparationRecords(plan.deal_id),
      sourceReader.findAssistedLineage(plan.journey_id)]);
    // This release is deliberately limited to the already accepted supervised,
    // assisted lineage. It is not a new public-intake or arbitrary migration API.
    check(lineage && lineage.journeyId === plan.journey_id);
    const match = /^form2cfgv1:([1-9][0-9]{0,29}):([a-f0-9]{40})$/.exec(records.deal.Configuration_Version || '');
    check(match);
    const [conversion, bundle] = await Promise.all([
      conversionReader.readConversion(lineage.originalLeadId), evidenceStore.readBundle(match[1]),
    ]);
    const value = JSON.parse(previous.CONFIGURATION_JSON);
    const deal = records.deal;
    check(deal.id === plan.deal_id && deal.Intake_Submission_ID === plan.journey_id
      && deal.Account_Name?.id === records.account.id && deal.Contact_Name?.id === records.contact.id
      && records.contact.Account_Name?.id === records.account.id
      && conversion.originalLeadId === lineage.originalLeadId && conversion.journeyId === plan.journey_id
      && conversion.accountId === records.account.id && conversion.contactId === records.contact.id
      && conversion.dealId === plan.deal_id && Date.parse(conversion.observedAt) <= now()
      && now() - Date.parse(conversion.observedAt) <= 900_000
      && Date.parse(lineage.consumedAt) <= Date.parse(conversion.convertedAt)
      && records.account.Account_Name === value.companyName
      && deal.Setup_Access_Status === 'Submitted' && deal.Authorized_Representative_Confirmed === true
      && deal.Test_Scope_Accepted === true && deal.Setup_Form_Submission_ID === value.setupFormSubmissionId
      && deal.Setup_Form_Version === value.setupFormVersion && deal.Configuration_Version === value.configurationVersion
      && deal.Deployment_Record_ID === plan.deployment_id && deal.Stage === 'Setup and QA'
      && !deal.Test_Start_At && !deal.Test_End_At && !deal.Test_End_Reason
      && !deal.Rollback_Completed_At && !deal.Billing_Subscription_ID
      && deal.Alert_Recipient_Email === value.notificationRecipient.email
      && deal.Alert_Recipient_Name === value.notificationRecipient.name
      && deal.Urgent_Call_Handling === 'Alert + Capture Callback'
      && deal.Existing_Customer_Call_Handling === 'Alert + Capture Callback');
    check(['submission', 'session', 'prefill', 'proof'].every((key) => bundle[key]
      && bundle[key].SOURCE_REVISION === match[2] && bundle[key].SOURCE_ENVIRONMENT === 'development'
      && !bundle[key].REVOKED_AT && !bundle[key].FAILED_AT && !bundle[key].RECONCILIATION_REQUIRED_AT)
      && String(bundle.submission.ROWID) === match[1] && bundle.submission.STATUS === 'succeeded'
      && bundle.session.STATUS === 'submitted' && bundle.prefill.STATUS === 'submitted'
      && bundle.proof.STATUS === 'consumed'
      && bundle.session.CRM_DEAL_ID === plan.deal_id && bundle.session.CRM_ACCOUNT_ID === records.account.id
      && bundle.session.CRM_CONTACT_ID === records.contact.id
      && String(bundle.submission.SESSION_ROW_ID) === String(bundle.session.ROWID)
      && String(bundle.proof.SESSION_ROW_ID) === String(bundle.session.ROWID)
      && String(bundle.prefill.SESSION_ROW_ID) === String(bundle.session.ROWID));
    check(sourceSnapshotDigest(records, lineage, conversion, bundle) === plan.source_snapshot_digest);
    return records;
  }

  async function noWork(plan) {
    for (const name of ['CANONICAL_CALL_TABLE', 'NOTIFICATION_TABLE']) {
      check(typeof tables[name] === 'string');
      const rows = await store.queryBounded(tables[name], 'DEPLOYMENT_ID', plan.deployment_id, 'ROWID', 1);
      check(rows.length === 0);
    }
  }

  async function history(plan, { successorClaim = null, allowCurrent = false } = {}) {
    const currentId = successorIdentity(plan).configurationVersionId;
    // Prove completeness once while never-active. Later provider events grow
    // independently; they must not exhaust the bounded control-history query
    // and prevent stopping a valid 25-call deployment.
    const rows = await store.queryBounded(tables.EVENT_RECEIPT_TABLE, 'DEPLOYMENT_ID', plan.deployment_id,
      'RECEIVED_AT', 100, successorClaim ? { RECEIPT_KIND: 'authorization_event' } : {});
    check(rows.length < 100);
    const old = successorClaim ? await Promise.all(plan.historical_receipt_keys.map((key) =>
      store.unique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', key)))
      : rows.filter((row) => row.CONFIGURATION_VERSION_ID !== currentId);
    check(old.every((row) => row && row.DEPLOYMENT_ID === plan.deployment_id)
      && JSON.stringify(old.map((row) => row.EVENT_KEY).sort()) === JSON.stringify([...plan.historical_receipt_keys].sort()));
    check(historyDigest(old) === plan.historical_receipts_digest);
    check(old.filter((row) => row.RECEIPT_KIND === 'authorization_event').length === 1
      && old.some((row) => row.RECEIPT_KIND === 'authorization_event' && row.EVENT_TYPE === 'approve'
        && row.STATUS === 'Completed' && row.CONFIGURATION_VERSION_ID === plan.predecessor_configuration_id));
    check(old.every((row) => ['configuration_staging', 'configuration_reconciliation',
      'configuration_completion', 'configuration_transition', 'authorization_event'].includes(row.RECEIPT_KIND)));
    const current = rows.filter((row) => !plan.historical_receipt_keys.includes(row.EVENT_KEY)
      && row.EVENT_KEY !== successorClaim);
    check(current.every((row) => row.CONFIGURATION_VERSION_ID === currentId)
      && (allowCurrent ? current.every((row) => row.RECEIPT_KIND === 'authorization_event') : current.length === 0));
    return current.filter((row) => row.RECEIPT_KIND === 'authorization_event');
  }

  async function readCompleted(command) {
    check(/^cfgsuccessor_[a-f0-9]{64}$/.test(command.configurationVersionId || ''));
    const receipt = await store.unique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', command.configurationVersionId);
    check(receipt?.RECEIPT_KIND === RECEIPT_KIND && receipt.EVENT_TYPE === 'configuration_successor'
      && receipt.STATUS === 'Completed' && receipt.LAST_ERROR_CODE === null
      && Number(receipt.RECEIPT_VERSION) === 1 && Number(receipt.ATTEMPT_COUNT) === 1
      && receipt.SOURCE_REVISION === config.sourceRevision && receipt.SOURCE_ENVIRONMENT === 'development');
    let data; try { data = JSON.parse(receipt.EVENT_DATA_JSON); } catch (_) { check(false); }
    check(data && receipt.PAYLOAD_FINGERPRINT === mac(data)
      && successorPlanDigest(data.plan) === config.successorAuthorizationSha256
      && data.plan.target_revision === config.sourceRevision && data.plan.operator_id_hash === config.operatorIdHash
      && data.plan.deployment_id === command.deploymentId && data.plan.deal_id === command.dealId
      && data.plan.journey_id === command.journeyId && successorIdentity(data.plan).claimKey === receipt.EVENT_KEY);
    const [previous, current, deployment] = await Promise.all([
      store.unique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID', data.plan.predecessor_configuration_id),
      store.unique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID', command.configurationVersionId),
      store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', command.deploymentId),
    ]);
    const projected = projectInactiveSuccessor(data.plan, previous, data.predecessorDeployment, data.createdAt);
    check(current && configurationSnapshotFingerprint(current) === configurationSnapshotFingerprint(projected.configurationRow)
      && current.CREATED_AT === data.createdAt && deployment?.ACTIVE_CONFIGURATION_VERSION_ID === command.configurationVersionId
      && deployment.SOURCE_REVISION === config.sourceRevision && Number(deployment.COUNT_VERSION) >= 2
      && deployment.NUMBER_LOOKUP_HASH === data.plan.new_number_lookup_hash
      && deployment.NUMBER_LOOKUP_HASH === numberLookupKey(config.numberSecret, config.retellPhoneNumber)
      && ['CLIENT_ID', 'DEPLOYMENT_ID', 'DEPLOYMENT_KEY', 'BINDING_ID', 'BINDING_VERSION',
        'MONITOR_AGENT_ID', 'MONITOR_AGENT_VERSION', 'COVERAGE_MODE', 'CALL_LIMIT', 'SOURCE_ENVIRONMENT']
        .every((key) => String(deployment[key]) === String(projected.deployment[key]))
      && receipt.RELATED_EVENT_KEY === data.predecessorDeployment.APPROVAL_EVENT_KEY
      && receipt.CONFIGURATION_VERSION_ID === command.configurationVersionId
      && receipt.DEPLOYMENT_ID === command.deploymentId && receipt.PROCESSED_AT === data.createdAt
      && receipt.RECEIVED_AT === data.createdAt
      && receipt.ROUTE_FINGERPRINT === routeFingerprint(routeFromRows(projected.deployment, projected.configurationRow)));
    await history(data.plan, { successorClaim: receipt.EVENT_KEY, allowCurrent: true });
    return { data, receipt, previous, current, deployment };
  }

  async function partitionAuthorizationHistory(command, receipts) {
    const { data, receipt } = await readCompleted(command);
    // Never silently discard arbitrary old receipts. Only the complete exact
    // historical inventory pinned by fresh owner authority may be excluded.
    const current = await history(data.plan, { successorClaim: receipt.EVENT_KEY, allowCurrent: true });
    check(receipts.length < 100 && evidenceDigest(receipts.filter((row) => row.CONFIGURATION_VERSION_ID === command.configurationVersionId))
      === evidenceDigest(current));
    return current;
  }

  async function assertApprovalSource(command, state) {
    const { data, previous } = await readCompleted(command);
    const records = await sources(data.plan, previous);
    check(records.deal.Modified_Time === state.deal.Modified_Time);
    return Object.freeze({ configurationStaged: true, priorCoreApproval: null });
  }

  async function succeed(request) {
    const plan = request?.intent?.plan;
    // Validate the exact server pin before even looking up an attempt identity.
    verifySuccessorIntent(request, config, now(), { replay: true });
    const ids = successorIdentity(plan);
    const command = { deploymentId: plan.deployment_id, dealId: plan.deal_id,
      journeyId: plan.journey_id, configurationVersionId: ids.configurationVersionId };
    const existing = await store.unique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', ids.claimKey);
    if (existing) {
      // A partial claim never retries a write. Exact completed replay is read-only.
      const { data, deployment, previous } = await readCompleted(command);
      check(successorPlanDigest(data.plan) === successorPlanDigest(plan)
        && deployment.TEST_STATUS === 'Ready for Approval' && deployment.GO_LIVE_APPROVAL_STATUS === 'Pending Internal Approval');
      await sources(plan, previous);
      return { state: 'SuccessorInactive', replayed: true, ...command };
    }
    verifySuccessorIntent(request, config, now());
    const [previous, deployment] = await Promise.all([
      store.unique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID', plan.predecessor_configuration_id),
      store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', plan.deployment_id),
    ]);
    const createdAt = new Date(now()).toISOString();
    const projected = projectInactiveSuccessor(plan, previous, deployment, createdAt);
    check(plan.new_number_lookup_hash === numberLookupKey(config.numberSecret, config.retellPhoneNumber)
      && deployment.MONITOR_AGENT_ID === config.sharedAgentId && Number(deployment.MONITOR_AGENT_VERSION) === config.stagingAgentVersion);
    const owner = await store.unique(tables.DEPLOYMENT_TABLE, 'NUMBER_LOOKUP_HASH', plan.new_number_lookup_hash);
    check(!owner && !(await store.unique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID', ids.configurationVersionId)));
    const records = await sources(plan, previous);
    check(records.deal.Test_Status === 'Scheduled' && records.deal.Go_Live_Approval_Status === 'Approved'
      && records.deal.Approved_Configuration_Version === plan.predecessor_configuration_id
      && records.deal.Approved_Deployment_Record_ID === plan.deployment_id
      && Date.parse(records.deal.Go_Live_Approved_At) === Date.parse(deployment.GO_LIVE_APPROVED_AT));
    await noWork(plan); await history(plan);
    const data = { profile: PROFILE, plan, predecessorDeployment: deployment, createdAt };
    const row = { EVENT_KEY: ids.claimKey, RECEIPT_KIND, EVENT_TYPE: 'configuration_successor',
      EVENT_DATA_JSON: JSON.stringify(data), PAYLOAD_FINGERPRINT: mac(data), DEPLOYMENT_ID: plan.deployment_id,
      CONFIGURATION_VERSION_ID: ids.configurationVersionId,
      ROUTE_FINGERPRINT: routeFingerprint(routeFromRows(projected.deployment, projected.configurationRow)),
      RELATED_EVENT_KEY: deployment.APPROVAL_EVENT_KEY, STATUS: 'Processing', RECEIPT_VERSION: 0,
      ATTEMPT_COUNT: 1, LAST_ERROR_CODE: null, RECEIVED_AT: createdAt, PROCESSED_AT: null,
      SOURCE_REVISION: config.sourceRevision, SOURCE_ENVIRONMENT: 'development' };
    check(Buffer.byteLength(row.EVENT_DATA_JSON, 'utf8') <= 10_000);
    const claimed = await store.insertUnique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', row,
      Object.keys(row).filter((key) => !['STATUS', 'RECEIPT_VERSION', 'PROCESSED_AT'].includes(key)));
    check(claimed.inserted === true, 'CONFIGURATION_SUCCESSOR_RECONCILIATION_REQUIRED');
    await store.insertUnique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID',
      projected.configurationRow, Object.keys(projected.configurationRow));
    await sources(plan, previous); await noWork(plan); await history(plan, { successorClaim: ids.claimKey });
    const current = await store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', plan.deployment_id);
    check(inactiveDeploymentFingerprint(current) === plan.predecessor_deployment_fingerprint);
    const changed = await store.conditionalUpdate(tables.DEPLOYMENT_TABLE, deployment.ROWID,
      projected.deploymentPatch, { COUNT_VERSION: 1, ACTIVE_CONFIGURATION_VERSION_ID: plan.predecessor_configuration_id,
        SOURCE_REVISION: plan.predecessor_revision, UPDATED_AT: deployment.UPDATED_AT });
    check(inactiveDeploymentFingerprint(changed) === inactiveDeploymentFingerprint(projected.deployment),
      'CONFIGURATION_SUCCESSOR_RECONCILIATION_REQUIRED');
    const fresh = await sources(plan, previous);
    await crm.recordConfigurationSuccessor(plan.deal_id, { expectedDeal: fresh.deal,
      deploymentId: plan.deployment_id, predecessorConfigurationId: plan.predecessor_configuration_id,
      predecessorApprovedAt: deployment.GO_LIVE_APPROVED_AT });
    await sources(plan, previous); await noWork(plan);
    const finished = await store.conditionalUpdate(tables.EVENT_RECEIPT_TABLE, claimed.row.ROWID,
      { STATUS: 'Completed', RECEIPT_VERSION: 1, PROCESSED_AT: createdAt },
      { STATUS: 'Processing', RECEIPT_VERSION: 0, PAYLOAD_FINGERPRINT: row.PAYLOAD_FINGERPRINT });
    check(finished?.STATUS === 'Completed' && Number(finished.RECEIPT_VERSION) === 1,
      'CONFIGURATION_SUCCESSOR_RECONCILIATION_REQUIRED');
    await readCompleted(command);
    return { state: 'SuccessorInactive', replayed: false, ...command };
  }
  return Object.freeze({ succeed, assertApprovalSource, partitionAuthorizationHistory });
}

module.exports = Object.freeze({ RECEIPT_KIND, historyDigest, sourceSnapshotDigest, createConfigurationSuccessorService });
