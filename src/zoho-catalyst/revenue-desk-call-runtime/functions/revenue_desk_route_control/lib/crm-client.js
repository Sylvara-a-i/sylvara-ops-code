'use strict';

const { RevenueDeskError, invariant } = require('revenue_desk_call_gateway/lib/errors');
const { NATIVE_CONVERSION_FIELDS } = require('./configuration-conversion-reader');

const PUBLIC_LINEAGE_FIELDS = Object.freeze([
  'id', 'Intake_Submission_ID', 'Submission_Channel', 'Free_Test_Request_Submitted_At',
  'Entry_Offer', 'Free_Test_Contact_Consent', 'Free_Test_Contact_Consent_At',
  'Free_Test_Contact_Consent_Version', 'Intake_Form_Version',
]);
const JOURNEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const PUBLIC_CHANNEL_SENTINELS = new Set(['crm assisted', 'unknown', 'pending', 'default']);

const DEAL_FIELDS = Object.freeze([
  'id', 'Modified_Time', 'Pipeline', 'Stage', 'Entry_Offer', 'Intake_Submission_ID',
  'Account_Name', 'Contact_Name', 'Setup_Access_Status', 'Setup_Access_Verified_At',
  'Setup_Form_Submission_ID', 'Setup_Form_Version', 'Setup_Form_Submitted_At',
  'Authorized_Representative_Confirmed', 'Test_Scope_Accepted', 'Authority_Confirmed_At',
  'Test_Scope_Accepted_At', 'Approved_Test_Route', 'No_Answer_Delay',
  'Forwarding_Administrator_Name', 'Forwarding_Administrator_Mobile',
  'Approved_Fallback_Destination', 'Approved_Fallback_Number', 'Rollback_Contact_Name',
  'Rollback_Contact_Mobile', 'Alert_Recipient_Name', 'Alert_Recipient_Email',
  'Alert_Recipient_Mobile', 'Urgent_Call_Handling', 'Existing_Customer_Call_Handling',
  'Test_Phone_Number', 'Deployment_Record_ID', 'Configuration_Version', 'Test_Status',
  'Go_Live_Approval_Status', 'Go_Live_Approved_At', 'Approved_Deployment_Record_ID',
  'Approved_Configuration_Version', 'Test_Start_At', 'Test_End_At', 'Test_End_Reason',
  'Rollback_Completed_At', 'Billing_Subscription_ID', 'Reason_For_Loss__s',
]);
const TRANSITIONS = Object.freeze({
  approval: 'Record Internal Approval',
  activation: 'Activate Test Route',
  activationContainment: 'Contain Failed Activation',
  rollbackByStage: Object.freeze({
    'Setup and Authorization': 'Close During Authorization',
    'Test Authorized': 'Close After Authorization',
    'Setup and QA': 'Close During QA',
    'Test Live': 'Close Live Test',
    'Results Review': 'Close After Results Review',
  }),
});
const APPROVAL_MUTABLE_FIELDS = new Set([
  'Modified_Time', 'Stage', 'Test_Status', 'Go_Live_Approval_Status',
  'Go_Live_Approved_At', 'Approved_Deployment_Record_ID',
  'Approved_Configuration_Version',
]);
const ACTIVATION_MUTABLE_FIELDS = new Set([
  'Modified_Time', 'Stage', 'Test_Status', 'Test_Start_At',
]);
const ROLLBACK_MUTABLE_FIELDS = new Set([
  'Modified_Time', 'Stage', 'Test_Status', 'Test_End_At', 'Test_End_Reason',
  'Rollback_Completed_At', 'Reason_For_Loss__s',
]);
const CORE_ROLLBACK_MUTABLE_FIELDS = new Set([
  ...ROLLBACK_MUTABLE_FIELDS, 'Go_Live_Approval_Status',
]);
const STAGING_MUTABLE_FIELDS = new Set(['Modified_Time', 'Stage', 'Test_Status', 'Deployment_Record_ID']);
const PREPARATION_ACCOUNT_FIELDS = Object.freeze(['id', 'Modified_Time', 'Account_Name',
  'Phone', 'Phone_System_Provider', 'Normal_Business_Hours', 'Primary_Service_Area', 'Services_Handled']);
const PREPARATION_CONTACT_FIELDS = Object.freeze(['id', 'Modified_Time', 'Account_Name']);
const PREPARATION_BASELINE_FIELDS = Object.freeze(['id', 'Modified_Time', 'Current_Call_Handling',
  'Monthly_Inbound_Calls', 'Monthly_Inbound_Call_Band', 'After_Hours_Call_Band',
  'After_Hours_Call_Share', 'Estimated_Unanswered_Call_Rate', 'Average_Job_Value',
  'Average_Job_Value_Band', 'Current_Monthly_Answering_Cost']);
const ROLLBACK_INTERLEAVING_MUTABLE_FIELDS = new Set([
  ...ROLLBACK_MUTABLE_FIELDS,
  ...ACTIVATION_MUTABLE_FIELDS,
]);
const LOOKUP_FIELDS = new Set(['Account_Name', 'Contact_Name']);
const DATETIME_FIELDS = new Set([
  'Modified_Time', 'Setup_Access_Verified_At', 'Setup_Form_Submitted_At',
  'Authority_Confirmed_At', 'Test_Scope_Accepted_At', 'Go_Live_Approved_At',
  'Test_Start_At', 'Test_End_At', 'Rollback_Completed_At',
]);
const CRM_ROLLBACK_END_REASONS = new Set([
  'Sylvara Stopped', 'Technical Failure', 'Other',
]);
const CRM_ROLLBACK_LOSS_REASON = 'Other';

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function same(actual, expected) {
  if (typeof expected === 'boolean') return actual === expected
    || String(actual).toLowerCase() === String(expected);
  return actual === expected;
}

function crmTimestamp(value) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const epoch = Date.parse(value);
  const local = value.slice(0, 19);
  if (!Number.isFinite(epoch)
    || new Date(Date.parse(`${local}.000Z`)).toISOString() !== `${local}.000Z`) return null;
  return epoch;
}

