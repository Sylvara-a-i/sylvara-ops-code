# Advertised Sylvara Zoho Tools — 2026-09-25

- **Owner:** Sylvara technical operations
- **Evidence:** Current session's advertised tool membership, not effective tenant access
- **Scope:** 506 role-qualified entries, 17 neutral roles, seven Zoho products
- **Inventory:** [Machine-readable operation list](sylvara-advertised-tool-inventory.json)

## What Was Observed

The session's callable tool registry was enumerated after a CRM automation
connector metadata refresh. The newly added `updateDealsRecord` action appeared
in both the connector's advertised schema and the callable registry. The other
roles were observed in that same registry; they were not individually refreshed,
reauthenticated or exercised.

All 506 matching entries are retained in the JSON inventory. There are 473 unique
product-qualified operation suffixes because some operations appear in more
than one role. The suffixes are lower-case, prefix-free runtime names, not
case-preserving provider catalog keys. Use current private runtime metadata to
obtain the actual callable names; do not reconstruct a private namespace from
this document.

| Neutral role | Product | Advertised entries |
| --- | --- | ---: |
| analytics-audit | Zoho Analytics | 9 |
| analytics-changes | Zoho Analytics | 9 |
| billing-audit | Zoho Billing | 32 |
| billing-changes | Zoho Billing | 19 |
| books-audit | Zoho Books | 91 |
| books-changes | Zoho Books | 24 |
| books-controller | Zoho Books | 67 |
| catalyst-audit | Zoho Catalyst | 32 |
| catalyst-break-glass | Zoho Catalyst | 6 |
| catalyst-changes | Zoho Catalyst | 29 |
| crm-audit | Zoho CRM | 98 |
| crm-automation-changes | Zoho CRM | 44 |
| crm-schema-changes | Zoho CRM | 13 |
| mail-audit | Zoho Mail | 12 |
| mail-changes | Zoho Mail | 4 |
| payments-audit | Zoho Payments | 10 |
| payments-changes | Zoho Payments | 7 |
| **Total** | **Seven products** | **506** |

These counts are not counts of successful tests, safe actions or approved
operations. An audit role label is not proof that the provider enforces read-only
access. High-risk actions appearing in the inventory remain subject to their
existing authority and safety gates.

## Focused Deal-Update Contract Check

Only the two relevant input contracts were inspected for the following
comparison. The inventory is not a complete schema review of every tool.

| Requirement | `updateRecord` | `updateDealsRecord` |
| --- | --- | --- |
| Exact record target | Module and record path parameters | Deal record path parameter |
| Arbitrary API-name record fields | Explicit additional record-item properties | Explicit additional record-item properties |
| Request-level automation controls | Trigger and feature controls are declared | Not exposed by the declared request body |
| `If-Unmodified-Since` header | Not exposed | Not exposed |

The refreshed generic action now exposes both custom-field values and explicit
automation controls in one request. This supersedes the earlier observation
that its declared record item lacked arbitrary API-name fields. The Deal-specific
action also permits custom fields, but does not declare those request-level
automation controls. Neither declares a stale-record condition. Controls from
separate operations cannot be combined into one supported request. Do not send
request-level controls as record fields, assume undeclared defaults, or probe
this limitation with a live write.

The [CRM Update Records API](https://www.zoho.com/crm/developer/docs/api/v8/update-records.html)
documents a conditional-update header and a stale-record rejection. Underlying
API support does not establish that a connector exposes it. A supported connector
contract or documented equivalent guarantee is still needed before an operation
requiring those controls. No tenant write or acceptance test was performed for
this inventory.

## Interpretation And Historical Evidence

This snapshot answers **which Sylvara Zoho tools were advertised to this
session**, not which tools are currently enabled at every server, authenticated,
permitted in a particular tenant, affordable to execute, or approved for use.
It contains no live records, full schemas, grants, endpoints, credentials or
connection identities.

The [2026-08-04 configured-selection snapshot](../../configured/2026-08-04/capability-catalog.md)
is preserved. Its 294 entries came from a different date and evidence layer.
The difference in counts must not be presented as 212 newly enabled operations.
A tool absent here is not proved disabled or removed elsewhere. Non-Zoho tools,
other businesses' tools and provider voice tooling are outside this inventory.

## Verification And Maintenance

Verification for this snapshot checks that every currently observed Sylvara
Zoho registry entry maps to exactly one neutral role and one stored operation;
role totals, product totals and the deduplicated count must reconcile. JSON
parsing, link checks, public-repository safety checks and independent review
apply before publication. No tool is executed merely to test its inventory row.

After a material connector refresh, create a new dated advertised snapshot and
update the MCP index. Preserve older observations. Inspect the current input
contract again before any consequential use; listing an operation does not
renew an action allocation or override an existing hold.

This documentation changes no server selection, permission, workflow, runtime,
deployment or billing setting. Reverting it affects documentation only.
