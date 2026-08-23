'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const contracts = require('../lib/contracts');
const { loadConfig } = require('../lib/config');
const { verifyRetellSignature } = require('../lib/security');
const { validateInboundPayload } = require('../lib/validation');
const {
  extractAnalysis,
  validateValueEvidence,
  admissionReconciliationBinding,
  validateAdmissionReconciliationEvidence,
} = require('../lib/service');
const {
  SyntheticNotificationAdapter,
  SyntheticAnalyticsAdapter,
  SyntheticAdmissionReconciliationAdapter,
} = require('../lib/adapters');
const { NOW, runtimeConfig, createFixture, admit } = require('./helpers');

function validEnvironment() {
  return {
    DEPLOYMENT_ENVIRONMENT: 'development',
    SOURCE_REVISION: 'a'.repeat(40),
    RETELL_WEBHOOK_API_KEY: 'retell-development-webhook-key',
    RETELL_SHARED_AGENT_ID: runtimeConfig.sharedAgentId,
    RETELL_SHARED_AGENT_VERSION: '7',
    RETELL_INBOUND_PATH: '/retell/inbound',
    RETELL_EVENTS_PATH: '/retell/events',
    RETELL_SIGNATURE_MAX_AGE_MS: '300000',
    MAX_WEBHOOK_BYTES: '262144',
    INBOUND_BODY_TIMEOUT_MS: '5000',
    ADMISSION_HMAC_SECRET: 'a'.repeat(32),
    EVENT_HMAC_SECRET: 'b'.repeat(32),
    NUMBER_LOOKUP_HMAC_SECRET: 'c'.repeat(32),
    PLATFORM_OPERATION_TIMEOUT_MS: '3000',
    NOTIFICATION_MODE: 'synthetic',
    NOTIFICATION_MAX_ATTEMPTS: '3',
    ANALYTICS_MODE: 'synthetic',
    CRM_SUMMARY_MODE: 'disabled',
    DEPLOYMENT_TABLE: 'DevDeployment',
    CONFIGURATION_TABLE: 'DevConfiguration',
    NUMBER_ASSIGNMENT_TABLE: 'DevNumberAssignment',
    ADMISSION_SLOT_TABLE: 'DevAdmissionSlot',
    ADMISSION_RECORD_TABLE: 'DevAdmissionRecord',
    EVENT_RECEIPT_TABLE: 'DevEventReceipt',
    CANONICAL_CALL_TABLE: 'DevCanonicalCall',
    NOTIFICATION_TABLE: 'DevNotification',
    REPORTING_OUTBOX_TABLE: 'DevReportingOutbox',
  };
}

test('unit: canonical contract preserves exact gate taxonomies and two post-call events', () => {
  assert.deepEqual([...contracts.COVERAGE_MODES], ['AfterHoursOnly', 'NoAnswerOverflowOnly', 'AfterHoursAndOverflow']);
  assert.deepEqual([...contracts.COVERAGE_LABEL_TO_MODE], [
    ['After Hours Only', 'AfterHoursOnly'],
    ['No Answer / Overflow Only', 'NoAnswerOverflowOnly'],
    ['After Hours + Overflow', 'AfterHoursAndOverflow'],
  ]);
  assert.deepEqual([...contracts.RETELL_EVENTS], ['call_ended', 'call_analyzed']);
  assert.deepEqual([...contracts.COVERAGE_TRIGGERS], ['AfterHours', 'NoAnswerOverflow', 'Unknown']);
  assert.equal(contracts.STOP_REASON_TO_CRM.get('seven_day_limit_reached'), 'Seven-Day Limit Reached');
  assert.equal(contracts.STOP_REASON_TO_CRM.get('call_limit_reached'), 'Call Limit Reached');
  assert.equal(contracts.OUTCOMES.size, 11);
  assert.equal(contracts.VALUE_EVIDENCE_CLASSES.size, 5);
  assert.deepEqual([...contracts.ADMISSION_STATES], ['Reserved', 'Handled', 'ReleasedNoCall']);
  assert.deepEqual([...contracts.ADMISSION_RECONCILIATION_DECISIONS], [
    'NoCallCreated', 'CallObserved', 'Ambiguous',
  ]);
});

