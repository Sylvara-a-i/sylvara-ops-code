'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalJson } = require('../functions/analytics_sync/lib/facts');
const { renderFreeTestReport, CLIENT_DRAFT_RENDERER_VERSION } = require('./render-free-test-report');
const { isClientCallDetails } = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/reporting');
const { createReconciledFreeTestInputReader } = require('./read-reconciled-free-test-input');

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 4096;
const REVIEW_STATE = 'draft_generated_owner_review_required_delivery_not_authorized';
const INPUT_KEYS = new Set(['privateDirectory', 'now', 'synthetic', 'callDetails', 'opportunityReview']);
const preparedDocuments = new WeakSet();

function fail() {
  // Neither filesystem diagnostics nor renderer errors may expose private input,
  // document contents, identifiers or paths to callers or an execution log.
  const error = new Error('DRAFT_RECONCILIATION_REQUIRED');
  error.code = 'DRAFT_RECONCILIATION_REQUIRED';
  throw error;
}

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function privateDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^[\\/]{2}/.test(value)
    || (process.platform === 'win32' && value.slice(2).includes(':'))) fail();
  const requested = path.resolve(value);
  const physical = fs.realpathSync(requested);
  const normalize = (candidate) => process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  if (normalize(requested) !== normalize(physical)) fail();
  const metadata = fs.lstatSync(requested);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail();
  let current = physical;
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) fail();
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return physical;
}

function readOptional(file, maximumBytes) {
  let metadata;
  try { metadata = fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.size < 1 || metadata.size > maximumBytes) fail();
  const bytes = fs.readFileSync(file);
  const after = fs.lstatSync(file);
  if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1
    || after.ino !== metadata.ino || after.dev !== metadata.dev
    || after.size !== metadata.size || bytes.length !== metadata.size) fail();
  return bytes;
}

function exclusiveWrite(file, bytes) {
  let descriptor;
  try { descriptor = fs.openSync(file, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  return true;
}

function exactBytes(actual, expected) {
  if (!actual || !actual.equals(expected)) fail();
}

/** Prepare one private client draft from the existing terminal/reconciliation gate.
 *
 * This is the bounded local completion hook, not an installed cloud trigger.
 * The existing optional analytics_sync checkpoint hook still needs a trusted
 * adapter for ALL three partitions and approved private storage before binding.
 * Runtime REPORT_RECONCILIATION_STATUS=Completed alone is never accepted here.
 *
 * The caller's prepared in-memory callDetails retains its runtime validation
 * brand; this module does not deserialize a free-text adjunct or create another
 * truth store. The renderer validates every input before a filesystem mutation.
 *
 * An exclusive durable intent fences duplicate generation. A crash after intent
 * but before a complete document is an ambiguous write, not permission to retry.
 * Only exact document readback can complete a missing receipt. No overwrite,
 * automatic cleanup, approval, delivery, provider request or credential read is
 * offered. The explicit directory must already have the approved private access
 * and retention policy; POSIX mode 0600 does not establish Windows ACL privacy.
 * An untrusted process able to modify that directory is outside this boundary.
 */
function prepareFreeTestDocument(input, options = {}) {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => !INPUT_KEYS.has(key))) fail();
    const { now = Date.now(), synthetic = false } = options;
    if (!Number.isSafeInteger(now) || typeof synthetic !== 'boolean'
      || !isClientCallDetails(options.callDetails)
      || typeof CLIENT_DRAFT_RENDERER_VERSION !== 'string'
      || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(CLIENT_DRAFT_RENDERER_VERSION)) fail();
    const renderOptions = { now, synthetic, audience: 'client',
      // Fresh readback time controls admission; the immutable source version
      // controls the printed date so next-day reconciliation is idempotent.
      documentRevisionAt: Date.parse(input?.finalResult?.SOURCE_MODIFIED_AT) };
    for (const key of ['callDetails', 'opportunityReview']) {
      if (Object.hasOwn(options, key)) renderOptions[key] = options[key];
    }
    const document = Buffer.from(renderFreeTestReport(input, renderOptions), 'utf8');
    if (document.length < 1 || document.length > MAX_DOCUMENT_BYTES) fail();
    const documentSha256 = hash(document);
    const scope = input.evidence.scopes[0];
    const generationKey = hash(`free-test-client-draft-v1\0${canonicalJson({
      environment: input.deployment.ENVIRONMENT,
      clientKey: input.deployment.CLIENT_KEY,
      deploymentKey: input.deployment.DEPLOYMENT_KEY,
      configurationVersion: input.deployment.CONFIGURATION_VERSION,
      finalSourceModifiedAt: input.finalResult.SOURCE_MODIFIED_AT,
      sourceRevision: input.finalResult.SOURCE_REVISION,
      rowsets: Object.fromEntries(['deployment', 'call', 'final_test_result'].map((kind) =>
        [kind, scope.analytics_readback.record_types[kind].rowset_digest])),
      rendererVersion: CLIENT_DRAFT_RENDERER_VERSION,
      documentSha256,
    })}`);
    const prepared = Object.freeze({ generationKey, documentSha256, document,
      periodStart: input.finalResult.TEST_STARTED_AT.slice(0, 10),
      periodEnd: input.finalResult.TEST_ENDED_AT.slice(0, 10),
      rendererVersion: CLIENT_DRAFT_RENDERER_VERSION, scope: Object.freeze({
        environment: input.deployment.ENVIRONMENT, clientKey: input.deployment.CLIENT_KEY,
        deploymentKey: input.deployment.DEPLOYMENT_KEY,
        configurationVersion: input.deployment.CONFIGURATION_VERSION,
        sourceRevision: input.finalResult.SOURCE_REVISION,
      }) });
    preparedDocuments.add(prepared);
    return prepared;
  } catch { fail(); }
}

