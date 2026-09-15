'use strict';

// Synthetic selected-field readback only; no fixture is live metadata evidence.
function crmBaselineFixture() {
  const syntheticId = (suffix) => `9${'0'.repeat(14)}${suffix}`;
  const relationships = {
    leadId: syntheticId(1), accountId: syntheticId(2),
    contactId: syntheticId(3), dealId: syntheticId(4),
    intakeSubmissionId: 'synthetic-intake-v1',
  };
  const context = {
    clientKey: 'a'.repeat(64), deploymentKey: 'b'.repeat(64),
    configurationVersionId: 'synthetic-config-row-1', configurationVersion: 'synthetic-config-v1',
    environment: 'development', relationships,
    crmModifiedAt: '2026-09-01T06:50:00-05:00', testStartedAt: '2026-09-01T12:00:00.000Z',
    approvedTestRoute: 'After Hours Only',
    sourcePeriod: { start: '2026-08-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' },
    evidenceClass: 'customer_supplied_estimate', currency: 'USD',
  };
  const evidence = {
    source: 'crm_selected_field_readback', clientKey: context.clientKey,
    deploymentKey: context.deploymentKey, configurationVersionId: context.configurationVersionId,
    configurationVersion: context.configurationVersion,
    environment: context.environment, relationships: { ...relationships },
    crmModifiedAt: context.crmModifiedAt, readAt: '2026-09-01T11:55:00.000Z',
    capturedAt: '2026-09-01T11:56:00.000Z', sourcePeriod: { ...context.sourcePeriod },
    evidenceClass: context.evidenceClass,
  };
  const deal = {
    id: relationships.dealId, Account_Name: { id: relationships.accountId },
    Contact_Name: { id: relationships.contactId }, Modified_Time: context.crmModifiedAt,
    Configuration_Version: context.configurationVersion,
    Intake_Submission_ID: relationships.intakeSubmissionId, Approved_Test_Route: 'After Hours Only',
    Current_Call_Handling: 'Voicemail', Monthly_Inbound_Calls: 140,
    Monthly_Inbound_Call_Band: '100-249', After_Hours_Call_Band: '25-49',
    After_Hours_Call_Share: 20.25, Estimated_Unanswered_Call_Rate: 12.5, Average_Job_Value: 350.25,
    Average_Job_Value_Band: '$250-$499', Current_Monthly_Answering_Cost: 0,
  };
  const choices = {
    Approved_Test_Route: ['-None-', 'After Hours Only', 'No Answer / Overflow Only',
      'After Hours + Overflow', 'After-Hours', 'No-Answer/Overflow', 'Both'],
    Current_Call_Handling: ['-None-', 'Voicemail', 'Unknown'],
    Monthly_Inbound_Call_Band: ['-None-', '100-249', 'Under 20', 'Unknown'],
    After_Hours_Call_Band: ['-None-', 'None', '25-49', 'Unknown'],
    Average_Job_Value_Band: ['-None-', '$250-$499', 'Under $250', 'Unknown'],
  };
  const fields = Object.fromEntries(Object.keys(deal).filter((field) => field in choices).map((field) => [
    field, { apiName: field, dataType: 'picklist', active: true, activeValues: choices[field] },
  ]));
  for (const [field, dataType] of [
    ['Monthly_Inbound_Calls', 'integer'], ['After_Hours_Call_Share', 'percent'],
    ['Estimated_Unanswered_Call_Rate', 'percent'],
    ['Average_Job_Value', 'currency'], ['Current_Monthly_Answering_Cost', 'currency'],
  ]) fields[field] = { apiName: field, dataType, active: true };
  return { deal, context, evidence,
    metadata: { source: 'crm_field_metadata_readback', observedAt: '2026-09-01T11:54:00.000Z', fields } };
}

module.exports = { crmBaselineFixture };
