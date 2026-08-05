# Privacy, Security, And Data Controls

**Status:** Proposed controls; no live data processing approved

**Verified:** 2026-08-04

The controlled demo is designed around synthetic conversation content, but a telephone service can still expose caller number, routing data, timestamps, device/network information, keypad events, support records, and security logs to one or more providers. “We do not ask for PII” is not a data map, and “the vendor is compliant” is not a security program.

Source IDs in brackets resolve through the [official source register](official-source-register.md).

## Federal Baseline

Section 5 of the FTC Act prohibits unfair or deceptive acts or practices. Privacy notices, AI disclosures, security claims, vendor statements repeated to customers, and representations such as “not recorded,” “not retained,” “never used for training,” or “secure” must match actual behavior. Reasonable security is evaluated in light of the sensitivity, volume, use, foreseeable harm, and available controls. FTC business guidance emphasizes inventory, minimization, protection, secure disposal, and incident planning. [FED-FTC-ACT; FED-FTC-PRIVACY; FED-FTC-DATA-GUIDE]

The FTC's business guidance is **official guidance**, not a safe harbor. Sylvara adopts its minimization lifecycle as an engineering floor:

1. know every data element and recipient;
2. collect and retain only what is necessary for an approved purpose;
3. restrict and protect what remains;
4. delete or render it unreadable when the approved purpose ends; and
5. prepare, test, and improve the incident response.

NIST's Cybersecurity Framework and Privacy Framework are useful voluntary structures for identifying, governing, protecting, detecting, responding, recovering, communicating, and controlling privacy risk. They do not certify legal compliance. [NIST-CSF; NIST-PRIVACY]

FTC voice-assistant enforcement illustrates why deletion and child/voice claims must reach derived data and training use rather than only a user-facing record. The order binds its respondents, not Sylvara, but the FTC's analysis is a direct warning against indefinite voice retention, undisclosed algorithm improvement, and unfulfilled deletion promises. [FED-FTC-ALEXA]

## Product, Sales, And Performance Claims

The FTC's 2026 Air AI settlement is directly relevant to selling AI call services and business opportunities. The Commission alleged unsupported and misleading claims about earnings, growth, refunds, performance, and affiliation. The settlement binds its respondents, but the FTC Act and Kansas/Missouri consumer statutes bind Sylvara when applicable. [FED-FTC-AIR-AI; FED-FTC-ACT; KS-KCPA-DECEPTIVE; MO-MMPA]

Do not claim or imply that Sylvara:

- never misses a call, is indistinguishable from or better than a human, or has a verified accuracy/uptime/conversion rate without current scoped evidence;
- guarantees revenue, savings, leads, appointments, growth, payback, or a return on investment;
- has customers, integrations, licensing, carrier approval, security certification, HIPAA/PCI status, production deployment, or a refund/service level that is not documented;
- is affiliated with, endorsed by, or speaking as a contractor, employee, vendor, regulator, or customer without written authority; or
- offers a resale, licensing, or managed “make money” opportunity without counsel reviewing the actual offer and Business Opportunity Rule risk.

Maintain a private evidence file for every material sales claim and its date, population, methodology, limitations, and approver. A synthetic demo proves only the observed synthetic scenario.

## Controlled-Demo Data Map

| Data or event | Required demo treatment | Public GitHub treatment |
|---|---|---|
| Prior written tester authorization and access allowlist | Private, Restricted record tied to the tester, invited number/access method, exact purpose and entity, notice version, date, and expiry; no sales reuse | Only the schema/control, never records |
| Caller and called numbers, routing, carrier call record, network metadata | Carrier/access-gate processing only where technically necessary; enumerate every recipient; no AI/model application or analytics ingestion; shortest verified retention; restricted support access; tested deletion | Prohibited |
| Static pre-consent prompt | Versioned sanitized source; no personal data | Allowed |
| Pre-assent inbound audio | Carrier-level one-way IVR transport only; discard without forwarding to voice/speech/model/observability/support recipients; verify buffers and fraud/abuse paths | Prohibited |
| Keypad assent event | Minimal, segregated consent receipt approved by counsel: prompt/configuration version, precise timestamp, DTMF result or withdrawal, pseudonymous call reference, and authorization linkage; no content, sales, training, or analytics use | Only the schema/control, never events |
| Post-assent audio | Transient transport and processing only; no recording, replay, QA sample, human review, or training | Prohibited |
| Speech recognition and model input/output | In-memory session only; no retained transcript, prompt trace, error payload, summary, or support copy | Synthetic prompts/tests only |
| Fictional scenario fields | Session-only and tool-restricted; never mixed with real client data | Sanitized examples allowed |
| Performance/security telemetry | Aggregate counts and coarse latency/error measures; no stable call ID, number, content, prompt, or tool arguments | Aggregate sanitized test results allowed |
| Vendor support or incident evidence | Private restricted system; redact/minimize before sharing; apply approved retention/legal hold | Prohibited |

