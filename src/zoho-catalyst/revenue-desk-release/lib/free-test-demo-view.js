'use strict';

const { createHash } = require('node:crypto');

function escape(value) {
  return String(value ?? 'Unknown / not established').replace(/[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

const FIELDS = [
  ['callsCaptured', 'Unique connected calls'],
  ['qualifiedOpportunities', 'Potential opportunities — not booked jobs'],
  ['existingCustomerCalls', 'Existing customers'],
  ['outOfAreaOrWrongFitCalls', 'Outside area / unsupported work'],
  ['urgentRequests', 'Urgent cases'],
  ['bookableOpportunities', 'Potentially bookable — not an appointment'],
  ['officeFollowUpCalls', 'Office follow-up needed'],
  ['observedWorkflowFailures', 'Observed workflow failures'],
  ['actualAverageCallDurationSeconds', 'Average connected duration (seconds)'],
  ['inFlightOvershoot', 'Already-admitted calls above the limit'],
];

function rows(values) {
  return values.map(([key, value]) => `<tr><th scope="row">${escape(key)}</th><td>${escape(value)}</td></tr>`).join('');
}

function handoffView(rehearsal) {
  if (!rehearsal) return '';
  const labels = { accepted: 'Fake delivery accepted', definite_rejection: 'Definite rejection — retry budget exhausted',
    ambiguous: 'Unknown delivery — reconciliation required' };
  return `<h4>Capture → Alert → Business Follow-Up</h4>
    <p>This separate memory-only rehearsal uses the real worker, notification outbox and Mail adapter with fake delivery responses. Its three calls are not added to the baseline reports. No message leaves this computer.</p>
    ${rehearsal.scenarios.map((scenario) => `<div class="handoff"><h4>${escape(labels[scenario.scenario])}</h4>
      <table><tbody>${rows([
    ['Capture: caller', scenario.capture.callerName], ['Capture: callback number', scenario.capture.callbackNumber],
    ['Capture: request', scenario.capture.issueSummary], ['Capture: urgency', scenario.capture.urgency],
    ['Captured connected calls', scenario.capture.connectedCalls],
    ['Business follow-up required', scenario.capture.officeFollowUpRequired],
    ['Alert: configured business recipient', scenario.alert.recipient],
    ['Business follow-up owner', scenario.alert.followUpOwner],
    ['Business time zone', scenario.alert.timeZone],
    ['Human next action', scenario.alert.nextAction],
    ['Alert: durable status sequence', scenario.alert.states.map((state) => `${state.status} (attempt ${state.attempts})`).join(' → ')],
    ['Fake send attempts', scenario.simulatedEffects.sendAttempts],
    ['Replay avoids another send', scenario.alert.replaySuppressed],
    ['Actual inbox delivery', 'Unknown / not established'],
    ['Business acknowledgment', scenario.businessFollowUp.acknowledgment],
    ['Business callback outcome', scenario.businessFollowUp.callbackOutcome],
  ])}</tbody></table>
      <p>${scenario.scenario === 'accepted'
    ? 'Sent means the fake adapter returned acceptance. It does not prove inbox arrival, reading, acknowledgment or a callback.'
    : scenario.scenario === 'ambiguous'
      ? 'An unknown after-invocation result stays held. Review delivery evidence before deciding recovery; do not resend, clone the event or mark it delivered.'
      : 'The definite pre-send rejection uses only the existing bounded retry budget, then stops. A Sylvara operator must review the failure; there is no automatic reroute or unlimited retry.'}</p>
      <details><summary>Actual template preview from this synthetic outbox record</summary><pre>${escape(scenario.alert.htmlPreview)}</pre></details></div>`).join('')}
    <p class="note">The business, not this free-test agent, owns manual review and any permitted callback. Acknowledgment and callback outcomes remain unknown until separately observed. No callback, appointment, dispatch or recovered revenue is simulated as complete.</p>`;
}

/** Render only the fixed synthetic harness output. No endpoints or live actions.
 * Derived backend evidence and illustrative journey history remain distinct.
 */
function renderFreeTestDemo(demo) {
  if (!demo || !Array.isArray(demo.companies) || demo.companies.length !== 2
    || !demo.label?.startsWith('SYNTHETIC DEMONSTRATION')) throw new Error('SYNTHETIC_DEMO_REQUIRED');
  const companies = demo.companies.map((company, index) => {
    const report = company.report;
    if (!report || report.engagementType !== 'free_test' || !Array.isArray(report.calls)) {
      throw new Error('SYNTHETIC_REPORT_REQUIRED');
    }
    const config = company.preparation?.candidate || company.preparation?.configuration
      || company.preparation || {};
    const earlyStop = index === 0 ? demo.earlyStopRehearsal : null;
    return `<article class="company" data-company="${index}">
      <h2>Fictional plumbing company ${escape(company.key || index + 1)}</h2>
      <section data-step="0"><p class="eyebrow">1 · Request</p><h3>One customer relationship, not competing writers</h3>
        <p>Public requests use the native Forms → CRM integration. An existing Lead uses the CRM-assisted form and Catalyst writes back to that exact Lead.</p>
        <p>A setup appointment is a scheduling entry, not setup authorization. Its CRM deduplication and next-action binding must be verified before relying on it.</p>
        <p class="note">This history is illustrative. Accepted live Form 1 and native conversion evidence is retained separately; this demo does not recreate it.</p></section>
      <section data-step="1"><p class="eyebrow">2 · Setup</p><h3>Review the business rules</h3>
        <table><tbody>${rows([
    ['Coverage', report.coverageMode], ['Hours and exceptions', config.businessHours],
    ['Services', config.servicesHandled?.join(', ')], ['Territory', config.serviceArea ? JSON.stringify(config.serviceArea) : null],
    ['Callback wording', config.callbackExpectation], ['Fallback preference', config.approvedFallbackDestination],
  ])}</tbody></table>
        <p class="note">Phone formatting does not prove ownership or forwarding. Overflow and combined coverage remain blocked until provider timing has a verified value, unit and source.</p></section>
      <section data-step="2"><p class="eyebrow">3 · Authorization</p><h3>Approval does not start the test</h3>
        <ol><li>Representative verification and scope acceptance.</li><li>Successful Form 2 receipt and exact CRM relationships.</li><li>Internal configuration review and approval.</li><li>Separate provider activation and independent readback — later, not performed here.</li></ol>
        <p>The seven-day clock begins only after verified activation. The local harness uses explicitly simulated activation facts, not live approval or telephone evidence.</p></section>
      <section data-step="3"><p class="eyebrow">4 · Capture</p><h3>What an intake call would capture</h3>
        <p>Name, callback number, new or existing customer, service request, city/ZIP, urgency, and any requested person. No booking, dispatch, transfer, payment or SMS.</p>
        <div class="table-wrap"><table><thead><tr><th>Illustrative outcome</th><th>Customer</th><th>Urgency</th><th>Evidence</th></tr></thead><tbody>${report.calls.map((call) => `<tr><td>${escape(call.outcome)}</td><td>${escape(call.customerType)}</td><td>${escape(call.urgency)}</td><td>${call.analysisEvidenceComplete ? 'Synthetic fields complete' : 'Incomplete / unknown preserved'}</td></tr>`).join('')}</tbody></table></div>
        <p class="note">These are injected synthetic outcomes, not proof that a voice model classified speech correctly.</p></section>
      <section data-step="4"><p class="eyebrow">5 · Alert</p><h3>Notification preview — nothing sent</h3>
        <p>Only the configured business recipient may receive an approved alert. Ambiguous delivery is reconciled before any retry.</p>
        ${index === 0 ? handoffView(demo.ownerHandoffRehearsal) : ''}
        <details><summary>Baseline notification previews for this company</summary><pre>${escape(JSON.stringify(company.notificationPreviews, null, 2))}</pre></details>
        <p class="note">All addresses and phone details shown here are fictional. No inbox, email or SMS service is connected.</p></section>
      <section data-step="5"><p class="eyebrow">6 · Results</p><h3>Derived synthetic free-test report</h3>
        <table><tbody>${rows([...FIELDS.map(([field, label]) => [label, report[field]]), ['Spam', report.metrics?.spam], ['Unresolved calls', report.metrics?.unresolvedCalls]])}</tbody></table>
        <p>Unknown means the evidence was absent; it is not zero. Potential opportunities are not confirmed jobs, recovered revenue or testimonials.</p>
        <p>Duration uses the synthetic event's explicit <code>duration_ms</code>, not an inferred timestamp difference. The same production calculation runs locally.</p>
        <details><summary>Report-only CRM reconciliation evidence</summary><pre>${escape(JSON.stringify(company.crmSummary, null, 2))}</pre></details></section>
      <section data-step="6"><p class="eyebrow">7 · Stop</p><h3>A bounded test, with restoration still to prove live</h3>
        <table><tbody>${rows([['Call ceiling', report.callLimit], ['Calls remaining', report.callsRemaining], ['Stop reason', report.testEndReason], ['Synthetic state', JSON.stringify(company.state)]])}</tbody></table>
        <p>Stop at seven days or 25 unique connected calls, whichever comes first. Already-admitted calls settle and any overshoot is disclosed. An operator or customer may stop earlier.</p>
        ${earlyStop ? `<h4>Early operator stop — separate synthetic rehearsal</h4>
        <p>The actual backend control service stops a separate in-memory copy of Company A before either limit. Its fake route and CRM adapters do not connect to external systems. These rehearsal calls are not added to the two reports above.</p>
        <table><tbody>${rows([
    ['Before operator stop', `${earlyStop.before.testStatus} · ${earlyStop.before.callsCaptured} connected call`],
    ['After backend rollback', `${earlyStop.after.testStatus} / ${earlyStop.after.approvalStatus}`],
    ['New admission rejected', earlyStop.newAdmissionRejected],
    ['Already-admitted call settled afterward', earlyStop.alreadyAdmittedCallSettled],
    ['Stop evidence preserved after late event', earlyStop.terminalEvidencePreserved],
    ['Same stop command replayed without another state change', earlyStop.sameCommandReplay],
    ['Durable revocation receipts', earlyStop.revocationReceiptCount],
    ['Rehearsal report connected calls', earlyStop.report.callsCaptured],
    ['Rehearsal report end reason', earlyStop.report.testEndReason],
    ['Rehearsal report ended at', earlyStop.report.testEnd],
    ['Rehearsal report source updated at', earlyStop.report.sourceModifiedAt],
    ['Original carrier handling restored', earlyStop.originalHandlingRestorationVerified ? 'Verified' : 'Unknown / not established'],
  ])}</tbody></table>` : ''}
        <p>Backend containment is separate from restoring original carrier handling. The latter requires the approved provider-specific procedure and a later real readback/test.</p>
        <p class="note">No live stop or route action exists in this page.</p></section>
    </article>`;
  }).join('');
  const script = `(() => {
    let company=0,step=0;
    const names=['Request','Setup','Authorization','Capture','Alert','Results','Stop'];
    const articles=[...document.querySelectorAll('.company')];
    const buttons=[...document.querySelectorAll('[data-go]')];
    function render(){articles.forEach((article,i)=>{article.hidden=i!==company;article.querySelectorAll('[data-step]').forEach(section=>{section.hidden=Number(section.dataset.step)!==step;});});buttons.forEach(button=>{button.setAttribute('aria-current',Number(button.dataset.go)===step?'step':'false');});document.getElementById('progress').textContent=(step+1)+' of 7 · '+names[step];document.getElementById('previous').disabled=step===0;document.getElementById('next').disabled=step===6;}
    buttons.forEach(button=>button.addEventListener('click',()=>{step=Number(button.dataset.go);render();}));
    document.getElementById('company').addEventListener('change',event=>{company=Number(event.target.value);render();});
    document.getElementById('previous').addEventListener('click',()=>{step=Math.max(0,step-1);render();});
    document.getElementById('next').addEventListener('click',()=>{step=Math.min(6,step+1);render();});render();
  })();`;
  const hash = createHash('sha256').update(script).digest('base64');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
<meta name="referrer" content="no-referrer"><title>Sylvara · Synthetic Free-Test Walkthrough</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#17232e;font-family:-apple-system,BlinkMacSystemFont,"Inter",sans-serif;font-size:17px;line-height:1.55}main{max-width:1000px;margin:auto;padding:24px}header{margin-bottom:24px}h1{font-size:clamp(1.8rem,4vw,2.6rem);line-height:1.15;margin:10px 0}h2{font-size:1.15rem;color:#435365}h3{font-size:1.5rem;line-height:1.25}p{max-width:76ch}.badge{display:inline-block;background:#16394a;color:white;border-radius:4px;padding:8px 12px;font-size:.85rem;font-weight:700}.eyebrow{font-weight:700;color:#386078}.company{background:white;border:1px solid #dce3e9;border-radius:14px;padding:24px}.note{border-left:4px solid #587f98;background:#f0f5f8;padding:14px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}button,select{font:inherit;min-height:46px;border:1px solid #a6b6c4;border-radius:8px;padding:8px 14px;background:white;color:#18354b;cursor:pointer}button:hover:not(:disabled){background:#e7f1f6}button:active:not(:disabled){transform:translateY(1px)}button[aria-current=step]{background:#183d51;color:white}button:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #1388b5;outline-offset:3px}button:disabled{opacity:.45;cursor:default}.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:20px 0}table{width:100%;border-collapse:collapse;font-size:.95rem}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #dce3e9;padding:12px 8px;overflow-wrap:anywhere}th{font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6f8;padding:16px;font-size:.8rem}.table-wrap{overflow:auto}summary{cursor:pointer;padding:12px 0}footer{color:#526273;font-size:.9rem;margin:24px 0}[hidden]{display:none!important}@media(max-width:600px){main{padding:14px}.company{padding:16px}nav button{flex:1 1 29%;padding:8px}th,td{padding:10px 5px}table{font-size:.85rem}}@media(prefers-reduced-motion:reduce){button:active:not(:disabled){transform:none}}</style></head>
<body><main><header><span class="badge">SYNTHETIC DEMONSTRATION · NO LIVE CALLS</span><h1>The free test, from request to results</h1><p>A local operator walkthrough. Fictional businesses, injected call events, preview-only alerts. No provider, microphone, CRM or email connection.</p><label for="company">Fictional company </label><select id="company"><option value="0">Company A</option><option value="1">Company B · isolation example</option></select></header>
<nav aria-label="Walkthrough steps">${['Request','Setup','Authorization','Capture','Alert','Results','Stop'].map((name,index)=>`<button type="button" data-go="${index}">${index+1}. ${name}</button>`).join('')}</nav>
${companies}<div class="controls"><button type="button" id="previous">Previous</button><span id="progress" aria-live="polite">All steps are visible without JavaScript</span><button type="button" id="next">Next</button></div>
<footer>Prepared for local review only. This demonstrates deterministic backend behavior, not speech quality, live delivery, carrier forwarding or customer readiness. Inter uses a locally installed font when available; no font is downloaded.</footer></main><script>${script}</script></body></html>`;
}

module.exports = { escape, renderFreeTestDemo };
