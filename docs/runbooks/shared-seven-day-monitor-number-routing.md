# Shared Seven-Day Monitor Number-Routing Runbook

## Status

- Runbook status: **Proposed**
- Governing decision: [ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md)
- Live implementation status: **Unknown and not established by this file**
- Production authorization: **Not granted**

This runbook supersedes the shared-agent prohibition, client-agent mapping assumption, and agent-first client-resolution language in the earlier [Retell, Catalyst, CRM, And Analytics Reporting Runbook](retell-catalyst-analytics-reporting.md). The reporting, privacy, reconciliation, and Analytics controls in that runbook remain applicable where they do not conflict with ADR 0006.

## Objective

Prove the smallest architecture that supports the free-test acquisition workflow without cloning the low-capability monitor for every client:

```text
One shared Seven-Day Monitor agent
One dedicated Retell number per active test client
One shared Catalyst inbound resolver endpoint
One client deployment per dedicated number
One shared post-call event and reporting path
One dedicated Revenue Desk agent per converted client
```

Do not purchase or activate a client number, modify forwarding, expose a webhook, or route a real call without separate approval for the exact target and rollback plan.

## Source-Of-Truth Rules

| Fact | Authoritative system |
|---|---|
| Public business number and forwarding state | Client carrier or phone system |
| Dedicated forwarding destination and bound agent/version | Retell phone-number configuration |
| Client, engagement, authorization, and report recipients | Zoho CRM |
| Number-to-deployment mapping, resolver state, call ownership, and reporting state | Zoho Catalyst |
| Derived report tables and client outputs | Zoho Analytics |
| Appointment, job, completion, invoice, and payment truth | Customer operating system |

The shared monitor `agent_id` identifies the monitor product, not the client.

## Required Retell Objects

### Shared Monitor Agent

Create or maintain one approved agent:

```text
Sylvara Plumbing — Seven-Day Call-Gap Monitor
```

Required baseline:

- one published version selected for the approved environment;
- generic disclosure and minimal call-gap capture behavior;
- no client-specific persistent company data;
- no booking, dispatch, quote, payment, outbound messaging, or client operating-system tools;
- no client-specific transfer or fallback destination;
- approved post-call analysis fields only;
- bounded webhook-event set; and
- tested prior version for rollback.

### Revenue Desk Master

Create or maintain one non-routed master:

```text
Sylvara Plumbing — Revenue Desk — Master
```

It is cloned only after a client converts and the paid scope is approved. The master never receives client traffic.

### Client Retell Number

For each active test client, purchase or import one dedicated Retell number.

Configure:

- a private nickname that identifies the client deployment without exposing sensitive data;
- the shared monitor as the default inbound agent and approved version or environment tag;
- the shared inbound resolver URL;
- no outbound agent unless a separately approved workflow requires one; and
- the minimum permitted number-level settings.

The client's public business number forwards the approved call gap to this dedicated Retell number. Do not advertise the Retell number as the client's public main number.

## Catalyst Deployment Record

Create one active deployment for each dedicated Retell number.

Minimum private fields:

```text
client_id
deployment_id
crm_relationship_reference
retell_to_number
monitor_agent_id
monitor_agent_version_ref
engagement_type
capability_profile
coverage_mode
configuration_version
test_start_at
test_end_at
handled_call_limit
status
resolver_policy
created_at
updated_at
```

Required constraints:

- `retell_to_number` is unique among active deployments;
- one active deployment per client test;
- one client per deployment;
- the shared `monitor_agent_id` may appear on multiple deployments;
- test start, end, status, and limit are explicit; and
- mutable company names are not keys.

## Inbound Resolver Contract

Use one exact endpoint for every approved client number:

```text
POST /retell/inbound
```

### Input

Accept only the documented Retell inbound-call event and the required fields:

```text
event = call_inbound
call_inbound.to_number
call_inbound.from_number
call_inbound.agent_id when supplied
call_inbound.agent_version when supplied
```

