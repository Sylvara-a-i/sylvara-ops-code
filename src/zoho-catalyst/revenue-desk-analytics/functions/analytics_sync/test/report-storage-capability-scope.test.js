'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  validateStorageCapability, getIssuedCapabilityScope,
  REPORT_FIELDS, RECEIPT_FIELDS, projectionDigest,
} = require('../lib/report-storage-capability');

const held = { code: 'REPORT_STORAGE_QUALIFICATION_HELD' };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function fixture() {
  const now = 1800000000000;
  const config = { environment: 'development', projectId: '123456789' };
  const environment = {
    DEPLOYMENT_ENVIRONMENT: 'development',
    REPORT_CONTROLLER_FUNCTION_ID: '123456786',
    REPORT_DEPLOYMENT_ID: 'synthetic_controller',
    X_ZOHO_CATALYST_ORG_ID: '123456785',
  };
  const app = {
    config: { projectId: config.projectId, environment: 'Development' },
    credential: {
      getCurrentUser: () => 'user',
      getCurrentUserType: () => 'admin',
      switchUser() { assert.fail('Issuing a scope must not switch credentials'); },
      getToken() { assert.fail('Issuing a scope must not acquire credentials'); },
    },
    authenticateRequest() { assert.fail('Issuing a scope must not authenticate a request'); },
  };
  const capability = {
    region: 'US', origin: 'https://api.catalyst.zoho.com',
    controllerFunctionId: environment.REPORT_CONTROLLER_FUNCTION_ID,
    deploymentId: environment.REPORT_DEPLOYMENT_ID, sdkVersion: '3.4.0',
    authMode: 'user', authType: 'admin', creatorPolicy: 'observed_consistent_v1',
    tables: {
      reportRuns: {
        id: '123456788', name: 'ReportRuns', uniqueField: 'IdempotencyKey',
        schemaSha256: sha('synthetic-schema-runs'), uniquenessSha256: sha('synthetic-unique-runs'),
        projectionSha256: projectionDigest(REPORT_FIELDS),
      },
      eventReceipts: {
        id: '123456787', name: 'RevenueDeskEventReceipts', uniqueField: 'EVENT_KEY',
        schemaSha256: sha('synthetic-schema-receipts'), uniquenessSha256: sha('synthetic-unique-receipts'),
        projectionSha256: projectionDigest(RECEIPT_FIELDS),
      },
    },
    evidence: Object.fromEntries(['ownerAuthorization', 'ownership', 'access'].map(kind => [kind, {
      digest: sha(`synthetic-${kind}`), verifiedAt: now - 2, expiresAt: now + 60000,
    }])),
  };
  const options = { app, config, environment, now, verifiedAt: now - 1, expiresAt: now + 60000 };
  return { capability, app, config, environment, issue: () => validateStorageCapability(capability, options) };
}

test('real issuer captures a frozen project, organization and Controller scope for the exact app', () => {
  const f = fixture();
  const issued = f.issue();
  const scope = getIssuedCapabilityScope(issued, f.app);
  assert.deepEqual(scope, {
    projectId: '123456789', controllerFunctionId: '123456786', organizationId: '123456785',
  });
  assert.equal(Object.isFrozen(scope), true);
  assert.equal(Object.isFrozen(issued), true);
  assert.equal(Object.isFrozen(issued.tables.reportRuns), true);
  assert.notStrictEqual(issued, f.capability);
  assert.strictEqual(getIssuedCapabilityScope(issued, f.app), scope);
  assert.throws(() => { scope.projectId = '123456780'; }, TypeError);
  assert.throws(() => { scope.organizationId = '123456780'; }, TypeError);
  assert.throws(() => { scope.controllerFunctionId = '123456780'; }, TypeError);
});

