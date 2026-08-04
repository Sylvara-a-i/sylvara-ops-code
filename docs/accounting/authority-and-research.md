# Accounting Authority And Research Standard

## Purpose

This standard defines how Sylvara turns accounting or tax research into a dated, reviewable decision. It prevents unofficial summaries, stale publications, software behavior, or another entity's conclusion from being promoted into policy.

## Evidence Layers

Classify every source before relying on it.

| Layer | Examples | Permitted use |
|---|---|---|
| Controlling authority | Current statute, regulation, controlling case, binding order | Governs within its jurisdiction and effective period |
| Authoritative reporting framework | FASB Codification when U.S. GAAP applies | Governs applicable financial-reporting treatment |
| Official administrative material | IRS revenue procedures, notices, publications, forms, and instructions | Apply according to legal weight and current scope; do not treat every item as controlling law |
| Entity evidence | Executed contracts, elections, invoices, approvals, source records | Establishes the facts to which authority is applied |
| Approved Sylvara policy | Dated policy signed by the authorized financial owner | Implements a supported conclusion until a review trigger occurs |
| Implementation evidence | Zoho settings, code, workflow output, reports | Shows what a system did, not whether the treatment is correct |
| Discovery material | Search results, alerts, secondary commentary, repository notes, AI output | Identifies research leads only |

If the controlling source is missing, inaccessible, conflicting, superseded, or unclear, label the conclusion **Unresolved** and escalate. Do not silently fall back to a lower layer.

## Required Research Record

A decision record belongs in the approved private accounting workspace and must include:

- decision ID, title, owner, reviewer, status, and effective date;
- legal entity, jurisdiction, tax year or reporting period, and reporting basis;
- complete relevant facts and unresolved facts;
- separate book, U.S. GAAP, federal tax, state or local tax, and system effects;
- source title, authority class, official URL or controlled citation, version or effective date, and date verified;
- applicability analysis, alternatives considered, conclusion, and uncertainty;
- any election, threshold, transition rule, estimate, materiality decision, or book-tax difference;
- required entry, disclosure, return position, configuration, control, or no-action result;
- professional approval where required; and
- next review date plus event-driven review triggers.

Public repository documents may keep a sanitized policy pattern or topic locator. Private facts, calculations, evidence, and signed conclusions stay outside GitHub.

## Currentness Rules

- `Reviewed on` means the cited source was checked on that date; it does not mean the conclusion is permanently current.
- Verify the effective law, regulation, form instructions, and standards for the exact period at issue.
- Reopen research after a law, regulation, standards update, court decision, entity change, new contract model, new jurisdiction, material transaction, auditor or tax-adviser finding, or source-access failure.
- An automated alert creates a review candidate. It cannot change policy, ledger behavior, tax treatment, or a filing position.
- A parser failure, blocked page, stale mirror, missing attachment, incomplete export, or degraded source keeps the item out of approved-current paths.
- Preserve the prior approved decision until it is lawfully superseded, unless continuing it would violate a known controlling requirement. Escalate that conflict immediately.

## Framework Separation

Bookkeeping, U.S. GAAP, federal income tax, payroll tax, sales tax, state or local tax, management reporting, and cash movement answer different questions. One transaction may need different treatments in more than one layer.

Do not make the general ledger imitate a tax return without an approved book-tax policy. Do not use a tax deduction rule as a U.S. GAAP recognition rule. Do not treat customer billing, payment-processor status, or cash receipt as automatic revenue recognition.

## FASB Research And Licensing

The [FASB Standards page](https://fasb.org/standards) identifies the Codification as the authoritative nongovernmental U.S. GAAP source. Use authorized [Codification access](https://fasb.org/page/PageContent?isStaticPage=true&pageId=%2Fstaticpages%2Fcodification-access.html) for exact scope, paragraphs, definitions, effective dates, transition, disclosure, and private-company alternatives.

This repository may contain Topic and Subtopic locators, official links, original summaries, applicability questions, and Sylvara decisions. Follow the official [FASB copyright information](https://www.fasb.org/copyright-information) and [Financial Accounting Foundation terms of use](https://accountingfoundation.org/page/detail?pageId=%2Fterms-of-use.html). Do not commit copied Codification paragraphs, screenshots, exports, reconstructed text, licensed research, or large excerpts from Accounting Standards Updates. An Accounting Standards Update communicates amendments; confirm the resulting current guidance in the Codification before making an applicability conclusion.

## Review Statuses

Use only these statuses:

- **Candidate:** discovered but not yet verified against the live primary source.
- **Reviewed:** source and scope checked for a stated date and period; no policy approval implied.
- **Approved:** qualified reviewer and authorized financial owner approved the dated Sylvara conclusion.
- **Superseded:** replaced by a later approved record with traceable lineage.
- **Unresolved:** facts, authority, access, applicability, or approval are insufficient.
- **Not applicable:** a documented facts-based review found the topic outside scope; review triggers still apply.

## Professional Review Gate

Qualified review is required before asserting U.S. GAAP compliance or adopting a material conclusion involving revenue recognition, software or research costs, credit losses, business combinations, equity compensation, income taxes, leases, contingencies, related parties, subsequent events, going concern, accounting-method changes, tax elections, worker classification, payroll corrections, or a disputed filing position.

Automation must not make these judgments from labels, dollar amount, vendor name, account mapping, or prior treatment alone.
