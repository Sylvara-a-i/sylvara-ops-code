# Zoho MCP Tool Manual Service Catalog

## Evidence Status

- Classification: **Reference**
- Tool Manual observation date: **2026-08-05**
- Source: [Zoho MCP Help Documentation](https://help.zoho.com/portal/en/kb/mcp/getting-started/articles/zoho-mcp-help-documentation) and its linked [Tool Manual](https://zoho-mcp-manual-tool-guide.onslate.in/)
- Zoho services: **52 services / 9,851 rendered rows / 9,828 unique operation keys**
- Beyond-Zoho services: **9 services / 966 rendered rows / 966 unique operation keys**
- Total: **61 services / 10,817 rendered rows / 10,794 unique service-qualified operation keys**
- Sylvara installation, authorization, plan availability, and effective access: **Unknown**

The complete names-only catalog is [`tool-manual-tool-catalog-2026-08-05.json`](tool-manual-tool-catalog-2026-08-05.json). It preserves every rendered Tool List row in source order, including 23 duplicate Catalyst rows, while separately recording the unique operation-key count. It excludes provider descriptions, parameters, schemas, endpoints, scopes, examples, page assets, and all account or tenant data.

## Naming Contract

A documented annotation never contains a product or server prefix. For example, the Zoho Books operation key `list_vendor_credits` is annotated as `list vendor credits`. Service qualification comes from the enclosing service record. The exact operation key is retained separately because it is needed for catalog matching.

Annotations are derived deterministically by removing an exact leading service qualifier when the provider embeds one in the operation key, replacing underscores with spaces, and inserting spaces only at lowercase-or-digit to uppercase boundaries. Source casing and hyphens are preserved. The exact provider operation key remains unchanged in its separate field.

## Source Consistency

The public Tool Manual displayed inconsistent service counters for several services. This snapshot uses the actual rendered Tool List rows rather than headings, aggregate counters, or unused bundle arrays. The rendered tables contained 10,817 rows and 10,794 unique service-qualified operation keys. Catalyst by Zoho accounts for all 23 duplicate rendered rows.

## Zoho Services

| Service | Rendered rows | Unique operation keys |
|---|---:|---:|
| Bigin | 70 | 70 |
| Catalyst by Zoho | 160 | 137 |
| Zoho Analytics | 19 | 19 |
| Zoho Apptics | 14 | 14 |
| Zoho Assist | 16 | 16 |
| Zoho Backstage | 49 | 49 |
| Zoho Billing | 455 | 455 |
| Zoho Bookings | 31 | 31 |
| Zoho Books | 1,090 | 1,090 |
| Zoho Calendar | 52 | 52 |
| Zoho Cliq | 454 | 454 |
| Zoho CommandCenter | 81 | 81 |
| Zoho Commerce | 153 | 153 |
| Zoho Connect | 280 | 280 |
| Zoho Creator | 45 | 45 |
| Zoho CRM | 1,204 | 1,204 |
| Zoho Dataprep | 34 | 34 |
| Zoho Desk | 306 | 306 |
| Zoho Directory | 34 | 34 |
| Zoho ERP | 1,020 | 1,020 |
| Zoho Expense | 168 | 168 |
| Zoho Inventory | 777 | 777 |
| Zoho Invoice | 526 | 526 |
| Zoho IoT | 314 | 314 |
| Zoho Learn | 29 | 29 |
| Zoho Lens | 23 | 23 |
| Zoho Mail | 183 | 183 |
| Zoho Meeting | 16 | 16 |
| Zoho Notebook | 56 | 56 |
| Zoho Office Integrator | 32 | 32 |
| Zoho One | 35 | 35 |
| Zoho PageSense | 13 | 13 |
| Zoho Payments | 16 | 16 |
| Zoho Payroll | 184 | 184 |
| Zoho People | 242 | 242 |
| Zoho POS | 442 | 442 |
| Zoho Procurement | 78 | 78 |
| Zoho Projects | 126 | 126 |
| Zoho Recruit | 71 | 71 |
| Zoho SalesIQ | 329 | 329 |
| Zoho Sheet | 82 | 82 |
| Zoho Show | 70 | 70 |
| Zoho Sign | 28 | 28 |
| Zoho Social | 31 | 31 |
| Zoho Sprints | 75 | 75 |
| Zoho Survey | 6 | 6 |
| Zoho Tables | 74 | 74 |
| Zoho Vertical Studio | 21 | 21 |
| Zoho Webinar | 31 | 31 |
| Zoho Workdrive | 178 | 178 |
| Zoho Writer | 25 | 25 |
| Zoho Quartz | 3 | 3 |
| **Total** | **9,851** | **9,828** |

## Beyond-Zoho Services

| Service | Rendered rows | Unique operation keys |
|---|---:|---:|
| CloudSpend | 291 | 291 |
| EndpointCentral | 60 | 60 |
| Log360Cloud | 49 | 49 |
| MDM | 128 | 128 |
| Qntrl | 25 | 25 |
| Vani | 123 | 123 |
| SDP on Demand | 138 | 138 |
| Site 24x7 | 32 | 32 |
| BFSI | 120 | 120 |
| **Total** | **966** | **966** |

## Interpretation Rules

1. Catalog presence is provider reference evidence, not proof that Sylvara selected, enabled, licensed, authorized, or successfully called an operation.
2. `annotated_tool_name` is the human documentation label and never contains a product or server prefix. `operation_key` preserves the exact Tool Manual key, including the provider's own qualification where present.
3. Service plus operation key is the qualified technical identity because names can repeat across services.
4. Duplicate source rows are preserved for auditability but do not increase the unique available-operation count.
5. Parameters, scopes, side effects, limits, data-center behavior, and live request/response contracts must be verified again before implementation.
6. Sylvara MCP servers should expose the smallest workflow-specific subset, not an entire service catalog.

## Refresh Procedure

1. Open the current official Tool Manual from the Zoho MCP knowledge base.
2. Capture the rendered service list and Tool List operation-name column only.
3. Compare aggregate, service, rendered-row, and unique-key counts; record discrepancies.
4. Preserve source order and duplicate rows; do not copy descriptions or account-adjacent content.
5. Regenerate annotations using the documented rule and validate configured Sylvara selections against service-qualified operation keys.
6. Re-run repository safety and documentation tests before publication.
