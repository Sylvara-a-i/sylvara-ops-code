'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const modelPath = path.resolve(__dirname, '../../../config/analytics-model-contract.json');
const dashboardPath = path.resolve(__dirname, '../../../config/dashboard-contract.json');
const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const dashboard = JSON.parse(fs.readFileSync(dashboardPath, 'utf8'));
const { renderContract } = require(path.resolve(
  __dirname, '../../../tools/render-analytics-model-contract.js',
));
const { TARGET_TABLE_NAMES } = require('../lib/config');

const COMMON = [
  'SCHEMA_VERSION', 'METRIC_VERSION', 'RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY',
  'CONFIGURATION_VERSION', 'ENGAGEMENT_TYPE', 'ENVIRONMENT', 'SOURCE_MODIFIED_AT',
  'SOURCE_REVISION', 'PAYLOAD_HASH',
];
const SPECIFIC = {
  deployment: [
    'CAPABILITY_PROFILE', 'PLAN_TIER', 'DEPLOYMENT_STATUS', 'GO_LIVE_APPROVAL_STATUS',
    'LIMIT_POLICY', 'BILLING_MODE', 'COVERAGE_MODE', 'HANDLED_COUNT', 'CALL_LIMIT',
    'ACTUAL_START_AT', 'EXPIRES_AT', 'STOPPED_AT', 'STOP_REASON',
  ],
  call: [
    'CALL_KEY', 'STARTED_AT', 'ENDED_AT', 'DURATION_SECONDS', 'CALL_STATUS', 'OUTCOME',
    'URGENCY_CLASS', 'COVERAGE_MODE', 'HANDLED_RECORDED', 'BOOKABLE_OPPORTUNITY',
    'OFFICE_FOLLOW_UP_REQUIRED', 'WORKFLOW_FAILURE_CODE', 'NOTIFICATION_STATE',
    'VALUE_EVIDENCE_CLASS', 'VALUE_MINOR_UNITS', 'VALUE_CURRENCY',
  ],
  daily_metric: [
    'REPORTING_DATE_UTC', 'TOTAL_CALLS_HANDLED', 'QUALIFIED_OPPORTUNITIES',
    'URGENT_REQUESTS', 'EXISTING_CUSTOMER_CALLS', 'WRONG_FIT_CALLS', 'SPAM_CALLS',
    'UNRESOLVED_CALLS', 'BOOKABLE_OPPORTUNITIES', 'OFFICE_FOLLOW_UP_CALLS',
  ],
  final_test_result: [
    'TEST_STARTED_AT', 'TEST_ENDED_AT', 'TEST_END_REASON', 'CALLS_CAPTURED', 'CALL_LIMIT',
    'QUALIFIED_OPPORTUNITIES', 'URGENT_REQUESTS', 'EXISTING_CUSTOMER_CALLS',
    'WRONG_FIT_CALLS', 'BOOKABLE_OPPORTUNITIES', 'OFFICE_FOLLOW_UP_CALLS',
    'DURATION_EVIDENCE_COMPLETE', 'ANALYSIS_EVIDENCE_COMPLETE',
  ],
  conversion_status: [
    'CRM_CONVERSION_STATUS', 'BILLING_CONVERSION_STATUS', 'RESULTS_REVIEW_STATUS',
    'PAID_ACCEPTANCE_STATUS', 'TARGET_ENGAGEMENT_TYPE',
  ],
};

