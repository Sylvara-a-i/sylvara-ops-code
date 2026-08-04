# Zoho System Ownership

## Status

- Repository ownership policy: **Proposed governance**
- Live Sylvara product adoption and configuration: **Unknown unless separately verified**
- Last policy review: **2026-08-04**

## Ownership Map

| Product | May own | Must not own |
|---|---|---|
| Zoho CRM | Prospect, customer, contact, opportunity, and approved commercial relationship state | Accounting truth, private document contents, credentials, or raw integration payloads |
| Zoho Books | General ledger, accounting balances, reconciliation, and financial reporting | CRM relationship state, subscription entitlement, or source code |
| Zoho Billing | Approved subscription lifecycle and entitlement events | General-ledger truth or duplicate Books outcomes |
| Zoho Creator | Explicitly approved workflow UI, human tasks, and Creator-native operational state | A duplicate CRM, a shadow accounting ledger, or an unapproved custom platform |
| Zoho Forms | Bounded external intake before authoritative validation and acceptance | Relationship, accounting, or subscription truth |
| Zoho Sites | Public presentation and approved doorway behavior | Operational, relationship, subscription, or accounting truth |
| Zoho WorkDrive | Private document contents, versions, hierarchy, and controlled sharing metadata | CRM relationship or accounting facts |
| Zoho Contracts | Contract drafting, clauses, negotiation, approval, and legal lifecycle state | Signature execution evidence or public document storage |
| Zoho Sign | Recipient routing, execution status, and execution evidence | Contract drafting or CRM relationship truth |
| Zoho Mail | Mailbox content, delivery state, and approved mail administration | CRM relationship, consent, or financial truth |
| Zoho Analytics | Derived reporting models, refresh state, dashboards, and controlled exports | Transactional truth or reverse-write authority |
| Zoho Catalyst | Verification, normalization, durable idempotency, retry state, API mediation, and approved release artifacts | CRM, subscription, accounting, legal-document, or mailbox facts |
| Zoho One | Identity and application assignment only if adopted | Product-specific business records or application authorization by inference |
| Zoho API Console | OAuth client registration and consent configuration | Runtime secrets in GitHub or business data |

Products such as Bookings, Calendar, Checkout, Flow, Meeting, Payments, People, ToDo, and Voice remain **Reference / adoption Unknown**. Their existence in the reference collection does not assign them a Sylvara role.

## Cross-System Rules

1. Every record type has one authoritative owner.
2. Integration state may reference an owner but must not silently recreate its truth.
3. Joins use stable verified identifiers, never display labels or unverified names.
4. Every side effect has a deterministic idempotency identity and an authoritative readback.
5. Ambiguous timeouts require reconciliation before retry.
6. Documents stay in WorkDrive or the owning legal product; public GitHub stores sanitized schemas and rules only.
7. Repository approval does not authorize a live product change.

## Selection Rule

Use the smallest managed Zoho product that reliably owns the approved workflow. Do not add Creator, Catalyst, Flow, or another orchestration layer when a bounded native configuration is sufficient. Do not adopt a reference-only product until requirements, ownership, operating cost, access controls, failure modes, and rollback are explicit.
