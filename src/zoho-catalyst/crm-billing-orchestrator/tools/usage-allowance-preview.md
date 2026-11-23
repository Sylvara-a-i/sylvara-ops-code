# v1.0 noncharging usage allowance preview

`previewUsageAllowancePeriod` in [preview-usage-period.js](preview-usage-period.js)
adds an offline **synthetic scenario** to the existing terms-v2 evidence preview.
It shows exact whole-minute and SMS-segment allowance arithmetic without claiming
that raw provider evidence is billable usage. No current Sylvara prices or
replacement commercial rules are established by this implementation. The
[commercial reconciliation boundary](../../../../docs/product/README.md#commercial-reconciliation-boundary)
still applies: historical public prices and candidate policy references are not
current offer authority.

Every result has `status: "held_synthetic_scenario"`, `billingAuthority: false`,
`paidExecutionEligible: false`, `postingCapability: false`, `billableMinutes: null`
and `chargeMinor: null`. Commercial approval, policy implementation and native
qualification remain held, even when a scenario produces an exact integer amount
or every policy reference is present. No posting adapter, provider call, LIVE
access, invoice, payment, subscription mutation, deployment or shared Foundation
change is included. The existing v1/v2 preview interfaces and paid terms-v1
runtime contract are unchanged.

## Input and output contract

Call the new export with all existing `previewUsagePeriodV2` fields:
`scope`, `period`, `snapshot`, `commercialTermsJson`, `plan`, `frequency`, `policy`
and `records`. Add these required fields; omission does not select a default:

| Field | Required value or shape |
| --- | --- |
| `scenarioBasis` | Exactly `"synthetic"` |
| `allowancePeriodMonths` | Exactly `1`, including when `frequency` is `"annual"` |
| `smsSnapshot` | `{ revision, complete }`; revision is a 64-character lowercase hexadecimal digest, complete is a boolean |
| `smsRecords` | At most 10,000 records, each exactly `{ scope, messageKey, version, occurredAtMs, segments }` |

SMS record scope must match the preview's account, subscription and configuration
scope. A message key uses the same bounded identifier syntax as call keys.
`version` is a positive safe integer and `occurredAtMs` is a nonnegative safe
integer. `segments` is explicitly `null` for unknown or an integer from zero to
1,000,000,000. Message count, text length and encoding are not segmentation
evidence; there is no default of one segment. Unknown fields, fractional segment
counts, negative zero, mismatched scopes, accessors and sparse record arrays are
rejected. Supplied evidence is never mutated.

`period` is an explicit UTC `[startMs,endMs)` observation window for one
hypothetical monthly allowance. A 27–32-day bound rejects obviously unsuitable
windows from scenario calculations; it does **not** verify a calendar month,
subscription cycle, reset anchor, timezone, proration or month-end convention.
`allowance_window_unverified` is always present and `windowVerified` is always
false. The tool does not generate periods or carry balances between invocations.
An annual base term still uses the one-month allowance in each separately
supplied window; it cannot pool twelve allowances into one annual calculation.

`allowanceScenario.voice` and `.sms` contain `includedUnits`, `rateMinor`,
`knownUnitsSubtotal`, `observedUnits`, `remainingUnits`, `overageUnits`,
`overageMinor` and metric-specific `holds`. These are hypothetical quantities,
not an allowance ledger. `knownUnitsSubtotal` preserves known evidence; the voice
value is null when its known duration is not an exact whole number of minutes.
`voice.knownDurationMsSubtotal` preserves that raw duration. Unresolved evidence
withholds the affected metric's calculated quantities and amount. Integer money
overflow withholds the amount with `amount_exceeds_safe_integer`.

`allowanceScenario.usageOverageMinor` adds the two amounts only when both are
available and their exact sum is a safe integer. All multiplication and money
addition use integer arithmetic. It does not add management/setup fees, apply an
annual discount to usage, calculate taxes or produce an invoice total. A scenario
zero is not a zero-charge conclusion. Top-level holds must always accompany a
scenario when displayed; an empty metric-level holds list does not mean approved
commercial terms or billing authority.

## Exact-cent synthetic examples

These numbers come only from
[helpers-commercial-v2.js](../functions/crm_billing_orchestrator/test/helpers-commercial-v2.js).
They are deliberately synthetic, **not Sylvara prices or approved customer
terms**. The fixture named `Growth` includes 100 voice minutes and 140 SMS
segments per supplied month, with overage rates of 37 cents/minute and
7 cents/segment.

For complete, conflict-free fixtures with whole-minute call durations:

| Voice minutes | SMS segments | Voice overage | SMS overage | Combined scenario |
| ---: | ---: | ---: | ---: | ---: |
| 99 | 139 | 0 cents | 0 cents | 0 cents |
| 100 | 140 | 0 cents | 0 cents | 0 cents |
| 101 | 141 | 1 × 37 = 37 cents | 1 × 7 = 7 cents | 44 cents ($0.44) |
| 103 | 145 | 3 × 37 = 111 cents | 5 × 7 = 35 cents | 146 cents ($1.46) |

For an annual synthetic selection, supply `[2026-12-01,2027-01-01)` and
`[2027-01-01,2027-02-01)` separately. A first-window observation of 90 minutes
and 130 segments leaves hypothetical remaining quantities of 10 and 10. Those
quantities do not carry into the next window. A second-window observation of
103 minutes and 145 segments still produces 111 + 35 = **146 cents**. This tests
independent monthly allowance arithmetic across a year boundary, not approval of
calendar-month reset alignment.

Run this example from `functions/crm_billing_orchestrator`:

```sh
node <<'NODE'
const { fixture } = require("./test/helpers-commercial-v2");
const { deriveCommercialTermsV2Version } = require("./lib/commercial-terms-v2");
const { POLICY_KEYS, previewUsageAllowancePeriod } = require("../../tools/preview-usage-period");
const core = fixture();
const scope = {
  accountKey: "synthetic_account", subscriptionKey: "synthetic_subscription",
  configurationVersion: "synthetic_config",
};
const startMs = Date.parse("2026-11-01T00:00:00Z");
const result = previewUsageAllowancePeriod({
  scope, period: { startMs, endMs: Date.parse("2026-12-01T00:00:00Z") },
  snapshot: { revision: "a".repeat(64), complete: true },
  commercialTermsJson: JSON.stringify({ termsVersion: deriveCommercialTermsV2Version(core), ...core }),
  plan: "Growth", frequency: "annual",
  policy: Object.fromEntries(POLICY_KEYS.map(key => [key, null])),
  records: [{ scope, callKey: "synthetic_call", version: 1,
    startMs, endMs: startMs + 103 * 60_000, durationMs: 103 * 60_000 }],
  scenarioBasis: "synthetic", allowancePeriodMonths: 1,
  smsSnapshot: { revision: "b".repeat(64), complete: true },
  smsRecords: [{ scope, messageKey: "synthetic_message", version: 1,
    occurredAtMs: startMs, segments: 145 }],
});
console.log(JSON.stringify({
  voiceMinor: result.allowanceScenario.voice.overageMinor,
  smsMinor: result.allowanceScenario.sms.overageMinor,
  scenarioMinor: result.allowanceScenario.usageOverageMinor,
  chargeMinor: result.chargeMinor,
  billingAuthority: result.billingAuthority,
  postingCapability: result.postingCapability,
  holds: result.holds,
}, null, 2));
NODE
```

The numeric fields are `111`, `35`, `146` and `null`; both capability flags are
false. Holds remain visible alongside the numeric scenario.

## Evidence holds and corrections

Exact duplicates count once within a snapshot. Different revisions or values
under the same call/message key are conflicts; the tool does not choose the
highest revision or first arrival. Conflicting rows are omitted from known
subtotals and the affected calculated amount is withheld. A separately supplied
replacement snapshot can be recomputed, but no snapshot delta becomes an
additional charge, refund or submission. Preview revisions identify observations,
not durable usage submission identities. Correction approval remains unresolved.

| Observation | Required result |
| --- | --- |
| Incomplete voice snapshot or unknown call duration | Voice amount and combined amount are null; known duration remains descriptive |
| Incomplete SMS snapshot | SMS amount and combined amount are null, even when observed segments are below the allowance |
| Unknown SMS segments | `sms_segmentation_unknown`; no message-to-segment guess and no complete SMS amount |
| Conflicting call or message revisions | Corresponding conflict hold; no automatic correction precedence |
| A call crosses a supplied period boundary | Voice amount held for unresolved allocation |
| Any relevant call contains fractional minutes | `fractional_voice_rounding_unresolved`; no rounding or aggregation default |
| Two 30-second calls total one minute | Voice amount still held: aggregation would itself select an unresolved policy |
| A supplied window is outside 27–32 days | `monthly_allowance_window_unresolved`; both scenario amounts are null |

Even if a fractional duration would multiply to an exact cent amount, the preview
does not decide that it is eligible or how it consumes an allowance. Policy prose
or content references cannot remove these holds.

## Unresolved commercial decisions

These decisions are separate from the implemented synthetic arithmetic. No row
below has an executable default in this preview.

| Decision | Evidence or approval still required |
| --- | --- |
| Current commercial terms | Approved effective rates, allowances, plan scope and customer acceptance; the repository's historical baseline is insufficient |
| Connected voice time | Authoritative eligible intervals and treatment of ringing, silence, holds, transfers, disconnects and failed calls |
| Fractional rounding and minimums | Per-call versus period aggregation, increments, direction, minimum duration and monetary rounding; exact-cent coincidence is insufficient |
| Monthly reset and attribution | Subscription anchor, timezone, month-end/DST handling, boundary-spanning usage, first/last partial months and historical plan changes |
| SMS eligibility and segmentation | Authoritative segment evidence and treatment of encoding, concatenation, retries, delivery failures and provider corrections |
| Exclusions and usage limits | Evidence-backed free-test/internal/failed/spam exclusions, duplicate-leg treatment, caps, thresholds and any notifications |
| Late events and corrections | Settlement cutoff, replacement precedence, closed-period handling, rate/allowance history, credit/refund approval and durable audit linkage |
| Disputes | Evidence retention, dispute window, approval owner and correction process |

Provider qualification, complete authoritative reads, native concurrency and a
durable submission ledger are separate technical gates. The preview supplies
none of those capabilities or authority to enable them.

## Verification and containment

From `functions/crm_billing_orchestrator`, run the focused checks:

```sh
node --test test/commercial-terms-v2.test.js test/usage-period-preview.test.js test/usage-period-preview-v2.test.js test/usage-allowance-preview.test.js
npm run ci
```

Then run `pwsh -NoProfile -File ./tools/verify.ps1` from the repository root.
Fixtures and the documented example are synthetic. These commands do not qualify
live provider behavior. Leave this export offline; no deployment or manual
provider setup is required. Source rollback removes the new export, scenario
helper, tests and documentation without a provider rollback.
