# Zoho CRM Synchronization Contract

## Current Gate

`CRM_WRITE_MODE` defaults to `disabled`. The processor durably holds each verified receipt as `Quarantined / CRM_WRITE_DISABLED` until the CRM schema and Catalyst Connection are separately approved and configured.

## Required Future Fields

No CRM field changes are included in this package. Before enabling writes, create and verify exact API names for:

### Deals

| Purpose | Recommended Label | Requirement |
|---|---|---|
| Provider agent mapping | Retell Agent ID | Unique or otherwise guaranteed one-to-one; searchable |
| Optional number validation | Voice Service Number | Provider-neutral phone field; only if number validation is enabled |

### Calls

| Purpose | Recommended Label | Requirement |
|---|---|---|
| Provider call identity | Provider Call ID | Unique/external identifier; required for idempotent synchronization |
| Provider name | Voice Provider | Optional |
| Latest event | Provider Event Type | Optional |
| Processing state | Voice Processing Status | Optional |
| Outcome | Voice Outcome | Optional |

Use exact API names from Zoho CRM metadata. Do not infer API names from labels.

## Standard Calls Fields Written

For a completed terminal event, the processor writes:

- `Subject`
- `Call_Type`
- `Call_Start_Time`
- `Call_Duration`
- `What_Id`
- top-level `$se_module`
- `Description`
- `Call_Result`
- `Call_Agenda`

The implementation deliberately excludes `Voice_Recording__s`, transcripts, recording URLs, caller phone numbers, caller names, addresses, raw metadata, and Retell dynamic variables.

## Mapping Rules

1. Resolve exactly one Deal by the configured Retell Agent ID field.
2. Optionally compare the encrypted called number to a configured Deal number field.
3. Resolve at most one Call by the configured Provider Call ID field.
4. Create the Call when no match exists; update it when one match exists.
5. Re-query after a CRM duplicate response to survive concurrent jobs.
6. Quarantine zero or multiple Deal matches and multiple Call matches.
7. Do not update Deal counters in version 1.

## OAuth Scopes

Use the least-privilege Catalyst Connection scopes required for the approved configuration:

```text
ZohoCRM.modules.deals.READ
ZohoCRM.modules.calls.CREATE
ZohoCRM.modules.calls.UPDATE
ZohoCRM.modules.calls.READ
ZohoCRM.coql.READ
```

If the connection UI requires broader grouped scopes, document the reason before approval rather than silently widening access.
