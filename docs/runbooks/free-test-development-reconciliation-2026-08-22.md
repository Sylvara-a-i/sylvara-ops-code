# 7-Day Free Test Development Reconciliation — 2026-08-22

## Scope And Evidence Boundary

This sanitized record separates three evidence layers:

1. Development metadata and the shared Retell draft observed during the 2026-08-22 audit, with Retell readback on 2026-08-23;
2. the current repository MVP source, offline tests, and Retell-native text simulations; and
3. the bounded Catalyst Development deployment and readback completed on 2026-08-24.

It contains no private identifiers, endpoints, customer facts, credentials, call content, or real destinations. No Production system, prospect/client record, telephone route, email, billing state, CRM record, or Analytics workspace was changed. [ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md) is authoritative.

## Current-State Audit

| Component | Expected MVP state | Development observation | Gap | Repository action | Final evidence status |
| --- | --- | --- | --- | --- | --- |
| Retell shared agent | One shared free-test agent | One shared unpublished Development draft/version was read back and reconciled | Webhook URL, publication/pin, number bindings, and voice/audio behavior remain unproven | Draft now has the minimal 11-field extraction schema and conservative naturalness settings | Draft parity/readback proven; no Retell change was made during Catalyst deployment |
| Retell flow | Shared bounded intake with exact gate and natural close | Development flow now has 47 nodes, the exact seven-field gate, direct no-data failure, client greeting, and deliberate close | Real voice/audio behavior and provider webhook-failure fallback still require controlled testing | Exact gate, 30-case contract, shadow corpus, and 11 outcomes are source controlled; 25 supported native simulations passed | Retell-native text simulation 25/25; voice/audio and bound-route evidence remain |
| Retell number model | Two dedicated synthetic numbers for internal validation, both on the same shared version | One Development number was observed and was not bound to the shared-agent deployment path | Second number and two-client provider binding/readback are absent | Source freezes both initial numbers, preserves ownership, and requires documented cooldown after completion; reassignment is deferred | Source contract exists; provider binding/readback remains |
| Inbound resolver | Unique `to_number`, exact gate, time/count eligibility, explicit reject or safe fallback | The Advanced I/O function is deployed from the reviewed revision. Its readiness response is currently non-cacheable HTTP 503 `INVALID_RUNTIME_CONFIGURATION` because required secrets and a verified mail sender are absent | No valid signed request, Data Store resolution, or Retell fallback has run | Corrected the hosted export shape and deployed/read back the function without enabling intake | Deployment and fail-closed startup proven; resolver behavior in Catalyst remains unproven |
| Configuration store | Versioned per-client deployment configuration | All four MVP tables now exist with the exact reviewed columns and constraints. Sensitive columns have the required `audit_consent`; App User has no table permissions | No synthetic deployment or call row has been written | Preserved the incompatible legacy table untouched and deployed the four distinct MVP tables | Schema and basic access readback proven; row behavior remains unproven |
| Route approval | Explicit approval before activation | CRM approval/status controls existed as setup evidence; no Catalyst deployment row or Retell route was activated | No runtime approval-state resolution/readback | Resolver requires the deployment's approved active state; CRM is not called at runtime | Source behavior only; CRM runtime correctly disabled |
| Seven-day stop | `now < expires_at` on every resolver request | Function and schema are deployed, but no signed request or durable row has exercised the boundary | Catalyst clock/boundary readback absent | Exact deterministic time gate remains implemented/tested in source | Source/synthetic proof only until Development execution |
| 25-call stop | Resolver requires handled count below 25; 25th processed call completes; in-flight overshoot visible | Function and schema are deployed, but no durable count has been written | Catalyst count/update behavior absent | MVP uses an idempotent handled count with honest in-flight overshoot | Source/synthetic proof only; exact no-overshoot cap deliberately not claimed |
| Retell event ingestion | Authenticated, validated, minimized, idempotent HTTP path | The Advanced I/O function is deployed, but missing runtime secrets prevent signed event execution | No signed event, receipt row, or acknowledgement proof | Raw-body verification, schema checks, durable deduplication, and safe errors are deployed from the reviewed revision | Deployment proven; request and persistence behavior remain unproven |
| Event/call processor | One canonical call/outcome/count under replay/reorder/retry | The retry Function, 512 MB Function Job pool, and disabled one-minute `FreeTestRetry1m` Cron are deployed/read back; the Cron has zero configured platform retries | No immediate synthetic Job or event/notification recovery has run | Kept retry execution disabled until runtime configuration and synthetic state are trustworthy | Packaging/readback proven; execution remains unproven |
| Canonical call store | One client/deployment/config-bound call row | The exact table exists, but no Development call row has been created | Durable uniqueness and tenant partition behavior unproven | Deployed the reviewed schema without inserting live or synthetic call state | Schema only; lifecycle behavior remains unproven |
| Email notification | Email only; durable state; default `dry_run` plus one controlled send proof | Both functions have the reviewed non-secret `dry_run` configuration, but `FREE_TEST_MAIL_FROM` has no verified Development sender and no row/provider action occurred | Dry-run persistence, provider/inbox readback, and replay behavior absent | Kept sending unavailable and made missing configuration fail closed | No email or delivery evidence; one controlled delivery still remains |
| Internal reporting | Fixed client/deployment Catalyst query and sanitized CSV | Existing reporting contracts were Analytics-oriented | No MVP query/export execution evidence | Metric contract and runtime boundary use canonical call rows; Analytics outbox/import removed from MVP | Query/CSV source contract exists; deployed export/isolation proof remains |
| CRM | Disabled in free-test call lifecycle | CRM setup/automation controls exist outside this runtime | Risk of implying call-path dependency | MVP performs no CRM read/write | Correctly disabled; not an internal-test blocker |
| Zoho Analytics | Deferred optional later presentation layer | Analytics access/workspace/import remained unproven | Prior docs treated Analytics as acceptance-critical | Analytics adapter/outbox/import removed from MVP documentation and source target | Correctly deferred; not an offline/internal-test blocker |
| Security | Development-only, authenticated, validated, redacted, tenant-partitioned | App User has no permissions on the four tables; non-secret configuration is pinned; readiness fails closed before Data Store or outbound work | Four required secrets, verified mail sender, signed-request behavior, and sanitized runtime logs remain unproven | Deployed only Development resources and left mail, Retell, CRM, Analytics, and Production untouched | Partial Development control readback; runtime security acceptance incomplete |
| Runtime/source parity | MVP runtime reproducible from one revision and read back in Development | Both 256 MB functions are deployed from `430f4ae628c9b5f3e8e068c802016bc0513e80b5`; a sanitized source pull compared 29 files with zero differences | Runtime cannot become ready until required private configuration exists | Corrected the Catalyst handler export and reserved-variable names, deployed both functions, and proved delete/absence/redeploy rollback | Source parity and function rollback proven; complete Catalyst lifecycle remains unproven |

