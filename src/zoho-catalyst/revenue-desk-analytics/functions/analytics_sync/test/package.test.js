'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const functionRoot = path.join(__dirname, '..');
const projectRoot = path.join(functionRoot, '..', '..');

function json(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function connectorBodyLeafPaths(value, prefix = 'body') {
  if (prefix === 'body.job_meta.params' || value === null || typeof value !== 'object'
    || Array.isArray(value) || Object.keys(value).length === 0) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    connectorBodyLeafPaths(child, `${prefix}.${key}`));
}

test('package is exactly one private analytics_sync Job target with no HTTP route', () => {
  const catalyst = json('catalyst.json');
  assert.deepEqual(catalyst.functions.targets, ['analytics_sync']);
  assert.equal(catalyst.functions.source, 'functions');
  assert.equal(catalyst.functions.scripts.predeploy,
    'npm --prefix analytics_sync ci --ignore-scripts');
  assert.equal(fs.existsSync(path.join(projectRoot, 'config', 'routes.json')), false);
  const deployment = JSON.parse(fs.readFileSync(
    path.join(functionRoot, 'catalyst-config.json'), 'utf8'));
  assert.deepEqual(deployment.deployment,
    { name: 'analytics_sync', stack: 'node24', type: 'job' });
  assert.equal(deployment.execution.main, 'index.js');
  const packageJson = require('../package.json');
  assert.equal(packageJson.name, 'analytics_sync');
  assert.deepEqual(packageJson.engines, { node: '24.x' });
  const lock = require('../package-lock.json');
  assert.deepEqual(lock.packages[''].engines, { node: '24.x' });
  assert.equal(packageJson.scripts['artifact:verify'],
    'node verify-artifact.js && npm ls --omit=dev --all --ignore-scripts');
  assert.equal(typeof require('../index'), 'function');
});

