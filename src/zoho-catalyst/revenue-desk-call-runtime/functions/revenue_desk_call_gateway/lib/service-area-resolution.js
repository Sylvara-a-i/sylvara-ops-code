'use strict';

const { normalizeZip, normalizeCity, cityKey, lookupPostalIndex } = require('./offline-postal-index');

function coverageLists(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cities = value.cities === undefined ? [] : value.cities;
  const zips = value.zips === undefined ? [] : value.zips;
  if (!Array.isArray(cities) || !Array.isArray(zips) || cities.length > 30 || zips.length > 50) return null;
  const normalizedCities = cities.map((city) => normalizeCity(city));
  // Approval is for five-digit ZIPs; never normalize malformed approval into a new grant.
  if (normalizedCities.some((city) => !city) || zips.some((zip) => typeof zip !== 'string' || !/^\d{5}$/.test(zip))) return null;
  return { cities: [...new Map(normalizedCities.map((city) => [cityKey(city), city])).values()],
    zips: [...new Set(zips)] };
}

function dimension(state, basis) { return { state, basis }; }

/**
 * Pure decision support. Inputs are a reviewed configuration snapshot and caller geography;
 * an authenticated integration must establish contractor approval before supplying coverage.
 * Postal candidates are evidence only and are never used as approved ZIPs or caller attestations.
 */
