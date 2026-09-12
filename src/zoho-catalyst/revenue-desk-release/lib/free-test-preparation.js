'use strict';

// Local preparation only: consistency checks cannot authenticate an exported
// receipt, verify telephone ownership, or issue provider/activation authority.
const {
  validateConfiguration,
} = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/validation');
const {
  decodeCrmApprovedTestRoute, COVERAGE_LABEL_TO_MODE,
} = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/contracts');

const CRM_ID = /^[1-9][0-9]{7,29}$/;
const REVISION = /^[a-f0-9]{40}$/;
const MAX_READBACK_AGE_MS = 15 * 60 * 1000;
const WEEKDAYS = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Friday', 'Saturday', 'Sunday']);

class PreparationError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function requireValue(condition, code) {
  if (!condition) throw new PreparationError(code);
}

function text(value, maximum, code) {
  requireValue(typeof value === 'string' && value === value.trim() && value.length > 0
    && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value), code);
  return value;
}

function instant(value, code) {
  requireValue(typeof value === 'string' && Number.isFinite(Date.parse(value)), code);
  return Date.parse(value);
}

function record(value) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype,
    'SUBMITTED_RECORDS_REQUIRED');
  return value;
}

function reviewedList(value, maximum, code) {
  requireValue(Array.isArray(value) && value.length <= maximum, code);
  const result = value.map((item) => text(item, 120, code));
  requireValue(new Set(result).size === result.length, code);
  return result;
}

function usPhone(value, countryCode, code) {
  // US is the only reviewed country context for this local first-client lane.
  // An extension is not an E.164 subscriber number; never strip it silently.
  requireValue(countryCode === 'US', 'PHONE_COUNTRY_UNRESOLVED');
  requireValue(typeof value === 'string' && /^[+0-9(). -]+$/.test(value), code);
  let digits = value.replace(/[(). -]/g, '');
  if (/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits)) digits = `+1${digits}`;
  else if (/^1[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits)) digits = `+${digits}`;
  requireValue(/^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits), code);
  return digits;
}

function reviewedHours(account, review) {
  const hours = text(account.Normal_Business_Hours, 500, 'BUSINESS_HOURS_REVIEW_REQUIRED');
  // This is an explicit operator interpretation tied to the exact submitted
  // text, not a natural-language schedule parser or proof of its correctness.
  requireValue(review.hoursSourceText === hours, 'BUSINESS_HOURS_SOURCE_MISMATCH');
  const weekly = review.weeklyHours;
  requireValue(weekly && typeof weekly === 'object' && !Array.isArray(weekly)
    && Object.keys(weekly).sort().join(',') === [...WEEKDAYS].sort().join(','),
  'WEEKLY_HOURS_REVIEW_REQUIRED');
  const range = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]-(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
  const validHours = (value) => value === 'Closed' || (typeof value === 'string'
    && range.test(value) && value.slice(0, 5) < value.slice(6));
  const weeklyHours = Object.freeze(Object.fromEntries(WEEKDAYS.map((day) => {
    requireValue(validHours(weekly[day]), 'WEEKLY_HOURS_REVIEW_REQUIRED');
    return [day, weekly[day]];
  })));
  const zone = text(review.timeZone, 80, 'TIMEZONE_REVIEW_REQUIRED');
  requireValue(zone.includes('/') && review.dstPolicy === 'iana_time_zone',
    'TIMEZONE_REVIEW_REQUIRED');
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0); }
  catch (_) { throw new PreparationError('TIMEZONE_REVIEW_REQUIRED'); }
  requireValue(Array.isArray(review.hoursExceptions) && review.hoursExceptions.length <= 16,
    'HOURS_EXCEPTIONS_REVIEW_REQUIRED');
  const seen = new Set();
  const exceptions = review.hoursExceptions.map((row) => {
    requireValue(row && typeof row === 'object' && !Array.isArray(row)
      && Object.keys(row).sort().join(',') === 'date,hours', 'HOURS_EXCEPTIONS_REVIEW_REQUIRED');
    requireValue(/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')
      && Number.isFinite(Date.parse(`${row.date}T00:00:00Z`))
      && new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) === row.date
      && !seen.has(row.date), 'HOURS_EXCEPTIONS_REVIEW_REQUIRED');
    seen.add(row.date);
    requireValue(validHours(row.hours), 'HOURS_EXCEPTIONS_REVIEW_REQUIRED');
    return Object.freeze({ date: row.date, hours: row.hours });
  });
  const exceptionText = exceptions.length === 0 ? 'none confirmed'
    : exceptions.map((row) => `${row.date} ${row.hours}`).join('; ');
  const weeklyText = WEEKDAYS.map((day) => `${day} ${weeklyHours[day]}`).join('; ');
  const compiled = `${weeklyText}; Time zone: ${zone} (IANA daylight-saving rules); Exceptions: ${exceptionText}.`;
  text(compiled, 500, 'BUSINESS_HOURS_REVIEW_REQUIRED');
  return { compiled, zone, exceptions, weeklyHours, sourceText: hours };
}

