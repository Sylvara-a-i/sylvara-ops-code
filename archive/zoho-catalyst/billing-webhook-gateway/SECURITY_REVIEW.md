# Security Review: Billing Webhook Gateway

## Decision

**Supplied export deployment: BLOCKED. Supplied export publication: BLOCKED. Sanitized replacement deployment: BLOCKED pending Development evidence.**

This is a sanitized design-level record derived from a historical local export. No live endpoint, route, middleware environment, downstream workflow, provider contract, secret store, retry behavior, or production log was tested. The original implementation is intentionally absent from this public repository. A separately written replacement is maintained at [`src/zoho-catalyst/billing-webhook-gateway`](../../../src/zoho-catalyst/billing-webhook-gateway/); its presence does not satisfy the release gates below.

## Findings To Resolve In A Replacement

### 1. Atomic idempotency is required

The reviewed design did not establish an atomic, durable claim for concurrent deliveries. A replacement must use a unique event key and durable states such as `received`, `processing`, and `completed`. The downstream operation must enforce the same stable key.

### 2. Failure handling must be fail-closed

Authentication, idempotency-store, and configuration failures must stop processing or place the event into a durable recovery path. Required controls must not be silently disabled by configuration.

### 3. Ambiguous delivery outcomes need reconciliation

A timeout or process failure must not cause either silent event loss or blind duplicate delivery. The gateway needs an inbox/outbox state machine, documented retry classification, and a downstream lookup by idempotency key before replay.

### 4. Data and logs must be minimized

Only an allowlisted downstream schema may be forwarded. Authentication material and raw payloads must not be copied into workflow records or logs. Logs need centralized redaction, bounded response reads, access controls, and retention limits.

### 5. Routing and environment identity must be trusted

Route, environment, and event-source decisions must come from immutable deployment configuration or trusted platform metadata, not caller-controlled headers or labels. The deployed route needs an exact allowlist and spoofing tests.

### 6. Runtime and dependencies need a supported baseline

A replacement must select a currently supported runtime, pin and review dependencies, generate a clean lockfile, and run tests in the exact build image. Historical syntax or dependency metadata is not compatibility evidence.

### 7. Tests and release evidence are mandatory

No replacement may deploy without automated coverage for concurrent duplicates, datastore failures, crash windows, ambiguous timeouts, signing boundaries, request-size and encoding limits, route spoofing, outbound request restrictions, log redaction, and Development-only end-to-end retries.

## Release Gates

Before any replacement can reach Production, require:

1. A minimal downstream contract using synthetic fixtures only.
2. Platform-managed secrets with rotation and least privilege.
3. A durable idempotency and recovery design.
4. Explicit response-size, redirect, timeout, and rate-limit controls.
5. A reviewed pull request with all required checks passing.
6. An immutable artifact hash and a sanitized deployment record.
7. Development deployment, smoke test, downstream readback, and rollback test.
8. Explicit approval for the exact Production artifact.

## Verification Performed

- Inventoried the supplied top-level files.
- Excluded the installed dependency directory.
- Recorded pre-sanitization SHA-256 hashes in the companion README.
- Reviewed the source privately for security and reliability risks.
- Confirmed that no executable source or deployable configuration is included in this public record.

These checks preserve review evidence only. They do not establish current deployment state or authorize reuse.
