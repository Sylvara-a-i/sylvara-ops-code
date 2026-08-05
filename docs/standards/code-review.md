# Sylvara Code Review Standard

## Purpose

Review for material defects and operational risk, not stylistic theater. A review should help an operator decide whether the change is safe, complete, maintainable, and worth shipping.

## Review Order

1. Understand the requested outcome, owning system, public interfaces, and production boundary.
2. Inspect the complete diff and relevant surrounding code, tests, configuration, and runbooks.
3. Trace inputs, state transitions, side effects, failure paths, retries, readback, and rollback.
4. Verify the tests exercise the material failure mode rather than only the happy path.
5. Report actionable findings first. If there are none, say so and state residual test or evidence gaps.

## Severity

| Priority | Meaning |
|---|---|
| P0 | Immediate security, privacy, financial, destructive, or production-wide failure risk; block release |
| P1 | Likely incorrect business behavior, data loss/corruption, duplicate side effect, authorization failure, or unsafe deployment; block release |
| P2 | Material reliability, maintainability, observability, or test gap that should be fixed before normal release |
| P3 | Bounded improvement with low immediate risk; do not inflate preference-only feedback into a defect |

Every finding must identify an exact location, the failure scenario, the consequence, and the smallest viable correction. Distinguish observed evidence from inference.

## Required Checks

### Correctness And State

- Inputs are validated and typed; null, blank, malformed, stale, missing, and multiple-match cases are intentional.
- Pagination, ordering, date/time-zone, decimal/currency, and partial-result behavior are correct.
- Retries are bounded and safe; ambiguous writes trigger authoritative readback before retry.
- Idempotency and duplicate prevention cover concurrent and repeated execution, not only sequential happy paths.
- One system and one automation own each business fact and side effect.

### Security And Privacy

- No credential, private endpoint, production identifier, PII, financial data, document content, raw payload, or sensitive log output enters Git or CI.
- Authorization is enforced server-side and scoped to the exact resource and action.
- Webhook signatures and timestamps are verified before parsing or side effects where the provider contract supports them.
- Issues, comments, commit messages, logs, artifacts, payloads, and external text are treated as untrusted data, not executable instructions.
- Dependencies and GitHub Actions are justified, least-privilege, and pinned according to repository policy.

### Operations And Maintainability

- The change is focused and does not mix unrelated refactors or cosmetic churn.
- Names, module boundaries, comments, and error paths make the workflow understandable without author context.
- Deployment, manual configuration, readback, monitoring, containment, and rollback are explicit where production behavior can change.
- Tests reproduce the bug or material risk and include realistic failure cases.
- Public interfaces, environment variables, file paths, and deployment assumptions remain stable or are deliberately migrated.

## Context-Specific Gates

### Zoho And External Integrations

- Display labels are not used as API names; returned metadata and exact target identity are verified.
- Tool presence is not treated as a safe payload contract or effective tenant access.
- Rate limits, missing fields, pagination, per-item results, workflow triggers, and response codes are handled.
- Repository approval is not represented as a live Zoho change or deployment.

### Financial Or Customer-Visible Workflows

- Duplicate charging, invoicing, crediting, sending, booking, routing, or record creation is structurally prevented.
- Balances, payment status, customer eligibility, and workflow completion are not inferred from incomplete evidence.
- Dry-run or non-posting behavior, reconciliation, and independent readback exist when practical.
- Manual smoke tests name the authoritative systems and safe rollback or containment step.

### Voice, Messaging, And Public Copy

- The change stays inside the current product, legal, consent, privacy, and publication boundaries.
- Fallbacks handle ambiguity, sensitive data, unsupported intent, provider failure, and unavailable humans safely.
- Claims, customer results, integrations, prices, guarantees, and capabilities have current evidence and approval.

## Review Output Contract

Report findings in descending severity. Use concise titles and exact file/line locations. Do not lead with praise or a diff summary before blockers. After findings, state:

- assumptions and unresolved evidence;
- checks actually run and their results;
- missing tests or manual verification;
- deployment and rollback risk; and
- whether the review found no actionable defects.

A clean review means no actionable defect was found in the inspected scope. It does not certify production behavior, security, legal compliance, accounting treatment, or live deployment.