If a provider's unavoidable call-detail records, transport buffers, abuse/fraud controls, support access, or logs differ from this map, document the exact behavior, purpose, role, contract, access, retention, deletion, and notice before approval. Trace ANI and identifiers end to end and test deletion. Do not call the result “zero retention.”

## Data Roles And Contracts

For a real client, the client will often determine the business purpose and means for caller data, with Sylvara acting as a processor or service provider on documented instructions. Sylvara may be an independent controller for narrowly defined billing, security, legal, or abuse-prevention records. Vendors may be subprocessors or independent recipients. The result is purpose-specific; one company can hold different roles for different data.

Every pilot must have a written, field-level role and purpose table plus processor/service-provider terms. At minimum the terms must:

- identify the specific processing purposes and instructions;
- prohibit sale, sharing, targeted advertising, unrelated profiling, model training, and combination across clients except where expressly lawful and approved;
- require confidentiality, appropriate security, deletion/return, rights assistance, assessment/audit assistance, and incident cooperation;
- govern subprocessors and flow down equivalent terms;
- give the client visibility and a practical route to stop unlawful processing; and
- preserve evidence without placing call content or personal data in GitHub.

California is an important example: when serving a covered CCPA business, a person does not qualify as a service provider or contractor merely because the parties use that label. The contract must contain the specific restrictions and assistance provisions required by the statute and current regulations; missing terms can change the disclosure analysis. [CA-CCPA; CA-CCPA-REGULATIONS]

## State Comprehensive Privacy Laws

State laws differ materially in threshold, exemption, consumer definition, sensitive data, sale/share, targeted advertising, controller/processor duties, notices, rights, universal signals, assessments, contracts, cure, enforcement, and effective date. Sylvara's own size does not decide the issue: a covered client can impose processor duties, and some provisions or amended biometric/health triggers can apply without the usual numeric threshold.

Examples that drive the national engineering baseline include:

| Jurisdiction | Applicability concern | Engineering implication |
|---|---|---|
| California | Broad personal-information definition and detailed business/service-provider/contractor restrictions for a covered client | Specific processing contract, no secondary use or cross-client combination, rights and audit assistance, notice/data inventory |
| Colorado | Controller duties include transparency, minimization, care, sensitive-data consent, contracts and assessments; biometric amendments can apply beyond ordinary thresholds | No biometric or sensitive-data processing; purpose/data limits; processor contract; state review before real callers |
| Connecticut | Current amendments add lower or activity-based triggers, including high-risk sensitive, sale, and consumer-health processing | Never assume startup size exempts a workflow; block sensitive/health/sale activity |
| Texas | Broad scope subject to entity and small-business rules rather than one simple numeric consumer threshold; small businesses retain a sensitive-data-sale restriction | Determine client/Sylvara roles and exemption precisely; no sale or secondary use; processor contract and rights support |
| Washington consumer health | Consumer-health duties can apply outside HIPAA and include small businesses | Do not request or infer health; separate review, notice, consent, rights, contract, and security before any health workflow |

[CA-CCPA; CA-CCPA-REGULATIONS; CO-PRIVACY; CO-BIOMETRIC-2024; CT-PRIVACY; TX-PRIVACY; WA-CONSUMER-HEALTH]

This table is not a complete state privacy survey. Before a real pilot, counsel must identify every caller/client state and effective law, including consumer-health, biometric, children's, genetic, geolocation, data-broker, wiretap, marketing, and breach statutes. Sylvara adopts a nationwide product floor—minimize, disclose, purpose-limit, prohibit sale/training, secure, support rights, contractually control vendors, and delete—but that floor does not replace state-specific words, methods, timing, assessments, registrations, or records.

## Voice, Biometrics, And Inference

An ordinary audio recording is not necessarily a voiceprint. Risk changes when software measures voice to identify or authenticate a specific person, creates or retains an identity-capable template/embedding, or infers a sensitive trait.

