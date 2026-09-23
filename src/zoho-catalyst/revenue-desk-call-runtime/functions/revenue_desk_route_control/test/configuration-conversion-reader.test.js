'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { NATIVE_CONVERSION_FIELDS, createConfigurationConversionReader }
  = require('../lib/configuration-conversion-reader');
const { createCrmControlClient } = require('../lib/crm-client');

const NOW = Date.parse('2026-09-15T15:00:00.000Z');
const LEAD = '7000000000001';
const ACCOUNT = '7000000000002';
const CONTACT = '7000000000003';
const DEAL = '7000000000004';
const JOURNEY = 'synthetic_form1_journey';
const SENTINEL = 'synthetic-private-provider-diagnostic';

function providerEvidence() {
  return { data: [{ id: LEAD, Intake_Submission_ID: JOURNEY,
    Modified_Time: '2026-09-14T10:00:00-05:00', Converted__s: true,
    Converted_Date_Time: '2026-09-14T10:00:00-05:00', $converted: true,
    Converted_Account: { id: ACCOUNT, name: SENTINEL },
    Converted_Contact: { id: CONTACT, name: SENTINEL },
    Converted_Deal: { id: DEAL, name: SENTINEL },
    Last_Name: SENTINEL, Email: 'synthetic-private@example.invalid',
  }], info: { count: 1, per_page: 2, page: 1, more_records: false, next_page_token: null } };
}

function fixture({ response = providerEvidence(), organizationId = '606', status = 200,
  failure, clock = () => NOW, json, timeoutMs = 10000, respectFields = true } = {}) {
  const requests = [];
  let readAuthCount = 0;
  let writeAuthCount = 0;
  const crm = createCrmControlClient({ crmApiBaseUrl: 'https://www.zohoapis.com/crm/v8',
    platformTimeoutMs: 250, crmOrganizationId: '606' }, {
    readAuthorization: async () => { readAuthCount += 1; return 'Zoho-oauthtoken synthetic-read'; },
    writeAuthorization: async () => { writeAuthCount += 1; throw new Error(SENTINEL); },
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      requests.push({ method: options.method, path: parsed.pathname,
        query: Object.fromEntries(parsed.searchParams.entries()) });
      assert.equal(options.body, undefined);
      if (parsed.pathname === '/crm/v8/org') return {
        status: 200, json: async () => ({ org: [{ zgid: organizationId }] }),
      };
      assert.equal(parsed.pathname, '/crm/v8/Leads');
      if (failure) throw new Error(SENTINEL);
      return { status, json: json || (async () => {
        const selected = structuredClone(response);
        if (respectFields && Array.isArray(selected?.data)) {
          const fields = parsed.searchParams.get('fields').split(',');
          selected.data = selected.data.map((row) => row && typeof row === 'object'
            ? Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key) || key === '$converted')) : row);
        }
        return selected;
      }) };
    },
  });
  return { requests, crm,
    reader: createConfigurationConversionReader({ crm, now: clock, timeoutMs }),
    counts: () => ({ readAuthCount, writeAuthCount }) };
}

test('field-aware v8 native conversion read works without an unrequested legacy detail', async () => {
  const response = providerEvidence();
  const selected = fixture({ response, respectFields: true });
  const result = await selected.reader.readConversion(LEAD);
  assert.deepEqual([result.accountId, result.contactId, result.dealId], [ACCOUNT, CONTACT, DEAL]);
  assert.equal(result.convertedAt, '2026-09-14T15:00:00.000Z');
  assert.doesNotMatch(selected.requests[1].query.fields, /\$converted_detail/);
});

test('native conversion uses the existing organization-bound exact-ID read only', async () => {
  const selected = fixture();
  const result = await selected.reader.readConversion(LEAD);
  assert.deepEqual(selected.requests, [
    { method: 'GET', path: '/crm/v8/org', query: {} },
    { method: 'GET', path: '/crm/v8/Leads', query: { ids: LEAD, converted: 'true',
      fields: 'id,Intake_Submission_ID,Modified_Time,Converted__s,Converted_Date_Time,Converted_Account,Converted_Contact,Converted_Deal', per_page: '2' } },
  ]);
  assert.deepEqual(NATIVE_CONVERSION_FIELDS,
    ['id', 'Intake_Submission_ID', 'Modified_Time', 'Converted__s', 'Converted_Date_Time',
      'Converted_Account', 'Converted_Contact', 'Converted_Deal']);
  assert.deepEqual(selected.counts(), { readAuthCount: 2, writeAuthCount: 0 });
  assert.deepEqual(result, { originalLeadId: LEAD, journeyId: JOURNEY, accountId: ACCOUNT,
    contactId: CONTACT, dealId: DEAL, convertedAt: '2026-09-14T15:00:00.000Z',
    observedAt: '2026-09-15T15:00:00.000Z' });
  assert.equal(Object.isFrozen(result), true);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private|Last_Name|Email|converted_by|verified/);
  assert.deepEqual(Object.keys(selected.reader), ['readConversion']);
});

