'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCrmControlClient } = require('../lib/crm-client');

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
    requests.push({ method: options.method, pathname: parsed.pathname });
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
