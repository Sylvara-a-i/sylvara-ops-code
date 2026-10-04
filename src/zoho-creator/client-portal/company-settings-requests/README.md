# Service-area change-request planner

Status: proposed source-only contract, synthetic validation. This is not a functional deployed portal. No endpoint, database writer, permissions, deployment, live call or tenant data is included. Creator may own the pending human request; CRM remains authoritative for the company relationship and current service area. Planning never changes CRM or Creator.

`preparePendingServiceAreaRequest(input, verifiedContext)` accepts exactly `Account` and `Requested_Service_Area` in a plain data object. `Account` is an untrusted Creator Account selector, never an identity or grant. Unknown, inherited, symbol and accessor keys are rejected, including client before/status/actor overrides. The result contains exactly `Account`, `Previous_Service_Area`, `Requested_Service_Area`, and `Status` (always `Pending review`). No extra schema field or duplicate audit form is introduced.

The separately verified server context has exactly:

- `principalId`: stable authenticated portal principal identifier.
- `contact`: `{ id, accountId }`, the exact CRM Contact and its `Contact.Account_Name` Account identifier.
- `companyMappings`: an array of `{ creatorAccountId, crmAccountId, active }` grants verified for that principal. Complete lookup results are required: exactly one matching selector, active grant and exact CRM Account equality. Missing, ambiguous, inactive or cross-company matches fail closed.
- `previousServiceArea`: authoritative current CRM baseline, required and copied exactly without trimming or newline conversion.
- `auditActorId`: verified human attribution, retained by the adapter's audit mechanism rather than added to the four-field form.

A passed object is **not authentication**. These assertions only reject structurally inconsistent facts. A future server adapter must authenticate the stable portal principal, verify its active company grant and complete exact Creator-to-CRM Account link, verify `Contact.Account_Name`, fetch a fresh authoritative previous area, and bind human audit attribution independently. Never deserialize this context from the client or infer it from an email/display-name match. Authorized secondary contacts require no Deal or `Primary_Contact` relationship. Those fields are intentionally absent.

Requested text uses the existing Form2 `normalizeText` semantics from `src/zoho-catalyst/revenue-leak-test-setup-form/functions/revenue_leak_test_setup_form/lib/form-contract.js`: CRLF/CR become LF, then trim, reject blank/prohibited controls, allow tab/LF, count at most 2000 Unicode code points, reject 2001 without truncation. Source parity tests extract only that pure function; runtime imports no Form2 code or writer. Baseline availability is validated with the same predicate but the original string is preserved. Historical fixtures rejecting CRLF/tab are not authority.

The returned object is frozen only to prevent accidental in-process edits. This is not immutable storage, durable acceptance, retry safety, or a success receipt. Live adapter attribution, a durable UNIQUE replay key with atomic concurrency handling, append-only persistence, independent readback/reconciliation and truthful acceptance remain explicit unimplemented gates. A future adapter must preserve attribution with the request durably without changing this approved form schema. Do not enable a portal save flow until those gates and separately approved permission/deployment acceptance are complete.

Run the focused checks from the repository root:

```sh
node --check src/zoho-creator/client-portal/company-settings-requests/service-area-request-contract.js
node --test src/zoho-creator/client-portal/company-settings-requests/test/service-area-request-contract.test.js
```

Tests cover exact projection/status, exact baseline/nonmutation, missing/ambiguous/inactive/cross-company links, secondary contacts, unsupported values, unknown/prototype/accessor keys, attribution availability, 2000/2001 ASCII/emoji/mixed text, newline/tab/control parity and zero transport capabilities. The canonical verifier runs syntax and focused tests in both Quick and All modes; Repo Checks CI also runs them explicitly. The verifier registration has a regression test in `tools/safety/tests/test_verify_entrypoint.py`. Keep fixtures synthetic and logs free of customer data. No live setup or rollback is needed for this source-only planner; revert its source commit for containment. Adapter, storage and live permission/acceptance tests remain outside this slice.
