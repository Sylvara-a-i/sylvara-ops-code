'use strict';

const { projectRawUsageEvidence } = require(
  '../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/raw-usage-evidence',
);
const { reconcileBillingLink } = require(
  '../../crm-billing-orchestrator/functions/crm_billing_orchestrator/lib/billing-link-reconciliation',
);

const unique = (values) => Object.freeze([...new Set(values)].sort());

/** Offline composition of normalized snapshots, never a provider synchronization.
 * A dated call always requires an explicit effective mapping. Current CRM fields
 * cannot establish historical ownership, even when they match today's Billing.
 */
function reconcileRawUsageWithBilling({ scope, rows, complete = false,
  billingSnapshot, effectiveMapping } = {}) {
  const raw = projectRawUsageEvidence({ scope, rows, complete });
  const calls = raw.calls.map((call) => {
    // A partial or conflicting raw read must not produce an apparently linked
    // batch by silently dropping the missing/foreign evidence.
    const rawHolds = unique([...raw.holds, ...call.holds]);
    const relationship = rawHolds.length ? null : reconcileBillingLink({
      scope, snapshot: billingSnapshot,
      attribution: { kind: 'historical', startedAt: call.startedAt, endedAt: call.endedAt,
        mapping: effectiveMapping },
    });
    return Object.freeze({ ...call,
      // Unit conversion only; durationMs remains the authoritative raw value.
      rawDurationSeconds: call.durationMs === null ? null : call.durationMs / 1000,
      billingLinkStatus: relationship?.status ?? 'not_checked',
      billingLink: relationship?.link ?? null,
      holds: unique([...rawHolds, ...(relationship?.holds ?? [])]),
    });
  });
  const holds = unique([...raw.holds, ...calls.flatMap((call) => call.holds)]);
  return Object.freeze({ schemaVersion: 1,
    evidenceStatus: holds.length ? 'held' : calls.length ? 'linked' : 'empty',
    calls: Object.freeze(calls), holds, completeness: raw.completeness,
    synchronizationAttempted: false,
    billableMinutes: null, chargeMinor: null, billingAuthority: false,
  });
}

module.exports = { reconcileRawUsageWithBilling };
