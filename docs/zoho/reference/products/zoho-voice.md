# Zoho Voice Reference

- **Reference ID:** `SYLVARA-ZOHO-VOICE-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective organization, edition, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes durable Zoho Voice telephony, messaging, call-log, queue, SDK, Deluge, carrier, and compliance behavior. It is not a number inventory, call export, recording catalog, routing plan, or proof that Voice is enabled.

Country support, number capability, messaging rules, API roots, editions, limits, retention, and carrier requirements are volatile. Verify the intended market and live organization before design.

## Product Role

Zoho Voice may own live business telephony, numbers, queues, agent state, calls, messages, and communication artifacts. CRM may own the commercial relationship and consent facts; another approved voice platform may own an AI-agent runtime.

Choose one platform as the runtime authority for each number and interaction path. Avoid parallel routing or duplicate messaging across providers.

## Authentication And Discovery

- Use OAuth scopes documented for the exact Voice API resource.
- Resolve organization, region, edition, user role, number capability, and carrier status before any action.
- Discover users, roles, numbers, queues, agents, statuses, and supported messaging capabilities from the live service.
- Distinguish native Zoho Voice, Zoho Telephony integration, SDK, and BYOC responsibilities.
- Treat numbers and all call, message, queue, recording, and contact identifiers as protected runtime data.
- Verify exact regional API roots and do not infer them from another Zoho product.
- Confirm registration, consent, and sender eligibility before messaging.

## Core Model And Capabilities

- Users and roles define access to numbers, queues, logs, recordings, and administration.
- Numbers and carrier configuration determine inbound, outbound, SMS, and MMS capability.
- Queues route calls to agents based on configured membership and availability.
- Call logs expose direction, parties, timing, disposition, and related artifacts.
- Recordings, voicemail, transcription, and call intelligence are separate sensitive resources.
- Messaging APIs cover sends, logs, scheduled messages, and documented status behavior.
- Power Dialer supports managed outbound sequences subject to consent and operational controls.
- SDK and embedded calling create separate browser, token, device, and media security boundaries.

## Automation And Events

- Deluge workflows can react to supported Voice events and call bounded custom functions.
- SMS status callbacks require exact contract validation; do not assume undocumented cryptographic guarantees.
- A universal signed event contract for calls, recordings, messages, and agent state was not established at the cutoff.
- Poll logs or state only with bounded windows, pagination, rate control, and overlap reconciliation.
- Persist a communication intent before sending and deduplicate by recipient, channel, purpose, and revision.
- Update CRM or another downstream system only after identity matching and consent checks succeed.

## Reliability And Security

- Require documented consent, quiet-hours controls, opt-out handling, and applicable messaging registration.
- Apply recording and transcription notice, consent, access, retention, and deletion policy by jurisdiction.
- Never log call content, transcripts, recordings, message bodies, phone numbers, tokens, callback credentials, or raw payloads.
- Treat a send timeout as ambiguous and reconcile message logs before retrying.
- Rate-limit outbound automation and provide a human escalation and suppression path.
- Secure SDK tokens, BYOC credentials, carrier configuration, and browser media permissions.
- Monitor delivery failures, queue abandonment, unavailable agents, unexpected routing, and artifact-processing delays.

## Validation

Before enabling a workflow, verify:

1. organization, region, edition, scopes, role, number, carrier, and messaging capability;
2. queue membership, routing, agent state, after-hours, overflow, and failure behavior;
3. call-log, disposition, recording, voicemail, transcription, and retention controls used;
4. SMS/MMS consent, sender registration, opt-out, callback, duplicate, and timeout behavior;
5. API limits, polling reconciliation, and downstream identity matching;
6. SDK, Deluge, Telephony, or BYOC ownership where used; and
7. rollback, number containment, credential rotation, and post-change readback.

Use synthetic destinations and approved test numbers. Repository review is not authorization to call, message, record, or change live routing.

## Official Sources

- [Zoho Voice knowledge base](https://help.zoho.com/portal/en/kb/zoho-voice)
- [Zoho Voice API index](https://help.zoho.com/portal/en/kb/zoho-voice/zoho-voice-apis)
- [Call Logs API](https://help.zoho.com/portal/en/kb/zoho-voice/zoho-voice-apis/common-apis/articles/call-logs-api)
- [SMS REST API](https://help.zoho.com/portal/en/kb/zoho-voice/zoho-voice-apis/common-apis/articles/sms-rest-api)
- [Voice Deluge guide](https://help.zoho.com/portal/en/kb/zoho-voice/deluge/articles/user-guide-for-deluge-integration-with-zoho-voice)
- [10DLC guidance](https://help.zoho.com/portal/en/kb/zoho-voice/10dlc)

## Exclusions

This reference contains no number, caller, recipient, call, message, queue, user, agent, recording, transcript, routing rule, carrier configuration, callback URL, token, live identifier, or deployment claim. Sylvara adoption and effective access remain Unknown.
