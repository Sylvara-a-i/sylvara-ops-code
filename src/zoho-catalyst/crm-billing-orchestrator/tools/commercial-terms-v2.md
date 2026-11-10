# Commercial terms v2 and noncharging usage preview

This is **offline preparation for the v1 product**, not paid execution. The
existing `PAID_COMMERCIAL_TERMS_JSON` configuration and paid lifecycle continue
to require the unchanged terms-v1 contract and reject terms-v2. No public route,
provider call, grant, catalog, charge, invoice, subscription, deployment or
customer communication is added. Commercial working terms are not published here.

## Why this format exists

The legacy paid contract contains only monthly base/setup amounts and one common
minute rate. A future paid offer can also require annual upfront base fees,
monthly included voice/SMS allowances, separate overage rates, refund terms and
versioned service scope. Leaving any of those outside the version identity would
allow a material change to reuse an old content identifier.

`lib/commercial-terms-v2.js` validates one bounded private candidate and produces a
`terms-v2:<sha256>` content version. This is not an acceptance signature or proof
that the terms have been approved, paid, cost-validated, published, or implemented.

## Exact input

`deriveCommercialTermsV2Version(core)` accepts these exact fields:

| Field | Contract |
| --- | --- |
| `currency` | `USD` |
| `annualTermMonths` | `12` |
| `annualBaseDiscountBasisPoints` | Integer 0–9,999; applies to annual base only |
| `allowancePeriodMonths` / `allowanceRollover` | `1` / `false`; this does not choose a cutoff or reset anchor |
| `voiceOverageMinorPerMinute` / `smsOverageMinorPerSegment` | Positive integer minor currency units, maximum 1,000,000,000 |
| `annualRefund` | Exact booleans `unusedWholeMonthsRefundable`, `currentMonthRefundable`, `completedSetupRefundable` |
| `policyVersions` | Exact seven policy names from the existing usage preview, each null or `policy-v1:<sha256>` |
| `plans` | Exactly `Launch`, `Growth`, `Scale` |

Each plan contains exactly `monthlyBaseMinor`, `annualBaseMinor`, `setupMinor`,
`includedVoiceMinutes`, `includedSmsSegments` and `scopeVersion`. Base amounts
must be positive integers; setup and included quantities may explicitly be zero.
All numeric amounts/quantities are bounded at 1,000,000,000. Negative zero,
coercion, floating-point amounts and omitted fields are rejected. `scopeVersion`
is null or a `policy-v1:<sha256>` reference to the private service scope.

The seven policy names are `connectedTimeDefinition`, `rounding`, `exclusions`,
`periodAttribution`, `lateEventsAndCorrections`, `usageLimits` and `disputes`.
References identify private content; this module does not fetch those bodies or
verify their approval. Null is an explicit unresolved reference, never a default.
Policy references and separate review prose are both version-bound but are not
claimed to have matching or implemented meaning.

The explicit annual amount must equal monthly base × 12 ×
(10,000 − discount basis points) / 10,000 exactly. Integer arithmetic rejects a
fractional-cent result instead of silently choosing a rounding policy. Setup,
usage rates and monthly allowances are never discounted or multiplied by twelve.
This checks a supplied quote; it does not compute an invoice, refund, proration
or allowance consumption.

`parseCommercialTermsV2(raw)` takes at most 16 KiB of UTF-8 JSON containing the
same core fields plus their exact `termsVersion`. Unknown keys, missing keys,
inherited fields and accessor properties at the object-validation boundary are
rejected. Property ordering does not change the canonical version. Every field
and explicit null participates in that version. Input objects are not retained.

The parser returns deeply frozen terms, missing policy/scope references, fixed
qualification holds, `paidExecutionEligible: false` and `billingAuthority: false`.
Even a candidate with every reference supplied retains all qualification holds.

## Plan selection and usage evidence

`selectCommercialTermsV2(candidate, plan, frequency)` accepts only the exact
parser-returned object, a canonical plan name and `monthly` or `annual`. These
are local model values, not unverified CRM picklist or Billing API values. A
deserialized candidate must be parsed again; the local object brand is only a
type boundary and is not an authorization mechanism.

The selected preview distinguishes `basePeriodMonths` (1 or 12) from
`allowancePeriodMonths` (always 1). It carries the unchanged setup, quoted usage
rates, monthly included quantities and content references. It cannot enable a
paid operation.

The existing `tools/preview-usage-period.js` exports two additional offline seams:

- `deriveUsagePolicyReviewContractV2(commercialTermsJson, plan, frequency, policy)`
  binds the selected candidate and all explicit review prose to a review version.
- `previewUsagePeriodV2(input)` takes the existing exact scope, period, snapshot,
  policy and records contract, a v2 `commercialTermsJson`, and explicit `plan` /
  `frequency`. It reuses the existing raw-evidence/deduplication algorithm.

V2 outputs use `commercialTermsVersion`, not `commercialAcceptanceVersion`, and
carry the selected quote as `commercialTermsPreview`. They retain null
`billableMinutes` and `chargeMinor`, false billing authority, and all commercial,
policy and native qualification holds. Raw duration does not consume allowances,
prove remaining minutes, select rounding, resolve transfer legs, determine
billable periods or produce an overage charge. Annual input does not turn the
supplied observation period into an annual allowance bucket.

Duplicate, conflicting, unknown-duration, incomplete-snapshot and cross-period
observations retain the existing conservative handling. V1 exports and output
semantics remain available unchanged. Neither path is imported by a runtime route.

## Verification and next integration gate

Run the commercial-v2, usage-preview-v2 and existing usage-preview tests, then
the function's `npm run ci` and repository canonical verifier. All fixtures use
deliberately synthetic terms, scopes and identifiers. Never replace them with
private accepted terms, native customer data or live provider responses.

Future executable use must verify actual policy bodies and approval, effective
identity/ownership mappings, current native catalog/usage contracts, bounded
complete reads, accepted financial rules and separately authorized operations.
The current paid parser must not simply be changed to accept v2: the lifecycle
fingerprint, meter, allowance ledger, policy implementation and native readback
must first enforce every relevant term. Direct-paid onboarding also needs its
own eligibility evidence without inventing a completed free test.

Containment is to leave these functions offline. Source rollback removes the
new parser, previews, tests and documentation; no provider rollback is needed.
