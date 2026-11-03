'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildGeoNamesUsPostalIndex, createSyntheticPostalIndex, failedIndex } = require('./offline-postal-index');

const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const FORMATS = Object.freeze({ geonames_us_tsv: 'us-postal.txt', synthetic_json: 'us-postal-fixture.json' });
let packaged;

function readRegular(file, maximum) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) throw new Error('invalid asset');
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size || bytes.length > maximum) throw new Error('changed asset');
  return bytes;
}

// A fixed package-relative asset, never a request path, URL, tenant file, or runtime download.
// Synthetic data is packaged for reproducibility but denied by the default runtime loader.
function loadPostalSnapshot({ packageRoot = path.resolve(__dirname, '..'), allowSynthetic = false } = {}) {
  try {
    for (const name of ['contracts', 'data']) {
      const stat = fs.lstatSync(path.join(packageRoot, name));
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid directory');
    }
    const manifest = JSON.parse(readRegular(path.join(packageRoot, 'contracts', 'postal-snapshot.json'), 4096));
    if (manifest.schemaVersion !== 1 || !Object.hasOwn(FORMATS, manifest.format)
      || !/^[a-f0-9]{64}$/.test(manifest.sha256 || '')
      || (manifest.format === 'synthetic_json' && !allowSynthetic)) throw new Error('unapproved snapshot');
    const bytes = readRegular(path.join(packageRoot, 'data', FORMATS[manifest.format]), MAX_SNAPSHOT_BYTES);
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('corrupt snapshot');
    const dates = { snapshotDate: manifest.snapshotDate, expiresOn: manifest.expiresOn };
    const index = manifest.format === 'geonames_us_tsv'
      ? buildGeoNamesUsPostalIndex({ text: bytes, expectedSha256: manifest.sha256, ...dates })
      : createSyntheticPostalIndex({ records: JSON.parse(bytes), ...dates });
    if (index.status !== 'ready') throw new Error('invalid snapshot');
    return Object.freeze({ index, sha256: manifest.sha256 });
  } catch (_) {
    return Object.freeze({ index: failedIndex('corrupt'), sha256: null });
  }
}

function loadPackagedPostalSnapshot() {
  // Rebuilding or replacing the asset requires a release; no request silently refreshes it.
  if (!packaged) packaged = loadPostalSnapshot();
  return packaged;
}

module.exports = { loadPostalSnapshot, loadPackagedPostalSnapshot, MAX_SNAPSHOT_BYTES };