Use `from_number` only under the approved privacy and caller-handling rules. It must not determine the contractor client.

### Processing Order

1. Reject the wrong method, route, media type, event type, or oversized body.
2. Verify the inbound webhook under the approved Retell verification contract.
3. Normalize `to_number` without logging it in ordinary application logs.
4. Resolve exactly one active deployment by `to_number`.
5. Verify environment, test status, date window, call limit, and capability profile.
6. Select the approved shared monitor agent and pinned version or environment tag.
7. Return only allowlisted metadata and string dynamic variables.
8. Persist a minimized resolver result or counter without raw request content.
9. Return within Retell's inbound-webhook timeout.

### Response

Proposed response shape:

```json
{
  "call_inbound": {
    "override_agent_id": "<shared-monitor-agent-id>",
    "override_agent_version": 0,
    "metadata": {
      "client_id": "<opaque-client-id>",
      "deployment_id": "<opaque-deployment-id>",
      "configuration_version": "<version>",
      "engagement_type": "free_test",
      "capability_profile": "call_gap_monitor_v1",
      "resolver_status": "resolved"
    },
    "dynamic_variables": {
      "company_name": "<approved-label>",
      "coverage_mode": "<approved-mode>",
      "timezone": "<iana-timezone>",
      "approved_disclosure_text": "<approved-text>"
    }
  }
}
```

The values above are placeholders. Live identifiers and client configuration remain private.

### Failure Behavior

Fail closed on:

- no deployment match;
- multiple active deployment matches;
- inactive, expired, not-yet-started, or exhausted test;
- conflicting environment or capability profile;
- malformed or unsupported input; or
- unavailable required configuration.

When Retell falls back to the number's default shared monitor because the resolver fails, the monitor must use only its neutral baseline. The post-call event is marked `resolver_status = degraded` or equivalent and sent to review. No prior client's dynamic variables may be cached or reused.

## Post-Call Event Resolution

Use the shared account-level post-call webhook unless an approved exception requires an agent-level route.

Resolve each call in this order:

1. validated `metadata.deployment_id`;
2. existing immutable call-to-deployment binding;
3. unique `to_number` deployment mapping;
4. `agent_id` only when it resolves to exactly one active deployment.

For the shared monitor, `agent_id` is not a client key. Multiple deployments for that agent are expected.

Persist one normalized call record per:

```text
client_id + deployment_id + call_id
```

Quarantine zero-match, multiple-match, conflicting-identity, stale-window, and unauthorized events. Never select the first matching deployment.

## Reporting Partition

Every call fact sent to Analytics must include:

```text
Client ID
Deployment ID
Call ID
Retell To Number Hash Or Private Reference
Monitor Agent Version
Resolver Status
Test Window
Coverage Mode
Outcome
QA Status
Reporting Watermark
```

Do not send the raw Retell number, caller number, transcript, recording, address, or client secrets into Analytics unless a separately approved data contract explicitly requires the field.

Before sending a client report, prove:

- exactly one distinct Client ID;
- exactly one approved Deployment ID;
- call counts match Catalyst;
- the test window and watermark are current;
- no unresolved resolver or reporting job remains;
- degraded resolver calls are identified and manually reviewed; and
- the CRM recipient set is current and approved.

## Two-Client Development Test

Use synthetic client records and two dedicated Development Retell numbers.

### Test Matrix

| Test | Expected result |
|---|---|
| Call Number A | Shared monitor receives Client A metadata only |
| Call Number B | Shared monitor receives Client B metadata only |
| Repeat A and B concurrently | No variable, deployment, or report crossover |
| Resolver receives unknown number | Fail closed |
| Duplicate active mapping for Number A | Fail closed and alert |
| Resolver timeout for Number A | Neutral monitor fallback; degraded status; Client A resolved post-call by `to_number` |
| Stale or expired Client B deployment | Fail closed or approved neutral fallback; no active report inclusion |
| Post-call event lacks metadata | Resolve by unique `to_number` |
| Post-call event has conflicting metadata and `to_number` | Quarantine |
| Rebind Number A to Revenue Desk clone | Client forwarding destination remains unchanged; correct dedicated agent receives calls |
| Roll back Number A | Prior shared monitor binding is restored and read back |

