# Kansas, Missouri, And Interstate Jurisdiction Controls

**Status:** Proposed research and control baseline; no launch authorization; representative interstate review, not a fifty-state opinion

**Verified:** 2026-08-04

Kansas and Missouri are the initial Kansas City jurisdictions, but a call can implicate the law of a participant's location and another state with a materially greater interest. A telephone number, server, carrier account, or Sylvara office in Kansas does not fix governing law. This file provides the initial local baseline and examples that drive a nationwide conservative design; it does not authorize operation in an unreviewed state.

Source IDs in brackets resolve through the [official source register](official-source-register.md).

## Kansas

Kansas's general consumer-protection definitions and deceptive-practice prohibition apply independently of the telemarketing provisions when their consumer-transaction scope is met. They prohibit material misrepresentation and other deceptive practices; AI identity, capability, affiliation, security, savings, and service-result claims must be truthful and substantiated. [KS-KCPA-DEFINITIONS; KS-KCPA-DECEPTIVE]

### Recording And Interception

K.S.A. 21-6101 prohibits interception of a private telephone message without consent of the sender **or** receiver, establishing a participant/one-party baseline for a Kansas-only call. Kansas Attorney General opinions have concluded that a participant's consent can support recording and that ownership of the telephone system alone is not a substitute for the actual user's consent. Later disclosure or use may still create privacy exposure. [KS-RECORDING; KS-AG-RECORDING-1993; KS-AG-MONITORING-1978]

**Sylvara control:** do not use the Kansas minimum for an interstate service. Obtain keypad assent before speech recognition and separate all-party consent before any recording or retained transcription. Document consent of any employee, human agent, interpreter, or new participant.

### Consumer Calls And No-Call

K.S.A. 50-670 regulates calls to residences and mobile numbers for solicitation. For covered unsolicited consumer calls it includes immediate caller/business/purpose identification, termination after a negative response, disconnection and answer timing, caller-ID, automated dialing-announcing device, relationship, and five-year stop-request rules. An automated answer message may identify the caller/business but may not contain an unsolicited advertisement. Violations can be unconscionable practices under the Kansas Consumer Protection Act. [KS-CONSUMER-CALLS]

K.S.A. 50-670a uses the federal registry as the Kansas no-call list and requires a covered caller to check it before the campaign and at least every 30 days. Kansas's business-number defense is fact-specific; a mobile or personal number does not become exempt merely because the recipient works for a business. [KS-NO-CALL]

**Sylvara control:** the controlled inbound synthetic telephone profile is internal, non-sales QA by authorized staff or contractors; it does not solicit, sell, induce purchase, or follow up. A prospect-facing demonstration is a separate commercial workflow. Any prospect call, outbound activity, real sales, or automated advertising feature requires a Kansas campaign analysis, registry process, identification/termination controls, suppression records, and review of federal duties.

### Security And Breach

K.S.A. 50-6,139b requires a holder of personal information to maintain reasonable procedures, use reasonable care against unauthorized access/use/modification/disclosure, and reasonably destroy records when no longer retained. Kansas's breach law requires investigation and, when the statutory risk condition is met, notice without unreasonable delay; a maintainer must notify the owner/licensee, and larger notices can trigger consumer-reporting-agency notice. [KS-DATA-SECURITY; KS-BREACH-DEFINITIONS; KS-BREACH-NOTICE]

The statutory breach definition is narrower than Sylvara's internal data classification. Audio and transcripts may contain or reveal far more than the enumerated fields. Sylvara treats audio, transcripts, prompts, summaries, call metadata linked to a person, and consent evidence as **Restricted** under the canonical [data-classification policy](../security/data-classification.md), even when one Kansas definition would not cover the item.

The targeted current-source review found no generally applicable Kansas omnibus commercial privacy or biometric statute. That is not permission to collect broadly or enable voiceprints; participant-state, client, federal, contract, and consumer-protection duties remain.

## Missouri

Missouri's Merchandising Practices Act prohibits deception, false promise, misrepresentation, unfair practice, and material concealment in covered trade or commerce. It applies independently of the telemarketing chapter and requires accurate service limitations, AI identity, client affiliation, price/refund terms, and performance claims. [MO-MMPA]

### Recording And Civil Exposure

