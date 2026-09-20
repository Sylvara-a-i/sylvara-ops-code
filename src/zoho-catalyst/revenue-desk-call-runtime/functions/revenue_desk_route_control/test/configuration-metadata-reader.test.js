'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { FIELDS, createConfigurationMetadataReader } = require('../lib/configuration-metadata-reader');
const { createCrmControlClient } = require('../lib/crm-client');
const { buildCrmPreTestSnapshot } = require('revenue_desk_call_gateway/lib/crm-report-baseline');
const { crmBaselineFixture } = require('../../../../revenue-desk-analytics/functions/analytics_sync/test/helpers/crm-baseline-fixture');

const NOW = Date.parse('2026-09-01T11:54:00.000Z');
const SENTINEL = 'synthetic-sensitive-diagnostic';

function providerMetadata() {
  const baseline = crmBaselineFixture();
  return { fields: Object.entries(FIELDS).map(([api_name, data_type]) => ({
    api_name, data_type, type: 'used', visible: true, virtual_field: false,
    id: `synthetic-private-${api_name}`, tooltip: { value: SENTINEL },
    profiles: [{ name: SENTINEL }],
    pick_list_values: data_type === 'picklist'
      ? baseline.metadata.fields[api_name].activeValues.map((value) => ({
        type: 'used', actual_value: value, reference_value: value,
        display_value: SENTINEL, id: `synthetic-option-${value}`,
      })) : [],
  })) };
}

function fixture({ response = providerMetadata(), organizationId = '606', status = 200,
  failure, clock = () => NOW, json, timeoutMs = 10000 } = {}) {
  const requests = [];
  let readAuthCount = 0;
  let writeAuthCount = 0;
  const crm = createCrmControlClient({ crmApiBaseUrl: 'https://www.zohoapis.com/crm/v8',
    platformTimeoutMs: 250, crmOrganizationId: '606' }, {
    readAuthorization: async () => { readAuthCount += 1; return 'Zoho-oauthtoken synthetic-read'; },
    writeAuthorization: async () => { writeAuthCount += 1; throw new Error(SENTINEL); },
    fetchImpl: async (url, options) => {
      // Save only a synthetic method/path projection, never authorization.
      const parsed = new URL(url);
      requests.push({ method: options.method, path: `${parsed.pathname}${parsed.search}` });
      assert.equal(options.body, undefined);
      if (parsed.pathname === '/crm/v8/org') return {
        status: 200, json: async () => ({ org: [{ zgid: organizationId }] }),
      };
      assert.equal(parsed.pathname + parsed.search, '/crm/v8/settings/fields?module=Deals');
      if (failure) throw new Error(SENTINEL);
      return { status, json: json || (async () => structuredClone(response)) };
    },
  });
  return { requests, crm,
    reader: createConfigurationMetadataReader({ crm, now: clock, timeoutMs }),
    counts: () => ({ readAuthCount, writeAuthCount }) };
}

test('fixed organization-bound metadata read emits only the ten canonical source fields', async () => {
  const selected = fixture();
  const result = await selected.reader.readMetadata({ verified: true, module: 'Contacts' });
  assert.deepEqual(selected.requests, [
    { method: 'GET', path: '/crm/v8/org' },
    { method: 'GET', path: '/crm/v8/settings/fields?module=Deals' },
  ]);
  assert.deepEqual(selected.counts(), { readAuthCount: 2, writeAuthCount: 0 });
  assert.deepEqual(Object.keys(result), ['source', 'observedAt', 'fields']);
  assert.equal(result.source, 'crm_field_metadata_readback');
  assert.equal(result.observedAt, new Date(NOW).toISOString());
  assert.deepEqual(Object.keys(result.fields), Object.keys(FIELDS));
  assert.deepEqual(Object.keys(FIELDS).sort(), Object.keys(crmBaselineFixture().metadata.fields).sort());
  assert.equal(Object.isFrozen(result) && Object.isFrozen(result.fields), true);
  for (const [name, kind] of Object.entries(FIELDS)) {
    assert.deepEqual(Object.keys(result.fields[name]), kind === 'picklist'
      ? ['apiName', 'dataType', 'active', 'activeValues'] : ['apiName', 'dataType', 'active']);
    assert.equal(Object.isFrozen(result.fields[name]), true);
    if (kind === 'picklist') assert.equal(Object.isFrozen(result.fields[name].activeValues), true);
  }
  assert.doesNotMatch(JSON.stringify(result), /synthetic-sensitive|synthetic-private|profiles|tooltip|display_value/);
  assert.deepEqual(Object.keys(selected.reader), ['readMetadata']);
});

