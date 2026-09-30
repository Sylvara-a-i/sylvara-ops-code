'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDealReportSnapshotReader}=require('../lib/report-delivery-snapshot');
const {canonicalJson}=require('../lib/facts');const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 const at=1800000000000,native={originalLeadId:'lead',journeyId:'journey',accountId:'account',contactId:'contact',dealId:'deal',convertedAt:'2026-01-01T00:00:00.000Z'};
 const digest=sha(canonicalJson(native));
 const selected={originalLeadId:'lead',binding:{clientId:'client',deploymentId:'deployment',dealId:'deal',accountId:'account',contactId:'contact',configurationVersion:'v1',periodStart:'2027-01-01',periodEnd:'2027-01-07'},report:{completed:true,fresh:true,validated:true,generationKey:sha('pair'),manifestSha256:sha('manifest'),sourceRevisionDigest:sha('source'),summary:{role:'summary',generationKey:sha('summary'),documentSha256:sha('PDF'),privateReceiptKey:sha('receipt')}}};
 const recipient={contactId:'contact',address:'owner@example.com',explicitlySelected:true,verified:true,eligible:true,suppressed:false,verificationDigest:sha('recipient'),nativeRelationshipEvidenceSha256:digest,verifiedAt:at-1000,expiresAt:at+60000};
 const records={deal:{id:'deal',Intake_Submission_ID:'journey',Account_Name:{id:'account'},Contact_Name:{id:'contact'},Deployment_Record_ID:'deployment',Configuration_Version:'v1',Test_Status:'Completed',Test_Report_Revision:sha('manifest'),Test_Report_Recipient_Email:'owner@example.com',Test_Report_Recipient_Verified_At:new Date(at-1000).toISOString()},contact:{id:'contact',Account_Name:{id:'account'},Email:'owner@example.com'}};
 const options={crm:{getReportRecords:async()=>structuredClone(records)},readCanonicalSelection:async()=>structuredClone(selected),readRecipientAttestation:async()=>structuredClone(recipient),readNativeConversion:async()=>structuredClone(native),now:()=>at};
 return {records,native,selected,recipient,options,read:()=>createDealReportSnapshotReader(options)({dealId:'deal'})};
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
