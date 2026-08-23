# AI Receptionist Legal And Compliance Control Archive

**Status:** Research archive with a preserved conservative internal-QA proposal; not a current launch decision

**Research verified:** 2026-08-04

**Preserved profile:** Controlled, inbound-only, internal non-sales QA with synthetic conversation data

This archive records dated source research and a conservative proposed control profile for Sylvara's AI receptionist. It is not legal advice, a legal opinion, a fifty-state survey, or proof that any vendor configuration or live deployment is compliant. Law, facts, contracts, caller location, client industry, and product behavior can change the result. A repository approval does not approve a public launch, customer pilot, outbound campaign, recording practice, privacy notice, contract, or production configuration.

The internal-QA profile is preserved as a historical proposed option, not as a blanket legal conclusion or the current approval record for every Development test. Keep three decisions separate: offline/synthetic Development tests need no telephone route; a controlled internal Development phone test needs an explicit owner-approved scope, environment readback, data-handling decision, and rollback; and a prospect/customer launch remains unresolved until its actual workflow and required approvals are recorded. The responsible business owner determines which professional reviews are required for the facts. This public archive neither grants nor denies a particular call authorization.

## Preserved Conservative Profile

No person can promise that a software stack is “perfectly legal.” The lowest-risk demonstrable profile is narrow enough to remove the highest-risk activities instead of trying to paper over them:

- an authorized adult Sylvara staff member or contractor, acting only as an internal non-sales tester under prior written authorization and notice, initiates an inbound call to a dedicated, non-public number;
- a carrier-level one-way media gate prevents inbound audio from reaching any AI, speech, model, logging, support, or observability system until a static first message identifies the AI/internal-QA purpose, explains processing and carrier metadata, directs the tester not to provide real or sensitive conversation data, and obtains keypad assent;
- recording and retained transcription are off; the call ends if assent is absent, unclear, or withdrawn;
- only fictional scenarios and synthetic service details are accepted;
- there are no outbound calls, texts, emails, lead follow-ups, transfers to a sales campaign, or automatic callbacks;
- there are no real bookings, dispatches, quotes, contracts, payments, credentials, emergencies, health matters, or regulated decisions; and
- no client system, production calendar, CRM, mailbox, analytics destination, or business phone line is connected.

A prospect-facing telephone demonstration is not within this historical profile. A real prospect test needs its own current business, privacy, security, vendor, route, data, and any legal review appropriate to the actual workflow; do not infer that approval from this archive.

The machine-readable proposed control profile is in [`demo-control-profile.json`](demo-control-profile.json). Repository tests check its declared scope and internal consistency; they do not implement or prove runtime enforcement. Runtime controls require separate implementation, environment-specific verification, and written approval. The human procedure and test cases are in [`controlled-demo-standard.md`](controlled-demo-standard.md).

## Read Order

1. [`authority-scope-and-roles.md`](authority-scope-and-roles.md) — research limits, legal weight, facts that change the analysis, and responsibility mapping.
2. [`telephony-recording-and-messaging.md`](telephony-recording-and-messaging.md) — TCPA/FCC, FTC telemarketing, recording, caller ID, messaging, and interstate controls.
3. [`state-jurisdiction-controls.md`](state-jurisdiction-controls.md) — Kansas, Missouri, representative high-risk recording states, and the state-expansion rule.
4. [`privacy-security-and-data.md`](privacy-security-and-data.md) — privacy roles, minimization, security, incident response, biometrics, and regulated data.
5. [`controlled-demo-standard.md`](controlled-demo-standard.md) — the only currently proposed demonstration profile.
6. [`vendor-client-and-launch-gates.md`](vendor-client-and-launch-gates.md) — evidence required before a vendor, client, or live workflow can be approved.
7. [`regulated-and-expanded-use-gates.md`](regulated-and-expanded-use-gates.md) — features and sectors that remain blocked pending separate review.
8. [`risk-register.md`](risk-register.md) — unresolved risks, owners, and release criteria.
9. [`official-source-register.md`](official-source-register.md) and [`reference/source-manifest.json`](reference/source-manifest.json) — dated primary authority and provenance.

## Authority Labels

Every conclusion in this archive uses one of four labels:

| Label | Meaning |
|---|---|
| **Binding when applicable** | Statute or regulation that controls when its jurisdiction, role, conduct, and threshold are met. |
| **Conditional** | A binding rule whose trigger is intentionally outside the controlled demo but may attach to a client, industry, data type, state, or expanded feature. |
| **Official guidance** | Government interpretation or security guidance; useful but not itself equivalent to a statute or rule. |
| **Sylvara control** | A conservative engineering or operating choice. It can reduce risk but does not create legal compliance by itself. |

## What This Archive Does Not Approve

The archive itself does not approve the following activities. They require a separate current decision for the actual workflow; the list is an engineering boundary, not a legal conclusion:

- outbound AI-generated or prerecorded voice calls;
- an openly advertised or unrestricted public call-in demonstration;
- any prospect-, lead-, customer-, reseller-, or sales-facing telephone demonstration;
- automated marketing texts, emails, or missed-call follow-up;
- recording, retained transcription, quality monitoring, or model training on real calls;
- collection of payment-card, bank, government-identifier, credential, health, biometric, precise-location, or children's data;
- real appointments, dispatch, contracting, price commitments, eligibility decisions, or emergency handling;
- voice cloning, speaker identification, voiceprints, emotion inference, or identity authentication by voice;
- healthcare, financial, insurance, legal, housing, employment, education, public-benefit, debt, or other regulated workflows;
- client number forwarding or access to production CRM, calendars, mailboxes, work orders, analytics, or call records; and
- operation outside the United States or intentional service to a new state without jurisdiction review.

## Change Control

Re-verify the affected primary sources and reopen legal review before changing the call direction, purpose, caller population, states, disclosure, recording or transcript behavior, data fields, retention, vendor/subprocessor, model-training terms, integrations, industry, automated decisions, payment flow, or message channel. Preserve legal advice and live evidence privately; this public repository should hold only sanitized controls, source locators, and approval status.
