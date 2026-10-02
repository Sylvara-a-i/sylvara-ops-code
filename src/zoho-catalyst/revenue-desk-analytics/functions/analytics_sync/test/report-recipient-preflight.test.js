'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {qualifyReportRecipient}=require('../lib/report-recipient-preflight');
const {requestEvidence}=require('./helpers/report-recipient-fixture');
const at=1800000000000,native={originalLeadId:'lead',journeyId:'journey',dealId:'deal',accountId:'account',contactId:'contact',convertedAt:'2026-01-01T00:00:00.000Z'};
function fixture(){const contact={id:'contact',Account_Name:{id:'account'},Email:'owner@example.invalid',Email_Opt_Out:false};return {request:requestEvidence(native,contact.Email),contact,native:structuredClone(native),now:at};}
test('request/follow-up consent binds exact native recipient without provider-clear assertion',()=>{
 const f=fixture(),proof=qualifyReportRecipient(f);assert.equal(proof.status,'provider_enforcement_pending');
 assert.match(proof.consentEvidenceDigest,/^[a-f0-9]{64}$/);assert.match(proof.evidenceDigest,/^[a-f0-9]{64}$/);
 assert.equal('suppressed' in proof,false);assert.equal('clear' in proof,false);
 f.request.Converted_Date_Time='2025-12-31T18:00:00-06:00';assert.deepEqual(qualifyReportRecipient(f),proof);
});
test('missing/withdrawn consent, wrong test or address, unsubscribe and chronology cannot qualify',()=>{
 for(const change of [f=>delete f.request.Free_Test_Contact_Consent,f=>f.request.Free_Test_Contact_Consent='true',
  f=>f.request.Free_Test_Contact_Consent_Version='unknown',f=>f.request.Intake_Form_Version='unknown',
  f=>f.request.Intake_Submission_ID='foreign',f=>f.request.Converted_Deal.id='foreign',
  f=>f.request.Email='other@example.invalid',f=>f.contact.Email_Opt_Out=null,f=>f.request.Email_Opt_Out=true,
  f=>f.request.Unsubscribed_Mode='Manual',f=>f.contact.Unsubscribed_Time='2025-01-01T00:00:00Z',
  f=>f.request.Free_Test_Contact_Consent_At='2028-01-01T00:00:00Z',f=>f.request.Free_Test_Request_Submitted_At='bad',
  f=>f.request.Submission_Channel='',f=>f.request.Free_Test_Contact_Consent_At='2025-02-30T00:00:00Z',f=>f.native.convertedAt='bad']){const f=fixture();change(f);assert.throws(()=>qualifyReportRecipient(f));}
});
