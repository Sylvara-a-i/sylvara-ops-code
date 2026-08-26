'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HEX_40 = /^[a-f0-9]{40}$/;
const OPAQUE_KEY = /^[a-f0-9]{64}$/;
const REQUIRED_RECORD_TYPES = Object.freeze([
  'deployment',
  'call',
  'daily_metric',
  'final_test_result',
  'conversion_status',
]);
const EVIDENCE_KEYS = Object.freeze([
  'schema_version',
  'evaluated_at',
  'approved_source_revision',
  'scope_inventory',
  'scopes',
]);
const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const MODEL_PATH = path.resolve(__dirname, '../config/analytics-model-contract.json');
const MAX_PRIVATE_INPUT_BYTES = 1024 * 1024;

function isoMillis(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  return plain(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function scopeKey(scope) {
  return [scope.ENVIRONMENT, scope.ENGAGEMENT_TYPE, scope.CLIENT_KEY, scope.DEPLOYMENT_KEY]
    .join('\0');
}

function scopeInventoryDigest(scopes) {
  const keys = scopes.map(scopeKey).sort();
  return crypto.createHash('sha256')
    .update(`analytics-dashboard-scope-v1\0${keys.join('\n')}`)
    .digest('hex');
}

function gateContractIsValid(gate) {
  return Boolean(gate)
    && gate.gate_key === 'catalyst-checkpoint-and-analytics-readback-v1'
    && gate.mode === 'fail_closed'
    && gate.evidence_schema_version === 1
    && gate.required_environment === 'development'
    && gate.required_engagement_type === 'free_test'
    && Array.isArray(gate.required_record_types)
    && exactKeys(
      Object.fromEntries((gate.required_record_types || []).map((value) => [value, true])),
      REQUIRED_RECORD_TYPES,
    )
    && gate.required_record_types.length === REQUIRED_RECORD_TYPES.length
    && gate.required_checkpoint_status === 'Healthy'
    && gate.maximum_evidence_age_seconds === 300
    && gate.ready_verdict === 'ready'
    && gate.blocked_verdict === 'blocked';
}

function evaluatePreRenderGate(
  gate,
  evidence,
  nowMs = Date.now(),
  renderApproval = null,
) {
  const reasons = new Set();
  const block = (reason) => reasons.add(reason);
  const gateValid = gateContractIsValid(gate);

  if (!gateValid) block('GATE_CONTRACT_INVALID');
  if (!exactKeys(evidence, EVIDENCE_KEYS)
    || evidence.schema_version !== 1
    || !Array.isArray(evidence.scopes) || evidence.scopes.length === 0) {
    block('EVIDENCE_MISSING_OR_INVALID');
  }
  const approvedSourceRevision = evidence?.approved_source_revision;
  if (!HEX_40.test(approvedSourceRevision || '')) {
    block('APPROVED_SOURCE_REVISION_INVALID');
  }
  if (!exactKeys(renderApproval, [
    'approved_scope_inventory_digest',
    'approved_source_revision',
    'schema_version',
  ])
    || renderApproval.schema_version !== 1
    || !HEX_40.test(renderApproval.approved_source_revision || '')
    || !OPAQUE_KEY.test(renderApproval.approved_scope_inventory_digest || '')) {
    block('RENDER_APPROVAL_INVALID');
  }
  if (approvedSourceRevision !== renderApproval?.approved_source_revision) {
    block('APPROVED_SOURCE_REVISION_MISMATCH');
  }

  const evaluatedAt = isoMillis(evidence?.evaluated_at);
  if (evaluatedAt === null || !Number.isFinite(nowMs)
    || evaluatedAt > nowMs
    || nowMs - evaluatedAt > 300 * 1000) {
    block('EVIDENCE_STALE');
  }

  const scopes = Array.isArray(evidence?.scopes) ? evidence.scopes : [];
  const inventory = evidence?.scope_inventory;
  const scopesArePlain = scopes.length > 0 && scopes.every(plain);
  const computedScopeKeys = scopesArePlain ? scopes.map(scopeKey) : [];
  const computedDigest = scopesArePlain ? scopeInventoryDigest(scopes) : null;
  const approvedScopeInventoryDigest = renderApproval?.approved_scope_inventory_digest;
  if (!inventory || !Number.isSafeInteger(inventory.expected_scope_count)
    || inventory.expected_scope_count !== scopes.length
    || inventory.catalyst_scope_digest !== computedDigest
    || inventory.analytics_scope_digest !== computedDigest
    || inventory.catalyst_scope_digest !== approvedScopeInventoryDigest
    || inventory.analytics_scope_digest !== approvedScopeInventoryDigest
    || new Set(computedScopeKeys).size !== scopes.length) {
    block('SCOPE_INVENTORY_MISMATCH');
  }

  const recordTypes = REQUIRED_RECORD_TYPES;
  for (const scope of scopes) {
    if (!scope || scope.ENVIRONMENT !== 'development'
      || scope.ENGAGEMENT_TYPE !== 'free_test'
      || !OPAQUE_KEY.test(scope.CLIENT_KEY || '')
      || !OPAQUE_KEY.test(scope.DEPLOYMENT_KEY || '')) {
      block('SCOPE_INVALID');
      continue;
    }
    if (scope.unresolved_v2_outbox_rows !== 0) block('UNRESOLVED_OUTBOX');

    const checkpoints = scope.checkpoints;
    if (!exactKeys(checkpoints, recordTypes)) block('CHECKPOINT_COVERAGE_MISMATCH');

    const readback = scope.analytics_readback;
    if (readback?.binding_verified !== true) block('ANALYTICS_BINDING_UNVERIFIED');
    if (readback?.partition_isolation_verified !== true) {
      block('ANALYTICS_ISOLATION_UNVERIFIED');
    }
    if (!exactKeys(readback?.record_types, recordTypes)) {
      block('ANALYTICS_COVERAGE_MISMATCH');
    }

    for (const recordType of recordTypes) {
      const checkpoint = checkpoints?.[recordType];
      const provider = readback?.record_types?.[recordType];
      if (!checkpoint || checkpoint.status !== 'Healthy') {
        block('CHECKPOINT_NOT_HEALTHY');
      }
      if (checkpoint?.last_error_code !== null) block('CHECKPOINT_ERROR');
      if (checkpoint?.last_rejected_row_count !== 0) block('CHECKPOINT_REJECTIONS');

      const watermark = isoMillis(checkpoint?.last_source_modified_at);
      const providerWatermark = isoMillis(checkpoint?.provider_watermark);
      const reconciledAt = isoMillis(checkpoint?.last_reconciled_at);
      const staleAfter = isoMillis(checkpoint?.stale_after_at);
      if (watermark === null || providerWatermark === null || reconciledAt === null
        || staleAfter === null || staleAfter <= nowMs || reconciledAt < watermark
        || staleAfter <= reconciledAt) {
        block('CHECKPOINT_STALE');
      }
      if (watermark > evaluatedAt || providerWatermark > evaluatedAt
        || reconciledAt > evaluatedAt) {
        block('CHECKPOINT_FUTURE_TIMESTAMP');
      }
      if (watermark !== providerWatermark) block('CHECKPOINT_WATERMARK_MISMATCH');
      if (!HEX_40.test(checkpoint?.source_revision || '')) {
        block('CHECKPOINT_REVISION_INVALID');
      }
      if (checkpoint?.source_revision !== approvedSourceRevision) {
        block('CHECKPOINT_APPROVED_REVISION_MISMATCH');
      }

      if (!provider || !Number.isSafeInteger(provider.row_count) || provider.row_count < 1
        || provider.duplicate_record_key_count !== 0
        || provider.payload_hash_mismatch_count !== 0) {
        block('ANALYTICS_ROWSET_INVALID');
      }
      if (isoMillis(provider?.latest_source_modified_at) !== watermark) {
        block('ANALYTICS_WATERMARK_MISMATCH');
      }
      if (provider?.source_revision !== checkpoint?.source_revision) {
        block('ANALYTICS_REVISION_MISMATCH');
      }
      if (provider?.source_revision !== approvedSourceRevision) {
        block('ANALYTICS_APPROVED_REVISION_MISMATCH');
      }
    }
  }

  const reasonCodes = [...reasons].sort();
  return Object.freeze({
    verdict: reasonCodes.length === 0 ? 'ready' : 'blocked',
    reason_codes: Object.freeze(reasonCodes),
  });
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

function hasGitWorkingTreeAncestor(candidate) {
  let cursor = path.dirname(candidate);
  while (true) {
    if (fs.existsSync(path.join(cursor, '.git'))) return true;
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
}

function readPrivateJson(inputPath) {
  if (typeof inputPath !== 'string' || !path.isAbsolute(inputPath)) {
    throw new Error('private input path must be absolute');
  }
  const requested = path.resolve(inputPath);
  const stat = fs.lstatSync(requested);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PRIVATE_INPUT_BYTES) {
    throw new Error('private input must be a bounded regular file');
  }
  const physical = fs.realpathSync.native(requested);
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  // Private live evidence must never be accepted through a link alias or from
  // any Git working tree where it could become a public object accidentally.
  if (normalize(physical) !== normalize(requested)
    || isWithin(REPOSITORY_ROOT, physical)
    || hasGitWorkingTreeAncestor(physical)) {
    throw new Error('private input location is not allowed');
  }
  return JSON.parse(fs.readFileSync(physical, { encoding: 'utf8', flag: 'r' }));
}

function parseCliArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) return null;
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!['--evidence', '--approval'].includes(name) || values[name]) return null;
    values[name] = argv[index + 1];
  }
  return values['--evidence'] && values['--approval'] ? values : null;
}

function blockedCliResult() {
  return Object.freeze({
    verdict: 'blocked',
    reason_codes: Object.freeze(['CLI_INPUT_INVALID']),
  });
}

function runCli(argv = process.argv.slice(2), nowMs = Date.now()) {
  try {
    const arguments_ = parseCliArguments(argv);
    if (!arguments_) return blockedCliResult();
    const model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
    return evaluatePreRenderGate(
      model.pre_render_gate,
      readPrivateJson(arguments_['--evidence']),
      nowMs,
      readPrivateJson(arguments_['--approval']),
    );
  } catch {
    return blockedCliResult();
  }
}

if (require.main === module) {
  const result = runCli();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.verdict === 'ready' ? 0 : 1;
}

module.exports = {
  evaluatePreRenderGate,
  parseCliArguments,
  readPrivateJson,
  runCli,
  scopeInventoryDigest,
};
