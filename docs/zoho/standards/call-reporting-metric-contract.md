# Call Reporting Metric Contract

## Status

- Repository status: **Proposed**
- Live Catalyst datasets: **Unknown**
- Live Zoho Analytics model, reports, schedules, and access controls: **Unknown**
- Customer-facing use: **Not authorized by this document**

This standard defines the minimum reproducible contract for Sylvara call and outcome reporting. It supplements the general [Zoho Analytics standard](analytics.md), the [Retell, Catalyst, CRM, and Analytics boundary](../../adr/0004-retell-catalyst-crm-analytics-integration-boundary.md), and the authoritative [shared free-test decision](../../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md).

A report is evidence about a bounded workflow. It is not transactional truth and it does not prove a booking, completed job, invoice, payment, or recovered revenue unless the metric is reconciled to the authoritative system that owns that outcome.

## Required Metric Metadata

Every published metric must document:

- metric name and version;
- business question;
- authoritative source system and source object;
- analytical grain;
- stable source key;
- numerator, denominator, formula, and units;
- included and excluded records;
- time field, time zone, and reporting-period boundary;
- null, duplicate, late-arriving, corrected, and deleted-record behavior;
- estimated versus verified status;
- sensitivity and permitted audience;
- refresh method, watermark, and acceptable staleness;
- reconciliation owner and source report;
- correction procedure; and
- conditions that suppress external publication.

Do not implement a metric that lacks a stable source key or reproducible definition.

## Canonical Dimensions

Every call fact must use these dimensions where applicable:

| Dimension | Contract |
|---|---|
| `Client ID` | Immutable internal client partition; mandatory on every client-reporting fact |
| `Deployment ID` | Immutable free-test deployment partition; mandatory with Client ID on every free-test fact |
| `Configuration Version` | Immutable approved deployment snapshot effective for the call |
| `Call Key` | Opaque stable keyed-HMAC lookup key derived from the provider call identifier; the raw provider identifier is excluded |
| `Agent ID` | Provider agent that handled the call; descriptive only for the shared free-test agent and never a tenant key |
| `Agent Version` | Reviewed shared Retell flow version effective for the call; distinct from Configuration Version |
| `Environment` | Development or Production; never combined without an explicit filter |
| `Coverage Mode` | One canonical deployment value: `AfterHoursOnly`, `NoAnswerOverflowOnly`, or `AfterHoursAndOverflow` |
| `Coverage Trigger` | Per-call `AfterHours` or `NoAnswerOverflow` where known; never substituted for Coverage Mode |
| `Started At` | Source timestamp normalized to UTC |
| `Ended At` | Source timestamp normalized to UTC |
| `Local Reporting Date` | Date derived with the approved client reporting time zone |
| `Outcome Version` | Version of the classification and metric taxonomy |
| `Data Watermark` | Latest source event included in the report |
| `Reconciliation Status` | Pending, verified, corrected, rejected, or unresolved |
| `Notification State` | Durable Catalyst notification result, including retry or terminal failure |

Display labels and company names are not join keys.

For free-test facts, match on the opaque `Call Key` and require immutable `Client ID` and `Deployment ID` partitions on the same row. Any ownership conflict fails closed. The shared Agent ID is never sufficient ownership evidence.

## Free-Test Outcome Taxonomy

Each processed free-test call receives exactly one high-level outcome:

| Canonical value | Report label |
| --- | --- |
| `potential_job` | Potential Job |
| `existing_customer` | Existing Customer |
| `urgent_potential_job` | Urgent Potential Job |
| `spam` | Spam |
| `unsupported_service` | Unsupported Service |
| `out_of_area` | Out Of Area |
| `other_general_inquiry` | Other / General Inquiry |
| `sensitive_data_ended` | Sensitive Data Ended |
| `configuration_failure` | Configuration Failure |
| `caller_abandoned` | Caller Abandoned |
| `unresolved` | Unresolved |

Do not create overlapping high-level outcomes or count one call in two outcome totals. Urgency may remain a separate detail, but an urgent new opportunity uses `urgent_potential_job`, not both potential-job categories. A configuration failure is operational evidence and never a client opportunity.

## Canonical Metrics

### Eligible Calls

**Question:** How many calls were inside the approved coverage and workflow boundary?

- Grain: one client and call.
- Primary source: normalized Catalyst call record plus approved client configuration.
- Include: calls whose environment, agent binding, coverage window, direction, and workflow intent satisfy the approved contract.
- Exclude: synthetic tests from Production reports, duplicate events, spam when the report definition excludes it, and calls outside the approved route.
- Verification: operationally derived; not customer-system revenue truth.

### Total Calls Handled And Limit Progress

- `Total Calls Handled` counts distinct finalized opaque Call Keys within the immutable Client ID and Deployment ID partitions.
- `Handled Call Count` is distinct from pre-call reserved capacity. A reservation prevents over-admission but is not reported as a handled call until bound/finalized.
- Operational limit evidence shows handled count, outstanding reservations, total admitted capacity, limit (25), and remaining capacity. Ambiguous reservations remain capacity-blocking until reconciled.
- Client-facing call-limit progress uses the finalized handled count and clearly labels any outstanding reservation state; it must never silently turn a reservation into a handled call.
- Replay changes none of these values.

