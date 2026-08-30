'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONTRACT_PATH = path.resolve(__dirname, '../config/analytics-model-contract.json');
const DASHBOARD_CONTRACT_PATH = path.resolve(__dirname, '../config/dashboard-contract.json');
// The connected createTable tool accepts only these two column properties. The
// richer MANDATORY/PII rules remain source-side contract assertions and must not
// be misrepresented as provider metadata by emitting unsupported fields.
const API_COLUMN_KEYS = Object.freeze(['COLUMNNAME', 'DATATYPE']);

function readContract(contractPath = CONTRACT_PATH) {
  return JSON.parse(fs.readFileSync(contractPath, 'utf8'));
}

function readDashboardContract(contractPath = DASHBOARD_CONTRACT_PATH) {
  return JSON.parse(fs.readFileSync(contractPath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function officialColumn(column) {
  return Object.fromEntries(API_COLUMN_KEYS.map((key) => [key, column[key]]));
}

function tablePayloads(contract) {
  const recordTypes = Object.keys(contract.target_tables || {});
  assert(recordTypes.length === 5, 'Analytics model must define exactly five target tables.');
  return Object.fromEntries(recordTypes.map((recordType) => {
    const target = contract.target_tables[recordType];
    const specific = contract.record_type_columns?.[recordType];
    assert(Array.isArray(contract.common_columns) && Array.isArray(specific),
      `Analytics columns are incomplete for ${recordType}.`);
    const columns = [...contract.common_columns, ...specific].map(officialColumn);
    assert(new Set(columns.map(({ COLUMNNAME }) => COLUMNNAME)).size === columns.length,
      `Analytics columns are duplicated for ${recordType}.`);
    return [recordType, {
      tableDesign: {
        TABLENAME: target.physical_table_name,
        TABLEDESCRIPTION: target.description,
        COLUMNS: columns,
      },
    }];
  }));
}

function withTableName(baseTableName, value) {
  return { tableName: baseTableName, ...value };
}

function reportPayloads(contract) {
  const reports = contract.reports || {};
  const titles = new Set();
  return Object.fromEntries(Object.entries(reports).map(([key, report]) => {
    const config = report.create_config;
    const profile = contract.report_filter_profiles?.[report.filter_profile];
    assert(config && profile, `Analytics report ${key} has an incomplete create contract.`);
    assert(!titles.has(config.title), `Analytics report title is duplicated: ${config.title}.`);
    titles.add(config.title);
    const payload = {
      baseTableName: config.baseTableName,
      title: config.title,
      description: `${report.widget_title}. ${report.null_behavior}`,
      reportType: config.reportType,
      ...(config.chartType ? { chartType: config.chartType } : {}),
      axisColumns: config.axisColumns,
      filters: [...profile.filters, ...(config.extra_filters || [])]
        .map((filter) => withTableName(config.baseTableName, filter)),
      userFilters: [...profile.userFilters, ...(config.extra_user_filters || [])]
        .map((filter) => withTableName(config.baseTableName, filter)),
    };
    return [key, payload];
  }));
}

function replaceBindingKey(template, placeholder, key) {
  assert(typeof template === 'string' && template.includes(placeholder),
    `Analytics private binding template is missing ${placeholder}.`);
  return template.replace(placeholder, key);
}

function folderAssetDefinitions(contract, dashboardContract) {
  const dashboards = Object.fromEntries((dashboardContract.dashboards || []).map((dashboard) => {
    assert(typeof dashboard.key === 'string' && dashboard.key.length > 0,
      'Every Analytics dashboard requires a stable public key.');
    return [dashboard.key, {
      viewName: dashboard.title,
      privateViewIdBinding: replaceBindingKey(
        contract.private_id_bindings?.dashboards,
        '<dashboard_key>',
        dashboard.key,
      ),
    }];
  }));
  assert(Object.keys(dashboards).length === (dashboardContract.dashboards || []).length,
    'Analytics dashboard keys must be unique.');

  return {
    table: Object.fromEntries(Object.entries(contract.target_tables || {}).map(([key, value]) =>
      [key, {
        viewName: value.physical_table_name,
        privateViewIdBinding: value.private_view_id_binding,
      }],
    )),
    query_view: Object.fromEntries(Object.entries(contract.derived_query_views || {})
      .map(([key, value]) => [key, {
        viewName: value.physical_view_name,
        privateViewIdBinding: value.private_view_id_binding,
      }])),
    report: Object.fromEntries(Object.entries(contract.reports || {}).map(([key, value]) =>
      [key, {
        viewName: value.create_config?.title,
        privateViewIdBinding: value.private_view_id_binding,
      }],
    )),
    dashboard: dashboards,
  };
}

function folderContract(contract, dashboardContract) {
  const definition = contract.folder_contract;
  const folders = definition?.folders || {};
  assert(definition?.api_operations?.create === 'createFolder'
    && definition?.api_operations?.place_assets === 'moveViewsToFolder',
  'Analytics folder operations are incomplete.');
  assert(definition.create_only_if_absent === true
    && definition.root_level_only === true
    && definition.make_default_folder === false,
  'Analytics folder containment rules are incomplete.');
  assert(Object.keys(folders).length === 3,
    'Analytics model must define exactly three canonical folders.');

  const definitions = folderAssetDefinitions(contract, dashboardContract);
  const expectedReferences = Object.entries(definitions).flatMap(([assetKind, values]) =>
    Object.keys(values).map((assetKey) => `${assetKind}:${assetKey}`));
  const observedReferences = [];
  const folderNames = new Set();
  const folderPayloads = {};
  const folderPlacements = {};

  for (const [folderKey, folder] of Object.entries(folders)) {
    assert(typeof folder.folder_name === 'string' && folder.folder_name.length > 0,
      `Analytics folder ${folderKey} has no exact name.`);
    assert(!folderNames.has(folder.folder_name),
      `Analytics folder name is duplicated: ${folder.folder_name}.`);
    folderNames.add(folder.folder_name);
    assert(typeof folder.description === 'string' && folder.description.length > 0,
      `Analytics folder ${folderKey} has no description.`);
    assert(folder.parent_folder_key === null,
      `Analytics folder ${folderKey} must remain root-level.`);
    assert(Array.isArray(folder.asset_references) && folder.asset_references.length > 0,
      `Analytics folder ${folderKey} has no asset references.`);

    folderPayloads[folderKey] = {
      folderName: folder.folder_name,
      folderDesc: folder.description,
      makeDefaultFolder: false,
    };
    folderPlacements[folderKey] = {
      privateFolderIdBinding: replaceBindingKey(
        definition.private_folder_id_binding,
        '<folder_key>',
        folderKey,
      ),
      viewReferences: folder.asset_references.map(({ asset_kind: assetKind,
        asset_key: assetKey }) => {
        const asset = definitions[assetKind]?.[assetKey];
        assert(asset, `Analytics folder ${folderKey} references unknown ${assetKind}:${assetKey}.`);
        assert(typeof asset.viewName === 'string' && asset.viewName.length > 0
          && typeof asset.privateViewIdBinding === 'string'
          && asset.privateViewIdBinding.length > 0,
        `Analytics folder ${folderKey} has an incomplete binding for ${assetKind}:${assetKey}.`);
        observedReferences.push(`${assetKind}:${assetKey}`);
        return {
          assetKind,
          assetKey,
          viewName: asset.viewName,
          privateViewIdBinding: asset.privateViewIdBinding,
        };
      }),
    };
  }

  assert(new Set(observedReferences).size === observedReferences.length,
    'Analytics canonical folder placement contains a duplicate asset reference.');
  assert(observedReferences.length === expectedReferences.length
    && expectedReferences.every((reference) => observedReferences.includes(reference)),
  'Analytics canonical folder placement must assign every table, query view, report, and dashboard exactly once.');

  return { folderPayloads, folderPlacements };
}

function preRenderGate(contract) {
  const gate = contract.pre_render_gate;
  const recordTypes = Object.keys(contract.target_tables || {});
  assert(gate && gate.mode === 'fail_closed'
    && gate.evidence_schema_version === 1
    && gate.ready_verdict === 'ready'
    && gate.blocked_verdict === 'blocked',
  'Analytics pre-render gate is incomplete.');
  assert(Array.isArray(gate.required_record_types)
    && gate.required_record_types.join(',') === recordTypes.join(','),
  'Analytics pre-render gate record types do not match the target model.');
  assert(gate.timestamp_boundary.includes('No timestamp'),
    'Analytics pre-render gate must prohibit timestamp-only health.');
  return gate;
}

function renderContract(contract = readContract(), dashboardContract = readDashboardContract()) {
  assert(contract.schema_version === 1 && contract.production_authorized === false,
    'Analytics model contract version or Production boundary is invalid.');
  const folders = folderContract(contract, dashboardContract);
  return Object.freeze({
    schema_version: contract.schema_version,
    production_authorized: false,
    private_id_bindings: contract.private_id_bindings,
    pre_render_gate: preRenderGate(contract),
    folder_payloads: folders.folderPayloads,
    folder_placements: folders.folderPlacements,
    table_payloads: tablePayloads(contract),
    query_view_payloads: Object.fromEntries(Object.entries(contract.derived_query_views || {})
      .map(([key, view]) => [key, {
        queryTableName: view.physical_view_name,
        sqlQuery: view.sql,
      }])),
    report_payloads: reportPayloads(contract),
  });
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(renderContract(), null, 2)}\n`);
}

module.exports = {
  folderContract,
  preRenderGate,
  readContract,
  readDashboardContract,
  renderContract,
  reportPayloads,
  tablePayloads,
};
