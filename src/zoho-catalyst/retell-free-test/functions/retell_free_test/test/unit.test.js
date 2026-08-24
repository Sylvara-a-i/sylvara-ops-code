'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const contracts = require('../lib/contracts');
const { loadConfig, loadJobConfig } = require('../lib/config');
const { verifyRetellSignature } = require('../lib/security');
const { validateInboundPayload } = require('../lib/validation');
const { extractAnalysis, validateValueEvidence } = require('../lib/analysis');
const { CatalystMailAdapter, messageContent } = require('../lib/catalyst-mail');
const { readRawBody } = require('../lib/http');
const { csvCell } = require('../lib/reporting');
const { timingSafeToken } = require('../lib/runtime-boundary');
const { createSafeConsoleLogger } = require('../lib/logging');
const { environment } = require('./runtime-fixture');

test('unit: approved gate taxonomies and event surface are exact', () => {
  assert.deepEqual([...contracts.COVERAGE_MODES], ['AfterHoursOnly', 'NoAnswerOverflowOnly', 'AfterHoursAndOverflow']);
  assert.deepEqual([...contracts.COVERAGE_LABEL_TO_MODE], [
    ['After Hours Only', 'AfterHoursOnly'],
    ['No Answer / Overflow Only', 'NoAnswerOverflowOnly'],
    ['After Hours + Overflow', 'AfterHoursAndOverflow'],
  ]);
  assert.deepEqual([...contracts.RETELL_EVENTS], ['call_ended', 'call_analyzed']);
  assert.equal(contracts.OUTCOMES.size, 11);
  assert.equal(contracts.VALUE_EVIDENCE_CLASSES.size, 5);
  assert.equal(contracts.NOTIFICATION_STATES.has('DryRunRecorded'), true);
  assert.equal(contracts.STOP_REASON_TO_CRM.get('call_limit_reached'), 'Call Limit Reached');
});

