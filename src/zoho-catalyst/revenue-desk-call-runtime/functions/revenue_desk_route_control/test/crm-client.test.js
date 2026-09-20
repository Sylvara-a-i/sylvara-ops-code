'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCrmControlClient, DEAL_FIELDS } = require('../lib/crm-client');

const DEAL_ID = '400000001';
const DEPLOYMENT_ID = 'deployment_synthetic';
const CONFIGURATION_ID = 'configuration_synthetic';
const ACTIVATED_AT = '2026-08-29T12:15:00.000Z';
const CORE_APPROVED_AT = '2026-08-29T12:10:00.789Z';
const CORE_STOPPED_AT = '2026-08-29T12:20:00.789Z';
const SYNTHETIC_ORGANIZATION_ID = '606';

function scheduledDeal() {
  return {
    id: DEAL_ID, Modified_Time: '2026-08-29T07:00:00-05:00',
    Stage: 'Setup and QA', Test_Status: 'Scheduled',
    Go_Live_Approval_Status: 'Approved',
    Account_Name: { id: '400000002', name: 'ZZZ SYNTHETIC Account' },
    Contact_Name: { id: '400000003', name: 'ZZZ SYNTHETIC Contact' },
    Approved_Deployment_Record_ID: DEPLOYMENT_ID,
    Approved_Configuration_Version: CONFIGURATION_ID,
    Deployment_Record_ID: DEPLOYMENT_ID,
    Configuration_Version: CONFIGURATION_ID,
    Test_Start_At: null, Test_End_At: null,
    Test_End_Reason: null, Rollback_Completed_At: null,
    Billing_Subscription_ID: null, Reason_For_Loss__s: null,
    Urgent_Call_Handling: 'Alert + Capture Callback',
    Existing_Customer_Call_Handling: 'Alert + Capture Callback',
  };
}

function response(status, value) {
  return { status, async json() { return structuredClone(value); } };
}

function fixture(transitionOutcome, organizationId = SYNTHETIC_ORGANIZATION_ID) {
  const state = scheduledDeal();
  const requests = [];
  const writes = [];
  let modified = 0;
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    requests.push({ method: options.method, pathname: parsed.pathname,
      fields: parsed.searchParams.get('fields') });
    if (options.method === 'GET' && parsed.pathname.endsWith('/org')) {
      return response(200, { org: [{ zgid: organizationId }] });
    }
    if (options.method === 'GET' && parsed.pathname.endsWith(`/Deals/${DEAL_ID}`)) {
      return response(200, { data: [{ ...state }] });
    }
    if (options.method === 'PUT' && parsed.pathname.endsWith(`/Deals/${DEAL_ID}`)) {
      const body = JSON.parse(options.body);
      const [{ id, ...patch }] = body.data;
      assert.equal(id, DEAL_ID);
      writes.push({ patch: structuredClone(patch), trigger: structuredClone(body.trigger) });
      Object.assign(state, patch, {
        Modified_Time: `2026-08-29T07:00:0${++modified}-05:00`,
      });
      return response(200, { data: [{ status: 'success', code: 'SUCCESS',
        details: { id: DEAL_ID } }] });
    }
    if (options.method === 'GET' && parsed.pathname.endsWith('/actions/blueprint')) {
      return response(200, { blueprint: { transitions: [
        { name: 'Activate Test Route', id: '400000099' },
        { name: 'Close During QA', id: '400000098' },
        { name: 'Contain Failed Activation', id: '400000097' },
        { name: 'Close Live Test', id: '400000096' },
      ] } });
    }
    if (options.method === 'PUT' && parsed.pathname.endsWith('/actions/blueprint')) {
      const transitionId = JSON.parse(options.body).blueprint[0].transition_id;
      if (transitionId === '400000098') {
        Object.assign(state, { Stage: 'Closed Lost', Test_Status: 'Rolled Back' });
        return response(200, { blueprint: [{ status: 'success', code: 'SUCCESS' }] });
      }
      if (transitionId === '400000096') {
        Object.assign(state, { Stage: 'Closed Lost', Test_Status: 'Rolled Back' });
        return response(200, { blueprint: [{ status: 'success', code: 'SUCCESS' }] });
      }
      if (transitionId === '400000097') {
        if (transitionOutcome === 'containment-unknown') {
          Object.assign(state, { Stage: 'Results Review', Test_Status: 'Review Ready' });
        } else {
          Object.assign(state, { Stage: 'Setup and QA', Test_Status: 'Scheduled',
            Test_Start_At: null });
        }
        if (transitionOutcome === 'containment-ambiguous'
          || transitionOutcome === 'containment-unknown') {
          throw new Error('synthetic ambiguous containment response');
        }
        return response(200, { blueprint: [{ status: 'success', code: 'SUCCESS' }] });
      }
      if (transitionOutcome === 'committed') {
        Object.assign(state, { Stage: 'Test Live', Test_Status: 'Live' });
      } else if (transitionOutcome === 'unknown') {
        Object.assign(state, { Stage: 'Test Authorized', Test_Status: 'Setup Pending' });
      }
      throw new Error('synthetic ambiguous transition response');
    }
    throw new Error(`Unexpected CRM request ${options.method} ${parsed.pathname}`);
  };
  const client = createCrmControlClient({
    crmApiBaseUrl: 'https://www.zohoapis.com/crm/v8', platformTimeoutMs: 3000,
    crmOrganizationId: SYNTHETIC_ORGANIZATION_ID,
  }, {
    readAuthorization: async () => 'Zoho-oauthtoken synthetic-read',
    writeAuthorization: async () => 'Zoho-oauthtoken synthetic-write',
    fetchImpl,
  });
  return { client, state, requests, writes, getModifiedCount: () => modified };
}

