'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readTree, readBlob, writeCoreBridges, stampSource, validateArtifact,
  SOURCE_STAMP_PATH, ANALYTICS_STAMP_PATH } = require('./build-release');

const RUNTIME = 'src/zoho-catalyst/revenue-desk-call-runtime';
const CRM = 'src/zoho-catalyst/crm-billing-orchestrator';
const CRM_FUNCTION = 'functions/crm_billing_orchestrator';
const SOURCE_SENTINEL = '__SYLVARA_UNSTAMPED_SOURCE_REVISION__';
const PROOF_SENTINEL = '__SYLVARA_UNSTAMPED_DEVELOPMENT_ZAID_HMAC_SHA256__';
const AUTH_PATHS = Object.freeze([
  `${RUNTIME}/functions/revenue_desk_call_gateway/lib/config.js`,
  `${RUNTIME}/functions/revenue_desk_call_gateway/lib/crm-report-dispatch.js`,
  `${RUNTIME}/functions/revenue_desk_route_control/lib/http-boundary.js`,
  `${CRM}/${CRM_FUNCTION}/lib/action-contract.js`,
  `${CRM}/${CRM_FUNCTION}/lib/catalyst-adapter.js`,
]);
const SHA = /^[a-f0-9]{40}$/;
const sourceRoot = path.resolve(__dirname, '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const slash = value => value.split(path.sep).join('/');
function fail(phase = 'precheck') {
  throw Object.assign(new Error('AUTH_PRESERVING_COMPOSITION_REQUIRES_REVIEW'), { phase });
}
function git(args, binary = false) {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      ...args], { cwd: sourceRoot, encoding: binary ? null : 'utf8', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 24 * 1024 * 1024 });
  } catch { fail(`git_${args[0]}`); }
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative));
}
function existsIncludingLink(candidate) {
  try { fs.lstatSync(candidate); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Resolve even a not-yet-created parent's existing ancestor before mkdir. A
// junction into an immutable input must not create directories inside that input.
function prepareDestination(repository, inputs, outputRoot) {
  const destination = path.resolve(outputRoot);
  const canonicalRepository = fs.realpathSync(repository);
  const canonicalInputs = inputs.map(root => fs.realpathSync(root));
  const forbidden = candidate => inside(canonicalRepository, candidate)
    || canonicalInputs.some(root => inside(root, candidate) || inside(candidate, root));
  if (existsIncludingLink(destination) || forbidden(destination)) fail('destination');
  let ancestor = path.dirname(destination);
  const missing = [];
  while (!existsIncludingLink(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) fail('destination');
    missing.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  if (!fs.statSync(ancestor).isDirectory()) fail('destination');
  const physical = path.join(fs.realpathSync(ancestor), ...missing, path.basename(destination));
  if (forbidden(physical)) fail('destination');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const actual = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
  if (actual !== physical || forbidden(actual) || existsIncludingLink(destination)) fail('destination');
  return destination;
}

function regularFile(root, relative) {
  if (typeof relative !== 'string' || !relative.split('/').every(part => /^[A-Za-z0-9._-]+$/.test(part))) fail();
  const resolvedRoot = fs.realpathSync(root);
  if (path.resolve(root) !== resolvedRoot || !fs.lstatSync(root).isDirectory()) fail();
  let file = resolvedRoot;
  for (const [index, part] of relative.split('/').entries()) {
    file = path.join(file, part);
    const metadata = fs.lstatSync(file);
    if (metadata.isSymbolicLink() || (index === relative.split('/').length - 1
      ? !metadata.isFile() : !metadata.isDirectory())) fail();
  }
  if (!inside(resolvedRoot, fs.realpathSync(file)) || fs.statSync(file).size > 4 * 1024 * 1024) fail();
  return fs.readFileSync(file);
}
function put(root, relative, bytes) {
  const file = path.join(root, ...relative.split('/'));
  if (!inside(root, file)) fail();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: 'wx' });
}
function crmEntries(revision) {
  const entries = [];
  for (const row of git(['ls-tree', '-r', '-z', '--full-tree', revision, '--', CRM]).split('\0')) {
    if (!row) continue;
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    if (!match) fail();
    const relative = match[3].slice(CRM.length + 1);
    if (relative === 'catalyst.json'
      || new Set(['catalyst-config.json', 'index.js', 'package.json', 'package-lock.json'])
        .has(relative.slice(CRM_FUNCTION.length + 1)) && relative.startsWith(`${CRM_FUNCTION}/`)
      || new RegExp(`^${CRM_FUNCTION}/lib/[A-Za-z0-9._-]+\\.js$`).test(relative)) {
      entries.push({ relative, repositoryPath: match[3], object: match[2] });
    }
  }
  for (const required of ['catalyst.json', `${CRM_FUNCTION}/index.js`, `${CRM_FUNCTION}/package.json`,
    `${CRM_FUNCTION}/package-lock.json`, `${CRM_FUNCTION}/catalyst-config.json`,
    `${CRM_FUNCTION}/lib/source-revision.js`]) {
    if (!entries.some(entry => entry.relative === required)) fail();
  }
  return entries;
}

/** Verify a reviewed CRM source artifact without loading its executable stamp.
 * Only the two explicit stamp values may differ from the selected Git blobs.
 */
function verifiedCrmSource(revision, root) {
  const files = [];
  let proof;
  for (const entry of crmEntries(revision)) {
    let expected = readBlob(entry.object);
    const actual = regularFile(root, entry.relative);
    if (entry.relative === `${CRM_FUNCTION}/lib/source-revision.js`) {
      proof = /ARTIFACT_DEVELOPMENT_ZAID_HMAC_SHA256\s*=\s*['"]([a-f0-9]{64})['"]/.exec(actual.toString('utf8'))?.[1];
      if (!proof || expected.toString('utf8').split(SOURCE_SENTINEL).length !== 2
        || expected.toString('utf8').split(PROOF_SENTINEL).length !== 2) fail();
      expected = Buffer.from(expected.toString('utf8').replace(SOURCE_SENTINEL, revision)
        .replace(PROOF_SENTINEL, proof));
    }
    if (!expected.equals(actual)) fail();
    files.push({ ...entry, bytes: actual });
  }
  if (!proof) fail();
  return { proof, files };
}

/** Export reporting CRM source while carrying one already reviewed opaque proof.
 * This does not recompute or authenticate the Development binding. Its private
 * acceptance remains separate. No old auth code or dependencies are copied.
 */
function prepareCrmBase({ reportingRevision, proofSourceRevision, proofArtifact, outputRoot } = {}) {
  if (![reportingRevision, proofSourceRevision].every(value => SHA.test(value || ''))
    || [proofArtifact, outputRoot].some(value => typeof value !== 'string' || !path.isAbsolute(value))) fail();
  const repository = path.resolve(git(['rev-parse', '--show-toplevel']).trim());
  if (slash(path.relative(repository, sourceRoot)) !== RUNTIME
    || git(['rev-parse', 'HEAD']).trim() !== reportingRevision
    || git(['rev-parse', '--verify', `${proofSourceRevision}^{commit}`]).trim() !== proofSourceRevision
    || git(['status', '--porcelain=v1', '--untracked-files=all']).trim()) fail('source_state');
  if (inside(fs.realpathSync(repository), fs.realpathSync(proofArtifact))) fail('destination');
  let reviewed;
  try { reviewed = verifiedCrmSource(proofSourceRevision, proofArtifact); }
  catch { fail('crm_proof_source_verification'); }
  const destination = prepareDestination(repository, [proofArtifact], outputRoot);
  const staging = fs.mkdtempSync(path.join(path.dirname(destination), '.sylvara-crm-reporting-base-'));
  let phase = 'crm_reporting_export';
  try {
    const files = [];
    for (const entry of crmEntries(reportingRevision)) {
      const source = readBlob(entry.object);
      let bytes = source;
      if (entry.relative === `${CRM_FUNCTION}/lib/source-revision.js`) {
        const template = source.toString('utf8');
        if (template.split(SOURCE_SENTINEL).length !== 2 || template.split(PROOF_SENTINEL).length !== 2) fail();
        bytes = Buffer.from(template.replace(SOURCE_SENTINEL, reportingRevision)
          .replace(PROOF_SENTINEL, reviewed.proof));
      }
      put(staging, entry.relative, bytes);
      files.push({ path: entry.relative, source_path: entry.repositoryPath,
        source_sha256: digest(source), sha256: digest(bytes) });
    }
    verifiedCrmSource(reportingRevision, staging);
    const proofSource = reviewed.files.find(entry => entry.relative === `${CRM_FUNCTION}/lib/source-revision.js`);
    const manifest = { schema_version: 'reporting-crm-source-base-v1',
      status: 'local_source_candidate_installation_held', installation_authorized: false,
      dependency_materialization_required: true, reporting_revision: reportingRevision,
      proof_source_revision: proofSourceRevision, proof_source_stamp_sha256: digest(proofSource.bytes),
      proof_carry_forward: 'existing_opaque_value_only_private_binding_acceptance_still_required',
      files: files.sort((a, b) => a.path.localeCompare(b.path)) };
    put(staging, 'crm-source-base-manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    phase = 'crm_proof_source_verification';
    for (const entry of reviewed.files) {
      if (!regularFile(proofArtifact, entry.relative).equals(entry.bytes)) fail();
    }
    if (git(['status', '--porcelain=v1', '--untracked-files=all']).trim() || fs.existsSync(destination)) fail();
    fs.renameSync(staging, destination);
    return Object.freeze({ outputRoot: destination,
      manifestPath: path.join(destination, 'crm-source-base-manifest.json'), installationAuthorized: false });
  } catch {
    if (inside(path.dirname(destination), staging) && path.basename(staging).startsWith('.sylvara-crm-reporting-base-')) {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    fail(phase);
  }
}

/** Local source composition only. No installs, credentials, deploys or Git mutations.
 * Input artifacts remain unchanged. Every copied source byte is independently
 * checked against its commit; only existing explicit source/protected-proof stamps
 * may differ. Dependencies must be materialized after overlay so workers cannot
 * retain a stale auth package. This output cannot use single-revision release parity.
 */
function compose({ reportingRevision, authRevision, runtimeArtifact, crmArtifact, outputRoot } = {}) {
  if (![reportingRevision, authRevision].every(value => SHA.test(value || ''))
    || [runtimeArtifact, crmArtifact, outputRoot].some(value => typeof value !== 'string' || !path.isAbsolute(value))) fail();
  const repository = path.resolve(git(['rev-parse', '--show-toplevel']).trim());
  if (slash(path.relative(repository, sourceRoot)) !== RUNTIME
    || git(['rev-parse', 'HEAD']).trim() !== reportingRevision
    || git(['rev-parse', '--verify', `${authRevision}^{commit}`]).trim() !== authRevision
    || git(['status', '--porcelain=v1', '--untracked-files=all']).trim()) fail('source_state');
  const parents = git(['rev-list', '--parents', '-n', '1', authRevision]).trim().split(' ');
  const baseRevision = git(['merge-base', reportingRevision, authRevision]).trim();
  if (parents.length !== 2 || parents[1] !== baseRevision || reportingRevision === authRevision) fail('source_lineage');
  const changes = git(['diff-tree', '--no-commit-id', '--name-only', '-r', authRevision]).trim().split('\n');
  const deployableChanges = changes.filter(name => /\/functions\/[^/]+\/(?:lib\/|contracts\/|index\.js$|package(?:-lock)?\.json$|catalyst-config\.json$)/.test(name)
    || /\/catalyst\.json$/.test(name)
    || name.startsWith('src/zoho-catalyst/revenue-desk-analytics/tools/')
    || /\/revenue-desk-analytics\/config\/(?:free-test-report-contract|analytics-model-contract)\.json$/.test(name));
  if (JSON.stringify(deployableChanges.sort()) !== JSON.stringify([...AUTH_PATHS].sort())) fail('auth_paths');
  const overlays = AUTH_PATHS.map(repositoryPath => {
    const base = git(['cat-file', 'blob', `${baseRevision}:${repositoryPath}`], true);
    const current = git(['cat-file', 'blob', `${reportingRevision}:${repositoryPath}`], true);
    const selected = git(['cat-file', 'blob', `${authRevision}:${repositoryPath}`], true);
    if (!base.equals(current) || selected.equals(base)) fail('source_overlap');
    return { repositoryPath, selected, baseSha256: digest(base), authSha256: digest(selected),
      authBlob: git(['rev-parse', '--verify', `${authRevision}:${repositoryPath}`]).trim() };
  });
  const destination = prepareDestination(repository, [runtimeArtifact, crmArtifact], outputRoot);
  const staging = fs.mkdtempSync(path.join(path.dirname(destination), '.sylvara-composed-reporting-'));
  const runtimeOutput = path.join(staging, 'runtime');
  const crmOutput = path.join(staging, 'crm');
  let phase = 'runtime_source';
  try {
    const entries = readTree(reportingRevision);
    for (const entry of entries) put(runtimeOutput, entry.relative, readBlob(entry.object));
    stampSource(runtimeOutput, SOURCE_STAMP_PATH, '__REVENUE_DESK_SOURCE_REVISION__', reportingRevision);
    stampSource(runtimeOutput, ANALYTICS_STAMP_PATH, SOURCE_SENTINEL, reportingRevision);
    const generated = writeCoreBridges(runtimeOutput, entries);
    phase = 'runtime_base_verification';
    const baseManifest = JSON.parse(regularFile(runtimeArtifact, 'release-manifest.json'));
    if (baseManifest.source_revision !== reportingRevision || !Array.isArray(baseManifest.files)
      || baseManifest.files.length !== entries.length + generated.length) fail();
    const sourceFiles = [];
    for (const entry of [...entries, ...generated]) {
      const expected = regularFile(runtimeOutput, entry.relative);
      const actual = regularFile(runtimeArtifact, entry.relative);
      const rows = baseManifest.files.filter(row => row.path === entry.relative && row.sha256 === digest(actual));
      if (!expected.equals(actual) || rows.length !== 1) fail();
      sourceFiles.push({ artifact: 'runtime', path: entry.relative, source: entry.source || entry });
    }
    put(staging, 'provenance/runtime-base-release-manifest.json', regularFile(runtimeArtifact, 'release-manifest.json'));
    phase = 'crm_base_verification';
    for (const entry of verifiedCrmSource(reportingRevision, crmArtifact).files) {
      put(crmOutput, entry.relative, entry.bytes);
      sourceFiles.push({ artifact: 'crm', path: entry.relative, source: entry });
    }
    phase = 'auth_overlay';
    for (const overlay of overlays) {
      const runtime = overlay.repositoryPath.startsWith(`${RUNTIME}/`);
      const relative = overlay.repositoryPath.slice((runtime ? RUNTIME : CRM).length + 1);
      const root = runtime ? runtimeOutput : crmOutput;
      fs.writeFileSync(path.join(root, ...relative.split('/')), overlay.selected, { flag: 'w' });
    }
    validateArtifact(runtimeOutput);
    phase = 'composition_manifest';
    const files = sourceFiles.map(({ artifact, path: relative, source }) => ({
      artifact, path: relative, source_path: source.repositoryPath,
      source_revision: AUTH_PATHS.includes(source.repositoryPath) ? authRevision : reportingRevision,
      source_sha256: overlays.find(item => item.repositoryPath === source.repositoryPath)?.authSha256
        || digest(readBlob(source.object)),
      sha256: digest(regularFile(artifact === 'runtime' ? runtimeOutput : crmOutput, relative)),
    })).sort((a, b) => `${a.artifact}/${a.path}`.localeCompare(`${b.artifact}/${b.path}`));
    const manifest = { schema_version: 'reporting-auth-preservation-composition-v1',
      status: 'local_source_candidate_installation_held', installation_authorized: false,
      dependency_materialization_required: true, base_revision: baseRevision,
      reporting_revision: reportingRevision, auth_preservation_revision: authRevision,
      source_revision_stamp_meaning: 'reporting_base_not_single_revision_artifact_parity',
      runtime_base_manifest_sha256: digest(regularFile(runtimeArtifact, 'release-manifest.json')),
      overlays: overlays.map(item => ({ source_path: item.repositoryPath,
        base_sha256: item.baseSha256, auth_blob_sha: item.authBlob, auth_sha256: item.authSha256 })), files };
    put(staging, 'composition-manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    if (git(['status', '--porcelain=v1', '--untracked-files=all']).trim() || fs.existsSync(destination)) fail();
    fs.renameSync(staging, destination);
    return Object.freeze({ outputRoot: destination, manifestPath: path.join(destination, 'composition-manifest.json'),
      installationAuthorized: false });
  } catch {
    if (inside(path.dirname(destination), staging) && path.basename(staging).startsWith('.sylvara-composed-reporting-')) {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    fail(phase);
  }
}

if (require.main === module) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--help') {
      process.stdout.write('Local held source composition; no install, deploy, credential read or Git change.\n'
        + 'node scripts/compose-reporting-artifact.js --reporting-revision <full-sha> --auth-revision <full-sha> '
        + '--runtime-artifact <absolute-base-root> --crm-artifact <absolute-base-root> --output <new-absolute-root>\n'
        + 'Requires clean reporting HEAD and exact reviewed base artifacts. Materialize reviewed dependencies '
        + 'after overlay, then hash complete archives separately. Source stamps identify the reporting base; '
        + 'composition-manifest.json identifies both revisions. Installation remains held.\n'
        + 'To export a reporting CRM base from an existing reviewed opaque proof, first run:\n'
        + 'node scripts/compose-reporting-artifact.js --prepare-crm-base --reporting-revision <full-sha> '
        + '--proof-source-revision <full-sha> --proof-artifact <absolute-reviewed-crm-root> '
        + '--output <new-absolute-crm-base-root>\n'
        + 'This mode verifies the proof-source artifact against its commit, exports only reporting Git blobs, '
        + 'and carries the existing proof without credentials or HMAC recomputation. Keep its private manifest.\n');
    } else {
      const args = process.argv.slice(2);
      const prepare = args[0] === '--prepare-crm-base';
      if (prepare) args.shift();
      const names = prepare
        ? { '--reporting-revision': 'reportingRevision', '--proof-source-revision': 'proofSourceRevision',
          '--proof-artifact': 'proofArtifact', '--output': 'outputRoot' }
        : { '--reporting-revision': 'reportingRevision', '--auth-revision': 'authRevision',
          '--runtime-artifact': 'runtimeArtifact', '--crm-artifact': 'crmArtifact', '--output': 'outputRoot' };
      const options = {};
      if (args.length !== (prepare ? 8 : 10)) fail();
      for (let index = 0; index < args.length; index += 2) {
        const name = names[args[index]];
        if (!name || Object.hasOwn(options, name)) fail();
        options[name] = args[index + 1];
      }
      process.stdout.write(`${JSON.stringify(prepare ? prepareCrmBase(options) : compose(options))}\n`);
    }
  } catch (error) {
    const phase = ['precheck', 'git_rev-parse', 'git_rev-list', 'git_merge-base', 'git_status',
      'git_diff-tree', 'git_cat-file', 'git_ls-tree', 'source_state', 'source_lineage', 'auth_paths', 'source_overlap',
      'destination', 'runtime_source', 'runtime_base_verification', 'crm_base_verification',
      'auth_overlay', 'composition_manifest', 'crm_proof_source_verification', 'crm_reporting_export'].includes(error.phase) ? error.phase : 'precheck';
    process.stderr.write(`AUTH_PRESERVING_COMPOSITION_REQUIRES_REVIEW:${phase}\n`);
    process.exitCode = 1;
  }
}

module.exports = { compose, prepareCrmBase, AUTH_PATHS };
