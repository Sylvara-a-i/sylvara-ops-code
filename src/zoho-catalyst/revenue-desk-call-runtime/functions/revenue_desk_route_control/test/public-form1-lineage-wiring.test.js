'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { syntheticPreparationInputs } = require('../../../../revenue-desk-release/test/fixtures/free-test-preparation');
const { createStagingFixture } = require('./helpers/configuration-staging-fixture');
const { createCrmControlClient, PUBLIC_LINEAGE_FIELDS } = require('../lib/crm-client');
const { createConfigurationSourceReader } = require('../lib/configuration-source-reader');
const { createConfigurationConversionReader, NATIVE_CONVERSION_FIELDS } = require('../lib/configuration-conversion-reader');
const { createConfigurationStagingService, RECEIPT_KIND } = require('../lib/configuration-staging-service');

// Exercise the public writer's CRM output through the real readers and staging
// service. Only transport, accepted setup evidence, and persistence are fakes;
// no preassembled public lineage or conversion proof can bypass these readers.
function publicWiringFixture(t) {
  const input = syntheticPreparationInputs()[0];
  const ids = Object.fromEntries(['leadId', 'accountId', 'contactId', 'dealId']
    .map((key) => [input.evidence.nativeConversion[key], `${input.evidence.nativeConversion[key]}00`]));
  function transportIds(value) {
    if (Array.isArray(value)) return value.map(transportIds);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, transportIds(child)]));
    return typeof value === 'string' && Object.hasOwn(ids, value) ? ids[value] : value;
  }
  const f = createStagingFixture(0, { publicNative: true, preparationInput: transportIds(input) });
  t.mock.method(Date, 'now', f.now);
  const config = { ...f.config, crmApiBaseUrl: 'https://www.zohoapis.com/crm/v8',
    crmOrganizationId: '606', platformTimeoutMs: 250, form1DestinationSha256: 'd'.repeat(64),
    form1PublicSubmissionChannel: 'Synthetic Public Form' };
  const publicRow = { id: f.lineage.originalLeadId, Intake_Submission_ID: f.request.journeyId,
    Submission_Channel: config.form1PublicSubmissionChannel, Entry_Offer: 'Free 7-Day Missed-Call',
    Free_Test_Request_Submitted_At: '2026-09-09T06:40:00-05:00',
    Free_Test_Contact_Consent: true, Free_Test_Contact_Consent_At: '2026-09-09T06:39:00-05:00',
    Free_Test_Contact_Consent_Version: 'form1-contact-consent-v1',
    Intake_Form_Version: 'revenue-leak-test-request-v1',
    Email: 'synthetic-unused@example.invalid' };
  const nativeRow = { id: publicRow.id, Intake_Submission_ID: publicRow.Intake_Submission_ID,
    Modified_Time: '2026-09-09T11:43:00.000Z', Converted__s: true,
    Converted_Date_Time: '2026-09-09T06:42:00-05:00',
    Converted_Account: { id: f.records.account.id, name: 'SYNTHETIC PRIVATE NAME' },
    Converted_Contact: { id: f.records.contact.id, name: 'SYNTHETIC PRIVATE NAME' },
    Converted_Deal: { id: f.records.deal.id, name: 'SYNTHETIC PRIVATE NAME' } };
  const state = { publicRows: [publicRow], publicInfo: { count: 1, page: 1, more_records: false },
    assistedRows: [], nativeRow };
  const reads = []; let writeAuthorizationReads = 0;
  const crm = createCrmControlClient(config, {
    readAuthorization: async () => 'Zoho-oauthtoken synthetic-read-only',
    writeAuthorization: async () => { writeAuthorizationReads += 1; throw new Error('Offline write prohibited'); },
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
      const query = Object.fromEntries(parsed.searchParams);
      reads.push({ path: parsed.pathname, query });
      if (parsed.pathname === '/crm/v8/org') return { status: 200,
        json: async () => ({ org: [{ zgid: config.crmOrganizationId }] }) };
      const fields = query.fields.split(',');
      const project = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key)));
      if (parsed.pathname === '/crm/v8/Leads/search') {
        assert.equal(query.criteria, `(Intake_Submission_ID:equals:${f.request.journeyId})`);
        assert.deepEqual(fields, PUBLIC_LINEAGE_FIELDS);
        assert.equal(query.converted, 'true'); assert.equal(query.page, '1'); assert.equal(query.per_page, '2');
        return { status: 200, json: async () => ({ data: state.publicRows.map(project), info: state.publicInfo }) };
      }
      assert.equal(parsed.pathname, '/crm/v8/Leads');
      assert.equal(query.ids, state.publicRows[0].id);
      assert.deepEqual(fields, NATIVE_CONVERSION_FIELDS);
      assert.equal(query.converted, 'true'); assert.equal(query.per_page, '2');
      return { status: 200, json: async () => ({ data: [project(state.nativeRow)],
        info: { count: 1, more_records: false, next_page_token: null } }) };
    },
  });
  const sourceReader = createConfigurationSourceReader({ zcql: () => ({
    async executeZCQLQuery(query) {
      assert.ok(query.endsWith(`WHERE INTAKE_SUBMISSION_ID = '${f.request.journeyId}' LIMIT 2`));
      reads.push({ path: 'assisted', query }); return structuredClone(state.assistedRows);
    },
  }) }, config, { now: f.now });
  const conversionReader = createConfigurationConversionReader({ crm, now: f.now });
  const service = createConfigurationStagingService({ config, store: f.store,
    crm: { ...f.crm, getPublicOriginalLead: crm.getPublicOriginalLead },
    core: f.core, sourceReader, conversionReader, now: f.now });
  return { f, state, publicRow, reads, service, writeAuthorizationReads: () => writeAuthorizationReads };
}

