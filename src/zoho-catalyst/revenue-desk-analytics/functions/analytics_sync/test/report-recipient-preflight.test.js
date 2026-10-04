'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {qualifyReportRecipient}=require('../lib/report-recipient-preflight');
const {requestEvidence}=require('./helpers/report-recipient-fixture');
const at=1800000000000,native={originalLeadId:'7000000000001',journeyId:'journey',dealId:'7000000000004',accountId:'7000000000002',contactId:'7000000000003',convertedAt:'2026-01-01T00:00:00.000Z'};
function fixture(){const contact={id:'7000000000003',Account_Name:{id:'7000000000002'},Email:'owner@example.invalid',Email_Opt_Out:false};return {request:requestEvidence(native,contact.Email),contact,native:structuredClone(native),now:at};}
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

test('fresh native observations of the same lineage keep recipient evidence stable',async()=>{
 const f=fixture(),conversion=require('./helpers/report-recipient-fixture').observedConversion(f.native,()=>f.now);
 f.native=await conversion.reader.readConversion(f.native.originalLeadId);
 const first=qualifyReportRecipient(f);f.now+=1000;f.native=await conversion.reader.readConversion(f.native.originalLeadId);
 assert.deepEqual(qualifyReportRecipient(f),first);
});

test('every selected relationship field is required and changed valid lineage changes proof',()=>{
 const first=qualifyReportRecipient(fixture());
 for(const key of ['originalLeadId','journeyId','accountId','contactId','dealId','convertedAt']){
  for(const value of [undefined,null,'',{},' ']){const f=fixture();f.native[key]=value;
   assert.throws(()=>qualifyReportRecipient(f),{code:'REPORT_RECIPIENT_PREFLIGHT_HELD'});}
  const f=fixture();f.native[key]=key==='convertedAt'?'2026-01-02T00:00:00.000Z':key==='journeyId'?'different_journey':'7000000000009';
  f.request=requestEvidence(f.native,f.contact.Email);f.contact.id=f.native.contactId;f.contact.Account_Name.id=f.native.accountId;
  assert.notEqual(qualifyReportRecipient(f).evidenceDigest,first.evidenceDigest);
 }
 const f=fixture();f.native.accountId=f.native.contactId;f.request=requestEvidence(f.native,f.contact.Email);f.contact.Account_Name.id=f.native.accountId;
 assert.throws(()=>qualifyReportRecipient(f),{code:'REPORT_RECIPIENT_PREFLIGHT_HELD'});
});
test('invalid native chronology and expired reads still hold through the real adapter',async()=>{
 const f=fixture();let clock=at;const conversion=require('./helpers/report-recipient-fixture').observedConversion(f.native,()=>clock);
 conversion.response.data[0].Modified_Time=new Date(at+1).toISOString();
 await assert.rejects(conversion.reader.readConversion(f.native.originalLeadId),{code:'CONFIGURATION_CONVERSION_INVALID'});
 conversion.response.data[0].Modified_Time=f.native.convertedAt;
 const {createConfigurationConversionReader}=require('../../../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/configuration-conversion-reader');
 const stale=createConfigurationConversionReader({crm:{getNativeConversion:async()=>{clock+=10001;return conversion.response;}},now:()=>clock});
 await assert.rejects(stale.readConversion(f.native.originalLeadId),{code:'CONFIGURATION_CONVERSION_INVALID'});
});