test('unit: environment registry exactly matches reads and rejects Production or unsafe values', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'config', 'variables.json'), 'utf8'));
  const env = environment();
  assert.deepEqual(Object.keys(env).sort(), registry.variables.map(({ name }) => name).sort());
  assert.deepEqual(registry.variables.filter(({ name }) => name.startsWith('CATALYST_')), [],
    'Catalyst reserves the CATALYST_ environment-variable namespace');
  assert.equal(loadConfig(env).tables.DEPLOYMENT_TABLE, 'FreeTestDeployments');
  const jobOnly = { ...env };
  for (const name of [
    'RETELL_WEBHOOK_API_KEY', 'NUMBER_LOOKUP_HMAC_SECRET', 'INTERNAL_READINESS_TOKEN',
    'RETELL_INBOUND_PATH', 'RETELL_EVENTS_PATH', 'INTERNAL_READINESS_PATH',
    'FREE_TEST_DEVELOPMENT_HOST', 'RETELL_SIGNATURE_MAX_AGE_MS', 'MAX_WEBHOOK_BYTES',
    'INBOUND_BODY_TIMEOUT_MS',
  ]) delete jobOnly[name];
  assert.equal(loadJobConfig(jobOnly).retryJobPoolId, env.FREE_TEST_RETRY_JOB_POOL_ID);
  assert.equal(Object.hasOwn(loadConfig(env), 'retryJobPoolId'), false);
  assert.throws(() => loadConfig({ ...env, DEPLOYMENT_ENVIRONMENT: 'production' }), { code: 'PRODUCTION_BLOCKED' });
  assert.throws(() => loadConfig({ ...env, ZOHO_CATALYST_ZCQL_PARSER: 'V1' }),
    { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({ ...env, EVENT_HMAC_SECRET: env.NUMBER_LOOKUP_HMAC_SECRET }),
    { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({ ...env, DEPLOYMENT_TABLE: 'AnotherTable' }),
    { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({ ...env, FREE_TEST_NOTIFICATION_MODE: 'send' }),
    { code: 'PRODUCTION_BLOCKED' });
  assert.throws(() => loadConfig({ ...env, FREE_TEST_MAIL_FROM: 'not-email' }),
    { code: 'INVALID_RUNTIME_CONFIGURATION' });
  for (const [name, value] of [
    ['RETELL_WEBHOOK_API_KEY', '<set-in-catalyst-secret>'],
    ['EVENT_HMAC_SECRET', '<set-in-catalyst-secret-material>'],
    ['NUMBER_LOOKUP_HMAC_SECRET', '<set-in-catalyst-secret-material>'],
    ['INTERNAL_READINESS_TOKEN', '<set-in-catalyst-secret-material>'],
  ]) {
    assert.throws(() => loadConfig({ ...env, [name]: value }),
      { code: 'INVALID_RUNTIME_CONFIGURATION' }, name);
  }
});

test('unit: default console logger emits only allowlisted opaque operational fields', () => {
  const lines = [];
  const logger = createSafeConsoleLogger({
    error(line) { lines.push(line); },
    warn(line) { lines.push(line); },
  });
  logger.error({
    event: 'runtime_request_failed', correlationId: `corr_${'a'.repeat(32)}`,
    errorCode: 'INVALID_SIGNATURE', route: 'events', status: 401,
    eventType: 'call_ended', state: 'TerminalFailure',
    eventCount: 2, notificationCount: 1, reconciliationRequired: 0,
    signature: 'private-signature', rawPayload: '{"caller":"private"}',
    phoneNumber: '+15550000000', recipient: 'private@example.invalid',
  });
  assert.deepEqual(JSON.parse(lines[0]), {
    level: 'error', event: 'runtime_request_failed',
    correlationId: `corr_${'a'.repeat(32)}`, errorCode: 'INVALID_SIGNATURE',
    route: 'events', eventType: 'call_ended', state: 'TerminalFailure', status: 401,
    eventCount: 2, notificationCount: 1, reconciliationRequired: 0,
  });
  assert.doesNotMatch(lines[0], /private|15550000000/);
  logger.warn({ event: 'invalid event name', correlationId: '+15550000000', rawPayload: 'private' });
  assert.deepEqual(JSON.parse(lines[1]), { level: 'warn', event: 'runtime_log' });
});

test('unit: Data Store schema contains exactly the four implemented MVP tables', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'config', 'datastore-schema.json'), 'utf8'));
  assert.equal(schema.status, 'development-mvp-schema-contract');
  assert.equal(schema.live_state, 'requires_fresh_candidate_readback');
  assert.equal(Object.hasOwn(schema, 'development_readback'), false);
  assert.equal(schema.historical_development_readback.status, 'historical_only');
  assert.deepEqual(schema.tables.map(({ api_name: name }) => name), [
    'FreeTestDeployments', 'FreeTestRetellEventReceipts', 'FreeTestCalls', 'FreeTestNotifications',
  ]);
  for (const table of schema.tables) {
    assert.equal(table.required_unique_columns.length >= 1, true);
    for (const name of table.required_unique_columns) {
      assert.equal(table.columns.find(({ api_name: apiName }) => apiName === name).unique, true);
    }
    assert.equal(table.required_pii_ephi_columns.length >= 1, true);
    for (const name of table.required_pii_ephi_columns) {
      const column = table.columns.find(({ api_name: apiName }) => apiName === name);
      assert.equal(column.type, 'encrypted_text', name);
      assert.equal(column.audit_consent, true, name);
    }
    for (const column of table.columns.filter(({ type }) => type === 'encrypted_text')) {
      assert.equal(column.max_length, 10_000, column.api_name);
    }
  }
  const deploymentSchema = schema.tables.find(({ api_name: name }) => name === 'FreeTestDeployments');
  assert.deepEqual(deploymentSchema.required_unique_columns, ['DEPLOYMENT_KEY', 'NUMBER_LOOKUP_HASH']);
  assert.equal(deploymentSchema.columns.find(({ api_name: name }) => name === 'DEPLOYMENT_ID').unique, false);
  const receiptColumns = new Set(schema.tables.find(({ api_name: name }) => name === 'FreeTestRetellEventReceipts')
    .columns.map(({ api_name: name }) => name));
  for (const field of ['EVENT_DATA_JSON', 'RECEIPT_VERSION', 'LEASE_TOKEN', 'NEXT_ATTEMPT_AT']) {
    assert.equal(receiptColumns.has(field), true, field);
  }
  const notificationColumns = new Set(schema.tables.find(({ api_name: name }) => name === 'FreeTestNotifications')
    .columns.map(({ api_name: name }) => name));
  for (const field of ['NOTIFICATION_VERSION', 'TEMPLATE_VERSION', 'PROVIDER_RESULT_REFERENCE',
    'SEND_TOKEN', 'LAST_ATTEMPT_AT', 'NEXT_ATTEMPT_AT', 'LAST_ERROR_CODE']) {
    assert.equal(notificationColumns.has(field), true, field);
  }
  assert.equal(JSON.stringify(schema).includes('ADMISSION_SLOT'), false);
  assert.equal(JSON.stringify(schema).includes('REPORTING_OUTBOX'), false);
});