### Acceptance

Proceed only when:

- both numbers point to the same accepted monitor version;
- every call resolves to exactly one deployment;
- resolver and post-call logs contain no secret or caller content;
- no cross-client data appears in Catalyst or Analytics;
- the neutral fallback contains no client-specific behavior;
- the report for each client contains only that client;
- number reassignment to a Revenue Desk clone succeeds; and
- rollback restores the prior route.

If acceptance fails, disable the affected route and use one monitor clone per client until the shared design passes completely.

## Client Onboarding Sequence

1. Qualify and authorize the free test in CRM.
2. Create the Catalyst deployment in a disabled or setup state.
3. Purchase or import one dedicated Retell number.
4. Bind the accepted shared monitor version as the default inbound agent.
5. Point the number to the shared inbound resolver endpoint.
6. Add the unique number-to-deployment mapping.
7. Configure the client's phone system for the approved after-hours or no-answer/overflow forwarding path.
8. Run synthetic and controlled test calls.
9. Read back the Retell number, bound agent/version, webhook, Catalyst deployment, and call ownership.
10. Activate the bounded test window only after the exact route receives approval.
11. Monitor resolver, call, reporting, and call-limit state during the test.
12. Close the test and freeze the reconciled report.

## Conversion Sequence

1. Keep the client's dedicated Retell number.
2. Clone the Revenue Desk master into a client-specific agent.
3. Apply the signed paid scope and approved client configuration.
4. Publish and pin the accepted Revenue Desk version.
5. Test tools, routing, fallback, integrations, and rollback separately.
6. Disable the free-test deployment or change its status to completed.
7. Rebind the existing client Retell number to the accepted Revenue Desk agent.
8. Update the inbound resolver to return the paid deployment identity and approved context where still required.
9. Run controlled calls and independent readback.
10. Activate only after separate live approval.

The monitor agent is not promoted into the Revenue Desk. The client's number is the retained routing asset.

## Containment And Rollback

If client identity, variables, routing, or reporting are uncertain:

1. Disable the affected client's forwarding or Retell inbound route.
2. Disable the deployment in Catalyst.
3. Preserve event and mapping evidence; do not delete or replay blindly.
4. Confirm whether any other client used the same number or received the same metadata.
5. Reconcile affected calls by `to_number`, timestamps, and provider call identifiers.
6. Restore the prior bound agent/version or prior carrier route.
7. Verify no report was delivered with mixed-client data.
8. Re-enable only after the complete two-client isolation suite passes.

A defect affecting the shared monitor or resolver can affect multiple clients. Containment must support disabling one number, one deployment, or the shared endpoint independently.

## Deferred Work

Do not add:

- client self-service number or agent administration;
- a generalized tenant-provisioning platform;
- client access to shared Retell history;
- arbitrary prompt or tool overrides through the inbound webhook;
- shared Revenue Desk agents across clients;
- a client portal; or
- automatic Production activation.

Automate number provisioning and mapping only after the manual two-client process is repeatable and paid demand justifies it.

## Official References

- [Retell inbound-call webhook](https://docs.retellai.com/features/inbound-call-webhook)
- [Retell receive inbound calls](https://docs.retellai.com/deploy/inbound-call)
- [Retell purchase phone number](https://docs.retellai.com/deploy/purchase-number)
- [Retell update phone number](https://docs.retellai.com/api-references/update-phone-number)
- [Retell dynamic variables](https://docs.retellai.com/build/dynamic-variables)
- [Retell agent versioning and environment tags](https://docs.retellai.com/agent/version)
- [Retell call-event webhook overview](https://docs.retellai.com/features/webhook-overview)
