# Zoho ToDo Reference

- **Reference ID:** `SYLVARA-ZOHO-TODO-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective organization, edition, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes durable Zoho ToDo task, Mail API, webhook, and MCP behavior. It is not a task export, group inventory, project catalog, assignment policy, or deployment record.

The documented REST surface is provided through Zoho Mail APIs. UI features, ToDo behavior, Mail organization configuration, plan limits, and MCP tools can change.

## Product Role

Zoho ToDo manages personal and group tasks, subtasks, priorities, due dates, reminders, recurrence, and lightweight task projects. It should track actionable work, not become the authoritative customer, financial, HR, or document system.

Use a purpose-built project or workflow product when dependencies, approvals, resource planning, or complex lifecycle management exceed ToDo's bounded task model.

## Authentication And Discovery

- Use Zoho Mail OAuth scopes documented for the exact task API operation.
- Resolve the authorized account, organization, regional API root, group membership, and role before accessing tasks.
- Discover personal and group namespaces, group identifiers, projects, members, and custom statuses from the API.
- Treat task, group, project, assignee, status, and parent identifiers as opaque.
- Verify whether an operation applies to personal tasks, group tasks, or both.
- Inspect recurrence, reminder, delete, archive, and restore behavior before automation.
- Treat Mail MCP task tools as an advertised contract separate from effective Sylvara access.

## Core Model And Capabilities

- Tasks contain title, description, assignee, creator, status, priority, due date, reminders, and recurrence.
- Personal tasks belong to one account; group tasks use group membership and role permissions.
- Subtasks create hierarchy but should not be treated as a general dependency graph.
- Group projects organize related tasks within a task group.
- Custom statuses provide workflow labels subject to group configuration.
- Recurring tasks create or advance work according to documented recurrence behavior.
- Delete and restore operations have distinct lifecycle and retention implications.
- Unified View aggregates tasks from supported Zoho services without changing source ownership.

## Automation And Events

- Tasks can be created through the UI, email, imports, supported integrations, REST API, or MCP.
- Zoho Mail webhooks document task-related activities; verify the exact event and signature contract before use.
- Polling integrations should use bounded windows, stable filters, pagination, and overlap reconciliation.
- AI task creation or mutation requires confirmation of destination, title, assignee, due date, and recurrence.
- Use an external operation key or deterministic lookup to prevent duplicate task creation.
- Assign one synchronization owner if ToDo is mirrored into another work-management system.

## Reliability And Security

- Do not blindly retry task creation or reassignment after an ambiguous timeout; reconcile first.
- Validate group membership and assignee permission immediately before a write.
- Handle recurrence and reminders as customer- or staff-impacting side effects, not decorative fields.
- Preserve source links as opaque references and do not copy confidential content into task descriptions.
- Never log task bodies, assignee details, webhook payloads, OAuth tokens, private links, or live identifiers.
- Use bounded retries for transient reads and explicit handling for permission, validation, and rate-limit failures.
- Prefer archive or governed completion over destructive deletion when audit history matters.

## Validation

Before enabling an integration, verify:

1. account, organization, region, OAuth scopes, group membership, and role;
2. personal versus group namespace, project, status, and assignee discovery;
3. create, edit, assign, prioritize, remind, recur, complete, delete, and restore behavior used;
4. duplicate, timeout, pagination, permission, and partial-failure handling;
5. webhook authenticity or polling reconciliation;
6. MCP tool contract and confirmation behavior where used; and
7. rollback plus independent post-change readback.

Use synthetic tasks in a non-production group. Repository review is not authorization to create or change live assignments.

## Official Sources

- [Zoho ToDo](https://www.zoho.com/todo/)
- [Tasks powered by Zoho ToDo](https://www.zoho.com/mail/help/tasks.html)
- [Zoho Mail Tasks API](https://www.zoho.com/mail/help/api/task-api.html)
- [Add a task](https://www.zoho.com/mail/help/api/post-add-new-task.html)
- [Zoho Mail webhooks](https://www.zoho.com/mail/help/dev-platform/webhook.html)
- [Zoho Mail MCP](https://www.zoho.com/mail/help/mcp/getting-started.html)

## Exclusions

This reference contains no task, group, project, assignee, status configuration, reminder, private description, webhook payload, OAuth grant, live identifier, MCP configuration, or deployment claim. Sylvara adoption and effective API or MCP access remain Unknown.
