# Contribution Policy

Sylvara is not currently accepting public code, documentation, feature, or configuration contributions.

Authorized maintainers and approved automation must:

1. work on a focused short-lived branch;
2. use synthetic or sanitized data only;
3. run the documented safety and relevant product checks;
4. document purpose, validation, production impact, rollback, and deferred work in the pull request;
5. obtain required review and resolve all conversations;
6. squash merge after checks pass; and
7. verify the merged `main` state and branch cleanup.

Do not submit secrets, customer or caller data, recordings, transcripts, raw payloads, production logs, payment or banking data, production identifiers, signed documents, or secret-bearing URLs.

Report vulnerabilities through GitHub private vulnerability reporting, not a public issue.