Illinois BIPA expressly includes voiceprints in its biometric-identifier definition and, for covered collection, requires a public retention/destruction policy, written notice of collection/storage and purpose/term, and a written release. It restricts sale/profit and disclosure, requires reasonable protection, and provides a private action and statutory remedies. [IL-BIPA-DEFINITIONS; IL-BIPA-DUTIES; IL-BIPA-AMENDMENT]

Texas and Washington regulate covered voiceprints/biometric identifiers under different definitions and consent, disclosure, retention, security, and enforcement structures. Washington distinguishes ordinary audio and data generated from it from identity-used voiceprints. [TX-BIOMETRIC; WA-BIOMETRIC]

Therefore every environment must disable:

- speaker identification, verification, authentication, recognition, and cross-call linking;
- persistent speaker embeddings or templates, including opaque vendor “fraud” or diarization artifacts unless proven non-identifying and approved;
- voice cloning or imitation of a real person;
- emotion, mental/physical health, age, accent, ethnicity, nationality, gender, disability, or other protected/sensitive inference; and
- biometric model training, sale, sharing, or unrelated fraud/advertising use.

An unclear vendor response is treated as biometric processing and blocks the vendor. Enabling any item requires a necessity assessment, technical proof, biometric-specific multistate counsel review, consent/release and policy design, retention/destruction, security, vendor terms, and approval.

## Sensitive And Regulated Data

The AI may not request or accept payment-card/bank data, credentials, government identifiers, health information, children's information, precise location, biometric identifiers, protected-trait data, legal/insurance/credit/debt/tax facts, or other regulated data.

Conditional regimes include:

- HIPAA Privacy, Security, and Breach Notification Rules when a covered entity or business associate handles protected health information; a business-associate label or agreement is insufficient if the vendor chain and configuration cannot support the rules; [FED-HIPAA]
- the FTC Health Breach Notification Rule and state consumer-health laws for certain health data and technologies outside HIPAA; [FED-HEALTH-BREACH]
- the FTC Safeguards Rule for covered financial institutions; [FED-GLBA-SAFEGUARDS]
- COPPA for covered child-directed online services or actual knowledge of a child under thirteen; an audio file containing a child's voice is included in the rule's personal-information definition; [FED-COPPA]
- card-network and acquiring obligations under PCI DSS for environments that store, process, or transmit account data; PCI DSS is an industry standard, not a general privacy statute. [PCI-DSS]

The current design avoids these triggers rather than attempting regulated compliance. If a caller begins sharing prohibited data, interrupt without echo, end, contain any artifact, notify the privacy/security owner, and investigate vendor copies.

COPPA's narrow voice exception does not authorize a stored lead or transcript. It concerns temporary use of an audio file solely to respond to a child's specific request, with no other use/disclosure and immediate deletion. Do not rely on it without child-privacy counsel. [FED-COPPA-VOICE]

## Notice And Choice

Before a real caller supplies data, an approved notice must accurately describe the entity, AI role, purposes, data categories, audio/transcript behavior, recipients/subprocessors by category, training/secondary use, retention criteria, rights/request route, security/incident contact, and any optional processing. Provide just-in-time notice before a new purpose or sensitive field.

Consent is not a substitute for minimization or security. It must be freely given, specific, informed, unambiguous, and as easy to withdraw where the applicable rule requires those qualities. Do not bundle recording, marketing, text, sale/share, sensitive data, or unrelated purposes. Do not require consent to optional processing when a genuine equivalent no-processing route should exist.

Utah provides one example of why immediate AI identification is the safer national design: its current generative-AI law contains interaction- and profession-specific disclosure rules and a safe-harbor structure for clear disclosure at the outset. Sylvara discloses AI at the start everywhere, while still performing state-specific review. [UT-AI-DISCLOSURE]

## Security Standard

Before any real data, document and verify controls proportionate to the complete data flow:

