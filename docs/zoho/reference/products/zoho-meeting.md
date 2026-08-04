# Zoho Meeting Reference

- **Reference ID:** `SYLVARA-ZOHO-MEETING-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective organization, edition, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes durable Zoho Meeting meeting, webinar, report, recording, SDK, and integration behavior. It is not a session inventory, participant export, recording catalog, or deployment record.

Meeting and standalone Webinar surfaces, API paths, editions, regional hosts, scopes, limits, and retention are volatile. Verify the exact product and organization before implementation.

## Product Role

Zoho Meeting owns online session scheduling, hosting, participation, webinar registration, engagement, and meeting artifacts when adopted. Calendar may own calendar events; Bookings may own appointment selection; CRM may own the commercial relationship.

A scheduled or completed session does not prove consent, payment, agreement, or completion of another operational process.

## Authentication And Discovery

- Use OAuth scopes documented for the exact Meeting or Webinar endpoint family.
- Resolve the current user, organization, regional API root, edition, and role before reading sessions.
- Distinguish Zoho Meeting webinar APIs from standalone Zoho Webinar APIs.
- Discover presenters, meeting keys, webinar keys, registration settings, and recording capability from the live organization.
- Treat opaque identifiers and regional API roots as runtime configuration, not source constants.
- Confirm whether Calendar, Bookings, CRM, or another integration is the scheduling writer.
- Validate recording, transcription, and summary availability independently of basic meeting access.

## Core Model And Capabilities

- Meetings represent interactive sessions with a presenter, schedule, participants, and security settings.
- Webinars add registration, attendees, polls, engagement, and reporting behavior.
- Participant and attendee reports are generated artifacts with availability and retention constraints.
- Recordings, transcripts, and summaries are separate sensitive resources.
- Registration operations can create customer-facing invitations and must be deduplicated.
- Meeting CRUD, webinar CRUD, reports, polls, and recordings use distinct endpoint families.
- The AV SDK can embed session experiences but creates a separate browser and token security boundary.
- Dial-in and regional media capabilities depend on current plan and geography.

## Automation And Events

- Calendar and Bookings integrations can create or synchronize sessions subject to ownership rules.
- CRM and other application integrations may link sessions to relationship workflows.
- No complete universal webhook contract for sessions, participants, recordings, or transcripts was established at the cutoff.
- Polling for reports or recordings must be bounded, status-aware, and reconciled.
- Webinar registration and customer messaging require an operation key and a single communication owner.
- Do not trigger downstream completion solely from a scheduled end time or absent participant report.

## Reliability And Security

- Persist the returned session identifier before sending downstream messages.
- Reconcile by deterministic schedule and organizer context after an ambiguous create or edit timeout.
- Do not blindly retry create, registration, edit, or delete operations.
- Protect join links, host controls, SDK tokens, participant details, recordings, transcripts, and reports.
- Collect recording and transcription consent under the applicable policy and jurisdiction.
- Apply waiting-room, passcode, lock, and participant controls appropriate to the session.
- Use bounded retries and honor current rate or processing guidance when documented.

## Validation

Before enabling an integration, verify:

1. exact product, organization, user, region, edition, scopes, and presenter permission;
2. meeting and webinar create, edit, delete, registration, and reporting behavior;
3. time zone, recurrence, invitation, cancellation, and integration ownership;
4. duplicate and ambiguous-write reconciliation;
5. recording, transcript, summary, download, deletion, and retention policy;
6. participant privacy, customer messaging, and SDK security; and
7. rollback plus independent post-change readback.

Use synthetic participants and a non-production session. Repository review is not authorization to schedule, record, invite, or publish a live session.

## Official Sources

- [Zoho Meeting API](https://www.zoho.com/meeting/api-integration.html)
- [Meeting OAuth](https://www.zoho.com/meeting/api-integration/authentication.html)
- [Organization discovery](https://www.zoho.com/meeting/api-integration/organization-id.html)
- [Meeting API](https://www.zoho.com/meeting/api-integration/meeting-api.html)
- [Webinar API](https://www.zoho.com/meeting/api-integration/webinar-api.html)
- [Recording API](https://www.zoho.com/meeting/api-integration/recording-api.html)

## Exclusions

This reference contains no meeting, webinar, presenter, participant, registrant, join link, recording, transcript, report, SDK token, live identifier, integration mapping, or deployment claim. Sylvara adoption and effective access remain Unknown.
