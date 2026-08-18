# Retell–Catalyst Voice Contract

## Status

- Classification: **Public sanitized product and integration contract**
- Decision state: **Accepted for Development validation**
- Live customer deployment: **Not established by this document**
- Production approval: **Not granted**
- Governing product boundary: [Managed Residential Plumbing Receptionist Product Direction](README.md)
- Governing voice and data controls: [AI Receptionist Legal And Compliance Control Archive](../legal-compliance/README.md)
- Governing middleware controls: [Zoho Catalyst Standard](../zoho/standards/catalyst.md)

## Decision

The initial free-test profile is a bounded inbound call-intake workflow for calls intentionally forwarded through an approved after-hours or no-answer/overflow route. It is not silent call monitoring, primary reception, or the future full-production service.

The voice runtime may disclose automation and recording, collect approved intake facts, classify urgency, attempt a configured urgent transfer, and otherwise record a callback request. It must not book appointments, dispatch technicians, promise timing or price, collect payment, send outbound follow-up, write directly to a client operating system, or expand itself into primary reception.

A future production profile must be forked from a validated pinned free-test version only after the exact commercial scope, integration contract, fallback, and acceptance gates are approved. Do not prebuild speculative production capabilities.

## Ownership Boundaries

| Layer | Authoritative For | Must Not Own |
| --- | --- | --- |
| Retell voice runtime | Real-time conversation execution, provider call identifiers, provider agent and version references, provider lifecycle events, and provider post-call analysis | Customer configuration authority, deployment entitlement, downstream job truth, CRM relationship truth, accounting, or legal approval |
| Zoho Catalyst | Webhook verification, replay protection, durable event receipt, normalization, canonical call ledger, deployment status and profile, bounded engagement limits, retry state, metric derivation, and restricted artifact references | Customer relationship ownership, job completion, appointment truth, invoice or collected-revenue truth, or raw secret storage in source control |
| Zoho CRM | Client account, contact, opportunity, approved engagement state, and high-signal relationship records | Raw webhook payloads, recordings, full transcripts, or the high-volume call ledger |
| Customer operating system | Approved services, service area, scheduling or dispatch state, jobs, work orders, and completed outcomes within the customer contract | Voice behavior, Sylvara subscription state, or Catalyst receipt state |

An answered call is not a booked job or collected revenue. Outcome attribution must reconcile the call ledger with the system that owns the downstream business fact.

## Early Deployment Topology

For the first controlled deployments:

1. Maintain one private reusable free-test master.
2. Create a client-specific clone from a pinned approved master version.
3. Do not route live calls directly to the master.
4. Store the client-specific provider agent identifier, pinned version reference, capability profile, deployment status, coverage mode, and immutable configuration version in Catalyst.
5. Preserve the prior working phone route or another tested fallback.

A shared multi-client agent with a real-time inbound configuration resolver is deferred. It adds a new dependency in the critical call path and should be built only after repeated paid demand proves that the simpler pinned-clone model creates unacceptable operating cost.

## Capability Profiles

### `plumbing_free_test_v1`

Allowed:

- approved inbound after-hours or no-answer/overflow calls;
- automation and recording disclosure according to the approved configuration;
- caller, callback, service-location, requested-service, issue, and urgency intake;
- supported-service and service-area classification;
- one configured urgent warm-transfer path with bounded failure handling;
- structured callback or human-review outcome; and
- provider post-call analysis and Catalyst event delivery.

Excluded:

- appointment booking or calendar writes;
- technician dispatch or arrival commitments;
- price, quote, warranty, or payment commitments;
- payment-card, bank, credential, government-identifier, or health-data collection;
- outbound voice, SMS, or email follow-up;
- direct CRM or field-service writes from the live conversation;
- unrestricted human answering; and
- primary-reception coverage.

### Future `plumbing_production_v1`

This profile does not yet exist as an approved production contract. It may add only capabilities supported by a signed scope, authoritative-system contract, idempotency, independent readback, fallback, rollback, legal review, and observed acceptance evidence.

## Canonical Dynamic Variables

All Retell dynamic-variable values must be strings. Empty values remain explicit empty strings. Missing or malformed required configuration must fail closed.

### Deployment Identity

- `deployment_id`
- `client_id`
- `engagement_type`
- `capability_profile`
- `configuration_version`
- `coverage_mode`
- `deployment_mode`

### Client Runtime Configuration

- `company_name`
- `company_description`
- `approved_disclosure_text`
- `timezone`
- `business_hours`
- `service_area_cities`
- `service_area_zips`
- `services_included`
- `services_excluded`
- `approved_urgent_conditions`
- `urgent_transfer_number`
- `fallback_number`
- `main_business_number`
- `callback_expectation`
- `configuration_ready`

`configuration_ready` defaults to the string `false`. The runtime must not transfer or perform any configuration-dependent action unless the validated value is the string `true` and all required target fields are present and well formed.

### Temporary Migration Aliases

