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
  assert.equal(manifest.mode, 'bounded-setup-journey');
  assert.deepEqual(manifest.functions.map(({ name }) => name), [
    'revenue_leak_test_request_form',
    'revenue_leak_test_setup_form',
    'revenue_desk_call_gateway',
    'revenue_desk_call_worker',
    'revenue_desk_route_control',
  ]);
  assert.equal(manifest.job_pools.length, 1);
  assert.equal(manifest.tables.length, 12);
  assert.equal(Object.keys(manifest.contract_sha256).length, 29);
  assert.equal(verifyReadback(manifest, readback, contract), true);
});

test('selects only the setup routes and keeps CRM Billing deferred', () => {
  const routeIds = routeContract.routes.map(({ id }) => id);
  const targets = contract.installation_scope.catalyst;
  const setupProfile = routeContract.route_profiles['setup-journey'];
  assert.equal(targets.route_profile, 'setup-journey');
  assert.deepEqual(targets.route_ids, setupProfile.route_ids);
  assert.deepEqual(targets.route_ids, routeIds.filter((id) => id !== 'CRM_BILLING'));
  assert.equal(targets.route_ids.length, 17);
  assert.deepEqual(targets.deferred_route_ids, ['CRM_BILLING']);
  assert.deepEqual(
    [...targets.route_ids, ...targets.deferred_route_ids].sort(),
    [...routeIds].sort(),
  );
  assert.equal(targets.development_api_gateway_availability_authorized, true);
  assert.equal(targets.development_api_gateway_required_post_install_state, 'enabled');
  assert.equal(targets.gateway_enablement_requires_exact_route_readback, true);
  assert.equal(targets.route_packet_gateway_activation_authorized, false);
  assert.equal(targets.retell_route_mode, 'disabled');
  assert.equal(targets.retell_provider_binding_authorized, false);
  assert.equal(targets.production_gateway_activation_authorized, false);
  assert.equal(contract.installation_scope.retell.publish_authorized, false);
  assert.equal(contract.installation_scope.retell.real_traffic_authorized, false);
  assert.equal(contract.installation_scope.retell.installation_number_binding_authorized, false);
  assert.equal(
    contract.installation_scope.retell.installation_webhook_provider_binding_authorized,
    false,
  );
  assert.equal(
    contract.installation_scope.retell.activation_failure_wire_code_when_disabled,
    'isolated_retell_test_number_required',
  );
  assert.equal(
    contract.installation_scope.retell.activation_failure_internal_code_when_disabled,
    'ISOLATED_RETELL_TEST_NUMBER_REQUIRED',
  );
  const functions = new Set(contract.functions.map(({ name }) => name));
  for (const route of routeContract.routes.slice(0, -1)) {
    assert.equal(functions.has(route.function), true);
  }
  assert.equal(functions.has(routeContract.routes.at(-1).function), false);
});

test('binds exactly three replacement CRM labels plus the retained predecessor', () => {
  const crm = contract.installation_scope.crm;
  assert.deepEqual(crm.controls, [
    'Start Free-Test Request',
    'Open Free-Test Setup',
    'Approve And Start Free Test',
    'Stop Or Roll Back Free Test',
  ]);
  assert.deepEqual(crm.control_bindings, [
    { label: 'Start Free-Test Request', module: 'Leads',
      function: 'start_free_revenue_leak_test_request', replacement: false },
    { label: 'Open Free-Test Setup', module: 'Leads',
      function: 'open_free_test_setup', replacement: true },
    { label: 'Open Free-Test Setup', module: 'Deals',
      function: 'issue_revenue_leak_test_setup', replacement: true },
    { label: 'Approve And Start Free Test', module: 'Deals',
      function: 'approve_and_start_free_test', replacement: true },
    { label: 'Stop Or Roll Back Free Test', module: 'Deals',
      function: 'stop_or_rollback_free_test', replacement: true },
  ]);
  assert.deepEqual(
    [...new Set(crm.control_bindings
      .filter(({ replacement }) => replacement)
      .map(({ label }) => label))],
    crm.controls.slice(1),
  );
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
  manifest.installation_scope.catalyst.retell_route_mode = 'isolated_test';
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
