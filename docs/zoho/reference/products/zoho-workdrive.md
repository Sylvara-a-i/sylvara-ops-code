# Zoho WorkDrive Reference

## Status And Scope

- Artifact class: **Reference**
- Research cutoff: **2026-07-20**
- Sylvara adoption: **Unknown**
- Effective Sylvara access: **Unknown**
- Evidence basis: official WorkDrive API and help documentation reviewed in the audited source material.

This handbook describes WorkDrive as a controlled content, version, collaboration, and sharing layer. It does not prove that a Sylvara team, Team Folder, role, webhook, custom app, workflow, or API grant exists.

Live metadata, permissions, current plan behavior, and the official API Explorer outrank this reference.

## Role And Ownership

WorkDrive owns approved private document content, versions, hierarchy, and controlled sharing metadata. It may store approved final copies produced by another system, but it does not replace that system's transactional or lifecycle authority.

GitHub stores sanitized source and documentation only. It must never become a document vault. External links are access grants and require the same review as any other permission.

Business automation should use an approved Team Folder or controlled shared location, not an individual's private space. Define classification, retention, recovery, legal-hold, membership, and sharing policy before ingestion.

## Authentication And Discovery

WorkDrive uses OAuth 2.0. Resolve the account's data center from the authorization result and request the exact operation-specific scopes from the current API Explorer. OAuth scope does not override Team Folder membership or role.

Use a durable integration principal rather than an individual's fragile session. Separate metadata audit, content read, upload/update, sharing, and administrative capabilities where practical.

Discovery sequence:

1. confirm organization, data center, authenticated principal, and intended role;
2. identify the correct team and Team Folder;
3. read membership, role, inheritance, classification, and sharing policy;
4. resolve the parent resource by opaque identifier, not path text;
5. inspect existing children, duplicate names, versions, and custom metadata;
6. confirm plan storage, file-size, upload, webhook, and recovery capability; and
7. produce an exact current/proposed operation with rollback and readback.

## Resource And Workflow Model

| Resource | Purpose | Control requirement |
|---|---|---|
| Team | Administrative and ownership boundary | Bind the approved organization and durable owner |
| Team Folder | Controlled shared root | Verify membership, role, policy, and status |
| Folder | Hierarchical container | Persist resource and parent identifiers; path is presentation only |
| File | Content resource | Validate type, size, checksum, source, classification, and current version |
| Version | Immutable content revision evidence | Distinguish latest from the required retained version |
| Member | User-to-team relationship | Resolve live membership and effective role |
| Permission/share | Internal or external access grant | Record target, role, expiry, download policy, and revocation owner |
| External link | Bearer-style sharing capability | Keep private, time-bound, reviewed, and revocable |
| Custom metadata | Search and classification data | Use an approved schema without duplicating authoritative business facts |
| Webhook/custom app | Change notification surface | Verify the current event and authentication contract |

Never route, deduplicate, or reconcile by filename or folder label alone. Names can collide or change.

## Automation And Webhooks

WorkDrive supports API operations, custom apps, webhooks, workflows, Connections, and custom functions subject to current plan and quota.

- Create deterministic folders only after confirming the exact parent and existing children.
- Define upload collision behavior: reject, new version, rename, or keep both.
- Use chunked upload for large content only after verifying the current session protocol.
- Scan and quarantine untrusted files before placing them in the trusted hierarchy.
- Keep external sharing disabled by default and require explicit recipient, role, expiry, and download decisions.
- Verify webhook authenticity using the current WorkDrive contract before parsing.
- Enqueue webhook work, retrieve authoritative resource state, and reconcile before downstream action.
- Keep custom functions bounded by their execution, response-size, and connection limits.

Webhook receipt is not proof that a file is complete, safe, final, or archived. Retrieve the resource and version before acting.

## Failure, Retry, And Idempotency

Use one durable operation key per intended content outcome. Persist the source reference, target parent, returned resource identifier, checksum, version, and processing state privately.

Retry rate-limited and selected transient reads with capped backoff and jitter. Do not blindly retry upload, move, rename, share, version, or delete after an ambiguous timeout. Search and read the exact target hierarchy first.

Stop on wrong organization, team, role, parent, version, checksum, classification, or permission. Prefer containment by disabling automation, revoking new access, or quarantining misrouted content rather than deleting evidence.

## Validation

Use synthetic files to test:

- correct organization, data center, team, Team Folder, principal, and role;
- stable identifier routing across rename and move;
- zero, one, and multiple folder/file matches;
- ordinary and chunk upload, size limits, interrupted upload, and checksum mismatch;
- duplicate names and each approved collision/version policy;
- malware quarantine, blocked formats, and temporary-file cleanup;
- internal role inheritance and external share creation, expiry, revocation, and download policy;
- webhook authentication, duplicates, ordering, unknown events, silence, and reconciliation;
- deactivated principal, changed membership, revoked token, rate limit, and ambiguous timeout; and
- version recovery, content restoration, containment, and independent readback.

Repository evidence must contain no real content, share URLs, paths, resource identifiers, membership details, or production payloads.

## Official Sources

- [WorkDrive API overview and Explorer](https://workdrive.zoho.com/apidocs/v1/overview)
- [File and folder sharing and upload](https://workdrive.zoho.com/apidocs/v1/filefoldersharing)
- [Chunk upload](https://workdrive.zoho.com/apidocs/v1/chunkupload)
- [Download server file](https://workdrive.zoho.com/apidocs/v1/filesfolders/downloadserverfile)
- [Get Team Folder information](https://workdrive.zoho.com/apidocs/v1/teamfolder/getteamfoldersinfo)
- [Webhook custom-app setup](https://help.zoho.com/portal/en/kb/workdrive/integrations/webhooks/articles/setting-up-webhooks-in-workdrive-using-custom-apps)
- [Webhook trigger events](https://help.zoho.com/portal/en/kb/workdrive/integrations/webhooks/articles/webhooks-trigger-events-available-in-workdrive)
- [Custom functions](https://help.zoho.com/portal/en/kb/workdrive/custom-functions-connections/articles/working-with-custom-functions-in-workdrive)
- [WorkDrive custom apps](https://www.zoho.com/workdrive/custom-apps.html)
- [WorkDrive plan comparison](https://www.zoho.com/workdrive/plan-comparison.html)

## Exclusions

This public reference intentionally excludes team and folder names, resource identifiers, paths, member identities, permissions, external links, file content, filenames, checksums tied to real content, webhook payloads, connection names, credentials, classifications, retention schedules, and organization-specific hierarchy rules.

Storage, file-size, webhook, workflow, recovery, and plan limits are volatile. Verify current product and account behavior before implementation.