async function prepareFreeTestDraft(input, options = {}) {
  try {
    const { generationKey, documentSha256, document } = prepareFreeTestDocument(input, options);
    const directory = privateDirectory(options.privateDirectory);
    const base = path.join(directory, `free-test-${generationKey}`);
    const files = { intent: `${base}.intent.json`, document: `${base}.html`, receipt: `${base}.receipt.json` };
    const identity = { schemaVersion: 1, generationKey, documentSha256,
      rendererVersion: CLIENT_DRAFT_RENDERER_VERSION };
    const intent = Buffer.from(canonicalJson({ ...identity, status: 'generation_intent' }), 'utf8');
    const receipt = Buffer.from(canonicalJson({ ...identity, status: REVIEW_STATE }), 'utf8');
    const existingIntent = readOptional(files.intent, MAX_RECEIPT_BYTES);
    const existingDocument = readOptional(files.document, MAX_DOCUMENT_BYTES);
    const existingReceipt = readOptional(files.receipt, MAX_RECEIPT_BYTES);
    let created = false;
    if (!existingIntent) {
      // Output or a receipt without its immutable intent is not attributable to
      // this operation, even if its bytes happen to match.
      if (existingDocument || existingReceipt) fail();
      created = exclusiveWrite(files.intent, intent);
      if (created) {
        exactBytes(readOptional(files.intent, MAX_RECEIPT_BYTES), intent);
        if (!exclusiveWrite(files.document, document)) fail();
      }
    }
    exactBytes(readOptional(files.intent, MAX_RECEIPT_BYTES), intent);
    exactBytes(readOptional(files.document, MAX_DOCUMENT_BYTES), document);
    // A complete matching document may recover only its missing receipt. The
    // original document is never rewritten and an inconsistent receipt blocks.
    if (existingReceipt) exactBytes(existingReceipt, receipt);
    else exclusiveWrite(files.receipt, receipt);
    exactBytes(readOptional(files.receipt, MAX_RECEIPT_BYTES), receipt);
    exactBytes(readOptional(files.document, MAX_DOCUMENT_BYTES), document);
    return Object.freeze({
      status: created ? 'draft_created_not_for_delivery' : 'existing_draft_verified_not_for_delivery',
      generationKey, documentSha256, receiptSha256: hash(receipt),
    });
  } catch { fail(); }
}

/** Compose the existing Analytics checkpoint wakeup with the local draft path.
 * readReconciledInput is a trusted application adapter, not a JSON payload: it
 * independently reads all required scopes and returns null while incomplete.
 * The event itself supplies neither report values nor a readiness assertion.
 * This adapter is deliberately not installed or scheduled by the module.
 */
