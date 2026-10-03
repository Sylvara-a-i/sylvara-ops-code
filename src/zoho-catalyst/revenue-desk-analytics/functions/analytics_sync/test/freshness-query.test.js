'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const model = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../config/analytics-model-contract.json'), 'utf8'));
const view = model.derived_query_views.freshness;
const dimensions = ['RECORD_TYPE', 'ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENGAGEMENT_TYPE'];
const tables = {
  deployment: 'RevenueDeskAnalyticsDeploymentFacts', call: 'RevenueDeskAnalyticsCallFacts',
  daily_metric: 'RevenueDeskAnalyticsDailyMetricFacts', final_test_result: 'RevenueDeskAnalyticsFinalTestResultFacts',
  conversion_status: 'RevenueDeskAnalyticsConversionStatusFacts',
};
test('derived freshness outer references use the declared table alias', () => {
  const select = view.sql.slice(0, view.sql.indexOf(' FROM ('));
  const group = view.sql.slice(view.sql.lastIndexOf(' GROUP BY '));
  for (const dimension of dimensions) {
    // Zoho otherwise exposes qualified dimension names rather than contractual output names.
    assert.ok(select.includes(`"RevenueDeskFacts"."${dimension}" AS "${dimension}"`));
    assert.ok(group.includes(`"RevenueDeskFacts"."${dimension}"`));
  }
  assert.ok(select.includes('MAX("RevenueDeskFacts"."SOURCE_MODIFIED_AT") AS "LATEST_SOURCE_MODIFIED_AT"'));
  assert.ok(select.includes('COUNT("RevenueDeskFacts"."RECORD_KEY") AS "SOURCE_ROW_COUNT"'));
  assert.equal((view.sql.match(/UNION ALL/g) || []).length, 4);
});
function database() {
  const db = new DatabaseSync(':memory:');
  for (const table of Object.values(tables)) db.exec(`CREATE TABLE "${table}" ("ENVIRONMENT" TEXT, "CLIENT_KEY" TEXT, "DEPLOYMENT_KEY" TEXT, "ENGAGEMENT_TYPE" TEXT, "SOURCE_MODIFIED_AT" TEXT, "RECORD_KEY" TEXT)`);
  return db;
}
// SQLite checks aggregation semantics locally; it does not certify Zoho's SQL dialect or live view creation.
test('freshness counts and latest timestamps remain isolated across every partition dimension and record type', () => {
  const db = database();
  try {
    const expected = [];
    for (const [recordType, table] of Object.entries(tables)) {
      const insert = db.prepare(`INSERT INTO "${table}" VALUES (?, ?, ?, ?, ?, ?)`);
      const baseline = ['development', 'synthetic-client-a', 'synthetic-deployment-a', 'FreeTest'];
      const partitions = [baseline, ['production', ...baseline.slice(1)],
        [baseline[0], 'synthetic-client-b', ...baseline.slice(2)],
        [...baseline.slice(0, 2), 'synthetic-deployment-b', baseline[3]],
        [...baseline.slice(0, 3), 'SyntheticOther']];
      for (const [index, values] of partitions.entries()) {
        const earlier = `2026-01-0${index + 1}T00:00:00.000Z`, latest = `2026-02-0${index + 1}T00:00:00.000Z`;
        insert.run(...values, earlier, `${recordType}-${index}-a`);
        insert.run(...values, latest, `${recordType}-${index}-b`);
        insert.run(...values, null, `${recordType}-${index}-c`);
        expected.push(Object.fromEntries([...dimensions.map((key, i) => [key, [recordType, ...values][i]]),
          ['LATEST_SOURCE_MODIFIED_AT', latest], ['SOURCE_ROW_COUNT', 3]]));
      }
    }
    const result = db.prepare(view.sql).all().map(row => ({ ...row }));
    const ordered = rows => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.deepEqual(ordered(result), ordered(expected));
    assert.deepEqual(Object.keys(result[0]), view.output_columns);
  } finally { db.close(); }
});
test('empty freshness partitions produce no invented rows or timestamps', () => {
  const db = database();
  try { assert.deepEqual(db.prepare(view.sql).all(), []); }
  finally { db.close(); }
});
