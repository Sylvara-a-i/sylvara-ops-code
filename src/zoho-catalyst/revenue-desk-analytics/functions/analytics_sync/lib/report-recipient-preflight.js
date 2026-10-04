'use strict';
const crypto=require('node:crypto');
const {canonicalJson}=require('./facts');
const sha=x=>crypto.createHash('sha256').update(canonicalJson(x)).digest('hex');
function held(){throw Object.assign(new Error('REPORT_RECIPIENT_PREFLIGHT_HELD'),{code:'REPORT_RECIPIENT_PREFLIGHT_HELD'});}
function unsubscribed(record){
 return ['Unsubscribed_Mode','Unsubscribed_Time'].some(k=>record?.[k]!==undefined&&record[k]!==null&&record[k]!=='');
}
/** Approved request/setup/follow-up email consent is preflight eligibility,
 * never a claim of comprehensive provider suppression clearance. */
function qualifyReportRecipient({request,contact,native,now}={}){
 const time=x=>{
  if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(x))return NaN;
  const local=x.slice(0,19),localEpoch=Date.parse(local+'.000Z'),epoch=Date.parse(x);
  return Number.isFinite(localEpoch)&&new Date(localEpoch).toISOString()===local+'.000Z'&&Number.isFinite(epoch)?epoch:NaN;
 };
 // Bind only the immutable native relationship. The conversion reader and
 // staging validation independently enforce observation chronology/freshness;
 // a new read's observedAt must not change an otherwise identical selection.
 const fields=['originalLeadId','journeyId','accountId','contactId','dealId','convertedAt'];
 if(!native||fields.some(k=>typeof native[k]!=='string'||native[k].trim().length===0)
  ||new Set([native.originalLeadId,native.accountId,native.contactId,native.dealId]).size!==4)held();
 const relationship=Object.fromEntries(fields.map(k=>[k,native[k]]));
 const consentAt=time(request?.Free_Test_Contact_Consent_At),submittedAt=time(request?.Free_Test_Request_Submitted_At);
 if(!Number.isSafeInteger(now)||!request||!contact||!native||request.id!==native.originalLeadId
  ||request.Converted__s!==true||request.Intake_Submission_ID!==native.journeyId
  ||request.Converted_Account?.id!==native.accountId||request.Converted_Contact?.id!==native.contactId
  ||request.Converted_Deal?.id!==native.dealId||time(request.Converted_Date_Time)!==time(native.convertedAt)
  ||contact.id!==native.contactId||contact.Account_Name?.id!==native.accountId
  ||request.Email!==contact.Email||typeof contact.Email!=='string'||contact.Email.length>100
  ||!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(contact.Email)
  ||request.Email_Opt_Out!==false||contact.Email_Opt_Out!==false||unsubscribed(request)||unsubscribed(contact)
  ||request.Entry_Offer!=='Free 7-Day Missed-Call'||request.Free_Test_Contact_Consent!==true
  ||request.Free_Test_Contact_Consent_Version!=='form1-contact-consent-v1'
  ||request.Intake_Form_Version!=='revenue-leak-test-request-v1'
  ||typeof request.Submission_Channel!=='string'||request.Submission_Channel.trim().length===0
  ||!Number.isFinite(time(native.convertedAt))||!Number.isFinite(time(request.Converted_Date_Time))
  ||!Number.isFinite(consentAt)||!Number.isFinite(submittedAt)||consentAt>submittedAt
  ||submittedAt>time(native.convertedAt)||time(native.convertedAt)>now)held();
 const consentEvidenceDigest=sha({originalLeadId:native.originalLeadId,intakeSubmissionId:native.journeyId,
  address:contact.Email,consentAt,submittedAt,consentVersion:request.Free_Test_Contact_Consent_Version,
  intakeVersion:request.Intake_Form_Version,channel:request.Submission_Channel});
 const evidenceDigest=sha({policy:'request_email_preflight_v1',consentEvidenceDigest,native:relationship,
  leadOptOut:request.Email_Opt_Out,contactOptOut:contact.Email_Opt_Out,
  leadUnsubscribe:[request.Unsubscribed_Mode??null,request.Unsubscribed_Time??null],
  contactUnsubscribe:[contact.Unsubscribed_Mode??null,contact.Unsubscribed_Time??null]});
 return {status:'provider_enforcement_pending',consentEvidenceDigest,evidenceDigest};
}
module.exports={qualifyReportRecipient,unsubscribed};
