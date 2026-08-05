# Zoho Evidence And Publication Standard

## Evidence Layers

Keep these layers separate:

1. **Official product capability** — a current official Zoho source documents a feature, endpoint, scope, limit, or behavior.
2. **Tool Manual catalog** — a dated official Tool Manual snapshot lists a service-qualified operation key and prefix-free annotation.
3. **Preconfigured template membership** — a dated portal template lists a specific group of tools.
4. **Configured MCP selection** — one inspected neutral role contains a service-qualified operation key on the observation date.
5. **Advertised MCP contract** — one inspected server exposes a description and input contract for that operation.
6. **Effective Sylvara access** — an exact server identity, organization, environment, grant, plan, role, and feature configuration pass a current authorized acceptance check.

Evidence at one layer never proves a higher layer. A repository reference, archived file, API link, or tool name is not deployment evidence.

## Sanitized Derivative Rules

When adapting authorized documentation from another repository:

- rewrite it for Sylvara; do not copy tenant sections or perform blanket name replacement;
- remove business-specific fields, modules, layouts, workflows, IDs, routes, aliases, examples, and decisions;
- retain only portable product behavior, generic controls, and official-source links;
- assign a new Sylvara path and a dated research cutoff;
- label adoption and effective access **Unknown** until verified;
- record the derivative in the source manifest without publishing private source paths or identifiers; and
- scan and manually review the derivative before publication.

## Public Repository Boundary

GitHub may contain sanitized standards, source, tests, schemas, decision records, tool-name catalogs, and synthetic examples. It must not contain credentials, tokens, populated environment files, private endpoints, live identifiers, PII, financial records, contracts, raw payloads, logs, screenshots, or exact private deployment controls that materially enable abuse.

## Live Use Gate

Before using a documented capability:

1. refresh the official source when the behavior or limit may have changed;
2. verify the exact Sylvara product, tenant, environment, identity, role, and feature state;
3. inspect the authorized tool contract and its complete response behavior;
4. propose exact current and intended state with rollback;
5. obtain approval scoped to the specific live action;
6. apply one bounded change; and
7. read authoritative state back independently.

Stop on ambiguity, stale state, missing prerequisites, untyped writes, incomplete responses, unsafe rollback, or a target mismatch.