test('unit: Retell signature uses raw bytes, millisecond timestamp, constant-time HMAC, and 300-second freshness', () => {
  const rawBody = Buffer.from('{"event":"call_ended"}', 'utf8');
  const now = 1_800_000_000_000;
  const key = 'synthetic-retell-verification-key';
  const digest = crypto.createHmac('sha256', key).update(rawBody.toString('utf8') + now).digest('hex');
  const header = `v=${now},d=${digest}`;
  assert.equal(verifyRetellSignature({ rawBody, signatureHeader: header, verificationKey: key,
    nowMs: now, maxAgeMs: 300_000 }).timestamp, now);
  assert.throws(() => verifyRetellSignature({ rawBody: Buffer.from('{}'), signatureHeader: header,
    verificationKey: key, nowMs: now, maxAgeMs: 300_000 }), { code: 'INVALID_SIGNATURE' });
  assert.throws(() => verifyRetellSignature({ rawBody, signatureHeader: header, verificationKey: key,
    nowMs: now + 300_001, maxAgeMs: 300_000 }), { code: 'STALE_SIGNATURE' });
  assert.throws(() => verifyRetellSignature({ rawBody, signatureHeader: header.replace(String(now), String(Math.floor(now / 1000))),
    verificationKey: key, nowMs: now, maxAgeMs: 300_000 }), { code: 'STALE_SIGNATURE' });
});

test('unit: optional bounded SIP headers are accepted then discarded', () => {
  const normalized = validateInboundPayload({ event: 'call_inbound', event_timestamp: 1_800_000_000_000,
    call_inbound: { agent_id: 'agent_shared_free_test', agent_version: 7,
      from_number: '+15551110001', to_number: '+15550000001',
      custom_sip_headers: { 'X-Synthetic-Trace': 'discard-me' } } });
  assert.equal(normalized.toNumber, '+15550000001');
  assert.equal(Object.hasOwn(normalized, 'customSipHeaders'), false);
});

test('unit: sensitive-data signals minimize every caller field before value validation', () => {
  for (const data of [
    { outcome: 'sensitive_data_ended', caller_name: 'Do Not Store', value_evidence_class: 'confirmed_revenue' },
    { outcome: 'potential_job', issue_summary: 'My SSN is 123456789' },
    { outcome: 'potential_job', issue_summary: 'My bank routing number is 123456789' },
    { outcome: 'potential_job', issue_summary: 'My medical diagnosis is diabetes' },
    { outcome: 'potential_job', callback_number: '+378282246310005' },
  ]) {
    const result = extractAnalysis({ call_analysis: { custom_analysis_data: data } });
    assert.equal(result.outcome, 'sensitive_data_ended');
    assert.equal(result.callerName, null);
    assert.equal(result.callbackNumber, null);
    assert.equal(result.issueSummary, null);
    assert.equal(result.value.evidenceClass, 'unknown');
  }
});

