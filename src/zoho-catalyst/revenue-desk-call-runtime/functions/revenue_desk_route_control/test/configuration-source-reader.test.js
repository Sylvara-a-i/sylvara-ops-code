'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { TABLE, FIELDS, createConfigurationSourceReader } = require('../lib/configuration-source-reader');
const form1Schema = require('../../../../revenue-leak-test-request-form/config/datastore-schema.json');
const { normalizeRow } = require('../../../../revenue-leak-test-request-form/functions/revenue_leak_test_request_form/lib/session-store');

const NOW = Date.parse('2026-09-15T15:00:00.000Z');
const JOURNEY = 'synthetic_form1_journey';
const CONFIG = Object.freeze({ environment: 'development',
  crmOrganizationSha256: 'a'.repeat(64), form1DestinationSha256: 'b'.repeat(64), platformTimeoutMs: 250 });
const row = () => ({
  ROWID: '7000000000001', CRM_LEAD_ID: '7100000000001', INTAKE_SUBMISSION_ID: JOURNEY,
  CRM_ORGANIZATION_HASH: CONFIG.crmOrganizationSha256, CRM_MODULE: 'Leads', EXPECTED_STAGE: 'form1',
  FORM_IDENTITY_HASH: CONFIG.form1DestinationSha256, SOURCE_ENVIRONMENT: 'development',
  SOURCE_REVISION: 'c'.repeat(40), CONFIGURATION_REVISION: 'c'.repeat(40), STATUS: 'consumed',
  LAST_OUTCOME: 'submitted', CREATED_AT: '2026-09-01T12:00:00.000Z',
  ISSUED_AT: '2026-09-01T12:00:00.000Z', EXPIRES_AT: '2026-09-01T12:20:00.000Z',
  LAST_PREFILLED_AT: '2026-09-01T12:02:00.000Z', PREFILL_HANDLE_CONSUMED_AT: '2026-09-01T12:02:00.000Z',
  SUBMISSION_STARTED_AT: '2026-09-01T12:05:00.000Z', CONSUMED_AT: '2026-09-01T12:06:00.000Z',
  UPDATED_AT: '2026-09-01T12:06:00.000Z', REVOKED_AT: null, SUBMISSION_FINGERPRINT: 'd'.repeat(64),
  SUBMISSION_CLAIM_ID: '11111111-1111-4111-8111-111111111111',
  CRM_RECORD_VERSION: '2026-09-01T12:04:00+00:00', PREFILL_COUNT: 1, MAX_PREFILLS: 1, SESSION_VERSION: 5,
});

function fixture({ rows = [row()], nested = false, execute } = {}) {
  const statements = [];
  const app = { zcql: () => ({ executeZCQLQuery: async (query) => {
    statements.push(query);
    return execute ? execute(query) : rows.map((value) => nested ? { [TABLE]: value } : value);
  } }) };
  return { app, statements,
    reader: createConfigurationSourceReader(app, CONFIG, { now: () => NOW }) };
}

test('projection and synthetic consumed state match the existing Form 1 schema and normalizer', () => {
  const table = form1Schema.tables.find((value) => value.expected_api_name === TABLE);
  assert.ok(table.required_unique_columns.includes('INTAKE_SUBMISSION_ID'));
  const columns = new Set(['ROWID', ...table.columns.map((value) => value.api_name)]);
  assert.ok(FIELDS.every((field) => columns.has(field)));
  const historical = normalizeRow({ ...row(), TOKEN_HASH: 'e'.repeat(64),
    PREFILL_HANDLE_HASH: 'f'.repeat(64), PREFILL_HANDLE_ISSUED_AT: '2026-09-01T12:01:00.000Z',
    PREFILL_HANDLE_EXPIRES_AT: '2026-09-01T12:11:00.000Z',
    PREFILL_CONSUMPTION_OWNER: row().SUBMISSION_CLAIM_ID,
    PREFILL_ID: row().SUBMISSION_CLAIM_ID, ISSUING_ACTOR_HASH: `operator_${'a'.repeat(64)}` }, TABLE);
  assert.equal(historical.status, 'consumed');
  assert.equal(historical.recordId, row().CRM_LEAD_ID);
  assert.equal(historical.journeyId, JOURNEY);
});

for (const nested of [false, true]) {
  test(`reads ${nested ? 'nested' : 'flat'} historical consumed Form 1 lineage without a secret projection`, async () => {
    const selected = fixture({ nested });
    assert.deepEqual(await selected.reader.readAssistedLineage(JOURNEY), {
      originalLeadId: '7100000000001', journeyId: JOURNEY, consumedAt: row().CONSUMED_AT,
      sourceRevision: 'c'.repeat(40), form1RowId: '7000000000001', submissionFingerprint: 'd'.repeat(64),
    });
    assert.equal(selected.statements.length, 1);
    assert.equal(selected.statements[0], `SELECT ${FIELDS.join(', ')} FROM ${TABLE}`
      + ` WHERE INTAKE_SUBMISSION_ID = '${JOURNEY}' LIMIT 2`);
    assert.doesNotMatch(selected.statements[0], /SELECT \*|TOKEN_HASH|PREFILL_HANDLE_HASH|PREFILL_ID/);
    assert.deepEqual(Object.keys(selected.reader), ['readAssistedLineage']);
  });
}

