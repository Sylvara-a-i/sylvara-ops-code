# Free Revenue Leak Test E2E Reconciliation

- **Status:** NOT READY FOR RETELL AGENT QA
- **Environment:** Development and Zoho Billing TEST only
- **Revision date:** 2026-08-24
- **Production authorized:** No

This record covers the non-conversational Free Revenue Leak Test lifecycle from Form 1 through explicit paid acceptance. It supersedes the Retell-only readiness classification in [the earlier Development reconciliation](free-test-development-reconciliation-2026-08-22.md) for the broader end-to-end release decision. The earlier record remains valid historical evidence for its narrower Retell/Catalyst milestone.

The repository implementation is materially advanced, and the additive Form 2 v3 Data Store schema now exists in Catalyst Development. The end-to-end release is still blocked by live Zoho Forms cutover, final function deployment and direct readback, CRM automation activation/proof, Billing TEST catalog creation, the accepted-only Billing lifecycle, and the coordinated final secret rotation. None of those blockers is Retell conversation-agent QA.

## Current-State Audit

| Component | Expected state | Current state | Gap / containment | Status |
| --- | --- | --- | --- | --- |
| Form 1 controller | Public and assisted intake are idempotent and Billing/routing-free | Source implements the assisted controller, desired Forms contract, and immutable-artifact builder; 22 tests pass locally | Hosted Form/webhook/button cutover and target-project deployment are not read back | P1 blocked |
| Form 2 controller | Six exact routes, durable email-only proof, bound prefill, one submission effect | Source implements issue, access, OTP request/verify, prefill, and submission with durable replay controls; Development sending requires a private recipient-digest allowlist; 226 tests pass locally and all 234 pass on hosted Linux with zero skips | Deployment, live conditional-ZCQL concurrency, Mail, and hosted Forms behavior require live proof | P1 blocked |
| Form 2 v3 Data Store | Four private additive runtime tables matching source | Four clean runtime targets contain 81 application columns, five unique keys, 25 audited/linkable columns, zero rows, and zero App User permissions | Clean session target is `Form2SessionsV3Runtime`; probe artifacts are unbound and denied to App User | Provisioned and contained |
| Form 2 v2 reconciliation | Preserve v2 and promote nothing ambiguous | Fresh readback matches the recorded zero-promotion disposition: two retained terminal sessions, one reconciliation quarantine, one state conflict, eight missing copied prefills, 13 retained copied prefills, and zero submissions | Both nonterminal source rows are time-expired; no v2 row is promoted | Reconciled |
| CRM schema | Additive fields support authorization, approval, reporting, and paid acceptance | Required additive fields exist; synthetic records remain isolated | Final workflow/Blueprint consolidation and complete synthetic transition proof are not active | P1 blocked |
| Shared Retell runtime | One agent, one existing number, consolidated signed Catalyst runtime | Existing published shared agent/version and one Development number remain unchanged; 64 source Retell lifecycle/report tests pass; incomplete legacy-v1 replay is quarantined; live analysis readback has 11 fields while Catalyst supports a 15-field target | The four-field agent alignment, simulation, calls, and conversation tuning are intentionally deferred to Retell Agent QA; incomplete aggregates stay withheld | Opaque dependency preserved |
| Free-test reporting | Tenant-scoped JSON/CSV without caller PII or invented value | Source reports authoritative duration, required aggregates, completeness, value evidence, and practical overshoot | New report revision is not yet deployed/read back against final candidate | P1 blocked |
| Billing orchestrator | Paid-only, acceptance-gated, idempotent TEST mutation with readback | Source verifies synthetic ownership, private commercial terms, catalog, meter, subscription, CRM callback, and immutable Development artifact provenance; 72 tests pass locally; delayed reconciliation remains non-creating across UTC date rollover | TEST catalog lacks the paid product/plans/common metered add-on required for a positive path | P1 blocked |
| Function topology | Smallest understandable least-privilege set | Five canonical functions are retained; legacy split Retell units remain containment/rollback assets | All five resources exist in their owned Development projects, but none has a recorded source revision matching the reviewed PR head | P1 blocked |
| Secret rotation | One coordinated final Development rotation after every consumer is final | Existing secrets remain contained in platform configuration | Rotation must wait for final callers, functions, and routes | P1 blocked |
| Production | Untouched | No Production change, route, traffic, data, charge, SMS, or call occurred | None | Verified |

## Function Consolidation Decision

Retain these five boundaries:

1. `form1_assisted_controller` — Lead-scoped issue and prefill.
2. `form2_controller` — access, email proof, prefill, and authorization submission.
3. `retell_free_test` — raw signed inbound and post-call webhooks plus private readiness/reporting.
4. `retell_free_test_retry` — non-HTTP bounded retry Job with fewer secrets.
5. `crm_billing_orchestrator` — paid acceptance and CRM/Billing write authority.

