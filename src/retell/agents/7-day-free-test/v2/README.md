# Free-Test Capture And Handoff V2 Candidate

This directory contains a public, provider-neutral, source-only acceptance candidate for `call_gap_capture_handoff_v2`. It is not a Retell export, an import package, a runtime mapping, deployment evidence, or authorization to change an agent, number, route, call, notification, or customer system.

The candidate is deliberately `draft`, disabled, unbound to traffic, and `NOT_READY`. Read-only public Retell schema and documentation reviewed on 2026-08-25 confirm native `transfer_call` destination/option families and the canonical `transfer_started`, `transfer_bridged`, `transfer_cancelled`, and `transfer_ended` events. They do not prove exact Draft serialization, complete webhook payload variations, failure subtyping/casing, or runtime behavior. The adapter therefore defines normalized semantics only and contains no fabricated provider parser or provider field mapping.

The current `call_gap_monitor_v1` files outside this directory remain the rollback boundary and are not modified by this candidate.

## Offline validation

```powershell
python src\retell\agents\7-day-free-test\v2\tools\validate_candidate.py
python -m unittest tools.safety.tests.test_retell_v2_handoff_candidate -v
```

Both commands are deterministic and prohibit network access. A passing local result proves only the public acceptance contract, 100 synthetic scenarios, order-independent monotone transfer-state convergence, authoritative evidence gates, required durable-ledger/notification-store interface behavior, irreversible payload-null suppression for sensitive/nonactionable outcomes, notification idempotency, isolation rules, and mutation coverage. The candidate supplies no live storage, delivery, route, or provider adapter. Retell Draft readback/import, provider parsing, text or voice simulation, human detection, voicemail detection, webhook validation, number binding, route activation, and email delivery remain deferred live work requiring separate approval.