function validateSubmittedContext(input, now) {
  const evidence = record(input.evidence);
  const { account, contact, deal } = record(input.crm);
  [account, contact, deal].forEach(record);
  const conversion = record(evidence.nativeConversion);
  const submission = record(evidence.submission);
  const session = record(evidence.session);
  const proof = record(evidence.proof);
  requireValue(deal.Pipeline === 'Revenue Desk Sales'
    && deal.Entry_Offer === 'Free 7-Day Missed-Call'
    && deal.Stage === 'Setup and Authorization'
    && [null, undefined, '', 'Not Ready', 'Pending Internal Approval'].includes(deal.Go_Live_Approval_Status)
    && [null, undefined, '', 'Not Started', 'Setup Pending'].includes(deal.Test_Status)
    && !deal.Go_Live_Approved_At && !deal.Approved_Configuration_Version
    && !deal.Test_Start_At && !deal.Test_End_At && !deal.Test_End_Reason
    && !deal.Rollback_Completed_At && !deal.Billing_Subscription_ID,
  'FREE_TEST_PREPARATION_STATE_REQUIRED');
  const capturedAt = instant(evidence.capturedAt, 'FRESH_READBACK_REQUIRED');
  requireValue(Number.isSafeInteger(now) && capturedAt <= now
    && now - capturedAt <= MAX_READBACK_AGE_MS, 'FRESH_READBACK_REQUIRED');
  requireValue([conversion.leadId, conversion.accountId, conversion.contactId,
    conversion.dealId].every((id) => typeof id === 'string' && CRM_ID.test(id))
    && new Set([conversion.leadId, conversion.accountId, conversion.contactId,
      conversion.dealId]).size === 4
    && conversion.accountId === account.id && conversion.contactId === contact.id
    && conversion.dealId === deal.id && contact.Account_Name?.id === account.id
    && deal.Account_Name?.id === account.id && deal.Contact_Name?.id === contact.id
    && session.CRM_ACCOUNT_ID === account.id && session.CRM_CONTACT_ID === contact.id
    && session.CRM_DEAL_ID === deal.id
    && conversion.intakeSubmissionId === deal.Intake_Submission_ID,
  'RELATIONSHIP_MISMATCH');
  const versions = record(evidence.recordVersions);
  for (const [key, value] of Object.entries({ account, contact, deal })) {
    requireValue(versions[key] === value.Modified_Time
      && instant(value.Modified_Time, 'RECORD_VERSION_MISMATCH') <= capturedAt,
    'RECORD_VERSION_MISMATCH');
  }
  requireValue(submission.STATUS === 'succeeded' && submission.LAST_OUTCOME === 'succeeded'
    && session.STATUS === 'submitted' && proof.STATUS === 'consumed'
    && /^[1-9][0-9]{0,29}$/.test(String(session.ROWID || ''))
    && String(proof.SESSION_ROW_ID) === String(session.ROWID)
    && String(submission.SESSION_ROW_ID) === String(session.ROWID)
    && /^[1-9][0-9]{0,29}$/.test(String(submission.ROWID || ''))
    && REVISION.test(submission.SOURCE_REVISION || '')
    && [submission, session, proof].every((row) => row.SOURCE_ENVIRONMENT === 'development'
      && row.SOURCE_REVISION === submission.SOURCE_REVISION), 'SUBMISSION_EVIDENCE_INCOMPLETE');
  const times = Object.fromEntries(Object.entries({
    verified: session.VERIFIED_AT, proofVerified: proof.VERIFIED_AT,
    crmVerified: deal.Setup_Access_Verified_At, proofConsumed: proof.CONSUMED_AT,
    crmSubmitted: deal.Setup_Form_Submitted_At, succeeded: submission.SUCCEEDED_AT,
    sessionSubmitted: session.SUBMITTED_AT,
    authority: deal.Authority_Confirmed_At, scope: deal.Test_Scope_Accepted_At,
  }).map(([key, value]) => [key, instant(value, 'SUBMISSION_EVIDENCE_INCOMPLETE')]));
  // CRM DateTime values preserve whole seconds; Catalyst proof/session values
  // preserve milliseconds. Do not reject a valid CRM round trip for that loss.
  const crmSecond = (value) => Math.trunc(value / 1000);
  requireValue(times.verified === times.proofVerified
    && crmSecond(times.verified) === crmSecond(times.crmVerified)
    && times.verified <= times.proofConsumed
    && crmSecond(times.proofConsumed) <= crmSecond(times.crmSubmitted)
    && times.crmSubmitted === times.authority && times.crmSubmitted === times.scope
    && times.crmSubmitted <= times.succeeded && times.succeeded <= times.sessionSubmitted
    && times.sessionSubmitted <= capturedAt, 'SUBMISSION_EVIDENCE_INCOMPLETE');
  requireValue([account, contact, deal].every((value) =>
    crmSecond(Date.parse(value.Modified_Time)) >= crmSecond(times.crmSubmitted)),
  'RECORD_VERSION_MISMATCH');
  requireValue(deal.Configuration_Version
      === `form2cfgv1:${submission.ROWID}:${submission.SOURCE_REVISION}`
    && deal.Setup_Access_Status === 'Submitted'
    && deal.Authorized_Representative_Confirmed === true && deal.Test_Scope_Accepted === true
    && !deal.Deployment_Record_ID && !deal.Approved_Deployment_Record_ID,
  'SUBMITTED_STATE_MISMATCH');
  text(deal.Intake_Submission_ID, 128, 'JOURNEY_REFERENCE_REQUIRED');
  text(deal.Setup_Form_Submission_ID, 100, 'SUBMISSION_EVIDENCE_INCOMPLETE');
  text(deal.Setup_Form_Version, 100, 'SUBMISSION_EVIDENCE_INCOMPLETE');
  return { account, contact, deal };
}

