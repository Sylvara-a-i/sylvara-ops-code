# Telephony, Recording, And Messaging Controls

**Status:** Proposed controls; telecom and state-law counsel review required

**Federal rules checked:** 2026-08-04 against the current eCFR through 2026-08-03

Source IDs in brackets resolve through the [official source register](official-source-register.md). “AI disclosure” and the strict nationwide assent flow are Sylvara controls unless a cited jurisdiction independently requires them.

## Inbound Is The Safe Starting Point

The TCPA restricts specified calls that a caller makes or initiates using an automatic telephone dialing system or artificial/prerecorded voice. The FCC has confirmed that current AI-generated human voices and voice clones are “artificial voice.” It has also stated that those call-initiation prohibitions do not extend to technology used to answer an inbound call. [FED-TCPA; FED-TCPA-RULE; FED-FCC-AI-VOICE; FED-FCC-AI-NPRM]

Accordingly, the genuine inbound leg of the proposed controlled demo is outside the TCPA's artificial-voice call-initiation restriction. This conclusion does not exempt:

- a callback, reminder, confirmation, voicemail, text, email, or later campaign;
- recording/interception, privacy, security, accessibility, impersonation, or consumer-protection law;
- an inbound sales campaign covered by the FTC Telemarketing Sales Rule; or
- a state law that uses broader definitions or imposes separate registration, consent, suppression, disclosure, or record duties.

The platform must technically disable every outbound channel. A prompt instruction alone is not a channel control.

## Communication Matrix

| Flow | Current disposition | Why |
|---|---|---|
| Authorized Sylvara staff/contractor dials dedicated non-public internal-QA number; AI only answers after carrier-gated assent | Proposed after all internal-QA gates close | No Sylvara-initiated TCPA call and no purchase-inducement purpose; strict privacy, interception, disclosure, evidence, and safety controls still apply |
| Prospect or lead dials a product-demo number after sales outreach | Prohibited pending commercial-demo review | A product demonstration can be part of a multi-call plan or campaign to induce purchase; “inbound” and “no sale on the call” do not establish a TSR or state exemption |
| Ordinary real customer calls a plumber for intake | Pilot gate | Inbound leg is lower TCPA risk, but facts, state law, recording, privacy, accessibility, truthful business rules, and any upsell still require review |
| Caller asks a trained human to call back about the same service | Separate live-human workflow gate | It is a new outbound call; document the exact request, number, purpose, and narrow time window; do not add marketing |
| AI callback, reminder, confirmation, interactive call, or voicemail | Prohibited until campaign-specific approval | It is a new artificial-voice outbound call; consent, identification, opt-out, DNC, revocation, timing, caller ID, records, and state rules may attach |
| AI marketing, reactivation, cross-sell, cold lead, or B2B prospecting to mobile numbers | Prohibited | Marketing artificial-voice calls are high risk; business mobile numbers do not create a general TCPA exemption |
| Automated text or email | Prohibited in demo; separate channel review | A voice-call request is not blanket consent for another channel; TCPA can cover texts and CAN-SPAM covers commercial email, not SMS |

## Federal TCPA And FCC Rules For Any Future Outbound Flow

These are **binding when applicable**. Do not implement them as a generic checkbox; counsel must classify the called line, content, purpose, technology, and exemption for the exact flow.

### Consent

- Artificial/prerecorded voice calls to wireless, paging, emergency, hospital patient/guest, or other recipient-charged lines generally require prior express consent unless an emergency-purpose or other rule exception applies. [FED-TCPA-RULE]
- Calls that introduce advertising or telemarketing to covered wireless/charged lines, and artificial/prerecorded residential telemarketing calls, generally require prior express written consent. [FED-TCPA-RULE]
- The writing must authorize the specified seller to deliver or cause the covered marketing calls to the specified number, clearly disclose the technology and authorization, and say consent is not a condition of purchase. A qualifying electronic signature can be used. [FED-TCPA-RULE; FED-ESIGN]
- The FCC's proposed “one-to-one consent” revision was vacated before it took effect; the prior regulatory definition was reinstated. Do not describe the vacated revision as current law. A particular seller and actual scope should nevertheless be named, because generic lead consent is poor evidence and other law may be stricter. [FED-FCC-CONSENT-RESTORATION]
- A commercial label such as “emergency plumbing” is not automatically an FCC emergency-purpose call. The exception concerns situations affecting health and safety. [FED-TCPA-RULE]

