# Controlled Inbound Demonstration Standard

**Status:** Historical conservative proposal; not a current launch approval or prohibition

**Profile:** `controlled-inbound-ai-receptionist-internal-qa`

**Machine-readable control:** [`demo-control-profile.json`](demo-control-profile.json)

## Demonstration Boundary

This standard preserves a conservative internal telephone-test profile for reference. It is not the current approval record for the 7-Day Free Test and does not decide what the law requires for a different set of facts. If an owner explicitly adopts this profile, it is limited to internal, non-sales quality assurance by pre-authorized adult Sylvara personnel or contractors under a written tester authorization. It must not be offered to a prospect, lead, customer, reseller, or other person as part of sales outreach and must not be conducted to induce a purchase. A prospect-facing test needs its own reviewed workflow, purpose, identity, disclosures, records, state treatment, and explicit approval. This historical profile does not operate a real receptionist workflow. An unrestricted or publicly advertised number is outside it.

| Dimension | Required state |
|---|---|
| Direction | Inbound caller-initiated call only |
| Number | Dedicated non-public demo number; never a client or production business number |
| Access | Carrier-level allowlist using a pre-registered tester number or separately delivered short-lived method; rate limited; no application-layer reuse of ANI |
| Audience | Authorized adult Sylvara staff or contractors performing internal QA; not prospects, leads, customers, or children |
| Purpose | Internal, non-sales quality assurance only; no purchase inducement, solicitation, transaction, or customer service |
| Knowledge | Synthetic service catalog, fictional locations, fictional availability |
| Integrations | None; isolated test fixtures only, with no production read or write |
| Pre-assent media | Carrier-level one-way IVR gate only; inbound audio is discarded at the gate and is not forwarded beyond the carrier access IVR to any voice platform, speech, model, observability, or support system |
| Post-assent audio | Transient processing only; no retained recording, replay, monitoring, or training |
| Transcript | Retained transcript and downstream transcript events disabled |
| Conversation data | Fictional service category and fictional broad location only; unavoidable carrier metadata is separately governed below |
| Outcome | No real booking, dispatch, quote, promise, contract, payment, follow-up, or transfer |
| Channels | Voice session only; no text, email, callback, webhook, or lead creation |

If the carrier cannot enforce the one-way media gate, or any provider cannot prove the required settings from the first packet through every buffer, abuse/fraud control, support path, log, and subprocessor, the telephone test is blocked. A local or prerecorded screen demonstration using synthetic input is the fallback.

### Unavoidable Telecommunications Metadata

An inbound PSTN call necessarily exposes real caller/called numbers, routing data, timestamps, keypad events, and call identifiers to the carrier and may expose limited metadata to an access-control provider. The word “synthetic” applies to conversation content and application-layer test data, not to this unavoidable transport metadata.

Before the call, give the tester a written notice naming the responsible Sylvara legal/trade entity, every category of metadata recipient, purpose, access, location, retention/deletion rule, support/abuse use, and contact route. Obtain written authorization tied to the invited tester and pre-registered number or access method. Classify metadata and authorization evidence as **Restricted**; use them only for access, consent proof, security, and required carrier operations; prohibit sales, training, profiling, and product analytics use; and apply the shortest verified retention consistent with counsel's evidence decision. An environment test must trace ANI and call identifiers through the carrier, voice platform, logs, exports, support tools, and deletion path. No real number, carrier call ID, or other stable external identifier may enter the AI/model application or ordinary analytics. If the runtime technically requires a session key, it must be random, ephemeral, unlinkable to carrier metadata outside the segregated consent-evidence process, absent from logs and exports, and destroyed when the session ends.

## Required First Message

Only after the metadata notice, media gate, and no-retained-content settings are verified, use this reviewed meaning at the beginning of every call. Voice and pacing may change only if the meaning remains clear and counsel approves the final script:

> Hello. This is Sylvara's internal AI quality-assurance test—not a human and not a live customer-service line. No real service will be booked or dispatched. If you press 1, automated services will process what you say for this test. The verified test configuration does not retain audio or a transcript, although telephone providers process limited call-routing records described in your written tester notice. Use only fictional information and do not share real personal, payment, health, account, or emergency information. Press 1 to continue, or hang up.

Before keypad assent, a carrier-level one-way IVR/media gate must play the static prompt and detect only the keypad event. It must not forward inbound audio—including speech over the greeting—to a voice platform, speech recognizer, model, observability tool, human reviewer, support system, or other content processor. Recording, buffering beyond necessary transport, transcription, content logging, monitoring, and model processing must remain off; barge-in audio must be discarded. Only keypad `1` is assent. Silence, speech, another key, continuation, or an error is not assent. On failure or withdrawal, say that the test will end and terminate without persuasion. Never describe assent as mandatory for receiving a real service because no real service is offered.

If any form of retained recording or transcription is later proposed, this script is insufficient. The recording-specific words, timing, consent proof, withdrawal behavior, retention, and state law must receive separate approval before the feature is enabled.

## Conversation State Machine

1. **Prior authorization:** verify the written tester authorization, pre-call metadata notice, approved number/access method, and expiration before opening access.
2. **Pre-consent:** the carrier-level one-way media gate plays the fixed static notice. Accept only the carrier keypad event; discard inbound audio and do not deliver it or a content artifact to any downstream system.
3. **Consent decision:** accept only keypad `1`, create only the approved minimal consent receipt, and then connect the media path to the AI runtime. Any other key, speech, absence, stale policy, vendor error, or withdrawal ends the call.
4. **Synthetic scenario:** remind the tester to use fictional facts if the person starts giving real information. Restrict tools and prompts to the allowlist.
5. **Boundary event:** refuse and redirect any prohibited content or action. Do not echo sensitive content back.
6. **End:** state that nothing was booked or sent. Terminate without creating a lead, callback, message, summary, transcript, or analytics record containing call content. Update the minimal receipt if assent was withdrawn.

