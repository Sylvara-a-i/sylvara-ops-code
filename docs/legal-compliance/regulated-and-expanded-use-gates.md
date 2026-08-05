# Regulated And Expanded Use Gates

**Status:** Every item below is prohibited or conditional; none is approved

The controlled demo deliberately avoids regulated data and consequential activity. Adding one field or tool can change Sylvara's legal role, the client's duties, and the required notice, consent, contract, security, record, registration, or license. The table is a routing device, not a substitute for a legal review.

| Expansion | Current status | Why it changes the analysis | Minimum reopen evidence |
|---|---|---|---|
| Prospect-, lead-, customer-, reseller-, or sales-facing telephone demonstration | Prohibited; offline/prerecorded synthetic simulation only | A product demonstration can be part of a plan or campaign intended to induce purchase even without a sale on the call; federal/state telemarketing identity, purpose, merchandise, disclosure, exemption, record, and registration questions may attach | Commercial-demo campaign classification; exact seller/telemarketer and merchandise; invitation path; approved script/disclosures; state matrix; records; counsel opinion; end-to-end evidence |
| Outbound AI voice, voicemail, reminder, confirmation, reactivation, prospecting, or marketing | Prohibited | TCPA artificial-voice consent, identity, opt-out, revocation, DNC, timing, caller-ID, reassigned-number, TSR, state mini-TCPA and registration duties | Campaign-specific telecom opinion; seller-specific consent; suppression and record system; carrier approval; state matrix; end-to-end tests |
| Automatic text, missed-call text, or email | Prohibited in demo | New channel and purpose; TCPA/state text law, carrier policy, privacy, CAN-SPAM for commercial email, and suppression may attach | Channel-specific consent and content classification; sender/brand registration; stop handling; notice; retention; state review |
| Recording, retained transcript, live monitoring, QA snippet, or model training | Prohibited | Federal/state interception, privacy, biometric, vendor, labor, data-right, security, and retention rules may attach from the first packet | All-party/state analysis; exact pre-capture disclosure; consent proof; no-recording alternative; vendor settings/terms; retention/deletion; access controls |
| Real name, contact, address, appointment, work order, CRM, calendar, or dispatch | Prohibited in demo; pilot gate | Personal data, consumer expectations, contractual promises, client instructions, state privacy/breach, accuracy, access, and deletion attach | Field-level data inventory; processor/service-provider terms; approved notice; system ownership; minimization; correction/deletion; readback and rollback |
| Price, estimate, sale, contract, refund, cancellation, or binding promise | Prohibited | Consumer-protection, telemarketing disclosure, authorization, e-sign/contract, licensing, tax, and client-agency issues | Approved source of truth; deterministic authority limits; counsel-approved terms; human confirmation; audit/readback; complaint/refund path |
| Payment card, bank, wallet, credit, debt, or financial account data | Prohibited by voice | PCI DSS and network/card-brand obligations, state breach laws, financial privacy and payment authorization risks; voice artifacts expand card-data scope | Use an approved hosted payment page outside audio; payment/security review; processor contract; no card data in AI vendors or logs; tested tokenized result only |
| Healthcare, symptoms, patient scheduling, prescriptions, or health inference | Prohibited | HIPAA may require business-associate agreements and Privacy/Security/Breach controls; non-HIPAA consumer-health and FTC rules may also apply | Entity/data-flow determination; BAA chain where required; state consumer-health review; minimum necessary design; approved vendors, notices, rights, retention, incident plan |
| Financial institution, insurance, credit, lending, debt collection, or tax/legal advice | Prohibited | GLBA, FCRA/ECOA, FDCPA, state licensing/consumer laws, professional-practice and consequential-decision rules may apply | Specialist legal opinion; licensing and role proof; sector contracts/notices; human review; adverse-action/appeal controls where applicable |
| Employment, housing, education, health-care eligibility, insurance, lending, essential government service, or public-benefit decision | Prohibited | Anti-discrimination, notice, access/correction, human review, impact assessment, record, and automated-decision laws may attach | Jurisdiction and decision inventory; civil-rights review; bias/impact assessment; validated data; meaningful human decision; notice, correction, appeal, monitoring |
| Children or a child-directed experience | Prohibited | Children's voice/audio and identifiers can trigger COPPA and stricter state design/privacy duties; valid parental consent and deletion are complex | Age/audience and child-law opinion; verifiable parental-consent design if allowed; child-safe data and content controls; deletion; vendor eligibility |
| Voiceprint, speaker recognition, voice authentication, voice cloning, liveness, emotion, health, accent, or protected-trait inference | Prohibited | Biometric and consumer-protection laws can require written notice/release, purpose/retention policy, reasonable care, consent, deletion, and can create private liability | Biometric-specific multistate opinion; necessity and proportionality; written consent/release; public retention/destruction policy; vendor proof; security; no secondary use |
| Real person's voice or real client's brand in a demo | Prohibited without written scope | Impersonation, publicity/personality, copyright, trademark, false endorsement, and client authorization concerns | Written rights and brand approval; exact voice/source provenance; approved script and use period; revocation/termination procedure |
| Emergency intake, triage, alarm, public-safety transfer, or automatic 911 | Prohibited | Location, routing, dispatch, professional standard, public-safety, VoIP/MLTS, consumer reliance, and negligence risks | Specialist public-safety/telecom review; location integrity; carrier/PSAP coordination; licensed human procedures; tested failover; never live-test 911 casually |
| Telephone-number/PSTN/VoIP resale, origination service, or MLTS operation | Prohibited | Carrier/provider status can trigger FCC/state authorization, STIR/SHAKEN, robocall mitigation, 911, CPNI, CALEA, tax, fee, and reporting duties | Telecom classification opinion; registrations; carrier architecture; 911/location plan; CPNI/CALEA program; state utility/tax review |
| International caller or non-U.S. client/data location | Prohibited until country review | Extraterritorial privacy, ePrivacy/direct-marketing, recording, data-transfer, localization, consumer, telecom, AI, and employment laws may apply | Country-specific counsel; lawful transfer/processor terms; regional architecture; rights/notice/retention; marketing and recording consent analysis |