test('retains consumed recovery provenance and provider numeric representations', async () => {
  const selected = row();
  selected.LAST_OUTCOME = `r1_${'e'.repeat(40)}_11111111111141118111111111111111`;
  selected.SESSION_VERSION = '6'; selected.PREFILL_COUNT = '1'; selected.MAX_PREFILLS = '1';
  // A bounded recovery may finish after original expiry. History is not expired access.
  selected.CONSUMED_AT = '2026-09-02T12:00:00.000Z'; selected.UPDATED_AT = selected.CONSUMED_AT;
  assert.equal((await fixture({ rows: [selected] }).reader.readAssistedLineage(JOURNEY)).consumedAt,
    selected.CONSUMED_AT);
});

test('missing, ambiguous, malformed and injection-shaped lineage fail closed', async () => {
  for (const rows of [[], [row(), row()], null, [null], [{}]]) {
    const selected = fixture({ execute: () => rows });
    await assert.rejects(selected.reader.readAssistedLineage(JOURNEY));
    assert.equal(selected.statements.length, 1);
  }
  for (const invalid of ["x' OR 1=1", '', 'x'.repeat(101), null, { verified: true }]) {
    const selected = fixture();
    await assert.rejects(selected.reader.readAssistedLineage(invalid),
      { code: 'CONFIGURATION_SOURCE_LINEAGE_INVALID' });
    assert.equal(selected.statements.length, 0);
  }
});

test('wrong source ownership, nonterminal states and incomplete claims are rejected', async () => {
  const changes = {
    CRM_LEAD_ID: 'not-a-lead', INTAKE_SUBMISSION_ID: 'another_journey', CRM_ORGANIZATION_HASH: 'e'.repeat(64),
    CRM_MODULE: 'Deals', EXPECTED_STAGE: 'form2', FORM_IDENTITY_HASH: 'f'.repeat(64),
    SOURCE_ENVIRONMENT: 'production', SOURCE_REVISION: 'latest', CONFIGURATION_REVISION: 'e'.repeat(40),
    STATUS: 'submitting', LAST_OUTCOME: 'submission_started', REVOKED_AT: row().CONSUMED_AT,
    SUBMISSION_FINGERPRINT: null, SUBMISSION_CLAIM_ID: null, CRM_RECORD_VERSION: null,
    PREFILL_COUNT: 0, MAX_PREFILLS: 2, SESSION_VERSION: 4,
  };
  for (const [field, value] of Object.entries(changes)) {
    await assert.rejects(fixture({ rows: [{ ...row(), [field]: value }] })
      .reader.readAssistedLineage(JOURNEY), { code: 'CONFIGURATION_SOURCE_LINEAGE_INVALID' });
  }
});

test('impossible, noncanonical, incomplete and future chronology is rejected', async () => {
  for (const change of [
    { CREATED_AT: row().CONSUMED_AT }, { ISSUED_AT: row().CONSUMED_AT },
    { LAST_PREFILLED_AT: row().ISSUED_AT }, { SUBMISSION_STARTED_AT: row().ISSUED_AT },
    { EXPIRES_AT: row().SUBMISSION_STARTED_AT }, { CONSUMED_AT: row().ISSUED_AT },
    { UPDATED_AT: row().ISSUED_AT }, { CRM_RECORD_VERSION: row().CONSUMED_AT },
    { CONSUMED_AT: '2026-09-16T12:00:00.000Z', UPDATED_AT: '2026-09-16T12:00:00.000Z' },
    { CONSUMED_AT: '2026-09-01T12:06:00Z' }, { SUBMISSION_STARTED_AT: null },
  ]) {
    await assert.rejects(fixture({ rows: [{ ...row(), ...change }] }).reader.readAssistedLineage(JOURNEY),
      { code: 'CONFIGURATION_SOURCE_LINEAGE_INVALID' });
  }
});

test('server context is required, copied, and does not accept caller authenticity assertions', async () => {
  const selected = fixture();
  for (const change of [{ environment: 'production' }, { form1DestinationSha256: undefined },
    { crmOrganizationSha256: undefined }, { platformTimeoutMs: 0 }]) {
    assert.throws(() => createConfigurationSourceReader(selected.app, { ...CONFIG, ...change }),
      { code: 'CONFIGURATION_SOURCE_READER_UNAVAILABLE' });
  }
  const config = { ...CONFIG };
  const reader = createConfigurationSourceReader(selected.app, config, { now: () => NOW });
  config.crmOrganizationSha256 = 'e'.repeat(64); config.form1DestinationSha256 = 'f'.repeat(64);
  assert.equal((await reader.readAssistedLineage(JOURNEY)).originalLeadId, '7100000000001');
});

test('provider exceptions and timeout have bounded sanitized errors and no retry', async () => {
  for (const execute of [() => { throw new Error('synthetic-secret-and-private-body'); },
    () => new Promise(() => {})]) {
    const selected = fixture({ execute });
    await assert.rejects(selected.reader.readAssistedLineage(JOURNEY), (error) => {
      assert.equal(error.code, 'CONFIGURATION_SOURCE_READ_UNAVAILABLE');
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(JSON.stringify(error) + error.message, /synthetic-secret-and-private-body/);
      return true;
    });
    assert.equal(selected.statements.length, 1);
  }
});
