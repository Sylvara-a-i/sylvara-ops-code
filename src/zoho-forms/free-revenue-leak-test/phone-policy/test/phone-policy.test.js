"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { normalizeUsPhone, toUsNationalInput, formatUsPhoneDisplay, PhonePolicyError } = require("../us-phone-policy");
const fixture = require("./fixtures");
const root = path.resolve(__dirname, "../../../../..");
const f1 = path.join(root, "src/zoho-catalyst/revenue-leak-test-request-form/functions/revenue_leak_test_request_form");
const f2 = path.join(root, "src/zoho-catalyst/revenue-leak-test-setup-form/functions/revenue_leak_test_setup_form");
const legacy1 = require(path.join(f1, "lib/form-contract"));
const adapter1 = require(path.join(f1, "lib/phone-contract"));
const adapter2 = require(path.join(f2, "lib/phone-contract"));
const legacy2 = require(path.join(f2, "lib/form-contract"));
const security1 = require(path.join(f1, "lib/security"));
const snapshot2 = require(path.join(f2, "lib/snapshot"));
const OPTIONS = Object.freeze({ countryCode: "US" });
const BINDING = Object.freeze({
  submissionId: "synthetic-phone-001",
  prefillId: "11111111-1111-4111-8111-111111111111",
  configurationRevision: "a".repeat(40),
});
const PEPPER = "s".repeat(43);
const variants = ["2025550109", "12025550109", "+12025550109",
  "(202) 555-0109", "1 (202) 555-0109", "+1 202 555 0109", "202.555.0109"];
const invalid = ["", "5550109", "0205550109", "2021550109", "+442071838750",
  "+12025550109x12", "2025550109#12", "2025550109 ext 12",
  "++12025550109", "1+2025550109", "0012025550109", "20255501090",
  "２０２５５５０１０９", "202\u00a0555\u00a00109", "202\t5550109",
  "202\n5550109", "202/555/0109", "2025550109,2025550110", " ".repeat(31), 2025550109, {}, []];

function oldFingerprint1(formData) {
  return security1.submissionFingerprint(BINDING.submissionId, BINDING.prefillId,
    BINDING.configurationRevision, legacy1.normalizeFormData(formData), PEPPER);
}
function rawFingerprint2(values) {
  return snapshot2.fingerprintSubmission({ ...BINDING, values }, PEPPER);
}
function freshFingerprint1(formData, revision = BINDING.configurationRevision) {
  const prepared = adapter1.prepareCanonicalForm1Submission(
    formData, fixture.constants, fixture.receipt, OPTIONS);
  return security1.submissionFingerprint(BINDING.submissionId, BINDING.prefillId,
    revision, prepared.fingerprintValues, PEPPER);
}

