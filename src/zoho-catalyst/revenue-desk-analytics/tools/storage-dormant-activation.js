'use strict';
// Pure private-artifact preparation: no clock, nonce generation, files or provider I/O.
const crypto = require('node:crypto');
const { types } = require('node:util');
const { encodeStorageBinding } = require('../functions/analytics_sync/lib/report-storage-binding');
const { dormantOperationDigest, validateDormantBinding, activateDormantBinding } = require('../functions/analytics_sync/lib/report-storage-activation');

const LIMITS = Object.freeze({ maximumDataStoreAttempts: 13, maximumInsertAttempts: 5,
  maximumActiveRequests: 2, maximumNewSyntheticRows: 5, operationTimeoutMs: 25000,
  requestTimeoutMs: 3000, drainTimeoutMs: 1000 });
const preparedActivations = new WeakSet();
const ROLES = ['ownerAuthorization', 'ownership', 'access'];
const KINDS = { ownerAuthorization: 'owner_readiness_continuity', ownership: 'ownership_readback', access: 'access_readback' };
const HASH = /^[a-f0-9]{64}$(?![\s\S])/;
const WINDOW_MS = 3600000;
const HEADROOM_MS = 27000;
function held() { throw new Error('DORMANT_ACTIVATION_PREPARATION_HELD'); }
function plain(value) {
  return value !== null && typeof value === 'object' && !types.isProxy(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exact(value, keys) {
  if (!plain(value) || Reflect.ownKeys(value).length !== keys.length) held();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) held();
  }
}
// Recursive canonicalization is solely the facts/receipt hashing contract.
// Binding wire bytes keep the codec's exact field order.
function canonical(value, seen = new Set(), depth = 0) {
  if (depth > 32) held();
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value) || Object.is(value, -0)) held(); return JSON.stringify(value); }
  if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) held();
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) held();
    const items = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) held();
      items.push(canonical(descriptor.value, seen, depth + 1));
    }
    result = '[' + items.join(',') + ']';
  } else {
    if (!plain(value)) held();
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) held();
    result = '{' + keys.sort().map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) held();
      return JSON.stringify(key) + ':' + canonical(descriptor.value, seen, depth + 1);
    }).join(',') + '}';
  }
  seen.delete(value);
  return result;
}
const sha = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const evidenceDigest = value => sha(canonical(value));
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function stageDormant(input) {
  exact(input, ['binding']);
  canonical(input.binding); // Reject accessors/non-JSON values before serialization or shared validation.
  validateDormantBinding(input.binding);
  if (input.binding.timeoutMs !== LIMITS.operationTimeoutMs) held();
  const raw = JSON.stringify(input.binding), bindingSha256 = sha(raw);
  const transport = encodeStorageBinding(raw, { partSize: 400, format: 'tuple-v1' });
  return freeze({ status: 'dormant_artifacts_prepared', raw, bindingSha256,
    operationDigest: dormantOperationDigest(bindingSha256), transport, limits: LIMITS,
    providerActions: 0, grantsExecutionAuthority: false });
}
function prepareActivation(input, options) {
  exact(input, ['binding', 'bindingSha256', 'expiresAt', 'receipts', 'readiness']);
  exact(options, ['now']);
  const now = options.now;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(input.expiresAt)
    || input.expiresAt - now < HEADROOM_MS || input.expiresAt - now > WINDOW_MS) held();
  const stage = stageDormant({ binding: input.binding });
  if (input.bindingSha256 !== stage.bindingSha256) held();
  exact(input.readiness, ['stagedAndReadBack', 'sourceAndTargetUnchanged', 'scopeAndCostAuthorized', 'durableConsumptionReady']);
  if (Object.values(input.readiness).some(value => value !== true)) held();
  exact(input.receipts, ROLES);
  const evidence = {};
  for (const role of ROLES) {
    const receipt = input.receipts[role];
    exact(receipt, ['schemaVersion', 'role', 'method', 'reference', 'observedAt', 'observationKind', 'normalizedFacts']);
    if (receipt.schemaVersion !== 1 || receipt.role !== role || receipt.method !== 'independent_current_read'
      || receipt.observationKind !== KINDS[role] || typeof receipt.reference !== 'string'
      || !/^[A-Za-z0-9_.:-]{1,160}$(?![\s\S])/.test(receipt.reference)
      || !Number.isSafeInteger(receipt.observedAt) || receipt.observedAt < 0 || receipt.observedAt > now
      || input.expiresAt - receipt.observedAt > WINDOW_MS || !plain(receipt.normalizedFacts)) held();
    const stateSha256 = evidenceDigest(receipt.normalizedFacts);
    if (stateSha256 !== input.binding.capability.evidence[role].digest) held();
    if (role === 'ownerAuthorization' && (!Object.hasOwn(receipt.normalizedFacts, 'standingApprovalSha256')
      || typeof receipt.normalizedFacts.standingApprovalSha256 !== 'string'
      || !HASH.test(receipt.normalizedFacts.standingApprovalSha256))) held();
    evidence[role] = { stateSha256, digest: evidenceDigest(receipt), verifiedAt: receipt.observedAt, expiresAt: input.expiresAt };
  }
  const activation = { schemaVersion: 1, bindingSha256: stage.bindingSha256,
    operationDigest: stage.operationDigest, verifiedAt: now, expiresAt: input.expiresAt, evidence };
  const activated = activateDormantBinding(input.binding, stage.bindingSha256, activation, now);
  const command = { profile: 'report_storage_qualification_v1', action: 'qualify_storage', activation };
  const result = freeze({ status: 'activation_prepared_not_consumed_or_executed', command, body: canonical(command),
    bindingSha256: stage.bindingSha256, operationDigest: stage.operationDigest,
    activationDigest: activated.activationDigest,
    guardTimes: { verifiedAt: now, expiresAt: input.expiresAt, latestDispatchAt: input.expiresAt - HEADROOM_MS,
      requiredDispatchHeadroomMs: HEADROOM_MS },
    limits: LIMITS, providerActions: 0, grantsExecutionAuthority: false,
    requiredSequence: ['verify_current_receipts_and_staged_caller', 'durably_consume_exact_activation',
      'inject_constant_body_through_reviewed_managed_caller', 'execute_once', 'restore_and_reconcile_without_retry'] });
  preparedActivations.add(result);
  return result;
}
function renderActivationCaller(input) {
  exact(input, ['templateText', 'templateSha256', 'preparedActivation']);
  const { templateText, templateSha256, preparedActivation: prepared } = input;
  if (typeof templateText !== 'string' || !/^[\x09\x0a\x20-\x7e]+$(?![\s\S])/.test(templateText)
    || !templateText.endsWith('\n') || typeof templateSha256 !== 'string' || !HASH.test(templateSha256)
    || sha(templateText) !== templateSha256 || !preparedActivations.has(prepared)) held();
  const expected = { __ACTIVATION_COMMAND_JSON__: 1, __OPERATION_DIGEST__: 2,
    __VERIFIED_AT__: 3, __EXPIRES_AT__: 3, __TIMEOUT_MS__: 2 };
  const counts = {};
  for (const token of templateText.match(/__[A-Z_]+__/g) || []) {
    if (!Object.hasOwn(expected, token)) held();
    counts[token] = (counts[token] || 0) + 1;
  }
  // Existing callers may already contain the literal fixed timeout.
  if (!Object.hasOwn(counts, '__TIMEOUT_MS__')) expected.__TIMEOUT_MS__ = 0;
  if (Object.entries(expected).some(([token, count]) => (counts[token] || 0) !== count)
    || (templateText.match(/\binvokeurl\b/g) || []).length !== 1
    || (templateText.match(/"__OPERATION_DIGEST__"/g) || []).length !== 2
    || (templateText.match(/\bbody = __ACTIVATION_COMMAND_JSON__\.toMap\(\);/g) || []).length !== 1) held();
  const replacements = { __ACTIVATION_COMMAND_JSON__: JSON.stringify(prepared.body),
    __OPERATION_DIGEST__: prepared.operationDigest, __VERIFIED_AT__: String(prepared.guardTimes.verifiedAt),
    __EXPIRES_AT__: String(prepared.guardTimes.expiresAt), __TIMEOUT_MS__: String(LIMITS.operationTimeoutMs) };
  // A callback avoids replacement-string metacharacter interpretation. All route,
  // Connection, projection and native formatting bytes remain the reviewed ones.
  const text = templateText.replace(/__[A-Z_]+__/g, token => replacements[token]);
  return freeze({ text, sha256: sha(text), bytes: Buffer.byteLength(text, 'utf8'),
    templateSha256, operationDigest: prepared.operationDigest, activationDigest: prepared.activationDigest,
    grantsExecutionAuthority: false, providerActions: 0 });
}
function renderDiagnosticActivationCaller(input) {
  const base = renderActivationCaller(input);
  const { instrumentStorageCaller } = require('./storage-caller-diagnostics');
  const diagnostic = instrumentStorageCaller({ callerText: base.text, callerSha256: base.sha256 });
  return freeze({ ...base, ...diagnostic });
}
module.exports = { LIMITS, evidenceDigest, stageDormant, prepareActivation, renderActivationCaller, renderDiagnosticActivationCaller };
