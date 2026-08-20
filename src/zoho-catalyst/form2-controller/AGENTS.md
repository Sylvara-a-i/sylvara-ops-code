# Form 2 Controller Instructions

These rules apply to this proposed Zoho Forms Form 2 controller.

- Production remains code-blocked. A merge, pipeline build, or Development test does not authorize Production.
- Never place CRM record IDs, contact data, or business data in the Form URL. Treat the opaque setup token as a bearer credential and never log it.
- Verify the exact route, JSON content type, and route-specific shared header before parsing business fields. Bound every inbound and outbound body and operation.
- Store only token/submission HMACs and minimum restricted record context. Raw tokens, Forms bodies, CRM responses, headers, and PII must not be stored or logged.
- Bind every submission to one unique prefill revision and its three CRM `Modified_Time` values. A stale or reused revision must fail closed.
- Claim the immutable Forms submission identity with a unique Data Store key before CRM mutation. Unknown duplicate or timeout outcomes require reconciliation.
- Apply Contact, Account, and Deal changes as one ordered CRM Composite request with rollback on failure. Put Deal last so its workflow observes complete related state.
- Lock Business Email. Reject Mobile changes until an independently approved reverification flow exists. Preserve original request, approved route, duration, call-limit, and scope-version fields.
- Require independent CRM readback before acknowledging success. Never retry an ambiguous mutation without resolving current CRM and receipt state first.
- Use synthetic fixtures only. Run `npm run ci`, then the repository verifier before handoff.