test('unit: Retell cannot assert confirmed, booked, or internal estimated revenue', () => {
  assert.equal(validateValueEvidence({}).evidenceClass, 'unknown');
  assert.equal(validateValueEvidence({ value_evidence_class: 'customer_supplied_estimate',
    value_minor_units: 12500, value_currency: 'USD' }).evidenceClass, 'customer_supplied_estimate');
  for (const value_evidence_class of ['confirmed_revenue', 'booked_revenue', 'internal_estimate_with_method']) {
    assert.throws(() => validateValueEvidence({ value_evidence_class, value_minor_units: 12500,
      value_currency: 'USD' }), { code: 'UNAUTHORIZED_VALUE_EVIDENCE' });
  }
});

test('unit: Catalyst Mail dry-run validates email ownership and never accesses email SDK', async () => {
  let emailAccesses = 0;
  const config = loadConfig(environment());
  const adapter = new CatalystMailAdapter({
    app: { email() { emailAccesses += 1; throw new Error('must remain unreachable'); } }, config,
  });
  const prepared = adapter.prepare({ recipient: { approved: true, channel: 'email',
    email: 'approved@example.invalid' }, payload: { outcome: 'potential_job' } });
  const result = await adapter.notify(prepared);
  assert.equal(result.status, 'DryRunRecorded');
  assert.equal(emailAccesses, 0);
  assert.throws(() => adapter.prepare({ recipient: { approved: true, channel: 'mobile',
    email: 'approved@example.invalid' }, payload: {} }), { code: 'NOTIFICATION_DESTINATION_UNAVAILABLE' });
});

test('unit: Catalyst Mail real Development path uses official SDK shape and treats timeout as ambiguous', async () => {
  const sent = [];
  const config = loadConfig(environment({ FREE_TEST_NOTIFICATION_MODE: 'send_development' }));
  const adapter = new CatalystMailAdapter({ app: { email() { return { async sendMail(message) {
    sent.push(message); return { isAsync: false, project_details: { id: 'synthetic-project' },
      from_email: message.from_email, to_email: message.to_email };
  } }; } }, config });
  const prepared = adapter.prepare({ recipient: { approved: true, channel: 'email',
    email: 'synthetic-recipient@example.invalid' }, payload: { callerName: 'Synthetic Caller',
    callOutcome: 'potential_job' } });
  const delivered = await adapter.notify(prepared);
  assert.equal(delivered.status, 'Sent');
  assert.match(delivered.providerResultReference, /^mail_[a-f0-9]{64}$/);
  assert.deepEqual(sent[0].to_email, ['synthetic-recipient@example.invalid']);
  assert.equal(sent[0].from_email, 'verified-sender@example.invalid');
  assert.equal(sent[0].html_mode, true);

  const timeout = new CatalystMailAdapter({ app: { email() { return { sendMail() {
    return new Promise(() => {});
  } }; } }, config: { ...config, mailTimeoutMs: 5 } });
  const timedOut = await timeout.notify(timeout.prepare({ recipient: { approved: true, channel: 'email',
    email: 'synthetic-recipient@example.invalid' }, payload: { callOutcome: 'potential_job' } }));
  assert.equal(timedOut.status, 'Ambiguous');
  assert.equal(timedOut.ambiguous, true);

  const unverified = new CatalystMailAdapter({ app: { email() { return { async sendMail() {
    return { accepted: true };
  } }; } }, config });
  const unverifiedResult = await unverified.notify(unverified.prepare({ recipient: {
    approved: true, channel: 'email', email: 'synthetic-recipient@example.invalid',
  }, payload: { callOutcome: 'potential_job' } }));
  assert.equal(unverifiedResult.status, 'Ambiguous');
  assert.equal(unverifiedResult.providerCode, 'CATALYST_MAIL_RESPONSE_INVALID');
});

test('unit: Catalyst Mail escapes caller text and preserves the capability disclaimer', () => {
  const content = messageContent({
    callerName: '<script>alert("caller")</script>',
    issueSummary: '<img src=x onerror=alert("issue")>',
    callOutcome: 'potential_job',
  });
  assert.doesNotMatch(content, /<script|<img/i);
  assert.match(content, /&lt;script&gt;alert\(&quot;caller&quot;\)&lt;\/script&gt;/);
  assert.match(content, /&lt;img src=x onerror=alert\(&quot;issue&quot;\)&gt;/);
  assert.match(content, /No appointment or dispatch has been confirmed\./);
});

