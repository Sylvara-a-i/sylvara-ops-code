'use strict';

const { RevenueDeskError, invariant } = require('./errors');
const { keyedDigest } = require('./security');
const { exactKeys, string, e164 } = require('./validation');

const TEMPLATE_VERSION = 'free_test_call_summary_v1';
const HANDOFF_TEMPLATE_VERSION = 'free_test_call_summary_v2';

function validateHandoffPayload(payload) {
  exactKeys(payload, ['notificationPayloadVersion', 'businessName', 'followUpOwner',
    'timeZone', 'callerName', 'callbackNumber', 'callbackNumberConfirmed', 'customerType',
    'cityOrZip', 'issueSummary', 'urgency', 'specificPersonRequested', 'callTimestamp',
    'callOutcome', 'nextAction'], 'notification');
  string(payload.businessName, 'notification.businessName', { maximum: 120 });
  string(payload.followUpOwner, 'notification.followUpOwner', { maximum: 120 });
  string(payload.nextAction, 'notification.nextAction', { maximum: 600 });
  invariant(typeof payload.callbackNumberConfirmed === 'boolean'
    && (payload.callbackNumberConfirmed ? typeof payload.callbackNumber === 'string'
      : payload.callbackNumber === null),
  'INVALID_NOTIFICATION', 'Callback confirmation evidence is inconsistent.');
  if (payload.callbackNumberConfirmed) e164(payload.callbackNumber, 'notification.callbackNumber');
  let validTime = false;
  try {
    validTime = typeof payload.timeZone === 'string' && payload.timeZone.length <= 100
      && new Date(payload.callTimestamp).toISOString() === payload.callTimestamp;
    new Intl.DateTimeFormat('en-US', { timeZone: payload.timeZone }).format(new Date(payload.callTimestamp));
  } catch (_) { validTime = false; }
  invariant(validTime, 'INVALID_NOTIFICATION', 'Call time or timezone is invalid.');
}

