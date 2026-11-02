'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { resolveServiceArea } = require('../lib/service-area-resolution');
const { normalizeZip, createSyntheticPostalIndex, buildGeoNamesUsPostalIndex, failedIndex,
  lookupPostalIndex } = require('../lib/offline-postal-index');

// Synthetic relations exercise policy behavior; this is not a geographic reference dataset.
const records = [
  { zip5: '66212', city: 'Overland Park', state: 'KS' },
  { zip5: '66101', city: 'Kansas City', state: 'KS' },
  { zip5: '66102', city: 'Kansas City', state: 'KS' },
  { zip5: '64101', city: 'Kansas City', state: 'MO' },
  { zip5: '00501', city: 'Example Township', state: 'NY' },
  { zip5: '00501', city: 'Example Postal Alias', state: 'NY' },
  { zip5: '00502', city: 'Example Township', state: 'NY' },
];
const dates = { snapshotDate: '2026-10-01', expiresOn: '2026-11-30' };
const index = createSyntheticPostalIndex({ records, ...dates });
const cities = ['Kansas City, KS', 'Kansas City, MO'];
const cityApproval = { status: 'contractor_approved', cities, zips: [] };
const zipApproval = { status: 'contractor_approved', cities: [], zips: ['66101', '00501'] };
function resolve(overrides = {}) {
  return resolveServiceArea({ declaration: { cities, zips: [] }, approvedCoverage: cityApproval,
    policy: { cityMeaning: 'postal_locality' }, caller: { zip: '66212', addressKind: 'physical' },
    postalIndex: index, asOf: '2026-11-02', ...overrides });
}
function zipOnly(caller, overrides = {}) {
  return resolve({ declaration: { cities: [], zips: ['66101', '00501'] }, approvedCoverage: zipApproval,
    policy: {}, caller: { addressKind: 'physical', ...caller }, ...overrides });
}
function mixed(mode, caller, overrides = {}) {
  return resolve({ declaration: { cities: ['Kansas City, KS'], zips: ['66101'] },
    approvedCoverage: { status: 'contractor_approved', cities: ['Kansas City, KS'], zips: ['66101'] },
    policy: { cityMeaning: 'postal_locality', mixedLists: mode },
    caller: { addressKind: 'physical', ...caller }, ...overrides });
}
test.after(() => {
  assert.deepEqual(guard.blocked, [], 'no calls, provider packages, credential reads, or subprocess attempts');
  guard.restore();
});

test('city-only legacy coverage asks city and state for ZIP 66212, including missing approval/policy', () => {
  for (const overrides of [{}, { approvedCoverage: undefined, policy: {} }]) {
    const result = resolve(overrides);
    assert.equal(result.status, 'needs_clarification');
    assert.deepEqual(result.clarification, ['ask_city_and_state']);
    assert.deepEqual(result.evidence.declaration.zips, []);
    assert.ok(result.evidence.candidateRelations.some((row) => row.zip5 === '66212'));
  }
});

test('exact city and state distinguish Kansas City KS from MO under explicit locality policy', () => {
  const approvedCoverage = { status: 'contractor_approved', cities: ['Kansas City, KS'], zips: [] };
  for (const [state, expected] of [['KS', 'eligible'], ['MO', 'manual_review']]) {
    const result = resolve({ approvedCoverage, caller: { city: ' Kansas   City ', state, addressKind: 'physical' } });
    assert.equal(result.status, expected);
    assert.equal(result.evidence.cityCoverage.basis,
      state === 'KS' ? 'caller_provided_postal_locality' : 'city_identity_unconfirmed');
    assert.equal(result.evidence.caller.city.state, state);
    assert.equal(result.evidence.municipalBoundaryVerified, false);
  }
});

test('caller city without state, conflicting inline state, and partial state ask for clarification', () => {
  for (const caller of [{ city: 'Kansas City' }, { city: 'Kansas City, KS', state: 'MO' }, { state: 'KS' },
    { city: { city: 'Kansas City', state: 'KS' }, state: 'MO' }, { city: 'Kansas City, KS', state: 1 }]) {
    const result = resolve({ caller: { ...caller, addressKind: 'physical' } });
    assert.equal(result.status, 'needs_clarification');
    assert.deepEqual(result.clarification, ['ask_city_and_state']);
  }
  assert.equal(resolve({ declaration: { cities: ['Kansas City'] } }).status, 'manual_review');
});

