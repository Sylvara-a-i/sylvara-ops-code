# Zoho Forms Reference

## Status And Scope

- Artifact class: **Product reference**
- Live builder inventory observed: **2026-08-14**
- Official documentation review: **2026-08-14**
- Product: **Zoho Forms**
- Evidence basis: the current Zoho Forms builder inventory observed in the live tenant, cross-checked against current official Zoho Forms documentation.
- Sylvara adoption: **Verify per form**
- Effective edition, plan limits, regional behavior, and enabled integrations: **Verify in the intended tenant before adoption**

This reference documents the form-building elements currently exposed in the live Zoho Forms builder and the controls that govern their safe use. It does not prove that a specific form, connection, webhook, integration, payment gateway, approval, or subscription feature is enabled for Sylvara.

The official field-types overview currently lags the live builder in several areas. The observed builder includes newer elements such as GeoComplete, Regex, Large List, Multi-Type Matrix, Availability fields, separate Audio/Video/PDF embeds, Map Location, Image Slider, Yes/No, Heading, Divider, Spacer, Prefill fields, three Subform presentations, and Smart Scan. Where Zoho has not published a dedicated article for an observed element, this reference links the closest official family or configuration article and marks the documentation gap rather than inventing behavior.

No comprehensive public contract for arbitrary form-definition or submission CRUD was identified. Do not invent REST paths, OAuth scopes, schemas, limits, or retry guarantees.

## Role And Ownership

Zoho Forms is an intake and workflow surface. It can collect, validate, conditionally display, prefill, route, approve, notify, render, and pass data to supported systems.

A submitted or prefilled value is not automatically authoritative. The receiving system owns:

- identity and authorization checks;
- duplicate resolution and idempotency;
- acceptance or rejection;
- trusted timestamps, versions, statuses, and internal identifiers;
- cross-module updates;
- durable operational state; and
- reconciliation after partial or delayed failures.

Keep customer records, submissions, exports, administrative URLs, credentials, connection names, webhook endpoints, and audit evidence outside this public repository.

## Live Builder Element Catalog

The live builder exposed **66 elements across 18 sections** on 2026-08-14.