RSMo 542.402 permits interception when a non-law-enforcement person is a party or one party gave prior consent, unless done to commit a criminal or tortious act. RSMo 542.418 provides a civil action and specified damages and remedies for unlawful interception. [MO-RECORDING; MO-RECORDING-CIVIL]

**Sylvara control:** use the same nationwide keypad/all-party controls; Missouri's minimum does not answer interstate choice of law.

### Inbound Sales And Generated-Voice Disclosure

Missouri is operationally important because its telemarketing definition can include inbound activity. RSMo 407.1070 covers a multi-call plan or campaign intended to induce purchases and defines a telemarketer to include a recorded, computer-generated, electronically generated, or other voice that initiates **or receives** calls. RSMo 407.1073 requires prompt disclosures and disclosure at the beginning that such a voice is used. [MO-TELEMARKETING-DEFINITIONS; MO-TELEMARKETING-DISCLOSURE]

Additional provisions address harassment, called-party-local hours, stop requests, caller-ID, records, remedies, and fact-specific consumer-initiated, permission, established-relationship, regulated-entity, and business-call exemptions. Missouri telemarketing records can be required for 24 months. [MO-TELEMARKETING-CONDUCT; MO-TELEMARKETING-RECORDS; MO-TELEMARKETING-REMEDIES; MO-TELEMARKETING-EXEMPTIONS]

**Sylvara control:** identify the AI and exact purpose at the start everywhere. Do not call a production receptionist or prospect demo “exempt” merely because the other person called in. Determine whether the actual repeated workflow is intended to induce a purchase and whether a specific exemption applies. The controlled telephone profile is internal QA only: it uses no solicitation, transaction, upsell, prospect, or real conversation/application data. Unavoidable ANI and carrier metadata remain Restricted and follow the approved metadata map.

### Missouri No-Call

Missouri separately defines telephone solicitation to include voice and specified text/multimedia messages, with fact-specific exceptions. Its statutes create a Missouri no-call list and prohibit covered calls to listed residential subscribers. The Missouri Attorney General instructs covered telemarketers to register for the list and use updated quarterly data, including callers located outside Missouri. [MO-TELEPHONE-SOLICITATION; MO-NO-CALL-PROHIBITION; MO-NO-CALL-LIST; MO-NO-CALL-GUIDANCE]

**Sylvara control:** no outbound or automated message is enabled. If a future campaign is approved, retrieve current registration, list, fee, exception, and refresh requirements at launch rather than hard-coding them.

### Missouri Breach

RSMo 407.1500 covers specified personal, medical, and health-insurance information; requires owner/licensee notice without unreasonable delay under its test; requires a maintainer to notify the owner/licensee immediately after discovery; requires five-year retention of a documented no-notice risk determination; and has additional notice rules for larger incidents. [MO-BREACH]

The targeted review found no general Missouri commercial biometric statute. Ordinary audio is not automatically a biometric identifier, but identification-capable voice data can be regulated by another participant's state. All voiceprint, speaker-ID, embedding, cloning, and sensitive-inference features remain off.

The targeted current official-code review found no enacted omnibus controller/processor privacy law in Kansas or Missouri. Treat that as a dated finding, not a permanent conclusion or an exemption from breach, consumer, recording, contract, tort, sector, or another state's law.

## Representative Interstate Recording Matrix

This table identifies high-risk examples that justify the strict nationwide control. It is intentionally not exhaustive and does not summarize every exception, case, remedy, or covered technology.

