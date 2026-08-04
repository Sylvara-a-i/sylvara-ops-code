# Zoho Billing Webhook Gateway

**Repository status: Proposed sanitized replacement. Live state: Unknown. Deployment status: Not deployed, not deployment-approved, and code-blocked from Production.**

This package is the public, reviewable successor to the historical Billing-to-Creator Catalyst export recorded in [`archive/zoho-catalyst/billing-webhook-gateway`](../../../archive/zoho-catalyst/billing-webhook-gateway/). It preserves the intended inbound workflow as new source while removing private deployment identity, personal metadata, raw payload forwarding, cache-only replay marking, broad host suffixes, raw OAuth refresh logic, and unsafe logging.

The supplied export remains outside GitHub. This package is not a mechanically redacted copy and is not evidence of the code currently running in Catalyst. Repository tests establish only local behavior against synthetic fixtures.

`index.js` follows Catalyst's blank Advanced I/O contract by exporting a native Node.js HTTP server created with `createServer()`. The adapter is tested with a synthetic signed request and an injected Catalyst SDK boundary. A real Catalyst CLI serve test is still required in Development before any deployment.

## Ownership

- Zoho Billing owns approved subscription lifecycle, source events, and entitlement facts.
- Zoho Catalyst authenticates, bounds, normalizes, durably claims, and routes an event.
- Zoho Creator may own only the approved downstream workflow state represented by its Custom API contract.
- Zoho Books remains the accounting source of truth. This gateway must not create a second invoice, payment, credit, refund, or ledger outcome.
- GitHub owns this sanitized source, tests, schemas, and operating rules - not secrets, live configuration, customer data, or deployment state.

## Request Contract

The handler accepts one exact `POST` route, rejects query strings, requires the configured JSON content type, bounds the declared and streamed body, and verifies `X-Zoho-Webhook-Signature` against the unchanged raw bytes before parsing. The exact route value is private deployment configuration. It requires the `x-zc-environment` header consumed by the pinned Catalyst SDK, then compares that value with both the SDK's runtime environment and `DEPLOYMENT_ENVIRONMENT`; missing, invalid, defaulted, or mismatched metadata fails before Data Store access. Catalyst Development must still prove that the hosted platform injects or overwrites this header so an external caller cannot spoof its provenance.

Zoho Billing requires an alphanumeric signing token of 12-50 characters and documents HMAC-SHA256 canonicalization over sorted query/form parameters followed by raw JSON. This implementation deliberately accepts only the raw-JSON-only case: a Default or Raw JSON body with no URL query or form parameters. Its current security page does not state the signature digest encoding, so `BILLING_SIGNATURE_ENCODING` has no working default. A synthetic delivery from a dedicated Billing test organization must prove `hex` or `base64` and produce a byte-for-byte private fixture before activation. Other body shapes are outside this implementation's approved contract.

Accepted event names are an explicit subset of current documented Billing names. Unknown aliases fail closed. The required `event_time` must use an explicit ISO-8601 timestamp with an offset and fall inside the configured age and future-skew limits. A resend outside that window requires private manual reconciliation.

The gateway derives:

- a stable event key from the Catalyst environment, one private Billing source alias, and Billing `event_id`; and
- a keyed semantic fingerprint from the source event reference, type, time, and the exact optional fields the gateway can forward.

The fingerprint deliberately ignores JSON whitespace and unrelated webhook-delivery metadata. Its secret must remain stable for at least the inbox retention period; rotation requires an approved migration and reconciliation plan.

## Durable Processing

[`config/datastore-schema.json`](config/datastore-schema.json) defines the proposed Catalyst Data Store inbox. Its bounded strings are Catalyst `Var Char` columns. `EVENT_KEY` must be mandatory and unique. The table contains restricted operational metadata: the source event reference needed for reconciliation and a keyed fingerprint, but no direct customer fields or raw payload.

The gateway inserts `processing`, validates the returned row identifier, and treats only Development-verified duplicate error codes as possible conflicts. It then reads exactly one row before classifying a duplicate.

- An exact `completed` duplicate with matching source ID, event type, and semantic fingerprint receives a successful duplicate acknowledgment.
- A conflicting fingerprint or any `processing`, `failed`, or `reconciliation_required` duplicate fails closed for operator reconciliation.
- A Data Store error that is not an explicitly verified duplicate code is never treated as a duplicate.
- State updates are followed by an exact ZCQL readback. An update timeout is authoritative only when that readback matches.
- Success is returned only after the registration state or Creator acknowledgment is durably read back as `completed`.

Keep inbox rows for at least 180 days under an approved private retention and access policy. Source event IDs and fingerprints are never logged. They are visible only to the least-privilege reconciliation role.

## Delivery Modes