function sameDealField(field, actual, expected) {
  if (DATETIME_FIELDS.has(field)) {
    if (same(actual, expected)) return true;
    const valid = (value) => typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && Number.isFinite(Date.parse(value));
    return valid(actual) && valid(expected) && Date.parse(actual) === Date.parse(expected);
  }
  if (!LOOKUP_FIELDS.has(field)) return same(actual, expected);
  const lookupId = (value) => {
    if (!plain(value) || !/^[1-9][0-9]{7,29}$/.test(String(value.id || ''))) {
      return undefined;
    }
    return String(value.id);
  };
  const actualId = lookupId(actual);
  const expectedId = lookupId(expected);
  return actualId !== undefined && expectedId !== undefined && actualId === expectedId;
}

function toCrmDateTime(value) {
  invariant(typeof value === 'string' && Number.isFinite(Date.parse(value)),
    'CRM_WRITE_INVALID', 'CRM DateTime value is invalid.', { httpStatus: 503 });
  // Zoho CRM documents and reads back DateTime fields as whole seconds with
  // a numeric offset, rather than JavaScript's millisecond-Z representation.
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

function assertDealSnapshot(actual, expected, mutableFields = new Set()) {
  invariant(plain(expected) && DEAL_FIELDS.every((field) => mutableFields.has(field)
    || sameDealField(field, actual[field] === undefined ? null : actual[field],
      expected[field] === undefined ? null : expected[field])),
  'CRM_TRANSITION_PRECONDITION_FAILED',
  'CRM Deal changed after control validation.', { httpStatus: 409 });
}

function parseRecord(json, expectedId) {
  invariant(plain(json) && Array.isArray(json.data) && json.data.length === 1
    && plain(json.data[0]) && String(json.data[0].id) === expectedId,
  'CRM_READBACK_INVALID', 'CRM record readback is invalid.',
  { httpStatus: 503, retryable: true });
  return { ...json.data[0] };
}

function parseTransitionId(json, name) {
  const transitions = Array.isArray(json?.blueprint?.transitions)
    ? json.blueprint.transitions
    : Array.isArray(json?.blueprint) ? json.blueprint.flatMap((entry) => entry?.transitions || [])
      : [];
  const matches = transitions.filter((entry) => plain(entry) && entry.name === name
    && /^[1-9][0-9]{7,29}$/.test(String(entry.id || entry.transition_id || '')));
  invariant(matches.length === 1, 'CRM_TRANSITION_UNAVAILABLE',
    'The exact CRM Blueprint transition is unavailable.', { httpStatus: 409 });
  return String(matches[0].id || matches[0].transition_id);
}

function createCrmControlClient(config, {
  readAuthorization, writeAuthorization, fetchImpl = globalThis.fetch,
} = {}) {
  invariant(typeof readAuthorization === 'function' && typeof writeAuthorization === 'function'
    && typeof fetchImpl === 'function'
    && /^[1-9][0-9]{0,29}$/.test(config?.crmOrganizationId || ''),
  'INVALID_RUNTIME_CONFIGURATION',
  'CRM control dependencies are unavailable.', { httpStatus: 503 });
  let readOrganizationVerified = false;
  let writeOrganizationVerified = false;

  async function request(path, options, write = false) {
    const authorization = await (write ? writeAuthorization() : readAuthorization());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.platformTimeoutMs);
    let response;
    try {
      response = await fetchImpl(`${config.crmApiBaseUrl}${path}`, {
        ...options,
        headers: { Accept: 'application/json', ...options.headers, Authorization: authorization },
        signal: controller.signal,
      });
    } catch (error) {
      throw new RevenueDeskError('CRM_REQUEST_FAILED', 'CRM request failed.', {
        cause: error, httpStatus: 503, retryable: !write, ambiguous: write,
      });
    } finally {
      clearTimeout(timer);
    }
    let json;
    try { json = await response.json(); } catch (_) { json = null; }
    invariant(response.status >= 200 && response.status < 300 && plain(json),
      write ? 'CRM_WRITE_REJECTED' : 'CRM_READ_REJECTED',
      write ? 'CRM rejected the control transition.' : 'CRM rejected the control read.',
      { httpStatus: response.status === 401 || response.status === 403 ? 503 : 409,
        retryable: !write, ambiguous: write && response.status >= 500 });
    return json;
  }

  async function assertOrganization(write = false) {
    if ((write && writeOrganizationVerified) || (!write && readOrganizationVerified)) return;
    const json = await request('/org', { method: 'GET' }, write);
    const organizations = json?.org;
    invariant(Array.isArray(organizations) && organizations.length === 1
      && plain(organizations[0])
      && String(organizations[0].zgid || '') === config.crmOrganizationId,
    'CRM_ORGANIZATION_MISMATCH', 'CRM Connection organization does not match.',
    { httpStatus: 503 });
    if (write) writeOrganizationVerified = true;
    else readOrganizationVerified = true;
  }

  async function getDeal(dealId) {
    await assertOrganization(false);
    const query = new URLSearchParams({ fields: DEAL_FIELDS.join(',') }).toString();
    return parseRecord(await request(`/Deals/${dealId}?${query}`, { method: 'GET' }), dealId);
  }

  async function getPreparationFieldMetadata() {
    await assertOrganization(false);
    // CRM v8 documents one module-wide used-fields read, not a field-name
    // filter or pagination contract. The metadata reader projects ten fields
    // in memory; no raw provider metadata reaches a route response or log.
    return request('/settings/fields?module=Deals', { method: 'GET' });
  }

  async function getNativeConversion(originalLeadId) {
    invariant(typeof originalLeadId === 'string' && /^[1-9][0-9]{9,29}$/.test(originalLeadId),
      'CONFIGURATION_CONVERSION_INVALID', 'Original Lead identity is invalid.', { httpStatus: 409 });
    await assertOrganization(false);
    const query = new URLSearchParams({ ids: originalLeadId, converted: 'true',
      fields: NATIVE_CONVERSION_FIELDS.join(','), per_page: '2' });
    // Exactly one historical Lead, never a broad search or record conversion.
    // The conversion reader validates the derived evidence and drops all other
    // provider fields before it is used by the configuration staging service.
    return request(`/Leads?${query}`, { method: 'GET' });
  }

  async function getPublicOriginalLead(journeyId) {
    invariant(typeof journeyId === 'string' && JOURNEY.test(journeyId),
      'CONFIGURATION_SOURCE_LINEAGE_INVALID', 'Journey identity is invalid.', { httpStatus: 409 });
    const channel = config.form1PublicSubmissionChannel;
    const normalizedChannel = typeof channel === 'string'
      ? channel.replace(/\s+/g, ' ').trim().toLowerCase() : null;
    invariant(typeof channel === 'string' && channel.length >= 1 && channel.length <= 100
      && channel.trim().length >= 1 && !/[\u0000-\u001f\u007f]/.test(channel)
      && !/^<.*>$/.test(channel) && !PUBLIC_CHANNEL_SENTINELS.has(normalizedChannel),
    'CONFIGURATION_PUBLIC_SOURCE_UNAVAILABLE',
    'Public Form 1 lineage is disabled until its native channel is verified.', { httpStatus: 409 });
    const query = new URLSearchParams({
      criteria: `(Intake_Submission_ID:equals:${journeyId})`,
      converted: 'true',
      fields: PUBLIC_LINEAGE_FIELDS.join(','),
      page: '1',
      per_page: '2',
    });
    let response;
    let timer;
    try {
      response = await Promise.race([
        (async () => {
          await assertOrganization(false);
          return request(`/Leads/search?${query}`, { method: 'GET' });
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('public lineage timeout')), config.platformTimeoutMs);
        }),
      ]);
    } catch (_) {
      throw new RevenueDeskError('CONFIGURATION_PUBLIC_SOURCE_UNAVAILABLE',
        'Public Form 1 lineage read is unavailable.', { httpStatus: 503, retryable: true });
    } finally { clearTimeout(timer); }
    const row = Array.isArray(response?.data) && response.data.length === 1
      ? response.data[0] : null;
    const info = response?.info;
    // Zoho's equals search can behave as a contains match for punctuation.
    // Pagination alone therefore cannot prove identity; require the returned
    // unique field to match the signed journey byte for byte.
    const submittedAt = crmTimestamp(row?.Free_Test_Request_Submitted_At);
    const consentAt = crmTimestamp(row?.Free_Test_Contact_Consent_At);
    invariant(plain(row) && plain(info) && response.data.length === 1
      && info.count === 1 && info.page === 1 && info.more_records === false
      && (info.next_page_token === null || info.next_page_token === undefined)
      && typeof row.id === 'string' && /^[1-9][0-9]{9,29}$/.test(row.id)
      && row.Intake_Submission_ID === journeyId
      && row.Submission_Channel === channel
      && row.Entry_Offer === 'Free 7-Day Missed-Call'
      && row.Free_Test_Contact_Consent === true
      && row.Free_Test_Contact_Consent_Version === 'form1-contact-consent-v1'
      && row.Intake_Form_Version === 'revenue-leak-test-request-v1'
      && consentAt !== null && submittedAt !== null
      && consentAt <= submittedAt && submittedAt <= Date.now(),
    'CONFIGURATION_SOURCE_LINEAGE_INVALID',
    'Public Form 1 lineage is incomplete or ambiguous.', { httpStatus: 409 });
    return Object.freeze({ lineageType: 'public_native', originalLeadId: row.id, journeyId,
      submittedAt: new Date(submittedAt).toISOString(),
      consentAt: new Date(consentAt).toISOString(),
      submissionChannel: row.Submission_Channel,
      intakeFormVersion: row.Intake_Form_Version });
  }

  async function getPreparationRecords(dealId) {
    invariant(/^[1-9][0-9]{7,29}$/.test(dealId || ''), 'CRM_READ_REJECTED',
      'Preparation identity is invalid.', { httpStatus: 409 });
    const deal = await getDeal(dealId);
    const accountId = String(deal.Account_Name?.id || '');
    const contactId = String(deal.Contact_Name?.id || '');
    invariant([accountId, contactId].every((id) => /^[1-9][0-9]{7,29}$/.test(id)),
      'CRM_READBACK_INVALID', 'Preparation relationships are missing.', { httpStatus: 409 });
    async function projection(module, id, fields) {
      const query = new URLSearchParams({ fields: fields.join(',') });
      return parseRecord(await request(`/${module}/${id}?${query}`, { method: 'GET' }), id);
    }
    const [account, contact, baseline] = await Promise.all([
      projection('Accounts', accountId, PREPARATION_ACCOUNT_FIELDS),
      projection('Contacts', contactId, PREPARATION_CONTACT_FIELDS),
      projection('Deals', dealId, PREPARATION_BASELINE_FIELDS),
    ]);
    invariant(sameDealField('Modified_Time', baseline.Modified_Time, deal.Modified_Time)
      && String(contact.Account_Name?.id || '') === accountId,
    'CRM_READBACK_INVALID', 'Preparation changed across its bounded reads.', { httpStatus: 409 });
    // The second Deal projection keeps each read below the API field ceiling.
    const project = (record, fields) => Object.fromEntries(fields.map((field) => [field,
      LOOKUP_FIELDS.has(field) && plain(record[field]) ? { id: String(record[field].id) }
        : record[field]]));
    // Derived API capabilities, labels and layout hints are not source truth.
    // Drop them before hashing or returning a private preparation projection.
    return { account: project(account, PREPARATION_ACCOUNT_FIELDS),
      contact: project(contact, PREPARATION_CONTACT_FIELDS), deal: { ...project(deal, DEAL_FIELDS), ...Object.fromEntries(
      PREPARATION_BASELINE_FIELDS.filter((field) => !['id', 'Modified_Time'].includes(field))
        .map((field) => [field, baseline[field] === undefined ? null : baseline[field]]),
    ) } };
  }

  async function recordConfigurationStaging(dealId, { deploymentId, expectedDeal, priorApproval }) {
    const deal = await getDeal(dealId);
    assertDealSnapshot(deal, expectedDeal, STAGING_MUTABLE_FIELDS);
    invariant(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(deploymentId || '')
      && !deal.Test_Start_At && !deal.Test_End_At && !deal.Rollback_Completed_At
      && !deal.Billing_Subscription_ID && !deal.Approved_Deployment_Record_ID,
    'CRM_TRANSITION_PRECONDITION_FAILED', 'Configuration staging is not inactive.', { httpStatus: 409 });
    const desired = { Deployment_Record_ID: deploymentId, Stage: 'Setup and QA',
      Test_Status: priorApproval ? 'Scheduled' : 'Setup Pending' };
    if (priorApproval) invariant(deal.Go_Live_Approval_Status === 'Approved'
      && deal.Approved_Configuration_Version === priorApproval.configurationVersionId
      && sameDealField('Go_Live_Approved_At', deal.Go_Live_Approved_At, priorApproval.approvedAt),
    'CRM_TRANSITION_PRECONDITION_FAILED', 'Prior inactive approval changed.', { httpStatus: 409 });
    else invariant(deal.Go_Live_Approval_Status === 'Not Ready'
      && !deal.Approved_Configuration_Version && !deal.Go_Live_Approved_At,
    'CRM_TRANSITION_PRECONDITION_FAILED', 'Fresh staging has unexpected approval.', { httpStatus: 409 });
    const matches = (row) => Object.entries(desired).every(([key, value]) => same(row[key], value));
    if (matches(deal)) return deal;
    invariant(!deal.Deployment_Record_ID && (priorApproval
      ? deal.Stage === 'Setup and QA' && deal.Test_Status === 'Scheduled'
      : deal.Stage === 'Setup and Authorization' && deal.Test_Status === 'Not Started'),
    'CRM_TRANSITION_PRECONDITION_FAILED', 'Configuration staging source changed.', { httpStatus: 409 });
    let result;
    try { result = await updateCoreDeal(dealId, desired, deal.Modified_Time); }
    catch (error) {
      try { result = await getDeal(dealId); } catch (_) {
        throw new RevenueDeskError('CONFIGURATION_STAGING_RECONCILIATION_REQUIRED',
          'Configuration staging write needs independent readback.', { httpStatus: 503, ambiguous: true });
      }
      if (!matches(result)) throw error;
    }
    invariant(matches(result), 'CRM_READBACK_INVALID', 'Configuration staging did not read back.',
      { httpStatus: 503, ambiguous: true });
    assertDealSnapshot(result, expectedDeal, STAGING_MUTABLE_FIELDS);
    return result;
  }

  async function updateDeal(dealId, patch, modifiedTime) {
    invariant(plain(patch) && Object.keys(patch).length > 0,
      'CRM_WRITE_INVALID', 'CRM control patch is invalid.', { httpStatus: 503 });
    await assertOrganization(true);
    const headers = { 'Content-Type': 'application/json' };
    if (modifiedTime) headers['If-Unmodified-Since'] = modifiedTime;
    const json = await request(`/Deals/${dealId}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ data: [{ id: dealId, ...patch }], trigger: ['workflow'] }),
    }, true);
    const entry = Array.isArray(json.data) ? json.data[0] : null;
    invariant(entry?.status === 'success' && entry?.code === 'SUCCESS'
      && String(entry?.details?.id || dealId) === dealId,
    'CRM_WRITE_ACK_INVALID', 'CRM update acknowledgement is invalid.',
    { httpStatus: 503, ambiguous: true });
    const readback = await getDeal(dealId);
    invariant(Object.entries(patch).every(([field, value]) => same(readback[field], value)),
      'CRM_READBACK_INVALID', 'CRM update did not read back exactly.',
      { httpStatus: 503, ambiguous: true });
    return readback;
  }

  async function updateCoreDeal(dealId, patch, modifiedTime) {
    invariant(plain(patch) && Object.keys(patch).length > 0
      && typeof modifiedTime === 'string' && Number.isFinite(Date.parse(modifiedTime)),
    'CRM_WRITE_INVALID', 'CRM Journey-core patch is invalid.', { httpStatus: 503 });
    await assertOrganization(true);
    const json = await request(`/Deals/${dealId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Unmodified-Since': modifiedTime },
      // Core writes are authoritative and read back below. Deferred workflows
      // and Blueprint actions must not run as hidden side effects.
      body: JSON.stringify({ data: [{ id: dealId, ...patch }], trigger: [] }),
    }, true);
    const entry = Array.isArray(json.data) ? json.data[0] : null;
    invariant(entry?.status === 'success' && entry?.code === 'SUCCESS'
      && String(entry?.details?.id || dealId) === dealId,
    'CRM_WRITE_ACK_INVALID', 'CRM Journey-core acknowledgement is invalid.',
    { httpStatus: 503, ambiguous: true });
    const readback = await getDeal(dealId);
    invariant(Object.entries(patch)
      .every(([field, value]) => sameDealField(field, readback[field], value)),
    'CRM_READBACK_INVALID', 'CRM Journey-core update did not read back exactly.',
    { httpStatus: 503, ambiguous: true });
    return readback;
  }

  async function transition(dealId, name, data = {}) {
    await assertOrganization(false);
    const blueprint = await request(`/Deals/${dealId}/actions/blueprint`, { method: 'GET' });
    const transitionId = parseTransitionId(blueprint, name);
    await assertOrganization(true);
    const json = await request(`/Deals/${dealId}/actions/blueprint`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint: [{ transition_id: transitionId, data }] }),
    }, true);
    const acknowledgment = Array.isArray(json.blueprint) ? json.blueprint[0] : json;
    invariant(acknowledgment?.status === 'success' && acknowledgment?.code === 'SUCCESS',
      'CRM_TRANSITION_ACK_INVALID', 'CRM Blueprint transition acknowledgement is invalid.',
      { httpStatus: 503, ambiguous: true });
    return getDeal(dealId);
  }

  async function recordApproval(dealId, {
    deploymentId, configurationVersionId, approvedAt, expectedDeal, priorCoreApproval, configurationStaged,
  }) {
    const deal = await getDeal(dealId);
    assertDealSnapshot(deal, expectedDeal);
    const hasPriorApproval = priorCoreApproval !== undefined && priorCoreApproval !== null;
    invariant(!hasPriorApproval || configurationStaged === true,
      'CRM_TRANSITION_PRECONDITION_FAILED', 'Core approval supersession requires authenticated staging.',
      { httpStatus: 409 });
    if (configurationStaged === true) {
      // Only the server-side staging verifier supplies this authority. Both
      // fresh approval and old inactive core-approval supersession belong to
      // this controller, never the deferred commercial Blueprint. Historical
      // receipts and the Form 2 configuration label remain unchanged.
      if (hasPriorApproval) invariant(plain(priorCoreApproval)
        && Object.keys(priorCoreApproval).sort().join(',') === 'approvedAt,configurationVersionId'
        && typeof priorCoreApproval.configurationVersionId === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(priorCoreApproval.configurationVersionId)
        && typeof priorCoreApproval.approvedAt === 'string'
        && Number.isFinite(Date.parse(priorCoreApproval.approvedAt))
        && new Date(priorCoreApproval.approvedAt).toISOString() === priorCoreApproval.approvedAt
        && configurationVersionId !== priorCoreApproval.configurationVersionId
        && deal.Configuration_Version === priorCoreApproval.configurationVersionId,
      'CRM_TRANSITION_PRECONDITION_FAILED', 'Retained core approval proof is invalid.', { httpStatus: 409 });
      invariant(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(deploymentId || '')
        && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(configurationVersionId || '')
        && deal.Deployment_Record_ID === deploymentId
        && deal.Stage === 'Setup and QA'
        && !deal.Test_Start_At && !deal.Test_End_At && !deal.Test_End_Reason
        && !deal.Rollback_Completed_At && !deal.Billing_Subscription_ID,
      'CRM_TRANSITION_PRECONDITION_FAILED', 'Staged configuration is not eligible for inactive approval.',
      { httpStatus: 409 });
      const desired = {
        ...(!hasPriorApproval ? { Test_Status: 'Scheduled' } : {}),
        Go_Live_Approval_Status: 'Approved', Go_Live_Approved_At: toCrmDateTime(approvedAt),
        Approved_Deployment_Record_ID: deploymentId,
        Approved_Configuration_Version: configurationVersionId,
      };
      const matches = (value) => value.Stage === 'Setup and QA' && value.Test_Status === 'Scheduled'
        && !value.Test_Start_At && !value.Test_End_At && !value.Test_End_Reason
        && !value.Rollback_Completed_At && !value.Billing_Subscription_ID
        && Object.entries(desired).every(([field, expected]) => sameDealField(field, value[field], expected));
      if (matches(deal)) return deal;
      invariant(!deal.Approved_Deployment_Record_ID
        && (hasPriorApproval
          ? deal.Test_Status === 'Scheduled' && deal.Go_Live_Approval_Status === 'Approved'
            && deal.Approved_Configuration_Version === priorCoreApproval.configurationVersionId
            && sameDealField('Go_Live_Approved_At', deal.Go_Live_Approved_At, priorCoreApproval.approvedAt)
          : deal.Test_Status === 'Setup Pending' && deal.Go_Live_Approval_Status === 'Not Ready'
            && !deal.Approved_Configuration_Version && !deal.Go_Live_Approved_At),
      'CRM_TRANSITION_PRECONDITION_FAILED', 'Staged approval source changed before its conditional write.',
      { httpStatus: 409 });
      let readback;
      try { readback = await updateCoreDeal(dealId, desired, deal.Modified_Time); }
      catch (_) {
        try { readback = await getDeal(dealId); } catch (_) { readback = null; }
        // Reconcile one potentially committed write. This method never retries
        // a mutation when the authoritative outcome is absent or ambiguous.
        invariant(readback && matches(readback), 'CRM_APPROVAL_RECONCILIATION_REQUIRED',
          'Staged configuration approval needs independent reconciliation.',
          { httpStatus: 503, ambiguous: true });
      }
      invariant(matches(readback), 'CRM_READBACK_INVALID',
        'Staged configuration approval did not read back exactly.',
        { httpStatus: 503, ambiguous: true });
      assertDealSnapshot(readback, expectedDeal, APPROVAL_MUTABLE_FIELDS);
      return readback;
    }
    const desired = {
      Go_Live_Approval_Status: 'Approved', Go_Live_Approved_At: approvedAt,
      Approved_Deployment_Record_ID: deploymentId,
      Approved_Configuration_Version: configurationVersionId,
    };
    if (deal.Stage === 'Setup and QA' && deal.Test_Status === 'Scheduled'
      && Object.entries(desired).every(([field, value]) => same(deal[field], value))) return deal;
    invariant(deal.Stage === 'Setup and QA' && deal.Test_Status === 'Setup Pending'
      && !deal.Test_Start_At && !deal.Test_End_At,
    'CRM_TRANSITION_PRECONDITION_FAILED', 'CRM Deal is not awaiting approval.',
    { httpStatus: 409 });
    const readback = await transition(dealId, TRANSITIONS.approval, desired);
    invariant(readback.Stage === 'Setup and QA' && readback.Test_Status === 'Scheduled'
      && Object.entries(desired).every(([field, value]) => same(readback[field], value))
      && !readback.Test_Start_At,
    'CRM_READBACK_INVALID', 'CRM approval transition did not read back exactly.',
    { httpStatus: 503, ambiguous: true });
    assertDealSnapshot(readback, expectedDeal, APPROVAL_MUTABLE_FIELDS);
    return readback;
  }

  async function recordCoreApproval(dealId, {
    configurationVersionId, approvedAt, expectedDeal,
  }) {
    const deal = await getDeal(dealId);
    assertDealSnapshot(deal, expectedDeal);
    const desired = {
      Stage: 'Setup and QA', Test_Status: 'Scheduled',
      Go_Live_Approval_Status: 'Approved', Go_Live_Approved_At: toCrmDateTime(approvedAt),
      Approved_Deployment_Record_ID: null,
      Approved_Configuration_Version: configurationVersionId,
    };
    const exactApproved = (value) => Object.entries(desired)
      .every(([field, expected]) => sameDealField(field, value[field], expected))
      && value.Configuration_Version === configurationVersionId
      && !value.Deployment_Record_ID && !value.Billing_Subscription_ID
      && !value.Test_Start_At && !value.Test_End_At;
    if (exactApproved(deal)) return deal;
    invariant(deal.Stage === 'Setup and Authorization'
      && deal.Setup_Access_Status === 'Submitted'
      && deal.Configuration_Version === configurationVersionId
      && !deal.Deployment_Record_ID && !deal.Approved_Deployment_Record_ID
      && !deal.Approved_Configuration_Version && !deal.Go_Live_Approved_At
      && !deal.Billing_Subscription_ID
      // The Journey-core initializer owns `Not Started`; the deferred CRM
      // workflow is intentionally not required to manufacture `Setup Pending`.
      && deal.Test_Status === 'Not Started'
      && deal.Go_Live_Approval_Status === 'Not Ready'
      && !deal.Test_Start_At && !deal.Test_End_At,
    'CRM_TRANSITION_PRECONDITION_FAILED',
    'CRM Deal is not awaiting Journey-core approval.', { httpStatus: 409 });
    let readback;
    try {
      readback = await updateCoreDeal(dealId, desired, deal.Modified_Time);
    } catch (error) {
      try { readback = await getDeal(dealId); } catch (readError) {
        throw new RevenueDeskError('CRM_APPROVAL_RECONCILIATION_REQUIRED',
          'CRM Journey-core approval outcome requires reconciliation.',
          { cause: readError, httpStatus: 503, ambiguous: true });
      }
      if (!exactApproved(readback)) {
        throw new RevenueDeskError('CRM_APPROVAL_RECONCILIATION_REQUIRED',
          'CRM Journey-core approval outcome requires reconciliation.',
          { cause: error, httpStatus: 503, ambiguous: true });
      }
    }
    invariant(exactApproved(readback), 'CRM_READBACK_INVALID',
      'CRM Journey-core approval did not read back exactly.',
      { httpStatus: 503, ambiguous: true });
    assertDealSnapshot(readback, expectedDeal, APPROVAL_MUTABLE_FIELDS);
    return readback;
  }

  async function recordActivation(dealId, {
    deploymentId, configurationVersionId, activatedAt, expectedDeal,
  }) {
    let deal = await getDeal(dealId);
    assertDealSnapshot(deal, expectedDeal);
    if (deal.Stage === 'Test Live' && deal.Test_Status === 'Live'
      && deal.Test_Start_At === activatedAt
      && deal.Approved_Deployment_Record_ID === deploymentId
      && deal.Approved_Configuration_Version === configurationVersionId) return deal;
    invariant(deal.Stage === 'Setup and QA' && deal.Test_Status === 'Scheduled'
      && deal.Go_Live_Approval_Status === 'Approved'
      && deal.Approved_Deployment_Record_ID === deploymentId
      && deal.Approved_Configuration_Version === configurationVersionId
      && (!deal.Test_Start_At || deal.Test_Start_At === activatedAt)
      && !deal.Test_End_At,
    'CRM_TRANSITION_PRECONDITION_FAILED', 'CRM Deal is not awaiting activation.',
    { httpStatus: 409 });
    try {
      if (!deal.Test_Start_At) {
        deal = await updateDeal(dealId, { Test_Start_At: activatedAt }, deal.Modified_Time);
      }
      const readback = await transition(dealId, TRANSITIONS.activation);
      invariant(readback.Stage === 'Test Live' && readback.Test_Status === 'Live'
        && readback.Test_Start_At === activatedAt,
      'CRM_READBACK_INVALID', 'CRM activation transition did not read back exactly.',
      { httpStatus: 503, ambiguous: true });
      assertDealSnapshot(readback, expectedDeal, ACTIVATION_MUTABLE_FIELDS);
      return readback;
    } catch (error) {
      let observed;
      try { observed = await getDeal(dealId); } catch (readError) {
        throw new RevenueDeskError('CRM_ACTIVATION_RECONCILIATION_REQUIRED',
          'CRM activation outcome requires reconciliation.',
          { cause: readError, httpStatus: 503, ambiguous: true });
      }
      const exactLive = observed.Stage === 'Test Live' && observed.Test_Status === 'Live'
        && observed.Test_Start_At === activatedAt
        && observed.Approved_Deployment_Record_ID === deploymentId
        && observed.Approved_Configuration_Version === configurationVersionId
        && DEAL_FIELDS.every((field) => ACTIVATION_MUTABLE_FIELDS.has(field)
          || sameDealField(field, observed[field] === undefined ? null : observed[field],
            expectedDeal[field] === undefined ? null : expectedDeal[field]));
      if (exactLive) return observed;
      const exactScheduled = observed.Stage === 'Setup and QA'
        && observed.Test_Status === 'Scheduled'
        && observed.Go_Live_Approval_Status === 'Approved'
        && observed.Approved_Deployment_Record_ID === deploymentId
        && observed.Approved_Configuration_Version === configurationVersionId
        && !observed.Test_End_At
        && DEAL_FIELDS.every((field) => ACTIVATION_MUTABLE_FIELDS.has(field)
          || sameDealField(field, observed[field] === undefined ? null : observed[field],
            expectedDeal[field] === undefined ? null : expectedDeal[field]));
      if (exactScheduled && observed.Test_Start_At === activatedAt) {
        try {
          observed = await updateDeal(dealId, { Test_Start_At: null }, observed.Modified_Time);
        } catch (clearError) {
          throw new RevenueDeskError('CRM_ACTIVATION_RECONCILIATION_REQUIRED',
            'CRM activation outcome requires reconciliation.',
            { cause: clearError, httpStatus: 503, ambiguous: true });
        }
      }
      if (exactScheduled && !observed.Test_Start_At) {
        throw new RevenueDeskError('CRM_ACTIVATION_PROVEN_INACTIVE',
          'CRM activation failed and exact inactive state was restored.',
          { cause: error, httpStatus: 503, retryable: false });
      }
      throw new RevenueDeskError('CRM_ACTIVATION_RECONCILIATION_REQUIRED',
        'CRM activation outcome requires reconciliation.',
        { cause: error, httpStatus: 503, ambiguous: true });
    }
  }

  async function proveActivationInactive(dealId, {
    deploymentId, configurationVersionId, activatedAt,
  }) {
    let deal = await getDeal(dealId);
    invariant(deal.Stage === 'Setup and QA' && deal.Test_Status === 'Scheduled'
      && deal.Go_Live_Approval_Status === 'Approved'
      && deal.Approved_Deployment_Record_ID === deploymentId
      && deal.Approved_Configuration_Version === configurationVersionId
      && (!deal.Test_Start_At || deal.Test_Start_At === activatedAt)
      && !deal.Test_End_At,
    'CRM_ACTIVATION_RECONCILIATION_REQUIRED',
    'CRM activation outcome requires reconciliation.',
    { httpStatus: 503, ambiguous: true });
    if (deal.Test_Start_At === activatedAt) {
      deal = await updateDeal(dealId, { Test_Start_At: null }, deal.Modified_Time);
    }
    invariant(deal.Stage === 'Setup and QA' && deal.Test_Status === 'Scheduled'
      && !deal.Test_Start_At && !deal.Test_End_At,
    'CRM_ACTIVATION_RECONCILIATION_REQUIRED',
    'CRM activation outcome requires reconciliation.',
    { httpStatus: 503, ambiguous: true });
    return deal;
  }

  async function containActivation(dealId, {
    deploymentId, configurationVersionId, activatedAt, expectedDeal,
  }) {
    const exactInactive = (deal) => deal.Stage === 'Setup and QA'
      && deal.Test_Status === 'Scheduled'
      && deal.Go_Live_Approval_Status === 'Approved'
      && deal.Approved_Deployment_Record_ID === deploymentId
      && deal.Approved_Configuration_Version === configurationVersionId
      && !deal.Test_Start_At && !deal.Test_End_At;
    let deal = await getDeal(dealId);
    assertDealSnapshot(deal, expectedDeal, ACTIVATION_MUTABLE_FIELDS);
    if (exactInactive(deal)) return deal;
    invariant(deal.Stage === 'Test Live' && deal.Test_Status === 'Live'
      && deal.Go_Live_Approval_Status === 'Approved'
      && deal.Approved_Deployment_Record_ID === deploymentId
      && deal.Approved_Configuration_Version === configurationVersionId
      && deal.Test_Start_At === activatedAt && !deal.Test_End_At,
    'CRM_ACTIVATION_RECONCILIATION_REQUIRED',
    'CRM activation cannot be safely contained.', { httpStatus: 503, ambiguous: true });
    try {
      deal = await transition(dealId, TRANSITIONS.activationContainment, {
        Test_Status: 'Scheduled', Test_Start_At: null,
      });
    } catch (error) {
      try { deal = await getDeal(dealId); } catch (readError) {
        throw new RevenueDeskError('CRM_ACTIVATION_RECONCILIATION_REQUIRED',
          'CRM activation containment requires reconciliation.',
          { cause: readError, httpStatus: 503, ambiguous: true });
      }
      if (!exactInactive(deal)) {
        throw new RevenueDeskError('CRM_ACTIVATION_RECONCILIATION_REQUIRED',
          'CRM activation containment requires reconciliation.',
          { cause: error, httpStatus: 503, ambiguous: true });
      }
    }
    invariant(exactInactive(deal), 'CRM_READBACK_INVALID',
      'CRM activation containment did not read back exactly.',
      { httpStatus: 503, ambiguous: true });
    assertDealSnapshot(deal, expectedDeal, ACTIVATION_MUTABLE_FIELDS);
    return deal;
  }

  async function recordRollback(dealId, {
    deploymentId, configurationVersionId, stoppedAt, reason, routeInactive = true,
    activatedAt = null, expectedDeal,
  }) {
    let deal = await getDeal(dealId);
    // Activation and rollback share no external transaction. A rollback that
    // already won the local CAS may observe only the exact activation fields
    // moving in CRM; identity, approval, configuration, and Form 2 evidence
    // must remain byte-for-byte equal to the prevalidated snapshot.
    assertDealSnapshot(deal, expectedDeal, ROLLBACK_INTERLEAVING_MUTABLE_FIELDS);
    invariant(deal.Deployment_Record_ID === deploymentId
      // The prevalidated snapshot owns the CRM label. The approved version is
      // the physical immutable row ID; neither may substitute for the other.
      && typeof expectedDeal.Configuration_Version === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(expectedDeal.Configuration_Version)
      && deal.Configuration_Version === expectedDeal.Configuration_Version
      && typeof configurationVersionId === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(configurationVersionId)
      && deal.Approved_Configuration_Version === configurationVersionId,
    'CRM_TRANSITION_PRECONDITION_FAILED', 'CRM rollback identity is invalid.',
    { httpStatus: 409 });
    invariant(!deal.Billing_Subscription_ID,
      'CRM_TRANSITION_PRECONDITION_FAILED',
      'A Deal with a Billing subscription cannot use Free Test rollback.',
      { httpStatus: 409 });
    invariant(CRM_ROLLBACK_END_REASONS.has(reason),
      'CRM_TRANSITION_PRECONDITION_FAILED',
      'CRM rollback reason is not an approved picklist value.',
      { httpStatus: 409 });
    if (deal.Stage === 'Closed Lost') {
      const authorizedQaClose = deal.Test_Status === 'Failed' && !deal.Test_Start_At;
      const authorizedLiveClose = deal.Test_Status === 'Rolled Back'
        && Number.isFinite(Date.parse(activatedAt))
        && deal.Test_Start_At === activatedAt;
      invariant(deal.Rollback_Completed_At === stoppedAt
        && deal.Test_End_At === stoppedAt && deal.Test_End_Reason === reason
        && typeof deal.Reason_For_Loss__s === 'string'
        && deal.Reason_For_Loss__s.trim().length > 0
        && (authorizedQaClose || authorizedLiveClose),
      'CRM_TRANSITION_PRECONDITION_FAILED', 'CRM rollback history does not match.',
      { httpStatus: 409 });
      return deal;
    }
    if (!routeInactive) return Object.freeze({ ...deal, rollbackPending: true });
    const expectedControlState = ['Stage', 'Test_Status', 'Test_Start_At']
      .every((field) => same(
        deal[field] === undefined ? null : deal[field],
        expectedDeal[field] === undefined ? null : expectedDeal[field],
      ));
    const exactConcurrentActivation = deal.Stage === 'Test Live'
      && deal.Test_Status === 'Live'
      && Number.isFinite(Date.parse(activatedAt))
      && deal.Test_Start_At === activatedAt
      && deal.Go_Live_Approval_Status === 'Approved'
      && deal.Approved_Deployment_Record_ID === deploymentId
      && deal.Approved_Configuration_Version === configurationVersionId
      && !deal.Test_End_At;
    const exactContainedActivation = deal.Stage === 'Setup and QA'
      && deal.Test_Status === 'Scheduled'
      && (deal.Test_Start_At === null || deal.Test_Start_At === undefined
        || (Number.isFinite(Date.parse(activatedAt)) && deal.Test_Start_At === activatedAt))
      && deal.Go_Live_Approval_Status === 'Approved'
      && deal.Approved_Deployment_Record_ID === deploymentId
      && deal.Approved_Configuration_Version === configurationVersionId
      && !deal.Test_End_At;
    invariant(expectedControlState || exactConcurrentActivation || exactContainedActivation,
      'CRM_TRANSITION_PRECONDITION_FAILED',
      'CRM rollback observed an unrelated control-state change.',
      { httpStatus: 409 });
    if (exactContainedActivation && deal.Test_Start_At === activatedAt) {
      deal = await updateDeal(dealId, { Test_Start_At: null }, deal.Modified_Time);
    }
    const transitionName = TRANSITIONS.rollbackByStage[deal.Stage];
    invariant(transitionName, 'CRM_TRANSITION_PRECONDITION_FAILED',
      'CRM Deal has no safe rollback transition.', { httpStatus: 409 });
    const fields = {
      Test_End_At: stoppedAt,
      Test_End_Reason: reason,
      Rollback_Completed_At: stoppedAt,
    };
    const statusBeforeEvidence = deal.Test_Status;
    const exactPartial = Object.entries(fields)
      .every(([field, value]) => same(deal[field], value));
    const hasPartial = deal.Test_End_At != null || deal.Test_End_Reason != null
      || deal.Rollback_Completed_At != null;
    invariant(!hasPartial || exactPartial,
      'CRM_TRANSITION_PRECONDITION_FAILED',
      'CRM rollback fields contain a conflicting partial transition.',
      { httpStatus: 409 });
    if (!exactPartial) deal = await updateDeal(dealId, fields, deal.Modified_Time);
    invariant(deal.Stage !== 'Closed Lost'
      && deal.Test_Status === statusBeforeEvidence
      && deal.Rollback_Completed_At === stoppedAt
      && deal.Test_End_At === stoppedAt
      && deal.Test_End_Reason === reason,
    'CRM_READBACK_INVALID', 'CRM rollback evidence did not read back exactly.',
    { httpStatus: 503, ambiguous: true });
    assertDealSnapshot(deal, expectedDeal, ROLLBACK_INTERLEAVING_MUTABLE_FIELDS);
    return Object.freeze({
      ...deal,
      manualCloseRequired: Object.freeze({
        transitionName,
        requiredOperatorField: 'Reason_For_Loss__s',
        rollbackStatus: 'provider_inactive_and_control_stopped',
      }),
    });
  }

  async function recordCoreRollback(dealId, {
    configurationVersionId, stoppedAt, reason, expectedDeal,
  }) {
    let deal = await getDeal(dealId);
    assertDealSnapshot(deal, expectedDeal);
    invariant(!deal.Billing_Subscription_ID && !deal.Deployment_Record_ID
      && !deal.Approved_Deployment_Record_ID
      && deal.Configuration_Version === configurationVersionId
      && deal.Approved_Configuration_Version === configurationVersionId,
    'CRM_TRANSITION_PRECONDITION_FAILED',
    'CRM Deal is not a pre-telephony Journey-core deployment.', { httpStatus: 409 });
    invariant(CRM_ROLLBACK_END_REASONS.has(reason),
      'CRM_TRANSITION_PRECONDITION_FAILED',
      'CRM rollback reason is not an approved picklist value.', { httpStatus: 409 });
    const desired = {
      Stage: 'Closed Lost', Test_Status: 'Failed', Go_Live_Approval_Status: 'Revoked',
      Test_Start_At: null, Test_End_At: toCrmDateTime(stoppedAt), Test_End_Reason: reason,
      Rollback_Completed_At: toCrmDateTime(stoppedAt),
      Reason_For_Loss__s: deal.Reason_For_Loss__s || CRM_ROLLBACK_LOSS_REASON,
    };
    const exactStopped = (value) => Object.entries(desired)
      .every(([field, expected]) => sameDealField(field, value[field], expected))
      && value.Configuration_Version === configurationVersionId
      && value.Approved_Configuration_Version === configurationVersionId
      && !value.Deployment_Record_ID && !value.Approved_Deployment_Record_ID;
    if (exactStopped(deal)) return deal;
    invariant(deal.Stage === 'Setup and QA' && deal.Test_Status === 'Scheduled'
      && deal.Go_Live_Approval_Status === 'Approved'
      && !deal.Test_Start_At && !deal.Test_End_At && !deal.Rollback_Completed_At,
    'CRM_TRANSITION_PRECONDITION_FAILED',
    'CRM Deal is not awaiting Journey-core rollback.', { httpStatus: 409 });
    try {
      deal = await updateCoreDeal(dealId, desired, deal.Modified_Time);
    } catch (error) {
      try { deal = await getDeal(dealId); } catch (readError) {
        throw new RevenueDeskError('CRM_ROLLBACK_RECONCILIATION_REQUIRED',
          'CRM Journey-core rollback outcome requires reconciliation.',
          { cause: readError, httpStatus: 503, ambiguous: true });
      }
      if (!exactStopped(deal)) {
        throw new RevenueDeskError('CRM_ROLLBACK_RECONCILIATION_REQUIRED',
          'CRM Journey-core rollback outcome requires reconciliation.',
          { cause: error, httpStatus: 503, ambiguous: true });
      }
    }
    invariant(exactStopped(deal), 'CRM_READBACK_INVALID',
      'CRM Journey-core rollback did not read back exactly.',
      { httpStatus: 503, ambiguous: true });
    assertDealSnapshot(deal, expectedDeal, CORE_ROLLBACK_MUTABLE_FIELDS);
    return deal;
  }

  return Object.freeze({ getDeal, proveActivationInactive, containActivation,
    recordApproval, recordActivation, recordRollback, recordCoreApproval, recordCoreRollback,
    getPreparationRecords, getPreparationFieldMetadata, getNativeConversion, getPublicOriginalLead,
    recordConfigurationStaging });
}

module.exports = Object.freeze({ DEAL_FIELDS, PUBLIC_LINEAGE_FIELDS, TRANSITIONS, createCrmControlClient,
  parseTransitionId });