function resolveServiceArea({ declaration, approvedCoverage, policy = {}, caller = {}, postalIndex, asOf } = {}) {
  policy = policy && typeof policy === 'object' ? policy : {};
  caller = caller && typeof caller === 'object' ? caller : {};
  const declared = coverageLists(declaration);
  const approved = approvedCoverage?.status === 'contractor_approved' ? coverageLists(approvedCoverage) : null;
  const city = typeof caller.city === 'string' ? normalizeCity(caller.city, caller.state) : null;
  const zip = normalizeZip(caller.zip);
  const hasCityInput = caller.city !== undefined && caller.city !== null && caller.city !== '';
  const hasStateInput = caller.state !== undefined && caller.state !== null && caller.state !== '';
  const postal = lookupPostalIndex(postalIndex, {
    zip5: zip.zip5, cities: [...(declared?.cities || []), ...(approved?.cities || []), ...(city ? [city] : [])], asOf,
  });
  const zipRelations = postal.relations.filter((row) => row.zip5 === zip.zip5);
  const consistency = { status: 'not_requested', reason: 'city_zip_pair_not_provided' };
  if (city && zip.status === 'valid') {
    if (postal.status !== 'ready' || zipRelations.length === 0) {
      consistency.status = 'unknown';
      consistency.reason = postal.status === 'ready' ? 'zip_not_in_snapshot' : `postal_index_${postal.status}`;
    } else {
      consistency.status = zipRelations.some((row) => cityKey(row) === cityKey(city)) ? 'consistent' : 'conflict';
      consistency.reason = consistency.status === 'consistent' ? 'pair_listed_in_snapshot' : 'pair_not_listed_in_snapshot';
    }
  }
  const result = {
    status: 'manual_review', reasons: [], clarification: [],
    postalConsistency: consistency,
    evidence: {
      caller: { city, zip, addressKind: ['physical', 'po_box'].includes(caller.addressKind) ? caller.addressKind : 'unknown' },
      declaration: declared,
      approvedCoverage: approved ? { status: 'contractor_approved', ...approved } : null,
      candidateRelations: postal.relations,
      postalIndex: { status: postal.status, provenance: postal.provenance },
      cityCoverage: dimension('unknown', 'not_evaluated'), zipCoverage: dimension('unknown', 'not_evaluated'),
      scope: 'service_area_only', municipalBoundaryVerified: false,
    },
  };
  const finish = (status, reason, clarification) => {
    result.status = status;
    result.reasons.push(reason);
    if (clarification) result.clarification.push(clarification);
    return result;
  };
  if (!declared) return finish('manual_review', 'invalid_declaration', 'review_declared_cities_states_and_zips');
  if (zip.status === 'invalid') return finish('needs_clarification', 'invalid_caller_zip', 'ask_five_digit_zip');
  if ((hasCityInput || hasStateInput) && !city) {
    return finish('needs_clarification', 'city_and_state_required', 'ask_city_and_state');
  }
  // This preserves city-only legacy configurations: [] is not a ZIP exclusion rule.
  if (declared.cities.length && !declared.zips.length && !city && !approved?.zips.length) {
    return finish('needs_clarification', 'city_only_coverage_requires_caller_city', 'ask_city_and_state');
  }
  if (!approved || (!approved.cities.length && !approved.zips.length)) {
    return finish('manual_review', 'contractor_approved_coverage_required', 'review_contractor_coverage');
  }
  const hasCities = approved.cities.length > 0;
  const hasZips = approved.zips.length > 0;
  if (hasCities && !['postal_locality', 'municipality'].includes(policy.cityMeaning)) {
    return finish('needs_clarification', 'city_meaning_policy_required', 'confirm_city_meaning_with_contractor');
  }
  if (hasCities && hasZips && !['union', 'intersection'].includes(policy.mixedLists)) {
    return finish('needs_clarification', 'mixed_list_policy_required', 'confirm_union_or_intersection_with_contractor');
  }
  if (hasCities && policy.cityMeaning === 'municipality'
      && !['caller_attestation', 'boundary_required'].includes(policy.municipalityEvidence)) {
    return finish('needs_clarification', 'municipality_evidence_policy_required', 'confirm_municipality_evidence_with_contractor');
  }
  let cityCoverage = dimension('not_applicable', 'no_approved_city_rule');
  if (hasCities) {
    if (!city) cityCoverage = dimension('unknown', 'caller_city_and_state_missing');
    else if (policy.cityMeaning === 'municipality' && policy.municipalityEvidence === 'boundary_required') {
      cityCoverage = dimension('unknown', 'municipal_boundary_evidence_required');
    } else if (approved.cities.some((place) => cityKey(place) === cityKey(city))) {
      cityCoverage = dimension('match',
        policy.cityMeaning === 'municipality' ? 'caller_attested_municipality' : 'caller_provided_postal_locality');
    } else {
      // Shared postal codes may denote aliases or distinct municipalities. Neither interpretation
      // proves coverage. Even a populated index cannot establish exhaustive alias relationships.
      const approvedCityKeys = new Set(approved.cities.map(cityKey));
      const indexedCityKeys = new Set(postal.relations.map(cityKey));
      const candidateZips = new Set(postal.relations.filter((row) => approvedCityKeys.has(cityKey(row))).map((row) => row.zip5));
      if (postal.status !== 'ready') cityCoverage = dimension('unknown', `postal_index_${postal.status}`);
      else if (!indexedCityKeys.has(cityKey(city)) || [...approvedCityKeys].some((key) => !indexedCityKeys.has(key))) {
        cityCoverage = dimension('unknown', 'city_identity_not_in_snapshot');
      } else if (postal.relations.some((row) => cityKey(row) === cityKey(city) && candidateZips.has(row.zip5))) {
        cityCoverage = dimension('unknown', 'postal_alias_or_boundary_ambiguity');
      } else cityCoverage = dimension('unknown', 'city_identity_unconfirmed');
    }
  }
  let zipCoverage = dimension('not_applicable', 'no_approved_zip_rule');
  if (hasZips) {
    if (zip.status !== 'valid') zipCoverage = dimension('unknown', 'caller_zip_missing');
    else if (approved.zips.includes(zip.zip5)) zipCoverage = dimension('match', 'explicit_approved_zip');
    else if (postal.status !== 'ready' || !zipRelations.length) {
      zipCoverage = dimension('unknown', postal.status === 'ready' ? 'zip_not_in_snapshot' : `postal_index_${postal.status}`);
    } else zipCoverage = dimension('outside', 'caller_zip_outside_approved_list');
  }
  result.evidence.cityCoverage = cityCoverage;
  result.evidence.zipCoverage = zipCoverage;
  if (consistency.status === 'conflict') {
    // The index is not exhaustive about aliases. An absent pair is a question, not an invalid address.
    return finish('needs_clarification', 'city_zip_pair_needs_confirmation', 'confirm_service_city_state_and_zip');
  }
  if (consistency.status === 'unknown') return finish('manual_review', consistency.reason, 'review_postal_evidence');
  if (result.evidence.caller.addressKind !== 'physical') {
    return finish('needs_clarification', 'physical_service_location_required', 'ask_physical_service_location');
  }
  const dimensions = [cityCoverage, zipCoverage].filter((part) => part.state !== 'not_applicable');
  const union = dimensions.length === 1 || policy.mixedLists === 'union';
  if (union && dimensions.some((part) => part.state === 'match')) {
    return finish('eligible', 'approved_service_area_match');
  }
  if (dimensions.some((part) => part.state === 'unknown')) {
    if (zipCoverage.basis === 'caller_zip_missing') {
      if (cityCoverage.basis === 'caller_city_and_state_missing') result.clarification.push('ask_city_and_state');
      return finish('needs_clarification', 'coverage_evidence_incomplete', 'ask_five_digit_zip');
    }
    if (zipCoverage.state === 'unknown') {
      return finish('manual_review', zipCoverage.basis, 'review_postal_evidence');
    }
    if (cityCoverage.basis === 'municipal_boundary_evidence_required') {
      return finish('manual_review', cityCoverage.basis, 'review_municipal_boundary');
    }
    if (cityCoverage.basis === 'postal_alias_or_boundary_ambiguity') {
      return finish('needs_clarification', cityCoverage.basis, 'confirm_service_city_and_approved_locality');
    }
    if (cityCoverage.state === 'unknown' && cityCoverage.basis !== 'caller_city_and_state_missing') {
      return finish('manual_review', cityCoverage.basis, 'review_postal_evidence');
    }
    if (cityCoverage.state === 'unknown') result.clarification.push('ask_city_and_state');
    return finish('needs_clarification', 'coverage_evidence_incomplete');
  }
  if (dimensions.every((part) => part.state === 'match')) return finish('eligible', 'approved_service_area_match');
  return finish('ineligible', 'outside_explicit_approved_service_area');
}

module.exports = { resolveServiceArea };
