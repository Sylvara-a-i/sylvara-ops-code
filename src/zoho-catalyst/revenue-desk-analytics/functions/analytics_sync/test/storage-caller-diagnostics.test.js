'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { instrumentStorageCaller } = require('../../../tools/storage-caller-diagnostics');
const preparer = require('../../../tools/storage-dormant-activation');
const fixture = require('./helpers/storage-caller-fixture');
const { compile, execute } = require('./helpers/storage-caller-deluge-subset');
const { NOW, EXPIRES, SUMMARY, EXPECTED, callerText, sha, responseFixture } = fixture;
const input = { callerText, callerSha256: sha(callerText) };
const rendered = instrumentStorageCaller(input);
const originalScript = compile(callerText), diagnosticScript = compile(rendered.text);
const STAGES = ['diagnostic_unavailable', 'http_status', 'body_unavailable', 'body_empty',
  'body_oversize', 'body_parse', 'acceptance_predicate', 'receipt_second_guard_only'];
const FLAGS = ['responseCaptured', 'receiptClockCaptured', 'bodyTextCaptured', 'bodyParsed', 'resultCaptured',
  'allOtherAcceptanceChecksChecked', 'allOtherAcceptanceChecksPassed',
  'observationNotAfterReceiptFloorChecked', 'observationNotAfterReceiptFloor'];
function change(args, mutate) {
  const envelope = JSON.parse(args.response.responseText);
  mutate(envelope);
  return { ...args, response: { ...args.response, responseText: JSON.stringify(envelope) } };
}
function parity(args, fault) {
  const before = execute(originalScript, args, fault), after = execute(diagnosticScript, args, fault);
  assert.equal(after.output.status, before.output.status);
  assert.deepEqual(after.counts, before.counts);
  if (before.output.status !== 'unknown_no_retry') assert.equal(after.raw, before.raw);
  else {
    assert.equal(after.output.concurrencyProven, false);
    assert.equal(after.output.namedIdentityVerified, false);
    assert.equal(after.output.qualificationAuthority, false);
    assert.equal(after.output.deliveryAuthority, false);
    if (after.output.diagnostic) {
      const diagnostic = after.output.diagnostic;
      assert.equal(diagnostic.schemaVersion, 1);
      assert.ok(STAGES.includes(diagnostic.rejectionStage));
      for (const flag of FLAGS) assert.equal(typeof diagnostic[flag], 'boolean', flag);
      const allowed = ['schemaVersion', 'rejectionStage', ...FLAGS];
      if (Object.hasOwn(diagnostic, 'firstFailedAcceptanceClause')) {
        assert.ok(Number.isInteger(diagnostic.firstFailedAcceptanceClause));
        assert.ok(diagnostic.firstFailedAcceptanceClause >= 1 && diagnostic.firstFailedAcceptanceClause <= 32);
        allowed.push('firstFailedAcceptanceClause');
      }
      assert.deepEqual(Object.keys(diagnostic), allowed);
      assert.ok(after.raw.length < 800);
    }
  }
  return after;
}
const stage = (args, fault) => parity(args, fault).output.diagnostic;

test('generated caller preserves complete acceptance, request, clock and success-summary bytes', () => {
  const acceptance = /\/\/ ACCEPTANCE_PREDICATE\n\t\t\tif\([^\n]+\)/;
  const summary = /\t\t\t\tsummary = Map\(\);\n[\s\S]+?\t\t\t\tresult_message = summary.toString\(\);/;
  const request = /response = invokeurl\n[\s\S]+?\t\t\];/;
  for (const pattern of [acceptance, summary, request]) assert.equal(rendered.text.match(pattern)[0], callerText.match(pattern)[0]);
  assert.equal(fixture.clauses.length, 32);
  assert.equal((rendered.text.match(/\binvokeurl\b/g) || []).length, 1);
  assert.equal((rendered.text.match(/zoho\.currenttime/g) || []).length, 2);
  assert.equal((rendered.text.match(/\.unixEpoch\("UTC"\)/g) || []).length, 2);
  const accepted = parity(responseFixture());
  assert.deepEqual(Object.keys(accepted.output), SUMMARY);
  assert.equal(Object.hasOwn(accepted.output, 'diagnostic'), false);
  assert.deepEqual(accepted.counts, { invocations: 1, clockSamples: 2, epochConversions: 2 });
  assert.equal(rendered.baseCallerSha256, input.callerSha256);
  assert.equal(rendered.sha256, sha(rendered.text));
  assert.equal(rendered.bytes, Buffer.byteLength(rendered.text));
  assert.equal(rendered.grantsExecutionAuthority, false);
  assert.equal(rendered.providerActions, 0);
  assert.equal(rendered.diagnosticSchemaVersion, 1);
  assert.ok(Object.isFrozen(rendered));
});

