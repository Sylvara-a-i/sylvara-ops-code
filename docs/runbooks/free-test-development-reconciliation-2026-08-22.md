# 7-Day Free Test Development Reconciliation — 2026-08-22

## Scope And Evidence Boundary

This sanitized record separates three evidence layers:

1. Development metadata and the shared Retell draft observed during the 2026-08-22 audit, with final table/Retell readback on 2026-08-23;
2. the current repository MVP source, offline tests, and Retell-native text simulations; and
3. Catalyst Development deployment/readback, which has not yet been performed.

It contains no private identifiers, endpoints, customer facts, credentials, call content, or real destinations. No Production system, prospect/client record, telephone route, email, billing state, CRM record, or Analytics workspace was changed. [ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md) is authoritative.

## Current-State Audit

| Component | Expected MVP state | Development observation | Gap | Repository action | Final evidence status |
| --- | --- | --- | --- | --- | --- |
| Retell shared agent | One shared free-test agent | One shared unpublished Development draft/version was read back and reconciled | Webhook URL, publication/pin, number bindings, and voice/audio behavior remain unproven | Draft now has the minimal 11-field extraction schema and conservative naturalness settings | Draft parity/readback proven; publication waits for Catalyst deployment |
| Retell flow | Shared bounded intake with exact gate and natural close | Development flow now has 47 nodes, the exact seven-field gate, direct no-data failure, client greeting, and deliberate close | Real voice/audio behavior and provider webhook-failure fallback still require controlled testing | Exact gate, 30-case contract, shadow corpus, and 11 outcomes are source controlled; 25 supported native simulations passed | Retell-native text simulation 25/25; voice/audio and bound-route evidence remain |
| Retell number model | Two dedicated synthetic numbers for internal validation, both on the same shared version | One Development number was observed and was not bound to the shared-agent deployment path | Second number and two-client provider binding/readback are absent | Source freezes both initial numbers, preserves ownership, and requires documented cooldown after completion; reassignment is deferred | Source contract exists; provider binding/readback remains |
| Inbound resolver | Unique `to_number`, exact gate, time/count eligibility, explicit reject or safe fallback | A reproducible deployed resolver could not be proved | Reachable route, live Data Store response, and provider fallback were unproven | Known authenticated failures return HTTP 200 reject with no agent/write; transport/auth/timeout/503/malformed/invalid override can reach only the shared no-intake gate | Source/synthetic proof only until deployed route/provider readback |
| Configuration store | Versioned per-client deployment configuration | Eighteen tables were observed; the only overlapping name, legacy `RetellEventReceipts`, has an incompatible 40-column contract, while the other three MVP names are absent | The legacy table cannot safely host this runtime and the exact four-table MVP schema is not deployed | Preserve the legacy table untouched; use the distinct new `FreeTestRetellEventReceipts` name with the other three minimized tables and an allowlisted Catalyst adapter | Source/runtime name collision reconciled; exact new tables/constraints/readback remain |
| Route approval | Explicit approval before activation | CRM approval/status controls existed as setup evidence | No accepted Catalyst configuration/readback | Resolver requires the deployment's approved active state; CRM is not called at runtime | Source behavior requires Development proof; CRM runtime correctly disabled |
| Seven-day stop | `now < expires_at` on every resolver request | No accepted runtime enforcement was proved | Deployed clock/boundary readback absent | Exact deterministic time gate is implemented/tested in source | Source/synthetic proof only until Development execution |
| 25-call stop | Resolver requires handled count below 25; 25th processed call completes; in-flight overshoot visible | No accepted runtime enforcement was proved | Deployed concurrency/count behavior absent | MVP removed reservations/orphans and uses idempotent durable handled count with honest overshoot | Source/synthetic proof only; exact no-overshoot cap deliberately not claimed |
| Retell event ingestion | Authenticated, validated, minimized, idempotent HTTP path | Six undeployed function definitions were observed; route listing failed | No reachable route or successful event readback | Raw-body verification, schema checks, durable deduplication, safe errors, and Development-only boundary are represented | Source/synthetic proof only until deployment/readback |
| Event/call processor | One canonical call/outcome/count under replay/reorder/retry | No accepted execution/readback evidence | Catalyst durable behavior and Job packaging are unproven | Opaque call key, immutable ownership, idempotent count/outcome, reordered-event behavior, and separate `retell_free_test_retry` Function Job are represented | Source/synthetic proof only until Data Store and Job execution/readback |
| Canonical call store | One client/deployment/config-bound call row | No end-to-end Development call row was observed | Durable uniqueness and tenant partition unproven | Keyed-HMAC lookup and immutable ownership checks are represented | Source/synthetic proof only until Development table/readback evidence |
| Email notification | Email only; durable state; default `dry_run` plus one controlled send proof | No notification implementation/delivery evidence was observed | Catalyst Mail/runtime/provider/inbox readback absent | Source defaults to `DryRunRecorded` and models `send_development`, retry, ambiguity, terminal failure, and no blind resend | Source/synthetic proof only; one controlled delivery/replay/readback and restoration to `dry_run` remain |
| Internal reporting | Fixed client/deployment Catalyst query and sanitized CSV | Existing reporting contracts were Analytics-oriented | No MVP query/export execution evidence | Metric contract and runtime boundary use canonical call rows; Analytics outbox/import removed from MVP | Query/CSV source contract exists; deployed export/isolation proof remains |
| CRM | Disabled in free-test call lifecycle | CRM setup/automation controls exist outside this runtime | Risk of implying call-path dependency | MVP performs no CRM read/write | Correctly disabled; not an internal-test blocker |
| Zoho Analytics | Deferred optional later presentation layer | Analytics access/workspace/import remained unproven | Prior docs treated Analytics as acceptance-critical | Analytics adapter/outbox/import removed from MVP documentation and source target | Correctly deferred; not an offline/internal-test blocker |
| Security | Development-only, authenticated, validated, redacted, tenant-partitioned | Repository controls existed; runtime grants/logs/routes were not read back | Effective permissions/settings unproven | Fail-closed config, environment rejection, HMAC identifiers, request bounds, target-specific least-privilege variables, PII/ePHI validator requirements, safe errors, and dry-run mail boundary are represented | Source/synthetic proof only until Development identity/grant/log readback |
| Runtime/source parity | MVP runtime reproducible from one revision and read back in Development | Observed metadata did not map to an accepted deployed revision | Deployment/source parity remains unproven | Advanced I/O routes, four-table adapter, email modes, retry Job/Cron, query/CSV, schema, variables, and tests are represented; core package CI passed 46/46 (17 unit, 20 integration, 9 acceptance) and retry-package CI passed 1/1 | **READY FOR DEVELOPMENT DEPLOYMENT**; runtime parity and phone readiness still require readback |

