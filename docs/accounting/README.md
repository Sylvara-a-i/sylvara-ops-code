# Sylvara Accounting Knowledge Base

## Status

| Item | Status |
|---|---|
| Repository framework | **Proposed** |
| Official-source links | **Reviewed 2026-08-04**; reverify for the applicable tax year or reporting period |
| Sylvara reporting basis, accounting methods, elections, materiality, close calendar, and approved policies | **Unknown** |
| Assertion that Sylvara financial statements comply with U.S. GAAP | **Not made** |

## Purpose

This directory is the product-neutral front door for accounting authority, research discipline, policy controls, federal tax references, and U.S. GAAP topic navigation. It helps an operator find the right current source and document a reviewable decision. It is not a substitute for the controlling source, the private accounting record, or a qualified accountant or tax professional.

Zoho Books is Sylvara's implementation ledger. The [Zoho Accounting Practices Standard](../zoho/standards/accounting.md) governs safe evidence, posting, reconciliation, and readback in that product. Software settings never establish the correct legal, tax, or financial-reporting treatment.

## Decision Authority And Evidence

Tax, legal, and financial-reporting questions do not share one universal hierarchy. First identify the applicable framework, jurisdiction, reporting basis, and period; then use the controlling source within that framework.

- For a federal tax question, current statutes, regulations, controlling decisions, and other applicable law govern. Use official administrative guidance, forms, and instructions according to their legal weight.
- For a U.S. GAAP question, the current FASB Accounting Standards Codification governs when that reporting framework applies.
- Binding agreements, elections, orders, and reliable entity evidence establish obligations and facts. They can determine scope or application, but they do not override applicable law or U.S. GAAP.
- Approved Sylvara policy implements a supported conclusion and cannot conflict with its governing framework.
- Ledger configuration, automation, examples, search results, repository notes, and AI output are implementation or discovery material only.

Preserve conflicts and unresolved facts instead of forcing a convenient answer. A lower-authority implementation cannot convert itself into accounting or tax authority.

## Directory Map

- [Authority And Research Standard](authority-and-research.md) — currentness, source hierarchy, applicability, licensing, and review records.
- [Federal Tax Reference](federal-tax-reference.md) — official federal source map for general business accounting questions.
- [U.S. GAAP Reference](us-gaap-reference.md) — topic locators and Sylvara-relevant research triggers without copied Codification text.
- [Accounting Operating Controls](operating-controls.md) — policy register, evidence, posting, close, correction, and automation controls.
- [Source Manifest](reference/source-manifest.json) — machine-readable provenance, exclusions, official links, and public-artifact allowlist.

## Required Workflow

1. Identify the legal entity, transaction, contract, service period, reporting basis, tax year, jurisdiction, and decision being made.
2. Separate the book, U.S. GAAP, federal tax, state or local tax, cash, and system-configuration questions.
3. Start with the [authority and research standard](authority-and-research.md), then use the relevant source map.
4. Verify the live primary source and its effective date. An old publication, search result, summary, or unavailable source leaves current treatment unresolved.
5. Record the facts, citations, applicability analysis, alternatives, book-tax difference, approval, effective date, and next review trigger.
6. Obtain qualified review for judgments listed as professional-review-only.
7. Only then translate the approved conclusion into Zoho Books configuration, entries, automation, reports, or close procedures.

## Public Repository Boundary

GitHub may store original policy structure, sanitized control descriptions, topic locators, official links, synthetic examples, tests, and approval requirements. It must not store financial records, tax returns, payroll details, invoices, statements, receipts, customer or vendor data, account identifiers, elections containing private facts, legal advice, licensed commentary, or copied standards text.

Exact thresholds, rates, deadlines, form editions, transition rules, and elections are period-specific. Link to the current official source and record an approved dated decision in the private accounting workspace instead of turning a temporary number into permanent repository policy.

## Portability And Exclusions

This library is an original Sylvara synthesis informed by an authorized review of portable governance patterns in another internal repository and revalidated against current primary sources. No sourcebook or policy text was copied. The transfer deliberately excludes rental, property, landlord, tenant, mortgage, escrow, security-deposit, Kansas or local-law material; entity-specific elections and conclusions; charts of accounts; transactions; identifiers; PDFs; hashes; and dated thresholds or rates.

The exact provenance and exclusion record is in the [source manifest](reference/source-manifest.json).

## Approval Boundary

Repository review does not approve an accounting method, tax position, election, filing, journal, reconciliation, close, financial statement, payroll correction, customer charge, or live automation. Those actions require current private evidence, scoped authority, professional review where appropriate, and independent readback from the authoritative system.
