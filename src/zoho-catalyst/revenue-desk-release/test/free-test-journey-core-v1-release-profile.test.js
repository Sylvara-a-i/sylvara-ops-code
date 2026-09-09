'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildManifest,
  createArtifactProvenance,
  verifyReadback,
} = require('../lib/release-manifest');
const {
  prefillBindingDigest,
} = require('../../revenue-leak-test-setup-form/functions/revenue_leak_test_setup_form/lib/security');
const {
  keyedDigest,
} = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/security');

const contract = require('../free-test-journey-core-v1-release-contract.json');
const productContract = require('../../../../docs/product/free-revenue-leak-test-release-contract.json');
const routeContract = require('../private-route-packet-contract.json');
const coexistence = require('../journey-core-route-coexistence-contract.json');
const formsManifest = require('../../../zoho-forms/free-revenue-leak-test/forms-manifest.json');
const callerManifest = require('../../../zoho-crm/free-revenue-leak-test/config/caller-manifest.json');

const revision = 'a'.repeat(40);
const digest = 'b'.repeat(64);

test('Form 2 producer and route-control consumer share the exact prefill-binding HMAC framing', () => {
  const secret = 'synthetic-form2-workflow-hmac-secret-0123456789';
  const binding = {
    crmOrganizationHash: 'a'.repeat(64),
    crmContactId: '10000000001',
    crmAccountId: '10000000002',
    crmDealId: '10000000003',
    journeyId: 'journey.synthetic.001',
    formIdentityHash: 'b'.repeat(64),
    expectedStage: 'form2',
    formVersion: 'setup-auth-v1',
    configurationRevision: 'c'.repeat(40),
  };
  const orderedParts = [
    binding.crmOrganizationHash,
    binding.crmContactId,
    binding.crmAccountId,
    binding.crmDealId,
    binding.journeyId,
    binding.formIdentityHash,
    binding.expectedStage,
    binding.formVersion,
    binding.configurationRevision,
  ];
  const expected = '0c7f8ab46fc82957acb344c2e5a18659eb8113ac25b2bf0f2f8fb16b48e9dc32';

  assert.equal(prefillBindingDigest(binding, secret), expected);
  assert.equal(
    keyedDigest(secret, 'sylvara.form2.prefill-binding.v1', orderedParts),
    expected,
  );
});

function fixture() {
  const sourceTrees = Object.fromEntries(
    contract.functions.map(({ name }) => [name, digest]),
  );
  const artifacts = Object.fromEntries(contract.functions.map((entry) => {
    const artifact = { sha256: digest, file_count: 2 };
    artifact.provenance = createArtifactProvenance({
      functionName: entry.name,
      packageName: entry.name,
      revisionStampTarget: entry.revision_stamp_target,
      sourceRevision: revision,
      sourceTreeSha256: sourceTrees[entry.name],
      artifactSha256: artifact.sha256,
      artifactFileCount: artifact.file_count,
    });
    return [entry.name, artifact];
  }));
  const contractDigests = Object.fromEntries(
    contract.contract_files.map((file) => [file, digest]),
  );
  const manifest = buildManifest({
    contract,
    sourceRevision: revision,
    environment: 'Development',
    artifacts,
    sourceTrees,
    contractDigests,
  });
  const readback = {
    source_revision: revision,
    environment: 'Development',
    mode: manifest.mode,
    functions: manifest.functions.map((entry) => ({
      name: entry.name,
      source_revision: revision,
      source_tree_sha256: entry.source_tree_sha256,
      artifact_sha256: entry.artifact_sha256,
    })),
    job_pools: [...manifest.job_pools],
    tables: [...manifest.tables],
    contract_sha256: { ...manifest.contract_sha256 },
  };
  return { artifacts, contractDigests, manifest, readback, sourceTrees };
}