test('projects used actual/reference aliases without display labels or retired options', async () => {
  const response = providerMetadata();
  response.fields.find((field) => field.api_name === 'Approved_Test_Route').pick_list_values = [
    { type: 'used', actual_value: 'After-Hours', reference_value: 'After Hours Only', display_value: SENTINEL },
    { type: 'unused', actual_value: 'Retired route', reference_value: 'Retired route', display_value: SENTINEL },
  ];
  response.fields.push({ api_name: 'Unrelated_Private_Field', tooltip: SENTINEL });
  const result = await fixture({ response }).reader.readMetadata();
  assert.deepEqual(result.fields.Approved_Test_Route.activeValues, ['After Hours Only', 'After-Hours']);
  assert.doesNotMatch(JSON.stringify(result), /Retired|Unrelated_Private_Field|synthetic-sensitive/);
});

test('real transport projection feeds the shared baseline for each supported stored route', async () => {
  for (const route of ['After Hours Only', 'After-Hours', 'No Answer / Overflow Only',
    'No-Answer/Overflow', 'After Hours + Overflow', 'Both']) {
    const capture = crmBaselineFixture();
    delete capture.context.testStartedAt;
    capture.metadata = await fixture().reader.readMetadata();
    capture.deal.Approved_Test_Route = route;
    capture.context.approvedTestRoute = route;
    const result = buildCrmPreTestSnapshot(capture, { now: Date.parse(capture.evidence.capturedAt) });
    assert.equal(result.provenanceStatus, 'locally_consistent_not_authenticated');
    assert.equal(result.values.monthlyInboundCalls, 140);
  }
});

test('missing, duplicate, hidden, unused, virtual and wrong-type source fields fail closed', async () => {
  const mutations = [
    (value) => value.fields.pop(),
    (value) => value.fields.push(structuredClone(value.fields[0])),
    (value) => { value.fields[0].visible = false; },
    (value) => { delete value.fields[0].visible; },
    (value) => { value.fields[0].type = 'unused'; },
    (value) => { value.fields[0].virtual_field = true; },
    (value) => { value.fields[0].data_type = 'text'; },
    (value) => { value.fields[0].api_name = 'Current Call Handling'; },
  ];
  for (const mutate of mutations) {
    const response = providerMetadata(); mutate(response);
    await assert.rejects(fixture({ response }).reader.readMetadata(), { code: 'CONFIGURATION_METADATA_INVALID' });
  }
});

test('partial, malformed and over-bound metadata responses never certify completeness', async () => {
  for (const response of [null, {}, { fields: null }, { fields: [] }, { fields: [null] },
    { fields: Array(2001).fill({ api_name: 'Unrelated' }) },
    ...['info', 'next_page_token', 'more_records', 'partial'].map((key) => ({
      ...providerMetadata(), [key]: key === 'info' ? { more_records: true } : true,
    }))]) {
    await assert.rejects(fixture({ response }).reader.readMetadata());
  }
});

