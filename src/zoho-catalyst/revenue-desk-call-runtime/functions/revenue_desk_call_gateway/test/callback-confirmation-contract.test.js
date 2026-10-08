'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {extractAnalysis}=require('../lib/analysis');
const callback=require('../../../../../retell/agents/7-day-free-test/contracts/callback-confirmation-contract.json');
const canonical=require('../contracts/revenue-desk-call-contract.json');
const event=(confirmed,number='+12025550123')=>({from_number:'+12025550999',call_analysis:{custom_analysis_data:{outcome:'potential_job',coverage_trigger:'AfterHours',customer_type:'new',urgency:'routine',sensitive_data_detected:false,callback_number:number,...(confirmed===undefined?{}:{callback_number_confirmed:confirmed})}}});
test('callback contract aligns optional boolean/null semantics without changing required resolver/event schemas',()=>{
 assert.equal(callback.post_call_field.name,'callback_number_confirmed');assert.equal(callback.post_call_field.type,canonical.optional_handoff_analysis.callback_number_confirmed.type);
 assert.equal(callback.post_call_field.required,false);assert.equal(callback.post_call_field.format_or_caller_id_is_confirmation,false);
 assert.equal(callback.runtime_authority,false);assert.equal(callback.deployment_authorized,false);
 assert.deepEqual(callback.status_alignment.confirmed_usable_requires,['usable_final_caller_stated_number','explicit_confirmation_of_final_number','callback_number_confirmed_exactly_true']);
 assert.equal(callback.status_alignment.backend_retains_number_only_for_exact_true,true);
});
test('missing/null/false confirmation never makes formatted extraction or caller ID actionable',()=>{
 for(const value of [undefined,null,false]){
  const result=extractAnalysis(event(value));assert.equal(result.callbackNumber,null);assert.equal(result.callbackNumberConfirmed,value===false?false:null);
 }
});
test('only explicit boolean true retains the final extracted number, never caller ID',()=>{
 const result=extractAnalysis(event(true));assert.equal(result.callbackNumber,'+12025550123');assert.equal(result.callbackNumberConfirmed,true);
 assert.notEqual(result.callbackNumber,event(true).from_number);
});
test('string/numeric/truthy confirmation and true without a usable final number fail closed',()=>{
 for(const value of ['true','false',1,0,{},[]])assert.throws(()=>extractAnalysis(event(value)));
 for(const value of [null,'','2025550123','unconfirmed'])assert.throws(()=>extractAnalysis(event(true,value)));
});
test('a corrected number without fresh explicit confirmation is withheld',()=>{
 assert.equal(extractAnalysis(event(true)).callbackNumber,'+12025550123');
 assert.equal(extractAnalysis(event(null,'+12025550124')).callbackNumber,null);
 assert.equal(extractAnalysis(event(true,'+12025550124')).callbackNumber,'+12025550124');
});
test('sensitive-data minimization overrides otherwise confirmed callback evidence',()=>{
 const e=event(true);e.call_analysis.custom_analysis_data.sensitive_data_detected=true;
 const result=extractAnalysis(e);assert.equal(result.callbackNumber,null);assert.equal(result.callbackNumberConfirmed,null);
 assert.equal(result.sensitiveDataMinimized,true);
 assert.deepEqual(callback.precedence,['immediate_safety_end','consent_withdrawal_end','sensitive_data_minimization','ordinary_callback_confirmation']);
 assert.equal(callback.collection.read_back_alternate_number_once,true);assert.equal(callback.collection.maximum_clarifications,1);
});

// These aliases are test-only NANP examples, never caller ID or live contact data.
const acceptance = require('../../../../../retell/agents/7-day-free-test/tests/fixtures/acceptance-cases.json');
const conversation = require('../../../../../retell/agents/7-day-free-test/contracts/conversation-contract.json');
const { makeNotificationPayload } = require('../lib/analysis');
const { messageContent } = require('../lib/catalyst-mail');
const callbackExamples = {
  synthetic_callback_a: '+12025550123',
  synthetic_callback_b: '+12025550124',
  synthetic_callback_corrected: '+12025550125',
  not_provided: null,
};
const callbackCases = acceptance.cases.filter((row) =>
  Object.hasOwn(row.expected_extracted_fields, 'callback_number')
  || Object.hasOwn(row.expected_analytics_behavior, 'callback_available')
  || Object.hasOwn(row.expected_notification_behavior, 'callback_available'));

function acceptanceEvent(row) {
  const fields = row.expected_extracted_fields;
  assert.ok(Object.hasOwn(callbackExamples, fields.callback_number), row.case_id);
  return {
    from_number: '+12025550999',
    call_analysis: { custom_analysis_data: {
      coverage_trigger: 'AfterHours', customer_type: 'unknown', urgency: 'routine',
      sensitive_data_detected: false,
      ...fields,
      callback_number: callbackExamples[fields.callback_number],
    } },
  };
}

