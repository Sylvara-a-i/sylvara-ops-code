"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const functionRoot = path.resolve(__dirname, "..");
const controllerRoot = path.resolve(functionRoot, "../..");
const repositoryRoot = path.resolve(controllerRoot, "../../..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sorted(values) {
  return [...values].sort();
}

function walkFiles(root, relativeDirectory = "") {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const files = [];
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = path.posix.join(
      relativeDirectory.split(path.sep).join(path.posix.sep),
      entry.name,
    );
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function matchesManifestIgnore(relativePath, patterns) {
  const normalized = relativePath.split(path.sep).join(path.posix.sep);
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) {
      const directory = pattern.slice(0, -3).replace(/\/$/, "");
      return normalized === directory || normalized.startsWith(`${directory}/`);
    }
    if (pattern.endsWith("*") && !pattern.slice(0, -1).includes("*")) {
      const prefix = pattern.slice(0, -1);
      return pattern.includes("/")
        ? normalized.startsWith(prefix)
        : path.posix.basename(normalized).startsWith(prefix);
    }
    return normalized === pattern;
  });
}

test("the public variable registry and placeholder environment file stay in lockstep", () => {
  const registryPath = path.resolve(functionRoot, "../../config/variables.json");
  const registry = readJson(registryPath);
  const names = registry.variables.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    Object.fromEntries(
      registry.variables
        .filter((entry) => entry.name.endsWith("TABLE_NAME"))
        .map((entry) => [entry.name, entry.safe_default]),
    ),
    {
      SESSION_TABLE_NAME: "Form2SessionsV3Runtime",
      PREFILL_TABLE_NAME: "Form2PrefillsV3",
      SUBMISSION_TABLE_NAME: "Form2SubmissionsV3",
      FORM2_PROOF_TABLE_NAME: "Form2VerificationProofsV3",
    },
  );

  const exampleNames = fs.readFileSync(path.join(functionRoot, ".env.example"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.slice(0, line.indexOf("=")));
  assert.deepEqual([...names].sort(), [...exampleNames].sort());
  const example = fs.readFileSync(path.join(functionRoot, ".env.example"), "utf8");
  for (const tableName of [
    "Form2SessionsV3Runtime",
    "Form2PrefillsV3",
    "Form2SubmissionsV3",
    "Form2VerificationProofsV3",
  ]) {
    assert.match(example, new RegExp(`=${tableName}$`, "m"));
  }

  assert.doesNotMatch(example, /Zoho-oauthtoken|client_secret|refresh_token|@/i);
  assert.equal(registry.variables.filter((entry) => entry.classification.includes("secret"))
    .every((entry) => entry.example_allowed === false), true);
});

