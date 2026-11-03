'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { loadPostalSnapshot, MAX_SNAPSHOT_BYTES } = require('../lib/postal-index-loader');
const { lookupPostalIndex } = require('../lib/offline-postal-index');
const { serviceAreaDecision } = require('../lib/service-area-tool');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'postal-snapshot-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['contracts', 'data']) fs.mkdirSync(path.join(root, name));
  fs.copyFileSync(path.join(__dirname, '../data/us-postal-fixture.json'), path.join(root, 'data/us-postal-fixture.json'));
  fs.copyFileSync(path.join(__dirname, '../contracts/postal-snapshot.json'), path.join(root, 'contracts/postal-snapshot.json'));
  return root;
}
function writeManifest(root, update) {
  const file = path.join(root, 'contracts/postal-snapshot.json');
  const value = JSON.parse(fs.readFileSync(file)); update(value);
  fs.writeFileSync(file, JSON.stringify(value));
}

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });

test('packaged fixture is reproducible, immutable and denied by the default runtime loader', () => {
  assert.equal(loadPostalSnapshot().sha256, null);
  const snapshot = loadPostalSnapshot({ allowSynthetic: true });
  assert.ok(snapshot.sha256);
  const result = lookupPostalIndex(snapshot.index, { zip5: '00501', asOf: '2026-08-22' });
  assert.equal(result.provenance.source, 'synthetic');
  assert.equal(result.relations[0].zip5, '00501');
  assert.equal(Object.isFrozen(snapshot), true);
});

test('corrupted, missing, oversized or malformed local files do not produce usable indexes', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'data/us-postal-fixture.json');
  fs.appendFileSync(file, 'corruption');
  assert.equal(loadPostalSnapshot({ packageRoot: root, allowSynthetic: true }).sha256, null);
  fs.unlinkSync(file);
  assert.equal(loadPostalSnapshot({ packageRoot: root, allowSynthetic: true }).sha256, null);
  fs.writeFileSync(file, Buffer.alloc(MAX_SNAPSHOT_BYTES + 1));
  assert.equal(loadPostalSnapshot({ packageRoot: root, allowSynthetic: true }).sha256, null);
  fs.writeFileSync(path.join(root, 'contracts/postal-snapshot.json'), '{');
  assert.equal(loadPostalSnapshot({ packageRoot: root, allowSynthetic: true }).sha256, null);
});

test('stale and future snapshots leave paired geography unresolved', (t) => {
  const root = fixture(t);
  for (const [snapshotDate, expiresOn] of [['2026-07-01', '2026-08-21'], ['2026-08-23', '2026-09-01']]) {
    writeManifest(root, (manifest) => Object.assign(manifest, { snapshotDate, expiresOn }));
    const snapshot = loadPostalSnapshot({ packageRoot: root, allowSynthetic: true });
    const configuration = { serviceArea: { cities: ['Kansas City, KS'], zips: [] }, serviceAreaResolution: {
      snapshotSha256: snapshot.sha256, approvedCoverage: { status: 'contractor_approved', cities: ['Kansas City, KS'], zips: [] },
      policy: { cityMeaning: 'postal_locality' },
    } };
    const result = serviceAreaDecision(configuration, { city: 'Kansas City', state: 'KS', zip: '66101', addressKind: 'physical' },
      snapshot, '2026-08-22');
    assert.equal(result.status, 'manual_review');
    assert.equal(result.postalConsistency, 'unknown');
    assert.deepEqual(configuration.serviceAreaResolution.approvedCoverage.zips, []);
  }
});

test('already-local GeoNames-format synthetic bytes exercise the TSV loader without a fetch', (t) => {
  const root = fixture(t);
  // A format fixture, not an acquired GeoNames snapshot or a claim about a real place.
  const text = 'US\t00501\tExample Township\tExample State\tNY\t\t\t\t\t0\t0\t1\n';
  const sha256 = createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(path.join(root, 'data/us-postal.txt'), text);
  writeManifest(root, (manifest) => Object.assign(manifest, { format: 'geonames_us_tsv', sha256 }));
  const snapshot = loadPostalSnapshot({ packageRoot: root });
  assert.equal(snapshot.sha256, sha256);
  assert.match(snapshot.index.provenance.attribution, /GeoNames, CC BY 4.0/);
});