### Calls Completed Or Correctly Escalated

**Question:** How many eligible calls reached one approved terminal disposition?

- Grain: one eligible call.
- Numerator: eligible calls with one valid terminal disposition and no unresolved integration state.
- Denominator: eligible calls.
- Approved terminal classes may include qualified callback request, verified booking, human route requested, ineligible, or bounded fallback according to the workflow version.
- Do not count an attempted transfer as a completed human handoff.

### Qualified Opportunities

**Question:** How many eligible calls met the approved qualification rules for a new service opportunity?

- Grain: one call.
- Source: Catalyst outcome classification.
- Required fields: approved service intent, service-area eligibility, property-type eligibility, and minimum callback or booking facts.
- Exclude: existing-customer service requests unless a separately versioned metric includes them.
- Status: estimated operational opportunity until reconciled to a customer-system outcome.

### Callback Or Booking Requests

**Question:** How many calls produced a valid request for an approved callback or booking action?

- Grain: one call.
- Source: Catalyst disposition or customer-system request record.
- Separate:
  - request captured;
  - downstream write attempted;
  - downstream write verified; and
  - customer accepted or scheduled.
- Never combine those states into one "booked" metric.

### Verified Appointments

**Question:** How many calls are matched to an appointment in the authoritative customer scheduling or field-service system?

- Grain: one client, call, and authoritative appointment.
- Source: customer system.
- Required: stable customer-system record identifier, successful readback, and reconciliation timestamp.
- Deduplicate reschedules and replacements according to the customer-system contract.
- A Retell analysis field or CRM note cannot independently verify this metric.

### Transfer Attempted

- Grain: one transfer attempt.
- Source: Retell transfer event normalized in Catalyst.
- Trigger: `transfer_started`.
- Multiple attempts on one call remain separate attempts.

### Transfer Bridged

- Grain: one transfer attempt.
- Source: Retell transfer event normalized in Catalyst.
- Trigger: `transfer_bridged`.
- Do not infer bridge success from `call_ended`, prompt text, or a transfer request.

### Transfer Cancelled Or Failed

- Grain: one transfer attempt.
- Source: `transfer_cancelled`, provider error state, or approved timeout classification.
- Report provider cancellation separately from downstream unavailability when the contract supports that distinction.

### Human Escalation Share

**Question:** What share of eligible calls required a human route or manual review?

- Numerator: eligible calls with an approved human-escalation or manual-review disposition.
- Denominator: eligible calls.
- Separate a requested route from a bridged route.
- Review repeated reason codes; a high share can indicate weak workflow fit or hidden support labor.

### Unresolved Calls

- Grain: one eligible call.
- Source: Catalyst.
- Include: missing required facts, conflicting duplicate, ambiguous downstream write, unknown agent-client binding, uncertain outcome, stale configuration, or failed reconciliation.
- Unresolved calls are never silently reassigned to a successful class to improve a rate.

### Technical Failures

- Grain: one call or one integration operation, depending on the report.
- Source: Catalyst operational state and verified provider/customer-system errors.
- Examples: signature rejection, schema rejection, provider timeout, duplicate conflict, import rejection, failed customer-system readback, or stale Analytics watermark.
- Separate caller/business outcomes from platform failures.

### Estimated Opportunity Value

**Question:** What modeled commercial value is associated with qualified opportunities?

- Source: an approved customer-provided or contract-approved value model.
- Grain: one qualified opportunity.
- Required: method version, assumptions, currency, effective date, and confidence label.
- Never label this metric as revenue, collected revenue, or recovered revenue.
- Do not add value to spam, excluded, duplicate, unresolved, or unqualified calls.

Every value field must carry exactly one evidence status:

| Canonical value | Meaning |
| --- | --- |
| `confirmed_revenue` | Revenue reconciled to the authoritative financial/customer outcome |
| `booked_revenue` | Booked value reconciled to the authoritative scheduling/customer outcome |
| `customer_supplied_estimate` | Customer-supplied estimated job value, not verified revenue |
| `internal_estimate_with_method` | Internally estimated opportunity value with an approved method/version |
| `unknown` | No defensible value evidence |

Confirmed/booked labels require authoritative reconciliation. Internal estimates require a documented method version; never multiply calls by an arbitrary amount.

### Verified Booked Value

- Source: authoritative customer scheduling or field-service system.
- Required: reconciled appointment or accepted job request plus an approved value basis.
- Keep separate from completed, invoiced, and paid value.

### Verified Completed Value

- Source: authoritative completed-job or work-order status.
- Required: stable record, completion state, completion time, and value basis.
- A scheduled appointment does not qualify.

### Verified Invoiced Value

- Source: the customer's approved invoicing or accounting system.
- Required: invoice record, amount, currency, and attribution contract.
- Do not infer from quoted work.

### Verified Paid Value