test("the Data Store schema matches the runtime and Catalyst uniqueness boundary", () => {
  const schemaPath = path.join(controllerRoot, "config/datastore-schema.json");
  const schema = readJson(schemaPath);
  const { STORED_FIELDS } = require("../lib/session-store");
  const {
    PREFILL_STORED_FIELDS,
    SUBMISSION_STORED_FIELDS,
  } = require("../lib/workflow-store");
  const { PROOF_STORED_FIELDS } = require("../lib/verification-proof-store");
  const runtimeFields = new Map([
    ["SESSION_TABLE_NAME", STORED_FIELDS],
    ["PREFILL_TABLE_NAME", PREFILL_STORED_FIELDS],
    ["SUBMISSION_TABLE_NAME", SUBMISSION_STORED_FIELDS],
    ["FORM2_PROOF_TABLE_NAME", PROOF_STORED_FIELDS],
  ]);
  const expectedUniqueColumns = new Map([
    ["SESSION_TABLE_NAME", ["ISSUE_REQUEST_KEY", "DEAL_ISSUANCE_KEY"]],
    ["PREFILL_TABLE_NAME", ["PREFILL_KEY"]],
    ["SUBMISSION_TABLE_NAME", ["SUBMISSION_KEY"]],
    ["FORM2_PROOF_TABLE_NAME", ["PROOF_KEY"]],
  ]);

  assert.equal(schema.status, "development-provisioned-schema-verified-not-cut-over");
  assert.equal(
    schema.live_state,
    "retell-development-four-v3-runtime-targets-schema-verified-empty-probes-quarantined-callers-not-cut-over",
  );
  assert.equal(schema.observed_at, "2026-08-24");
  assert.deepEqual(
    schema.observed_development_readback.operational_targets.map((target) => [
      target.api_name,
      target.application_columns,
      target.rows,
    ]),
    [
      ["Form2SessionsV3Runtime", 20, 0],
      ["Form2PrefillsV3", 19, 0],
      ["Form2SubmissionsV3", 16, 0],
      ["Form2VerificationProofsV3", 26, 0],
    ],
  );
  assert.equal(schema.observed_development_readback.total_application_columns, 81);
  assert.equal(schema.observed_development_readback.unique_columns, 5);
  assert.equal(schema.observed_development_readback.audit_consent_columns, 25);
  assert.equal(schema.observed_development_readback.schema_mismatches, 0);
  assert.equal(schema.observed_development_readback.app_user_permissions_per_target, 0);
  assert.equal(schema.observed_development_readback.runtime_bound, false);
  assert.deepEqual(
    schema.quarantined_unbound_probe_artifacts.map((artifact) => [
      artifact.api_name,
      artifact.application_column_count,
      artifact.rows,
      artifact.app_user_permissions,
    ]),
    [
      ["Form2SessionsV3", 1, 0, 0],
      ["ZZZ_Quarantined_Form2SessionsV3_ColumnProbe", 3, 0, 0],
      ["ZZZ_Quarantined_Form2SessionsV3_TypeProbe", 0, 0, 0],
    ],
  );
  assert.match(schema.probe_policy, /Never bind, rename, reuse, or delete/);

  assert.equal(schema.tables.length, 4);
  assert.equal(
    schema.tables.reduce((total, table) => total + table.columns.length, 0),
    81,
  );
  assert.deepEqual(
    sorted(schema.tables.map((table) => table.runtime_variable)),
    sorted(runtimeFields.keys()),
  );
  assert.deepEqual(
    schema.tables.map((table) => table.expected_api_name),
    [
      "Form2SessionsV3Runtime",
      "Form2PrefillsV3",
      "Form2SubmissionsV3",
      "Form2VerificationProofsV3",
    ],
  );

  for (const table of schema.tables) {
    const columns = new Map(table.columns.map((column) => [column.api_name, column]));
    assert.equal(columns.size, table.columns.length, `${table.runtime_variable} has duplicate columns`);
    assert.equal(columns.has("ROWID"), false, "ROWID is generated by Catalyst, not provisioned");

    const exportedFields = runtimeFields.get(table.runtime_variable);
    assert.ok(exportedFields, `unexpected runtime variable ${table.runtime_variable}`);
    assert.equal(exportedFields.filter((field) => field === "ROWID").length, 1);
    assert.deepEqual(
      sorted(exportedFields.filter((field) => field !== "ROWID")),
      sorted(columns.keys()),
      `${table.runtime_variable} runtime and provisioned fields differ`,
    );

    const expectedUnique = expectedUniqueColumns.get(table.runtime_variable);
    assert.deepEqual(sorted(table.required_unique_columns), sorted(expectedUnique));
    assert.deepEqual(
      sorted(table.columns.filter((column) => column.unique).map((column) => column.api_name)),
      sorted(expectedUnique),
      `${table.runtime_variable} has an undeclared or missing unique column`,
    );
    for (const key of table.required_unique_columns) {
      assert.equal(columns.get(key)?.mandatory, true);
      assert.equal(columns.get(key)?.unique, true);
    }
    assert.ok(
      table.columns.filter((column) => column.type === "varchar" && column.unique).length <= 2,
      `${table.runtime_variable} exceeds Catalyst's verified unique varchar limit`,
    );
  }
  const sessionTable = schema.tables.find(
    (table) => table.runtime_variable === "SESSION_TABLE_NAME",
  );
  const sessionColumns = new Map(
    sessionTable.columns.map((column) => [column.api_name, column]),
  );
  assert.deepEqual(sessionColumns.get("DEAL_ISSUANCE_KEY"), {
    api_name: "DEAL_ISSUANCE_KEY",
    type: "varchar",
    max_length: 64,
    mandatory: true,
    unique: true,
    pii_ephi: true,
  });
  assert.deepEqual(sessionColumns.get("ISSUE_REQUEST_KEY"), {
    api_name: "ISSUE_REQUEST_KEY",
    type: "varchar",
    max_length: 64,
    mandatory: true,
    unique: true,
    pii_ephi: true,
  });
  assert.deepEqual(sessionColumns.get("ACCESS_TOKEN_HASH"), {
    api_name: "ACCESS_TOKEN_HASH",
    type: "varchar",
    max_length: 64,
    mandatory: true,
    unique: false,
    pii_ephi: true,
  });
  assert.equal(sessionColumns.has("TOKEN_HASH"), false);
  assert.equal(sessionColumns.has("ISSUE_KEY"), false);
  assert.equal(sessionColumns.get("LAST_OUTCOME").pii_ephi, true);
  assert.match(sessionTable.retention, /Do not delete or alter any session row/);
  assert.equal(schema.deployment_gates.some((gate) =>
    gate.includes("four exact empty operational targets") && gate.includes("Never rename")), true);
  assert.equal(
    schema.deployment_gates.some((gate) =>
      gate.includes("LAST_OUTCOME") && gate.includes("read back")),
    true,
  );
  assert.equal(
    schema.deployment_gates.some((gate) =>
      gate.includes("preserve every legacy Setup Form") && gate.includes("operational targets")),
    true,
  );
  assert.equal(JSON.stringify(schema).includes("RAW_PAYLOAD"), false);
});

