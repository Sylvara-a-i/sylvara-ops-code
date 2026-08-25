# RevenueLeakTestRequestForm Instructions

- Production remains blocked in source. A Development test, merge, or upload does not authorize Production.
- `RevenueLeakTestRequestForm` and `RevenueLeakTestSetupForm` target the existing Retell Catalyst project in Development, but they remain separate functions with separate routes, tables, Connections, variables, artifacts, and rollback paths. Never use an unscoped deployment that can change another Retell-project resource.
- The Retell Development table copy has initial readback evidence. The two Request Form CRM Connections were read back as Connected with the exact approved scopes on 2026-08-23, but their CRM-organization binding and runtime behavior remain unverified. The legacy project remains live under its former Form 1 name, and the function, routes, variables, and CRM/Forms callers have not been cut over. Do not delete the legacy project until replacement deployment and the explicit row disposition are proven.
- Never put CRM IDs, names, email addresses, phone numbers, raw tokens, secrets, or private routes in Git, logs, or the Form URL.
- Form 1's existing native CRM upsert is the only submission writer. This controller has only issue and prefill routes.
- Every issue must rotate `Intake_Submission_ID` before returning the URL so older assisted tokens fail the CRM binding check.
- Reserve a bounded prefill disclosure before reading CRM. Unknown or racing Data Store outcomes fail closed.
- Prefill only the allowlist in `lib/form-contract.js`. Consent fields and internal notes are prohibited.
- Use separate least-privilege Lead READ and Lead UPDATE Catalyst Connections.
- Stamp `lib/source-revision.js` only in a temporary artifact built from a clean, reviewed commit.
- Use synthetic fixtures only. Run the direct syntax checks, Node test suite, and repository verifier before handoff.