### Grid

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| 1-Column | Layout only | Full-width fields and long instructions | Does not collect data | [Field Types Overview](https://help.zoho.com/portal/en/kb/forms/field-types/overview/articles/field-types-overview) |
| 2-Column | Layout only | Paired short fields on wider screens | Verify mobile stacking and accessibility | [Field Types Overview](https://help.zoho.com/portal/en/kb/forms/field-types/overview/articles/field-types-overview) |
| 3-Column | Layout only | Compact, low-complexity field groups | Avoid for long labels or mobile-critical input | [Field Types Overview](https://help.zoho.com/portal/en/kb/forms/field-types/overview/articles/field-types-overview) |

### Basic Info

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Name | Composite input | Structured first, middle, last, prefix, or suffix data | Configure only required components; mark personal when identifying a person | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |
| Address | Composite input | Structured street, city, region, postal code, and country | Configure allowed/default countries and required components; treat as personal | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |
| Phone | Validated input | Telephone or mobile numbers | Prefer international format when geography can vary; mark personal and encrypt when sensitive | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |
| Email | Validated input | Email addresses | Use domain, duplicate, and confirmation controls only when the workflow requires them | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |
| Website | Validated input | Public website URLs | Do not use for private administrative links or secrets | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |
| GeoComplete | Address-autocomplete input | Fast single-line address capture | Select Zoho Maps or a configured Google Maps connection; use structured Address instead when components must map separately | [GeoComplete](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/basic-info/articles/geocomplete) |

### Textbox

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Single Line | Short text input | Concise names, labels, codes, and short values | Maximum documented length is 255 characters; configure input type, entry format, case, and validation deliberately | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |
| Multi Line | Long text input | Notes, descriptions, exceptions, and narrative responses | Set a practical character or word limit; avoid collecting unnecessary sensitive narrative | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |
| Regex | Pattern-validated text input | Values that must match a precise format | Observed in the live builder; no dedicated public field article was located. Verify the supported regex engine, anchoring, error message, and export format in the tenant | [Prefill Response Formats](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/prefill/articles/prefill-fields-overview) |

### Number

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Number | Integer input | Counts, quantities, whole-number delays, and integer bands | Configure digits, range, negative-value policy, and confirmation only when needed | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |
| Decimal | Decimal input | Measurements and fractional values | Configure decimal precision, range, separators, unit, and negative-value policy | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |
| Formula | Calculated output | Calculations based on prior fields | Treat as derived display, not a trusted server calculation; prevent circular dependencies | [Formula Field](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/number/articles/using-the-formula-field) |
| Currency | Monetary input | User-entered monetary amounts | Configure currency unit, precision, range, and confirmation; do not use as a payment-status control | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |

### Choices

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Dropdown | Single-select choice | Longer compact lists | Preserve exact downstream picklist labels and assigned values | [Choices](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices) |
| Radio | Single-select choice | Small lists whose options should remain visible | Prefer when respondents benefit from seeing every option | [Choices](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices) |
| Checkbox | Multi-select choice | Several selectable options shown as boxes | Configure selection limits and exact downstream values | [Choices](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices) |
| Multiple Choice | Multi-select choice | Several selectable options in a compact presentation | Configure selection limits; do not confuse with single-select Radio | [Choices](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices) |
| Large List | Searchable large choice set | Catalogs or lists too large for standard choice fields | Paid-plan and usage limits apply; maintain list ownership and synchronization | [Large List](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices/articles/large-list) |
| Image Choices | Image-based choice input | Visually distinguishable products, layouts, or options | Provide accessible labels/alt context and stable assigned values | [Image Choices](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices/articles/image-choices) |

### Matrix Choices

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Radio | Matrix, one choice per question | Repeated questions sharing the same single-select scale | Verify required rows and exported structure | [Matrix Choice](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices/articles/matrix-choice) |
| Checkbox | Matrix, multiple choices per question | Repeated questions allowing several selections | Configure mandatory questions and choice limits where supported | [Matrix Choice](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices/articles/matrix-choice) |
| Dropdown | Matrix, dropdown per question | Compact repeated single-select questions | Preserve exact assigned values and test mobile usability | [Matrix Choice](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices/articles/matrix-choice) |
| Textbox | Matrix text cells | Repeated short text responses | Set practical limits and validate the exported cell structure | [Matrix Choice](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices/articles/matrix-choice) |
| Number | Matrix numeric cells | Repeated numeric responses | Configure ranges and verify formula aggregation behavior | [Matrix Choice](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices/articles/matrix-choice) |
| Currency | Matrix currency cells | Repeated monetary responses | Configure currency and precision consistently | [Matrix Choice](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices/articles/matrix-choice) |
| Multi-Type | Mixed matrix cells | Repeated rows requiring different input types by column | Observed in the live builder; no dedicated public article was located. Verify supported child types, required behavior, export schema, prefill, and integration mapping before use | [Matrix Choice](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/choices/articles/matrix-choice) |

### Date & Time

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Date | Date input | Requested dates, deadlines, and date-only facts | Configure allowed dates; revalidate downstream because some date rules do not apply during record edit | [Date Field](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/date-time/articles/date-field) |
| Time | Time input | Time-of-day values | Configure 12/24-hour format and minute interval | [Date & Time](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/date-time) |
| Date-Time | Combined date and time input | Appointments or timestamp-like respondent choices | Configure timezone, allowed range, minute interval, and time windows | [Date-Time Field](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/date-time/articles/date-time-field) |
| Month-Year | Month and year input | Expiration months, planning periods, and month-level dates | Configure the allowed month/year range | [Date & Time](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/date-time) |

### Availability

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Day Availability | Capacity-managed date selection | All-day reservations or daily quotas | Availability fields have special edit, deletion, and plan constraints; use only when booking capacity is authoritative in Forms | [Availability](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/availability) |
| Date-Time Availability | Capacity-managed slot selection | Appointment slots with per-slot or daily limits | Configure date range, timezone, slots, limits, and closure rules; do not duplicate a separate scheduling system without reconciliation | [Date-Time Availability](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/availability/articles/date-time-availability) |

### Uploads

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| File Upload | File attachment input | Approved documents and files | Restrict formats, count, size, storage, retention, malware handling, and downstream access | [File Upload](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/uploads/articles/file-upload-field) |
| Image Upload | Image attachment or capture | Photos and image evidence | Restrict formats/count/size; classify and protect location or identifying content | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |
| Audio/Video Upload | Media upload or recording | Approved audio/video evidence | Browser permissions, format, size, storage, consent, and retention require explicit review | [Audio/Video Upload](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/uploads/articles/audio-video-upload) |

### Rating Scales

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Rating | Symbolic or numeric rating input | Satisfaction or ordinal scoring | Configure scale and labels so the meaning is unambiguous | [Rating](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/rating-scales/articles/rating-field) |
| Slider | Numeric scale input | Bounded numeric sentiment or quantity selection | Configure minimum, maximum, step, unit, and labels | [Slider](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/rating-scales/articles/slider) |

### Instructions

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Description | Rich instructional display | Context, examples, scope, and dynamic summaries | Does not collect input; avoid exposing sensitive merged values | [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields) |
| Audio Embed | Embedded audio display | Approved instructions or demonstrations | Use approved sources; verify accessibility and autoplay behavior | [Audio Embed](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/instructions/articles/audio-embed) |
| Video Embed | Embedded video display | Approved demonstrations or instructions | Use approved sources and captions; verify responsive behavior | [Video Embed](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/instructions/articles/video-embed) |
| PDF Embed | Embedded PDF display | Terms, manuals, or reference material | Confirm mobile readability and keep the source document version-controlled | [PDF Embed](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/instructions/articles/pdf-embed) |
| Map Location | Fixed map display | Show a known venue or office | Display only; use Address or GeoComplete to collect a respondent's location | [Map Location](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/instructions/articles/map-location) |
| Image Slider | Image carousel display | Visual instructions or examples | Provide alt text; control image size, ownership, and versioning | [Image Slider](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/instructions/articles/image-slider) |

### Identifier

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Unique ID | Sequential generated identifier | Human-readable entry references | Not a secret or authorization token; downstream idempotency still requires an authoritative receipt key | [Unique ID](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/identifier/articles/unique-id) |
| Random ID | Random generated identifier | Non-sequential entry references | Documented length is limited and optional non-repetition may be plan-dependent; do not use as a security credential | [Random ID](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/identifier/articles/random-id) |

### Legal & Consent

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Terms and Conditions | Terms display plus acceptance | Terms, privacy disclosures, and declarations | Version the exact text and record trusted acceptance metadata downstream; legal sufficiency requires separate review | [Terms and Conditions](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/legal-consent/articles/terms-and-conditions-field) |
| Signature | Handwritten-style signature capture | Acknowledgments where a drawn signature is appropriate | A signature image alone is not a complete contract workflow; define identity, intent, evidence, retention, and legal requirements | [Signature](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/legal-consent/articles/signature-field) |
| Zoho Sign | Zoho Sign document signing within the form | Formal signature workflows based on a PDF template | Requires mapped recipient name/email and a governed Zoho Sign template; distinguish from the separate Zoho Sign integration | [Zoho Sign Field](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/legal-consent/articles/field-zoho-sign) |
| Decision Box | Single checkbox decision | Explicit agreement to one statement | Keep each material confirmation separate and mandatory when required | [Legal & Consent](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/legal-consent) |
| Yes/No | Binary two-option input | Explicit yes/no decisions | Exactly two choices; no default for material consent or authorization unless intentionally approved | [Yes/No](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/legal-consent/articles/yes-no) |

### Page Elements

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Section | Labeled grouping | Organize related fields on one page | Does not collect data | [Page Elements](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/page-elements) |
| Heading | Styled display heading | Introduce a page or group with stronger visual hierarchy | Does not collect data; not supported in Card Forms | [Heading](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/page-elements/articles/heading-field) |
| Page Break | Multi-page boundary | Break a long form into sequential steps | Test page rules, back navigation, save/resume, and analytics | [Page Elements](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/page-elements) |
| Divider | Visual line | Separate nearby content without a label | Does not collect data; latest-version and form-type limits may apply | [Divider](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/page-elements/articles/divider-field) |
| Spacer | Vertical whitespace | Improve readability without a visible separator | Does not collect data; avoid excessive vertical length | [Page Elements](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/page-elements) |

### Prefill

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Webhook | Search-triggered dynamic prefill from an external service | Controlled lookup against an API or service | Supports GET/POST, connections, request body, URL parameters, and custom headers. Prefer POST body plus managed authentication for sensitive lookups | [Prefill-Webhook](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/prefill/articles/prefill-webhook) |
| Zoho Sheet | Search-triggered dynamic prefill from a worksheet | Low-code lookup against a governed sheet | Do not use a sheet as the security boundary or authoritative customer record unless explicitly approved | [Prefill-Zoho Sheet](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/prefill/articles/prefill-zoho-sheet) |

Zoho currently permits only one Prefill field per form. A Prefill field and a Zoho CRM field cannot coexist in the same form. Verify current plan search-credit limits before launch. See [Prefill Fields Overview](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/prefill/articles/prefill-fields-overview).

### Repeatable Subforms

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Inline | Repeated child rows displayed horizontally | Small repeated records with few short fields | Verify mobile layout, row limits, child mapping, and downstream schema | [Subform](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/repeatable-subforms/articles/subform) |
| Popup | Repeated child entries edited in a modal | Larger repeated records where a compact summary is preferred | Define the entry summary and test accessibility | [Subform](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/repeatable-subforms/articles/subform) |
| Vertical | Repeated child blocks stacked vertically | Repeated records best completed as full blocks | Latest-theme restrictions may apply; test long-form usability | [Subform](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/repeatable-subforms/articles/subform) |

### Advanced

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Zoho CRM | CRM lookup/prefill and supported update/related-list actions | Private, permissioned CRM-assisted forms or CRM-distributed prefilled forms | Do not expose unrestricted CRM record search on a generic public form; a CRM field cannot coexist with a Prefill field | [Zoho CRM Field](https://help.zoho.com/portal/en/kb/forms/integrations/zoho-crm/articles/zoho-crm-field) |
| Payment | Payment initiation through supported gateways | Approved one-time or recurring payment collection | Payment transport success is not authoritative settlement; reconcile gateway status and keep financial credentials out of the form and repository | [Payment Field](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/advanced/articles/payment-field) |

### AI

| Element | Behavior | Appropriate Use | Control Notes | Official Reference |
|---|---|---|---|---|
| Smart Scan | AI/OCR image extraction into mapped fields | Optional document-assisted data entry | Extracted values remain editable and untrusted; do not use for unsupported sensitive documents, identity proofing, or automatic approval | [Smart Scan](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/ai/articles/smart-scan) |

## Prefill And Lookup Decision Standard

Use the least exposed mechanism that meets the workflow.

| Method | Use | Security Position |
|---|---|---|
| Field Alias / query-string prefill | Low-sensitivity convenience values only | Values are placed in the URL. Never use for PII, CRM IDs, access codes, tokens, authorization state, or customer-specific routing data |
| Static Prefill URL | Fixed, controlled scenarios | Better concealment than readable aliases, but the link is persistent and reusable. Do not treat it as identity proof or a per-customer secure session |
| Prefill-Webhook | Dynamic customer-specific lookup | Preferred builder mechanism when a server must authorize the lookup and return an allowlisted response |
| Prefill-Zoho Sheet | Simple governed worksheet lookup | Suitable only when the sheet is an approved source and the lookup does not expose records to unauthorized respondents |
| Zoho CRM Field | Permissioned CRM lookup | Prefer private organizational use or CRM-distributed flows; do not expose generic public record discovery |

For a sensitive external setup form:

1. use a generic form URL with no PII, record IDs, codes, or tokens in the query string;
2. verify the respondent before returning customer-specific data;
3. send Prefill-Webhook input by POST request body rather than URL parameters;
4. use a managed Connection or supported custom authorization header;
5. return only allowlisted display/edit fields plus, if required, a short-lived opaque session reference;
6. never return CRM record IDs or server-controlled statuses to the browser unless there is a documented, unavoidable requirement;
7. treat all prefilled, disabled, hidden, calculated, and submitted values as untrusted;
8. re-resolve the authoritative records and revalidate every rule on submission; and
9. revoke or consume one-time access after successful acceptance.

## Form Security And Privacy Baseline

### Public Access

- Enable CAPTCHA for public forms. Zoho supports its own CAPTCHA and Google reCAPTCHA options; verify compatibility with the selected embed method.
- Use Email OTP, SMS OTP, or another approved identity step where the form exposes customer-specific data.
- Set OTP expiration, resend limits, resend delay, and OTP-validated form expiration.
- Map the verified address or number into the corresponding field and disable edits when it is an identity factor.
- Use a neutral error message that does not reveal whether a customer, email, phone number, deal, or access record exists.

### Sensitive Fields

Use **Mark as Personal** for information relating to an identifiable person. Use **Encrypt** for sensitive values that the workflow does not need to search, sort, or broadly export.

Field-level encryption has plan, field-count, filtering, reporting, and irreversibility implications. Test integrations and reporting before launch. Full Form Encryption has broader restrictions and should not be enabled until the entire automation path is validated.

Never place secrets, credentials, tokens, private keys, payment credentials, access codes, or raw production logs in form configuration, GitHub, browser JavaScript, URLs, notification templates, PDFs, or screenshots.

### Trusted Values

Generate and enforce these downstream, not in browser-controlled fields:

- authoritative record IDs;
- submission receipt IDs used for idempotency;
- trusted timestamps;
- consent, scope, and form-version values;
- authorization, signature, approval, payment, routing, test, deployment, or go-live statuses;
- usage limits and commercial controls; and
- audit and reconciliation metadata.

A hidden field is only hidden from the normal interface. It is not a trusted server value.

### Webhooks And Integrations

- Send an allowlisted payload; never forward every field by default.
- Authenticate webhooks or use the strongest supported connection mechanism.
- Enforce schema, type, length, enum, and relationship validation downstream.
- Prevent blank values from unintentionally clearing populated authoritative fields.
- Deduplicate and reject replayed submissions.
- Persist receipt state before applying external side effects.
- Read the authoritative system after a timeout before retrying.
- Distinguish form submission, internal acceptance, approval, signature, payment, and go-live states.
- Exclude sensitive fields from email notifications, PDFs, analytics, and logs unless explicitly required and approved.
- Do not rely on a direct native integration as the sole security boundary for a multi-record or authorization-sensitive workflow.

## Field Dictionary Requirement

For each adopted form field, record:

- form and page;
- display label and reference/link name;
- exact field type and child/component schema;
- business purpose;
- authoritative destination;
- required, optional, conditional, hidden, disabled, or display-only state;
- exact choices and assigned values;
- default or prefilled value;
- browser validation and downstream validation;
- sensitivity, personal-data classification, and encryption;
- conditional rules;
- prefill source and exposure;
- downstream mapping and blank-overwrite behavior;
- retention and deletion rule; and
- synthetic test cases.

## Validation Checklist

Test with synthetic data before accepting real submissions:

- every required, optional, conditional, disabled, hidden, prefilled, repeated, file, signature, and date field;
- every page, section, field rule, form rule, and back-navigation path;
- desktop, tablet, mobile, iframe, and JavaScript embed behavior;
- accessibility, label clarity, error messages, and focus order;
- CAPTCHA, OTP expiry, resend limits, session expiry, and neutral error behavior;
- valid, invalid, expired, reused, tampered, and replayed access attempts;
- webhook authentication, request body, response mapping, timeout, duplicate, and partial-failure behavior;
- zero, one, and multiple authoritative-record matches;
- blank-value overwrite protection;
- authoritative timestamp, version, status, and ID generation;
- attachment type, size, retention, and access;
- notification, PDF, report, export, encryption, and role access;
- signature decline, expiry, void, and callback behavior where applicable;
- plan, wallet-credit, field-count, storage, and attachment limits; and
- rollback by disabling access or integration without deleting evidence.

Record only sanitized test outcomes in GitHub.

## Official Sources

- [Zoho Forms Overview](https://help.zoho.com/portal/en/kb/forms/overview/articles/zoho-forms-welcomes-you)
- [Field Types Overview](https://help.zoho.com/portal/en/kb/forms/field-types/overview/articles/field-types-overview)
- [Form Fields](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/overview/articles/form-fields)
- [Field Properties](https://help.zoho.com/portal/en/kb/forms/field-types/field-properties/articles/field-properties)
- [Prefill Fields Overview](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/prefill/articles/prefill-fields-overview)
- [Prefill-Webhook](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/prefill/articles/prefill-webhook)
- [Prefill-Zoho Sheet](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/prefill/articles/prefill-zoho-sheet)
- [Zoho CRM Field](https://help.zoho.com/portal/en/kb/forms/integrations/zoho-crm/articles/zoho-crm-field)
- [Webhook Configuration](https://help.zoho.com/portal/en/kb/forms/integrations/webhooks/articles/webhook-configuration)
- [Email OTP Verification](https://help.zoho.com/portal/en/kb/forms/form-settings/privacy-features/otp-verification/articles/otp-verification-via-email)
- [OTP Expiry Settings](https://help.zoho.com/portal/en/kb/forms/form-settings/privacy-features/otp-verification/articles/otp-expiry-settings)
- [CAPTCHA](https://help.zoho.com/portal/en/kb/forms/form-settings/privacy-features/captcha/articles/including-captcha)
- [Personal And Encrypted Fields](https://help.zoho.com/portal/en/kb/forms/form-settings/privacy-features/personal-and-encrypted-fields/articles/personal-encrypted-fields-overview)
- [Form Encryption](https://help.zoho.com/portal/en/kb/forms/form-settings/compliance-audit/form-encryption/articles/form-encryption)
- [Zoho Sign Field](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/legal-consent/articles/field-zoho-sign)
- [Subform](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/repeatable-subforms/articles/subform)
- [Payment Field](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/advanced/articles/payment-field)
- [Smart Scan](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/ai/articles/smart-scan)

## Exclusions

This public reference intentionally excludes live form names, links, field dictionaries, aliases, respondent data, prefill values, customer records, submission exports, files, payment details, approval participants, notification addresses, webhook endpoints, connection names, credentials, internal identifiers, and organization-specific rules.

Plan features, limits, integration behavior, and UI labels can change. Verify them in the intended tenant before adoption.
