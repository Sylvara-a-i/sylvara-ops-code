# Form 1 Assisted Controller Instructions

- Production remains blocked in source. A Development test, merge, or upload does not authorize Production.
- Keep Form 2, its project, routes, functions, tables, connections, and active pull requests untouched.
- Never put CRM IDs, names, email addresses, phone numbers, raw tokens, secrets, or private routes in Git, logs, or the Form URL.
- Form 1's existing native CRM upsert is the only submission writer. This controller has only issue and prefill routes.
- Every issue must rotate `Intake_Submission_ID` before returning the URL so older assisted tokens fail the CRM binding check.
- Reserve a bounded prefill disclosure before reading CRM. Unknown or racing Data Store outcomes fail closed.
- Prefill only the allowlist in `lib/form-contract.js`. Consent fields and internal notes are prohibited.
- Use separate least-privilege Lead READ and Lead UPDATE Catalyst Connections.
- Stamp `lib/source-revision.js` only in a temporary artifact built from a clean, reviewed commit.
- Use synthetic fixtures only. Run the direct syntax checks, Node test suite, and repository verifier before handoff.
