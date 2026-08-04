# Security Policy

## Reporting A Vulnerability

Use GitHub private vulnerability reporting from the repository's **Security** tab. Do not publish exploit details, credentials, customer data, call data, or production configuration in an issue, pull request, discussion, commit, or comment.

## Public Repository Rule

Treat every commit, branch, tag, pull request, comment, workflow log, release, and artifact as permanently public. Removing a file later does not guarantee that copies, forks, caches, or prior Git objects disappear.

## Prohibited Repository Content

- Passwords, MFA codes, recovery codes, tokens, API keys, private keys, or `.env` files
- Client phone-system credentials or secret-bearing URLs
- Production agent IDs, phone numbers, webhook secrets, or authentication headers
- Call recordings, transcripts, caller names, phone numbers, addresses, or other PII
- Raw Retell, Make, telephony, CRM, payment, or production payloads
- Unredacted production logs, customer exports, signed agreements, or billing records
- Exact production prompts or guardrails when disclosure would create an abuse or security risk

## Credential Handling

Use local environment variables for development and the approved platform's encrypted secret store for deployment. Commit only `.env.example` with blank values and explanatory comments.

Treat any committed secret as compromised. Revoke or rotate it immediately, preserve incident evidence outside the public repository, then remove it from the current branch and Git history. Assume prior public copies may still exist.
