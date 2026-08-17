# Retell-to-Zoho CRM Catalyst Event Gateway

## Status

This package is the reviewed source implementation for the existing Zoho Catalyst project named `Retell`.

| Component | Development State |
|---|---|
| Catalyst project | Existing; name retained as `Retell` |
| `RetellEventReceipts` Data Store table | Created and permissioned |
| `retell_events` Advanced I/O function | Source complete; not deployed by the current plugin surface |
| `process_retell_event` Job Function | Source complete; not deployed by the current plugin surface |
| Function Job Pool | Not created; current routine plugin has no create-pool action |
| Catalyst environment variables | Not created; current routine plugin has no variable-management action |
| Catalyst Zoho CRM Connection | Not created; current plugin has no Connection create/authorize action |
| CRM writes | Disabled by default |
| Retell webhook registration | Not performed |
| Production | Not configured or approved |

No Breakglass action is required or appropriate for the remaining routine setup.

## Purpose

The gateway turns verified Retell call events into a durable, idempotent processing stream and, only after a separate approval gate, synchronizes controlled call outcomes to Zoho CRM.

It does not participate in the live audio path. Retell remains responsible for the conversation and telephony session; Catalyst receives asynchronous post-call and transfer events. This keeps the customer call path independent from CRM latency or temporary CRM outages.

## Architecture

```text
Retell account-level webhook
        |
        | POST /retell/events
        v
retell_events (Advanced I/O, Node 24, 256 MB)
  1. Enforce method, route, content type, and body limit
  2. Verify X-Retell-Signature over the exact raw body
  3. Reject stale requests and unsupported events
  4. Normalize an explicit non-sensitive allowlist
  5. Claim event_type:call_id in RetellEventReceipts
  6. Submit only receipt_row_id to the Job Pool
  7. Return 204 after durable receipt and accepted Job
        |
        v
retell_event_jobs (Function Job Pool, planned 512 MB)
        |
        v
process_retell_event (Job Function, Node 18, 256 MB)
  1. Claim the receipt and increment attempts
  2. Stop safely when CRM_WRITE_MODE is disabled
  3. Resolve exactly one Deal by Retell Agent ID
  4. Resolve at most one Call by Provider Call ID
  5. Create or update one CRM Call
  6. Mark Completed, Quarantined, Retry Required, or Failed
```

The receiver is intentionally short and deterministic because Retell expects a successful response within its webhook timeout. CRM work is asynchronous and retryable.

## Function 1: `retell_events`

Type: Advanced I/O  
Runtime: Node 24  
Memory target: 256 MB  
Preferred route: `POST /retell/events`

### Accepted Events

- `call_ended`
- `call_analyzed`
- `transfer_started`
- `transfer_bridged`
- `transfer_cancelled`
- `transfer_ended`

`transcript_updated` is deliberately excluded. The integration does not need streaming transcript traffic to prove missed-call capture or create a reliable CRM Call.

### Verification and Input Controls

The receiver:

- reads the exact raw request bytes;
- verifies `X-Retell-Signature` before parsing JSON;
- applies the five-minute freshness window by default;
- accepts `application/json` only;
- caps the body at 256 KiB by default;
- requires safe provider call and agent identifiers;
- rejects events outside the configured allowlist;
- never logs the raw body, signature, API key, phone number, transcript, or provider response.

### Data Minimization

The normalized payload can contain only:

- event type;
- provider call ID;
- provider agent ID;
- call direction and type;
- call status;
- start and end timestamps;
- duration seconds;
- disconnection reason;
- selected boolean or short analysis values;
- explicitly allowlisted scalar custom-analysis fields;
- a bounded summary only when `STORE_CALL_SUMMARY=true` is separately approved.

The normalizer excludes transcripts, transcript objects, tool-call transcripts, recording URLs, caller numbers, names, addresses, raw metadata, dynamic variables, and unknown nested objects.

The Retell-controlled called number may be stored separately in the encrypted `ProviderPhoneNumber` column solely for optional Deal-number validation. It is never copied into the normalized payload or logs.

### Idempotency

The durable key is:

```text
event_type:provider_call_id
```

The exact raw payload receives a SHA-256 digest. Behavior is:

- first key and payload: insert one receipt and submit a Job;
- duplicate key with the same digest: acknowledge without a second receipt;
- duplicate key with a different digest: quarantine as an idempotency conflict;
- Job submission failure: mark `Retry Required` and return 503 so Retell can retry.

Duplicate Job dispatch remains safe because the processor and future CRM Provider Call ID field are both idempotent.

## Function 2: `process_retell_event`

Type: Job Function  
Runtime: Node 18  
Memory target: 256 MB  
Planned Job Pool: `retell_event_jobs`, 512 MB

The Job parameter contains only:

```json
{
  "receipt_row_id": "<Catalyst-ROWID>"
}
```

No transcript, phone number, CRM token, or provider payload is placed in Job parameters.

### CRM Write Gate

The default is:

```text
CRM_WRITE_MODE=disabled
```

