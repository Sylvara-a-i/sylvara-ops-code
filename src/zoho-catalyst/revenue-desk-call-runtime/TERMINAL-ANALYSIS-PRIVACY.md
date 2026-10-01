# Terminal analysis privacy and safety

Status: source-only correction; not installed or live accepted.

`configuration_failure` has no authority to retain caller identity, callback,
request descriptions, location or requested-person details. The normalizer
erases those fields even when the provider says sensitive data was not detected
and the callback was confirmed. It preserves the configuration-failure terminal
outcome. The existing `sensitiveDataMinimized` marker identifies this same
conservative content-withholding policy; no new provider field is introduced.

Sensitive-data termination continues to erase personal content and positive
opportunity/follow-up/value assertions. An explicitly supplied canonical
`immediate_danger` category survives erasure as nonpersonal safety evidence.
No descriptions are recovered, and the category authorizes neither dispatch
nor an emergency response. Other urgency categories remain Unknown after
erasure. Reporting validates these minimized projections and keeps their
analysis/failure evidence incomplete instead of manufacturing zero totals.

Historical unminimized configuration-failure records fail canonical reporting
validation under this source revision. This change does not rewrite old records,
replay completed imports/CRM effects, or relax conflicting receipt checks.
An identical signed raw-payload retry can acknowledge an already completed
historical receipt only after matching every immutable identity/fingerprint and
its exact prior normalization. Changed payloads remain conflicts. Pending old
configuration-failure receipts are held before claim or worker effects. Pending
older minimized receipts with Unknown urgency also require reconciliation; erased
safety evidence cannot be reconstructed from their contents.
Corrections require the existing controlled reconciliation and re-attestation
workflow before a fresh report is accepted.

Consent withdrawal has no separate canonical analysis field in this contract.
This patch does not infer withdrawal from free text or introduce a provider
schema change. A separately reviewed signal is still required if it must be
distinguished from other terminal outcomes.

Validation: existing workflow-failure integration tests exercise erasure,
terminal-state preservation and retained safety classification through signed
synthetic event ingestion and canonical report generation. Existing callback,
opportunity and privacy tests remain applicable. No provider requests are needed.

Deployment remains separate. Keep admission, report execution and sending held
until exact installed-source verification and existing acceptance gates pass.
Rollback uses the prior exact source package; it cannot restore erased content.
