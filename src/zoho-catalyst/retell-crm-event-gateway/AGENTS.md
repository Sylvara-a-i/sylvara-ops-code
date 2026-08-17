# Retell CRM Event Gateway Instructions

## Scope

This package contains the two-function Zoho Catalyst reference implementation for the Sylvara `Retell` project:

- `retell_events`: public Advanced I/O receiver for verified Retell webhook events.
- `process_retell_event`: private Job Function for asynchronous Zoho CRM synchronization.

## Non-Negotiable Controls

- Development only until a separate production release is explicitly approved.
- Keep `CRM_WRITE_MODE=disabled` until the exact CRM fields, OAuth scopes, and test plan are approved.
- Never commit API keys, OAuth credentials, access tokens, project or organization IDs, private endpoints, real phone numbers, transcripts, recording URLs, caller PII, or raw production payloads.
- Verify the Retell signature against the exact raw body before JSON parsing.
- Store only the normalized allowlist. Do not store transcripts, recordings, caller numbers, names, addresses, metadata, or dynamic variables.
- One provider call ID must map to at most one Zoho CRM Call. Zero or multiple Deal mappings are quarantined.
- Do not increment Deal counters in this version.
- Do not use Breakglass to perform routine setup or deployment.

## Validation

Run from this directory:

```bash
npm run ci
```

A change is not ready if syntax checks or tests fail. Add tests for every new event, mapping rule, failure class, or data field.
