# Form 2 Controller Instructions

These rules apply to this proposed Zoho Forms Form 2 controller.

- Production remains code-blocked. A merge, pipeline build, or Development test does not authorize Production.
- Form 1 and Form 2 target the existing Retell Catalyst project in Development, but they remain separate functions with separate routes, tables, Connections, variables, artifacts, and rollback paths. Deploy only `form2_controller`; never use an unscoped command that can change another Retell-project resource.
- The Retell Development table copies have initial readback evidence. The two Form 2 CRM Connections were read back as Connected with the exact approved scopes on 2026-08-23, but their CRM-organization binding and runtime behavior remain unverified. The legacy Form 2 project remains live, and the function, routes, variables, pipeline, and Forms callers have not been cut over. Do not delete or disable the legacy path without separately approved acceptance and rollback evidence.
- Keep every Retell-target Form 2 route disabled until the Catalyst email-OTP proof path, additive version-3 stores, and all six routes have independent Development readback. CAPTCHA may be optional bot mitigation but is not identity proof. Native Forms UI configuration alone is not server proof. SMS is outside the approved workflow and must not be configured.
- Never place CRM record IDs, contact data, or business data in the Form URL. Treat the opaque setup token as a bearer credential and never log it.
- Verify the exact route, JSON content type, and route-specific shared header before parsing business fields. Bound every inbound and outbound body and operation.
- Store only token/submission HMACs and minimum restricted record context. Raw tokens, Forms bodies, CRM responses, headers, and PII must not be stored or logged.
- Bind every submission to one unique prefill revision and its three CRM `Modified_Time` values. A stale or reused revision must fail closed.
- Claim the immutable Forms submission identity with a unique Data Store key before CRM mutation. Unknown duplicate or timeout outcomes require reconciliation.
- Apply Contact, Account, and Deal changes as one ordered CRM Composite request with rollback on failure. Put Deal last so its workflow observes complete related state.
- Lock Business Email. Reject Mobile changes until an independently approved reverification flow exists. Preserve original request, approved route, duration, call-limit, and scope-version fields.
- Do not send Form 2 to Zoho Sign. Treat `Authorized_Representative_Confirmed` and `Authority_Confirmed_At` only as the approved checkbox attestation for Form 2. They do not authorize phone routing or go-live; that requires the separate explicit CRM go-live approval.
- Require independent CRM readback before acknowledging success. Never retry an ambiguous mutation without resolving current CRM and receipt state first.
- Use synthetic fixtures only. Run `npm run ci`, then the repository verifier before handoff.
