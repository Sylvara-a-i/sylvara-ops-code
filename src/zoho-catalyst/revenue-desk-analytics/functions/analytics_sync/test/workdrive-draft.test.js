'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { prepareFreeTestDocument } = require('../../../tools/prepare-free-test-draft');
const { createWorkDriveDraftWriter } = require('../../../tools/prepare-workdrive-draft');
const { privateCallLedgerFixture } = require('./helpers/private-call-ledger-fixture');
const { createWorkDriveDraftFixture } = require('./helpers/workdrive-draft-fixture');
test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });
const rejected = { code: 'WORKDRIVE_DRAFT_RECONCILIATION_REQUIRED' };

async function fixture() {
  const p = await privateCallLedgerFixture();
  const prepared = prepareFreeTestDocument(p.input, { now: p.now, synthetic: true, callDetails: p.snapshot });
  const f = createWorkDriveDraftFixture(prepared, { now: p.now });
  return { ...f, prepared, write: () => createWorkDriveDraftWriter({ reportRunStore: f.runs,
    workdrive: f.workdrive, readDestinationBinding: f.readDestinationBinding, now: f.now }) };
}

test('one durable claim creates one exact version and owner-review receipt; repeat reuses it', async () => {
  const f = await fixture();
  assert.equal((await f.write()(f.prepared)).status, 'draft_created_not_for_delivery');
  assert.equal((await f.write()(f.prepared)).status, 'existing_draft_verified_not_for_delivery');
  assert.equal(f.uploads.length, 1);
  const [row] = f.rows.values();
  assert.equal(row.state.receipt.status, 'draft_generated_owner_review_required_delivery_not_authorized');
  assert.equal(row.state.receipt.versionId, 'synthetic_version_1');
  assert.ok(!JSON.stringify(row).includes('Synthetic leaking'));
});

test('adapter-supported dotted version selector is preserved through download and exact repeat', async () => {
  const f = await fixture();
  const upload = f.workdrive.upload;
  f.workdrive.upload = async function (...args) {
    await upload.apply(this, args);
    [...f.resources.values()][0].versions[0].versionNumber = '1.0';
  };
  const selectors = [];
  f.workdrive.downloadVersion = async function (resourceId, selector) {
    selectors.push(selector);
    return Buffer.from(f.resources.get(resourceId).bytes);
  };
  await f.write()(f.prepared);
  await f.write()(f.prepared);
  assert.deepEqual(selectors, Array.from({ length: 2 }, () => ({
    versionId: 'synthetic_version_1', versionNumber: '1.0' })));
  assert.equal([...f.rows.values()][0].state.receipt.versionNumber, '1.0');
  assert.equal(f.uploads.length, 1);
});

test('concurrent generation attempts dispatch at most one upload', async () => {
  const f = await fixture();
  const results = await Promise.allSettled([f.write()(f.prepared), f.write()(f.prepared)]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  assert.equal(f.uploads.length, 1);
  assert.equal((await f.write()(f.prepared)).status, 'existing_draft_verified_not_for_delivery');
});

test('a timed-out completed upload is recovered by exact resource/version bytes without another POST', async () => {
  const f = await fixture();
  const upload = f.workdrive.upload;
  f.workdrive.upload = async function (...args) { await upload.apply(this, args); throw new Error('private response'); };
  await assert.rejects(f.write()(f.prepared), rejected);
  assert.equal((await f.write()(f.prepared)).status, 'existing_draft_verified_not_for_delivery');
  assert.equal(f.uploads.length, 1);
});

test('unknown upload with no currently visible file stays held; expired lease never authorizes re-upload', async () => {
  const f = await fixture();
  f.workdrive.upload = async () => { f.uploads.push({}); throw new Error('timeout'); };
  await assert.rejects(f.write()(f.prepared), rejected);
  f.clock.value += 180000;
  await assert.rejects(f.write()(f.prepared), rejected);
  assert.equal(f.uploads.length, 1);
});

test('cancellation after dispatch preserves intent and reconciles a late remote completion', async () => {
  const f = await fixture();
  const controller = new AbortController();
  const upload = f.workdrive.upload;
  f.workdrive.upload = async function (...args) { controller.abort(); await upload.apply(this, args); };
  await assert.rejects(f.write()(f.prepared, { signal: controller.signal }), rejected);
  assert.equal([...f.rows.values()][0].state.phase, 'upload_started');
  assert.equal((await f.write()(f.prepared)).status, 'existing_draft_verified_not_for_delivery');
  assert.equal(f.uploads.length, 1);
});

test('lost receipt CAS is reconciled by exact independent readback', async () => {
  const f = await fixture();
  const cas = f.runs.compareAndSwap;
  f.runs.compareAndSwap = async function (current, state, options) {
    const result = await cas.call(this, current, state, options);
    return state.phase === 'verified' ? null : result;
  };
  await f.write()(f.prepared);
  assert.equal(f.uploads.length, 1);
  assert.equal([...f.rows.values()][0].state.phase, 'verified');
});

for (const defect of ['wrong-company', 'expired-binding', 'parent-moved', 'preexisting-collision', 'corrupt-bytes', 'extra-version', 'renamed']) {
  test(`${defect} cannot be adopted as a verified private draft`, async () => {
    const f = await fixture();
    if (defect === 'wrong-company') f.binding.company = 'Other';
    if (defect === 'expired-binding') f.binding.expiresAt = f.clock.value;
    if (defect === 'parent-moved') f.parent.parentId = 'other_parent';
    if (defect === 'preexisting-collision') await f.workdrive.upload({ parentId: f.binding.parentId,
      filename: `free-test-${f.prepared.generationKey}.html`, bytes: f.prepared.document });
    if (['corrupt-bytes', 'extra-version', 'renamed'].includes(defect)) {
      const upload = f.workdrive.upload;
      f.workdrive.upload = async function (...args) {
        await upload.apply(this, args);
        const item = [...f.resources.values()][0];
        if (defect === 'corrupt-bytes') item.bytes[0] ^= 1;
        if (defect === 'extra-version') item.versions.push({ ...item.versions[0], versionId: 'second', versionNumber: '2' });
        if (defect === 'renamed') item.metadata.name += '.timestamp';
      };
    }
    await assert.rejects(f.write()(f.prepared), rejected);
    assert.ok([...f.rows.values()].every(row => row.state.phase !== 'verified'));
  });
}

test('serialized document or changed buffer cannot cross the preparation trust boundary', async () => {
  const f = await fixture();
  await assert.rejects(f.write()(structuredClone(f.prepared)), rejected);
  f.prepared.document[0] ^= 1;
  await assert.rejects(f.write()(f.prepared), rejected);
  assert.equal(f.uploads.length, 0);
});
