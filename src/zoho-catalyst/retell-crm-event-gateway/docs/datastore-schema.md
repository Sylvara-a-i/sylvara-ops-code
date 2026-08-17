# Retell Event Receipt Data Store Schema

## Current Development Resource

The `RetellEventReceipts` table has been created in the Development environment of the existing Catalyst project named `Retell`. Production is not configured.

The table is an internal receipt ledger, not a transcript store and not a customer-facing reporting database. Its purpose is durable webhook acknowledgment, idempotency, controlled retries, CRM synchronization state, and retention cleanup.

## Permissions

| Role | Scope | Permissions |
|---|---|---|
| App Administrator | Global | Select, Insert, Update, Delete |
| App User | User | None |

Both functions must initialize the Catalyst SDK with Admin scope for Data Store operations. No browser or app-user access is required.

## Columns

| Column | Type | Required | Indexed / Unique | Purpose |
|---|---|---:|---|---|
| `IdempotencyKey` | Var Char (255) | Yes | Indexed, Unique | `event_type:provider_call_id` |
| `DeploymentEnvironment` | Var Char (32) | Yes | Indexed | Development or Production boundary |
| `EventType` | Var Char (64) | Yes | Indexed | Allowlisted Retell event |
| `ProviderCallId` | Var Char (255) | Yes | Indexed | Correlates all events for one call |
| `ProviderAgentId` | Var Char (255) | Yes | Indexed | Resolves the CRM Deal/client workflow |
| `ProviderPhoneNumber` | Encrypted Text | No | Not searchable | Optional called-number validation only |
| `PayloadHash` | Var Char (64) | Yes | No | SHA-256 digest of the exact raw body |
| `NormalizedPayload` | Encrypted Text | Yes | Not searchable | Bounded allowlisted event data only |
| `ProcessingStatus` | Var Char (64) | Yes | Indexed | Receipt and processor state |
| `AttemptCount` | Int | Yes | No | Processor claim count |
| `CRMCallId` | Var Char (64) | No | Indexed | Synchronized Zoho CRM Call ID |
| `CRMDealId` | Var Char (64) | No | Indexed | Resolved Zoho CRM Deal ID |
| `LastErrorCode` | Var Char (128) | No | Indexed | Stable sanitized error class |
| `ReceivedAt` | DateTime | Yes | Indexed | UTC-encoded receipt time |
| `ProcessedAt` | DateTime | No | Indexed | UTC-encoded terminal processing time |
| `ExpiresAt` | DateTime | Yes | Indexed | Retention cleanup boundary |
| `SchemaVersion` | Int | Yes | No | Receipt/normalization schema version |

Catalyst system columns `ROWID`, `CREATORID`, `CREATEDTIME`, and `MODIFIEDTIME` are platform-managed.

## Allowed Statuses

- `Received`
- `Queued`
- `Processing`
- `Retry Required`
- `Completed`
- `Quarantined`
- `Failed`

`Quarantined` is a deliberate hold for configuration, mapping, authorization, or data-contract failures. It is not automatically retried. `Retry Required` is reserved for transient failures.

## Retention

The initial receipt retention hypothesis is 90 days. A separate approved cleanup job must delete expired rows in bounded batches. No cleanup function is deployed by this package because the current request is limited to the two agreed functions.
