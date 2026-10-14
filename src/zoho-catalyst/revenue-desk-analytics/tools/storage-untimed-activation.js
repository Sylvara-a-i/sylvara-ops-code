'use strict';
// Pure schema-7 preparation. No clock, nonce allocation, ledger or provider I/O.
const crypto = require('node:crypto');
const { types } = require('node:util');
const { canonicalJson } = require('../functions/analytics_sync/lib/facts');
const { encodeStorageBinding } = require('../functions/analytics_sync/lib/report-storage-binding');
const { validateDormantBinding, dormantOperationDigest, activateDormantBinding } = require('../functions/analytics_sync/lib/report-storage-activation');
const { LIMITS, evidenceDigest } = require('./storage-dormant-activation');
const { instrumentStorageCaller } = require('./storage-caller-diagnostics');
const HASH = /^[a-f0-9]{64}$(?![\s\S])/;
const ROLES = ['ownerAuthorization', 'ownership', 'access'];
const KINDS = { ownerAuthorization: 'owner_readiness_continuity', ownership: 'ownership_readback', access: 'access_readback' };
const issued = new WeakSet();
const sha = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
function held() { throw new Error('UNTIMED_ACTIVATION_PREPARATION_HELD'); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length) held();
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) held();
  }
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function stageUntimed(input) {
  exact(input, ['binding']);
  evidenceDigest(input.binding); // Reject accessors, proxies and non-JSON values before shared validation.
  validateDormantBinding(input.binding);
  if (input.binding.schemaVersion !== 7 || input.binding.timeoutMs !== LIMITS.operationTimeoutMs) held();
  const raw = JSON.stringify(input.binding), bindingSha256 = sha(raw);
  return freeze({ status: 'untimed_dormant_artifacts_prepared', raw, bindingSha256,
    operationDigest: dormantOperationDigest(bindingSha256),
    transport: encodeStorageBinding(raw, { partSize: 400, format: 'tuple-v1' }), limits: LIMITS,
    providerActions: 0, grantsExecutionAuthority: false });
}
function prepareUntimedActivation(input) {
  exact(input, ['binding', 'bindingSha256', 'receipts', 'readiness']);
  const stage = stageUntimed({ binding: input.binding });
  if (stage.bindingSha256 !== input.bindingSha256) held();
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
      || !Number.isSafeInteger(receipt.observedAt) || receipt.observedAt < 0) held();
    if (!receipt.normalizedFacts || typeof receipt.normalizedFacts !== 'object' || types.isProxy(receipt.normalizedFacts)
      || Object.getPrototypeOf(receipt.normalizedFacts) !== Object.prototype) held();
    const digest = evidenceDigest(receipt), stateSha256 = evidenceDigest(receipt.normalizedFacts);
    if (stateSha256 !== input.binding.capability.evidence[role].digest) held();
    if (role === 'ownerAuthorization' && (!Object.hasOwn(receipt.normalizedFacts, 'standingApprovalSha256')
      || typeof receipt.normalizedFacts.standingApprovalSha256 !== 'string'
      || !HASH.test(receipt.normalizedFacts.standingApprovalSha256))) held();
    evidence[role] = { stateSha256, digest, observedAt: receipt.observedAt };
  }
  const activation = { schemaVersion: 2, bindingSha256: stage.bindingSha256, operationDigest: stage.operationDigest, evidence };
  // The shared validator's explicit clock is unused for schema 7. Zero is not a new observation.
  const checked = activateDormantBinding(input.binding, stage.bindingSha256, activation, 0);
  const command = { profile: 'report_storage_qualification_v1', action: 'qualify_storage', activation };
  const result = freeze({ status: 'untimed_activation_prepared_not_consumed_or_executed', command,
    body: canonicalJson(command), bindingSha256: stage.bindingSha256, operationDigest: stage.operationDigest,
    activationDigest: checked.activationDigest, limits: LIMITS, providerActions: 0, grantsExecutionAuthority: false,
    requiredSequence: ['review_and_publish_exact_caller', 'read_back_source_and_prepare_editor',
      'reconcile_unchanged_scope_target_cost_and_unconsumed_ledger', 'durably_consume_exact_activation',
      'execute_once', 'restore_and_reconcile_without_retry'] });
  issued.add(result);
  return result;
}
function renderUntimedActivationCaller(input) {
  exact(input, ['templateText', 'templateSha256', 'preparedActivation']);
  const { templateText, templateSha256, preparedActivation: prepared } = input;
  if (!issued.has(prepared) || typeof templateText !== 'string' || templateText.length > 65536
    || !/^[\x09\x0a\x20-\x7e]+$(?![\s\S])/.test(templateText) || !templateText.endsWith('\n')
    || typeof templateSha256 !== 'string' || !HASH.test(templateSha256) || sha(templateText) !== templateSha256) held();
  const counts = {}, expected = { __ACTIVATION_COMMAND_JSON__: 1, __OPERATION_DIGEST__: 2,
    __VERIFIED_AT__: 3, __EXPIRES_AT__: 3, __TIMEOUT_MS__: 2 };
  for (const token of templateText.match(/__[A-Z_]+__/g) || []) {
    if (!Object.hasOwn(expected, token)) held();
    counts[token] = (counts[token] || 0) + 1;
  }
  if (!Object.hasOwn(counts, '__TIMEOUT_MS__')) expected.__TIMEOUT_MS__ = 0;
  if (Object.entries(expected).some(([key, count]) => (counts[key] || 0) !== count)) held();
  let text = templateText;
  // Remove only the five reviewed pre-execution/absolute-expiry clauses. Keep
  // dispatch/receipt clocks, response provenance and actual request duration.
  for (const clause of [
    ' && dispatch_at >= __VERIFIED_AT__ && dispatch_at + 1000 + __TIMEOUT_MS__ + 1000 <= __EXPIRES_AT__',
    ' && result.get("observedAt").toLong() >= __VERIFIED_AT__',
    ' && result.get("observedAt").toLong() < __EXPIRES_AT__',
    ' && received_at >= __VERIFIED_AT__', ' && received_at + 1000 <= __EXPIRES_AT__'
  ]) {
    const supported = expected.__TIMEOUT_MS__ === 0 ? clause.replace('__TIMEOUT_MS__', '25000') : clause;
    if (text.split(supported).length !== 2) held();
    text = text.replace(supported, '');
  }
  const replacements = { __ACTIVATION_COMMAND_JSON__: JSON.stringify(prepared.body),
    __OPERATION_DIGEST__: prepared.operationDigest, __TIMEOUT_MS__: String(LIMITS.operationTimeoutMs) };
  text = text.replace(/__[A-Z_]+__/g, token => {
    if (!Object.hasOwn(replacements, token)) held();
    return replacements[token];
  });
  // Full-frame validation also preserves the exact route, Connection, single
  // request, response projection and every remaining acceptance predicate.
  const diagnostic = instrumentStorageCaller({ callerText: text, callerSha256: sha(text) });
  return freeze({ ...diagnostic, templateSha256, operationDigest: prepared.operationDigest,
    bindingSha256: prepared.bindingSha256, activationDigest: prepared.activationDigest });
}
module.exports = { LIMITS, stageUntimed, prepareUntimedActivation, renderUntimedActivationCaller };