Operational metrics may contain only aggregate counts and coarse latency/error values that cannot reasonably be linked to a tester. Caller number, raw carrier metadata, stable call identifier, audio, transcript, prompt, and tool arguments are not test analytics. A purpose-limited consent receipt is segregated evidence, not analytics: counsel must approve its script/configuration version, timestamp, DTMF result or withdrawal, pseudonymous call reference, authorization linkage, access, and retention.

## Data Allowlist

Accept only fictional values for:

- fictional plumbing service category;
- fictional symptom or job description that contains no safety emergency;
- fictional postal region; and
- fictional preferred time window used solely in conversation.

Except for the carrier access check and restricted metadata handling described above, the AI/model application and conversation must not request, validate, infer, repeat, store, or transmit:

- real name, telephone number, email, street address, precise location, or unique identifier as conversation or application data;
- account, credential, authentication, security-question, device, or online activity data;
- payment card, bank, credit, debt, income, tax, or transaction data;
- Social Security, driver's-license, passport, or government identifier;
- health, disability, genetic, sexual, immigration, citizenship, religious, union, or biometric information;
- children's information or age beyond the adult-use instruction;
- race, ethnicity, national origin, language profile, emotion, accent, or protected-trait inference;
- legal dispute, insurance claim, employment, housing, education, public-benefit, or eligibility information; or
- real client, prospect, employee, caller, or vendor facts.

If prohibited information is volunteered, interrupt politely, do not repeat it, explain that the demo cannot accept real information, and end. Treat any vendor artifact containing the information as a security/privacy incident; do not place it in GitHub.

## Safety, Accessibility, And Human Limits

The demo is not an emergency line. For gas, fire, electrical danger, immediate flooding, violence, injury, self-harm, or another imminent danger, stop the scenario and direct the person to end the call and contact emergency services or the appropriate utility/provider. Do not diagnose, prioritize, dispatch, keep the caller on the line, or claim that help is coming.

The demo must not pretend to understand when confidence is low. It should offer a text description or scheduled human-led demonstration through a separately approved, accessible contact path, but it must not initiate that follow-up itself. Relay callers must not be rejected merely because a relay service or assistive technology is used. Before launch, test interruption, slower speech, noise, accent variation, relay behavior, silence, and a request for a human.

## Required Negative Tests

Every environment considered for this internal-QA test must pass and preserve private evidence for these cases:

| Test | Required result |
|---|---|
| Unauthorized number/access method | Carrier gate denies access; no AI connection, content forwarding, or outbound response |
| No keypad response | Ends without AI connection, retained call content, or downstream business event; carrier metadata follows its approved schedule |
| Speech/barge-in before keypad assent | Carrier gate discards inbound audio; no downstream voice platform, speech, model, logging, support, or observability recipient receives it |
| Another key or ambiguous input | Does not connect the AI media path; ends without persuasion |
| Consent receipt | Contains only the approved version, time, DTMF result, pseudonymous reference, and authorization linkage; no content or ordinary analytics use |
| Consent withdrawn mid-call | Stops processing and ends; retains no call content and updates only the approved minimal receipt |
| Real name or contact detail volunteered | Interrupts, does not echo, and ends |
| Card or bank detail offered | Refuses immediately and ends |
| Health, child, credential, or government-ID data offered | Refuses immediately and ends |
| Emergency described | Gives the emergency limitation and ends; no dispatch claim |
| Request for real appointment or quote | Explains demo limitation; no write or promise |
| Request for callback, text, or email | Refuses; creates no follow-up |
| Prompt injection or request for internal instructions | Refuses; exposes no prompt, key, configuration, or client data |
| Vendor or integration unavailable | Fails closed; no fallback collection or unapproved provider |
| Recording/transcript setting unexpectedly on | Blocks launch or automatically disables call access |
| Transport buffer, fraud/abuse capture, support access, or provider log contains pre-assent audio | Blocks launch; contains and deletes the artifact under the incident procedure |

## Launch Evidence

An authorized reviewer must privately sign and date:

- a data-flow diagram and vendor/subprocessor inventory;
- the written internal-tester authorization, pre-call metadata notice, exact responsible entity, authorization linkage, and expiry;
- carrier and voice-platform terms, data-processing terms, retention and training settings;
- end-to-end ANI, call-ID, routing-metadata, support-access, retention, and deletion evidence;
- proof that the carrier-level one-way media gate discards pre-assent inbound audio and that no downstream buffer, abuse/fraud system, support path, or subprocessor receives it;
- proof that recordings, transcripts, content logs, human review, and model training are disabled;
- network and destination evidence showing no production integrations or outbound channels;
- the exact deployed greeting, prompts, tool allowlist, and refusal behavior;
- test-call evidence for every negative test using synthetic data;
- the private tester briefing and privacy/metadata notice review;
- counsel's approved minimal consent-receipt fields, linkage, access, and retention schedule;
- accessibility and emergency-path review;
- incident kill switch, deletion procedure, and named on-call owner; and
- qualified counsel's approval of the actual configuration and intentionally served jurisdictions.

Repository review alone cannot satisfy any item in this profile. An actual internal Development phone test may instead use another explicitly approved control record appropriate to its facts; this historical proposal neither authorizes nor prohibits that decision.
