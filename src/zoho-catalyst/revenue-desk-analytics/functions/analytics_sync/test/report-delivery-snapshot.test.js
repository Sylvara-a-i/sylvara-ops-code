'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDealReportSnapshotReader}=require('../lib/report-delivery-snapshot');
const {canonicalJson}=require('../lib/facts');const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 const at=1800000000000,native={originalLeadId:'7000000000001',journeyId:'journey',accountId:'7000000000002',contactId:'7000000000003',dealId:'7000000000004',convertedAt:'2026-01-01T00:00:00.000Z'};
 const digest=sha(canonicalJson(native));
 const selected={originalLeadId:'7000000000001',binding:{clientId:'client',deploymentId:'deployment',dealId:'7000000000004',accountId:'7000000000002',contactId:'7000000000003',configurationVersion:'v1',periodStart:'2027-01-01',periodEnd:'2027-01-07'},report:{completed:true,fresh:true,validated:true,generationKey:sha('pair'),manifestSha256:sha('manifest'),sourceRevisionDigest:sha('source'),summary:{role:'summary',generationKey:sha('summary'),documentSha256:sha('PDF'),privateReceiptKey:sha('receipt')}}};
 const recipient={contactId:'7000000000003',address:'owner@example.com',explicitlySelected:true,verified:true,eligible:true,suppressed:null,suppressionStatus:'provider_enforcement_pending',consentEvidenceDigest:'a'.repeat(64),preflightEvidenceDigest:'b'.repeat(64),verificationDigest:sha('recipient'),nativeRelationshipEvidenceSha256:digest,verifiedAt:at-1000,expiresAt:at+60000};
 const records={deal:{id:'7000000000004',Intake_Submission_ID:'journey',Account_Name:{id:'7000000000002'},Contact_Name:{id:'7000000000003'},Deployment_Record_ID:'deployment',Configuration_Version:'v1',Test_Status:'Completed',Test_Report_Revision:sha('manifest'),Test_Report_Recipient_Email:'owner@example.com',Email_Opt_Out:false,Test_Report_Recipient_Verified_At:new Date(at-1000).toISOString()},contact:{id:'7000000000003',Account_Name:{id:'7000000000002'},Email:'owner@example.com',Email_Opt_Out:false}};
 const request=require('./helpers/report-recipient-fixture').requestEvidence(native,records.contact.Email);
 const preflight=require('../lib/report-recipient-preflight').qualifyReportRecipient({request,contact:records.contact,native,now:at});
 recipient.consentEvidenceDigest=preflight.consentEvidenceDigest;recipient.preflightEvidenceDigest=preflight.evidenceDigest;
 const options={crm:{getReportRecords:async()=>structuredClone(records),getReportRequestEvidence:async()=>structuredClone(request)},readCanonicalSelection:async()=>structuredClone(selected),readRecipientAttestation:async()=>structuredClone(recipient),readNativeConversion:async()=>structuredClone(native),now:()=>at};
 return {records,native,selected,recipient,request,options,read:()=>createDealReportSnapshotReader(options)({dealId:'7000000000004'})};
}
test('field-selected Deal/Contact plus native lineage and private attestation bind exact test recipient',async()=>{
 const f=fixture(),result=await f.read();assert.equal(result.recipient.address,'owner@example.com');assert.equal(result.binding.deploymentId,'deployment');
});
test('mutable lookup, contact email, revision and display verification time cannot replace canonical evidence',async()=>{
 for(const change of [f=>f.native.contactId='foreign',f=>f.records.contact.Email='changed@example.com',f=>f.records.deal.Test_Report_Revision=sha('old'),f=>f.recipient.verified=false,f=>f.records.deal.Test_Report_Recipient_Verified_At=null,f=>f.records.deal.Test_Status='Stopped']){
  const f=fixture();change(f);await assert.rejects(f.read());
 }
});
test('CRM cohort drift during attestation read holds before control claims',async()=>{
 const f=fixture();f.options.readRecipientAttestation=async()=>{f.records.deal.Test_Report_Recipient_Email='changed@example.com';return f.recipient;};await assert.rejects(f.read());
});
test('missing report recipient never falls back to alert/signer/Account email',async()=>{
 const f=fixture();delete f.records.deal.Test_Report_Recipient_Email;f.records.deal.Alert_Recipient_Email='owner@example.com';await assert.rejects(f.read());
});

test('request consent provenance, original address and current unsubscribe contradictions hold',async()=>{
 for(const change of [f=>f.request.Free_Test_Contact_Consent=false,f=>f.request.Free_Test_Contact_Consent_Version='unknown',
  f=>f.request.Email='other@example.com',f=>f.request.Email_Opt_Out=true,f=>f.request.Unsubscribed_Mode='Manual',
  f=>f.records.contact.Unsubscribed_Time='2026-01-01T00:00:00Z',f=>f.request.Converted_Contact.id='foreign',
  f=>f.request.Free_Test_Contact_Consent_At='2028-01-01T00:00:00Z']){
  const f=fixture();change(f);await assert.rejects(f.read());
 }
 const f=fixture();f.recipient.suppressed=false;delete f.recipient.suppressionStatus;await assert.rejects(f.read());
});

test('later fresh conversion observation accepts the stored recipient proof until expiry',async()=>{
 const f=fixture();let clock=1800000000000;
 const conversion=require('./helpers/report-recipient-fixture').observedConversion(f.native,()=>clock);
 f.native=await conversion.reader.readConversion(f.native.originalLeadId);
 f.recipient.preflightEvidenceDigest=require('../lib/report-recipient-preflight').qualifyReportRecipient({request:f.request,contact:f.records.contact,native:f.native,now:1800000000000}).evidenceDigest;
 clock+=1000;f.options.now=()=>clock;f.options.readNativeConversion=()=>conversion.reader.readConversion(f.native.originalLeadId);
 await f.read();f.options.now=()=>f.recipient.expiresAt;await assert.rejects(f.read());
});

test('internally consistent changed lineage cannot reuse the stored relationship proof',async()=>{
 for(const key of ['originalLeadId','journeyId','accountId','contactId','dealId','convertedAt']){
  const f=fixture();f.native[key]=key==='convertedAt'?'2026-01-02T00:00:00.000Z':key==='journeyId'?'different_journey':'7000000000009';
  f.request=require('./helpers/report-recipient-fixture').requestEvidence(f.native,f.records.contact.Email);
  await assert.rejects(f.read());
 }
 const f=fixture();f.request.Free_Test_Contact_Consent_At='2025-01-01T00:00:00.001Z';await assert.rejects(f.read());
});