- `client_configuration_version` maps to `configuration_version`.
- `test_route_type` maps to `coverage_mode`.

Keep aliases for one migration cycle only. Remove them after the deployed processor and signed end-to-end acceptance evidence prove that the canonical names are authoritative.

## Provider Event Contract

The minimum event set is:

- `call_started`;
- `call_ended`;
- `call_analyzed`;
- `transfer_started`;
- `transfer_bridged`;
- `transfer_cancelled`; and
- `transfer_ended`.

Do not enable transcript-stream events by default. The receiver must authenticate the request, enforce a timestamp tolerance, reject unsupported methods, content types, event names, and oversized bodies, derive a stable idempotency key, persist a minimal receipt, and enqueue retry-safe processing. Unknown or conflicting duplicates fail closed.

## Canonical Call Mapping

| Retell Source | Catalyst Canonical Field | Rule |
| --- | --- | --- |
| Provider call identifier | `ProviderCallId` and provider-neutral `CallId` | Preserve the exact provider identifier and derive a stable provider-neutral identifier |
| Provider agent identifier | `ProviderAgentId` | Direct |
| Provider agent version | `ProviderAgentVersionRef` | Preserve the exact pinned version or version tag |
| `deployment_id` | `DeploymentId` | Required |
| `client_id` | `ClientId` | Required |
| `configuration_version` | `ConfigurationVersion` | Required |
| `caller_name` | `CallerName` | Encrypted |
| Provider caller number | `CallerPhone` and `CallerPhoneHash` | Transport caller ID; may differ from the confirmed callback number |
| `callback_number` | `ConfirmedCallbackPhone` and `ConfirmedCallbackPhoneHash` | Encrypted normalized value plus one-way lookup hash |
| `service_city` | `ServiceCity` | Encrypted |
| `service_zip` | `ServiceZip` | Encrypted |
| `service_address_if_collected` | `ServiceAddress` | Encrypted and optional |
| `preferred_callback_window` | `PreferredCallbackWindow` | Preserve as encrypted text unless an exact normalized time was actually supplied |
| `call_intent` | `CallIntent` | Normalized enum |
| `requested_service` | `RequestedService` | Direct normalized text |
| `service_category` | `ServiceCategory` | Normalized enum |
| `urgency_level` | `Urgency` | Normalized enum |
| `customer_status` | `ExistingCustomer` | Existing = Yes; New = No; Representative or uncertain = Unknown |
| `service_area_status` | `ServiceAreaEligible` | In area = Yes; out of area = No; otherwise Unknown |
| `qualified_opportunity` | `QualifiedOpportunity` | Yes, No, or Unknown |
| `callback_required` | `CallbackRequired` | Boolean normalized to Yes or No |
| `transfer_attempted` | `HumanEscalation` | Boolean normalized to Yes or No |
| `transfer_result` | `TransferResult` | Normalized enum |
| `primary_outcome` | `RevenueDeskOutcome` | Direct normalized outcome |
| `call_summary` | `CallSummary` | Encrypted concise summary |
| `workflow_succeeded` | `WorkflowSucceeded` | Direct boolean |
| Provider timestamps plus configured hours | `AfterHours` | Derive deterministically in Catalyst, not from model analysis |
| Provider cost object | `ProviderCostUSD` | Sum only documented provider cost components |
| Provider disconnect reason | `DisconnectReason` | Normalize without inventing a reason |

Full transcripts and recordings do not belong in the canonical call row. Store only approved restricted artifact references, lifecycle state, redaction state, consent state, integrity hashes, and retention expiry in the artifact layer.

## Acceptance Gates

Before setting an agent-level webhook, publishing a pinned provider version, or assigning any non-synthetic phone route, Development acceptance must prove:

1. a valid signed event is accepted and an invalid, missing, stale, and replayed signature is rejected;
2. `call_ended` and `call_analyzed` events reconcile into one canonical call row;
3. exact replays do not create duplicates and conflicting duplicates fail closed;
4. the asynchronous processor runs, retries safely, and records a bounded failure state;
5. transfer events remain correct when delivered late, duplicated, or out of order;
6. the canonical fields above are populated, encrypted, hashed, or omitted as specified;
7. no raw webhook body, signature, secret, full transcript, or recording is written to ordinary logs or the canonical call table;
8. deployment status and engagement limits stop further handling through a deterministic routing control rather than prompt language alone;
9. the previous phone route or fallback can be restored; and
10. independent readback confirms the final provider, Catalyst, and downstream state.

Production promotion, a live client route, primary reception, booking, dispatch, outbound messaging, or a client-system write requires separate exact approval.

## Repository Boundary

GitHub may contain this contract, sanitized schemas, validation code, and synthetic fixtures. It must not contain private agent exports, complete runtime prompts, live agent or project identifiers, private routes, webhook URLs, client configuration, call content, recordings, transcripts, credentials, populated environment files, or production evidence that would materially enable abuse.