test('builds and verifies the immutable Development Journey-core manifest', () => {
  const { artifacts, contractDigests, manifest, readback, sourceTrees } = fixture();
  assert.equal(manifest.release_kind, 'free_test_journey_core_v1_release');
  assert.equal(manifest.mode, 'free-test-journey-core-v1');
  assert.deepEqual(manifest.functions.map(({ name }) => name), [
    'revenue_leak_test_request_form',
    'revenue_leak_test_setup_form',
    'revenue_desk_call_gateway',
    'revenue_desk_call_worker',
    'revenue_desk_route_control',
  ]);
  assert.equal(manifest.job_pools.length, 1);
  assert.equal(manifest.tables.length, 12);
  assert.equal(Object.keys(manifest.contract_sha256).length, 31);
  assert.equal(
    Object.hasOwn(
      manifest.contract_sha256,
      'src/zoho-catalyst/revenue-desk-release/free-test-journey-core-v1-release-contract.json',
    ),
    true,
  );
  assert.equal(verifyReadback(manifest, readback, contract), true);

  assert.throws(() => buildManifest({
    contract,
    sourceRevision: revision,
    environment: 'Production',
    artifacts,
    sourceTrees,
    contractDigests,
  }), /Environment is not allowed/);
});

test('makes the complete secure Form 2 path mandatory', () => {
  const form2 = contract.installation_scope.forms.form2;
  assert.equal(contract.installation_scope.forms.exact_form_count, 2);
  assert.equal(contract.installation_scope.forms.count_semantics, "logical Journey stages");
  assert.equal(contract.installation_scope.forms.exact_logical_stage_count, 2);
  assert.equal(contract.installation_scope.forms.exact_physical_surface_count, 3);
  assert.equal(contract.installation_scope.forms.form1_physical_surface_count, 2);
  assert.deepEqual(formsManifest.surface_inventory, {
    logical_stage_count: 2,
    physical_surface_count: 3,
    form1_physical_surface_count: 2,
    rule: "The Journey has two logical stages. Form 1 uses separate public and CRM-assisted physical Forms surfaces; Form 2 remains the second logical stage and third physical surface.",
  });
  assert.equal(form2.mandatory, true);
  assert.deepEqual(form2.required_controls, [
    'opaque record-bound short-lived handle validation',
    'one-time email OTP proof',
    'Dynamic Prefill-Webhook',
    'protected header',
    'exact prefill mapping',
    'exact 36-key submission mapping',
    'submission webhook',
    'server-side Journey, record, form, stage, and immutable-revision validation',
    'direct bounded Catalyst-to-CRM persistence',
    'idempotent replay',
    'conflicting replay rejection',
  ]);
  assert.equal(form2.submission_result, 'Setup_Access_Status read back as Submitted');
  assert.equal(form2.missing_invalid_expired_cross_record_or_cross_stage_access, 'fail_closed');
  assert.equal(form2.submission_can_approve, false);
  assert.equal(form2.submission_can_activate, false);

  const acceptance = contract.installation_scope.acceptance;
  assert.equal(acceptance.form2_live_happy_path_required, true);
  assert.equal(acceptance.form2_live_failure_path_required, true);
  assert.equal(acceptance.approval_requires_valid_form2_evidence, true);
  assert.equal(
    productContract.deployment_profiles['free-test-journey-core-v1'].form2.mandatory,
    true,
  );
});

test('requires no CRM workflow or Blueprint dependency for Journey-core acceptance', () => {
  const crm = contract.installation_scope.crm;
  assert.equal(crm.workflow_dependency_required, false);
  assert.deepEqual(crm.required_workflow_rules, []);
  assert.deepEqual(crm.deferred_setup_initialization_workflow_rules, [
    'Deals Free Test Initialize Controls',
    'Deals Free Test Initialize Limits',
    'Deals Free Test Initialize Setup Issue Identity',
  ]);
  assert.deepEqual(crm.deferred_inactive_form2_workflow_rules, [
    'Deals Form 2 Controller Proof Candidate',
    'Deals Free Test Form 2 Submitted',
  ]);
  assert.equal(crm.form2_workflow_state, 'FORM2_WORKFLOW_DEFERRED_INACTIVE');
  assert.deepEqual(crm.blueprint, {
    required: false,
    transition_dependency_required: false,
    state: 'FULL_BLUEPRINT_DEFERRED',
    inert_actions_preserved_unassociated: true,
    installation_or_publication_authorized: false,
  });
  assert.deepEqual(crm.internal_review_task_automation, {
    scope: 'Form 2',
    required: false,
    state: 'deferred',
  });
  assert.deepEqual(crm.legacy_form1_review_task, {
    state: 'preserved_nonblocking',
    required_for_current_acceptance: false,
    workflow_execution_is_security_authority: false,
  });

  const productProfile = productContract.deployment_profiles['free-test-journey-core-v1'];
  assert.equal(
    productContract.deployment_profiles.current_installation_acceptance_profile,
    'free-test-journey-core-v1',
  );
  assert.equal(productProfile.crm_automation.workflow_dependency_required, false);
  assert.equal(productProfile.crm_automation.blueprint_transition_dependency_required, false);
  assert.equal(
    productContract.deployment_profiles['full-automation']
      .current_installation_acceptance_dependency,
    false,
  );
});