test('documented conversion state does not require the optional legacy flag', async () => {
  const response = providerEvidence(); delete response.data[0].$converted;
  assert.equal((await fixture({ response }).reader.readConversion(LEAD)).dealId, DEAL);
});

test('invalid or multi-ID request cannot escape the one-Lead transport contract', async () => {
  for (const id of [null, '', LEAD + ',' + DEAL, LEAD + '&converted=both', '100000000',
    Number(LEAD), { id: LEAD, verified: true }, '1'.repeat(31)]) {
    const selected = fixture();
    await assert.rejects(selected.reader.readConversion(id), { code: 'CONFIGURATION_CONVERSION_INVALID' });
    await assert.rejects(selected.crm.getNativeConversion(id), { code: 'CONFIGURATION_CONVERSION_INVALID' });
    assert.equal(selected.requests.length, 0);
  }
});

test('empty, ambiguous, wrong-ID, partial and malformed responses fail closed', async () => {
  const variants = [null, {}, { data: [] }, { data: [null] },
    { ...providerEvidence(), data: [providerEvidence().data[0], providerEvidence().data[0]] }];
  for (const mutate of [
    (value) => { value.data[0].id = DEAL; },
    (value) => { delete value.info; },
    (value) => { value.info.count = 2; },
    (value) => { value.info.more_records = true; },
    (value) => { value.info.next_page_token = SENTINEL; },
  ]) { const value = providerEvidence(); mutate(value); variants.push(value); }
  for (const response of variants) await assert.rejects(fixture({ response }).reader.readConversion(LEAD));
});

test('native conversion state cannot be replaced by a request or legacy verification flag', async () => {
  const mutations = [
    (row) => { row.Converted__s = false; },
    (row) => { row.Converted__s = 'true'; },
    (row) => { delete row.Converted__s; },
    (row) => { row.$converted = false; },
    (row) => { row.$converted = 'true'; },
    (row) => { row.Intake_Submission_ID = ''; },
    (row) => { row.Intake_Submission_ID = 'x'.repeat(101); },
  ];
  for (const mutate of mutations) {
    const response = providerEvidence(); mutate(response.data[0]);
    response.data[0].verified = true;
    await assert.rejects(fixture({ response }).reader.readConversion(LEAD),
      { code: 'CONFIGURATION_CONVERSION_INVALID' });
  }
});

test('each native lookup requires a distinct valid ID and ordinary links or legacy details are not substitutes', async () => {
  for (const field of ['Converted_Account', 'Converted_Contact', 'Converted_Deal']) {
    for (const value of [undefined, null, {}, [], ACCOUNT, { name: SENTINEL }, { id: null },
      { id: '' }, { id: Number(ACCOUNT) }, { id: '100000000' }, { id: LEAD }, { id: '1'.repeat(31) }]) {
      const response = providerEvidence();
      if (value === undefined) delete response.data[0][field]; else response.data[0][field] = value;
      Object.assign(response.data[0], { Account_Name: { id: ACCOUNT }, Contact_Name: { id: CONTACT },
        Deal_Name: { id: DEAL }, $converted_detail: { account: ACCOUNT, contact: CONTACT, deal: DEAL,
          convert_date: response.data[0].Converted_Date_Time }, verified: true });
      await assert.rejects(fixture({ response, respectFields: false }).reader.readConversion(LEAD),
        { code: 'CONFIGURATION_CONVERSION_INVALID' });
    }
  }
  for (const [field, duplicate] of [['Converted_Account', CONTACT], ['Converted_Contact', DEAL],
    ['Converted_Deal', ACCOUNT]]) {
    const response = providerEvidence(); response.data[0][field].id = duplicate;
    await assert.rejects(fixture({ response }).reader.readConversion(LEAD),
      { code: 'CONFIGURATION_CONVERSION_INVALID' });
  }
});

test('missing, impossible, noncanonical, contradictory and future canonical times are rejected', async () => {
  const mutations = [
    (row) => { delete row.Converted_Date_Time; },
    (row) => { row.Converted_Date_Time = null; },
    (row) => { row.Converted_Date_Time = '2026-02-30T12:00:00.000Z'; },
    (row) => { row.Converted_Date_Time = '2026-09-14T15:00:00'; },
    (row) => { row.Converted_Date_Time = '2026-09-16T15:00:00.000Z'; },
    (row) => { row.Converted_Date_Time = '2026-09-14T15:00:01.000Z'; },
    (row) => { row.Modified_Time = '2026-09-16T15:00:00.000Z'; },
    (row) => { delete row.Modified_Time; },
    (row) => { row.Modified_Time = '2026-02-30T12:00:00.000Z'; },
    (row) => { row.Modified_Time = '2026-09-14T15:00:00'; },
    (row) => { row.Modified_Time = 1789398000000; },
  ];
  for (const mutate of mutations) {
    const response = providerEvidence(); mutate(response.data[0]);
    response.data[0].$converted_detail = { account: ACCOUNT, contact: CONTACT, deal: DEAL,
      convert_date: '2026-09-14T15:00:00.000Z' };
    await assert.rejects(fixture({ response, respectFields: false }).reader.readConversion(LEAD),
      { code: 'CONFIGURATION_CONVERSION_INVALID' });
  }
});