test('Job, pool, empty params, dark Production, and provider contracts are exact', () => {
  const contract = json(path.join('config', 'analytics-sync.json'));
  assert.equal(contract.schema_version, 3);
  assert.equal(contract.function.target_name, 'analytics_sync');
  assert.equal(contract.function.stack, 'node24');
  assert.equal(contract.function.public_http_endpoint, false);
  assert.deepEqual(contract.job_pool, {
    name: 'RevenueDeskAnalyticsJobs', type: 'Function', memory_mb: 512,
    platform_retries_enabled: false, job_params: {},
  });
  const submitter = contract.development_submitter;
  assert.equal(submitter.environment, 'Development');
  assert.equal(submitter.submitter_type, 'Cron');
  assert.equal(submitter.initial_status, 'disabled');
  assert.equal(submitter.cron_name, 'RevenueAnalytics1m');
  assert.equal(submitter.cron_name_max_characters, 20);
  assert.equal(submitter.cron_name.length <= submitter.cron_name_max_characters, true,
    'Catalyst rejects Cron names longer than 20 characters');
  assert.equal(submitter.job_name, 'RevenueAnalyticsSync');
  assert.equal(submitter.production_authorized, false);
  assert.deepEqual(submitter.write_connector, {
    name: 'Sylvara Catalyst Changes',
    create_tool: 'mcp__codex_apps__sylvara_catalyst_changes_catalystbyzoho_create_cron_job',
    status_tool: 'mcp__codex_apps__sylvara_catalyst_changes_catalystbyzoho_update_cron_job_status',
    submit_tool: 'mcp__codex_apps__sylvara_catalyst_changes_catalystbyzoho_submit_cron_job',
    delete_tool: 'mcp__codex_apps__sylvara_catalyst_changes_catalystbyzoho_delete_cron_job',
  });
  assert.deepEqual(submitter.audit_connector, {
    name: 'Sylvara Catalyst Audit',
    inventory_tool: 'mcp__codex_apps__sylvara_catalyst_audit_catalystbyzoho_list_all_crons',
    resource_tool: 'mcp__codex_apps__sylvara_catalyst_audit_catalystbyzoho_get_cron_job_by_id',
    job_tool: 'mcp__codex_apps__sylvara_catalyst_audit_catalystbyzoho_get_job_by_id',
    log_tool: 'mcp__codex_apps__sylvara_catalyst_audit_catalystbyzoho_get_logs',
  });
  const bindings = submitter.private_bindings;
  assert.deepEqual(Object.keys(bindings), [
    'organization_id', 'project_id', 'job_pool_id', 'function_id', 'cron_id',
    'job_id', 'execution_id', 'rules',
  ]);
  assert.deepEqual([
    bindings.organization_id, bindings.project_id, bindings.job_pool_id,
    bindings.function_id,
  ], [
    { placeholder: 'TBD_PRIVATE_CATALYST_ORG_ID', required_type: 'number',
      destination: 'headers.Catalyst-org' },
    { placeholder: 'TBD_PRIVATE_CATALYST_PROJECT_ID', required_type: 'string',
      destination: 'path_variables.projectId' },
    { placeholder: 'TBD_PRIVATE_ANALYTICS_JOB_POOL_ID', required_type: 'string',
      destination: 'body.job_meta.jobpool_id' },
    { placeholder: 'TBD_PRIVATE_ANALYTICS_FUNCTION_ID', required_type: 'string',
      destination: 'body.job_meta.target_id' },
  ]);
  assert.deepEqual(bindings.cron_id, {
    placeholder: 'TBD_PRIVATE_ANALYTICS_CRON_ID', required_type: 'string',
    source: 'fresh exact Cron inventory or create-response readback',
    destinations: [
      'provider_readback.arguments_template.path_variables.id',
      'status_change.exact_canonical_arguments_templates.*.path_variables.id',
      'disabled_canary.submission_arguments_template.path_variables.id',
      'prestate_and_rollback.conditional_delete.arguments_template.path_variables.id',
    ],
  });
  assert.deepEqual(bindings.job_id, {
    placeholder: 'TBD_PRIVATE_ANALYTICS_JOB_ID', required_type: 'string',
    source: 'manual-submit response',
    destination: 'disabled_canary.terminal_job_readback.arguments_template.path_variables.id',
  });
  assert.deepEqual(bindings.execution_id, {
    placeholder: 'TBD_PRIVATE_ANALYTICS_EXECUTION_ID', required_type: 'string',
    source: 'fresh lossless Job-to-execution correlation proof',
    destination: 'disabled_canary.execution_scoped_log_readback.arguments_template.query_params.execution_id',
  });
  assert.match(bindings.rules.join(' '),
    /fresh Development Audit readback.*required type.*never commit.*blocks the write/i);

  const create = submitter.create_arguments_template;
  assert.deepEqual(create, {
    headers: {
      'Catalyst-org': 'TBD_PRIVATE_CATALYST_ORG_ID', Environment: 'Development',
    },
    path_variables: { projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID' },
    body: {
      cron_execution_type: 'pre-defined',
      cron_name: 'RevenueAnalytics1m',
      cron_status: false,
      cron_type: 'Periodic',
      job_detail: { hour: '0', minute: '1', second: '0', repetition_type: 'every' },
      job_meta: {
        job_name: 'RevenueAnalyticsSync',
        jobpool_id: 'TBD_PRIVATE_ANALYTICS_JOB_POOL_ID',
        jobpool_name: contract.job_pool.name,
        params: {},
        source_type: 'Cron',
        target_id: 'TBD_PRIVATE_ANALYTICS_FUNCTION_ID',
        target_name: contract.function.target_name,
        target_type: contract.job_pool.type,
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
  assert.equal(inventory.classification_rules.candidate_name, submitter.cron_name);
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
      id: 'TBD_PRIVATE_ANALYTICS_CRON_ID', projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID',
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
    connectorBodyLeafPaths(create.body).sort());
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
  assert.deepEqual(readback.documented_raw_path_map, {
    cron_id: 'data.id',
    cron_execution_type: 'data.cron_execution_type',
    cron_name: 'data.cron_name',
    cron_status: 'data.cron_status',
    cron_type: 'data.cron_type',
    'schedule.hour': 'data.cron_detail.hour',
    'schedule.minute': 'data.cron_detail.minute',
    'schedule.second': 'data.cron_detail.second',
    'schedule.repetition_type': 'data.cron_detail.repetition_type',
    'job.job_name': 'data.job_meta.job_name',
    'job.job_pool_id': 'data.job_meta.jobpool_id',
    'job.job_pool_name': 'data.job_meta.jobpool_details.name',
    'job.job_pool_type': 'data.job_meta.jobpool_details.type',
    'job.params': 'data.job_meta.params',
    'job.source_type': 'data.job_meta.source_type',
    'job.target_id': 'data.job_meta.target_details.id',
    'job.target_name': 'data.job_meta.target_details.target_name',
    'job.target_type': 'data.job_meta.target_type',
    'job.number_of_retries': 'data.job_meta.job_config.number_of_retries',
  });
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
    cron_id: 'TBD_PRIVATE_ANALYTICS_CRON_ID',
    cron_execution_type: 'pre-defined',
    cron_name: 'RevenueAnalytics1m',
    cron_type: 'Periodic',
    schedule: { hour: 0, minute: 1, second: 0, repetition_type: 'every' },
    job: {
      job_name: 'RevenueAnalyticsSync',
      job_pool_id: 'TBD_PRIVATE_ANALYTICS_JOB_POOL_ID',
      job_pool_name: contract.job_pool.name,
      job_pool_type: contract.job_pool.type,
      params: {}, source_type: 'Cron', target_id: 'TBD_PRIVATE_ANALYTICS_FUNCTION_ID',
      target_name: contract.function.target_name, target_type: contract.job_pool.type,
      number_of_retries: 0,
    },
  });
  assert.deepEqual(readback.expected_cron_status_by_phase, {
    prestate_provisioning_and_disabled_canary: false,
    post_activation: true,
    containment_and_rollback: false,
  });
  assert.match(readback.normalization_rules.join(' '),
    /fresh private Audit response.*numeric Cron schedule.*target_details.*jobpool_details.*lossless exact.*phase-specific cron_status/i);
  assert.deepEqual(readback.forbidden_unproven_request_shaped_paths, [
    'data.job_detail', 'data.job_meta.jobpool_name', 'data.job_meta.target_id',
    'data.job_meta.target_name',
  ]);
  assert.match(readback.stop_gate,
    /shape proof.*lossless execution identity.*no create.*canary.*preserve mode-first containment/i);

  const statusChange = submitter.status_change;
  assert.equal(statusChange.shape_status,
    'fresh_connector_status_schema_proof_required_before_first_use');
  assert.equal(statusChange.tool, submitter.write_connector.status_tool);
  assert.equal(statusChange.full_body_safety_gate.execution_ready, false);
  assert.equal(statusChange.full_body_safety_gate.required_contract,
    'provider_readback.exact_behavior_field_policy');
  assert.match(statusChange.full_body_safety_gate.prerequisites.join(' '),
    /status-only PATCH.*nonreplacement.*canonical-absent.*unknown field.*not executable/i);
  const statusArguments = {
    headers: create.headers,
    path_variables: {
      id: 'TBD_PRIVATE_ANALYTICS_CRON_ID', projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID',
    },
  };
  assert.deepEqual(statusChange.exact_canonical_arguments_templates.disable, {
    ...statusArguments, body: create.body,
  });
  assert.deepEqual(statusChange.exact_canonical_arguments_templates.enable, {
    ...statusArguments, body: { ...create.body, cron_status: true },
  });
  assert.match(statusChange.rules.join(' '),
    /which advertised status body shape.*do not probe by mutation.*exact canonical readback.*Never use.*drifted or duplicate.*disabled-Cron containment as unproven/i);

  const containment = submitter.prestate_and_rollback;
  assert.match(containment.mode_first_containment.join(' '),
    /ANALYTICS_SYNC_MODE=disabled.*cron_status=false.*Drain every.*terminal state/i);
  assert.deepEqual(Object.keys(containment.prestate_branches),
    ['absent', 'exact', 'drifted', 'duplicate']);
  assert.match(containment.prestate_branches.absent, /create.*disabled.*exact provider readback/i);
  assert.match(containment.prestate_branches.exact, /no create or update.*disabled/i);
  assert.match(containment.prestate_branches.drifted, /disable.*drain.*stop/i);
  assert.match(containment.prestate_branches.duplicate, /disable.*every.*drain.*without.*deleting/i);
  assert.deepEqual(Object.keys(containment.rollback_branches), [
    'created_from_absent', 'preexisting_exact', 'drifted_or_duplicate', 'ambiguous_create',
  ]);
  assert.deepEqual(containment.job_drain.accepted_job_id_sources, [
    {
      surface: 'manual Cron submit response', documented_path: 'data.job_id',
      fresh_shape_proof_required: true,
    },
    {
      surface: 'provider-complete Cron execution history', documented_path: null,
      status: 'unproven_until_a_fresh_lossless_execution_history_shape_is_available',
    },
  ]);
  assert.deepEqual(containment.job_drain.forbidden_job_id_sources, [
    'Cron create response data.id', 'Cron resource data.id', 'cron_detail.jobId',
    'Job metadata, pool, target, or function IDs',
  ]);
  assert.equal(containment.job_drain.terminal_readback_required, true);
  assert.equal(containment.job_drain.complete_execution_inventory_required, true);
  assert.match(containment.job_drain.unknown_or_nonterminal_action,
    /mode disabled.*Cron containment.*Job drain.*unproven.*stop/i);
  assert.match(containment.rollback_branches.created_from_absent,
    /mode-first containment.*Job drain.*fresh live packet.*exact packet-created Cron ID/i);
  assert.match(containment.rollback_branches.ambiguous_create,
    /Re-list.*duplicate prestate.*no retry or deletion.*fresh exact authority/i);
  assert.match(containment.rollback_branches.drifted_or_duplicate,
    /Preserve every affected definition.*mode disabled.*Cron containment unproven/i);
  assert.equal(containment.conditional_delete.authorized_by_this_contract, false);
  assert.equal(containment.conditional_delete.tool, submitter.write_connector.delete_tool);
  assert.deepEqual(containment.conditional_delete.arguments_template, {
    headers: create.headers,
    path_variables: {
      id: 'TBD_PRIVATE_ANALYTICS_CRON_ID', projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID',
    },
  });
  assert.match(containment.conditional_delete.destructive_effect,
    /Permanently deletes.*execution history.*cannot be undone/i);
  assert.match(containment.conditional_delete.prerequisites.join(' '),
    /fresh live packet.*exact packet-created Cron ID.*complete execution inventory.*terminal drain/i);
  assert.match(containment.conditional_delete.success_readback.join(' '),
    /all-execution-type.*exact Cron ID and name.*get-by-ID.*not-found/i);
  assert.equal(containment.conditional_delete.success_readback_contracts.inventory.tool,
    submitter.audit_connector.inventory_tool);
  assert.deepEqual(containment.conditional_delete.success_readback_contracts
    .inventory.arguments_template, submitter.inventory_readback.arguments_template);
  assert.equal(containment.conditional_delete.success_readback_contracts.resource.tool,
    submitter.audit_connector.resource_tool);
  assert.deepEqual(containment.conditional_delete.success_readback_contracts
    .resource.arguments_template, submitter.provider_readback.arguments_template);
  assert.match(containment.conditional_delete.success_readback_contracts
    .inventory.required_result, /neither the exact Cron ID nor RevenueAnalytics1m/i);
  assert.match(containment.conditional_delete.success_readback_contracts
    .resource.required_result, /not-found.*exact Cron ID/i);
  assert.match(containment.conditional_delete.ambiguous_outcome,
    /Never retry deletion.*both independent readbacks.*fresh authority/i);
  assert.equal(containment.deletion_authorized_by_this_contract, false);

  const canary = submitter.disabled_canary;
  assert.equal(canary.live_action_authorized_by_this_contract, false);
  assert.equal(canary.required_mode, 'disabled');
  assert.equal(canary.required_cron_status, false);
  assert.equal(canary.submission_tool, submitter.write_connector.submit_tool);
  assert.deepEqual(canary.submission_arguments_template, {
    headers: {
      'Catalyst-org': 'TBD_PRIVATE_CATALYST_ORG_ID', Environment: 'Development',
    },
    path_variables: {
      id: 'TBD_PRIVATE_ANALYTICS_CRON_ID', projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID',
    },
    body: create.body.job_meta,
  });
  const terminal = canary.terminal_job_readback;
  assert.deepEqual(terminal.arguments_template, {
    headers: {
      'Catalyst-org': 'TBD_PRIVATE_CATALYST_ORG_ID', Environment: 'Development',
    },
    path_variables: {
      id: 'TBD_PRIVATE_ANALYTICS_JOB_ID', projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID',
    },
  });
  assert.equal(terminal.shape_status,
    'fresh_audit_job_meta_details_shape_and_execution_correlation_required');
  assert.deepEqual(terminal.documented_raw_paths, {
    job_id: 'data.job_id', job_status: 'data.job_status',
    job_metadata_root: 'data.job_meta_details',
    job_name: 'data.job_meta_details.job_name',
    job_pool_id: 'data.job_meta_details.jobpool_id',
    job_pool_name: 'data.job_meta_details.jobpool_details.name',
    params: 'data.job_meta_details.params',
    source_type: 'data.job_meta_details.source_type',
    source_cron_id: 'data.job_meta_details.source_details.id',
    source_cron_name: 'data.job_meta_details.source_details.source_name',
    source_cron_execution_type:
      'data.job_meta_details.source_details.details.cron_execution_type',
    target_id: 'data.job_meta_details.target_details.id',
    target_name: 'data.job_meta_details.target_details.target_name',
    target_type: 'data.job_meta_details.target_type',
    number_of_retries: 'data.job_meta_details.job_config.number_of_retries',
  });
  assert.equal(terminal.documented_terminal_success_value, 'SUCCESS');
  assert.deepEqual(terminal.expected_normalized_job_projection_template, {
    job_id: 'TBD_PRIVATE_ANALYTICS_JOB_ID',
    job_status: 'SUCCESS',
    job_name: 'RevenueAnalyticsSync',
    job_pool_id: 'TBD_PRIVATE_ANALYTICS_JOB_POOL_ID',
    job_pool_name: contract.job_pool.name,
    params: {},
    source_type: 'Cron',
    source_cron_id: 'TBD_PRIVATE_ANALYTICS_CRON_ID',
    source_cron_name: 'RevenueAnalytics1m',
    source_cron_execution_type: 'pre-defined',
    target_id: 'TBD_PRIVATE_ANALYTICS_FUNCTION_ID',
    target_name: contract.function.target_name,
    target_type: contract.job_pool.type,
    number_of_retries: 0,
  });
  assert.equal(terminal.metadata_path_map,
    'documented_raw_paths_require_fresh_shape_proof_and_exact_normalized_comparison');
  assert.equal(terminal.submission_identity_binding.manual_submit_response_job_id_path,
    'data.job_id');
  assert.match(terminal.submission_identity_binding.required_equalities.join(' '),
    /manual-submit response data\.job_id.*get-by-ID request path ID.*response data\.job_id.*source_type.*source_details\.id.*RevenueAnalytics1m.*different ID.*not canary evidence/i);
  assert.match(terminal.missing_or_ambiguous_metadata_action,
    /mode and Cron disabled.*stop without claiming canary acceptance/i);
  assert.equal(terminal.terminal_success_required, true);
  assert.deepEqual(canary.execution_correlation, {
    documented_job_response_execution_id_path: null,
    status: 'blocked_until_a_lossless_job_to_execution_id_binding_is_proven',
    required_for_canary_acceptance: true,
    time_window_or_unscoped_log_fallback_allowed: false,
  });
  assert.deepEqual(canary.execution_scoped_log_readback.arguments_template, {
    headers: {
      'Catalyst-org': 'TBD_PRIVATE_CATALYST_ORG_ID', Environment: 'Development',
    },
    path_variables: { projectId: 'TBD_PRIVATE_CATALYST_PROJECT_ID' },
    query_params: {
      execution_id: 'TBD_PRIVATE_ANALYTICS_EXECUTION_ID',
      resource_list: 'TBD_PRIVATE_ANALYTICS_FUNCTION_ID',
      logType: 'application', level: 'INFO', search: 'analytics_sync_disabled',
      timezone: 'UTC',
    },
  });
  assert.equal(canary.execution_scoped_log_readback.required_exact_event,
    'analytics_sync_disabled');
  assert.equal(canary.no_io_conclusion.classification,
    'inference_only_not_provider_io_telemetry');
  assert.equal(canary.no_io_conclusion.provider_io_absence_directly_observed, false);
  assert.match(canary.no_io_conclusion.basis.join(' '),
    /deployed-archive pullback parity.*reviewed disabled code path/i);
  assert.equal(submitter.activation.mode_before_cron_status, true);
  assert.equal(submitter.activation.separate_development_approval_required, true);
  assert.match(submitter.activation.rules.join(' '),
    /mode and Cron disabled.*terminal Job readback.*execution-ID-scoped log readback.*Set.*mode before enabling the Cron/i);
  assert.deepEqual(contract.runtime_modes.production, ['disabled', 'readiness']);
  assert.equal(contract.production_authorized, false);
  assert.equal(contract.production_dark_contract.sdk_initialization, false);
  assert.equal(contract.production_dark_contract.datastore_reads, 0);
  assert.equal(contract.production_dark_contract.datastore_writes, 0);
  assert.equal(contract.production_dark_contract.analytics_reads, 0);
  assert.equal(contract.production_dark_contract.analytics_writes, 0);
  assert.equal(contract.production_dark_contract.result, 'DarkNoOp');
  assert.equal(contract.production_dark_contract.tables_required, false);
  assert.equal(contract.production_dark_contract.connections_required, false);
  assert.deepEqual(contract.provider_contract.connection_references, {
    read: 'ANALYTICS_READ_CONNECTION_LINK_NAME',
    write: 'ANALYTICS_WRITE_CONNECTION_LINK_NAME',
    must_be_distinct: true,
  });
  assert.match(contract.provider_contract.pre_write_target_check,
    /Immediately before every import POST.*read-only Connection.*view ID.*table name.*workspace ID.*organization ID.*do not cache.*write authorization/);
  assert.deepEqual(contract.provider_contract.matching_columns,
    ['RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT']);
  assert.deepEqual(contract.provider_contract.outbox_version_fence.identity_columns, [
    'RECORD_TYPE', 'ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'RECORD_KEY',
    'SOURCE_MODIFIED_AT',
  ]);
  assert.equal(contract.provider_contract.outbox_version_fence.column, 'OUTBOX_KEY');
  assert.equal(contract.provider_contract.outbox_version_fence.payload_binding_column,
    'PAYLOAD_HASH');
  assert.equal(contract.provider_contract.outbox_version_fence.timestamp_normalization,
    'new Date(value).toISOString()');
  assert.equal(contract.provider_contract.outbox_version_fence.provider_unique_constraint_required,
    true);
  assert.equal(contract.compatibility.legacy_rows_automatically_claimed, false);
  assert.equal(contract.compatibility.additive_columns_physical_mandatory, false);
  assert.equal(contract.compatibility.v2_outbox_state_column, 'SYNC_STATUS');
  assert.equal(contract.compatibility.documented_v1_outbox_state_column, 'Status');
  assert.deepEqual(contract.compatibility.nullable_unique_semantics, {
    packet_a_proved: true,
    proved_behavior: 'nullable unique columns admit multiple null rows while rejecting duplicate nonnull values',
    fresh_pre_activation_readback_required: true,
  });
  assert.equal(contract.observed_development_inventory_2026_08_24.AnalyticsSyncOutbox, 307);
});

test('additive v2 schemas preserve live rows and include fencing, retry, readback, and checkpoints', () => {
  const schema = json(path.join('config', 'datastore-schema.json'));
  assert.equal(schema.schema_version, 2);
  assert.equal(schema.migration_policy.observed_counts.AnalyticsSyncOutbox, 307);
  assert.match(schema.migration_policy.strategy, /never rebuild, truncate, rename, or delete/);
  assert.deepEqual(schema.tables.map((table) => table.api_name),
    ['AnalyticsSyncCheckpoints', 'AnalyticsSyncOutbox']);
  for (const table of schema.tables) {
    assert.deepEqual(table.required_unique_columns, table.api_name === 'AnalyticsSyncOutbox'
      ? ['OUTBOX_KEY'] : ['CHECKPOINT_KEY']);
    assert.equal(table.columns.every((column) => column.mandatory === false), true,
      `${table.api_name} additive columns must be physically nullable`);
    for (const uniqueName of table.required_unique_columns) {
      const column = table.columns.find(({ api_name: name }) => name === uniqueName);
      assert.equal(column.unique, true, uniqueName);
      assert.equal(column.required_for_v2_rows, true, uniqueName);
    }
    assert.ok(table.columns.some((column) => column.api_name === 'ROW_SCHEMA_VERSION'
      && column.required_for_v2_rows === true));
  }
  const requiredByTable = {
    AnalyticsSyncCheckpoints: [
      'CHECKPOINT_KEY', 'ROW_SCHEMA_VERSION', 'RECORD_TYPE', 'TARGET_TABLE_ALIAS',
      'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT', 'LAST_SOURCE_MODIFIED_AT',
      'LAST_RECORD_KEY', 'PROVIDER_WATERMARK', 'LAST_PROVIDER_JOB_ID',
      'LAST_ACCEPTED_ROW_COUNT', 'LAST_REJECTED_ROW_COUNT', 'STATUS', 'STALE_AFTER_AT',
      'VERSION', 'LAST_SYNC_AT', 'LAST_RECONCILED_AT', 'CREATED_AT', 'UPDATED_AT',
      'SOURCE_REVISION', 'METRIC_VERSION',
    ],
    AnalyticsSyncOutbox: [
      'OUTBOX_KEY', 'ROW_SCHEMA_VERSION', 'RECORD_TYPE',
      'RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
      'ENGAGEMENT_TYPE', 'ENVIRONMENT', 'PAYLOAD_JSON', 'PAYLOAD_HASH', 'METRIC_VERSION',
      'SOURCE_MODIFIED_AT', 'SOURCE_DATE_UTC', 'SYNC_STATUS', 'ATTEMPT_COUNT',
      'CLAIM_COUNT', 'POLL_COUNT', 'NEXT_ATTEMPT_AT', 'FENCE_VERSION', 'CREATED_AT',
      'UPDATED_AT', 'SOURCE_REVISION',
    ],
  };
  for (const table of schema.tables) {
    const required = table.columns.filter((column) => column.required_for_v2_rows === true)
      .map((column) => column.api_name);
    assert.deepEqual(required, requiredByTable[table.api_name]);
    const reserved = new Set(
      schema.migration_policy.documented_v1_casefold_reserved_columns[table.api_name]
        .map((name) => name.toLowerCase()),
    );
    assert.equal(table.columns.every((column) =>
      !reserved.has(column.api_name.toLowerCase())), true,
    `${table.api_name} v2 columns must not collide with documented v1 columns`);
  }
  const outbox = schema.tables.find((table) => table.api_name === 'AnalyticsSyncOutbox');
  const names = new Set(outbox.columns.map((column) => column.api_name));
  for (const required of [
    'OUTBOX_KEY', 'PAYLOAD_HASH', 'SYNC_STATUS', 'BATCH_KEY', 'ATTEMPT_COUNT',
    'CLAIM_COUNT', 'POLL_COUNT',
    'LEASE_TOKEN', 'FENCE_VERSION', 'PROVIDER_JOB_ID', 'READBACK_JOB_ID',
    'READBACK_ROW_COUNT', 'READBACK_WATERMARK',
  ]) assert.equal(names.has(required), true, required);
  const outboxKey = outbox.columns.find((column) => column.api_name === 'OUTBOX_KEY');
  assert.equal(outboxKey.unique, true);
  assert.equal(outboxKey.required_for_v2_rows, true);
  assert.match(outboxKey.purpose, /provider identity.*source-watermark fence/i);
  assert.equal(names.has('STATUS'), false);
  const checkpoint = schema.tables.find((table) =>
    table.api_name === 'AnalyticsSyncCheckpoints');
  assert.equal(checkpoint.columns.some((column) => column.api_name === 'STATUS'), true);
  assert.match(schema.provisioning_gates.join(' '),
    /nullable-unique behavior with multiple null rows.*did not prove the full 71-column outbox application schema/i);
  assert.equal(names.has('SOURCE_DATE_UTC'), true);
  assert.deepEqual(schema.data_policy.app_user_permissions, []);
  assert.equal(schema.data_policy.raw_transcripts, false);
});

test('active Analytics package has no retired physical fence column or key-inequality loophole', () => {
  const retiredColumn = ['PROVIDER', 'VERSION', 'KEY'].join('_');
  const activeFiles = [
    path.join('config', 'analytics-sync.json'),
    path.join('config', 'datastore-schema.json'),
    'README.md',
    'RUNBOOK.md',
    path.join('functions', 'analytics_sync', 'lib', 'facts.js'),
    path.join('functions', 'analytics_sync', 'lib', 'catalyst-store.js'),
    path.join('functions', 'analytics_sync', 'lib', 'service.js'),
  ];
  for (const relativePath of activeFiles) {
    const contents = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.equal(contents.includes(retiredColumn), false, relativePath);
  }
  const store = fs.readFileSync(path.join(functionRoot, 'lib', 'catalyst-store.js'), 'utf8');
  assert.doesNotMatch(store, /OUTBOX_KEY\s*!=/);
});

test('variable registry and example contain names/placeholders only and no known private project ID', () => {
  const registry = json(path.join('config', 'variables.json'));
  const names = new Set(registry.variables.map((variable) => variable.name));
  assert.deepEqual(
    registry.variables.filter(({ name }) => name.endsWith('_CONNECTION_LINK_NAME'))
      .map(({ name }) => name),
    ['ANALYTICS_READ_CONNECTION_LINK_NAME', 'ANALYTICS_WRITE_CONNECTION_LINK_NAME'],
  );
  for (const required of [
    'ANALYTICS_SYNC_MODE', 'EXPECTED_CATALYST_PROJECT_ID', 'ANALYTICS_JOB_POOL_ID',
    'ANALYTICS_CHECKPOINT_TABLE', 'ANALYTICS_OUTBOX_TABLE',
    'ANALYTICS_READ_CONNECTION_LINK_NAME', 'ANALYTICS_WRITE_CONNECTION_LINK_NAME',
    'ANALYTICS_TARGETS_JSON', 'ANALYTICS_MIGRATION_EVIDENCE_DIGEST',
  ]) assert.equal(names.has(required), true, required);
  const deploymentEnvironment = registry.variables.find((variable) =>
    variable.name === 'DEPLOYMENT_ENVIRONMENT');
  assert.deepEqual(deploymentEnvironment.allowed, ['development', 'production']);
  const example = fs.readFileSync(path.join(functionRoot, '.env.example'), 'utf8');
  assert.doesNotMatch(example, /\b\d{15,30}\b/);
  assert.doesNotMatch(example, /Zoho-oauthtoken|refresh_token|client_secret/i);
  assert.match(example, /TBD_PRIVATE_CATALYST_PROJECT_ID/);
});

test('README and runbook link the central standards and block a thinner live replacement', () => {
  const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
  const runbook = fs.readFileSync(path.join(projectRoot, 'RUNBOOK.md'), 'utf8');
  const parity = json(path.join('config', 'live-source-parity.json'));
  const schema = json(path.join('config', 'datastore-schema.json'));
  assert.match(readme, /Retell\/Catalyst\/CRM\/Analytics reporting runbook/);
  assert.match(readme, /Zoho Analytics standard/);
  assert.match(readme, /npm run artifact:verify/);
  assert.match(readme, /APPROVED_SOURCE_REVISION/);
  assert.match(runbook, /thinner candidate is not an acceptable replacement/);
  assert.match(readme, /RevenueAnalytics1m.*not deployed or active/);
  assert.match(readme,
    /71 total outbox columns.*did \*\*not\*\* prove the full outbox application schema/i);
  assert.match(readme,
    /no documented execution ID.*canary remains blocked.*terminal `SUCCESS`.*inference/i);
  assert.match(readme,
    /status mutation has a separate stop gate.*full Cron body.*canonical-absent.*unknown key.*not execution-ready.*forbidden for drifted or duplicate/i);
  assert.match(readme,
    /manual-submit `data\.job_id`.*get-by-ID request and response.*exact source Cron ID.*pool, target, parameters.*insufficient/i);
  assert.match(readme,
    /destroys the Cron and its execution history permanently.*never retried.*inventory absence.*get-by-ID not-found/i);
  assert.match(runbook, /RevenueAnalytics1m.*cron_status=false/);
  assert.match(runbook,
    /empty list is never absence.*same-name collisions across execution types.*pre-defined-only inventory/i);
  assert.match(runbook,
    /Cron create\/resource `data\.id`.*are not execution IDs.*complete execution inventory/i);
  assert.match(runbook, /Absent:.*Exact:.*Drifted:.*Duplicate:/s);
  assert.match(runbook,
    /mode-first containment.*disabled-Cron readback only when.*drain of only proven Job IDs/i);
  assert.match(runbook,
    /advertises a complete Cron body.*safe status-only shape is unavailable.*stop/i);
  assert.match(runbook,
    /not execution-ready.*every advertised schedule.*unknown fields.*fail closed/i);
  assert.match(runbook,
    /permanently destroys.*execution history.*ambiguous delete is never retried.*both readbacks/i);
  assert.match(runbook, /npm run artifact:verify/);
  assert.match(runbook, /APPROVED_SOURCE_REVISION/);
  assert.equal(parity.deployment_replacement_authorized, false);
  const parityResolution = parity.superseding_packet_a_resolution_2026_08_26;
  const evidencePath = path.resolve(projectRoot, 'config', parityResolution.evidence);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const prestate = evidence.verified_prestate;
  assert.equal(parityResolution.analytics_outbox_total_columns,
    prestate.analytics_outbox_total_columns);
  assert.equal(parityResolution.analytics_outbox_full_application_schema_readback_exact,
    false);
  assert.equal(Object.hasOwn(prestate,
    'analytics_outbox_required_application_columns_exact'), false);
  assert.deepEqual(parityResolution.analytics_outbox_outbox_key_contract,
    prestate.analytics_outbox_outbox_key_contract);
  assert.equal(parityResolution.analytics_checkpoints_required_application_columns_exact,
    prestate.analytics_checkpoints_required_application_columns_exact);
  assert.equal(parityResolution.outbox_key_nullable_unique_contract_readback_exact, true);
  assert.equal(
    evidence.disposable_nonempty_table_capability_proof.nullable_unique_column_created_and_read_back,
    true,
  );
  assert.equal(
    evidence.disposable_nonempty_table_capability_proof.multiple_preexisting_nulls_preserved,
    true,
  );
  assert.equal(evidence.provider_concurrency_proof.provider_unique_constraint_is_atomic_boundary,
    true);
  assert.equal(parityResolution.fresh_pre_activation_schema_readback_still_required, true);
  assert.equal(parityResolution.live_binding_fixture_parity_and_reconciliation_proven, false);
  const schemaResolution = schema.migration_policy.superseding_schema_resolution_2026_08_26;
  assert.equal(path.resolve(projectRoot, 'config', schemaResolution.evidence), evidencePath);
  assert.equal(schemaResolution.analytics_outbox_total_columns,
    prestate.analytics_outbox_total_columns);
  assert.equal(schemaResolution.analytics_outbox_full_application_schema_readback_exact, false);
  assert.deepEqual(schemaResolution.analytics_outbox_outbox_key_contract,
    prestate.analytics_outbox_outbox_key_contract);
  assert.equal(schemaResolution.analytics_checkpoints_required_application_columns_exact,
    prestate.analytics_checkpoints_required_application_columns_exact);
  assert.equal(schemaResolution.outbox_key_nullable_unique_contract_readback_exact, true);
  assert.equal(schemaResolution.legacy_rows_rewritten, false);
  assert.equal(schemaResolution.fresh_pre_activation_schema_and_lineage_readback_required, true);
  assert.equal(fs.existsSync(path.resolve(projectRoot, 'config', schemaResolution.evidence)), true);
  assert.ok(parity.live_modules.some((module) => module.name === 'daily-rollup.js'
    && module.repository_candidate.includes('functions/analytics_sync/lib/daily-rollup.js')
    && module.parity.includes('persistence-and-private-live-fixture-parity-blocked')));
  assert.ok(parity.live_modules.every((module) => module.candidate_owner
    && Array.isArray(module.candidate_tests) && module.candidate_tests.length >= 1));
  assert.equal(fs.existsSync(path.resolve(projectRoot,
    '../../../docs/runbooks/retell-catalyst-analytics-reporting.md')), true);
  assert.equal(fs.existsSync(path.resolve(projectRoot,
    '../../../docs/zoho/standards/analytics.md')), true);
});
