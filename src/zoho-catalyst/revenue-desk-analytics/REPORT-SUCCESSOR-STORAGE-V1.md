# Immutable ReportRuns successors

This source revision uses the existing ReportRuns table and its unique IdempotencyKey column. Live table uniqueness, encrypted/private payload access and the effective runtime principal still require independent qualification. No schema, grants or installed bindings are changed by this source.

Root slots retain revenue-desk-report-v1:<logical key>, contending with old writers. A new encrypted payload envelope has a fresh owner. Later slots use revenue-desk-report-v2:<logical key>:<ten-digit sequence>. Slot identity never includes candidate state. Each transition dispatches one insert and independently reads that exact slot; only its own envelope authorizes continuation. A losing insertion returns null. Read accepted history with get; never reinterpret a losing insertion as ownership.

No UPDATE, mutable head pointer, takeover lease or automatic mutation retry exists. Unknown insertion or missing/mismatching readback holds reconciliation. Provider-dispatch phases remain consumed across retries; completed imports, CRM effects, PDF conversions, uploads and mail are not replayed. Legacy plaintext-state roots remain exact and read-only. Their old approved drafts/receipts are retained; an attempted insertion cannot replace them.

Head selection reads the root and latest two successor rows, validates the current edge, predecessor row digest and root commitment. This is bounded current-edge validation under trusted append-only writers, not a complete administrative-tampering audit of every historical ancestor. A separate audit/reconciliation is required for altered history.

## Measured offline request accounting

The actual successor adapter with the existing two-PDF composition produced 14 physical rows, 26 reads and 14 insert attempts for a cold report revision. An accepted replay added two immutable attempt checkpoints and used 22 reads, without another render/upload/import/CRM effect. A corrected reviewed source produced another 14 rows (28 retained across two revisions), preserving both prior PDFs.

Existing per-pair-attempt ceilings remain 40 physical reads and 26 insert attempts. Each transition adds at most one owned row and one exact-slot read; duplicate conflicts add no row. Thus an attempt is bounded to at most 26 added rows and 40 reads, including failures; there is no invented lifetime cap across separately authorized corrections or manual resends. Existing six-failure backoff still bounds automatic failed attempts. Compared with six mutable logical roots in the cold fixture, immutable storage adds eight rows for that first revision. Payload envelopes remain within the existing 9,500-byte bound and public status values are unchanged.

Focused tests cover distinct/identical contenders, root ownership, unknown accepted insertion, lost insertion, current-edge corruption, legacy preservation, isolation, physical budgets, concurrent PDF pairs, ambiguous rendering, stored-byte mismatch and corrected immutable revisions. Actual SDK 3.4.0 tests use fake HTTP only: managed-principal selection, single dispatch, lost-response reconciliation, native cancellation, late authentication, delayed timer admission and response limits. This is offline evidence, not runtime principal or provider acceptance.

## Runtime qualification boundary

Protected reporting/delivery bindings require claimQualification.mechanism=unique_insert_successor_v1 plus qualified status, a private evidence digest and finite expiry. Configuration alone cannot manufacture that qualification. All delivery, auto-delivery and CRM projection switches remain disabled until their separate gates pass.

The smallest proposed synthetic Development storage proof is four insert attempts and at most eight reads, touching only one fresh synthetic logical operation with root and successor slots. Two contenders attempt the same root, then the same successor; exact readbacks must show one owner per slot and two immutable rows total. No customer data, provider conversion/upload/mail or Retell action belongs to that proof. Ordinary approved Zoho testing has no blanket unknown-quota hold; a known new paid service, upgrade or purchase needs its distinct approval. Stop on principal mismatch, uniqueness failure, ambiguous dispatch, projection mismatch or unexpected effects; retain rows/evidence and keep execution disabled rather than blindly retrying or deleting history.