| Jurisdiction | Primary-source baseline | Sylvara control |
|---|---|---|
| Kansas | Sender **or** receiver consent for private telephone message [KS-RECORDING] | Never use the one-party minimum as nationwide policy |
| Missouri | Party or one-party prior consent, absent criminal/tortious purpose [MO-RECORDING] | Same nationwide control |
| California | All-party consent for covered confidential communications and specified cellular/cordless calls; statutory civil remedy [CA-RECORDING; CA-MOBILE-RECORDING; CA-RECORDING-CIVIL] | Explicit assent before speech processing; separate affirmative consent before recording |
| Florida | Prior all-party consent is the ordinary participant rule; statutory civil remedy [FL-RECORDING; FL-RECORDING-CIVIL] | No capture before affirmative consent |
| Washington | All-participant consent for covered private calls; an effective recorded announcement can establish consent [WA-RECORDING] | Explicit keypad consent; if recording is ever approved, record the post-consent confirmation |
| Pennsylvania | Prior consent of all parties for the ordinary participant exception; statutory civil remedy [PA-RECORDING; PA-RECORDING-CIVIL] | Prior affirmative all-party consent |
| Maryland | Participant interception generally requires prior consent of all parties; statutory civil remedy [MD-RECORDING; MD-RECORDING-CIVIL] | Prior affirmative all-party consent |
| New Hampshire | Ordinary participant interception requires all-party consent; statutory civil remedy [NH-RECORDING; NH-RECORDING-CIVIL] | Prior affirmative all-party consent |
| Massachusetts | Statute targets secret interception and defines interception by lack of prior authority of all parties [MA-RECORDING] | Clear disclosure plus affirmative consent; never record secretly |
| Illinois | Prohibits surreptitious recording/transcription of covered private conversation without all other parties' consent [IL-RECORDING-DEFINITIONS; IL-RECORDING] | Treat recording and transcript generation as one gated feature |
| Montana | Prohibits hidden recording of covered conversation without all-party knowledge, subject to exceptions [MT-RECORDING] | Clear disclosure plus affirmative consent |
| Connecticut | Official legislative analysis describes the private-call knowledge rule and notice methods [CT-RECORDING-ANALYSIS] | Treat as strict pending current deployment-specific counsel review |

## Operational Choice-Of-Law Rule

1. Never default to Kansas or Missouri law because Sylvara, a server, the client, or the number is there.
2. Assume the actual location of every participant may matter.
3. Area code, billing address, IP location, and caller ID are risk signals, not reliable proof.
4. Treat unknown participant location as strict.
5. Use a carrier-level one-way IVR/media gate so inbound audio is discarded and reaches no AI, speech, model, observability, support, buffer, or abuse/fraud system until the fixed disclosure plays and keypad assent is received; turning off speech recognition alone is insufficient.
6. Require a new assent/consent decision when a new participant, interpreter, conference, transfer, purpose, or processing mode appears.
7. Keep recording and retained transcription off unless the approved state matrix and exact vendor path permit them.
8. Maintain a separate counsel-approved matrix for telemarketing, mini-TCPA, automated voice, text, DNC, registration/bond, caller-ID, privacy, biometric, breach, AI, consumer-protection, accessibility, and sector duties.
9. If a state, participant, feature, or required source is missing, fail closed.
10. Block international calls until country-specific review.

For example, Florida law can create a presumption about calls to Florida area codes, and covered commercial telephone sellers may have licensing duties subject to statutory exemptions. These are reasons not to treat phone-number geography as harmless. [FL-TELEPHONE-SOLICITATION; FL-SELLER-LICENSE; FL-SELLER-EXEMPTIONS]

## Recording-Enabled Feature Gate

Recording and retained transcription are currently prohibited. If ever proposed, the minimum technical design is:

1. a carrier-level one-way IVR/media gate that discards inbound audio without downstream forwarding; carrier recording, speech recognition, transcript logging, transport buffers beyond necessary delivery, debug audio, QA capture, monitoring, and vendor training off at connection;
2. static notice of the exact purposes, recipients, retention, and no-recording alternative;
3. keypad consent with no speech recognition used to obtain it;
4. a minimal immutable consent event with script/version, purpose, timestamp, participant count, known jurisdiction signals, configuration version, and keypad result;
5. recording/transcription activation only after the consent event succeeds;
6. an immediate post-activation confirmation captured in the recording;
7. any other key, silence, error, stale policy, or uncertain state leaves capture off;
8. any new participant or purpose pauses capture and requires refreshed consent;
9. any withdrawal phrase stops capture immediately; and
10. recurring sentinel tests prove no pre-consent audio was forwarded or retained in carrier storage, transport buffers, fraud/abuse systems, support paths, model logs, observability, QA, backups, or subprocessors.

Counsel must still approve the actual wording, accessibility method, language/capacity issues, employee/agent monitoring, locations, proof, withdrawal, retention, and use/disclosure. A technical consent event is evidence, not a legal conclusion.