test('CRM reader requests both existing handling fields and activation snapshots reject their drift', async () => {
  const selected = fixture('committed');
  const before = await selected.client.getDeal(DEAL_ID);
  const read = selected.requests.find(({ pathname }) => pathname.endsWith(`/Deals/${DEAL_ID}`));
  assert.deepEqual(read.fields.split(','), DEAL_FIELDS);
  for (const field of ['Urgent_Call_Handling', 'Existing_Customer_Call_Handling']) {
    assert.equal(DEAL_FIELDS.filter((name) => name === field).length, 1);
    assert.equal(before[field], 'Alert + Capture Callback');
    const changed = fixture('committed');
    const expectedDeal = structuredClone(changed.state);
    changed.state[field] = 'Transfer to On-Call';
    await assert.rejects(changed.client.recordActivation(DEAL_ID, {
      deploymentId: DEPLOYMENT_ID, configurationVersionId: CONFIGURATION_ID,
      activatedAt: ACTIVATED_AT, expectedDeal,
    }), { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
    assert.deepEqual(changed.writes, []);
    assert.equal(changed.requests.some(({ method }) => method === 'PUT'), false);
  }
});

test('ambiguous activation acknowledgement accepts exact authoritative Live readback', async () => {
  const selected = fixture('committed');
  const result = await selected.client.recordActivation(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    activatedAt: ACTIVATED_AT,
    expectedDeal: structuredClone(selected.state),
  });
  assert.equal(result.Stage, 'Test Live');
  assert.equal(result.Test_Status, 'Live');
  assert.equal(result.Test_Start_At, ACTIVATED_AT);
  assert.equal(selected.requests.some(({ pathname }) =>
    pathname.endsWith('/actions/blueprint')), true);
  assert.deepEqual(selected.writes[0].trigger, ['workflow']);
});

test('failed activation clears only proven Scheduled state and reports inactive', async () => {
  const selected = fixture('not-committed');
  await assert.rejects(selected.client.recordActivation(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    activatedAt: ACTIVATED_AT,
    expectedDeal: structuredClone(selected.state),
  }), { code: 'CRM_ACTIVATION_PROVEN_INACTIVE' });
  assert.equal(selected.state.Stage, 'Setup and QA');
  assert.equal(selected.state.Test_Status, 'Scheduled');
  assert.equal(selected.state.Test_Start_At, null);
});

test('unknown CRM poststate requires reconciliation and is never called inactive', async () => {
  const selected = fixture('unknown');
  await assert.rejects(selected.client.recordActivation(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    activatedAt: ACTIVATED_AT,
    expectedDeal: structuredClone(selected.state),
  }), { code: 'CRM_ACTIVATION_RECONCILIATION_REQUIRED' });
  assert.equal(selected.state.Stage, 'Test Authorized');
});

test('a misbound CRM Connection fails before Deal read or write', async () => {
  const selected = fixture('committed', '100000009');
  await assert.rejects(selected.client.recordActivation(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    activatedAt: ACTIVATED_AT,
    expectedDeal: structuredClone(selected.state),
  }), { code: 'CRM_ORGANIZATION_MISMATCH' });
  assert.equal(selected.state.Test_Start_At, null);
});

test('an exact partial start timestamp resumes through the Blueprint transition', async () => {
  const selected = fixture('committed');
  selected.state.Test_Start_At = ACTIVATED_AT;
  const expectedDeal = structuredClone(selected.state);
  const result = await selected.client.recordActivation(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    activatedAt: ACTIVATED_AT,
    expectedDeal,
  });
  assert.equal(result.Stage, 'Test Live');
  assert.equal(result.Test_Start_At, ACTIVATED_AT);
});

