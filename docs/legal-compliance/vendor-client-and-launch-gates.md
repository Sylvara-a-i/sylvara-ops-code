# Vendor, Client, And Launch Gates

**Status:** Proposed operating controls; no vendor, client, or environment approved

A vendor's feature list, trust page, contract label, or “compliance” badge cannot prove that the deployed data flow is lawful. Approval requires current contractual rights, technical behavior, environment-specific evidence, client facts, and a jurisdiction-specific legal decision. Unknown means blocked.

## Gate 1: Define The Exact Workflow

Create one private workflow record for each materially different call path. It must fix:

- client legal entity, trade name, industry, service area, licenses, and authorized brand/persona;
- inbound or outbound direction and who technically initiates each leg;
- consumer or business audience, line type, physical locations, age expectations, and intentionally served states;
- demonstration, existing-customer service, scheduling, sales, marketing, debt, survey, emergency, or other purpose;
- every disclosure, consent, revocation, suppression, refusal, and human-escalation step;
- audio transport, recording, transcription, summarization, monitoring, training, analytics, and deletion behavior;
- all requested, inferred, returned, and logged data fields;
- carrier, number owner, voice platform, model, speech, storage, automation, integration, observability, and support recipients;
- every read, write, notification, transfer, price, promise, or other real-world side effect; and
- incident, privacy request, deletion, legal hold, shutdown, rollback, and evidence owners.

Do not approve an architecture diagram that says only “telephony → AI → CRM.” Field-level purpose and retention matter.

## Gate 2: Vendor And Subprocessor Evidence

For every provider that can receive content or metadata, obtain current private evidence for the following:

| Area | Blocking evidence |
|---|---|
| Legal role | Contracting entity, service, region, carrier/application role, controller/processor position, and any independent-use purpose |
| Terms | Executed service agreement and data-processing terms that cover the exact product and environment |
| Subprocessors | Current list, function, location, change-notice procedure, objection/termination right, and equivalent downstream duties |
| Collection | Complete audio, transcript, prompt, metadata, identifier, diagnostic, human-review, and support data inventory from the first packet |
| Retention | Product, backup, abuse, safety, quality, support, and legal-hold periods; deletion trigger and completion evidence |
| AI use | Contract and settings prohibiting provider training, cross-customer improvement, profiling, voice cloning, voiceprints, emotion/protected-trait inference, and unrelated secondary use |
| Recording | Whether transport buffers, debugging, failure capture, sampling, screen/session replay, QA, or monitoring creates an artifact before consent |
| Pre-assent routing | Whether a carrier-level one-way media gate can play the notice and accept DTMF while discarding inbound audio without downstream forwarding; proof for barge-in, transport buffers, abuse/fraud, observability, support, and subprocessors |
| Security | Encryption, key and secret handling, least privilege, strong administrator authentication, environment isolation, vulnerability management, secure development, logging, and incident response evidence appropriate to the risk |
| Rights support | Search, access, correction, deletion, export, restriction, opt-out, and legal-hold capability with verified response times |
| Incident | Detection, containment, evidence preservation, subprocessor notice, contractual notice deadline, cooperation, and deletion/rotation support |
| Portability | Export format, number portability, configuration export, deletion on termination, and a tested replacement/rollback path |
| Claims | Precise scope and date for any audit report or certification; no inference that a certification covers Sylvara's configuration or legal use |

If a provider reserves broad rights to retain or train on call content, cannot stop pre-consent artifacts, cannot identify subprocessors, cannot support deletion, or will not sign the required processing terms, it is not approved for real calls. Use a synthetic offline demonstration or another provider.

## Gate 3: Contract Allocation

Counsel-approved agreements must address, as applicable:

- authorized instructions and prohibited purposes;
- business/controller and service-provider/processor roles by data purpose;
- confidentiality, personnel access, security controls, and audit/evidence rights;
- no sale, sharing, targeted advertising, unrelated profiling, model training, voice cloning, or biometric creation;
- approved subprocessors, location restrictions, change notice, and downstream flow-down;
- return/deletion, backup aging, legal holds, and proof at termination;
- privacy-request, consent, revocation, suppression, complaint, subpoena, and regulator cooperation;
- incident notice and cooperation early enough for the party with statutory notice duties to investigate and act;
- telephone number, caller ID, brand, carrier registration, script, consent, DNC, reassigned-number, and record responsibility;
- client ownership and approval of business facts, hours, prices, availability, licensing, service areas, emergency paths, and human staffing;
- limits on AI authority to quote, promise, schedule, contract, charge, dispatch, diagnose, or make consequential decisions;
- service changes, legal changes, material model/vendor changes, suspension, kill switch, and transition assistance; and
- warranty, indemnity, insurance, limitation-of-liability, and dispute terms approved for the actual risk.

