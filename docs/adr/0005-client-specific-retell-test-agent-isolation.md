# ADR 0005: Client-Specific Retell Agent Isolation For Live Seven-Day Tests

- Status: **Superseded**
- Date: 2026-08-18
- Superseded by: [ADR 0006](0006-shared-seven-day-monitor-with-client-number-isolation.md)
- Deployment status: Documentation only; this decision did not change any live Retell, Catalyst, CRM, Analytics, phone-number, forwarding, or customer configuration

## Original Decision

This decision required one cloned Seven-Day Monitor agent per client and preferred promoting that same client-specific agent into paid service through later versions.

The decision was made to prevent ambiguous routing while the architecture was described primarily around Retell `agent_id` as the available client key.

## Reason For Supersession

The later review separated three objects that had been conflated:

1. the shared low-capability Seven-Day Call-Gap Monitor;
2. the dedicated Retell number and Catalyst deployment that identify each test client; and
3. the separate client-specific Revenue Desk agent created after conversion.

Retell's inbound-call webhook always provides the called `to_number` and can inject call-specific metadata and dynamic variables before connection. With one unique Retell number per active client, one shared inbound resolver can map each call to exactly one deployment while multiple numbers use the same monitor agent.

The current decision therefore shares the monitor agent but never the client Retell number. It also keeps the monitor and Revenue Desk as separate agents because their purposes, permissions, integrations, risk, and rollback behavior differ.

## Historical Value

The controls from this superseded decision remain relevant where they do not conflict with ADR 0006:

- no client identity may be inferred from mutable display labels or caller statements;
- zero-match, multiple-match, conflicting, and stale routing must fail closed;
- environment tags are release controls rather than customer-tenancy boundaries;
- reports must contain one client only;
- prior versions and routes require tested rollback; and
- no repository decision authorizes a live call path.

Do not implement the client-specific monitor-clone or monitor-to-Revenue-Desk promotion model from this ADR. Follow [ADR 0006](0006-shared-seven-day-monitor-with-client-number-isolation.md).
