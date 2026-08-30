'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const functionRoot = path.join(__dirname, '..');

function connectorBodyLeafPaths(value, prefix = 'body') {
  if (prefix === 'body.job_meta.params' || value === null || typeof value !== 'object'
    || Array.isArray(value) || Object.keys(value).length === 0) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    connectorBodyLeafPaths(child, `${prefix}.${key}`));
}

test('job target is independently deployable and imports a materialized reviewed core package', () => {
  const config = JSON.parse(fs.readFileSync(path.join(functionRoot, 'catalyst-config.json'), 'utf8'));
  assert.deepEqual(config.deployment, {
    name: 'revenue_desk_call_worker', stack: 'node24', type: 'job',
  });
  assert.equal(Object.hasOwn(config.deployment, 'env_variables'), false);
  assert.equal(config.execution.main, 'index.js');
  const projectConfig = JSON.parse(fs.readFileSync(path.join(functionRoot, '..', '..', 'catalyst.json'), 'utf8'));
  assert.deepEqual(projectConfig.functions.targets, [
    'revenue_desk_call_gateway', 'revenue_desk_route_control', 'revenue_desk_call_worker',
  ]);
  assert.equal(projectConfig.functions.scripts.predeploy,
    'npm --prefix revenue_desk_route_control ci --ignore-scripts --install-links && npm --prefix revenue_desk_call_worker ci --ignore-scripts --install-links');
  const retryConfig = JSON.parse(fs.readFileSync(
    path.join(functionRoot, '..', '..', 'config', 'retry-job.json'), 'utf8',
  ));
  assert.equal(retryConfig.record_type, 'revenue_desk_call_worker_job_contract');
  assert.equal(retryConfig.schema_version, 4);
  assert.equal(retryConfig.environment, 'Development');
  assert.equal(retryConfig.current_status,
    'repository_provider_native_contract_defined_live_provisioning_unverified');
  assert.equal(retryConfig.production_authorized, false);
  assert.deepEqual(retryConfig.function_target, {
    name: 'revenue_desk_call_worker', stack: 'node24', type: 'job', memory_mb: 256,
  });
  assert.equal(retryConfig.function_target.memory_mb, 256);
  assert.equal(retryConfig.job_pool.memory_mb, 512);
  assert.equal(retryConfig.sdk_submission.target_name, 'revenue_desk_call_worker');
  assert.equal(retryConfig.sdk_submission.shape,
    'app.jobScheduling().JOB.submitJob(payload)');
  assert.equal(retryConfig.sdk_submission.platform_retries, 0);
  assert.deepEqual(retryConfig.scheduled_retry_scan.params, { mode: 'retry_scan' });
  assert.equal(retryConfig.scheduled_retry_scan.cron_name, 'RevenueDeskRetry1m');
  assert.equal(retryConfig.scheduled_retry_scan.cron_name_max_characters, 20);
  assert.equal(retryConfig.scheduled_retry_scan.cron_name.length
    <= retryConfig.scheduled_retry_scan.cron_name_max_characters, true,
    'Catalyst rejects Cron names longer than 20 characters');
  assert.equal(retryConfig.scheduled_retry_scan.initial_status, 'disabled');
  assert.deepEqual(retryConfig.scheduled_retry_scan.schedule,
    { hour: 0, minute: 1, second: 0, repetition_type: 'every' });
  assert.deepEqual(Object.keys(retryConfig.private_modes), [
    'process_event', 'retry_scan', 'rebuild_report', 'reconcile_deployment',
  ]);

  const functionPackage = require('../package.json');
  const functionLock = require('../package-lock.json');
  assert.equal(functionPackage.name, config.deployment.name);
  assert.equal(functionPackage.engines.node, '24.x');
  assert.equal(functionLock.packages[''].engines.node, '24.x');
  assert.match(fs.readFileSync(path.join(functionRoot, 'index.js'), 'utf8'),
    /createSafeConsoleLogger\(console\)/);
  const corePackagePath = require.resolve('revenue_desk_call_gateway/package.json');
  const corePackageRoot = path.dirname(corePackagePath);
  const coreSourceRoot = path.join(functionRoot, '..', 'revenue_desk_call_gateway');
  assert.equal(require(corePackagePath).name, 'revenue_desk_call_gateway');
  assert.equal(fs.lstatSync(corePackageRoot).isSymbolicLink(), false,
    'run npm ci with --install-links before Catalyst packages the job target');
  assert.equal(path.relative(functionRoot, fs.realpathSync(corePackageRoot)).startsWith('node_modules'), true);
  const runtimeFiles = [
    'index.js', 'package.json', path.join('contracts', 'revenue-desk-call-contract.json'),
    ...fs.readdirSync(path.join(coreSourceRoot, 'lib')).sort().map((name) => path.join('lib', name)),
  ];
  for (const relativePath of runtimeFiles) {
    assert.equal(
      fs.readFileSync(path.join(corePackageRoot, relativePath), 'utf8'),
      fs.readFileSync(path.join(coreSourceRoot, relativePath), 'utf8'),
      `materialized core package is stale: ${relativePath}`,
    );
  }
  assert.equal(typeof require('../index'), 'function');
});