test("function-local packaged policy copies are exactly the authoritative source", () => {
  const source = fs.readFileSync(path.join(__dirname, "../us-phone-policy.js"));
  for (const functionRoot of [f1, f2]) {
    assert.deepEqual(fs.readFileSync(path.join(functionRoot, "lib/us-phone-policy.js")), source);
    const adapter = fs.readFileSync(path.join(functionRoot, "lib/phone-contract.js"), "utf8");
    assert.equal(adapter.includes('require("./us-phone-policy")'), true);
    assert.equal(/require\(["']\.\.\//.test(adapter), false);
  }
});

test("existing runtime pure US parser and bounded shared policy agree on reviewed vectors", () => {
  const source = fs.readFileSync(path.join(root,
    "src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/free-test-preparation.js"), "utf8");
  const helper = source.match(/function usPhone\(value, countryCode, code\) \{[\s\S]*?\n\}/);
  assert.ok(helper);
  const previous = vm.runInNewContext(
    'function requireValue(ok, code) { if (!ok) throw new Error(code); }\n' +
    helper[0] + '\nusPhone');
  for (const value of variants) assert.equal(normalizeUsPhone(value, OPTIONS), previous(value, "US", "INVALID"));
  for (const value of invalid.filter(value => typeof value === "string" && value.length <= 30)) {
    assert.throws(() => previous(value, "US", "INVALID"));
    assert.throws(() => normalizeUsPhone(value, { ...OPTIONS, required: true }));
  }
});

test("equivalent display variants normalize, display round-trip, and are idempotent", () => {
  for (const value of variants) {
    const canonical = normalizeUsPhone(value, OPTIONS);
    assert.equal(canonical, "+12025550109");
    assert.equal(normalizeUsPhone(canonical, OPTIONS), canonical);
    assert.equal(formatUsPhoneDisplay(canonical, OPTIONS), "(202) 555-0109");
    assert.equal(normalizeUsPhone(formatUsPhoneDisplay(canonical, OPTIONS), OPTIONS), canonical);
  }
  assert.throws(() => formatUsPhoneDisplay("2025550109", OPTIONS),
    error => error.code === "PHONE_CANONICAL_REQUIRED");
});

test("unsupported foreign, extensions, Unicode and malformed input fail without lossy coercion", () => {
  for (const value of invalid) {
    assert.throws(() => normalizeUsPhone(value, { ...OPTIONS, required: true }),
      error => error instanceof PhonePolicyError);
  }
});

test("country context is explicit and not proof of geographical allocation or ownership", () => {
  for (const countryCode of [undefined, "", "CA", "US ", "us"]) {
    assert.throws(() => normalizeUsPhone("+12025550109", { countryCode }),
      error => error.code === "PHONE_COUNTRY_UNRESOLVED");
  }
  // A Canadian-area NANP syntax value is accepted under the declared context.
  // This deliberately proves the function is not an allocation/country lookup.
  assert.equal(normalizeUsPhone("+14165550109", OPTIONS), "+14165550109");
});

test("optional null/blank and required semantics remain explicit", () => {
  for (const value of [undefined, null, ""]) {
    assert.equal(normalizeUsPhone(value, OPTIONS), null);
    assert.throws(() => normalizeUsPhone(value, { ...OPTIONS, required: true }),
      error => error.code === "PHONE_REQUIRED");
  }
  assert.equal(formatUsPhoneDisplay(null, OPTIONS), null);
});

test("Form1 opt-in canonical payload and patch cover exactly its two phones", () => {
  const input = fixture.form1(); const before = structuredClone(input);
  const prepared = adapter1.prepareCanonicalForm1Submission(
    input, fixture.constants, fixture.receipt, OPTIONS);
  assert.deepEqual(input, before);
  assert.equal(prepared.crmPatch.Mobile, "+12025550109");
  assert.equal(prepared.crmPatch.Main_Business_Phone, "+12025550110");
  assert.deepEqual(adapter1.PHONE_FIELDS, ["mobilePhone", "companyPhone"]);
  const expected = legacy1.buildCrmPatch(input, fixture.constants, fixture.receipt);
  assert.deepEqual(prepared.crmPatch, { ...expected, Mobile: "+12025550109", Main_Business_Phone: "+12025550110" });
  assert.equal(Object.hasOwn(prepared.crmPatch, "Lead_Source"), false);
  for (const field of ["Email_Opt_Out", "Text_Opt_Out", "Lifecycle_Status"]) {
    assert.equal(Object.hasOwn(prepared.crmPatch, field), false);
  }
});

test("Form1 new-revision canonical equivalence does not change legacy/recovery normalization", () => {
  const fingerprints = variants.map(mobilePhone => freshFingerprint1(fixture.form1({ mobilePhone })));
  assert.equal(new Set(fingerprints).size, 1);
  assert.notEqual(freshFingerprint1(fixture.form1(), "b".repeat(40)), fingerprints[0]);
  assert.notEqual(freshFingerprint1(fixture.form1({ mobilePhone: "+12025550114" })), fingerprints[0]);
  assert.equal(oldFingerprint1(fixture.form1()), "bf41cb21839b04bca105c2418541b10bca950715e94efeae57d135e7f763d2a1");
  assert.notEqual(oldFingerprint1(fixture.form1()), oldFingerprint1(fixture.form1({ mobilePhone: "+12025550109" })));
  assert.equal(legacy1.normalizeFormData(fixture.form1()).Mobile, "(202) 555-0109");
  assert.equal(legacy1.buildCrmPatch(fixture.form1(), fixture.constants, fixture.receipt).Mobile, "(202) 555-0109");
});

test("Form1 adapter preserves exact input, consent and allowlist failures", () => {
  for (const override of [{ contactConsent: false }, { extra: "x" }, { mobilePhone: " 2025550109" },
    { companyPhone: "2025550110x2" }, { mobilePhone: "+442071838750" }]) {
    assert.throws(() => adapter1.canonicalizeForm1Submission(fixture.form1(override), OPTIONS));
  }
});

test("Form1 prefill adapts phones without mutating record or preselecting consent", () => {
  const record = { Mobile: "2025550109", Main_Business_Phone: "(202) 555-0110",
    Free_Test_Contact_Consent: true };
  const before = structuredClone(record);
  const prefill = adapter1.buildNationalForm1Prefill(record, fixture.constants, OPTIONS);
  assert.equal(prefill.mobilePhone, "2025550109");
  assert.equal(prefill.companyPhone, "2025550110");
  assert.equal(Object.hasOwn(prefill, "contactConsent"), false);
  assert.deepEqual(record, before);
});

test("Form2 updates canonicalize writable phones and preserve exact Contact.Mobile prestate", () => {
  const input = fixture.form2(); const options = fixture.form2Options();
  const beforeInput = structuredClone(input); const beforeRecords = structuredClone(options.existing);
  const updates = adapter2.validateCanonicalForm2Payload(input, options);
  assert.deepEqual(input, beforeInput); assert.deepEqual(options.existing, beforeRecords);
  assert.equal(Object.hasOwn(updates.contactUpdate, "Mobile"), false);
  assert.equal(Object.hasOwn(updates.contactUpdate, "Email"), false);
  assert.equal(options.existing.contact.Mobile, "2025550109");
  assert.equal(updates.accountUpdate.Phone, "+12025550110");
  assert.equal(updates.dealUpdate.Forwarding_Administrator_Mobile, "+12025550111");
  assert.equal(updates.dealUpdate.Approved_Fallback_Number, "+12025550112");
  assert.equal(updates.dealUpdate.Rollback_Contact_Mobile, "+12025550113");
  const old = legacy2.validateForm2Payload(input, options);
  assert.deepEqual(updates, { ...old,
    accountUpdate: { ...old.accountUpdate, Phone: "+12025550110" },
    dealUpdate: { ...old.dealUpdate, Forwarding_Administrator_Mobile: "+12025550111",
      Approved_Fallback_Number: "+12025550112", Rollback_Contact_Mobile: "+12025550113" } });
});

test("Form2 raw fingerprint protocol stays distinct from canonical write equivalence", () => {
  const a = fixture.form2();
  const b = fixture.form2({ mainBusinessNumber: "+12025550110" });
  assert.deepEqual(adapter2.validateCanonicalForm2Payload(a, fixture.form2Options()),
    adapter2.validateCanonicalForm2Payload(b, fixture.form2Options()));
  assert.notEqual(rawFingerprint2(a), rawFingerprint2(b));
  assert.equal(rawFingerprint2(a), "6bcb570412597ebb6b88677ac0b13998895120cfc387a9253fbbb629cc132ce5");
  assert.equal(rawFingerprint2(structuredClone(a)), rawFingerprint2(a));
});

test("Form2 direct-mobile changes, extensions and prohibited fields remain blocked", () => {
  assert.throws(() => adapter2.validateCanonicalForm2Payload(
    fixture.form2({ directMobileNumber: "+12025550114" }), fixture.form2Options()),
    error => error.publicCode === "mobile_reverification_required");
  for (const extra of [{ testPhoneNumber: "+12025550115" }, { alertRecipientMobile: "+12025550115" },
    { forwardingAdministratorMobile: "2025550111x2" }, { mainBusinessNumber: "+442071838750" }]) {
    assert.throws(() => adapter2.validateCanonicalForm2Payload(fixture.form2(extra), fixture.form2Options()));
  }
});

test("Form2 fallback applicability and native optional blanks are retained", () => {
  const updates = adapter2.validateCanonicalForm2Payload(fixture.form2({
    approvedFallbackDestination: "Voicemail", approvedFallbackNumber: "",
  }), fixture.form2Options());
  assert.equal(updates.dealUpdate.Approved_Fallback_Number, null);
  assert.throws(() => adapter2.validateCanonicalForm2Payload(fixture.form2({
    approvedFallbackDestination: "Voicemail", approvedFallbackNumber: "+12025550112",
  }), fixture.form2Options()));
  assert.throws(() => adapter2.validateCanonicalForm2Payload(fixture.form2({
    approvedFallbackDestination: "On-Call Mobile", approvedFallbackNumber: "",
  }), fixture.form2Options()));
});

test("Form2 new prefill projection is pure and leaves legacy snapshots unchanged", () => {
  const options = fixture.form2Options(); const records = options.existing;
  records.contact.Mobile = "+1 (202) 555-0109";
  const before = structuredClone(records);
  const old = legacy2.buildPrefillPayload(records, options);
  const fresh = adapter2.buildNationalForm2Prefill(records, options);
  assert.equal(old.directMobileNumber, "+1 (202) 555-0109");
  assert.equal(fresh.directMobileNumber, "2025550109");
  assert.equal(fresh.mainBusinessNumber, "2025550110");
  assert.equal(fresh.forwardingAdministratorMobile, null);
  assert.equal(fresh.approvedFallbackNumber, null);
  assert.equal(fresh.rollbackContactMobile, null);
  assert.notEqual(snapshot2.fingerprintSnapshot(old, PEPPER), snapshot2.fingerprintSnapshot(fresh, PEPPER));
  assert.deepEqual(records, before);
});


test("national prefill is exactly ten digits for every native phone and text control", () => {
  for (const value of variants) {
    const canonical = normalizeUsPhone(value, OPTIONS);
    assert.equal(toUsNationalInput(canonical, OPTIONS), "2025550109");
    assert.match(toUsNationalInput(canonical, OPTIONS), /^[0-9]{10}$/);
  }
  const context = fixture.records();
  Object.assign(context.deal, { Forwarding_Administrator_Mobile: "202-555-0111",
    Approved_Fallback_Destination: "On-Call Mobile", Approved_Fallback_Number: "202.555.0112",
    Rollback_Contact_Mobile: "+12025550113" });
  const prefill = adapter2.buildNationalForm2Prefill(context, fixture.form2Options());
  for (const key of adapter2.PHONE_FIELDS) assert.match(prefill[key], /^[0-9]{10}$/);
  assert.equal(prefill.mainBusinessNumber.length, 10);
  assert.equal(prefill.authorizedRepresentativeConfirmed, false);
  assert.equal(prefill.testScopeAccepted, false);
});

test("canonical predecessor proof binds exact original source hashes and rejects cross-pairs", () => {
  const { inspectOriginalPolicy, verifyRegistry } = require(path.join(root,
    "src/zoho-catalyst/revenue-leak-test-request-form/tools/verify-recovery-phone-policy"));
  const revision = "a".repeat(40);
  const read = (_root, observedRevision, filename) => {
    assert.equal(observedRevision, revision);
    return fs.readFileSync(path.join(f1, "lib", filename));
  };
  const entry = inspectOriginalPolicy(root, revision, read);
  assert.equal(verifyRegistry(root, [entry], read), 1);
  for (const patch of [{ phonePolicy: "legacy" }, { policyModuleSha256: "e".repeat(64) },
    { handlerModuleSha256: "f".repeat(64) }, { sourceRevision: "b".repeat(40) }]) {
    assert.throws(() => verifyRegistry(root, [{ ...entry, ...patch }], read));
  }
  assert.throws(() => inspectOriginalPolicy(root, revision,
    () => Buffer.from('"use strict"; module.exports = {};')));
  assert.throws(() => verifyRegistry(root, [entry, entry], read));
});

test("canonical verifier and both Form1 release paths include policy provenance", () => {
  const verify = fs.readFileSync(path.join(root, "tools/verify.ps1"), "utf8");
  assert.match(verify, /Forms phone policy and isolated packaging parity tests/);
  assert.match(verify, /Form 1 recovery phone-policy source provenance/);
  for (const tool of ["build-single-file.js", "build-release-artifact.js"]) {
    const source = fs.readFileSync(path.join(f1, "../../tools", tool), "utf8");
    assert.match(source, /verifyRegistry\(/);
  }
  for (const dir of [f1, f2]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    assert.match(pkg.scripts.check, /node --check lib\/us-phone-policy.js/);
    assert.match(pkg.scripts.check, /node --check lib\/phone-contract.js/);
  }
});

test("both isolated runtime dependency closures include local policy modules only", () => {
  for (const dir of [f1, f2]) {
    const visited = new Set();
    function visit(file) {
      assert.ok(file.startsWith(dir + path.sep));
      if (visited.has(file)) return;
      visited.add(file);
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
        if (!match[1].startsWith(".")) continue;
        const target = path.resolve(path.dirname(file), match[1] + ".js");
        visit(target);
      }
    }
    visit(path.join(dir, "index.js"));
    for (const name of ["phone-contract.js", "us-phone-policy.js"]) {
      assert.ok(visited.has(path.join(dir, "lib", name)), name);
    }
    if (dir === f1) {
      for (const name of ["recovery-phone-policy.js", "recovery-phone-policy-revisions.js"]) {
        assert.ok(visited.has(path.join(dir, "lib", name)), name);
      }
    }
  }
});

test("same-profile core or adapter drift fails compatibility even with an exact source pin", () => {
  const { inspectOriginalPolicy } = require(path.join(root,
    "src/zoho-catalyst/revenue-leak-test-request-form/tools/verify-recovery-phone-policy"));
  for (const drifted of ["phone-contract.js", "us-phone-policy.js"]) {
    assert.throws(() => inspectOriginalPolicy(root, "a".repeat(40), (_root, _revision, file) => {
      const original = fs.readFileSync(path.join(f1, "lib", file));
      return file === drifted ? Buffer.concat([original, Buffer.from("\n// different original policy\n")]) : original;
    }), /incompatible/);
  }
});

test("Git provenance ignores replacement objects and hostile inherited Git configuration", () => {
  const os = require("node:os"); const { execFileSync } = require("node:child_process");
  const { inspectOriginalPolicy, safeGitEnvironment } = require(path.join(root,
    "src/zoho-catalyst/revenue-leak-test-request-form/tools/verify-recovery-phone-policy"));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-policy-git-test-"));
  const functionRoot = path.join(temp, "src/zoho-catalyst/revenue-leak-test-request-form/functions/revenue_leak_test_request_form/lib");
  fs.mkdirSync(functionRoot, { recursive: true });
  const git = args => execFileSync("git", ["-C", temp, ...args], { encoding: "utf8",
    env: safeGitEnvironment(), stdio: ["ignore", "pipe", "pipe"] }).trim();
  const save = Object.fromEntries(["GIT_DIR", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_GLOBAL"].map(k => [k, process.env[k]]));
  try {
    git(["init", "-q"]);
    fs.writeFileSync(path.join(functionRoot, "phone-contract.js"), '"use strict"; module.exports = {};\n');
    fs.writeFileSync(path.join(functionRoot, "handler.js"), '"use strict"; module.exports = {};\n');
    fs.copyFileSync(path.join(f1, "lib/us-phone-policy.js"), path.join(functionRoot, "us-phone-policy.js"));
    const commit = message => { git(["add", "."]); git(["-c", "user.name=Synthetic QA",
      "-c", "user.email=synthetic@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", message]);
      return git(["rev-parse", "HEAD"]); };
    const legacy = commit("Synthetic legacy policy");
    for (const file of ["phone-contract.js", "handler.js", "us-phone-policy.js"]) {
      fs.copyFileSync(path.join(f1, "lib", file), path.join(functionRoot, file));
    }
    const canonical = commit("Synthetic canonical policy");
    git(["replace", legacy, canonical]);
    process.env.GIT_DIR = path.join(temp, "missing-hostile-git-dir");
    process.env.GIT_CONFIG_PARAMETERS = "invalid inherited Git configuration";
    process.env.GIT_CONFIG_GLOBAL = path.join(temp, "missing-hostile-config");
    const safe = safeGitEnvironment();
    assert.equal(safe.GIT_NO_REPLACE_OBJECTS, "1");
    assert.equal(Object.hasOwn(safe, "GIT_DIR"), false);
    assert.equal(Object.hasOwn(safe, "GIT_CONFIG_PARAMETERS"), false);
    assert.equal(inspectOriginalPolicy(temp, canonical).sourceRevision, canonical);
    assert.throws(() => inspectOriginalPolicy(temp, legacy), /does not declare/);
  } finally {
    for (const [key, value] of Object.entries(save)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