## Conditional Federal Regimes

These authorities are **conditional** and are indexed in the [official source register](official-source-register.md):

- HIPAA rules for covered entities and business associates, and the FTC Health Breach Notification Rule for certain non-HIPAA health technologies; [FED-HIPAA; FED-HEALTH-BREACH]
- the FTC Safeguards Rule for covered financial institutions; [FED-GLBA-SAFEGUARDS]
- COPPA for operators of covered child-directed services or those with actual knowledge of under-thirteen users; voice recordings can be personal information; [FED-COPPA]
- E-SIGN for qualifying electronic records and signatures, without changing the substantive consent requirements; [FED-ESIGN]
- ADA effective-communication requirements for covered public accommodations; [FED-ADA-COMMUNICATION]
- FCC 911, STIR/SHAKEN, Robocall Mitigation Database, CPNI, and CALEA obligations if actual conduct makes Sylvara a covered provider or system operator. [FED-911-VOIP; FED-STIR-SHAKEN; FED-RMD; FED-CPNI; FED-CALEA]

PCI DSS is a payment-card industry standard and contractual ecosystem requirement, not a general statute. Compliance with it would not answer telephony, privacy, authorization, or consumer-law questions. The current control is stronger and simpler: the AI does not receive card data; any future payment uses an approved hosted payment page and returns only the minimum tokenized business result. [PCI-DSS]

## State Privacy, Biometric, Consumer-Health, And AI Expansion

State comprehensive privacy laws differ in thresholds, exemptions, controller/processor roles, notices, data rights, sensitive-data consent, assessments, sale/share/targeted-advertising opt-outs, universal signals, contracts, and cure/enforcement. Small-company or B2B exemptions are not uniform. A client's coverage can impose processor duties on Sylvara even if Sylvara would not independently meet a threshold. [CA-CCPA; CO-PRIVACY; TX-PRIVACY]

Voice data is not necessarily a biometric identifier merely because it is audio. It becomes materially higher risk when used to identify a person, create a voiceprint/template, authenticate, or infer sensitive traits. Illinois, Texas, Washington, and other state laws use different definitions, consent/release standards, policies, security duties, enforcement, and remedies. Keep every biometric or inference feature off. [IL-BIPA-DEFINITIONS; IL-BIPA-DUTIES; TX-BIOMETRIC; WA-BIOMETRIC]

Colorado's current automated-decision law, effective 2027-01-01, concerns covered automated decision-making technology used to materially influence consequential decisions and includes developer/deployer documentation, notices, data access/correction, human review, and record duties. It is a future expansion trigger, not proof that an ordinary synthetic receptionist demo is a covered system. Colorado's separately enacted chatbot-safety requirements also take effect in 2027 and require monitoring before any service that could fall within their scope. [CO-ADMT-2026; CO-AI-RULEMAKING]

Some state AI laws require disclosure in defined consumer or regulated interactions. Rather than maintain state-specific AI concealment, Sylvara discloses the AI clearly at the start everywhere. That conservative policy does not satisfy unrelated state duties or authorize an automated decision.

## Change Request Template

Before proposing any item in this file, answer privately:

1. What exact business need cannot be met by the current synthetic inbound profile?
2. Who initiates, receives, decides, pays, and suffers an error?
3. Which states/countries, people, line types, industries, and data categories are involved?
4. What is collected or inferred before notice and before assent?
5. What legal role does each party actually perform?
6. What is the least-data, least-channel, human-confirmed alternative?
7. Which current primary authorities and counsel conclusions apply?
8. What technical control prevents scope expansion, not merely asks the model to behave?
9. What private evidence proves the control in the deployed environment?
10. How is the feature stopped, data contained/deleted, and affected people helped when it fails?

No answer, no feature.
