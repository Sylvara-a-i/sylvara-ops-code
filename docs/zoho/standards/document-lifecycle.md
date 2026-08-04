# Zoho Document Lifecycle Standard

## Status

- Repository standard: **Proposed**
- Sylvara WorkDrive folders, Contracts templates, Sign templates, signer routing, and live document integrations: **Unknown**

The official [WorkDrive API documentation](https://workdrive.zoho.com/apidocs/v1/teamfolder/getteamfolderfiles), [Zoho Contracts API introduction](https://www.zoho.com/contracts/api/introduction.html), [Zoho Sign API reference](https://www.zoho.com/sign/api/), and [Zoho Sign OAuth scopes](https://www.zoho.com/sign/api/oauth.html) describe product capabilities. They do not prove that a template, document, or integration is configured or legally suitable for Sylvara.

## Ownership

- **Zoho Contracts** may own approved legal-document generation and contract lifecycle state.
- **Zoho Sign** may own signature-request routing, recipient actions, execution status, and signature evidence.
- **Zoho WorkDrive** owns the approved private document vault and retained copies.
- **Zoho CRM** may store the minimum operational index: document type, sanitized status, version reference, and immutable private resource reference.
- **GitHub** owns sanitized merge-field contracts, implementation source, and runbooks, not legal documents or executed evidence.

Legal text, signer order, authentication method, retention, and enforceability require qualified review. A repository standard is not legal advice or approval of a template.

## Lifecycle Contract

Use an explicit state model such as proposed, generated, internally approved, sent, viewed, partially signed, completed, declined, expired, voided, or superseded. Use only states supported and verified in the intended product; do not infer completion from a filename, email, upload, or partial signer action.

Every document workflow must define:

- the approved template and immutable version reference;
- merge fields, authoritative sources, requiredness, and formatting;
- recipient roles, order, authentication, and fallback behavior;
- internal approval required before sending;
- duplicate-request and resend rules;
- the executed-copy destination and naming convention;
- the CRM index and conflict-resolution behavior;
- retention, access, legal hold, supersession, and deletion rules; and
- rollback or safe containment before and after external delivery.

## Access And Data Controls

Separate metadata inspection from content download. Use least-privilege WorkDrive folders and Sign/Contracts roles, avoid public sharing by default, and keep signer data and document content out of logs.

Validate template fields against current product metadata before merge. Reject missing, ambiguous, or overlong values instead of sending a document with blanks or guessed substitutions. Never route a document to a recipient resolved from an ambiguous CRM match.

## Repository Boundary

GitHub may contain sanitized field dictionaries, state diagrams, template-version metadata without private content, integration code, synthetic tests, and setup/runbook documentation. It must not contain legal templates not approved for publication, drafts, executed agreements, signatures, signer data, document contents, WorkDrive or Sign IDs, private links, folder structures, OAuth material, or raw delivery/audit evidence.

An archived document or template is reference-only and does not prove current legal approval, product configuration, or execution.

## Failure And Readback

Fail closed on an unapproved template, version mismatch, missing merge value, ambiguous signer, invalid recipient order, unavailable authentication method, unknown folder, duplicate active request, stale document state, upload failure, incomplete response, or ambiguous send result.

After generation, read the template/version and generated document metadata. After sending, read the Sign request and recipient action state. After completion, verify all required actions, retrieve the executed artifact through the approved private path, confirm its WorkDrive retention, and read the CRM index separately. Do not retry an ambiguous send until the current request list is reconciled.

## Validation

Use synthetic or Development documents to test:

- every required and optional merge field;
- missing, malformed, oversized, and conflicting source values;
- one and multiple recipients, ordering, decline, expiration, and resend behavior;
- exact duplicate submission and timeout after possible send;
- generated-file and executed-file storage;
- access denial and role boundaries;
- CRM index mismatch and supersession; and
- rollback or containment before send and after send.

Legal review, signer-authentication review, and retention review are required before any production template is enabled.

## Manual Setup

All live setup is currently **Unknown**. Before use, verify or configure:

- Contracts and Sign organizations, editions, data centers, administrators, roles, and OAuth scopes;
- qualified approval of legal templates and version ownership;
- merge fields, data sources, signer roles/order, authentication, reminders, expiration, and decline behavior;
- WorkDrive team folders, permissions, naming, retention, and legal-hold procedures;
- CRM index fields and status mappings from live metadata;
- webhook or polling behavior, idempotency, private evidence storage, and alerts; and
- Development smoke tests, production approval, rollback/containment, and independent readback.
