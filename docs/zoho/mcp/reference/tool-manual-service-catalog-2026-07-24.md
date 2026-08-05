# Zoho MCP Tool Manual Service Catalog

## Evidence Status

- Classification: **Reference**
- Tool Manual snapshot date: **2026-07-24**
- Zoho services: **51 services / 9,697 rows**
- Extended Zoho-family services: **8 services / 836 rows**
- Total: **59 services / 10,533 service-qualified rows**
- Sylvara installation, authorization, plan availability, and effective access: **Unknown**

This catalog preserves the complete service/count index from a dated Tool Manual review. It does not republish a large account-adjacent name export or claim that any service is installed, licensed, configured, authorized, or safe for Sylvara.

Before selecting a tool, start from the current [Zoho MCP knowledge-base index](https://help.zoho.com/portal/en/kb/mcp), open its interactive Tool Manual, and inspect the [implementation guide](https://help.zoho.com/portal/en/kb/mcp/implementation-guide/articles/zoho-mcp-implementation-guide) and [supported-services list](https://www.zoho.com/mcp/services/zoho-services.html). Verify the exact name, parameters, scopes, side effects, limits, data-center behavior, plan availability, and response contract in the current Tool Manual. The previously captured direct Tool Guide article route returned HTTP 404 during the 2026-08-04 verification, so this repository links the stable knowledge-base index instead.

## Zoho Services

| Service | Tool rows |
|---|---:|
| Bigin | 70 |
| Catalyst by Zoho | 176 |
| Zoho Analytics | 25 |
| Zoho Apptics | 42 |
| Zoho Assist | 16 |
| Zoho Billing | 453 |
| Zoho Bookings | 27 |
| Zoho Books | 1,090 |
| Zoho Calendar | 52 |
| Zoho Cliq | 454 |
| Zoho Commerce | 153 |
| Zoho Creator | 37 |
| Zoho CRM | 1,089 |
| Zoho DataPrep | 34 |
| Zoho Desk | 269 |
| Zoho Expense | 168 |
| Zoho Inventory | 777 |
| Zoho Invoice | 526 |
| Zoho Learn | 29 |
| Zoho Lens | 23 |
| Zoho Mail | 183 |
| Zoho Notebook | 55 |
| Zoho Payments | 16 |
| Zoho Payroll | 150 |
| Zoho People | 242 |
| Zoho POS | 442 |
| Zoho Projects | 126 |
| Zoho Recruit | 71 |
| Zoho SalesIQ | 329 |
| Zoho Sheet | 82 |
| Zoho Sign | 28 |
| Zoho Social | 31 |
| Zoho Sprints | 75 |
| Zoho Survey | 6 |
| Zoho Vertical Studio | 21 |
| Zoho WorkDrive | 178 |
| Zoho Writer | 25 |
| Zoho Backstage | 49 |
| Zoho CommandCenter | 81 |
| Zoho Connect | 280 |
| Zoho Directory | 34 |
| Zoho ERP | 1,020 |
| Zoho IoT | 314 |
| Zoho Meeting | 16 |
| Zoho Office Integrator | 32 |
| Zoho One | 35 |
| Zoho PageSense | 13 |
| Zoho Procurement | 78 |
| Zoho Show | 70 |
| Zoho Tables | 74 |
| Zoho Webinar | 31 |
| **Total** | **9,697** |

## Extended Zoho-Family Services

| Service | Tool rows |
|---|---:|
| CloudSpend | 291 |
| Endpoint Central | 60 |
| Log360 Cloud | 49 |
| MDM | 128 |
| Qntrl | 25 |
| Vani | 123 |
| ServiceDesk Plus On-Demand | 128 |
| Site24x7 | 32 |
| **Total** | **836** |

## Interpretation Rules

1. Row counts are dated catalog evidence, not enabled-tool counts.
2. A service can have a Tool Manual surface without a preconfigured template.
3. A preconfigured template can contain only a small subset of a service's documented tools.
4. Identical names can represent different APIs in different services; always qualify a tool by service.
5. Portal membership and Tool Manual snapshots can drift independently.
6. Exact live contracts must be retrieved again before implementation.
7. Sylvara MCP servers should expose the smallest workflow-specific subset, not an entire service catalog.

## Refresh Procedure

1. Record the current Tool Manual publication date or immutable bundle fingerprint privately.
2. Export the service-qualified catalog through an approved process.
3. Compare service counts and names against this snapshot.
4. Review additions, removals, renames, parameters, scopes, and side effects.
5. Update only sanitized evidence; exclude portal identities, account state, server names, and authorization details.
6. Re-run repository safety and documentation tests before publication.
