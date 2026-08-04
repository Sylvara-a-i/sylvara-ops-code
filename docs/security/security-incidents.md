# Security Incidents

## Scope

Use this runbook for suspected secret exposure, PII disclosure, unauthorized access, connector compromise, unsafe public artifacts, unexpected production writes, duplicate actions, or integrity failures.

## First Response

1. Stop the affected workflow, deployment, connector, or publication path when safe.
2. Do not reproduce sensitive content in GitHub, chat, email, or a public ticket.
3. Preserve timestamps, commit references, actor identity, and relevant evidence in an approved private incident system.
4. Notify the authorized incident owner through a private channel.
5. Classify the affected data, systems, environments, and possible downstream impact.

## Containment By Incident Type

### Secret Or Credential Exposure

- Treat the credential as compromised.
- Revoke or rotate it in the authoritative platform immediately.
- Invalidate sessions, signed URLs, or dependent credentials as required.
- Remove the exposed value from the active branch and workflow output.
- Assess Git history, forks, caches, artifacts, and logs; deletion from the latest commit alone is not containment.

### PII Or Client Data Exposure

- Restrict access and stop further copying.
- Preserve evidence privately without expanding the exposed dataset.
- Identify the data owner and applicable notification obligations.
- Remove public access only after evidence needed for response is safely preserved.

### Connector Or Account Compromise

- Disable or suspend the installation, token, or automation identity.
- Review recent branches, pull requests, workflow runs, deployments, permission changes, and audit events.
- Rotate credentials and reauthorize with least privilege.
- Do not restore write access until identity, scope, and expected state are verified.

### Unexpected Or Duplicate Production Action

- Stop automated retries and related writers.
- Read authoritative system state before attempting compensation.
- Use idempotency and returned identifiers to determine actual effects.
- Obtain explicit approval for rollback, reversal, refund, deletion, or any financial correction.
- Prefer a traceable compensating action over destructive deletion when appropriate.

## Recovery

1. Identify the root cause and affected boundary.
2. Patch the smallest safe scope on a short-lived branch.
3. Add or update a regression test, safety check, and runbook.
4. Pass required checks and review before merge.
5. Obtain separate approval before any production recovery or deployment.
6. Deploy an immutable reviewed artifact and perform independent readback.
7. Monitor for recurrence and close only after affected systems reconcile.

## Public Communication

Do not disclose sensitive incident details publicly. Public notices, customer communication, regulatory notices, or security advisories require authorized legal and business approval. Security reports belong in GitHub private vulnerability reporting or the approved private incident channel, not public issues.

## Post-Incident Record

Record privately: impact, timeline, root cause, containment, rotations, affected data, approvals, recovery evidence, and follow-up owners. Add only a sanitized process improvement to this repository when it is safe and useful.