function createReconciledDraftTrigger({ readReconciledInput, privateDirectory: directory,
  synthetic = false, now = Date.now } = {}) {
  if (typeof readReconciledInput !== 'function' || typeof now !== 'function'
    || typeof synthetic !== 'boolean') fail();
  return async function onReconciledScope(event) {
    try {
      const scopeKeys = ['CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
        'ENGAGEMENT_TYPE', 'ENVIRONMENT', 'SOURCE_REVISION'];
      const instant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString() === value;
      if (!event || Object.keys(event).sort().join(',') !== 'reconciledAt,recordType,scope,sourceModifiedAt'
        || !event.scope || Object.keys(event.scope).sort().join(',') !== scopeKeys.slice().sort().join(',')
        || !/^[a-f0-9]{64}$/.test(event.scope.CLIENT_KEY) || !/^[a-f0-9]{64}$/.test(event.scope.DEPLOYMENT_KEY)
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(event.scope.CONFIGURATION_VERSION)
        || !/^[a-f0-9]{40}$/.test(event.scope.SOURCE_REVISION)
        || !['deployment', 'call', 'final_test_result'].includes(event.recordType)
        || event.scope.ENVIRONMENT !== 'development' || event.scope.ENGAGEMENT_TYPE !== 'free_test'
        || !instant(event.sourceModifiedAt) || !instant(event.reconciledAt)
        || Date.parse(event.sourceModifiedAt) > Date.parse(event.reconciledAt)
        || Date.parse(event.reconciledAt) > now()) fail();
      const prepared = await readReconciledInput(event);
      if (prepared === null) return Object.freeze({ status: 'awaiting_reconciled_evidence' });
      if (!prepared || Object.keys(prepared).some((key) =>
        !['input', 'callDetails', 'opportunityReview'].includes(key))
        || !scopeKeys.every((key) => prepared.input?.deployment?.[key] === event.scope[key])) fail();
      const readback = prepared.input.evidence?.scopes?.[0]?.analytics_readback?.record_types?.[event.recordType];
      if (!readback || !Number.isFinite(Date.parse(readback.latest_source_modified_at))
        || Date.parse(readback.latest_source_modified_at) < Date.parse(event.sourceModifiedAt)) fail();
      return await prepareFreeTestDraft(prepared.input, { privateDirectory: directory, now: now(), synthetic,
        callDetails: prepared.callDetails,
        ...(Object.hasOwn(prepared, 'opportunityReview') ? { opportunityReview: prepared.opportunityReview } : {}),
      });
    } catch { fail(); }
  };
}

/** Bind the existing completed-test scan to validated private draft preparation.
 *
 * Construction requires trusted application dependencies; no request, Job
 * parameter or environment switch can install this callback. The deployed
 * handler leaves its factory null. The provider's complete-scope reader and
 * approved durable storage remain separate live-integration requirements.
 *
 * The optional review reader belongs to the existing results-review step. A
 * missing review prepares an explicitly unvalued draft; it never invents job
 * groups. Re-read canonical evidence after that asynchronous lookup so a source
 * correction during review retrieval cannot produce a stale document.
 */
function createTerminalDraftReconciler({ runtimeStore, runtimeConfig, analyticsStore,
  readCompleteScope, readOpportunityReview = null, privateDirectory: directory,
  synthetic = false, now = Date.now } = {}) {
  if ((readOpportunityReview !== null && typeof readOpportunityReview !== 'function')
    || typeof synthetic !== 'boolean' || typeof now !== 'function') fail();
  const readReconciledInput = createReconciledFreeTestInputReader({
    runtimeStore, runtimeConfig, analyticsStore, readCompleteScope, now,
  });
  return async function onTerminalReportReconciled(scope, options = {}) {
    try {
      if (!scope || Object.keys(scope).sort().join(',') !== 'clientId,deploymentId'
        || !options || typeof options !== 'object' || Array.isArray(options)
        || Object.keys(options).some((key) => key !== 'signal')
        || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) fail();
      const identity = Object.freeze({ clientId: scope.clientId, deploymentId: scope.deploymentId });
      const signal = options.signal;
      const assertActive = () => { if (signal?.aborted) fail(); };
      assertActive();
      let prepared = await readReconciledInput(identity, { signal });
      assertActive();
      if (prepared === null) return Object.freeze({ status: 'awaiting_reconciled_evidence' });
      let opportunityReview = null;
      if (readOpportunityReview) {
        opportunityReview = await readOpportunityReview(identity, Object.freeze({ signal }));
        assertActive();
        if (opportunityReview === undefined) fail();
        // Copy before another await: a mutable adapter view cannot change the
        // grouping or amounts while the current source is being reconciled.
        opportunityReview = structuredClone(opportunityReview);
        prepared = await readReconciledInput(identity, { signal });
        assertActive();
        if (prepared === null) return Object.freeze({ status: 'awaiting_reconciled_evidence' });
      }
      // The file writer below performs its validation and exclusive writes
      // synchronously. A timed-out scan cannot resume into a late file write.
      assertActive();
      return await prepareFreeTestDraft(prepared.input, { privateDirectory: directory,
        synthetic, now: now(), callDetails: prepared.callDetails, opportunityReview });
    } catch { fail(); }
  };
}

module.exports = { prepareFreeTestDocument, prepareFreeTestDraft, createReconciledDraftTrigger,
  createTerminalDraftReconciler, MAX_DOCUMENT_BYTES, REVIEW_STATE,
  isPreparedFreeTestDocument: (value) => preparedDocuments.has(value) };