test('many ZIPs per city and multiple place names per ZIP remain candidate relations', () => {
  const result = lookupPostalIndex(index, { zip5: '00501', cities: ['Kansas City, KS'], asOf: '2026-11-02' });
  assert.deepEqual(result.relations.map((row) => row.zip5), ['00501', '00501', '66101', '66102']);
  const resolution = zipOnly({ city: 'Example Township', state: 'NY' });
  assert.equal(resolution.status, 'needs_clarification');
  assert.deepEqual(resolution.clarification, ['ask_five_digit_zip']);
  assert.equal(resolution.evidence.zipCoverage.state, 'unknown');
  assert.equal(resolution.evidence.candidateRelations.length, 2);
  assert.equal(zipOnly({ city: 'Example Postal Alias', state: 'NY', zip: '00501' }).postalConsistency.status, 'consistent');
  for (const zip of [undefined, '00501']) {
    const ambiguous = resolve({ declaration: { cities: ['Example Township, NY'] },
      approvedCoverage: { status: 'contractor_approved', cities: ['Example Township, NY'] },
      caller: { city: 'Example Postal Alias', state: 'NY', zip, addressKind: 'physical' } });
    assert.equal(ambiguous.status, 'needs_clarification');
    assert.deepEqual(ambiguous.clarification, ['confirm_service_city_and_approved_locality']);
    assert.equal(ambiguous.evidence.cityCoverage.basis, 'postal_alias_or_boundary_ambiguity');
  }
});

test('explicit approved ZIP can qualify without inventing city or needing a postal lookup', () => {
  for (const postalIndex of [index, undefined, failedIndex('timeout')]) {
    const result = zipOnly({ zip: '00501' }, { postalIndex });
    assert.equal(result.status, 'eligible');
    assert.equal(result.evidence.zipCoverage.basis, 'explicit_approved_zip');
    assert.equal(result.evidence.caller.city, null);
    assert.equal(result.postalConsistency.status, 'not_requested');
  }
});

test('losing city alias evidence cannot turn clarification into rejection', () => {
  const coverage = { cities: ['Example Township, NY'], zips: [] };
  const options = { declaration: coverage, approvedCoverage: { status: 'contractor_approved', ...coverage },
    caller: { city: 'Example Postal Alias', state: 'NY', addressKind: 'physical' } };
  assert.equal(resolve(options).status, 'needs_clarification');
  const missingPlaces = [
    records.filter((row) => row.city !== 'Example Postal Alias'),
    records.filter((row) => row.city !== 'Example Township'),
    records.filter((row) => !row.city.startsWith('Example')),
  ].map((snapshotRecords) => ({ postalIndex: createSyntheticPostalIndex({ records: snapshotRecords, ...dates }) }));
  for (const unavailable of [
    { postalIndex: undefined }, { postalIndex: failedIndex('timeout') }, { postalIndex: failedIndex('corrupt') },
    { postalIndex: { status: 'ready', records } }, { asOf: '2026-12-01' }, { asOf: '2026-09-30' },
    { asOf: '2026-02-30' }, ...missingPlaces,
  ]) {
    const result = resolve({ ...options, ...unavailable });
    assert.equal(result.status, 'manual_review');
    assert.equal(result.evidence.cityCoverage.state, 'unknown');
    assert.deepEqual(result.clarification, ['review_postal_evidence']);
    assert.deepEqual(result.evidence.approvedCoverage.zips, []);
    const exact = resolve({ ...options, ...unavailable,
      caller: { city: 'Example Township', state: 'NY', addressKind: 'physical' } });
    assert.equal(exact.status, 'eligible', 'an independent exact approved locality match is preserved');
  }
  // Both names can remain indexed after just their shared relationship disappears.
  // None of the subsets of these candidate rows establishes an exclusion or an approval.
  const aliasRelations = [
    { zip5: '00501', city: 'Example Township', state: 'NY' },
    { zip5: '00502', city: 'Example Township', state: 'NY' },
    { zip5: '00501', city: 'Example Postal Alias', state: 'NY' },
    { zip5: '00503', city: 'Example Postal Alias', state: 'NY' },
  ];
  for (let subset = 0; subset < 16; subset++) {
    const postalIndex = createSyntheticPostalIndex({ ...dates,
      records: [records[0], ...aliasRelations.filter((row, bit) => subset & (1 << bit))] });
    const result = resolve({ ...options, postalIndex });
    assert.ok(['needs_clarification', 'manual_review'].includes(result.status), `relationship subset ${subset}`);
    assert.equal(result.evidence.cityCoverage.state, 'unknown');
    assert.equal(zipOnly({ zip: '00501' }, { postalIndex }).status, 'eligible');
  }
});