test('renders five exact public-safe create-table payloads with complete fact schemas', () => {
  const rendered = renderContract(model);
  const expectedTableNames = {
    deployment: 'RevenueDeskAnalyticsDeploymentFacts',
    call: 'RevenueDeskAnalyticsCallFacts',
    daily_metric: 'RevenueDeskAnalyticsDailyMetricFacts',
    final_test_result: 'RevenueDeskAnalyticsFinalTestResultFacts',
    conversion_status: 'RevenueDeskAnalyticsConversionStatusFacts',
  };
  assert.deepEqual(Object.fromEntries(Object.entries(model.target_tables)
    .map(([key, value]) => [key, value.physical_table_name])), expectedTableNames);
  assert.deepEqual(TARGET_TABLE_NAMES, expectedTableNames);
  assert.deepEqual(Object.keys(rendered.table_payloads), Object.keys(SPECIFIC));
  for (const [recordType, payload] of Object.entries(rendered.table_payloads)) {
    const columns = payload.tableDesign.COLUMNS;
    const contractColumns = [
      ...model.common_columns,
      ...model.record_type_columns[recordType],
    ];
    assert.deepEqual(columns.map(({ COLUMNNAME }) => COLUMNNAME),
      [...COMMON, ...SPECIFIC[recordType]]);
    assert.equal(columns.every((column) =>
      Object.keys(column).sort().join(',') === 'COLUMNNAME,DATATYPE'), true);
    assert.equal(columns.every(({ DATATYPE }) =>
      model.create_table_contract.allowed_data_types.includes(DATATYPE)), true);
    assert.equal(contractColumns.every(({ PII }) => PII === false), true);
    assert.deepEqual(model.create_table_contract.connector_column_keys,
      ['COLUMNNAME', 'DATATYPE']);
    assert.deepEqual(model.create_table_contract.repository_constraint_keys,
      ['MANDATORY', 'PII']);
    assert.equal(payload.tableDesign.TABLENAME,
      model.target_tables[recordType].physical_table_name);
    assert.equal(model.target_tables[recordType].private_view_id_binding,
      `ANALYTICS_TARGETS_JSON.${recordType}.view_id`);
  }
  const nullable = Object.fromEntries(Object.entries(SPECIFIC).map(([recordType]) => [recordType,
    [...model.common_columns, ...model.record_type_columns[recordType]]
      .filter(({ MANDATORY }) => !MANDATORY).map(({ COLUMNNAME }) => COLUMNNAME),
  ]));
  assert.deepEqual(nullable, {
    deployment: ['COVERAGE_MODE', 'STOPPED_AT', 'STOP_REASON'],
    call: [
      'ENDED_AT', 'DURATION_SECONDS', 'URGENCY_CLASS', 'COVERAGE_MODE',
      'BOOKABLE_OPPORTUNITY', 'OFFICE_FOLLOW_UP_REQUIRED', 'WORKFLOW_FAILURE_CODE',
      'NOTIFICATION_STATE', 'VALUE_EVIDENCE_CLASS', 'VALUE_MINOR_UNITS', 'VALUE_CURRENCY',
    ],
    daily_metric: ['BOOKABLE_OPPORTUNITIES', 'OFFICE_FOLLOW_UP_CALLS'],
    final_test_result: ['BOOKABLE_OPPORTUNITIES', 'OFFICE_FOLLOW_UP_CALLS'],
    conversion_status: [],
  });
});

test('renders every dashboard widget to a unique executable report payload', () => {
  const rendered = renderContract(model);
  const reports = rendered.report_payloads;
  const widgets = dashboard.dashboards.flatMap((item) => item.widgets.map((widget) => ({
    dashboard: item.title.startsWith('Free-Test') ? 'operations' : 'customer', ...widget,
  })));
  assert.equal(widgets.length, 20);
  assert.deepEqual(new Set(widgets.map(({ report_key: key }) => key)),
    new Set(Object.keys(reports)));
  assert.equal(new Set(Object.values(reports).map(({ title }) => title)).size, 20);
  for (const widget of widgets) {
    const definition = model.reports[widget.report_key];
    const payload = reports[widget.report_key];
    assert.equal(definition.widget_title, widget.title);
    assert.equal(definition.dashboard, widget.dashboard);
    assert.ok(['chart', 'pivot', 'summary'].includes(payload.reportType));
    assert.ok(Array.isArray(payload.axisColumns) && payload.axisColumns.length > 0);
    assert.ok(payload.axisColumns.every(({ type, columnName, operation }) =>
      typeof type === 'string' && typeof columnName === 'string'
      && typeof operation === 'string'));
    assert.ok(payload.filters.some(({ columnName, values }) =>
      columnName === 'ENVIRONMENT' && values.includes('development')));
    assert.ok(payload.filters.some(({ columnName, values }) =>
      columnName === 'ENGAGEMENT_TYPE' && values.includes('free_test')));
    assert.ok(payload.userFilters.some(({ columnName }) => columnName === 'CLIENT_KEY'));
    assert.ok(payload.userFilters.some(({ columnName }) => columnName === 'DEPLOYMENT_KEY'));
    assert.ok([...payload.filters, ...payload.userFilters]
      .every(({ tableName }) => tableName === payload.baseTableName));
    assert.match(payload.description, new RegExp(`^${widget.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`));
    assert.equal(/TBD_PRIVATE|\bviewId\b|\bworkspaceId\b/.test(JSON.stringify(payload)), false);
  }
});

