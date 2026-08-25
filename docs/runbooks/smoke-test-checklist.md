# Smoke-Test Checklist

This checklist separates offline/synthetic Development, a controlled internal Development phone test, and a later prospect/Production workflow. The [legal archive](../legal-compliance/README.md) preserves a conservative historical profile but does not itself decide authorization for a particular test.

Current classification is **NOT READY FOR RETELL AGENT TESTING**. No phone call, Retell simulation, prospect/customer route, or Production traffic is authorized by this checklist.

The earlier four-table/two-function Development proof is historical migration evidence. Readiness now requires the exact final-main six-function and two-pool topology, canonical migration/reconciliation, CRM and Billing TEST lifecycle, both Analytics dashboards, staged cleanup, exposed-key rotation and revocation, dark-Production zero-traffic proof, rollback, and zero open P0/P1 defects under the [final release contract](../product/free-revenue-leak-test-release-contract.md).

## Safety Preconditions

- [ ] Target organization, environment, runtime, and account are confirmed.
- [ ] The tested artifact matches the reviewed commit and immutable artifact reference.
- [ ] Required deployment approval is recorded.
- [ ] Test data is synthetic and clearly identifiable.
- [ ] No real caller PII, recording, transcript, payment data, or client payload is used.
- [ ] Rollback and containment actions are ready.
- [ ] Logging is sanitized and secret redaction is enabled.

## Repository Checks

- [ ] Required tests, linting, formatting, type checks, and repository safety checks pass.
- [ ] The committed diff contains no secrets, private identifiers, or generated sensitive artifacts.
- [ ] Documentation reflects the implemented boundary and rollback path.
- [ ] The exact reviewed immutable commit is selected and the pull-request state is recorded; merge remains a separate action and is not implied by Development deployment.

## Historical Conservative Profile Checks

Use this section only if the owner explicitly adopts the historical internal-QA profile. It is not automatically required by this checklist and is not a prospect-test path.

- [ ] A synthetic inbound test reaches only the approved voice runtime and route.
- [ ] The static AI/demo notice and keypad assent occur before speech recognition; absent, ambiguous, or withdrawn assent ends the call.
- [ ] Missing, malformed, ambiguous, spam-like, and after-hours inputs fail safely.
- [ ] A provider or dependency failure produces the controlled profile's approved carrier-level safe termination rather than fabricated success. This is not permission for free-test degraded intake.
- [ ] Recording, retained transcription, content logging, model training, and human review are disabled from the first packet through every provider and subprocessor.
- [ ] Outbound channels, human transfers, post-call events, downstream integrations, and real-world side effects remain disabled.
- [ ] Only synthetic scenario content is accepted; sensitive or real data triggers the approved refusal and termination path.

## Synthetic Development Free-Test Processing — No Phone Or External Delivery

This scope exercises source locally or in a separately authorized isolated Development deployment with synthetic fixtures. It must not bind a callable number, receive audio, contact a recipient, write CRM, import Analytics, or expose a public route.

- [ ] The source revision, `development` environment, component-owned variable registry, exact `FREE_TEST_NOTIFICATION_MODE=dry_run`, privately configured verified `FREE_TEST_MAIL_FROM`, disabled CRM mode, and absent Analytics integration are verified; `CATALYST_MAIL_MODE` is not accepted.
- [ ] Two synthetic Catalyst clients use different client/deployment/configuration-version/company/service-area/recipient/number values and the same reviewed shared agent version.
- [ ] Each synthetic number value resolves only its own versioned deployment/configuration; this backend isolation proof does not require buying a second live Retell number.
- [ ] All seven exact gate values and every ownership/approval/status/expiry/count invariant pass before normal intake.
- [ ] Every known authenticated invalid, unknown, ambiguous, mismatched, inactive, expired, or exhausted resolution returns HTTP 200 with `{ "call_inbound": { "reject": true } }`, starts no agent, and creates no resolver-side write.
- [ ] Transport/authentication/timeout/503/unavailable, malformed-response, and invalid-override cases may fall back only to the number-bound shared agent; its exact Configuration Unavailable gate collects no caller data.
- [ ] A resolver request fails at a durable handled count of 25; processing the 25th unique handled call completes the deployment; any already-in-flight overshoot is counted and reported honestly.
- [ ] Duplicate, delayed, reordered, malformed, and retried events preserve one immutable call binding and one canonical outcome.
- [ ] Replay produces no duplicate call, handled-count increment, email dry-run row, or CSV row.
- [ ] The email row terminates at `DryRunRecorded` with zero attempts and `CATALYST_MAIL_DRY_RUN`; `sendMail` is never invoked and recipient references never cross clients.
- [ ] Catalyst queries and sanitized CSV exports require both Client ID and Deployment ID and contain one client only.
- [ ] The current Development number is not reused or moved; historical ownership is retained and the completed-number cooldown procedure is documented.
- [ ] One immutable correlation chain follows resolver decision, event, call/outcome/count, email dry-run row, and query/CSV export.
- [ ] All required caller, configuration, isolation, replay, retry, and provider-failure scenarios pass with zero P0/P1 defects.
- [ ] Rollback leaves the deployment inactive, evidence preserved, and subsequent configuration attempts safely unavailable.

