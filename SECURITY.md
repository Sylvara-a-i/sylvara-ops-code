# Security Policy

## Reporting A Vulnerability

Use GitHub private vulnerability reporting from this repository's **Security** tab. Do not publish exploit details, credentials, customer data, call data, financial data, or production configuration in an issue, discussion, pull request, commit, or comment.

## Public Repository Rule

Treat every commit, branch, tag, pull request, workflow log, release, and artifact as permanently public. Removing a file later does not reliably remove it from prior Git objects, clones, forks, caches, or third-party systems.

## Prohibited Content

- Passwords, MFA codes, recovery codes, API keys, OAuth tokens, private keys, or populated environment files
- Credential-bearing URLs, authorization headers, webhook secrets, or signing material
- Customer, caller, lead, employee, contractor, or vendor PII
- Phone numbers, addresses, recordings, transcripts, raw prompts, or customer-specific routing rules
- Raw CRM, Retell, Make, Zoho, telephony, payment, or production payloads and logs
- Bank details, balances, transactions, invoices, payment records, tax data, account suffixes, or accounting exports
- Production organization, account, record, agent, workflow, webhook, phone, or tenant identifiers
- Signed contracts, private pricing, customer exports, or unapproved case-study material
- Exact production security or escalation logic when disclosure would materially enable abuse

Use blank environment examples, synthetic fixtures, redacted screenshots, and allowlisted text derivatives of private exports.

## Dependency And Workflow Controls

- Pin third-party GitHub Actions to full commit SHAs.
- Keep workflow permissions read-only unless a reviewed job has a documented need for a narrower write permission.
- Disable persisted checkout credentials.
- Commit lockfiles for runnable package manifests.
- Do not commit vendored dependencies, build output, caches, or `node_modules`.
- Run the repository safety scanner, workflow-policy validator, and regression tests before publication.

## Suspected Exposure

1. Stop publication and preserve a minimal incident record outside the public repository.
2. Revoke or rotate the affected credential before attempting repository cleanup.
3. Determine whether customer, financial, or regulated data was exposed and follow the approved notification process.
4. Remove the material from the current branch and, when justified, coordinate history cleanup with repository administrators.
5. Assume public copies may remain even after cleanup.
6. Add a regression check that would have blocked the same exposure.

See [`docs/security/security-incidents.md`](docs/security/security-incidents.md) for the operational checklist.
