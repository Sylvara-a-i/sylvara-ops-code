'use strict';

const crypto = require('node:crypto');
const { invariant } = require('./errors');
const { numberLookupKey } = require('./security');
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const PHONE = /^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/;
function exact(value, fields) {
  return value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).sort().join(',') === fields.slice().sort().join(',');
}
function held(condition) {
  invariant(condition, 'INVALID_TEST_NUMBER_INVENTORY',
    'Protected test number inventory is unavailable.', { httpStatus: 503 });
}

/** Operator-owned configuration only; never called with a form or HTTP body.
 * Deployment's unique number hash remains the durable, non-recycling owner.
 * Changing this document cannot erase a retained deployment's reservation. */
function loadTestNumberAssignments(env, { sourceRevision, operatorIdHash, numberSecret, qaPhoneNumber }) {
  const mode = env.RETELL_NUMBER_ASSIGNMENT_MODE || 'qa_only';
  held(mode === 'qa_only' || mode === 'approved_inventory');
  const raw = env.RETELL_NUMBER_INVENTORY_JSON;
  const pin = env.RETELL_NUMBER_INVENTORY_SHA256;
  if (mode === 'qa_only') {
    held((raw === undefined || raw === '') && (pin === undefined || pin === ''));
    return Object.freeze({ numberAssignmentMode: mode, approvedTestNumbers: null });
  }
  held(typeof qaPhoneNumber === 'string' && /^\+[1-9][0-9]{7,14}$/.test(qaPhoneNumber));
  held(typeof raw === 'string' && Buffer.byteLength(raw) <= 65536
    && /^[a-f0-9]{64}$/.test(pin || '')
    && crypto.createHash('sha256').update(raw, 'utf8').digest('hex') === pin);
  let document; try { document = JSON.parse(raw); } catch (_) { held(false); }
  held(exact(document, ['schemaVersion', 'environment', 'sourceRevision', 'operatorIdHash',
    'approvalSha256', 'assignments']) && document.schemaVersion === 1
    && document.environment === 'development' && document.sourceRevision === sourceRevision
    && document.operatorIdHash === operatorIdHash && /^[a-f0-9]{64}$/.test(document.approvalSha256 || '')
    && Array.isArray(document.assignments) && document.assignments.length >= 1
    && document.assignments.length <= 100);
  const phones = new Set(), deployments = new Set(), journeys = new Set();
  const entries = document.assignments.map(entry => {
    held(exact(entry, ['dealId', 'journeyId', 'clientId', 'deploymentId', 'phoneNumber'])
      && ['dealId', 'journeyId', 'clientId', 'deploymentId'].every(key => typeof entry[key] === 'string' && ID.test(entry[key]))
      && typeof entry.phoneNumber === 'string' && PHONE.test(entry.phoneNumber) && entry.phoneNumber !== qaPhoneNumber);
    const journey = JSON.stringify([entry.dealId, entry.journeyId]);
    held(!phones.has(entry.phoneNumber) && !deployments.has(entry.deploymentId) && !journeys.has(journey));
    phones.add(entry.phoneNumber); deployments.add(entry.deploymentId); journeys.add(journey);
    return Object.freeze({ ...entry, numberLookupHash: numberLookupKey(numberSecret, entry.phoneNumber) });
  });
  return Object.freeze({ numberAssignmentMode: mode, approvedTestNumbers: Object.freeze(entries) });
}

function assignedTestPhoneNumber(config, deployment, { dealId, journeyId } = {}) {
  if (!config.numberAssignmentMode || config.numberAssignmentMode === 'qa_only') return config.retellPhoneNumber;
  invariant(config.numberAssignmentMode === 'approved_inventory' && Array.isArray(config.approvedTestNumbers),
    'TEST_NUMBER_ASSIGNMENT_UNAVAILABLE', 'Protected test number assignment is unavailable.', { httpStatus: 409 });
  const found = config.approvedTestNumbers.filter(entry => entry.deploymentId === deployment?.DEPLOYMENT_ID
    && entry.clientId === deployment?.CLIENT_ID && entry.numberLookupHash === deployment?.NUMBER_LOOKUP_HASH
    && (dealId === undefined || entry.dealId === dealId)
    && (journeyId === undefined || entry.journeyId === journeyId));
  invariant(found.length === 1 && PHONE.test(found[0].phoneNumber)
    && found[0].numberLookupHash === numberLookupKey(config.numberSecret, found[0].phoneNumber),
    'TEST_NUMBER_ASSIGNMENT_UNAVAILABLE', 'Protected test number assignment is unavailable.', { httpStatus: 409 });
  return found[0].phoneNumber;
}
module.exports = { loadTestNumberAssignments, assignedTestPhoneNumber };
