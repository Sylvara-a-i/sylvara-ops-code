# Zoho Sites Reference

## Status And Scope

- Artifact class: **Reference**
- Research cutoff: **2026-07-20**
- Sylvara adoption: **Unknown**
- Effective Sylvara access: **Unknown**
- Evidence basis: official Zoho Sites documentation reviewed in the audited source material.

This handbook covers durable Sites behavior for a public website, member entry point, forms, integrations, and Dynamic Content. It is not proof that a Sylvara site, domain, member portal, connection, or published component exists.

No general public REST API for arbitrary site, page, or builder administration was identified at the research cutoff. Do not invent API paths or treat browser automation as a supported deployment contract.

## Role And Ownership

Sites is a public presentation and entry layer. It can host pages, navigation, forms, embeds, member access, and approved Dynamic Content, but it is not authoritative operational state.

CRM or another approved application owns accepted relationship data. Forms or Creator may own bounded intake and workflow state. WorkDrive owns private documents. Sites should display only approved, minimized projections and links.

Keep the public path small. Do not place credentials, private identifiers, internal routing, or sensitive payloads in HTML, page variables, JavaScript, analytics tags, query strings, or browser storage.

## Authentication And Discovery

Before implementation, inspect and record privately:

1. account, site, edition, data center, owner, and contributors;
2. mapped domains, DNS, TLS, canonical host, and redirects;
3. publication state, page versions, backups, and recovery options;
4. page tree, menus, headers, footers, scripts, CSS, embeds, and analytics;
5. Dynamic Content collections, Face views, functions, variables, and Connections;
6. native forms, embedded Forms, CRM forms, and downstream mappings;
7. member portal, sign-in methods, access restrictions, and CRM member sync; and
8. SEO, robots, sitemap, structured data, and public indexing choices.

Treat member, contributor, connection, and component names as live metadata. Never infer an identifier or access rule from a label or another site.

## Resource And Workflow Model

| Resource | Purpose | Control requirement |
|---|---|---|
| Site | Public publication boundary | Bind approved organization, domain, and owner |
| Page | Public or restricted content | Classify access, indexing, scripts, and release state |
| Page version | Builder recovery point | Verify what is and is not restored |
| Dynamic Content collection | Server-rendered data component | Define source, query, cache, and empty/error behavior |
| Face view | Dynamic Content presentation | Escape output and keep authorization server-side |
| Server function | Data retrieval and transformation | Bound inputs, calls, time, output, and logs |
| Connection | Managed external authorization | Use least privilege and separate environments |
| Form/embed | Intake or external component | Validate origin, schema, privacy, and downstream acceptance |
| Member | Authenticated external viewer | Enforce access at the supported server/product layer |
| Contributor | Builder or administrative user | Apply least privilege and periodic review |

Dynamic Content is a server-function and view model, not evidence of a general site-management API. Client navigation and rules improve presentation but cannot authorize sensitive access.

## Automation And Webhooks

Supported automation centers on Dynamic Content functions and Connections, form integrations, member synchronization, and approved embedded products.

- Use Connections for managed server-side authorization; never expose tokens to page code.
- Validate all request and member context before calling another system.
- Cache only content explicitly approved for the same audience and vary cache keys safely.
- Render a bounded empty or unavailable state when a dependency fails.
- Treat native, CRM, and embedded forms as different contracts.
- Keep header/footer code and third-party scripts under source and privacy review.
- Do not treat analytics, browser callbacks, or page visits as authoritative events.

If an intake component triggers a downstream change, the receiver must apply its own authentication, validation, duplicate protection, and readback. Sites publication does not authorize the downstream operation.

## Failure, Retry, And Idempotency

Dynamic Content should fail closed without disclosing stack traces, internal identifiers, request data, or response bodies. Bound external calls and use a safe public fallback.

Do not retry a create, send, or other side effect from a page request after an ambiguous timeout. Use a durable operation key at the receiving service and reconcile authoritative state before replay.

Publishing and data operations are separate. Roll back content with an approved page/site version or unpublish action, and disable a broken connection or component independently. Confirm the public host and affected pages after every change.

## Validation

Validate in preview and on the intended public host:

- correct account, site, domain, TLS, redirects, and canonical URL behavior;
- public, password, member, and restricted-page access with each role;
- Dynamic Content success, empty, unauthorized, slow, and dependency-failure states;
- input validation, output escaping, cache separation, and secret-free logs;
- native and embedded form validation, duplicates, consent, and downstream rejection;
- member synchronization without overbroad access;
- responsive layout, keyboard access, labels, contrast, and error messages;
- SEO, sitemap, robots, metadata, and accidental indexing;
- third-party scripts, consent behavior, content-security constraints, and performance; and
- page-version rollback, unpublish, recovery, and post-release readback.

Use synthetic public content and accounts. Keep real member lists, form submissions, analytics details, and debug evidence private.

## Official Sources

- [Dynamic Content](https://help.zoho.com/portal/en/kb/zohosites/help-guide/manage/dynamic-content/articles/dynamic-content)
- [Sites Connections](https://help.zoho.com/portal/en/kb/zohosites/help-guide/manage/dynamic-content/articles/zoho-sites-connections)
- [Header and footer code](https://help.zoho.com/portal/en/kb/zohosites/help-guide/customization/code/articles/zoho-sites-header-and-footer-code)
- [Integrating Zoho Forms](https://help.zoho.com/portal/en/kb/zohosites/help-guide/edit-website/forms/articles/zoho-sites-integrating-zoho-forms)
- [Native Sites forms](https://help.zoho.com/portal/en/kb/zohosites/help-guide/forms/articles/zoho-sites-forms)
- [Member portal](https://help.zoho.com/portal/en/kb/zohosites/help-guide/roles-and-permissions/member-portal/articles/member-portal-sites)
- [Access restriction](https://help.zoho.com/portal/en/kb/zohosites/help-guide/roles-and-permissions/access-control/articles/access-restriction)
- [Domain mapping](https://help.zoho.com/portal/en/kb/zohosites/help-guide/configuration/domain-ssl/articles/zoho-sites-domain-mapping)
- [Publish options](https://help.zoho.com/portal/en/kb/zohosites/help-guide/configuration/site-options/articles/publish-options)
- [Page versions](https://help.zoho.com/portal/en/kb/zohosites/help-guide/pages/articles/page-versions)

## Exclusions

This public reference intentionally excludes live domains, site and page names, member or contributor identities, form mappings, connection names, scripts, analytics identifiers, Dynamic Content configuration, DNS values, debug output, credentials, submissions, and organization-specific routing rules.

Plans, quotas, member features, integration behavior, publication recovery, and builder UI are volatile. Verify them immediately before adoption or release.
