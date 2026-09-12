'use strict';

// Fictional local walkthrough data. These are not exports of accepted records,
// authentic consent/receipts, provider bindings, or deployable configurations.
const SYNTHETIC_NOW = Date.parse('2026-09-09T12:00:00.000Z');
const SOURCE = 'd'.repeat(40);
const CAPTURED = '2026-09-09T11:59:00.000Z';
const SUBMITTED = '2026-09-09T11:50:00.000Z';
const VERIFIED = '2026-09-09T11:45:00.000Z';

function syntheticPreparationInputs() {
  return ['A', 'B'].map((letter, index) => {
    const ids = { leadId: `10000000${index + 1}`, accountId: `20000000${index + 1}`,
      contactId: `30000000${index + 1}`, dealId: `40000000${index + 1}` };
    const row = String(101 + index);
    return {
      classification: 'synthetic-demonstration',
      evidence: {
        capturedAt: CAPTURED, nativeConversion: { ...ids, intakeSubmissionId: `synthetic_journey_${letter}` },
        recordVersions: { account: SUBMITTED, contact: SUBMITTED, deal: SUBMITTED },
        submission: { ROWID: row, SESSION_ROW_ID: String(201 + index), STATUS: 'succeeded',
          LAST_OUTCOME: 'succeeded', SUCCEEDED_AT: SUBMITTED,
          SOURCE_REVISION: SOURCE, SOURCE_ENVIRONMENT: 'development' },
        session: { ROWID: String(201 + index), STATUS: 'submitted', CRM_ACCOUNT_ID: ids.accountId,
          CRM_CONTACT_ID: ids.contactId, CRM_DEAL_ID: ids.dealId,
          VERIFIED_AT: VERIFIED, SUBMITTED_AT: SUBMITTED,
          SOURCE_REVISION: SOURCE, SOURCE_ENVIRONMENT: 'development' },
        proof: { SESSION_ROW_ID: String(201 + index), STATUS: 'consumed', CONSUMED_AT: SUBMITTED,
          VERIFIED_AT: VERIFIED,
          SOURCE_REVISION: SOURCE, SOURCE_ENVIRONMENT: 'development' },
      },
      crm: {
        account: { id: ids.accountId, Modified_Time: SUBMITTED,
          Account_Name: `SYNTHETIC DEMONSTRATION Plumbing ${letter}`,
          Phone: index === 0 ? '+19135550101' : '+13035550102',
          Phone_System_Provider: 'Synthetic PBX - not a verified provider',
          Normal_Business_Hours: index === 0 ? 'Monday-Friday 08:00-17:00' : 'Tuesday-Saturday 09:00-18:00',
          Primary_Service_Area: index === 0 ? 'Lenexa, ZIP 66215' : 'Denver, ZIP 80202',
          Services_Handled: index === 0 ? ['Water Heaters'] : ['Drain Cleaning'] },
        contact: { id: ids.contactId, Modified_Time: SUBMITTED, Account_Name: { id: ids.accountId } },
        deal: { id: ids.dealId, Modified_Time: SUBMITTED,
          Account_Name: { id: ids.accountId }, Contact_Name: { id: ids.contactId },
          Pipeline: 'Revenue Desk Sales', Entry_Offer: 'Free 7-Day Missed-Call',
          Stage: 'Setup and Authorization', Test_Status: 'Not Started', Go_Live_Approval_Status: 'Not Ready',
          Configuration_Version: `form2cfgv1:${row}:${SOURCE}`,
          Intake_Submission_ID: `synthetic_journey_${letter}`, Setup_Access_Status: 'Submitted',
          Setup_Form_Submission_ID: `synthetic_form2_${letter}`, Setup_Form_Version: 'synthetic_v1',
          Setup_Access_Verified_At: VERIFIED, Setup_Form_Submitted_At: SUBMITTED,
          Authorized_Representative_Confirmed: true, Test_Scope_Accepted: true,
          Authority_Confirmed_At: SUBMITTED, Test_Scope_Accepted_At: SUBMITTED,
          Deployment_Record_ID: null, Approved_Deployment_Record_ID: null,
          Approved_Test_Route: index === 0 ? 'After-Hours' : 'After Hours Only', No_Answer_Delay: null,
          Forwarding_Administrator_Name: `SYNTHETIC Administrator ${letter}`,
          Forwarding_Administrator_Mobile: index === 0 ? '+19135550111' : '+13035550112',
          Approved_Fallback_Destination: 'Voicemail', Approved_Fallback_Number: null,
          Rollback_Contact_Name: `SYNTHETIC Rollback ${letter}`,
          Rollback_Contact_Mobile: index === 0 ? '+19135550121' : '+13035550122',
          Urgent_Call_Handling: 'Alert + Capture Callback',
          Existing_Customer_Call_Handling: 'Alert + Capture Callback',
          Alert_Recipient_Name: `SYNTHETIC Recipient ${letter}`,
          Alert_Recipient_Email: `demo-${letter.toLowerCase()}@example.invalid`, Alert_Recipient_Mobile: null },
      },
      review: { clientId: `synthetic_client_${letter}`, deploymentId: `synthetic_deployment_${letter}`,
        notificationRecipientId: `synthetic_recipient_${letter}`, countryCode: 'US',
        timeZone: index === 0 ? 'America/Chicago' : 'America/Denver', dstPolicy: 'iana_time_zone',
        hoursSourceText: index === 0 ? 'Monday-Friday 08:00-17:00' : 'Tuesday-Saturday 09:00-18:00',
        weeklyHours: index === 0
          ? { Monday: '08:00-17:00', Tuesday: '08:00-17:00', Wednesday: '08:00-17:00',
            Thursday: '08:00-17:00', Friday: '08:00-17:00', Saturday: 'Closed', Sunday: 'Closed' }
          : { Monday: 'Closed', Tuesday: '09:00-18:00', Wednesday: '09:00-18:00',
            Thursday: '09:00-18:00', Friday: '09:00-18:00', Saturday: '09:00-18:00', Sunday: 'Closed' },
        hoursExceptions: [{ date: '2026-11-26', hours: 'Closed' }],
        serviceAreaSourceText: index === 0 ? 'Lenexa, ZIP 66215' : 'Denver, ZIP 80202',
        urgentHandlingSourceText: 'Alert + Capture Callback',
        serviceArea: index === 0 ? { cities: ['Lenexa'], zips: ['66215'] }
          : { cities: ['Denver'], zips: ['80202'] },
        unsupportedServices: index === 0 ? ['Septic pumping'] : ['Well drilling'],
        urgentConditions: index === 0 ? ['Caller reports an uncontrolled active water leak']
          : ['Caller reports a sewage backup'],
        callbackExpectation: 'The team will review the details. No callback time, appointment, transfer, or dispatch is guaranteed.',
        rollbackInstructions: 'SYNTHETIC ONLY: disable the fictional forwarding rule and compare the original fictional voicemail handling. Real provider steps remain unverified.',
        rollbackInstructionsVersion: 'synthetic_review_v1' },
    };
  });
}

module.exports = { SYNTHETIC_NOW, syntheticPreparationInputs };
