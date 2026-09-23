# Lead time-zone update receipt correction

Owner: Gabriel / CRM intake operations. Revision: 2026-09-23.
Status: **receipt correction published; runtime acceptance stopped on audit skew;
explicit-UTC correction is source-only and not runtime accepted**.

This replaces the body of the two existing create/edit normalization functions;
it does not add a function, workflow, CRM writer, field or scheduler. It addresses
the G1 intake-effects inventory in the [operator runbook](../../zoho-catalyst/revenue-desk-release/free-test-operator-runbook.md#g1-native-recovery-and-identity-reconciliation).

## Observed defect and bounded change

Read-only inspection found both published functions checking for `status: success`
after `zoho.crm.updateRecord`. The [official task contract](https://www.zoho.com/deluge/help/crm/update-record.html)
returns an `id` and modification metadata instead. The old predicate therefore
classifies a documented successful response as failure and, when the audit field
is configured, performs another update without that field. Null/ambiguous results
also cause that retry. This is a source-level reproduction, not evidence that a
particular tenant execution duplicated effects.

The receipt correction preserves normalization and converges blank, invalid and
changed values on one update attempt. It checks
the exact returned ID and expected success shape, never retries, and never logs
raw responses, source values or record identifiers. A rejected audit field now
requires reconciliation; dropping that evidence silently is not recovery.

The two declaration-first receipt corrections were subsequently published and
independently read back with unchanged workflow mappings. The first separately
allocated synthetic create invoked the create normalizer once and committed one
target/audit update. The canonical zone was correct, but the stored audit instant
was two hours ahead of the authoritative record-change time. Both timestamps had
the same offset; this was not just a UI display-zone difference. The remaining
two fixture saves were stopped, and the original record was preserved. A task
success receipt and platform Success did not make this runtime acceptance pass.

The smallest next candidate explicitly converts `zoho.currenttime` to UTC before
formatting the audit value with a numeric `+00:00` offset. Zoho documents
[explicit timezone conversion](https://www.zoho.com/deluge/help/functions/common/tostring.html)
and [CRM ISO-8601 date/time inputs](https://www.zoho.com/crm/developer/docs/api/v8/insert-records.html).
This removes implicit formatter-zone dependence; it does not establish whether
the earlier skew originated in the clock, formatting context or CRM parsing.
Do not subtract two hours, change tenant/user timezones, drop the audit field or
rewrite the preserved failed fixture. The candidate needs native compilation,
publication/readback and allocated runtime proof before it can be called fixed.

Unchanged: argument order, no-op for an already-matching target, clearing a stored
target for blank/unsupported source shape, and the three-argument task's automation
defaults. Zoho documents approval/Blueprint/orchestration defaults when options
are omitted; this correction neither enables workflows explicitly nor suppresses
those other effects. Their applicable live configuration remains part of the
separately allocated intake acceptance inventory.

This is not a full IANA validator, a concurrency fix or telephone activation
evidence. Existing workflow argument values are snapshots. Schedule/configuration
validation remains with the accepted Journey controller.

## Exact replacement and acceptance boundary

Use [the canonical source](normalize_lead_time_zone.deluge) for both existing
functions. Retain each original declaration: create uses
`automation.normalize_time_zone_iana_v4e2`; edit uses
`automation.normalize_time_zone_iana_v4e`. Only the declaration differs; do not
create a new function or alter either workflow association.

The native CRM editor's pre-save format check rejected the earlier file-level
header comment before the function declaration. The declaration must be the
first nonblank line; the preserved header now sits immediately inside its opening
brace. No Save was pressed during that reproduction. The corrected envelope was
subsequently published and read back for both receipt-correction functions. The
new explicit-UTC candidate has not been published; native compilation and actual
CRM behavior remain separate, unpassed checks for that delta.

Keep these existing mappings and seven argument positions unchanged:

| Argument | Authoritative binding |
| --- | --- |
| `module_api_name` | Literal `Leads` |
| `record_id` | Triggering Lead ID |
| `source_field_api` | Literal `Time_Zone` (compatibility argument) |
| `target_field_api` | Literal `Time_Zone_IANA_ID` |
| `source_value` | Triggering Lead's `Time_Zone` |
| `target_value` | Triggering Lead's `Time_Zone_IANA_ID` |
| `audit_field_api` | Literal `Time_Zone_Normalized_At` |

No live save or execution is authorized by source publication. Before a future
bounded installation: verify exact organization, function identities, current
bodies and mappings; retain private prestate; confirm save-time side effects and
allowance; approve at most two existing-function saves and independent published
readbacks. A source drift or import error stops the operation without retry.

Use a separately allocated synthetic Lead for runtime acceptance. Verify a changed
valid zone, unchanged zone, blank source and unsupported abbreviation; compare
target/audit values and actual update/action counts. Verify a definite rejected
update and ambiguous-result recovery only through an approved supported method,
not by manufacturing a tenant failure or replaying a successful Forms entry.
Error/null/malformed response branches currently have **offline evidence only**.
Successful task acknowledgment does not pass independent CRM readback.

The minimal native acceptance sequence is one separately allocated non-intake
synthetic Lead: create with `America/Chicago`, clear via native `-None-`, then
change to `America/Los Angeles`. Expected canonical values are `America/Chicago`,
logical empty (not the literal picker label), then `America/Los_Angeles`.
Before each next save, compare stored audit and authoritative change timestamps
as instants, not wall-time strings; the audit must fall between the initiating
save and committed change, allowing only their documented timestamp precision.
Correlate exact-record Timeline entries with function log parameters/counts;
check committed updates and queued actions separately. A platform Success or
two field-history changes does not prove two writes. Keep no-op/error branches
offline when the native trigger or picklist cannot exercise them safely.

Monitoring/recovery: fixed `tz_*` outcomes identify an operator check, not an
automatic retry queue. Gabriel reconciles the exact record, audit value and
downstream actions privately before any separately approved repair. Preserve
intake identity, consent timestamps and converted relationships. Containment is
to stop intake/retry execution; disabling a live workflow also needs scoped
approval. Do not roll back blindly to the known retry defect. An authorized code
rollback must be justified against the captured prestate and retain containment.

## Local verification

```powershell
python -m unittest tools.safety.tests.test_lead_time_zone_response -v
```

Tests use synthetic decision cases plus source guards; they do not interpret
Deluge, call CRM, prove import syntax or certify installed behavior. No credentials,
provider SDK, network, hosted evaluation or external model is used by the tests.
