'use strict';
function requestEvidence(native,email){return {id:native.originalLeadId,Converted__s:true,Intake_Submission_ID:native.journeyId,
 Converted_Account:{id:native.accountId},Converted_Contact:{id:native.contactId},Converted_Deal:{id:native.dealId},
 Converted_Date_Time:native.convertedAt,Email:email,Email_Opt_Out:false,Unsubscribed_Mode:null,Unsubscribed_Time:null,
 Entry_Offer:'Free 7-Day Missed-Call',Free_Test_Contact_Consent:true,Free_Test_Contact_Consent_At:'2025-01-01T00:00:00.000Z',
 Free_Test_Request_Submitted_At:'2025-01-01T00:00:01.000Z',Free_Test_Contact_Consent_Version:'form1-contact-consent-v1',
 Intake_Form_Version:'revenue-leak-test-request-v1',Submission_Channel:'CRM Assisted'};}
// Real native adapter over synthetic provider-shaped evidence; no transport.
function observedConversion(native,now){
 const {createConfigurationConversionReader}=require('../../../../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/configuration-conversion-reader');
 const response={data:[{id:native.originalLeadId,Intake_Submission_ID:native.journeyId,
  Converted__s:true,Converted_Date_Time:native.convertedAt,Modified_Time:native.convertedAt,
  Converted_Account:{id:native.accountId},Converted_Contact:{id:native.contactId},Converted_Deal:{id:native.dealId}}],
  info:{count:1,more_records:false}};
 return {response,reader:createConfigurationConversionReader({crm:{getNativeConversion:async()=>structuredClone(response)},now})};
}
module.exports={requestEvidence,observedConversion};
