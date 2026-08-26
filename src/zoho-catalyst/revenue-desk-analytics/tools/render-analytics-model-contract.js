'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONTRACT_PATH = path.resolve(__dirname, '../config/analytics-model-contract.json');
// The connected createTable tool accepts only these two column properties. The
// richer MANDATORY/PII rules remain source-side contract assertions and must not
// be misrepresented as provider metadata by emitting unsupported fields.
const API_COLUMN_KEYS = Object.freeze(['COLUMNNAME', 'DATATYPE']);

function readContract(contractPath = CONTRACT_PATH) {
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

function renderContract(contract = readContract()) {
  assert(contract.schema_version === 1 && contract.production_authorized === false,
    'Analytics model contract version or Production boundary is invalid.');
  return Object.freeze({
    schema_version: contract.schema_version,
    production_authorized: false,
    private_id_bindings: contract.private_id_bindings,
    pre_render_gate: preRenderGate(contract),
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

module.exports = { preRenderGate, readContract, renderContract, reportPayloads, tablePayloads };