## Readiness By Validation Lane

| Lane | Status | Meaning |
| --- | --- | --- |
| Offline/synthetic Development | Source, backend synthetic, and Retell-native evidence | Uses only synthetic clients/events; 25/25 supported native simulations passed; no phone, external email, CRM, or Analytics |
| Development end-to-end deployment test | **READY FOR DEVELOPMENT DEPLOYMENT** | Source is ready for a Development-only deployment with exact target, rollback, and independent readback |
| Controlled internal Development phone test | **NOT READY** | Requires successful deployed E2E evidence, Retell parity/native tests, two non-customer Development numbers on the same shared version, one controlled email proof, explicit owner-approved tester/scope/settings/data/rollback, and route readback |
| Controlled prospect test | **NOT READY — approval unresolved** | Requires a separate real-prospect operating decision, actual email approval, route/recipient/data handling, rollback, and every approval appropriate to the facts |
| Production | **Not authorized** | Outside this work |

**Current classification: READY FOR DEVELOPMENT DEPLOYMENT.** Controlled internal phone testing remains **NOT READY**. The next acceptance target is **READY FOR CONTROLLED INTERNAL PHONE TEST**, and that status may be used only after the Development runtime and Retell route are deployed and independently read back with the evidence below.

## Current Blockers

These are current evidence gaps, not claims that every item is a permanent product gate:

1. no reviewed immutable build has been deployed and read back in the intended Catalyst Development project;
2. the required four-table schema, uniqueness behavior, PII/ePHI validators, conditional count update, least-privilege grants, and target-specific variables have not been proved in that runtime;
3. the authenticated resolver, event, and readiness routes have not passed deployed request/response and durable-row readback;
4. the separate `retell_free_test_retry` Function Job and its disabled-first one-minute predefined Cron have not been deployed, immediately triggered, enabled, or read back in the exact Development pool;
5. Retell's actual provider behavior for resolver authentication failure, timeout, 503, malformed JSON, invalid override, and endpoint unavailability remains unproven, even though the shared agent's exact no-intake gate passed native simulation;
6. the reconciled Retell draft has not been published/pinned, its webhook is unset, one observed Development number remains unbound, and a second dedicated synthetic number is unavailable;
7. no deployed two-client trace yet proves resolver, call/outcome/count, notification state, fixed-scope query/CSV isolation, and same-version routing;
8. one controlled `send_development` delivery, provider/inbox readback, replay-without-duplicate proof, and restoration to `dry_run` have not occurred;
9. rollback, initial-number freeze, post-completion cooldown, and route disablement have not been rehearsed against the deployed Development path; and
10. the controlled internal tester, two synthetic number bindings, test window, deployed route, data readback, and rollback evidence do not yet exist.

Zoho Analytics, CRM mutation, exact-cap reservations, orphan-slot reconciliation, automatic number reassignment, and SMS are outside this internal MVP. One exact Development email delivery/readback is still required for the requested internal-phone readiness classification; it cannot be attempted until a verified sender and approved Development recipient exist in deployed configuration.

The [legal archive](../legal-compliance/README.md) preserves research and a conservative historical internal-QA proposal. It is not legal advice and does not itself grant or deny a specific test. This reconciliation records engineering and operating authority only.

## Development End-To-End Evidence Still Required

An authorized operator must produce, not assume:

1. exact source revision/build, Catalyst Development identity, four-table schema, constraints, variables, and least-privilege readback;
2. deployed resolver/event/readiness routes and safe error behavior;
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