Passing this section proves only offline/synthetic readiness. It does not prove a deployed phone route or prospect approval.

## Controlled Internal Development Phone Test

This readiness classification is technical, not authorization to place a call. Before any
telephone execution, the owner must approve a current test-specific profile and route. The
historical conservative profile applies only when expressly adopted; otherwise a separately
reviewed profile must supersede it before the test proceeds.

- [ ] An explicit owner-approved test record identifies the internal tester, synthetic script, one non-customer Development number, shared agent/Catalyst resources, data handling, time window, kill switch, and rollback.
- [ ] The deployed artifact, exact Development routes, four tables, secrets, retry Job, current number binding, and shared agent version are independently read back.
- [ ] No client forwarding, Production resource, real customer/prospect data, prospect/customer email, CRM mutation, or Analytics import is enabled.
- [ ] Catalyst Mail first proves `dry_run`; then one `send_development` email uses only the verified Development sender and approved synthetic recipient, receives provider/inbox readback, and replay produces no second delivery; mode is restored to `dry_run`.
- [ ] The dedicated Development number reaches only its active synthetic deployment and the shared reviewed agent version.
- [ ] The exact gate, company identity, bounded intake, interruption/correction behavior, and deliberate closing pass on the approved internal calls.
- [ ] The complete call/event/outcome/count/email/query/CSV correlation trace reconciles for the active phone deployment; backend A/B isolation remains covered by signed Catalyst tests.
- [ ] The current number remains frozen through validation and enters documented cooldown after completion; reassignment is not exercised.
- [ ] The route is disabled or restored to the approved inactive state after the test and read back.

Passing this section supports only the scoped controlled internal Development phone test. It does not authorize a prospect, customer, or Production route.

A second live Development number, live two-number/same-version isolation, paid/native voice expansion, and provider-fallback fault injection are deferred. Complete the second-number proof before activating two concurrent deployments or claiming the first-controlled-prospect technical gate.

## Future Prospect Or Production Checks — Separately Approved

- [ ] The actual prospect/customer workflow has separately recorded business, privacy, security, vendor, client, route, data, notification, deployment, and any professional approval required for its facts.
- [ ] The post-call event contains only the minimum approved fields.
- [ ] Required fields and allowlists are validated before downstream writes.
- [ ] The same event replayed twice produces no duplicate business action.
- [ ] An ambiguous timeout causes authoritative-state readback before retry.
- [ ] Catalyst Mail sender, approved email recipient, delivery result, and any other enabled downstream result are independently verified.
- [ ] If financial systems are involved, tests remain non-mutating unless a separately approved sandbox procedure exists.

## Observation And Exit

- [ ] Error, latency, and handoff behavior stay within the approved pilot threshold.
- [ ] No secret, PII, raw payload, or exact private configuration appears in logs or artifacts.
- [ ] Runtime and authoritative system state match the expected result.
- [ ] The sanitized deployment outcome is recorded.
- [ ] Temporary test records and access are removed through approved, traceable procedures.

Stop and contain the scoped test on any identity mismatch, unexpected data handling, enabled outbound channel, unexpected integration, unauthorized side effect, duplicate action, sensitive-data exposure, failed readback, or unknown write result. If the historical conservative profile is the adopted control record, also stop on pre-assent speech processing or retained call content.