Allocating a duty does not necessarily eliminate statutory, vicarious, aiding, or unfair-practice exposure. Each party must monitor the duties it cannot transfer.

## Gate 4: Client Readiness

The client must provide and approve current, truthful evidence—not verbal assumptions—for:

- its identity, trade names, service locations, licenses, insurance, service categories, exclusions, and consumer terms;
- the source of every price, fee, estimate boundary, availability claim, service area, promotion, guarantee, and appointment rule;
- jurisdictions and caller types intentionally served, including whether residential consumers or mobile numbers are involved;
- approved disclosures, privacy notice, consent language, no-recording alternative, accessibility path, and complaint channel;
- a human team able to receive only approved handoffs and honor suppression, privacy, refund, cancellation, safety, and escalation obligations;
- data fields it actually needs, why it needs them, lawful handling, system of record, access, retention, and deletion;
- sector status, including whether it is a covered healthcare or financial entity, public accommodation, government contractor, debt collector, insurer, employer, housing provider, school, or licensed profession;
- emergency and after-hours limitations that never imply Sylvara dispatched public safety or a technician when it did not; and
- signed commercial and data-processing terms plus any business associate, sector, carrier, messaging, or state registration required for the exact workflow.

A client request cannot override a legal or safety block. Do not deploy a client-provided script that is deceptive, suppresses AI/recording disclosure, expands consent, invents urgency, discriminates, collects prohibited data, or authorizes an unreviewed channel.

## Gate 5: Environment-Specific Verification

Validate the actual development environment first with synthetic calls. Preserve private screenshots, exports, version numbers, timestamps, and test results for:

1. inbound-only routing and denial of every outbound API/tool;
2. number and brand ownership without exposing identifiers in GitHub;
3. prior written tester authorization, notice version, access expiry, and a minimal segregated consent receipt;
4. a carrier-level one-way media gate that discards barge-in/pre-assent inbound audio, with no downstream AI, speech, model, logging, support, observability, buffer, abuse/fraud, or subprocessor recipient;
5. end-to-end ANI, called-number, routing, call-ID, support, retention, and deletion behavior without AI/model application or analytics ingestion;
6. the first-message disclosure and consent state machine;
7. no pre-consent or post-call recording, transcript, summary, content log, QA sample, human review, or model training;
8. no production integration, destination, webhook, CRM, calendar, mailbox, analytics, or notification;
9. prompt/tool/data allowlists and hard side-effect denials;
10. sensitive-data interruption without echo or logging;
11. emergency, relay, accessibility, silence, ambiguity, withdrawal, prompt-injection, and outage behavior;
12. deletion across primary storage, derived artifacts, vendor consoles, support systems, and backups where testable;
13. administrator access, strong authentication, secret storage, audit events, rate limits, abuse controls, and kill switch; and
14. rollback to a noninteractive notice or disabled number.

Vendor documentation is not a test result. A setting label is not proof until an authorized reviewer observes its effect and checks all downstream systems.

## Gate 6: Legal And Business Approval

The approval packet must contain:

- the fixed workflow record;
- proof that the telephone audience is limited to internal non-sales staff/contractor QA and excludes prospects, leads, customers, resellers, and purchase-inducement activity;
- current official-source review and counsel analysis for the actual states and localities;
- approved contracts, notices, scripts, consent evidence design, and retention schedule;
- completed vendor, security, privacy, accessibility, emergency, and sector reviews;
- environment-specific negative and deletion tests;
- a named operator, incident lead, privacy lead, client approver, counsel approver, and expiration/review date;
- monitored change events and a defined automatic stop condition; and
- a rollback and caller-communication plan that does not require the failed AI service.

Only an approval scoped to the immutable script/configuration/vendor version may authorize a launch. A Git commit, pull request, passing CI run, signed client contract, or vendor sales assurance alone does not.

## Ongoing Monitoring And Stop Conditions

Disable all affected access when any of these occurs:

- recording, transcript, log, training, or subprocessor behavior cannot be confirmed;
- the greeting, prompt, model, tool, destination, data field, vendor, subprocessor, region, or terms change materially;
- outbound activity, real data, an unapproved integration, or a real-world side effect is detected;
- consent, withdrawal, accessibility, safety, deletion, or sensitive-data tests fail;
- a complaint, regulator inquiry, privacy request, security incident, or suspected unlawful call occurs;
- an official source or counsel indicates the legal analysis may have changed; or
- the approval expires or the named responsible operator is unavailable.

Keep a non-AI status message or take the number offline. Never silently fall back to broader logging, another model, another region, a personal number, or unapproved human monitoring.

## Rollback

Source rollback is a revert of the focused commit. Live rollback is separate: disable routing and tools, stop new calls, preserve required evidence, contain/delete data according to the incident and retention plans, notify the client and authorized reviewers privately, and independently verify that no provider continues processing. Regulatory or consumer notice is a legal decision; do not publish it from this repository.