test('dispatch remains held without an invocation, receipt clock or diagnostic', () => {
  for (const dispatchAt of [NOW - 1, EXPIRES - 26999, 'invalid']) {
    const result = parity({ ...responseFixture(), dispatchAt });
    assert.equal(result.output.status, 'held_not_dispatched');
    assert.deepEqual(result.counts, { invocations: 0, clockSamples: 1, epochConversions: 1 });
  }
});

test('HTTP, missing projection, empty, oversize and malformed bodies have distinct bounded reasons', () => {
  const base = responseFixture();
  const cases = [
    [{ ...base.response, responseCode: 500 }, 'http_status'],
    [{ ...base.response, responseCode: null }, 'http_status'],
    [{ responseCode: 200 }, 'body_empty'],
    [{ responseCode: 200, responseText: null }, 'body_empty'],
    [{ responseCode: 200, responseText: '' }, 'body_empty'],
    [{ responseCode: 200, responseText: 'x'.repeat(4097) }, 'body_oversize'],
    [{ responseCode: 200, responseText: 'x'.repeat(4096) }, 'body_parse'],
    [{ responseCode: 200, responseText: '{invalid' }, 'body_parse']
  ];
  for (const [response, expected] of cases) assert.equal(stage({ ...base, response }).rejectionStage, expected);
  const unavailable = stage(base, (operation, value, key) => {
    if (operation === 'get' && key === 'responseText') throw Error('synthetic projection unavailable');
  });
  assert.equal(unavailable.rejectionStage, 'body_unavailable');
  assert.equal(unavailable.responseCaptured, true);
  assert.equal(unavailable.receiptClockCaptured, true);
  assert.equal(unavailable.bodyTextCaptured, false);
});

test('failure facts distinguish unobserved checks from false checks and conversion exceptions', () => {
  const nullEnvelope = stage({ ...responseFixture(), response: { responseCode: 200, responseText: 'null' } });
  assert.equal(nullEnvelope.rejectionStage, 'diagnostic_unavailable');
  assert.equal(nullEnvelope.bodyParsed, true);
  assert.equal(nullEnvelope.resultCaptured, false);
  assert.equal(nullEnvelope.allOtherAcceptanceChecksChecked, false);
  const nullResult = stage(change(responseFixture(), value => { value.result = null; }));
  assert.equal(nullResult.rejectionStage, 'acceptance_predicate');
  assert.equal(nullResult.firstFailedAcceptanceClause, 3);
  assert.equal(nullResult.resultCaptured, true); // Capture succeeded; shape did not.
  assert.equal(nullResult.allOtherAcceptanceChecksChecked, false);
  assert.equal(nullResult.observationNotAfterReceiptFloorChecked, false);
  const invalidObservation = stage(change(responseFixture(), value => { value.result.observedAt = 'invalid'; }));
  assert.equal(invalidObservation.firstFailedAcceptanceClause, 25);
  assert.equal(invalidObservation.allOtherAcceptanceChecksChecked, false);
  assert.equal(invalidObservation.observationNotAfterReceiptFloorChecked, false);
  const falseObservation = stage(responseFixture(NOW + 2500));
  assert.equal(falseObservation.observationNotAfterReceiptFloorChecked, true);
  assert.equal(falseObservation.observationNotAfterReceiptFloor, false);
  assert.equal(falseObservation.allOtherAcceptanceChecksChecked, true);
  assert.equal(falseObservation.allOtherAcceptanceChecksPassed, true);
});

