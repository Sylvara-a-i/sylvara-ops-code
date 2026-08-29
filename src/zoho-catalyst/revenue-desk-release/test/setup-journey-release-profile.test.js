'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildManifest,
  createArtifactProvenance,
  verifyReadback,
} = require('../lib/release-manifest');

const contract = require('../setup-journey-release-contract.json');
const routeContract = require('../private-route-packet-contract.json');
const revision = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function fixture() {
  const sourceTrees = Object.fromEntries(
    contract.functions.map(({ name }) => [name, digest]),
  );
  const artifacts = Object.fromEntries(contract.functions.map((entry) => {
    const artifact = { sha256: digest, file_count: 2 };
    artifact.provenance = createArtifactProvenance({
      functionName: entry.name,
      packageName: entry.name,
      revisionStampTarget: entry.revision_stamp_target,
      sourceRevision: revision,
      sourceTreeSha256: sourceTrees[entry.name],
      artifactSha256: artifact.sha256,
      artifactFileCount: artifact.file_count,
    });
    return [entry.name, artifact];
  }));
  const contractDigests = Object.fromEntries(
    contract.contract_files.map((file) => [file, digest]),
  );
  const manifest = buildManifest({
    contract,
    sourceRevision: revision,
    environment: 'Development',
    artifacts,
    sourceTrees,
    contractDigests,
  });
  const readback = {
    source_revision: revision,
    environment: 'Development',
    mode: manifest.mode,
    functions: manifest.functions.map((entry) => ({
      name: entry.name,
      source_revision: revision,
      source_tree_sha256: entry.source_tree_sha256,
      artifact_sha256: entry.artifact_sha256,
    })),
    job_pools: [...manifest.job_pools],
    tables: [...manifest.tables],
    contract_sha256: { ...manifest.contract_sha256 },
  };
  return { artifacts, contractDigests, manifest, readback, sourceTrees };
}

test('binds the exact Development setup journey to one immutable revision', () => {
  const { manifest, readback } = fixture();
  assert.equal(manifest.release_kind, 'revenue_desk_setup_journey_release');
  assert.equal(manifest.mode, 'contained-setup-journey');
  assert.deepEqual(manifest.functions.map(({ name }) => name), [
    'revenue_leak_test_request_form',
    'revenue_leak_test_setup_form',
    'revenue_desk_call_gateway',
    'revenue_desk_call_worker',
  ]);
  assert.equal(manifest.job_pools.length, 1);
  assert.equal(manifest.tables.length, 11);
  assert.equal(Object.keys(manifest.contract_sha256).length, 18);
  assert.equal(verifyReadback(manifest, readback, contract), true);
});

test('selects only the setup routes and keeps CRM Billing deferred', () => {
  const routeIds = routeContract.routes.map(({ id }) => id);
  const targets = contract.installation_scope.catalyst;
  assert.deepEqual(targets.route_ids, routeIds.slice(0, 11));
  assert.deepEqual(targets.deferred_route_ids, ['CRM_BILLING']);
  const classifiedRouteIds = [...targets.route_ids, ...targets.deferred_route_ids];
  assert.equal(new Set(classifiedRouteIds).size, classifiedRouteIds.length);
  assert.deepEqual([...classifiedRouteIds].sort(), [...routeIds].sort());
  assert.equal(targets.gateway_activation_authorized, false);
  const functions = new Set(contract.functions.map(({ name }) => name));
  for (const route of routeContract.routes.slice(0, 11)) {
    assert.equal(functions.has(route.function), true);
  }
  assert.equal(functions.has(routeContract.routes[11].function), false);
});

test('rejects extra artifacts, mixed live state, and Production', () => {
  const { artifacts, contractDigests, manifest, readback, sourceTrees } = fixture();
  const extraArtifacts = { ...artifacts, crm_billing_orchestrator: artifacts[Object.keys(artifacts)[0]] };
  assert.throws(() => buildManifest({
    contract,
    sourceRevision: revision,
    environment: 'Development',
    artifacts: extraArtifacts,
    sourceTrees,
    contractDigests,
  }), /Artifact names/);
  assert.throws(() => buildManifest({
    contract,
    sourceRevision: revision,
    environment: 'Production',
    artifacts,
    sourceTrees,
    contractDigests,
  }), /Environment is not allowed/);
  readback.tables.pop();
  assert.throws(() => verifyReadback(manifest, readback, contract), /tables/);
  readback.tables.push(manifest.tables.at(-1));
  readback.functions[0].source_revision = 'c'.repeat(40);
  assert.throws(() => verifyReadback(manifest, readback, contract), /parity failed/);
});

test('rejects source-scope drift and never treats it as provider readback', () => {
  const { manifest, readback } = fixture();
  manifest.installation_scope.catalyst.gateway_activation_authorized = true;
  assert.throws(() => verifyReadback(manifest, readback, contract), /source-scope parity/);
  const clean = fixture();
  clean.readback.installation_scope = JSON.parse(
    JSON.stringify(clean.manifest.installation_scope),
  );
  assert.throws(
    () => verifyReadback(clean.manifest, clean.readback, contract),
    /not provider readback/,
  );
});