for (const mode of ['containment-committed', 'containment-ambiguous']) {
  test(`failed activation containment preserves approval with exact ${mode} readback`, async () => {
    const selected = fixture(mode);
    const expectedDeal = structuredClone(selected.state);
    Object.assign(selected.state, { Stage: 'Test Live', Test_Status: 'Live',
      Test_Start_At: ACTIVATED_AT });
    const result = await selected.client.containActivation(DEAL_ID, {
      deploymentId: DEPLOYMENT_ID,
      configurationVersionId: CONFIGURATION_ID,
      activatedAt: ACTIVATED_AT,
      expectedDeal,
    });
    assert.equal(result.Stage, 'Setup and QA');
    assert.equal(result.Test_Status, 'Scheduled');
    assert.equal(result.Test_Start_At, null);
    assert.equal(result.Go_Live_Approval_Status, 'Approved');
  });
}

test('ambiguous failed-activation containment rejects any noncanonical CRM poststate', async () => {
  const selected = fixture('containment-unknown');
  const expectedDeal = structuredClone(selected.state);
  Object.assign(selected.state, { Stage: 'Test Live', Test_Status: 'Live',
    Test_Start_At: ACTIVATED_AT });
  await assert.rejects(selected.client.containActivation(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    activatedAt: ACTIVATED_AT,
    expectedDeal,
  }), { code: 'CRM_ACTIVATION_RECONCILIATION_REQUIRED' });
  assert.equal(selected.state.Stage, 'Results Review');
});

test('an exact partial rollback resumes without repeating the field write', async () => {
  const selected = fixture('committed');
  const stoppedAt = '2026-08-29T12:20:00.000Z';
  Object.assign(selected.state, {
    Test_End_At: stoppedAt,
    Test_End_Reason: 'Sylvara Stopped',
    Rollback_Completed_At: stoppedAt,
  });
  const expectedDeal = structuredClone(selected.state);
  const result = await selected.client.recordRollback(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    stoppedAt,
    reason: 'Sylvara Stopped',
    routeInactive: true,
    expectedDeal,
  });
  assert.equal(selected.getModifiedCount(), 0);
  assert.equal(result.Stage, 'Setup and QA');
  assert.equal(result.Test_Status, 'Scheduled');
  assert.equal(result.Test_End_At, stoppedAt);
  assert.equal(result.manualCloseRequired.transitionName, 'Close During QA');
});

test('rollback keeps the exact CRM label separate from its approved physical version ID', async () => {
  const selected = fixture('committed');
  selected.state.Configuration_Version = 'form2cfgv1:101:synthetic_label';
  const expectedDeal = structuredClone(selected.state);
  const stoppedAt = '2026-08-29T12:20:00.000Z';
  const request = { deploymentId: DEPLOYMENT_ID, configurationVersionId: CONFIGURATION_ID,
    stoppedAt, reason: 'Sylvara Stopped', routeInactive: true, expectedDeal };
  const result = await selected.client.recordRollback(DEAL_ID, request);
  assert.equal(result.Configuration_Version, expectedDeal.Configuration_Version);
  assert.equal(result.Approved_Configuration_Version, CONFIGURATION_ID);
  assert.equal(result.manualCloseRequired.transitionName, 'Close During QA');
  const writes = selected.writes.length;
  const resumed = await selected.client.recordRollback(DEAL_ID, {
    ...request, expectedDeal: structuredClone(selected.state),
  });
  assert.equal(resumed.Configuration_Version, expectedDeal.Configuration_Version);
  assert.equal(selected.writes.length, writes);
});

