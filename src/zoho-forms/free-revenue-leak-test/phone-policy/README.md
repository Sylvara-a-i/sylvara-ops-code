# Source-bound phone representation

Status: source candidate; installation and native acceptance remain unproven.
Policy: `us-national-e164-v1`, selected by the immutable artifact source. No mutable
runtime switch changes representation under an existing session revision.

## Scope and representations

One pure policy reuses the existing call-runtime US-context parser. Source lives in
this directory, with byte-identical function-local copies for isolated Catalyst
artifacts. The repository verifier checks copy parity and dependency containment.
No cross-function runtime import, library install, new permission, or paid lookup
is required.

- Canonical new write value: +1 plus ten NANP digits
- Native prefill value: exactly ten national digits
- Display: the native US phone control owns masking; the existing Form2 Main
  Business Number text control also requires exactly ten digits
- Optional inapplicable fallback: null; required blanks fail
- Extensions, other country codes, ambiguous short numbers and Unicode
  digits/separators fail without lossy stripping

US context is explicit. +1 and NANP NPA/NXX syntax do not prove geographical US
allocation, ownership, reachability, consent, or permission to call/message.
There are nine governed physical phone controls: two public Form1, two assisted
Form1, and five Form2. Test Phone Number and Alert Recipient Mobile remain excluded
from the Form2 respondent contract.

## Actual handler integration

Form1 ordinary Prefill emits national phone strings. Ordinary Submission first
checks the exact source/session revision, then canonicalizes its two phone inputs
before the existing fingerprint and CRM patch. Formatting-only variants share the
new ordinary fingerprint; changed actual numbers do not. Public unbound delivery
still acknowledges without a Catalyst CRM write. API names, opt-outs, consent
requirements, attribution authority, version fencing and workflow triggers remain.

Form2 uses the same national projection at issuance validation, OTP/prefill snapshot
creation, Dynamic Prefill delivery, and submission snapshot recheck. Write validation
canonicalizes the five approved phone inputs. Contacts.Mobile remains unwritable:
canonical identity is compared, while the historical CRM string is preserved.
Form2 still fingerprints the original raw formPayload including provider checkbox
text. Equivalent phone formatting is therefore NOT an exact raw receipt replay.
Existing succeeded receipts retain their old-source replay path; stale unfinished
revisions reject before a claim or record change.

Native form/consent version labels keep their current meanings. They are not
substitutes for the exact artifact SOURCE_REVISION in sessions, prefills and receipts.
No old snapshot, payload, fingerprint, claim or version is rewritten.

## Recovery compatibility

Form1 schema1 keeps exactly its original eight keys and raw normalization. Its
signed/private packet bytes remain unchanged. New schema2 adds phonePolicy and
phonePolicySourceRevision, pinned to the exact originalSourceRevision. It requires
an independently reviewed immutable predecessor registry containing the exact
original policy-module, core-normalizer and handler-module Git blob SHA-256 hashes. Manifest strings
or phone formatting alone cannot prove provenance.

The registry initially contains no canonical predecessors. A future failed
canonical claim requires a distinct reviewed recovery artifact, as the existing
recovery workflow already requires. In that artifact, independently inspect the
original release and use the component's verify-recovery-phone-policy.js --prepare
command to prepare a sanitized provenance entry. Review and pin only that exact
entry. Both Form1 release builders and the repository verifier check original Git
source hashes. Unknown, contradictory, unregistered or malformed bindings fail
before dependency access. Schema2 mechanics pass with synthetic provenance fixtures;
this does not authorize or make any unregistered real claim recoverable now.

## Native/public and data boundaries

Fresh native readback reports public Form1's CRM writer as New Record, Upsert
unchecked, Automation/Process Management enabled, and mobile duplicate prevention
on. Earlier source upsert descriptions are historical/desired-state evidence, not
current live proof. Preserve this writer, dedupe setting, field identity, encryption
and API mappings. No independent native canonical-value transform has been proven.
Catalyst cannot canonicalize that native write. Do not claim public first-write
E.164 storage or change its writer without a supported, separately reviewed mapping.
The public and Form2 controls already have US presentation; only the assisted two
phone controls require a coordinated International-to-US cutover.

No historical CRM/Billing/Books value is migrated. Existing national/bare-ten-digit
values are tolerated only by the relevant display/consumer boundary. Billing
customer joins stay ID-based; the canonical TEST orchestrator does not propagate
phone. No customer sync, Billing/Books write, Lead conversion, invitation, message,
provisioning, routing-key change or live routing action is introduced.

## Release and acceptance gates

1. Review the complete source diff and the exact new immutable artifact revision.
2. Run full component CI, the canonical repository verifier and immutable CLI
   release builds against the actual clean release commit.
3. Inventory old sessions/receipts. Preserve the mapping fixture unconsumed. Form1
   can migrate only an existing clean-issued binding using its current approved
   transition; never reset consumed/submitting claims. Old Form2 succeeded receipts
   must still replay; unfinished old revisions require a fresh approved journey.
4. Independently read back artifact stamp, function-local policy, existing private
   configuration and caller mappings. No new mutable configuration flag is needed.
5. Coordinate only the assisted native display change and prove ten-digit prefill,
   exact webhook serialization, canonical CRM readback, and replay behavior with
   separately authorized synthetic submissions. Public writer behavior is a separate
   acceptance gate and must not be inferred from Catalyst tests.
6. On ambiguity preserve original entry/claim/version evidence; reconcile without
   a blind re-push. Rollback must not restore a writer that ignores a spent recovery
   reservation or reinterpret new canonical claims under a legacy policy.

Offline regression coverage includes the actual Form1/Form2 handlers, national
prefill, canonical writes, strict invalid input, old unfinished revision rejection,
Form1 legacy and schema2 recovery, old Form2 succeeded receipt replay, raw-fingerprint
compatibility, predecessor proof binding, local module closure and packaging parity.
These are source tests, not provider acceptance or deployment evidence.

Canonical predecessor verification also requires byte-identical original/current
phone adapter and core modules. Same-profile drift fails closed and needs a new
profile or an explicitly retained implementation. Provenance Git reads use the
builders' sanitized environment with replacement objects disabled; inherited Git
configuration cannot substitute content for a pinned revision.