test('renders exact createQueryTable payload keys without private identifiers', () => {
  const rendered = renderContract(model);
  assert.deepEqual(Object.keys(rendered.query_view_payloads),
    ['deployment_remaining', 'value_evidence', 'optional_evidence', 'freshness']);
  for (const [key, payload] of Object.entries(rendered.query_view_payloads)) {
    assert.deepEqual(Object.keys(payload).sort(), ['queryTableName', 'sqlQuery']);
    assert.equal(payload.queryTableName, model.derived_query_views[key].physical_view_name);
    assert.equal(payload.sqlQuery, model.derived_query_views[key].sql);
    assert.equal(/TBD_PRIVATE|\bviewId\b|\bworkspaceId\b/.test(JSON.stringify(payload)), false);
  }
});

test('renders three root folder payloads and assigns every canonical view exactly once', () => {
  const rendered = renderContract(model, dashboard);
  assert.deepEqual(Object.keys(rendered.folder_payloads),
    ['data_model', 'operations', 'customer_results']);
  assert.deepEqual(rendered.folder_payloads, {
    data_model: {
      folderName: 'Revenue Desk - Data Model',
      folderDesc: 'Canonical Revenue Desk Analytics tables and derived query views.',
      makeDefaultFolder: false,
    },
    operations: {
      folderName: 'Revenue Desk - Operations',
      folderDesc: 'Internal free-test operations reports and dashboard.',
      makeDefaultFolder: false,
    },
    customer_results: {
      folderName: 'Revenue Desk - Customer Results',
      folderDesc: 'Internal fixed-client results reports and dashboard.',
      makeDefaultFolder: false,
    },
  });
  assert.equal(JSON.stringify(rendered.folder_payloads).includes('parentFolderId'), false);

  const expectedReferences = new Set([
    ...Object.keys(model.target_tables).map((key) => `table:${key}`),
    ...Object.keys(model.derived_query_views).map((key) => `query_view:${key}`),
    ...Object.keys(model.reports).map((key) => `report:${key}`),
    ...dashboard.dashboards.map(({ key }) => `dashboard:${key}`),
  ]);
  const observedReferences = Object.values(rendered.folder_placements)
    .flatMap(({ viewReferences }) => viewReferences)
    .map(({ assetKind, assetKey }) => `${assetKind}:${assetKey}`);
  assert.equal(observedReferences.length, 31);
  assert.equal(new Set(observedReferences).size, 31);
  assert.deepEqual(new Set(observedReferences), expectedReferences);
  assert.deepEqual(Object.fromEntries(Object.entries(rendered.folder_placements)
    .map(([key, value]) => [key, value.viewReferences.length])), {
    data_model: 9,
    operations: 11,
    customer_results: 11,
  });

  for (const [folderKey, placement] of Object.entries(rendered.folder_placements)) {
    assert.match(placement.privateFolderIdBinding,
      new RegExp(`PRIVATE_ANALYTICS_FOLDER_IDS_JSON\\.${folderKey}`));
    for (const reference of placement.viewReferences) {
      assert.equal(typeof reference.viewName, 'string');
      assert.ok(reference.viewName.length > 0);
      assert.match(reference.privateViewIdBinding, /view_id|VIEW_IDS_JSON/);
    }
  }
  assert.equal(/TBD_PRIVATE|workspaceId|folderId|viewId/.test(JSON.stringify({
    payloads: rendered.folder_payloads,
    placements: rendered.folder_placements,
  })), false);
});

test('rejects duplicate or incomplete canonical folder placement', () => {
  const duplicate = structuredClone(model);
  duplicate.folder_contract.folders.operations.asset_references.push(
    { asset_kind: 'table', asset_key: 'deployment' },
  );
  assert.throws(() => renderContract(duplicate, dashboard), /duplicate asset reference/);

  const incomplete = structuredClone(model);
  incomplete.folder_contract.folders.customer_results.asset_references.pop();
  assert.throws(() => renderContract(incomplete, dashboard),
    /assign every table, query view, report, and dashboard exactly once/);
});