- Source: the customer's approved payment or accounting system.
- Required: payment record, amount, currency, attribution contract, and reconciliation date.
- This is the strongest commercial outcome in the reporting chain but still requires a documented call-attribution method.

## Outcome Ladder

Reports must preserve the outcome ladder rather than collapse it:

```text
Call handled
    -> qualified opportunity
        -> callback or booking requested
            -> appointment verified
                -> job completed
                    -> invoice issued
                        -> payment verified
```

Each step has its own source, timestamp, and verification state. A later step may be absent without invalidating earlier operational evidence.

## Free-Test Or Evaluation Report

The first external report for a bounded evaluation is manually generated and reviewed. A free-test report uses simple per-client metrics:

- total calls handled;
- potential jobs and urgent potential jobs;
- existing customers;
- spam, unsupported, out-of-area, other/general, and unresolved calls;
- notification success, retry/terminal failure, and unresolved state;
- calls by date/time and after-hours versus no-answer/overflow where known;
- call-limit and seven-day period progress;
- representative redacted outcome summaries; and
- estimated opportunity value only with its documented method/version.

Do not include raw transcripts, recordings, caller phone numbers, caller addresses, unrestricted call-detail exports, or an unverified revenue claim.

A recommendation may be:

- continue with the same bounded workflow;
- correct the workflow and retest; or
- stop because the workflow, data, support burden, or customer value is not credible.

## Paid Monthly Report

After repeated clean manual cycles, a paid-client report may include:

- eligible-call volume and completion rate;
- qualified-opportunity rate;
- verified callback, appointment, or job outcomes;
- transfer performance;
- unresolved and technical-failure rates;
- human-escalation share;
- estimated opportunity value;
- separately verified booked, completed, invoiced, or paid value;
- period-over-period comparison;
- source watermark and refresh time; and
- reconciliation and correction status.

Do not automate client delivery merely because a dashboard looks correct.

## Report Acceptance Gates

Before one external delivery:

1. the report period, client, environment, and time zone are explicit;
2. `count_distinct(Client ID) = 1` and only approved Deployment IDs across every included dataset;
3. source and Analytics row counts reconcile for the approved period;
4. duplicate source keys are zero or explicitly quarantined;
5. all asynchronous imports are complete and rejected rows are resolved;
6. the watermark meets the approved freshness requirement;
7. estimated and verified values are visually and semantically separate;
8. no recording, transcript, raw payload, phone number, address, credential, or unrestricted identifier appears;
9. the recipient set exactly matches the approved CRM record;
10. export, link, and row-level permissions were tested with a non-admin identity;
11. correction history is preserved; and
12. an authorized reviewer approves the final output.

Fail closed when any gate is unknown.

## Client Isolation

The proposed shared workspace requires immutable `Client ID` and `Deployment ID` partitions on every free-test fact and dimension that can reach a client report. This is a model contract, not Production authorization.

- Fixed-client reports use server-side or workspace-controlled criteria.
- A client must never be able to change a filter to another client.
- Source tables and unrestricted query tables are not shared with clients.
- Public or no-login links are disabled.
- Scheduled attachments inherit the source classification and require recipient review.
- Contractual or technical requirements may justify a separate workspace for one client; that is an exception, not the default.

## Corrections And Late Data

- Preserve source modified time, load time, metric version, and reconciliation status.
- A corrected source outcome creates a governed analytical update; do not erase the fact that an earlier report was different.
- Late customer-system outcomes may update later periods or a labeled prior-period correction according to the approved reporting policy.
- Deleted or withdrawn source records require a documented tombstone or correction path so derived totals do not silently drift.
- An ambiguous import or reverse-write is reconciled before retry.

## Privacy And Export Boundary

Zoho Analytics receives only the columns required to calculate and present approved metrics.

Excluded by default:

- recordings;
- full transcripts;
- raw webhook bodies;
- caller phone numbers;
- caller street addresses;
- payment-card or bank data;
- credentials, tokens, or secret-bearing URLs;
- unrestricted CRM records;
- raw customer-system payloads; and
- provider prompts or private customer rule sets.

A sanitized call-detail view may use opaque call references and redacted summaries only when the client contract and privacy review allow it.

## Validation Fixtures

Use synthetic data to test:

- zero-call periods;
- duplicate events and calls;
- multiple transfer attempts;
- missing and conflicting deployment/number mappings;
- replay and delayed events across number reassignment;
- duplicate and terminal-failure notification behavior;
- late and corrected customer-system outcomes;
- unknown or stale metric versions;
- time-zone and period-boundary behavior;
- null and malformed values;
- import rejection and ambiguous job status;
- cross-client join attempts;
- non-admin sharing and export restrictions;
- estimated-versus-verified labeling; and
- exact aggregate reconciliation to known expected values.

## Change Control

A metric change requires:

1. a versioned definition;
2. an impact assessment for prior reports;
3. synthetic regression fixtures;
4. Development readback;
5. a decision on backfill or forward-only application;
6. review of client-facing labels and claims;
7. Production approval; and
8. a correction note when previously delivered values change.

A GitHub merge establishes reviewed intent only. It does not change a live Analytics formula, report, schedule, share, or delivered customer report.
