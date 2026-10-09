# Requested service-area text validation

Status: proposed source-only Creator On Validate workflow. This is not installed, deployed, or a functional portal request acceptance path. Creator owns this field-level normalization; CRM remains authoritative for company relationships and current service area. The existing four-field planner and identity contract are unchanged.

## Intended native binding

- Workflow name: **Validate Requested Service Area**.
- Product and target: the existing Creator Development `Company_Settings_Requests` form.
- Event: **Created or Edited → On Validate**, each submission. No schedule or helper function.
- Source: [`native/requested-service-area-on-validate.deluge`](native/requested-service-area-on-validate.deluge).
- Input: existing required `Requested_Service_Area` MULTI_LINE field, TEXT or null. Existing field typing is required; do not coerce another type into text. Deluge `isText()` is unsuitable because it rejects numeric text such as `123`.
- Effects: cancel invalid input; assign only the validated normalized requested text. No other form field, record, company setting, status, permission, connection, notification, billing state, or external system is touched.
- Privacy: generic alerts only; no input, company, actor, or provider logging.

## Exact text contract

CRLF and CR become LF before trimming. Trim uses the explicit ECMAScript whitespace set: U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. Do not substitute Deluge `trim()` or a generic `\s` class.

Reject blank text and the exact prohibited controls U+0000–0008, U+000B, U+000C, U+000E–001F and U+007F after trimming. Internal tab and LF are allowed. Edge VT/FF are trimmed; internal VT/FF are rejected. No forbidden control is silently cleaned from an accepted value.

The maximum is 2,000 Unicode code points after normalization, with no truncation. A regex `[\s\S]` match becomes one ASCII marker, then the markers are counted. Raw Deluge `length()` returned 2 for one supplementary-plane emoji in the native probe, so it cannot implement this limit directly. Combining marks and ZWJ components count separately, matching JavaScript spread rather than visible graphemes.

Trailing trim must use absolute-end `\z`, not `$` or `\Z`. Native probing found that `$` can match before final NEL U+0085, incorrectly removing preceding whitespace. This could conceal a prohibited VT or shrink 2,001 code points to 2,000. The strict anchor preserves `x + SPACE + NEL`, rejects `x + VT + NEL`, and rejects `1999 x + SPACE + NEL` at 2,001 code points.

Normalization is deterministic and idempotent. It is not durable request idempotency, duplicate prevention, or a success receipt. The workflow has no dry-run switch; keep it uninstalled until its specific binding and test are authorized.

## Reproducible checks and native evidence

The generator imports the existing `validateRequestedServiceArea` source as its oracle and extracts the actual validation statements from the Deluge file. No duplicate source snapshot or generated fixture bundle is committed.

```sh
node --check src/zoho-creator/client-portal/company-settings-requests/native/build-native-fixtures.js
node --test src/zoho-creator/client-portal/company-settings-requests/test/native-service-area-validation.test.js
node --test src/zoho-creator/client-portal/company-settings-requests/test/service-area-request-contract.test.js
node src/zoho-creator/client-portal/company-settings-requests/native/build-native-fixtures.js --emit-tryout > /tmp/service-area-native-probe.ds
```

The existing canonical/CI entrypoint imports the new focused tests. Run the repository's canonical `tools/verify.cmd` on Windows, or `pwsh -NoProfile -File ./tools/verify.ps1` on Linux/macOS with PowerShell 7, before handoff. Source checks are not a Deluge emulator.

Native receipt, **2026-10-07**, official Deluge Tryout, pure synthetic computation only:

- Unicode probe: raw emoji length 2; regex marker counts 1, 3, 2000 and 2001.
- Original 167-case suite passed but missed the final-NEL defect; that result is superseded.
- Separate three-case probe reproduced the `$` defect and verified strict `\z` preservation and rejection.
- Corrected full program executed once, unchanged: **Function Executed Successfully; TOTAL=170, PASS=170, FAIL=0**, with no failure IDs displayed.
- Exact generated program SHA256: `7d25ea4c343d219f9d9d14bc9f177c716d06630cb17a0bf5e19482b313e30367`. A regression test enforces byte-for-byte reproduction of this receipt.
- Oracle at that observation: source ref `329d47c4`, blob `dc24f6414272657abf0ee57e160a019ef5a9590c`. Future contract changes require new native evidence when generated output changes.
- Local checks cover all 170 cases and exhaustive explicit trim/control classification over 65,536 BMP code units. Independent review confirmed exact source provenance and matching candidate/probe transformations.

Only comments were expanded in the committed workflow header after the native test. The validation statements and generated native program remain identical. The full workflow wrapper still requires Creator-specific syntax/event verification.

## Manual acceptance and containment

Before an authorized Development-only installation, revalidate the exact application/environment/form, field type, workflow inventory and every active create/edit/import/API path. Capture the prestate and review the intended event attachment and source. Do not duplicate an existing validator, change portal access, or infer authority from this source PR.

After installation, independently read back the exact saved source and event. Use separately authorized synthetic inputs to verify null/blank rejection, CRLF/CR/tab normalization, edge versus internal controls, 2,000/2,001 emoji boundaries, and all three final-NEL regressions. Verify invalid submissions persist nothing and valid normalized text is read back exactly; check unchanged before-image/status/account and repeated-trigger behavior. Establish runtime-error and workflow-skip behavior for the actual native write paths before relying on this guard.

For source-only rollback, close the draft or revert these files; no live rollback is needed. If later installed and a problem appears, disable only **Validate Requested Service Area**, restore its captured prestate if replacing an existing rule, and independently confirm containment. Do not delete requests, rewrite stored text, enable portal actions, or change grants as rollback. A Git revert cannot undo a native configuration change or previously accepted data.

## Explicit limits

Official Tryout proves the recorded pure text behavior, not Creator runtime equivalence, event attachment, null-field handling, rollback, workflow-skip enforcement, or form persistence. The suite covers well-formed Unicode strings; lone UTF-16 surrogate transport remains unverified. Other JavaScript input types remain rejected by the existing source validator; the native workflow relies on the already-typed multiline field.

No principal, company grant, authoritative baseline lookup, review transition, audit persistence, UNIQUE replay claim, durable acceptance, portal permission, customer delivery, launch, or billing behavior is added. Full request acceptance remains blocked on those independent gates.

## Official references

- [replaceAll regex versus literal mode](https://www.zoho.com/deluge/help/functions/string/replaceall.html)
- [length](https://www.zoho.com/deluge/help/functions/string/length.html), [trim](https://www.zoho.com/deluge/help/functions/string/trim.html), [hexToText](https://www.zoho.com/deluge/help/functions/string/hextotext.html), [isText](https://www.zoho.com/deluge/help/functions/common/istext.html)
- [Creator cancel submit](https://www.zoho.com/deluge/help/misc-statements/cancel-submit.html), [alert](https://www.zoho.com/deluge/help/client-functions/alert.html), [set field value](https://www.zoho.com/deluge/help/misc-statements/set-variable/set-field-value.html)
- [ECMAScript trim and string iteration](https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.trim)