In this mode the processor validates the receipt, records the attempt, and holds the receipt as `Quarantined / CRM_WRITE_DISABLED`. It does not obtain a CRM token and does not call Zoho CRM.

Enabling writes requires the separate CRM schema and Connection approvals in [`docs/crm-contract.md`](docs/crm-contract.md).

### CRM Mapping

When enabled, the processor:

1. resolves exactly one Deal by the configured Retell Agent ID field;
2. optionally validates the encrypted provider number against a Deal field;
3. resolves zero or one Call by the unique Provider Call ID field;
4. creates a Call when no match exists or updates the existing Call;
5. re-queries after a CRM duplicate response to handle concurrent Jobs;
6. quarantines zero/multiple Deal matches and multiple Call matches.

`call_ended` and `call_analyzed` can create or update the CRM Call. Transfer events update an existing Call when one already exists; otherwise they remain durable receipts until a terminal event arrives. Out-of-order delivery is therefore safe.

### CRM Call Contract

The processor uses the standard Calls fields required by Zoho CRM and keeps `$se_module` at the top level when `What_Id` is present. A positive duration is required; the code rounds up to the next minute rather than writing zero. Receipts without a usable positive duration are quarantined instead of fabricating activity data.

The description is a bounded structured summary of safe operational fields. It never writes `Voice_Recording__s` or any raw transcript/recording/caller PII.

## Failure Classes

| State | Meaning | Automatic Retry |
|---|---|---:|
| `Completed` | Event was safely handled; CRM may or may not have required a write | No |
| `Quarantined` | Configuration, authorization, schema, or mapping defect needs review | No |
| `Retry Required` | Transient CRM, network, Data Store, or Job issue | Yes, within configured attempts |
| `Failed` | Transient failures exhausted the processor attempt ceiling | No |

Only stable error codes are persisted. Raw exception messages and upstream responses are not stored.

## Local Validation

The root package has no runtime dependencies. Run:

```bash
npm run ci
```

The suite currently verifies:

- exact-raw-body HMAC verification;
- stale and tampered signature rejection;
- transcript, recording, caller, metadata, and dynamic-variable exclusion;
- event allowlisting;
- durable receipt and Job dispatch behavior;
- duplicate acknowledgment and conflicting duplicate quarantine;
- queue-failure retry behavior;
- exact CRM API-name validation;
- trigger suppression on CRM writes;
- top-level `$se_module` and omitted recording field;
- disabled CRM gate;
- one-Call synchronization;
- zero/multiple Deal quarantine;
- transient CRM retry state.

The two function folders pin the Catalyst Node SDK to `3.4.0`. Install function dependencies only in a secure local deployment checkout.

## Environment Variables

Use [`.env.example`](.env.example) as the inventory. Values belong in Catalyst Development, not in Git.

The variables that must receive operator-provided values are:

- `RETELL_WEBHOOK_API_KEY`: Retell key with webhook verification capability; secret.
- `CRM_CONNECTION_LINK_NAME`: authorized Catalyst Connection name; not a token.
- `CRM_DEAL_AGENT_ID_FIELD`: approved Deal field API name.
- `CRM_CALL_PROVIDER_ID_FIELD`: approved unique Call field API name.
- optional provider-neutral Deal/Call field API names.

Do not hardcode any credential or private Catalyst identifier in source.

## Deployment

Follow [`docs/deployment-checklist.md`](docs/deployment-checklist.md). The remaining setup cannot be completed through the currently exposed routine Catalyst actions because they do not include:

- Function create/upload/deploy;
- Function Job Pool creation or Function association;
- environment-variable create/read;
- Catalyst Connection create/read/authorize;
- API Gateway function-route binding after deployment.

The existing routine plugin can inspect resources, create Data Store schema, update table permissions/scopes, update memory/stack on an already-existing function, and execute an already-existing function. It cannot bootstrap these two functions.

## Operational Boundaries

Do not add a customer portal, transcript archive, broad analytics store, Deal counter logic, generalized multi-provider abstraction, or production deployment to this version. Those are premature until controlled tests prove the two-function path, CRM mapping, and customer value.

The next meaningful gate is not more code. It is a successful remote synthetic Development test followed by approval of the minimal CRM fields and Connection.

## Primary Documentation

- Retell secure webhook verification: <https://docs.retellai.com/features/secure-webhook>
- Retell webhook events and retry behavior: <https://docs.retellai.com/features/webhook-overview>
- Catalyst Job Functions: <https://docs.catalyst.zoho.com/en/serverless/help/functions/job-function/>
- Catalyst Node.js Job submission: <https://docs.catalyst.zoho.com/en/sdk/nodejs/v2/job-scheduling/jobs/create-job/>
- Zoho CRM V8 Insert Records / Calls: <https://www.zoho.com/crm/developer/docs/api/v8/insert-records.html>
- Zoho CRM V8 COQL: <https://www.zoho.com/crm/developer/docs/api/v8/COQL-Overview.html>