test('unit: runtime environment registry has exact parity and rejects Production, missing, and placeholders', () => {
  const registryPath = path.join(__dirname, '..', '..', '..', 'config', 'variables.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const env = validEnvironment();
  assert.deepEqual(Object.keys(env).sort(), registry.variables.map(({ name }) => name).sort());
  assert.match(registry.variables.find(({ name }) => name === 'RETELL_WEBHOOK_API_KEY').format, /24-4096/);
  for (const name of ['ADMISSION_HMAC_SECRET', 'EVENT_HMAC_SECRET', 'NUMBER_LOOKUP_HMAC_SECRET']) {
    assert.match(registry.variables.find((entry) => entry.name === name).format, /32-4096/);
  }
  assert.equal(loadConfig(env).environment, 'development');
  assert.throws(() => loadConfig({ ...env, DEPLOYMENT_ENVIRONMENT: 'production' }), { code: 'PRODUCTION_BLOCKED' });
  const missing = { ...env };
  delete missing.EVENT_HMAC_SECRET;
  assert.throws(() => loadConfig(missing), { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({ ...env, DEPLOYMENT_TABLE: '<private-development-table-name>' }), { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({ ...env, RETELL_WEBHOOK_API_KEY: 'short-key' }), { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({ ...env, RETELL_SHARED_AGENT_ID: 'bad.id' }), { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({ ...env, DEPLOYMENT_TABLE: 'bad.table' }), { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({ ...env, EVENT_HMAC_SECRET: `bad secret ${'x'.repeat(30)}` }), { code: 'INVALID_RUNTIME_CONFIGURATION' });
});

test('unit: coverage contract and durable state-machine schema remain in parity', () => {
  const authorityPath = path.join(__dirname, '..', '..', '..', '..', 'retell-inbound-resolver', 'contracts', 'coverage-mode-contract.json');
  const authority = JSON.parse(fs.readFileSync(authorityPath, 'utf8'));
  assert.deepEqual(contracts.CONTRACT.canonical_coverage_modes, authority.canonical_coverage_modes);
  assert.deepEqual(contracts.CONTRACT.display_label_mappings, authority.display_label_mappings);
  assert.deepEqual(contracts.CONTRACT.coverage_triggers.slice(0, 2), authority.coverage_triggers);

  const schemaPath = path.join(__dirname, '..', '..', '..', 'config', 'datastore-schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const notification = schema.tables.find(({ runtime_variable: name }) => name === 'NOTIFICATION_TABLE');
  const notificationColumns = new Set(notification.columns.map(({ api_name: name }) => name));
  for (const field of ['CLIENT_ID', 'CREATED_AT', 'UPDATED_AT', 'LAST_ATTEMPT_AT', 'NEXT_ATTEMPT_AT', 'ATTEMPT_COUNT', 'STATUS']) {
    assert.ok(notificationColumns.has(field), field);
  }
  const admissions = schema.tables.find(({ runtime_variable: name }) => name === 'ADMISSION_SLOT_TABLE');
  assert.ok(admissions.required_unique_columns.includes('ADMISSION_ID'));
  assert.equal(admissions.columns.find(({ api_name: name }) => name === 'ADMISSION_ID').unique, true);
  const admissionLedger = schema.tables.find(({ runtime_variable: name }) => name === 'ADMISSION_RECORD_TABLE');
  assert.deepEqual(admissionLedger.required_unique_columns, ['ADMISSION_KEY']);
  const admissionColumns = new Set(admissionLedger.columns.map(({ api_name: name }) => name));
  for (const field of [
    'ADMISSION_KEY', 'ADMISSION_STATE', 'RECONCILIATION_STATE', 'RECONCILIATION_LEASE_TOKEN',
    'EVIDENCE_FINGERPRINT', 'BINDING_FINGERPRINT', 'RELEASED_AT',
  ]) assert.ok(admissionColumns.has(field), field);
  const eventReceipt = schema.tables.find(({ runtime_variable: name }) => name === 'EVENT_RECEIPT_TABLE');
  const receiptColumns = new Set(eventReceipt.columns.map(({ api_name: name }) => name));
  for (const field of ['EVENT_KEY', 'CALL_KEY', 'PAYLOAD_FINGERPRINT', 'EVENT_TYPE', 'STATUS', 'ATTEMPT_COUNT', 'LEASE_TOKEN', 'RECEIVED_AT', 'LEASE_EXPIRES_AT']) {
    assert.ok(receiptColumns.has(field), field);
  }
  assert.equal(receiptColumns.has('PROVIDER_CALL_ID'), false);
  assert.equal(receiptColumns.has('NORMALIZED_EVENT_JSON'), false);
  const outbox = schema.tables.find(({ runtime_variable: name }) => name === 'REPORTING_OUTBOX_TABLE');
  const outboxColumns = new Set(outbox.columns.map(({ api_name: name }) => name));
  for (const field of ['CLIENT_ID', 'CREATED_AT', 'UPDATED_AT', 'LAST_ATTEMPT_AT', 'NEXT_ATTEMPT_AT', 'ATTEMPT_COUNT', 'STATUS']) {
    assert.ok(outboxColumns.has(field), field);
  }
});

test('unit: official Retell raw-body signature verifies with 300-second freshness and rejects tampering', () => {
  const rawBody = Buffer.from('{"event":"call_ended"}', 'utf8');
  const timestamp = 1_800_000_000_000;
  const verificationKey = 'synthetic-retell-verification-key';
  const digest = crypto.createHmac('sha256', verificationKey).update(rawBody.toString('utf8') + timestamp).digest('hex');
  const header = `v=${timestamp},d=${digest}`;
  assert.equal(verifyRetellSignature({ rawBody, signatureHeader: header, verificationKey, nowMs: timestamp, maxAgeMs: 300_000 }).timestamp, timestamp);
  assert.throws(() => verifyRetellSignature({ rawBody: Buffer.from('{}'), signatureHeader: header, verificationKey, nowMs: timestamp, maxAgeMs: 300_000 }), { code: 'INVALID_SIGNATURE' });
  assert.throws(() => verifyRetellSignature({ rawBody, signatureHeader: header, verificationKey, nowMs: timestamp + 300_001, maxAgeMs: 300_000 }), { code: 'STALE_SIGNATURE' });
  assert.throws(() => verifyRetellSignature({ rawBody, signatureHeader: header, verificationKey, nowMs: timestamp, maxAgeMs: 299_999 }), { code: 'INVALID_RUNTIME_CONFIGURATION' });
});

test('unit: optional bounded SIP headers are accepted then discarded from normalized inbound data', () => {
  const normalized = validateInboundPayload({
    event: 'call_inbound',
    event_timestamp: 1_800_000_000_000,
    call_inbound: {
      agent_id: runtimeConfig.sharedAgentId,
      from_number: '+15551110001',
      to_number: '+15550000001',
      custom_sip_headers: { 'X-Synthetic-Trace': 'discard-me' },
    },
  });
  assert.equal(normalized.toNumber, '+15550000001');
  assert.equal(Object.hasOwn(normalized, 'customSipHeaders'), false);
  assert.throws(() => validateInboundPayload({
    event: 'call_inbound', event_timestamp: 1, call_inbound: {
      from_number: '+15551110001', to_number: '+15550000001', custom_sip_headers: { 'bad header': 'x' },
    },
  }), { code: 'INVALID_SCHEMA' });
});

test('unit: sensitive outcomes and obvious sensitive free text are minimized before value validation', () => {
  const contradictory = extractAnalysis({ call_analysis: { custom_analysis_data: {
    outcome: 'sensitive_data_ended',
    caller_name: 'Do Not Store',
    callback_number: '+15551110001',
    issue_summary: 'secret',
    value_evidence_class: 'confirmed_revenue',
    value_minor_units: -1,
  } } }, new Set());
  assert.equal(contradictory.outcome, 'sensitive_data_ended');
  assert.equal(contradictory.callerName, null);
  assert.equal(contradictory.callbackNumber, null);
  assert.equal(contradictory.value.evidenceClass, 'unknown');

  const pattern = extractAnalysis({ call_analysis: { custom_analysis_data: {
    outcome: 'potential_job', issue_summary: 'My verification code is 123456', callback_number: '+15551110001',
  } } }, new Set());
  assert.equal(pattern.outcome, 'sensitive_data_ended');
  assert.equal(pattern.issueSummary, null);
  for (const issue_summary of [
    'My bank account is 123456789',
    'My medical diagnosis is diabetes',
    'My government ID is A12345678',
    'My SSN is 123456789',
    'Social Security number 123456789',
    'Bank routing 123456789',
  ]) {
    const minimized = extractAnalysis({ call_analysis: { custom_analysis_data: {
      outcome: 'potential_job', issue_summary, callback_number: '+15551110001',
    } } }, new Set());
    assert.equal(minimized.outcome, 'sensitive_data_ended');
    assert.equal(minimized.issueSummary, null);
  }
});

test('unit: Retell may report only unknown or customer-supplied value evidence', () => {
  assert.equal(validateValueEvidence({}, new Set()).evidenceClass, 'unknown');
  assert.equal(validateValueEvidence({
    value_evidence_class: 'customer_supplied_estimate', value_minor_units: 12500, value_currency: 'USD',
  }, new Set()).evidenceClass, 'customer_supplied_estimate');
  assert.throws(() => validateValueEvidence({
    value_evidence_class: 'confirmed_revenue', value_minor_units: 12500, value_currency: 'USD',
  }, new Set()), { code: 'UNAUTHORIZED_VALUE_EVIDENCE' });
  assert.equal(validateValueEvidence({
    value_evidence_class: 'booked_revenue', value_minor_units: 12500, value_currency: 'USD',
  }, new Set(), 'verified_downstream').evidenceClass, 'booked_revenue');
  assert.equal(validateValueEvidence({
    value_evidence_class: 'internal_estimate_with_method', value_minor_units: 12500,
    value_currency: 'USD', value_method_id: 'documented', value_method_version: 'v1',
  }, new Set(['documented:v1']), 'server_method').evidenceClass, 'internal_estimate_with_method');
  assert.throws(() => validateValueEvidence({
    value_evidence_class: 'internal_estimate_with_method', value_minor_units: 12500,
    value_currency: 'USD', value_method_id: 'undocumented', value_method_version: 'v1',
  }, new Set(), 'server_method'), { code: 'UNDOCUMENTED_VALUE_METHOD' });
});

test('unit: notification idempotency binds a key to recipient and payload', async () => {
  const adapter = new SyntheticNotificationAdapter();
  await adapter.send({ idempotencyKey: 'notify-1', recipientId: 'recipient_A', payload: { outcome: 'potential_job' } });
  await adapter.send({ idempotencyKey: 'notify-1', recipientId: 'recipient_A', payload: { outcome: 'potential_job' } });
  await assert.rejects(adapter.send({
    idempotencyKey: 'notify-1', recipientId: 'recipient_B', payload: { outcome: 'potential_job' },
  }), { code: 'NOTIFICATION_IDEMPOTENCY_CONFLICT' });
});

test('unit: Analytics idempotency rejects cross-client projection collisions', async () => {
  const adapter = new SyntheticAnalyticsAdapter();
  await adapter.upsert({ idempotencyKey: 'analytics-1', projectionKey: 'call-1', projection: { clientId: 'client_A' } });
  await adapter.upsert({ idempotencyKey: 'analytics-1', projectionKey: 'call-1', projection: { clientId: 'client_A' } });
  await assert.rejects(adapter.upsert({
    idempotencyKey: 'analytics-1', projectionKey: 'call-1', projection: { clientId: 'client_B' },
  }), { code: 'ANALYTICS_IDEMPOTENCY_CONFLICT' });
});

test('unit: durable store binds notification, outbox, and call idempotency to immutable ownership', async () => {
  const fixture = createFixture();
  const notification = {
    notificationId: 'notify_key', callKey: 'call_key', correlationId: 'corr_key', clientId: 'client_A',
    deploymentId: 'deployment_A', configurationVersion: 'cfg_A_v1', recipientId: 'recipient_A',
    sourceRevision: runtimeConfig.sourceRevision, sourceEnvironment: runtimeConfig.environment,
    payload: { outcome: 'potential_job' }, state: 'Pending', attempts: 0,
  };
  await fixture.store.ensureNotification(notification);
  await assert.rejects(fixture.store.ensureNotification({ ...notification, recipientId: 'recipient_B' }),
    { code: 'NOTIFICATION_OWNERSHIP_CONFLICT' });
  await assert.rejects(fixture.store.ensureNotification({ ...notification, sourceRevision: 'b'.repeat(40) }),
    { code: 'NOTIFICATION_OWNERSHIP_CONFLICT' });
  const outbox = {
    outboxId: 'outbox_key', callKey: 'call_key', correlationId: 'corr_key', clientId: 'client_A',
    deploymentId: 'deployment_A', configurationVersion: 'cfg_A_v1',
    sourceRevision: runtimeConfig.sourceRevision, sourceEnvironment: runtimeConfig.environment,
    projection: { outcome: 'potential_job' }, state: 'Pending',
  };
  await fixture.store.ensureOutbox(outbox);
  await assert.rejects(fixture.store.ensureOutbox({ ...outbox, projection: { outcome: 'spam' } }),
    { code: 'OUTBOX_OWNERSHIP_CONFLICT' });
  await assert.rejects(fixture.store.ensureOutbox({ ...outbox, sourceEnvironment: 'production' }),
    { code: 'OUTBOX_OWNERSHIP_CONFLICT' });
});

test('unit: event receipt lease blocks concurrent work but allows deterministic crash recovery', async () => {
  const fixture = createFixture();
  const base = {
    receiptKey: 'receipt_key', callKey: 'call_key', eventType: 'call_analyzed', fingerprint: 'a'.repeat(64),
    receivedAt: '2026-08-22T12:00:00.000Z', leaseExpiresAt: '2026-08-22T12:00:30.000Z',
  };
  const first = await fixture.store.beginEvent(base);
  const concurrent = await fixture.store.beginEvent({
    ...base, receivedAt: '2026-08-22T12:00:01.000Z', leaseExpiresAt: '2026-08-22T12:00:31.000Z',
  });
  const recovered = await fixture.store.beginEvent({
    ...base, receivedAt: '2026-08-22T12:00:30.000Z', leaseExpiresAt: '2026-08-22T12:01:00.000Z',
  });
  assert.equal(first.inProgress, false);
  assert.equal(concurrent.inProgress, true);
  assert.equal(recovered.resumed, true);
  assert.equal(recovered.receipt.attempts, 2);
  await fixture.store.finishEvent('receipt_key', recovered.receipt.leaseToken, 'Completed');
  await assert.rejects(
    fixture.store.finishEvent('receipt_key', first.receipt.leaseToken, 'RetryRequired', 'STALE_WORKER'),
    { code: 'EVENT_LEASE_LOST' },
  );
  assert.equal((await fixture.store.snapshot()).receipts[0].status, 'Completed');
});

test('unit: orphan reconciliation crash recovery is lease-fenced, evidence-bound, replay-safe, and never changes handled count', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const admissionId = admitted.metadata.admission_id;
  const first = await fixture.store.claimAdmissionReconciliation(
    admissionId, new Date(NOW).toISOString(),
  );
  assert.equal(first.reconciliationLeaseToken, 1);
  const concurrent = await fixture.store.claimAdmissionReconciliation(
    admissionId, new Date(NOW + 1).toISOString(),
  );
  assert.equal(concurrent, null);
  const recoveredAt = new Date(NOW + contracts.CONTRACT.admission_reconciliation_lease_ms).toISOString();
  const recovered = await fixture.store.claimAdmissionReconciliation(admissionId, recoveredAt);
  assert.equal(recovered.reconciliationLeaseToken, 2);
  const bindingFingerprint = admissionReconciliationBinding(runtimeConfig, recovered);
  const adapter = new SyntheticAdmissionReconciliationAdapter({
    environment: 'development', behavior: () => 'no_call_created',
  });
  const evidence = validateAdmissionReconciliationEvidence(await adapter.inspect({
    idempotencyKey: `${admissionId}:authoritative_reconciliation_v1`,
    admissionId,
    bindingFingerprint,
    observedAt: recoveredAt,
  }), bindingFingerprint, recoveredAt);
  await assert.rejects(
    fixture.store.releaseAdmissionNoCall(admissionId, first.reconciliationLeaseToken, evidence, recoveredAt),
    { code: 'ADMISSION_RECONCILIATION_LEASE_LOST' },
  );
  const released = await fixture.store.releaseAdmissionNoCall(
    admissionId, recovered.reconciliationLeaseToken, evidence, recoveredAt,
  );
  const replay = await fixture.store.releaseAdmissionNoCall(
    admissionId, recovered.reconciliationLeaseToken, evidence, recoveredAt,
  );
  const snapshot = await fixture.store.snapshot();
  assert.equal(released.replay, false);
  assert.equal(replay.replay, true);
  assert.equal(snapshot.deployments.find(({ deploymentId }) => deploymentId === 'deployment_A').admittedCallCount, 0);
  assert.equal(snapshot.deployments.find(({ deploymentId }) => deploymentId === 'deployment_A').handledCallCount, 0);
  assert.equal(snapshot.admissions[0].state, 'ReleasedNoCall');
});

test('unit: deployment entrypoint is an unconditional non-cacheable 503 barrier', () => {
  const server = require('../index');
  const handler = server.listeners('request')[0];
  const response = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; },
  };
  handler({ method: 'POST', url: '/retell/events' }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    code: 'development_runtime_not_enabled',
  });
  assert.equal(server.listening, false);
});

test('unit: runtime readiness remains no-go until every authoritative Development contract is verified', () => {
  const readinessPath = path.join(__dirname, '..', '..', '..', 'config', 'runtime-readiness.json');
  const readiness = JSON.parse(fs.readFileSync(readinessPath, 'utf8'));
  assert.equal(readiness.decision, 'no_go');
  assert.equal(readiness.environment, 'development');
  assert.equal(readiness.entrypoint_policy, 'fixed_503');
  assert.equal(readiness.release_gate.fixed_503_removal_requires_separate_review, true);
  assert.equal(readiness.release_gate.production_remains_prohibited, true);
  const requiredGaps = new Set([
    'atomic_admission_and_handled_count',
    'nullable_unique_and_duplicate_error',
    'conditional_zcql_result_and_timeout',
    'lease_fenced_side_effect_claims',
    'queue_worker_runtime',
    'runtime_environment_and_raw_body_readback',
    'notification_provider_contract',
    'analytics_handoff_contract',
    'orphan_admission_reconciliation',
  ]);
  assert.deepEqual(new Set(readiness.blocking_evidence_gaps.map(({ id }) => id)), requiredGaps);
  assert.equal(readiness.blocking_evidence_gaps.every(({ status }) => status === 'unverified'), true);
  assert.equal(readiness.documented_platform_capabilities.every(({ source, secondary_source: secondary }) => (
    source.startsWith('https://docs.catalyst.zoho.com/')
      && (!secondary || secondary.startsWith('https://docs.catalyst.zoho.com/'))
  )), true);
});
