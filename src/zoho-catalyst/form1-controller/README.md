# Zoho Forms Form 1 Assisted Intake Controller

This isolated Node.js 24 Advanced I/O function supports the CRM record-details button **Start Free-Test Request** without changing Form 2. It is Development-only and exposes exactly two JSON `POST` routes:

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

1. Create the dedicated Development function and upload only a clean reviewed artifact whose `lib/source-revision.js` sentinel is stamped with the matching Git commit.
2. Configure the variables in `config/variables.json`. Keep all private values in Catalyst.
3. Authorize two separate Catalyst CRM Connections with the exact scopes above.
4. Create two private API Gateway paths targeting this function, with throttling and independent shared-header authentication. No CORS is required.
5. Add one hidden or locked Zoho Forms Prefill-Webhook field with the configured alias. POST `{"token":"<field value>"}` to the prefill route, send the prefill shared header, and map only `lib/form-contract.js` outputs.
6. Create a CRM Button-category Deluge function that receives the Lead ID plus runtime-held issue URL and secret, POSTs `{"leadId":"..."}`, validates the 201 JSON response and exact Form host/path, then calls `openUrl(..., "new window")`.
7. Associate it with a Leads **View page** button named **Start Free-Test Request**, initially restricted to the Administrator profile.
8. Run a clearly synthetic canary: issue link, verify prefill, submit Form 1, prove the same Lead was updated and no duplicate Lead was created. Do not create a Bookings appointment.

## Verification

Run from `functions/form1_assisted_controller`:

```text
node --check index.js
for each lib/*.js: node --check
node --test test/*.test.js
```

The tests cover Development/source binding, credential separation, destination allowlists, opaque-token handling, fresh intake rotation, prefill-before-read reservation, stale binding rejection, exact request contracts, live table columns, bounded concurrent reservations, and separate CRM read/write credentials.

When Catalyst's console rejects a valid multi-file ZIP, `tools/build-single-file.js` can produce a deterministic editor-safe `index.js` from the same reviewed modules. It stamps the exact reviewed commit, keeps Node built-ins and the Catalyst SDK as native imports, and fails if the source-revision sentinel is missing or remains unstamped.