test('binds the exact operator controls and separates approval, activation, and rollback', () => {
  const crm = contract.installation_scope.crm;
  assert.deepEqual(crm.controls, [
    'Start Free-Test Request',
    'Open Free-Test Setup',
    'Approve And Start Free Test',
    'Stop Or Roll Back Free Test',
  ]);
  assert.deepEqual(crm.functions, [
    'open_free_test_setup',
    'open_free_test_setup_zdk',
    'initialize_setup_access_issue_request_id',
    'issue_revenue_leak_test_setup',
    'issue_revenue_leak_test_setup_zdk',
    'approve_and_start_free_test',
    'stop_or_rollback_free_test',
  ]);
  assert.deepEqual(crm.journey_core_functions, [
    'open_free_test_setup_zdk',
    'issue_revenue_leak_test_setup_zdk',
    'approve_and_start_free_test',
    'stop_or_rollback_free_test',
  ]);
  assert.deepEqual(crm.preserved_unrequired_functions, [
    'initialize_setup_access_issue_request_id',
    'open_free_test_setup',
    'issue_revenue_leak_test_setup',
  ]);
  assert.deepEqual(crm.client_scripts, [
    { name: 'open_free_test_setup_leads', module: 'Leads',
      page: 'Detail Page (Standard)', event_type: 'Button Event', event: 'onClick',
      source: 'src/zoho-crm/free-revenue-leak-test/client-scripts/open_free_test_setup_leads.js',
      invokes_function: 'open_free_test_setup_zdk', function_category: 'Standalone',
      function_state: 'active', function_return_type: 'string',
      function_arguments: [{ name: 'record_id', type: 'string' },
        { name: 'crm_module', type: 'string' }], navigation_api: '$Client.openURL',
      development_zdk_execution_canary_required: true },
    { name: 'open_free_test_setup_deals', module: 'Deals',
      page: 'Detail Page (Standard)', event_type: 'Button Event', event: 'onClick',
      source: 'src/zoho-crm/free-revenue-leak-test/client-scripts/open_free_test_setup_deals.js',
      invokes_function: 'issue_revenue_leak_test_setup_zdk', function_category: 'Standalone',
      function_state: 'active', function_return_type: 'string',
      function_arguments: [{ name: 'deal_id', type: 'string' }],
      navigation_api: '$Client.openURL', development_zdk_execution_canary_required: true },
  ]);
  for (const script of crm.client_scripts) {
    assert.equal(contract.contract_files.includes(script.source), true);
  }
  assert.deepEqual(crm.client_script_cutover_order, [
    'disable_and_read_back_no_direct_function_binding',
    'create_and_read_back_distinct_standalone_functions_while_preserving_button_rollbacks',
    'publish_and_read_back_module_specific_client_scripts',
    'bind_disabled_controls_to_exact_client_scripts',
    'pass_leads_development_zdk_execution_canary',
    'enable_leads_replacement_control_after_its_exact_readback_and_canary',
    'pass_deals_development_zdk_execution_canary',
    'enable_deals_replacement_control_after_its_exact_readback_and_canary',
  ]);
  assert.equal(crm.direct_url_returning_function_binding_allowed, false);
  assert.deepEqual(crm.control_bindings, [
    { logical_name: 'FORM1_ASSISTED_ISSUE_CALLER', label: 'Start Free-Test Request', module: 'Leads',
      client_script: 'open_free_test_setup_leads',
      invokes_function: 'open_free_test_setup_zdk', replacement: true },
    { logical_name: 'FORM2_SETUP_ISSUE_CALLER', label: 'Open Free-Test Setup', module: 'Deals',
      client_script: 'open_free_test_setup_deals',
      invokes_function: 'issue_revenue_leak_test_setup_zdk', replacement: true },
    { logical_name: 'APPROVE_AND_START_FREE_TEST_CALLER', label: 'Approve And Start Free Test', module: 'Deals',
      function: 'approve_and_start_free_test', replacement: true },
    { logical_name: 'STOP_OR_ROLLBACK_FREE_TEST_CALLER', label: 'Stop Or Roll Back Free Test', module: 'Deals',
      function: 'stop_or_rollback_free_test', replacement: true },
  ]);
  assert.deepEqual(
    productContract.deployment_profiles['free-test-journey-core-v1'].backend_operations,
    ['Approve Configuration', 'Activate Free Test', 'Stop Or Roll Back Free Test'],
  );
  assert.equal(
    contract.installation_scope.acceptance
      .deployment_remains_approved_and_inactive_after_expected_activation_failure,
    true,
  );
  assert.deepEqual(contract.installation_scope.acceptance.route_control_request_contract, {
    required_fields: ['dealId', 'journeyId', 'configurationVersionId', 'idempotencyKey'],
    rollback_additional_required_fields: ['reason'],
    optional_fields: ['deploymentId'],
    deployment_id_policy: 'omitted_or_empty_string_only',
    configuration_version_grammar: '^form2cfgv1:[1-9][0-9]{0,29}:[a-f0-9]{40}$',
    approval_requires_telephony_deployment: false,
    blueprint_transition_required: false,
    retell_operation_required: false,
  });
  assert.equal(contract.installation_scope.retell.mode, 'local-contract-reference-only');
  assert.equal(contract.installation_scope.retell.provider_access_authorized, false);
  assert.equal(contract.installation_scope.retell.schema_readback_authorized, false);
  assert.equal(
    contract.installation_scope.retell.activation_failure_wire_code_when_disabled,
    'isolated_retell_test_number_required',
  );
  assert.equal(
    contract.installation_scope.retell.activation_failure_internal_code_when_disabled,
    'ISOLATED_RETELL_TEST_NUMBER_REQUIRED',
  );
});