test('canonical time with an explicit offset wins over ignored legacy detail without timezone repair', async () => {
  for (const detail of [null, {}, { convert_date: '2026-09-14T08:00:00.000Z' },
    { account: DEAL, contact: ACCOUNT, deal: CONTACT, convert_date: 'not-a-time', converted_by: SENTINEL }]) {
    const response = providerEvidence(); response.data[0].$converted_detail = detail;
    response.data[0].Converted_Date_Time = '2026-09-14T10:00:00.125-05:00';
    response.data[0].Modified_Time = '2026-09-14T15:01:00.000Z';
    const result = await fixture({ response, respectFields: false }).reader.readConversion(LEAD);
    assert.equal(result.convertedAt, '2026-09-14T15:00:00.125Z');
    assert.deepEqual([result.accountId, result.contactId, result.dealId], [ACCOUNT, CONTACT, DEAL]);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private|converted_detail|converted_by|Email|name/);
  }
});

test('different native relationships and journey are preserved for staging comparison, never overwritten', async () => {
  const response = providerEvidence();
  response.data[0].Intake_Submission_ID = 'synthetic_other_journey';
  response.data[0].Converted_Deal.id = '7000000000005';
  const result = await fixture({ response }).reader.readConversion(LEAD);
  assert.notEqual(result.journeyId, JOURNEY);
  assert.notEqual(result.dealId, DEAL);
  assert.equal(result.originalLeadId, LEAD);
});

test('wrong organization fails before the converted Lead request', async () => {
  const selected = fixture({ organizationId: '707' });
  await assert.rejects(selected.reader.readConversion(LEAD),
    { code: 'CONFIGURATION_CONVERSION_READ_UNAVAILABLE' });
  assert.equal(selected.requests.length, 1);
  assert.equal(selected.counts().writeAuthCount, 0);
});

test('auth errors, rate limits and transport failures are private and have no retry', async () => {
  for (const options of [{ status: 401 }, { status: 403 }, { status: 429 }, { status: 503 },
    { failure: true }, { json: async () => { throw new Error(SENTINEL); } }]) {
    const selected = fixture(options);
    await assert.rejects(selected.reader.readConversion(LEAD), (error) => {
      assert.equal(error.code, 'CONFIGURATION_CONVERSION_READ_UNAVAILABLE');
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(String(error.stack), /synthetic-private/);
      return true;
    });
    assert.equal(selected.requests.length, 2);
    assert.equal(selected.counts().writeAuthCount, 0);
  }
});

test('body timeout is bounded without a second Lead request', async () => {
  const selected = fixture({ timeoutMs: 250, json: () => new Promise(() => {}) });
  await assert.rejects(selected.reader.readConversion(LEAD),
    { code: 'CONFIGURATION_CONVERSION_READ_UNAVAILABLE' });
  assert.equal(selected.requests.length, 2);
});

test('trusted observation rejects backwards, malformed and stale clocks; no evidence is cached', async () => {
  for (const end of [NOW - 1, NOW + 10001, NaN]) {
    let reads = 0;
    await assert.rejects(fixture({ clock: () => reads++ ? end : NOW }).reader.readConversion(LEAD),
      { code: 'CONFIGURATION_CONVERSION_INVALID' });
  }
  for (const invalid of [NaN, -1, 1.5, 8_640_000_000_000_001]) {
    const selected = fixture({ clock: () => invalid });
    await assert.rejects(selected.reader.readConversion(LEAD), { code: 'CONFIGURATION_CONVERSION_INVALID' });
    assert.equal(selected.requests.length, 0);
  }
  const selected = fixture();
  await selected.reader.readConversion(LEAD); await selected.reader.readConversion(LEAD);
  assert.equal(selected.requests.filter(({ path }) => path.endsWith('/Leads')).length, 2);
});

test('factory requires the established CRM read method and a bounded clock/timeout', () => {
  for (const options of [undefined, {}, { crm: { converted: true } },
    { crm: fixture().crm, now: true }, { crm: fixture().crm, timeoutMs: 0 }]) {
    assert.throws(() => createConfigurationConversionReader(options),
      { code: 'CONFIGURATION_CONVERSION_READER_UNAVAILABLE' });
  }
});

test.after(() => {
  assert.deepEqual(guard.blocked, []);
  guard.restore();
});