test('retry Cron contract is provider-native, disabled-first, and fail-closed on ambiguity', () => {
  const retryConfig = JSON.parse(fs.readFileSync(
    path.join(functionRoot, '..', '..', 'config', 'retry-job.json'), 'utf8',
  ));
  const submitter = retryConfig.development_submitter;

  assert.equal(submitter.environment, retryConfig.environment);
  assert.equal(submitter.production_authorized, false);
  assert.equal(submitter.submitter_type, 'Cron');
  assert.equal(submitter.initial_status, retryConfig.scheduled_retry_scan.initial_status);
  assert.equal(submitter.cron_name, retryConfig.scheduled_retry_scan.cron_name);
  assert.equal(submitter.cron_name_max_characters,
    retryConfig.scheduled_retry_scan.cron_name_max_characters);
  assert.equal(submitter.job_name, retryConfig.scheduled_retry_scan.job_name);
  assert.deepEqual(submitter.write_connector, {
    name: 'Sylvara Catalyst Changes',
    create_tool: 'mcp__codex_apps__sylvara_catalyst_changes_catalystbyzoho_create_cron_job',
    status_tool:
      'mcp__codex_apps__sylvara_catalyst_changes_catalystbyzoho_update_cron_job_status',
    submit_tool: 'mcp__codex_apps__sylvara_catalyst_changes_catalystbyzoho_submit_cron_job',
    delete_tool: 'mcp__codex_apps__sylvara_catalyst_changes_catalystbyzoho_delete_cron_job',
  });
  assert.deepEqual(submitter.audit_connector, {
    name: 'Sylvara Catalyst Audit',
    inventory_tool: 'mcp__codex_apps__sylvara_catalyst_audit_catalystbyzoho_list_all_crons',
    resource_tool:
      'mcp__codex_apps__sylvara_catalyst_audit_catalystbyzoho_get_cron_job_by_id',
    job_tool: 'mcp__codex_apps__sylvara_catalyst_audit_catalystbyzoho_get_job_by_id',
    log_tool: 'mcp__codex_apps__sylvara_catalyst_audit_catalystbyzoho_get_logs',
  });

  assert.deepEqual(
    Object.fromEntries(Object.entries(submitter.private_bindings)
      .filter(([, value]) => typeof value === 'object' && !Array.isArray(value))
      .map(([name, value]) => [name, value.required_type])),
    {
      organization_id: 'number',
      project_id: 'string',
      job_pool_id: 'string',
      function_id: 'string',
      cron_id: 'string',
      job_id: 'string',
      execution_id: 'string',
    },
  );
  assert.equal(submitter.private_bindings.rules.length, 4);
  assert.deepEqual(submitter.private_bindings.cron_id, {
    placeholder: 'TBD_PRIVATE_CALL_RETRY_CRON_ID',
    required_type: 'string',
    source: 'fresh exact Cron inventory or create-response readback',
    destinations: [
      'provider_readback.arguments_template.path_variables.id',
      'status_change.exact_canonical_arguments_templates.*.path_variables.id',
      'disabled_canary.submission_arguments_template.path_variables.id',
      'prestate_and_rollback.conditional_delete.arguments_template.path_variables.id',
    ],
  });
  assert.equal(submitter.private_bindings.execution_id.destination,
    'disabled_canary.execution_scoped_log_readback.arguments_template.query_params.execution_id');

  assert.deepEqual(submitter.create_arguments_template, {
    headers: {
      'Catalyst-org': 'TBD_PRIVATE_CATALYST_ORG_ID',
      Environment: 'Development',
    },
    path_variables: { projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID' },
    body: {
      cron_execution_type: 'pre-defined',
      cron_name: 'RevenueDeskRetry1m',
      cron_status: false,
      cron_type: 'Periodic',
      job_detail: {
        hour: '0', minute: '1', second: '0', repetition_type: 'every',
      },
      job_meta: {
        job_name: 'RevenueDeskRetryScan',
        jobpool_id: 'TBD_PRIVATE_CALL_JOB_POOL_ID',
        jobpool_name: 'RevenueDeskCallJobs',
        params: { mode: 'retry_scan' },
        source_type: 'Cron',
        target_id: 'TBD_PRIVATE_CALL_WORKER_FUNCTION_ID',
        target_name: 'revenue_desk_call_worker',
        target_type: 'Function',
        job_config: { number_of_retries: '0' },
      },
    },
  });

  const inventory = submitter.inventory_readback;
  assert.equal(inventory.tool, submitter.audit_connector.inventory_tool);
  assert.deepEqual(inventory.arguments_template, {
    headers: {
      'Catalyst-org': 'TBD_PRIVATE_CATALYST_ORG_ID', Environment: 'Development',
    },
    path_variables: { projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID' },
  });
  assert.equal(inventory.shape_status,
    'fresh_complete_array_item_and_pagination_proof_required_before_classification');
  assert.equal(inventory.documented_inventory_scope, 'pre-defined Crons only');
  assert.equal(inventory.candidate_raw_array_path, 'data');
  assert.deepEqual(inventory.required_item_path_map, {
    cron_id: 'data[].id', cron_name: 'data[].cron_name',
    cron_execution_type: 'data[].cron_execution_type', cron_status: 'data[].cron_status',
  });
  assert.deepEqual(inventory.required_item_type_map, {
    'data[].id': 'lossless_exact_identifier', 'data[].cron_name': 'string',
    'data[].cron_execution_type': 'string', 'data[].cron_status': 'boolean',
  });
  assert.match(inventory.completeness_gates.join(' '),
    /complete untruncated array.*empty.*never proves absence.*every item.*all-type name inventory.*create remain blocked/i);
  assert.deepEqual(Object.keys(inventory.classification_rules),
    ['candidate_name', 'absent', 'exact', 'drifted', 'duplicate']);
  assert.equal(inventory.classification_rules.candidate_name, 'RevenueDeskRetry1m');
  assert.match(inventory.classification_rules.absent,
    /all-type name-collision proof.*zero exact-name matches/i);
  assert.match(inventory.classification_rules.exact,
    /Exactly one lossless.*get-by-ID normalized projection.*phase-specific canonical/i);
  assert.match(inventory.classification_rules.drifted,
    /Exactly one lossless.*differs from the canonical projection/i);
  assert.match(inventory.classification_rules.duplicate,
    /More than one.*any execution type.*collision exclusion is incomplete/i);
  assert.match(inventory.stop_gate,
    /No branch.*array shape.*completeness.*pagination.*all-execution-type/i);

  const readback = submitter.provider_readback;
  assert.equal(readback.tool, submitter.audit_connector.resource_tool);
  assert.equal(readback.shape_status,
    'fresh_audit_response_shape_proof_required_before_create_or_exact_comparison');
  assert.deepEqual(readback.arguments_template, {
    headers: {
      'Catalyst-org': 'TBD_PRIVATE_CATALYST_ORG_ID', Environment: 'Development',
    },
    path_variables: {
      id: 'TBD_PRIVATE_CALL_RETRY_CRON_ID', projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID',
    },
  });
  const behaviorPolicy = readback.exact_behavior_field_policy;
  const advertisedFields = behaviorPolicy.advertised_connector_body_leaf_paths;
  const safetyBuckets = [
    behaviorPolicy.canonical_present_leaf_paths,
    behaviorPolicy.canonical_absent_behavior_leaf_paths,
    behaviorPolicy.provider_generated_identity_or_integrity_leaf_paths,
    behaviorPolicy.provider_metadata_never_resent_leaf_paths,
  ];
  const bucketFields = safetyBuckets.flat();
  assert.equal(advertisedFields.length, 61);
  assert.equal(new Set(advertisedFields).size, advertisedFields.length);
  assert.equal(new Set(bucketFields).size, bucketFields.length,
    'advertised Cron fields must belong to exactly one safety bucket');
  assert.deepEqual([...bucketFields].sort(), [...advertisedFields].sort());
  assert.deepEqual([...behaviorPolicy.canonical_present_leaf_paths].sort(),
    connectorBodyLeafPaths(submitter.create_arguments_template.body).sort());
  const dangerousAbsentReadbackPaths = [
    'data.cron_expression', 'data.description', 'data.end_time',
    'data.cron_detail.dateInmonth', 'data.cron_detail.days', 'data.cron_detail.months',
    'data.cron_detail.periodicity', 'data.cron_detail.skipFrequency',
    'data.cron_detail.start_date', 'data.cron_detail.start_month',
    'data.cron_detail.start_year', 'data.cron_detail.time_of_execution',
    'data.cron_detail.timezone', 'data.cron_detail.week_day',
    'data.cron_detail.weeks_of_month', 'data.job_meta.content_type',
    'data.job_meta.headers', 'data.job_meta.is_query_param_enable',
    'data.job_meta.job_config.retry_interval', 'data.job_meta.job_desc',
    'data.job_meta.jobpool_details.capacity.number', 'data.job_meta.notify_url',
    'data.job_meta.request_body', 'data.job_meta.request_method',
    'data.job_meta.target_details.details', 'data.job_meta.url',
  ];
  assert.deepEqual(behaviorPolicy.provider_readback_paths_that_must_be_proven_absent,
    dangerousAbsentReadbackPaths);
  const absentRequestPaths = dangerousAbsentReadbackPaths.map((rawPath) => rawPath
    .replace(/^data\.cron_detail/, 'body.job_detail')
    .replace(/^data\.job_meta/, 'body.job_meta')
    .replace(/^data\./, 'body.'));
  assert.deepEqual([...behaviorPolicy.canonical_absent_behavior_leaf_paths].sort(),
    absentRequestPaths.sort());
  assert.deepEqual(behaviorPolicy.provider_generated_identity_or_integrity_leaf_paths, [
    'body.job_meta.id',
    'body.job_meta.jobpool_details.capacity.memory',
    'body.job_meta.jobpool_details.name',
    'body.job_meta.jobpool_details.parentId',
    'body.job_meta.jobpool_details.projectId',
    'body.job_meta.jobpool_details.type',
    'body.job_meta.source_details.details',
    'body.job_meta.source_details.id',
    'body.job_meta.source_details.source_name',
    'body.job_meta.source_id',
    'body.job_meta.target_details.id',
    'body.job_meta.target_details.target_name',
    'body.project_details',
  ]);
  assert.deepEqual(behaviorPolicy.provider_metadata_never_resent_leaf_paths, [
    'body.job_meta.jobpool_details.created_by',
    'body.job_meta.jobpool_details.created_time',
    'body.job_meta.jobpool_details.description',
    'body.job_meta.jobpool_details.modified_by',
    'body.job_meta.jobpool_details.modified_time',
  ]);
  assert.deepEqual(behaviorPolicy.known_provider_only_paths, [
    'data.id', 'data.created_by', 'data.created_time', 'data.cron_detail.jobId',
    'data.job_meta.jobpool_details.id',
    'data.job_meta.jobpool_details.project_details.id',
    'data.job_meta.jobpool_details.project_details.project_name',
    'data.job_meta.jobpool_details.project_details.project_type',
    'data.modified_by', 'data.modified_time',
  ]);
  assert.match(behaviorPolicy.rules.join(' '),
    /mutually exclusive.*complete advertised.*literally absent.*Null.*unobserved path.*not evidence of absence.*unknown.*blocks exact classification/i);
  assert.match(behaviorPolicy.provider_generated_exact_relations.join(' '),
    /job_meta\.id.*not a submitted execution Job ID.*cron_detail\.jobId.*never a submitted execution Job ID.*source_details\.id.*Cron ID/i);
  assert.equal(readback.documented_raw_path_map.cron_id, 'data.id');
  assert.equal(readback.documented_raw_path_map['schedule.hour'], 'data.cron_detail.hour');
  assert.equal(readback.documented_raw_path_map['job.job_pool_name'],
    'data.job_meta.jobpool_details.name');
  assert.equal(readback.documented_raw_path_map['job.target_id'],
    'data.job_meta.target_details.id');
  assert.equal(readback.documented_raw_path_map['job.target_name'],
    'data.job_meta.target_details.target_name');
  assert.deepEqual(readback.documented_raw_type_requirements, {
    'data.id': 'lossless_exact_identifier',
    'data.cron_status': 'boolean',
    'data.cron_detail.hour': 'number',
    'data.cron_detail.minute': 'number',
    'data.cron_detail.second': 'number',
    'data.job_meta.jobpool_id': 'lossless_exact_identifier',
    'data.job_meta.params': 'object',
    'data.job_meta.target_details.id': 'lossless_exact_identifier',
    'data.job_meta.job_config.number_of_retries': 'number',
  });
  assert.deepEqual(readback.expected_normalized_projection_base, {
    cron_id: 'TBD_PRIVATE_CALL_RETRY_CRON_ID',
    cron_execution_type: 'pre-defined',
    cron_name: 'RevenueDeskRetry1m',
    cron_type: 'Periodic',
    schedule: { hour: 0, minute: 1, second: 0, repetition_type: 'every' },
    job: {
      job_name: 'RevenueDeskRetryScan',
      job_pool_id: 'TBD_PRIVATE_CALL_JOB_POOL_ID',
      job_pool_name: 'RevenueDeskCallJobs',
      job_pool_type: 'Function',
      params: { mode: 'retry_scan' },
      source_type: 'Cron',
      target_id: 'TBD_PRIVATE_CALL_WORKER_FUNCTION_ID',
      target_name: 'revenue_desk_call_worker',
      target_type: 'Function',
      number_of_retries: 0,
    },
  });
  assert.deepEqual(readback.expected_cron_status_by_phase, {
    prestate_provisioning_and_disabled_canary: false,
    post_activation: true,
    containment_and_rollback: false,
  });
  assert.deepEqual(readback.forbidden_unproven_request_shaped_paths, [
    'data.job_detail',
    'data.job_meta.jobpool_name',
    'data.job_meta.target_id',
    'data.job_meta.target_name',
  ]);
  assert.match(readback.stop_gate, /perform no create, update, activation, canary, or deletion/);

  const statusChange = submitter.status_change;
  assert.equal(statusChange.shape_status,
    'fresh_connector_status_schema_proof_required_before_first_use');
  assert.equal(statusChange.tool, submitter.write_connector.status_tool);
  assert.equal(statusChange.advertised_connector_shape,
    'headers plus path_variables with Cron and project IDs plus the complete Cron body');
  assert.equal(statusChange.official_status_only_shape, 'Cron ID plus cron_status');
  assert.equal(statusChange.full_body_safety_gate.execution_ready, false);
  assert.equal(statusChange.full_body_safety_gate.required_contract,
    'provider_readback.exact_behavior_field_policy');
  assert.match(statusChange.full_body_safety_gate.prerequisites.join(' '),
    /status-only PATCH.*nonreplacement.*canonical-absent.*unknown field.*not executable/i);
  const statusArguments = {
    headers: submitter.create_arguments_template.headers,
    path_variables: {
      id: 'TBD_PRIVATE_CALL_RETRY_CRON_ID', projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID',
    },
  };
  assert.deepEqual(statusChange.exact_canonical_arguments_templates.disable, {
    ...statusArguments, body: submitter.create_arguments_template.body,
  });
  assert.deepEqual(statusChange.exact_canonical_arguments_templates.enable, {
    ...statusArguments,
    body: { ...submitter.create_arguments_template.body, cron_status: true },
  });
  assert.match(statusChange.rules.join(' '),
    /which advertised status body shape.*do not probe by mutation.*exact canonical readback.*Never use.*drifted or duplicate.*disabled-Cron containment as unproven/i);

  const safety = submitter.prestate_and_rollback;
  assert.deepEqual(safety.contained_function_configuration, {
    function_name: 'revenue_desk_call_worker',
    variable: 'DEPLOYMENT_MODE',
    contained_value: 'dark',
    activation_value: 'active',
    development_dark_effect: 'intentional fail-closed configuration rejection before SDK initialization',
    gateway_configuration_mutation_authorized: false,
  });
  assert.match(safety.mode_first_containment[0], /^Set DEPLOYMENT_MODE=dark/);
  assert.deepEqual(Object.keys(safety.prestate_branches), [
    'absent', 'exact', 'drifted', 'duplicate',
  ]);
  assert.deepEqual(Object.keys(safety.rollback_branches), [
    'created_from_absent', 'preexisting_exact', 'drifted_or_duplicate', 'ambiguous_create',
  ]);
  assert.deepEqual(safety.job_drain.accepted_job_id_sources, [
    {
      surface: 'manual Cron submit response', documented_path: 'data.job_id',
      fresh_shape_proof_required: true,
    },
    {
      surface: 'provider-complete Cron execution history', documented_path: null,
      status: 'unproven_until_a_fresh_lossless_execution_history_shape_is_available',
    },
  ]);
  assert.deepEqual(safety.job_drain.forbidden_job_id_sources, [
    'Cron create response data.id', 'Cron resource data.id', 'cron_detail.jobId',
    'Job metadata, pool, target, or function IDs',
  ]);
  assert.equal(safety.job_drain.terminal_readback_required, true);
  assert.equal(safety.job_drain.complete_execution_inventory_required, true);
  assert.match(safety.job_drain.unknown_or_nonterminal_action,
    /worker mode dark.*Cron containment.*Job drain.*unproven.*stop/i);
  assert.match(safety.prestate_branches.drifted,
    /only with proven safe status shape.*Drain only proven Job IDs.*stop/i);
  assert.match(safety.prestate_branches.duplicate,
    /only with proven safe status shape.*Drain only proven Job IDs.*without selecting or deleting/i);
  assert.match(safety.rollback_branches.drifted_or_duplicate,
    /Preserve every affected definition.*worker mode dark.*Cron containment unproven/i);
  assert.match(safety.rollback_branches.ambiguous_create,
    /Re-list through the complete inventory contract.*duplicate prestate.*no retry or deletion/i);
  assert.equal(safety.conditional_delete.authorized_by_this_contract, false);
  assert.equal(safety.conditional_delete.tool, submitter.write_connector.delete_tool);
  assert.deepEqual(safety.conditional_delete.arguments_template, {
    headers: submitter.create_arguments_template.headers,
    path_variables: {
      id: 'TBD_PRIVATE_CALL_RETRY_CRON_ID', projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID',
    },
  });
  assert.match(safety.conditional_delete.destructive_effect,
    /Permanently deletes.*execution history.*cannot be undone/i);
  assert.match(safety.conditional_delete.prerequisites.join(' '),
    /fresh live packet.*exact packet-created Cron ID.*complete execution inventory.*terminal drain/i);
  assert.match(safety.conditional_delete.success_readback.join(' '),
    /all-execution-type.*exact Cron ID and name.*get-by-ID.*not-found/i);
  assert.equal(safety.conditional_delete.success_readback_contracts.inventory.tool,
    submitter.audit_connector.inventory_tool);
  assert.deepEqual(safety.conditional_delete.success_readback_contracts
    .inventory.arguments_template, submitter.inventory_readback.arguments_template);
  assert.equal(safety.conditional_delete.success_readback_contracts.resource.tool,
    submitter.audit_connector.resource_tool);
  assert.deepEqual(safety.conditional_delete.success_readback_contracts
    .resource.arguments_template, submitter.provider_readback.arguments_template);
  assert.match(safety.conditional_delete.success_readback_contracts
    .inventory.required_result, /neither the exact Cron ID nor RevenueDeskRetry1m/i);
  assert.match(safety.conditional_delete.success_readback_contracts
    .resource.required_result, /not-found.*exact Cron ID/i);
  assert.match(safety.conditional_delete.ambiguous_outcome,
    /Never retry deletion.*both independent readbacks.*fresh authority/i);
  assert.equal(safety.deletion_authorized_by_this_contract, false);

  const canary = submitter.disabled_canary;
  assert.equal(canary.acceptance_status,
    'blocked_until_lossless_job_to_execution_id_binding_is_proven');
  assert.equal(canary.live_action_authorized_by_this_contract, false);
  assert.equal(canary.canary_scope,
    'worker_dark_containment_only_not_retry_scan_business_behavior');
  assert.equal(canary.required_worker_mode, 'dark');
  assert.equal(canary.required_cron_status, false);
  assert.deepEqual(canary.submission_arguments_template.body,
    submitter.create_arguments_template.body.job_meta);
  assert.deepEqual({
    job_id: canary.terminal_job_readback.documented_raw_paths.job_id,
    job_status: canary.terminal_job_readback.documented_raw_paths.job_status,
    source_type: canary.terminal_job_readback.documented_raw_paths.source_type,
    source_cron_id: canary.terminal_job_readback.documented_raw_paths.source_cron_id,
    source_cron_name: canary.terminal_job_readback.documented_raw_paths.source_cron_name,
    source_cron_execution_type:
      canary.terminal_job_readback.documented_raw_paths.source_cron_execution_type,
  }, {
    job_id: 'data.job_id',
    job_status: 'data.job_status',
    source_type: 'data.job_meta_details.source_type',
    source_cron_id: 'data.job_meta_details.source_details.id',
    source_cron_name: 'data.job_meta_details.source_details.source_name',
    source_cron_execution_type:
      'data.job_meta_details.source_details.details.cron_execution_type',
  });
  assert.equal(canary.terminal_job_readback.documented_terminal_success_value, 'SUCCESS');
  assert.deepEqual(canary.terminal_job_readback.expected_normalized_job_projection_template, {
    job_id: 'TBD_PRIVATE_CALL_RETRY_JOB_ID',
    job_status: 'SUCCESS',
    job_name: 'RevenueDeskRetryScan',
    job_pool_id: 'TBD_PRIVATE_CALL_JOB_POOL_ID',
    job_pool_name: 'RevenueDeskCallJobs',
    params: { mode: 'retry_scan' },
    source_type: 'Cron',
    source_cron_id: 'TBD_PRIVATE_CALL_RETRY_CRON_ID',
    source_cron_name: 'RevenueDeskRetry1m',
    source_cron_execution_type: 'pre-defined',
    target_id: 'TBD_PRIVATE_CALL_WORKER_FUNCTION_ID',
    target_name: 'revenue_desk_call_worker',
    target_type: 'Function',
    number_of_retries: 0,
  });
  assert.equal(canary.terminal_job_readback.submission_identity_binding
    .manual_submit_response_job_id_path, 'data.job_id');
  assert.match(canary.terminal_job_readback.submission_identity_binding
    .required_equalities.join(' '),
  /manual-submit response data\.job_id.*get-by-ID request path ID.*response data\.job_id.*source_type.*source_details\.id.*RevenueDeskRetry1m.*different ID.*not canary evidence/i);
  assert.equal(canary.execution_correlation.documented_job_response_execution_id_path, null);
  assert.equal(canary.execution_correlation.required_for_canary_acceptance, true);
  assert.equal(canary.execution_correlation.time_window_or_unscoped_log_fallback_allowed, false);
  assert.deepEqual(canary.execution_scoped_log_readback.arguments_template, {
    headers: {
      'Catalyst-org': 'TBD_PRIVATE_CATALYST_ORG_ID', Environment: 'Development',
    },
    path_variables: { projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID' },
    query_params: {
      execution_id: 'TBD_PRIVATE_CALL_RETRY_EXECUTION_ID',
      resource_list: 'TBD_PRIVATE_CALL_WORKER_FUNCTION_ID',
      logType: 'application', level: 'ERROR', search: 'revenue_desk_worker_failed',
      timezone: 'UTC',
    },
  });
  assert.equal(canary.execution_scoped_log_readback.required_exact_event,
    'revenue_desk_worker_failed');
  assert.equal(canary.execution_scoped_log_readback.required_exact_error_code,
    'INVALID_RUNTIME_CONFIGURATION');
  assert.equal(canary.no_io_conclusion.classification,
    'inference_only_not_provider_io_telemetry');
  assert.equal(canary.no_io_conclusion.provider_io_absence_directly_observed, false);
  assert.equal(submitter.activation.separate_development_approval_required, true);
  assert.equal(submitter.activation.mode_before_cron_status, true);

  const coreSourceRoot = path.join(functionRoot, '..', 'revenue_desk_call_gateway');
  const handlerSource = fs.readFileSync(path.join(coreSourceRoot, 'lib', 'job-handler.js'), 'utf8');
  const configLoadIndex = handlerSource.indexOf('const config = loadJobConfig(environment');
  const sdkLoadIndex = handlerSource.indexOf(
    "const runtimeCatalystSdk = catalystSdk || require('zcatalyst-sdk-node')",
  );
  assert.notEqual(configLoadIndex, -1);
  assert.notEqual(sdkLoadIndex, -1);
  assert.equal(configLoadIndex < sdkLoadIndex, true,
    'worker configuration must fail closed before SDK initialization');
});

test('worker and Analytics Cron contracts retain the same common safety surface', () => {
  const worker = JSON.parse(fs.readFileSync(
    path.join(functionRoot, '..', '..', 'config', 'retry-job.json'), 'utf8',
  )).development_submitter;
  const analytics = JSON.parse(fs.readFileSync(path.join(
    functionRoot, '..', '..', '..', 'revenue-desk-analytics', 'config', 'analytics-sync.json',
  ), 'utf8')).development_submitter;

  const requiredSections = [
    'write_connector', 'audit_connector', 'private_bindings', 'create_arguments_template',
    'inventory_readback', 'provider_readback', 'status_change', 'prestate_and_rollback',
    'disabled_canary', 'activation',
  ];
  for (const section of requiredSections) {
    assert.equal(Object.hasOwn(worker, section), true, `worker missing ${section}`);
    assert.equal(Object.hasOwn(analytics, section), true, `Analytics missing ${section}`);
  }
  assert.deepEqual(Object.keys(worker.inventory_readback),
    Object.keys(analytics.inventory_readback));
  assert.deepEqual(Object.keys(worker.provider_readback),
    Object.keys(analytics.provider_readback));
  assert.deepEqual(Object.keys(worker.status_change), Object.keys(analytics.status_change));
  assert.deepEqual(Object.keys(worker.prestate_and_rollback.job_drain),
    Object.keys(analytics.prestate_and_rollback.job_drain));
  assert.deepEqual(Object.keys(worker.disabled_canary.execution_scoped_log_readback.arguments_template),
    ['headers', 'path_variables', 'query_params']);
  assert.deepEqual(Object.keys(worker.disabled_canary.execution_scoped_log_readback.arguments_template),
    Object.keys(analytics.disabled_canary.execution_scoped_log_readback.arguments_template));
});
