# Zoho Forms Form 1 Assisted Intake Controller

This isolated Node.js 24 Advanced I/O function supports the CRM record-details button **Start Free-Test Request** without changing Form 2. It is Development-only and exposes exactly two JSON `POST` routes:

**Development status, 2026-08-23:** The Form 1 table has been provisioned in the existing Retell Catalyst Development project and its initial copy was independently read back. Both Form 1 CRM Connections were read back in the Retell Development console as Connected with the exact approved scopes; their private link names remain outside Git, and CRM-organization binding and runtime behavior are still unverified. The legacy Form 1 project remains live. The Retell-target function, routes, variables, CRM button, and Forms Prefill Webhook have not been cut over or runtime-tested. Production remains code-blocked.

1. **Issue** accepts one Lead ID from the CRM button, reads that Lead, creates a fresh intake identity and a 256-bit opaque token, stores only the token HMAC, updates and reads back `Intake_Submission_ID`, then returns the existing Form 1 permalink with the token field alias.
2. **Prefill** receives the token from Zoho Forms' server-side Prefill Webhook, validates expiry and bounded disclosure state, reads the bound Lead, proves the Lead still has the session intake identity, and returns only the allowlisted Form 1 values.

Form 1's existing native CRM integration remains the only submission writer. Its current upsert order is `Intake Submission ID` first and `Contact Email` second, with blank overwrite disabled. There is no Catalyst submission route.

## Security contract

- Production is blocked in source, and an unstamped or source-revision-mismatched artifact fails configuration.
- Every new issue rotates the Lead intake identity, which invalidates older still-unexpired tokens.
- The URL contains no Lead ID or PII. Raw tokens, request bodies, CRM responses, headers, and secrets are never logged or stored.
- API Gateway route secrets are independent, verified before parsing business input, and kept out of source.
- The read Connection has only `ZohoCRM.modules.leads.READ`; the write Connection has only `ZohoCRM.modules.leads.UPDATE`.
- A unique Data Store reservation is acquired before each CRM prefill read, preventing concurrent requests from bypassing the configured disclosure ceiling.
- Consent fields, consent timestamps, and `Free_Test_Request_Notes` are excluded from prefill.
- Only the exact US Zoho CRM V8 and Zoho Forms public hosts are accepted.

## Prefill allowlist

The current allowlist is: first and last name, company, decision-maker role, exact job title, contact email, mobile phone, company phone, the existing CRM Lead Source, current call handling, requested test route, phone-system provider, primary service area, field-team-size band, the fresh intake identity, and the assisted-mode provenance values held only in Catalyst Development configuration. The original Lead Source is preserved; assisted intake is attributed separately through Submission Channel and Source Page.

## Development setup

1. Confirm the exact existing Retell Catalyst project and Development environment, inventory its current functions, routes, tables, Connections, and variables, and independently re-read the copied Form 1 table before deployment. Keep the legacy project live and Production untouched.
2. Create or update only `form1_assisted_controller`. Upload only a clean reviewed artifact whose `lib/source-revision.js` sentinel is stamped with the matching Git commit; do not add Form 2 or any Retell function to this package's `catalyst.json` target list.
3. Configure the variables in `config/variables.json` on this function. Keep all private values in Catalyst and bind `SESSION_TABLE_NAME` only to the distinct copied Form 1 table.
4. **Connection-console check completed on 2026-08-23:** both Form 1-specific Catalyst CRM Connections are Connected with the exact scopes above. Re-read their private link names and grants, then prove the intended CRM organization through a harmless authenticated read before binding the function variables. Do not reuse the Form 2 or Retell call-processing Connections.
5. Create two unique private API Gateway paths targeting only this function, with throttling and independent shared-header authentication. Preserve every existing Retell route and do not enable or reconfigure API Gateway until its project-wide effect is understood. No CORS is required.
6. Add one hidden or locked Zoho Forms Prefill-Webhook field with the configured alias. POST `{"token":"<field value>"}` to the prefill route, send the prefill shared header, and map only `lib/form-contract.js` outputs.
7. Create a CRM Button-category Deluge function that receives the Lead ID plus runtime-held issue URL and secret, POSTs `{"leadId":"..."}`, validates the 201 JSON response and exact Form host/path, then calls `openUrl(..., "new window")`.
8. Associate it with a Leads **View page** button named **Start Free-Test Request**, initially restricted to the Administrator profile.
9. Run a clearly synthetic canary: issue link, verify prefill, submit Form 1, prove the same Lead was updated and no duplicate Lead was created. Do not create a Bookings appointment. Cut over callers only after function, route, Connection, table, variable, source-revision, and downstream readback all pass; legacy cleanup is a separate destructive action.

## Verification

Run from `functions/form1_assisted_controller` with Node.js 24:

```text
npm ci --ignore-scripts
npm run ci
```

The tests cover Development/source binding, credential separation, destination allowlists, opaque-token handling, fresh intake rotation, prefill-before-read reservation, stale binding rejection, exact request contracts, live table columns, bounded concurrent reservations, and separate CRM read/write credentials.

When Catalyst's console rejects a valid multi-file ZIP, `tools/build-single-file.js` can produce a deterministic editor-safe `index.js` from the same reviewed modules. It stamps the exact reviewed commit, keeps Node built-ins and the Catalyst SDK as native imports, and fails if the source-revision sentinel is missing or remains unstamped.