function snapshot(f) {
  return { rows: structuredClone([...f.store.rows.entries()]), records: structuredClone(f.records),
    writes: f.store.writes.length, stagingWrites: f.stagingWrites };
}

function assertNoNewWrites(selected, before) {
  const { f } = selected;
  assert.equal(f.store.writes.length, before.writes);
  assert.equal(f.stagingWrites, before.stagingWrites);
  assert.deepEqual(f.records, before.records);
  // Reads may initialize empty fake tables, but must never add persisted rows.
  assert.deepEqual([...f.store.rows.entries()].filter(([, rows]) => rows.length),
    before.rows.filter(([, rows]) => rows.length));
  assert.equal(selected.writeAuthorizationReads(), 0);
}

test('public Form 1 CRM output resolves through native conversion to one inactive staging result and exact replay', async (t) => {
  const selected = publicWiringFixture(t); const { f, service, reads } = selected;
  const result = await service.stage(f.request);
  assert.equal(result.state, 'StagedInactive'); assert.equal(result.active, false); assert.equal(result.approved, false);
  assert.equal(f.stagingWrites, 1);
  assert.equal(f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE).length, 1);
  const [deployment] = f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE);
  assert.equal(deployment.TEST_STATUS, 'Ready for Approval');
  assert.equal(deployment.GO_LIVE_APPROVAL_STATUS, 'Pending Internal Approval');
  assert.equal(deployment.ACTUAL_START_AT, null); assert.equal(deployment.APPROVAL_EVENT_KEY, null);
  const receipt = f.store.rowsFor(f.config.tables.EVENT_RECEIPT_TABLE).find((row) => row.RECEIPT_KIND === RECEIPT_KIND);
  assert.equal(receipt.STATUS, 'Completed');
  assert.doesNotMatch(JSON.stringify([...f.store.rows.entries()]), /synthetic-unused|SYNTHETIC PRIVATE NAME/);
  const before = snapshot(f); const readCount = reads.length;
  f.advance(1000);
  assert.deepEqual(await service.stage(f.request), { ...result, replayed: true });
  assertNoNewWrites(selected, before);
  assert.deepEqual(reads.slice(readCount).map(({ path }) => path),
    ['assisted', '/crm/v8/Leads/search', '/crm/v8/Leads']);
});

