# Zoho MCP Preconfigured Template Catalog

## Evidence Status

- Classification: **Reference**
- Portal capture cutoff: **2026-07-25**
- Captured templates: **19**
- Exact membership captured for: **18**
- Displayed tool chips across verified templates: **217**
- Unique per-template memberships: **216**
- Unique tool names across templates: **177**
- Sylvara template availability and authorization: **Unknown**

This catalog preserves template names, dated membership counts, and unchanged-template risk. It excludes account identities, custom server names, organization choices, authorization state, and tenant-specific rollout decisions.

Template composition can change. Reopen the current portal modal and compare the exact membership before creating or authorizing a server.

## Captured Templates

| Template | Service | Dated membership | Unchanged-template risk |
|---|---|---:|---|
| CRM Data & Metadata Operations | Zoho CRM | 16 chips / 15 unique | High; combines metadata, record reads, and record writes |
| CRM Activities & Engagement | Zoho CRM | 12 | Critical; includes record mutation and external mail |
| CRM Automation & Workflows | Zoho CRM | 17 | Critical; changes workflow and notification configuration |
| Lead Management System | Zoho CRM | 5 | High; creates, updates, searches, and converts records |
| Contact Hub & Merging | Zoho CRM | 5 | Critical; includes merge or deletion behavior |
| Deal Lifecycle Tracker | Zoho CRM | 3 | High; changes commercial pipeline state |
| Account & Relationship Manager | Zoho CRM | 4 | High; creates and updates relationship records |
| Activity & Communication Center | Zoho CRM | 5 | High; creates or updates activities and records |
| Notes & Contextual Collaboration | Zoho CRM | 3 | High; creates content-bearing notes |
| Email Automation & Follow-up | Zoho CRM | 1 | Critical; sends external mail |
| CommandCenter CRM Actions | CRM / CommandCenter | 9 | Critical; changes journeys, stages, or attached automation |
| Accountant Management System | Zoho Books | 67 | Critical; combines structural, journal, project, and destructive operations |
| Books Financial Overview | Zoho Books | 12 | Medium-high; financial reads still expose sensitive state |
| Books Transactions & Creation | Zoho Books | 9 | Critical; creates accounting records |
| Payments Management | Zoho Payments | 15 | Critical; creates payment objects and refunds |
| Mail Reading & Search | Zoho Mail | 13 | High; exposes message and attachment contents and may change flags |
| Mail Sending & Replies | Zoho Mail | 5 | Critical; sends externally and uploads attachments |
| Mail Organization & Management | Zoho Mail | 16 | Critical; moves, archives, deletes, labels, or marks mail |
| WorkDrive File Management | Zoho WorkDrive | Not verified | High; exact membership was not captured |

## Design Rules

1. Do not authorize a template unchanged merely because it is preconfigured.
2. Separate metadata-only reads from content-bearing reads.
3. Separate routine bounded writes from financial, destructive, communication, schema, or administrative actions.
4. Exclude delete, merge, send, refund, public-sharing, unrestricted execution, and structural accounting tools by default.
5. Bind the exact organization and environment inside the server boundary where possible.
6. Require explicit approval and independent readback for every write-capable role.
7. Treat WorkDrive membership as Unknown until the current template is captured.
8. Prefer custom least-privilege selections for concrete Sylvara workflows.

## Official References

- [Zoho MCP Tool Guide](https://help.zoho.com/portal/en/kb/mcp/mcp-tool-manual/articles/zoho-mcp-tool-guide)
- [Zoho MCP Implementation Guide](https://help.zoho.com/portal/en/kb/mcp/implementation-guide/articles/zoho-mcp-implementation-guide)
- [Supported Zoho Services](https://www.zoho.com/mcp/services/zoho-services.html)
- [Zoho CRM MCP Overview](https://www.zoho.com/crm/developer/docs/mcp/overview.html)