// Ordered mutation table covers every original clause. Clause 2 stops during
// envelope.get before the predicate; clause 31 follows the stronger combination
// O >= verifiedAt and O <= R (clauses 26/28). Neither has an isolated first failure.
const clauseMutations = [
  [1, args => { args.receivedAt = 1; }, 1],
  [2, args => { args.response.responseText = 'null'; }, null],
  [3, args => change(args, e => { e.result = null; }), 3],
  [4, args => change(args, e => { e.extra = true; }), 4],
  [5, args => change(args, e => { e.ok = false; }), 5],
  [6, args => change(args, e => { e.action = 'other'; }), 6],
  [7, args => change(args, e => { e.result.extra = true; }), 7],
  ...Object.entries(EXPECTED).map(([key, value], index) => [index + 8,
    args => change(args, e => { e.result[key] = typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1 : 'other'; }), index + 8]),
  [22, args => change(args, e => { e.result.operationDigest = 'd'.repeat(64); }), 22],
  [23, args => change(args, e => { e.result.evidenceDigest = null; }), 23],
  [24, args => change(args, e => { e.result.admissionEvidenceDigest = 'invalid'; }), 24],
  [25, args => change(args, e => { e.result.observedAt = 'invalid'; }), 25],
  [26, args => change(args, e => { e.result.observedAt = NOW - 1; }), 26],
  [27, args => change(args, e => { e.result.observedAt = EXPIRES; }), 27],
  [28, args => change(args, e => { e.result.observedAt = NOW + 2001; }), 28],
  [29, args => { args.receivedAt = NOW; return change(args, e => { e.result.observedAt = NOW; }); }, 29],
  [30, args => { args.receivedAt = NOW + 40000; }, 30],
  [31, args => { args.receivedAt = NOW - 1; return change(args, e => { e.result.observedAt = NOW; }); }, 28],
  [32, args => { args.dispatchAt = EXPIRES - 27000; args.receivedAt = EXPIRES; return change(args, e => { e.result.observedAt = EXPIRES - 1; }); }, 32]
];
test('all 32 original acceptance clauses retain rejection and ordered first-failure evidence', () => {
  assert.deepEqual(clauseMutations.map(([ordinal]) => ordinal), Array.from({ length: 32 }, (_, i) => i + 1));
  for (const [ordinal, mutate, first] of clauseMutations) {
    const args = responseFixture(), executed = parity(mutate(args) || args), result = executed.output.diagnostic;
    assert.equal(result.firstFailedAcceptanceClause ?? null, first, 'clause ' + ordinal);
    if (ordinal !== 2) assert.equal(executed.checks[ordinal - 1].passed, false, 'target clause ' + ordinal);
    if (ordinal !== 28) assert.notEqual(result.rejectionStage, 'receipt_second_guard_only', 'clause ' + ordinal);
  }
});

test('other acceptance failures suppress receipt-second-only diagnosis even when they occur later', () => {
  for (const [ordinal, mutate] of clauseMutations) {
    if (ordinal === 28) continue;
    const args = responseFixture(NOW + 2500), altered = mutate(args) || args;
    assert.notEqual(stage(altered).rejectionStage, 'receipt_second_guard_only', 'clause ' + ordinal);
  }
  const laterFailure = stage({ ...responseFixture(NOW + 500), receivedAt: NOW });
  assert.equal(laterFailure.firstFailedAcceptanceClause, 28);
  assert.equal(laterFailure.allOtherAcceptanceChecksPassed, false);
  assert.equal(laterFailure.rejectionStage, 'acceptance_predicate');
});

test('O=R accepts; 1..999 ms remain rejected; O=R+1000 is not diagnosed as floor-only', () => {
  for (const delta of [-1, 0, 1, 499, 500, 999, 1000, 1001]) {
    const output = parity(responseFixture(NOW + 2000 + delta)).output;
    if (delta <= 0) assert.equal(output.status, 'storage_unique_successor_observed');
    else {
      assert.equal(output.status, 'unknown_no_retry');
      assert.equal(output.diagnostic.firstFailedAcceptanceClause, 28);
      assert.equal(output.diagnostic.rejectionStage, delta < 1000 ? 'receipt_second_guard_only' : 'acceptance_predicate');
    }
  }
  assert.match(callerText, /result.get\("observedAt"\).toLong\(\) <= received_at/);
  // The same floor sample hides either a valid observation or one after receipt.
  assert.ok(NOW + 2500 <= NOW + 2900);
  assert.ok(NOW + 2500 > NOW + 2100);
  assert.equal(parity(responseFixture(NOW + 2500)).output.status, 'unknown_no_retry');
});