### Identification And Opt-Out

Every outbound artificial/prerecorded voice message must identify the responsible entity at the beginning; a business must use its registered name. It must provide a non-premium contact number during or after the message. Covered marketing and exempt residential messages need the rule-specified automated opt-out; a voicemail needs the required callback opt-out. [FED-TCPA-RULE]

This is different from saying “I am an AI.” As of the verification date, the FCC's AI-specific start-of-call disclosure is proposed, not a final codified federal rule. Sylvara still requires immediate AI identification on every call as a non-deception and state-law control. [FED-FCC-AI-NPRM; FED-FTC-ACT; FED-IMPERSONATION-RULE]

### Time, Suppression, And Reassigned Numbers

For telephone solicitations, the federal rule includes called-party-local hours, National Do Not Call controls, a registry version no more than 31 days old, written procedures, training, entity-specific suppression, and five-year entity-specific request records. An established business relationship does not replace consent required for an artificial-voice marketing call, and an entity-specific request overrides the relationship. [FED-TCPA-RULE]

Use the Reassigned Numbers Database immediately before any approved recurring outbound program and preserve query/result evidence if relying on its safe harbor. A number owner's consent does not follow a reassigned number. [FED-RND]

### Revocation

Current rules accept any reasonable method that clearly communicates revocation, including the enumerated voice/key-press, reply-text keywords, and designated contact paths. A caller cannot force one exclusive revocation route. Honor a request as soon as practicable and no later than ten business days. A narrowly constrained nonmarketing confirmation text may be permitted. [FED-TCPA-RULE]

The FCC's 2026 waiver delays only the rule that would make revocation in response to one type of informational message revoke consent for unrelated future robocalls or robotexts. That cross-category requirement is delayed through 2027-01-31; the other reasonable-method, processing-time, confirmation, and do-not-call provisions remain effective. Build a global suppression default now and do not misstate the entire revocation rule as delayed. [FED-FCC-REVOCATION-WAIVER]

### Liability

The TCPA authorizes private claims for actual loss or statutory amounts per violation, with discretionary trebling for willful or knowing violations. A seller can face liability for calls made on its behalf; allocating duties to Sylvara or a vendor does not erase statutory exposure. [FED-TCPA]

## FTC Telemarketing Sales Rule

The TSR applies to a plan, program, or campaign conducted to induce purchase or a charitable contribution that involves more than one interstate telephone call. A telemarketer can initiate **or receive** calls. [FED-TSR]

### Inbound And Business Calls

- An unsolicited consumer-initiated inbound call is generally exempt, but any upsell is not. [FED-TSR-EXEMPTIONS]
- A call responding to general media advertising is often exempt, subject to the rule's listed categories, payment restrictions, and upsell limitation. A direct-mail response has additional disclosure conditions. [FED-TSR-EXEMPTIONS]
- Most business-to-business calls retain a broad exemption, but current rules apply prohibitions on material misrepresentations and false or misleading statements used to induce payment or purchase. Sylvara must not invent capabilities, clients, integrations, savings, licensing, price, availability, uptime, dispatch, or human involvement. [FED-TSR-2024; FED-TSR]

