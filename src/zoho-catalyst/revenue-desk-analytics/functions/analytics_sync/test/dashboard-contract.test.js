'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contractPath = path.resolve(__dirname, '../../../config/dashboard-contract.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const { conversionStatusFact } = require(path.resolve(
  __dirname,
  '../../../../crm-billing-orchestrator/functions/crm_billing_orchestrator/lib/analytics-outbox.js',
));

test('declares the two exact fail-closed dashboard contracts', () => {
  assert.equal(contract.schema_version, 2);
  assert.equal(contract.production_authorized, false);
  assert.equal(contract.workspace_strategy.create_new_workspace, false);
  assert.deepEqual(contract.source_contract.record_types, [
    'deployment', 'call', 'daily_metric', 'final_test_result', 'conversion_status',
  ]);
  assert.deepEqual(contract.dashboards.map(({ title }) => title), [
    'Free-Test Operations Dashboard', 'Customer Results Dashboard',
  ]);

  for (const dashboard of contract.dashboards) {
    assert.equal(dashboard.pre_render_gate_key, contract.pre_render_gate.model_gate_key);
    assert.equal(dashboard.access.public_link, false);
    assert.equal(dashboard.access.embed, false);
    assert.equal(dashboard.access.scheduled_export, false);
    assert.equal(dashboard.access.direct_customer_access, false);
    assert.ok(dashboard.widgets.some(({ title }) => title === 'Data Freshness'));
    assert.ok(dashboard.required_filters.some(({ column }) => column === 'ENVIRONMENT'));
    assert.ok(dashboard.required_filters.some(({ column, fixed_value: fixed }) =>
      column === 'ENGAGEMENT_TYPE' && fixed === 'free_test'));
    assert.match(
      dashboard.widgets.find(({ title }) => title === 'Data Freshness').definition,
      /never emits or implies Healthy.*pre-render/i,
    );
  }

  const customer = contract.dashboards[1];
  for (const column of ['CLIENT_KEY', 'DEPLOYMENT_KEY']) {
    const filter = customer.required_filters.find((candidate) => candidate.column === column);
    assert.deepEqual(
      { required: filter.required, single: filter.single_value, locked: filter.locked_before_render },
      { required: true, single: true, locked: true },
    );
  }
  assert.match(
    customer.widgets.find(({ title }) => title === 'Value Evidence').definition,
    /separately by VALUE_EVIDENCE_CLASS and VALUE_CURRENCY/,
  );
  for (const title of ['Bookable Evidence', 'Office Follow-Up']) {
    const widget = customer.widgets.find((candidate) => candidate.title === title);
    assert.equal(widget.source, 'optional_evidence');
    assert.match(widget.definition, /available plus 0 is a verified zero/i);
    assert.match(widget.definition, /not_available plus null displays Not Available/i);
  }
  assert.deepEqual(contract.pre_render_gate.required_before,
    ['dashboard visibility', 'fixed-client rendering', 'Reconciled label']);
  assert.match(contract.pre_render_gate.blocked_behavior,
    /Do not substitute a recent timestamp.*for the ready verdict/i);
});

test('conversion producer preserves its free-test origin and passes the unchanged dashboard partition', () => {
  const conversion = contract.source_contract.engagement_semantics.conversion_status;
  assert.deepEqual(conversion, {
    origin_field: 'ENGAGEMENT_TYPE',
    origin_value: 'free_test',
    target_field: 'TARGET_ENGAGEMENT_TYPE',
    target_value: 'paid_service',
    rule: 'A free-test conversion remains in the free_test source partition while its separately named target identifies the proposed paid engagement.',
  });
  const operations = contract.dashboards.find(({ title }) =>
    title === 'Free-Test Operations Dashboard');
  const filters = Object.fromEntries(operations.required_filters.map((filter) =>
    [filter.column, filter]));
  assert.deepEqual(filters.ENVIRONMENT,
    { column: 'ENVIRONMENT', required: true, single_value: true });
  assert.deepEqual(filters.ENGAGEMENT_TYPE,
    { column: 'ENGAGEMENT_TYPE', required: true, fixed_value: 'free_test' });
  assert.deepEqual(filters.CLIENT_KEY,
    { column: 'CLIENT_KEY', required: false, single_value: false });
  assert.deepEqual(filters.DEPLOYMENT_KEY,
    { column: 'DEPLOYMENT_KEY', required: false, single_value: false });

  const fact = conversionStatusFact({
    analyticsPartitionSecret: 'synthetic-analytics-partition-key-value',
    paidSubscriptionStatusMap: { growth: 'Active' },
    testCompletedStatusValue: 'Completed',
    paidAcceptanceValue: 'Accepted',
    sourceRevision: 'a'.repeat(40),
    deploymentEnvironment: 'development',
  }, {
    deal: {
      id: '100000000000001', Modified_Time: '2026-08-21T15:01:00.000Z',
      Billing_Automation_Status: 'Paid Verified', Subscription_Status: 'Active',
      Test_Status: 'Completed', Subscription_Acceptance_Status: 'Accepted',
    },
    accountId: '100000000000002', deploymentId: 'synthetic_deployment',
    configurationVersion: 'synthetic_config_v1', billingStatus: 'Active',
  });
  assert.equal(fact[conversion.origin_field], filters.ENGAGEMENT_TYPE.fixed_value);
  assert.equal(fact[conversion.target_field], conversion.target_value);
  assert.equal(fact.ENVIRONMENT, 'development');
  assert.match(fact.CLIENT_KEY, /^[a-f0-9]{64}$/);
  assert.match(fact.DEPLOYMENT_KEY, /^[a-f0-9]{64}$/);
  assert.match(
    operations.widgets.find(({ title }) => title === 'Conversion Readiness').definition,
    /ENGAGEMENT_TYPE=free_test.*TARGET_ENGAGEMENT_TYPE=paid_service/,
  );
});

test('keeps live creation, sharing, and cleanup approval-gated', () => {
  assert.match(contract.status, /live-creation-and-sharing-blocked/);
  assert.equal(contract.creation_order.some((step) => /one-client isolation/i.test(step)), true);
  assert.equal(contract.creation_order.some((step) => /native Analytics console/i.test(step)), true);
  assert.equal(contract.rollback.some((step) => /separately approved/i.test(step)), true);
});
