'use strict';

const { invariant } = require('./errors');
const { executeMigration } = require('./executor');
const { createFixedTargetMigrationAdapter } = require('./fixed-target-adapter');
const { assertApprovedDigest, digestEquals } = require('./digests');
const { createMigrationPlan } = require('./planner');
const { assertPrivateTargetBindingFresh } = require('./private-binding');

const MODES = new Set(['dry-run', 'apply', 'reconcile']);

/**
 * Composes the migration executor with the only repository-owned live boundary.
 * Dry-run remains the default and deliberately does not inspect private bindings,
 * transports, or loggers, so previewing cannot initialize a provider capability.
 */
async function executeFixedTargetMigration({
  mode = 'dry-run',
  contract,
  privateInput,
  digestKey,
  approvedInputDigest = null,
  approvedTargetBindingDigest = null,
  privateTargetBinding = null,
  transport = null,
  logger = null,
  cursor = null,
  batchSize = 100,
} = {}) {
  invariant(MODES.has(mode), 'INVALID_MIGRATION_MODE',
    'Migration mode must be dry-run, apply, or reconcile.');
  if (mode === 'dry-run') {
    return executeMigration({
      mode, contract, privateInput, digestKey, cursor, batchSize,
    });
  }
  // Validate the full immutable input, approval, batch bound, and cursor before
  // even inspecting a live-capable transport object. executeMigration repeats
  // this preflight at the execution seam so the adapter cannot weaken it.
  const preflight = createMigrationPlan({ contract, privateInput, digestKey, cursor, batchSize });
  assertApprovedDigest(approvedInputDigest);
  invariant(digestEquals(approvedInputDigest, preflight.inputDigest),
    'APPROVED_INPUT_DIGEST_MISMATCH',
    'The immutable approved input digest does not match this migration snapshot.');
  // Freshness is checked before the adapter is constructed or the transport
  // object is inspected. The adapter repeats the check at its internal seam.
  assertPrivateTargetBindingFresh(privateTargetBinding);
  const adapter = createFixedTargetMigrationAdapter({
    mode,
    contract,
    privateInput,
    approvedInputDigest,
    approvedTargetBindingDigest,
    binding: privateTargetBinding,
    transport,
    logger,
  });
  return executeMigration({
    mode,
    contract,
    privateInput,
    digestKey,
    approvedInputDigest,
    adapter,
    cursor,
    batchSize,
  });
}

module.exports = { executeFixedTargetMigration };