“Inbound” and “B2B” are therefore facts to classify, not universal safe harbors. A demonstration offered to prospects can itself be part of a plan or campaign intended to induce purchase even if the call takes no payment and closes no sale. The controlled telephone profile is limited to internal, non-sales QA. A prospect-facing telephone demo is blocked until counsel classifies the campaign and approves the responsible seller/telemarketer identity, sales purpose, merchandise, script, invitations, disclosures, exemptions, records, and state treatment. No demo may sell, upsell, collect payment, or complete a transaction.

### Covered Campaign Controls

If the TSR applies, classify and implement all relevant disclosures, non-misrepresentation rules, payment authorization, abandonment, calling-time, caller-ID, Do Not Call, prerecorded-message consent/opt-out, and record duties. A fully dynamic AI sales conversation presents unresolved questions under the TSR's prerecorded-message and sales-representative concepts even though TCPA artificial-voice coverage is clear. Keep it prohibited unless counsel approves the exact technology and flow. [FED-TSR; FED-FTC-AI-TELEMARKETING]

Covered activity can require five years of records for materially different scripts and messages, detailed call facts, transfers and dispositions, consent presentation and evidence, business-relationship data, vendor contracts, suppression lists, and the registry version used. Written allocation is possible, but the seller must retain access; unclear allocation can leave both seller and telemarketer responsible. [FED-TSR-RECORDS]

## Caller ID And Telecommunications Provider Boundary

Do not knowingly cause misleading or inaccurate caller identification with intent to defraud, cause harm, or wrongfully obtain value. Approved telemarketing must transmit the required number and name information and cannot block it. Use only a number and brand the client or provider has authorized, with a working callback and suppression route. [FED-CALLER-ID-RULE; FED-CALLER-ID-DELIVERY; FED-TSR]

Sylvara's proposed architecture uses an established carrier account and application-layer voice software. It does not sell or resell numbers, PSTN/VoIP access, call origination, or multi-line telephone-system management. If that changes, voice-service-provider, STIR/SHAKEN, Robocall Mitigation Database, 911, customer-network-information, state utility, tax, fee, registration, and licensing duties require specialist review before implementation. [FED-STIR-SHAKEN; FED-RMD; FED-911-VOIP; FED-911-MLTS]

## Recording, Transcription, Monitoring, And AI Processing

Federal law prohibits intentional interception, use, or disclosure except where an exception applies and provides a federal participant/one-party-consent baseline unless the interception has a criminal or tortious purpose. Stricter state laws are not displaced. Real-time transcription or model processing may be an interception even if no audio file is retained. [FED-WIRETAP; FED-WIRETAP-CIVIL]

State statutes differ in covered technologies, confidentiality expectations, required parties, permitted purpose, notice form, and remedies. Kansas and Missouri generally use participant/one-party baselines; California, Florida, Pennsylvania, Washington, and other states can require all-party consent for covered communications. Interstate choice of law is not reliably determined by area code. [KS-RECORDING; MO-RECORDING; CA-RECORDING; FL-RECORDING; PA-RECORDING; WA-RECORDING]

Sylvara therefore requires:

1. no retained recording, transcript, human monitoring, content log, or model training in the controlled demo;
2. prior written tester authorization and a pre-call metadata/privacy notice for the internal-QA profile;
3. a carrier-level one-way IVR/media gate that plays the static disclosure and discards inbound audio without forwarding it to any voice, speech, model, observability, support, buffer, or abuse/fraud recipient before assent;
4. keypad assent before the carrier connects inbound media to the AI runtime, with termination for every other input, silence, error, or withdrawal;
5. a counsel-approved minimal consent receipt segregated from analytics and call content;
6. separate, recording-specific notice and affirmative agreement **before** capture if retention is ever enabled;
7. a genuine no-recording alternative for real service;
8. private proof of the exact deployed notice, media routing, consent decision, ANI/metadata flow, configuration, vendor behavior, retention, and deletion; and
9. a current state matrix and counsel approval for every intentionally served jurisdiction.