test('matching and conflicting pairs report postal consistency separately from coverage', () => {
  const matching = resolve({ caller: { city: 'Kansas City', state: 'KS', zip: '66101', addressKind: 'physical' } });
  assert.equal(matching.status, 'eligible');
  assert.equal(matching.postalConsistency.status, 'consistent');
  const conflicting = zipOnly({ city: 'Kansas City', state: 'MO', zip: '66101' });
  assert.equal(conflicting.evidence.zipCoverage.state, 'match');
  assert.equal(conflicting.postalConsistency.status, 'conflict');
  assert.equal(conflicting.status, 'needs_clarification');
  const outside = zipOnly({ city: 'Kansas City', state: 'MO', zip: '64101' });
  assert.equal(outside.postalConsistency.status, 'consistent');
  assert.equal(outside.status, 'ineligible');
});

test('mixed policy is explicit and missing evidence is not an exclusion', () => {
  assert.equal(mixed(undefined, { zip: '66101' }).status, 'needs_clarification');
  for (const [mode, caller, expected] of [
    ['union', { zip: '66101' }, 'eligible'],
    ['union', { zip: '64101' }, 'needs_clarification'],
    ['union', { city: 'Kansas City', state: 'KS' }, 'eligible'],
    ['union', { city: 'Kansas City', state: 'MO' }, 'needs_clarification'],
    ['intersection', { zip: '66101' }, 'needs_clarification'],
    ['intersection', { zip: '64101' }, 'needs_clarification'],
    ['intersection', { city: 'Kansas City', state: 'KS' }, 'needs_clarification'],
    ['intersection', { city: 'Kansas City', state: 'MO' }, 'needs_clarification'],
    ['intersection', { city: 'Kansas City', state: 'KS', zip: '66101' }, 'eligible'],
    ['intersection', { city: 'Kansas City', state: 'KS', zip: '66102' }, 'ineligible'],
    ['union', { city: 'Kansas City', state: 'KS', zip: '66102' }, 'eligible'],
    ['union', { city: 'Kansas City', state: 'MO', zip: '64101' }, 'manual_review'],
  ]) assert.equal(mixed(mode, caller).status, expected, JSON.stringify({ mode, caller }));
});

test('unknown city semantics and municipal boundary requirements never become ZIP guesses', () => {
  const caller = { city: 'Kansas City', state: 'KS', addressKind: 'physical' };
  assert.equal(resolve({ caller, policy: {} }).status, 'needs_clarification');
  assert.equal(resolve({ caller, policy: { cityMeaning: 'municipality' } }).status, 'needs_clarification');
  const boundary = resolve({ caller, policy: { cityMeaning: 'municipality', municipalityEvidence: 'boundary_required' } });
  assert.equal(boundary.status, 'manual_review');
  assert.deepEqual(boundary.clarification, ['review_municipal_boundary']);
  const attested = resolve({ caller, policy: { cityMeaning: 'municipality', municipalityEvidence: 'caller_attestation' } });
  assert.equal(attested.status, 'eligible');
  assert.equal(attested.evidence.cityCoverage.basis, 'caller_attested_municipality');
  assert.equal(attested.evidence.municipalBoundaryVerified, false);
  const ambiguous = resolve({ declaration: { cities: ['Example Township, NY'] },
    approvedCoverage: { status: 'contractor_approved', cities: ['Example Township, NY'] },
    caller: { zip: '00501', addressKind: 'physical' } });
  assert.equal(ambiguous.status, 'needs_clarification');
  assert.deepEqual(ambiguous.clarification, ['ask_city_and_state']);
});

test('ZIP normalization preserves zeroes and only accepts unambiguous input formats', () => {
  for (const [value, expected, normalization] of [
    ['00501', '00501', 'five_digit'], ['00501-1234', '00501', 'zip_plus_four'],
    ['zero zero five zero one', '00501', 'spoken_digits'], ['6 6 2 1 2', '66212', 'separated_digits'],
  ]) {
    const result = normalizeZip(value);
    assert.equal(result.zip5, expected);
    assert.equal(result.normalization, normalization);
    assert.equal(result.extensionValidated, false);
    if (expected === '00501') assert.equal(zipOnly({ zip: value }).status, 'eligible');
  }
  for (const value of [501, 66212, '501', '005011234', '00501-123', 'five hundred one', 'oh oh five oh one',
    'ZIP 66212', '66A12', '66212, 64101', {}, []]) {
    assert.equal(normalizeZip(value).status, 'invalid');
    assert.equal(zipOnly({ zip: value }).status, 'needs_clarification');
  }
});

test('physical service location must be confirmed; postal data does not establish delivery type', () => {
  for (const addressKind of [undefined, 'unknown', 'po_box', 'mailing', 'physical-ish']) {
    const result = zipOnly({ zip: '00501', addressKind });
    assert.equal(result.status, 'needs_clarification');
    assert.deepEqual(result.clarification, ['ask_physical_service_location']);
  }
});

