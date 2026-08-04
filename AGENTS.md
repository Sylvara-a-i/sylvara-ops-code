# Agent Instructions

Optimize for first revenue, delivery reliability, maintainability, margin, and speed.

## Commercial Constraints

- Primary segment: independent residential plumbing companies with approximately 5–15 service trucks.
- Primary offer: after-hours and overflow call recovery, not a generic AI receptionist.
- Do not broaden to all contractors without attributable customer evidence.
- Do not confuse positive feedback with willingness to pay.
- Preserve the current offer until direct evidence justifies a change.

## Engineering Constraints

- Prefer managed services and the smallest reliable implementation.
- Retell AI is the default voice runtime for the first paid pilots.
- Make.com is the default post-call workflow layer for the first paid pilots.
- Keep Make.com out of the critical conversational path where practical.
- Do not build custom telephony, a general agent platform, or multi-tenant SaaS administration.
- Add code only when a specific demo or paid pilot requires it.

## Security Constraints

Never request, store, expose, upload, or commit:

- passwords, MFA codes, recovery codes, tokens, API keys, or private keys;
- `.env` files;
- call recordings, transcripts, phone numbers, addresses, or caller PII;
- client credentials, raw production payloads, or production logs;
- payment, banking, health, government-ID, or other sensitive records.

Use environment-variable references and platform secret stores. Keep examples synthetic.

## Change Workflow

1. Inspect current repository state.
2. Make one focused change on a short-lived branch.
3. Add or update tests and runbooks.
4. Open a pull request into `main`.
5. Run checks and resolve failures.
6. Obtain explicit approval before production deployment or external publication.
7. Merge by squash after checks pass.
8. Delete the merged branch.
9. Record any production-relevant deployment and rollback result.

## Public Repository Constraints

- Treat every commit and pull request as permanently disclosed.
- Do not publish client-specific configuration, private sales research, pricing negotiations, production identifiers, exact production prompts that create abuse risk, or unapproved case-study material.
- External contributors are not accepted unless Gabriel explicitly changes that policy.
- Approved connectors must use branches and pull requests; they may not bypass `main` protections.
