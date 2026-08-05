# Authority, Scope, And Responsibility

**Status:** Proposed control framework; counsel review required

**Verified:** 2026-08-04

## Research Question And Fixed Facts

The research asks what controls are required or prudent for a United States AI voice receptionist that answers calls for another business. The current conclusion applies only to a controlled demonstration with the fixed facts in the [demo standard](controlled-demo-standard.md). It does not carry forward automatically to an open public demo, customer pilot, or production service.

The legally material facts are:

- who initiates the communication and whether any later callback, text, or email occurs;
- whether the message advertises, solicits, upsells, collects payment, or completes a transaction;
- the caller's physical location, the called party's location, and the business's operating locations;
- whether audio is merely transported, algorithmically processed, recorded, transcribed, monitored, retained, or used to train a model;
- whether each participant received notice and gave legally sufficient consent before the relevant processing;
- whether a consumer, business, patient, child, employee, debtor, tenant, applicant, or other protected person is involved;
- every data field, inference, integration, recipient, subprocessor, storage region, purpose, and retention period;
- who controls the purpose and means of processing and who acts only on documented instructions;
- whether the AI can make promises, prices, appointments, eligibility decisions, contracts, transfers, or safety decisions; and
- whether Sylvara or a vendor supplies or resells telephone service rather than only using a carrier account.

If any fact is unknown, the affected capability remains off.

## Authority Hierarchy

Research proceeds in this order:

1. current federal and state constitutions, statutes, and enacted session laws;
2. current federal and state regulations;
3. controlling court decisions for the relevant forum;
4. formal agency orders, declaratory rulings, and enforcement decisions;
5. official agency guidance and recognized technical standards; and
6. Sylvara policy choices and counsel advice for the actual deployment.

Search snippets, vendor marketing, blog posts, prior drafts, and this repository are not authority. The [source manifest](reference/source-manifest.json) records the official materials verified for this review. It does not replace citator work, case-law research, local-law research, or counsel's opinion.

## Applicability Map

| Topic | Controlled internal-QA telephone test | Real inbound pilot | Outbound or follow-up |
|---|---|---|---|
| Federal artificial/prerecorded voice calling restrictions | Inbound leg is not initiated by Sylvara, and the profile has no purchase-inducement purpose; deception and general consumer-protection rules still apply | Usually not triggered by the customer's inbound call itself, but facts, sales purpose, and upsell can change the FTC analysis | High risk; prior consent, written consent for marketing, identification, opt-out, time, suppression, recordkeeping, and exemptions require campaign-specific review |
| State call recording/interception | Prior written tester authorization, one-way carrier media gate, keypad assent before downstream processing, and no retained content; exact state review still required | Applies according to every relevant state and technology; strict all-party procedure is the default | Applies to both call direction and every state; no campaign launch without matrix and counsel |
| Privacy and security | Synthetic conversation/application data, but real ANI, call-routing metadata, authorization, and consent evidence are Restricted and governed | Personal data, service-provider/processor contracts, notices, rights, retention, security, and breach duties attach according to facts | Same, plus consent and suppression evidence become critical |
| Sector rules | Blocked | Require sector-specific approval | Require sector-specific approval plus channel rules |
| State AI transparency or automated-decision laws | Early AI disclosure is the national control | Disclosure and decision restrictions depend on state and use | Same, with heightened impersonation and consumer-protection risk |

“Inbound” is not a universal exemption. A seller can turn an inbound inquiry into telemarketing by solicitation or upsell, and a prospect-facing product demonstration can itself be part of a campaign intended to induce purchase. State laws may use different definitions. A caller's request does not authorize unrelated future calls or texts.

## Role Mapping Required Before A Pilot

The client generally decides why calls are handled and what business outcomes occur. Sylvara may be a service provider or processor for some data and an independent controller for its own security, billing, abuse-prevention, or product records. The voice platform, carrier, speech/model providers, automation platform, CRM, and analytics services may be subprocessors or independent recipients. Labels in a contract do not override actual conduct.

Before any prospect-facing, client, public, or production call, create a private, approved record containing:

| Required fact | Evidence |
|---|---|
| Client legal entity and service locations | Executed agreement and verified onboarding record |
| Controller/business and processor/service-provider roles by purpose | Data-processing schedule and data-flow review |
| Carrier, number owner, voice runtime, model, speech, storage, automation, and destination systems | Current vendor and subprocessor inventory |
| Each data category, purpose, legal basis or consent, disclosure, recipient, region, and retention | Field-level data inventory and approved notice |
| Call direction, purpose, states, audience, and any continuation channel | Approved use-case sheet and routing rules |
| Recording/transcription state from the first packet through deletion | Vendor documentation plus environment-specific test evidence |
| Who handles privacy requests, legal holds, incidents, and regulator or consumer notices | Contract, runbook, and escalation roster |

## Choice Of Law And State Expansion

A Kansas or Missouri office does not make every call a Kansas or Missouri call. The caller may be in a stricter state, the client's business may be located elsewhere, and courts differ on which interception law applies. Geolocation and telephone area code are imperfect and cannot safely establish the caller's physical location.

Sylvara therefore uses three controls:

1. prior written tester authorization plus a carrier-level one-way media gate and keypad assent before any internal-QA audio reaches a downstream AI, speech, model, logging, support, or observability system;
2. a separate nationwide, all-participant disclosure and affirmative-consent procedure before any retained recording or transcription; and
3. a state launch review covering recording, telemarketing, mini-TCPA, privacy, biometric, breach, consumer-protection, accessibility, tax/telecom, and sector rules for every intentionally served state.

The technical and consent controls reduce uncertainty; they do not eliminate state review. If a state requires a particular announcement, writing, registration, bond, record, retention period, or consent form, the stricter requirement governs.

## Responsibility Boundary

| Actor | Minimum responsibility |
|---|---|
| Sylvara | Design fail-closed controls; use vendors only after review; keep proof of configuration; follow client instructions only within approved scope; protect data; stop on uncertainty; never claim legal certification |
| Client | Supply truthful business rules and notices; establish the lawful purpose and customer relationship; approve scripts and data fields; perform industry/state review; staff escalation; honor privacy and suppression requests |
| Carrier and voice/data vendors | Perform contracted service, publish current security/privacy behavior, support required settings and deletion, notify incidents, and bind subprocessors; vendor terms do not transfer all liability away from Sylvara or the client |
| Qualified counsel | Apply current law to actual facts, jurisdictions, contracts, scripts, and evidence; approve high-risk launches and material changes |
| Authorized operator | Confirm every gate with evidence, test the deployed configuration, preserve private proof, monitor drift, and stop the service when a control fails |

## No Compliance Claim

Do not use “compliant,” “HIPAA compliant,” “PCI compliant,” “TCPA compliant,” “all-party-consent compliant,” “secure,” “zero retention,” or an equivalent claim unless its exact scope, evidence, approver, and expiration are recorded privately. Passing repository tests proves only that the proposed public control files are internally consistent.
