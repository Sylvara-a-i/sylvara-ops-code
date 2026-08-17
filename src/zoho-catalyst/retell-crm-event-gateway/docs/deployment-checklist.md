# Development Deployment Checklist

## Release Boundary

This checklist is for Development only. Do not deploy to Production, register a live Retell webhook, route real customer calls, or enable CRM writes without separate explicit approval.

## 1. Prerequisites

- Existing Catalyst project: `Retell`
- Development Data Store table: `RetellEventReceipts`
- Zoho Catalyst CLI authenticated to the correct organization
- Source branch reviewed and tests passing
- No `.catalystrc`, `catalyst.json`, API key, token, or private project identifier committed

## 2. Initialize the Local Catalyst Project

From a secure local checkout, initialize against the existing project using the actual organization and project IDs obtained from Catalyst. Do not place those IDs in this public repository.

```bash
catalyst init --org <organization-id> -p <project-id> -ni
```

Add the functions using the CLI so Catalyst creates the correct runtime metadata:

```bash
catalyst functions:add --name retell_events --type aio --stack node24 -ni
catalyst functions:add --name process_retell_event --type job --stack node18 -ni
```

Copy the reviewed source from this package into the generated function folders. Ensure both targets are present in the local `catalyst.json`.

## 3. Create the Function Job Pool

Create a Function Job Pool named `retell_event_jobs` with 512 MB memory. Associate the `process_retell_event` Job Function with that pool. Keep the Job Function itself at 256 MB so its memory is below the pool allocation.

Configured submission behavior:

- Immediate Job
- 3 platform retries
- 5-minute retry interval
- Job parameter contains only `receipt_row_id`

## 4. Configure Development Variables

Create every variable shown in `.env.example` in Catalyst Development. Store `RETELL_WEBHOOK_API_KEY` as a secret. Do not paste the value into GitHub, chat, logs, screenshots, or documentation.

Keep:

```text
VOICE_ENVIRONMENT=development
CRM_WRITE_MODE=disabled
STORE_CALL_SUMMARY=false
```

## 5. Install Function Dependencies

Run inside each function folder:

```bash
npm install
```

The package pins `zcatalyst-sdk-node` to `3.4.0`. Commit a reviewed lockfile only if it contains no private registry URL or credential.

## 6. Deploy the Two Functions to Development

```bash
catalyst deploy --only functions:retell_events
catalyst deploy --only functions:process_retell_event
```

Set memory:

- `retell_events`: 256 MB
- `process_retell_event`: 256 MB

Do not rely on a reported `is_deployed` flag alone. Verify the functions in the Catalyst Console and run remote synthetic tests.

## 7. Configure the HTTP Route

Preferred route:

```text
POST /retell/events
```

Route it to the `retell_events` Advanced I/O function. Keep `ALLOW_ROOT_WEBHOOK_PATH=false`. If the direct Catalyst function URL must be used temporarily, explicitly set `ALLOW_ROOT_WEBHOOK_PATH=true` and retain signature verification.

## 8. Synthetic Receiver Tests

Use a non-production Retell webhook key and synthetic payloads only. Verify:

- valid signature returns 204;
- stale or invalid signature returns 401;
- unsupported event returns 422;
- oversized request returns 413;
- first event creates one receipt and one Job;
- duplicate same payload returns 204 without a second durable receipt;
- conflicting duplicate is quarantined;
- queue failure returns 503 and marks `Retry Required`;
- no transcript, recording URL, caller phone, name, address, metadata, or dynamic variable is stored or logged.

## 9. Processor Tests With CRM Writes Disabled

Submit a synthetic Job with a valid receipt ROWID. Confirm:

- the Job Function runs in the configured Job Pool;
- receipt attempt count increments;
- receipt ends in `Quarantined / CRM_WRITE_DISABLED`;
- no CRM request is made;
- logs contain only component, outcome code, status, and elapsed time.

## 10. Separate Approval Before CRM Writes

Before setting `CRM_WRITE_MODE=enabled`:

1. Approve and create the exact Deal and Call fields in `crm-contract.md`.
2. Verify the Provider Call ID field is unique.
3. Create and authorize the Catalyst Zoho CRM Connection with least-privilege scopes.
4. Fill the exact API names in Catalyst variables.
5. Run synthetic Deal/Call mapping tests in Development.
6. Confirm zero/multiple matches quarantine cleanly.
7. Confirm one provider call produces one CRM Call across duplicate and out-of-order events.

## 11. Separate Approval Before Retell Registration

Only after the receiver passes remote synthetic tests:

- configure one account-level Retell webhook;
- select only the allowlisted events;
- do not enable `transcript_updated`;
- do not route real prospect or client calls under the current legal/compliance gate.

## 12. Production Release Gate

Production requires its own variables, secret, Connection, Data Store schema, Job Pool, route, alerting, rollback plan, deployment approval, and post-release verification. Never copy Development credentials or data into Production.
