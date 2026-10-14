'use strict';

// TEST ONLY. These sealed handles address a synthetic surviving authority, not
// a provider SDK, network transport, credential store or authorization API.
const { types: { isProxy }, isDeepStrictEqual } = require('node:util');
const audits = new WeakMap();
const changes = new WeakMap();
const journals = new WeakMap();
// Provider-facing limits only; the generic journal retains its larger budget.
// String.length counts UTF-16 code units, conservatively bounding characters.
const MAX_CHECKPOINT = 10000;
const MAX_PREDICATES = 5;
const TARGET_FIELDS = Object.freeze(['organizationId', 'projectId', 'environment', 'journalId']);
const fail = () => { throw new Error('Invalid synthetic provider contract.'); };

// Copy only own data fields; a hostile response cannot execute getters, proxy
// traps, coercion or serialization hooks while its identity is inspected.
function record(value, keys) {
  if (!value || typeof value !== 'object' || isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== keys.length || !keys.every((key) =>
    Object.hasOwn(fields, key) && Object.hasOwn(fields[key], 'value') && fields[key].enumerable)) return fail();
  return Object.fromEntries(keys.map((key) => [key, fields[key].value]));
}

function target(value) {
  const result = record(value, TARGET_FIELDS);
  if (result.environment !== 'synthetic' || !['organizationId', 'projectId', 'journalId'].every((key) =>
    typeof result[key] === 'string' && /^synthetic-[a-z0-9-]{1,80}$/.test(result[key]))) return fail();
  return Object.freeze(result);
}

function snapshot(value) {
  const result = record(value, ['revision', 'checkpoint']);
  if (!Number.isSafeInteger(result.revision) || result.revision < 0 ||
      typeof result.checkpoint !== 'string' || result.checkpoint.length > MAX_CHECKPOINT) return fail();
  return Object.freeze(result);
}

function assertTarget(expected, actual) {
  if (!isDeepStrictEqual(expected, target(actual))) fail();
}

function read(cell) {
  cell.counts.reads += 1;
  const fault = cell.readFault;
  cell.readFault = null;
  if (cell.hasOverride) {
    cell.hasOverride = false;
    const response = cell.override;
    cell.override = undefined;
    return response;
  }
  if (fault === 'unavailable') return fail();
  const previous = cell.previous || { revision: null, checkpoint: null };
  const data = fault === 'stale_snapshot' ? previous : {
    revision: cell.current.revision,
    checkpoint: fault === 'corrupt' ? '{' : fault === 'stale' ? previous.checkpoint : cell.current.checkpoint,
  };
  return Object.freeze({
    target: fault === 'wrong_target' ? Object.freeze({ ...cell.target, journalId: `${cell.target.journalId}-other` }) : cell.target,
    ...data,
  });
}

function writeRequest(expectedTarget, expectedRevision, checkpoint) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      expectedRevision === Number.MAX_SAFE_INTEGER) return fail();
  // Derive the complete closed predicate set, never trust a caller's count or
  // omit a fence to fit. This models logical conditions, not a SQL mapping.
  const predicates = Object.freeze({ ...expectedTarget, revision: expectedRevision });
  if (Object.keys(predicates).length > MAX_PREDICATES) return fail();
  const candidate = snapshot({ revision: expectedRevision + 1, checkpoint });
  return Object.freeze({ predicates, candidate });
}

function compareAndSwap(cell, request) {
  cell.counts.writes += 1;
  // Identity and revision are checked in the same indivisible synthetic write.
  // A separate preflight identity read would leave a retargeting race here.
  const { revision: expectedRevision, ...expectedTarget } = request.predicates;
  assertTarget(expectedTarget, cell.target);
  if (cell.current.revision !== expectedRevision) return false;
  const fault = cell.writeFault;
  cell.writeFault = null;
  if (fault === 'before_write') return fail();
  if (fault === 'drop_write') return true;
  cell.previous = cell.current;
  cell.current = request.candidate;
  cell.counts.commits += 1;
  const afterCommit = cell.afterCommit;
  cell.afterCommit = null;
  if (afterCommit) afterCommit();
  if (fault === 'after_write') return fail();
  return fault === 'invalid_response' ? Object.freeze({ unexpected: true }) : true;
}

function createSyntheticRotationProvider(inputTarget, seed) {
  const cell = { target: target(inputTarget), current: snapshot(seed), previous: null,
    readFault: null, writeFault: null, hasOverride: false, override: undefined, afterCommit: null,
    counts: { reads: 0, writes: 0, commits: 0 } };
  return Object.freeze({
    // Fresh transports share this authority. Do not copy a checkpoint into a
    // second provider while old writers survive: that would fork the CAS fence.
    connect() {
      const audit = Object.freeze({});
      const change = Object.freeze({});
      audits.set(audit, cell);
      changes.set(change, cell);
      return Object.freeze({ audit, changes: change });
    },
    snapshot: () => Object.freeze({ ...cell.current }),
    counts: () => Object.freeze({ ...cell.counts }),
    retarget: (value) => { cell.target = target(value); },
    faultNextWrite(fault) {
      if (!['before_write', 'after_write', 'drop_write', 'invalid_response'].includes(fault)) return fail();
      cell.writeFault = fault;
    },
    faultNextRead(fault) {
      if (!['unavailable', 'corrupt', 'stale', 'stale_snapshot', 'wrong_target'].includes(fault)) return fail();
      cell.readFault = fault;
    },
    // Deliberately retain malformed values as untrusted response fixtures.
    overrideNextRead(value) { cell.hasOverride = true; cell.override = value; },
    afterNextCommit(callback) {
      if (typeof callback !== 'function' || isProxy(callback)) return fail();
      cell.afterCommit = callback;
    },
  });
}

function createFixedTargetRotationJournal(inputTarget, transport) {
  const expectedTarget = target(inputTarget);
  const handles = record(transport, ['audit', 'changes']);
  const audit = audits.get(handles.audit);
  const change = changes.get(handles.changes);
  // A matching label alone cannot prove two handles share a revision authority.
  // Only handles issued by this synthetic fixture are accepted; arbitrary IO
  // functions and advertised capability flags are not a live transport seam.
  if (!audit || audit !== change || handles.audit === handles.changes) return fail();
  const journal = Object.freeze({});
  journals.set(journal, Object.freeze({
    read() {
      const response = record(read(audit), ['target', 'revision', 'checkpoint']);
      assertTarget(expectedTarget, response.target);
      return snapshot({ revision: response.revision, checkpoint: response.checkpoint });
    },
    compareAndSwap(expectedRevision, checkpoint) {
      // Reject incompatible requests before the synthetic dispatch counter or
      // provider state can change. The controller may still independently read.
      const request = writeRequest(expectedTarget, expectedRevision, checkpoint);
      const response = compareAndSwap(change, request);
      if (typeof response !== 'boolean') return fail();
      return response;
    },
  }));
  return journal;
}

// Internal test composition only. The migration package export map and runtime
// imports remain unchanged; a spread/copied object cannot impersonate a journal.
const fixedTargetJournalOperations = (journal) => journals.get(journal);
module.exports = { createSyntheticRotationProvider, createFixedTargetRotationJournal, fixedTargetJournalOperations };
