# Smoke-Test Checklist

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
- [ ] The pull request is approved and merged; deployment remains a separate authorized action.

## Runtime Checks

- [ ] A synthetic inbound test reaches only the approved voice runtime and route.
- [ ] Expected greeting, consent, fallback, and escalation behavior work without revealing private prompt details.
- [ ] Missing, malformed, ambiguous, spam-like, and after-hours inputs fail safely.
- [ ] A provider or dependency failure produces the approved fallback rather than fabricated success.
- [ ] Make or another post-call workflow failure does not unnecessarily terminate an active conversation.
- [ ] Recording and transcript behavior matches the approved privacy configuration.

## Integration Checks

- [ ] The post-call event contains only the minimum approved fields.
- [ ] Required fields and allowlists are validated before downstream writes.
- [ ] The same event replayed twice produces no duplicate business action.
- [ ] An ambiguous timeout causes authoritative-state readback before retry.
- [ ] CRM, scheduling, notification, or other downstream results are independently verified.
- [ ] If financial systems are involved, tests remain non-mutating unless a separately approved sandbox procedure exists.

## Observation And Exit

- [ ] Error, latency, and handoff behavior stay within the approved pilot threshold.
- [ ] No secret, PII, raw payload, or exact private configuration appears in logs or artifacts.
- [ ] Runtime and authoritative system state match the expected result.
- [ ] The sanitized deployment outcome is recorded.
- [ ] Temporary test records and access are removed through approved, traceable procedures.

Stop and contain the rollout on any identity mismatch, unauthorized side effect, duplicate action, sensitive-data exposure, failed readback, or unknown write result.