function html(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function messageContent(payload) {
  if (payload.notificationPayloadVersion === 2) {
    const localTime = new Intl.DateTimeFormat('en-US', {
      timeZone: payload.timeZone, dateStyle: 'medium', timeStyle: 'long',
    }).format(new Date(payload.callTimestamp));
    const rows = [
      ['Business', payload.businessName], ['Business follow-up owner', payload.followUpOwner],
      ['Caller name', payload.callerName],
      ['Confirmed callback number', payload.callbackNumberConfirmed === true
        ? payload.callbackNumber : 'Unknown — do not infer from caller ID'],
      ['New / existing customer', payload.customerType], ['City / ZIP', payload.cityOrZip],
      ['Issue', payload.issueSummary], ['Urgency', payload.urgency],
      ['Requested person', payload.specificPersonRequested],
      ['Call time', `${localTime} (${payload.timeZone}); UTC: ${payload.callTimestamp}`],
      ['Classification', payload.callOutcome], ['Human next action', payload.nextAction],
    ];
    return `<p>Seven-Day Free Test — Development callback request.</p><table>${rows.map(([label, value]) => (
      `<tr><th align="left">${html(label)}</th><td>${html(value || 'Unknown / not provided')}</td></tr>`
    )).join('')}</table><p>This is a request for human review, not an appointment, dispatch, transfer or guaranteed response. Mail-provider acceptance does not prove inbox delivery, acknowledgment or a completed callback.</p>`;
  }
  const rows = [
    ['Caller Name', payload.callerName], ['Callback Number', payload.callbackNumber],
    ['New / Existing Customer', payload.customerType], ['City / ZIP', payload.cityOrZip],
    ['Issue Summary', payload.issueSummary], ['Routine / Urgent', payload.urgency],
    ['Specific Person Requested', payload.specificPersonRequested],
    ['Call Timestamp', payload.callTimestamp], ['Call Outcome', payload.callOutcome],
  ];
  return `<p>Sylvara Development free-test call summary.</p><table>${rows.map(([label, value]) => (
    `<tr><th align="left">${html(label)}</th><td>${html(value || 'Not provided')}</td></tr>`
  )).join('')}</table><p>No appointment or dispatch has been confirmed.</p>`;
}

class CatalystMailAdapter {
  constructor({ app, config }) {
    invariant(config.environment === 'development'
      && new Set(['dry_run', 'send_development']).has(config.mailMode),
    'PRODUCTION_BLOCKED', 'Catalyst Mail is Development-only.', { httpStatus: 503 });
    invariant(app && typeof app === 'object', 'INVALID_RUNTIME_CONFIGURATION',
      'Catalyst app context is required.', { httpStatus: 503 });
    invariant(typeof config.mailFrom === 'string' && config.mailFrom.includes('@'),
      'INVALID_RUNTIME_CONFIGURATION', 'Verified Catalyst Mail sender is unavailable.', { httpStatus: 503 });
    this.app = app;
    this.config = config;
  }

  prepare({ recipient, payload }) {
    invariant(recipient && recipient.approved === true && recipient.channel === 'email'
      && typeof recipient.email === 'string' && recipient.email.length > 3,
    'NOTIFICATION_DESTINATION_UNAVAILABLE', 'Approved email destination is unavailable.');
    invariant(payload && typeof payload === 'object', 'INVALID_NOTIFICATION',
      'Notification payload is unavailable.');
    if (payload.notificationPayloadVersion === 2) validateHandoffPayload(payload);
    return Object.freeze({
      recipientFingerprint: keyedDigest(this.config.eventSecret, 'free-test-mail-recipient-v1', [recipient.email]),
      recipientEmail: recipient.email,
      templateVersion: payload.notificationPayloadVersion === 2 ? HANDOFF_TEMPLATE_VERSION : TEMPLATE_VERSION,
      payload: Object.freeze({ ...payload }),
    });
  }

  async notify(prepared) {
    invariant(prepared && typeof prepared.recipientEmail === 'string' && prepared.payload,
      'INVALID_NOTIFICATION', 'Prepared notification is unavailable.');
    if (this.config.mailMode === 'dry_run') return Object.freeze({
      status: 'DryRunRecorded', providerCode: 'CATALYST_MAIL_DRY_RUN',
      providerResultReference: null, ambiguous: false,
    });
    // Old outbox evidence is immutable. Do not turn an old, unconfirmed number
    // into a newly sent callback instruction or silently migrate its template.
    if (prepared.templateVersion !== HANDOFF_TEMPLATE_VERSION) return Object.freeze({
      status: 'ReconciliationRequired', providerCode: 'LEGACY_HANDOFF_REVIEW_REQUIRED',
      providerResultReference: null, ambiguous: false,
    });
    let timer;
    let invoked = false;
    try {
      const operation = Promise.resolve().then(() => {
        invoked = true;
        return this.app.email().sendMail({
          from_email: this.config.mailFrom,
          to_email: [prepared.recipientEmail],
          subject: 'Sylvara Development Free Test Call Summary',
          content: messageContent(prepared.payload),
          html_mode: true,
        });
      });
      const response = await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new RevenueDeskError(
            'CATALYST_MAIL_TIMEOUT', 'Catalyst Mail outcome is ambiguous after invocation.',
            { retryable: false, ambiguous: true },
          )), this.config.mailTimeoutMs);
        }),
      ]);
      invariant(response && typeof response === 'object' && !Array.isArray(response)
        && typeof response.isAsync === 'boolean'
        && response.from_email === this.config.mailFrom
        && Array.isArray(response.to_email) && response.to_email.length === 1
        && response.to_email[0] === prepared.recipientEmail
        && response.project_details && ['string', 'number'].includes(typeof response.project_details.id),
      'CATALYST_MAIL_RESPONSE_INVALID', 'Catalyst Mail returned unverifiable delivery evidence.',
      { ambiguous: true });
      const providerResultReference = `mail_${keyedDigest(this.config.eventSecret,
        'free-test-mail-result-v1', [response.project_details.id, response.isAsync,
          response.from_email, response.to_email[0]])}`;
      return Object.freeze({ status: 'Sent', providerCode: 'CATALYST_MAIL_ACCEPTED',
        providerResultReference, ambiguous: false });
    } catch (error) {
      if (error instanceof RevenueDeskError && error.ambiguous) return Object.freeze({
        status: 'Ambiguous', providerCode: error.code, providerResultReference: null, ambiguous: true,
      });
      if (error?.preSend === true && error?.retryable === true) return Object.freeze({
        status: 'RetryRequired', providerCode: 'CATALYST_MAIL_RETRYABLE_REJECTION',
        providerResultReference: null, ambiguous: false,
      });
      if (error?.terminal === true) return Object.freeze({
        status: 'TerminalFailure', providerCode: 'CATALYST_MAIL_TERMINAL_REJECTION',
        providerResultReference: null, ambiguous: false,
      });
      return Object.freeze({
        status: invoked ? 'Ambiguous' : 'RetryRequired',
        providerCode: invoked ? 'CATALYST_MAIL_UNCLASSIFIED_AFTER_INVOKE' : 'CATALYST_MAIL_PRE_INVOKE_FAILURE',
        providerResultReference: null, ambiguous: invoked,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { CatalystMailAdapter, messageContent, TEMPLATE_VERSION, HANDOFF_TEMPLATE_VERSION };