test('paired synthetic 1490-ms exchanges prove duration cannot identify the rejection', () => {
  for (const [dispatch, observed, receipt, expected] of [
    [NOW + 300, NOW + 1700, NOW + 1790, 'unknown_no_retry'],
    [NOW + 600, NOW + 1999, NOW + 2090, 'storage_unique_successor_observed']
  ]) {
    assert.equal(receipt - dispatch, 1490);
    assert.ok(observed <= receipt);
    const result = parity({ ...responseFixture(observed), dispatchAt: Math.floor(dispatch / 1000) * 1000,
      receivedAt: Math.floor(receipt / 1000) * 1000 });
    assert.equal(result.output.status, expected);
  }
});

test('synthetic timing grid preserves accepted decisions and original summaries', () => {
  for (const delay of [0, 999, 1000, 2000, 39000, 39001, 40000]) {
    for (const offset of [-1000, -1, 0, 1, 999, 1000]) {
      parity({ ...responseFixture(NOW + delay + offset), receivedAt: NOW + delay });
    }
  }
});

test('transport, receipt-clock and accepted-summary failures remain unknown without another call', () => {
  const failures = [
    [(operation) => { if (operation === 'invoke') throw Error('synthetic transport'); }, false, false],
    [(operation, value) => { if (operation === 'clock' && value === 2) throw Error('synthetic clock'); }, true, false],
    [(operation, value) => { if (operation === 'mapString' && value.status === 'storage_unique_successor_observed') throw Error('synthetic serialization'); }, true, true]
  ];
  for (const [fault, responseCaptured, receiptClockCaptured] of failures) {
    const actual = stage(responseFixture(), fault);
    assert.equal(actual.rejectionStage, responseCaptured && !receiptClockCaptured ? 'body_unavailable' : 'diagnostic_unavailable');
    assert.equal(actual.responseCaptured, responseCaptured);
    assert.equal(actual.receiptClockCaptured, receiptClockCaptured);
  }
});

test('diagnostic construction and serialization failure return the exact original unknown', () => {
  for (const fault of [
    (operation, value, key) => { if (operation === 'put' && key === 'rejectionStage') throw Error('synthetic diagnostic failure'); },
    (operation, value) => { if (operation === 'mapString' && value.diagnostic) throw Error('synthetic serialization failure'); },
    (operation, value, key) => { if (operation === 'get' && key === 'responseCode') throw Error('synthetic projection failure'); }
  ]) {
    const args = responseFixture(NOW + 2500), actual = parity(args, fault);
    assert.equal(actual.raw, execute(originalScript, args, fault).raw);
    assert.equal(Object.hasOwn(actual.output, 'diagnostic'), false);
  }
});

test('hostile body fields, error details, digests, timestamps and nested data never appear in rejection', () => {
  const sentinel = 'SYNTHETIC_SECRET_DO_NOT_RETURN';
  const samples = [
    { ...responseFixture(), response: { responseCode: sentinel, responseText: sentinel } },
    { ...responseFixture(), response: { responseCode: 200, responseText: sentinel } },
    change(responseFixture(), e => { e.result.evidenceDigest = sentinel; }),
    change(responseFixture(), e => { e.nested = { secret: sentinel }; }),
    responseFixture(NOW + 2500)
  ];
  for (const args of samples) {
    const actual = parity(args);
    for (const forbidden of [sentinel, fixture.DIGEST, 'b'.repeat(64), String(NOW + 2500), 'synthetic.invalid', 'synthetic_managed']) {
      assert.equal(actual.raw.includes(forbidden), false);
    }
  }
  assert.equal(parity(responseFixture(), () => { throw Error(sentinel); }).raw.includes(sentinel), false);
});

