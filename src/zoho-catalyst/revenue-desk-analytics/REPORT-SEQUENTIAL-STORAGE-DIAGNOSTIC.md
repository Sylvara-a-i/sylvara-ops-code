# Protected sequential uniqueness diagnostic

Schema 5 selects a bounded sequential probe through the existing pinned Development binding and fixed `qualify_storage` action. Schemas 3 and 4 retain the original overlapping root/successor acceptance. Callers cannot select the probe through command data. The schema-5 operation digest has a separate `sequential_unique_diagnostic_v1` domain. Tuple shape is unchanged; the binding, source revision and exact installed candidate must be freshly reviewed before preparation.

The schema-5 window is 15 minutes, with the existing ten-minute preparation margin. It admits one durable receipt and at most two report inserts, three report reads and one admission read: seven DataStore attempts, at most three retained synthetic rows when uniqueness is defective. It uses the existing table, managed runtime user/admin path and RAW no-retry transport. No new grants, credentials, indexes or storage are introduced.

Sequence: admission insert/read; empty root precheck; first root insert/read; only after a verified accepted first insert, second distinct contender insert/read at the same slot. There are no successor inserts. Unknown first acknowledgements stop before the second contender. Unexpected rows, ambiguous responses, expired authority, provenance/ACK mismatch or a second accepted contender hold without replay or deletion.

A successful result is `storage_sequential_duplicate_rejected`, with a verified duplicate response, immutable single-row readback, seven requests and `concurrencyProven:false`, `qualificationAuthority:false`, `deliveryAuthority:false`. It proves sequential rejection only. It cannot authorize generation, upload, CRM projection, sending or concurrent ownership. Failure holds preserve all rows and consumption evidence.

Only schema 5 enables additional provider diagnostics. Numeric HTTP status is bounded to 100-599. SDK rejection classification uses only an own data-property `code`: exact `DUPLICATE_VALUE`, exact `INVALID_DATA`, `other` or `unknown`. No messages, values, headers, stacks or arbitrary string parsing are logged. Separate last insert status/code survives later readback. Missing status remains absent rather than borrowing a prior request's status. Existing schema-3/4 provider diagnostics remain unchanged.

This is an offline candidate. Independent review, canonical verification, exact candidate extraction/install parity, fresh protected bindings, approved invocation budget/cost/expiry and parent coordination are prerequisites. No live preparation claim, deployment or invocation is authorized by this document. Preserve consumed operations and installed rollback archives. Containment is to disable the diagnostic admission; package rollback does not remove retained rows or establish uniqueness.
# Closed response-decode observations

When the existing storage-provider diagnostic switch is enabled, the transport records only closed categories for UTF-8/JSON decoding, root and `data` types, array cardinality, envelope status, content-type class, and deadline state. It never records response bytes, arbitrary header values, row contents, or thrown messages. `requestApiVersion` identifies the installed SDK's fixed v1 request contract; it is not evidence of a response API version.

The immutable `firstDecodeFailure` snapshot retains the first decoding failure and its operation even when reconciliation later receives a valid response. Current-response fields remain separate. Only snapshots issued by the existing tracker/error boundary are eligible for failure logging.

These observations do not change response acceptance, request budgets, cancellation, retries, or execution authority. The expected array envelope follows the official [Catalyst REST reference](https://docs.catalyst.zoho.com/en/api/oauth2/generate-grant-token/) and installed SDK contract; documentation cannot establish the shape of an unread live response. A held or ambiguous attempt remains held and must not be retried without its own authority.

# Exact INT version representation

Independent Development readback observed canonical decimal strings for the INT-schema `SchemaVersion` and `RD_REPORT_VERSION` columns. The original insert acknowledgement representation was not retained, so this observation does not prove an earlier acknowledgement failure's cause or qualify storage.

For these two columns only, acknowledgement and independent readback must equal the submitted positive int32 expectation, either as that exact number or as `String(expected)`. Whitespace, signs, leading zeros, decimal/exponent strings, differing values and noninteger or out-of-range values are rejected. Readback of other columns remains strictly equal. The comparison never rewrites the acknowledgement, stored row, payload bytes or hashes.

The existing successor decoder uses broader numeric coercion for schema projection; this contract deliberately does not adopt it. Parsed JSON numbers retain their numeric value rather than raw token spelling, so numeric `2.0` and `2e0` are indistinguishable from numeric `2`; string forms remain rejected. This compatibility preserves semantic version equality without granting execution, retry, concurrency, qualification or delivery authority.

The immutable first validation failure records only closed location/reason enums for projection, row/creator and field checks. No values, arbitrary field names or identifiers enter this diagnostic.

# Exact Boolean insert acknowledgement representation

The ReportRuns insert acknowledgement accepts the submitted Boolean or its exact lowercase `true`/`false` string for five schema-pinned columns: `ActualEstimatedSeparated`, `CrossClientIsolationPassed`, `DuplicateSendGuardPassed`, `ReportTotalsReconciled` and `AutoDeliveryEnabledAtRun`. The expected value must itself be a Boolean. Opposite values, numbers, whitespace, mixed case, null and object/array forms fail the existing acknowledgement check before further I/O.

This comparison applies only to the insert acknowledgement. Independent readback still requires native Boolean equality; submitted rows, acknowledgement objects, payload bytes and hashes are unchanged. Other acknowledgement fields retain their existing checks. This compatibility does not change operation counts, replay handling, evidence scope or the qualification and delivery holds described above.
