# Zoho Calendar Reference

- **Reference ID:** `SYLVARA-ZOHO-CALENDAR-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective organization, edition, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes durable Zoho Calendar event, availability, resource-booking, synchronization, API, and MCP behavior. It is not a calendar inventory, event export, sharing register, or live integration map.

Calendar categories, regional hosts, scopes, quotas, and integration propagation can change. Live discovery and current endpoint documentation control implementation.

## Product Role

Zoho Calendar owns calendars, events, recurrence, attendee scheduling, free/busy data, and calendar resource reservations when adopted. It does not own customer relationship state, appointment-service policy, or meeting recordings.

Define one writing authority for each event class. Bidirectional integrations can otherwise create loops, duplicates, or conflicting updates.

## Authentication And Discovery

- Use OAuth scopes documented for calendars, events, free/busy, groups, or resource booking.
- Resolve the authorized user, data center, regional API root, and effective calendar permission first.
- Discover calendar category, calendar UID, sharing rights, time zone, and owner from the API.
- Discover branches, buildings, floors, resources, and permissions before resource-booking work.
- Treat display names as mutable; use returned opaque identifiers for synchronization.
- Read recurrence, attendee, notification, and attachment behavior from the exact endpoint contract.
- Treat the official Calendar MCP server as an advertised capability separate from effective Sylvara access.

## Core Model And Capabilities

- Calendars contain events and carry ownership, category, sharing, and time-zone behavior.
- Events include start and end values, time zone, organizer, attendees, recurrence, reminders, and status.
- Recurring series and individual instances require distinct update and reconciliation handling.
- Free/busy queries support scheduling without exposing full event content.
- Groups and shared calendars provide collaborative visibility subject to permissions.
- Resource booking models locations and reservable resources separately from ordinary events.
- Attachments and descriptions can contain confidential content and need stricter retention controls.
- CalDAV, iCal, EAS, and native integrations have different synchronization guarantees.

## Automation And Events

- Calendar can integrate with Meeting, Bookings, CRM, People, and external calendar systems.
- Smart Add can interpret natural-language input but must not bypass explicit confirmation for important events.
- MCP may support AI-assisted calendar operations within the authorized tool and permission boundary.
- No universal event-change webhook contract was established at the cutoff; do not fabricate one.
- If polling is required, use bounded windows, pagination, stable cursors where documented, and overlap reconciliation.
- Assign one synchronization owner and attach an operation key to prevent integration loops.

## Reliability And Security

- Normalize instants internally while preserving the source time zone and intended local display.
- Handle daylight-saving transitions, all-day events, recurrence exceptions, and organizer changes explicitly.
- Use concurrency metadata such as `etag` when documented and stop on stale state.
- Do not blindly retry event creation after an ambiguous timeout; search a narrow deterministic window first.
- Treat attendee notifications as customer-impacting side effects and request them deliberately.
- Fetch free/busy rather than event details when only availability is required.
- Never log event descriptions, attendee lists, attachments, private calendar URLs, or live identifiers.

## Validation

Before enabling an integration, verify:

1. user, organization, data center, regional API root, scopes, and calendar permission;
2. calendar UID, category, owner, sharing, and time-zone behavior;
3. event create, update, move, delete, recurrence, and instance semantics;
4. daylight-saving, all-day, attendee, notification, and conflict cases;
5. free/busy and resource reservation permissions;
6. synchronization ownership, loop prevention, and ambiguous-write reconciliation; and
7. rollback and independent post-change readback.

Use synthetic participants and a non-production calendar. Repository review is not authorization to change live events or sharing.

## Official Sources

- [Calendar API introduction](https://www.zoho.com/calendar/help/api/introduction.html)
- [Calendar OAuth guide](https://www.zoho.com/calendar/help/api/oauth2-user-guide.html)
- [Calendars API](https://www.zoho.com/calendar/help/api/calendars-api.html)
- [Events API](https://www.zoho.com/calendar/help/api/events-api.html)
- [Free/Busy API](https://www.zoho.com/calendar/help/api/freebusy-api.html)
- [Calendar MCP server](https://www.zoho.com/calendar/help/mcp/getting-started.html)

## Exclusions

This reference contains no calendar, event, attendee, resource, group, sharing rule, integration mapping, private URL, attachment, live identifier, or deployment claim. Sylvara adoption and effective API or MCP access remain Unknown.