// Compare stable logical bindings, not mutable display labels or a private native
// Function name. Retired controls must not remain active bindings.
function assertCallerBindingParity(crm, callers) {
  assert.equal(crm.control_bindings.length, 4);
  assert.equal(new Set(crm.control_bindings.map(({ logical_name: name }) => name)).size, 4);
  assert.deepEqual(crm.control_bindings.map(({ logical_name: name }) => name).sort(),
    callers.map(({ logical_name: name }) => name).sort());
  assert.deepEqual(crm.controls, [...new Set(crm.control_bindings.map(({ label }) => label))]);
  for (const binding of crm.control_bindings) {
    const caller = callers.find(({ logical_name: name }) => name === binding.logical_name);
    assert.equal(binding.label, caller.button);
    assert.equal(binding.module, caller.module);
    if (caller.client_script) {
      assert.equal(binding.client_script, path.posix.basename(caller.client_script.source, '.js'));
      assert.equal(binding.invokes_function, caller.client_script.function_api_name);
      assert.equal(binding.invokes_function, caller.server_function.api_name);
      assert.equal(Object.hasOwn(binding, 'function'), false);
    } else {
      assert.equal(binding.function, path.posix.basename(caller.source, '.deluge'));
      assert.equal(Object.hasOwn(binding, 'client_script'), false);
    }
    assert.deepEqual(binding.source_identity_policy, caller.source_identity_policy);
  }
}

test('keeps all four Journey-core labels and source identities aligned with the caller manifest', () => {
  const crm = contract.installation_scope.crm;
  assertCallerBindingParity(crm, callerManifest.callers);
  assert.match(crm.function_inventory_semantics, /permanently retired local-only predecessor is excluded/);
  assert.match(crm.client_script_cutover_order_scope, /Historical initial replacement installation only/);
  assert.match(crm.client_script_cutover_order_scope, /does not repeat installation, reopen the source-revision hold, or reuse a consumed canary/);
});

test('all buildable Journey profiles exclude the retired source and legacy binding', () => {
  const retiredSource = 'src/zoho-crm/free-revenue-leak-test/functions/start_free_revenue_leak_test_request.deluge';
  const root = path.resolve(__dirname, '../../../..');
  for (const profile of [contract, require('../setup-journey-release-contract.json')]) {
    assert.equal(profile.contract_files.includes(retiredSource), false);
    assert.equal(profile.installation_scope.crm.functions.includes('start_free_revenue_leak_test_request'), false);
    assert.equal(profile.installation_scope.crm.controls.includes('Legacy Free-Test - Contained'), false);
    assert.equal(profile.installation_scope.crm.control_bindings.length, 4);
    assert.equal(profile.installation_scope.crm.control_bindings.some(
      (binding) => binding.function === 'start_free_revenue_leak_test_request'), false);
    assert.equal(fs.existsSync(path.join(root, retiredSource)), false);
  }
  assert.match(callerManifest.lead_legacy_retirement.rollback_policy, /Do not restore or recreate/);
  assert.match(productContract.deployment_profiles['free-test-journey-core-v1'].rollback_order.join(' '),
    /do not recreate the retired local-only Form 1 predecessor/);
  const form1Routes = require('../../revenue-leak-test-request-form/config/routes.json');
  assert.equal(form1Routes.rollback.preserve.includes('old CRM control'), false);
  assert.match(form1Routes.rollback.preserve.join(' '), /failed active CRM launcher containment/);
});

