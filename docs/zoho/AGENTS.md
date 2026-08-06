# Zoho Documentation Instructions

These rules apply under `docs/zoho/` and supplement the repository root instructions.

## Evidence Layers

Keep these evidence layers separate:

1. current official Zoho documentation for generic product behavior;
2. a dated Tool Manual catalog entry for a provider operation;
3. membership in a dated preconfigured provider template;
4. a configured MCP selection identified by service and prefix-free catalog operation key;
5. the selected connector's currently advertised tool contract;
6. effective tenant access observed in the correctly identified Sylvara tenant;
7. an approved Sylvara requirement, schema, or interface describing desired state; and
8. independent readback proving deployed state.

One layer never proves another. A catalog entry, UI label, example payload, prior tenant, or successful call is not a complete contract. Treat returned `api_name`, type metadata, environment, role, organization, and response shape as authoritative only for the observation actually made. Record the verification date for volatile facts and use `Unknown` where evidence is missing.

## Documentation Scope

- Read [`README.md`](README.md) and the owning product standard before editing.
- Keep reusable Zoho governance here. Keep deployment, validation, rollback, and integration-specific decisions beside the owning implementation.
- Preserve only the minimum official behavior, Sylvara decision, provenance, and link needed to implement safely; do not copy official documentation wholesale.
- Do not import another tenant's modules, fields, layouts, rules, identifiers, connections, examples, or business logic.
- Do not create speculative product scaffolding. A proposed schema or interface must name the concrete workflow and remain visibly proposed until readback.
- Keep secret values, endpoints, private hosts, connection names, live paths, platform identifiers, raw payloads, customer data, documents, signatures, and financial data outside GitHub and logs.

## Live Evidence And Authority

For tenant-specific work, start with the least-sensitive identity and metadata reads. Before a high-risk write, require the exact target, typed operation contract, fresh prestate, approved proposed state, duplicate control, rollback or containment, and independent readback. Fail closed on unknown organization, environment, permission, field semantics, workflow triggers, subform behavior, verification, or response completeness.

Editing documentation, passing tests, or merging a pull request does not authorize a live Zoho read or write. Report the evidence layer reached, unresolved unknowns, manual setup, and the separate approval required for any external action.