test('rollback rejects stale labels and wrong approved physical IDs before any CRM write', async () => {
  for (const change of ['label-drift', 'physical-id', 'missing-label']) {
    const selected = fixture('committed');
    selected.state.Configuration_Version = 'form2cfgv1:101:synthetic_label';
    const expectedDeal = structuredClone(selected.state);
    if (change === 'label-drift') selected.state.Configuration_Version = 'another_label';
    if (change === 'missing-label') {
      selected.state.Configuration_Version = null;
      expectedDeal.Configuration_Version = null;
    }
    await assert.rejects(selected.client.recordRollback(DEAL_ID, {
      deploymentId: DEPLOYMENT_ID,
      configurationVersionId: change === 'physical-id' ? 'different_physical_row' : CONFIGURATION_ID,
      stoppedAt: '2026-08-29T12:20:00.000Z', reason: 'Sylvara Stopped', routeInactive: true, expectedDeal,
    }), { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
    assert.equal(selected.writes.length, 0);
    assert.equal(selected.requests.some((request) => request.method === 'PUT'), false);
  }
});

test('rollback accepts only the exact concurrent activation and closes CRM non-Live', async () => {
  const selected = fixture('committed');
  const expectedDeal = structuredClone(selected.state);
  Object.assign(selected.state, {
    Stage: 'Test Live', Test_Status: 'Live', Test_Start_At: ACTIVATED_AT,
  });
  const stoppedAt = '2026-08-29T12:20:00.000Z';
  const result = await selected.client.recordRollback(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    stoppedAt,
    reason: 'Sylvara Stopped',
    routeInactive: true,
    activatedAt: ACTIVATED_AT,
    expectedDeal,
  });
  assert.equal(result.Stage, 'Test Live');
  assert.equal(result.Test_Status, 'Live');
  assert.equal(result.Test_Start_At, ACTIVATED_AT);
  assert.equal(result.Test_End_At, stoppedAt);
  assert.equal(result.manualCloseRequired.transitionName, 'Close Live Test');
});

test('manual QA close retry proves terminal status, loss reason, and unchanged Billing state', async () => {
  const selected = fixture('committed');
  const expectedDeal = structuredClone(selected.state);
  const stoppedAt = '2026-08-29T12:20:00.000Z';
  const partial = await selected.client.recordRollback(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    stoppedAt,
    reason: 'Sylvara Stopped',
    routeInactive: true,
    activatedAt: ACTIVATED_AT,
    expectedDeal,
  });
  assert.equal(partial.Test_Status, 'Scheduled');
  assert.equal(partial.manualCloseRequired.transitionName, 'Close During QA');
  Object.assign(selected.state, {
    Stage: 'Closed Lost', Test_Status: 'Failed',
    Reason_For_Loss__s: 'Synthetic QA stop',
  });
  const completed = await selected.client.recordRollback(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    stoppedAt,
    reason: 'Sylvara Stopped',
    routeInactive: true,
    activatedAt: ACTIVATED_AT,
    expectedDeal,
  });
  assert.equal(completed.Stage, 'Closed Lost');
  assert.equal(completed.Test_Status, 'Failed');
  assert.equal(completed.Test_Start_At, null);
});