/**
 * Prepare an unapproved in-memory candidate from a supplied private readback.
 * This is not an authenticated evidence reader or a deployment artifact builder.
 * Callers must not print private candidates or use this result as live authority.
 */
function prepareFreeTestConfiguration(input, { now = Date.now() } = {}) {
  const boundary = {
    deploymentAuthorized: false, providerVerified: false,
    evidenceStatus: 'locally_consistent_not_authenticated',
  };
  try {
    record(input);
    requireValue(['synthetic-demonstration', 'private-preparation'].includes(input.classification),
      'PREPARATION_CLASSIFICATION_REQUIRED');
    const { account, deal } = validateSubmittedContext(input, now);
    const review = record(input.review);
    const label = decodeCrmApprovedTestRoute(deal.Approved_Test_Route);
    requireValue(label !== undefined, 'APPROVED_ROUTE_UNRESOLVED');
    // No public authenticated timing-evidence contract exists yet. Even a
    // plausible numeric delay cannot make overflow executable in this bridge.
    requireValue(label === 'After Hours Only', 'PROVIDER_TIMING_UNVERIFIED');
    requireValue(deal.No_Answer_Delay === null || deal.No_Answer_Delay === undefined,
      'AFTER_HOURS_DELAY_CONFLICT');
    const hours = reviewedHours(account, review);
    const country = review.countryCode;
    const mainBusinessNumber = usPhone(account.Phone, country, 'BUSINESS_PHONE_UNRESOLVED');
    const fallback = deal.Approved_Fallback_Number === null
      || deal.Approved_Fallback_Number === undefined || deal.Approved_Fallback_Number === ''
      ? null : usPhone(deal.Approved_Fallback_Number, country, 'FALLBACK_PHONE_UNRESOLVED');
    requireValue(['Existing Office Line', 'On-Call Mobile', 'Voicemail', 'Other']
      .includes(deal.Approved_Fallback_Destination)
      && (deal.Approved_Fallback_Destination === 'Voicemail' || fallback !== null),
    'FALLBACK_REVIEW_REQUIRED');
    requireValue(!deal.Alert_Recipient_Mobile, 'EMAIL_ONLY_RECIPIENT_REQUIRED');
    const services = reviewedList(account.Services_Handled, 30, 'SERVICES_REVIEW_REQUIRED');
    requireValue(services.length > 0 && !services.includes('Other'), 'SERVICES_REVIEW_REQUIRED');
    requireValue(review.serviceAreaSourceText
      === text(account.Primary_Service_Area, 500, 'SERVICE_AREA_SOURCE_REQUIRED'),
    'SERVICE_AREA_SOURCE_MISMATCH');
    requireValue(review.urgentHandlingSourceText
      === text(deal.Urgent_Call_Handling, 500, 'URGENCY_SOURCE_REQUIRED'),
    'URGENCY_SOURCE_MISMATCH');
    const existingCustomerHandling = text(deal.Existing_Customer_Call_Handling, 500,
      'EXISTING_CUSTOMER_HANDLING_REQUIRED');
    // The free-test runtime captures and classifies, then queues an alert. It
    // has no transfer/fallback or notification-suppression policy variable.
    // Do not silently replace an incompatible submitted handling preference.
    requireValue(deal.Urgent_Call_Handling === 'Alert + Capture Callback'
      && existingCustomerHandling === 'Alert + Capture Callback',
    'FREE_TEST_HANDLING_POLICY_UNSUPPORTED');
    const candidate = validateConfiguration({
      clientId: review.clientId, crmDealId: deal.id, deploymentId: review.deploymentId,
      configurationVersion: deal.Configuration_Version, approved: false,
      companyName: account.Account_Name, companyDescription: null,
      businessHours: hours.compiled, coverageMode: COVERAGE_LABEL_TO_MODE.get(label),
      servicesHandled: services,
      unsupportedServices: reviewedList(review.unsupportedServices, 30, 'EXCLUSIONS_REVIEW_REQUIRED'),
      serviceArea: review.serviceArea,
      urgentConditions: reviewedList(review.urgentConditions, 25, 'URGENCY_REVIEW_REQUIRED'),
      callbackExpectation: text(review.callbackExpectation, 300, 'CALLBACK_REVIEW_REQUIRED'),
      notificationRecipient: {
        recipientId: review.notificationRecipientId, approved: false,
        name: deal.Alert_Recipient_Name, channel: 'email', email: deal.Alert_Recipient_Email,
        mobile: null,
      },
      phoneSystemProvider: account.Phone_System_Provider, approvedTestRoute: label, noAnswerDelay: null,
      forwardingAdministratorName: deal.Forwarding_Administrator_Name,
      forwardingAdministratorMobile: usPhone(deal.Forwarding_Administrator_Mobile, country,
        'ADMINISTRATOR_PHONE_UNRESOLVED'),
      approvedFallbackDestination: deal.Approved_Fallback_Destination, approvedFallbackNumber: fallback,
      rollbackContactName: deal.Rollback_Contact_Name,
      rollbackContactMobile: usPhone(deal.Rollback_Contact_Mobile, country, 'ROLLBACK_PHONE_UNRESOLVED'),
      rollbackInstructions: review.rollbackInstructions,
      rollbackInstructionsVersion: review.rollbackInstructionsVersion,
      authorizedRepresentativeConfirmed: deal.Authorized_Representative_Confirmed,
      testScopeAccepted: deal.Test_Scope_Accepted, authorityConfirmedAt: deal.Authority_Confirmed_At,
      setupFormSubmissionId: deal.Setup_Form_Submission_ID, setupFormVersion: deal.Setup_Form_Version,
    });
    const phoneReconciliationFields = [
      ['Account.Phone', account.Phone, mainBusinessNumber],
      ['Deal.Forwarding_Administrator_Mobile', deal.Forwarding_Administrator_Mobile,
        candidate.forwardingAdministratorMobile],
      ['Deal.Rollback_Contact_Mobile', deal.Rollback_Contact_Mobile, candidate.rollbackContactMobile],
      ['Deal.Approved_Fallback_Number', deal.Approved_Fallback_Number || null, fallback],
    ].filter(([, source, normalized]) => source !== normalized).map(([field]) => field);
    return Object.freeze({ ...boundary, classification: input.classification,
      status: 'prepared_local_only', candidate,
      unresolved: Object.freeze(phoneReconciliationFields.length
        ? ['CRM_PHONE_FORMAT_RECONCILIATION_REQUIRED'] : []),
      reviewContext: Object.freeze({ countryCode: country, timeZone: hours.zone,
        dstPolicy: review.dstPolicy, hoursExceptions: Object.freeze(hours.exceptions),
        weeklyHours: hours.weeklyHours, hoursSourceText: hours.sourceText,
        serviceAreaSourceText: review.serviceAreaSourceText,
        urgentHandlingSourceText: review.urgentHandlingSourceText, existingCustomerHandling,
        sourceInterpretationAuthenticated: false,
        phoneReconciliationFields: Object.freeze(phoneReconciliationFields),
        crmPhoneFormattingMatchesCandidate: phoneReconciliationFields.length === 0,
        mainBusinessNumber, numberOwnershipVerified: false, forwardingVerified: false }),
    });
  } catch (error) {
    if (!(error instanceof PreparationError) && error.code !== 'INVALID_SCHEMA') throw error;
    return Object.freeze({ ...boundary, status: 'blocked', candidate: null,
      unresolved: Object.freeze([error instanceof PreparationError
        ? error.code : 'RUNTIME_CONFIGURATION_REVIEW_REQUIRED']), reviewContext: null });
  }
}

module.exports = { MAX_READBACK_AGE_MS, prepareFreeTestConfiguration };
