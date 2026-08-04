# Sylvara Operations Code

Public, sanitized technical source of truth for Sylvara's automation systems, integration standards, tests, and operating runbooks.

This repository is publicly viewable but is not open source. See [`NOTICE.md`](NOTICE.md).

## Repository Boundary

GitHub owns versioned code and sanitized technical context. It does not own live customer data, accounting records, call data, credentials, production configuration, or deployment state.

| Area | Operational source of truth |
|---|---|
| Prospects, customers, and commercial relationships | Approved CRM |
| General ledger, accounting balances, and financial reporting | Zoho Books |
| Subscription lifecycle and billing events | Zoho Billing, when used for the approved workflow |
| Voice-agent runtime | Retell or the approved voice platform |
| Non-critical workflow orchestration | Make or the approved automation platform |
| Custom workflow UI and records | Zoho Creator only for an explicitly approved use case |
| Secure middleware, webhook verification, and retry controls | Zoho Catalyst or the approved middleware runtime |
| Credentials and tokens | Platform secret stores only |
| Sanitized code, tests, schemas, runbooks, and decisions | This repository |

The detailed ownership map is in [`docs/architecture/system-overview.md`](docs/architecture/system-overview.md).

## Current Contents

```text
.github/       Pull-request ownership, templates, dependency updates, and CI
archive/       Sanitized historical references that are not deployment-approved
docs/          Architecture, security, setup, and reusable runbooks
src/           Active or governed system-specific technical artifacts
tools/safety/  Public-repository and workflow-policy validation
```

Current governed artifacts:

- [`docs/zoho/`](docs/zoho/) defines portable Zoho MCP, CRM schema, Deluge, and product-ownership standards without copying another tenant's fields or configuration.
- [`docs/zoho/mcp/observed-tool-inventory.json`](docs/zoho/mcp/observed-tool-inventory.json) preserves one sanitized row for each of 403 tool contracts observed on 2026-08-03; it is a dated capability snapshot, not a Sylvara allowlist or proof of access.
- [`src/zoho-books/reference/chart-of-accounts.csv`](src/zoho-books/reference/chart-of-accounts.csv) is a sanitized reference with system IDs and bank-account suffixes removed.
- [`archive/zoho-catalyst/billing-webhook-gateway`](archive/zoho-catalyst/billing-webhook-gateway) preserves a non-executable review record and source hashes. The supplied handler and deployment files are excluded because current route and deployment status are unverified.

## Operating Rules

1. Keep changes focused and reviewable.
2. Use short-lived branches and pull requests; do not make routine direct changes to `main`.
3. Run repository and workflow safety checks before publication.
4. Treat every public commit, branch, pull request, log, and artifact as permanently disclosed.
5. Use synthetic examples only. Never commit secrets, customer data, call data, raw payloads, production identifiers, or financial records.
6. A merged pull request does not authorize or perform a production deployment, live Zoho change, billing action, or customer communication.
7. Live changes require an explicit deployment plan, scoped approval, rollback path, and independent readback.

## Local Validation

```powershell
python -m venv .codex-tmp\safety-venv
.\.codex-tmp\safety-venv\Scripts\python.exe -m pip install --disable-pip-version-check --only-binary=:all: --require-hashes -r tools/safety/requirements.txt
.\.codex-tmp\safety-venv\Scripts\python.exe tools/safety/pre-commit-safety-check.py
.\.codex-tmp\safety-venv\Scripts\python.exe tools/safety/validate_workflows.py
.\.codex-tmp\safety-venv\Scripts\python.exe -m unittest discover -s tools/safety/tests -p "test_*.py" -v
```

Use 64-bit CPython 3.12 on Windows for the documented local path; CI runs the equivalent checks on CPython 3.12 for Linux. Dependency installation is hash-pinned and fails closed on an unsupported wheel.

## Commercial Constraint

Build only what supports a validated demo, customer commitment, or paid delivery. Do not create a generalized agent platform, custom telephony stack, client portal, or multi-tenant SaaS layer without evidence that the simpler managed-service workflow is insufficient.

## Security

Read [`SECURITY.md`](SECURITY.md) and [`docs/security/public-repository-boundary.md`](docs/security/public-repository-boundary.md) before adding code, configuration, exports, screenshots, logs, or integration examples.
