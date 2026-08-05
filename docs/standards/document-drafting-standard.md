# Sylvara Document Drafting And Typography Standard

- **Standard ID:** `SYL-DOC-001`
- **Version:** `1.0`
- **Effective date:** 2026-08-05
- **Status:** Active repository standard
- **Machine-readable profile:** [document-style-profile.json](document-style-profile.json)

## Purpose And Priority

This standard governs user-facing letters, proposals, reports, policies, checklists, forms, presentations, DOCX files, PDFs, Zoho templates, and reusable business-document generators. It does not force typography on plain-text chat or Markdown viewers.

Apply requirements in this order:

1. Binding law, mandatory form, regulator or court instruction, and accessibility requirement.
2. Executed agreement or approved legal, finance, security, or brand requirement.
3. Application and output-format constraints.
4. This standard.
5. A documented artifact-specific exception.

Never alter mandatory wording, invalidate an official form, weaken accessibility, or misstate document status to satisfy a visual preference.

## Typography

Sylvara prefers the visual character of Apple's San Francisco typeface. Use it only for an Apple-platform interface through the native system-font API, or when a separate written license expressly authorizes the exact use. Do not download, bundle, upload, embed, or redistribute Apple font files in documents, websites, applications, templates, PDFs, or this repository. Apple's published font package is licensed for restricted Apple-platform interface mockup use; it is not the document font for this repository. See [Apple Fonts](https://developer.apple.com/fonts/).

**Inter is the production default for portable artifacts.** Use Inter for DOCX, PDF, presentations, reports, policies, templates, Zoho documents, and cross-platform interfaces when the native Apple system font is unavailable or inappropriate. Inter is distributed under the [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt).

| Environment | Required implementation |
|---|---|
| Apple-native interface | Use the system-font API; do not package an SF font file |
| HTML/CSS | `font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;` |
| DOCX / Word | Apply Inter through document styles and run-level mappings where the generator requires them |
| PDF | Render from the editable source and embed or subset Inter when the tool and license permit |
| Zoho templates | Select Inter when available; record an exception if the product cannot supply it |
| Plain text / Markdown | Viewer controls the font; rendered derivatives follow this standard |

Do not silently substitute Arial, Calibri, Roboto, or another font and describe the output as compliant.

## Page And Type Defaults

These starting defaults apply to paged U.S.-Letter business documents when no mandatory form, approved template, accessibility rule, or output-specific constraint supersedes them. They do not govern slides, application interfaces, web pages, or compact form controls. Record deliberate output-specific overrides rather than forcing a poor fit.

| Element | Default |
|---|---|
| Page size | U.S. Letter, 8.5 × 11 inches |
| Margins | Top 0.80 in; bottom 0.78 in; left/right 1.00 in |
| Header/footer distance | Header 0.35 in; footer 0.34 in |
| Title | Inter 18 pt, bold |
| Status kicker | Inter 8.3 pt, bold, uppercase |
| Subtitle | Inter 9.2 pt, semibold or bold |
| Heading 1 | Inter 15 pt, bold |
| Heading 2 | Inter 12 pt, bold |
| Heading 3 | Inter 10.5 pt, bold |
| Body | Inter 10 pt, regular |
| Dense body minimum | 9 pt |
| Tables | Normally 7.5–8.8 pt; use the largest readable size that fits |
| Header/footer | 7.2–7.6 pt |
| Body spacing | 1.08 line spacing; 0 pt before and 5 pt after |

Use paragraph spacing rather than empty paragraphs. Keep headings with the next paragraph, enable widow/orphan control, and avoid fully justified text when it creates uneven spacing.

Brand colors are not established by this standard. Use black or dark ink on white with a restrained approved accent. Do not import another organization's palette, and never rely on color alone to convey status or meaning.

## Structure And Writing

- Lead with the outcome, decision, requested action, or material risk.
- Use plain language, direct sentences, short paragraphs, and concrete owners and deadlines.
- Use real heading styles and generated numbering. Do not simulate structure with bold text, blank lines, or manual spaces.
- Use tables only when they materially improve comparison, mapping, or scanning. Repeat table headers across pages.
- Use meaningful link labels, searchable text, descriptive alternative text, and a logical reading order.
- Record owner, status, revision date, and version on reusable or operationally material documents.
- Keep unresolved placeholders visible and fail delivery if required merge fields remain unresolved.
- Keep legal conclusions, accounting conclusions, verified facts, proposals, and unknowns visibly distinct.
- Avoid excessive decoration, stock imagery, inconsistent icon systems, and dense visual clutter.

## Headers, Footers, And Versioning

Default header:

```text
Sylvara | [Short Document Name]
```

Default footer:

```text
[Status] | Rev. YYYY-MM-DD | Page X of Y
```

Use automatic page fields and document identifiers. Do not place a manually maintained transaction, customer, contract, or production identifier in a global template. Material final artifacts should record an immutable filename/version and hash in the approved private evidence system.

## Format-Specific Controls

### DOCX And Word

- Set Inter in paragraph styles and any required `ascii`, `hAnsi`, complex-script, and East-Asian font mappings.
- Use semantic headings, list numbering, page fields, table-header repetition, and editable fields.
- Preserve accessible reading order and do not create spacing with repeated spaces or blank paragraphs.

### PDF

- Export from the verified source; do not deliver screenshots of document pages as the document.
- Preserve selectable/searchable text, working links, bookmarks for long artifacts, and tagged structure when supported.
- Confirm the intended font did not silently substitute during export.

### Presentations

- Use Inter, a consistent type scale, restrained visuals, and one idea per slide where practical.
- Keep source citations and status labels legible. Do not shrink essential content below a readable size to avoid editing.

### Zoho Contracts And Sign

- Keep Contracts merge fields separate from Sign recipient fields.
- Use semantic Title, Heading 1–5, and Normal styles instead of embedding heading text in body paragraphs.
- Keep clause or section titles separate from substantive language when the product stores them separately.
- Test the final merged document and signing preview, not only the blank template.
- Follow the current [Zoho document lifecycle standard](../zoho/standards/document-lifecycle.md) for fields, recipients, readback, evidence, and publication gates.

## Required Final QA

Every final DOCX or PDF must pass:

1. Content comparison against the approved source of truth.
2. Heading, numbering, cross-reference, table, and attachment reconciliation.
3. Merge-field and unresolved-placeholder review.
4. Header, footer, status, revision, and page-number review.
5. Font-family and font-substitution review.
6. Full-page rendering and visual inspection of every page.
7. Clipping, overflow, blank-page, orphan-heading, split-block, and broken-table review.
8. Searchable/selectable text, working links, and accessibility review where supported.
9. Final filename, version, and private evidence hash for material documents.

Opening successfully is not sufficient QA. If rendering or visual inspection cannot be performed, deliver a clearly labeled draft and state the missing verification.

## Exceptions And Repository Boundary

An exception records the application limitation, affected rule, temporary substitute, user-facing impact, remediation owner, and whether the final artifact remains noncompliant.

This public repository may store this standard, machine-readable style settings, source templates, and sanitized generation code. It must not store proprietary font binaries, signatures, private customer documents, completed agreements, confidential source material, or generated artifacts containing sensitive or production data.