1. **Inventory and ownership:** enumerate fields, metadata, inferences, prompts, logs, vendors, regions, roles, purposes, lawful authority, retention, rights, and system of record.
2. **Minimization and isolation:** deny unapproved fields and tools; separate development, demonstration, and production; never use production data in testing or model evaluation.
3. **Identity and access:** unique identities, least privilege, strong phishing-resistant administrator authentication where available, prompt access removal, periodic review, restricted vendor support.
4. **Secrets and keys:** approved secret stores, no prompt/source/log secrets, scoped credentials, rotation, revocation, and environment separation.
5. **Encryption and transport:** current protected transport; appropriate encryption at rest for retained data; controlled key access; no unapproved export/download.
6. **Application controls:** server-side authorization, input/output/tool allowlists, rate limits, abuse protection, prompt-injection resistance, safe errors, dependency and vulnerability management.
7. **Logging:** security events without raw audio, transcripts, PII, secrets, prompts, tool arguments, or vendor payloads; access-controlled integrity and retention.
8. **Vendor controls:** due diligence, contracts, subprocessor governance, data-location and deletion proof, incident notice, and monitored changes.
9. **Availability and safety:** bounded timeouts/retries, no unsafe fallback provider, human/accessibility path, emergency refusal, kill switch, rollback, independent readback.
10. **Assurance:** threat model, code/config review, synthetic tests, privacy/security review, vulnerability assessment, deletion test, access review, incident exercise, and remediation tracking.

Default the controlled demo to United States storage, processing, support, and administrative access. The DOJ Data Security Program can restrict specified transactions involving bulk U.S. sensitive personal data or government-related data and countries of concern. The controlled demo is designed far below those activity thresholds, but a vendor's ownership, personnel, subprocessors, region, and remote access still must be inventoried before any real data or scale. [FED-DOJ-DSP]

Do not publish exact live defenses that would materially enable abuse. Public GitHub contains policy and synthetic tests, not production identifiers, configurations, logs, caller data, incident evidence, or vulnerabilities.

## Retention And Deletion

There is no one legal retention period for every artifact. Set an approved schedule by data/purpose/jurisdiction, reconcile statutory records and legal holds, and never retain content merely because storage is inexpensive.

For the controlled demo:

- audio, transcript, summary, prompt trace, tool data, and content logs: no retention;
- fictional scenario values: session-only;
- application call identifier and caller number: do not ingest; carrier/access metadata follows the separately approved recipient and deletion map;
- aggregate metrics: only if non-linkable and necessary, with a short approved schedule;
- prior written tester authorization and minimal consent receipt: Restricted, segregated, purpose-limited evidence with fields, linkage, access, and retention approved by counsel;
- private test evidence: synthetic test ID and configuration/script result only, for the approved quality/security schedule; and
- carrier/vendor metadata: shortest available contractually verified schedule, restricted access, no unrelated use.

Deletion must cover primary records, derived data, indexes, exports, support copies, queues, caches, backups according to documented aging, subprocessors, and model-training pipelines. Validate deletion with a synthetic sentinel. A user-interface delete button is not sufficient evidence.

## Privacy Rights

Before a pilot, provide a verified intake and identity process for access, correction, deletion, portability, opt-out, restriction, consent withdrawal, and appeal where applicable. Minimize authentication data and prevent one person's request from exposing another's information. The client and Sylvara must know who responds, who searches each vendor, what exceptions apply, and how completion is proved.

A service provider that receives a request directly should follow the applicable contract/law—often assisting or directing the request to the controller—not improvise a response or disclose client data.

## Incident And Breach Response

All U.S. states have breach-notification laws, but definitions, risk tests, affected data, timing, regulator/consumer-reporting notices, and processor duties differ. Kansas requires investigation and risk-based notice without unreasonable delay under its statute; Missouri requires owner/licensee notice without unreasonable delay under its test and immediate maintainer-to-owner notice, with specified documentation duties. California and Texas illustrate additional security, resident, Attorney General, timing, and threshold rules that must be applied to affected residents rather than Sylvara's office location. [KS-BREACH-DEFINITIONS; KS-BREACH-NOTICE; MO-BREACH; CA-SECURITY; CA-BREACH; TX-BREACH]

Contractual vendor notice must arrive early enough for Sylvara and the client to investigate and meet the shortest applicable deadline; “within the statutory period” is not a usable subprocessor SLA.

On suspected exposure:

1. stop new calls and unapproved processing;
2. contain access and preserve minimal, restricted evidence without copying content into GitHub or chat;
3. identify affected people, data, systems, vendors, locations, acquisition/access, and time window;
4. rotate/revoke credentials and remove unsafe integrations;
5. notify the private incident, privacy, client, insurer, and counsel owners under the approved plan;
6. have counsel decide regulator, consumer, contractual, law-enforcement, and public notice;
7. remediate, independently verify, and document deletion/recovery; and
8. do not restore service until the control and approval are re-established.

Never promise secrecy, suppress legally required notice, or publish sensitive incident detail in a public issue or pull request.