test('arbitrary, source, cloned and inherited capabilities do not acquire an issued scope', () => {
  const f = fixture();
  const issued = f.issue();
  for (const unissued of [undefined, null, {}, f.capability, structuredClone(issued),
    Object.freeze({ ...issued }), Object.create(issued)]) {
    assert.throws(() => getIssuedCapabilityScope(unissued, f.app), held);
  }
});

test('a second app cannot reuse an issued capability even with identical config and credentials', () => {
  const f = fixture();
  const issued = f.issue();
  const sameConfigurationApp = { ...f.app };
  assert.strictEqual(sameConfigurationApp.config, f.app.config);
  assert.strictEqual(sameConfigurationApp.credential, f.app.credential);
  assert.throws(() => getIssuedCapabilityScope(issued, sameConfigurationApp), held);
  assert.throws(() => getIssuedCapabilityScope(issued), held);
  assert.throws(() => getIssuedCapabilityScope(issued, null), held);
  assert.equal(getIssuedCapabilityScope(issued, f.app).projectId, f.config.projectId);
});

test('project mismatch and malformed or mismatched Controller identity cannot issue a scope', () => {
  const changes = [
    f => { f.app.config.projectId = '123456780'; },
    f => { delete f.app.config.projectId; },
    f => { f.config.projectId = '123456780'; },
    f => { delete f.config.projectId; },
    f => { f.capability.controllerFunctionId = '123456780'; },
    f => { delete f.environment.REPORT_CONTROLLER_FUNCTION_ID; },
  ];
  for (const invalid of ['', '0', '12', '0123456789', 'synthetic-controller', '1'.repeat(31)]) {
    changes.push(f => {
      f.capability.controllerFunctionId = invalid;
      f.environment.REPORT_CONTROLLER_FUNCTION_ID = invalid;
    });
  }
  for (const mutate of changes) {
    const f = fixture();
    mutate(f);
    assert.throws(() => f.issue(), held);
    assert.throws(() => getIssuedCapabilityScope(f.capability, f.app), held);
  }
});

test('later input mutations and another issuance cannot rewrite a captured scope', () => {
  const f = fixture();
  const issued = f.issue();
  const originalScope = getIssuedCapabilityScope(issued, f.app);
  f.app.config.projectId = f.config.projectId = '123456780';
  f.capability.controllerFunctionId = f.environment.REPORT_CONTROLLER_FUNCTION_ID = '123456781';
  f.environment.X_ZOHO_CATALYST_ORG_ID = '123456782';
  f.capability.tables.reportRuns.schemaSha256 = sha('different-synthetic-schema');
  const later = f.issue();
  assert.deepEqual(getIssuedCapabilityScope(later, f.app), {
    projectId: '123456780', controllerFunctionId: '123456781', organizationId: '123456782',
  });
  assert.strictEqual(getIssuedCapabilityScope(issued, f.app), originalScope);
  assert.deepEqual(originalScope, {
    projectId: '123456789', controllerFunctionId: '123456786', organizationId: '123456785',
  });
  assert.equal(issued.controllerFunctionId, '123456786');
  assert.equal(issued.tables.reportRuns.schemaSha256, sha('synthetic-schema-runs'));
  assert.throws(() => { issued.controllerFunctionId = '123456781'; }, TypeError);
});

test('missing organization remains absent in the captured scope without fallback or later filling', () => {
  const f = fixture();
  delete f.environment.X_ZOHO_CATALYST_ORG_ID;
  // The issuer records protected inputs; physical admission separately requires
  // valid IDs. Issuance must not invent organization authority from another ID.
  const issued = f.issue();
  const scope = getIssuedCapabilityScope(issued, f.app);
  assert.equal(Object.hasOwn(scope, 'organizationId'), true);
  assert.equal(scope.organizationId, undefined);
  assert.equal(Object.isFrozen(scope), true);
  f.environment.X_ZOHO_CATALYST_ORG_ID = '123456785';
  assert.strictEqual(getIssuedCapabilityScope(issued, f.app), scope);
  assert.equal(scope.organizationId, undefined);
});
