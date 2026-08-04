# Zoho Bookings Reference

- **Reference ID:** `SYLVARA-ZOHO-BOOKINGS-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective organization, edition, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes durable Zoho Bookings scheduling, API, workflow, and integration behavior. It is not a workspace inventory, service catalog, public-page register, customer export, or deployment record.

Plan features, Bookings version, API quotas, workflow behavior, and AI access are volatile. Confirm them in the intended organization before design or use.

## Product Role

Zoho Bookings owns appointment availability, scheduling rules, appointments, and scheduling notifications when adopted. CRM remains the relationship source, an accounting product remains the financial source, and Calendar remains a separate event surface.

An appointment state must not be interpreted as proof of customer eligibility, payment, contractual acceptance, or completion of another workflow.

## Authentication And Discovery

- Use OAuth with the exact Bookings scopes documented for each endpoint.
- Resolve organization, data center, edition, API access, and quota before calling the API.
- Discover workspaces, services, staff, resources, and service types from the live organization.
- Persist opaque identifiers in protected configuration; do not infer them from display names.
- Verify time zone and date format behavior before parsing availability or appointment values.
- Treat the official Bookings MCP surface as a separate advertised contract; effective Sylvara access is Unknown.
- Inspect custom fields and required intake values from current metadata or authorized configuration.

## Core Model And Capabilities

- Workspaces group scheduling operations and settings.
- Services define duration, availability, buffers, intake, assignment, and customer-facing behavior.
- Staff represent schedulable people; resources represent schedulable capacity or equipment.
- Appointments link a service, time, customer, and assigned staff or resource.
- Availability is calculated from schedules, exceptions, buffers, capacity, and existing bookings.
- Service types may support one-to-one, collective, class, or resource-based scheduling.
- APIs cover availability and bounded appointment, workspace, service, staff, resource, and customer operations.
- Public booking pages expose a controlled scheduling experience, not administrative authority.

## Automation And Events

- Native workflows can send approved notifications and run supported actions or custom functions.
- Integrations may synchronize appointment information with CRM, Calendar, Flow, or other supported systems.
- Appointment-booked, rescheduled, and canceled triggers are documented for some connectors.
- Do not assume a universal signed webhook contract; verify the exact delivery mechanism before relying on it.
- Choose one owner for each email, SMS, or downstream action to prevent duplicate communication.
- AI-assisted create, reschedule, or cancel actions require explicit confirmation of service, time, time zone, and contact channel.

## Reliability And Security

- Availability is provisional until the create request succeeds; refresh options after a conflict.
- Persist an operation intent before creating an appointment and reconcile ambiguous timeouts before retrying.
- Serialize each customer-impacting mutation and make downstream actions independently idempotent.
- Do not log raw intake, responses, customer details, private booking links, or live identifiers.
- Minimize intake fields and keep confidential documents and sensitive data outside scheduling notes.
- Treat public booking and cancellation links as potentially sensitive until current authorization behavior is verified.
- Deactivate rather than destructively delete services or resources when historical linkage matters.

## Validation

Before enabling a workflow, verify:

1. organization, data center, edition, quota, workspace, service type, and time zone;
2. least-privilege OAuth scopes and effective role permission;
3. availability across daylight-saving and schedule-boundary cases;
4. create, reschedule, cancel, conflict, timeout, and reconciliation behavior;
5. notification ownership and duplicate suppression;
6. CRM or Calendar mapping without uncontrolled duplicate creation; and
7. audit, rollback, and post-change readback.

Use synthetic contacts in a non-production service. Repository approval is not authorization to expose a page or change live scheduling.

## Official Sources

- [Zoho Bookings introduction](https://help.zoho.com/portal/en/kb/bookings/introduction-to-zoho-bookings/articles/bookings-introduction)
- [Bookings OAuth](https://www.zoho.com/bookings/help/api/v1/oauthauthentication.html)
- [Fetch services](https://www.zoho.com/bookings/help/api/v1/fetch-services.html)
- [Book an appointment](https://www.zoho.com/bookings/help/api/v1/book-appointment.html)
- [Bookings workflows](https://help.zoho.com/portal/en/kb/bookings-2-0/workflows/articles/workflows-bookings)
- [Bookings MCP integration](https://help.zoho.com/portal/en/kb/bookings-2-0/integrations/ai-automations/articles/integrate-zoho-bookings-with-ai-using-mcp)

## Exclusions

This reference contains no workspace, service, staff, resource, customer, appointment, public-page URL, connection name, notification template, live identifier, intake value, or deployment claim. Sylvara adoption and effective API or MCP access remain Unknown.