test('unsupported or tampered frames and imitations fail closed without inspecting accessors', () => {
  const mutations = [text => text.replaceAll('\n', '\r\n'), text => text.slice(0, -1), text => '\uFEFF' + text,
    text => text.replace('try\n', 'try \n'), text => text.replace('<= received_at', '<= received_at + 1000'),
    text => text.replace('summary.put("reads",result.get("reads"));', 'summary.put("reads",9);'),
    text => text.replace('response-format:STRING', 'response-format:FILE'), text => text + '// scd_custom\n',
    text => text.replace('"schemaVersion\\":1', '"schemaVersion\\":2')];
  for (const mutate of mutations) {
    const text = mutate(callerText);
    assert.notEqual(text, callerText);
    assert.throws(() => instrumentStorageCaller({ callerText: text, callerSha256: sha(text) }), /STORAGE_CALLER_DIAGNOSTICS_HELD/);
  }
  assert.throws(() => instrumentStorageCaller({ ...input, callerSha256: '0'.repeat(64) }));
  assert.throws(() => instrumentStorageCaller({ ...input, extra: true }));
  assert.throws(() => instrumentStorageCaller({ callerText: rendered.text, callerSha256: rendered.sha256 }));
  assert.throws(() => instrumentStorageCaller({ callerText: fixture.templateText, callerSha256: sha(fixture.templateText) }));
  let accesses = 0;
  const hostile = { get callerText() { accesses++; throw Error('synthetic'); }, callerSha256: input.callerSha256 };
  assert.throws(() => instrumentStorageCaller(hostile));
  assert.throws(() => instrumentStorageCaller(new Proxy(input, { ownKeys() { accesses++; throw Error('synthetic'); } })));
  assert.equal(accesses, 0);
});

function preparedInput() {
  const roles = ['ownerAuthorization', 'ownership', 'access'];
  const facts = { ownerAuthorization: { standingApprovalSha256: 'a'.repeat(64) }, ownership: { synthetic: true }, access: { synthetic: true } };
  const table = (id, name, key) => ({ id, name, schemaSha256: 'c'.repeat(64), uniquenessSha256: 'd'.repeat(64), uniqueField: key, projectionSha256: 'e'.repeat(64) });
  const binding = { schemaVersion: 6, enabled: false, environment: 'development', sourceRevision: 'b'.repeat(40),
    projectId: '101000001', controlHost: 'synthetic.development.catalystserverless.com', tableId: '101000003', nonce: 'f'.repeat(32),
    capability: { region: 'US', origin: 'https://api.catalyst.zoho.com', controllerFunctionId: '101000002', deploymentId: 'synthetic_deployment',
      sdkVersion: '3.4.0', authMode: 'user', authType: 'admin', creatorPolicy: 'observed_consistent_v1',
      tables: { reportRuns: table('101000003', 'ReportRuns', 'IdempotencyKey'), eventReceipts: table('101000004', 'RevenueDeskEventReceipts', 'EVENT_KEY') },
      evidence: Object.fromEntries(roles.map(role => [role, { digest: preparer.evidenceDigest(facts[role]), verifiedAt: 0, expiresAt: 0 }])) },
    verifiedAt: 0, expiresAt: 0, timeoutMs: 25000, singleAdmittedInvocation: true };
  const receipts = Object.fromEntries(roles.map(role => [role, { schemaVersion: 1, role, method: 'independent_current_read',
    reference: 'synthetic-read:' + role, observedAt: NOW - 1000,
    observationKind: { ownerAuthorization: 'owner_readiness_continuity', ownership: 'ownership_readback', access: 'access_readback' }[role], normalizedFacts: facts[role] }]));
  return { templateText: fixture.templateText, templateSha256: sha(fixture.templateText),
    preparedActivation: preparer.prepareActivation({ binding, bindingSha256: preparer.stageDormant({ binding }).bindingSha256,
      expiresAt: EXPIRES, receipts, readiness: { stagedAndReadBack: true, sourceAndTargetUnchanged: true,
        scopeAndCostAuthorized: true, durableConsumptionReady: true } }, { now: NOW }) };
}
test('opt-in activation wrapper preserves the issued activation and cannot accept serialized authority', () => {
  const data = preparedInput(), base = preparer.renderActivationCaller(data);
  const actual = preparer.renderDiagnosticActivationCaller(data);
  assert.equal(actual.text, instrumentStorageCaller({ callerText: base.text, callerSha256: base.sha256 }).text);
  for (const field of ['operationDigest', 'activationDigest', 'templateSha256']) assert.equal(actual[field], base[field]);
  assert.equal(actual.baseCallerSha256, base.sha256);
  assert.equal(actual.providerActions, 0);
  assert.equal(actual.grantsExecutionAuthority, false);
  assert.ok(Object.isFrozen(actual));
  assert.throws(() => preparer.renderDiagnosticActivationCaller({ ...data, preparedActivation: JSON.parse(JSON.stringify(data.preparedActivation)) }));
  assert.throws(() => preparer.renderDiagnosticActivationCaller({ ...data, diagnosticOverride: true }));
});