test('rejects stale labels and mismatched caller labels', () => {
  for (const [index, label] of [[0, 'Obsolete synthetic label'], [1, 'Start Free-Test Request']]) {
    const crm = structuredClone(contract.installation_scope.crm);
    crm.control_bindings[index].label = label;
    crm.controls = [...new Set(crm.control_bindings.map((binding) => binding.label))];
    assert.throws(() => assertCallerBindingParity(crm, callerManifest.callers));
  }
  const callers = structuredClone(callerManifest.callers);
  callers[1].button = 'Synthetic mismatched Deal label';
  assert.throws(() => assertCallerBindingParity(contract.installation_scope.crm, callers));
});

test('profiles legacy automation separately and pins approved Forms toggles', () => {
  assert.equal(productContract.state_machine_profile_scope, 'full-automation');
  assert.equal(productContract.deployment_order_profile_scope, 'full-automation');
  assert.equal(productContract.rollback_order_profile_scope, 'full-automation');
  const core = productContract.deployment_profiles['free-test-journey-core-v1'];
  assert.equal(core.crm_automation.legacy_form1_review_task_state, 'preserved_nonblocking');
  assert.equal(core.crm_automation.legacy_form1_review_task_required_for_acceptance, false);
  assert.equal(core.state_contract.crm_blueprint_transition_required, false);
  assert.equal(core.state_contract.retell_operation_required, false);
  assert.equal(core.route_control_request_contract.approval_requires_telephony_deployment, false);
  assert.equal(core.route_control_request_contract.deployment_id_policy, 'omitted_or_empty_string_only');

  const exactDesiredState = {
    public_url: 'Enabled',
    enhanced_accessibility: 'Yes',
    respondent_font_size_control: 'Disabled',
    respondent_letter_spacing_control: 'Disabled',
    respondent_themes_control: 'Disabled',
  };
  for (const form of formsManifest.forms) {
    const access = form.approved_public_access_and_accessibility;
    assert.deepEqual(access.desired_state, exactDesiredState);
    assert.equal(access.authoritative_live_readback.source_values_inferred_as_live, false);
    for (const field of Object.keys(exactDesiredState)) {
      assert.equal(access.authoritative_live_readback[field], null);
    }
  }
  const form2 = formsManifest.forms.find(
    ({ logical_name: name }) => name === 'REVENUE_LEAK_TEST_SETUP_FORM',
  );
  assert.equal(form2.approved_public_access_and_accessibility.organization_only_sharing_allowed, false);
  assert.equal(form2.approved_public_access_and_accessibility.bare_permalink_distribution_allowed, false);
  assert.deepEqual(form2.approved_public_access_and_accessibility.public_url_enablement_gate, [
    'Catalyst Form 2 server-side fail-closed validation deployed and read back',
    'Dynamic Prefill-Webhook saved and read back',
    'submission webhook saved and read back',
    'Development protected headers rotated and matched on Forms and Catalyst',
    'exact prefill and 36-key submission mappings saved and read back',
  ]);
});