test('optional customer evidence preserves an explicit missing-versus-zero discriminator', () => {
  const rendered = renderContract(model);
  const view = model.derived_query_views.optional_evidence;
  assert.deepEqual(view.output_columns, [
    'ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
    'ENGAGEMENT_TYPE', 'RECORD_KEY', 'BOOKABLE_OPPORTUNITIES',
    'BOOKABLE_EVIDENCE_STATE', 'OFFICE_FOLLOW_UP_CALLS',
    'OFFICE_FOLLOW_UP_EVIDENCE_STATE', 'SOURCE_MODIFIED_AT',
  ]);
  for (const [measure, state] of [
    ['BOOKABLE_OPPORTUNITIES', 'BOOKABLE_EVIDENCE_STATE'],
    ['OFFICE_FOLLOW_UP_CALLS', 'OFFICE_FOLLOW_UP_EVIDENCE_STATE'],
  ]) {
    assert.match(view.sql, new RegExp(
      `ANALYSIS_EVIDENCE_COMPLETE[^;]+${measure}[^;]+THEN "${measure}" ELSE NULL`,
    ));
    assert.match(view.sql, new RegExp(
      `${measure}[^;]+THEN 'available' ELSE 'not_available' END AS "${state}"`,
    ));
  }

  const cases = [
    ['customer_bookable_evidence', 'BOOKABLE_OPPORTUNITIES', 'BOOKABLE_EVIDENCE_STATE'],
    ['customer_office_follow_up', 'OFFICE_FOLLOW_UP_CALLS',
      'OFFICE_FOLLOW_UP_EVIDENCE_STATE'],
  ];
  for (const [reportKey, measure, state] of cases) {
    const report = rendered.report_payloads[reportKey];
    assert.equal(report.baseTableName, view.physical_view_name);
    assert.deepEqual(report.axisColumns, [
      { type: 'groupBy', columnName: state, operation: 'actual' },
      { type: 'summarize', columnName: measure, operation: 'sum' },
    ]);
    assert.equal(report.filters.some(({ columnName }) =>
      columnName === 'ANALYSIS_EVIDENCE_COMPLETE'), false);
    assert.match(report.description, /available with numeric zero/i);
    assert.match(report.description, /not_available with a null measure/i);
  }
});

test('rendered freshness contract requires the fail-closed authoritative pre-render gate', () => {
  const rendered = renderContract(model);
  assert.equal(rendered.pre_render_gate.mode, 'fail_closed');
  assert.deepEqual(rendered.pre_render_gate.required_record_types, Object.keys(SPECIFIC));
  assert.match(rendered.pre_render_gate.timestamp_boundary,
    /No timestamp.*complete authoritative checkpoint/i);
  for (const reportKey of ['operations_data_freshness', 'customer_data_freshness']) {
    assert.match(rendered.report_payloads[reportKey].description,
      /never emits or implies Healthy/i);
    assert.match(rendered.report_payloads[reportKey].description, /pre_render_gate/i);
  }
});

test('report axes and filters resolve to declared table or query-view columns', () => {
  const rendered = renderContract(model);
  const columnsByView = new Map();
  for (const payload of Object.values(rendered.table_payloads)) {
    columnsByView.set(payload.tableDesign.TABLENAME,
      new Set(payload.tableDesign.COLUMNS.map(({ COLUMNNAME }) => COLUMNNAME)));
  }
  for (const view of Object.values(model.derived_query_views)) {
    columnsByView.set(view.physical_view_name, new Set(view.output_columns));
  }
  for (const [key, payload] of Object.entries(rendered.report_payloads)) {
    const columns = columnsByView.get(payload.baseTableName);
    assert.ok(columns, `unknown base view for ${key}`);
    for (const value of [...payload.axisColumns, ...payload.filters, ...payload.userFilters]) {
      assert.ok(columns.has(value.columnName), `${key} references unknown ${value.columnName}`);
    }
  }
});

test('dashboard assembly locks environment and fixed-client boundaries before render', () => {
  const operations = dashboard.dashboards[0];
  const customer = dashboard.dashboards[1];
  assert.deepEqual(dashboard.dashboards.map(({ key }) => key), ['operations', 'customer']);
  for (const item of [operations, customer]) {
    const controls = Object.fromEntries(item.user_filter_controls
      .map((control) => [control.column, control]));
    assert.deepEqual(
      { fixed: controls.ENVIRONMENT.fixed_value, hidden: controls.ENVIRONMENT.visible,
        locked: controls.ENVIRONMENT.locked },
      { fixed: 'development', hidden: false, locked: true },
    );
    assert.equal(controls.ENGAGEMENT_TYPE.fixed_value, 'free_test');
  }
  const customerControls = Object.fromEntries(customer.user_filter_controls
    .map((control) => [control.column, control]));
  for (const column of ['CLIENT_KEY', 'DEPLOYMENT_KEY']) {
    assert.deepEqual({
      control: customerControls[column].control,
      required: customerControls[column].required,
      visible: customerControls[column].visible,
      locked: customerControls[column].locked,
      bind: customerControls[column].bind_before_render,
    }, {
      control: 'single-select', required: true, visible: false, locked: true, bind: true,
    });
  }
  const expiry = operations.user_filter_controls.find(({ name }) => name === 'Expiry Window');
  assert.deepEqual({ required: expiry.required, locked: expiry.locked, value: expiry.default },
    { required: true, locked: true, value: 'next 48 hours' });
});
