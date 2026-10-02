'use strict';
const crypto=require('node:crypto');
const {canonicalJson}=require('./facts');
const {validateSnapshot}=require('./report-delivery-control');
const {qualifyReportRecipient}=require('./report-recipient-preflight');
const sha=x=>crypto.createHash('sha256').update(canonicalJson(x)).digest('hex');
function held(){throw Object.assign(new Error('REPORT_DELIVERY_HELD'),{code:'REPORT_DELIVERY_HELD'});}

/** Join the qualified canonical report selection and private recipient
 * attestation with field-selected CRM reads and immutable native conversion.
 * CRM display timestamps/statuses are corroboration, never authorization.
 * readCanonicalSelection must use the existing complete-partition report gate;
 * readRecipientAttestation must read protected explicit per-test selection and
 * current suppression evidence. Neither dependency is accepted from a request.
 */
function createDealReportSnapshotReader({crm,readCanonicalSelection,readRecipientAttestation,
  readNativeConversion,now=Date.now,requireProjection=true}={}) {
  if(typeof requireProjection!=='boolean'||typeof crm?.getReportRecords!=='function'||typeof crm.getReportRequestEvidence!=='function'||![readCanonicalSelection,readRecipientAttestation,
    readNativeConversion,now].every(x=>typeof x==='function'))held();
  return async function readSnapshot({dealId,signal}={}) {
    const active=()=>{if(signal?.aborted)held();};active();
    const selected=await readCanonicalSelection({dealId,signal});active();
    if(selected?.binding?.dealId!==dealId||typeof selected.originalLeadId!=='string')held();
    const native=await readNativeConversion(selected.originalLeadId);active();
    const {deal,contact}=await crm.getReportRecords(dealId,{signal});active();
    const b=selected.binding;
    if(native?.dealId!==dealId||native.accountId!==b.accountId||native.contactId!==b.contactId
      ||native.originalLeadId!==selected.originalLeadId||native.journeyId!==deal.Intake_Submission_ID
      ||deal.Account_Name?.id!==b.accountId||deal.Contact_Name?.id!==b.contactId
      ||contact.id!==b.contactId||contact.Account_Name?.id!==b.accountId
      ||deal.Deployment_Record_ID!==b.deploymentId||deal.Configuration_Version!==b.configurationVersion
      ||deal.Test_Status!=='Completed'||(requireProjection&&deal.Test_Report_Revision!==selected.report?.manifestSha256))held();
    const nativeDigest=sha(Object.fromEntries(['originalLeadId','journeyId','accountId','contactId','dealId','convertedAt']
      .map(k=>[k,native[k]])));
    const recipient=await readRecipientAttestation({binding:b,nativeRelationshipEvidenceSha256:nativeDigest,signal});active();
    if(contact.Email_Opt_Out!==false||(requireProjection&&recipient?.address!==deal.Test_Report_Recipient_Email)||recipient.address!==contact.Email
      ||recipient.contactId!==b.contactId||recipient.address.length>100
      ||(requireProjection&&Date.parse(deal.Test_Report_Recipient_Verified_At)!==recipient.verifiedAt)
      ||recipient.nativeRelationshipEvidenceSha256!==nativeDigest)held();
    const request=await crm.getReportRequestEvidence(selected.originalLeadId,{signal});active();
    const preflight=qualifyReportRecipient({request,contact,native,now:now()});
    if(preflight.consentEvidenceDigest!==recipient.consentEvidenceDigest
      ||preflight.evidenceDigest!==recipient.preflightEvidenceDigest)held();
    const requestFresh=await crm.getReportRequestEvidence(selected.originalLeadId,{signal});active();
    if(canonicalJson(requestFresh)!==canonicalJson(request))held();
    const snapshot={binding:b,nativeRelationshipEvidenceSha256:nativeDigest,report:selected.report,recipient};
    validateSnapshot(snapshot,now());
    // Re-read the CRM cohort after the private attestation read. A changed
    // email/lookup/field projection cannot authorize even one later send.
    const fresh=await crm.getReportRecords(dealId,{signal});active();
    if(canonicalJson(fresh)!==canonicalJson({deal,contact}))held();
    return snapshot;
  };
}
module.exports={createDealReportSnapshotReader};