test('requires only Journey routes and preserves excluded provider routes without mutation', () => {
  const catalyst = contract.installation_scope.catalyst;
  const allRouteIds = routeContract.routes.map(({ id }) => id);
  const required = catalyst.required_journey_route_ids;
  const deferred = catalyst.preserved_deferred_route_ids;
  assert.deepEqual(required, [
    'ROUTE_CONTROL_APPROVE',
    'ROUTE_CONTROL_ACTIVATE',
    'ROUTE_CONTROL_ROLLBACK',
    'FORM1_ISSUE',
    'FORM1_ACCESS',
    'FORM1_EXCHANGE',
    'FORM1_PREFILL',
    'FORM1_SUBMISSION',
    'FORM2_ISSUE',
    'FORM2_ACCESS',
    'FORM2_OTP_REQUEST',
    'FORM2_OTP_VERIFY',
    'FORM2_PREFILL',
    'FORM2_SUBMISSION',
  ]);
  assert.deepEqual(deferred, [
    'RETELL_INBOUND', 'RETELL_EVENTS', 'RETELL_READINESS', 'CRM_BILLING',
  ]);
  assert.equal(new Set([...required, ...deferred]).size, 18);
  assert.deepEqual([...required, ...deferred].sort(), [...allRouteIds].sort());
  assert.equal(catalyst.physical_route_count, 24);
  assert.deepEqual(catalyst.required_compatibility_route_ids,
    coexistence.compatibility_routes.filter((route) => route.acceptance_required).map(({ id }) => id));
  assert.deepEqual(catalyst.preserved_nonrequired_compatibility_route_ids,
    coexistence.compatibility_routes.filter((route) => !route.acceptance_required).map(({ id }) => id));
  assert.equal(new Set([...required, ...deferred,
    ...catalyst.required_compatibility_route_ids,
    ...catalyst.preserved_nonrequired_compatibility_route_ids]).size, 24);
  assert.equal(catalyst.compatibility_security_readback_required, true);
  assert.equal(catalyst.unresolved_compatibility_consumers_authorize_retirement, false);
  assert.ok(contract.contract_files.includes(catalyst.route_readback_contract));
  const productRoutes = productContract.deployment_profiles['free-test-journey-core-v1'].route_inventory;
  assert.equal(productRoutes.readback_contract, catalyst.route_readback_contract);
  assert.equal(productRoutes.physical_route_count, 24);
  assert.equal(productRoutes.unknown_security_is_accepted, false);
  assert.equal(productRoutes.runtime_reopening_or_test_authorized, false);
  assert.equal(coexistence.retell_provider_access_authorized, false);
  assert.equal(coexistence.runtime_reopening_authorized, false);
  assert.equal(coexistence.session_or_email_test_authorized, false);
  assert.equal(coexistence.security_policy.temporary_mapping_routes_allowed, false);
  assert.ok(coexistence.compatibility_routes.filter((route) => !route.acceptance_required)
    .every((route) => route.consumer_evidence === 'unresolved'));
  assert.equal(catalyst.existing_route_mutation_authorized, false);

  const execution = contract.installation_scope.excluded_from_current_acceptance;
  assert.equal(execution.billing_execution, true);
  assert.equal(execution.analytics_execution, true);
  assert.equal(execution.retell_ingress_execution, true);
  assert.equal(execution.call_worker_execution, true);
  assert.equal(execution.telephony_execution, true);
  assert.deepEqual(catalyst.journey_core_execution_functions, [
    'revenue_leak_test_request_form',
    'revenue_leak_test_setup_form',
    'revenue_desk_route_control',
  ]);
  assert.deepEqual(catalyst.packaging_parity_only_functions, [
    'revenue_desk_call_gateway',
    'revenue_desk_call_worker',
  ]);
});

test('CLI readback verifier selects Journey-core and rejects parity drift', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-core-readback-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { manifest, readback } = fixture();
  const manifestPath = path.join(root, 'manifest.json');
  const readbackPath = path.join(root, 'readback.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.writeFileSync(readbackPath, JSON.stringify(readback));

  const scriptPath = path.join(__dirname, '..', 'scripts', 'verify-release-readback.js');
  const verify = () => spawnSync(process.execPath, [
    scriptPath,
    '--profile', 'free-test-journey-core-v1',
    '--manifest', manifestPath,
    '--readback', readbackPath,
  ], { encoding: 'utf8' });

  const accepted = verify();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.stdout, 'release-readback-ok\n');

  readback.functions[0].source_revision = 'c'.repeat(40);
  fs.writeFileSync(readbackPath, JSON.stringify(readback));
  const rejected = verify();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /parity failed/);
});

test('rejects installation-scope drift and mixed provider resource readback', () => {
  const { manifest, readback } = fixture();
  manifest.installation_scope.crm.workflow_dependency_required = true;
  assert.throws(() => verifyReadback(manifest, readback, contract), /source-scope parity/);

  const clean = fixture();
  clean.readback.tables.pop();
  assert.throws(
    () => verifyReadback(clean.manifest, clean.readback, contract),
    /tables/,
  );
});