test("the Catalyst and npm manifests describe one consistent Advanced IO target", () => {
  const catalyst = readJson(path.join(controllerRoot, "catalyst.json"));
  assert.deepEqual(catalyst, {
    functions: {
      source: "functions",
      targets: ["revenue_leak_test_setup_form"],
      ignore: ["test/**", ".env*"],
    },
  });

  const sourceRoot = path.join(controllerRoot, catalyst.functions.source);
  const targetRoot = path.join(sourceRoot, catalyst.functions.targets[0]);
  assert.equal(path.resolve(targetRoot), functionRoot);
  assert.equal(fs.statSync(sourceRoot).isDirectory(), true);
  assert.equal(fs.statSync(targetRoot).isDirectory(), true);

  const catalystConfigPath = path.join(targetRoot, "catalyst-config.json");
  const packagePath = path.join(targetRoot, "package.json");
  const packageLockPath = path.join(targetRoot, "package-lock.json");
  const catalystConfig = readJson(catalystConfigPath);
  const packageJson = readJson(packagePath);
  const packageLock = readJson(packageLockPath);

  assert.deepEqual(catalystConfig, {
    deployment: {
      name: "revenue_leak_test_setup_form",
      stack: "node24",
      type: "advancedio",
    },
    execution: { main: "index.js" },
  });
  assert.equal(catalystConfig.deployment.name, catalyst.functions.targets[0]);
  const expectedRuntimeSources = [
    "index.js",
    "lib/access-page.js",
    "lib/catalyst-adapter.js",
    "lib/catalyst-datastore-adapter.js",
    "lib/catalyst-mail.js",
    "lib/config.js",
    "lib/connection-boundary.js",
    "lib/crm-client.js",
    "lib/destinations.js",
    "lib/form-destination.js",
    "lib/form-contract.js",
    "lib/handler.js",
    "lib/http.js",
    "lib/operation-timeout.js",
    "lib/safe-log.js",
    "lib/security.js",
    "lib/session-store.js",
    "lib/snapshot.js",
    "lib/source-revision.js",
    "lib/v2-reconciliation.js",
    "lib/verification-proof.js",
    "lib/verification-proof-store.js",
    "lib/verification-service.js",
    "lib/workflow-store.js",
  ];
  const expectedCheckScript = expectedRuntimeSources
    .map((sourceFile) => `node --check ${sourceFile}`)
    .join(" && ");
  assert.deepEqual(packageJson, {
    name: "sylvara-revenue-leak-test-setup-form",
    version: "0.1.0",
    private: true,
    description: "Development-blocked RevenueLeakTestSetupForm prefill and submission handler for Zoho Catalyst.",
    main: "index.js",
    type: "commonjs",
    engines: { node: "24.x" },
    scripts: {
      check: expectedCheckScript,
      test: "node --test test/*.test.js",
      ci: "npm run check && npm test",
    },
    dependencies: { "zcatalyst-sdk-node": "3.4.0" },
  });
  assert.equal(packageJson.main, catalystConfig.execution.main);

  assert.deepEqual(sorted(Object.keys(packageLock)), sorted([
    "name",
    "version",
    "lockfileVersion",
    "requires",
    "packages",
  ]));
  assert.equal(packageLock.lockfileVersion, 3);
  assert.equal(packageLock.requires, true);
  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.version, packageJson.version);
  assert.deepEqual(packageLock.packages[""], {
    name: packageJson.name,
    version: packageJson.version,
    dependencies: packageJson.dependencies,
    engines: packageJson.engines,
  });
  assert.deepEqual(sorted(Object.keys(packageLock.packages)), sorted([
    "",
    "node_modules/agent-base",
    "node_modules/debug",
    "node_modules/https-proxy-agent",
    "node_modules/ms",
    "node_modules/zcatalyst-sdk-node",
  ]));
  for (const [packagePath, metadata] of Object.entries(packageLock.packages)) {
    assert.notEqual(metadata.hasInstallScript, true, `${packagePath} has an install script`);
    assert.equal(metadata.link, undefined, `${packagePath} is a linked dependency`);
    if (packagePath !== "") {
      assert.match(metadata.resolved, /^https:\/\/registry\.npmjs\.org\//);
      assert.match(metadata.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
    }
  }
  assert.equal(packageLock.packages["node_modules/zcatalyst-sdk-node"].version, "3.4.0");
  assert.match(
    packageLock.packages["node_modules/zcatalyst-sdk-node"].resolved,
    /\/zcatalyst-sdk-node-3\.4\.0\.tgz$/,
  );
  assert.match(
    packageLock.packages["node_modules/zcatalyst-sdk-node"].integrity,
    /^sha512-[A-Za-z0-9+/]+=*$/,
  );

  for (const referencedFile of [
    catalystConfig.execution.main,
    "catalyst-config.json",
    "package.json",
    "package-lock.json",
  ]) {
    assert.equal(
      fs.statSync(path.join(targetRoot, referencedFile)).isFile(),
      true,
      `${referencedFile} is missing`,
    );
  }

  const runtimeSources = walkFiles(targetRoot)
    .filter((relativePath) => relativePath === "index.js" || /^lib\/.*\.js$/.test(relativePath));
  assert.deepEqual(sorted(runtimeSources), sorted(expectedRuntimeSources));
  for (const sourceFile of expectedRuntimeSources) {
    assert.equal(fs.statSync(path.join(targetRoot, sourceFile)).isFile(), true);
  }
});

test("the intended function archive excludes tests and environment files", () => {
  const catalyst = readJson(path.join(controllerRoot, "catalyst.json"));
  const targetRoot = path.join(
    controllerRoot,
    catalyst.functions.source,
    catalyst.functions.targets[0],
  );
  const allFiles = walkFiles(targetRoot);
  const archiveFiles = allFiles.filter(
    (relativePath) => !matchesManifestIgnore(relativePath, catalyst.functions.ignore),
  );

  assert.ok(allFiles.includes("test/registry.test.js"));
  assert.ok(allFiles.includes(".env.example"));
  assert.equal(archiveFiles.some((relativePath) => relativePath.startsWith("test/")), false);
  assert.equal(
    archiveFiles.some((relativePath) => path.posix.basename(relativePath).startsWith(".env")),
    false,
  );

  for (const requiredFile of [
    "index.js",
    "catalyst-config.json",
    "package.json",
    "package-lock.json",
  ]) {
    assert.ok(archiveFiles.includes(requiredFile), `${requiredFile} is absent from the archive`);
  }
  const runtimeLibraries = allFiles.filter((relativePath) => /^lib\/.*\.js$/.test(relativePath));
  assert.ok(runtimeLibraries.length > 0);
  for (const runtimeLibrary of runtimeLibraries) {
    assert.ok(archiveFiles.includes(runtimeLibrary), `${runtimeLibrary} is absent from the archive`);
  }
});

test("the route manifest exposes exactly the six reviewed fail-closed routes", () => {
  const manifest = readJson(path.join(controllerRoot, "config/routes.json"));
  assert.equal(manifest.environment, "Development");
  assert.equal(manifest.gateway_state, "desired-disabled-until-project-wide-route-preservation-readback");
  assert.equal(manifest.default_action, "reject");
  assert.equal(manifest.cors, false);
  assert.equal(manifest.query_strings, false);
  assert.deepEqual(manifest.routes.map((route) => [route.id, route.method, route.path_reference]), [
    ["FORM2_ISSUE", "POST", "ISSUE_PATH"],
    ["FORM2_ACCESS", "GET", "FORM2_ACCESS_PATH"],
    ["FORM2_OTP_REQUEST", "POST", "FORM2_OTP_REQUEST_PATH"],
    ["FORM2_OTP_VERIFY", "POST", "FORM2_OTP_VERIFY_PATH"],
    ["FORM2_PREFILL", "POST", "PREFILL_PATH"],
    ["FORM2_SUBMISSION", "POST", "SUBMISSION_PATH"],
  ]);
  assert.equal(new Set(manifest.routes.map((route) => route.id)).size, 6);
  assert.equal(manifest.routes.every((route) =>
    Number.isSafeInteger(route.rate_limit_per_minute) &&
    Number.isSafeInteger(route.rate_limit_per_ip_per_minute) &&
    route.rate_limit_per_ip_per_minute <= route.rate_limit_per_minute), true);
  assert.equal(manifest.common_controls.browser_routes_expose_shared_secret, false);
  assert.equal(JSON.stringify(manifest).toLowerCase().includes("sms"), true);
  assert.equal(
    manifest.activation_gates.some((gate) => gate.includes("Never add SMS")),
    true,
  );
});

test("the Zoho Forms manifest is email-only and matches the runtime client contract", () => {
  const manifest = readJson(path.join(
    repositoryRoot,
    "src/zoho-forms/free-revenue-leak-test/forms-manifest.json",
  ));
  const { CLIENT_KEYS } = require("../lib/form-contract");
  const form2 = manifest.forms.find(
    (form) => form.logical_name === "REVENUE_LEAK_TEST_SETUP_FORM",
  );
  assert.ok(form2);
  assert.equal(form2.crm_integration.native_direct_write, false);
  assert.equal(form2.access.sms_otp, false);
  assert.equal(form2.access.sms_delivery, false);
  assert.equal(form2.access.proof_destination, "current CRM-bound Contact.Email only");
  assert.deepEqual(form2.controller_hidden_fields, ["setupToken", "prefillId"]);
  assert.deepEqual(form2.prohibited_hidden_fields, [
    "Contact_ID",
    "Account_ID",
    "Deal_ID",
    "Issuance_Request_ID",
    "Setup_Form_Version",
    "Test_Scope_Version",
  ]);
  assert.equal(form2.server_generated_submission_field.controller_key, "submissionId");
  assert.deepEqual(form2.submission_webhook.client_keys, CLIENT_KEYS);
  assert.equal(form2.required_fields.includes("alertRecipientEmail"), true);
  assert.equal(form2.prohibited_fields.includes("alertRecipientMobile"), true);
  assert.equal(form2.submission_webhook.client_keys.includes("alertRecipientMobile"), false);
  assert.match(form2.confirmation_copy, /does not activate call routing/);
  assert.match(form2.confirmation_copy, /billing/i);
  assert.match(form2.confirmation_copy, /SMS/);
});

test("the additive v3 migration manifest preserves v2 and authorizes no promotion", () => {
  const manifest = readJson(path.join(controllerRoot, "config/migration-v2-to-v3.json"));
  assert.equal(manifest.environment, "Development");
  assert.equal(manifest.strategy, "additive-v3-zero-promotion");
  assert.deepEqual(manifest.destination_tables, [
    "Form2SessionsV3Runtime",
    "Form2PrefillsV3",
    "Form2SubmissionsV3",
    "Form2VerificationProofsV3",
  ]);
  assert.deepEqual(manifest.form2_v3_legacy_source_mapping, {
    Form2SessionsV3: "Form2SessionsV3Runtime",
  });
  assert.equal(manifest.destination_readback.all_targets_empty, true);
  assert.equal(manifest.destination_readback.total_application_columns, 81);
  assert.equal(manifest.destination_readback.schema_mismatches, 0);
  assert.deepEqual(manifest.quarantined_unbound_probe_artifacts, [
    "Form2SessionsV3",
    "ZZZ_Quarantined_Form2SessionsV3_ColumnProbe",
    "ZZZ_Quarantined_Form2SessionsV3_TypeProbe",
  ]);
  assert.equal(manifest.rules.some((rule) => /Never rename, update, delete, or backfill/.test(rule)), true);
  assert.equal(manifest.rules.some((rule) => /Abort if any destination version-3 table is nonempty/.test(rule)), true);
  assert.equal(manifest.observed_sanitized_disposition.promoted_sessions, 0);
  assert.equal(manifest.observed_sanitized_disposition.promoted_prefills, 0);
  assert.equal(manifest.observed_sanitized_disposition.promoted_submissions, 0);
  assert.match(manifest.output_policy, /Never output rows, CRM IDs, emails, tokens/);
});

test("GitHub Linux CI executes the RevenueLeakTestSetupForm deploy-artifact regressions", () => {
  const workflow = fs.readFileSync(
    path.join(repositoryRoot, ".github/workflows/repo-checks.yml"),
    "utf8",
  );
  const packageManifest = readJson(path.join(functionRoot, "package.json"));
  const deploymentTests = fs.readFileSync(
    path.join(functionRoot, "test/deploy-development.integration.test.js"),
    "utf8",
  );
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(
    workflow,
    /npm run ci --prefix src\/zoho-catalyst\/revenue-leak-test-setup-form\/functions\/revenue_leak_test_setup_form/,
  );
  assert.equal(packageManifest.scripts.test, "node --test test/*.test.js");
  assert.match(deploymentTests, /process\.platform === "linux" && process\.arch === "x64"/);
  assert.equal((deploymentTests.match(/skip: !supportedRunner/g) ?? []).length, 8);
});

test("the repository pipeline keeps approval but blocks Development deployment", () => {
  const pipelinePath = path.join(repositoryRoot, "catalyst-pipelines.yaml");
  const scriptPath = path.join(controllerRoot, "scripts/deploy-development.sh");
  const revisionModulePath = path.join(functionRoot, "lib/source-revision.js");
  const formDestinationModulePath = path.join(functionRoot, "lib/form-destination.js");
  const pipeline = fs.readFileSync(pipelinePath, "utf8");
  const script = fs.readFileSync(scriptPath, "utf8");
  const revisionModule = fs.readFileSync(revisionModulePath, "utf8");
  const formDestinationModule = fs.readFileSync(formDestinationModulePath, "utf8");

  assert.match(pipeline, /^version: 1$/m);
  assert.match(pipeline, /^  approve:\n    type:\n      type-name: approval$/m);
  const approvalStageIndex = pipeline.indexOf("- name: approval");
  const developmentStageIndex = pipeline.indexOf("- name: development");
  assert.notEqual(approvalStageIndex, -1, "the approval stage is missing");
  assert.notEqual(developmentStageIndex, -1, "the Development stage is missing");
  assert.ok(
    approvalStageIndex < developmentStageIndex,
    "the approval stage must precede the deployment stage",
  );
  assert.match(pipeline, /<< env\.DEPLOY_APPROVER_EMAIL >>/);
  const deploymentJob = pipeline
    .split(/^  deploy_revenue_leak_test_setup_form_development:\n/m)[1]
    ?.split(/^stages:\n/m)[0];
  assert.ok(deploymentJob, "the Development deployment job is missing");
  assert.equal(
    deploymentJob.trimEnd(),
    `    steps:
      - |
        set +x
        printf '%s\\n' 'BLOCKED: RevenueLeakTestSetupForm Development deployment requires a verified native secret binding.' >&2
        exit 1`,
  );
  assert.doesNotMatch(deploymentJob, /<<\s*env\./);
  for (const forbiddenVariableName of [
    "PROJECT_ID",
    "CATALYST_ORG",
    "CATALYST_TOKEN",
    "APPROVED_SOURCE_REVISION",
    "APPROVED_FORM2_DESTINATION_SHA256",
  ]) {
    assert.doesNotMatch(pipeline, new RegExp(`<< env\\.${forbiddenVariableName} >>`));
  }
  assert.match(
    deploymentJob,
    /printf '%s\\n' 'BLOCKED: RevenueLeakTestSetupForm Development deployment requires a verified native secret binding\.' >&2/,
  );
  assert.match(deploymentJob, /^      - \|\n        set \+x\n/m);
  assert.match(deploymentJob, /^        exit 1$/m);
  assert.doesNotMatch(deploymentJob, /deploy-development\.sh|\bcatalyst\s+deploy\b/);
  assert.doesNotMatch(pipeline, /BASH_ENV=|ENV=|SHELLOPTS=|PS4=/);

  if (process.platform !== "win32") {
    assert.notEqual(fs.statSync(scriptPath).mode & 0o111, 0, "deployment script is not executable");
  }
  assert.match(script, /^#!\/usr\/bin\/env bash\nset \+x\nset -euo pipefail$/m);
  assert.match(script, /readonly NODE_VERSION="24\.19\.0"/);
  assert.match(script, /readonly CATALYST_CLI_VERSION="1\.26\.0"/);
  assert.match(
    script,
    /readonly NODE_SHA256="14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647"/,
  );
  assert.match(script, /actual_revision.*run_isolated_git .* rev-parse --verify HEAD/);
  assert.match(script, /actual_revision" == "\$APPROVED_SOURCE_REVISION/);
  assert.match(script, /status --porcelain=v1 --untracked-files=all/);
  assert.equal(revisionModule, `"use strict";

// The Development deploy script replaces this sentinel only after proving that
// Git HEAD equals APPROVED_SOURCE_REVISION. An unstamped or manually packaged
// function therefore fails configuration before it can access CRM or Data Store.
const ARTIFACT_SOURCE_REVISION = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";

module.exports = { ARTIFACT_SOURCE_REVISION };
`);
  assert.equal(formDestinationModule, `"use strict";

// The reviewed Development deploy script replaces this sentinel only in its
// isolated temporary artifact. A checkout or manually packaged function stays
// unstamped and therefore fails closed before reaching CRM or Data Store.
const ARTIFACT_FORM_DESTINATION_SHA256 =
  "__SYLVARA_UNSTAMPED_FORM_DESTINATION_SHA256__";

module.exports = { ARTIFACT_FORM_DESTINATION_SHA256 };
`);
  assert.match(script, /run_isolated_git .* archive --format=tar "\$actual_revision"/);
  assert.match(script, /catalyst-pipelines\.yaml \|/);
  assert.match(script, /approved pipeline export is unavailable/);
  assert.match(script, /"ls-tree", "-r", "-z", revision/);
  assert.match(script, /mode not in \{"100644", "100755"\}/);
  assert.match(script, /approved Git export contains an unsupported mode or object type/);
  assert.match(script, /approved Git export content differs from its Git blob/);
  assert.match(script, /approved Git export paths differ from the reviewed Git tree/);
  assert.match(script, /test-export/);
  assert.match(script, /deploy-export/);
  assert.match(script, /reference-export/);
  assert.match(script, /source revision module is not the exact reviewed sentinel template/);
  assert.match(script, /replacement = f'const ARTIFACT_SOURCE_REVISION = "\{revision\}";'/);
  assert.match(script, /artifact_revision" == "\$actual_revision/);
  assert.match(script, /APPROVED_FORM2_DESTINATION_SHA256.*\^\[a-f0-9\]\{64\}\$/);
  assert.match(script, /reviewed source form destination is not approved/);
  assert.match(script, /read_approved_form_destination "\$form_destination_path"/);
  assert.match(script, /tools\/stamp-form-destination\.js/);
  assert.match(
    script,
    /artifact_form_destination" == "\$APPROVED_FORM2_DESTINATION_SHA256/,
  );
  assert.doesNotMatch(script, /require\(process\.argv\[1\]\)\.ARTIFACT_SOURCE_REVISION/);
  assert.doesNotMatch(script, /--exclude=node_modules/);
  assert.match(script, /function_dependency_subtree="functions\/revenue_leak_test_setup_form\/node_modules"/);
  assert.match(script, /reference_source_manifest/);
  assert.match(script, /deploy_source_manifest/);
  assert.match(script, /deployable controller differs from the approved Git export/);
  assert.doesNotMatch(script, /source-revision\.js\.original|revision_backup_path/);
  assert.match(script, /tools\/safety\/pre-commit-safety-check\.py/);
  assert.match(script, /run_isolated_npm/);
  assert.match(script, /env -i/);
  assert.match(script, /npm_config_globalconfig/);
  assert.equal(
    (script.match(/ci --omit=dev --ignore-scripts --no-audit --no-fund/g) ?? []).length,
    2,
  );
  assert.match(script, /--ignore-scripts run ci/);
  assert.match(script, /manifest_tree/);
  assert.match(script, /tested and deployable dependency trees differ/);
  assert.match(script, /artifact symlink escapes its tree/);
  assert.match(script, /artifact path has special permission bits/);
  assert.match(script, /artifact directory has special permission bits/);
  assert.match(script, /artifact regular file is group- or world-writable/);
  assert.match(script, /artifact contains an unsupported file type/);
  assert.match(script, /rm -rf -- "\$deploy_function_root\/test"/);
  assert.doesNotMatch(script, /find "\$deploy_function_root" -maxdepth 1 -name '\.env\*'/);
  assert.match(script, /unreviewed Catalyst project-state file entered the export/);
  assert.match(script, /deployment cleanup failed; deployment may have completed/);
  assert.match(
    script,
    /export -n PROJECT_ID CATALYST_ORG CATALYST_TOKEN APPROVED_SOURCE_REVISION/,
  );
  assert.match(script, /GIT_\*\|npm_config_\*\|NPM_CONFIG_\*/);
  const unexportIndex = script.indexOf(
    "export -n PROJECT_ID CATALYST_ORG CATALYST_TOKEN APPROVED_SOURCE_REVISION",
  );
  assert.notEqual(unexportIndex, -1);
  assert.ok(unexportIndex < script.indexOf('git_directory="$(dirname'));
  assert.ok(unexportIndex < script.indexOf('runner_architecture="$(uname'));
  assert.match(script, /GIT_NO_REPLACE_OBJECTS=1/);
  assert.match(script, /"GIT_NO_REPLACE_OBJECTS": "1"/);
  assert.doesNotMatch(script, /npm install[^\n]*zcatalyst-cli|zcatalyst-cli@/);
  assert.equal((script.match(/"\$catalyst_path" deploy/g) ?? []).length, 1);
  assert.match(
    script,
    /deployment may have completed; independently read back the Development function and deployment before any retry/,
  );
  assert.match(script, /trap deployment_interrupted HUP INT TERM/);
  assert.match(script, /cd -- "\$deploy_project_root"/);
  assert.match(script, /--only functions:revenue_leak_test_setup_form/);
  assert.match(script, /--ignore-scripts/);
  assert.match(script, /--project "\$PROJECT_ID"/);
  assert.match(script, /--org "\$CATALYST_ORG"/);
  const catalystTokenName = ["CATALYST", "TOKEN"].join("_");
  assert.doesNotMatch(script, new RegExp(`--token|${catalystTokenName}=.*deploy`));
  assert.match(script, /export CATALYST_TOKEN/);
  assert.match(script, /compgen -e/);
  assert.match(script, /--dc us/);
  assert.doesNotMatch(script, /set -x|--verbose/);
});