## Readiness By Validation Lane

| Lane | Status | Meaning |
| --- | --- | --- |
| Offline/synthetic Development | Source, backend synthetic, and Retell-native evidence | Uses only synthetic clients/events; 25/25 supported native simulations passed; no phone, external email, CRM, or Analytics |
| Catalyst Development deployment | **INCOMPLETE** | Functions, tables, Job pool, disabled Cron, non-secret configuration, source parity, and function rollback are proven; required private configuration and lifecycle execution are not |
| Controlled internal Development phone test | **NOT READY** | Requires successful deployed E2E evidence, Retell parity/native tests, two non-customer Development numbers on the same shared version, one controlled email proof, explicit owner-approved tester/scope/settings/data/rollback, and route readback |
| Controlled prospect test | **NOT READY — approval unresolved** | Requires a separate real-prospect operating decision, actual email approval, route/recipient/data handling, rollback, and every approval appropriate to the facts |
| Production | **Not authorized** | Outside this work |

**Current classification: NOT READY.** The Catalyst phase is incomplete, and controlled internal phone testing remains **NOT READY**. The next acceptance target is **READY FOR CONTROLLED INTERNAL PHONE TEST**, which may be used only after the remaining Catalyst runtime and Retell evidence below is independently proved.

## Catalyst Development Evidence Snapshot