test('malformed, unclassified, excessive or wholly retired options are rejected without values', async () => {
  const valid = { type: 'used', actual_value: 'Voicemail', reference_value: 'Voicemail' };
  for (const options of [null, [], [null], [{ ...valid, type: 'unknown' }],
    [{ ...valid, type: 'unused' }], [{ ...valid, reference_value: null }],
    [{ ...valid, actual_value: ' Voicemail' }], [{ ...valid, actual_value: `bad\n${SENTINEL}` }],
    [{ ...valid, actual_value: 'x'.repeat(121) }], Array(101).fill(valid),
    Array.from({ length: 51 }, (_, index) => ({ type: 'used',
      actual_value: `Actual${index}`, reference_value: `Reference${index}` }))]) {
    const response = providerMetadata(); response.fields[0].pick_list_values = options;
    await assert.rejects(fixture({ response }).reader.readMetadata(), (error) => {
      assert.equal(error.code, 'CONFIGURATION_METADATA_INVALID');
      assert.doesNotMatch(String(error.stack), /synthetic-sensitive/);
      return true;
    });
  }
});

test('wrong organization stops before metadata and only read credentials are requested', async () => {
  const selected = fixture({ organizationId: '707' });
  await assert.rejects(selected.reader.readMetadata(), { code: 'CONFIGURATION_METADATA_READ_UNAVAILABLE' });
  assert.deepEqual(selected.requests, [{ method: 'GET', path: '/crm/v8/org' }]);
  assert.deepEqual(selected.counts(), { readAuthCount: 1, writeAuthCount: 0 });
});

test('scope/auth/rate-limit errors and transport failures are bounded, private and never retried', async () => {
  for (const options of [{ status: 401 }, { status: 403 }, { status: 429 }, { status: 503 }, { failure: true },
    { json: async () => { throw new Error(SENTINEL); } }]) {
    const selected = fixture(options);
    await assert.rejects(selected.reader.readMetadata(), (error) => {
      assert.equal(error.code, 'CONFIGURATION_METADATA_READ_UNAVAILABLE');
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(String(error.stack), /synthetic-sensitive/);
      return true;
    });
    assert.equal(selected.requests.length, 2);
    assert.equal(selected.counts().writeAuthCount, 0);
  }
});

test('reader timeout bounds delayed body consumption without retry or raw cause', async () => {
  const selected = fixture({ timeoutMs: 250, json: () => new Promise(() => {}) });
  await assert.rejects(selected.reader.readMetadata(), { code: 'CONFIGURATION_METADATA_READ_UNAVAILABLE' });
  assert.equal(selected.requests.length, 2);
});

test('observation uses the trusted start clock and rejects clock rollback or stale completion', async () => {
  let count = 0;
  const result = await fixture({ clock: () => NOW + count++ }).reader.readMetadata();
  assert.equal(result.observedAt, new Date(NOW).toISOString());
  for (const end of [NOW - 1, NOW + 10001, NaN]) {
    let reads = 0;
    await assert.rejects(fixture({ clock: () => reads++ ? end : NOW }).reader.readMetadata(),
      { code: 'CONFIGURATION_METADATA_INVALID' });
  }
  for (const invalid of [NaN, -1, 1.5, 8_640_000_000_000_001]) {
    const selected = fixture({ clock: () => invalid });
    await assert.rejects(selected.reader.readMetadata(), { code: 'CONFIGURATION_METADATA_INVALID' });
    assert.equal(selected.requests.length, 0);
  }
});

test('no cache can promote old metadata into a fresh server observation', async () => {
  const selected = fixture();
  await selected.reader.readMetadata(); await selected.reader.readMetadata();
  assert.equal(selected.requests.filter(({ path }) => path.includes('/settings/fields')).length, 2);
  assert.equal(selected.requests.filter(({ path }) => path.endsWith('/org')).length, 1);
});

test('factory rejects unsupported dependencies and timeout configuration', () => {
  for (const options of [undefined, {}, { crm: { readMetadata: () => {} } },
    { crm: fixture().crm, now: 'verified' }, { crm: fixture().crm, timeoutMs: 0 }]) {
    assert.throws(() => createConfigurationMetadataReader(options),
      { code: 'CONFIGURATION_METADATA_READER_UNAVAILABLE' });
  }
});

test.after(() => {
  assert.deepEqual(guard.blocked, []);
  guard.restore();
});
