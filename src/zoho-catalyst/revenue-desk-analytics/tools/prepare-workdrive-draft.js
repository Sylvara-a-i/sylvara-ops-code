'use strict';

const crypto = require('node:crypto');
const { canonicalJson } = require('../functions/analytics_sync/lib/facts');
const { isPreparedFreeTestDocument, MAX_DOCUMENT_BYTES, REVIEW_STATE, pdfDocumentIdentity, preparePdfFromSource } = require('./prepare-free-test-draft');
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
function fail() { throw Object.assign(new Error('WORKDRIVE_DRAFT_RECONCILIATION_REQUIRED'),
  { code: 'WORKDRIVE_DRAFT_RECONCILIATION_REQUIRED' }); }
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

/** Durable, immutable generation on WorkDrive using the existing ReportRuns index.
 * A filename is never a lock. A unique durable intent and CAS fence authorize ONE
 * upload dispatch. Once marked upload_started, even a missing object after timeout
 * cannot authorize a second upload: a late provider effect may still arrive.
 * Reconciliation may recover an exact version/receipt; it never overwrites,
 * shares, sends, deletes or treats cancellation as remote rollback.
 */
function createWorkDriveDraftWriter({ reportRunStore: runs, workdrive, readDestinationBinding,
  now = Date.now, ownerId = crypto.randomUUID, leaseMs = 120000 } = {}) {
  if (!runs || !workdrive || typeof readDestinationBinding !== 'function'
    || typeof now !== 'function' || typeof ownerId !== 'function'
    || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) fail();

  const write = async function prepareWorkDriveDraft(prepared, options = {}) {
    try {
      const active = () => { options.budget?.assertActive(); if (options.signal?.aborted) fail(); };
      active();
      if (!isPreparedFreeTestDocument(prepared)) fail();
      // Buffers cannot be frozen: take a private copy and verify its immutable hash.
      const bytes = Buffer.from(prepared.document);
      if (bytes.length < 1 || bytes.length > MAX_DOCUMENT_BYTES
        || sha256(bytes) !== prepared.documentSha256 || !HASH.test(prepared.generationKey)) fail();
      const binding = structuredClone(await readDestinationBinding(prepared.scope, options));
      active();
      if (!binding || !same(binding.scope, prepared.scope)
        || binding.environment !== 'development' || binding.company !== 'Sylvara'
        || !['parentId', 'parentParentId', 'organizationId', 'teamFolderId', 'writerId'].every(k => ID.test(binding[k]))
        || !['clientId', 'deploymentId'].every(k => /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(binding[k]))
        || !HASH.test(binding.accessApprovalDigest) || !HASH.test(binding.retentionApprovalDigest)
        || !HASH.test(binding.contractQualificationDigest)
        || binding.externalSharing !== false || binding.ownerReviewRequired !== true
        || !Number.isSafeInteger(binding.verifiedAt) || binding.verifiedAt > now()
        || !Number.isSafeInteger(binding.expiresAt) || binding.expiresAt <= now()) fail();
      // The private binding resolver authenticates company/CRM ownership, access,
      // retention and Connection identity. Resource metadata independently guards
      // the selected exact parent; a folder's friendly name is not that evidence.
      async function checkDestination() {
        active();
        const current = await readDestinationBinding(prepared.scope, options);
        active();
        if (!same(current, binding) || binding.expiresAt <= now()) fail();
        const meta = await workdrive.getMetadata(binding.parentId, options);
        active();
        if (!meta?.isFolder || meta.id !== binding.parentId || meta.parentId !== binding.parentParentId
          || meta.organizationId !== binding.organizationId || meta.teamFolderId !== binding.teamFolderId) fail();
      }
      await checkDestination();
      const filename = `free-test-${prepared.generationKey}.${prepared.format === 'pdf' ? 'pdf' : 'html'}`;
      const identity = { generationKey: prepared.generationKey, documentSha256: prepared.documentSha256,
        // Preserve historical HTML identity bytes; only new PDF records add format.
        ...(prepared.format === 'pdf' ? { format: 'pdf', sourceGenerationKey: prepared.sourceGenerationKey,
          rendererQualificationDigest: prepared.rendererQualificationDigest } : {}),
        clientId: binding.clientId, deploymentId: binding.deploymentId,
        periodStart: prepared.periodStart, periodEnd: prepared.periodEnd,
        byteLength: bytes.length, rendererVersion: prepared.rendererVersion, scope: prepared.scope,
        parentId: binding.parentId, organizationId: binding.organizationId, teamFolderId: binding.teamFolderId,
        writerId: binding.writerId, accessApprovalDigest: binding.accessApprovalDigest,
        retentionApprovalDigest: binding.retentionApprovalDigest,
        contractQualificationDigest: binding.contractQualificationDigest,
        filename };
      const key = sha256(`workdrive-draft-v1\0${prepared.generationKey}`);
      let row = await runs.get(key, options);
      active();
      let mine = false;
      const owner = ownerId();
      if (!ID.test(owner)) fail();
      if (!row) {
        const state = { kind: 'workdrive_draft_v1', identity, phase: 'intent', owner,
          leaseUntil: now() + leaseMs, receipt: null };
        row = await runs.insert(key, state, options);
        active();
        mine = Boolean(row && same(row.state, state));
      }
      if (!row || row.state.kind !== 'workdrive_draft_v1' || !same(row.state.identity, identity)
        || !['intent', 'upload_started', 'verified'].includes(row.state.phase)) fail();
      if (row.state.phase === 'intent' && !mine) {
        if (!Number.isSafeInteger(row.state.leaseUntil) || row.state.leaseUntil > now()) fail();
        row = await runs.compareAndSwap(row, { ...row.state, owner, leaseUntil: now() + leaseMs }, options);
        active();
        if (!row) fail();
        mine = true;
      }

      async function candidates() {
        const children = await workdrive.listChildren(binding.parentId, options);
        active();
        if (!Array.isArray(children)) fail();
        // Reject timestamp-renamed collision results too. The qualified adapter
        // returns the COMPLETE bounded partition, never a first page only.
        const matching = children.filter(item => item.name?.startsWith(`free-test-${prepared.generationKey}`));
        if (matching.length > 1 || matching.some(item => item.name !== filename || item.isFolder)) fail();
        return matching;
      }
      if (row.state.phase === 'intent') {
        if (!mine || (await candidates()).length) fail();
        await checkDestination();
        row = await runs.compareAndSwap(row, { ...row.state, phase: 'upload_started' }, options);
        active();
        if (!row || row.state.owner !== owner) fail();
        // Persisted before dispatch. No catch path can reset this phase or upload
        // again; a cancelled/failed request may still finish remotely.
        await workdrive.upload({ parentId: binding.parentId, filename, bytes }, options);
        active();
      }

      await checkDestination();
      let receipt = row.state.receipt;
      const matches = await candidates();
      if (matches.length !== 1) fail();
      const candidate = await workdrive.getMetadata(matches[0].id, options);
      active();
      if (candidate.id !== matches[0].id || candidate.name !== filename || candidate.isFolder) fail();
      if (candidate.parentId !== binding.parentId || candidate.organizationId !== binding.organizationId
        || candidate.teamFolderId !== binding.teamFolderId || candidate.sizeBytes !== bytes.length) fail();
      const versions = await workdrive.listVersions(candidate.id, options);
      active();
      if (!Array.isArray(versions) || !versions.length) fail();
      let version;
      if (row.state.phase === 'verified') {
        if (!receipt || receipt.resourceId !== candidate.id || receipt.status !== REVIEW_STATE
          || receipt.documentSha256 !== prepared.documentSha256) fail();
        const selected = versions.filter(item => item.versionId === receipt.versionId
          && item.versionNumber === receipt.versionNumber);
        if (selected.length !== 1) fail();
        [version] = selected;
      } else {
        // An unreceipted resource with multiple versions is not ours to adopt.
        if (versions.length !== 1) fail();
        [version] = versions;
      }
      if (version.resourceId !== candidate.id || !ID.test(version.versionId)
        || typeof version.versionNumber !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(version.versionNumber)
        || version.sizeBytes !== bytes.length) fail();
      const downloaded = await workdrive.downloadVersion(candidate.id,
        { versionId: version.versionId, versionNumber: version.versionNumber }, options);
      active();
      if (!Buffer.isBuffer(downloaded) || downloaded.length !== bytes.length
        || sha256(downloaded) !== prepared.documentSha256) fail();
      await checkDestination();
      const after = await workdrive.getMetadata(candidate.id, options);
      active();
      if (!same(after, candidate)) fail();
      const nextReceipt = { resourceId: candidate.id, versionId: version.versionId,
        versionNumber: version.versionNumber, documentSha256: prepared.documentSha256,
        parentId: binding.parentId, status: REVIEW_STATE };
      if (receipt && !same(receipt, nextReceipt)) fail();
      if (row.state.phase !== 'verified') {
        const saved = await runs.compareAndSwap(row, { ...row.state, phase: 'verified', receipt: nextReceipt }, options);
        active();
        // Concurrent reconciliation may finish the same receipt. Independent
        // readback accepts exact equality, never an unrelated winning state.
        row = saved || await runs.get(key, options);
      }
      active();
      const final = await runs.get(key, options);
      active();
      if (!final || final.state.phase !== 'verified' || !same(final.state.identity, identity)
        || !same(final.state.receipt, nextReceipt)) fail();
      return Object.freeze({ status: mine ? 'draft_created_not_for_delivery' : 'existing_draft_verified_not_for_delivery',
        generationKey: prepared.generationKey, documentSha256: prepared.documentSha256,
        receiptSha256: sha256(canonicalJson(nextReceipt)) });
    } catch { fail(); }
  };
  // Read an already accepted (or independently recoverable) exact version.
  // The same writer below rechecks all ownership/access/retention and content
  // fences. This never calls the renderer or dispatches another upload.
  async function readExistingPdf(source, renderer, options = {}) {
    try {
      const active = () => { options.budget?.assertActive(); if (options.signal?.aborted) fail(); };
      active();
      const expected = pdfDocumentIdentity(source, renderer);
      const key = sha256(`workdrive-draft-v1\0${expected.generationKey}`);
      const row = await runs.get(key, options);
      active();
      if (!row) return null;
      const identity = row.state.identity;
      if (row.state.kind !== 'workdrive_draft_v1'
        || !['upload_started', 'verified'].includes(row.state.phase)
        || !identity || identity.format !== 'pdf'
        || !same(identity.scope, source.scope)
        || !Object.entries(expected).every(([k, v]) => identity[k] === v)
        || !HASH.test(identity.documentSha256)
        || !Number.isSafeInteger(identity.byteLength) || identity.byteLength < 16
        || identity.byteLength > MAX_DOCUMENT_BYTES
        || identity.periodStart !== source.periodStart || identity.periodEnd !== source.periodEnd) fail();
      const binding = await readDestinationBinding(source.scope, options);
      active();
      // Check the complete accepted binding BEFORE private content retrieval.
      if (!binding || !same(binding.scope, source.scope) || binding.environment !== 'development'
        || binding.company !== 'Sylvara' || binding.externalSharing !== false
        || binding.ownerReviewRequired !== true || !Number.isSafeInteger(binding.verifiedAt)
        || binding.verifiedAt > now() || !Number.isSafeInteger(binding.expiresAt) || binding.expiresAt <= now()
        || !['parentId','parentParentId','organizationId','teamFolderId','writerId'].every(k => ID.test(binding[k]))
        || !['clientId','deploymentId','parentId','organizationId','teamFolderId','writerId',
          'accessApprovalDigest','retentionApprovalDigest','contractQualificationDigest'].every(k => binding[k] === identity[k])
        || !['accessApprovalDigest','retentionApprovalDigest','contractQualificationDigest'].every(k => HASH.test(binding[k]))) fail();
      const parent = await workdrive.getMetadata(binding.parentId, options);
      active();
      if (!parent?.isFolder || parent.id !== binding.parentId || parent.parentId !== binding.parentParentId
        || parent.organizationId !== binding.organizationId || parent.teamFolderId !== binding.teamFolderId) fail();
      const filename = `free-test-${expected.generationKey}.pdf`;
      if (identity.filename !== filename) fail();
      const children = await workdrive.listChildren(binding.parentId, options);
      active();
      if (!Array.isArray(children)) fail();
      const matches = children.filter(x => x.name?.startsWith(`free-test-${expected.generationKey}`));
      if (matches.length !== 1 || matches[0].name !== filename || matches[0].isFolder) fail();
      const candidate = await workdrive.getMetadata(matches[0].id, options);
      active();
      if (!candidate || candidate.id !== matches[0].id || candidate.name !== filename || candidate.isFolder
        || candidate.parentId !== binding.parentId || candidate.organizationId !== binding.organizationId
        || candidate.teamFolderId !== binding.teamFolderId || candidate.sizeBytes !== identity.byteLength) fail();
      const versions = await workdrive.listVersions(candidate.id, options);
      active();
      if (!Array.isArray(versions) || !versions.length) fail();
      const receipt = row.state.receipt;
      const selected = row.state.phase === 'verified'
        ? versions.filter(v => receipt && v.versionId === receipt.versionId && v.versionNumber === receipt.versionNumber)
        : versions;
      if (selected.length !== 1) fail();
      const version = selected[0];
      if (!ID.test(version.versionId) || typeof version.versionNumber !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(version.versionNumber)
        || version.resourceId !== candidate.id || version.sizeBytes !== identity.byteLength
        || (row.state.phase === 'verified' && (receipt.resourceId !== candidate.id
          || receipt.documentSha256 !== identity.documentSha256 || receipt.parentId !== binding.parentId
          || receipt.status !== REVIEW_STATE))) fail();
      const bytes = await workdrive.downloadVersion(candidate.id,
        { versionId: version.versionId, versionNumber: version.versionNumber }, options);
      active();
      if (!Buffer.isBuffer(bytes) || bytes.length !== identity.byteLength || sha256(bytes) !== identity.documentSha256) fail();
      const document = preparePdfFromSource(source, renderer, bytes);
      const result = await write(document, options);
      active();
      return Object.freeze({ document, result });
    } catch { fail(); }
  }
  Object.defineProperty(write, 'readExistingPdf', { value: readExistingPdf });
  return Object.freeze(write);
}

module.exports = { createWorkDriveDraftWriter };
