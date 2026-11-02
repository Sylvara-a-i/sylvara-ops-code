'use strict';

const { createHash } = require('node:crypto');

const STATES = new Set(('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT '
  + 'NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI AA AE AP').split(' '));
const DIGITS = Object.freeze({ zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9' });
const snapshots = new WeakMap();
const failures = new Set(['unavailable', 'timeout', 'corrupt']);

function normalizeZip(value) {
  const result = { status: 'invalid', zip5: null, normalization: null, extensionValidated: false };
  if (value === undefined || value === null || value === '') return { ...result, status: 'missing' };
  // Numbers lose leading zeroes; do not guess, pad, parse prose, or validate ZIP+4 delivery points.
  if (typeof value !== 'string' || value.length > 80) return result;
  const text = value.trim().toLowerCase();
  if (!text) return { ...result, status: 'missing' };
  if (/^\d{5}$/.test(text)) return { ...result, status: 'valid', zip5: text, normalization: 'five_digit' };
  if (/^\d{5}-\d{4}$/.test(text)) {
    return { ...result, status: 'valid', zip5: text.slice(0, 5), normalization: 'zip_plus_four' };
  }
  const parts = text.split(/[\s-]+/);
  if (parts.length === 5 && parts.every((part) => Object.hasOwn(DIGITS, part))) {
    return { ...result, status: 'valid', zip5: parts.map((part) => DIGITS[part]).join(''), normalization: 'spoken_digits' };
  }
  if (/^\d(?:\s+\d){4}$/.test(text)) {
    return { ...result, status: 'valid', zip5: text.replace(/\s/g, ''), normalization: 'separated_digits' };
  }
  return result;
}

function normalizeCity(value, state) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (state !== undefined && state !== null) return null;
    state = value.state;
    value = value.city;
  }
  if (state !== undefined && state !== null && typeof state !== 'string') return null;
  if (typeof value !== 'string' || value.length > 100) return null;
  const parts = value.trim().split(',');
  if (parts.length > 2) return null;
  const city = parts[0].normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();
  const inlineState = parts[1]?.trim().toUpperCase();
  const selectedState = typeof state === 'string' ? state.trim().toUpperCase() : inlineState;
  if (inlineState && selectedState !== inlineState) return null;
  if (!city || city.length > 80 || !/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(city) || !STATES.has(selectedState)) return null;
  return Object.freeze({ city, state: selectedState });
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function cityKey(value) { return `${value.city}|${value.state}`; }
function relationKey(value) { return `${value.zip5}|${cityKey(value)}`; }
function sortedUnique(rows) {
  return [...new Map(rows.map((row) => [relationKey(row), row])).values()]
    .sort((a, b) => relationKey(a) < relationKey(b) ? -1 : relationKey(a) > relationKey(b) ? 1 : 0);
}

function failedIndex(status = 'unavailable') {
  const handle = Object.freeze({ status: failures.has(status) ? status : 'corrupt' });
  snapshots.set(handle, { status: handle.status, provenance: null });
  return handle;
}

function buildIndex(records, manifest, sha256) {
  if (!manifest || !validDate(manifest.snapshotDate) || !validDate(manifest.expiresOn)
      || manifest.expiresOn < manifest.snapshotDate || !Array.isArray(records)
      || records.length === 0 || records.length > 1000000) return failedIndex('corrupt');
  const rows = [];
  for (const record of records) {
    const place = normalizeCity(record?.city, record?.state);
    if (!place || typeof record.zip5 !== 'string' || !/^\d{5}$/.test(record.zip5)) return failedIndex('corrupt');
    rows.push(Object.freeze({ zip5: record.zip5, ...place }));
  }
  const relations = sortedUnique(rows);
  const provenance = Object.freeze({
    source: manifest.source,
    sourceUrl: manifest.source === 'geonames' ? 'https://download.geonames.org/export/zip/' : null,
    attribution: manifest.source === 'geonames' ? 'GeoNames, CC BY 4.0, https://www.geonames.org/' : 'Synthetic test data',
    snapshotDate: manifest.snapshotDate, expiresOn: manifest.expiresOn,
    sha256: sha256 || createHash('sha256').update(JSON.stringify(relations)).digest('hex'),
    relationCount: relations.length,
  });
  const byZip = new Map();
  const byCity = new Map();
  for (const row of relations) {
    for (const [map, key] of [[byZip, row.zip5], [byCity, cityKey(row)]]) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
  }
  const handle = Object.freeze({ status: 'ready', provenance });
  snapshots.set(handle, { status: 'ready', provenance, byZip, byCity });
  return handle;
}

// Injection is explicit: synthetic rows never acquire a GeoNames source label.
function createSyntheticPostalIndex({ records, snapshotDate, expiresOn } = {}) {
  return buildIndex(records, { source: 'synthetic', snapshotDate, expiresOn });
}

// Accept already-local US.txt bytes/text. No filesystem, fetch, account, or refresh side effects.
// The checksum covers the uncompressed UTF-8 US.txt bytes, not the download ZIP archive.
function buildGeoNamesUsPostalIndex({ text, expectedSha256, snapshotDate, expiresOn } = {}) {
  if (!(typeof text === 'string' || Buffer.isBuffer(text))
      || !/^[a-f0-9]{64}$/.test(expectedSha256 || '')) return failedIndex('corrupt');
  const sha256 = createHash('sha256').update(text).digest('hex');
  if (sha256 !== expectedSha256) return failedIndex('corrupt');
  const content = Buffer.isBuffer(text) ? text.toString('utf8') : text;
  if (content.includes('\uFFFD')) return failedIndex('corrupt');
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const records = [];
  for (const line of lines) {
    const fields = line.split('\t');
    if (fields.length !== 12 || fields[0] !== 'US') return failedIndex('corrupt');
    records.push({ zip5: fields[1], city: fields[2], state: fields[4] });
  }
  // County names, coordinates, and coordinate accuracy never establish municipal boundaries.
  return buildIndex(records, { source: 'geonames', snapshotDate, expiresOn }, sha256);
}

function lookupPostalIndex(index, { zip5, cities = [], asOf } = {}) {
  const stored = index && typeof index === 'object' ? snapshots.get(index) : null;
  const unknown = (status, provenance = null) => ({ status, provenance, relations: [] });
  if (!stored) return unknown(index == null ? 'unavailable' : 'corrupt');
  if (stored.status !== 'ready') return unknown(stored.status);
  if (!validDate(asOf)) return unknown('invalid_date', stored.provenance);
  if (asOf < stored.provenance.snapshotDate) return unknown('future_snapshot', stored.provenance);
  if (asOf > stored.provenance.expiresOn) return unknown('stale', stored.provenance);
  const rows = [...(stored.byZip.get(zip5) || [])];
  for (const city of cities) {
    const normalized = normalizeCity(city);
    if (normalized) rows.push(...(stored.byCity.get(cityKey(normalized)) || []));
  }
  return { status: 'ready', provenance: stored.provenance,
    relations: sortedUnique(rows).map((row) => ({ ...row })) };
}

module.exports = { normalizeZip, normalizeCity, cityKey, createSyntheticPostalIndex,
  buildGeoNamesUsPostalIndex, failedIndex, lookupPostalIndex };
