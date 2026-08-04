# Data Classification

## Policy

This is a public repository. Only information classified **Public** may be committed. When classification is unclear, treat the information as **Restricted** and keep it out of GitHub until an authorized reviewer approves a sanitized form.

## Classification Levels

| Level | Examples | Public Repository Handling |
|---|---|---|
| Public | Sanitized code, public runbooks, generic architecture, synthetic test fixtures, approved public documentation | Allowed after review and automated scanning |
| Internal | Private operating procedures, unpublished roadmaps, private vendor assessments, internal-only architecture detail | Do not commit |
| Confidential | Client configuration, contracts, private commercial terms, production identifiers, nonpublic reports, production topology | Do not commit |
| Restricted | Credentials, tokens, private keys, MFA or recovery codes, caller PII, recordings, transcripts, payment or banking data, health or government-ID data, raw production payloads or logs | Never request, copy, upload, or commit |

## Data-Minimization Rules

- Use synthetic names, phone numbers, addresses, account IDs, payloads, and timestamps.
- Include only the fields required to demonstrate or test behavior.
- Replace production endpoints and identifiers with obvious placeholders.
- Do not include exact production prompts or guardrails whose disclosure creates abuse or security risk.
- Do not place secrets in examples, tests, comments, screenshots, commit messages, pull requests, workflow logs, or generated artifacts.
- Keep call recordings, transcripts, caller data, client exports, and unredacted logs in approved private systems with appropriate retention controls.

## Sanitization Review

Before committing an artifact:

1. Confirm its intended audience is public.
2. Remove client names, identifiers, contact details, and account-specific configuration.
3. Replace payloads with minimal synthetic fixtures.
4. Remove credentials, authentication headers, signed URLs, webhook secrets, and environment values.
5. Remove hidden data, document metadata, comments, spreadsheet formulas, image EXIF data, and revision history when applicable.
6. Check filenames, paths, logs, diffs, commit messages, and generated files for sensitive context.
7. Run the repository safety checks and review the staged diff.

## Handling Uncertainty

Do not downgrade data based on convenience. If the source, ownership, consent, or classification cannot be verified, stop publication and keep the material outside the repository. A sanitized summary may be created only after confirming that it cannot be reversed into sensitive source data.

## Incident Rule

Treat any committed secret as compromised, even if it was quickly removed. Follow [Security Incidents](security-incidents.md) immediately.