test('rollback rejects Billing subscription state and raw machine reasons before writing', async () => {
  const billing = fixture('committed');
  billing.state.Billing_Subscription_ID = 'subscription_synthetic';
  await assert.rejects(billing.client.recordRollback(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    stoppedAt: '2026-08-29T12:20:00.000Z',
    reason: 'Sylvara Stopped',
    routeInactive: true,
    expectedDeal: structuredClone(billing.state),
  }), { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
  assert.equal(billing.getModifiedCount(), 0);

  const rawReason = fixture('committed');
  await assert.rejects(rawReason.client.recordRollback(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    stoppedAt: '2026-08-29T12:20:00.000Z',
    reason: 'operator_requested',
    routeInactive: true,
    expectedDeal: structuredClone(rawReason.state),
  }), { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
  assert.equal(rawReason.getModifiedCount(), 0);
});

test('rollback rejects unrelated drift during a concurrent activation', async () => {
  const selected = fixture('committed');
  const expectedDeal = structuredClone(selected.state);
  Object.assign(selected.state, {
    Stage: 'Test Live', Test_Status: 'Live', Test_Start_At: ACTIVATED_AT,
    Approved_Configuration_Version: 'configuration_other',
  });
  await assert.rejects(selected.client.recordRollback(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    stoppedAt: '2026-08-29T12:20:00.000Z',
    reason: 'Sylvara Stopped',
    routeInactive: true,
    activatedAt: ACTIVATED_AT,
    expectedDeal,
  }), { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
  assert.equal(selected.state.Stage, 'Test Live');
});

test('activation rejects a Deal that drifted after control validation', async () => {
  const selected = fixture('committed');
  const expectedDeal = structuredClone(selected.state);
  selected.state.Approved_Fallback_Number = '+15550100105';
  await assert.rejects(selected.client.recordActivation(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    activatedAt: ACTIVATED_AT,
    expectedDeal,
  }), { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
  assert.equal(selected.state.Stage, 'Setup and QA');
  assert.equal(selected.state.Test_Start_At, null);
});

test('lookup snapshots compare canonical CRM ids and reject cross-record drift', async () => {
  const selected = fixture('committed');
  const expectedDeal = structuredClone(selected.state);
  selected.state.Account_Name = { ...selected.state.Account_Name, name: 'Updated label' };
  const activated = await selected.client.recordActivation(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    activatedAt: ACTIVATED_AT,
    expectedDeal,
  });
  assert.equal(activated.Stage, 'Test Live');

  const drifted = fixture('committed');
  const driftExpected = structuredClone(drifted.state);
  drifted.state.Contact_Name = { id: '400000004', name: 'Different contact' };
  await assert.rejects(drifted.client.recordActivation(DEAL_ID, {
    deploymentId: DEPLOYMENT_ID,
    configurationVersionId: CONFIGURATION_ID,
    activatedAt: ACTIVATED_AT,
    expectedDeal: driftExpected,
  }), { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
  assert.equal(drifted.state.Test_Start_At, null);
});

test('Journey-core writes bypass workflows and normalize CRM DateTimes without Blueprint',
  async () => {
  const selected = fixture('not-committed');
  Object.assign(selected.state, {
    Stage: 'Setup and Authorization', Test_Status: 'Not Started',
    Setup_Access_Status: 'Submitted', Go_Live_Approval_Status: 'Not Ready',
    Go_Live_Approved_At: null, Deployment_Record_ID: null,
    Approved_Deployment_Record_ID: null, Approved_Configuration_Version: null,
    Test_Start_At: null, Test_End_At: null, Test_End_Reason: null,
    Rollback_Completed_At: null,
  });
  const approved = await selected.client.recordCoreApproval(DEAL_ID, {
    configurationVersionId: CONFIGURATION_ID, approvedAt: CORE_APPROVED_AT,
    expectedDeal: structuredClone(selected.state),
  });
  assert.equal(approved.Stage, 'Setup and QA');
  assert.equal(approved.Test_Status, 'Scheduled');
  assert.equal(approved.Go_Live_Approved_At, '2026-08-29T12:10:00+00:00');
  assert.deepEqual(selected.writes[0].trigger, []);

  const stopped = await selected.client.recordCoreRollback(DEAL_ID, {
    configurationVersionId: CONFIGURATION_ID, stoppedAt: CORE_STOPPED_AT,
    reason: 'Sylvara Stopped', expectedDeal: structuredClone(selected.state),
  });
  assert.equal(stopped.Stage, 'Closed Lost');
  assert.equal(stopped.Test_Status, 'Failed');
  assert.equal(stopped.Go_Live_Approval_Status, 'Revoked');
  assert.equal(stopped.Test_End_At, '2026-08-29T12:20:00+00:00');
  assert.equal(stopped.Rollback_Completed_At, '2026-08-29T12:20:00+00:00');
  assert.deepEqual(selected.writes[1].trigger, []);
  assert.equal(selected.requests.some(({ pathname }) =>
    pathname.endsWith('/actions/blueprint')), false);
});

test('Journey-core approval rejects workflow-shaped and conflicting prestates', async () => {
  for (const conflict of [
    { Test_Status: 'Setup Pending' },
    { Stage: 'Setup and QA' },
    { Go_Live_Approval_Status: 'Pending Internal Approval' },
    { Go_Live_Approved_At: '2026-08-29T12:10:00+00:00' },
    { Approved_Configuration_Version: 'configuration_other' },
    { Deployment_Record_ID: DEPLOYMENT_ID },
  ]) {
    const selected = fixture('not-committed');
    Object.assign(selected.state, {
      Stage: 'Setup and Authorization', Test_Status: 'Not Started',
      Setup_Access_Status: 'Submitted', Go_Live_Approval_Status: 'Not Ready',
      Go_Live_Approved_At: null, Deployment_Record_ID: null,
      Approved_Deployment_Record_ID: null, Approved_Configuration_Version: null,
      Test_Start_At: null, Test_End_At: null,
    }, conflict);
    await assert.rejects(selected.client.recordCoreApproval(DEAL_ID, {
      configurationVersionId: CONFIGURATION_ID, approvedAt: CORE_APPROVED_AT,
      expectedDeal: structuredClone(selected.state),
    }), { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
    assert.equal(selected.writes.length, 0);
  }
});

function supersessionFixture({ outcome = 'committed', afterCommit = () => {} } = {}) {
  const priorCoreApproval = { configurationVersionId: 'form2cfgv1:7000000000001:' + 'a'.repeat(40),
    approvedAt: '2026-08-29T12:05:00.000Z' };
  const state = { ...scheduledDeal(), Configuration_Version: priorCoreApproval.configurationVersionId,
    Approved_Configuration_Version: priorCoreApproval.configurationVersionId,
    Approved_Deployment_Record_ID: null, Go_Live_Approved_At: '2026-08-29T12:05:00+00:00' };
  const writes = [];
  const requests = [];
  const client = createCrmControlClient({ crmApiBaseUrl: 'https://synthetic-crm.invalid/crm/v8',
    crmOrganizationId: SYNTHETIC_ORGANIZATION_ID, platformTimeoutMs: 500 }, {
    readAuthorization: async () => 'Zoho-oauthtoken synthetic-read',
    writeAuthorization: async () => 'Zoho-oauthtoken synthetic-write',
    async fetchImpl(url, options) {
      const pathname = new URL(url).pathname;
      requests.push({ method: options.method, pathname });
      assert.equal(pathname.includes('blueprint'), false);
      if (pathname.endsWith('/org')) return response(200, { org: [{ zgid: SYNTHETIC_ORGANIZATION_ID }] });
      assert.equal(pathname, `/crm/v8/Deals/${DEAL_ID}`);
      if (options.method === 'GET') {
        if (outcome === 'readback-unknown' && writes.length) throw new Error('synthetic private readback');
        return response(200, { data: [state] });
      }
      assert.equal(options.method, 'PUT');
      const body = JSON.parse(options.body);
      const [{ id, ...patch }] = body.data;
      assert.equal(id, DEAL_ID);
      writes.push({ patch, trigger: body.trigger, conditional: options.headers['If-Unmodified-Since'] });
      if (outcome === 'before-commit') throw new Error('synthetic private precommit');
      Object.assign(state, patch, { Modified_Time: '2026-08-29T12:15:01+00:00' });
      afterCommit(state);
      if (outcome === 'after-commit') throw new Error('synthetic private postcommit');
      return response(200, { data: [{ status: 'success', code: 'SUCCESS', details: { id: DEAL_ID } }] });
    },
  });
  const argumentsFor = () => ({ deploymentId: DEPLOYMENT_ID, configurationVersionId: CONFIGURATION_ID,
    approvedAt: ACTIVATED_AT, expectedDeal: structuredClone(state), priorCoreApproval, configurationStaged: true });
  return { client, state, writes, requests, argumentsFor, priorCoreApproval };
}

test('server-proven core approval supersession uses one conditional controller write with no workflow', async () => {
  const selected = supersessionFixture();
  const previous = structuredClone(selected.state);
  const result = await selected.client.recordApproval(DEAL_ID, selected.argumentsFor());
  assert.equal(result.Approved_Configuration_Version, CONFIGURATION_ID);
  assert.equal(result.Configuration_Version, selected.priorCoreApproval.configurationVersionId);
  assert.equal(result.Go_Live_Approved_At, '2026-08-29T12:15:00+00:00');
  assert.equal(result.Approved_Deployment_Record_ID, DEPLOYMENT_ID);
  assert.equal(result.Test_Status, 'Scheduled');
  assert.equal(result.Test_Start_At, null);
  assert.equal(result.Test_End_At, null);
  assert.deepEqual(selected.writes, [{ patch: {
    Go_Live_Approval_Status: 'Approved', Go_Live_Approved_At: '2026-08-29T12:15:00+00:00',
    Approved_Deployment_Record_ID: DEPLOYMENT_ID, Approved_Configuration_Version: CONFIGURATION_ID,
  }, trigger: [], conditional: previous.Modified_Time }]);
  await selected.client.recordApproval(DEAL_ID, selected.argumentsFor());
  assert.equal(selected.writes.length, 1);
});

test('ambiguous core supersession reconciles committed state but never blindly resends', async () => {
  const committed = supersessionFixture({ outcome: 'after-commit' });
  const result = await committed.client.recordApproval(DEAL_ID, committed.argumentsFor());
  assert.equal(result.Approved_Configuration_Version, CONFIGURATION_ID);
  assert.equal(committed.writes.length, 1);
  for (const outcome of ['before-commit', 'readback-unknown']) {
    const selected = supersessionFixture({ outcome });
    await assert.rejects(selected.client.recordApproval(DEAL_ID, selected.argumentsFor()), (error) => {
      assert.equal(error.code, 'CRM_APPROVAL_RECONCILIATION_REQUIRED');
      assert.equal(error.ambiguous, true);
      assert.doesNotMatch(error.message + JSON.stringify(error), /synthetic private/);
      return true;
    });
    assert.equal(selected.writes.length, 1);
  }
});

test('core supersession rejects missing/mismatched proof and changed target or stopped state before write', async () => {
  for (const patch of [
    { priorCoreApproval: undefined }, { priorCoreApproval: {} },
    { priorCoreApproval: { configurationVersionId: 'wrong', approvedAt: '2026-08-29T12:05:00.000Z' } },
    { priorCoreApproval: { configurationVersionId: 'form2cfgv1:7000000000001:' + 'a'.repeat(40),
      approvedAt: '2026-08-29T12:04:00.000Z' } },
    { deploymentId: 'another_deployment' },
  ]) {
    const selected = supersessionFixture();
    await assert.rejects(selected.client.recordApproval(DEAL_ID, { ...selected.argumentsFor(), ...patch }),
      { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
    assert.equal(selected.writes.length, 0);
  }
  for (const patch of [{ Approved_Deployment_Record_ID: 'other_deployment' },
    { Test_Start_At: ACTIVATED_AT }, { Test_End_At: ACTIVATED_AT },
    { Test_End_Reason: 'Other' }, { Rollback_Completed_At: ACTIVATED_AT },
    { Billing_Subscription_ID: 'synthetic_subscription' }]) {
    const selected = supersessionFixture();
    Object.assign(selected.state, patch);
    await assert.rejects(selected.client.recordApproval(DEAL_ID, selected.argumentsFor()),
      { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
    assert.equal(selected.writes.length, 0);
  }
});

test('core supersession rejects source drift before commit and unrelated drift after commit', async () => {
  const before = supersessionFixture();
  const command = before.argumentsFor();
  before.state.Alert_Recipient_Email = 'different-synthetic@example.invalid';
  await assert.rejects(before.client.recordApproval(DEAL_ID, command),
    { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
  assert.equal(before.writes.length, 0);
  const after = supersessionFixture({ afterCommit(state) {
    state.Contact_Name = { id: '400000004', name: 'Different synthetic contact' };
  } });
  await assert.rejects(after.client.recordApproval(DEAL_ID, after.argumentsFor()),
    { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
  assert.equal(after.writes.length, 1);
});

test('preparation projects only approved source fields and canonical lookup IDs across bounded reads', async () => {
  const deal = scheduledDeal(); deal.$editable = true; deal.private_unselected = 'must-not-return';
  const requests = [];
  const client = createCrmControlClient({ crmApiBaseUrl: 'https://www.zohoapis.com/crm/v8',
    platformTimeoutMs: 3000, crmOrganizationId: SYNTHETIC_ORGANIZATION_ID }, {
    readAuthorization: async () => 'Zoho-oauthtoken synthetic-read',
    writeAuthorization: async () => { throw new Error('No write credential may be used'); },
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET'); const parsed = new URL(url); requests.push(parsed);
      if (parsed.pathname.endsWith('/org')) return response(200, { org: [{ zgid: SYNTHETIC_ORGANIZATION_ID }] });
      const fields = parsed.searchParams.get('fields').split(','); assert.ok(fields.length <= 50);
      if (parsed.pathname.endsWith(`/Deals/${DEAL_ID}`)) return response(200, { data: [deal] });
      if (parsed.pathname.endsWith('/Accounts/400000002')) return response(200, { data: [{
        id: '400000002', Modified_Time: deal.Modified_Time, Account_Name: 'Synthetic Company',
        Phone: '+19135550101', $editable: true, private_unselected: 'must-not-return' }] });
      if (parsed.pathname.endsWith('/Contacts/400000003')) return response(200, { data: [{
        id: '400000003', Modified_Time: deal.Modified_Time, Account_Name: { id: '400000002', name: 'ignored label' },
        Email: 'unselected@example.invalid' }] });
      throw new Error('Unexpected source projection');
    },
  });
  const first = await client.getPreparationRecords(DEAL_ID);
  deal.$editable = false;
  const second = await client.getPreparationRecords(DEAL_ID);
  assert.deepEqual(first, second);
  assert.deepEqual(first.deal.Account_Name, { id: '400000002' });
  assert.deepEqual(first.contact.Account_Name, { id: '400000002' });
  assert.equal(first.account.Account_Name, 'Synthetic Company');
  assert.equal(first.deal.Monthly_Inbound_Calls, null);
  assert.doesNotMatch(JSON.stringify(first), /must-not-return|\$editable|unselected@example/);
  assert.ok(requests.filter((url) => url.pathname.includes('/Deals/')).length === 4);
});

test('fresh and core-approved staging use one conditional no-workflow link write, retaining prior evidence', async () => {
  for (const prior of [false, true]) {
    const f = fixture('committed');
    Object.assign(f.state, { Stage: prior ? 'Setup and QA' : 'Setup and Authorization',
      Test_Status: prior ? 'Scheduled' : 'Not Started', Deployment_Record_ID: null,
      Approved_Deployment_Record_ID: null, Approved_Configuration_Version: prior ? 'form2_label' : null,
      Go_Live_Approval_Status: prior ? 'Approved' : 'Not Ready',
      Go_Live_Approved_At: prior ? '2026-08-29T12:00:00.000Z' : null });
    const before = structuredClone(f.state);
    const priorApproval = prior ? { configurationVersionId: 'form2_label', approvedAt: before.Go_Live_Approved_At } : null;
    const result = await f.client.recordConfigurationStaging(DEAL_ID, {
      deploymentId: DEPLOYMENT_ID, expectedDeal: before, priorApproval });
    assert.equal(result.Deployment_Record_ID, DEPLOYMENT_ID);
    assert.equal(result.Approved_Configuration_Version, before.Approved_Configuration_Version);
    assert.equal(result.Go_Live_Approved_At, before.Go_Live_Approved_At);
    assert.equal(result.Test_Start_At, null); assert.equal(result.Test_End_At, null);
    assert.equal(f.writes.length, 1); assert.deepEqual(f.writes[0].trigger, []);
    assert.equal(f.requests.some((r) => r.pathname.includes('blueprint')), false);
    await f.client.recordConfigurationStaging(DEAL_ID, { deploymentId: DEPLOYMENT_ID,
      expectedDeal: result, priorApproval });
    assert.equal(f.writes.length, 1);
  }
});

function freshStagedApprovalFixture(options) {
  const f = supersessionFixture(options);
  Object.assign(f.state, { Test_Status: 'Setup Pending', Go_Live_Approval_Status: 'Not Ready',
    Go_Live_Approved_At: null, Approved_Configuration_Version: null });
  return { ...f, argumentsFor: () => ({ ...f.argumentsFor(), priorCoreApproval: null }) };
}

test('fresh staged internal approval is conditional and replay-safe without the deferred Blueprint', async () => {
  const f = freshStagedApprovalFixture(); const before = structuredClone(f.state);
  const result = await f.client.recordApproval(DEAL_ID, f.argumentsFor());
  assert.equal(result.Stage, 'Setup and QA'); assert.equal(result.Test_Status, 'Scheduled');
  assert.equal(result.Approved_Configuration_Version, CONFIGURATION_ID);
  assert.equal(result.Configuration_Version, before.Configuration_Version);
  assert.equal(result.Approved_Deployment_Record_ID, DEPLOYMENT_ID);
  assert.equal(result.Test_Start_At, null); assert.equal(result.Test_End_At, null);
  assert.deepEqual(f.writes, [{ patch: { Test_Status: 'Scheduled', Go_Live_Approval_Status: 'Approved',
    Go_Live_Approved_At: '2026-08-29T12:15:00+00:00', Approved_Deployment_Record_ID: DEPLOYMENT_ID,
    Approved_Configuration_Version: CONFIGURATION_ID }, trigger: [], conditional: before.Modified_Time }]);
  await f.client.recordApproval(DEAL_ID, f.argumentsFor());
  assert.equal(f.writes.length, 1);
  assert.equal(f.requests.some(({ pathname }) => pathname.includes('blueprint')), false);
});

test('fresh staged ambiguous approval reconciles once and never repeats a mutation', async () => {
  const committed = freshStagedApprovalFixture({ outcome: 'after-commit' });
  assert.equal((await committed.client.recordApproval(DEAL_ID, committed.argumentsFor())).Test_Status, 'Scheduled');
  assert.equal(committed.writes.length, 1);
  for (const outcome of ['before-commit', 'readback-unknown']) {
    const f = freshStagedApprovalFixture({ outcome });
    await assert.rejects(f.client.recordApproval(DEAL_ID, f.argumentsFor()),
      { code: 'CRM_APPROVAL_RECONCILIATION_REQUIRED', ambiguous: true });
    assert.equal(f.writes.length, 1);
  }
});

test('fresh staged native approval requires trusted staging and exact inactive source and readback', async () => {
  for (const patch of [{ Test_Status: 'Scheduled' }, { Go_Live_Approval_Status: 'Approved' },
    { Go_Live_Approved_At: ACTIVATED_AT }, { Approved_Deployment_Record_ID: 'other_deployment' },
    { Approved_Configuration_Version: 'other_configuration' }, { Deployment_Record_ID: 'wrong_deployment' },
    { Test_Start_At: ACTIVATED_AT }, { Test_End_Reason: 'Other' },
    { Billing_Subscription_ID: 'synthetic_subscription' }]) {
    const f = freshStagedApprovalFixture(); Object.assign(f.state, patch);
    await assert.rejects(f.client.recordApproval(DEAL_ID, f.argumentsFor()),
      { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
    assert.equal(f.writes.length, 0);
  }
  const withoutProof = supersessionFixture();
  await assert.rejects(withoutProof.client.recordApproval(DEAL_ID,
    { ...withoutProof.argumentsFor(), configurationStaged: false }),
  { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
  assert.equal(withoutProof.writes.length, 0);
  const after = freshStagedApprovalFixture({ afterCommit(state) {
    state.Contact_Name = { id: '400000004' };
  } });
  await assert.rejects(after.client.recordApproval(DEAL_ID, after.argumentsFor()),
    { code: 'CRM_TRANSITION_PRECONDITION_FAILED' });
  assert.equal(after.writes.length, 1);
});
