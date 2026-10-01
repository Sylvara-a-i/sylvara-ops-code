'use strict';

const assert = require('node:assert/strict');
const { canonicalJson } = require('../../lib/facts');

/** Synthetic-only durable state/provider fixture, shared with isolated packaging tests. */
function createWorkDriveDraftFixture(prepared, { now = Date.now() } = {}) {
  const clock = { value: now };
  const rows = new Map();
  const resources = new Map();
  const uploads = [];
  let sequence = 0;
  const clone = value => value === null ? null : structuredClone(value);
  const binding = { scope: prepared.scope, environment: 'development', company: 'Sylvara',
    clientId: 'client_A', deploymentId: 'deployment_A',
    parentId: 'synthetic_client_folder', parentParentId: 'synthetic_clients_parent',
    organizationId: 'synthetic_org', teamFolderId: 'synthetic_team_folder', writerId: 'synthetic_writer',
    accessApprovalDigest: 'a'.repeat(64), retentionApprovalDigest: 'b'.repeat(64),
    contractQualificationDigest: 'c'.repeat(64), externalSharing: false, ownerReviewRequired: true,
    verifiedAt: now, expiresAt: now + 3600000 };
  const runs = {
    async get(key, options = {}) { options.budget?.consume('report_run_read'); return clone(rows.get(key) || null); },
    async insert(key, state, options = {}) {
      options.budget?.consume('report_run_write');
      if (!rows.has(key)) rows.set(key, { key, rowId: String(++sequence), version: 1, state: clone(state) });
      return this.get(key, options);
    },
    async compareAndSwap(current, state, options = {}) {
      options.budget?.consume('report_run_write');
      const row = rows.get(current.key);
      if (!row || row.version !== current.version) return null;
      const next = { ...row, version: row.version + 1, state: clone(state) };
      rows.set(current.key, next);
      return this.get(current.key, options);
    },
  };
  const parent = { id: binding.parentId, parentId: binding.parentParentId, name: 'Synthetic reports',
    organizationId: binding.organizationId, teamFolderId: binding.teamFolderId, isFolder: true, sizeBytes: 0 };
  const workdrive = {
    async getMetadata(id, options = {}) {
      options.budget?.consume('workdrive_read');
      return clone(id === parent.id ? parent : resources.get(id)?.metadata);
    },
    async listChildren(id, options = {}) {
      options.budget?.consume('workdrive_read');
      assert.equal(id, parent.id);
      return [...resources.values()].map(item => clone(item.metadata));
    },
    async listVersions(id, options = {}) {
      options.budget?.consume('workdrive_read');
      return clone(resources.get(id).versions);
    },
    async downloadVersion(id, selector, options = {}) {
      options.budget?.consume('workdrive_read');
      assert.equal(canonicalJson(selector), canonicalJson({ versionId: 'synthetic_version_1', versionNumber: '1' }));
      return Buffer.from(resources.get(id).bytes);
    },
    async upload({ parentId, filename, bytes }, options = {}) {
      options.budget?.consume('workdrive_write');
      uploads.push({ parentId, filename, documentSha256: prepared.documentSha256 });
      const id = `synthetic_resource_${uploads.length}`;
      resources.set(id, { bytes: Buffer.from(bytes), metadata: {
        id, parentId, name: filename, organizationId: binding.organizationId,
        teamFolderId: binding.teamFolderId, isFolder: false, sizeBytes: bytes.length },
      versions: [{ resourceId: id, versionId: 'synthetic_version_1', versionNumber: '1', sizeBytes: bytes.length }] });
      return { status: 'upload_response_requires_readback' };
    },
  };
  return { runs, workdrive, rows, resources, uploads, clock, binding, parent,
    now: () => clock.value, readDestinationBinding: async () => clone(binding) };
}

module.exports = { createWorkDriveDraftFixture };
