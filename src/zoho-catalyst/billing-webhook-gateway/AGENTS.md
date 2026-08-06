# Billing Webhook Gateway Instructions

These rules apply to the proposed Zoho Billing webhook gateway. Read [`README.md`](README.md) and the linked Billing and Catalyst standards before changing behavior.

## Non-Negotiable Security Contract

- Production remains code-blocked. Repository changes, tests, and pull-request approval do not authorize deployment or a live Billing, Catalyst, Creator, or Books action.
- Accept only the exact configured route and content type. Bound the declared and streamed body, require proven environment identity, and reject stale, future, malformed, or unsupported events.
- Verify the provider signature over the unchanged raw bytes before parsing, normalizing, logging, Data Store access, or any downstream call. Preserve constant-time comparison and the reviewed current/previous-secret rotation boundary.
- Claim each event through a durable unique key before a side effect. An uncertain insert, update, duplicate, timeout, or downstream result must fail into `reconciliation_required`; it must never be treated as safe replay or success.
- A successful acknowledgment requires exact durable readback of the completed gateway state and the approved downstream outcome. Zoho Books remains accounting truth; this gateway must not infer or create an accounting outcome.
- Forward only explicitly allowlisted, bounded scalars. Do not forward or log raw bodies, signatures, headers, credentials, response bodies, customer data, event identifiers, fingerprints, routes, hosts, connection names, or platform identifiers.
- Keep source authentication, normalization, idempotency, delivery, and redaction boundaries explicit. Do not hide consequential behavior in generic helpers.

## Change And Test Standard

- Do not loosen a gate based only on an example, catalog, assumed provider behavior, or mocked success. Require current official documentation plus a sanitized Development fixture for provider-specific facts.
- Treat timeouts and partial failures as ambiguous until authoritative readback resolves them. Retries must preserve the same event identity and side-effect boundary.
- Add a regression test for every change to signature handling, request bounds, event freshness, environment binding, idempotency, redaction, delivery acknowledgment, or Production blocking.
- Use synthetic fixtures only. Tests must prove both the accepted path and the nearest unsafe path.
- Keep dependencies exact-version pinned. Do not add a service, library, or deployment mechanism unless its operational benefit exceeds its security and support cost.

From this package directory, run `npm run ci`. Then run the repository's canonical verifier before handoff. Report any unverified provider contract, Development-only evidence gap, containment step, or separate live approval still required.