`register-only` authenticates and records restricted operational metadata without forwarding direct customer fields. It is permitted only in Catalyst Development and is intended for acceptance testing. Production configuration rejects this mode so a webhook cannot silently consume Billing retries without completing the intended workflow.

`creator` is a Development-only candidate path that sends this minimum private envelope to one exact Creator Custom API:

- schema version;
- derived event key;
- Billing event ID;
- Billing event time;
- allowlisted event type; and
- optional explicitly allowlisted bounded scalars.

Arbitrary floating-point numbers, unsafe integers, nested objects, protected source fields, signatures, headers, raw bodies, OAuth material, endpoint metadata, and webhook-delivery history are not forwarded. Decimal, money, and large numeric identifiers must use a reviewed canonical string contract rather than a JavaScript number. Billing's API documents its stored `payload` as a string; this gateway does not parse that string or support an implied `payload.foo` path. Optional fields must already exist as bounded scalars in an explicitly configured custom JSON webhook body, or be obtained by the companion authoritative readback.

The current authorization adapter attempts to retrieve exactly one `Authorization` header and no query parameters through Catalyst Connections. This is not yet an official, proven Creator connection contract: the published Node SDK credential method is documented for Default Services, and Creator is not in the current Default Services list. A real Catalyst Development fixture must prove whether an approved Custom Service/Connection can supply credentials through this exact pinned-SDK method, or the adapter must be replaced with an officially supported invocation path. The Creator Custom API itself must require OAuth2 with `Zohocreator.customapi.EXECUTE`. Until then, Creator delivery is unsupported and non-deployable. The raw client ID, client secret, refresh token, and token-refresh endpoint variables from the historical export remain retired.

The required companion Creator Custom API is not included in this repository and has not been built or tested. Before any activation, it must perform a second authoritative source check before any side effect. Using a separate least-privilege Billing connection with `ZohoSubscriptions.webhooks.READ`, it must bind the exact private `X-com-zoho-subscriptions-organizationid` header, retrieve `GET /billing/v1/events/{billing_event_id}`, verify the ID, type, time, current source state, and out-of-order rules, then apply one idempotent operation. Only after authoritative downstream readback may it respond:

```json
{
  "accepted": true,
  "authoritative_readback": true,
  "event_key": "<same-derived-key>"
}
```

A timeout, malformed acknowledgment, source mismatch, stale event, conflicting duplicate, or state-update failure becomes `reconciliation_required`; the gateway does not blindly replay an uncertain side effect.

## Runtime Budget

Catalyst Advanced I/O functions currently have a 30-second maximum execution time. Configuration caps the composite inbound, Catalyst platform-operation, Connection, and Creator request budget at 25 seconds. Data Store, ZCQL, and Connection calls receive bounded operation timers; a timed-out insert or update remains ambiguous and is resolved only through the unique key and exact readback.

The configured budget is a fail-closed ceiling, not a service-level promise. Development tests must exercise cold starts, concurrent duplicates, platform timeouts, and Creator timeouts before activation. Capacity testing must also account for Billing's documented 500 webhook triggers per day and Creator's documented API throttle of 50 calls per user per minute and six concurrent calls per account; Custom API daily limits and the actual account plan still require live verification.

## Configuration And Logging

[`config/variables.json`](config/variables.json) is the reviewed registry attested to cover every variable found in the privately supplied export plus the proposed replacement variables. It records classification, lifecycle, repository-value policy, safe default where one exists, and runtime logging policy. Public readers cannot independently reproduce the private-source comparison.

Secret and private values stay in environment-specific Catalyst configuration or Connections. GitHub stores variable names and rules only for:

- webhook and fingerprint secrets;
- previous-secret rotation expiry;
- exact routes, hosts, table names, source aliases, and Connection link names;
- Creator target and Billing source aliases or binding rules;
- OAuth identities and tokens; and
- deployment topology.

Runtime logs contain only a synthetic request ID, reviewed source revision, coarse stage, outcome class, and elapsed milliseconds. Configuration values, routes, hosts, event types, event keys, source event IDs, fingerprints, headers, signatures, bodies, tokens, response bodies, and platform identifiers are never logged.

## Manual Setup

No live setup was performed. Before any Catalyst Development deployment, an authorized operator must:

1. Create a dedicated Zoho Billing test organization. Give it a unique signing secret and private source alias so it cannot be confused with the live organization.
2. Create the Data Store table and exact `Var Char` columns in [`config/datastore-schema.json`](config/datastore-schema.json), including `IsMandatory`, `IsUnique`, `Max Length`, and the specified PII/ePHI validators; read the metadata back after creation.
3. Configure the Billing test-organization webhook as JSON with no query string and record a synthetic signed delivery privately.
4. Confirm the actual signature encoding and add a sanitized deterministic provider fixture test.
5. Verify the Catalyst SDK duplicate-conflict code and Data Store insert, update, and ZCQL response shapes under concurrent delivery; set only the confirmed code.
6. In Catalyst Development, prove an officially supported Creator authentication/invocation path. The current candidate must return only the OAuth `Authorization` header and no parameters through the exact pinned SDK; otherwise replace it. Also prove hosted provenance for `x-zc-environment`. Record the results privately and add sanitized contract tests.
7. Build and separately review the missing Creator Custom API at the exact endpoint copied from the intended Creator environment. Configure `POST`, `application/json`, Argument Type `Entire JSON`, exactly one String argument, OAuth2, and `Zohocreator.customapi.EXECUTE`. Give its function a separate least-privilege Billing connection with `ZohoSubscriptions.webhooks.READ` and a fixed private Billing organization binding. Implement event readback, ordering, idempotency, capacity handling, and the exact acknowledgment contract. Prove in Development and Stage that routing reaches the intended environment and that the Custom API's actual HTTP status and body serialization expose the direct JSON acknowledgment shape expected by this client, without an extra wrapper.
8. Set every required name from [`.env.example`](.env.example) in Catalyst Development without copying a populated file into source control.
9. Keep `DELIVERY_MODE=register-only` until Data Store behavior, conflict classification, freshness checks, response codes, and log redaction pass against the Billing test organization.
10. Test Creator Development, then a separately reviewed Creator Stage target from Catalyst Development. Lifting the hard-coded Production block requires a new reviewed source change after every external contract gate passes; an environment variable cannot bypass it.
11. Run duplicate, conflicting-duplicate, stale/future timestamp, crash-window, timeout, oversized-body, invalid-signature, secret-rotation, Connection-failure, out-of-order, and downstream-readback tests with synthetic data.
12. Record the immutable source commit and build artifact privately, test containment and rollback, and obtain separate approval for the exact Production artifact and live Billing source.

Production activation remains blocked both by these gates and by `loadConfig()`. GitHub merge is not deployment authorization.

## Containment And Rollback

If Development or a later approved deployment misbehaves:

1. Disable the affected Billing webhook or Catalyst route first so new events stop entering the uncertain path.
2. Disable or revoke the Creator Connection if outbound writes must stop independently.
3. Preserve the inbox rows and logs; do not delete or reset evidence and do not replay uncertain events automatically.
4. Use the stored restricted source event ID and a read-only Billing identity to reconcile each unresolved row against the exact organization and authoritative event.
5. Restore only the last separately approved immutable artifact if one exists. The historical export in `archive/` is blocked and is not a rollback candidate. If no approved artifact exists, keep the route disabled.
6. Independently read back the Billing webhook state, Catalyst function revision and route state, Connection state, inbox status, and Creator outcome before declaring containment complete.
7. Re-enable only after a synthetic test-organization event passes the full signature, claim, readback, and duplicate sequence.

## Local Validation

From this package directory with Node.js 24:

```powershell
npm ci --ignore-scripts
npm run ci
```

The dependency is exact-version pinned and the lockfile is committed. `node_modules/`, populated environment files, deployment identifiers, payloads, and logs are excluded.

## Official References

- [Zoho Billing webhook security](https://www.zoho.com/us/billing/kb/webhooks/securing-webhooks.html)
- [Zoho Billing webhook automation and limits](https://www.zoho.com/us/billing/help/settings/automation.html)
- [Zoho Billing events and event readback](https://www.zoho.com/billing/api/v1/events/)
- [Zoho Billing test organizations](https://www.zoho.com/us/billing/kb/general/creating-test-organization.html)
- [Zoho Billing webhook resend](https://www.zoho.com/us/billing/kb/webhooks/resend-webhook.html)
- [Catalyst Advanced I/O functions](https://docs.catalyst.zoho.com/en/serverless/help/functions/advanced-io/)
- [Catalyst runtime support](https://docs.catalyst.zoho.com/en/serverless/help/functions/runtime-support/)
- [Catalyst Data Store columns](https://docs.catalyst.zoho.com/en/cloud-scale/help/data-store/columns/)
- [Catalyst Connections credentials](https://docs.catalyst.zoho.com/en/sdk/nodejs/v2/cloud-scale/connections/get-credentials/)
- [Catalyst Connections service types](https://docs.catalyst.zoho.com/en/cloud-scale/help/connections/introduction/)
- [Catalyst custom Connections](https://docs.catalyst.zoho.com/en/cloud-scale/help/connections/establish-custom-connection/)
- [Creator Custom API setup and scope](https://help.zoho.com/portal/en/kb/creator/developer-guide/microservices/custom-api/articles/create-and-manage-custom-apis)
- [Creator environments](https://help.zoho.com/portal/en/kb/creator/developer-guide/environments/articles/understand-environments)
- [Creator API limits](https://www.zoho.com/creator/help/api/v2.1/api-limits.html)