Turning off speech recognition does not by itself prevent interception: RTP/media may already be forwarded or buffered, and a person may speak over the greeting. Do not say “not recorded,” “not stored,” “zero retention,” or “not used for training” until the carrier, voice platform, speech/model provider, observability tools, subprocessors, transport buffers, backups, error logs, abuse/fraud systems, support access, and human-review paths have been verified. If the carrier cannot prevent pre-assent inbound media from leaving its one-way IVR gate, the telephone test is blocked. Any future speech-based consent requires counsel to decide whether transient recognition of the response is itself a regulated interception or transcription.

## Text Messages

Texts can be TCPA “calls.” Applicability can depend on the dialing technology, content, recipient, consent, and state law. CAN-SPAM does not govern SMS. A request during a call is not consent to marketing texts, and consent to one client/purpose is not a reusable lead asset. [FED-TCPA; FED-TCPA-RULE]

The demo sends no text. A future one-time informational link may be considered only after the person expressly requests that exact message, the number and purpose are confirmed, required identity and stop handling are implemented, the carrier's registration rules are satisfied, and counsel approves the state/channel analysis. Marketing texts remain prohibited.

## Email

Commercial email must use accurate transmission and header information, a nondeceptive subject, required advertising identification absent qualifying prior consent, a valid physical postal address, and a functioning opt-out that remains available for the statutory period and is honored within ten business days. Transactional or relationship content is exempt only within the regulatory definition; mixed content can become commercial based on subject and prominence. [FED-CAN-SPAM; FED-CAN-SPAM-PRIMARY-PURPOSE]

The demo sends no email. Any future email requires its own approved purpose, content classification, sender, suppression process, privacy notice, retention, and proof.

## Accessibility And Relay Calls

Covered public accommodations must provide effective communication and appropriate auxiliary aids unless a legal exception applies. The ADA regulation specifically addresses automated attendants, voicemail/messaging, and interactive voice systems receiving incoming calls: they must support effective real-time communication with TTY and FCC-approved relay systems. Relay calls must be handled like other calls. [FED-ADA-COMMUNICATION; FED-ADA-GUIDE]

Do not reject a relay assistant as a bot or fraud signal, add a surcharge, or shorten the session because of pauses. Test relay/TTY behavior, speech and keypad paths, extended timeouts, interruption, and an accessible human or web alternative. Client coverage and the exact alternative require counsel review.

## Emergency And 911 Boundary

The receptionist is not a public-safety answering point, emergency service, interconnected VoIP offering, or multi-line telephone system. It must never promise to contact or dispatch help. For imminent danger, it tells the caller to end the call and contact emergency services or an approved utility emergency line. It must not auto-dial or bridge 911 because cloud caller identity and location can be wrong and the handoff can delay response.

If Sylvara ever provides outbound calling capability, numbers, VoIP/PSTN service, or MLTS management, FCC 911 classification, routing, location, notification, warning, and acknowledgment duties require telecom counsel. Never test with live 911 without carrier and public-safety coordination. [FED-911-VOIP; FED-911-MLTS; FED-911-GUIDE]

## Evidence For Any Approved Outbound Campaign

At minimum, preserve privately:

- client legal name and specific seller identity;
- call/text purpose, content class, direction, called-line type, states, and local-time rule;
- the exact presented consent text, version/hash, unchecked affirmative act/signature, specified number and channels, not-a-purchase-condition disclosure, timestamp, attribution evidence, confirmation, and revocation history;
- National and entity-specific suppression evidence, registry access/version, reassigned-number query, and time-zone calculation;
- deployed script/message, AI/artificial-voice classification, caller-ID authorization, callback/opt-out behavior, carrier and vendor;
- call disposition, transfers, errors, complaints, and required retention classification; and
- written allocation of seller, telemarketer, vendor, suppression, privacy-request, and incident duties.

Audio is not the default consent record. Retain only what the controlling rule and approved schedule require, restrict access, and apply litigation holds separately.