function handoff(analysis) {
  return makeNotificationPayload({
    ...analysis, notificationPayloadVersion: 2, startedAt: '2026-01-01T00:00:00.000Z',
  }, {
    companyName: 'Synthetic Plumbing', notificationRecipient: { name: 'Synthetic Team' },
    notificationHandoff: { timeZone: 'UTC' },
  });
}

function assertAcceptanceCallback(row) {
  const fields = row.expected_extracted_fields;
  const expected = row.expected_analytics_behavior.callback_available;
  assert.equal(typeof expected, 'boolean', row.case_id);
  assert.equal(row.expected_notification_behavior.callback_available, expected, row.case_id);
  if (expected) assert.equal(fields.callback_number_confirmed, true, row.case_id);
  const analysis = extractAnalysis(acceptanceEvent(row));
  const payload = handoff(analysis);
  assert.equal(analysis.callbackNumberConfirmed, fields.callback_number_confirmed, row.case_id);
  assert.equal(analysis.callbackNumber !== null, expected, row.case_id);
  assert.equal(payload.callbackNumberConfirmed, expected, row.case_id);
  assert.equal(payload.callbackNumber, analysis.callbackNumber, row.case_id);
  if (expected) {
    assert.equal(analysis.callbackNumber, callbackExamples[fields.callback_number], row.case_id);
    assert.ok(messageContent(payload).includes(analysis.callbackNumber), row.case_id);
  } else {
    assert.equal(payload.callbackNumber, null, row.case_id);
    assert.match(messageContent(payload), /Unknown \u2014 do not infer from caller ID/);
  }
  assert.ok(!messageContent(payload).includes('+12025550999'), row.case_id);
}

test('conversation requires explicit confirmation of every final callback number', () => {
  assert.equal(conversation.conversation_style.explicitly_confirm_final_callback_number, true);
  assert.equal(conversation.minimum_intake.find((field) => field.key === 'callback_number').collection,
    'request_once_and_explicitly_confirm_final_number');
  assert.equal(callback.collection.require_confirmation_after_correction, true);
});

test('acceptance callback expectations execute actual extraction and notification rendering offline', () => {
  assert.ok(callbackCases.some((row) => row.case_id === 'ft_013'));
  assert.ok(callbackCases.some((row) => row.case_id === 'ft_014'));
  for (const row of callbackCases) assertAcceptanceCallback(row);
});

test('every callback-available fixture rejects missing, non-true and malformed confirmation', () => {
  for (const row of callbackCases.filter((item) => item.expected_analytics_behavior.callback_available)) {
    for (const value of [undefined, null, false, 'true', 'false', 1, 0, {}, []]) {
      const mutated = structuredClone(row);
      if (value === undefined) delete mutated.expected_extracted_fields.callback_number_confirmed;
      else mutated.expected_extracted_fields.callback_number_confirmed = value;
      assert.throws(() => assertAcceptanceCallback(mutated), { code: 'ERR_ASSERTION' });
      const input = acceptanceEvent(mutated);
      if (value === undefined || value === null || value === false) {
        const analysis = extractAnalysis(input);
        const payload = handoff(analysis);
        assert.equal(analysis.callbackNumber, null);
        assert.equal(payload.callbackNumberConfirmed, false);
        assert.equal(payload.callbackNumber, null);
        const content = messageContent(payload);
        assert.match(content, /Unknown \u2014 do not infer from caller ID/);
        assert.ok(!content.includes(callbackExamples[row.expected_extracted_fields.callback_number]));
        assert.ok(!content.includes(input.from_number));
      } else {
        assert.throws(() => extractAnalysis(input));
      }
    }
  }
});

test('corrected callback acceptance requires fresh final confirmation and never exposes the old number', () => {
  const row = callbackCases.find((item) => item.case_id === 'ft_013');
  assert.ok(row.inputs.caller_sequence.includes('explicit_final_callback_confirmation'));
  const payload = handoff(extractAnalysis(acceptanceEvent(row)));
  assert.equal(payload.callbackNumber, callbackExamples.synthetic_callback_corrected);
  assert.ok(!messageContent(payload).includes(callbackExamples.synthetic_callback_a));
});

test('acceptance extraction still rejects outcome, urgency and opportunity contradictions', () => {
  for (const requestKind of [undefined, 'unknown', 'new_service_request', 'existing_job_follow_up']) {
    const existing = structuredClone(callbackCases.find((row) => row.case_id === 'ft_002'));
    existing.expected_extracted_fields.bookable_opportunity = true;
    if (requestKind !== undefined) existing.expected_extracted_fields.request_kind = requestKind;
    assert.throws(() => extractAnalysis(acceptanceEvent(existing)), { code: 'INVALID_ANALYSIS' });
  }
  const urgent = structuredClone(callbackCases.find((row) => row.case_id === 'ft_003'));
  urgent.expected_extracted_fields.outcome = 'potential_job';
  assert.throws(() => extractAnalysis(acceptanceEvent(urgent)), { code: 'INVALID_ANALYSIS' });
});