test('ambiguous or overwritten public intake evidence rejects before any staging write', async (t) => {
  for (const [name, mutate] of [
    ['duplicate native submissions', (s) => {
      s.state.publicRows.push({ ...s.publicRow, id: '900000000001' }); s.state.publicInfo.count = 2;
    }],
    ['punctuation search false match', (s) => { s.publicRow.Intake_Submission_ID += '-other'; }],
    ['unread duplicate page', (s) => { s.state.publicInfo.more_records = true; }],
    ['missing cohort evidence', (s) => { s.state.publicInfo = undefined; }],
    ['assisted channel on public search', (s) => { s.publicRow.Submission_Channel = 'CRM Assisted'; }],
    ['consent after submission', (s) => { s.publicRow.Free_Test_Contact_Consent_At = '2026-09-09T11:41:00Z'; }],
  ]) {
    await t.test(name, async (t) => {
      const selected = publicWiringFixture(t); mutate(selected); const before = snapshot(selected.f);
      await assert.rejects(selected.service.stage(selected.f.request), { code: 'CONFIGURATION_SOURCE_LINEAGE_INVALID' });
      assertNoNewWrites(selected, before);
      assert.equal(selected.reads.some(({ path }) => path === '/crm/v8/Leads'), false);
    });
  }
});

test('completed public staging replay rechecks duplicate, intake, and original-Lead identity without new writes', async (t) => {
  for (const [name, code, mutate] of [
    ['new duplicate', 'CONFIGURATION_SOURCE_LINEAGE_INVALID', (s) => {
      s.state.publicRows.push({ ...s.publicRow, id: '900000000001' }); s.state.publicInfo.count = 2;
    }],
    ['overwritten intake ID', 'CONFIGURATION_SOURCE_LINEAGE_INVALID', (s) => {
      s.publicRow.Intake_Submission_ID = 'synthetic_replacement_intake';
    }],
    ['rebound original Lead', 'CONFIGURATION_STAGING_CONFLICT', (s) => {
      s.publicRow.id = '900000000001'; s.state.nativeRow.id = s.publicRow.id;
    }],
    ['otherwise valid changed consent time', 'CONFIGURATION_STAGING_CONFLICT', (s) => {
      s.publicRow.Free_Test_Contact_Consent_At = '2026-09-09T11:38:00Z';
    }],
  ]) {
    await t.test(name, async (t) => {
      const selected = publicWiringFixture(t);
      await selected.service.stage(selected.f.request);
      const before = snapshot(selected.f); mutate(selected);
      await assert.rejects(selected.service.stage(selected.f.request), { code });
      assertNoNewWrites(selected, before);
    });
  }
});

test('public intake cannot bridge an invalid assisted source or unrelated native conversion', async (t) => {
  for (const [name, code, mutate] of [
    ['ambiguous assisted rows', 'CONFIGURATION_SOURCE_LINEAGE_UNAVAILABLE', (s) => {
      s.state.assistedRows = [{}, {}];
    }],
    ['malformed assisted row', 'CONFIGURATION_SOURCE_LINEAGE_INVALID', (s) => { s.state.assistedRows = [{}]; }],
    ['different native Deal', 'CONFIGURATION_NATIVE_CONVERSION_UNVERIFIED', (s) => {
      s.state.nativeRow.Converted_Deal.id = '900000000001';
    }],
    ['conversion predates intake', 'CONFIGURATION_NATIVE_CONVERSION_UNVERIFIED', (s) => {
      s.state.nativeRow.Converted_Date_Time = '2026-09-09T11:38:00Z';
    }],
  ]) {
    await t.test(name, async (t) => {
      const selected = publicWiringFixture(t); mutate(selected); const before = snapshot(selected.f);
      await assert.rejects(selected.service.stage(selected.f.request), { code });
      assertNoNewWrites(selected, before);
      if (selected.state.assistedRows.length) {
        assert.deepEqual(selected.reads.map(({ path }) => path), ['assisted']);
      }
    });
  }
});

test.after(() => { assert.deepEqual(guard.blocked, []); guard.restore(); });