test('missing/new ZIP, stale/future/invalid-date index, timeout and corruption cannot reject callers', () => {
  assert.equal(zipOnly({ zip: '99998' }).status, 'manual_review');
  for (const overrides of [
    { postalIndex: undefined }, { postalIndex: failedIndex('timeout') }, { postalIndex: failedIndex('corrupt') },
    { postalIndex: { status: 'ready', records } }, { asOf: '2026-12-01' }, { asOf: '2026-09-30' }, { asOf: '2026-02-30' },
  ]) {
    assert.equal(zipOnly({ zip: '64101' }, overrides).status, 'manual_review');
    assert.equal(zipOnly({ city: 'Kansas City', state: 'KS', zip: '66101' }, overrides).status, 'manual_review');
  }
});

test('local GeoNames parser pins bytes and provenance, discards coordinates, and rejects corrupt snapshots', () => {
  const text = 'US\t00501\tExample Township\tNew York\tNY\tExample County\t000\t\t\t40.0\t-73.0\t1\n';
  const expectedSha256 = createHash('sha256').update(text).digest('hex');
  const built = buildGeoNamesUsPostalIndex({ text, expectedSha256, ...dates });
  const lookup = lookupPostalIndex(built, { zip5: '00501', asOf: '2026-11-02' });
  assert.equal(lookup.status, 'ready');
  assert.equal(lookup.provenance.source, 'geonames');
  assert.equal(lookup.provenance.sha256, expectedSha256);
  assert.match(lookup.provenance.attribution, /GeoNames, CC BY 4.0/);
  assert.deepEqual(lookup.relations, [{ zip5: '00501', city: 'EXAMPLE TOWNSHIP', state: 'NY' }]);
  for (const corrupted of [text + 'x', text.replace('US', 'CA'), text.replace('00501', '501'), text.replace('\t40.0', '')]) {
    for (const checksum of [expectedSha256, createHash('sha256').update(corrupted).digest('hex')]) {
      assert.equal(buildGeoNamesUsPostalIndex({ text: corrupted, expectedSha256: checksum, ...dates }).status, 'corrupt');
    }
  }
  assert.equal(buildGeoNamesUsPostalIndex({ text, ...dates }).status, 'corrupt');
  assert.equal(createSyntheticPostalIndex({ records, ...dates, expiresOn: '2026-02-30' }).status, 'corrupt');
  assert.equal(createSyntheticPostalIndex({ records: [...records, { zip5: 'broken' }], ...dates }).status, 'corrupt');
});

test('refresh cannot change approval, infer caller ZIP, or promote candidate relations', () => {
  const declaration = { cities: ['Kansas City, KS'], zips: [] };
  const approvedCoverage = { status: 'contractor_approved', cities: [], zips: ['64101'] };
  const before = structuredClone({ declaration, approvedCoverage, records });
  const refreshed = createSyntheticPostalIndex({ records: [...records, { city: 'Kansas City', state: 'KS', zip5: '99998' }], ...dates });
  for (const postalIndex of [index, refreshed]) {
    const result = resolve({ declaration, approvedCoverage, postalIndex, caller: { city: 'Kansas City', state: 'KS', addressKind: 'physical' } });
    assert.equal(result.status, 'needs_clarification');
    assert.deepEqual(result.evidence.approvedCoverage.zips, ['64101']);
    assert.equal(result.evidence.caller.zip.zip5, null);
    const candidateCaller = resolve({ declaration, approvedCoverage, postalIndex, caller: { zip: '66101', addressKind: 'physical' } });
    assert.notEqual(candidateCaller.status, 'eligible');
  }
  assert.deepEqual({ declaration, approvedCoverage, records }, before);
  const unknownApproval = resolve({ approvedCoverage: undefined,
    caller: { city: 'Kansas City', state: 'KS', addressKind: 'physical' } });
  assert.equal(unknownApproval.status, 'manual_review');
});

test('outputs allowlist geography and fixed reasons; unrelated input data is never returned', () => {
  const sentinel = 'synthetic-sensitive-sentinel';
  const result = zipOnly({ zip: '00501', fullAddress: sentinel, phone: sentinel, transcript: sentinel }, {
    declaration: { cities: [], zips: ['00501'], sourceText: sentinel },
    approvedCoverage: { ...zipApproval, tenantId: sentinel, approvalNote: sentinel },
    policy: { note: sentinel },
  });
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.deepEqual(Object.keys(result).sort(), ['clarification', 'evidence', 'postalConsistency', 'reasons', 'status']);
  assert.deepEqual(Object.keys(result.evidence.caller).sort(), ['addressKind', 'city', 'zip']);
  const first = lookupPostalIndex(index, { zip5: '00501', asOf: '2026-11-02' });
  first.relations[0].zip5 = '99998';
  assert.equal(lookupPostalIndex(index, { zip5: '00501', asOf: '2026-11-02' }).relations[0].zip5, '00501');
});
