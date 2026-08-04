# Sylvara Ops Code

Public, sanitized technical source of truth for Sylvara's productized after-hours and overflow call-recovery service for independent residential plumbing companies.

## Repository Identity

```text
Owner: Sylvara-a-i
Repository: sylvara-ops-code
Visibility: Public
Default branch: main
Canonical URL: https://github.com/Sylvara-a-i/sylvara-ops-code
```

## Current Commercial Wedge

**Target:** Locally owned residential plumbing companies with approximately 5–15 service trucks, meaningful inbound lead volume, after-hours or no-answer leakage, capacity for more work, and no effective existing AI or human overflow system.

**Offer:** Sylvara answers only approved after-hours, busy, and unanswered calls; applies plumbing-specific qualification and escalation rules; books or hands off eligible work; and reports each recovered opportunity against the pre-launch baseline.

**Primary Outcome:** Recover more qualified plumbing opportunities without replacing the client's daytime front office.

This is a testable commercial hypothesis, not a proven market conclusion. Public visibility does not make this repository open source; see `NOTICE.md`.

## Source-Of-Truth Boundaries

| Area | Source Of Truth |
|---|---|
| Prospect and customer records | Approved CRM |
| Contracts, invoices, and payments | Approved business systems |
| Voice agent runtime configuration | Retell AI or the approved runtime |
| Workflow runtime configuration | Make.com or the approved runtime |
| Credentials and tokens | Platform secret stores only |
| Code, sanitized configuration, tests, runbooks, and decision records | This repository |
| Call recordings, transcripts, caller PII, and raw production logs | Never this repository |

## Operating Rules

1. Sell and validate before building a broad platform.
2. One vertical, one offer, and one controlled call path at a time.
3. Do not commit secrets, caller data, client exports, recordings, transcripts, or production payloads.
4. Every live change needs a rollback path and a test record.
5. Client-specific configuration must be sanitized before it enters GitHub.
6. No destructive, externally visible, financial, publishing, or production-data action without explicit approval.

## Repository Map

```text
docs/
  strategy/      ICP, offer, validation gates, and decisions
  website/       Approved website copy and cleanup plan
  sales/         Assessment, objections, and sales process
  product/       Architecture, call flow, and QA plan
  operations/    Onboarding, deployment, and rollback
  security/      Data classification and credential rules
integrations/
  retell/        Sanitized agent configuration and integration notes
  make/          Sanitized scenario maps and integration notes
  telephony/     Forwarding and phone-system patterns
scripts/         Local and CI safety checks
src/             Runtime code only when a paid pilot requires it
```

## First Milestone

A working plumbing demo that:

- receives a real inbound call;
- handles one approved new-customer intake path;
- identifies service area, job type, urgency, and callback details;
- escalates approved emergencies;
- sends a structured post-call summary;
- passes the documented QA test plan.

Do not add a client portal, multi-tenant administration, generalized agent builder, complex analytics, or custom telephony platform before paid demand proves the need.


## Public Repository Boundary

This repository is intentionally public for sanitized code review, connector compatibility, and operational transparency. Treat every commit as permanently disclosed. Never commit client-specific configuration, production prompts, phone numbers, recordings, transcripts, raw payloads, credentials, secret-bearing URLs, customer records, or unredacted logs. See `docs/security/PUBLIC_REPOSITORY_BOUNDARY.md`.

External contributions are not currently accepted, and pull requests should be restricted to approved collaborators. Security reports should use GitHub private vulnerability reporting.