| Evidence | Sanitized readback | Boundary |
| --- | --- | --- |
| Immutable source | `430f4ae628c9b5f3e8e068c802016bc0513e80b5` | Public source revision only; no private target identifiers |
| Advanced I/O and retry Functions | Both deployed at 256 MB | No signed request or retry execution |
| Source parity | Sanitized pull compared 29 files with zero differences | Configuration values and platform metadata excluded |
| Data Store | Exact four-table schema, constraints, and `audit_consent` read back; App User has no permissions | No rows created or lifecycle behavior exercised |
| Retry infrastructure | Function Job pool at 512 MB; `FreeTestRetry1m` configured every minute, disabled, with zero platform retries | No immediate Job run; Cron never enabled |
| Non-secret configuration | Complete Advanced I/O map: 21 variables; complete retry map: 15 variables; reviewed source and agent version pinned; notification mode `dry_run` | Four required secrets and verified `FREE_TEST_MAIL_FROM` remain absent |
| Readiness | Non-cacheable HTTP 503 `INVALID_RUNTIME_CONFIGURATION` | Expected fail-closed result; not a ready endpoint |
| Function rollback | Delete, independent absence readback, and exact redeploy completed | Does not prove route/data rollback |

## Current Blockers

These are current evidence gaps, not claims that every item is a permanent product gate:

1. `RETELL_WEBHOOK_API_KEY`, `EVENT_HMAC_SECRET`, `NUMBER_LOOKUP_HMAC_SECRET`, and `INTERNAL_READINESS_TOKEN` are not configured; the verified Development value for `FREE_TEST_MAIL_FROM` is also absent;
2. readiness therefore returns non-cacheable HTTP 503 `INVALID_RUNTIME_CONFIGURATION`, as intended, and no signed inbound or event request has run;
3. no synthetic deployment, receipt, canonical call, notification, handled-count, query, or CSV row has been created or read back;
4. the retry Function, Job pool, and disabled Cron exist, but no immediate synthetic Job or retry lifecycle has executed;
5. Retell's actual provider behavior for resolver authentication failure, timeout, 503, malformed JSON, invalid override, and endpoint unavailability remains unproven, even though the shared agent's exact no-intake gate passed native simulation;
6. the reconciled Retell draft has not been changed, published/pinned, or pointed at the Catalyst webhook; no number binding changed;
7. no deployed two-client trace yet proves resolver, call/outcome/count, notification state, fixed-scope query/CSV isolation, and same-version routing;
8. no dry-run notification row or controlled `send_development` delivery/provider/inbox/replay proof exists;
9. function delete/absence/redeploy rollback is proven, but route disablement, data-preserving rollback, initial-number freeze, and cooldown have not been rehearsed; and
10. no call, external email, Production action, CRM write, Analytics write, or prospect/customer action occurred.

Zoho Analytics, CRM mutation, exact-cap reservations, orphan-slot reconciliation, automatic number reassignment, and SMS are outside this internal MVP. One exact Development email delivery/readback is still required for the requested internal-phone readiness classification; it cannot be attempted until a verified sender and approved Development recipient exist in deployed configuration.

The [legal archive](../legal-compliance/README.md) preserves research and a conservative historical internal-QA proposal. It is not legal advice and does not itself grant or deny a specific test. This reconciliation records engineering and operating authority only.

## Development End-To-End Evidence Still Required

An authorized operator must produce, not assume:

