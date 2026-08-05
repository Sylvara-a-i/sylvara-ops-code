# AI Receptionist Legal And Operational Risk Register

**Status:** Open; no launch authorization

**Reviewed:** 2026-08-04

Severity reflects potential harm and legal/operational exposure, not a probability estimate. “Controlled for demo” means only that the proposed design contains a control; it is not closed until environment-specific evidence and approval exist.

| ID | Risk | Severity | Proposed demo control | Evidence required to close for demo | Status |
|---|---|---:|---|---|---|
| R-01 | Outbound AI call or cross-channel follow-up triggers TCPA/TSR/state duties | Critical | All outbound call, text, email, callback, and voicemail capabilities disabled | Network/tool denial plus negative tests and vendor/carrier review | Open |
| R-02 | Audio is forwarded, buffered, recorded, transcribed, or logged before valid notice or assent | Critical | Prior written tester authorization; carrier-level one-way media gate; static notice; keypad assent; no downstream pre-assent media; no retained content | First-packet routing, barge-in, buffer, abuse/fraud, support, log, subprocessor, and deletion tests | Open |
| R-03 | Tester is in a stricter recording or privacy jurisdiction | Critical | Nationwide authorization/assent design; synthetic conversation data; Restricted ANI/metadata handling | Intentionally served-state matrix, metadata map, and counsel approval | Open |
| R-04 | Vendor retains content, trains models, samples calls, or changes subprocessors | Critical | Contract/settings prohibit use; provider blocked if behavior unknown | Executed terms, settings export, subprocessor list, test, change monitoring | Open |
| R-05 | Caller volunteers PII, payment, health, credentials, child, or biometric data | Critical | Upfront warning, hard field allowlist, interrupt without echo, end | Adversarial tests and proof no content entered logs/support systems | Open |
| R-06 | Demo creates real booking, dispatch, quote, contract, charge, or notification | Critical | No tools/integrations; fictional knowledge; final no-action reminder | Destination/network inventory and side-effect denial tests | Open |
| R-07 | Emergency caller relies on AI and help is delayed | Critical | Not-emergency disclosure; immediate end-and-contact-emergency instruction; no auto-911 | Hazard tests, approved wording, kill switch, human alternative | Open |
| R-08 | AI impersonates a person/business or invents material facts | High | Immediate AI/demo identity; no cloned voice; synthetic scenario; constrained facts | Voice provenance, prompt tests, client/brand authorization if later real | Open |
| R-09 | Relay, disabled, accented, or slower caller cannot communicate equally | High | Relay-friendly timing, no bot/fraud rejection, accessible alternative | TRS/TTY and accessibility tests plus client Title III review | Open |
| R-10 | Public notice or privacy claim is inaccurate, especially “not recorded” or “secure” | High | Narrow reviewed language; no unsupported compliance claim | End-to-end vendor evidence and synchronized notice/configuration review | Open |
| R-11 | Stable identifiers or call content leak into analytics, support, CI, or GitHub | Critical | Aggregate metrics only; public-repository scanner; private evidence store | Log/telemetry inventory, scanner results, access/deletion test | Open |
| R-12 | Security compromise exposes callers, prompts, client systems, or credentials | Critical | Isolated demo, secret store, least privilege, strong admin auth, rate limits, no production access | Threat model, access review, vulnerability test, incident/rotation exercise | Open |
| R-13 | Client industry or workflow triggers HIPAA, GLBA, biometric, child, consumer-health, civil-rights, or professional rules | Critical | All regulated sectors/data/decisions prohibited | Client legal/entity/data questionnaire and specialist approval | Open |
| R-14 | Sylvara becomes a telecommunications provider or MLTS operator through resale/control | Critical | Application-layer use of established carrier only; no resale or 911 function | Telecom architecture and contract classification opinion | Open |
| R-15 | Privacy, deletion, suppression, complaint, or incident request lacks an owner | High | Named client/Sylvara roles required before launch | Executed responsibility matrix and tested intake/escalation | Open |
| R-16 | Law, FCC order, state rule, vendor term, model, or configuration changes after review | High | Dated sources, change triggers, approval expiration, automatic stop | Monitoring owner, review cadence, diff alerts, reapproval record | Open |
| R-17 | Consent proof is too weak, too broad, or retained with unnecessary PII | High | Written tester authorization plus minimal segregated DTMF receipt; no call content | Counsel-approved authorization/receipt fields, linkage, access, privacy notice, and retention schedule | Open |
| R-18 | A model prompt rule fails and no technical boundary prevents the action | Critical | Tools, network, data destinations, and side effects denied outside model | Independent configuration review and prompt-injection tests | Open |
| R-19 | A prospect-facing telephone demo is treated as harmless QA even though it induces purchase | Critical | Telephone profile restricted to internal non-sales staff/contractor QA; prospects receive only offline/prerecorded synthetic simulation | Commercial-demo campaign opinion, seller/telemarketer identity, purpose/merchandise disclosures, state matrix, records, script and environment evidence | Open |

## Non-Negotiable Launch Blocks

The demo remains unavailable while any of these facts is unknown:

- whether any provider stores, reviews, trains on, or exposes call content or metadata;
- whether the carrier gate prevents pre-assent inbound audio from reaching any downstream system and every buffer/support/abuse path is verified;
- whether recording/transcript/content logging is off from the first packet;
- whether ANI, routing metadata, written authorization, and consent receipts have approved recipients, access, retention, and deletion;
- whether any tester is a prospect, lead, customer, reseller, or participant in a purchase-inducement campaign;
- whether an outbound or production tool can be reached;
- whether the public words match actual processing;
- whether sensitive-data and emergency tests fail closed;
- whether a named operator can disable the service immediately;
- whether the intentionally served jurisdictions were approved; or
- whether qualified counsel approved the actual workflow and evidence.

## Review Cadence

Review before launch, after every change trigger, after any incident or complaint, and on the approval date set by counsel. The official-source register is dated, not evergreen. Monitor the FCC AI proceeding, the 2027 revocation transition, newly effective state privacy/AI/biometric/telemarketing laws, and vendor/subprocessor terms. A scheduled review cannot substitute for event-driven shutdown.

## Risk Acceptance

Only the authorized business owner and qualified counsel may accept a legal risk, and security/privacy owners must separately approve risks in their domains. Record the exact scope, rationale, compensating controls, evidence, expiration, and rollback privately. Do not place privileged advice, personal data, client details, or exploitable security facts in GitHub. A blanket statement that the platform is “compliant” is not risk acceptance.