test('unit: raw-body reader enforces the byte ceiling', async () => {
  const request = Readable.from([Buffer.alloc(1025)]);
  await assert.rejects(readRawBody(request, { maximumBytes: 1024, timeoutMs: 1000 }),
    { code: 'REQUEST_TOO_LARGE' });
});

test('unit: CSV export neutralizes caller-supplied spreadsheet formulas and controls', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.invalid")'), `"'=HYPERLINK(""https://example.invalid"")"`);
  assert.equal(csvCell('  +1+1'), "'  +1+1");
  assert.equal(csvCell('safe\tvalue'), 'safe value');
});

test('unit: readiness token comparison is deterministic and timing-safe at the digest boundary', () => {
  assert.equal(timingSafeToken('a'.repeat(32), 'a'.repeat(32)), true);
  assert.equal(timingSafeToken('a'.repeat(32), 'b'.repeat(32)), false);
  assert.equal(timingSafeToken('short', 'b'.repeat(32)), false);
});

test('unit: runtime readiness is a one-number contract whose current status requires live readback', () => {
  const readiness = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'config', 'runtime-readiness.json'), 'utf8'));
  assert.equal(readiness.record_type, 'development_readiness_contract');
  assert.equal(readiness.environment, 'development');
  assert.equal(Object.hasOwn(readiness, 'source_revision'), false);
  assert.equal(Object.hasOwn(readiness, 'decision'), false);
  assert.equal(readiness.status_authority.current_status_not_committed, true);
  assert.equal(readiness.release_gate_contract.production_remains_prohibited, true);
  assert.equal(readiness.release_gate_contract.current_candidate_requires_exact_revision_deployment_and_readback, true);
  assert.equal(readiness.release_gate_contract.current_candidate_requires_sanitized_package_parity, true);
  assert.equal(readiness.scope.active_retell_development_number_count_at_last_observation, 1);
  assert.equal(readiness.scope.second_number_deferred, true);
  assert.equal(readiness.historical_observation.status, 'superseded_by_later_source_change');
  assert.match(readiness.historical_observation.observed_source_revision, /^[0-9a-f]{40}$/);
  assert.deepEqual(new Set(readiness.deferred_evidence.map(({ id }) => id)), new Set([
    'second_retell_development_number', 'retell_voice_and_provider_fallback',
    'prospect_launch_review',
  ]));
});

test('unit: sanitized Development function inventory preserves the canonical security boundaries', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..',
    'development-function-inventory.json'), 'utf8'));
  assert.equal(inventory.record_type, 'sanitized_development_function_inventory');
  assert.equal(inventory.environment, 'Development');
  assert.equal(inventory.production_authorized, false);
  assert.equal(inventory.authorization.manifest_is_deletion_authority, false);
  assert.equal(inventory.sanitization.function_ids_included, false);
  assert.equal(inventory.sanitization.invoke_urls_or_private_hosts_included, false);
  assert.deepEqual(Object.fromEntries(inventory.functions.map(({ api_name: name, classification }) => (
    [name, classification]
  ))), {
    retell_free_test: 'canonical',
    retell_free_test_retry: 'canonical',
    crm_billing_orchestrator: 'independently_necessary',
    retell_inbound_resolver: 'legacy_rollback_only',
    retell_route_approval_control: 'legacy_rollback_only',
    retell_events: 'legacy_rollback_only',
    process_retell_events: 'legacy_rollback_only',
    analytics_sync: 'legacy_deferred',
  });
  assert.equal(inventory.rollback_policy.legacy_reactivation_is_not_the_canonical_rollback, true);
});

test('unit: Advanced I/O entrypoint exports the Catalyst request handler', () => {
  const functionConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalyst-config.json'), 'utf8'));
  assert.equal(require('../package.json').name, functionConfig.deployment.name);
  const handler = require('../index');
  assert.equal(typeof handler, 'function');
});