Combining them would mix unrelated callers and credentials, enlarge the failure blast radius, and make rollback harder. The excess function count comes from legacy split Retell units, not these five boundaries. Legacy units remain disabled or unbound until the canonical packages and callers are independently proven; this document is not deletion authority.

## Form 2 Data Store Readback

| Runtime binding | Application columns | Unique | Audited | Rows | App User permissions |
| --- | ---: | ---: | ---: | ---: | ---: |
| `Form2SessionsV3Runtime` | 20 | 2 | 7 | 0 | 0 |
| `Form2PrefillsV3` | 19 | 1 | 6 | 0 | 0 |
| `Form2SubmissionsV3` | 16 | 1 | 4 | 0 | 0 |
| `Form2VerificationProofsV3` | 26 | 1 | 8 | 0 | 0 |

The empty `Form2SessionsV3` table contains one earlier encrypted-type probe and is never a runtime target. Two additional `ZZZ_Quarantined_*` empty probe tables preserve connector-behavior evidence. All probe tables have zero rows, zero App User permissions, and no caller. Do not bind, promote, delete, or treat them as migration destinations.

## Verified Source Behavior

- Form 1 rejects expired, unauthorized, malformed, and wrong-Lead requests and creates one assisted-intake effect.
- Form 2 stores no plaintext OTP, serializes verification attempts, revalidates the authoritative Contact email after proof consumption, and preserves the Setup/QA-owned test number.
- Form 2 cannot approve go-live, create paid acceptance, create Billing state, or mutate the protected phone-number field.
- Retell ingestion verifies the unchanged raw body, preserves legacy schema-v1 evidence, writes schema-v2 canonical calls, converges reordered events, and counts one accepted call once.
- Retell reports omit callback numbers and unrestricted narratives, withhold incomplete evidence, and reject unsupported value provenance or contradictory urgency/outcome combinations.
- Billing source requires completed Results Review plus separate paid acceptance and exact `ZZZ SYNTHETIC` Deal and Account ownership.
- Billing unresolved rows never resume mutation. Read-only reconciliation can converge an existing authoritative customer/subscription; missing resources remain contained.
- Stable external Billing references are separate from immutable acceptance and commercial-term fingerprints.
- The repository-wide `All` verifier passed with clean dependency installation, production dependency audits, safety tests, and every component suite. Hosted Linux then ran all 234 Form 2 cases, including the eight OS-gated artifact-deployment regressions, with zero failures and zero skips.

## Release-Blocking Evidence

The following are P1 release blockers until independently proven:

1. Deploy the exact selected source revision for all five canonical functions and read back artifact/source parity.
2. Configure and directly test the Form 1 and Form 2 Development routes, then cut over the hosted Forms/CRM callers while preserving rollback routes.
3. Prove Form 2 conditional Data Store behavior with concurrent requests and one controlled internal email-proof delivery.
4. Prove one final CRM workflow and one Blueprint across a fresh `ZZZ SYNTHETIC` Lead-to-Deal lifecycle without Zoho Sign, automatic go-live, automatic Billing, or premature Closed Won.
5. Create/read back the approved paid Revenue Desk catalog in Zoho Billing TEST and run the single Growth acceptance path with no payment method or real charge.
6. Reconcile authoritative Billing state back to CRM and prove replay creates no second customer, subscription, or CRM effect.
7. Rotate the four shared Development secrets only after every consumer is final; prove new requests pass and old credentials fail.
8. Run the final repository/Linux deployment checks, merge only after all P0/P1 defects are closed, deploy final `main`, and repeat the synthetic smoke path.

No available Zoho Forms connector exposes hosted-form mutation, and the available Zoho Billing write connector does not create products, plans, or add-ons. Under the repository's Zoho change-control rule, browser or ad-hoc REST substitution is not an authorized workaround. These remain genuine system-access blockers rather than Retell Agent QA.

## Rollback And Containment

- Keep new Form callers unbound until direct tests pass.
- Keep all v2 tables and v3 evidence; promote no v2 row.
- Keep notification and proof delivery in stub/dry-run except one separately controlled internal delivery.
- Keep the Retell retry Cron disabled.
- Stop synthetic deployments and unbind the existing Development number before any route rollback.
- Keep unresolved Billing operation rows non-creating; disable the paid action before any private operator reset.
- Preserve legacy function packages and routes until the canonical source, callers, and rollback are read back.
- Production requires no rollback because it was not changed.

## Classification

Current status is **NOT READY FOR RETELL AGENT QA**. Retell simulation, voice/audio testing, and conversation refinement are not the only remaining work.