1. configure the four required secrets and verified `FREE_TEST_MAIL_FROM`, then prove authenticated readiness without exposing their values;
2. exercise the deployed resolver/event routes with valid and invalid signed requests and read back safe responses;
3. two synthetic clients using two dedicated numbers on the same reviewed shared agent version with disjoint configurations/email references;
4. exact gate rejection and strict seven-day behavior;
5. handled-count behavior at 24, 25, and already-in-flight overshoot, with no new intake after the observed threshold;
6. duplicate/reordered/malformed event behavior with one canonical call/outcome/count/email row;
7. Catalyst Mail dry-run containment followed by one approved `send_development` delivery, one provider response, one durable success row, and no duplicate on replay;
8. fixed client/deployment queries and a sanitized CSV whose rows/counts reconcile;
9. proof that CRM and Analytics were untouched;
10. one immutable correlation trace from resolver through event, call/outcome/count, notification state/delivery, and CSV; and
11. initial-number freeze, documented post-completion cooldown, route disablement, and rollback readback.

Exact reservation/orphan reconciliation, an exact concurrency cap, automatic number reassignment, CRM summary, and Analytics import are not MVP evidence requirements. Bounded notification retry and terminal/ambiguous failure behavior remain required and are represented in source tests.

The notification variables must match the component registry exactly:

| Variable | Consumer | Secret | Format | Development | Production |
| --- | --- | --- | --- | --- | --- |
| `FREE_TEST_NOTIFICATION_MODE` | Catalyst Mail adapter | No | `dry_run` or `send_development` | Defaults are forbidden; committed example is `dry_run`; switch only for the single controlled Development send | Rejected by this package |
| `FREE_TEST_MAIL_FROM` | Catalyst Mail adapter | No value in Git; treat the configured sender as private operational configuration | Verified Development sender email address | Required and independently read back before the controlled send | Not supported by this package |

The complete public registry is [`variables.json`](../../src/zoho-catalyst/retell-free-test/config/variables.json). Never substitute `CATALYST_MAIL_MODE`, root Retell/Make variables, or an undocumented default.

## Before A Controlled Internal Development Phone Test

After Development E2E succeeds, record privately:

- the explicit owner-approved internal tester, scope, synthetic script, window, both dedicated synthetic numbers, Development resources, data handling, settings, kill switch, and rollback;
- the shared Retell agent/version and conversational-settings readback already recorded on 2026-08-22;
- two non-customer Development numbers bound to two synthetic deployments on the same reviewed shared agent version;
- proof of default `dry_run`, one controlled `send_development` provider/inbox delivery, no duplicate on replay, restoration to `dry_run`, and continued disablement of CRM, Analytics, Production, customer forwarding, and prospect/customer email;
- the 25/25 native text-simulation result plus voice/audio interruption, correction, noise, callback, safety, sensitive-data, and deliberate-close results; and
- post-test route disablement/readback.

This is an operating approval, not a legal conclusion or prospect authorization.

## Before A Controlled Prospect Test

Do not infer prospect readiness from synthetic or internal results. The actual prospect workflow needs explicit business/client, privacy, security, vendor, caller/data/retention, sender/recipient, route, rollback, notification-delivery, and any professional review required for its facts. Actual Catalyst Mail sending must have a separately approved sender/template/recipient and delivery/failure readback. Production remains out of scope.

## Operator Evidence Record

Keep the following in the approved private evidence system:

- immutable source revision and artifact;
- environment and target identity;
- shared agent/version and route readback;
- both current number/deployment/configuration bindings, initial-validation freeze, and cooldown state;
- test clock, handled count, limit, overshoot, status, and stop reason;
- event, opaque call, outcome, durable email state/delivery, and export correlation identifiers;
- sanitized query/CSV reconciliation and export hash;
- CRM/Analytics disabled proof;
- scoped P0/P1 disposition;
- operator and approval references; and
- rollback result/readback.

Do not place private identifiers, addresses, message bodies, call content, or secrets in GitHub.
