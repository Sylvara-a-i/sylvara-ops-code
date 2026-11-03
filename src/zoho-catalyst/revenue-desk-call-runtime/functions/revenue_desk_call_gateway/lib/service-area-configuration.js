'use strict';

const { createHash } = require('node:crypto');
const { invariant } = require('./errors');
const { normalizeCity } = require('./offline-postal-index');

function exact(value, fields) {
  invariant(value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).every((key) => fields.includes(key)),
  'INVALID_SCHEMA', 'Service-area confirmation contains unsupported fields.');
}

function declarationFingerprint(declaration) {
  return createHash('sha256').update(JSON.stringify({ cities: declaration.cities, zips: declaration.zips })).digest('hex');
}

function coverage(value) {
  exact(value, ['status', 'cities', 'zips']);
  invariant(value.status === 'contractor_approved'
    && Array.isArray(value.cities) && value.cities.length <= 30
    && value.cities.every((city) => typeof city === 'string' && normalizeCity(city))
    && Array.isArray(value.zips) && value.zips.length <= 50
    && value.zips.every((zip) => typeof zip === 'string' && /^\d{5}$/.test(zip))
    && value.cities.length + value.zips.length > 0,
  'INVALID_SCHEMA', 'Confirmed service coverage requires cities with states or five-digit ZIPs.');
  const cities = value.cities.map((text) => {
    const city = normalizeCity(text);
    return `${city.city}, ${city.state}`;
  });
  invariant(new Set(cities).size === cities.length && new Set(value.zips).size === value.zips.length,
    'INVALID_SCHEMA', 'Confirmed service coverage contains duplicate entries.');
  return Object.freeze({ status: value.status, cities: Object.freeze(cities), zips: Object.freeze([...value.zips]) });
}

// This validates a confirmation's shape and declaration binding, not the operator's identity.
// Only the existing authenticated configuration approval can make this snapshot authoritative.
function validateServiceAreaResolution(value, declaration) {
  exact(value, ['schemaVersion', 'approvedCoverage', 'policy', 'confirmation', 'snapshotSha256']);
  invariant(value.schemaVersion === 1 && /^[a-f0-9]{64}$/.test(value.snapshotSha256 || ''),
    'INVALID_SCHEMA', 'Service-area snapshot identity is invalid.');
  invariant(declaration.cities.every((city) => normalizeCity(city))
    && declaration.zips.every((zip) => /^\d{5}$/.test(zip)),
  'INVALID_SCHEMA', 'A new service-area confirmation requires unambiguous declared cities and ZIPs.');
  const approvedCoverage = coverage(value.approvedCoverage);
  const policy = value.policy;
  exact(policy, ['cityMeaning', 'municipalityEvidence', 'mixedLists']);
  invariant((policy.cityMeaning === undefined || ['postal_locality', 'municipality'].includes(policy.cityMeaning))
    && (policy.municipalityEvidence === undefined || ['caller_attestation', 'boundary_required'].includes(policy.municipalityEvidence))
    && (policy.mixedLists === undefined || ['union', 'intersection'].includes(policy.mixedLists))
    && (!approvedCoverage.cities.length || policy.cityMeaning !== undefined)
    && (policy.cityMeaning !== 'municipality' || policy.municipalityEvidence !== undefined)
    && (!(approvedCoverage.cities.length && approvedCoverage.zips.length) || policy.mixedLists !== undefined),
  'INVALID_SCHEMA', 'Confirmed service coverage requires an explicit applicable policy.');
  const confirmation = value.confirmation;
  exact(confirmation, ['confirmedAt', 'reference', 'declarationSha256']);
  const timestamp = Date.parse(confirmation.confirmedAt);
  invariant(typeof confirmation.confirmedAt === 'string' && Number.isFinite(timestamp)
    && new Date(timestamp).toISOString() === confirmation.confirmedAt
    && typeof confirmation.reference === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(confirmation.reference)
    && confirmation.declarationSha256 === declarationFingerprint(declaration),
  'INVALID_SCHEMA', 'Service-area confirmation does not match the declaration.');
  return Object.freeze({ schemaVersion: 1, approvedCoverage, policy: Object.freeze({ ...policy }),
    confirmation: Object.freeze({ ...confirmation }), snapshotSha256: value.snapshotSha256 });
}

module.exports = { validateServiceAreaResolution, declarationFingerprint };
